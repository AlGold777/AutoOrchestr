'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const { createBackupGate } = require('../disput/thecycle/backup-gate.js');
function fixture() {
  const rows = new Map();
  const metadata = {
    async get(id) { return rows.has(id) ? structuredClone(rows.get(id)) : null; },
    async put(id, expected, value) {
      const actual = rows.get(id)?.revision ?? 0;
      if (actual !== expected) return false;
      rows.set(id, structuredClone(value));
      return true;
    }
  };
  let time = 1000000;
  let fail = false;
  const backup = { async save(key, { requiredCommitId }) {
    if (fail) throw new Error('DISK_FAILURE');
    return { key, verified: true, packetCommitId: requiredCommitId };
  } };
  const make = () => createBackupGate({ metadata, backup, clock: () => time });
  return { make, rows, setTime: v => { time = v; }, setFail: v => { fail = v; } };
}
test('initially blocked until verified backup', async () => {
  const f = fixture(), gate = f.make();
  await assert.rejects(gate.assertCanStartCycle('r'), /BACKUP_REQUIRED/);
  await gate.persist('r', 'manual');
  assert.equal(await gate.assertCanStartCycle('r'), true);
});
test('committed packet requires a matching verified backup', async () => {
  const f = fixture(), gate = f.make();
  await gate.persist('r', 'manual');
  await gate.requireCommit('r', 'pc-1');
  await assert.rejects(gate.assertCanStartCycle('r'), /BACKUP_REQUIRED/);
  await gate.persist('r', 'cycle');
  assert.equal(await gate.assertCanStartCycle('r'), true);
  assert.deepEqual((await gate.load('r')).pendingCommitIds, []);
});
test('gate survives recreation and disk failure', async () => {
  const f = fixture();
  await f.make().requireCommit('r', 'pc-2');
  f.setFail(true);
  await assert.rejects(f.make().persist('r', 'cycle'), /DISK_FAILURE/);
  await assert.rejects(f.make().assertCanStartCycle('r'), /BACKUP_REQUIRED/);
  f.setFail(false);
  await f.make().persist('r', 'cycle');
  assert.equal(await f.make().assertCanStartCycle('r'), true);
});
test('interval expiration blocks new cycle', async () => {
  const f = fixture();
  await f.make().persist('r', 'manual');
  f.setTime(1600000);
  await assert.rejects(f.make().assertCanStartCycle('r'), /BACKUP_INTERVAL_DUE/);
});
test('concurrent metadata conflict fails closed', async () => {
  const f = fixture(), gate = f.make();
  await gate.requireCommit('r', 'pc-1');
  await gate.requireCommit('r', 'pc-1');
  assert.deepEqual((await gate.load('r')).pendingCommitIds, ['pc-1']);
});
test('wrong backup commit does not unblock', async () => {
  const rows = new Map();
  const metadata = {
    async get(id) { return rows.get(id) || null; },
    async put(id, rev, val) { if ((rows.get(id)?.revision ?? 0) !== rev) return false; rows.set(id, val); return true; }
  };
  const gate = createBackupGate({ metadata, backup: { async save(key) {
    return { key, verified: true, packetCommitId: 'wrong' };
  } } });
  await gate.requireCommit('r', 'pc-1');
  await assert.rejects(gate.persist('r', 'cycle'), /BACKUP_UNVERIFIED/);
  await assert.rejects(gate.assertCanStartCycle('r'), /BACKUP_REQUIRED/);
});
