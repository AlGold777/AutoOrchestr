// Documents folder: a copy of an approved document (the answer of a Basic run) is written into a folder on disk
// that the User chooses (File System Access). The main store of a run stays the record of the run (disput/custom-run-record.js);
// this copy is only for reading and sharing outside the extension.
// Layout: <folder>/<pipeline>/<start time of the run>/<document name>.md (or .json for a form).
// The folder handle is kept in IndexedDB. Without access, a write returns { ok: false, reason } and does not throw.
(function initDocumentsFolder(root) {
  'use strict';

  const DB_NAME = 'AutoOrchestrDocumentsFolder';
  const DB_VERSION = 1;
  const STORE = 'handles';
  const KEY = 'documents';
  const NAME_LIMIT = 80;

  const pad = (n) => String(n).padStart(2, '0');

  // A name that is safe for a file or a folder in Windows and macOS.
  const sanitizeName = (value) => {
    const cleaned = String(value == null ? '' : value)
      .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_')
      .replace(/\s+/g, ' ')
      .replace(/^[\s.]+|[\s.]+$/g, '')
      .slice(0, NAME_LIMIT)
      .replace(/[\s.]+$/g, '');
    return cleaned || 'document';
  };

  // The start time of a run as a folder name: local time, YYYY-MM-DD_HH-mm-ss.
  const stamp = (ms) => {
    const d = new Date(ms);
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`;
  };

  // The path of a copy inside the folder: the folders to create, then the file name.
  const relativePath = ({ pipeline, startedAt, name, kind }) => ({
    dirs: [sanitizeName(pipeline), stamp(startedAt)],
    file: `${sanitizeName(name)}${kind === 'form' ? '.json' : '.md'}`
  });

  const isAbort = (error) => error?.name === 'AbortError';

  // The folder handle is kept in the store (get() gives a handle or null, set(handle) keeps it).
  function create({ store, picker }) {
    const folderName = async () => {
      const handle = await store.get();
      return handle ? String(handle.name || '') : '';
    };

    // Returns the name of the chosen folder, or null when the User cancels the choice.
    const pick = async () => {
      let handle;
      try {
        handle = await picker();
      } catch (error) {
        if (isAbort(error)) return null;
        throw error;
      }
      await store.set(handle);
      return String(handle.name || '');
    };

    // 'none' without a folder; 'granted' when writing is allowed; otherwise 'denied'.
    // A request for access (a click of the User) is made only when request is true and the permission is still a prompt.
    const ensureAccess = async ({ request = false } = {}) => {
      const handle = await store.get();
      if (!handle) return 'none';
      const current = await handle.queryPermission({ mode: 'readwrite' });
      if (current === 'granted') return 'granted';
      if (!request || current !== 'prompt') return 'denied';
      const answer = await handle.requestPermission({ mode: 'readwrite' });
      return answer === 'granted' ? 'granted' : 'denied';
    };

    const write = async ({ pipeline, startedAt, name, kind, text }) => {
      const handle = await store.get();
      if (!handle) return { ok: false, reason: 'none' };
      if ((await ensureAccess({ request: false })) !== 'granted') return { ok: false, reason: 'denied' };
      try {
        const { dirs, file } = relativePath({ pipeline, startedAt, name, kind });
        let dir = handle;
        for (const part of dirs) dir = await dir.getDirectoryHandle(part, { create: true });
        const fileHandle = await dir.getFileHandle(file, { create: true });
        const writable = await fileHandle.createWritable();
        await writable.write(String(text == null ? '' : text));
        await writable.close();
        return { ok: true, path: [...dirs, file].join('/') };
      } catch (error) {
        return { ok: false, reason: 'error', message: String(error?.message || error) };
      }
    };

    return { folderName, pick, ensureAccess, write };
  }

  // The store in IndexedDB opens the base only on the first call, so creating it is safe without indexedDB.
  let dbPromise = null;
  const openDb = () => {
    if (!dbPromise) {
      dbPromise = new Promise((resolve, reject) => {
        const idb = root.indexedDB;
        if (!idb) { reject(new Error('indexedDB недоступен')); return; }
        const request = idb.open(DB_NAME, DB_VERSION);
        request.onupgradeneeded = () => {
          const db = request.result;
          if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      dbPromise.catch(() => { dbPromise = null; });
    }
    return dbPromise;
  };
  const runRequest = (mode, action) => openDb().then((db) => new Promise((resolve, reject) => {
    const request = action(db.transaction(STORE, mode).objectStore(STORE));
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  }));
  const indexedDbStore = {
    get: () => runRequest('readonly', (os) => os.get(KEY)).then((value) => value || null).catch(() => null),
    set: (handle) => runRequest('readwrite', (os) => os.put(handle, KEY)).then(() => undefined)
  };

  const defaultPicker = () => {
    if (typeof root.showDirectoryPicker !== 'function') throw new Error('showDirectoryPicker недоступен');
    return root.showDirectoryPicker({ mode: 'readwrite', id: 'basicDocuments' });
  };

  const instance = create({ store: indexedDbStore, picker: defaultPicker });
  const api = Object.freeze({ sanitizeName, stamp, relativePath, create, instance });
  root.DocumentsFolder = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
