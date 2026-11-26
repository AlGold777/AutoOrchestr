// TheCycle: persist user-selected File System Access directory handles in IDB.
// No picker or permission prompt is ever invoked by background code.
(function initTheCycleDirectoryHandleManager(root) {
  'use strict';
  const DB = 'auto-orchestr-thecycle-directory-handles';
  function request(r) {
    return new Promise((resolve, reject) => {
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error || new Error('DIRECTORY_IDB_REQUEST_FAILED'));
    });
  }
  async function createDirectoryHandleManager({ indexedDB = root.indexedDB } = {}) {
    if (!indexedDB?.open) throw new Error('DIRECTORY_INDEXEDDB_UNAVAILABLE');
    const db = await new Promise((resolve, reject) => {
      const r = indexedDB.open(DB, 1);
      r.onupgradeneeded = () => {
        if (!r.result.objectStoreNames.contains('handles'))
          r.result.createObjectStore('handles', { keyPath: 'id' });
      };
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error || new Error('DIRECTORY_DB_OPEN_FAILED'));
      r.onblocked = () => reject(new Error('DIRECTORY_DB_BLOCKED'));
    });
    db.onversionchange = () => db.close();
    async function transaction(mode, work) {
      const tx = db.transaction('handles', mode);
      const done = new Promise((resolve, reject) => {
        tx.oncomplete = resolve;
        tx.onabort = () => reject(tx.error || new Error('DIRECTORY_TRANSACTION_ABORTED'));
      });
      done.catch(() => {});
      try {
        const result = await work(tx.objectStore('handles'));
        await done;
        return result;
      } catch (error) {
        try { tx.abort(); } catch (_) {}
        throw error;
      }
    }
    function checkId(id) {
      if (typeof id !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(id))
        throw new TypeError('INVALID_DIRECTORY_ID');
    }
    async function save(id, handle) {
      checkId(id);
      if (!handle || handle.kind !== 'directory' ||
          typeof handle.queryPermission !== 'function')
        throw new TypeError('INVALID_DIRECTORY_HANDLE');
      if (await handle.queryPermission({ mode: 'readwrite' }) !== 'granted')
        throw new Error('DIRECTORY_PERMISSION_REQUIRED');
      await transaction('readwrite', s => request(s.put({ id, handle })));
      return true;
    }
    async function load(id) {
      checkId(id);
      const record = await transaction('readonly', s => request(s.get(id)));
      if (!record) throw new Error('DIRECTORY_HANDLE_NOT_FOUND');
      if (await record.handle.queryPermission({ mode: 'readwrite' }) !== 'granted')
        throw new Error('DIRECTORY_PERMISSION_REQUIRED');
      return record.handle;
    }
    async function remove(id) {
      checkId(id);
      await transaction('readwrite', s => request(s.delete(id)));
    }
    return Object.freeze({ save, load, remove, close: () => db.close() });
  }
  const api = Object.freeze({ createDirectoryHandleManager });
  root.TheCycleDirectoryHandleManager = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
