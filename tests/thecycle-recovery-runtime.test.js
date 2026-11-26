'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { recover } = require('../disput/thecycle/recovery-runtime.js');
test('recovery refuses to run without verified transport evidence', async () => {
  globalThis.TheCycleDirectorySink = { createDirectorySink: () => ({}) };
  globalThis.TheCycleBackup = { createBackupService: () => ({}) };
  globalThis.TheCycleRestore = { restore: () => { throw new Error('must not run'); } };
  await assert.rejects(recover({ stateStore: {}, verifyTransportQuiescence: async () =>
    ({ quiescent: false, source: 'browser', reference: 'check' }) }),
    /RECOVERY_TRANSPORT_NOT_QUIESCENT/);
});
test('recovery connects sink and backup to isolated restore', async () => {
  const sink = { get: async () => ({}) };
  const service = { getVerifiedEnvelope: async () => ({}) };
  globalThis.TheCycleDirectorySink = { createDirectorySink: () => sink };
  globalThis.TheCycleBackup = { createBackupService: ({ sink: s }) => {
    assert.equal(s, sink); return service;
  } };
  globalThis.TheCycleRestore = { restore: async (args) => {
    assert.equal(args.backupService, service);
    assert.equal(args.transportQuiescent, true);
    assert.equal(args.targetName, 'auto-orchestr-thecycle-restore-12345678');
    return { status: 'RESTORED_PAUSED' };
  } };
  const result = await recover({ stateStore: {}, backupKey: 'bk',
    targetName: 'auto-orchestr-thecycle-restore-12345678',
    verifyTransportQuiescence: async () => ({ quiescent: true, source: 'browser', reference: 'tab-closed' }) });
  assert.equal(result.activeDatabaseUnchanged, true);
  assert.equal(result.status, 'RESTORED_PAUSED');
});
