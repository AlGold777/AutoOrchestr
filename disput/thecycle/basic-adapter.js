// TheCycle C01: bridge to the finite Basic engine in main.
// This module does not dispatch by itself, persist storage, or schedule cycles.
// All external effects are injected; the caller owns durable state and transport.
(function initTheCycleBasicAdapter(root) {
  'use strict';

  class AdapterError extends Error {
    constructor(code, message, cause) {
      super(message || code);
      this.name = 'TheCycleAdapterError';
      this.code = code;
      if (cause) this.cause = cause;
    }
  }

  const fail = (code, message, cause) => new AdapterError(code, message, cause);
  const clone = (value) => JSON.parse(JSON.stringify(value));
  const positiveInt = (value) => Number.isSafeInteger(value) && value > 0;
  const nonempty = (value) => typeof value === 'string' && value.trim().length > 0;
  const activeModels = (step) => (step.models || []).filter((model) => model.enabled !== false);

  function createBasicAdapter({
    schemaApi = root.BasicSchema || (typeof require === 'function' ? require('../basic-schema') : null),
    engine = root.CustomEngine || (typeof require === 'function' ? require('../custom-engine') : null),
    send, accept, journal, availableModels, isRole, roleText, reconcileTransport = null
  } = {}) {
    if (!schemaApi || !['validate', 'toCanvas', 'assemble', 'resolveRun'].every((key) => typeof schemaApi[key] === 'function') ||
        !engine || typeof engine.run !== 'function') {
      throw fail('BASIC_API_UNAVAILABLE');
    }
    if (![send, accept, journal].every((fn) => typeof fn === 'function')) {
      throw fail('MISSING_DEPENDENCY', 'send, accept and durable journal are mandatory');
    }
    if (!Array.isArray(availableModels) || !availableModels.length || !availableModels.every(nonempty)) {
      throw fail('MISSING_MODELS', 'Explicit available model list is mandatory');
    }
    const modelList = [...new Set(availableModels)];
    const active = new Map();

    // Conservative capabilities for main, not the unmerged PR3.
    const capabilities = Object.freeze({
      finiteBasic: true,
      automaticPolicy: true,
      checkpointBeforeDispatch: true,
      checkpointInsideBasic: false,
      resumeInsideBasic: false,
      independentParticipantChats: false,
      dynamicRoutes: false,
      unknownReconciliation: typeof reconcileTransport === 'function'
    });

    function validate(schema) {
      const errors = schemaApi.validate(schema);
      if (errors.length) return { ok: false, errors };
      const canvas = schemaApi.toCanvas(schema, {
        models: modelList,
        isRole: (role) => typeof isRole === 'function' && typeof roleText === 'function' && isRole(role)
      });
      if (canvas.errors.length) return { ok: false, errors: canvas.errors };
      const reject = (path, message) => errors.push({ path, message });
      const settings = schemaApi.resolveRun(schema);
      if (settings.policy !== 'auto') reject('run.policy', 'C01 supports auto only; manual owner interaction is not wired');
      if (!schema.steps.some((step) => step.kind === 'round' && activeModels(step).length)) {
        reject('steps', 'At least one enabled round is required');
      }
      let roundIndex = 0;
      for (const step of schema.steps) {
        if (step.kind !== 'round') continue;
        const input = step.input || (roundIndex++ === 0 ? 'none' : 'previous');
        // The counter must advance even when input is explicitly set.
        if (step.input) roundIndex += 1;
        // Main's assembler blanks task instructions for input:none. Refuse explicit
        // instructions it cannot preserve; do not silently change Basic semantics.
        if (input === 'none' && activeModels(step).length &&
            (nonempty(step.task) || nonempty(schema.defaults?.roundTask) || activeModels(step).some((model) => nonempty(model.task)))) {
          reject('steps.' + step.ref + '.task', 'Main Basic drops explicit task on input:none; move it to the task/prompt or upgrade Basic');
        }
      }
      return { ok: !errors.length, errors };
    }

    async function execute({ researchId, cycleId, runId, schema, task, maxCalls, maxPromptChars, signal } = {}) {
      if (![researchId, runId, task].every(nonempty) || !positiveInt(cycleId) ||
          !positiveInt(maxCalls) || !positiveInt(maxPromptChars)) {
        throw fail('INVALID_RUN', 'researchId, runId, task, positive cycleId, maxCalls and maxPromptChars are required');
      }
      if (active.size) throw fail('RUN_ALREADY_ACTIVE', 'This adapter permits one active Basic run');
      const schemaCopy = clone(schema);
      const checked = validate(schemaCopy);
      if (!checked.ok) throw fail('INVALID_SCHEMA', schemaApi.describeErrors(checked.errors));
      const settings = schemaApi.resolveRun(schemaCopy);
      const steps = schemaApi.assemble(schemaCopy, { roleText: roleText || (() => '') });
      // Match the shared answer limit when a participant has no own override.
      for (const step of steps) {
        for (const model of step.models) if (model.maxWords == null) model.maxWords = settings.maxWords;
      }
      const aborter = new AbortController();
      const propagateAbort = () => aborter.abort();
      if (signal?.aborted) aborter.abort();
      signal?.addEventListener?.('abort', propagateAbort, { once: true });
      active.set(runId, aborter);
      let batchSeq = 0;
      let reservedCalls = 0;
      let blockedReason = null;
      const unresolved = new Set();
      const identity = { researchId, cycleId, runId };
      const persist = async (event) => {
        try {
          await journal(clone({ ...identity, ...event }));
        } catch (error) {
          aborter.abort();
          blockedReason = 'CHECKPOINT_FAILED';
          throw fail('CHECKPOINT_FAILED', 'Durable journal rejected a write', error);
        }
      };
      const stop = (reason) => {
        blockedReason = blockedReason || reason;
        aborter.abort();
        return fail(reason);
      };

      // Basic main catches ordinary send errors. Abort on an uncertain transport
      // outcome so its retry/next-step logic cannot dispatch a second request.
      async function guardedSend(models, prompts, meta) {
        if (aborter.signal.aborted) throw stop('CANCELLED');
        if (reservedCalls + models.length > maxCalls) throw stop('BUDGET_EXHAUSTED');
        const batchId = runId + ':batch:' + (++batchSeq);
        const request = { batchId, models: [...models], prompts, meta };
        await persist({ type: 'DISPATCH_INTENT', ...request, reservedCalls: reservedCalls + models.length });
        if (aborter.signal.aborted) {
          await persist({ type: 'NOT_SENT', batchId, reason: 'cancelled_before_dispatch' });
          throw stop('CANCELLED');
        }
        reservedCalls += models.length;
        unresolved.add(batchId);
        let response;
        try {
          response = await send(models, prompts, { ...meta, ...identity, batchId, signal: aborter.signal });
          // A missing response cannot prove non-delivery. Preserve the returned
          // evidence, but block automatic continuation if any outcome is unclear.
          const missing = models.filter((name) => {
            const item = response?.byModel?.[name];
            return !item || !nonempty(item.text);
          });
          if (missing.length) {
            await persist({ type: 'DISPATCH_UNKNOWN', batchId, missing, response: response ?? null });
            stop('UNKNOWN_DISPATCH');
          } else {
            await persist({ type: 'DISPATCH_RESPONSE', batchId, response });
            unresolved.delete(batchId);
          }
          return response;
        } catch (error) {
          // Failed journal writes after dispatch must not be disguised as a
          // transport failure or a successful checkpoint.
          if (error?.code === 'CHECKPOINT_FAILED') throw error;
          aborter.abort();
          blockedReason = blockedReason || 'UNKNOWN_DISPATCH';
          await persist({ type: 'DISPATCH_UNKNOWN', batchId, reason: String(error?.message || error) });
          throw fail('UNKNOWN_DISPATCH', 'Transport outcome needs reconciliation', error);
        }
      }

      try {
        if (aborter.signal.aborted) throw fail('CANCELLED');
        await persist({ type: 'RUN_INTENT', schema: schemaCopy, task, maxCalls, maxPromptChars });
        const result = await engine.run({
          task, steps, accept, send: guardedSend, signal: aborter.signal,
          maxAttempts: 1, maxPromptChars, semiAuto: false,
          decide: () => 'stop'
        });
        if (blockedReason === 'CHECKPOINT_FAILED') throw fail('CHECKPOINT_FAILED');
        const allAccepted = result.steps.length === steps.length && result.steps.every((step, index) =>
          !step.skipped && steps[index].models.every((model) => step.outcome?.[model.name]?.ok === true));
        const status = unresolved.size ? 'UNKNOWN' :
          blockedReason === 'BUDGET_EXHAUSTED' ? 'BUDGET_EXHAUSTED' :
          aborter.signal.aborted || result.stopReason === 'cancelled' ? 'CANCELLED' :
          result.stopReason === 'steps_done' && allAccepted ? 'PIPELINE_COMPLETE' : 'PARTIAL';
        const report = clone({
          ...identity, status, stopReason: blockedReason || result.stopReason,
          basicStopReason: result.stopReason, reservedCalls, unresolvedBatchIds: [...unresolved],
          steps: result.steps, history: result.history, answers: result.answers,
          ownerAnswers: result.ownerAnswers
        });
        // A completed Basic run is never a claim of a verified research solution.
        await persist({ type: 'RUN_RESULT', report });
        return report;
      } catch (error) {
        if (error?.code !== 'CHECKPOINT_FAILED' && blockedReason !== 'CHECKPOINT_FAILED') {
          await persist({ type: 'RUN_ERROR', code: error?.code || 'ENGINE_ERROR',
            message: String(error?.message || error), unresolvedBatchIds: [...unresolved], reservedCalls });
        }
        throw error;
      } finally {
        signal?.removeEventListener?.('abort', propagateAbort);
        active.delete(runId);
      }
    }

    // Cancellation is local/best effort: the injected transport must honor signal.
    function cancel(runId) {
      const aborter = active.get(runId);
      if (!aborter) return false;
      aborter.abort();
      return true;
    }

    // Read-only reconciliation hook. It must not send a new model request.
    async function reconcile(request) {
      if (!nonempty(request?.runId) || !nonempty(request?.batchId)) throw fail('INVALID_RECONCILIATION');
      if (typeof reconcileTransport !== 'function') return { status: 'UNKNOWN' };
      const outcome = await reconcileTransport(clone(request));
      return clone(outcome ?? { status: 'UNKNOWN' });
    }

    return Object.freeze({ capabilities, validate, execute, cancel, reconcile });
  }

  const api = Object.freeze({ createBasicAdapter, AdapterError });
  root.TheCycleBasicAdapter = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
