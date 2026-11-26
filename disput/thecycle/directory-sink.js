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
    const SUFFIX = '.thecycle.json';
    // Only this sink's own files: key + lastModified. Never touches other files of the directory.
    async function list() {
      await requirePermission();
      const iterate = typeof directory.entries === 'function' ? directory.entries() : null;
      if (!iterate) throw new Error('BACKUP_DIRECTORY_LISTING_UNAVAILABLE');
      const rows = [];
      for await (const [name, handle] of iterate) {
        if (typeof name !== 'string' || !name.endsWith(SUFFIX) || handle?.kind === 'directory') continue;
        const key = name.slice(0, -SUFFIX.length);
        if (!safeKey(key)) continue;
        try { rows.push({ key, lastModified: (await handle.getFile()).lastModified }); }
        catch (_) { /* a vanished file is not listed */ }
      }
      return rows;
    }
    async function remove(key) {
      const name = filename(key);
      await requirePermission();
      if (typeof directory.removeEntry !== 'function') throw new Error('BACKUP_DIRECTORY_REMOVE_UNAVAILABLE');
      try { await directory.removeEntry(name); return true; }
      catch (error) { if (error?.name === 'NotFoundError') return false; throw error; }
    }
    return Object.freeze({ put, get, list, remove });
  }
  const api = Object.freeze({ createDirectorySink });
  root.TheCycleDirectorySink = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
