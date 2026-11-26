// TheCycle C02: explicit, independently persisted backup envelopes.
// A caller supplies a durable sink. A successful return means the sink
// acknowledged the write and readback matched; it is not an off-device claim.
(function initTheCycleBackup(root) {
  'use strict';
  class BackupError extends Error {
    constructor(code) { super(code); this.name = 'TheCycleBackupError'; this.code = code; }
  }
  const fail = (code) => new BackupError(code);
  const str = (v) => typeof v === 'string' && v.trim().length > 0;

  function createBackupService({ store, sink } = {}) {
    if (!store || typeof store.exportVerifiedBackup !== 'function' ||
        typeof store.verifyBackup !== 'function' || !sink ||
        typeof sink.put !== 'function' || typeof sink.get !== 'function') {
      throw fail('INVALID_BACKUP_DEPENDENCIES');
    }
    let busy = false;
    async function save(key) {
      if (!str(key)) throw fail('INVALID_BACKUP_KEY');
      if (busy) throw fail('BACKUP_BUSY');
      busy = true;
      try {
        const envelope = await store.exportVerifiedBackup();
        await sink.put(key, envelope);
        const persisted = await sink.get(key);
        if (!persisted || persisted.payload !== envelope.payload ||
            persisted.sha256 !== envelope.sha256 ||
            persisted.format !== envelope.format ||
            persisted.version !== envelope.version ||
            persisted.algorithm !== envelope.algorithm) throw fail('BACKUP_READBACK_MISMATCH');
        await store.verifyBackup(persisted);
        return { key, sha256: envelope.sha256, verified: true };
      } finally { busy = false; }
    }
    async function inspect(key) {
      if (!str(key)) throw fail('INVALID_BACKUP_KEY');
      const envelope = await sink.get(key);
      if (!envelope) throw fail('BACKUP_NOT_FOUND');
      const snapshot = await store.verifyBackup(envelope);
      return { key, sha256: envelope.sha256,
        counts: Object.fromEntries(Object.entries(snapshot.stores).map(([name, rows]) => [name, rows.length])) };
    }
    // Backup export is explicit: caller decides where the bytes are stored.
    // Import remains disabled until a verified quiescent transport and a
    // separate empty-target restore transaction are implemented.
    async function getVerifiedEnvelope(key) {
      if (!str(key)) throw fail('INVALID_BACKUP_KEY');
      const envelope = await sink.get(key);
      if (!envelope) throw fail('BACKUP_NOT_FOUND');
      await store.verifyBackup(envelope);
      return JSON.parse(JSON.stringify(envelope));
    }

    // No automatic restore: only a fresh, empty database may be populated,
    // after checking every record, ownership fence and transport quiescence.
    return Object.freeze({ save, inspect, getVerifiedEnvelope });
  }
  const api = Object.freeze({ createBackupService, BackupError });
  root.TheCycleBackup = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
