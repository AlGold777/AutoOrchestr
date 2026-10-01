// Persistent pre-run plan for the universal Canvas. A DraftPlan is the only
// editable source before an Orchestrator creates the initial PlanRevision.
(function initDebateDraftPlan(root) {
  'use strict';

  const SCHEMA_VERSION = 1;
  const arr = (value) => Array.isArray(value) ? value : [];
  const clone = (value) => value == null ? value : JSON.parse(JSON.stringify(value));
  const clean = (value) => String(value == null ? '' : value).trim();
  const id = (value) => clean(value).replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '');
  const stageId = (value, fallback) => id(value) || fallback;

  function stageById(plan, plannedStageId) {
    return arr(plan?.plannedStages).find((stage) => stage.plannedStageId === plannedStageId) || null;
  }

  function normalizeStage(stage = {}, index = 0) {
    const purpose = clean(stage.purpose) || 'response';
    const outputIntent = clean(stage.outputIntent)
      || (purpose === 'synthesis' ? 'working_synthesis' : 'discussion_work');
    const terminalPolicy = clean(stage.terminalPolicy)
      || (outputIntent === 'candidate_final' ? 'eligible_for_finalization' : 'continue');
    return {
      plannedStageId: stageId(stage.plannedStageId, `draft-stage-${index + 1}`),
      purpose,
      status: 'pending',
      participantIds: arr(stage.participantIds).map(clean).filter(Boolean),
      participantBindings: arr(stage.participantBindings).map(clone),
      assignmentPolicy: clean(stage.assignmentPolicy)
        || (purpose === 'synthesis' ? 'explicit_required' : 'planner_select'),
      requiredCapabilities: arr(stage.requiredCapabilities).map(clean).filter(Boolean),
      upstream: arr(stage.upstream).map(clean).filter(Boolean),
      activationPolicy: clean(stage.activationPolicy) || 'immediate',
      outputIntent,
      terminalPolicy,
      auditPolicy: clean(stage.auditPolicy) || 'none',
      expectedArtifactTypes: arr(stage.expectedArtifactTypes).map(clean).filter(Boolean),
      inputSelector: clone(stage.inputSelector || null),
      goalIds: arr(stage.goalIds).map(clean).filter(Boolean),
      ...(stage.label ? { label: clean(stage.label) } : {}),
      // Moderator-facing brief of the stage (template stage card) and its card data.
      ...(clean(stage.instruction) ? { instruction: clean(stage.instruction) } : {}),
      ...(stage.meta && typeof stage.meta === 'object' ? { meta: clone(stage.meta) } : {})
    };
  }

  function validate(plan = {}) {
    const stages = arr(plan.plannedStages);
    const errors = [];
    const ids = new Set();
    stages.forEach((stage, index) => {
      const stageIdValue = clean(stage.plannedStageId);
      if (!stageIdValue) errors.push({ code: 'DRAFT_STAGE_ID_REQUIRED', index });
      else if (ids.has(stageIdValue)) errors.push({ code: 'DRAFT_STAGE_ID_DUPLICATE', plannedStageId: stageIdValue });
      else ids.add(stageIdValue);
      if (!clean(stage.purpose)) errors.push({ code: 'DRAFT_STAGE_PURPOSE_REQUIRED', plannedStageId: stageIdValue });
      if (stage.purpose === 'synthesis' && stage.assignmentPolicy === 'explicit_required' && !arr(stage.participantIds).length) {
        errors.push({ code: 'SYNTHESIS_PARTICIPANT_REQUIRED', plannedStageId: stageIdValue });
      }
    });
    stages.forEach((stage) => arr(stage.upstream).forEach((upstreamId) => {
      if (!ids.has(upstreamId)) errors.push({ code: 'INVALID_INSERTION_POINT', plannedStageId: stage.plannedStageId, upstreamId });
    }));
    const visiting = new Set();
    const visited = new Set();
    const byId = new Map(stages.map((stage) => [stage.plannedStageId, stage]));
    const visit = (stageIdValue) => {
      if (visiting.has(stageIdValue)) { errors.push({ code: 'DEPENDENCY_CYCLE', plannedStageId: stageIdValue }); return; }
      if (visited.has(stageIdValue)) return;
      visiting.add(stageIdValue);
      arr(byId.get(stageIdValue)?.upstream).forEach(visit);
      visiting.delete(stageIdValue);
      visited.add(stageIdValue);
    };
    stages.forEach((stage) => visit(stage.plannedStageId));
    return { valid: !errors.length, errors };
  }

  function normalize(plan = {}) {
    const stages = arr(plan.plannedStages).map(normalizeStage);
    return {
      schemaVersion: SCHEMA_VERSION,
      planId: clean(plan.planId) || 'draft-plan',
      revision: Math.max(0, Number(plan.revision || 0)),
      plannedStages: stages,
      updatedAt: clean(plan.updatedAt) || new Date().toISOString()
    };
  }

  function createCanvasPlan(input = {}) {
    const selectedModels = arr(input.selectedModels).map(clean).filter(Boolean);
    const rounds = arr(input.rounds).filter((round) => arr(round.participantIds).length);
    const stages = rounds.map((round, index) => normalizeStage({
      plannedStageId: stageId(round.plannedStageId, `canvas-r${index + 1}`),
      label: clean(round.label) || `R${index + 1}`,
      purpose: clean(round.purpose) || (index === 0 ? 'position' : 'response'),
      participantIds: arr(round.participantIds).map(clean).filter(Boolean),
      participantBindings: arr(round.participantBindings),
      assignmentPolicy: 'explicit_required',
      requiredCapabilities: [],
      upstream: index ? [stageId(rounds[index - 1]?.plannedStageId, `canvas-r${index}`)] : [],
      activationPolicy: 'immediate',
      outputIntent: 'discussion_work',
      terminalPolicy: 'continue',
      expectedArtifactTypes: index === 0 ? ['claim'] : ['revision'],
      instruction: round.instruction,
      meta: round.meta
    }, index));
    const synthesizer = clean(input.synthesizer);
    if (synthesizer) {
      stages.push(normalizeStage({
        plannedStageId: 'planned-final-synthesis', label: 'Final synthesis', purpose: 'synthesis',
        participantIds: [synthesizer], assignmentPolicy: 'explicit_required', requiredCapabilities: ['synthesis'],
        upstream: stages.length ? [stages[stages.length - 1].plannedStageId] : [],
        activationPolicy: 'finalization_ready', outputIntent: 'candidate_final',
        terminalPolicy: 'eligible_for_finalization', auditPolicy: 'none',
        expectedArtifactTypes: ['synthesis_conclusion']
      }, stages.length));
    }
    return normalize({ planId: input.planId || 'canvas-plan', revision: input.revision || 0, plannedStages: stages, selectedModels });
  }

  function insertSynthesis(plan, { afterPlannedStageId, participantIds, plannedStageId } = {}) {
    const normalized = normalize(plan);
    const sourceIndex = normalized.plannedStages.findIndex((stage) => stage.plannedStageId === afterPlannedStageId);
    if (sourceIndex < 0) return { ok: false, code: 'SEMANTIC_INVALID', reasonCode: 'INVALID_INSERTION_POINT' };
    const assignments = arr(participantIds).map(clean).filter(Boolean);
    if (!assignments.length) return { ok: false, code: 'SEMANTIC_INVALID', reasonCode: 'SYNTHESIS_PARTICIPANT_REQUIRED' };
    const next = clone(normalized);
    const insertedId = stageId(plannedStageId, `planned-working-synthesis-${next.revision + 1}-${sourceIndex + 1}`);
    if (stageById(next, insertedId)) return { ok: false, code: 'SEMANTIC_INVALID', reasonCode: 'PLANNED_STAGE_ID_DUPLICATE' };
    const downstream = next.plannedStages.filter((stage) => arr(stage.upstream).includes(afterPlannedStageId));
    const stage = normalizeStage({
      plannedStageId: insertedId, purpose: 'synthesis', participantIds: assignments,
      assignmentPolicy: 'explicit_required', requiredCapabilities: ['synthesis'], upstream: [afterPlannedStageId],
      activationPolicy: 'immediate', outputIntent: 'working_synthesis', terminalPolicy: 'continue',
      auditPolicy: 'none', expectedArtifactTypes: ['synthesis_working'], goalIds: []
    }, sourceIndex + 1);
    downstream.forEach((item) => { item.upstream = arr(item.upstream).map((value) => value === afterPlannedStageId ? insertedId : value); });
    next.plannedStages.splice(sourceIndex + 1, 0, stage);
    next.revision += 1;
    next.updatedAt = new Date().toISOString();
    return { ok: true, plan: normalize(next), stage };
  }

  function setStageParticipants(plan, plannedStageId, participantIds) {
    const next = normalize(plan);
    const stage = stageById(next, plannedStageId);
    if (!stage) return { ok: false, code: 'SEMANTIC_INVALID', reasonCode: 'PLANNED_STAGE_NOT_FOUND' };
    const assignments = arr(participantIds).map(clean).filter(Boolean);
    if (stage.purpose === 'synthesis' && stage.assignmentPolicy === 'explicit_required' && !assignments.length) {
      return { ok: false, code: 'SEMANTIC_INVALID', reasonCode: 'SYNTHESIS_PARTICIPANT_REQUIRED' };
    }
    stage.participantIds = assignments;
    next.revision += 1;
    next.updatedAt = new Date().toISOString();
    return { ok: true, plan: normalize(next) };
  }

  const api = Object.freeze({ SCHEMA_VERSION, normalize, validate, createCanvasPlan, insertSynthesis, setStageParticipants });
  root.DebateDraftPlan = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
