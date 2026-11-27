'use strict';
// G5: automatic part of the integral acceptance. End-to-end scenarios on the real state store (fake IndexedDB), controller,
// Circle runtime, policy, Basic adapter and the Basic engine; only the bridge (model answers by a script) and the backup copy are fakes.
// Every scenario ends with the same invariant: every transport request is unique, no batch is sent twice, usedCalls <= maxCalls.
const test = require('node:test');
const assert = require('node:assert/strict');
const { createFakeIndexedDB, installKeyRange } = require('./thecycle-fake-idb.js');
require('../disput/custom-engine.js');
require('../disput/basic-schema.js');
const { createStateStore } = require('../disput/thecycle/state-store.js');
const { createBasicAdapter } = require('../disput/thecycle/basic-adapter.js');
const { createController } = require('../disput/thecycle/controller.js');
const context = require('../disput/thecycle/circle-context.js');
const policyApi = require('../disput/thecycle/circle-policy.js');
const reconciliation = require('../disput/thecycle/transport-reconciliation.js');
const { createCircleRunner } = require('../disput/thecycle/circle-runtime.js');
const { createBackupGate } = require('../disput/thecycle/backup-gate.js');
const handleManager = require('../disput/thecycle/directory-handle-manager.js');
const { restore } = require('../disput/thecycle/restore-service.js');
installKeyRange();

const clone = (v) => JSON.parse(JSON.stringify(v));
const json = (o) => JSON.stringify(o);
const isAnalyst = (t) => t.includes('Ты управляешь исследованием');
const isVerifier = (t) => t.includes('Ты независимый проверяющий');
const TOKEN = '[[AO-abc234]]';
const oneRound = (models) => ({ schemaVersion: 1, origin: 'user', run: { policy: 'manual' }, steps: [{ ref: 'r1', kind: 'round', models: models.map((name) => ({ name })) }] });
const summarySchema = { schemaVersion: 1, origin: 'user', run: { policy: 'manual' }, steps: [
  { ref: 'r1', kind: 'round', models: [{ name: 'GPT' }] }, { ref: 'r2', kind: 'round', input: 'previous', models: [{ name: 'GPT' }] }] };
const refOf = (cycle, step = 1, model = 'GPT') => 'cycle=' + cycle + ' step=' + step + ' model=' + model;
const cont = (ref) => json({ action: 'CONTINUE', reason: 'дальше', refs: [ref] });
const complete = (ref) => json({ action: 'COMPLETE', reason: 'готово', refs: [ref] });
const cycleOf = (runId) => Number(/:cycle:(\d+)$/.exec(runId)[1]);

