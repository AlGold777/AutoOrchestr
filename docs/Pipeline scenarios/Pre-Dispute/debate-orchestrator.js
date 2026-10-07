// DebateOrchestrator — lifecycle owner for one discussion run (Orchestrator Contract v1.0).
// Planner decides. Orchestrator coordinates. Executor executes.
(function initDebateOrchestrator(root) {
  'use strict';

  const LIFECYCLE = Object.freeze({
    CREATED: 'CREATED', STARTING: 'STARTING', RUNNING: 'RUNNING',
    PAUSE_REQUESTED: 'PAUSE_REQUESTED', QUIESCING: 'QUIESCING', PAUSED: 'PAUSED',
    RECONCILING: 'RECONCILING', FINALIZING: 'FINALIZING',
    COMPLETED: 'COMPLETED', CANCELLED: 'CANCELLED', FAILED: 'FAILED'
  });

  const TERMINAL = new Set([LIFECYCLE.COMPLETED, LIFECYCLE.CANCELLED, LIFECYCLE.FAILED]);
  const NO_LEASE_RENEWAL = new Set([LIFECYCLE.PAUSED, ...TERMINAL]);

  const arr = (value) => Array.isArray(value) ? value : [];
  const clone = (value) => value == null ? value : JSON.parse(JSON.stringify(value));

  function createOrchestrator(deps = {}) {
    const planner = deps.planner;
    const executor = deps.executor;
    const revisions = deps.revisionStore;
    if (!planner || typeof planner.evaluate !== 'function') throw new Error('Orchestrator requires a Planner');
    if (!executor || typeof executor.execute !== 'function') throw new Error('Orchestrator requires a StageExecutor');
    if (!revisions) throw new Error('Orchestrator requires a PlanRevision store');
    const now = deps.now || (() => Date.now());
    const nowIso = () => new Date(now()).toISOString();
    const leaseTtlMs = Number(deps.leaseTtlMs || 30000);
    const leaseHeartbeatMs = Math.max(1, Number(
      deps.leaseHeartbeatMs || Math.floor(leaseTtlMs / 3) || 1
    ));
    const scheduleInterval = deps.setInterval || (typeof setInterval === 'function' ? setInterval : null);
    const cancelInterval = deps.clearInterval || (typeof clearInterval === 'function' ? clearInterval : null);
    const ownerId = String(deps.ownerId || `owner-${Math.random().toString(36).slice(2, 10)}`);
    const persistence = deps.persistence || createMemoryPersistence();
    const semanticStore = deps.semanticStore || null;
    const commitStateDelta = deps.commitStateDelta || null;
    const projectStateMap = deps.projectStateMap || ((state) => state.stateMap);

    // ---- Persistent run state (event-sourced; snapshot is a materialized checkpoint) ----
    const state = {
      runId: '',
      lifecycle: LIFECYCLE.CREATED,
      caseVersion: 0,
      debateCase: null,
      stateMap: {},
      openGoals: [],
      stages: [],           // StageInstances (all)
      events: [],           // append-only event log
      eventSequence: 0,
      decisions: {},        // planningDecisionId -> decision (idempotent commit)
      participantStatus: {}, // participantId -> runtime availability projection
      configuredParticipants: [],
      activeParticipants: [],
      droppedParticipants: [],
      pendingInterventions: [],
      lateResponses: [],
      pausePolicy: null,
      finalization: null,
      totalStagesExecuted: 0,
      usage: { modelCalls: 0, humanWaits: 0, retryAttempts: 0, corrections: 0, estimatedCost: 0 },
      stagnationSignals: { consecutiveNoStateDelta: 0, unchangedStateMapCount: 0, repeatedActionCount: 0 },
      recentActionFingerprints: []
    };
    let lease = null;
    let tickInFlight = false;
    let quiescePromise = null;
    let commitPortMissingSignalled = false;
    const createAbortController = () => deps.AbortController
      ? new deps.AbortController()
      : (typeof AbortController !== 'undefined' ? new AbortController() : null);
    let abortController = createAbortController();

    function createMemoryPersistence() {
      const store = { events: [], snapshots: [], lease: null, lastPublishedSequence: 0 };
      return {
        appendEvent: (event) => { store.events.push(clone(event)); },
        loadEvents: (afterSequence = 0) => store.events.filter((e) => e.eventSequence > afterSequence).map(clone),
        saveSnapshot: (snapshot) => { store.snapshots.push(clone(snapshot)); },
        loadLatestSnapshot: () => clone(store.snapshots[store.snapshots.length - 1] || null),
        loadRecoveryCheckpoint: () => clone(store.events.slice().reverse().find((event) => event.type === 'RUN_STATE_CHECKPOINTED')?.payload?.snapshot || null),
        readLastPublishedSequence: () => store.lastPublishedSequence,
        markPublished: (sequence) => { store.lastPublishedSequence = Math.max(store.lastPublishedSequence, Number(sequence || 0)); return store.lastPublishedSequence; },
        readLease: () => clone(store.lease),
        writeLease: (value) => { store.lease = clone(value); return true; },
        compareAndSetLease: (expectedVersion, value) => {
          if (Number(store.lease?.leaseRevision || store.lease?.version || 0) !== Number(expectedVersion || 0)) return false;
          store.lease = clone(value);
          return true;
        }
      };
    }

    const fatal = (reason, detail) => {
      state.lifecycle = LIFECYCLE.FAILED;
      emit('RUN_FAILED', { reason, detail, fatal: true });
      return { ok: false, fatal: true, reason };
    };

    function publishPersistedEvent(event) {
      const cursor = Number(persistence.readLastPublishedSequence?.() || 0);
      if (Number(event.eventSequence) <= cursor) return false;
      try {
        const published = deps.emit?.(event.type, event);
        if (published && typeof published.then === 'function') {
          published.then(() => persistence.markPublished?.(event.eventSequence)).catch(() => {});
        } else {
          persistence.markPublished?.(event.eventSequence);
        }
        return true;
      } catch (_) {
        return false;
      }
    }

    function emit(type, payload = {}) {
      state.eventSequence += 1;
      const event = {
        eventId: `${state.runId}:${state.eventSequence}`,
        eventSequence: state.eventSequence,
        runId: state.runId,
        ownerId,
        caseVersion: state.caseVersion,
        planRevisionId: revisions.getActive?.()?.revisionId || null,
        type,
        payload: clone(payload),
        timestamp: nowIso()
      };
      state.events.push(event);
      persistence.appendEvent(event);
      publishPersistedEvent(event);
      return event;
    }

    function initializeParticipants(participants = []) {
      state.configuredParticipants = arr(participants).map((participant) => String(participant?.participantId || '')).filter(Boolean);
      state.droppedParticipants = state.configuredParticipants
        .filter((participantId) => state.participantStatus[participantId]?.available === false)
        .map((participantId) => ({ participantId, ...clone(state.participantStatus[participantId]) }));
      const dropped = new Set(state.droppedParticipants.map((participant) => participant.participantId));
      state.activeParticipants = state.configuredParticipants.filter((participantId) => !dropped.has(participantId));
    }

    // ---- Lease (§6) ----
    function notifyLease(change) {
      try { deps.onLeaseChange?.(clone(change)); } catch (_) {}
      try { persistence.publishLeaseChange?.(clone(change)); } catch (_) {}
    }
    async function acquireLease() {
      const existing = persistence.readLease?.();
      const expired = !existing || existing.expiresAt <= now() || existing.ownerId === ownerId;
      if (!expired) return { ok: false, code: 'LEASE_HELD', holder: existing.ownerId };
      if (typeof persistence.acquireExclusiveLease === 'function' && !(await persistence.acquireExclusiveLease())) {
        return { ok: false, code: 'LEASE_HELD' };
      }
      const latest = persistence.readLease?.();
      if (latest && latest.expiresAt > now() && latest.ownerId !== ownerId) {
        persistence.releaseExclusiveLease?.();
        return { ok: false, code: 'LEASE_HELD', holder: latest.ownerId };
      }
      const previousRevision = Number(latest?.leaseRevision || latest?.version || existing?.leaseRevision || existing?.version || 0);
      lease = {
        runId: state.runId, ownerId,
        acquiredAt: now(), expiresAt: now() + leaseTtlMs,
        leaseRevision: previousRevision + 1,
        // `version` remains for stored snapshots created before leaseRevision.
        version: previousRevision + 1
      };
      const committed = typeof persistence.compareAndSetLease === 'function'
        ? persistence.compareAndSetLease(previousRevision, lease)
        : persistence.writeLease?.(lease);
      if (!committed) { lease = null; persistence.releaseExclusiveLease?.(); return { ok: false, code: 'LEASE_RACE' }; }
      notifyLease({ type: 'LEASE_ACQUIRED', lease });
      return { ok: true, lease };
    }
    function renewLease() {
      if (!lease || NO_LEASE_RENEWAL.has(state.lifecycle)) return false;
      const current = persistence.readLease?.();
      if (!current || current.ownerId !== ownerId
        || Number(current.leaseRevision || current.version || 0) !== Number(lease.leaseRevision || lease.version || 0)) {
        lease = null;
        return false;
      }
      lease = { ...lease, expiresAt: now() + leaseTtlMs };
      const renewed = typeof persistence.compareAndSetLease === 'function'
        ? persistence.compareAndSetLease(Number(current.leaseRevision || current.version || 0), lease)
        : persistence.writeLease?.(lease);
      if (!renewed) { lease = null; return false; }
      notifyLease({ type: 'LEASE_RENEWED', lease });
      return true;
    }
    function startLeaseHeartbeat() {
      if (!scheduleInterval || !cancelInterval) return () => {};
      const timer = scheduleInterval(() => {
        if (!lease || NO_LEASE_RENEWAL.has(state.lifecycle)) return;
        if (!renewLease()) handleLeaseLost('lease_renewal_failed_during_stage');
      }, leaseHeartbeatMs);
      timer?.unref?.();
      return () => cancelInterval(timer);
    }
    function assertLease() {
      const current = persistence.readLease?.();
      if (!current || !lease || current.ownerId !== ownerId || current.expiresAt <= now()
        || Number(current.leaseRevision || current.version || 0) !== Number(lease.leaseRevision || lease.version || 0)) {
        return { ok: false, code: 'LEASE_LOST' };
      }
      return { ok: true };
    }
    function releaseLease(reason = 'released') {
      const current = persistence.readLease?.();
      if (!lease || !current || current.ownerId !== ownerId
        || Number(current.leaseRevision || current.version || 0) !== Number(lease.leaseRevision || lease.version || 0)) {
        lease = null;
        return false;
      }
      const released = { ...lease, releasedAt: now(), releaseReason: reason };
      const committed = typeof persistence.compareAndSetLease === 'function'
        ? persistence.compareAndSetLease(Number(lease.leaseRevision || lease.version || 0), null)
        : persistence.writeLease?.(null);
      lease = null;
      persistence.releaseExclusiveLease?.();
      if (!committed) return false;
      notifyLease({ type: 'LEASE_RELEASED', lease: released });
      return true;
    }
    function handleLeaseLost(reason = 'lease_lost') {
      if (state.lifecycle === LIFECYCLE.RUNNING || state.lifecycle === LIFECYCLE.STARTING) {
        abortController?.abort?.(reason);
        state.lifecycle = LIFECYCLE.PAUSED;
        // A fenced owner is read-only: retain a local diagnostic without
        // appending to the shared event log or advancing its sequence.
        state.events.push({
          type: 'LEASE_LOST',
          payload: { reason },
          at: now(),
          sequence: state.eventSequence,
          localOnly: true
        });
      }
      lease = null;
      persistence.releaseExclusiveLease?.();
      return { ok: false, code: 'LEASE_LOST' };
    }

    persistence.subscribeLeaseChange?.((change) => {
      const next = change?.lease;
      if (change?.type === 'LEASE_ACQUIRED' && lease && next?.ownerId && next.ownerId !== ownerId) {
        handleLeaseLost('cross_context_invalidation');
      }
    });

    // ---- Snapshot (§15) ----
    function buildSnapshot() {
      return {
        runId: state.runId,
        snapshotVersion: 3,
        eventSequence: state.eventSequence,
        debateCase: clone(state.debateCase),
        activePlanRevisionId: revisions.getActive?.()?.revisionId || null,
        revisions: revisions.getLineage?.().map(clone) || [],
        activeStages: clone(state.stages.filter((s) => !['completed', 'failed', 'cancelled', 'stale'].includes(s.status))),
        stages: clone(state.stages),
        openGoals: clone(state.openGoals),
        runLifecycle: state.lifecycle,
        caseVersion: state.caseVersion,
        stateMap: clone(state.stateMap),
        participantStatus: clone(state.participantStatus),
        configuredParticipants: clone(state.configuredParticipants),
        activeParticipants: clone(state.activeParticipants),
        droppedParticipants: clone(state.droppedParticipants),
        pendingHumanDecision: clone(state.pendingHumanDecision || null),
        totalStagesExecuted: state.totalStagesExecuted,
        usage: clone(state.usage),
        stagnationSignals: clone(state.stagnationSignals),
        createdAt: nowIso()
      };
    }

    function validRecoverySnapshot(snapshot) {
      return Boolean(snapshot && String(snapshot.runId || '')
        && Number.isFinite(Number(snapshot.eventSequence))
        && snapshot.debateCase && typeof snapshot.debateCase === 'object'
        && Array.isArray(snapshot.openGoals)
        && Array.isArray(snapshot.stages || snapshot.activeStages));
    }

    function hydrateSnapshot(snapshot) {
      state.runId = snapshot.runId;
      state.debateCase = clone(snapshot.debateCase);
      state.caseVersion = Number(snapshot.caseVersion ?? snapshot.debateCase?.caseVersion ?? 0);
      state.stateMap = projectStateMap(state) || clone(snapshot.stateMap || {});
      state.participantStatus = clone(snapshot.participantStatus || {});
      state.configuredParticipants = clone(snapshot.configuredParticipants || []);
      state.activeParticipants = clone(snapshot.activeParticipants || []);
      state.droppedParticipants = clone(snapshot.droppedParticipants || []);
      state.pendingHumanDecision = clone(snapshot.pendingHumanDecision || null);
      if (!state.configuredParticipants.length) initializeParticipants(state.debateCase?.participants);
      state.openGoals = clone(snapshot.openGoals || []);
      state.stages = clone(snapshot.stages || snapshot.activeStages || []);
      state.eventSequence = Number(snapshot.eventSequence || 0);
      state.totalStagesExecuted = Number(snapshot.totalStagesExecuted || 0);
      state.usage = { ...state.usage, ...(clone(snapshot.usage || {})) };
      state.stagnationSignals = clone(snapshot.stagnationSignals) || state.stagnationSignals;
      state.lifecycle = snapshot.runLifecycle;
      revisions.hydrate?.({ revisions: snapshot.revisions || [] });
    }

    function persistRecoveryPoint(reason) {
      const snapshot = buildSnapshot();
      snapshot.eventSequence = state.eventSequence + 1;
      snapshot.createdAt = nowIso();
      emit('RUN_STATE_CHECKPOINTED', { reason, snapshot });
      return snapshot;
    }

    function republishUnpublished(events) {
      const cursor = Number(persistence.readLastPublishedSequence?.() || 0);
      events.filter((event) => Number(event.eventSequence) > cursor)
        .sort((a, b) => Number(a.eventSequence) - Number(b.eventSequence))
        .forEach(publishPersistedEvent);
    }

    // ---- Planner tick (§9) ----
    function plannerInput() {
      const active = revisions.getActive?.();
      return {
        runId: state.runId,
        caseVersion: state.caseVersion,
        activePlanRevisionId: active?.revisionId,
        activePlanRevision: active,
        debateCase: state.debateCase,
        stateMap: state.stateMap,
        openGoals: clone(state.openGoals),
        resolvedGoals: [],
        activeStages: clone(state.stages.filter((s) => !['completed', 'failed', 'cancelled', 'stale'].includes(s.status))),
        stageHistory: clone(state.stages),
        availableParticipants: arr(state.debateCase?.participants).map((p) => ({
          participantId: p.participantId, type: p.type || 'llm', provider: p.provider,
          capabilities: p.capabilities || [],
          serviceOnly: p.serviceOnly === true,
          available: p.available !== false && state.participantStatus[p.participantId]?.available !== false,
          capacity: p.capacity ?? 1
        })),
        participantCapabilities: Object.fromEntries(arr(state.debateCase?.participants).map((p) => [p.participantId, p.capabilities || []])),
        policies: state.debateCase?.policies || {},
        budgets: state.debateCase?.policies?.budgets || {},
        totalStagesExecuted: state.totalStagesExecuted,
        totalModelCalls: state.usage.modelCalls,
        humanWaits: state.usage.humanWaits,
        retryAttempts: state.usage.retryAttempts,
        totalCorrections: state.usage.corrections,
        contextTokens: Number(state.stateMap?.contextTokensEstimate || 0),
        estimatedCost: state.usage.estimatedCost,
        stagnationSignals: clone(state.stagnationSignals),
        recentActionFingerprints: state.recentActionFingerprints.slice(),
        pendingHumanDecision: clone(state.pendingHumanDecision || null),
        ruleSetVersion: planner.ruleSetVersion,
        currentTime: nowIso()
      };
    }

    async function plannerTick() {
      if (state.lifecycle !== LIFECYCLE.RUNNING) return { ok: false, code: 'NOT_RUNNING' };
      if (tickInFlight) return { ok: false, code: 'TICK_IN_FLIGHT' };
      const leaseCheck = assertLease();
      if (!leaseCheck.ok) return leaseCheck;
      tickInFlight = true;
      try {
        emit('PLANNING_STARTED', {});
        const input = plannerInput();
        let decision;
        try {
          decision = planner.evaluate(input);
        } catch (error) {
          emit('PLANNING_FAILED', { reason: error?.message });
          return { ok: false, code: 'PLANNING_FAILED', reason: error?.message };
        }
        // Stale check (§9.2): versions must be unchanged at commit time.
        const projectionIdentity = {
          sourceCaseVersion: Number(state.stateMap?.sourceCaseVersion ?? state.caseVersion),
          projectorVersion: Number(state.stateMap?.projectorVersion || state.stateMap?.version || 0)
        };
        if (decision.inputCaseVersion !== state.caseVersion
          || JSON.stringify(decision.inputStateMapIdentity || {}) !== JSON.stringify(projectionIdentity)
          || decision.inputPlanRevisionId !== revisions.getActive?.()?.revisionId) {
          emit('PLANNING_DECISION_STALE', { decisionId: decision.decisionId });
          return { ok: false, code: 'PLANNING_DECISION_STALE' };
        }
        if (state.lifecycle !== LIFECYCLE.RUNNING) {
          emit('PLANNING_DECISION_STALE', { decisionId: decision.decisionId, reason: 'lifecycle_changed' });
          return { ok: false, code: 'PLANNING_DECISION_STALE' };
        }
        if (state.decisions[decision.decisionId]) {
          return { ok: true, decision: state.decisions[decision.decisionId], deduplicated: true };
        }
        state.decisions[decision.decisionId] = decision;
        emit('PLANNING_COMPLETED', { decisionId: decision.decisionId, type: decision.type, rationaleCode: decision.rationaleCode });
        return { ok: true, decision };
      } finally {
        tickInFlight = false;
      }
    }

    // ---- Stage creation (§10) ----
    function createStages(decision) {
      const active = revisions.getActive?.();
      const created = [];
      for (const proposed of arr(decision.proposedStages)) {
        const stageInstanceId = `stage-${state.runId}-${state.stages.length + created.length + 1}`;
        // Idempotent creation: one stage per (decisionId, proposedStageId).
        const duplicate = state.stages.find((s) => s.createdByDecisionId === decision.decisionId && s.proposedStageId === proposed.proposedStageId);
        if (duplicate) { created.push(duplicate); continue; }
        const stage = {
          stageInstanceId,
          proposedStageId: proposed.proposedStageId,
          plannedStageId: proposed.plannedStageId || null,
          runId: state.runId,
          planRevisionId: active?.revisionId,
          createdByDecisionId: decision.decisionId,
          goalIds: arr(proposed.goalIds),
          purpose: proposed.purpose,
          participants: arr(proposed.participantIds).map((id) => {
            const definition = arr(state.debateCase?.participants).find((p) => p.participantId === id);
            const binding = arr(proposed.participantBindings).find((item) => item?.participantId === id) || {};
            return { participantId: id, type: definition?.type || 'llm', model: definition?.model || id, promptId: binding.promptId || null };
          }),
          inputArtifactIds: arr(proposed.inputArtifactIds),
          expectedOutputs: arr(proposed.expectedArtifactTypes),
          dispatchMode: proposed.dispatchMode || 'single',
          completionMode: proposed.completionMode || 'all',
          visibilityPolicy: proposed.visibilityPolicy || { mode: 'public' },
          outputIntent: proposed.outputIntent,
          terminalPolicy: proposed.terminalPolicy,
          auditPolicy: proposed.auditPolicy,
          inputSelector: proposed.inputSelector,
          status: 'pending',
          attempt: 1
        };
        state.stages.push(stage);
        created.push(stage);
        emit('STAGE_CREATED', { stageInstanceId, decisionId: decision.decisionId, purpose: stage.purpose, participants: stage.participants.map((p) => p.participantId) });
        stage.goalIds.forEach((goalId) => {
          const goal = state.openGoals.find((g) => g.goalId === goalId);
          if (goal) goal.status = 'assigned';
        });
      }
      return created;
    }

    function operationReceipt(change, result, delta, deltaIndex, stage, batchDuplicate) {
      const duplicate = result?.duplicate === true || (result == null && batchDuplicate === true);
      const explicitGoalIds = arr(delta?.goalIds);
      return {
        deltaIndex,
        deltaId: String(delta?.deltaId || ''),
        kind: String(change?.kind || 'STATE_DELTA'),
        artifactId: String(change?.artifact?.id || change?.artifactId || result?.receipt?.result?.details?.artifactId || ''),
        artifactType: String(change?.artifact?.type || result?.receipt?.result?.details?.artifactType || ''),
        artifactStatus: String(change?.artifact?.status || result?.receipt?.result?.details?.after?.status || ''),
        targetId: String(change?.targetId || change?.artifact?.targetId || result?.receipt?.result?.details?.targetId || ''),
        goalIds: explicitGoalIds.length ? explicitGoalIds.slice() : arr(stage?.goalIds),
        goalLink: explicitGoalIds.length ? 'explicit_delta' : 'stage_candidate',
        duplicate,
        changed: !duplicate
      };
    }

    const GOAL_ARTIFACT_TYPES = Object.freeze({
      establish_position: ['claim'],
      verify_claim: ['evidence', 'axis_verdict', 'audit'],
      verify_evidence: ['evidence', 'axis_verdict', 'audit'],
      resolve_objection: ['revision', 'human_decision'],
      resolve_contradiction: ['revision', 'human_decision'],
      answer_open_question: ['revision', 'finding', 'human_decision'],
      examine_dissent: ['dissent', 'revision', 'human_decision'],
      test_revision: ['objection', 'evidence', 'axis_verdict'],
      recheck_conclusion: ['evidence', 'audit', 'axis_verdict'],
      compact_context: ['finding'],
      produce_synthesis: ['synthesis_conclusion'],
      correct_synthesis: ['synthesis_conclusion'],
      audit_output: ['audit'],
      request_human_judgment: ['human_decision']
    });
    const GOALS_REQUIRING_TARGET = new Set([
      'verify_claim', 'verify_evidence', 'resolve_objection', 'resolve_contradiction',
      'answer_open_question', 'examine_dissent', 'test_revision', 'recheck_conclusion',
      'correct_synthesis', 'audit_output'
    ]);

    function operationSatisfiesGoal(operation, goal) {
      if (!operation?.changed || !arr(operation.goalIds).includes(goal.goalId)) return false;
      const criteria = goal.acceptanceCriteria && typeof goal.acceptanceCriteria === 'object'
        ? goal.acceptanceCriteria
        : {};
      const allowedTypes = arr(criteria.artifactTypes).length
        ? arr(criteria.artifactTypes)
        : (GOAL_ARTIFACT_TYPES[goal.type] || []);
      if (!allowedTypes.length || !allowedTypes.includes(operation.artifactType)) return false;
      const requiredTargets = arr(criteria.targetArtifactIds).length
        ? arr(criteria.targetArtifactIds)
        : arr(goal.targetArtifactIds);
      const artifactCollection = Array.isArray(state.debateCase?.artifacts)
        ? state.debateCase.artifacts
        : Object.values(state.debateCase?.artifacts || {});
      const targetArtifact = artifactCollection.find((artifact) => artifact.id === operation.targetId);
      const targetMatches = requiredTargets.includes(operation.targetId)
        || requiredTargets.includes(targetArtifact?.targetId);
      if (requiredTargets.length && GOALS_REQUIRING_TARGET.has(goal.type)
        && !targetMatches) return false;
      const allowedStatuses = arr(criteria.artifactStatuses);
      if (allowedStatuses.length && !allowedStatuses.includes(operation.artifactStatus)) return false;
      if (goal.type === 'audit_output' && operation.artifactStatus !== 'verified') return false;
      return true;
    }

    function evaluateGoalOutcome(goal, beforeStateMap, afterStateMap, commitReport) {
      const evaluator = planner?.evaluateDerivedGoalCondition;
      if (typeof evaluator === 'function') {
        const inputBase = {
          debateCase: state.debateCase,
          openGoals: state.openGoals,
          activeStages: state.stages,
          activePlanRevision: revisions.getActive?.(),
          policies: state.debateCase?.policies || {},
          currentTime: nowIso()
        };
        const before = evaluator(goal, { ...inputBase, stateMap: beforeStateMap });
        const after = evaluator(goal, { ...inputBase, stateMap: afterStateMap });
        if (after?.evaluable && after.active === false) {
          return {
            goalId: goal.goalId,
            outcome: 'satisfied',
            reason: after.reason,
            conditionWasActive: before?.evaluable ? before.active : null
          };
        }
        if (after?.evaluable) {
          const relatedChange = arr(commitReport.operations)
            .some((operation) => operation.changed && arr(operation.goalIds).includes(goal.goalId));
          return {
            goalId: goal.goalId,
            outcome: relatedChange ? 'progressed' : 'not_satisfied',
            reason: relatedChange ? 'related_state_change_without_clearing_condition' : after.reason,
            conditionWasActive: before?.evaluable ? before.active : null
          };
        }
      }
      const satisfyingOperation = arr(commitReport.operations).find((operation) => operationSatisfiesGoal(operation, goal));
      if (satisfyingOperation) {
        return {
          goalId: goal.goalId,
          outcome: 'satisfied',
          reason: 'acceptance_criterion_matched',
          artifactId: satisfyingOperation.artifactId,
          artifactType: satisfyingOperation.artifactType
        };
      }
      const relatedChange = arr(commitReport.operations).some((operation) =>
        operation.changed && arr(operation.goalIds).includes(goal.goalId));
      return {
        goalId: goal.goalId,
        outcome: relatedChange ? 'progressed' : 'not_satisfied',
        reason: relatedChange ? 'acceptance_criterion_not_met' : 'no_goal_linked_state_change'
      };
    }

    // ---- Commit transaction (§12) ----
    async function commitStageResult(stage, result) {
      // Atomic semantic commit: artifacts + goal update + case version + terminal status.
      for (const failure of arr(result.terminalFailures)) {
        const participantId = String(failure.participantId || '');
        if (!participantId || state.participantStatus[participantId]?.available === false) continue;
        state.participantStatus[participantId] = {
          available: false,
          terminal: true,
          reasonCode: failure.reasonCode || 'terminal_transport_failure',
          stageInstanceId: failure.stageId || stage.stageInstanceId,
          attemptId: failure.attemptId || '',
          recordedAt: nowIso()
        };
        initializeParticipants(state.debateCase?.participants);
        emit('PARTICIPANT_UNAVAILABLE', { participantId, ...state.participantStatus[participantId] });
      }
      const applied = [];
      const baseCaseVersion = state.caseVersion;
      const workingState = {
        ...state,
        debateCase: clone(state.debateCase),
        stateMap: clone(state.stateMap),
        caseVersion: baseCaseVersion
      };
      const beforeStateMap = clone(state.stateMap);
      const proposedDeltas = arr(result.proposedStateDeltas);
      const eligible = [];
      for (const delta of proposedDeltas) {
        emit('STATE_DELTA_PROPOSED', { stageInstanceId: stage.stageInstanceId, delta });
        const expected = delta.expectedCaseVersion;
        if (expected != null && Number(expected) !== Number(baseCaseVersion)) {
          emit('STATE_DELTA_STALE', { stageInstanceId: stage.stageInstanceId, expected, actual: baseCaseVersion, delta: clone(delta) });
        } else eligible.push(delta);
      }
      let semanticBatchHandled = false;
      let idempotentReplay = false;
      const commitReport = {
        accepted: eligible.length > 0,
        committed: false,
        changed: false,
        recoveryReplay: false,
        semanticNoOp: false,
        operations: []
      };
      if (semanticStore?.commit) {
        semanticBatchHandled = true;
        const envelopes = eligible.flatMap((delta, deltaIndex) => arr(delta.artifacts).map((artifact, artifactIndex) => ({
          delta,
          deltaIndex,
          change: {
            kind: 'UPSERT_ARTIFACT', artifact,
            correlationId: `${delta.deltaId || stage.stageInstanceId}:artifact:${artifact.id || artifactIndex}`,
            actor: delta.participantId || 'orchestrator'
          }
        })));
        const proposedConclusions = envelopes.filter((envelope) => envelope.change.artifact?.type === 'synthesis_conclusion');
        if (proposedConclusions.length === 1) {
          const replacement = proposedConclusions[0].change.artifact;
          const currentConclusion = Object.values(workingState.debateCase?.artifacts || {}).find((artifact) =>
            artifact.type === 'synthesis_conclusion' && artifact.id !== replacement.id
            && !artifact.supersededBy && !artifact.mergedInto
            && !['superseded', 'merged', 'rejected', 'withdrawn'].includes(artifact.status));
          if (currentConclusion) {
            envelopes.push({
              delta: proposedConclusions[0].delta,
              deltaIndex: proposedConclusions[0].deltaIndex,
              change: {
                kind: 'SUPERSEDE_ARTIFACT',
                artifactId: currentConclusion.id,
                targetId: replacement.id,
                expectedRevision: currentConclusion.revision,
                correlationId: `${proposedConclusions[0].change.correlationId}:supersede:${currentConclusion.id}`,
                actor: proposedConclusions[0].change.actor
              }
            });
          }
        }
        const changes = envelopes.map((envelope) => envelope.change);
        if (changes.length) {
          const committed = await semanticStore.commit({ expectedCaseVersion: baseCaseVersion, leaseRevision: lease?.leaseRevision, changes });
          if (committed.ok) {
            commitReport.committed = true;
            workingState.debateCase = clone(committed.case || semanticStore.getState?.() || workingState.debateCase);
            workingState.caseVersion = Number(committed.caseVersion ?? baseCaseVersion + changes.length);
            workingState.stateMap = projectStateMap(workingState) || workingState.stateMap;
            commitReport.operations = envelopes.map((envelope, index) =>
              operationReceipt(
                envelope.change,
                arr(committed.results)[index],
                envelope.delta,
                envelope.deltaIndex,
                stage,
                committed.duplicate
              ));
            commitReport.changed = commitReport.operations.some((operation) => operation.changed);
            idempotentReplay = commitReport.operations.length > 0
              && commitReport.operations.every((operation) => operation.duplicate);
            idempotentReplay = idempotentReplay || committed.duplicate === true;
            commitReport.recoveryReplay = idempotentReplay;
            const changedDeltaIndexes = new Set(commitReport.operations
              .filter((operation) => operation.changed)
              .map((operation) => operation.deltaIndex));
            applied.push(...eligible.filter((_, index) => changedDeltaIndexes.has(index)));
          } else {
            emit('STATE_DELTA_REJECTED', { stageInstanceId: stage.stageInstanceId, reason: committed.code || 'semantic_commit_rejected' });
          }
        } else if (eligible.length) {
          commitReport.semanticNoOp = true;
        }
      }
      for (const delta of semanticBatchHandled ? [] : eligible) {
        if (!commitStateDelta && !commitPortMissingSignalled) {
          commitPortMissingSignalled = true;
          emit('SEMANTIC_COMMIT_DEGRADED', { stageInstanceId: stage.stageInstanceId, reason: 'commit_port_missing' });
        }
        const outcome = commitStateDelta
          ? (commitStateDelta({ state: workingState, stage, delta }) || { applied: false, reason: 'commit_port_no_result' })
          : { applied: false, reason: 'commit_port_missing' };
        if (outcome.applied !== true) {
          if (outcome.reason === 'no_state_change') commitReport.semanticNoOp = true;
          emit('STATE_DELTA_REJECTED', { stageInstanceId: stage.stageInstanceId, reason: outcome.reason || 'commit_not_applied' });
          continue;
        }
        if (typeof outcome.changed !== 'boolean') {
          emit('SEMANTIC_COMMIT_CONTRACT_VIOLATION', {
            stageInstanceId: stage.stageInstanceId,
            reason: 'changed_boolean_required',
            deltaId: delta.deltaId || ''
          });
          emit('STATE_DELTA_REJECTED', { stageInstanceId: stage.stageInstanceId, reason: 'commit_change_undetermined' });
          continue;
        }
        if (!outcome.changed) {
          commitReport.committed = true;
          commitReport.semanticNoOp = true;
          workingState.stateMap = outcome.stateMap || workingState.stateMap;
          continue;
        }
        commitReport.committed = true;
        commitReport.changed = true;
        applied.push(delta);
        const artifacts = arr(delta.artifacts);
        const appliedIds = arr(outcome.appliedArtifactIds);
        const operationArtifacts = artifacts.length ? artifacts : appliedIds.map((id) => ({ id }));
        commitReport.operations.push(...(operationArtifacts.length ? operationArtifacts : [{}]).map((artifact) => ({
          deltaIndex: eligible.indexOf(delta),
          deltaId: String(delta.deltaId || ''),
          kind: 'UPSERT_ARTIFACT',
          artifactId: String(artifact?.id || ''),
          artifactType: String(artifact?.type || ''),
          artifactStatus: String(artifact?.status || ''),
          targetId: String(artifact?.targetId || ''),
          goalIds: arr(delta.goalIds).length ? arr(delta.goalIds) : arr(stage.goalIds),
          goalLink: arr(delta.goalIds).length ? 'explicit_delta' : 'stage_candidate',
          duplicate: false,
          changed: true
        })));
        workingState.stateMap = outcome.stateMap || projectStateMap(workingState) || workingState.stateMap;
      }
      const meaningful = commitReport.changed;
      emit('STATE_COMMIT_REPORTED', { stageInstanceId: stage.stageInstanceId, report: clone(commitReport) });
      if (meaningful) {
        state.debateCase = workingState.debateCase;
        state.stateMap = workingState.stateMap;
        state.caseVersion = semanticBatchHandled ? Number(workingState.caseVersion) : baseCaseVersion + 1;
        if (state.debateCase) state.debateCase.version = state.caseVersion;
        applied.forEach((delta) => emit('STATE_DELTA_APPLIED', {
          stageInstanceId: stage.stageInstanceId,
          deltaId: delta.deltaId || '',
          caseVersion: state.caseVersion,
          operations: commitReport.operations.filter((operation) => operation.deltaIndex === eligible.indexOf(delta))
        }));
        state.stagnationSignals.consecutiveNoStateDelta = 0;
        state.stagnationSignals.unchangedStateMapCount = 0;
      } else if (idempotentReplay) {
        emit('STATE_DELTA_REPLAYED', { stageInstanceId: stage.stageInstanceId, caseVersion: state.caseVersion });
      } else {
        state.stagnationSignals.consecutiveNoStateDelta += 1;
        state.stagnationSignals.unchangedStateMapCount += 1;
        emit('NO_STATE_CHANGE', { stageInstanceId: stage.stageInstanceId });
      }
      if (!idempotentReplay) {
        const fingerprint = `${stage.purpose}|${arr(stage.inputArtifactIds).join(',')}`;
        if (state.recentActionFingerprints.includes(fingerprint)) state.stagnationSignals.repeatedActionCount += 1;
        else state.stagnationSignals.repeatedActionCount = 0;
        state.recentActionFingerprints = [...state.recentActionFingerprints, fingerprint].slice(-6);
      }

      const goalEvaluations = [];
      stage.goalIds.forEach((goalId) => {
        const goal = state.openGoals.find((g) => g.goalId === goalId);
        if (!goal) return;
        const evaluation = evaluateGoalOutcome(goal, beforeStateMap, workingState.stateMap, commitReport);
        goalEvaluations.push(evaluation);
        goal.status = evaluation.outcome === 'satisfied' ? 'resolved' : 'open';
        emit('GOAL_EVALUATED', { stageInstanceId: stage.stageInstanceId, ...evaluation, status: goal.status });
      });
      stage.status = result.executionStatus === 'completed' ? 'completed'
        : result.executionStatus === 'partial' ? 'completed'
        : result.executionStatus === 'cancelled' ? 'cancelled' : 'failed';
      state.totalStagesExecuted += 1;
      const attempts = arr(result.attempts);
      state.usage.modelCalls += attempts.length || (arr(result.acceptedResponses).length + arr(result.failedParticipants).length);
      state.usage.retryAttempts += attempts.reduce((total, attempt) => total + Math.max(0, Number(attempt.attempts || 1) - 1), 0);
      emit('STAGE_COMPLETED', {
        stageInstanceId: stage.stageInstanceId,
        executionStatus: result.executionStatus,
        meaningfulDelta: meaningful,
        goalEvaluations
      });
      persistRecoveryPoint('stage_completed');
    }

    async function executeStage(stage) {
      if (stage.status !== 'pending') return null;
      const activeRevisionId = revisions.getActive?.()?.revisionId;
      if (stage.planRevisionId !== activeRevisionId) {
        stage.status = 'stale';
        emit('STAGE_STALE', { stageInstanceId: stage.stageInstanceId, reason: 'revision_superseded' });
        return null;
      }
      stage.status = 'running';
      emit('STAGE_STARTED', { stageInstanceId: stage.stageInstanceId });
      // Universal Production Wiring: executor needs the canonical state snapshot to
      // compile a real prompt / extract artifacts, not just an abort signal.
      const executionContext = {
        signal: abortController?.signal,
        debateCase: state.debateCase,
        stateMap: state.stateMap,
        openGoals: state.openGoals,
        constraints: arr(state.debateCase?.constraints),
        attachments: arr(state.debateCase?.attachments),
        caseVersion: state.caseVersion,
        stateMapIdentity: {
          sourceCaseVersion: Number(state.stateMap?.sourceCaseVersion ?? state.caseVersion),
          projectorVersion: Number(state.stateMap?.projectorVersion || state.stateMap?.version || 0)
        },
        planRevisionId: activeRevisionId
      };
      const stopLeaseHeartbeat = startLeaseHeartbeat();
      let result;
      try {
        result = await executor.execute(stage, executionContext);
      } finally {
        stopLeaseHeartbeat();
      }
      // A slow provider response must not be committed by a former owner after
      // another context has fenced it out or the lease has expired.
      const leaseCheck = assertLease();
      if (!leaseCheck.ok) {
        stage.status = 'stale';
        emit('STAGE_STALE', { stageInstanceId: stage.stageInstanceId, reason: 'lease_lost_after_dispatch' });
        return handleLeaseLost('lease_lost_after_dispatch');
      }
      if (result.executionStatus === 'awaiting_participant') {
        stage.status = 'awaiting_participant';
        emit('STAGE_AWAITING_PARTICIPANT', { stageInstanceId: stage.stageInstanceId, participants: result.awaitingParticipants });
        return result;
      }
      if (stage.resultDisposition === 'CANCEL' || stage.resultDisposition === 'IGNORE_RESULT' || stage.resultDisposition === 'RESTART') {
        stage.status = stage.resultDisposition === 'IGNORE_RESULT' ? 'stale' : 'cancelled';
        emit('STAGE_RESULT_DISCARDED', {
          stageInstanceId: stage.stageInstanceId,
          policy: stage.resultDisposition,
          replacementStageInstanceId: stage.replacementStageInstanceId || ''
        });
        return result;
      }
      // Pause policies (§13): finish_received_only rejects semantic commit of in-flight work.
      if (state.lifecycle === LIFECYCLE.QUIESCING && state.pausePolicy === 'finish_received_only') {
        state.lateResponses.push({ stageInstanceId: stage.stageInstanceId, result: clone(result) });
        stage.status = 'stale';
        emit('LATE_RESPONSE_RECORDED', { stageInstanceId: stage.stageInstanceId });
        return result;
      }
      if (stage.resultDisposition === 'CONVERT_TO_AUDIT') {
        const originalGoalIds = stage.goalIds.slice();
        stage.goalIds = [];
        await commitStageResult(stage, result);
        stage.goalIds = originalGoalIds;
        const artifactIds = arr(result.proposedStateDeltas).flatMap((delta) => arr(delta.artifacts).map((artifact) => artifact.id)).filter(Boolean);
        const auditStage = {
          ...clone(stage),
          stageInstanceId: `${stage.stageInstanceId}:audit`,
          proposedStageId: `${stage.proposedStageId || stage.stageInstanceId}:audit`,
          plannedStageId: null,
          planRevisionId: revisions.getActive?.()?.revisionId,
          purpose: 'audit',
          status: 'pending',
          goalIds: originalGoalIds,
          inputArtifactIds: artifactIds,
          expectedOutputs: ['audit'],
          dispatchMode: stage.participants.length > 1 ? 'parallel' : 'single',
          resultDisposition: null
        };
        state.stages.push(auditStage);
        emit('STAGE_CONVERTED_TO_AUDIT', {
          stageInstanceId: stage.stageInstanceId,
          auditStageInstanceId: auditStage.stageInstanceId,
          inputArtifactIds: artifactIds
        });
        if (state.lifecycle === LIFECYCLE.RUNNING) await executeStage(auditStage);
        return result;
      }
      await commitStageResult(stage, result);
      return result;
    }

    // ---- Main loop step: one tick + execution of created stages ----
    async function step() {
      const tick = await plannerTick();
      if (!tick.ok) return tick;
      const decision = tick.decision;
      switch (decision.type) {
        case 'CREATE_STAGES': {
          const stages = createStages(decision);
          for (const stage of stages) {
            if (state.lifecycle !== LIFECYCLE.RUNNING) break;
            const execution = await executeStage(stage);
            if (execution?.ok === false) return execution;
          }
          return { ok: true, decision, executed: stages.map((s) => s.stageInstanceId) };
        }
        case 'REQUEST_HUMAN_DECISION':
          emit('PLANNING_HUMAN_DECISION_REQUIRED', { request: decision.humanDecisionRequest });
          state.pendingHumanDecision = decision.humanDecisionRequest;
          state.usage.humanWaits += 1;
          persistRecoveryPoint('human_decision_requested');
          return { ok: true, decision };
        case 'FINALIZE':
          return finalize(decision.finalizationDecision || { reason: 'REQUIRED_GOALS_RESOLVED', finalizationMode: 'STATE_MAP' });
        case 'WAIT':
        case 'NO_OP':
          emit('PLANNING_NO_ACTION', { type: decision.type, rationaleCode: decision.rationaleCode });
          return { ok: true, decision };
        default:
          return fatal('UNKNOWN_DECISION_TYPE', decision.type);
      }
    }

    async function runLoop(maxSteps = 50) {
      let steps = 0;
      while (state.lifecycle === LIFECYCLE.RUNNING && steps < maxSteps) {
        steps += 1;
        if (!renewLease()) return handleLeaseLost('lease_renewal_failed');
        const outcome = await step();
        if (!outcome.ok) return outcome;
        const type = outcome.decision?.type;
        if (['WAIT', 'NO_OP', 'REQUEST_HUMAN_DECISION'].includes(type)) return outcome;
        if (state.finalization) return outcome;
      }
      return { ok: true, code: steps >= maxSteps ? 'STEP_BUDGET_REACHED' : 'STOPPED' };
    }

    // ---- Finalization (§18) ----
    function finalize(finalizationDecision) {
      if (state.finalization) {
        emit('DUPLICATE_FINALIZATION_REJECTED', {});
        return { ok: true, deduplicated: true, finalization: state.finalization };
      }
      state.lifecycle = LIFECYCLE.FINALIZING;
      emit('RUN_FINALIZATION_STARTED', { reason: finalizationDecision.reason, mode: finalizationDecision.finalizationMode });
      state.finalization = {
        ...finalizationDecision,
        finalStateMap: clone(state.stateMap),
        unresolvedGoalIds: state.openGoals.filter((g) => g.status !== 'resolved').map((g) => g.goalId),
        finalizedAt: nowIso()
      };
      state.lifecycle = LIFECYCLE.COMPLETED;
      emit('RUN_COMPLETED', { reason: finalizationDecision.reason });
      persistRecoveryPoint('run_completed');
      persistence.saveSnapshot(buildSnapshot());
      releaseLease('terminal_completed');
      return { ok: true, finalization: state.finalization };
    }

    // ---- Reconciliation shared by continue/recover (§14.2) ----
    async function reconcile() {
      state.lifecycle = LIFECYCLE.RECONCILING;
      emit('RECONCILING_STARTED', {});
      // Late responses: commit or discard against current revision.
      for (const late of state.lateResponses.splice(0)) {
        const stage = state.stages.find((s) => s.stageInstanceId === late.stageInstanceId);
        if (!stage) continue;
        if (stage.planRevisionId === revisions.getActive?.()?.revisionId) {
          await commitStageResult(stage, late.result);
          emit('LATE_RESPONSE_RECONCILED', { stageInstanceId: stage.stageInstanceId });
        } else {
          stage.status = 'stale';
          emit('LATE_RESPONSE_DISCARDED', { stageInstanceId: stage.stageInstanceId, reason: 'revision_superseded', delta: clone(late.result?.proposedStateDeltas || []) });
        }
      }
      // Interventions become goals/constraints before the next Planner tick (§16).
      for (const intervention of state.pendingInterventions.splice(0)) {
        await applyIntervention(intervention);
        emit('INTERVENTION_APPLIED', { interventionId: intervention.interventionId });
      }
      // Stage invalidation against active revision.
      const activeRevisionId = revisions.getActive?.()?.revisionId;
      for (const stage of state.stages) {
        if (['pending', 'awaiting_participant', 'running'].includes(stage.status) && stage.planRevisionId !== activeRevisionId) {
          stage.status = 'stale';
          stage.goalIds.forEach((goalId) => {
            const goal = state.openGoals.find((g) => g.goalId === goalId);
            if (goal && goal.status !== 'resolved') goal.status = 'open';
          });
          emit('STAGE_STALE', { stageInstanceId: stage.stageInstanceId, reason: 'reconciliation' });
        }
      }
      state.stateMap = projectStateMap(state) || state.stateMap;
      emit('RECONCILING_COMPLETED', {});
    }

    async function applyIntervention(intervention) {
      const payload = intervention.payload || {};
      const beforeCase = clone(state.debateCase);
      const beforeGoals = clone(state.openGoals);
      switch (intervention.type) {
        case 'ADD_CONSTRAINT':
          if (!semanticStore?.commit && state.debateCase) {
            state.debateCase.constraints = [...arr(state.debateCase.constraints), {
              ...(payload.constraint || {}),
              constraintId: String(payload.constraint?.constraintId || payload.constraint?.id || `constraint-${intervention.interventionId}`)
            }];
          }
          break;
        case 'CORRECT_FACT':
        case 'ADD_CLARIFICATION':
          state.usage.corrections += 1;
          state.openGoals.push({
            goalId: `goal-intervention-${intervention.interventionId}`,
            type: 'recheck_conclusion', targetArtifactIds: arr(payload.artifactIds),
            status: 'open', priority: 70, humanRequested: true,
            createdFromEventId: intervention.interventionId, createdAt: nowIso()
          });
          break;
        case 'REQUEST_VERIFICATION':
          state.openGoals.push({
            goalId: `goal-verify-${intervention.interventionId}`,
            type: 'verify_claim', targetArtifactIds: arr(payload.artifactIds),
            status: 'open', priority: 75, humanRequested: true,
            createdFromEventId: intervention.interventionId, createdAt: nowIso()
          });
          break;
        case 'REQUEST_SYNTHESIS':
          state.openGoals.push({
            goalId: `goal-synthesis-${intervention.interventionId}`,
            type: 'produce_synthesis', targetArtifactIds: [],
            status: 'open', priority: 80, humanRequested: true,
            createdFromEventId: intervention.interventionId, createdAt: nowIso()
          });
          break;
        case 'CANCEL_GOAL': {
          const goal = state.openGoals.find((g) => g.goalId === payload.goalId);
          if (goal) goal.status = 'cancelled';
          break;
        }
        case 'STOP_RUN':
          finalize({ reason: 'MANUAL_STOP', finalizationMode: payload.finalizationMode || 'STATE_MAP', humanApprovalRequired: false });
          break;
        default: break;
      }
      if (semanticStore?.commit && state.debateCase) {
        const correlationId = `intervention:${intervention.interventionId}`;
        const targetId = arr(intervention.payload?.artifactIds)[0] || intervention.payload?.artifactId || '';
        const action = String(intervention.payload?.action || intervention.type);
        let changes = intervention.type === 'DELETE_ARTIFACT'
          ? [{ kind: 'DELETE_ARTIFACT', artifactId: targetId, correlationId: `${correlationId}:delete`, actor: 'human' }]
          : intervention.type === 'ADD_CONSTRAINT'
            ? [{
              kind: 'ADD_CONSTRAINT', correlationId: `${correlationId}:constraint`, actor: 'human',
              constraint: {
                ...(payload.constraint || {}),
                constraintId: String(payload.constraint?.constraintId || payload.constraint?.id || `constraint-${intervention.interventionId}`)
              }
            }]
            : [{ kind: 'RECORD_HUMAN_DECISION', correlationId: `${correlationId}:decision`, decision: { decisionId: intervention.interventionId, value: action, text: action, targetId }, actor: 'human' }];
        const targetArtifact = state.debateCase.artifacts?.[targetId];
        if (intervention.type === 'HUMAN_DECISION' && targetArtifact && ['approve_closure', 'reject_closure'].includes(action)) {
          changes.push({
            kind: 'UPSERT_ARTIFACT', correlationId: `${correlationId}:target`, actor: 'human', expectedRevision: targetArtifact.revision,
            artifact: { ...targetArtifact, status: action === 'approve_closure' ? 'closed' : 'reopened', provenance: { ...(targetArtifact.provenance || {}), decisionId: intervention.interventionId } }
          });
        }
        if (intervention.type === 'REQUEST_VERIFICATION' && action === 'request_evidence' && targetId) {
          changes.push({
            kind: 'UPSERT_ARTIFACT', correlationId: `${correlationId}:gap`, actor: 'human',
            artifact: { id: `evidence-gap-${intervention.interventionId}`, type: 'evidence_gap', status: 'open', targetId, title: `Требуется дополнительное evidence для ${targetId}`, provenance: { source: 'state_map_drawer', decisionId: intervention.interventionId, runId: state.runId } }
          });
        }
        const committed = await semanticStore.commit({ expectedCaseVersion: state.caseVersion, leaseRevision: lease?.leaseRevision, changes, deltaId: correlationId });
        if (committed.ok) {
          state.debateCase = clone(committed.case || semanticStore.getState?.() || state.debateCase);
          state.caseVersion = Number(committed.caseVersion ?? state.caseVersion);
        } else {
          state.debateCase = beforeCase;
          state.openGoals = beforeGoals;
          return { ok: false, code: committed.code || 'INTERVENTION_COMMIT_REJECTED', errors: committed.errors || [] };
        }
      } else {
        state.caseVersion += 1;
      }
      state.stateMap = projectStateMap(state) || state.stateMap;
      return { ok: true };
    }

    // ---- Public API (§5) ----
    const api = Object.freeze({
      LIFECYCLE,
      getState: () => ({
        runId: state.runId, lifecycle: state.lifecycle, caseVersion: state.caseVersion,
        activePlanRevisionId: revisions.getActive?.()?.revisionId || null,
        stages: clone(state.stages), openGoals: clone(state.openGoals),
        events: state.events.slice(), finalization: clone(state.finalization),
        pendingHumanDecision: clone(state.pendingHumanDecision || null),
        stateMap: clone(state.stateMap), participantStatus: clone(state.participantStatus),
        configuredParticipants: clone(state.configuredParticipants), activeParticipants: clone(state.activeParticipants),
        droppedParticipants: clone(state.droppedParticipants)
        , stagnationSignals: clone(state.stagnationSignals)
        , usage: clone(state.usage)
      }),
      getOwnerId: () => ownerId,

      async startRun(command = {}) {
        if (state.lifecycle !== LIFECYCLE.CREATED) return { ok: false, code: 'ALREADY_STARTED' };
        // DebateCase and initial revision exist before runtime (Roadmap §6.1).
        if (!command.debateCase) return { ok: false, code: 'DEBATE_CASE_REQUIRED' };
        state.runId = String(command.runId || command.debateCase.caseId || `run-${now()}`);
        const leased = await acquireLease();
        if (!leased.ok) return leased;
        state.debateCase = clone(command.debateCase);
        state.caseVersion = Number(state.debateCase.caseVersion ?? state.debateCase.version ?? 0);
        state.openGoals = clone(arr(command.debateCase.openGoals));
        initializeParticipants(state.debateCase.participants);
        state.stateMap = projectStateMap(state) || clone(command.stateMap || {});
        if (!revisions.getActive?.()) {
          revisions.initialize({
            runId: state.runId,
            createdBy: 'system',
            executionPolicies: command.debateCase.policies || {},
            plannedStages: arr(command.plannedStages)
          });
        }
        state.lifecycle = LIFECYCLE.STARTING;
        emit('RUN_CREATED', {});
        emit('RUN_START_REQUESTED', {});
        state.lifecycle = LIFECYCLE.RUNNING;
        emit('RUN_STARTED', {});
        persistRecoveryPoint('run_started');
        const outcome = command.deferExecution ? { ok: true } : await runLoop(command.maxSteps);
        return { ok: true, runId: state.runId, outcome, lifecycle: state.lifecycle };
      },

      async requestPause(command = {}) {
        if (state.lifecycle !== LIFECYCLE.RUNNING) return { ok: false, code: 'NOT_RUNNING' };
        state.pausePolicy = command.policy || state.debateCase?.policies?.pause?.mode || 'finish_current_stage';
        state.lifecycle = LIFECYCLE.PAUSE_REQUESTED;
        emit('PAUSE_REQUESTED', { policy: state.pausePolicy, requestedBy: command.requestedBy });
        state.lifecycle = LIFECYCLE.QUIESCING;
        emit('RUN_QUIESCING', {});
        if (state.pausePolicy === 'cancel_active_dispatch') {
          abortController?.abort?.('pause');
          state.stages.forEach((stage) => {
            if (stage.status === 'running') { stage.status = 'cancelled'; emit('STAGE_CANCELLED', { stageInstanceId: stage.stageInstanceId, reason: 'pause' }); }
          });
        }
        if (quiescePromise) await quiescePromise.catch(() => {});
        const stillRunning = state.stages.some((s) => s.status === 'running');
        if (!stillRunning) {
          state.lifecycle = LIFECYCLE.PAUSED;
          emit('RUN_PAUSED', {});
          persistRecoveryPoint('run_paused');
          persistence.saveSnapshot(buildSnapshot());
          releaseLease('paused');
        }
        if (abortController && state.pausePolicy === 'cancel_active_dispatch' && deps.AbortController) {
          abortController = createAbortController();
        }
        return { ok: true, lifecycle: state.lifecycle };
      },

      async requestContinue(command = {}) {
        if (state.lifecycle !== LIFECYCLE.PAUSED) return { ok: false, code: 'NOT_PAUSED' };
        emit('CONTINUE_REQUESTED', { requestedBy: command.requestedBy });
        const leased = await acquireLease();
        if (!leased.ok) return leased;
        if (command.expectedCaseVersion != null && command.expectedCaseVersion !== state.caseVersion) {
          releaseLease('continue_case_version_stale');
          return { ok: false, code: 'CASE_VERSION_STALE' };
        }
        await reconcile();
        state.lifecycle = LIFECYCLE.RUNNING;
        emit('RUN_RESUMED', {});
        const outcome = command.deferExecution ? { ok: true } : await runLoop(command.maxSteps);
        return { ok: true, outcome, lifecycle: state.lifecycle };
      },

      async requestCancel(command = {}) {
        if (TERMINAL.has(state.lifecycle)) return { ok: false, code: 'ALREADY_TERMINAL' };
        abortController?.abort?.('cancel');
        state.stages.forEach((stage) => {
          if (['pending', 'running', 'awaiting_participant'].includes(stage.status)) {
            stage.status = 'cancelled';
            emit('STAGE_CANCELLED', { stageInstanceId: stage.stageInstanceId, reason: 'run_cancelled' });
          }
        });
        state.lifecycle = LIFECYCLE.CANCELLED;
        emit('RUN_CANCELLED', { reason: command.reason || 'cancelled' });
        persistRecoveryPoint('run_cancelled');
        persistence.saveSnapshot(buildSnapshot());
        releaseLease('terminal_cancelled');
        return { ok: true, lifecycle: state.lifecycle };
      },

      // Human participant response for an awaiting stage (Roadmap §8.2).
      async submitParticipantResponse(command = {}) {
        const stage = state.stages.find((s) => s.stageInstanceId === command.stageInstanceId);
        if (!stage) return { ok: false, code: 'STAGE_NOT_FOUND' };
        if (stage.status !== 'awaiting_participant') return { ok: false, code: 'STAGE_NOT_AWAITING' };
        const leaseCheck = assertLease();
        if (!leaseCheck.ok) return leaseCheck;
        const participantId = String(command.participantId || '');
        if (!stage.participants.some((p) => p.participantId === participantId)) return { ok: false, code: 'PARTICIPANT_NOT_ASSIGNED' };
        const duplicate = state.events.some((e) => e.type === 'PARTICIPANT_RESPONSE_SUBMITTED'
          && e.payload.stageInstanceId === stage.stageInstanceId && e.payload.participantId === participantId);
        if (duplicate) return { ok: false, code: 'DUPLICATE_RESPONSE' };
        emit('PARTICIPANT_RESPONSE_SUBMITTED', { stageInstanceId: stage.stageInstanceId, participantId });
        const artifacts = deps.extractArtifacts?.({ stage, participant: { participantId }, text: command.text }) || [];
        const result = {
          stageInstanceId: stage.stageInstanceId,
          executionStatus: 'completed',
          attempts: [{ participantId, status: 'accepted', attempts: 1 }],
          acceptedResponses: [{ participantId, text: String(command.text || ''), artifacts }],
          proposedStateDeltas: command.stateDelta ? [command.stateDelta] : (deps.proposeStateDelta ? [deps.proposeStateDelta({ stage, participant: { participantId }, text: command.text, artifacts })].filter(Boolean) : []),
          awaitingParticipants: [], failedParticipants: []
        };
        await commitStageResult(stage, result);
        state.pendingHumanDecision = null;
        if (state.lifecycle === LIFECYCLE.RUNNING && !command.deferExecution) await runLoop(command.maxSteps);
        return { ok: true, stageInstanceId: stage.stageInstanceId };
      },

      // Control intervention — distinct from participant response (Roadmap §8.3).
      async submitIntervention(command = {}) {
        const intervention = {
          interventionId: String(command.interventionId || `intervention-${now()}`),
          type: command.type, payload: command.payload || {},
          targets: command.targets || 'all', visibility: command.visibility || 'public'
        };
        const duplicate = state.events.some((e) => e.type === 'INTERVENTION_RECORDED' && e.payload.interventionId === intervention.interventionId);
        if (duplicate) return { ok: false, code: 'DUPLICATE_INTERVENTION' };
        if (state.lifecycle === LIFECYCLE.PAUSED || state.lifecycle === LIFECYCLE.RUNNING) {
          const wasPaused = state.lifecycle === LIFECYCLE.PAUSED;
          if (wasPaused) {
            const leased = await acquireLease();
            if (!leased.ok) return leased;
          } else {
            const leaseCheck = assertLease();
            if (!leaseCheck.ok) return handleLeaseLost('intervention_after_lease_loss');
          }
          emit('INTERVENTION_RECORDED', intervention);
          if (state.lifecycle === LIFECYCLE.RUNNING) {
            const runningStages = state.stages.filter((s) => s.status === 'running');
            runningStages.forEach((stage) => emit('STAGE_MARKED_STALE_AFTER_COMPLETION', { stageInstanceId: stage.stageInstanceId }));
          }
          const applied = await applyIntervention(intervention);
          if (!applied?.ok) {
            if (wasPaused) releaseLease('paused_intervention_rejected');
            return applied;
          }
          emit('INTERVENTION_APPLIED', { interventionId: intervention.interventionId });
          persistRecoveryPoint('intervention_applied');
          if (wasPaused) releaseLease('paused_intervention_committed');
          if (state.lifecycle === LIFECYCLE.RUNNING && !command.deferExecution) await runLoop(command.maxSteps);
        } else {
          emit('INTERVENTION_RECORDED', intervention);
          state.pendingInterventions.push(intervention);
        }
        return { ok: true, interventionId: intervention.interventionId };
      },

      resolveHumanDecision(command = {}) {
        if (!state.pendingHumanDecision) return { ok: false, code: 'NO_PENDING_DECISION' };
        const request = state.pendingHumanDecision;
        if (String(command.requestId || '') !== String(request.requestId || '')) return { ok: false, code: 'DECISION_REQUEST_STALE' };
        if (command.expectedCaseVersion != null && Number(command.expectedCaseVersion) !== state.caseVersion) return { ok: false, code: 'CASE_VERSION_STALE' };
        if (command.expectedPlanRevisionId != null && command.expectedPlanRevisionId !== revisions.getActive?.()?.revisionId) return { ok: false, code: 'REVISION_STALE' };
        if (Array.isArray(request.options) && !request.options.some((option) => option.id === command.optionId)) return { ok: false, code: 'DECISION_OPTION_INVALID' };
        emit('HUMAN_DECISION_RECORDED', { requestId: request.requestId, optionId: command.optionId });
        state.pendingHumanDecision = null;
        if (request.type === 'APPROVE_FINALIZATION' && command.optionId === 'finalize') {
          return finalize({ reason: 'MANUAL_STOP', finalizationMode: 'STATE_MAP', humanApprovalRequired: false });
        }
        persistRecoveryPoint('human_decision_resolved');
        return { ok: true };
      },

      // Plan revision activation (§17): delegates to revision store, then invalidates + replans.
      async activatePlanRevision(commandOrCommands, context = {}) {
        const activeStages = state.stages.filter((s) => ['pending', 'running', 'awaiting_participant'].includes(s.status));
        const restartStages = [];
        const result = revisions.submit(commandOrCommands, { ...context, activeStages, stageHistory: state.stages });
        if (!result.ok) {
          emit('PLAN_REVISION_REJECTED', { code: result.code });
          return result;
        }
        emit('PLAN_REVISION_ACTIVATED', { revisionId: result.revision.revisionId, revisionNumber: result.revision.revisionNumber });
        for (const item of result.stageInvalidation) {
          const stage = state.stages.find((s) => s.stageInstanceId === item.stageInstanceId);
          if (!stage) continue;
          if (item.invalidation === 'CANCELLED' && stage.status === 'pending') {
            stage.status = 'cancelled';
            emit('STAGE_CANCELLED', { stageInstanceId: stage.stageInstanceId, reason: 'revision' });
          } else if (item.invalidation === 'STALE' && stage.status === 'pending') {
            stage.status = 'stale';
            stage.goalIds.forEach((goalId) => {
              const goal = state.openGoals.find((g) => g.goalId === goalId);
              if (goal && goal.status !== 'resolved') goal.status = 'open';
            });
            emit('STAGE_STALE', { stageInstanceId: stage.stageInstanceId, reason: 'revision' });
          } else if (stage.status === 'running' && item.invalidation !== 'UNCHANGED') {
            // Running stages follow the revision's runningStagePolicy (§17.2); default FINISH.
            emit('RUNNING_STAGE_POLICY_APPLIED', { stageInstanceId: stage.stageInstanceId, policy: result.runningStagePolicy });
            const policy = result.runningStagePolicy || 'FINISH';
            if (policy === 'CANCEL' || policy === 'RESTART') {
              stage.resultDisposition = policy;
              abortController?.abort?.('revision');
              if (policy === 'RESTART') {
                const replacement = {
                  ...clone(stage),
                  stageInstanceId: `${stage.stageInstanceId}:restart:${result.revision.revisionNumber}`,
                  planRevisionId: result.revision.revisionId,
                  status: 'pending',
                  resultDisposition: null,
                  replacementStageInstanceId: null
                };
                stage.replacementStageInstanceId = replacement.stageInstanceId;
                state.stages.push(replacement);
                restartStages.push(replacement);
                emit('STAGE_RESTART_SCHEDULED', {
                  stageInstanceId: stage.stageInstanceId,
                  replacementStageInstanceId: replacement.stageInstanceId
                });
              }
              abortController = createAbortController();
            } else if (policy === 'IGNORE_RESULT') {
              stage.resultDisposition = 'IGNORE_RESULT';
            } else if (policy === 'CONVERT_TO_AUDIT') {
              stage.resultDisposition = 'CONVERT_TO_AUDIT';
            }
          }
        }
        persistRecoveryPoint('plan_revision_activated');
        if (state.lifecycle === LIFECYCLE.RUNNING && !context.deferExecution) {
          for (const replacement of restartStages) await executeStage(replacement);
          await runLoop(context.maxSteps);
        }
        return result;
      },

      // Recovery (§15.4): snapshot + replay; idempotent.
      async recoverRun(command = {}) {
        const persistedSnapshot = persistence.loadLatestSnapshot?.();
        const allEvents = persistence.loadEvents?.(0) || [];
        let snapshot = validRecoverySnapshot(persistedSnapshot) ? persistedSnapshot : null;
        let recoveredFrom = snapshot ? 'snapshot' : '';
        if (!snapshot) {
          const checkpoint = persistence.loadRecoveryCheckpoint?.()
            || allEvents.slice().reverse().find((event) => event.type === 'RUN_STATE_CHECKPOINTED')?.payload?.snapshot;
          if (validRecoverySnapshot(checkpoint)) {
            snapshot = checkpoint;
            recoveredFrom = 'event_log';
          }
        }
        if (!snapshot) {
          if (persistedSnapshot || allEvents.length) return fatal('RECOVERY_CHECKPOINT_INVALID', { runId: command.runId || '' });
          return { ok: false, code: 'NOTHING_TO_RECOVER' };
        }
        hydrateSnapshot(snapshot);
        const replayed = persistence.loadEvents?.(snapshot?.eventSequence || 0) || [];
        for (const event of replayed) {
          // Event replay validation: sequence must be continuous (§19.2 fatal otherwise).
          if (event.eventSequence <= (snapshot?.eventSequence || 0)) continue;
          if (event.eventSequence !== state.eventSequence + 1 && state.eventSequence >= (snapshot?.eventSequence || 0)) {
            if (event.eventSequence > state.eventSequence + 1) return fatal('CORRUPTED_EVENT_SEQUENCE', { expected: state.eventSequence + 1, actual: event.eventSequence });
          }
          state.eventSequence = Math.max(state.eventSequence, event.eventSequence);
        }
        republishUnpublished(allEvents);
        if (state.lifecycle !== LIFECYCLE.PAUSED) {
          const leased = await acquireLease();
          if (!leased.ok) return leased;
        }
        emit('RUN_RECOVERED', { recoveredFrom, replayedEvents: replayed.length });
        if (!TERMINAL.has(state.lifecycle)) {
          if (state.lifecycle !== LIFECYCLE.PAUSED) {
            await reconcile();
            state.lifecycle = LIFECYCLE.RUNNING;
            emit('RUN_RESUMED', {});
            if (!command.deferExecution) await runLoop(command.maxSteps);
          }
        }
        return { ok: true, lifecycle: state.lifecycle };
      },

      async finalizeRun(command = {}) {
        return finalize({
          reason: command.reason || 'MANUAL_STOP',
          finalizationMode: command.finalizationMode || 'STATE_MAP',
          humanApprovalRequired: false
        });
      },

      buildSnapshot,
      _internals: deps.exposeInternals ? { state, plannerInput, plannerTick, step, runLoop, reconcile, acquireLease, renewLease, assertLease, releaseLease } : undefined
    });
    return api;
  }

  const api = Object.freeze({ LIFECYCLE, createOrchestrator });
  root.DebateOrchestrator = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
