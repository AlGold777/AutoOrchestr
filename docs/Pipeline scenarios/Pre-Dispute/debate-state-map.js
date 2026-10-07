(function initDebateStateMap(root) {
  'use strict';
  const VERSION = 4;
  const ContextBudget = root.DebateContextBudget || (typeof require === 'function' ? require('./debate-context-budget') : null);
  const CaseSchema = root.DebateCaseSchema || (typeof require === 'function' ? require('./debate-case-schema') : null);
  const text = (value) => String(value == null ? '' : value).trim();
  const values = (object) => object && typeof object === 'object' ? Object.values(object) : [];

  function normalizeArtifact(raw = {}) {
    const type = text(raw.type || raw.artifactType || 'unknown');
    const status = text(raw.status || 'unknown');
    return {
      id: text(raw.id), type, status,
      title: text(raw.formulation || raw.text || raw.title || raw.term || raw.id),
      description: text(raw.description || raw.reason || raw.detail),
      targetId: text(raw.targetId || raw.claimId || raw.target),
      axis: text(raw.axis || raw.axisId), severity: text(raw.severity), tier: text(raw.tier || raw.evidenceTier),
      owner: text(raw.owner || raw.model || raw.author), requiredAction: text(raw.requiredAction),
      confidence: Number(raw.extractionConfidence ?? raw.confidence ?? 0), revision: Number(raw.revision || 0),
      supersededBy: text(raw.supersededBy), mergedInto: text(raw.mergedInto),
      openedAt: Number(raw.wave || raw.openedAt || 0), lastChangedAt: Number(raw.lastWave || raw.updatedAt || raw.wave || 0),
      history: Array.isArray(raw.history) ? raw.history.slice() : [], provenance: raw.provenance || raw.anchor || null
    };
  }

  const isOpen = (item) => ['proposed', 'open', 'raised', 'unresolved', 'clarifying', 'partially_closed', 'reopened', 'asserted', 'contested', 'disputed'].includes(item.status);
  const isActionable = (item) => typeof CaseSchema?.isActionable === 'function' ? CaseSchema.isActionable(item) : isOpen(item);
  const isBlocking = (item) => item.severity === 'blocking' || item.severity === 'critical' || item.severity === 'high';

  function readiness({ blockers, axes, open, evidenceGaps, dissent }) {
    if (blockers.length) return { id: 'not_ready', label: 'Не готово к синтезу', reason: `${blockers.length} blocking` };
    const unchecked = axes.filter((axis) => axis.required && axis.status === 'not_checked');
    if (unchecked.length) return { id: 'not_ready', label: 'Не готово к синтезу', reason: `${unchecked.length} обязательных проверок не выполнено` };
    if (evidenceGaps.length) return { id: 'inconclusive', label: 'Недостаточно данных', reason: `${evidenceGaps.length} evidence gaps` };
    if (dissent.length || open.length) return { id: 'limited', label: 'Готово с ограничениями', reason: `${open.length} открыто · ${dissent.length} dissent` };
    return { id: 'ready', label: 'Готово к синтезу', reason: 'Критических препятствий нет' };
  }

  function project(input = {}) {
    const externalRuleHistory = input?.ruleHistory || null;
    let caseDiff = null;
    let snapshots = [];
    if (input?.caseId && input?.artifacts) {
      snapshots = (Array.isArray(input.snapshots) ? input.snapshots : []).map((snapshot) => ({
        id: text(snapshot.snapshotId),
        sequence: Number(snapshot.sequence || 0),
        reason: text(snapshot.reason),
        at: text(snapshot.at),
        artifacts: snapshot.projection?.artifacts || {}
      }));
      const previousArtifacts = snapshots.at(-2)?.artifacts || {};
      const currentArtifacts = snapshots.at(-1)?.artifacts || input.artifacts;
      const added = Object.keys(currentArtifacts).filter((id) => !previousArtifacts[id]);
      const changed = Object.keys(currentArtifacts).filter((id) => previousArtifacts[id] && JSON.stringify(previousArtifacts[id]) !== JSON.stringify(currentArtifacts[id]));
      const removed = Object.keys(previousArtifacts).filter((id) => !currentArtifacts[id]);
      caseDiff = { from: snapshots.at(-2)?.id || '', to: snapshots.at(-1)?.id || '', added, changed, removed };
      const artifacts = values(input.artifacts).map(normalizeArtifact).filter((item) => item.id);
      input = {
        runId: input.runId || input.caseId,
        caseVersion: Number(input.caseVersion || 0),
        sessionId: input.sessionId,
        status: input.technicalStatus,
        epistemicOutcome: input.epistemicOutcome,
        config: { topic: input.title },
        executionPlan: { profileId: input.profile?.id },
        protocolState: { registry: { artifacts }, axisVerdicts: artifacts.filter((item) => item.type === 'axis_verdict') },
        events: [
          ...(input.sourceEvents || []).map((event) => ({ id: event.eventId, type: event.type || event.eventType || 'SOURCE_EVENT', at: event.at, payload: { title: event.actor || event.model || event.type } })),
          ...(input.changes || []).map((change) => ({ id: change.changeId, type: change.kind === 'RECORD_HUMAN_DECISION' ? 'HUMAN_DECISION_RECORDED' : 'REGISTRY_UPDATED', at: change.at, payload: { title: change.details?.artifactId || change.details?.decisionId || change.kind } }))
        ],
        taskContract: input.taskContract || null,
        humanDecisions: input.humanDecisions || []
      };
    }
    const aggregate = input.aggregate || input;
    const protocol = aggregate?.protocolState || {};
    const registry = input.registry || protocol.registry || aggregate.registry || {};
    const artifacts = values(registry.artifacts).map(normalizeArtifact).filter((item) => item.id);
    const claims = artifacts.filter((item) => item.type === 'claim');
    const objections = artifacts.filter((item) => item.type === 'objection' || item.type === 'open_issue');
    const evidence = artifacts.filter((item) => item.type === 'evidence');
    const revisions = artifacts.filter((item) => item.type === 'revision');
    const assumptions = artifacts.filter((item) => item.type === 'assumption');
    const contradictions = artifacts.filter((item) => item.type === 'contradiction');
    const openQuestions = artifacts.filter((item) => item.type === 'open_question');
    const decisionCriteria = artifacts.filter((item) => item.type === 'decision_criterion');
    const dissent = artifacts.filter((item) => item.type === 'dissent' || item.status === 'dissent');
    const workingSyntheses = artifacts.filter((item) => item.type === 'synthesis_working');
    const artifactAuthors = Object.fromEntries(artifacts.filter((item) => item.id && item.owner).map((item) => [item.id, item.owner]));
    const actionableObjections = objections.filter(isActionable);
    const actionableContradictions = contradictions.filter(isActionable);
    const actionableDissent = dissent.filter(isActionable);
    const actionableQuestions = openQuestions.filter(isActionable);
    const finalArtifacts = artifacts.filter((item) => item.type === 'synthesis_conclusion' && !item.supersededBy && !item.mergedInto);
    const contextChars = artifacts.reduce((total, item) => total + text(item.title).length + text(item.description).length, 0);
    const budget = ContextBudget?.check?.({ parts: artifacts.map((item) => ({ id: item.id, text: `${item.title}\n${item.description}` })) });
    const contextPressure = budget ? Math.min(1, budget.totalChars / Math.max(1, budget.totalChars + Math.max(0, 52000 - budget.totalChars))) : Math.min(1, contextChars / 52000);
    const limitations = artifacts.filter((item) => item.status === 'accepted_as_limitation' || item.status === 'limitation');
    const evidenceGaps = artifacts.filter((item) => item.type === 'evidence_gap');
    const open = artifacts.filter(isOpen);
    const blockers = objections.filter((item) => isOpen(item) && isBlocking(item));
    const links = artifacts.filter((item) => item.targetId).map((item) => {
      const link = { from: item.id, to: item.targetId, type: item.type, blocking: isBlocking(item) };
      if (item.provenance?.source === 'state_map_drawer') link.removable = true;
      return link;
    });
    const axes = values(registry.axisVerdicts || protocol.axisVerdicts).map((axis) => ({ id: text(axis.id || axis.axisId), type: 'axis_verdict', title: text(axis.title || axis.label || axis.axisId), status: text(axis.status || axis.verdict || 'not_checked'), required: axis.required !== false, blocking: Boolean(axis.blocking), openCount: Number(axis.openCount || 0), history: Array.isArray(axis.history) ? axis.history.slice() : [], provenance: axis.provenance || null }));
    const runId = text(aggregate?.runId);
    const ready = runId ? readiness({ blockers, axes, open, evidenceGaps, dissent }) : { id: 'idle', label: 'Нет активного дела', reason: 'Запустите pipeline' };
    const attention = [...blockers, ...contradictions.filter(isOpen), ...dissent, ...evidenceGaps, ...openQuestions.filter(isOpen), ...axes.filter((axis) => axis.status === 'issue_found')]
      .slice(0, 8);
    const eventList = Array.isArray(aggregate?.events) ? aggregate.events : [];
    const timeline = eventList.filter((event) => ['START_REQUESTED', 'CHECKPOINT_COMPLETED', 'REGISTRY_UPDATED', 'HUMAN_DECISION_RECORDED', 'DECISION_REQUESTED', 'DECISION_RESOLVED', 'RULE_FIRED', 'PROGRESS_WINDOW_UPDATED', 'FINALIZATION_COMPLETED', 'RUN_FAILED', 'CANCEL_REQUESTED', 'SOURCE_EVENT'].includes(event.type)).map((event) => ({ id: event.id, type: event.type, at: event.at, title: text(event.payload?.title || event.payload?.question || event.payload?.triggerId || event.payload?.stageId || event.type), delta: event.payload?.delta || null }));
    const decisionRequests = Array.isArray(aggregate?.decisionRequests) ? aggregate.decisionRequests.slice() : [];
    if (aggregate?.pendingHumanDecision?.requestId
      && !decisionRequests.some((item) => item.requestId === aggregate.pendingHumanDecision.requestId)) {
      decisionRequests.push({ ...aggregate.pendingHumanDecision, status: 'pending' });
    }
    const ruleEvaluations = Array.isArray(aggregate?.ruleEvaluations) ? aggregate.ruleEvaluations.slice() : [];
    const pendingDecisions = decisionRequests.filter((item) => item.status === 'pending');
    return Object.freeze({
      version: VERSION, runId, sessionId: text(aggregate?.sessionId),
      sourceCaseVersion: Number(input?.caseVersion ?? aggregate?.caseVersion ?? 0),
      projectorVersion: VERSION,
      title: text(aggregate?.config?.topic || protocol.topic || 'Текущее дело'),
      profileId: text(aggregate?.executionPlan?.profileId || aggregate?.executionPlan?.presetId || aggregate?.preset?.presetId),
      currentStageId: text(aggregate?.currentStageId || aggregate?.execution?.activeStageId || protocol.currentStageId || protocol.phase),
      technicalStatus: text(aggregate?.status || protocol.status || 'idle'), epistemicOutcome: text(aggregate?.epistemicOutcome),
      taskContract: aggregate?.taskContract || aggregate?.config?.taskContract || null,
      humanDecisions: Array.isArray(aggregate?.humanDecisions) ? aggregate.humanDecisions.slice() : [],
      decisionRequests, pendingDecisions, ruleEvaluations,
      progressWindow: Array.isArray(aggregate?.progressWindow) ? aggregate.progressWindow.slice() : [],
      modelSignals: Array.isArray(aggregate?.modelSignals) ? aggregate.modelSignals.slice() : [],
      ruleHistory: externalRuleHistory || aggregate?.ruleHistory || null,
      automation: protocol.triggerState ? {
        actionCount: Number(protocol.actionCount || 0),
        active: Array.isArray(protocol.triggerState.active) ? protocol.triggerState.active.slice() : [],
        queue: Array.isArray(protocol.triggerState.queue) ? protocol.triggerState.queue.slice() : [],
        awaitingHuman: pendingDecisions.length ? pendingDecisions : (protocol.triggerState.queue || []).filter((task) => task.status === 'awaiting_confirmation'),
        budget: { ...(protocol.triggerState.budget || {}) }
      } : null,
      claims, assumptions, objections, evidence, revisions, dissent, workingSyntheses, contradictions, openQuestions, questions: openQuestions, decisionCriteria, limitations, evidenceGaps, links, axes, blockers, attention, timeline, readiness: ready,
      artifactAuthors, contextPressure, contextChars,
      contextTokensEstimate: Math.ceil(contextChars / 4),
      finalArtifactIds: finalArtifacts.map((item) => item.id),
      actionableObjections, actionableContradictions, actionableDissent, actionableQuestions,
      diff: caseDiff, snapshots,
      stats: { open: open.length, blockers: blockers.length, dissent: dissent.length, contradictions: contradictions.length, openQuestions: openQuestions.length, evidenceGaps: evidenceGaps.length, claims: claims.length, evidence: evidence.length }
    });
  }

  function compareSnapshots(from = {}, to = {}) {
    const before = from.artifacts || {};
    const after = to.artifacts || {};
    const added = Object.keys(after).filter((id) => !before[id]);
    const removed = Object.keys(before).filter((id) => !after[id]);
    const changed = Object.keys(after).filter((id) => before[id] && JSON.stringify(before[id]) !== JSON.stringify(after[id]));
    return Object.freeze({ from: text(from.id), to: text(to.id), added, changed, removed });
  }

  const api = Object.freeze({ VERSION, normalizeArtifact, project, readiness, compareSnapshots });
  root.DebateStateMap = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
