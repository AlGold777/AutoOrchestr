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
const { createRecoveryRepositories } = require('../disput/thecycle/recovery-repositories.js');
require('../disput/thecycle/recovery-runtime.js');
require('../disput/thecycle/database-activation.js');
require('../disput/thecycle/activation-coordinator.js');
const activeStoreApi = require('../disput/thecycle/active-state-store.js');
const { createGateMetadata } = require('../disput/thecycle/gate-metadata.js');
const { createWriterLock } = require('../disput/thecycle/writer-lock.js');
const { restoreFromCopy, listCopies } = require('../disput/thecycle/restore-flow.js');
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

function pageStorage(values = new Map()) {
  return { values, async get(k) { return k === null ? Object.fromEntries(values) : { [k]: values.get(k) }; },
    async set(o) { for (const [k, v] of Object.entries(o)) values.set(k, clone(v)); } };
}

// Web Locks of one browser: shared holders exclude the exclusive one and the other way round; nothing queues.
function webLocks() {
  let shared = 0, exclusive = false;
  return { request(name, { mode }, callback) {
    return Promise.resolve().then(async () => {
      if (exclusive || (mode === 'exclusive' && shared)) return callback(null);
      if (mode === 'exclusive') exclusive = true; else shared += 1;
      try { return await callback({ name, mode }); } finally { if (mode === 'exclusive') exclusive = false; else shared -= 1; }
    });
  } };
}

