'use strict';
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
const handleManager = require('../disput/thecycle/directory-handle-manager.js');
const telemetryApi = require('../disput/thecycle/telemetry.js');
installKeyRange();
const clone = (v) => JSON.parse(JSON.stringify(v));

async function fixture({ onSend, onGatePersist } = {}) {
  const indexedDB = createFakeIndexedDB();
  const store = await createStateStore({ indexedDB });
  const values = new Map(), prompts = [], metadata = new Map(); let seq = 0, bridgeRun = null, backups = 0, runner;
  const storage = { async get(k) { return { [k]: values.get(k) }; }, async set(o) { for (const [k, v] of Object.entries(o)) values.set(k, clone(v)); } };
  const bridge = {
    capture: () => ({ models: ['GPT'], errors: [], schema: { schemaVersion: 1, origin: 'user', run: { policy: 'manual' }, steps: [{ ref: 'r1', kind: 'round', models: [{ name: 'GPT' }] }] } }),
    accept: () => ({ ok: true }), roleText: () => '',
    begin({ runId }) { bridgeRun = runId; }, end() { bridgeRun = null; },
    async send(models, byModel, meta) {
      prompts.push({ runId: meta.runId, text: byModel.GPT });
      const custom = onSend && await onSend({ n: prompts.length, runner, meta });
      if (custom) return custom;
      return { byModel: { GPT: { text: 'Evidence ' + prompts.length, status: 'SUCCESS', answered: true } } };
    }
  };
  const gate = createBackupGate({ clock: () => 1000 + backups, metadata: {
    async get(id) { return metadata.get(id) || null; },
    async put(id, rev, v) { if ((metadata.get(id)?.revision || 0) !== rev) return false; metadata.set(id, clone(v)); return true; } },
    backup: { async save(key, { requiredCommitId }) { backups++; if (onGatePersist) await onGatePersist({ runner, backups }); return { key, verified: true, packetCommitId: requiredCommitId }; } } });
  const rows = []; let tseq = 0;
  const telemetry = telemetryApi.createTelemetry({ repository: { async append(r) { rows.push({ ...r, seq: ++tseq }); }, async list() { return rows; }, async clear() {} }, version: () => 't' });
  runner = createCircleRunner({ bridge, storage, activeStore: { async createActiveStateStore() { return { store, database: 'test', close() {} }; } },
    controllerApi: { createController }, adapterApi: { createBasicAdapter }, contextApi: context, telemetry,
    createBackup: async () => ({ gate, close() {} }), uuid: () => String(++seq) });
  return { runner, store, prompts, rows, bridgeRunning: () => bridgeRun };
}

test('Stop before any request: nothing sent, transport free, the next start runs without reload', async () => {
  const x = await fixture({ onGatePersist: async ({ runner, backups }) => { if (backups === 1) await runner.stop(); } });
  const first = await x.runner.start({ task: 'Investigate', maxCalls: 3 });
  assert.equal(x.prompts.length, 0); assert.equal(first.state.phase, 'PAUSED');
  assert.equal((await x.store.getOwnership())?.ownerId ?? null, null);
  const second = await x.runner.start({ task: 'Investigate again', maxCalls: 1 });
  assert.equal(x.prompts.length, 1); assert.equal(second.state.budget.usedCalls, 1);
});

