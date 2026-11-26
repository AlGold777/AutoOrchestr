'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createFakeIndexedDB } = require('./thecycle-fake-idb.js');
const manager = require('../disput/thecycle/directory-handle-manager.js');
const telemetryApi = require('../disput/thecycle/telemetry.js');

function handle(initial, afterRequest) {
  const h = { kind: 'directory', state: initial, requests: 0,
    async queryPermission() { return h.state; },
    async requestPermission() { h.requests++; if (afterRequest === 'throw') throw new Error('NO_ACTIVATION'); h.state = afterRequest; return h.state; } };
  return h;
}
async function setup(h) {
  const indexedDB = createFakeIndexedDB();
  if (h) {
    const m = await manager.createDirectoryHandleManager({ indexedDB });
    const before = h.state; h.state = 'granted';
    await m.save('thecycle-backups', h);
    h.state = before; m.close();
  }
  const rows = []; let seq = 0;
  const telemetry = telemetryApi.createTelemetry({ repository: { async append(r) { rows.push({ ...r, seq: ++seq }); }, async list() { return rows; }, async clear() {} }, version: () => 't' });
  return { indexedDB, telemetry, rows };
}

test('permission already granted: no prompt, event ALREADY_GRANTED', async () => {
  const h = handle('granted', 'granted');
  const x = await setup(h);
  const r = await manager.restoreBackupDirectoryAccess({ indexedDB: x.indexedDB, telemetry: x.telemetry });
  assert.equal(r.ok, true); assert.equal(r.requested, false); assert.equal(h.requests, 0);
  assert.equal(x.rows[0].type, 'BACKUP_DIRECTORY_PERMISSION'); assert.equal(x.rows[0].directory.outcome, 'ALREADY_GRANTED');
});

test('permission needs a prompt and is granted: requestPermission called once, event GRANTED_AFTER_REQUEST', async () => {
  const h = handle('prompt', 'granted');
  const x = await setup(h);
  const r = await manager.restoreBackupDirectoryAccess({ indexedDB: x.indexedDB, telemetry: x.telemetry });
  assert.equal(r.ok, true); assert.equal(r.requested, true); assert.equal(h.requests, 1);
  assert.equal(x.rows[0].directory.outcome, 'GRANTED_AFTER_REQUEST');
  assert.match(telemetryApi.markdown(x.rows), /GRANTED_AFTER_REQUEST/);
});

test('permission refused: result is not ok, Russian message, event DENIED in the MD export', async () => {
  const h = handle('prompt', 'denied');
  const x = await setup(h);
  const r = await manager.restoreBackupDirectoryAccess({ indexedDB: x.indexedDB, telemetry: x.telemetry });
  assert.equal(r.ok, false); assert.equal(r.code, 'DIRECTORY_PERMISSION_REQUIRED');
  assert.match(r.message, /Нет доступа к каталогу копий/); assert.match(r.message, /до первой отправки/);
  assert.equal(x.rows[0].directory.outcome, 'DENIED'); assert.equal(x.rows[0].directory.permission, 'denied');
  assert.match(telemetryApi.markdown(x.rows), /"outcome":"DENIED"/);
});

test('requestPermission throws (no user gesture): treated as a refusal, not an exception', async () => {
  const h = handle('prompt', 'throw');
  const x = await setup(h);
  const r = await manager.restoreBackupDirectoryAccess({ indexedDB: x.indexedDB, telemetry: x.telemetry });
  assert.equal(r.ok, false); assert.equal(x.rows[0].directory.outcome, 'ERROR'); assert.match(x.rows[0].directory.error, /NO_ACTIVATION/);
});

test('no saved directory: NOT_CONFIGURED', async () => {
  const x = await setup(null);
  const r = await manager.restoreBackupDirectoryAccess({ indexedDB: x.indexedDB, telemetry: x.telemetry });
  assert.equal(r.ok, false); assert.equal(r.outcome, 'NOT_CONFIGURED');
});

test('Run click: the permission request is the first thing startDebateFromPage starts, before any await', () => {
  const src = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'results.js'), 'utf8');
  const start = src.indexOf('const startDebateFromPage = async () => {');
  const body = src.slice(start, src.indexOf('const cancelPipelineRun', start));
  const call = body.indexOf('ensureCircleBackupAccess()');
  const firstAwait = body.indexOf('await ');
  assert.ok(call > 0 && firstAwait > 0 && call < firstAwait, 'permission is requested before the first await');
  assert.match(body, /circleAccess = [^;]*ensureCircleBackupAccess\(\)/);
});
