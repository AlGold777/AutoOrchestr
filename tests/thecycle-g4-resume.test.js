'use strict';
// G4.1: continue a research after a page reload. Crashes are simulated by leaving the durable state in the middle.
const test = require('node:test');
const assert = require('node:assert/strict');
const { createFakeIndexedDB, installKeyRange } = require('./thecycle-fake-idb.js');
require('../disput/custom-engine.js');
require('../disput/basic-schema.js');
const { createStateStore } = require('../disput/thecycle/state-store.js');
const { createBasicAdapter } = require('../disput/thecycle/basic-adapter.js');
const { createController } = require('../disput/thecycle/controller.js');
const context = require('../disput/thecycle/circle-context.js');
const { createCircleRunner } = require('../disput/thecycle/circle-runtime.js');
const { createBackupGate } = require('../disput/thecycle/backup-gate.js');
const telemetryApi = require('../disput/thecycle/telemetry.js');
installKeyRange();
const clone = (v) => JSON.parse(JSON.stringify(v));

async function fixture() {
  let denyBackup = false;
  const store = await createStateStore({ indexedDB: createFakeIndexedDB() });
  const values = new Map(), prompts = [], metadata = new Map(); let seq = 0, backups = 0, crashPrepare = true, held = 0;
  const storage = { async get(k) { return { [k]: values.get(k) }; }, async set(o) { for (const [k, v] of Object.entries(o)) values.set(k, clone(v)); } };
  const bridge = {
    capture: () => ({ models: ['GPT'], errors: [], schema: { schemaVersion: 1, origin: 'user', run: { policy: 'manual' }, steps: [{ ref: 'r1', kind: 'round', models: [{ name: 'GPT' }] }] } }),
    accept: () => ({ ok: true }), roleText: () => '', begin() {}, end() {}, hold() { held++; }, release() { held--; },
    async send(models, byModel, meta) {
      prompts.push({ runId: meta.runId, text: byModel.GPT });
      return { byModel: { GPT: { text: 'Evidence ' + prompts.length, status: 'SUCCESS', answered: true } } };
    }
  };
  const gate = createBackupGate({ clock: () => 1000 + backups, metadata: {
    async get(id) { return metadata.get(id) || null; },
    async put(id, rev, v) { if ((metadata.get(id)?.revision || 0) !== rev) return false; metadata.set(id, clone(v)); return true; } },
    backup: { async save(key, { requiredCommitId }) { backups++; return { key, verified: true, packetCommitId: requiredCommitId }; } } });
  const rows = []; let tseq = 0;
  const telemetry = telemetryApi.createTelemetry({ repository: { async append(r) { rows.push({ ...r, seq: ++tseq }); }, async list() { return rows; }, async clear() {} }, version: () => 't' });
  // The first runner "crashes" before its first cycle: prepareRun fails, the config and the research stay, the owner stays.
  const wrapped = Object.assign(Object.create(null), store, { prepareRun: (...a) => { if (crashPrepare) throw new Error('CRASH'); return store.prepareRun(...a); } });
  const make = (useStore) => createCircleRunner({ bridge, storage, activeStore: { async createActiveStateStore() { return { store: useStore, database: 'test', close() {} }; } },
    controllerApi: { createController }, adapterApi: { createBasicAdapter }, contextApi: context, telemetry,
    createBackup: async () => { if (denyBackup) throw new Error('NO_ACCESS'); return { gate, close() {} }; }, uuid: () => String(++seq) });
  const first = make(wrapped);
  const started = await first.start({ task: 'Investigate', maxCalls: 3 });
  crashPrepare = false;
  const id = started.researchId;
  return { deny: () => { denyBackup = true; }, store, prompts, rows, id, values, held: () => held, newRunner: () => make(store), gate,
    owner: () => store.getOwnership() };
}

