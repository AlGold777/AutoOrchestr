// Automation Lab — authoritative persistence (runtime/storage-contract.json: IndexedDB).
// One StateCommit = one readwrite transaction over every touched store. The memory backend has the
// same all-or-nothing semantics (copy-on-write) and is used by jest and the offline simulator.
(function initAlStore(root) {
  'use strict';

  const DB_NAME = 'automationLab.v1';
  const DB_VERSION = 1;
  const STORES = Object.freeze({
    projects: 'project_id',
    registry: ['project_id', 'object_id', 'version'],
    events: ['project_id', 'seq'],
    execs: 'exec_id',
    calls: 'call_id',
    snapshots: 'snapshot_id',
    messages: ['project_id', 'source_message_id']
  });
  const STORE_NAMES = Object.freeze(Object.keys(STORES));

  const keyOf = (storeName, value) => {
    const path = STORES[storeName];
    if (!path) throw new Error(`STORE_UNKNOWN ${storeName}`);
    return Array.isArray(path) ? JSON.stringify(path.map((field) => value[field])) : String(value[path]);
  };
  const normalizeKey = (storeName, key) => (Array.isArray(STORES[storeName]) ? JSON.stringify(key) : String(key));
  const clone = (value) => (value === undefined ? undefined : JSON.parse(JSON.stringify(value)));

  function createMemoryStore() {
    let data = Object.fromEntries(STORE_NAMES.map((name) => [name, new Map()]));
    let queue = Promise.resolve();

    const transaction = (names, mode, work) => {
      const run = async () => {
        const staged = Object.fromEntries(STORE_NAMES.map((name) => [name, new Map(data[name])]));
        const tx = {
          async get(storeName, key) { return clone(staged[storeName].get(normalizeKey(storeName, key))); },
          async put(storeName, value) {
            if (mode !== 'readwrite') throw new Error('READONLY_TRANSACTION');
            staged[storeName].set(keyOf(storeName, value), clone(value));
          },
          async delete(storeName, key) {
            if (mode !== 'readwrite') throw new Error('READONLY_TRANSACTION');
            staged[storeName].delete(normalizeKey(storeName, key));
          },
          async byProject(storeName, projectId) {
            return [...staged[storeName].values()].filter((value) => value.project_id === projectId).map(clone);
          },
          async all(storeName) { return [...staged[storeName].values()].map(clone); }
        };
        const result = await work(tx);
        if (mode === 'readwrite') data = staged;
        return result;
      };
      const next = queue.then(run, run);
      queue = next.catch(() => {});
      return next;
    };
    return Object.freeze({ kind: 'memory', transaction, close() {} });
  }

  function promisify(request) {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async function createIdbStore({ indexedDB = root.indexedDB, name = DB_NAME } = {}) {
    if (!indexedDB) throw new Error('INDEXEDDB_UNAVAILABLE');
    const openRequest = indexedDB.open(name, DB_VERSION);
    openRequest.onupgradeneeded = () => {
      const db = openRequest.result;
      STORE_NAMES.forEach((storeName) => {
        if (db.objectStoreNames.contains(storeName)) return;
        const store = db.createObjectStore(storeName, { keyPath: STORES[storeName] });
        store.createIndex('project_id', 'project_id', { unique: false });
      });
    };
    const db = await promisify(openRequest);

    const transaction = (names, mode, work) => new Promise((resolve, reject) => {
      const scope = names === '*' ? STORE_NAMES : names;
      const idbTx = db.transaction(scope, mode);
      let result;
      let failed = null;
      const tx = {
        get: (storeName, key) => promisify(idbTx.objectStore(storeName).get(key)),
        put: (storeName, value) => promisify(idbTx.objectStore(storeName).put(clone(value))),
        delete: (storeName, key) => promisify(idbTx.objectStore(storeName).delete(key)),
        byProject: (storeName, projectId) => promisify(idbTx.objectStore(storeName).index('project_id').getAll(projectId)),
        all: (storeName) => promisify(idbTx.objectStore(storeName).getAll())
      };
      idbTx.oncomplete = () => (failed ? reject(failed) : resolve(result));
      idbTx.onerror = () => reject(failed || idbTx.error);
      idbTx.onabort = () => reject(failed || idbTx.error || new Error('TRANSACTION_ABORTED'));
      Promise.resolve()
        .then(() => work(tx))
        .then((value) => { result = value; })
        .catch((error) => {
          failed = error;
          try { idbTx.abort(); } catch (_) { reject(error); }
        });
    });
    return Object.freeze({ kind: 'indexeddb', transaction, close: () => db.close() });
  }

  const api = Object.freeze({ STORES, STORE_NAMES, DB_NAME, createMemoryStore, createIdbStore });
  root.AlStore = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
