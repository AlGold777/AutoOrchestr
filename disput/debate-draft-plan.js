// Persistent pre-run plan for the universal Canvas. A DraftPlan is the only
// editable source before an Orchestrator creates the initial PlanRevision.
// The Basic canvas builds its plan from rounds only (createCanvasPlan): a synthesis is a round of one model with a role.
// normalize keeps reading stored plans of every shape, a synthesis stage of an older plan included.
(function initDebateDraftPlan(root) {
  'use strict';

  const SCHEMA_VERSION = 1;
  const arr = (value) => Array.isArray(value) ? value : [];
  const clone = (value) => value == null ? value : JSON.parse(JSON.stringify(value));
  const clean = (value) => String(value == null ? '' : value).trim();
  const id = (value) => clean(value).replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '');
  const stageId = (value, fallback) => id(value) || fallback;

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
    return normalize({ planId: input.planId || 'canvas-plan', revision: input.revision || 0, plannedStages: stages, selectedModels });
  }

  const api = Object.freeze({ SCHEMA_VERSION, normalize, validate, createCanvasPlan });
  root.DebateDraftPlan = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