// A crashed controller: takes the transport over and walks the journal to the wanted point (cycle 1).
async function crashAt(x, point) {
  const owner = await x.owner();
  const tok = await x.store.acquire({ researchId: x.id, ownerId: 'crashed-' + point, takeoverEpoch: owner.epoch });
  const runId = x.id + ':cycle:1', base = { researchId: x.id, runId, cycleId: 1 };
  let s = await x.store.load(x.id);
  if (point === 'READY') return tok;
  if (point === 'PAUSED') { await x.store.decide(tok, { expectedVersion: s.stateVersion, action: 'PAUSE', reason: 'TEST' }); return tok; }
  await x.store.prepareRun(tok, { expectedVersion: s.stateVersion, runId, cycleId: 1, pipelineRef: s.pipelineRef, maxCalls: 1 });
  const journal = x.store.journalFor(tok);
  await journal({ type: 'RUN_INTENT', ...base, maxCalls: 1 });
  await journal({ type: 'DISPATCH_INTENT', ...base, batchId: 'b1', models: ['GPT'] });
  if (point === 'RUNNING') return tok;
  await journal({ type: 'DISPATCH_RESPONSE', ...base, batchId: 'b1' });
  const report = { ...base, status: 'PIPELINE_COMPLETE', unresolvedBatchIds: [], steps: [{ outcome: { GPT: { ok: true, text: 'Evidence old' } } }] };
  await journal({ type: 'RUN_RESULT', ...base, report });
  if (point === 'COMMIT') return tok;
  s = await x.store.load(x.id);
  await x.store.commitPacket(tok, { expectedVersion: s.stateVersion, runId });
  return tok; // EVALUATE, backup still owed
}

for (const point of ['READY', 'COMMIT', 'EVALUATE']) {
  test('resume after a crash at ' + point + ': the cycle goes on, the recorded batch is not sent again', async () => {
    const x = await fixture();
    const old = await crashAt(x, point);
    const result = await x.newRunner().resume(x.id);
    const sent = x.prompts.map((p) => p.runId);
    assert.ok(!sent.includes(x.id + ':cycle:1') || point === 'READY', 'cycle 1 is not sent again');
    assert.equal(result.state.lastCommittedPacket >= 1, true);
    assert.equal(result.state.budget.usedCalls, 3);
    assert.equal(result.state.phase, 'PAUSED'); assert.equal(result.state.lastDecision.reason, 'BUDGET_EXHAUSTED');
    if (point !== 'READY') { assert.equal(sent[0], x.id + ':cycle:2'); assert.equal((await x.store.getPacket(x.id, 1)).status, 'RECORDED_RESULT'); }
    assert.equal(x.held(), 0);
    // takeover fenced the crashed writer
    await assert.rejects(x.store.journalFor(old)({ type: 'RUN_ERROR', researchId: x.id, runId: x.id + ':cycle:1', cycleId: 1 }), /STALE_OWNER/);
  });
}

test('resume of a PAUSED research is the "Continue" press: runs on', async () => {
  const x = await fixture();
  await crashAt(x, 'PAUSED');
  const result = await x.newRunner().resume(x.id);
  assert.equal(x.prompts.length, 3); assert.equal(result.state.budget.usedCalls, 3);
});

test('crash in RUNNING with a request out: resume pauses UNKNOWN_DISPATCH_AFTER_RELOAD, nothing is sent', async () => {
  const x = await fixture();
  await crashAt(x, 'RUNNING');
  const runner = x.newRunner();
  const result = await runner.resume(x.id);
  assert.equal(x.prompts.length, 0);
  assert.equal(result.outcomes.at(-1).reason, 'UNKNOWN_DISPATCH_AFTER_RELOAD');
  assert.equal(result.state.phase, 'RECONCILE');
  const status = await runner.snapshot(x.id);
  assert.equal(status.unknown, true); assert.equal(status.pauseReason, 'UNKNOWN_DISPATCH_AFTER_RELOAD');
  // resume again: still no send, still the same question
  const again = await x.newRunner().resume(x.id);
  assert.equal(x.prompts.length, 0); assert.equal(again.outcomes.at(-1).reason, 'UNKNOWN_DISPATCH_AFTER_RELOAD');
});

