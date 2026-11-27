'use strict';
// End to end: a research is continued from the file copy alone — empty database, empty page storage, no backup gate metadata.
// Real state store (fake IndexedDB), controller, runtime, policy, Basic adapter and engine, backup runtime and restore; only the
// bridge and the directory are fakes.
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
require('../disput/thecycle/gate-metadata.js');
const { createDirectorySink } = require('../disput/thecycle/directory-sink.js');
const { createBackupService } = require('../disput/thecycle/backup-service.js');
require('../disput/thecycle/backup-gate.js');
require('../disput/thecycle/backup-retention.js');
const { createBackupRuntime } = require('../disput/thecycle/backup-runtime.js');
const { restore } = require('../disput/thecycle/restore-service.js');
installKeyRange();

const clone = (v) => JSON.parse(JSON.stringify(v));
const json = (o) => JSON.stringify(o);
const isAnalyst = (t) => t.includes('Ты управляешь исследованием');
const answer = (action) => json({ action, reason: 'r', refs: ['cycle=1 step=1 model=GPT'] });
const TARGET = 'auto-orchestr-thecycle-restore-12345678';

function directory() {
  const files = new Map(); let t = 1;
  const notFound = () => Object.assign(new Error('nf'), { name: 'NotFoundError' });
  return { files, async queryPermission() { return 'granted'; },
    async getFileHandle(name, { create = false } = {}) {
      if (!files.has(name)) { if (!create) throw notFound(); files.set(name, { text: '', modified: t++ }); }
      const e = files.get(name);
      return { kind: 'file', async getFile() { return { text: async () => e.text, lastModified: e.modified }; },
        async createWritable() { let d = ''; return { async write(v) { d = v; }, async close() { e.text = d; }, async abort() {} }; } };
    },
    async *entries() { for (const n of [...files.keys()]) yield [n, await this.getFileHandle(n)]; },
    async removeEntry(n) { if (!files.delete(n)) throw notFound(); } };
}

// One device: its own database and page storage; the file directory is shared between devices.
function device({ dir, analyst, transport, store, indexedDB, database = 'auto-orchestr-thecycle', onSend }) {
  const values = new Map(); let seq = 0;
  const storage = { async get(k) { return { [k]: values.get(k) }; }, async set(o) { for (const [k, v] of Object.entries(o)) values.set(k, clone(v)); } };
  const bridge = {
    capture: () => ({ models: ['GPT'], errors: [], schema: { schemaVersion: 1, origin: 'user', run: { policy: 'manual' }, steps: [{ ref: 'r1', kind: 'round', models: [{ name: 'GPT' }] }] } }),
    accept: () => ({ ok: true }), roleText: () => '', begin() {}, end() {}, hold() {}, release() {},
    async send(names, byModel, meta) {
      const out = {};
      for (const name of names) {
        const role = isAnalyst(byModel[name]) ? 'analyst' : 'work';
        const cycle = Number(/:cycle:(\d+)$/.exec(meta.runId)[1]);
        transport.push(cycle + ':' + role);
        if (onSend) { const custom = await onSend(); if (custom !== undefined) return custom; }
        out[name] = { text: role === 'work' ? 'Work c' + cycle + ' ' + 'w'.repeat(200) : analyst.shift(), status: 'SUCCESS', answered: true };
      }
      return { byModel: out };
    }
  };
  return createCircleRunner({ bridge, storage, activeStore: { async createActiveStateStore() { return { store, database, close() {} }; } },
    controllerApi: { createController }, adapterApi: { createBasicAdapter }, contextApi: context, policyApi, reconcileApi: reconciliation, telemetry: null,
    createBackup: ({ stateStore, onDiagnostic }) => createBackupRuntime({ directory: dir, indexedDB, stateStore, onDiagnostic, storage }),
    uuid: () => database + '-' + String(++seq) });
}

// The newest copy of the directory goes into a new database on an empty device.
async function restoreLatest(dir, sourceStore) {
  const sink = createDirectorySink({ directory: dir });
  const latest = (await sink.list()).sort((a, b) => b.lastModified - a.lastModified)[0];
  const indexedDB = createFakeIndexedDB();
  await restore({ backupService: createBackupService({ store: sourceStore, sink }), stateStore: sourceStore, indexedDB,
    key: latest.key, targetName: TARGET, transportQuiescent: true });
  return { indexedDB, store: await createStateStore({ indexedDB, name: TARGET }) };
}

test('a paused research continues from the file copy on an empty device', async () => {
  const dir = directory(), transport = [], analyst = [answer('WAIT_OWNER'), answer('COMPLETE'), answer('COMPLETE')];
  const indexedDB = createFakeIndexedDB(), store = await createStateStore({ indexedDB });
  const first = await device({ dir, analyst, transport, store, indexedDB }).start({ task: 'T', maxCalls: 8 });
  assert.equal(first.state.phase, 'PAUSED');

  const copy = await restoreLatest(dir, store);
  const there = device({ dir, analyst, transport, store: copy.store, indexedDB: copy.indexedDB, database: TARGET });
  assert.deepEqual((await there.list()).map((r) => r.researchId), [first.researchId]);
  const resumed = await there.resume(first.researchId);
  assert.equal(resumed.state.phase, 'COMPLETED');
  assert.ok(!resumed.outcomes.some((o) => o.outcome === 'BACKUP_REQUIRED'));
  // Only the new cycle is sent: the recorded work and analyst answers are not paid again.
  assert.deepEqual(transport, ['1:work', '2:analyst', '3:analyst']);
  assert.deepEqual(await copy.store.getPacket(first.researchId, 1).then((p) => p.runId), (await store.getPacket(first.researchId, 1)).runId);
});

test('a research stopped in flight continues from the file copy after a human choice, without resending the request', async () => {
  const dir = directory(), transport = [], analyst = [answer('COMPLETE')];
  const indexedDB = createFakeIndexedDB(), store = await createStateStore({ indexedDB });
  let here, calls = 0;
  here = device({ dir, analyst, transport, store, indexedDB, onSend: async () => { if (++calls !== 2) return undefined; await here.stop(); return { byModel: {} }; } });
  const first = await here.start({ task: 'T', maxCalls: 8 });
  assert.equal(first.state.phase, 'RECONCILE');

  const copy = await restoreLatest(dir, store);
  const there = device({ dir, analyst, transport, store: copy.store, indexedDB: copy.indexedDB, database: TARGET });
  const waiting = await there.resume(first.researchId);
  assert.equal(waiting.state.phase, 'RECONCILE');
  assert.deepEqual(transport, ['1:work', '2:analyst']);
  // The abandoned cycle stays as a partial record; the research pauses on it, as without a restore.
  const abandoned = await there.resolveUnknown(first.researchId, 'abandon');
  assert.equal(abandoned.state.phase, 'PAUSED');
  const resumed = await there.resume(first.researchId);
  assert.ok(![...abandoned.outcomes, ...resumed.outcomes].some((o) => o.outcome === 'BACKUP_REQUIRED'));
  assert.equal(resumed.state.phase, 'COMPLETED');
  assert.deepEqual(transport, ['1:work', '2:analyst', '3:analyst']);
  assert.equal(resumed.state.budget.usedCalls, 3);
});
