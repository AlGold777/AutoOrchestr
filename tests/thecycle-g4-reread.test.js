'use strict';
// G4.1b: after a reload the answer of an unclear batch is taken only from the page, by the journaled delivery token;
// the owner liveness heartbeat; the "waiting research" flag. Nothing is ever resent.
const test = require('node:test');
const assert = require('node:assert/strict');
const { createFakeIndexedDB, installKeyRange } = require('./thecycle-fake-idb.js');
require('../disput/custom-engine.js');
require('../disput/basic-schema.js');
const { createStateStore } = require('../disput/thecycle/state-store.js');
const { createBasicAdapter } = require('../disput/thecycle/basic-adapter.js');
const { createController } = require('../disput/thecycle/controller.js');
const context = require('../disput/thecycle/circle-context.js');
const reconciliation = require('../disput/thecycle/transport-reconciliation.js');
const { createCircleRunner } = require('../disput/thecycle/circle-runtime.js');
const { createBackupGate } = require('../disput/thecycle/backup-gate.js');
installKeyRange();
const clone = (v) => JSON.parse(JSON.stringify(v));
const TOKEN = '[[AO-abc234]]';

async function fixture({ withPrompt = true, prompt = 'Investigate ' + TOKEN } = {}) {
  const store = await createStateStore({ indexedDB: createFakeIndexedDB() });
  const values = new Map(), sends = [], rereads = [], metadata = new Map(); let seq = 0, backups = 0, crashPrepare = true, clock = 1000000;
  const hooks = { reread: async () => ({ found: false, reason: 'no_own_turn' }), onSend: null };
  const storage = { async get(k) { return { [k]: values.get(k) }; }, async set(o) { for (const [k, v] of Object.entries(o)) values.set(k, clone(v)); } };
  const bridge = {
    capture: () => ({ models: ['GPT'], errors: [], schema: { schemaVersion: 1, origin: 'user', run: { policy: 'manual' }, steps: [{ ref: 'r1', kind: 'round', models: [{ name: 'GPT' }] }] } }),
    accept: () => ({ ok: true }), roleText: () => '', begin() {}, end() {}, hold() {}, release() {},
    async send(models, byModel, meta) {
      sends.push({ runId: meta.runId, text: byModel.GPT });
      if (hooks.onSend) return hooks.onSend(models, byModel, meta);
      return { byModel: { GPT: { text: 'Evidence ' + sends.length, status: 'SUCCESS', answered: true } } };
    },
    async reread(request) { rereads.push(request); return hooks.reread(request); }
  };
  const gate = createBackupGate({ clock: () => 1000 + backups, metadata: {
    async get(id) { return metadata.get(id) || null; },
    async put(id, rev, v) { if ((metadata.get(id)?.revision || 0) !== rev) return false; metadata.set(id, clone(v)); return true; } },
    backup: { async save(key, { requiredCommitId }) { backups++; return { key, verified: true, packetCommitId: requiredCommitId }; } } });
  const wrapped = Object.assign(Object.create(null), store, { prepareRun: (...a) => { if (crashPrepare) throw new Error('CRASH'); return store.prepareRun(...a); } });
  const make = (useStore, extra = {}) => createCircleRunner({ bridge, storage, activeStore: { async createActiveStateStore() { return { store: useStore, database: 'test', close() {} }; } },
    controllerApi: { createController }, adapterApi: { createBasicAdapter }, contextApi: context, telemetry: null, reconcileApi: reconciliation, now: () => clock,
    createBackup: async () => ({ gate, close() {} }), uuid: () => String(++seq), ...extra });
  const first = make(wrapped);
  const started = await first.start({ task: 'Investigate', maxCalls: 3 });
  crashPrepare = false;
  const id = started.researchId;
  const x = { store, sends, rereads, id, values, hooks, newRunner: (extra) => make(store, extra), owner: () => store.getOwnership(),
    setClock: (v) => { clock = v; }, clock: () => clock, bridge, make };
  return x;
}

// A crashed controller left a request in flight: DISPATCH_INTENT (and the journaled prompt) are in the journal, no answer.
async function crashInFlight(x, { withPrompt = true, prompt = 'Investigate ' + TOKEN } = {}) {
  const owner = await x.owner();
  const tok = await x.store.acquire({ researchId: x.id, ownerId: 'crashed', takeoverEpoch: owner.epoch });
  const runId = x.id + ':cycle:1', base = { researchId: x.id, runId, cycleId: 1 };
  const s = await x.store.load(x.id);
  await x.store.prepareRun(tok, { expectedVersion: s.stateVersion, runId, cycleId: 1, pipelineRef: s.pipelineRef, maxCalls: 1 });
  const journal = x.store.journalFor(tok);
  await journal({ type: 'RUN_INTENT', ...base, maxCalls: 1 });
  await journal({ type: 'DISPATCH_INTENT', ...base, batchId: 'b1', models: ['GPT'] });
  if (withPrompt) await journal({ type: 'DISPATCH_PROMPT', ...base, batchId: 'b1', prompts: { GPT: prompt } });
  return tok;
}
const found = (text = 'Answer from the page') => async () => ({ found: true, confirmed: true, text, status: 'SUCCESS', completion: 'complete' });

