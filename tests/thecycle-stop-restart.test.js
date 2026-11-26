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

test('Stop during a send (outcome unknown): research closed OWNER_STOP_UNRESOLVED, unknown batch kept, transport free, new start does not resend', async () => {
  const x = await fixture({ onSend: async ({ n, runner }) => { if (n === 1) { await runner.stop(); return { byModel: {} }; } return null; } });
  const first = await x.runner.start({ task: 'Investigate', maxCalls: 3 });
  assert.equal(x.prompts.length, 1);
  assert.equal(first.state.phase, 'COMPLETED'); assert.equal(first.state.closedReason, 'OWNER_STOP_UNRESOLVED');
  assert.equal(first.state.activeRunId, null); assert.equal(first.outcomes.at(-1).outcome, 'RUN_CLOSED');
  const run = await x.store.getRun(first.researchId, first.researchId + ':cycle:1');
  assert.equal(run.phase, 'CLOSED_UNRESOLVED'); assert.deepEqual(run.batches.map((b) => b.status), ['UNKNOWN']);
  const events = await x.store.getEvents(first.researchId, run.runId);
  assert.ok(events.some((e) => e.eventId === 'RUN_CLOSED' && e.payload.reason === 'OWNER_STOP_UNRESOLVED'));
  assert.equal((await x.store.getOwnership())?.ownerId ?? null, null);
  // new research, no reload
  const second = await x.runner.start({ task: 'Second research', maxCalls: 1 });
  assert.notEqual(second.researchId, first.researchId);
  assert.equal(x.prompts.length, 2, 'exactly one new request, the old batch was not resent');
  assert.equal(x.prompts[1].runId, second.researchId + ':cycle:1');
  assert.equal(second.state.budget.usedCalls, 1);
  // the old research stays closed and its batch unresolved
  assert.equal((await x.store.load(first.researchId)).phase, 'COMPLETED');
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