// opts.analyst / opts.verifier: array of answers (shifted) or function(ctx). opts.onSend(ctx, meta): a non-undefined result replaces the answer.
function harness({ models = ['GPT'], workSchema = null, analyst = [], verifier = [], onSend = null, createBackup, withReread = false } = {}) {
  const indexedDB = createFakeIndexedDB();
  const transport = [], values = new Map(), metadata = new Map(), perRun = new Map();
  const hooks = { reread: async () => ({ found: false, reason: 'no_own_turn' }), rereads: [] };
  const queues = { analyst, verifier };
  let seq = 0, backups = 0, store, crashPrepare = false;
  const storage = { async get(k) { return { [k]: values.get(k) }; }, async set(o) { for (const [k, v] of Object.entries(o)) values.set(k, clone(v)); } };
  const pick = (role, ctx) => {
    const q = queues[role];
    return typeof q === 'function' ? q(ctx) : q.shift();
  };
  const bridge = {
    capture: () => ({ models, errors: [], schema: workSchema || oneRound(models) }),
    accept: () => ({ ok: true }), roleText: () => '', begin() {}, end() {}, hold() {}, release() {},
    async send(names, byModel, meta) {
      const out = {};
      for (const name of names) {
        const text = byModel[name], nth = perRun.get(meta.runId) || 0;
        const role = isAnalyst(text) ? 'analyst' : isVerifier(text) ? 'verifier' : 'work';
        const ctx = { role, model: name, text, runId: meta.runId, batchId: meta.batchId, cycle: cycleOf(meta.runId), nth, n: transport.length + 1 };
        transport.push(ctx);
        perRun.set(meta.runId, nth + 1);
        if (onSend) { const custom = await onSend(ctx, meta); if (custom !== undefined) return custom; }
        const answer = role === 'work'
          ? (workSchema === summarySchema && nth === 1 ? 'SUMMARY c' + ctx.cycle + ' ' + 's'.repeat(300) : 'Work ' + name + ' c' + ctx.cycle + ' ' + 'w'.repeat(200))
          : pick(role, ctx);
        out[name] = { text: answer, status: 'SUCCESS', answered: true };
      }
      return { byModel: out };
    },
    async reread(request) { hooks.rereads.push(request); return hooks.reread(request); }
  };
  const gate = createBackupGate({ clock: () => 1000 + backups, metadata: {
    async get(id) { return metadata.get(id) || null; },
    async put(id, rev, v) { if ((metadata.get(id)?.revision || 0) !== rev) return false; metadata.set(id, clone(v)); return true; } },
    backup: { async save(key, { requiredCommitId }) { backups++; return { key, verified: true, packetCommitId: requiredCommitId }; } } });
  const x = { transport, values, hooks, indexedDB, metadata, queues, bridge: withReread ? bridge : Object.assign({}, bridge, { reread: undefined }) };
  x.make = (useStore, extra = {}) => createCircleRunner({ bridge: x.bridge, storage, activeStore: { async createActiveStateStore() { return { store: useStore, database: 'test', close() {} }; } },
    controllerApi: { createController }, adapterApi: { createBasicAdapter }, contextApi: context, policyApi, reconcileApi: reconciliation, telemetry: null,
    createBackup: createBackup === undefined ? async () => ({ gate, close() {} }) : createBackup, uuid: () => String(++seq), ...extra });
  x.init = async () => {
    store = await createStateStore({ indexedDB }); x.store = store;
    const wrapped = Object.assign(Object.create(null), store, { prepareRun: (...a) => { if (crashPrepare) throw new Error('CRASH'); return store.prepareRun(...a); } });
    x.runner = x.make(store);
    // A first runner whose controller "dies" before the first cycle: the research and its config stay, the owner stays.
    x.crashStart = async (opts) => { crashPrepare = true; const r = await x.make(wrapped).start(opts); crashPrepare = false; x.id = r.researchId; return r.researchId; };
    x.newRunner = (extra) => x.make(store, extra);
    return x;
  };
  return x;
}

// A crashed controller takes the transport over and walks the journal to the wanted point of cycle 1.
async function crashAt(x, point, prompt = 'Investigate ' + TOKEN) {
  const owner = await x.store.getOwnership();
  const tok = await x.store.acquire({ researchId: x.id, ownerId: 'crashed-' + point, takeoverEpoch: owner.epoch });
  const runId = x.id + ':cycle:1', base = { researchId: x.id, runId, cycleId: 1 };
  let s = await x.store.load(x.id);
  if (point === 'READY') return tok;
  await x.store.prepareRun(tok, { expectedVersion: s.stateVersion, runId, cycleId: 1, pipelineRef: s.pipelineRef, maxCalls: 1 });
  const journal = x.store.journalFor(tok);
  await journal({ type: 'RUN_INTENT', ...base, maxCalls: 1 });
  await journal({ type: 'DISPATCH_INTENT', ...base, batchId: 'b1', models: ['GPT'] });
  if (point === 'RUNNING') { await journal({ type: 'DISPATCH_PROMPT', ...base, batchId: 'b1', prompts: { GPT: prompt } }); return tok; }
  await journal({ type: 'DISPATCH_RESPONSE', ...base, batchId: 'b1' });
  const report = { ...base, status: 'PIPELINE_COMPLETE', unresolvedBatchIds: [], steps: [{ outcome: { GPT: { ok: true, text: 'Evidence old' } } }] };
  await journal({ type: 'RUN_RESULT', ...base, report });
  if (point === 'COMMIT') return tok;
  s = await x.store.load(x.id);
  await x.store.commitPacket(tok, { expectedVersion: s.stateVersion, runId });
  return tok;
}