// One device: its own database and page storage; the file directory is shared between devices.
// Without a fixed store the runner opens the active database of the device, as the page does.
function device({ dir, analyst, transport, store, indexedDB, database = 'auto-orchestr-thecycle', onSend, storage = pageStorage(), writerLock }) {
  let seq = 0;
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
  const activeStore = store ? { async createActiveStateStore() { return { store, database, close() {} }; } }
    : { createActiveStateStore: () => activeStoreApi.createActiveStateStore({ indexedDB }) };
  return createCircleRunner({ bridge, storage, activeStore, writerLock,
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

const latestKey = async (dir) => (await createDirectorySink({ directory: dir }).list()).sort((a, b) => b.lastModified - a.lastModified)[0].key;
// The browser of a person: default database, page storage, backup gate records, one set of Web Locks.
async function browser() {
  const indexedDB = createFakeIndexedDB(), storage = pageStorage(), locks = webLocks();
  await createStateStore({ indexedDB });
  const pointer = async () => { const r = await createRecoveryRepositories({ indexedDB }); try { return await r.activation.read(); } finally { r.close(); } };
  const restoreCopy = (dir, backupKey, extra = {}) => restoreFromCopy({ backupKey, directory: dir, storage, indexedDB,
    writerLock: createWriterLock({ locks }), telemetry: null, ...extra });
  const page = (options) => device({ indexedDB, storage, writerLock: createWriterLock({ locks }), ...options });
  return { indexedDB, storage, locks, pointer, restoreCopy, page };
}

// A research on another device; the directory keeps its copies.
async function elsewhere({ answers = [answer('WAIT_OWNER'), answer('COMPLETE'), answer('COMPLETE')], onSend } = {}) {
  const dir = directory(), transport = [], indexedDB = createFakeIndexedDB(), store = await createStateStore({ indexedDB });
  const here = device({ dir, analyst: answers, transport, store, indexedDB, onSend: onSend && (() => onSend(here)) });
  const first = await here.start({ task: 'T', maxCalls: 8 });
  return { dir, transport, analyst: answers, indexedDB, store, first };
}

test('one action restores a copy on an empty device, activates it and lists the research; resume sends only new requests', async () => {
  const source = await elsewhere(), there = await browser();
  const result = await there.restoreCopy(source.dir, await latestKey(source.dir));
  assert.deepEqual(await there.pointer(), { revision: 1, activeDatabase: result.database });
  assert.equal(result.previousDatabase, 'auto-orchestr-thecycle');
  assert.equal(result.researchId, source.first.researchId);
  assert.equal(there.storage.values.get('thecycle.circle.latest'), source.first.researchId);
  assert.equal(there.storage.values.get('thecycle.circle.pending').researchId, source.first.researchId);
  assert.equal(there.storage.values.get('thecycle.activation').activeDatabase, result.database);

  const page = there.page({ dir: source.dir, analyst: source.analyst, transport: source.transport });
  assert.deepEqual((await page.list()).map((r) => [r.researchId, r.usedCalls, r.maxCalls]), [[source.first.researchId, 2, 8]]);
  const restored = await page.snapshot(source.first.researchId);
  assert.deepEqual(restored.report, source.first.report);
  assert.deepEqual(restored.state.config, source.first.state.config);
  const resumed = await page.resume(source.first.researchId);
  assert.equal(resumed.state.phase, 'COMPLETED');
  assert.equal(resumed.state.budget.usedCalls, 3);
  assert.deepEqual(source.transport, ['1:work', '2:analyst', '3:analyst']);
});

test('a copy taken before the evaluation continues it after the restore, without resending the work', async () => {
  const source = await elsewhere({ answers: [answer('COMPLETE'), answer('COMPLETE')] });
  // The first copy that holds the committed work cycle and no analyst request.
  const sink = createDirectorySink({ directory: source.dir }), service = createBackupService({ store: source.store, sink });
  let key = null;
  for (const row of (await sink.list()).sort((a, b) => a.lastModified - b.lastModified)) {
    const snapshot = await source.store.verifyBackup(await service.getVerifiedEnvelope(row.key));
    const state = snapshot.stores.research[0];
    if (state?.phase === 'EVALUATE' && state.lastCommittedPacket === 1) { key = row.key; break; }
  }
  assert.ok(key, 'a copy at EVALUATE exists');
  const there = await browser();
  await there.restoreCopy(source.dir, key);
  const transport = [];
  const resumed = await there.page({ dir: source.dir, analyst: [answer('COMPLETE')], transport }).resume(source.first.researchId);
  assert.equal(resumed.state.phase, 'COMPLETED');
  assert.deepEqual(transport, ['2:analyst']);
});

test('a request with an unknown outcome stays for a human choice after the restore and is not sent again', async () => {
  let calls = 0;
  const source = await elsewhere({ answers: [answer('COMPLETE')],
    onSend: async (here) => { if (++calls !== 2) return undefined; await here.stop(); return { byModel: {} }; } });
  assert.equal(source.first.state.phase, 'RECONCILE');
  const there = await browser();
  const result = await there.restoreCopy(source.dir, await latestKey(source.dir));
  assert.equal(result.requiresManualReconciliation, true);
  const page = there.page({ dir: source.dir, analyst: source.analyst, transport: source.transport });
  assert.equal((await page.snapshot(source.first.researchId)).unknown, true);
  assert.equal((await page.resume(source.first.researchId)).state.phase, 'RECONCILE');
  await page.resolveUnknown(source.first.researchId, 'abandon');
  assert.equal((await page.resume(source.first.researchId)).state.phase, 'COMPLETED');
  assert.deepEqual(source.transport, ['1:work', '2:analyst', '3:analyst']);
});

test('a damaged copy is listed as damaged and refused; the active database stays', async () => {
  const source = await elsewhere(), there = await browser();
  const key = await latestKey(source.dir), file = source.dir.files.get(key + '.thecycle.json');
  const whole = file.text;
  for (const damaged of [whole.slice(0, whole.length >> 1), whole.replace('"payload":"', '"payload":"x')]) {
    file.text = damaged;
    const sourceStore = await createStateStore({ indexedDB: there.indexedDB });
    const row = (await listCopies({ directory: source.dir, store: sourceStore })).find((copy) => copy.key === key);
    assert.ok(row.damaged);
    await assert.rejects(there.restoreCopy(source.dir, key), /BACKUP_|INVALID_BACKUP|RESTORE_/);
    assert.deepEqual(await there.pointer(), { revision: 0, activeDatabase: 'auto-orchestr-thecycle' });
    assert.equal(there.storage.values.size, 0);
  }
  file.text = whole;
  assert.equal((await there.restoreCopy(source.dir, key)).revision, 1);
});

test('a busy transport refuses the restore: a running research, then a fresh heartbeat', async () => {
  const source = await elsewhere(), there = await browser(), key = await latestKey(source.dir);
  let refused = null;
  const running = there.page({ dir: directory(), analyst: [answer('COMPLETE')], transport: [],
    onSend: async () => { refused ||= await there.restoreCopy(source.dir, key).then(() => 'restored', (error) => error.code); return undefined; } });
  await running.start({ task: 'Local', maxCalls: 8 });
  assert.equal(refused, 'RESTORE_TRANSPORT_BUSY');
  assert.equal((await there.pointer()).revision, 0);

  const idle = await browser();
  await idle.storage.set({ 'thecycle.circle.heartbeat.other': { ownerId: 'tab', at: Date.now() } });
  await assert.rejects(idle.restoreCopy(source.dir, key), { code: 'RESTORE_TRANSPORT_BUSY' });
  assert.equal((await idle.pointer()).revision, 0);
  // A heartbeat that stopped three minutes ago no longer holds the transport.
  await idle.storage.set({ 'thecycle.circle.heartbeat.other': { ownerId: 'tab', at: Date.now() - 180000 } });
  assert.equal((await idle.restoreCopy(source.dir, key)).revision, 1);
});

test('nothing starts or continues while a restore holds the writer lock', async () => {
  const source = await elsewhere(), there = await browser(), transport = [];
  const release = await createWriterLock({ locks: there.locks }).exclusive();
  const page = there.page({ dir: source.dir, analyst: [], transport });
  await assert.rejects(page.start({ task: 'T', maxCalls: 8 }), { code: 'THECYCLE_RESTORE_IN_PROGRESS' });
  await assert.rejects(page.resume(source.first.researchId), { code: 'THECYCLE_RESTORE_IN_PROGRESS' });
  assert.deepEqual(transport, []);
  await release();
  assert.deepEqual(await page.list(), []);
});

test('a copy without researches is refused', async () => {
  const dir = directory(), there = await browser();
  const store = await createStateStore({ indexedDB: there.indexedDB });
  await createBackupService({ store, sink: createDirectorySink({ directory: dir }) }).save('thecycle-manual-empty');
  await assert.rejects(there.restoreCopy(dir, 'thecycle-manual-empty'), { code: 'RESTORE_COPY_EMPTY' });
  assert.equal((await there.pointer()).revision, 0);
});

test('a copy older than the data of this browser is refused: an unknown request is not forgotten', async () => {
  let calls = 0, page = null;
  const there = await browser(), dir = directory(), transport = [];
  page = there.page({ dir, analyst: [], transport, onSend: async () => { if (++calls !== 2) return undefined; await page.stop(); return { byModel: {} }; } });
  const first = await page.start({ task: 'T', maxCalls: 8 });
  assert.equal(first.state.phase, 'RECONCILE');
  const sink = createDirectorySink({ directory: dir });
  const oldest = (await sink.list()).sort((a, b) => a.lastModified - b.lastModified)[0].key;
  await assert.rejects(there.restoreCopy(dir, oldest), { code: 'RESTORE_ACTIVE_NEWER' });
  assert.deepEqual(await there.pointer(), { revision: 0, activeDatabase: 'auto-orchestr-thecycle' });
  assert.equal((await page.snapshot(first.researchId)).state.budget.usedCalls, 2);
  assert.equal(transport.length, 2);
});

test('a copy without a research of this browser, or from before its close, is refused', async () => {
  const source = await elsewhere(), there = await browser(), key = await latestKey(source.dir);
  const local = there.page({ dir: directory(), analyst: [answer('WAIT_OWNER')], transport: [], database: 'local' });
  await local.start({ task: 'Local', maxCalls: 8 });
  await assert.rejects(there.restoreCopy(source.dir, key), { code: 'RESTORE_ACTIVE_NEWER' });
  assert.equal((await there.pointer()).revision, 0);

  // A research closed without any request: only its phase tells that the copy is older.
  const same = await browser(), dir = directory(), store = await createStateStore({ indexedDB: same.indexedDB });
  await store.createResearch({ researchId: 'r-closed', task: 'T', pipelineRef: 'p', maxCalls: 8 });
  await createBackupService({ store, sink: createDirectorySink({ directory: dir }) }).save('thecycle-manual-open');
  const token = await store.acquire({ researchId: 'r-closed', ownerId: 'tab' });
  await store.decide(token, { expectedVersion: (await store.load('r-closed')).stateVersion, action: 'COMPLETE' });
  await assert.rejects(same.restoreCopy(dir, 'thecycle-manual-open'), { code: 'RESTORE_ACTIVE_NEWER' });
  assert.equal((await same.pointer()).revision, 0);
});

test('backup records left by lost local data restart from the copy and research continues', async () => {
  const source = await elsewhere(), there = await browser(), key = await latestKey(source.dir);
  // The research data is gone, a packet of a later state still waits for its copy.
  const metadata = await createGateMetadata({ indexedDB: there.indexedDB });
  const researchId = source.first.researchId;
  assert.equal(await metadata.put(researchId, 0, { researchId, revision: 1, blocked: true, lastVerifiedAt: null,
    lastBackupId: 'gone', verifiedCommitId: null, pendingCommitIds: [researchId + ':cycle:99'] }), true);
  await there.restoreCopy(source.dir, key);
  const reset = await metadata.get(researchId);
  assert.deepEqual([reset.pendingCommitIds, reset.lastBackupId, reset.blocked], [[], key, true]);
  const resumed = await there.page({ dir: source.dir, analyst: source.analyst, transport: source.transport }).resume(researchId);
  assert.equal(resumed.state.phase, 'COMPLETED');
});

test('a copy taken between the answer and its record has no unknown request', async () => {
  const there = await browser(), dir = directory();
  const indexedDB = createFakeIndexedDB(), store = await createStateStore({ indexedDB });
  await store.createResearch({ researchId: 'r-commit', task: 'T', pipelineRef: 'p', maxCalls: 8 });
  const token = await store.acquire({ researchId: 'r-commit', ownerId: 'tab' });
  await store.prepareRun(token, { expectedVersion: (await store.load('r-commit')).stateVersion, runId: 'run', cycleId: 1, pipelineRef: 'p', maxCalls: 2 });
  const journal = store.journalFor(token), id = { researchId: 'r-commit', runId: 'run', cycleId: 1 };
  await journal({ ...id, type: 'RUN_INTENT', maxCalls: 2 });
  await journal({ ...id, type: 'DISPATCH_INTENT', batchId: 'b', models: ['GPT'] });
  await journal({ ...id, type: 'DISPATCH_RESPONSE', batchId: 'b' });
  await journal({ ...id, type: 'RUN_RESULT', report: id });
  assert.equal((await store.load('r-commit')).phase, 'COMMIT');
  await createBackupService({ store, sink: createDirectorySink({ directory: dir }) }).save('thecycle-manual-commit');
  assert.equal((await there.restoreCopy(dir, 'thecycle-manual-commit')).requiresManualReconciliation, false);
});

test('a switch that fails puts the backup records back', async () => {
  const there = await browser(), dir = directory(), transport = [];
  const first = await there.page({ dir, analyst: [answer('WAIT_OWNER')], transport }).start({ task: 'T', maxCalls: 8 });
  const metadata = await createGateMetadata({ indexedDB: there.indexedDB });
  const before = await metadata.get(first.researchId), key = await latestKey(dir);
  // The transport turns busy between the data write and the switch.
  let reads = 0;
  const storage = { ...there.storage, async get(k) {
    if (k === null && ++reads === 3) await there.storage.set({ 'thecycle.circle.heartbeat.late': { ownerId: 'tab', at: Date.now() } });
    return there.storage.get(k);
  } };
  await assert.rejects(there.restoreCopy(dir, key, { storage }), /ACTIVATION_/);
  assert.equal((await there.pointer()).revision, 0);
  const after = await metadata.get(first.researchId);
  assert.deepEqual({ ...after, revision: 0 }, { ...before, revision: 0 });
});

test('closing a research for good leaves a verified copy of the closed state', async () => {
  let calls = 0;
  const there = await browser(), dir = directory(), transport = [];
  let page = null;
  page = there.page({ dir, analyst: [], transport, onSend: async () => { if (++calls !== 2) return undefined; await page.stop(); return { byModel: {} }; } });
  const first = await page.start({ task: 'T', maxCalls: 8 });
  const closed = await page.resolveUnknown(first.researchId, 'close');
  assert.equal(closed.state.phase, 'COMPLETED');
  assert.equal(closed.closeCopy.verified, true);
  const other = await browser();
  assert.equal((await other.restoreCopy(dir, closed.closeCopy.key)).requiresManualReconciliation, false);
  // The same copy over the data it was taken from loses nothing and is accepted.
  assert.equal((await there.restoreCopy(dir, closed.closeCopy.key)).revision, 1);
  const copy = await other.page({ dir, analyst: [], transport }).snapshot(first.researchId);
  assert.deepEqual([copy.state.phase, copy.state.closedReason, copy.state.budget.usedCalls],
    ['COMPLETED', closed.state.closedReason, closed.state.budget.usedCalls]);
  assert.equal(transport.length, 2);
});

test('a close without a writable directory still closes and reports the missing copy', async () => {
  let calls = 0;
  const there = await browser(), dir = directory(), transport = [];
  let page = null;
  page = there.page({ dir, analyst: [], transport, onSend: async () => { if (++calls !== 2) return undefined; await page.stop(); return { byModel: {} }; } });
  const first = await page.start({ task: 'T', maxCalls: 8 });
  dir.queryPermission = async () => 'prompt';
  const closed = await page.resolveUnknown(first.researchId, 'close');
  assert.equal(closed.state.phase, 'COMPLETED');
  assert.deepEqual(closed.closeCopy, { verified: false, error: 'BACKUP_DIRECTORY_PERMISSION_REQUIRED' });
});