test('Stop during a send (outcome unknown): research paused with the run open, transport free, new start does not resend; the same research continues later', async () => {
  const x = await fixture({ onSend: async ({ n, runner }) => { if (n === 1) { await runner.stop(); return { byModel: {} }; } return null; } });
  const first = await x.runner.start({ task: 'Investigate', maxCalls: 3 });
  const id = first.researchId, runId = id + ':cycle:1';
  assert.equal(x.prompts.length, 1);
  assert.equal(first.state.phase, 'RECONCILE'); assert.equal(first.state.activeRunId, runId); assert.equal(first.state.stopRequested, true);
  assert.equal(first.pauseReason, 'OWNER_STOP_UNRESOLVED'); assert.equal(first.unknown, true); assert.equal(first.outcomes.at(-1).outcome, 'RUN_SUSPENDED');
  assert.deepEqual((await x.store.getRun(id, runId)).batches.map((b) => b.status), ['UNKNOWN']);
  assert.ok((await x.store.getEvents(id, runId)).some((e) => e.payload.type === 'RUN_SUSPENDED'));
  assert.equal((await x.store.getOwnership())?.ownerId ?? null, null);
  // another research starts without a reload and leaves the paused one untouched
  const second = await x.runner.start({ task: 'Second research', maxCalls: 1 });
  assert.equal(x.prompts.length, 2, 'exactly one new request, the old batch was not resent');
  assert.equal(x.prompts[1].runId, second.researchId + ':cycle:1');
  assert.deepEqual(await x.store.load(id), first.state);
  assert.deepEqual((await x.runner.list()).map((r) => r.researchId).sort(), [id, second.researchId].sort());
  // Resume without a way to confirm the answer: nothing is sent, the pause stays, the transport stays free
  const unsure = await x.runner.resume(id);
  assert.equal(unsure.outcomes.at(-1).reason, 'UNKNOWN_DISPATCH_AFTER_RELOAD'); assert.equal(unsure.state.phase, 'RECONCILE');
  assert.equal(unsure.state.stopRequested, true); assert.equal(x.prompts.length, 2);
  assert.equal((await x.store.getOwnership())?.ownerId ?? null, null);
  // the person abandons the unknown batch: partial packet, no request
  const abandoned = await x.runner.resolveUnknown(id, 'abandon');
  assert.equal(abandoned.state.phase, 'PAUSED'); assert.equal(abandoned.state.stopRequested, false); assert.equal(abandoned.pauseReason, 'PARTIAL_OR_UNCERTAIN');
  assert.equal(x.prompts.length, 2);
  const partial = await x.store.getPacket(id, 1);
  assert.equal(partial.status, 'PARTIAL_RECOVERY');
  // the same research goes on: next cycle number, used calls kept
  const resumed = await x.runner.resume(id);
  assert.deepEqual(x.prompts.slice(2).map((p) => p.runId), [id + ':cycle:2', id + ':cycle:3']);
  assert.equal(resumed.state.budget.usedCalls, 3); assert.equal(resumed.pauseReason, 'BUDGET_EXHAUSTED');
  assert.deepEqual(await x.store.getPacket(id, 1), partial, 'saved packets are not rewritten');
  await assert.rejects(x.runner.resume(id), /BUDGET_EXHAUSTED/);
  await assert.rejects(x.runner.resume(id, { maxCalls: 10001 }), /CIRCLE_INPUT_INVALID/);
  assert.equal((await x.store.getOwnership())?.ownerId ?? null, null);
  // a higher limit: the postponed decision is taken again, usedCalls is not reset, the old pause stays on record
  const raised = await x.runner.resume(id, { maxCalls: 5 });
  assert.deepEqual(x.prompts.slice(4).map((p) => p.runId), [id + ':cycle:4', id + ':cycle:5']);
  assert.equal(raised.state.budget.usedCalls, 5); assert.equal(raised.state.budget.maxCalls, 5);
  assert.deepEqual(raised.state.budgetHistory.map((h) => [h.from, h.to]), [[3, 5]]);
  assert.equal(raised.state.researchId, id); assert.equal(raised.state.task, 'Investigate');
  const third = await x.store.getPacket(id, 3);
  assert.deepEqual(third.decisionHistory.map((d) => d.reason), ['BUDGET_EXHAUSTED']); assert.equal(third.decision.action, 'CONTINUE');
});