test('send journals the prompt with the delivery token BEFORE the request outcome, in order', async () => {
  const x = await fixture();
  x.hooks.onSend = async (models, byModel, meta) => {
    await meta.onDispatchPrompts({ GPT: byModel.GPT + ' ' + TOKEN });
    throw new Error('PAGE_RELOADED'); // the page died after the request left
  };
  await x.newRunner().resume(x.id).catch(() => {});
  const events = (await x.store.getEvents(x.id, x.id + ':cycle:1')).map((e) => e.payload.type);
  assert.deepEqual(events.slice(0, 4), ['RUN_INTENT', 'DISPATCH_INTENT', 'DISPATCH_PROMPT', 'DISPATCH_UNKNOWN']);
  const prompt = (await x.store.getEvents(x.id, x.id + ':cycle:1')).find((e) => e.payload.type === 'DISPATCH_PROMPT').payload;
  assert.match(prompt.prompts.GPT, /\[\[AO-abc234\]\]/);
});

// Live run 2026-11-27: the transport journals the prompts under upper-cased model names («DEEPSEEK»).
test('journaled prompt keyed by the upper-cased model name is found', async () => {
  const x = await fixture();
  const owner = await x.owner();
  const tok = await x.store.acquire({ researchId: x.id, ownerId: 'crashed', takeoverEpoch: owner.epoch });
  const runId = x.id + ':cycle:1', base = { researchId: x.id, runId, cycleId: 1 };
  const s = await x.store.load(x.id);
  await x.store.prepareRun(tok, { expectedVersion: s.stateVersion, runId, cycleId: 1, pipelineRef: s.pipelineRef, maxCalls: 1 });
  const journal = x.store.journalFor(tok);
  await journal({ type: 'RUN_INTENT', ...base, maxCalls: 1 });
  await journal({ type: 'DISPATCH_INTENT', ...base, batchId: 'b1', models: ['DeepSeek'] });
  await journal({ type: 'DISPATCH_PROMPT', ...base, batchId: 'b1', prompts: { DEEPSEEK: 'Investigate ' + TOKEN } });
  x.hooks.reread = found();
  await x.newRunner().resume(x.id);
  assert.equal(x.sends.length, 0);
  assert.equal(x.rereads[0].sentPrompt, 'Investigate ' + TOKEN); assert.equal(x.rereads[0].modelName, 'DeepSeek');
  assert.equal(x.rereads[0].detached, true);
  assert.deepEqual((await x.store.getRun(x.id, runId)).batches.map((b) => b.status), ['RESPONSE']);
});

test('reread finds the confirmed answer: batch RESPONSE, packet recorded, nothing sent again', async () => {
  const x = await fixture();
  await crashInFlight(x);
  x.hooks.reread = found();
  const result = await x.newRunner().resume(x.id);
  assert.equal(x.sends.length, 0);
  assert.equal(x.rereads.length, 1);
  assert.equal(x.rereads[0].modelName, 'GPT'); assert.equal(x.rereads[0].sentPrompt, 'Investigate ' + TOKEN);
  const run = await x.store.getRun(x.id, x.id + ':cycle:1');
  assert.deepEqual(run.batches.map((b) => b.status), ['RESPONSE']);
  assert.equal((await x.store.getPacket(x.id, 1)).status, 'PARTIAL_RECOVERY');
  const rec = (await x.store.getEvents(x.id, x.id + ':cycle:1')).find((e) => e.eventId === 'RECONCILED:b1').payload;
  assert.equal(rec.evidence.verified, true); assert.equal(rec.evidence.answers.GPT, 'Answer from the page');
  assert.equal(rec.evidence.source, 'BASIC_REREAD_OWN_TURN'); assert.equal(rec.evidence.reference, TOKEN);
  assert.equal(result.state.phase, 'PAUSED'); assert.equal(result.state.budget.usedCalls, 1);
});