// The summary invariant of every scenario. extraUsed: calls journaled by a "crashed" controller outside the fake transport.
async function invariants(x, ids, extraUsed = {}) {
  const keys = x.transport.map((t) => t.runId + '|' + t.batchId + '|' + t.model);
  assert.equal(new Set(keys).size, keys.length, 'каждый transport request уникален, ни одна пачка не отправлена дважды');
  for (const id of ids) {
    const state = await x.store.load(id);
    assert.ok(state.budget.usedCalls <= state.budget.maxCalls, 'usedCalls <= maxCalls');
    const sent = x.transport.filter((t) => t.runId.startsWith(id + ':')).length;
    assert.equal(state.budget.usedCalls, sent + (extraUsed[id] || 0), 'usedCalls равен числу отправок');
  }
}

test('1. sixty work+analyst cycles: one send per batch, budget = sends, summary context does not grow, packets 1..120 in a row', async () => {
  const x = await harness({ workSchema: summarySchema, analyst: (ctx) => (ctx.cycle === 120 ? complete(refOf(119, 2)) : cont(refOf(ctx.cycle - 1, 2))) }).init();
  const r = await x.runner.start({ task: 'Solve it', maxCalls: 200, contextMode: 'latest-summary' });
  assert.equal(r.state.phase, 'COMPLETED'); assert.equal(r.state.finalStatus, 'PARTIAL');
  assert.equal(x.transport.length, 180); assert.equal(r.state.budget.usedCalls, 180);
  assert.equal(r.state.lastCommittedPacket, 120);
  for (let n = 1; n <= 120; n++) {
    const p = await x.store.getPacket(r.researchId, n);
    assert.equal(p.status, 'RECORDED_RESULT', 'packet ' + n); assert.equal(p.cycleId, n);
    assert.equal(/:analyst:/.test(p.pipelineRef), n % 2 === 0, 'roles alternate at ' + n);
    const run = await x.store.getRun(r.researchId, p.runId);
    assert.equal(run.batches.length, n % 2 ? 2 : 1); assert.ok(run.batches.every((b) => b.status === 'RESPONSE'));
  }
  // context is bounded: the first step of every work cycle after the 2nd and every analyst prompt stay the same size
  const firsts = x.transport.filter((t) => t.role === 'work' && t.nth === 0 && t.cycle >= 3).map((t) => t.text.length);
  assert.equal(firsts.length, 59); assert.ok(Math.max(...firsts) - Math.min(...firsts) < 40, 'work task is bounded: ' + Math.min(...firsts) + '..' + Math.max(...firsts));
  assert.ok(Math.max(...firsts) < 4000);
  const analysts = x.transport.filter((t) => t.role === 'analyst' && t.cycle >= 42).map((t) => t.text.length);
  assert.ok(Math.max(...analysts) - Math.min(...analysts) < 120, 'analyst task is bounded');
  assert.ok(x.transport.find((t) => t.cycle === 119 && t.nth === 0).text.includes('SUMMARY c117'), 'work cycle reads the latest summary');
  assert.ok(!x.transport.find((t) => t.cycle === 119 && t.nth === 0).text.includes('SUMMARY c115'), 'older summaries are not carried');
  await invariants(x, [r.researchId]);
});

test('2. strategy change: valid schema, the next work cycles run by it, stored on the analyst packet', async () => {
  const next = { schemaVersion: 1, origin: 'user', run: { policy: 'manual' }, steps: [{ ref: 'r1', kind: 'round', input: 'none', task: 'NEWSTRATEGY', models: [{ name: 'GPT' }] }] };
  const change = json({ action: 'CHANGE_STRATEGY', reason: 'другая стратегия', refs: [refOf(1)], schema: next });
  const x = await harness({ analyst: [change, cont(refOf(3)), complete(refOf(5))] }).init();
  const r = await x.runner.start({ task: 'Solve it', maxCalls: 20 });
  assert.equal(r.state.phase, 'COMPLETED');
  const work = x.transport.filter((t) => t.role === 'work');
  assert.deepEqual(work.map((t) => /NEWSTRATEGY/.test(t.text)), [false, true, true]);
  const ref = 'thecycle:circle:' + r.researchId + ':schema:c2';
  assert.deepEqual([await x.store.getPacket(r.researchId, 1), await x.store.getPacket(r.researchId, 3), await x.store.getPacket(r.researchId, 5)].map((p) => p.pipelineRef === ref),
    [false, true, true]);
  assert.equal((await x.store.getPacket(r.researchId, 2)).decision.detail.schema.steps[0].task, 'NEWSTRATEGY');
  await invariants(x, [r.researchId]);
});

