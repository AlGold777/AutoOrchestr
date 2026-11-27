// TheCycle: restore orchestration with explicit quiescence evidence.
// This API never switches the active database automatically.
(function initTheCycleRecoveryRuntime(root) {
  'use strict';
  async function recover({ directory, stateStore, indexedDB = root.indexedDB,
    backupKey, targetName, envelope, verifyTransportQuiescence } = {}) {
    if (!root.TheCycleDirectorySink || !root.TheCycleBackup ||
        !root.TheCycleRestore || !stateStore ||
        typeof verifyTransportQuiescence !== 'function')
      throw new Error('RECOVERY_DEPENDENCIES_MISSING');
    // Must be based on observed transport state, not merely a user-supplied boolean.
    const evidence = await verifyTransportQuiescence();
    if (!evidence || evidence.quiescent !== true ||
        typeof evidence.source !== 'string' || !evidence.source.trim() ||
        typeof evidence.reference !== 'string' || !evidence.reference.trim())
      throw new Error('RECOVERY_TRANSPORT_NOT_QUIESCENT');
    const sink = root.TheCycleDirectorySink.createDirectorySink({ directory });
    const service = root.TheCycleBackup.createBackupService({ store: stateStore, sink });
    const result = await root.TheCycleRestore.restore({
      backupService: service, stateStore, indexedDB,
      key: backupKey, targetName, envelope, transportQuiescent: true
    });
    return Object.freeze({ ...result, quiescenceEvidence: {
      source: evidence.source, reference: evidence.reference
    }, activeDatabaseUnchanged: true });
  }
  const api = Object.freeze({ recover });
  root.TheCycleRecoveryRuntime = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