for (const [name, reply, expected] of [
  ['page shows no own turn', async () => ({ found: false, reason: 'no_own_turn' }), 1],
  ['answer found but not confirmed by the token', async () => ({ found: true, confirmed: false, text: 'partial' }), 1],
  ['empty confirmed text', async () => ({ found: true, confirmed: true, text: '  ' }), 1],
  ['confirmed but completion partial', async () => ({ found: true, confirmed: true, text: 'half', status: 'SUCCESS', completion: 'partial' }), 1],
  ['confirmed but status PARTIAL', async () => ({ found: true, confirmed: true, text: 'half', status: 'PARTIAL', completion: 'complete' }), 1],
  ['reread throws', async () => { throw new Error('PAGE_GONE'); }, 1]
]) {
  test('pause UNKNOWN_DISPATCH_AFTER_RELOAD, nothing settled: ' + name, async () => {
    const x = await fixture();
    await crashInFlight(x);
    x.hooks.reread = reply;
    const runner = x.newRunner();
    const result = await runner.resume(x.id);
    assert.equal(x.sends.length, 0); assert.equal(x.rereads.length, expected);
    assert.equal(result.outcomes.at(-1).reason, 'UNKNOWN_DISPATCH_AFTER_RELOAD');
    assert.equal(result.state.phase, 'RECONCILE');
    assert.notEqual((await x.store.getRun(x.id, x.id + ':cycle:1')).batches[0].status, 'RESPONSE');
    assert.equal((await runner.snapshot(x.id)).unknown, true);
    // the human choice stays available
    const abandoned = await x.newRunner().resolveUnknown(x.id, 'abandon');
    assert.equal(abandoned.state.phase, 'PAUSED');
  });
}

test('prompt without a delivery token: not asked, pause', async () => {
  const x = await fixture();
  await crashInFlight(x, { prompt: 'Investigate without a mark' });
  x.hooks.reread = found();
  const result = await x.newRunner().resume(x.id);
  assert.equal(x.rereads.length, 0); assert.equal(result.outcomes.at(-1).reason, 'UNKNOWN_DISPATCH_AFTER_RELOAD');
});

test('no journaled prompt (older journal): not asked, pause', async () => {
  const x = await fixture();
  await crashInFlight(x, { withPrompt: false });
  x.hooks.reread = found();
  const result = await x.newRunner().resume(x.id);
  assert.equal(x.rereads.length, 0); assert.equal(result.outcomes.at(-1).reason, 'UNKNOWN_DISPATCH_AFTER_RELOAD');
});

test('without a reread in the bridge: pause as before', async () => {
  const x = await fixture();
  await crashInFlight(x);
  const bare = { ...x.bridge, reread: undefined };
  const runner = createCircleRunner({ bridge: bare, storage: { get: async (k) => ({ [k]: x.values.get(k) }), set: async (o) => { for (const [k, v] of Object.entries(o)) x.values.set(k, clone(v)); } },
    activeStore: { async createActiveStateStore() { return { store: x.store, database: 'test', close() {} }; } }, controllerApi: { createController }, adapterApi: { createBasicAdapter },
    contextApi: context, telemetry: null, reconcileApi: reconciliation, createBackup: async () => ({ gate: { persist: async () => ({}), assertCanStartCycle: async () => {}, requireCommit: async () => {} }, close() {} }), uuid: () => 'x' + Math.random() });
  const result = await runner.resume(x.id);
  assert.equal(result.outcomes.at(-1).reason, 'UNKNOWN_DISPATCH_AFTER_RELOAD');
});

// The fail-closed reconciliation: duplicate evidence, evidence of a foreign epoch, evidence without verified.
for (const [name, tamper] of [
  ['two evidence items for one batch', (input) => ({ ...input, evidence: [input.evidence[0], { ...input.evidence[0], reference: 'second' }] })],
  ['foreign owner epoch', (input) => ({ ...input, evidence: [{ ...input.evidence[0], ownerEpoch: input.evidence[0].ownerEpoch + 7 }] })],
  ['evidence not verified', (input) => ({ ...input, evidence: [{ ...input.evidence[0], verified: false }] })]
]) {
  test('reconciliation rejects: ' + name + ' -> pause', async () => {
    const x = await fixture();
    await crashInFlight(x);
    x.hooks.reread = found();
    const tampered = { reconcile: (input) => reconciliation.reconcile(tamper(input)) };
    const result = await x.newRunner({ reconcileApi: tampered }).resume(x.id);
    assert.equal(x.sends.length, 0);
    assert.equal(result.outcomes.at(-1).reason, 'UNKNOWN_DISPATCH_AFTER_RELOAD');
    assert.notEqual((await x.store.getRun(x.id, x.id + ':cycle:1')).batches[0].status, 'RESPONSE');
  });
}

// ---- owner liveness ----
const hbKey = (id) => 'thecycle.circle.heartbeat.' + id;