const proc = [{ id: 'p1', check: 'пересчитать' }, { id: 'p2', check: 'найти контрпример' }];
const checks = (a = 'PASS', b = 'PASS') => [{ id: 'p1', result: a, evidence: 'e1' }, { id: 'p2', result: b, evidence: 'e2' }];
const verdict = (v) => json({ verdict: v, checks: checks(), limitations: [] });

test('3a. verified final: VERIFY -> another model VERIFIED, all PASS -> COMPLETE gives VERIFIED_SOLUTION', async () => {
  const two = oneRound(['GPT', 'DeepSeek']);
  const verify = json({ action: 'VERIFY', reason: 'r', refs: [refOf(1, 1, 'DeepSeek')], claim: 'x=1', procedure: proc });
  const x = await harness({ models: ['GPT', 'DeepSeek', 'Qwen'], workSchema: two, analyst: [verify, complete(refOf(1))], verifier: [verdict('VERIFIED')] }).init();
  const r = await x.runner.start({ task: 'Solve it', maxCalls: 12 });
  assert.equal(r.state.phase, 'COMPLETED'); assert.equal(r.state.finalStatus, 'VERIFIED_SOLUTION');
  const v = x.transport.filter((t) => t.role === 'verifier');
  assert.equal(v.length, 1); assert.equal(v[0].model, 'Qwen');
  const rec = (await x.store.getPacket(r.researchId, 3)).decision.detail.verificationRecord;
  assert.equal(rec.independence, 'FRESH_TAB_OTHER_MODEL'); assert.equal(rec.verdict, 'VERIFIED'); assert.ok(rec.checks.every((c) => c.result === 'PASS'));
  await invariants(x, [r.researchId]);
});

test('3b. no independent model: the check is UNPROVEN, COMPLETE gives only PARTIAL', async () => {
  const verify = json({ action: 'VERIFY', reason: 'r', refs: [refOf(1)], claim: 'x=1', procedure: proc });
  const x = await harness({ models: ['GPT', 'Claude'], analyst: [verify, complete(refOf(1))], verifier: [verdict('VERIFIED')] }).init();
  const r = await x.runner.start({ task: 'Solve it', maxCalls: 12 });
  assert.equal(r.state.phase, 'COMPLETED'); assert.equal(r.state.finalStatus, 'PARTIAL');
  assert.equal((await x.store.getPacket(r.researchId, 3)).decision.detail.verificationRecord.independence, 'UNPROVEN');
  await invariants(x, [r.researchId]);
});

test('4. budget limit: stop before a send when the budget does not cover the next cycle plus the analyst', async () => {
  const x = await harness({ analyst: [cont(refOf(1))] }).init();
  const r = await x.runner.start({ task: 'Solve it', maxCalls: 3 });
  assert.equal(r.state.phase, 'PAUSED');
  assert.equal(x.transport.length, 2, 'work + analyst only, the third request was never sent');
  assert.equal(r.state.budget.usedCalls, 2);
  assert.match(String(r.state.lastDecision.reason), /BUDGET/);
  await invariants(x, [r.researchId]);
});

test('4b. budget exactly spent on the last cycle: BUDGET_EXHAUSTED, nothing beyond maxCalls', async () => {
  const x = await harness({ analyst: (ctx) => cont(refOf(ctx.cycle - 1)) }).init();
  const r = await x.runner.start({ task: 'Solve it', maxCalls: 6 });
  assert.equal(r.state.phase, 'PAUSED'); assert.ok(x.transport.length <= 6); assert.equal(r.state.budget.usedCalls, x.transport.length);
  assert.match(String(r.state.lastDecision.reason), /BUDGET/);
  await invariants(x, [r.researchId]);
});

