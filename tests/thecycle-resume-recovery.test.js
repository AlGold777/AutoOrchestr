'use strict';
// Resume of a paused Circle research: what the journal already holds is used, nothing is sent twice, saved packets stay.
// Real state store (fake IndexedDB), controller, runtime, policy, Basic adapter and engine; only the bridge and the backup copy are fakes.
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

const VERIFIED = json({ verdict: 'VERIFIED', checks: [{ id: 'p1', result: 'PASS', evidence: 'e' }, { id: 'COVERS_TASK', result: 'PASS', evidence: 'e' }], limitations: [] });
const sent = (x) => x.transport.map((t) => t.cycle + ':' + t.role);
const lockFree = async (x) => assert.equal((await x.store.getOwnership())?.ownerId ?? null, null);

test('a cycle with a failed model answer does not block the research', async () => {
  const x = await harness({ analyst: Array(9).fill(complete(refOf(2))),
    onSend: async (c) => (c.n === 1 ? { byModel: { GPT: { text: '', status: 'ERROR', answered: false } } } : undefined) }).init();
  const first = await x.runner.start({ task: 'T', maxCalls: 4 });
  const packet = await x.store.getPacket(first.researchId, 1);
  const resumed = await x.runner.resume(first.researchId);
  assert.ok(resumed.state.lastCommittedPacket > 1);
  assert.deepEqual(await x.store.getPacket(first.researchId, 1), packet);
});

test('an answer confirmed by reread is used by the interrupted cycle and not paid again', async () => {
  const x = await harness({ withReread: true, analyst: [complete(refOf(1))], onSend: async (c, meta) => {
    if (c.n !== 2) return undefined;
    await meta.onDispatchPrompts?.({ GPT: 'x ' + TOKEN }); await x.runner.stop(); return { byModel: {} };
  } }).init();
  x.hooks.reread = async () => ({ found: true, confirmed: true, text: complete(refOf(1)), completion: 'complete', status: 'SUCCESS' });
  const first = await x.runner.start({ task: 'T', maxCalls: 4 });
  assert.equal(first.state.phase, 'RECONCILE');
  const resumed = await x.runner.resume(first.researchId);
  assert.equal(resumed.state.phase, 'COMPLETED'); assert.equal(resumed.state.budget.usedCalls, 2);
  assert.deepEqual(sent(x), ['1:work', '2:analyst']);
});

test('reload after a recorded answer and before the report: the recorded step is not sent again', async () => {
  const x = await harness({ workSchema: summarySchema, analyst: [complete(refOf(1, 2))] }).init();
  let reached; const dead = new Promise((resolve) => { reached = resolve; });
  const dying = Object.assign(Object.create(null), x.store, { journalFor: (token) => {
    const journal = x.store.journalFor(token);
    return (event) => { if (event.type !== 'RUN_RESULT') return journal(event); reached(event); return new Promise(() => {}); };
  } });
  x.make(dying).start({ task: 'T', maxCalls: 6 });
  const { researchId } = await dead;
  // the dead page's heartbeat has gone stale
  const resumed = await x.newRunner({ now: () => Date.now() + 200000 }).resume(researchId);
  assert.equal(resumed.state.phase, 'COMPLETED');
  assert.deepEqual(sent(x), ['1:work', '1:work', '2:analyst']);
  assert.equal(resumed.state.budget.usedCalls, 3);
});

test('a verified solution survives an analyst cycle interrupted by Stop', async () => {
  let asked = 0;
  const x = await harness({ models: ['GPT', 'Claude'], workSchema: oneRound(['GPT']),
    analyst: () => (++asked === 1 ? json({ action: 'VERIFY', reason: 'r', refs: [refOf(1)], claim: 'c', procedure: [{ id: 'p1', check: 'k' }] }) : complete(refOf(1))),
    verifier: [VERIFIED], onSend: async (c) => { if (c.cycle === 4 && c.role === 'analyst') await x.runner.stop(); } }).init();
  let result = await x.runner.start({ task: 'T', maxCalls: 12 });
  assert.equal(result.state.phase, 'PAUSED');
  result = await x.runner.resume(result.researchId);
  assert.equal(result.state.phase, 'COMPLETED'); assert.equal(result.state.finalStatus, 'VERIFIED_SOLUTION');
});

test('a refused limit change keeps the saved per-cycle limit', async () => {
  const x = await harness({ analyst: [json({ action: 'WAIT_OWNER', reason: 'q', refs: [refOf(1)] })] }).init();
  const first = await x.runner.start({ task: 'T', maxCalls: 4 });
  const saved = () => [...x.values.entries()].find(([key]) => key.includes(first.researchId))[1].maxCallsPerCycle;
  const before = saved();
  await x.store.createResearch({ researchId: 'other', task: 'o', pipelineRef: 'p', maxCalls: 1 });
  await x.store.acquire({ researchId: 'other', ownerId: 'y' });
  await assert.rejects(x.runner.resume(first.researchId, { maxCalls: 20 }), /TRANSPORT_OWNED/);
  assert.equal(saved(), before); assert.equal((await x.store.load(first.researchId)).budget.maxCalls, 4);
});

test('a second Stop while the run is being paused leaves the transport free', async () => {
  const x = await harness({ onSend: async (c) => { if (c.n !== 1) return undefined; await x.runner.stop(); return { byModel: {} }; } }).init();
  x.runner = x.make(Object.assign(Object.create(null), x.store, {
    suspendRun: async (...args) => { await x.runner.stop(); return x.store.suspendRun(...args); } }));
  const first = await x.runner.start({ task: 'T', maxCalls: 4 });
  assert.equal(first.state.phase, 'RECONCILE'); await lockFree(x);
});