for (const mode of ['resume', 'abandon', 'close']) {
  test('fresh heartbeat of another runner: ' + mode + ' refused with CIRCLE_ACTIVE_ELSEWHERE, state untouched', async () => {
    const x = await fixture();
    await crashInFlight(x);
    x.values.set(hbKey(x.id), { ownerId: 'other-tab', at: x.clock() - 5000 });
    const before = await x.owner();
    const runner = x.newRunner();
    const call = mode === 'resume' ? runner.resume(x.id) : runner.resolveUnknown(x.id, mode);
    await assert.rejects(call, /CIRCLE_ACTIVE_ELSEWHERE/);
    assert.deepEqual(await x.owner(), before);
    assert.equal(x.sends.length, 0); assert.equal(x.rereads.length, 0);
    assert.equal((await x.store.load(x.id)).phase, 'RUNNING');
  });
}

test('snapshot of a research working in another tab: activeElsewhere, no unknown-outcome buttons', async () => {
  const x = await fixture();
  await crashInFlight(x);
  x.values.set(hbKey(x.id), { ownerId: 'other-tab', at: x.clock() - 1000 });
  const status = await x.newRunner().snapshot(x.id);
  assert.equal(status.activeElsewhere, true); assert.equal(status.unknown, false); assert.equal(status.pauseReason, 'CIRCLE_ACTIVE_ELSEWHERE');
});

test('stale heartbeat of another runner (180 s and older) allows recovery', async () => {
  const x = await fixture();
  await crashInFlight(x);
  x.values.set(hbKey(x.id), { ownerId: 'other-tab', at: x.clock() - 181000 });
  const result = await x.newRunner().resume(x.id);
  assert.equal(result.outcomes.at(-1).reason, 'UNKNOWN_DISPATCH_AFTER_RELOAD');
  assert.equal((await x.newRunner().snapshot(x.id)).activeElsewhere, false);
});

test('own heartbeat (same runner id) never blocks recovery', async () => {
  const x = await fixture();
  await crashInFlight(x);
  x.values.set(hbKey(x.id), { ownerId: 'tab-1', at: x.clock() - 1000 });
  const result = await x.newRunner({ runnerId: 'tab-1' }).resume(x.id);
  assert.equal(result.outcomes.at(-1).reason, 'UNKNOWN_DISPATCH_AFTER_RELOAD');
});

test('while working the page writes its heartbeat; at the end it is released', async () => {
  const x = await fixture();
  const owner = await x.owner();
  const tok = await x.store.acquire({ researchId: x.id, ownerId: 'crashed', takeoverEpoch: owner.epoch });
  const s = await x.store.load(x.id);
  await x.store.decide(tok, { expectedVersion: s.stateVersion, action: 'PAUSE', reason: 'TEST' });
  let seen = null;
  x.hooks.onSend = async () => { seen = clone(x.values.get(hbKey(x.id))); return { byModel: { GPT: { text: 'ok', status: 'SUCCESS', answered: true } } }; };
  await x.newRunner({ runnerId: 'tab-9' }).resume(x.id);
  assert.deepEqual(seen, { ownerId: 'tab-9', at: x.clock() });
  assert.equal(x.values.get(hbKey(x.id)).at, 0);
});

// ---- the "waiting research" flag ----
test('flag stays while the research waits for a person, is cleared by a final state', async () => {
  const x = await fixture();
  await crashInFlight(x);
  await x.newRunner().resume(x.id);
  const flag = x.values.get('thecycle.circle.pending');
  assert.equal(flag.researchId, x.id); assert.equal(flag.phase, 'RECONCILE'); assert.equal(flag.at, x.clock());
  await x.newRunner().resolveUnknown(x.id, 'close');
  assert.equal(x.values.get('thecycle.circle.pending'), null);
});

test('the text must pass bridge.accept with text and completion, as on the ordinary path', async () => {
  const x = await fixture();
  await crashInFlight(x);
  x.hooks.reread = found('Rejected text');
  const seen = [];
  const bridge = { ...x.bridge, accept: (r) => { seen.push(r); return { ok: false, reason: 'refusal' }; } };
  const result = await x.make(x.store, { bridge }).resume(x.id);
  assert.equal(seen.length, 1); assert.equal(seen[0].text, 'Rejected text'); assert.equal(seen[0].completion, 'complete');
  assert.equal(result.outcomes.at(-1).reason, 'UNKNOWN_DISPATCH_AFTER_RELOAD');
  assert.notEqual((await x.store.getRun(x.id, x.id + ':cycle:1')).batches[0].status, 'RESPONSE');
});

test('page runner id: new on every load, kept only over a reload (source check)', () => {
  const src = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'results.js'), 'utf8');
  assert.match(src, /getEntriesByType\('navigation'\)\[0\]\?\.type === 'reload'/);
  assert.match(src, /isReload \? sessionStorage\.getItem\('thecycle\.circle\.runnerId'\) : null/);
});