test('abandon: batch ABANDONED_UNKNOWN, budget stays spent, PARTIAL_RECOVERY, pause, then RESUME goes on', async () => {
  const x = await fixture();
  await crashAt(x, 'RUNNING');
  const result = await x.newRunner().resolveUnknown(x.id, 'abandon');
  assert.equal(x.prompts.length, 0);
  const run = await x.store.getRun(x.id, x.id + ':cycle:1');
  assert.deepEqual(run.batches.map((b) => b.status), ['ABANDONED_UNKNOWN']);
  assert.equal(result.state.budget.usedCalls, 1);
  assert.equal((await x.store.getPacket(x.id, 1)).status, 'PARTIAL_RECOVERY');
  assert.equal(result.state.phase, 'PAUSED'); assert.equal(result.state.lastDecision.reason, 'PARTIAL_OR_UNCERTAIN');
  // a person presses Continue: the next cycle starts from the task alone (the partial packet is no evidence) and does not break
  const next = await x.newRunner().resume(x.id);
  assert.equal(x.prompts.length, 2);
  assert.equal(x.prompts[0].runId, x.id + ':cycle:2'); assert.match(x.prompts[0].text, /Investigate/); assert.doesNotMatch(x.prompts[0].text, /CIRCLE: iteration/);
  assert.equal(next.state.budget.usedCalls, 3);
  assert.equal((await x.store.getPacket(x.id, 2)).status, 'RECORDED_RESULT');
});

test('abandon without an unknown outcome is refused', async () => {
  const x = await fixture();
  await crashAt(x, 'PAUSED');
  await assert.rejects(x.newRunner().resolveUnknown(x.id, 'abandon'), /CIRCLE_NOTHING_TO_RESOLVE/);
});

test('close: the research ends closed, unknown batch kept, transport free, nothing sent', async () => {
  const x = await fixture();
  await crashAt(x, 'RUNNING');
  const result = await x.newRunner().resolveUnknown(x.id, 'close');
  assert.equal(x.prompts.length, 0);
  assert.equal(result.state.phase, 'COMPLETED'); assert.equal(result.state.closedReason, 'OWNER_STOP_UNRESOLVED');
  assert.deepEqual((await x.store.getRun(x.id, x.id + ':cycle:1')).batches.map((b) => b.status), ['UNKNOWN']);
  assert.equal((await x.owner())?.ownerId ?? null, null);
});

test('close of a paused research (no active run) frees the transport', async () => {
  const x = await fixture();
  await crashAt(x, 'PAUSED');
  const result = await x.newRunner().resolveUnknown(x.id, 'close');
  assert.equal(result.state.phase, 'PAUSED'); assert.equal(result.state.stopRequested, true);
  assert.equal((await x.owner())?.ownerId ?? null, null);
});

test('two resumes at once: only one succeeds', async () => {
  const x = await fixture();
  await crashAt(x, 'COMMIT');
  const settled = await Promise.allSettled([x.newRunner().resume(x.id), x.newRunner().resume(x.id)]);
  assert.equal(settled.filter((r) => r.status === 'fulfilled').length, 1);
  assert.match(String(settled.find((r) => r.status === 'rejected').reason.message), /STALE_OWNER|TRANSPORT_OWNED|STALE_STATE|RUN_NOT_ALLOWED|COMMIT_NOT_ALLOWED|STALE/);
  // the same runner refuses a second concurrent resume outright
  const runner = x.newRunner();
  const a = runner.resume(x.id);
  await assert.rejects(runner.resume(x.id), /CIRCLE_ALREADY_RUNNING/);
  await a.catch(() => {});
});

test('no access to the backup directory: nothing sent, ownership and state untouched', async () => {
  const x = await fixture();
  await crashAt(x, 'RUNNING');
  x.deny();
  const before = await x.owner();
  await assert.rejects(x.newRunner().resume(x.id), /NO_ACCESS/);
  await assert.rejects(x.newRunner().resolveUnknown(x.id, 'abandon'), /NO_ACCESS/);
  assert.equal(x.prompts.length, 0);
  assert.deepEqual(await x.owner(), before);
  assert.equal((await x.store.load(x.id)).phase, 'RUNNING');
  assert.equal(x.held(), 0);
});

test('unknown research id is refused', async () => {
  const x = await fixture();
  await assert.rejects(x.newRunner().resume('circle-none'), /CIRCLE_RESEARCH_NOT_FOUND/);
});
