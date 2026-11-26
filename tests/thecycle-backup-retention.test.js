'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createFakeIndexedDB } = require('./thecycle-fake-idb.js');
const { createDirectorySink } = require('../disput/thecycle/directory-sink.js');
const { createRetention, planRetention } = require('../disput/thecycle/backup-retention.js');
const telemetryApi = require('../disput/thecycle/telemetry.js');

const notFound = () => Object.assign(new Error('not found'), { name: 'NotFoundError' });
function directory({ failRemove = new Set() } = {}) {
  const files = new Map(); let clock = 1000;
  return {
    files, removed: [],
    async queryPermission() { return 'granted'; },
    async getFileHandle(name, { create = false } = {}) {
      if (!files.has(name)) { if (!create) throw notFound(); files.set(name, { text: '', modified: clock++ }); }
      const entry = files.get(name);
      return { kind: 'file', async getFile() { return { text: async () => entry.text, lastModified: entry.modified }; },
        async createWritable() { let data = ''; return { async write(v) { data = v; }, async close() { entry.text = data; }, async abort() {} }; } };
    },
    async *entries() { for (const name of [...files.keys()]) yield [name, await this.getFileHandle(name)]; },
    async removeEntry(name) {
      if (failRemove.has(name)) throw Object.assign(new Error('locked'), { name: 'NoModificationAllowedError' });
      if (!files.has(name)) throw notFound();
      files.delete(name); this.removed.push(name);
    }
  };
}
const envelope = (n) => ({ format: 'thecycle-backup', version: 1, algorithm: 'SHA-256', sha256: String(n).padStart(64, 'a'), payload: '{}' });
function storage() {
  const data = new Map();
  return { data, async get(k) { return { [k]: data.get(k) }; }, async set(o) { for (const [k, v] of Object.entries(o)) data.set(k, JSON.parse(JSON.stringify(v))); } };
}
async function write(dir, key, n = 1) { await createDirectorySink({ directory: dir }).put(key, envelope(n)); }
function setup({ failRemove, gate = [], research = {} } = {}) {
  const dir = directory({ failRemove }), st = storage(), events = [];
  const sink = createDirectorySink({ directory: dir });
  const retention = createRetention({ sink, store: { async verifyBackup() { return {}; }, async load(id) { if (!research[id]) throw Object.assign(new Error('RESEARCH_NOT_FOUND'), { code: 'RESEARCH_NOT_FOUND' }); return research[id]; } },
    metadata: { async list() { return gate; } }, storage: st, keep: 10, onEvent: async (type, data) => { events.push({ type, ...data }); } });
  let at = 10000;
  const save = async (key) => { await write(dir, key); return retention.afterVerified({ key, sha256: 'a'.repeat(64), createdAt: at++ }); };
  return { dir, st, events, retention, save, sink };
}

test('planRetention is unchanged: only verified, unprotected, inactive copies beyond keep', () => {
  const records = Array.from({ length: 4 }, (_, i) => ({ key: 'k' + i, createdAt: i, verified: true }));
  assert.deepEqual(planRetention({ records, keep: 2, protectedKeys: ['k0'] }).deleteCandidates, ['k1']);
});

test('11 verified copies become 10: the oldest file is removed, newest 10 stay', async () => {
  const x = setup();
  for (let i = 1; i <= 11; i++) await x.save('thecycle-c' + i);
  assert.equal(x.dir.files.size, 10);
  assert.ok(!x.dir.files.has('thecycle-c1.thecycle.json')); assert.ok(x.dir.files.has('thecycle-c11.thecycle.json'));
  assert.deepEqual(x.events.filter((e) => e.type === 'RETENTION_DELETED').map((e) => e.retention.key), ['thecycle-c1']);
  const done = x.events.filter((e) => e.type === 'RETENTION_DONE').at(-1).retention;
  assert.deepEqual(done.deleted, ['thecycle-c1']); assert.equal(done.verifiedTotal, 10);
});

