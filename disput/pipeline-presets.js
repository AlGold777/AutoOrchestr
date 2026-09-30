// Configuration-only presets for the universal discussion pipeline.
(function initPipelinePresets(root) {
  'use strict';

  const DEFAULT_PRESET_ID = 'UNIVERSAL_STANDARD';
  const STANDARD_BUDGET = Object.freeze({ class: 'standard', maxTotalStages: 12, critiqueDepth: 1, synthesisPasses: 1 });
  const RESEARCH_BUDGET = Object.freeze({ class: 'research', maxTotalStages: 30, critiqueDepth: 2, synthesisPasses: 1 });
  const RED_TEAM_BUDGET = Object.freeze({ class: 'red_team', maxTotalStages: 24, critiqueDepth: 3, synthesisPasses: 1 });
  const REASONING_BUDGETS = Object.freeze({
    STANDARD: STANDARD_BUDGET, RESEARCH: RESEARCH_BUDGET, RED_TEAM: RED_TEAM_BUDGET,
    VERDICT_STANDARD: STANDARD_BUDGET, LONG_INFINITE: RESEARCH_BUDGET, RED_TEAM_MEDIUM: RED_TEAM_BUDGET
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
      { finalizationPolicy: 'after_audited_synthesis' })
  ]);

  const BUILTIN_PIPELINE_DEFINITIONS = Object.freeze([
    Object.freeze({ name: 'Universal', presetId: 'UNIVERSAL_STANDARD', profileId: 'UNIVERSAL_STANDARD', runPolicy: 'auto', length: '700', defaultModelCount: 2, roles: ['participant', 'critic', 'verifier', 'synthesizer'] }),
    Object.freeze({ name: 'Test', presetId: 'TEST', profileId: 'UNIVERSAL_STANDARD', runPolicy: 'auto', length: '700', roundLimit: '2', defaultModelCount: 2, roles: ['participant', 'critic'] }),
    Object.freeze({ name: 'Research', presetId: 'UNIVERSAL_RESEARCH', profileId: 'DEEP_RESEARCH_ALPHA', runPolicy: 'auto', length: '1000', defaultModelCount: 2, roles: ['researcher', 'critic', 'verifier', 'synthesizer'] }),
    Object.freeze({ name: 'Red Team', presetId: 'UNIVERSAL_RED_TEAM', profileId: 'UNIVERSAL_RED_TEAM', runPolicy: 'auto', length: '900', defaultModelCount: 3, roles: ['proposer', 'critic', 'verifier', 'synthesizer'] })
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
