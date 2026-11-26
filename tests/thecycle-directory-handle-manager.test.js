'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createDirectoryHandleManager } = require('../disput/thecycle/directory-handle-manager.js');
test('rejects absent IndexedDB', async () => {
  await assert.rejects(createDirectoryHandleManager({ indexedDB: null }), /DIRECTORY_INDEXEDDB_UNAVAILABLE/);
});
test('rejects broken IndexedDB factory', async () => {
  await assert.rejects(createDirectoryHandleManager({ indexedDB: {} }), /DIRECTORY_INDEXEDDB_UNAVAILABLE/);
});