test('5. Stop during a send: OWNER_STOP_UNRESOLVED, unknown batch kept, a new start goes through and does not resend', async () => {
  const x = await harness({ analyst: [complete(refOf(1))], onSend: async (ctx) => { if (ctx.n === 1) { await x.runner.stop(); return { byModel: {} }; } } }).init();
  const first = await x.runner.start({ task: 'Investigate', maxCalls: 6 });
  assert.equal(x.transport.length, 1);
  assert.equal(first.state.phase, 'COMPLETED'); assert.equal(first.state.closedReason, 'OWNER_STOP_UNRESOLVED');
  assert.deepEqual((await x.store.getRun(first.researchId, first.researchId + ':cycle:1')).batches.map((b) => b.status), ['UNKNOWN']);
  assert.equal((await x.store.getOwnership())?.ownerId ?? null, null);
  const second = await x.runner.start({ task: 'Second', maxCalls: 4 });
  assert.notEqual(second.researchId, first.researchId); assert.equal(second.state.phase, 'COMPLETED');
  assert.equal(x.transport.length, 3); // 1 + work + analyst of the second research
  assert.ok(x.transport.slice(1).every((t) => t.runId.startsWith(second.researchId + ':')));
  await invariants(x, [first.researchId, second.researchId]);
});

for (const point of ['READY', 'COMMIT', 'EVALUATE']) {
  test('6. restart in ' + point + ': the new runner resumes, the recorded batch is not sent again', async () => {
    const x = await harness({ analyst: [complete(refOf(1))] }).init();
    const id = await x.crashStart({ task: 'Investigate', maxCalls: 6 });
    const old = await crashAt(x, point);
    const r = await x.newRunner().resume(id);
    assert.equal(r.state.phase, 'COMPLETED'); assert.equal(r.state.finalStatus, 'PARTIAL');
    const runs = x.transport.map((t) => t.runId);
    if (point === 'READY') assert.deepEqual(runs, [id + ':cycle:1', id + ':cycle:2']);
    else { assert.deepEqual(runs, [id + ':cycle:2']); assert.equal((await x.store.getPacket(id, 1)).status, 'RECORDED_RESULT'); }
    await assert.rejects(x.store.journalFor(old)({ type: 'RUN_ERROR', researchId: id, runId: id + ':cycle:1', cycleId: 1 }), /STALE_OWNER/);
    await invariants(x, [id], { [id]: point === 'READY' ? 0 : 1 });
  });
}

test('6. restart in RUNNING: pause UNKNOWN_DISPATCH_AFTER_RELOAD, nothing sent, still nothing on a second resume', async () => {
  const x = await harness({ withReread: true }).init();
  const id = await x.crashStart({ task: 'Investigate', maxCalls: 6 });
  await crashAt(x, 'RUNNING');
  const runner = x.newRunner();
  const r = await runner.resume(id);
  assert.equal(x.transport.length, 0); assert.equal(r.outcomes.at(-1).reason, 'UNKNOWN_DISPATCH_AFTER_RELOAD'); assert.equal(r.state.phase, 'RECONCILE');
  const snap = await runner.snapshot(id);
  assert.equal(snap.unknown, true); assert.equal(snap.pauseReason, 'UNKNOWN_DISPATCH_AFTER_RELOAD');
  const again = await x.newRunner().resume(id);
  assert.equal(x.transport.length, 0); assert.equal(again.outcomes.at(-1).reason, 'UNKNOWN_DISPATCH_AFTER_RELOAD');
  await invariants(x, [id], { [id]: 1 });
});

test('6. restart in RUNNING, the page confirms the answer by the delivery token: batch RESPONSE, still nothing sent', async () => {
  const x = await harness({ withReread: true }).init();
  const id = await x.crashStart({ task: 'Investigate', maxCalls: 6 });
  await crashAt(x, 'RUNNING');
  x.hooks.reread = async () => ({ found: true, confirmed: true, text: 'Answer from the page', status: 'SUCCESS', completion: 'complete' });
  const r = await x.newRunner().resume(id);
  assert.equal(x.transport.length, 0); assert.equal(x.hooks.rereads.length, 1);
  assert.equal(x.hooks.rereads[0].sentPrompt, 'Investigate ' + TOKEN);
  assert.deepEqual((await x.store.getRun(id, id + ':cycle:1')).batches.map((b) => b.status), ['RESPONSE']);
  assert.equal(r.state.phase, 'PAUSED');
  const rec = (await x.store.getEvents(id, id + ':cycle:1')).find((e) => e.eventId === 'RECONCILED:b1').payload;
  assert.equal(rec.evidence.verified, true); assert.equal(rec.evidence.answers.GPT, 'Answer from the page');
  await invariants(x, [id], { [id]: 1 });
});

