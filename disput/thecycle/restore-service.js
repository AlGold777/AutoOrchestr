// TheCycle: verified, fail-closed restore into a NEW IndexedDB database.
(function initTheCycleRestore(root) {
  'use strict';
  const STORES = {
    research: 'researchId', control: 'key',
    runs: ['researchId', 'runId'],
    events: ['researchId', 'runId', 'eventId'],
    packets: ['researchId', 'cycleId']
  };
  const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
  const validString = x => typeof x === 'string' && x.trim().length > 0;
  function validate(snapshot) {
    if (snapshot?.format !== 'thecycle-idb-snapshot' || snapshot.version !== 1 ||
        snapshot.databaseVersion !== 1 || !snapshot.stores ||
        Object.keys(snapshot.stores).sort().join('|') !== Object.keys(STORES).sort().join('|'))
      throw new Error('RESTORE_SCHEMA_INVALID');
    for (const [name, keyPath] of Object.entries(STORES)) {
      const rows = snapshot.stores[name];
      if (!Array.isArray(rows)) throw new Error('RESTORE_ROWS_INVALID');
      const seen = new Set();
      for (const row of rows) {
        if (!row || typeof row !== 'object' || Array.isArray(row)) throw new Error('RESTORE_ROW_INVALID');
        const keys = Array.isArray(keyPath) ? keyPath : [keyPath];
        const values = keys.map(k => own(row, k) ? row[k] : undefined);
        if (values.some(v => !(validString(v) || (Number.isSafeInteger(v) && v >= 0))))
          throw new Error('RESTORE_KEY_INVALID');
        const id = JSON.stringify(values);
        if (seen.has(id)) throw new Error('RESTORE_DUPLICATE_KEY');
        seen.add(id);
      }
    }
    const researchIds = new Set(snapshot.stores.research.map(r => r.researchId));
    if (snapshot.stores.research.some(r => !validString(r.researchId) || !Number.isSafeInteger(r.stateVersion) || r.stateVersion < 0 ||
        !['READY','INTENT','RUNNING','RECONCILE','COMMIT','EVALUATE','PAUSED','COMPLETED'].includes(r.phase)))
      throw new Error('RESTORE_RESEARCH_INVALID');
    for (const name of ['runs','events','packets'])
      if (snapshot.stores[name].some(r => !researchIds.has(r.researchId)))
        throw new Error('RESTORE_ORPHAN_ROW');
    if (snapshot.stores.control.some(r => r.key !== 'transport'))
      throw new Error('RESTORE_CONTROL_INVALID');
    return snapshot;
  }
  function open(factory, name) {
    return new Promise((resolve, reject) => {
      const req = factory.open(name, 1);
      let created = false;
      req.onupgradeneeded = (event) => {
        created = event.oldVersion === 0;
        if (!created) return;
        for (const [store, keyPath] of Object.entries(STORES))
          req.result.createObjectStore(store, { keyPath });
      };
      req.onerror = () => reject(req.error || new Error('RESTORE_OPEN_FAILED'));
      req.onblocked = () => reject(new Error('RESTORE_OPEN_BLOCKED'));
      req.onsuccess = () => {
        if (!created) { req.result.close(); reject(new Error('RESTORE_TARGET_NOT_NEW')); }
        else resolve(req.result);
      };
    });
  }
  async function restore({ backupService, stateStore, indexedDB = root.indexedDB,
    key, targetName, envelope: given, transportQuiescent = false } = {}) {
    if (!backupService || typeof backupService.getVerifiedEnvelope !== 'function' ||
        !stateStore || typeof stateStore.verifyBackup !== 'function' ||
        !indexedDB || !validString(key) || !validString(targetName) ||
        !/^auto-orchestr-thecycle-restore-[a-zA-Z0-9_-]{8,}$/.test(targetName) ||
        transportQuiescent !== true) throw new Error('RESTORE_PRECONDITION_FAILED');
    // A caller that already verified the copy passes the very envelope it checked: the file is not read a second time.
    const envelope = given ? JSON.parse(JSON.stringify(given)) : await backupService.getVerifiedEnvelope(key);
    const snapshot = validate(await stateStore.verifyBackup(envelope));
    const restored = structuredClone(snapshot);
    for (const state of restored.stores.research) {
      if (state.activeRunId || ['INTENT','RUNNING','RECONCILE','COMMIT'].includes(state.phase))
        state.phase = 'RECONCILE';
      else if (state.phase !== 'COMPLETED') state.phase = 'PAUSED';
      state.stopRequested = true;
      state.stateVersion += 1;
    }
    restored.stores.control = restored.stores.control.map(r => ({ ...r, ownerId: null, researchId: null }));
    const db = await open(indexedDB, targetName);
    try {
      await new Promise((resolve, reject) => {
        const tx = db.transaction(Object.keys(STORES), 'readwrite');
        tx.oncomplete = resolve;
        tx.onabort = () => reject(tx.error || new Error('RESTORE_TRANSACTION_ABORTED'));
        tx.onerror = () => {};
        try {
          for (const [name, rows] of Object.entries(restored.stores))
            for (const row of rows) tx.objectStore(name).add(row);
        } catch (error) { try { tx.abort(); } catch (_) {} reject(error); }
      });
      // Read back all stores before declaring success.
      const readback = await new Promise((resolve, reject) => {
        const tx = db.transaction(Object.keys(STORES), 'readonly');
        const result = {};
        tx.oncomplete = () => resolve(result);
        tx.onabort = () => reject(tx.error || new Error('RESTORE_READBACK_ABORTED'));
        for (const name of Object.keys(STORES)) {
          const req = tx.objectStore(name).getAll();
          req.onsuccess = () => { result[name] = req.result; };
          req.onerror = () => { try { tx.abort(); } catch (_) {} };
        }
      });
      for (const name of Object.keys(STORES)) {
        if (readback[name].length !== restored.stores[name].length ||
            !restored.stores[name].every(row => readback[name].some(item =>
              JSON.stringify(item) === JSON.stringify(row))))
          throw new Error('RESTORE_READBACK_MISMATCH');
      }
    } catch (error) {
      db.close();
      let cleanupFailure = null;
      try {
        await new Promise((resolve, reject) => {
          const req = indexedDB.deleteDatabase(targetName);
          req.onsuccess = resolve;
          req.onerror = () => reject(req.error || new Error('RESTORE_CLEANUP_FAILED'));
          req.onblocked = () => reject(new Error('RESTORE_CLEANUP_BLOCKED'));
        });
      } catch (cleanupError) { cleanupFailure = cleanupError; }
      if (cleanupFailure) {
        const combined = new Error('RESTORE_FAILED_CLEANUP_UNCONFIRMED');
        combined.cause = error;
        combined.cleanupError = cleanupFailure;
        throw combined;
      }
      throw error;
    } finally { db.close(); }
    return { targetName, researchCount: restored.stores.research.length,
      status: 'RESTORED_PAUSED', requiresManualReconciliation: restored.stores.research.some(r => r.phase === 'RECONCILE') };
  }
  const api = Object.freeze({ restore, validate });
  root.TheCycleRestore = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
