// Topology-neutral application boundary for Debate orchestration.
(function initDebateApplication(root) {
  'use strict';

  const RunStore = root.DebateRunStore || (typeof require === 'function' ? require('./debate-run-store') : null);
  const Policies = root.DebatePolicies || (typeof require === 'function' ? require('./debate-policies') : null);
  const PlanRevision = root.DebatePlanRevision || (typeof require === 'function' ? require('./debate-plan-revision') : null);
  const DraftPlan = root.DebateDraftPlan || (typeof require === 'function' ? require('./debate-draft-plan') : null);
  const Planner = root.DebatePlanner || (typeof require === 'function' ? require('./debate-planner') : null);
  const StageExecutor = root.DebateStageExecutor || (typeof require === 'function' ? require('./debate-stage-executor') : null);
  const Orchestrator = root.DebateOrchestrator || (typeof require === 'function' ? require('./debate-orchestrator') : null);
  const CaseStore = root.DebateCaseStore || (typeof require === 'function' ? require('./debate-case-store') : null);
  const OrchestratorPersistence = root.DebateOrchestratorPersistence || (typeof require === 'function' ? require('./debate-orchestrator-persistence') : null);

  const makeFallbackId = () => `debate-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  function createApplication(options = {}) {
    const store = options.store || RunStore?.createStore?.();
    if (!store) throw new Error('DebateApplication requires DebateRunStore');
    const deps = Object.freeze({ ...(options.deps || {}) });
    const semanticStore = options.semanticStore || (options.enableCanonicalStore ? CaseStore?.createStore?.(options.caseStoreOptions || {}) : null);
    const dispatch = (type, payload = {}) => store.dispatch({ type, payload });
    const event = RunStore?.EVENTS || {};

    // The application has exactly one execution architecture: the universal engine.
    let universal = null;
    let universalRevisions = null;
    const universalEnabled = () => true;
    const universalModulesReady = () => Boolean(Policies && PlanRevision && DraftPlan && Planner && StageExecutor && Orchestrator);

    function normalizeParticipants(config = {}) {
      const source = Array.isArray(config.participants) && config.participants.length
        ? config.participants
        : (Array.isArray(config.models) && config.models.length
          ? config.models
          : (Array.isArray(config.selectedModels) ? config.selectedModels : []));
      return source.map((entry) => typeof entry === 'string'
        ? { participantId: entry, type: 'llm', model: entry, capabilities: ['position', 'critique', 'response', 'verification', 'synthesis', 'audit'] }
        : { type: 'llm', capabilities: ['position', 'critique', 'response', 'verification', 'synthesis', 'audit'], ...entry, participantId: entry.participantId || entry.model });
    }

    // Universal Production Wiring Contract: when the flag is genuinely enabled (not a
    // test exercising dispatch/validation in isolation), every port the executor/
    // orchestrator need for a real semantic commit must be present. Without this gate,
    // missing commitStateDelta/extractArtifacts/proposeStateDelta silently degrade to
    // permissive built-in fallbacks (see debate-stage-executor.js, debate-orchestrator.js)
    // that report success without any real state change — the worst class of bug: a run
    // that looks completed but produced nothing. Tests opt out explicitly via
    // options.allowIncompleteWiring; production callers must wire all ports for real.
    function assertProductionWiringComplete(options, deps) {
      if (options.allowIncompleteWiring) return;
      const missing = [];
      if (!options.stageExecutor) {
        if (!options.adapters?.llm && typeof deps.runModelBatch !== 'function') missing.push('runModelBatch');
        if (typeof deps.acceptResponse !== 'function') missing.push('acceptResponse');
        if (typeof (options.compilePrompt || deps.compilePrompt) !== 'function') missing.push('compilePrompt');
        if (typeof (options.extractArtifacts || deps.extractArtifacts) !== 'function') missing.push('extractArtifacts');
        if (typeof (options.proposeStateDelta || deps.proposeStateDelta) !== 'function') missing.push('proposeStateDelta');
      }
      if (typeof (options.commitStateDelta || deps.commitStateDelta) !== 'function') missing.push('commitStateDelta');
      if (typeof (options.projectStateMap || deps.projectStateMap) !== 'function') missing.push('projectStateMap');
      if (missing.length) {
        const error = new Error(`UNIVERSAL_PRODUCTION_WIRING_INCOMPLETE: missing required production port(s): ${missing.join(', ')}`);
        error.code = 'UNIVERSAL_PRODUCTION_WIRING_INCOMPLETE';
        error.missingPorts = missing;
        throw error;
      }
    }

    function createUniversalRun(config = {}) {
      if (!universalModulesReady()) throw new Error('Universal engine modules are unavailable');
      assertProductionWiringComplete(options, deps);
      const policies = Policies.resolve(config.policies || {});
      const discussionParticipants = normalizeParticipants(config);
      const suppliedPlan = config.draftPlan ? DraftPlan.normalize(config.draftPlan) : null;
      const draftValidation = suppliedPlan ? DraftPlan.validate(suppliedPlan) : { valid: true, errors: [] };
      if (!draftValidation.valid) return { ok: false, code: 'DRAFT_PLAN_INVALID', validation: draftValidation };
      const synthesizer = String(config.synthesizer || '').trim();
      // Participant-count and identity policies describe discussion participants.
      // A separate synthesis-only service participant must not change that count.
      const validation = Policies.validateConfiguration({ participants: discussionParticipants }, policies);
      if (!validation.valid) return { ok: false, code: 'CONFIGURATION_INVALID', validation };
      const plannedStages = suppliedPlan
        ? suppliedPlan.plannedStages
        : (Array.isArray(config.plannedStages) ? config.plannedStages.slice() : []);
      const explicitParticipantIds = new Set([
        ...(synthesizer && !['auto', 'none'].includes(synthesizer.toLowerCase()) ? [synthesizer] : []),
        ...plannedStages.flatMap((stage) => Array.isArray(stage?.participantIds) ? stage.participantIds : [])
      ].map((participantId) => String(participantId || '').trim()).filter(Boolean));
      explicitParticipantIds.forEach((participantId) => {
        if (discussionParticipants.some((participant) => participant.participantId === participantId)) return;
        const assignedToDiscussion = plannedStages.some((stage) => stage?.purpose !== 'synthesis'
          && Array.isArray(stage.participantIds) && stage.participantIds.includes(participantId));
        const isSynthesisOnly = !assignedToDiscussion && (participantId === synthesizer || plannedStages.some((stage) => stage?.purpose === 'synthesis'
          && Array.isArray(stage.participantIds) && stage.participantIds.includes(participantId)));
        discussionParticipants.push({
          participantId,
          type: 'llm',
          model: participantId,
          capabilities: isSynthesisOnly ? ['synthesis', 'audit'] : ['position', 'critique', 'response', 'verification', 'synthesis', 'audit'],
          serviceOnly: isSynthesisOnly
        });
      });
      const participants = discussionParticipants;
      const runId = String(config.runId || deps.createId?.('debate') || makeFallbackId());
      // Slice B: DebateCase is created before the runtime starts.
      const debateCase = {
        caseId: runId,
        version: 1,
        topic: { title: String(config.topic || config.pipelineNameText || '') },
        problemSpec: config.problemSpec || null,
        taskContract: config.taskContract || null,
        constraints: Array.isArray(config.constraints) ? config.constraints.slice() : [],
        attachments: Array.isArray(config.attachments || config.attachmentsPayload) ? (config.attachments || config.attachmentsPayload).slice() : [],
        participants,
        artifacts: [], relations: [],
        openGoals: Array.isArray(config.openGoals) ? config.openGoals.slice() : (plannedStages.length ? [] : participants.map((p, index) => ({
          goalId: `goal-position-${p.participantId}`,
          type: 'establish_position', targetArtifactIds: [], status: 'open',
          priority: 50, createdFromEventId: 'initial_configuration', createdAt: new Date().toISOString(), order: index
        })).slice(0, 1)),
        sourceEvents: [],
        policies,
        lifecycle: 'created'
      };
      const explicitSynthesizer = ['auto', 'none'].includes(synthesizer.toLowerCase()) ? '' : synthesizer;
      if (explicitSynthesizer && !plannedStages.some((stage) => stage.purpose === 'synthesis')) {
        plannedStages.push({
          plannedStageId: 'planned-final-synthesis',
          purpose: 'synthesis',
          status: 'pending',
          participantIds: [explicitSynthesizer],
          requiredCapabilities: ['synthesis'],
          activationPolicy: 'finalization_ready',
          outputIntent: 'candidate_final',
          terminalPolicy: 'eligible_for_finalization',
          expectedArtifactTypes: ['synthesis_conclusion'],
          upstream: [],
          goalIds: []
        });
      }
      universalRevisions = PlanRevision.createRevisionStore({
        emit: recordUniversalEvent,
        validateDraft: options.validateRevisionDraft
      });
      const adapters = StageExecutor.createAdapterRegistry({
        human: StageExecutor.createHumanAdapter(),
        ...(typeof deps.runModelBatch === 'function' ? { llm: StageExecutor.createLlmAdapter({ runModelBatch: deps.runModelBatch }) } : {}),
        ...(options.adapters || {})
      });
      const executor = options.stageExecutor || StageExecutor.createStageExecutor({
        adapters,
        acceptResponse: deps.acceptResponse,
        compilePrompt: options.compilePrompt || deps.compilePrompt,
        repairPrompt: options.repairPrompt || deps.repairPrompt,
        extractArtifacts: options.extractArtifacts || deps.extractArtifacts,
        proposeStateDelta: options.proposeStateDelta || deps.proposeStateDelta,
        retryPolicy: policies.retry,
        emit: recordUniversalEvent
      });
      universal = Orchestrator.createOrchestrator({
        planner: options.planner || Planner.createPlanner(),
        executor,
        revisionStore: universalRevisions,
        persistence: options.persistence || (options.enableDurablePersistence ? OrchestratorPersistence?.createPersistence?.({ runId }) : undefined),
        semanticStore,
        commitStateDelta: options.commitStateDelta || deps.commitStateDelta,
        projectStateMap: options.projectStateMap || deps.projectStateMap,
        extractArtifacts: options.extractArtifacts || deps.extractArtifacts,
        proposeStateDelta: options.proposeStateDelta || deps.proposeStateDelta,
        AbortController: deps.AbortController,
        emit: recordUniversalEvent,
        exposeInternals: options.exposeInternals
      });
      return { ok: true, orchestrator: universal, debateCase, plannedStages, validation, runId };
    }

    function recordUniversalEvent(type, payload = {}) {
      const body = payload?.payload || payload;
      // Lifecycle projections are committed before ancillary timeline work. This
      // guarantees that a completed orchestrator cannot be left with a running
      // UI aggregate if telemetry/rendering fails.
      if (type === 'STAGE_STARTED') dispatch(event.STAGE_STARTED, { stageId: body.stageInstanceId });
      if (type === 'STAGE_COMPLETED') dispatch(event.STAGE_COMPLETED, { stageId: body.stageInstanceId });
      if (type === 'RUN_COMPLETED') dispatch(event.FINALIZATION_COMPLETED, { reason: body.reason || 'completed' });
      if (type === 'RUN_CANCELLED') dispatch(event.CANCEL_REQUESTED, { reason: body.reason || 'cancelled' });
      if (type === 'RUN_FAILED') dispatch(event.RUN_FAILED, { reason: body.reason || 'failed' });
      dispatch(event.TIMELINE_EVENT_RECORDED, { kind: type, ...payload });
    }

    const revisionCommand = (commandType, payload, meta = {}) => ({
      commandId: meta.commandId || `command-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      expectedRevisionId: meta.expectedRevisionId || universalRevisions?.getActive?.()?.revisionId,
      commandType,
      payload,
      createdBy: meta.createdBy || 'human',
      timestamp: new Date().toISOString()
    });

    const api = Object.freeze({
      getState: () => store.getState(),
      subscribe: (listener) => store.subscribe(listener),
      getExecutionContext: () => null,
      // Universal engine surface.
      isUniversalEngineEnabled: universalEnabled,
      validateConfiguration(config = {}) {
        if (!Policies) throw new Error('DebatePolicies unavailable');
        return Policies.validateConfiguration({ participants: normalizeParticipants(config) }, Policies.resolve(config.policies || {}));
      },
      async startUniversal(config = {}) {
        const created = createUniversalRun(config);
        if (!created.ok) return created;
        if (semanticStore?.create) {
          let canonical = semanticStore.getState?.();
          if (canonical?.caseId !== created.runId && semanticStore.load) canonical = await semanticStore.load(created.runId);
          if (!canonical) canonical = await semanticStore.create(created.debateCase);
          created.debateCase = canonical;
        }
        dispatch(event.START_REQUESTED, {
          runId: created.runId,
          sessionId: config.sessionId,
          topology: 'universal',
          preset: config.preset || null,
          taskContract: created.debateCase.taskContract,
          config: config.persistedConfig || config
        });
        const maxSteps = config.maxSteps ?? created.debateCase.policies?.budgets?.maxTotalStages;
        const started = await created.orchestrator.startRun({
          runId: created.runId, debateCase: created.debateCase,
          stateMap: config.stateMap, plannedStages: created.plannedStages,
          deferExecution: config.deferExecution, maxSteps
        });
        return { ...started, validation: created.validation, orchestrator: created.orchestrator };
      },
      getOrchestrator: () => universal,
      getActiveRevision: () => universalRevisions?.getActive?.() || null,
      insertStage: (stage, meta) => universal?.activatePlanRevision(revisionCommand('INSERT_STAGE', {
        stage,
        afterPlannedStageId: meta?.afterPlannedStageId,
        runningStagePolicy: meta?.runningStagePolicy
      }, meta), meta),
      removePlannedStage: (plannedStageId, meta) => universal?.activatePlanRevision(revisionCommand('REMOVE_PENDING_STAGE', { plannedStageId }, meta), meta),
      changeParticipant: (payload, meta) => universal?.activatePlanRevision(revisionCommand('CHANGE_PARTICIPANT', payload, meta), meta),
      changePolicy: (payload, meta) => universal?.activatePlanRevision(revisionCommand('CHANGE_EXECUTION_POLICY', payload, meta), meta),
      requestSynthesis: (payload, meta) => universal?.activatePlanRevision(revisionCommand('REQUEST_SYNTHESIS', payload || {}, meta), meta),
      requestAudit: (payload, meta) => universal?.activatePlanRevision(revisionCommand('REQUEST_AUDIT', payload || {}, meta), meta),
      insertHumanStage: (stage, meta) => universal?.activatePlanRevision(revisionCommand('INSERT_HUMAN_STAGE', { stage }, meta), meta),
      submitIntervention: (command) => universal?.submitIntervention(command),
      submitParticipantResponse: (command) => universal?.submitParticipantResponse(command),
      resolveHumanDecision: (command) => universal?.resolveHumanDecision(command),
      pauseRun: (command) => universal?.requestPause(command || {}),
      continueRun: (command) => universal?.requestContinue(command || {}),
      async start(config = {}) {
        return api.startUniversal(config);
      },
      startFromPage(...args) {
        if (typeof deps.startFromPage === 'function') return deps.startFromPage(...args);
        return api.start(args[0] || {});
      },
      async pause(reason = 'moderator_pause') {
        return universal?.requestPause?.({ requestedBy: 'moderator', reason }) || { ok: false, code: 'RUN_NOT_STARTED' };
      },
      async resume() {
        return universal?.requestContinue?.({ requestedBy: 'moderator' }) || { ok: false, code: 'RUN_NOT_STARTED' };
      },
      approveTurn(turn) {
        return api.submitParticipantResponse(turn || {});
      },
      rejectTurn() {
        return false;
      },
      async cancel(reason = 'cancelled') {
        const state = store.getState();
        await universal?.requestCancel?.({ reason });
        if (!RunStore?.isTerminal?.(store.getState())) dispatch(event.CANCEL_REQUESTED, { reason });
        await deps.cancelTransport?.(state?.runId, reason);
        return store.getState();
      },
      async recover(snapshot, command = {}) {
        const recovered = RunStore?.hydrate?.(snapshot) || snapshot;
        if (!recovered?.runId) return { ok: false, code: 'RECOVERY_SNAPSHOT_INVALID' };
        if (RunStore?.isTerminal?.(recovered)) {
          store.replace(recovered);
          return { ok: true, lifecycle: 'TERMINAL', aggregate: store.getState() };
        }
        const created = createUniversalRun({
          ...(recovered.config || {}),
          runId: recovered.runId,
          sessionId: recovered.sessionId,
          persistedConfig: recovered.config || {}
        });
        if (!created?.ok || !created.orchestrator?.recoverRun) {
          return { ok: false, code: created?.code || 'RUNTIME_RECOVERY_UNAVAILABLE' };
        }
        let runtimeRecovery = await created.orchestrator.recoverRun({
          runId: recovered.runId,
          deferExecution: command.deferExecution !== false,
          maxSteps: command.maxSteps
        });
        if (!runtimeRecovery?.ok) return runtimeRecovery;
        if (runtimeRecovery.lifecycle === 'RUNNING') {
          const paused = await created.orchestrator.requestPause({
            policy: 'finish_current_stage',
            requestedBy: 'recovery'
          });
          if (!paused?.ok) return paused;
          runtimeRecovery = { ...runtimeRecovery, lifecycle: paused.lifecycle };
        }
        store.replace(recovered);
        if (runtimeRecovery.lifecycle === 'COMPLETED') {
          dispatch(event.FINALIZATION_COMPLETED, { reason: 'runtime_recovered_completed' });
        } else if (runtimeRecovery.lifecycle === 'CANCELLED') {
          dispatch(event.CANCEL_REQUESTED, { reason: 'runtime_recovered_cancelled' });
        } else if (runtimeRecovery.lifecycle === 'FAILED') {
          dispatch(event.RUN_FAILED, { reason: 'runtime_recovered_failed' });
        } else if (!RunStore?.isTerminal?.(store.getState())) {
          dispatch(event.TECHNICAL_PAUSE, { reason: 'page_recovered' });
        }
        return {
          ok: true,
          lifecycle: runtimeRecovery.lifecycle,
          aggregate: store.getState()
        };
      },
      recoverRun(snapshot, command) {
        return api.recover(snapshot, command);
      },
      dispose(reason = 'application_disposed') {
        universal?.requestCancel?.({ reason });
      }
    });

    return api;
  }

  const api = Object.freeze({ createApplication });
  root.DebateApplication = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