test('7. UNKNOWN: the transport throws after the send: no repeat, resume pauses, abandon then continues by the choice', async () => {
  const x = await harness({ analyst: [cont(refOf(1)), cont(refOf(1)), complete(refOf(1))], onSend: async (ctx) => { if (ctx.n === 3) throw new Error('PAGE_GONE'); } }).init();
  const first = await x.runner.start({ task: 'Investigate', maxCalls: 20 });
  const id = first.researchId;
  assert.equal(x.transport.length, 3); // work, analyst, work (threw)
  assert.equal(first.state.phase, 'RECONCILE');
  assert.deepEqual((await x.store.getRun(id, id + ':cycle:3')).batches.map((b) => b.status), ['UNKNOWN']);
  const paused = await x.newRunner().resume(id);
  assert.equal(x.transport.length, 3, 'resume does not resend'); assert.equal(paused.outcomes.at(-1).reason, 'UNKNOWN_DISPATCH_AFTER_RELOAD');
  const abandoned = await x.newRunner().resolveUnknown(id, 'abandon');
  assert.equal(x.transport.length, 3);
  assert.deepEqual((await x.store.getRun(id, id + ':cycle:3')).batches.map((b) => b.status), ['ABANDONED_UNKNOWN']);
  assert.equal(abandoned.state.phase, 'PAUSED'); assert.equal(abandoned.state.lastDecision.reason, 'PARTIAL_OR_UNCERTAIN');
  assert.equal((await x.store.getPacket(id, 3)).status, 'PARTIAL_RECOVERY');
  const done = await x.newRunner().resume(id);
  assert.equal(done.state.phase, 'COMPLETED');
  assert.equal(x.transport.filter((t) => t.runId === id + ':cycle:3').length, 1, 'the abandoned batch is never sent again');
  assert.ok(x.transport.slice(3).every((t) => cycleOf(t.runId) >= 4));
  await invariants(x, [id]);
});

test('8a. no access to the backup directory: nothing is sent, no research is left behind', async () => {
  const indexedDB = createFakeIndexedDB(); globalThis.indexedDB = indexedDB;
  try {
    const h = { kind: 'directory', state: 'granted', async queryPermission() { return this.state; } };
    const m = await handleManager.createDirectoryHandleManager({ indexedDB }); await m.save('thecycle-backups', h); m.close(); h.state = 'prompt';
    const x = await harness({ createBackup: undefined }).init();
    x.values.set('thecycleBackupEnabled', true);
    const runner = x.make(x.store, { createBackup: undefined });
    await assert.rejects(runner.start({ task: 'Investigate', maxCalls: 4 }), /Нет доступа к каталогу копий/);
    assert.equal(x.transport.length, 0); assert.equal(runner.isRunning(), false);
    await invariants(x, []);
  } finally { delete globalThis.indexedDB; }
});

test('8a. no access when resuming: nothing sent, the state and the owner stay as they were', async () => {
  const x = await harness({ analyst: [complete(refOf(1))] }).init();
  const id = await x.crashStart({ task: 'Investigate', maxCalls: 6 });
  await crashAt(x, 'RUNNING');
  const before = await x.store.getOwnership();
  const denied = x.newRunner({ createBackup: async () => { throw new Error('NO_ACCESS'); } });
  await assert.rejects(denied.resume(id), /NO_ACCESS/);
  await assert.rejects(x.newRunner({ createBackup: async () => { throw new Error('NO_ACCESS'); } }).resolveUnknown(id, 'abandon'), /NO_ACCESS/);
  assert.equal(x.transport.length, 0); assert.deepEqual(await x.store.getOwnership(), before);
  assert.equal((await x.store.load(id)).phase, 'RUNNING');
  await invariants(x, [id], { [id]: 1 });
});

