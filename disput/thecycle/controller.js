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

  // One rule "the cycle is technically complete": PIPELINE_COMPLETE, or PARTIAL that ended normally (steps_done) with no
  // unresolved batch where every non-skipped step has at least one accepted answer (a dropped participant does not stop the work).
  function isCycleSettled(report) {
    if (!report || (report.unresolvedBatchIds || []).length) return false;
    if (report.status === 'PIPELINE_COMPLETE') return true;
    if (report.status !== 'PARTIAL' || report.stopReason !== 'steps_done' || !Array.isArray(report.steps)) return false;
    const steps = report.steps.filter((step) => !step?.skipped);
    return steps.length > 0 && steps.every((step) =>
      Object.values(step.outcome || {}).some((v) => v?.ok === true && str(v.text)));
  }

  // A completed pipeline is not a mathematical solution. Until the verification
  // module exists, continue only from a complete technical result; otherwise pause.
  function fixedPolicy({ state, packet, report }) {
    if (state.stopRequested) return { action: 'PAUSE', reason: 'OWNER_STOP' };
    if (state.budget.usedCalls >= state.budget.maxCalls) return { action: 'PAUSE', reason: 'BUDGET_EXHAUSTED' };
    if (!packet || packet.status !== 'RECORDED_RESULT' ||
        !isCycleSettled(report) ||
        !pos(packet.usedCalls)) {
      return { action: 'PAUSE', reason: 'PARTIAL_OR_UNCERTAIN' };
    }
    return { action: 'CONTINUE', reason: 'FIXED_PIPELINE' };
  }

  function createController({ store, makeAdapter, loadPipeline, maxCallsPerCycle, maxPromptChars,
    ownerId = root.crypto?.randomUUID?.(), backupGate = null, resolveTask = null, policy = fixedPolicy } = {}) {
    if (!store || !['load', 'acquire', 'release', 'prepareRun', 'journalFor', 'getRun', 'getEvents',
      'getPacket', 'commitPacket', 'decide', 'requestStop', 'getOwnership'].every((key) => typeof store[key] === 'function') ||
      typeof makeAdapter !== 'function' || typeof loadPipeline !== 'function' ||
      !str(ownerId) || !pos(maxCallsPerCycle) || !pos(maxPromptChars) ||
      (resolveTask !== null && typeof resolveTask !== 'function') || typeof policy !== 'function' ||
      (backupGate && (!['assertCanStartCycle', 'requireCommit', 'persist'].every((key) => typeof backupGate[key] === 'function') || typeof store.acknowledgePacketBackup !== 'function'))) {
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
        try { return await tickBody(researchId); }
        catch (error) {
          // Stop landed between reading the state and writing the transition: the version moved.
          // Nothing was sent at this point, so re-read once; a stopped research pauses instead of throwing.
          if (error?.code !== 'STALE_STATE' || !(await safeState(researchId)).stopRequested) throw error;
          return await tickBody(researchId);
        }
      } finally {
        busy = false;
      }
    }

    async function tickBody(researchId) {
      {
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
          let decision;
          try { decision = await policy({ state, packet, report, store }); }
          catch (error) { decision = { action: 'PAUSE', reason: 'POLICY_ERROR' }; }
          let next;
          try {
            next = await store.decide(fence, { expectedVersion: state.stateVersion, action: decision.action, reason: decision.reason,
              pipelineRef: decision.pipelineRef, detail: decision.detail, finalStatus: decision.finalStatus, verificationRecord: decision.verificationRecord });
          } catch (error) {
            if (!['INVALID_DECISION_DETAIL', 'INVALID_FINAL_STATUS'].includes(error?.code)) throw error;
            decision = { action: 'PAUSE', reason: 'DECISION_RECORD_INVALID' };
            next = await store.decide(fence, { expectedVersion: state.stateVersion, action: 'PAUSE', reason: decision.reason });
          }
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
        // The remaining budget must cover the whole next cycle: pause before any request when it cannot.
        // reserveCalls: calls kept for what must follow this cycle (the analyst after a work cycle).
        const reserve = Number.isSafeInteger(pipeline.reserveCalls) && pipeline.reserveCalls > 0 ? pipeline.reserveCalls : 0;
        if (typeof adapter.estimateCalls === 'function') {
          const need = adapter.estimateCalls(pipeline.schema);
          if (pos(need) && (need > Math.min(remaining, maxCallsPerCycle) || need + reserve > remaining)) {
            const next = await store.decide(fence, { expectedVersion: state.stateVersion, action: 'PAUSE', reason: 'BUDGET_INSUFFICIENT_FOR_CYCLE' });
            await releaseIfSettled(next);
            return result(next, 'PAUSED', { reason: 'BUDGET_INSUFFICIENT_FOR_CYCLE', required: need, remaining });
          }
        }
        // Circle may construct a bounded task from already committed evidence.
        // Classic execution and G1 retain the original task by default.
        let task = state.task;
        if (resolveTask) {
          try {
            task = await resolveTask({ state, store, pipeline });
            if (!str(task) || task.length > maxPromptChars) throw fail('CONTEXT_INVALID');
          } catch (error) {
            const next = await store.decide(fence, { expectedVersion: state.stateVersion, action: 'PAUSE', reason: 'CONTEXT_UNAVAILABLE' });
            await releaseIfSettled(next);
            return result(next, 'PAUSED', { reason: 'CONTEXT_UNAVAILABLE', error: String(error?.message || error) });
          }
        }
        const cycleId = state.nextCycle;
        const runId = researchId + ':cycle:' + cycleId;
        const maxCalls = Math.min(remaining - reserve > 0 ? remaining - reserve : remaining, maxCallsPerCycle);
        const aborter = new AbortController();
        live = { researchId, runId, adapter, aborter };
        try {
          await store.prepareRun(fence, { expectedVersion: state.stateVersion, runId, cycleId,
            pipelineRef: state.pipelineRef, maxCalls });
          const report = await adapter.execute({ researchId, cycleId, runId, schema: pipeline.schema,
            task, maxCalls, maxPromptChars, signal: aborter.signal });
          const next = await safeState(researchId);
          // Never use the return value as authority for continuation: the
          // durable journal and packet commit must be observed in later ticks.
          return result(next, next.phase === 'RECONCILE' ? 'RECOVERY_REQUIRED' : 'RUN_RETURNED', { report });
        } catch (error) {
          const next = await safeState(researchId);
          // Stop moved the state version before prepareRun: nothing was sent, the research is paused.
          if (error?.code === 'STALE_STATE' && next.stopRequested && !next.activeRunId) {
            await releaseIfSettled(next);
            return result(next, 'PAUSED', { reason: 'OWNER_STOP' });
          }
          return result(next, next.activeRunId ? 'RECOVERY_REQUIRED' : 'RUN_REJECTED',
            { error: { code: error?.code || 'RUN_ERROR', message: String(error?.message || error) } });
        } finally {
          live = null;
        }
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

    // Stop and Close are distinct: park keeps an unfinished research resumable.
    async function parkStopped(researchId) {
      if (busy) return { outcome: 'BUSY' };
      busy = true;
      try {
        const state = await safeState(researchId);
        if (typeof store.parkStopped !== 'function' || !state.stopRequested || !state.activeRunId)
          throw fail('PARK_NOT_ALLOWED');
        const fence = await owned(researchId);
        const next = await store.parkStopped(fence, { expectedVersion: state.stateVersion, runId: state.activeRunId });
        return result(next, 'RUN_PARKED', { reason: 'OWNER_STOP_UNRESOLVED', runId: state.activeRunId });
      } finally { busy = false; }
    }

    // Explicit Close whose request is already out: close the research as unresolved (the batch stays UNKNOWN, nothing
    // is resent) and release the transport, so a new research starts without a reload.
    async function closeStopped(researchId, reason = 'OWNER_STOP_UNRESOLVED') {
      if (!str(researchId)) throw fail('INVALID_RESEARCH');
      if (busy) return { outcome: 'BUSY' };
      busy = true;
      try {
        if (typeof store.abandonRun !== 'function') throw fail('CLOSE_NOT_SUPPORTED');
        const state = await safeState(researchId);
        if (!state.stopRequested || !state.activeRunId || !['RECONCILE', 'RUNNING', 'INTENT'].includes(state.phase)) {
          throw fail('CLOSE_NOT_ALLOWED');
        }
        const fence = await owned(researchId);
        const next = await store.abandonRun(fence, { expectedVersion: state.stateVersion, runId: state.activeRunId, reason });
        await releaseIfSettled(next);
        return result(next, 'RUN_CLOSED', { reason, runId: state.activeRunId });
      } finally { busy = false; }
    }

    // Frees the transport ownership of a settled research (no active run, nothing left to back up) using the
    // same release as the ticks; never frees a run that needs recovery.
    async function releaseSettled(researchId) {
      if (busy || !token || token.researchId !== researchId) return false;
      const state = await safeState(researchId);
      if (state.backupRequiredCycleId !== null && state.backupRequiredCycleId !== undefined) return false;
      await releaseIfSettled(state);
      return token === null;
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

    async function resume(researchId, { maxCalls, pipelineRef, reopenLegacy = false, configuration } = {}) {
      if (busy) return { outcome: 'BUSY' };
      busy = true;
      try {
        let state = await safeState(researchId);
        const legacy = reopenLegacy === true && state.phase === 'COMPLETED' && state.closedReason === 'OWNER_STOP_UNRESOLVED' && state.finalStatus == null;
        if ((state.phase !== 'PAUSED' && !legacy) || state.activeRunId) throw fail('RESUME_NOT_ALLOWED');
        if (maxCalls !== undefined && (!pos(maxCalls) || maxCalls < state.budget.maxCalls || maxCalls > 10000)) throw fail('INVALID_BUDGET');
        if (!legacy && !state.parkedRunId && state.budget.usedCalls >= (maxCalls ?? state.budget.maxCalls)) throw fail('BUDGET_EXHAUSTED');
        const fence = await owned(researchId);
        state = await safeState(researchId);
        const next = await store.decide(fence, { expectedVersion: state.stateVersion, action: 'RESUME', maxCalls, pipelineRef, reopenLegacy, configuration });
        return result(next, 'RESUMED');
      } finally { busy = false; }
    }

    async function claimRecovery(researchId) {
      if (busy) throw fail('RECOVERY_BUSY');
      busy = true;
      try {
        const state = await safeState(researchId);
        if (state.phase !== 'RECONCILE' || !state.activeRunId) throw fail('RECOVERY_NOT_ALLOWED');
        await owned(researchId);
        return result(await safeState(researchId), 'OWNERSHIP_ACQUIRED');
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

    // Human decision "continue without the batch": the unknown dispatch is abandoned (never resent) and the run commits as a partial packet.
    async function abandonUnknown(researchId, reason = 'UNKNOWN_ABANDONED_BY_OWNER') {
      if (busy) return { outcome: 'BUSY' };
      busy = true;
      try {
        if (typeof store.abandonUnknown !== 'function') throw fail('ABANDON_NOT_SUPPORTED');
        const state = await safeState(researchId);
        if (state.phase !== 'RECONCILE' || !state.activeRunId) throw fail('ABANDON_NOT_ALLOWED');
        const fence = await owned(researchId);
        const next = await store.abandonUnknown(fence, { expectedVersion: state.stateVersion, runId: state.activeRunId, reason });
        return result(next, 'UNKNOWN_ABANDONED', { reason, runId: state.activeRunId });
      } finally { busy = false; }
    }

    return Object.freeze({ tick, stop, resume, takeOver, reconcile, abandonUnknown, parkStopped, closeStopped, claimRecovery, releaseSettled, ownerId });
  }

  const api = Object.freeze({ createController, fixedPolicy, isCycleSettled, ControllerError });
  root.TheCycleController = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
