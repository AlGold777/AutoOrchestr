// Rule-based, deterministic Planner (Planner Contract v1.0).
// evaluate(PlannerInput) -> PlanningDecision. No side effects, no transport, no LLM calls.
(function initDebatePlanner(root) {
  'use strict';

  const RULE_SET_VERSION = '1.0.0';
  const PLANNER_ALGORITHM_VERSION = '1.0.0';
  const UTILITY_FORMULA_VERSION = '1.0.0';
  const GOAL_SCHEMA_VERSION = '1.0.0';

  const GOAL_TYPES = Object.freeze([
    'establish_position', 'verify_claim', 'verify_evidence', 'resolve_objection',
    'resolve_contradiction', 'answer_open_question', 'examine_dissent', 'test_revision',
    'recheck_conclusion', 'compact_context', 'produce_synthesis', 'correct_synthesis', 'audit_output',
    'request_human_judgment'
  ]);

  const DECISION_TYPES = Object.freeze(['CREATE_STAGES', 'REQUEST_HUMAN_DECISION', 'WAIT', 'FINALIZE', 'NO_OP']);

  const SUPPRESSION = Object.freeze([
    'GOAL_ALREADY_COVERED', 'DEPENDENCY_NOT_READY', 'PARTICIPANT_UNAVAILABLE', 'POLICY_FORBIDS',
    'BUDGET_EXCEEDED', 'CONFLICT_WITH_HIGHER_UTILITY', 'PAUSE_PENDING', 'FINALIZATION_PENDING',
    'VISIBILITY_CONFLICT'
  ]);

  const GOAL_PURPOSE = Object.freeze({
    establish_position: 'position',
    verify_claim: 'verification',
    verify_evidence: 'evidence_review',
    resolve_objection: 'response',
    resolve_contradiction: 'contradiction_resolution',
    answer_open_question: 'response',
    examine_dissent: 'dissent_examination',
    test_revision: 'critique',
    recheck_conclusion: 'verification',
    compact_context: 'context_compaction',
    produce_synthesis: 'synthesis',
    correct_synthesis: 'synthesis',
    audit_output: 'audit',
    request_human_judgment: 'human_judgment'
  });

  const INDEPENDENT_PURPOSES = new Set(['verification', 'audit', 'critique', 'evidence_review']);
  const PURE_DERIVED_GOAL_TYPES = new Set([
    'verify_claim', 'verify_evidence', 'resolve_objection', 'resolve_contradiction',
    'answer_open_question', 'examine_dissent', 'test_revision', 'compact_context'
  ]);

  const text = (value) => String(value == null ? '' : value).trim();
  const arr = (value) => Array.isArray(value) ? value : [];
  const terminalStageStatuses = new Set(['completed']);
  const occupyingStageStatuses = new Set(['pending', 'running', 'awaiting_participant', 'completed']);

  function hasPlannedPurpose(input, purpose) {
    return arr(input.activePlanRevision?.plannedStages)
      .some((stage) => stage.status !== 'cancelled' && stage.purpose === purpose);
  }

  // §7 Derived Goal Generation from StateMap conditions.
  function deriveGoals(input) {
    const map = input.stateMap || {};
    const derived = [];
    const push = (type, targets, priority, sourceId) => derived.push({
      goalId: `derived:${type}:${targets.join('+') || 'run'}`,
      type, targetArtifactIds: targets, status: 'open', priority,
      createdFromEventId: sourceId || 'state_map', createdAt: input.currentTime || '', derived: true
    });
    for (const claim of arr(map.claims)) {
      if (claim.status === 'unsupported') push('verify_claim', [claim.id], 60, claim.id);
      if (claim.revision && claim.revision.status === 'untested') push('test_revision', [claim.id], 55, claim.id);
    }
    for (const evidence of arr(map.evidence)) {
      if (evidence.status === 'disputed') push('verify_evidence', [evidence.id], 60, evidence.id);
    }
    for (const objection of arr(map.actionableObjections || map.objections).filter((item) => item.severity === 'blocking' || item.severity === 'critical' || item.severity === 'high')) push('resolve_objection', [objection.id], 80, objection.id);
    for (const contradiction of arr(map.actionableContradictions || map.contradictions)) push('resolve_contradiction', [contradiction.id], 75, contradiction.id);
    for (const question of arr(map.actionableQuestions || map.questions)) push('answer_open_question', [question.id], 50, question.id);
    for (const dissent of arr(map.actionableDissent || map.dissent)) push('examine_dissent', [dissent.id], 45, dissent.id);
    const compaction = input.policies?.compaction || {};
    if (Number(map.contextPressure || 0) > Number(compaction.contextPressureThreshold ?? 0.8)) {
      push('compact_context', [], 70, 'context_pressure');
    }
    const finalization = input.policies?.finalization || {};
    const requiredOpen = arr(input.openGoals).filter((g) => g.required && ['open', 'assigned', 'in_progress', 'blocked'].includes(g.status));
    const blockers = derived.filter((g) => ['resolve_objection', 'resolve_contradiction'].includes(g.type));
    if (['optional', 'required'].includes(finalization.synthesis) && !hasPlannedPurpose(input, 'synthesis')
      && !requiredOpen.length && !blockers.length
      && arr(map.claims).length && !map.synthesisArtifactId) {
      push('produce_synthesis', [], 40, 'synthesis_readiness');
    }
    if (finalization.audit === 'required' && !hasPlannedPurpose(input, 'audit')
      && map.synthesisArtifactId && !map.validAuditArtifactId) {
      if (map.currentSynthesisAuditVerdict === 'issues_found') {
        push('correct_synthesis', [map.synthesisArtifactId, map.currentSynthesisAuditId].filter(Boolean), 90, map.currentSynthesisAuditId);
      } else {
        push('audit_output', [map.synthesisArtifactId], 65, map.synthesisArtifactId);
      }
    }
    return derived;
  }

  function evaluateDerivedGoalCondition(goal = {}, input = {}) {
    const derived = goal.derived === true || String(goal.goalId || '').startsWith('derived:');
    if (!derived || !PURE_DERIVED_GOAL_TYPES.has(String(goal.type || ''))) {
      return Object.freeze({ evaluable: false, active: null, reason: 'goal_condition_not_reusable' });
    }
    const key = (candidate) => `${candidate.type}|${arr(candidate.targetArtifactIds).slice().sort().join(',')}`;
    const active = deriveGoals(input).some((candidate) => key(candidate) === key(goal));
    return Object.freeze({
      evaluable: true,
      active,
      reason: active ? 'derivation_condition_still_true' : 'derivation_condition_cleared'
    });
  }

  // §6.5 Goal deduplication against open goals and active stages.
  function dedupeGoals(candidates, openGoals, activeStages) {
    const activeKey = (g) => `${g.type}|${arr(g.targetArtifactIds).slice().sort().join(',')}`;
    const known = new Set(arr(openGoals)
      .filter((g) => ['open', 'assigned', 'in_progress'].includes(g.status))
      .map(activeKey));
    const covered = new Set(arr(activeStages).flatMap((s) => arr(s.goalIds)));
    return candidates.filter((g) => !known.has(activeKey(g)) && !covered.has(g.goalId));
  }

  // §12 Participant selection with independence preference.
  function selectParticipants(goal, purpose, input, notes) {
    const available = arr(input.availableParticipants)
      .filter((p) => p.available !== false && (!p.serviceOnly || ['synthesis', 'audit'].includes(purpose)));
    const capabilities = input.participantCapabilities || {};
    const authorship = input.stateMap?.artifactAuthors || {};
    const authors = new Set(arr(goal.targetArtifactIds).map((id) => authorship[id]).filter(Boolean));
    const required = arr(goal.requiredCapabilities);
    const capacityUsed = {};
    arr(input.activeStages).forEach((stage) => arr(stage.participants || stage.participantIds).forEach((id) => {
      capacityUsed[id] = (capacityUsed[id] || 0) + 1;
    }));
    const eligible = available.filter((p) => {
      const caps = arr(capabilities[p.participantId] || p.capabilities);
      if (required.some((c) => !caps.includes(c))) return false;
      const capacity = Number(p.capacity ?? 1);
      if ((capacityUsed[p.participantId] || 0) >= capacity) return false;
      return true;
    });
    if (!eligible.length) return { participants: [], reason: 'PARTICIPANT_UNAVAILABLE' };
    const independence = input.policies?.independence || {};
    let pool = eligible;
    let degraded = false;
    if (INDEPENDENT_PURPOSES.has(purpose) && independence.verifierMustDifferFromAuthor !== false) {
      const independent = eligible.filter((p) => !authors.has(p.participantId));
      if (independent.length) pool = independent;
      else if (independence.allowDegraded) { degraded = true; notes.push('DEGRADED_INDEPENDENCE'); }
      else return { participants: [], reason: 'POLICY_FORBIDS' };
      if (independence.preferDifferentProvider && authors.size) {
        const providers = new Set(available.filter((p) => authors.has(p.participantId)).map((p) => p.provider).filter(Boolean));
        const crossProvider = pool.filter((p) => p.provider && !providers.has(p.provider));
        if (crossProvider.length) pool = crossProvider;
      }
    }
    // Deterministic ordering: lexical by participantId.
    const sorted = pool.slice().sort((a, b) => String(a.participantId).localeCompare(String(b.participantId)));
    const count = goal.type === 'establish_position' ? sorted.length : 1;
    return { participants: sorted.slice(0, Math.max(1, count)).map((p) => p.participantId), degraded };
  }

  function plannedStageExecutions(input, plannedStageId) {
    return arr(input.stageHistory).filter((stage) => stage.plannedStageId === plannedStageId);
  }

  function isPlannedStageReady(stage, input, nonPlannedActionable) {
    const executions = plannedStageExecutions(input, stage.plannedStageId);
    if (executions.some((item) => occupyingStageStatuses.has(item.status))) return false;
    const upstreamReady = arr(stage.upstream).every((upstreamId) =>
      plannedStageExecutions(input, upstreamId).some((item) => terminalStageStatuses.has(item.status)));
    if (!upstreamReady) return false;
    const activationPolicy = stage.activationPolicy || stage.schedulePolicy || 'immediate';
    if (activationPolicy === 'finalization_ready' || activationPolicy === 'after_open_goals') {
      const unresolvedGoals = arr(input.openGoals)
        .filter((goal) => !['resolved', 'cancelled'].includes(goal.status))
        .filter((goal) => !['produce_synthesis', 'correct_synthesis', 'audit_output'].includes(goal.type));
      if (unresolvedGoals.length || nonPlannedActionable.length) return false;
    }
    return true;
  }

  function selectPlannedStageParticipants(stage, input) {
    const assigned = arr(stage.participantIds);
    if (!assigned.length) {
      if (stage.assignmentPolicy === 'explicit_required') {
        return { participantIds: [], reason: 'SYNTHESIS_PARTICIPANT_REQUIRED', notes: [] };
      }
      const notes = [];
      const selection = selectParticipants({
        goalId: `planned:${stage.plannedStageId}`,
        type: stage.purpose === 'audit' ? 'audit_output' : stage.purpose === 'synthesis' ? 'produce_synthesis' : 'answer_open_question',
        targetArtifactIds: arr(stage.artifactIds || stage.inputArtifactIds),
        requiredCapabilities: arr(stage.requiredCapabilities)
      }, stage.purpose || 'response', input, notes);
      return { participantIds: selection.participants, reason: selection.reason, notes };
    }
    const available = new Map(arr(input.availableParticipants).map((participant) => [participant.participantId, participant]));
    const required = arr(stage.requiredCapabilities);
    const capacityUsed = {};
    arr(input.activeStages).forEach((activeStage) => arr(activeStage.participants || activeStage.participantIds).forEach((participant) => {
      const participantId = typeof participant === 'string' ? participant : participant?.participantId;
      if (participantId) capacityUsed[participantId] = (capacityUsed[participantId] || 0) + 1;
    }));
    const invalid = assigned.find((participantId) => {
      const participant = available.get(participantId);
      if (!participant || participant.available === false) return true;
      if ((capacityUsed[participantId] || 0) >= Math.max(1, Number(participant.capacity ?? 1))) return true;
      const capabilities = arr(input.participantCapabilities?.[participantId] || participant.capabilities);
      return required.some((capability) => !capabilities.includes(capability));
    });
    return invalid
      ? { participantIds: [], reason: 'ASSIGNED_PARTICIPANT_UNAVAILABLE', unavailableParticipantId: invalid, notes: [] }
      : { participantIds: assigned.slice(), notes: [] };
  }

  function resolvePlannedInputArtifactIds(stage, input) {
    const selector = stage.inputSelector || {};
    if (selector.kind === 'working_synthesis') return arr(input.stateMap?.workingSynthesisArtifactIds);
    if (selector.kind === 'all_artifacts') return Object.keys(input.stateMap?.artifacts || {});
    return arr(stage.artifactIds || stage.inputArtifactIds);
  }

  function proposePlannedStages(input, actionable) {
    const plannedStages = arr(input.activePlanRevision?.plannedStages)
      .filter((stage) => !stage.status || stage.status === 'pending')
      .filter((stage) => !plannedStageExecutions(input, stage.plannedStageId)
        .some((item) => occupyingStageStatuses.has(item.status)));
    if (!plannedStages.length) return null;
    const ready = plannedStages.filter((stage) => isPlannedStageReady(stage, input, actionable));
    if (!ready.length) return { blocked: true, plannedStages };
    const stage = ready[0];
    const selection = selectPlannedStageParticipants(stage, input);
    if (!selection.participantIds.length) {
      return { blocked: true, plannedStages, participantFailure: { stage, ...selection } };
    }
    return {
      stage,
      decision: makeDecision(input, {
        type: 'CREATE_STAGES',
        rationaleCode: 'PLANNED_STAGE_READY',
        rationaleData: { plannedStageId: stage.plannedStageId, notes: selection.notes },
        consideredGoalIds: arr(stage.goalIds),
        selectedGoalIds: arr(stage.goalIds),
        firedRules: [{
          ruleId: 'rule:planned-stage:v1',
          version: RULE_SET_VERSION,
          targetGoalIds: arr(stage.goalIds),
          candidateAction: stage.purpose,
          matchedConditions: ['ACTIVE_PLAN_REVISION', 'STAGE_READY']
        }],
        proposedStages: [{
          proposedStageId: `proposed-${input.runId}-${stage.plannedStageId}`,
          plannedStageId: stage.plannedStageId,
          purpose: stage.purpose,
          goalIds: arr(stage.goalIds),
          participantIds: selection.participantIds,
          participantBindings: arr(stage.participantBindings),
          inputArtifactIds: resolvePlannedInputArtifactIds(stage, input),
          expectedArtifactTypes: arr(stage.expectedArtifactTypes),
          dispatchMode: stage.dispatchMode || (selection.participantIds.length > 1 ? 'parallel' : 'single'),
          completionMode: stage.completionMode || (selection.participantIds.length > 1 ? (input.policies?.completion?.mode || 'all') : 'all'),
          executionPolicyId: stage.executionPolicyId || input.policies?.retry?.policyId || 'retry.default.v1',
          promptContractId: stage.promptContractId || `prompt:${stage.purpose}:v1`,
          visibilityPolicy: stage.visibilityPolicy || { mode: 'public' },
          outputIntent: stage.outputIntent,
          terminalPolicy: stage.terminalPolicy,
          auditPolicy: stage.auditPolicy,
          inputSelector: stage.inputSelector,
          participantSelectionRationale: arr(stage.participantIds).length ? 'PLAN_REVISION_ASSIGNMENT' : 'CAPABILITY_MATCH'
        }],
        utilityBreakdown: []
      })
    };
  }

  // §9 Utility formula (deterministic, fully traced).
  function computeUtility(goal, input, context) {
    const breakdown = {
      goalId: goal.goalId,
      ruleId: context.ruleId,
      basePriority: Number(goal.priority || 0),
      blockerBonus: ['resolve_objection', 'resolve_contradiction'].includes(goal.type) ? 25 : 0,
      disputedBonus: arr(goal.targetArtifactIds).some((id) => context.disputedIds.has(id)) ? 10 : 0,
      uncertaintyBonus: goal.highImpactUncertainty ? 10 : 0,
      dependencyUnlockBonus: Math.min(15, 5 * context.dependents(goal.goalId)),
      humanPriorityBonus: goal.humanRequested ? 20 : 0,
      executionCostPenalty: goal.type === 'produce_synthesis' ? 8 : goal.type === 'compact_context' ? 4 : 2,
      participantScarcityPenalty: context.scarce ? 5 : 0,
      contextCostPenalty: goal.type === 'compact_context' ? 0 : Math.min(10, Math.round(Number(input.stateMap?.contextPressure || 0) * 5)),
      duplicationPenalty: context.repeated(goal) ? 30 : 0,
      latencyPenalty: 0
    };
    breakdown.total = breakdown.basePriority + breakdown.blockerBonus + breakdown.disputedBonus
      + breakdown.uncertaintyBonus + breakdown.dependencyUnlockBonus + breakdown.humanPriorityBonus
      - breakdown.executionCostPenalty - breakdown.participantScarcityPenalty
      - breakdown.contextCostPenalty - breakdown.duplicationPenalty - breakdown.latencyPenalty;
    return breakdown;
  }

  // §9.4 Deterministic tie-breaking.
  function tieBreak(a, b) {
    if (b.utility.total !== a.utility.total) return b.utility.total - a.utility.total;
    const blockerA = a.utility.blockerBonus > 0 ? 1 : 0;
    const blockerB = b.utility.blockerBonus > 0 ? 1 : 0;
    if (blockerB !== blockerA) return blockerB - blockerA;
    if (b.utility.dependencyUnlockBonus !== a.utility.dependencyUnlockBonus) return b.utility.dependencyUnlockBonus - a.utility.dependencyUnlockBonus;
    const createdA = text(a.goal.createdAt);
    const createdB = text(b.goal.createdAt);
    if (createdA !== createdB) return createdA < createdB ? -1 : 1;
    if (a.utility.executionCostPenalty !== b.utility.executionCostPenalty) return a.utility.executionCostPenalty - b.utility.executionCostPenalty;
    return String(a.goal.goalId).localeCompare(String(b.goal.goalId));
  }

  // §14 Stagnation signals.
  function detectStagnation(input) {
    const policy = input.policies?.stagnation || {};
    const signals = input.stagnationSignals || {};
    const noDelta = Number(signals.consecutiveNoStateDelta || 0) >= Number(policy.noStateDeltaLimit ?? 3);
    const unchanged = Number(signals.unchangedStateMapCount || 0) >= Number(policy.unchangedStateMapLimit ?? 3);
    const repeatedAction = Number(signals.repeatedActionCount || 0) >= Number(policy.repeatedActionLimit ?? 2);
    return { stagnant: noDelta || unchanged || repeatedAction, noDelta, unchanged, repeatedAction };
  }

  function makeDecision(input, partial) {
    return Object.freeze({
      decisionId: `decision-${input.runId}-${input.caseVersion}-${input.stateMap?.projectorVersion || 0}-${Number(input.totalStagesExecuted || 0)}`,
      inputCaseVersion: input.caseVersion,
      inputStateMapIdentity: {
        sourceCaseVersion: Number(input.stateMap?.sourceCaseVersion ?? input.caseVersion),
        projectorVersion: Number(input.stateMap?.projectorVersion || input.stateMap?.version || 0)
      },
      inputPlanRevisionId: input.activePlanRevisionId,
      ruleSetVersion: input.ruleSetVersion || RULE_SET_VERSION,
      plannerAlgorithmVersion: PLANNER_ALGORITHM_VERSION,
      utilityFormulaVersion: UTILITY_FORMULA_VERSION,
      goalSchemaVersion: GOAL_SCHEMA_VERSION,
      stateMapSchemaVersion: String(input.stateMapSchemaVersion || '1'),
      consideredGoalIds: [], selectedGoalIds: [], firedRules: [], suppressedRules: [],
      utilityBreakdown: [], rationaleData: {},
      createdAt: input.currentTime || new Date().toISOString(),
      ...partial
    });
  }

  function evaluate(input = {}) {
    if (!input.runId || input.caseVersion == null || !input.activePlanRevisionId) {
      throw new Error('PlannerInput requires runId, caseVersion, activePlanRevisionId');
    }
    const budgets = { ...(input.budgets || {}) };
    const finalizationPolicy = input.policies?.finalization || {};
    const revisionMeta = input.activePlanRevision?.metadata || {};
    const cancelledGoals = new Set(arr(revisionMeta.cancelledGoalIds));

    // 3. Reconcile goal coverage + 4. derived goals
    const openGoals = arr(input.openGoals).filter((g) => !cancelledGoals.has(g.goalId));
    const derived = dedupeGoals(deriveGoals(input), openGoals, input.activeStages);
    const actionable = [...openGoals.filter((g) => g.status === 'open'), ...derived];
    const consideredGoalIds = actionable.map((g) => g.goalId);

    // Blocking human decision requested previously → only REQUEST_HUMAN_DECISION.
    if (input.pendingHumanDecision) {
      return makeDecision(input, { type: 'WAIT', rationaleCode: 'AWAITING_HUMAN_DECISION', consideredGoalIds });
    }

    // An active PlanRevision is the authoritative source for explicitly authored
    // stages. Goal-derived stages remain available only for work not represented
    // by the plan, preventing a second synthesis execution path.
    const nonPlannedActionable = actionable.filter((goal) =>
      !(hasPlannedPurpose(input, 'synthesis') && ['produce_synthesis', 'correct_synthesis'].includes(goal.type))
      && !(hasPlannedPurpose(input, 'audit') && goal.type === 'audit_output'));
    const suppressed = [];
    const suppress = (goal, reason, ruleId) => suppressed.push({ ruleId: ruleId || `rule:${goal.type}`, targetGoalIds: [goal.goalId], suppressionReason: reason });

    // Budget exhaustion (§16.3)
    const stagesSoFar = Number(input.totalStagesExecuted || 0);
    const activeStages = arr(input.activeStages).filter((s) => !['completed', 'failed', 'cancelled', 'stale'].includes(s.status));
    const budgetChecks = [
      ['stages', 'maxTotalStages', stagesSoFar],
      ['model_calls', 'maxModelCalls', Number(input.totalModelCalls || 0)],
      ['human_waits', 'maxHumanWaits', Number(input.humanWaits || 0)],
      ['retry_attempts', 'maxRetryAttempts', Number(input.retryAttempts || 0)],
      ['context_tokens', 'maxContextTokens', Number(input.contextTokens || input.stateMap?.contextTokensEstimate || 0)],
      ['corrections', 'maxCorrections', Number(input.totalCorrections || 0)],
      ['estimated_cost', 'maxEstimatedCost', Number(input.estimatedCost || 0)],
      ['elapsed_time_ms', 'maxElapsedTimeMs', Number(input.elapsedTimeMs || 0)]
    ];
    const exhaustedBudgets = budgetChecks
      .filter(([, policyKey, actual]) => budgets[policyKey] != null && actual >= Number(budgets[policyKey]))
      .map(([resource, policyKey, actual]) => ({
        type: 'budget_exhausted', resource, policyKey,
        actual, limit: Number(budgets[policyKey]), severity: 'limitation'
      }));
    const budgetExhausted = exhaustedBudgets.length > 0;
    const requiredOpen = openGoals.filter((g) => g.required && g.status !== 'resolved');
    if (budgetExhausted) {
      const finalization = {
        reason: 'BUDGET_EXHAUSTED',
        finalizationMode: input.stateMap?.synthesisArtifactId ? 'SYNTHESIS' : (arr(input.stateMap?.claims).length ? 'STATE_MAP' : 'ARTIFACTS_ONLY'),
        unresolvedGoalIds: requiredOpen.map((g) => g.goalId),
        selectedFinalArtifactIds: arr(input.stateMap?.finalArtifactIds),
        humanApprovalRequired: finalizationPolicy.mode === 'manual',
        degradationEvidence: exhaustedBudgets
      };
      if (finalizationPolicy.mode === 'manual') {
        return makeDecision(input, {
          type: 'REQUEST_HUMAN_DECISION', rationaleCode: 'BUDGET_EXHAUSTED_MANUAL_POLICY', consideredGoalIds,
          humanDecisionRequest: {
            requestId: `hdr-${input.runId}-budget`, type: 'APPROVE_FINALIZATION',
            question: 'Budget exhausted. Finalize the run?',
            options: [{ id: 'finalize', label: 'Finalize' }, { id: 'extend', label: 'Extend budget' }],
            blocking: true, relatedGoalIds: requiredOpen.map((g) => g.goalId), relatedArtifactIds: [],
            degradationEvidence: exhaustedBudgets
          }
        });
      }
      return makeDecision(input, { type: 'FINALIZE', rationaleCode: 'BUDGET_EXHAUSTED', consideredGoalIds, finalizationDecision: finalization });
    }

    const planned = proposePlannedStages(input, nonPlannedActionable);
    if (planned?.decision) return planned.decision;
    if (planned?.participantFailure) {
      return makeDecision(input, {
        type: 'WAIT',
        rationaleCode: 'PLANNED_STAGE_PARTICIPANT_UNAVAILABLE',
        consideredGoalIds,
        suppressedRules: [{
          ruleId: 'rule:planned-stage:v1',
          targetGoalIds: arr(planned.participantFailure.stage.goalIds),
          suppressionReason: 'PARTICIPANT_UNAVAILABLE',
          plannedStageId: planned.participantFailure.stage.plannedStageId,
          participantId: planned.participantFailure.unavailableParticipantId
        }]
      });
    }

    // Stagnation (§14)
    const stagnation = detectStagnation(input);

    // No actionable goals → finalization or NO_OP by policy (§17).
    if (!nonPlannedActionable.length && !activeStages.length) {
      if (planned?.blocked) {
        return makeDecision(input, {
          type: 'WAIT', rationaleCode: 'PLANNED_STAGE_DEPENDENCY_NOT_READY', consideredGoalIds,
          rationaleData: { plannedStageIds: planned.plannedStages.map((stage) => stage.plannedStageId) }
        });
      }
      if (requiredOpen.length && !stagnation.stagnant) {
        return makeDecision(input, { type: 'NO_OP', rationaleCode: 'REQUIRED_GOALS_BLOCKED', consideredGoalIds, rationaleData: { requiredOpen: requiredOpen.map((g) => g.goalId) } });
      }
      if (finalizationPolicy.mode === 'manual') {
        return makeDecision(input, { type: 'NO_OP', rationaleCode: 'AWAITING_MANUAL_FINALIZATION', consideredGoalIds });
      }
      return makeDecision(input, {
        type: 'FINALIZE',
        rationaleCode: stagnation.stagnant ? 'STAGNATION' : 'NO_ACTIONABLE_GOALS',
        consideredGoalIds,
        finalizationDecision: {
          reason: stagnation.stagnant ? 'STAGNATION' : (requiredOpen.length ? 'NO_ACTIONABLE_GOALS' : 'REQUIRED_GOALS_RESOLVED'),
          finalizationMode: input.stateMap?.synthesisArtifactId ? 'SYNTHESIS' : (arr(input.stateMap?.claims).length ? 'STATE_MAP' : 'ARTIFACTS_ONLY'),
          unresolvedGoalIds: requiredOpen.map((g) => g.goalId),
          selectedFinalArtifactIds: arr(input.stateMap?.finalArtifactIds),
          humanApprovalRequired: false
        }
      });
    }
    if (!nonPlannedActionable.length) {
      return makeDecision(input, { type: 'WAIT', rationaleCode: 'ACTIVE_STAGES_IN_FLIGHT', consideredGoalIds, rationaleData: { activeStages: activeStages.map((s) => s.stageInstanceId) } });
    }

    // 5–7. Rules + utility.
    const disputedIds = new Set([
      ...arr(input.stateMap?.claims).filter((c) => c.status === 'disputed').map((c) => c.id),
      ...arr(input.stateMap?.evidence).filter((e) => e.status === 'disputed').map((e) => e.id)
    ]);
    const dependentsOf = (goalId) => nonPlannedActionable.filter((g) => arr(g.blockedByGoalIds).includes(goalId)).length;
    const recentFingerprints = arr(input.recentActionFingerprints);
    const repeated = (goal) => stagnation.repeatedAction === false
      ? recentFingerprints.includes(`${goal.type}|${arr(goal.targetArtifactIds).join(',')}`) && Number(input.stagnationSignals?.consecutiveNoStateDelta || 0) > 0
      : recentFingerprints.includes(`${goal.type}|${arr(goal.targetArtifactIds).join(',')}`);

    const candidates = [];
    const notes = [];
    for (const goal of nonPlannedActionable) {
      const ruleId = `rule:${goal.type}:v1`;
      if (goal.status === 'blocked' || arr(goal.blockedByGoalIds).some((id) => nonPlannedActionable.some((g) => g.goalId === id) || openGoals.some((g) => g.goalId === id && g.status !== 'resolved'))) {
        suppress(goal, 'DEPENDENCY_NOT_READY', ruleId);
        continue;
      }
      if (['produce_synthesis', 'correct_synthesis'].includes(goal.type)) {
        if (finalizationPolicy.synthesis === 'none') { suppress(goal, 'POLICY_FORBIDS', ruleId); continue; }
        if (revisionMeta.synthesisForbidden || input.humanForbidsSynthesis) { suppress(goal, 'POLICY_FORBIDS', ruleId); continue; }
      }
      const purpose = GOAL_PURPOSE[goal.type] || 'response';
      if (purpose === 'human_judgment') {
        return makeDecision(input, {
          type: 'REQUEST_HUMAN_DECISION', rationaleCode: 'HUMAN_JUDGMENT_GOAL', consideredGoalIds,
          selectedGoalIds: [goal.goalId],
          humanDecisionRequest: {
            requestId: `hdr-${input.runId}-${goal.goalId}`, type: 'CHOOSE_ACTION',
            question: goal.question || 'Human judgment required', options: goal.options || [],
            blocking: true, relatedGoalIds: [goal.goalId], relatedArtifactIds: arr(goal.targetArtifactIds)
          }
        });
      }
      const selection = selectParticipants(goal, purpose, input, notes);
      if (!selection.participants.length) { suppress(goal, selection.reason || 'PARTICIPANT_UNAVAILABLE', ruleId); continue; }
      const scarcity = arr(input.availableParticipants).filter((p) => p.available !== false).length <= 1;
      const utility = computeUtility(goal, input, { ruleId, disputedIds, dependents: dependentsOf, scarce: scarcity, repeated });
      // §15.2 repetition suppression: similarity + no meaningful StateDelta + threshold.
      if (utility.duplicationPenalty > 0 && (stagnation.repeatedAction || utility.total <= 0)) {
        suppress(goal, 'CONFLICT_WITH_HIGHER_UTILITY', ruleId);
        continue;
      }
      candidates.push({ goal, purpose, ruleId, participants: selection.participants, degraded: Boolean(selection.degraded), utility });
    }

    // Stagnation escalation: nothing viable & stagnant → human decision or finalize per policy.
    if (!candidates.length) {
      if (stagnation.stagnant) {
        if (finalizationPolicy.mode === 'manual') {
          return makeDecision(input, {
            type: 'REQUEST_HUMAN_DECISION', rationaleCode: 'STAGNATION_MANUAL_POLICY', consideredGoalIds, suppressedRules: suppressed,
            humanDecisionRequest: {
              requestId: `hdr-${input.runId}-stagnation`, type: 'CHOOSE_ACTION',
              question: 'Discussion is stagnant. Choose next step.',
              options: [{ id: 'finalize', label: 'Finalize' }, { id: 'continue', label: 'Continue' }],
              blocking: true, relatedGoalIds: consideredGoalIds, relatedArtifactIds: []
            }
          });
        }
        return makeDecision(input, {
          type: 'FINALIZE', rationaleCode: 'STAGNATION', consideredGoalIds, suppressedRules: suppressed,
          finalizationDecision: {
            reason: 'STAGNATION',
            finalizationMode: input.stateMap?.synthesisArtifactId ? 'SYNTHESIS' : 'STATE_MAP',
            unresolvedGoalIds: requiredOpen.map((g) => g.goalId),
            selectedFinalArtifactIds: arr(input.stateMap?.finalArtifactIds),
            humanApprovalRequired: false
          }
        });
      }
      return activeStages.length
        ? makeDecision(input, { type: 'WAIT', rationaleCode: 'ALL_CANDIDATES_SUPPRESSED', consideredGoalIds, suppressedRules: suppressed })
        : makeDecision(input, { type: 'NO_OP', rationaleCode: 'NO_VIABLE_ACTION', consideredGoalIds, suppressedRules: suppressed });
    }

    // 8. Conflict resolution + selection (§10).
    candidates.sort(tieBreak);
    const maxStages = Math.max(1, Number(budgets.maxStagesPerTick ?? 1));
    const concurrencyRoom = Math.max(0, Number(budgets.maxConcurrentStages ?? Infinity) - activeStages.length);
    const selected = [];
    const usedArtifacts = new Set();
    const participantLoad = new Map();
    const capacityOf = (id) => {
      const definition = arr(input.availableParticipants).find((p) => p.participantId === id);
      return Math.max(1, Number(definition?.capacity ?? 1));
    };
    for (const candidate of candidates) {
      if (selected.length >= Math.min(maxStages, concurrencyRoom || maxStages)) {
        suppress(candidate.goal, 'BUDGET_EXCEEDED', candidate.ruleId);
        continue;
      }
      const artifacts = arr(candidate.goal.targetArtifactIds);
      const artifactConflict = artifacts.some((id) => usedArtifacts.has(id));
      // Participant conflict only above declared capacity (§10.1.3).
      const participantConflict = candidate.participants.some((id) => (participantLoad.get(id) || 0) + 1 > capacityOf(id));
      const dependencyConflict = selected.some((s) => arr(candidate.goal.blockedByGoalIds).includes(s.goal.goalId));
      const mutexConflict = selected.some((s) => candidate.goal.mutexGroup && s.goal.mutexGroup === candidate.goal.mutexGroup);
      if (artifactConflict || participantConflict || dependencyConflict || mutexConflict) {
        suppress(candidate.goal, 'CONFLICT_WITH_HIGHER_UTILITY', candidate.ruleId);
        continue;
      }
      artifacts.forEach((id) => usedArtifacts.add(id));
      candidate.participants.forEach((id) => participantLoad.set(id, (participantLoad.get(id) || 0) + 1));
      selected.push(candidate);
    }
    if (!selected.length) {
      return makeDecision(input, { type: 'WAIT', rationaleCode: 'CONCURRENCY_LIMIT', consideredGoalIds, suppressedRules: suppressed });
    }

    const proposedStages = selected.map((candidate, index) => ({
      proposedStageId: `proposed-${input.runId}-${input.caseVersion}-${index}`,
      purpose: candidate.purpose,
      goalIds: [candidate.goal.goalId],
      participantIds: candidate.participants,
      inputArtifactIds: arr(candidate.goal.targetArtifactIds),
      expectedArtifactTypes: arr(candidate.goal.expectedArtifactTypes),
      dispatchMode: candidate.participants.length > 1 ? 'parallel' : 'single',
      completionMode: candidate.participants.length > 1 ? (input.policies?.completion?.mode || 'all') : 'all',
      executionPolicyId: input.policies?.retry?.policyId || 'retry.default.v1',
      promptContractId: `prompt:${candidate.purpose}:v1`,
      visibilityPolicy: candidate.goal.visibilityPolicy || { mode: 'public' },
      degradedIndependence: candidate.degraded || undefined,
      ruleIds: [candidate.ruleId],
      participantSelectionRationale: candidate.degraded ? 'DEGRADED_INDEPENDENCE' : 'CAPABILITY_AND_INDEPENDENCE_MATCH'
    }));

    return makeDecision(input, {
      type: 'CREATE_STAGES',
      rationaleCode: selected[0].goal.type.toUpperCase(),
      rationaleData: { notes },
      consideredGoalIds,
      selectedGoalIds: selected.map((c) => c.goal.goalId),
      firedRules: selected.map((c) => ({
        ruleId: c.ruleId, version: RULE_SET_VERSION, targetGoalIds: [c.goal.goalId],
        candidateAction: c.purpose, basePriority: c.utility.basePriority,
        matchedConditions: [c.goal.type]
      })),
      suppressedRules: suppressed,
      proposedStages,
      utilityBreakdown: selected.map((c) => c.utility)
    });
  }

  function createPlanner() {
    return Object.freeze({ evaluate, evaluateDerivedGoalCondition, ruleSetVersion: RULE_SET_VERSION });
  }

  const api = Object.freeze({
    RULE_SET_VERSION, PLANNER_ALGORITHM_VERSION, UTILITY_FORMULA_VERSION, GOAL_SCHEMA_VERSION,
    GOAL_TYPES, DECISION_TYPES, SUPPRESSION, GOAL_PURPOSE,
    deriveGoals, evaluateDerivedGoalCondition, dedupeGoals, computeUtility, detectStagnation, evaluate, createPlanner
  });
  root.DebatePlanner = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
