(function initCompletionProtocol(root, factory) {
  const protocolVersion = '2.3.1';
  if (root?.CompletionProtocol?.version === protocolVersion) {
    if (typeof module === 'object' && module.exports) module.exports = root.CompletionProtocol;
    return;
  }
  const api = factory(protocolVersion);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.CompletionProtocol = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function buildCompletionProtocol(PROTOCOL_VERSION) {
  'use strict';

  const TERMINAL_STATUSES = Object.freeze([
    'SUCCESS_TERMINAL', 'CONTINUE_REQUIRED', 'PROVIDER_ERROR', 'INTERRUPTED',
    'STALLED', 'AMBIGUOUS', 'CONTEXT_LOST'
  ]);
  const PRODUCER_STATES = Object.freeze(['UNKNOWN', 'ACTIVE', 'CANDIDATE', 'TERMINAL', 'VETOED']);
  const OWNERSHIP_STATES = Object.freeze(['CONFIRMED', 'UNKNOWN', 'CONFLICT']);
  const VETO_TYPES = Object.freeze([
    'ACTIVE_GENERATION', 'ACTIVE_STOP', 'PROVIDER_ERROR', 'CONTINUE_REQUIRED',
    'OWNERSHIP_CONFLICT', 'CONTEXT_INVALID'
  ]);
  const WITNESS_TYPES = Object.freeze([
    'GENERATION_ACTIVE', 'GENERATION_INACTIVE', 'FRESH_RESPONSE_OBSERVED',
    'STOP_VISIBLE', 'STOP_ABSENT', 'COPY_VISIBLE', 'REGENERATE_VISIBLE',
    'COMPLETION_MARKER_VISIBLE', 'CONTINUE_VISIBLE', 'CONTENT_PROGRESS',
    'RESPONSE_STRUCTURE_CHANGED', 'COSMETIC_MUTATION', 'PROVIDER_ERROR_VISIBLE',
    'NODE_REPLACED', 'CONTEXT_INVALIDATED', 'USER_INTERRUPTED'
  ]);

  const freeze = (value) => {
    if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
    const prototype = Object.getPrototypeOf(value);
    if (!Array.isArray(value) && prototype !== Object.prototype && prototype !== null) return value;
    Object.keys(value).forEach((key) => freeze(value[key]));
    return Object.freeze(value);
  };

  function hashString(input) {
    const text = String(input || '');
    let hash = 2166136261;
    for (let index = 0; index < text.length; index += 1) {
      hash ^= text.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(16);
  }

  class EvidenceLedger {
    constructor() {
      this.records = [];
      this.nextSeq = 1;
    }

    append(event) {
      if (!event || !WITNESS_TYPES.includes(event.type)) throw new TypeError(`Unknown witness type: ${event?.type}`);
      const record = freeze({
        seq: this.nextSeq++,
        type: event.type,
        observedAt: Number(event.observedAt || Date.now()),
        source: String(event.source || 'unknown'),
        payload: event.payload == null ? null : event.payload
      });
      this.records.push(record);
      return record;
    }

    getLatest(type) {
      for (let index = this.records.length - 1; index >= 0; index -= 1) {
        if (this.records[index].type === type) return this.records[index];
      }
      return null;
    }

    has(type) { return this.records.some((record) => record.type === type); }
    snapshot() { return freeze(this.records.slice()); }
    refs(types = null) {
      const allowed = types ? new Set(types) : null;
      return this.records.filter((record) => !allowed || allowed.has(record.type)).map((record) => record.seq);
    }
  }

  class ProducerGate {
    constructor({ confirmationWindowMs = 1200 } = {}) {
      this.confirmationWindowMs = Math.max(0, Number(confirmationWindowMs || 0));
      this.state = 'UNKNOWN';
      this.candidateSince = null;
      this.evidenceRefs = [];
    }

    observe(type, observedAt = Date.now(), evidenceRef = null) {
      const at = Number(observedAt || Date.now());
      if (evidenceRef != null) this.evidenceRefs.push(evidenceRef);
      if (['GENERATION_ACTIVE', 'STOP_VISIBLE', 'CONTENT_PROGRESS', 'RESPONSE_STRUCTURE_CHANGED'].includes(type)) {
        this.state = 'ACTIVE';
        this.candidateSince = null;
      } else if (['STOP_ABSENT', 'COPY_VISIBLE', 'REGENERATE_VISIBLE', 'COMPLETION_MARKER_VISIBLE', 'GENERATION_INACTIVE'].includes(type)) {
        if (this.state !== 'TERMINAL' && this.state !== 'VETOED') {
          if (this.state !== 'CANDIDATE') this.candidateSince = at;
          this.state = 'CANDIDATE';
        }
      }
      return this.evaluate(at);
    }

    veto() { this.state = 'VETOED'; return this.state; }
    evaluate(now = Date.now()) {
      if (this.state === 'CANDIDATE' && Number(now) - Number(this.candidateSince) >= this.confirmationWindowMs) {
        this.state = 'TERMINAL';
      }
      return this.state;
    }
  }

  class MutationClassifier {
    classify(mutations, context = {}) {
      const list = Array.from(mutations || []);
      return list.map((mutation) => {
        const target = mutation?.target || null;
        const responseRoot = context.responseRoot || null;
        const controlsRoot = context.controlsRoot || null;
        const inResponse = !!(target && responseRoot && (target === responseRoot || responseRoot.contains?.(target)));
        const inControls = !!(target && controlsRoot && (target === controlsRoot || controlsRoot.contains?.(target)));
        const producerControl = inControls || !!context.isProducerControl?.(target, mutation);
        const cosmetic = !!context.isCosmetic?.(target, mutation)
          || (mutation?.type === 'attributes' && ['class', 'style', 'aria-live', 'aria-busy'].includes(mutation.attributeName));
        const normalizedBefore = context.normalizedBefore ?? null;
        const normalizedAfter = context.normalizedAfter ?? null;
        const structuralBefore = context.structuralBefore ?? null;
        const structuralAfter = context.structuralAfter ?? null;
        if (producerControl) return { kind: 'PRODUCER_CONTROL', substantive: false, targetNode: target };
        if (!inResponse) return { kind: 'UNRELATED', substantive: false, targetNode: target };
        if (normalizedBefore !== null && normalizedAfter !== null && normalizedBefore !== normalizedAfter) {
          return { kind: 'CONTENT_PROGRESS', substantive: true, targetNode: target };
        }
        if (structuralBefore !== null && structuralAfter !== null && structuralBefore !== structuralAfter) {
          return { kind: 'RESPONSE_STRUCTURE', substantive: true, targetNode: target };
        }
        if (cosmetic) return { kind: 'COSMETIC', substantive: false, targetNode: target };
        return { kind: 'COSMETIC', substantive: false, targetNode: target };
      });
    }
  }

  class TimeoutPolicy {
    constructor({ promptSubmittedAt = Date.now(), progressTimeoutMs = 60000, producerStuckTimeoutMs = 90000, hardAttemptTimeoutMs = 450000 } = {}) {
      this.promptSubmittedAt = Number(promptSubmittedAt);
      this.progressTimeoutMs = Number(progressTimeoutMs);
      this.producerStuckTimeoutMs = Number(producerStuckTimeoutMs);
      this.hardAttemptTimeoutMs = Number(hardAttemptTimeoutMs);
      this.lastProgressAt = this.promptSubmittedAt;
      this.producerActiveSince = null;
    }
    progress(at = Date.now()) { this.lastProgressAt = Number(at); }
    producerActive(active, at = Date.now()) {
      if (active && this.producerActiveSince == null) this.producerActiveSince = Number(at);
      if (!active) this.producerActiveSince = null;
    }
    evaluate(now = Date.now()) {
      const at = Number(now);
      if (at - this.promptSubmittedAt >= this.hardAttemptTimeoutMs) return 'HARD';
      if (this.producerActiveSince != null && at - this.lastProgressAt >= this.producerStuckTimeoutMs) return 'PRODUCER_STUCK';
      if (at - this.lastProgressAt >= this.progressTimeoutMs) return 'PROGRESS';
      return null;
    }
  }

  class CompletionCapabilityHealth {
    constructor(initial = {}, onTransition = null) {
      this.onTransition = typeof onTransition === 'function' ? onTransition : null;
      this.states = {
        generationSignal: initial.generationSignal || 'UNAVAILABLE',
        producerControls: initial.producerControls || 'UNAVAILABLE',
        answerResolution: initial.answerResolution || 'UNAVAILABLE',
        continueDetection: initial.continueDetection || 'UNAVAILABLE'
      };
    }
    report(capability, state) {
      if (!Object.prototype.hasOwnProperty.call(this.states, capability)) throw new TypeError(`Unknown capability: ${capability}`);
      if (!['HEALTHY', 'DEGRADED', 'UNAVAILABLE'].includes(state)) throw new TypeError(`Unknown capability state: ${state}`);
      const previousState = this.states[capability];
      if (previousState === state) return state;
      this.states[capability] = state;
      try { this.onTransition?.({ capability, previousState, state }); } catch (_) {}
      return state;
    }
    snapshot() { return freeze({ ...this.states }); }
  }

  const CompletionPolicy = Object.freeze({
    canSucceed(facts) {
      return facts?.generationObserved === true
        && facts?.producerState === 'TERMINAL'
        && facts?.contentTerminal === true
        && facts?.ownership === 'CONFIRMED'
        && Array.isArray(facts?.activeVetoes)
        && facts.activeVetoes.length === 0;
    },
    evaluate(facts, meta = {}) {
      let status = null;
      let reason = null;
      if (facts?.contextLost) [status, reason] = ['CONTEXT_LOST', 'context_invalidated'];
      else if (facts?.interrupted) [status, reason] = ['INTERRUPTED', 'attempt_interrupted'];
      else if (facts?.providerError) [status, reason] = ['PROVIDER_ERROR', 'provider_error_visible'];
      else if (facts?.continueRequired) [status, reason] = ['CONTINUE_REQUIRED', 'continue_required'];
      else if (facts?.ownership === 'CONFLICT') [status, reason] = ['AMBIGUOUS', 'ownership_conflict'];
      else if (facts?.timeoutState) {
        // Stop still visible at the deadline: the provider is generating, the text stopped growing.
        // Not a stream timeout and not a success; the final status is UNCERTAIN (see FinalizationAdapter).
        const stopHeld = Array.isArray(facts.activeVetoes) && facts.activeVetoes.includes('ACTIVE_STOP');
        [status, reason] = ['STALLED', stopHeld ? 'stop_stalled' : `timeout_${String(facts.timeoutState).toLowerCase()}`];
      }
      else if (this.canSucceed(facts)) [status, reason] = ['SUCCESS_TERMINAL', 'all_terminal_facts_proven'];
      if (!status) return null;
      return freeze({
        status,
        attemptId: String(meta.attemptId || 'unknown-attempt'),
        decidedAt: Number(meta.decidedAt || Date.now()),
        reason,
        evidenceRefs: Array.from(new Set(meta.evidenceRefs || [])),
        ownership: meta.ownershipResult || undefined
      });
    }
  });

  class MaterializationHydrationGate {
    constructor(strategies = []) { this.strategies = Array.from(strategies || []); }
    async materialize(input) {
      const strategy = this.strategies.find((item) => item?.canHandle?.(input?.provider));
      if (strategy) return strategy.materialize(input);
      const before = await input.capture();
      await input.forceBottom?.();
      await input.expandDeferred?.();
      await input.waitForSettle?.();
      const after = await input.capture();
      const beforeHash = before?.contentHash || hashString(before?.text || '');
      const afterHash = after?.contentHash || hashString(after?.text || '');
      const beforeStructuralHash = before?.structuralHash || null;
      const afterStructuralHash = after?.structuralHash || null;
      return freeze({
        changed: beforeHash !== afterHash || (beforeStructuralHash != null && beforeStructuralHash !== afterStructuralHash),
        beforeHash, afterHash, beforeStructuralHash, afterStructuralHash,
        reason: 'generic_materialization_comparison', before, after
      });
    }
  }

  const ExtractionSnapshotFactory = Object.freeze({
    capture(terminalResult, verifiedSnapshot) {
      if (terminalResult?.status !== 'SUCCESS_TERMINAL') throw new Error('Extraction requires SUCCESS_TERMINAL');
      if (!verifiedSnapshot || typeof verifiedSnapshot.text !== 'string') throw new Error('Verified snapshot is required');
      const text = verifiedSnapshot.text;
      const html = String(verifiedSnapshot.html || '');
      const proof = verifiedSnapshot.answerVerification;
      return freeze({
        answerVerification: proof ? freeze(JSON.parse(JSON.stringify(proof))) : null,
        responseIdentity: freeze({ ...(verifiedSnapshot.responseIdentity || {}) }),
        text,
        html,
        contentHash: verifiedSnapshot.contentHash || hashString(text),
        structuralHash: verifiedSnapshot.structuralHash || hashString(html || text),
        capturedAt: Number(verifiedSnapshot.capturedAt || verifiedSnapshot.observedAt || terminalResult.decidedAt)
      });
    }
  });

  const RecoveryReconciler = Object.freeze({
    reconcile(persisted, current) {
      if (!persisted || !current || current.contextValid === false) return 'CONTEXT_LOST';
      const persistedContext = persisted.context || persisted;
      const currentContext = current.context || current;
      const keys = ['runSessionId', 'dispatchId', 'generationEpoch'];
      if (keys.some((key) => persistedContext[key] != null && currentContext[key] != null && String(persistedContext[key]) !== String(currentContext[key]))) return 'AMBIGUOUS';
      const persistedIdentity = persisted.responseIdentity || persisted.extractionSnapshot?.responseIdentity || persisted.ownershipResult?.responseIdentity || null;
      const currentIdentity = current.responseIdentity || current.extractionSnapshot?.responseIdentity || current.ownershipResult?.responseIdentity || null;
      if (persistedIdentity && currentIdentity
        && JSON.stringify(persistedIdentity) !== JSON.stringify(currentIdentity)) return 'AMBIGUOUS';
      return 'RESUME';
    }
  });

  const FinalizationAdapter = Object.freeze({
    toFinalStatus(terminalResult) {
      if (terminalResult?.status === 'STALLED' && terminalResult?.reason === 'stop_stalled') return 'UNCERTAIN';
      return ({
        SUCCESS_TERMINAL: 'COMPLETE',
        CONTINUE_REQUIRED: 'USER_ACTION_REQUIRED',
        PROVIDER_ERROR: 'EXTERNAL_LLM_FAILURE',
        INTERRUPTED: 'ERROR',
        STALLED: 'STREAM_TIMEOUT',
        AMBIGUOUS: 'UNCERTAIN',
        CONTEXT_LOST: 'UNCERTAIN'
      })[terminalResult?.status] || 'UNCERTAIN';
    },
    toCandidate(terminalResult, extractionSnapshot = null) {
      return freeze({
        status: this.toFinalStatus(terminalResult),
        finalStatus: this.toFinalStatus(terminalResult),
        dispatchId: extractionSnapshot?.responseIdentity?.dispatchId || null,
        trimmedAnswer: terminalResult?.status === 'SUCCESS_TERMINAL' ? String(extractionSnapshot?.text || '').trim() : '',
        completionTerminalResult: terminalResult || null
      });
    }
  });

  const CompletionRollout = Object.freeze({
    MODES: Object.freeze(['legacy', 'shadow', 'enforced']),
    normalize(mode) { return this.MODES.includes(mode) ? mode : 'enforced'; },
    permitsLegacyDelivery(mode) { return ['legacy', 'shadow'].includes(this.normalize(mode)); },
    evaluateLegacyCandidate(observations = {}) {
      const stable = observations.contentStable === true || observations.fingerprintStable === true;
      const corroborated = observations.transportTerminal === true
        || observations.regenerateVisible === true
        || observations.completionMarkerVisible === true
        || observations.copyButtonStable === true
        || observations.contentMutationStable === true;
      const accepted = observations.freshAnswerObserved === true
        && observations.vetoActive !== true
        && observations.stopVisible !== true
        && stable
        && corroborated;
      return freeze({
        accepted,
        reason: accepted ? 'legacy_corroborated_stable_candidate' : 'legacy_candidate_unproven',
        signals: Array.from(observations.signals || []),
        evaluatedAt: Number(observations.evaluatedAt || Date.now())
      });
    },
    compare({ legacySuccess = false, legacyCompletionReason = null, terminalResult = null, responseLength = 0, contentHash = null } = {}) {
      const v2TerminalStatus = terminalResult?.status || null;
      const v2Success = v2TerminalStatus === 'SUCCESS_TERMINAL';
      return freeze({
        legacySuccess: legacySuccess === true,
        v2TerminalStatus,
        legacyCompletionReason,
        v2Evidence: terminalResult?.evidenceRefs || [],
        responseLength: Number(responseLength || 0),
        contentHash,
        decisionDelta: legacySuccess === v2Success ? 'same' : (legacySuccess ? `legacy_success_v2_${v2TerminalStatus || 'non_terminal'}` : `legacy_non_success_v2_${v2TerminalStatus}`)
      });
    }
  });

  class CompletionSession {
    constructor(context, options = {}) {
      this.context = freeze({ ...(context || {}) });
      this.attemptId = String(options.attemptId || context?.dispatchId || `${context?.provider || 'attempt'}:${context?.promptSubmittedAt || Date.now()}`);
      this.rolloutMode = CompletionRollout.normalize(options.rolloutMode);
      this.onTransition = typeof options.onTransition === 'function' ? options.onTransition : null;
      this.ledger = new EvidenceLedger();
      this.producer = new ProducerGate({ confirmationWindowMs: options.confirmationWindowMs });
      this.timeouts = new TimeoutPolicy({ promptSubmittedAt: context?.promptSubmittedAt, ...options.timeouts });
      this.facts = {
        generationObserved: false, producerState: 'UNKNOWN', contentTerminal: false,
        ownership: 'UNKNOWN', activeVetoes: [], timeoutState: null,
        providerError: false, continueRequired: false, interrupted: false, contextLost: false
      };
      this.ownershipResult = null;
      this.capabilityHealth = new CompletionCapabilityHealth(options.capabilityHealth, (change) => {
        this.emitTransition('COMPLETION_CAPABILITY_HEALTH_CHANGED', change);
      });
      this.verifiedSnapshot = null;
      this.terminalResult = null;
      this.extractionSnapshot = null;
      this.interruptEvidence = null;
    }

    emitTransition(type, payload = {}) {
      if (!this.onTransition) return;
      try {
        this.onTransition(freeze({
          type,
          at: Date.now(),
          attemptId: this.attemptId,
          ...payload
        }));
      } catch (_) {}
    }

    emitFactTransitions(previous) {
      if (!previous.generationObserved && this.facts.generationObserved) {
        this.emitTransition('GENERATION_OBSERVED', { generationObserved: true });
      }
      if (previous.producerState !== this.facts.producerState) {
        if (previous.producerState === 'CANDIDATE' && this.facts.producerState === 'ACTIVE') {
          this.emitTransition('PRODUCER_CANDIDATE_REVOKED', { producerState: this.facts.producerState });
        }
        const eventType = ({ ACTIVE: 'PRODUCER_ACTIVE', CANDIDATE: 'PRODUCER_CANDIDATE', TERMINAL: 'PRODUCER_TERMINAL' })[this.facts.producerState];
        if (eventType) this.emitTransition(eventType, { producerState: this.facts.producerState });
      }
      const beforeVetoes = new Set(previous.activeVetoes || []);
      const afterVetoes = new Set(this.facts.activeVetoes || []);
      afterVetoes.forEach((veto) => {
        if (!beforeVetoes.has(veto)) this.emitTransition('VETO_ACTIVATED', { veto, activeVetoes: Array.from(afterVetoes) });
      });
      beforeVetoes.forEach((veto) => {
        if (!afterVetoes.has(veto)) this.emitTransition('VETO_CLEARED', { veto, activeVetoes: Array.from(afterVetoes) });
      });
    }

    observe(event) {
      if (this.terminalResult) return null;
      const previous = { ...this.facts, activeVetoes: this.facts.activeVetoes.slice() };
      const record = this.ledger.append(event);
      const type = record.type;
      if (['FRESH_RESPONSE_OBSERVED', 'GENERATION_ACTIVE', 'CONTENT_PROGRESS', 'RESPONSE_STRUCTURE_CHANGED'].includes(type)) {
        this.facts.generationObserved = true;
      }
      if (['CONTENT_PROGRESS', 'RESPONSE_STRUCTURE_CHANGED'].includes(type)) {
        this.timeouts.progress(record.observedAt);
        this.facts.contentTerminal = false;
        this.verifiedSnapshot = null;
      }
      this.facts.producerState = this.producer.observe(type, record.observedAt, record.seq);
      this.timeouts.producerActive(this.facts.producerState === 'ACTIVE', record.observedAt);
      if (type === 'PROVIDER_ERROR_VISIBLE') this.facts.providerError = true;
      if (type === 'CONTINUE_VISIBLE') this.facts.continueRequired = true;
      if (type === 'USER_INTERRUPTED') {
        // A stop while the page holds text the observer never saw ownership of is not a verdict on
        // this answer: defer it as CONTEXT_LOST (the router waits for the answer to settle).
        const textLength = Number(record.payload?.textLength || 0);
        this.interruptEvidence = { textLength, hardStopSetBy: record.payload?.hardStopSetBy || null };
        if (textLength > 0 && this.facts.ownership !== 'CONFIRMED') this.facts.contextLost = true;
        else this.facts.interrupted = true;
      }
      if (type === 'CONTEXT_INVALIDATED') this.facts.contextLost = true;
      if (type === 'NODE_REPLACED') this.confirmOwnership({ status: 'CONFLICT', reasons: ['node_replaced'], verifiedAt: record.observedAt });
      this.refreshVetoes();
      this.emitTransition('WITNESS_OBSERVED', { witnessType: type, evidenceSeq: record.seq });
      this.emitFactTransitions(previous);
      return record;
    }

    confirmOwnership(result) {
      const previous = { ...this.facts, activeVetoes: this.facts.activeVetoes.slice() };
      const status = OWNERSHIP_STATES.includes(result?.status) ? result.status : 'UNKNOWN';
      const reasons = Array.from(result?.reasons || []);
      const identityKey = JSON.stringify(result?.responseIdentity || null);
      const priorKey = JSON.stringify(this.ownershipResult?.responseIdentity || null);
      const changed = this.ownershipResult?.status !== status
        || identityKey !== priorKey
        || JSON.stringify(this.ownershipResult?.reasons || []) !== JSON.stringify(reasons);
      this.ownershipResult = freeze({ status, responseIdentity: result?.responseIdentity, reasons, verifiedAt: Number(result?.verifiedAt || Date.now()) });
      this.facts.ownership = status;
      this.refreshVetoes();
      if (changed) this.emitTransition(`OWNERSHIP_${status}`, { ownershipStatus: status, reasons: this.ownershipResult.reasons });
      this.emitFactTransitions(previous);
      return this.ownershipResult;
    }

    setContentVerification(verification, materialization, snapshot) {
      const previousTerminal = this.facts.contentTerminal;
      const terminal = verification?.stable === true
        && verification?.structurallyComplete === true
        && verification?.lengthRegressionRecovered === true
        && materialization?.changed === false;
      this.facts.contentTerminal = terminal;
      this.verifiedSnapshot = terminal ? freeze({ ...(snapshot || verification?.snapshot || {}) }) : null;
      if (verification?.stable === true && materialization?.changed !== true) this.emitTransition('CONTENT_STABILITY_PASSED', { contentTerminal: terminal });
      if ((previousTerminal && !terminal) || materialization?.changed === true || verification?.stable === false) {
        this.emitTransition('CONTENT_STABILITY_RESET', {
          contentTerminal: false,
          reason: materialization?.changed === true ? 'materialization_changed' : 'verification_reset'
        });
      }
      if (!previousTerminal && terminal) this.emitTransition('CONTENT_TERMINAL', { contentTerminal: true });
      return terminal;
    }

    refreshVetoes() {
      const vetoes = [];
      if (this.facts.producerState === 'ACTIVE') vetoes.push('ACTIVE_GENERATION');
      if (this.ledger.getLatest('STOP_VISIBLE')?.seq > (this.ledger.getLatest('STOP_ABSENT')?.seq || 0)) vetoes.push('ACTIVE_STOP');
      if (this.facts.providerError) vetoes.push('PROVIDER_ERROR');
      if (this.facts.continueRequired) vetoes.push('CONTINUE_REQUIRED');
      if (this.facts.ownership === 'CONFLICT') vetoes.push('OWNERSHIP_CONFLICT');
      if (this.facts.contextLost) vetoes.push('CONTEXT_INVALID');
      this.facts.activeVetoes = vetoes;
      return vetoes;
    }

    evaluate(now = Date.now()) {
      if (this.terminalResult) return this.terminalResult;
      const previous = { ...this.facts, activeVetoes: this.facts.activeVetoes.slice() };
      this.facts.producerState = this.producer.evaluate(now);
      this.facts.timeoutState = this.facts.timeoutState || this.timeouts.evaluate(now);
      this.refreshVetoes();
      this.emitFactTransitions(previous);
      if (!previous.timeoutState && this.facts.timeoutState) {
        this.emitTransition(`TIMEOUT_${this.facts.timeoutState}`, { timeoutState: this.facts.timeoutState });
      }
      const result = CompletionPolicy.evaluate(this.facts, {
        attemptId: this.attemptId, decidedAt: now, evidenceRefs: this.ledger.refs(), ownershipResult: this.ownershipResult
      });
      if (result) {
        this.terminalResult = result;
        this.emitTransition('TERMINAL_DECISION', {
          terminalResult: result,
          reason: result.reason,
          hardStopSetBy: this.interruptEvidence?.hardStopSetBy || null,
          interruptTextLength: this.interruptEvidence?.textLength ?? null
        });
        if (result.status === 'SUCCESS_TERMINAL') {
          this.extractionSnapshot = ExtractionSnapshotFactory.capture(result, this.verifiedSnapshot);
          this.emitTransition('EXTRACTION_SNAPSHOT_CAPTURED', {
            contentHash: this.extractionSnapshot.contentHash,
            structuralHash: this.extractionSnapshot.structuralHash,
            capturedAt: this.extractionSnapshot.capturedAt
          });
        }
      }
      return result;
    }

    snapshot() {
      return freeze({ context: this.context, rolloutMode: this.rolloutMode, facts: { ...this.facts, activeVetoes: this.facts.activeVetoes.slice() }, capabilityHealth: this.capabilityHealth.snapshot(), evidence: this.ledger.snapshot(), terminalResult: this.terminalResult, extractionSnapshot: this.extractionSnapshot });
    }
  }

  return Object.freeze({
    version: PROTOCOL_VERSION,
    TERMINAL_STATUSES, PRODUCER_STATES, OWNERSHIP_STATES, VETO_TYPES, WITNESS_TYPES,
    EvidenceLedger, ProducerGate, MutationClassifier, TimeoutPolicy, CompletionCapabilityHealth, CompletionPolicy,
    MaterializationHydrationGate, ExtractionSnapshotFactory, RecoveryReconciler, FinalizationAdapter, CompletionRollout,
    CompletionSession, hashString
  });
});
