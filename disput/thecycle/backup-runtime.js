// TheCycle: explicit wiring for directory-backed, readback-verified backups.
// Call only from a document context with an already-authorized directory
// handle. MV3 service workers cannot invoke a directory picker.
(function initTheCycleBackupRuntime(root) {
  'use strict';
  async function createBackupRuntime({ directory, indexedDB = root.indexedDB,
    stateStore, clock = () => Date.now(), onDiagnostic = async () => {} } = {}) {
    const modules = [root.TheCycleGateMetadata, root.TheCycleDirectorySink,
      root.TheCycleBackup, root.TheCycleBackupGate];
    if (modules.some((item) => !item) || !stateStore) {
      throw new Error('THECYCLE_BACKUP_MODULES_MISSING');
    }
    const metadata = await root.TheCycleGateMetadata.createGateMetadata({ indexedDB });
    const sink = root.TheCycleDirectorySink.createDirectorySink({ directory });
    const backupService = root.TheCycleBackup.createBackupService({ store: stateStore, sink });
    // Backup service currently returns only {key,sha256,verified}; do not
    // fabricate proof that a specific packet commit is present. This wrapper
    // verifies the captured snapshot actually contains that packet.
    const note = async (type, data) => { try { await onDiagnostic(type,data); } catch (_) {} };
    const backup = {
      async save(key, { researchId, requiredCommitId } = {}) {
        const saved = await backupService.save(key);
        if (!requiredCommitId) { const result={...saved,packetCommitId:null}; await note('BACKUP_READBACK_VERIFIED',{researchId,backup:result}); return result; }
        const envelope = await backupService.getVerifiedEnvelope(key);
        const snapshot = await stateStore.verifyBackup(envelope);
        const match = /^(.+):cycle:([1-9][0-9]*)$/.exec(requiredCommitId);
        if (!match || match[1] !== researchId ||
            !snapshot.stores.packets.some((p) =>
              p.researchId === researchId && p.cycleId === Number(match[2]))) {
          throw new Error('BACKUP_MISSING_COMMITTED_PACKET');
        }
        const result={...saved,packetCommitId:requiredCommitId};
        await note('BACKUP_READBACK_VERIFIED',{researchId,backup:result});
        return result;
      }
    };
    const gate = root.TheCycleBackupGate.createBackupGate({ metadata, backup, clock });
    return Object.freeze({ gate, metadata, sink, backupService, close: () => metadata.close() });
  }
  const api = Object.freeze({ createBackupRuntime });
  root.TheCycleBackupRuntime = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
