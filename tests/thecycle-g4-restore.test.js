'use strict';
// G4.1b: loss of the database -> restore of the verified copy into a new database -> activation pointer -> resume by a new runner.
// A request already recorded in the lost journal is never sent again.
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
const { restore } = require('../disput/thecycle/restore-service.js');
const { createActivationCoordinator } = require('../disput/thecycle/activation-coordinator.js');
const { createDatabaseActivationManager } = require('../disput/thecycle/database-activation.js');
installKeyRange();
const clone = (v) => JSON.parse(JSON.stringify(v));
const TARGET = 'auto-orchestr-thecycle-restore-abcdef12';

test('snapshot -> database lost -> restore into a new database -> activation -> resume continues, nothing recorded is resent', async () => {
  const oldIdb = createFakeIndexedDB();
  const oldStore = await createStateStore({ indexedDB: oldIdb });
  const values = new Map(), sends = [], metadata = new Map(); let seq = 0, backups = 0, crash = true;
  const storage = { async get(k) { return { [k]: values.get(k) }; }, async set(o) { for (const [k, v] of Object.entries(o)) values.set(k, clone(v)); } };
  const bridge = {
    capture: () => ({ models: ['GPT'], errors: [], schema: { schemaVersion: 1, origin: 'user', run: { policy: 'manual' }, steps: [{ ref: 'r1', kind: 'round', models: [{ name: 'GPT' }] }] } }),
    accept: () => ({ ok: true }), roleText: () => '', begin() {}, end() {}, hold() {}, release() {},
    async send(models, byModel, meta) { sends.push(meta.runId); return { byModel: { GPT: { text: 'Evidence ' + sends.length, status: 'SUCCESS', answered: true } } }; }
  };
  const gate = createBackupGate({ clock: () => 1000 + backups, metadata: {
    async get(id) { return metadata.get(id) || null; },
    async put(id, rev, v) { if ((metadata.get(id)?.revision || 0) !== rev) return false; metadata.set(id, clone(v)); return true; } },
    backup: { async save(key, { requiredCommitId }) { backups++; return { key, verified: true, packetCommitId: requiredCommitId }; } } });
  const make = (store) => createCircleRunner({ bridge, storage, activeStore: { async createActiveStateStore() { return { store, database: 'test', close() {} }; } },
    controllerApi: { createController }, adapterApi: { createBasicAdapter }, contextApi: context, telemetry: null,
    createBackup: async () => ({ gate, close() {} }), uuid: () => String(++seq) });
  const wrapped = Object.assign(Object.create(null), oldStore, { prepareRun: (...a) => { if (crash) throw new Error('CRASH'); return oldStore.prepareRun(...a); } });
  const started = await make(wrapped).start({ task: 'Investigate', maxCalls: 3 });
  crash = false;
  const id = started.researchId;

  // Cycle 1 finished and committed in the old database (a crashed controller, backup still owed).
  const owner = await oldStore.getOwnership();
  const tok = await oldStore.acquire({ researchId: id, ownerId: 'crashed', takeoverEpoch: owner.epoch });
  const runId = id + ':cycle:1', base = { researchId: id, runId, cycleId: 1 };
  let s = await oldStore.load(id);
  await oldStore.prepareRun(tok, { expectedVersion: s.stateVersion, runId, cycleId: 1, pipelineRef: s.pipelineRef, maxCalls: 1 });
  const journal = oldStore.journalFor(tok);
  await journal({ type: 'RUN_INTENT', ...base, maxCalls: 1 });
  await journal({ type: 'DISPATCH_INTENT', ...base, batchId: 'b1', models: ['GPT'] });
  await journal({ type: 'DISPATCH_RESPONSE', ...base, batchId: 'b1' });
  await journal({ type: 'RUN_RESULT', ...base, report: { ...base, status: 'PIPELINE_COMPLETE', unresolvedBatchIds: [], steps: [{ outcome: { GPT: { ok: true, text: 'Evidence old' } } }] } });
  s = await oldStore.load(id);
  await oldStore.commitPacket(tok, { expectedVersion: s.stateVersion, runId });

  // The copy is taken, then the whole database is lost.
  const envelope = await oldStore.exportVerifiedBackup();
  oldStore.close();
  const newIdb = createFakeIndexedDB();
  const holder = await createStateStore({ indexedDB: newIdb });

  const result = await restore({ backupService: { async getVerifiedEnvelope() { return envelope; } }, stateStore: holder,
    indexedDB: newIdb, key: 'backup-1', targetName: TARGET, transportQuiescent: true });
  assert.equal(result.status, 'RESTORED_PAUSED'); assert.equal(result.researchCount, 1);

  // The activation pointer moves to the restored database only after inspection and quiescence evidence.
  let pointer = { revision: 0, activeDatabase: 'auto-orchestr-thecycle' };
  const registry = { async read() { return clone(pointer); }, async compareAndSet(rev, next) { if (pointer.revision !== rev) return false; pointer = clone(next); return true; } };
  const inspectDatabase = async (name) => {
    const inspected = await createStateStore({ indexedDB: newIdb, name });
    try {
      const state = await inspected.load(id), lock = await inspected.getOwnership();
      return { verified: true, paused: state.phase === 'PAUSED', hasActiveOwner: Boolean(lock?.ownerId) };
    } finally { inspected.close(); }
  };
  const coordinator = createActivationCoordinator({ registry, inspectDatabase, activeWriters: async () => 0,
    verifyQuiescence: async () => ({ verified: true, quiescent: true, source: 'test', reference: 'no-live-tabs' }),
    activationManager: { createDatabaseActivationManager } });
  await coordinator.activate({ targetName: TARGET, expectedRevision: 0 });
  assert.deepEqual(pointer, { revision: 1, activeDatabase: TARGET });

  // A new runner resolves the pointer, reads the restored research and continues: cycle 1 is not sent again.
  const active = await createStateStore({ indexedDB: newIdb, name: pointer.activeDatabase });
  const restored = await active.load(id);
  assert.equal(restored.phase, 'PAUSED'); assert.equal(restored.lastCommittedPacket, 1);
  assert.equal((await active.getPacket(id, 1)).status, 'RECORDED_RESULT');
  const resumed = await make(active).resume(id);
  assert.ok(sends.length > 0, 'the research went on');
  assert.ok(!sends.includes(runId), 'cycle 1 is never sent again');
  assert.equal(sends[0], id + ':cycle:2');
  assert.equal(resumed.state.budget.usedCalls, 3);
  assert.equal(resumed.state.phase, 'PAUSED'); assert.equal(resumed.state.lastDecision.reason, 'BUDGET_EXHAUSTED');
});
