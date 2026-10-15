// Configuration-only presets for the universal discussion pipeline.
(function initPipelinePresets(root) {
  'use strict';

  // The one runner is the Basic engine: an unknown or retired preset id falls back to it (it used to fall back to the Debate engine).
  const DEFAULT_PRESET_ID = 'CUSTOM';
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
    checkpointPolicy: Object.freeze({ enabled: false }),
    reasoningBudget, resourceBudget: Object.freeze({ limit: reasoningBudget.maxTotalStages }),
    safetyPolicy: SAFETY_POLICY, status: 'enabled', ...overrides
  });

  const PIPELINE_PRESETS = Object.freeze([
    // The Default template runs the Basic engine (disput/custom-engine.js), not the Debate engine.
    makePreset('CUSTOM', 'Default', 'UNIVERSAL_STANDARD', REASONING_BUDGETS.STANDARD, { runner: 'custom' }),
  ]);

  const BUILTIN_PIPELINE_DEFINITIONS = Object.freeze([
    // The one built-in template; the others (Polishing, Delta, Test, Research, Architecture) were removed.
    Object.freeze({ name: 'Default', presetId: 'CUSTOM', profileId: 'UNIVERSAL_STANDARD', runPolicy: 'auto', noMiniPrompts: true, length: '700', roundLimit: '2', defaultModelCount: 0, roles: ['participant'] }),
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
      contextPolicy: preset.contextPolicy,
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
