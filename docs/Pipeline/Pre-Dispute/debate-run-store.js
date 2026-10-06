// Canonical aggregate and event stream for one Debate run.
(function initDebateRunStore(root) {
  'use strict';

  const VERSION = 6;
  const STORAGE_KEY = 'llmCodexDebateRun.v1';
  const MAX_EVENTS = 500;
  const TERMINAL = new Set(['completed', 'error', 'cancelled', 'stopped_by_moderator']);
  const EVENTS = Object.freeze({
    START_REQUESTED: 'START_REQUESTED',
    BATCH_DISPATCHED: 'BATCH_DISPATCHED',
    STAGE_STARTED: 'STAGE_STARTED',
    STAGE_COMPLETED: 'STAGE_COMPLETED',
    STAGE_FAILED: 'STAGE_FAILED',
    MODEL_RESPONSE_RECEIVED: 'MODEL_RESPONSE_RECEIVED',
    APPROVAL_REQUESTED: 'APPROVAL_REQUESTED',
    APPROVAL_GRANTED: 'APPROVAL_GRANTED',
    PAUSE_REQUESTED: 'PAUSE_REQUESTED',
    RESUME_REQUESTED: 'RESUME_REQUESTED',
    TECHNICAL_PAUSE: 'TECHNICAL_PAUSE',
    CHECKPOINT_COMPLETED: 'CHECKPOINT_COMPLETED',
    FINALIZATION_REQUESTED: 'FINALIZATION_REQUESTED',
    FINALIZATION_COMPLETED: 'FINALIZATION_COMPLETED',
    RUN_FAILED: 'RUN_FAILED',
    CANCEL_REQUESTED: 'CANCEL_REQUESTED',
    EXECUTION_STATE_CHANGED: 'EXECUTION_STATE_CHANGED',
    PROTOCOL_STATE_REPLACED: 'PROTOCOL_STATE_REPLACED',
    PROTOCOL_STATE_SYNCED: 'PROTOCOL_STATE_SYNCED',
    MODERATOR_TURN_RECORDED: 'MODERATOR_TURN_RECORDED',
    MODEL_TURN_RECORDED: 'MODEL_TURN_RECORDED',
    VERDICT_RECORDED: 'VERDICT_RECORDED',
    TIMELINE_EVENT_RECORDED: 'TIMELINE_EVENT_RECORDED',
    REGISTRY_UPDATED: 'REGISTRY_UPDATED'
    ,PROMPT_COMPILED: 'PROMPT_COMPILED'
    ,STATE_DELTA_PROPOSED: 'STATE_DELTA_PROPOSED'
    ,STATE_DELTA_APPLIED: 'STATE_DELTA_APPLIED'
    ,STATE_DELTA_REJECTED: 'STATE_DELTA_REJECTED'
    ,HUMAN_DECISION_RECORDED: 'HUMAN_DECISION_RECORDED'
    ,DUPLICATE_FINAL_REJECTED: 'DUPLICATE_FINAL_REJECTED'
    ,DECISION_REQUESTED: 'DECISION_REQUESTED'
    ,DECISION_RESOLVED: 'DECISION_RESOLVED'
    ,RULE_EVALUATED: 'RULE_EVALUATED'
    ,RULE_FIRED: 'RULE_FIRED'
    ,RULE_SUPPRESSED: 'RULE_SUPPRESSED'
    ,PROGRESS_WINDOW_UPDATED: 'PROGRESS_WINDOW_UPDATED'
    ,MODEL_SIGNAL_OBSERVED: 'MODEL_SIGNAL_OBSERVED'
    ,MODEL_SIGNAL_INVALID: 'MODEL_SIGNAL_INVALID'
    ,DROPOUT_RESOLVER_MISSING: 'DROPOUT_RESOLVER_MISSING'
    ,SYNTHESIZER_UNAVAILABLE: 'SYNTHESIZER_UNAVAILABLE'
    ,SYNTHESIZER_REASSIGNED: 'SYNTHESIZER_REASSIGNED'
    ,SYNTHESIS_RESPONSE_REJECTED: 'SYNTHESIS_RESPONSE_REJECTED'
    ,SYNTHESIS_SKIPPED_UNAVAILABLE: 'SYNTHESIS_SKIPPED_UNAVAILABLE'
    ,TERMINAL_EVENT_REJECTED: 'TERMINAL_EVENT_REJECTED'
  });

  const now = () => Date.now();
  const EXECUTION_FIELDS = new Set([
    'status', 'activeBatch', 'activeStageId', 'lastDispatchAt', 'lastResponseAt',
    'errorCode', 'reason', 'retryCount'
  ]);
  const currentVersions = () => root.DebateVersionManifest?.getVersions?.() || { implementation: 'dev', protocol: 5, planSchema: 3, runStoreSchema: VERSION, traceSchema: 3 };
  const normalizeTopology = () => 'universal';
  function createState(seed = {}) {
    const state = {
      version: VERSION,
      runId: String(seed.runId || ''),
      sessionId: String(seed.sessionId || '1'),
      architecture: 'universal',
      topology: 'universal',
      preset: seed.preset && typeof seed.preset === 'object' ? seed.preset : null,
      executionPlan: seed.executionPlan && typeof seed.executionPlan === 'object' ? seed.executionPlan : null,
      currentStageId: String(seed.currentStageId || ''),
      status: String(seed.status || 'idle'),
      protocolState: seed.protocolState || null,
      protocolRevision: Math.max(0, Number(seed.protocolRevision || 0)),
      execution: {
        status: 'idle',
        activeBatch: null,
        lastDispatchAt: null,
        lastResponseAt: null,
        ...(seed.execution && typeof seed.execution === 'object' ? seed.execution : {})
      },
      approval: {
        waiting: false,
        model: '',
        requestedAt: null,
        ...(seed.approval && typeof seed.approval === 'object' ? seed.approval : {})
      },
      config: seed.config && typeof seed.config === 'object' ? seed.config : {},
      taskContract: seed.taskContract || seed.executionPlan?.taskContract || seed.config?.taskContract || null,
      promptExecutions: Array.isArray(seed.promptExecutions) ? seed.promptExecutions.slice() : [],
      stateDeltas: Array.isArray(seed.stateDeltas) ? seed.stateDeltas.slice() : [],
      humanDecisions: Array.isArray(seed.humanDecisions) ? seed.humanDecisions.slice() : [],
      decisionRequests: Array.isArray(seed.decisionRequests) ? seed.decisionRequests.slice() : [],
      ruleEvaluations: Array.isArray(seed.ruleEvaluations) ? seed.ruleEvaluations.slice() : [],
      progressWindow: Array.isArray(seed.progressWindow) ? seed.progressWindow.slice() : [],
      modelSignals: Array.isArray(seed.modelSignals) ? seed.modelSignals.slice() : [],
      events: Array.isArray(seed.events) ? seed.events.slice() : [],
      eventSeq: Number(seed.eventSeq || 0),
      eventLog: {
        truncated: false,
        droppedCount: 0,
        firstRetainedSeq: null,
        ...(seed.eventLog && typeof seed.eventLog === 'object' ? seed.eventLog : {})
      },
      startedAt: Number(seed.startedAt || 0) || null,
      updatedAt: Number(seed.updatedAt || 0) || now(),
      completedAt: Number(seed.completedAt || 0) || null,
      pauseReason: String(seed.pauseReason || (
        ['paused', 'technical_pause'].includes(String(seed.status || '')) ? seed.terminalReason || '' : ''
      )),
      terminalReason: String(seed.terminalReason || '')
      ,epistemicOutcome: String(seed.epistemicOutcome || '')
      ,degradedMode: seed.degradedMode || null
      ,acceptedLedger: seed.acceptedLedger && typeof seed.acceptedLedger === 'object' ? { ...seed.acceptedLedger } : {}
      ,processAudit: seed.processAudit || null
      ,versions: seed.versions && typeof seed.versions === 'object' ? { ...seed.versions } : { ...currentVersions(), migratedFrom: 0 }
    };
    if (state.events.length > MAX_EVENTS) {
      const dropped = state.events.length - MAX_EVENTS;
      state.events = state.events.slice(-MAX_EVENTS);
      state.eventLog.truncated = true;
      state.eventLog.droppedCount = Number(state.eventLog.droppedCount || 0) + dropped;
    }
    state.eventLog.firstRetainedSeq = state.events[0]?.seq ?? null;
    return state;
  }

  function eventRecord(state, input) {
    return Object.freeze({
      id: `${state.runId || 'debate'}:${state.eventSeq + 1}`,
      seq: state.eventSeq + 1,
      type: String(input.type || ''),
      at: Number(input.at || 0) || now(),
      payload: input.payload && typeof input.payload === 'object' ? input.payload : {}
    });
  }

  function appendEvent(state, event) {
    const next = state.events.concat(event);
    const dropped = Math.max(0, next.length - MAX_EVENTS);
    state.events = dropped ? next.slice(-MAX_EVENTS) : next;
    if (dropped) {
      state.eventLog = {
        ...(state.eventLog || {}),
        truncated: true,
        droppedCount: Number(state.eventLog?.droppedCount || 0) + dropped
      };
    }
    state.eventLog = {
      ...(state.eventLog || {}),
      firstRetainedSeq: state.events[0]?.seq ?? null
    };
  }

  function transition(current, input = {}) {
    const state = input.type === EVENTS.START_REQUESTED ? createState() : createState(current);
    if (!input.type) return state;
    if (input.type === EVENTS.PROTOCOL_STATE_SYNCED && input.payload?.expectedProtocolRevision != null) {
      const expected = Number(input.payload.expectedProtocolRevision);
      if (!Number.isFinite(expected) || expected !== state.protocolRevision) {
        const error = new Error(`PROTOCOL_REVISION_STALE: expected ${expected}, actual ${state.protocolRevision}`);
        error.code = 'PROTOCOL_REVISION_STALE';
        error.expectedProtocolRevision = expected;
        error.actualProtocolRevision = state.protocolRevision;
        throw error;
      }
    }
    if (input.type === EVENTS.MODEL_RESPONSE_RECEIVED && input.payload?.accepted === true) {
      const payload = input.payload || {};
      const stageId = String(payload.stageId || '').trim();
      const participant = String(payload.participant || payload.model || '').trim();
      const attemptId = String(payload.attemptId || '').trim();
      if (stageId && participant && attemptId) {
        const key = `${stageId}:${participant}`;
        const prior = state.acceptedLedger?.[key];
        if (prior && prior.attemptId !== attemptId) {
          const rejected = eventRecord(state, { type: EVENTS.DUPLICATE_FINAL_REJECTED, payload: { attemptedType: input.type, stageId, participant, attemptId, acceptedAttemptId: prior.attemptId } });
          state.eventSeq = rejected.seq;
          appendEvent(state, rejected);
          state.updatedAt = rejected.at;
          return state;
        }
        if (prior && prior.attemptId === attemptId) return state;
      }
    }
    if (TERMINAL.has(state.status) && input.type !== EVENTS.START_REQUESTED) {
      const duplicateFinal = [EVENTS.FINALIZATION_COMPLETED, EVENTS.RUN_FAILED, EVENTS.CANCEL_REQUESTED].includes(input.type);
      const rejected = eventRecord(state, {
        type: duplicateFinal ? EVENTS.DUPLICATE_FINAL_REJECTED : EVENTS.TERMINAL_EVENT_REJECTED,
        payload: { attemptedType: input.type, originalStatus: state.status }
      });
      state.eventSeq = rejected.seq;
      appendEvent(state, rejected);
      state.updatedAt = rejected.at;
      return state;
    }
    const event = eventRecord(state, input);
    const payload = event.payload;
    state.eventSeq = event.seq;
    appendEvent(state, event);
    state.updatedAt = event.at;

    switch (event.type) {
      case EVENTS.START_REQUESTED:
        state.runId = String(payload.runId || state.runId);
        state.sessionId = String(payload.sessionId || state.sessionId || '1');
        state.topology = normalizeTopology(payload.topology || state.topology);
        state.preset = payload.preset || state.preset;
        state.executionPlan = payload.executionPlan || state.executionPlan;
        state.taskContract = payload.taskContract || payload.executionPlan?.taskContract || payload.config?.taskContract || state.taskContract;
        state.currentStageId = String(payload.executionPlan?.stages?.[0]?.stageId || '');
      state.config = payload.config || state.config;
        state.protocolState = payload.protocolState || state.protocolState;
        state.status = 'running';
        state.execution = { ...state.execution, status: 'starting', activeBatch: null };
        state.approval = { waiting: false, model: '', requestedAt: null };
        state.startedAt = event.at;
        state.completedAt = null;
        state.pauseReason = '';
        state.terminalReason = '';
        state.epistemicOutcome = '';
        state.degradedMode = null;
        state.processAudit = null;
        state.versions = { ...(payload.versions || currentVersions()) };
        break;
      case EVENTS.BATCH_DISPATCHED:
        state.status = 'running';
        state.execution = { ...state.execution, status: 'dispatching', activeBatch: payload.batch || payload, lastDispatchAt: event.at };
        break;
      case EVENTS.STAGE_STARTED:
        state.status = 'running';
        state.currentStageId = String(payload.stageId || state.currentStageId || '');
        state.execution = { ...state.execution, status: 'dispatching', activeStageId: state.currentStageId };
        break;
      case EVENTS.STAGE_COMPLETED: {
        const completedId = String(payload.stageId || state.currentStageId || '');
        const stages = state.executionPlan?.stages || [];
        const completedIndex = stages.findIndex((stage) => stage.stageId === completedId);
        state.currentStageId = String(stages[completedIndex + 1]?.stageId || '');
        state.execution = { ...state.execution, status: 'collecting', activeStageId: state.currentStageId || null };
        break;
      }
      case EVENTS.STAGE_FAILED:
        state.currentStageId = String(payload.stageId || state.currentStageId || '');
        state.execution = { ...state.execution, status: 'stage_error', activeStageId: state.currentStageId };
        break;
      case EVENTS.MODEL_RESPONSE_RECEIVED:
        state.execution = { ...state.execution, status: 'collecting', lastResponseAt: event.at };
        {
          const stageId = String(payload.stageId || '').trim();
          const participant = String(payload.participant || payload.model || '').trim();
          const attemptId = String(payload.attemptId || '').trim();
          if (payload.accepted === true && stageId && participant && attemptId) {
            const key = `${stageId}:${participant}`;
            state.acceptedLedger = { ...(state.acceptedLedger || {}), [key]: {
              attemptId,
              at: event.at
            } };
          }
        }
        break;
      case EVENTS.APPROVAL_REQUESTED:
        state.status = 'awaiting_approval';
        state.approval = { waiting: true, model: String(payload.model || ''), requestedAt: event.at };
        break;
      case EVENTS.APPROVAL_GRANTED:
        state.status = 'running';
        state.approval = { waiting: false, model: '', requestedAt: null };
        break;
      case EVENTS.PAUSE_REQUESTED:
        state.status = 'paused';
        state.pauseReason = String(payload.reason || '');
        break;
      case EVENTS.RESUME_REQUESTED:
        state.status = 'running';
        state.pauseReason = '';
        break;
      case EVENTS.TECHNICAL_PAUSE:
        state.status = 'technical_pause';
        state.pauseReason = String(payload.reason || 'technical_pause');
        break;
      case EVENTS.FINALIZATION_REQUESTED:
        state.status = 'finalization_pending';
        state.execution = { ...state.execution, status: 'finalizing' };
        break;
      case EVENTS.FINALIZATION_COMPLETED:
        state.status = 'completed';
        state.execution = { ...state.execution, status: 'completed', activeBatch: null };
        state.completedAt = event.at;
        state.pauseReason = '';
        state.epistemicOutcome = String(payload.epistemicOutcome || '');
        state.processAudit = payload.processAudit || state.processAudit || null;
        break;
      case EVENTS.RUN_FAILED:
        state.status = 'error';
        state.execution = { ...state.execution, status: 'error', activeBatch: null };
        state.terminalReason = String(payload.reason || 'run_failed');
        state.pauseReason = '';
        state.completedAt = event.at;
        break;
      case EVENTS.CANCEL_REQUESTED:
        state.status = 'cancelled';
        state.execution = { ...state.execution, status: 'cancelled', activeBatch: null };
        state.approval = { waiting: false, model: '', requestedAt: null };
        state.terminalReason = String(payload.reason || 'cancelled');
        state.pauseReason = '';
        state.completedAt = event.at;
        state.epistemicOutcome = '';
        break;
      case EVENTS.EXECUTION_STATE_CHANGED:
        if (payload.degradedMode) state.degradedMode = payload.degradedMode;
        state.execution = {
          ...state.execution,
          ...Object.fromEntries(Object.entries(payload).filter(([key]) => EXECUTION_FIELDS.has(key)))
        };
        break;
      case EVENTS.PROMPT_COMPILED:
        state.promptExecutions = state.promptExecutions.concat({ ...payload, at: event.at }).slice(-200);
        break;
      case EVENTS.STATE_DELTA_PROPOSED:
      case EVENTS.STATE_DELTA_APPLIED:
      case EVENTS.STATE_DELTA_REJECTED:
        state.stateDeltas = state.stateDeltas.concat({ ...payload, eventType: event.type, at: event.at }).slice(-200);
        break;
      case EVENTS.HUMAN_DECISION_RECORDED:
        state.humanDecisions = state.humanDecisions.concat({ ...payload, at: event.at }).slice(-100);
        break;
      case EVENTS.DECISION_REQUESTED:
        state.status = 'awaiting_approval';
        state.decisionRequests = state.decisionRequests.filter((item) => item.requestId !== payload.requestId).concat({ ...payload, status: 'pending', at: event.at }).slice(-50);
        break;
      case EVENTS.DECISION_RESOLVED:
        state.decisionRequests = state.decisionRequests.map((item) => item.requestId === payload.requestId ? { ...item, status: 'resolved', resolution: payload, resolvedAt: event.at } : item);
        state.humanDecisions = state.humanDecisions.concat({ ...payload, at: event.at }).slice(-100);
        state.status = payload.effect === 'stop_run' ? 'stopped_by_moderator' : 'running';
        break;
      case EVENTS.RULE_EVALUATED:
      case EVENTS.RULE_FIRED:
      case EVENTS.RULE_SUPPRESSED:
        state.ruleEvaluations = state.ruleEvaluations.concat({ ...payload, eventType: event.type, at: event.at }).slice(-500);
        break;
      case EVENTS.PROGRESS_WINDOW_UPDATED:
        state.progressWindow = Array.isArray(payload.window) ? payload.window.slice(-20) : state.progressWindow.concat({ ...payload, at: event.at }).slice(-20);
        break;
      case EVENTS.MODEL_SIGNAL_OBSERVED:
      case EVENTS.MODEL_SIGNAL_INVALID:
        state.modelSignals = state.modelSignals.concat({ ...payload, eventType: event.type, at: event.at }).slice(-200);
        break;
      case EVENTS.PROTOCOL_STATE_REPLACED:
        state.protocolState = payload.protocolState || null;
        state.protocolRevision += 1;
        break;
      case EVENTS.PROTOCOL_STATE_SYNCED:
        state.protocolState = payload.protocolState || state.protocolState || null;
        state.protocolRevision += 1;
        {
          const protocolStatus = String(payload.protocolStatus || state.protocolState?.status || '').toLowerCase();
          if (TERMINAL.has(protocolStatus)) {
            state.status = protocolStatus;
            state.execution = { ...state.execution, status: protocolStatus, activeBatch: null };
            state.approval = { waiting: false, model: '', requestedAt: null };
            state.terminalReason = String(payload.reason || state.protocolState?.terminalReason || protocolStatus);
            state.pauseReason = '';
            state.completedAt = event.at;
          }
        }
        break;
      default:
        break;
    }
    return state;
  }

  function createStore(initial = {}, options = {}) {
    let state = createState(initial);
    const listeners = new Set();
    const reportListenerError = typeof options.onListenerError === 'function'
      ? options.onListenerError
      : (error, context) => root.console?.error?.('[DebateRunStore] subscriber failed', error, context);
    const notify = (event) => {
      listeners.forEach((listener) => {
        try {
          listener(state, event);
        } catch (error) {
          try { reportListenerError(error, { event, state }); } catch (_) {}
        }
      });
    };
    return Object.freeze({
      getState: () => state,
      dispatch(event) {
        state = transition(state, event);
        notify(state.events[state.events.length - 1]);
        return state;
      },
      replace(next) {
        state = createState(next);
        notify(null);
        return state;
      },
      subscribe(listener) {
        if (typeof listener !== 'function') return () => {};
        listeners.add(listener);
        return () => listeners.delete(listener);
      }
    });
  }

  const encode = (value) => {
    if (value === undefined) return { __debateType: 'Undefined' };
    if (value instanceof Date) return { __debateType: 'Date', value: value.toISOString() };
    if (value instanceof Map) return { __debateType: 'Map', entries: Array.from(value.entries(), ([key, item]) => [encode(key), encode(item)]) };
    if (value instanceof Set) return { __debateType: 'Set', values: Array.from(value, encode) };
    if (Array.isArray(value)) return value.map(encode);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, encode(item)]));
    return value;
  };
  const decode = (value) => {
    if (value?.__debateType === 'Undefined') return undefined;
    if (value?.__debateType === 'Date') return new Date(value.value);
    if (value?.__debateType === 'Map') return new Map((value.entries || []).map(([key, item]) => [decode(key), decode(item)]));
    if (value?.__debateType === 'Set') return new Set((value.values || []).map(decode));
    if (Array.isArray(value)) return value.map(decode);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, decode(item)]));
    return value;
  };
  const serialize = (state) => JSON.stringify(encode(createState(state)));
  const hydrate = (raw) => {
    const decoded = decode(typeof raw === 'string' ? JSON.parse(raw) : raw || {});
    const savedSchema = Number(decoded?.versions?.runStoreSchema || 0);
    if (savedSchema > VERSION) return createState({ ...decoded, status: 'error', terminalReason: 'saved_by_newer_version', completedAt: now(), versions: { ...currentVersions(), savedSchema } });
    if (!decoded.versions) decoded.versions = { ...currentVersions(), migratedFrom: 0 };
    else if (savedSchema < VERSION) decoded.versions = { ...decoded.versions, migratedFrom: savedSchema };
    return createState(decoded);
  };
  const isTerminal = (state) => TERMINAL.has(String(state?.status || ''));

  const api = Object.freeze({ VERSION, STORAGE_KEY, MAX_EVENTS, EVENTS, createState, transition, createStore, serialize, hydrate, isTerminal });
  root.DebateRunStore = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