test('Stop after the answer was recorded: Resume takes the postponed step of the same research', async () => {
  const x = await fixture({ onGatePersist: async ({ runner, backups }) => { if (backups === 2) await runner.stop(); } });
  const first = await x.runner.start({ task: 'Investigate', maxCalls: 2 });
  assert.equal(first.state.phase, 'PAUSED'); assert.equal(first.pauseReason, 'OWNER_STOP'); assert.equal(x.prompts.length, 1);
  const resumed = await x.runner.resume(first.researchId);
  assert.equal(resumed.state.stopRequested, false); assert.equal(resumed.state.budget.usedCalls, 2);
  assert.deepEqual(x.prompts.map((p) => p.runId), [1, 2].map((n) => first.researchId + ':cycle:' + n));
});

test('suspendRun refuses without Stop; raiseBudget only grows the limit', async () => {
  const indexedDB = createFakeIndexedDB(); const store = await createStateStore({ indexedDB });
  await store.createResearch({ researchId: 'r', task: 't', pipelineRef: 'p', maxCalls: 2 });
  const fence = await store.acquire({ researchId: 'r', ownerId: 'o1' });
  const s = await store.load('r');
  await assert.rejects(store.suspendRun(fence, { expectedVersion: s.stateVersion, runId: 'r:cycle:1' }), /SUSPEND_NOT_ALLOWED/);
  await assert.rejects(store.raiseBudget(fence, { expectedVersion: s.stateVersion, maxCalls: 2 }), /BUDGET_CHANGE_NOT_ALLOWED/);
  await assert.rejects(store.raiseBudget(fence, { expectedVersion: s.stateVersion, maxCalls: 10001 }), /INVALID_BUDGET/);
  await assert.rejects(store.raiseBudget({ ...fence, ownerId: 'o2' }, { expectedVersion: s.stateVersion, maxCalls: 3 }), /STALE_OWNER/);
  assert.equal((await store.raiseBudget(fence, { expectedVersion: s.stateVersion, maxCalls: 3 })).budget.maxCalls, 3);
});

test('abandonRun refuses without Stop and for a foreign owner', async () => {
  const indexedDB = createFakeIndexedDB(); const store = await createStateStore({ indexedDB });
  await store.createResearch({ researchId: 'r', task: 't', pipelineRef: 'p', maxCalls: 2 });
  const fence = await store.acquire({ researchId: 'r', ownerId: 'o1' });
  const s = await store.load('r');
  await assert.rejects(store.abandonRun(fence, { expectedVersion: s.stateVersion, runId: 'r:cycle:1', reason: 'X' }), /ABANDON_NOT_ALLOWED/);
  await assert.rejects(store.abandonRun({ ...fence, ownerId: 'o2' }, { expectedVersion: s.stateVersion, runId: 'r:cycle:1', reason: 'X' }), /STALE_OWNER/);
});

function stubAdapter() {
  return ({ journal }) => ({ validate: () => ({ ok: true, errors: [] }), cancel: () => true,
    async execute({ researchId, cycleId, runId }) {
      await journal({ type: 'RUN_INTENT', researchId, runId, cycleId, maxCalls: 1 });
      const report = { researchId, runId, cycleId, status: 'PIPELINE_COMPLETE', unresolvedBatchIds: [], steps: [] };
      await journal({ type: 'RUN_RESULT', researchId, runId, cycleId, report });
      return report;
    } });
}
async function controllerFixture(wrap = {}) {
  const real = await createStateStore({ indexedDB: createFakeIndexedDB() });
  await real.createResearch({ researchId: 'r', task: 't', pipelineRef: 'p', maxCalls: 5 });
  const store = Object.assign(Object.create(null), real, Object.fromEntries(Object.entries(wrap).map(([k, fn]) => [k, (...a) => fn(real, ...a)])));
  const controller = createController({ store, makeAdapter: stubAdapter(), loadPipeline: async () => ({ ref: 'p', schema: {} }), maxCallsPerCycle: 1, maxPromptChars: 1000, ownerId: 'owner-1' });
  return { real, controller };
}

