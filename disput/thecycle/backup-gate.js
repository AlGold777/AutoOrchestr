// TheCycle C02: durable post-commit backup gate.
// The caller supplies a transactionally durable metadata repository and a
// readback-verifying backup service. No assumption of persistent MV3 globals.
(function initTheCycleBackupGate(root) {
  'use strict';
  const INTERVAL_MS = 600000;
  const nonempty = (s) => typeof s === 'string' && s.trim().length > 0;
  function createBackupGate({ metadata, backup, clock = () => Date.now() } = {}) {
    if (!metadata || typeof metadata.get !== 'function' ||
        typeof metadata.put !== 'function' ||
        !backup || typeof backup.save !== 'function' ||
        typeof clock !== 'function') throw new TypeError('INVALID_BACKUP_GATE');
    // A process-local mutex is only a convenience. The metadata adapter MUST
    // enforce atomic compare-and-set across worker instances.
    let queue = Promise.resolve();
    function serialized(fn) {
      const operation = queue.then(fn);
      queue = operation.catch(() => {});
      return operation;
    }
    function validate(s) {
      if (!s || !nonempty(s.researchId) ||
          !Number.isSafeInteger(s.revision) || s.revision < 0 ||
          !Array.isArray(s.pendingCommitIds) ||
          !s.pendingCommitIds.every(nonempty) ||
          (s.lastVerifiedAt !== null && (!Number.isSafeInteger(s.lastVerifiedAt) || s.lastVerifiedAt < 0))) {
        throw new Error('INVALID_BACKUP_GATE_STATE');
      }
      return s;
    }
    async function load(researchId) {
      if (!nonempty(researchId)) throw new TypeError('INVALID_RESEARCH_ID');
      const found = await metadata.get(researchId);
      return validate(found || { researchId, revision: 0, pendingCommitIds: [],
        lastVerifiedAt: null, lastBackupId: null, verifiedCommitId: null, blocked: true });
    }
    async function save(before, after) {
      const updated = { ...after, revision: before.revision + 1 };
      const success = await metadata.put(before.researchId, before.revision, updated);
      if (success !== true) throw new Error('BACKUP_GATE_CONFLICT');
      return updated;
    }
    // Must be invoked before a newly committed packet can be scheduled.
    // The caller MUST persist the packet and its backup-required marker
    // atomically in the same IndexedDB transaction for crash safety.
    async function requireCommit(researchId, commitId) {
      if (!nonempty(commitId)) throw new TypeError('INVALID_COMMIT_ID');
      return serialized(async () => {
        const state = await load(researchId);
        if (state.pendingCommitIds.includes(commitId)) return state;
        return save(state, { ...state, blocked: true,
          pendingCommitIds: [...state.pendingCommitIds, commitId] });
      });
    }
    async function assertCanStartCycle(researchId, expectedCommitId = null) {
      const state = await load(researchId);
      if (state.blocked || state.pendingCommitIds.length ||
          (expectedCommitId !== null && state.verifiedCommitId !== expectedCommitId)) {
        throw new Error('BACKUP_REQUIRED');
      }
      if (state.lastVerifiedAt === null || clock() - state.lastVerifiedAt >= INTERVAL_MS) {
        throw new Error('BACKUP_INTERVAL_DUE');
      }
      return true;
    }
    async function persist(researchId, reason) {
      if (!['cycle', 'interval', 'manual'].includes(reason)) throw new TypeError('INVALID_BACKUP_REASON');
      return serialized(async () => {
        const state = await load(researchId);
        const target = state.pendingCommitIds[state.pendingCommitIds.length - 1] || null;
        // Backup service MUST capture a snapshot containing target commit;
        // returning verified:true alone does not prove that association.
        const key = 'thecycle-' + researchId + '-' + clock() + '-' + (state.revision + 1);
        let result;
        try {
          result = await backup.save(key, { researchId, requiredCommitId: target });
          if (!result || result.verified !== true || result.key !== key ||
              (target !== null && result.packetCommitId !== target)) {
            throw new Error('BACKUP_UNVERIFIED');
          }
        } catch (error) {
          if (!state.blocked) await save(state, { ...state, blocked: true });
          throw error;
        }
        return save(state, { ...state, blocked: false, pendingCommitIds: [],
          lastVerifiedAt: clock(), lastBackupId: result.key,
          verifiedCommitId: target || state.verifiedCommitId });
      });
    }
    return Object.freeze({ requireCommit, assertCanStartCycle, persist, load, INTERVAL_MS });
  }
  const api = Object.freeze({ createBackupGate, INTERVAL_MS });
  root.TheCycleBackupGate = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
