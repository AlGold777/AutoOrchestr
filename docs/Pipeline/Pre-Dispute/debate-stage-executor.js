// Preset-neutral StageExecutor: executes one prepared StageInstance
// (Roadmap §5.4). No planning decisions, no lifecycle ownership.
(function initDebateStageExecutor(root) {
  'use strict';
  const Participants = root.DebateParticipantRegistry || (typeof require === 'function' ? require('./debate-participant-registry') : null);

  const arr = (value) => Array.isArray(value) ? value : [];
  const text = (value) => String(value == null ? '' : value).trim();

  const DISPATCH_MODES = Object.freeze(['single', 'parallel', 'sequential']);
  const COMPLETION_MODES = Object.freeze(['all', 'quorum', 'first_success']);

  function idempotencyKey(stage, attempt, participantId) {
    return `${stage.runId}:${stage.stageInstanceId}:${attempt}:${participantId}`;
  }

  // Participant adapters: only the response acquisition mechanism differs (Roadmap §5.5).
  function createAdapterRegistry(adapters = {}) {
    const registry = { ...adapters };
    return Object.freeze({
      register(type, adapter) { registry[type] = adapter; },
      get(type) { return registry[type] || null; },
      has(type) { return Boolean(registry[type]); }
    });
  }

  // Human adapter: never resolves inline — the stage stays awaiting_participant and
  // is completed later through Orchestrator.submitParticipantResponse (persisted event).
  function createHumanAdapter() {
    return Object.freeze({
      type: 'human',
      async dispatch() {
        return { status: 'awaiting_participant' };
      }
    });
  }

  function createLlmAdapter(deps = {}) {
    if (typeof deps.runModelBatch !== 'function') throw new Error('LLM adapter requires runModelBatch');
    const outcomeFor = (result, participant, stage, attempt) => {
      const modelId = participant.model || participant.participantId;
      const terminalFailure = Participants?.terminalFailures?.(result, {
        stageId: stage.stageInstanceId,
        attemptId: `${stage.stageInstanceId}:a${attempt}`
      }).find((failure) => failure.modelId === modelId);
      if (terminalFailure) return { status: 'terminal_failure', failure: terminalFailure, raw: result };
      return { status: 'received', text: text(result?.responses?.[modelId]), raw: result };
    };
    return Object.freeze({
      type: 'llm',
      async dispatch({ participant, prompt, stage, attempt, signal, context }) {
        const result = await deps.runModelBatch({
          prompt,
          models: [participant.model || participant.participantId],
          attachments: context?.attachments || [],
          useApiFallback: context?.useApiFallback !== false,
          context: {
            pipelineRunId: stage.runId,
            pipelineStageId: stage.stageInstanceId,
            stageAttemptId: `${stage.stageInstanceId}:a${attempt}`,
            idempotencyKey: idempotencyKey(stage, attempt, participant.participantId)
          },
          signal
        });
        return outcomeFor(result, participant, stage, attempt);
      },
      async dispatchBatch({ participants, promptsByParticipantId, stage, attempt, signal, context }) {
        const models = participants.map((participant) => participant.model || participant.participantId);
        const promptsByModel = Object.fromEntries(participants.map((participant) => [
          participant.model || participant.participantId,
          promptsByParticipantId[participant.participantId]
        ]));
        const result = await deps.runModelBatch({
          prompt: promptsByModel[models[0]], promptsByModel, models,
          attachments: context?.attachments || [], useApiFallback: context?.useApiFallback !== false,
          context: {
            pipelineRunId: stage.runId,
            pipelineStageId: stage.stageInstanceId,
            stageAttemptId: `${stage.stageInstanceId}:a${attempt}`,
            idempotencyKeys: Object.fromEntries(participants.map((participant) => [
              participant.participantId, idempotencyKey(stage, attempt, participant.participantId)
            ]))
          },
          signal
        });
        return Object.fromEntries(participants.map((participant) => [
          participant.participantId, outcomeFor(result, participant, stage, attempt)
        ]));
      }
    });
  }

  function createStageExecutor(deps = {}) {
    const adapters = deps.adapters || createAdapterRegistry();
    const acceptance = deps.acceptResponse || ((responseText) => ({ ok: Boolean(text(responseText)), reason: text(responseText) ? '' : 'empty_response' }));
    const compilePrompt = deps.compilePrompt || (({ stage, participant }) => `${stage.purpose}:${participant.participantId}`);
    const repairPrompt = deps.repairPrompt || null;
    const extractArtifacts = deps.extractArtifacts || (() => []);
    const proposeStateDelta = deps.proposeStateDelta || (() => null);
    const emit = typeof deps.emit === 'function' ? deps.emit : () => {};
    const retryPolicy = deps.retryPolicy || { maxAttempts: 2, delayMs: 0 };
    const sleep = deps.sleep || ((ms) => ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve());
    const timeoutMs = Number(deps.timeoutMs || 0);
    const seenIdempotencyKeys = new Set();

    const withTimeout = (promise, signal) => {
      if (!timeoutMs) return promise;
      return Promise.race([
        promise,
        new Promise((_, reject) => {
          const timer = setTimeout(() => reject(Object.assign(new Error('participant_timeout'), { code: 'TIMEOUT' })), timeoutMs);
          signal?.addEventListener?.('abort', () => clearTimeout(timer));
        })
      ]);
    };

    async function executeParticipant(stage, participant, signal, context, initial = null) {
      const adapter = adapters.get(participant.type || 'llm');
      if (!adapter) {
        return { participantId: participant.participantId, status: 'failed', reason: `adapter_missing:${participant.type}`, attempts: 0 };
      }
      const maxAttempts = Math.max(1, Number(retryPolicy.maxAttempts || 1));
      let lastReason = '';
      for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        if (signal?.aborted) return { participantId: participant.participantId, status: 'cancelled', reason: 'aborted', attempts: attempt - 1 };
        const usesInitialBatchOutcome = attempt === 1 && initial;
        const key = idempotencyKey(stage, attempt, participant.participantId);
        if (!usesInitialBatchOutcome) {
          if (seenIdempotencyKeys.has(key)) {
            return { participantId: participant.participantId, status: 'failed', reason: 'duplicate_dispatch', attempts: attempt - 1 };
          }
          seenIdempotencyKeys.add(key);
          emit('STAGE_DISPATCH_STARTED', { stageInstanceId: stage.stageInstanceId, participantId: participant.participantId, attempt, idempotencyKey: key });
        }
        try {
          const prompt = usesInitialBatchOutcome ? initial.prompt : compilePrompt({ stage, participant, attempt, context });
          const outcome = usesInitialBatchOutcome
            ? initial.outcome
            : await withTimeout(adapter.dispatch({ participant, prompt, stage, attempt, signal, context }), signal);
          if (outcome?.status === 'dispatch_error') throw outcome.error;
          if (outcome?.status === 'awaiting_participant') {
            emit('PARTICIPANT_TASK_ASSIGNED', { stageInstanceId: stage.stageInstanceId, participantId: participant.participantId });
            return { participantId: participant.participantId, status: 'awaiting_participant', attempts: attempt };
          }
          if (outcome?.status === 'cancelled') {
            return { participantId: participant.participantId, status: 'cancelled', reason: 'aborted', attempts: attempt };
          }
          if (outcome?.status === 'terminal_failure') {
            const failure = outcome.failure || {
              modelId: participant.model || participant.participantId,
              terminal: true,
              reasonCode: 'terminal_transport_failure',
              stageId: stage.stageInstanceId,
              attemptId: `${stage.stageInstanceId}:a${attempt}`
            };
            emit('PARTICIPANT_TERMINAL_FAILURE', {
              stageInstanceId: stage.stageInstanceId, participantId: participant.participantId,
              attempt, reasonCode: failure.reasonCode, attemptId: failure.attemptId
            });
            return {
              participantId: participant.participantId, status: 'failed', terminal: true,
              reason: failure.reasonCode, failure, attempts: attempt
            };
          }
          let responseText = text(outcome?.text);
          let verdict = acceptance(responseText, { stage, participant });
          if (!verdict.ok && repairPrompt && attempt <= maxAttempts) {
            // Format repair: one in-attempt repair dispatch (Extraction Contract D-9/T-6/F-10).
            emit('RESPONSE_CONTRACT_REPAIR', { stageInstanceId: stage.stageInstanceId, participantId: participant.participantId, reason: verdict.reason });
            const repaired = await withTimeout(adapter.dispatch({
              participant, stage, attempt, signal, context,
              prompt: repairPrompt({ stage, participant, prompt, reason: verdict.reason, details: verdict.details })
            }), signal);
            responseText = text(repaired?.text);
            verdict = acceptance(responseText, { stage, participant });
          }
          if (verdict.ok) {
            emit('PARTICIPANT_RESPONSE_ACCEPTED', { stageInstanceId: stage.stageInstanceId, participantId: participant.participantId, attempt });
            const artifacts = extractArtifacts({ stage, participant, text: responseText }) || [];
            const stateDelta = proposeStateDelta({ stage, participant, text: responseText, artifacts, context });
            return {
              participantId: participant.participantId, status: 'accepted',
              text: responseText, artifacts, proposedStateDelta: stateDelta, attempts: attempt
            };
          }
          lastReason = verdict.reason || 'not_accepted';
          emit('PARTICIPANT_RESPONSE_REJECTED', { stageInstanceId: stage.stageInstanceId, participantId: participant.participantId, attempt, reason: lastReason });
        } catch (error) {
          if (error?.name === 'AbortError' || signal?.aborted) {
            return { participantId: participant.participantId, status: 'cancelled', reason: 'aborted', attempts: attempt };
          }
          lastReason = error?.code === 'TIMEOUT' ? 'participant_timeout' : (error?.message || 'dispatch_failed');
          emit('PARTICIPANT_DISPATCH_FAILED', { stageInstanceId: stage.stageInstanceId, participantId: participant.participantId, attempt, reason: lastReason });
        }
        if (attempt < maxAttempts) await sleep(Number(retryPolicy.delayMs || 0));
      }
      return { participantId: participant.participantId, status: 'failed', reason: lastReason || 'no_usable_response', attempts: maxAttempts };
    }

    async function executeParallelBatch(stage, participants, adapter, signal, context) {
      const attempt = 1;
      const promptsByParticipantId = {};
      for (const participant of participants) {
        const key = idempotencyKey(stage, attempt, participant.participantId);
        if (seenIdempotencyKeys.has(key)) return null;
        seenIdempotencyKeys.add(key);
        promptsByParticipantId[participant.participantId] = compilePrompt({ stage, participant, attempt, context });
        emit('STAGE_DISPATCH_STARTED', {
          stageInstanceId: stage.stageInstanceId, participantId: participant.participantId,
          attempt, idempotencyKey: key, batch: true
        });
      }
      let outcomes;
      try {
        outcomes = await withTimeout(adapter.dispatchBatch({
          participants, promptsByParticipantId, stage, attempt, signal, context
        }), signal);
      } catch (error) {
        if (error?.name === 'AbortError' || signal?.aborted) {
          outcomes = Object.fromEntries(participants.map((participant) => [participant.participantId, { status: 'cancelled' }]));
        } else {
          outcomes = Object.fromEntries(participants.map((participant) => [participant.participantId, { status: 'dispatch_error', error }]));
        }
      }
      return Promise.all(participants.map((participant) => executeParticipant(stage, participant, signal, context, {
        prompt: promptsByParticipantId[participant.participantId],
        outcome: outcomes?.[participant.participantId] || { status: 'received', text: '' }
      })));
    }

    function summarize(stage, results) {
      const accepted = results.filter((r) => r.status === 'accepted');
      const awaiting = results.filter((r) => r.status === 'awaiting_participant');
      const cancelled = results.filter((r) => r.status === 'cancelled');
      const completionMode = stage.completionMode || 'all';
      const quorum = completionMode === 'quorum'
        ? Math.max(1, Number(stage.quorumSize || Math.ceil(results.length / 2)))
        : null;
      let executionStatus;
      if (cancelled.length && !accepted.length) executionStatus = 'cancelled';
      else if (awaiting.length) executionStatus = 'awaiting_participant';
      else if (completionMode === 'all') executionStatus = accepted.length === results.length ? 'completed' : (accepted.length ? 'partial' : 'failed');
      else if (completionMode === 'quorum') executionStatus = accepted.length >= quorum ? 'completed' : (accepted.length ? 'partial' : 'failed');
      else executionStatus = accepted.length >= 1 ? 'completed' : 'failed';
      return {
        stageInstanceId: stage.stageInstanceId,
        executionStatus,
        attempts: results.map((r) => ({ participantId: r.participantId, status: r.status, attempts: r.attempts, reason: r.reason })),
        acceptedResponses: accepted.map((r) => ({ participantId: r.participantId, text: r.text, artifacts: r.artifacts })),
        proposedStateDeltas: accepted.map((r) => r.proposedStateDelta).filter(Boolean),
        awaitingParticipants: awaiting.map((r) => r.participantId),
        failedParticipants: results.filter((r) => r.status === 'failed').map((r) => r.participantId)
        ,terminalFailures: results.filter((r) => r.status === 'failed' && r.terminal).map((r) => ({
          participantId: r.participantId,
          terminal: true,
          reasonCode: r.failure?.reasonCode || r.reason || 'terminal_transport_failure',
          stageId: r.failure?.stageId || stage.stageInstanceId,
          attemptId: r.failure?.attemptId || ''
        }))
      };
    }

    return Object.freeze({
      DISPATCH_MODES, COMPLETION_MODES, idempotencyKey,
      async execute(stage, executionContext = {}) {
        if (!stage?.stageInstanceId || !stage?.runId) throw new Error('StageInstance requires stageInstanceId and runId');
        const participants = arr(stage.participants).map((p) => typeof p === 'string' ? { participantId: p, type: 'llm' } : p);
        if (!participants.length) throw new Error('StageInstance requires participants');
        const signal = executionContext.signal || null;
        const mode = DISPATCH_MODES.includes(stage.dispatchMode) ? stage.dispatchMode : (participants.length > 1 ? 'parallel' : 'single');
        if (mode === 'single' && participants.length !== 1) {
          const error = new Error('single dispatch mode requires exactly one participant');
          error.code = 'SINGLE_DISPATCH_PARTICIPANT_COUNT';
          throw error;
        }
        emit('STAGE_EXECUTION_STARTED', { stageInstanceId: stage.stageInstanceId, dispatchMode: mode, participants: participants.map((p) => p.participantId) });
        let results = [];
        if (mode === 'parallel' && participants.length > 1) {
          const participantTypes = new Set(participants.map((participant) => participant.type || 'llm'));
          const batchAdapter = participantTypes.size === 1 ? adapters.get(participants[0].type || 'llm') : null;
          results = typeof batchAdapter?.dispatchBatch === 'function'
            ? await executeParallelBatch(stage, participants, batchAdapter, signal, executionContext)
            : null;
          if (!results) results = await Promise.all(participants.map((p) => executeParticipant(stage, p, signal, executionContext)));
        } else if (mode === 'sequential') {
          for (const participant of participants) {
            const result = await executeParticipant(stage, participant, signal, executionContext);
            results.push(result);
            if (stage.completionMode === 'first_success' && result.status === 'accepted') break;
            if (signal?.aborted) break;
          }
        } else {
          results = [await executeParticipant(stage, participants[0], signal, executionContext)];
        }
        const summary = summarize(stage, results);
        emit('STAGE_EXECUTION_FINISHED', { stageInstanceId: stage.stageInstanceId, executionStatus: summary.executionStatus });
        return summary;
      }
    });
  }

  const api = Object.freeze({
    DISPATCH_MODES, COMPLETION_MODES, idempotencyKey,
    createAdapterRegistry, createHumanAdapter, createLlmAdapter, createStageExecutor
  });
  root.DebateStageExecutor = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
