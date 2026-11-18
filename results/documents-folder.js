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

  // The folders of a run: the pipeline name, then the start time of the run.
  const runDirs = ({ pipeline, startedAt }) => [sanitizeName(pipeline), stamp(startedAt)];

  // The path of a copy inside the folder: the folders to create, then the file name.
  const relativePath = ({ pipeline, startedAt, name, kind }) => ({
    dirs: runDirs({ pipeline, startedAt }),
    file: `${sanitizeName(name)}${kind === 'form' ? '.json' : '.md'}`
  });

  // A file name with its extension kept: the base name is cleaned, the extension only loses forbidden characters.
  const fileName = (value) => {
    const text = String(value == null ? '' : value);
    const dot = text.lastIndexOf('.');
    if (dot <= 0) return sanitizeName(text);
    return `${sanitizeName(text.slice(0, dot))}${text.slice(dot).replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_')}`;
  };

  const isAbort = (error) => error?.name === 'AbortError';

  // The folder handle is kept in the store (get() gives a handle or null, set(handle) keeps it).
  function create({ store, picker }) {
    // Which run wrote each file in this page session (path → run id).
    const writtenBy = new Map();
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

    const write = async ({ pipeline, startedAt, name, kind, text, runId = '' }) => {
      const handle = await store.get();
      if (!handle) return { ok: false, reason: 'none' };
      if ((await ensureAccess({ request: false })) !== 'granted') return { ok: false, reason: 'denied' };
      try {
        const { dirs, file } = relativePath({ pipeline, startedAt, name, kind });
        let dir = handle;
        for (const part of dirs) dir = await dir.getDirectoryHandle(part, { create: true });
        // A file of the same name written by another run is kept: the copy gets « (2)», « (3)»… A run's own file (the same
        // run's OK again) and a file this page does not know (after a reload) are overwritten, as before.
        const dot = file.lastIndexOf('.');
        const base = file.slice(0, dot);
        const ext = file.slice(dot);
        let candidate = file;
        for (let index = 2; ; index += 1) {
          const key = [...dirs, candidate].join('/');
          const taken = await dir.getFileHandle(candidate).then(() => true, () => false);
          if (!taken || !writtenBy.has(key) || writtenBy.get(key) === runId) break;
          candidate = `${base} (${index})${ext}`;
        }
        const fileHandle = await dir.getFileHandle(candidate, { create: true });
        const writable = await fileHandle.createWritable();
        await writable.write(String(text == null ? '' : text));
        await writable.close();
        writtenBy.set([...dirs, candidate].join('/'), runId);
        return { ok: true, path: [...dirs, candidate].join('/') };
      } catch (error) {
        return { ok: false, reason: 'error', message: String(error?.message || error) };
      }
    };

    // Reads a file by its path in the folder; creates nothing.
    const readAt = async ({ dirs = [], file }) => {
      try {
        const handle = await store.get();
        if (!handle) return { ok: false, reason: 'none' };
        if ((await ensureAccess({ request: false })) !== 'granted') return { ok: false, reason: 'denied' };
        let dir = handle;
        for (const part of dirs) dir = await dir.getDirectoryHandle(sanitizeName(part));
        const fileHandle = await dir.getFileHandle(fileName(file));
        const text = await (await fileHandle.getFile()).text();
        return { ok: true, text };
      } catch (error) {
        if (error?.name === 'NotFoundError') return { ok: false, reason: 'missing' };
        return { ok: false, reason: 'error', message: String(error?.message || error) };
      }
    };

    // Writes a file by its path, creating the folders; the file is overwritten. Returns the path, never throws.
    const writeAt = async ({ dirs = [], file, text }) => {
      try {
        const handle = await store.get();
        if (!handle) return { ok: false, reason: 'none' };
        if ((await ensureAccess({ request: false })) !== 'granted') return { ok: false, reason: 'denied' };
        const names = dirs.map(sanitizeName);
        const name = fileName(file);
        let dir = handle;
        for (const part of names) dir = await dir.getDirectoryHandle(part, { create: true });
        const fileHandle = await dir.getFileHandle(name, { create: true });
        const writable = await fileHandle.createWritable();
        await writable.write(String(text == null ? '' : text));
        await writable.close();
        return { ok: true, path: [...names, name].join('/') };
      } catch (error) {
        return { ok: false, reason: 'error', message: String(error?.message || error) };
      }
    };

    return { folderName, pick, ensureAccess, write, readAt, writeAt };
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
  const api = Object.freeze({ sanitizeName, stamp, runDirs, relativePath, create, instance });
  root.DocumentsFolder = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
