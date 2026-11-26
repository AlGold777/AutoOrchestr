// TheCycle C03: deterministic outer controller over C01/C02.
// One bounded transition per tick; scheduling and real browser transport are C04.
// Fixed pipeline only. No LLM policy, no automatic replay of uncertain dispatch.
(function initTheCycleController(root) {
  'use strict';

  const str = (v) => typeof v === 'string' && v.trim().length > 0;
  const pos = (v) => Number.isSafeInteger(v) && v > 0;
  class ControllerError extends Error {
    constructor(code, message) {
      super(message || code);
      this.name = 'TheCycleControllerError';
      this.code = code;
    }
  }
  const fail = (code, message) => new ControllerError(code, message);

  // A completed pipeline is not a mathematical solution. Until the verification
  // module exists, continue only from a complete technical result; otherwise pause.
  function fixedPolicy({ state, packet, report }) {
    if (state.stopRequested) return { action: 'PAUSE', reason: 'OWNER_STOP' };
    if (state.budget.usedCalls >= state.budget.maxCalls) return { action: 'PAUSE', reason: 'BUDGET_EXHAUSTED' };
    if (!packet || packet.status !== 'RECORDED_RESULT' ||
        report?.status !== 'PIPELINE_COMPLETE' ||
        !pos(packet.usedCalls) ||
        (report.unresolvedBatchIds || []).length) {
      return { action: 'PAUSE', reason: 'PARTIAL_OR_UNCERTAIN' };
    }
    return { action: 'CONTINUE', reason: 'FIXED_PIPELINE' };
  }

  function createController({ store, makeAdapter, loadPipeline, maxCallsPerCycle, maxPromptChars,
    ownerId = root.crypto?.randomUUID?.(), backupGate = null } = {}) {
    if (!store || !['load', 'acquire', 'release', 'prepareRun', 'journalFor', 'getRun', 'getEvents',
      'getPacket', 'commitPacket', 'acknowledgePacketBackup', 'decide', 'requestStop', 'getOwnership'].every((key) => typeof store[key] === 'function') ||
      typeof makeAdapter !== 'function' || typeof loadPipeline !== 'function' ||
      !str(ownerId) || !pos(maxCallsPerCycle) || !pos(maxPromptChars) ||
      (backupGate && !['assertCanStartCycle', 'requireCommit', 'persist'].every((key) => typeof backupGate[key] === 'function'))) {
      throw fail('INVALID_CONTROLLER_DEPENDENCIES');
    }
    // ownerId must be unique per live controller instance, not shared across tabs.
    let busy = false;
    let live = null;
    let token = null;
    const safeState = (researchId) => store.load(researchId);
    const result = (state, outcome, extra = {}) => ({ state, outcome, ...extra });

    async function owned(researchId, takeoverEpoch = null) {
      if (token && token.researchId !== researchId) throw fail('CONTROLLER_OWNS_OTHER_RESEARCH');
      const next = await store.acquire({ researchId, ownerId, takeoverEpoch });
      token = next;
      return next;
    }

    async function releaseIfSettled(state) {
      if (token && token.researchId === state.researchId && !state.activeRunId &&
          ['PAUSED', 'COMPLETED'].includes(state.phase)) {
        await store.release(token);
        token = null;
      }
    }

    async function ensurePacketBackup(researchId, fence, state) {
      if (!backupGate || state.lastCommittedPacket === null) return state;
      const commitId = researchId + ':cycle:' + state.lastCommittedPacket;
      if (state.backupRequiredCycleId !== null && state.backupRequiredCycleId !== undefined) {
        await backupGate.requireCommit(researchId, commitId);
        await backupGate.persist(researchId, 'cycle');
        state = await store.acknowledgePacketBackup(fence, {
          expectedVersion: state.stateVersion, cycleId: state.lastCommittedPacket
        });
      }
      await backupGate.assertCanStartCycle(researchId, commitId);
      return state;
    }

    // One tick executes at most one Basic pipeline, or one state transition.
    // Scheduler must not call tick recursively or continuously while WAITING.
    async function tick(researchId) {
      if (!str(researchId)) throw fail('INVALID_RESEARCH');
      if (busy) return { outcome: 'BUSY' };
      busy = true;
      try {
        let state = await safeState(researchId);
        if (['PAUSED', 'COMPLETED'].includes(state.phase) &&
            !(backupGate && state.backupRequiredCycleId !== null &&
              state.backupRequiredCycleId !== undefined)) {
          await releaseIfSettled(state);
          return result(state, state.phase);
        }
        const fence = await owned(researchId);
        state = await safeState(researchId);

        // A stopped run may still carry an unacknowledged committed packet.
        // Discharge its durable backup obligation before releasing ownership.
        if (['PAUSED', 'COMPLETED'].includes(state.phase)) {
          try { state = await ensurePacketBackup(researchId, fence, state); }
          catch (error) { return result(state, 'BACKUP_REQUIRED', {
            error: { code: error?.code || 'BACKUP_REQUIRED', message: String(error?.message || error) }
          }); }
          await releaseIfSettled(state);
          return result(state, state.phase);
        }
        if (state.phase === 'RECONCILE') {
          return result(state, 'RECOVERY_REQUIRED', { runId: state.activeRunId });
        }
        // INTENT/RUNNING without a live adapter means interruption. Do not
        // recreate it; explicit takeover/reconciliation is required.
        if (['INTENT', 'RUNNING'].includes(state.phase)) {
          return result(state, 'RECOVERY_REQUIRED', { runId: state.activeRunId });
        }
        if (state.phase === 'COMMIT') {
          const committed = await store.commitPacket(fence, {
            expectedVersion: state.stateVersion, runId: state.activeRunId
          });
          let backedState = committed.state;
          if (backupGate) {
            try { backedState = await ensurePacketBackup(researchId, fence, committed.state); }
            catch (error) {
              return result(committed.state, 'BACKUP_REQUIRED', {
                packet: committed.packet, error: { code: error?.code || 'BACKUP_REQUIRED', message: String(error?.message || error) }
              });
            }
          }
          await releaseIfSettled(backedState);
          return result(backedState, 'PACKET_COMMITTED', { packet: committed.packet });
        }
        if (state.phase === 'EVALUATE') {
          if (backupGate) {
            try { state = await ensurePacketBackup(researchId, fence, state); }
            catch (error) { return result(state, 'BACKUP_REQUIRED', { error: {
              code: error?.code || 'BACKUP_REQUIRED', message: String(error?.message || error)
            } }); }
          }
          const packet = await store.getPacket(researchId, state.lastCommittedPacket);
          const events = packet ? await store.getEvents(researchId, packet.runId) : [];
          const report = events.find((row) => row.eventId === packet?.resultEventId)?.payload?.report;
          const decision = fixedPolicy({ state, packet, report });
          const next = await store.decide(fence, { expectedVersion: state.stateVersion, action: decision.action });
          await releaseIfSettled(next);
          return result(next, 'DECISION', { decision });
        }
        if (state.phase !== 'READY') throw fail('UNKNOWN_PHASE', state.phase);
        if (backupGate) {
          try { state = await ensurePacketBackup(researchId, fence, state);
            if (state.lastCommittedPacket === null) await backupGate.assertCanStartCycle(researchId); }
          catch (error) {
            return result(state, 'BACKUP_REQUIRED', { error: {
              code: error?.code || 'BACKUP_REQUIRED', message: String(error?.message || error)
            } });
          }
        }
        const remaining = state.budget.maxCalls - state.budget.usedCalls;
        if (state.stopRequested || !pos(remaining)) {
          const next = await store.decide(fence, { expectedVersion: state.stateVersion, action: 'PAUSE' });
          await releaseIfSettled(next);
          return result(next, 'PAUSED', { reason: state.stopRequested ? 'OWNER_STOP' : 'BUDGET_EXHAUSTED' });
        }

        // The repository/registry must supply a version-pinned schema. There
        // is no mutation of the fixed plan in C03. Missing schema fails closed.
        const pipeline = await loadPipeline(state.pipelineRef);
        if (!pipeline || pipeline.ref !== state.pipelineRef || !pipeline.schema) {
          const next = await store.decide(fence, { expectedVersion: state.stateVersion, action: 'PAUSE' });
          await releaseIfSettled(next);
          return result(next, 'PAUSED', { reason: 'PIPELINE_UNAVAILABLE' });
        }
        const adapter = makeAdapter({ journal: store.journalFor(fence), fence });
        if (!adapter || typeof adapter.validate !== 'function' || typeof adapter.execute !== 'function' ||
            typeof adapter.cancel !== 'function') throw fail('INVALID_ADAPTER');
        const checked = adapter.validate(pipeline.schema);
        if (!checked.ok) {
          const next = await store.decide(fence, { expectedVersion: state.stateVersion, action: 'PAUSE' });
          await releaseIfSettled(next);
          return result(next, 'PAUSED', { reason: 'INVALID_PIPELINE', errors: checked.errors });
        }
        const cycleId = state.nextCycle;
        const runId = researchId + ':cycle:' + cycleId;
        const maxCalls = Math.min(remaining, maxCallsPerCycle);
        const aborter = new AbortController();
        live = { researchId, runId, adapter, aborter };
        try {
          await store.prepareRun(fence, { expectedVersion: state.stateVersion, runId, cycleId,
            pipelineRef: state.pipelineRef, maxCalls });
          const report = await adapter.execute({ researchId, cycleId, runId, schema: pipeline.schema,
            task: state.task, maxCalls, maxPromptChars, signal: aborter.signal });
          const next = await safeState(researchId);
          // Never use the return value as authority for continuation: the
          // durable journal and packet commit must be observed in later ticks.
          return result(next, next.phase === 'RECONCILE' ? 'RECOVERY_REQUIRED' : 'RUN_RETURNED', { report });
        } catch (error) {
          const next = await safeState(researchId);
          return result(next, next.activeRunId ? 'RECOVERY_REQUIRED' : 'RUN_REJECTED',
            { error: { code: error?.code || 'RUN_ERROR', message: String(error?.message || error) } });
        } finally {
          live = null;
        }
      } finally {
        busy = false;
      }
    }

    // Stop is durable, then best-effort abort of the in-process transport.
    // A late response is journaled; it does not authorize a new cycle.
    async function stop(researchId) {
      const state = await store.requestStop(researchId);
      if (live?.researchId === researchId) {
        live.aborter.abort();
        live.adapter.cancel(live.runId);
      }
      if (!busy) await releaseIfSettled(state);
      return result(state, 'STOP_REQUESTED');
    }

    // Recovery takeover is explicit. It fences the former writer, never
    // resends a request. A new controller with a distinct ownerId is required
    // to take over a crashed instance. C04 must verify provider quiescence.
    async function takeOver(researchId, previousEpoch) {
      if (busy || !pos(previousEpoch)) throw fail('TAKEOVER_NOT_ALLOWED');
      busy = true;
      try {
        await owned(researchId, previousEpoch);
        return result(await safeState(researchId), 'OWNERSHIP_ACQUIRED');
      } finally { busy = false; }
    }

    async function resume(researchId) {
      if (busy) return { outcome: 'BUSY' };
      busy = true;
      try {
        let state = await safeState(researchId);
        if (state.phase !== 'PAUSED' || state.activeRunId) throw fail('RESUME_NOT_ALLOWED');
        if (state.budget.usedCalls >= state.budget.maxCalls) throw fail('BUDGET_EXHAUSTED');
        const fence = await owned(researchId);
        state = await safeState(researchId);
        const next = await store.decide(fence, { expectedVersion: state.stateVersion, action: 'RESUME' });
        return result(next, 'RESUMED');
      } finally { busy = false; }
    }

    // No automatic settlement or invented transport evidence. Explicit
    // verified evidence is passed to the store by the integration layer.
    async function reconcile(researchId, resolution) {
      if (busy) return { outcome: 'BUSY' };
      busy = true;
      try {
        const fence = await owned(researchId);
        const state = await safeState(researchId);
        if (state.phase !== 'RECONCILE' || !state.activeRunId) throw fail('RECONCILIATION_NOT_ALLOWED');
        const args = { ...resolution, runId: state.activeRunId, expectedVersion: state.stateVersion };
        const next = resolution?.batchId ?
          await store.reconcileBatch(fence, args) : await store.settleInterruptedRun(fence, args);
        return result(next, 'RECOVERY_RECORDED');
      } finally { busy = false; }
    }

    return Object.freeze({ tick, stop, resume, takeOver, reconcile, ownerId });
  }

  const api = Object.freeze({ createController, fixedPolicy, ControllerError });
  root.TheCycleController = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