test('STALE_STATE window before the run: Stop between read and prepareRun pauses, start() does not throw, nothing runs', async () => {
  const x = await controllerFixture({ prepareRun: async (real, ...a) => { await real.requestStop('r'); return real.prepareRun(...a); } });
  const r = await x.controller.tick('r');
  assert.equal(r.outcome, 'PAUSED'); assert.equal(r.reason, 'OWNER_STOP');
  const s = await x.real.load('r');
  assert.equal(s.phase, 'PAUSED'); assert.equal(s.activeRunId, null); assert.equal(s.budget.usedCalls, 0);
});

test('STALE_STATE window at commit: Stop between read and commitPacket commits and pauses without throwing', async () => {
  let armed = false;
  const x = await controllerFixture({ commitPacket: async (real, ...a) => { if (!armed) { armed = true; await real.requestStop('r'); } return real.commitPacket(...a); } });
  assert.equal((await x.controller.tick('r')).outcome, 'RUN_RETURNED');
  const r = await x.controller.tick('r');
  assert.equal(r.outcome, 'PACKET_COMMITTED');
  assert.equal(r.state.phase, 'PAUSED'); assert.equal(r.state.lastCommittedPacket, 1);
});

test('STALE_STATE that is not caused by Stop is still an error', async () => {
  const x = await controllerFixture({ prepareRun: async (real, token, args) => real.prepareRun(token, { ...args, expectedVersion: args.expectedVersion + 5 }) });
  const r = await x.controller.tick('r'); // prepareRun is inside the run guard: reported as a rejected run, not swallowed
  assert.equal(r.outcome, 'RUN_REJECTED'); assert.equal(r.error.code, 'STALE_STATE');
});

test('no access to the backup directory: run blocked before the first request, telemetry says why, no research left running', async () => {
  const indexedDB = createFakeIndexedDB(); globalThis.indexedDB = indexedDB;
  const h = { kind: 'directory', state: 'granted', async queryPermission() { return this.state; } };
  const m = await handleManager.createDirectoryHandleManager({ indexedDB }); await m.save('thecycle-backups', h); m.close(); h.state = 'prompt';
  const x = await fixture();
  const events = []; let n = 0;
  const telemetry = telemetryApi.createTelemetry({ repository: { async append(r) { events.push({ ...r, seq: ++n }); }, async list() { return events; }, async clear() {} }, version: () => 't' });
  const store = x.store, values = new Map([['thecycleBackupEnabled', true]]);
  const runner = createCircleRunner({
    bridge: { capture: () => ({ models: ['GPT'], errors: [], schema: { schemaVersion: 1, origin: 'user', run: { policy: 'manual' }, steps: [{ ref: 'r1', kind: 'round', models: [{ name: 'GPT' }] }] } }), accept: () => ({ ok: true }), roleText: () => '', begin() {}, end() {}, send: async () => { throw new Error('MUST_NOT_SEND'); } },
    storage: { async get(k) { return { [k]: values.get(k) }; }, async set(o) { for (const [k, v] of Object.entries(o)) values.set(k, v); } },
    activeStore: { async createActiveStateStore() { return { store, database: 't', close() {} }; } },
    controllerApi: { createController }, adapterApi: { createBasicAdapter }, contextApi: context, telemetry, uuid: () => 'u1' });
  await assert.rejects(runner.start({ task: 'Investigate', maxCalls: 2 }), /Нет доступа к каталогу копий/);
  assert.equal(x.prompts.length, 0);
  const denied = events.find((e) => e.type === 'BACKUP_DIRECTORY_PERMISSION');
  assert.equal(denied.directory.outcome, 'DENIED'); assert.equal(denied.directory.source, 'runtime');
  assert.match(telemetryApi.markdown(events), /BACKUP_DIRECTORY_PERMISSION/);
  delete globalThis.indexedDB;
});
