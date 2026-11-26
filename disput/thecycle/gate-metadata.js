// TheCycle: durable metadata adapter backed by a dedicated IndexedDB store.
// A single readwrite transaction enforces revision compare-and-set across MV3
// worker restarts and multiple extension contexts.
(function initTheCycleGateMetadata(root) {
  'use strict';
  const DB_VERSION = 1;
  const STORE = 'backup-gate';
  function request(req) {
    return new Promise((resolve, reject) => {
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error || new Error('BACKUP_METADATA_REQUEST_FAILED'));
    });
  }
  async function createGateMetadata({ indexedDB = root.indexedDB,
    databaseName = 'auto-orchestr-thecycle-backup-metadata' } = {}) {
    if (!indexedDB || typeof indexedDB.open !== 'function') throw new TypeError('INDEXEDDB_UNAVAILABLE');
    const db = await new Promise((resolve, reject) => {
      const req = indexedDB.open(databaseName, DB_VERSION);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(STORE)) {
          req.result.createObjectStore(STORE, { keyPath: 'researchId' });
        }
      };
      req.onerror = () => reject(req.error || new Error('BACKUP_METADATA_OPEN_FAILED'));
      req.onblocked = () => reject(new Error('BACKUP_METADATA_UPGRADE_BLOCKED'));
      req.onsuccess = () => resolve(req.result);
    });
    db.onversionchange = () => db.close();
    function transaction(mode, fn) {
      return new Promise((resolve, reject) => {
        let settled = false;
        const tx = db.transaction(STORE, mode);
        const store = tx.objectStore(STORE);
        let output;
        tx.oncomplete = () => { settled = true; resolve(output); };
        tx.onabort = () => { if (!settled) reject(tx.error || new Error('BACKUP_METADATA_ABORTED')); };
        tx.onerror = () => {};
        try { fn(store, (value) => { output = value; }, (error) => {
          try { tx.abort(); } catch (_) {}
          if (!settled) { settled = true; reject(error); }
        }); } catch (error) {
          try { tx.abort(); } catch (_) {}
          settled = true; reject(error);
        }
      });
    }
    function get(researchId) {
      return transaction('readonly', (store, done, fail) => {
        const req = store.get(researchId);
        req.onsuccess = () => done(req.result || null);
        req.onerror = () => fail(req.error);
      });
    }
    function put(researchId, expectedRevision, value) {
      if (!value || value.researchId !== researchId ||
          value.revision !== expectedRevision + 1) throw new TypeError('INVALID_GATE_REVISION');
      return transaction('readwrite', (store, done, fail) => {
        const req = store.get(researchId);
        req.onerror = () => fail(req.error);
        req.onsuccess = () => {
          if ((req.result?.revision ?? 0) !== expectedRevision) {
            done(false);
            return;
          }
          const write = store.put(value);
          write.onerror = () => fail(write.error);
          write.onsuccess = () => done(true);
        };
      });
    }
    return Object.freeze({ get, put, close: () => db.close() });
  }
  const api = Object.freeze({ createGateMetadata });
  root.TheCycleGateMetadata = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