test('8b. restore from the verified copy into a new database: resume goes on without repeats', async () => {
  const wait = json({ action: 'WAIT_OWNER', reason: 'нужен человек', refs: [refOf(3)], question: 'продолжать?' });
  const x = await harness({ analyst: [cont(refOf(1)), wait] }).init();
  const first = await x.runner.start({ task: 'Investigate', maxCalls: 30 });
  const id = first.researchId;
  assert.equal(first.state.phase, 'PAUSED'); assert.equal(first.state.lastDecision.reason, 'WAIT_OWNER');
  const sentBefore = x.transport.length; assert.equal(sentBefore, 4);
  const envelope = await x.store.exportVerifiedBackup();
  x.store.close();
  const newIdb = createFakeIndexedDB();
  const holder = await createStateStore({ indexedDB: newIdb });
  const res = await restore({ backupService: { async getVerifiedEnvelope() { return envelope; } }, stateStore: holder, indexedDB: newIdb,
    key: 'backup-1', targetName: 'auto-orchestr-thecycle-restore-abcdef12', transportQuiescent: true });
  assert.equal(res.status, 'RESTORED_PAUSED');
  const active = await createStateStore({ indexedDB: newIdb, name: 'auto-orchestr-thecycle-restore-abcdef12' });
  x.store = active;
  assert.equal((await active.load(id)).lastCommittedPacket, 4);
  x.queues.analyst.push(complete(refOf(3)));
  const resumed = await x.make(active).resume(id);
  assert.equal(resumed.state.phase, 'COMPLETED');
  const after = x.transport.slice(sentBefore);
  // Continue after WAIT_OWNER asks the analyst again (cycle 5), with the human's pause in between; cycles 1..4 are not sent again.
  assert.deepEqual(after.map((t) => t.runId), [id + ':cycle:5']); assert.equal(after[0].role, 'analyst');
  await invariants(x, [id]);
});

test('9. analyst format errors pause with a reason and send nothing extra', async () => {
  const bad = [
    ['не JSON', 'не JSON'],
    ['extra key', json({ action: 'CONTINUE', reason: 'r', refs: [refOf(1)], foo: 1 })],
    ['unknown action', json({ action: 'DANCE', reason: 'r', refs: [] })],
    ['invented ref', json({ action: 'CONTINUE', reason: 'r', refs: ['cycle=9 step=1 model=GPT'] })],
    ['COMPLETE without refs', json({ action: 'COMPLETE', reason: 'r', refs: [] })]
  ];
  for (const [name, answer] of bad) {
    const x = await harness({ analyst: [answer, cont(refOf(1))] }).init();
    const r = await x.runner.start({ task: 'Solve it', maxCalls: 10 });
    assert.equal(r.state.phase, 'PAUSED', name); assert.equal(r.state.lastDecision.reason, 'DECISION_FORMAT_INVALID', name);
    assert.ok(r.state.lastDecision.detail.errors.length >= 1, name);
    assert.equal(x.transport.length, 2, name + ': work + analyst, no retry');
    await invariants(x, [r.researchId]);
  }
});

test('9. verifier format error pauses with a reason and sends no extra request', async () => {
  const verify = json({ action: 'VERIFY', reason: 'r', refs: [refOf(1)], claim: 'x=1', procedure: proc });
  for (const answer of ['не JSON', verdict('VERIFIED') + verdict('VERIFIED')]) {
    const x = await harness({ models: ['GPT', 'Claude'], analyst: [verify, complete(refOf(1))], verifier: [answer, verdict('VERIFIED')] }).init();
    const r = await x.runner.start({ task: 'Solve it', maxCalls: 12 });
    assert.equal(r.state.phase, 'PAUSED'); assert.equal(r.state.lastDecision.reason, 'DECISION_FORMAT_INVALID');
    assert.equal(x.transport.length, 4, 'two work answers + analyst + verifier, no retry'); assert.equal(x.transport.filter((t) => t.role === 'verifier').length, 1);
    await invariants(x, [r.researchId]);
  }
});
