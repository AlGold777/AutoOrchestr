// Configuration-only presets for the universal discussion pipeline.
(function initPipelinePresets(root) {
  'use strict';

  const DEFAULT_PRESET_ID = 'UNIVERSAL_STANDARD';
  const STANDARD_BUDGET = Object.freeze({ class: 'standard', maxTotalStages: 12, critiqueDepth: 1, synthesisPasses: 1 });
  const RESEARCH_BUDGET = Object.freeze({ class: 'research', maxTotalStages: 30, critiqueDepth: 2, synthesisPasses: 1 });
  const RED_TEAM_BUDGET = Object.freeze({ class: 'red_team', maxTotalStages: 24, critiqueDepth: 3, synthesisPasses: 1 });
  // Product→Architecture template: 30 framework stages (26 with models, 4 gates).
  const ARCHITECTURE_BUDGET = Object.freeze({ class: 'research', maxTotalStages: 40, critiqueDepth: 2, synthesisPasses: 1 });
  const REASONING_BUDGETS = Object.freeze({
    STANDARD: STANDARD_BUDGET, RESEARCH: RESEARCH_BUDGET, RED_TEAM: RED_TEAM_BUDGET,
    VERDICT_STANDARD: STANDARD_BUDGET, LONG_INFINITE: RESEARCH_BUDGET, RED_TEAM_MEDIUM: RED_TEAM_BUDGET,
    ARCHITECTURE: ARCHITECTURE_BUDGET
  });
  // Compatibility names describe budget classes, not execution architectures.

  const SAFETY_POLICY = Object.freeze({ canPause: true, canRecover: true, canError: true, canCancel: true });
  const makePreset = (id, label, profileId, reasoningBudget, overrides = {}) => Object.freeze({
    id, label, profileId, duration: 'goal_driven', terminationOwner: 'planner_and_moderator',
    finalizationPolicy: 'after_required_goals', contextPolicy: 'relevance_budgeted',
    anonymizeParticipants: false, checkpointPolicy: Object.freeze({ enabled: false }),
    reasoningBudget, resourceBudget: Object.freeze({ limit: reasoningBudget.maxTotalStages }),
    safetyPolicy: SAFETY_POLICY, status: 'enabled', ...overrides
  });

  const PIPELINE_PRESETS = Object.freeze([
    makePreset('UNIVERSAL_STANDARD', 'Universal', 'UNIVERSAL_STANDARD', REASONING_BUDGETS.STANDARD),
    makePreset('TEST', 'Test', 'UNIVERSAL_STANDARD', REASONING_BUDGETS.STANDARD),
    makePreset('UNIVERSAL_RESEARCH', 'Research', 'DEEP_RESEARCH_ALPHA', REASONING_BUDGETS.RESEARCH,
      { finalizationPolicy: 'readiness_or_moderator' }),
    makePreset('UNIVERSAL_RED_TEAM', 'Red Team', 'UNIVERSAL_RED_TEAM', REASONING_BUDGETS.RED_TEAM,
      { finalizationPolicy: 'after_audited_synthesis' }),
    makePreset('ARCHITECTURE', 'Architecture', 'UNIVERSAL_STANDARD', REASONING_BUDGETS.ARCHITECTURE,
      { finalizationPolicy: 'readiness_or_moderator' }),
    // Polishing runs its own loop (disput/polishing-pipeline.js), not the Debate engine.
    makePreset('POLISHING', 'Polishing', 'UNIVERSAL_STANDARD', REASONING_BUDGETS.STANDARD, { runner: 'polishing' }),
    // Delta runs its own loop too (disput/delta-pipeline.js).
    makePreset('DELTA', 'Delta', 'UNIVERSAL_STANDARD', REASONING_BUDGETS.STANDARD, { runner: 'delta' })
  ]);

  const BUILTIN_PIPELINE_DEFINITIONS = Object.freeze([
    Object.freeze({ name: 'Test', presetId: 'TEST', profileId: 'UNIVERSAL_STANDARD', runPolicy: 'auto', noMiniPrompts: true, length: '700', roundLimit: '2', defaultModelCount: 0, roles: ['participant', 'critic'] }),
    // Исследование: 15 stages from ResearchFramework (disput/research-framework.js), automatic
    // with three moderator gates (G1 specification, G2 sufficiency, G3 acceptance).
    Object.freeze({ name: 'Research', presetId: 'UNIVERSAL_RESEARCH', profileId: 'DEEP_RESEARCH_ALPHA', runPolicy: 'auto', length: '1000', roundLimit: '15', stageTemplate: 'research', defaultModelCount: 0, roles: ['researcher', 'critic', 'verifier', 'synthesizer'] }),
    Object.freeze({ name: 'Red Team', presetId: 'UNIVERSAL_RED_TEAM', profileId: 'UNIVERSAL_RED_TEAM', runPolicy: 'auto', length: '900', defaultModelCount: 0, roles: ['proposer', 'critic', 'verifier', 'synthesizer'] }),
    // Разработка архитектуры: stage by stage with the moderator (semi-automatic by default).
    // The 30 stages come from ArchitectureFramework (disput/architecture-framework.js).
    Object.freeze({ name: 'Architecture', presetId: 'ARCHITECTURE', profileId: 'UNIVERSAL_STANDARD', runPolicy: 'manual', length: '1000', roundLimit: '30', stageTemplate: 'architecture', defaultModelCount: 0, roles: ['participant', 'critic', 'verifier', 'synthesizer'] }),
    // Polishing: collects fresh improvements of one idea. Canvas rounds are the rounds, the order of
    // models in a round is the call order; polishingMaxIdeas is K (lines per answer).
    Object.freeze({ name: 'Polishing', presetId: 'POLISHING', profileId: 'UNIVERSAL_STANDARD', runPolicy: 'auto', noMiniPrompts: true, length: '300', roundLimit: '3', defaultModelCount: 0, roles: ['participant'], polishingMaxIdeas: 3 }),
    // Delta: models take turns adding one word to the phrase; later turns carry only the change.
    // Canvas rounds are the rounds, the order of models in a round is the order of turns.
    Object.freeze({ name: 'Delta', presetId: 'DELTA', profileId: 'UNIVERSAL_STANDARD', runPolicy: 'auto', noMiniPrompts: true, length: '300', roundLimit: '3', defaultModelCount: 0, roles: ['participant'] })
  ]);

  const PRESET_BY_ID = Object.freeze(Object.fromEntries(PIPELINE_PRESETS.map((preset) => [preset.id, preset])));
  function getPipelinePreset(presetId) { return PRESET_BY_ID[presetId] || PRESET_BY_ID[DEFAULT_PRESET_ID]; }
  function resolveFinalizationPolicy(value) {
    const policy = String(value || 'after_required_goals');
    if (policy === 'after_audited_synthesis') {
      return Object.freeze({
        mode: 'after_synthesis',
        synthesis: 'required',
        audit: 'required',
        allowContinueAfterSynthesis: false
      });
    }
    if (policy === 'readiness_or_moderator') {
      return Object.freeze({
        mode: 'after_required_goals',
        synthesis: 'optional',
        audit: 'optional',
        allowContinueAfterSynthesis: true
      });
    }
    return Object.freeze({
      mode: 'after_required_goals',
      synthesis: 'optional',
      audit: 'optional',
      allowContinueAfterSynthesis: true
    });
  }
  const isPresetEnabled = (presetOrId) => getPipelinePreset(typeof presetOrId === 'string' ? presetOrId : presetOrId?.id).status === 'enabled';
  const isOpenEndedPreset = () => false;
  const isLongPreset = (presetOrId) => getPipelinePreset(typeof presetOrId === 'string' ? presetOrId : presetOrId?.id).reasoningBudget.class === 'research';

  function resolveRuntimeRoundLimits(presetOrId, input = {}) {
    const preset = getPipelinePreset(typeof presetOrId === 'string' ? presetOrId : presetOrId?.id);
    const requested = Number(input.maxTotalStages || input.storedRoundLimit || input.uiRoundLimit);
    const maxTotalStages = Number.isFinite(requested) && requested > 0 ? requested : preset.reasoningBudget.maxTotalStages;
    return Object.freeze({ maxTotalStages, roundLimit: null, turnLimit: null, waveLimit: null });
  }

  function normalizePipelinePreset(presetId, userOptions = {}) {
    const preset = getPipelinePreset(presetId);
    const limits = resolveRuntimeRoundLimits(preset, userOptions.currentUiLimits || userOptions);
    return Object.freeze({
      presetId: preset.id, profileId: preset.profileId, duration: preset.duration,
      terminationOwner: preset.terminationOwner, finalizationPolicy: preset.finalizationPolicy,
      finalization: resolveFinalizationPolicy(preset.finalizationPolicy),
      contextPolicy: preset.contextPolicy, anonymizeParticipants: preset.anonymizeParticipants,
      checkpointPolicy: preset.checkpointPolicy, reasoningBudget: Object.freeze({ ...preset.reasoningBudget }),
      resourceBudget: Object.freeze({ limit: limits.maxTotalStages }), safetyPolicy: preset.safetyPolicy,
      maxTotalStages: limits.maxTotalStages
    });
  }

  const api = Object.freeze({
    PIPELINE_PRESETS, BUILTIN_PIPELINE_DEFINITIONS, REASONING_BUDGETS, DEFAULT_PRESET_ID,
    normalizePipelinePreset, resolveRuntimeRoundLimits, resolveFinalizationPolicy, getPipelinePreset,
    isLongPreset, isOpenEndedPreset, isPresetEnabled
  });
  root.PipelinePresets = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
