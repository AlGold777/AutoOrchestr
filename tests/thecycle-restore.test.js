'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { validate, restore } = require('../disput/thecycle/restore-service.js');
const snapshot = () => ({
  format: 'thecycle-idb-snapshot', version: 1, databaseVersion: 1,
  stores: { research: [{ researchId: 'r', stateVersion: 0, phase: 'READY', activeRunId: null }],
    control: [], runs: [], events: [], packets: [] }
});
test('accepts structurally valid snapshot', () => {
  assert.equal(validate(snapshot()).stores.research.length, 1);
});
test('rejects duplicate keys', () => {
  const s = snapshot();
  s.stores.research.push({ ...s.stores.research[0] });
  assert.throws(() => validate(s), /RESTORE_DUPLICATE_KEY/);
});
test('rejects orphan packet', () => {
  const s = snapshot();
  s.stores.packets.push({ researchId: 'missing', cycleId: 1 });
  assert.throws(() => validate(s), /RESTORE_ORPHAN_ROW/);
});
test('rejects unknown control records', () => {
  const s = snapshot();
  s.stores.control.push({ key: 'other' });
  assert.throws(() => validate(s), /RESTORE_CONTROL_INVALID/);
});
test('rejects invalid schema', () => {
  const s = snapshot(); delete s.stores.events;
  assert.throws(() => validate(s), /RESTORE_SCHEMA_INVALID/);
});
test('restore requires explicit transport quiescence', async () => {
  await assert.rejects(restore({ backupService: {}, stateStore: {}, indexedDB: {},
    key: 'backup', targetName: 'auto-orchestr-thecycle-restore-12345678' }),
    /RESTORE_PRECONDITION_FAILED/);
});
