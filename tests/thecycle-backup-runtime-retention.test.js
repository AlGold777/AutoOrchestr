'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createFakeIndexedDB } = require('./thecycle-fake-idb.js');
require('../disput/thecycle/gate-metadata.js');
require('../disput/thecycle/directory-sink.js');
require('../disput/thecycle/backup-service.js');
require('../disput/thecycle/backup-gate.js');
require('../disput/thecycle/backup-retention.js');
const { createBackupRuntime } = require('../disput/thecycle/backup-runtime.js');

const notFound = () => Object.assign(new Error('nf'), { name: 'NotFoundError' });
function directory() {
  const files = new Map(); let t = 1;
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
function stateStore(packets) {
  let n = 0;
  return { async exportVerifiedBackup() { n++; return { format: 'thecycle-backup', version: 1, algorithm: 'SHA-256', sha256: String(n).padStart(64, 'c'), payload: JSON.stringify({ n }) }; },
    async verifyBackup() { return { stores: { packets, research: [], runs: [], events: [], control: [] } }; },
    async load() { return { phase: 'PAUSED', backupRequiredCycleId: null, activeRunId: null }; } };
}
const storage = () => { const d = new Map(); return { async get(k) { return { [k]: d.get(k) }; }, async set(o) { for (const [k, v] of Object.entries(o)) d.set(k, JSON.parse(JSON.stringify(v))); } }; };

test('a copy without the required committed packet is not accepted: nothing is rotated; an accepted one rotates', async () => {
  const dir = directory(), events = [], st = storage();
  const packets = [];
  const rt = await createBackupRuntime({ directory: dir, indexedDB: createFakeIndexedDB(), stateStore: stateStore(packets), storage: st, keep: 3,
    onDiagnostic: async (type, data) => { events.push({ type, ...data }); } });
  const ok = [];
  for (let i = 1; i <= 3; i++) { await rt.gate.persist('r1', 'manual'); }
  assert.equal(dir.files.size, 3);
  // the gate now requires cycle 1; the snapshot has no such packet -> copy rejected, rotation untouched
  await rt.gate.requireCommit('r1', 'r1:cycle:1');
  await assert.rejects(rt.gate.persist('r1', 'cycle'), /BACKUP_MISSING_COMMITTED_PACKET|BACKUP_UNVERIFIED/);
  assert.equal(dir.files.size, 4, 'the rejected copy stays on disk but nothing older was deleted');
  assert.ok(!events.some((e) => e.type === 'RETENTION_DELETED'));
  // packet present: copy accepted, rotation runs
  packets.push({ researchId: 'r1', cycleId: 1 });
  await rt.gate.persist('r1', 'cycle');
  assert.ok(events.some((e) => e.type === 'RETENTION_DELETED'), 'old copy rotated after the accepted one');
  assert.ok(events.some((e) => e.type === 'RETENTION_DONE'));
  const lastBackup = (await rt.gate.load('r1')).lastBackupId;
  assert.ok(dir.files.has(lastBackup + '.thecycle.json'));
  rt.close();
});
