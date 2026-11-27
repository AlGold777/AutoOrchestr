'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createDirectorySink } = require('../disput/thecycle/directory-sink.js');
function directory() {
  const files = new Map();
  let permission = 'granted';
  return {
    files,
    setPermission(value) { permission = value; },
    async queryPermission() { return permission; },
    async getFileHandle(name, { create = false } = {}) {
      if (!files.has(name)) {
        if (!create) { const error = new Error('not found'); error.name = 'NotFoundError'; throw error; }
        files.set(name, '');
      }
      return {
        async getFile() { return { text: async () => files.get(name) }; },
        async createWritable() {
          let data = '';
          return {
            async write(value) { data = value; },
            async close() { files.set(name, data); },
            async abort() {}
          };
        }
      };
    }
  };
}
test('round trip envelope through directory', async () => {
  const dir = directory(), sink = createDirectorySink({ directory: dir });
  const value = { format: 'thecycle-backup', sha256: 'abc', payload: '{"ok":true}' };
  await sink.put('research-1', value);
  assert.deepEqual(await sink.get('research-1'), value);
});
test('missing backup returns null', async () => {
  const sink = createDirectorySink({ directory: directory() });
  assert.equal(await sink.get('missing'), null);
});
test('rejects path traversal', async () => {
  const sink = createDirectorySink({ directory: directory() });
  await assert.rejects(sink.put('../secret', {}), /INVALID_BACKUP_KEY/);
});
test('rejects overwrite of an existing backup', async () => {
  const sink = createDirectorySink({ directory: directory() });
  await sink.put('one', { version: 1 });
  await assert.rejects(sink.put('one', { version: 2 }), /BACKUP_ALREADY_EXISTS/);
});
test('requires granted permission without prompting', async () => {
  const dir = directory(), sink = createDirectorySink({ directory: dir });
  dir.setPermission('prompt');
  await assert.rejects(sink.put('one', {}), /BACKUP_DIRECTORY_PERMISSION_REQUIRED/);
});
test('invalid persisted JSON fails closed', async () => {
  const dir = directory(), sink = createDirectorySink({ directory: dir });
  dir.files.set('bad.thecycle.json', '{');
  await assert.rejects(sink.get('bad'), /BACKUP_FILE_INVALID_JSON/);
});
