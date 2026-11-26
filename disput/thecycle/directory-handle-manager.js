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
    // Restores access to a stored handle. requestPermission needs a user gesture (transient activation),
    // so call this first thing from a click handler. Never throws on a refusal: the caller decides.
    // Returns { permission: 'granted' | 'prompt' | 'denied' | 'error', requested }.
    async function ensurePermission(id, { ask = true } = {}) {
      checkId(id);
      const record = await transaction('readonly', s => request(s.get(id)));
      if (!record) throw new Error('DIRECTORY_HANDLE_NOT_FOUND');
      const handle = record.handle;
      const mode = { mode: 'readwrite' };
      const current = await handle.queryPermission(mode);
      if (current === 'granted') return { permission: 'granted', requested: false };
      if (!ask || typeof handle.requestPermission !== 'function') return { permission: current, requested: false };
      try {
        return { permission: await handle.requestPermission(mode), requested: true };
      } catch (error) {
        return { permission: 'error', requested: true, error: String(error?.message || error) };
      }
    }
    async function remove(id) {
      checkId(id);
      await transaction('readwrite', s => request(s.delete(id)));
    }
    return Object.freeze({ save, load, ensurePermission, remove, close: () => db.close() });
  }
  const NO_ACCESS_MESSAGE = 'Нет доступа к каталогу копий. Разрешите доступ при запуске или выберите каталог заново в настройках копий. Запуск остановлен до первой отправки.';
  // Called from the Run click: restores the saved directory permission and writes the outcome to TheCycle telemetry.
  // Result: { ok, permission, requested, outcome, code, message }.
  async function restoreBackupDirectoryAccess({ id = 'thecycle-backups', ask = true, indexedDB = root.indexedDB,
    telemetry = root.TheCycleTelemetry, source = 'run' } = {}) {
    const emit = async (outcome, extra = {}) => {
      try { await telemetry?.append('BACKUP_DIRECTORY_PERMISSION', { directory: { id, source, outcome, ...extra }, reason: outcome }); }
      catch (_) { /* diagnostics must not change the result */ }
    };
    const fail = async (outcome, code, extra = {}) => {
      await emit(outcome, extra);
      return { ok: false, permission: extra.permission || 'none', requested: Boolean(extra.requested), outcome, code, message: NO_ACCESS_MESSAGE };
    };
    let manager;
    try { manager = await createDirectoryHandleManager({ indexedDB }); }
    catch (error) { return fail('ERROR', 'DIRECTORY_MANAGER_UNAVAILABLE', { error: String(error?.message || error) }); }
    try {
      const result = await manager.ensurePermission(id, { ask });
      if (result.permission === 'granted') {
        await emit(result.requested ? 'GRANTED_AFTER_REQUEST' : 'ALREADY_GRANTED', { permission: 'granted', requested: result.requested });
        return { ok: true, permission: 'granted', requested: result.requested, outcome: result.requested ? 'GRANTED_AFTER_REQUEST' : 'ALREADY_GRANTED' };
      }
      return fail(result.permission === 'error' ? 'ERROR' : 'DENIED', 'DIRECTORY_PERMISSION_REQUIRED',
        { permission: result.permission, requested: result.requested, error: result.error });
    } catch (error) {
      const code = String(error?.message || error);
      return fail(code === 'DIRECTORY_HANDLE_NOT_FOUND' ? 'NOT_CONFIGURED' : 'ERROR', code, { error: code });
    } finally { try { manager.close(); } catch (_) {} }
  }
  const api = Object.freeze({ createDirectoryHandleManager, restoreBackupDirectoryAccess, NO_ACCESS_MESSAGE });
  root.TheCycleDirectoryHandleManager = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