test('protected copy (research still open) and the copy just written are never deleted; finished research copy is', async () => {
  const gate = [{ researchId: 'open', lastBackupId: 'thecycle-c1' }, { researchId: 'done', lastBackupId: 'thecycle-c2' }, { researchId: 'foreign', lastBackupId: 'thecycle-c3' }];
  const research = { open: { phase: 'PAUSED', activeRunId: null, backupRequiredCycleId: null },
    done: { phase: 'COMPLETED', activeRunId: null, backupRequiredCycleId: null } };
  const x = setup({ gate, research });
  for (let i = 1; i <= 13; i++) await x.save('thecycle-c' + i);
  assert.ok(x.dir.files.has('thecycle-c1.thecycle.json'), 'open research copy kept');
  assert.ok(x.dir.files.has('thecycle-c3.thecycle.json'), 'research unknown to the database kept');
  assert.ok(!x.dir.files.has('thecycle-c2.thecycle.json'), 'finished research copy rotated');
  // clock skew: the new copy is "older" than all others, but is still kept
  await write(x.dir, 'thecycle-skew');
  await x.retention.afterVerified({ key: 'thecycle-skew', sha256: 'a'.repeat(64), createdAt: 1 });
  assert.ok(x.dir.files.has('thecycle-skew.thecycle.json'));
});

test('removeEntry failure: reported, other copies still rotated, the new copy is untouched, nothing thrown', async () => {
  const x = setup({ failRemove: new Set(['thecycle-c1.thecycle.json']) });
  for (let i = 1; i <= 12; i++) await x.save('thecycle-c' + i);
  assert.ok(x.dir.files.has('thecycle-c1.thecycle.json')); assert.ok(!x.dir.files.has('thecycle-c2.thecycle.json'));
  assert.ok(x.dir.files.has('thecycle-c12.thecycle.json'));
  const failed = x.events.filter((e) => e.type === 'RETENTION_DELETE_FAILED');
  assert.ok(failed.length >= 1); assert.equal(failed[0].retention.key, 'thecycle-c1'); assert.match(failed[0].retention.code, /NoModificationAllowedError|locked/);
});

test('listing failure and unknown protection fail closed: nothing is deleted', async () => {
  const x = setup();
  for (let i = 1; i <= 11; i++) await x.save('thecycle-c' + i);
  const noMeta = createRetention({ sink: x.sink, store: { async verifyBackup() {} }, metadata: null, storage: x.st, keep: 10, onEvent: async (t, d) => x.events.push({ type: t, ...d }) });
  await write(x.dir, 'thecycle-c12');
  const r = await noMeta.afterVerified({ key: 'thecycle-c12', createdAt: 99999 });
  assert.equal(r.skipped, 'PROTECTION_UNKNOWN'); assert.equal(x.dir.files.size, 11);
  assert.ok(x.events.some((e) => e.type === 'RETENTION_SKIPPED'));
});

test('unknown old files are adopted only after verifyBackup; a corrupt one is left alone', async () => {
  const x = setup();
  await write(x.dir, 'old-good'); await write(x.dir, 'old-bad');
  const bad = createRetention({ sink: x.sink, store: { async verifyBackup(env) { if (env.sha256.endsWith('bbbb')) throw new Error('BACKUP_INTEGRITY_FAILED'); return {}; } },
    metadata: { async list() { return []; } }, storage: x.st, keep: 2, onEvent: async (t, d) => x.events.push({ type: t, ...d }) });
  x.dir.files.get('old-bad.thecycle.json').text = JSON.stringify({ ...envelope(1), sha256: 'b'.repeat(64) });
  x.dir.files.get('old-good.thecycle.json').text = JSON.stringify(envelope(2));
  for (const key of ['n1', 'n2']) { await write(x.dir, key); await bad.afterVerified({ key, createdAt: 50000 + x.dir.files.size }); }
  assert.ok(x.dir.files.has('old-bad.thecycle.json'), 'unverified file is never deleted');
  assert.ok(!x.dir.files.has('old-good.thecycle.json'), 'verified old file rotated');
  assert.ok(x.events.some((e) => e.type === 'RETENTION_UNVERIFIED_SKIPPED' && e.retention.key === 'old-bad'));
});

test('rotation events reach Telemetry and the MD export', async () => {
  const x = setup(); const rows = []; let seq = 0;
  const t = telemetryApi.createTelemetry({ repository: { async append(r) { rows.push({ ...r, seq: ++seq }); }, async list() { return rows; }, async clear() {} }, version: () => 't' });
  const retention = createRetention({ sink: x.sink, store: { async verifyBackup() {} }, metadata: { async list() { return []; } }, storage: x.st, keep: 2,
    onEvent: (type, data) => t.append(type, { researchId: 'r1', ...data }) });
  for (let i = 1; i <= 3; i++) { await write(x.dir, 'thecycle-m' + i); await retention.afterVerified({ key: 'thecycle-m' + i, createdAt: i }); }
  const md = telemetryApi.markdown(await t.list());
  assert.match(md, /RETENTION_DELETED/); assert.match(md, /RETENTION_DONE/); assert.match(md, /thecycle-m1/);
});
