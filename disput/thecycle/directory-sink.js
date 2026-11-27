// TheCycle: File System Access directory sink for verified backup envelopes.
// Only instantiate in an extension context where showDirectoryPicker is
// available and the user has granted a persistent read/write directory handle.
// Never claim unattended operation across browser shutdown.
(function initTheCycleDirectorySink(root) {
  'use strict';
  const safeKey = (key) => typeof key === 'string' &&
    /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,180}$/.test(key);
  function createDirectorySink({ directory } = {}) {
    if (!directory || typeof directory.getFileHandle !== 'function' ||
        typeof directory.queryPermission !== 'function') {
      throw new TypeError('INVALID_DIRECTORY_HANDLE');
    }
    async function requirePermission() {
      // No permission prompt inside alarms or background automation.
      if (await directory.queryPermission({ mode: 'readwrite' }) !== 'granted') {
        throw new Error('BACKUP_DIRECTORY_PERMISSION_REQUIRED');
      }
    }
    const filename = (key) => {
      if (!safeKey(key)) throw new TypeError('INVALID_BACKUP_KEY');
      return key + '.thecycle.json';
    };
    async function put(key, envelope) {
      const name = filename(key);
      await requirePermission();
      // Fail closed rather than silently overwrite an existing backup.
      try {
        await directory.getFileHandle(name, { create: false });
        throw new Error('BACKUP_ALREADY_EXISTS');
      } catch (error) {
        if (error?.name !== 'NotFoundError') throw error;
      }
      const handle = await directory.getFileHandle(name, { create: true });
      const writer = await handle.createWritable({ keepExistingData: false });
      try {
        await writer.write(JSON.stringify(envelope));
        await writer.close();
      } catch (error) {
        try { await writer.abort(); } catch (_) { /* preserve original */ }
        throw error;
      }
    }
    async function get(key) {
      const name = filename(key);
      await requirePermission();
      let handle;
      try { handle = await directory.getFileHandle(name, { create: false }); }
      catch (error) {
        if (error?.name === 'NotFoundError') return null;
        throw error;
      }
      const file = await handle.getFile();
      try { return JSON.parse(await file.text()); }
      catch (_) { throw new Error('BACKUP_FILE_INVALID_JSON'); }
    }
    return Object.freeze({ put, get });
  }
  const api = Object.freeze({ createDirectorySink });
  root.TheCycleDirectorySink = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
