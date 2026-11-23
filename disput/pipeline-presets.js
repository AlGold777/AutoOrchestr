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
    Object.freeze({ name: 'Default', presetId: 'CUSTOM', profileId: 'UNIVERSAL_STANDARD', runPolicy: 'auto', noMiniPrompts: true, length: '700', roundLimit: '1', defaultModelCount: 0, defaultModels: Object.freeze(['GPT', 'Claude']), roles: ['participant'] }),
  ]);

  // Basic schemas seeded into the list on the first start (results.js, initPipelineList). Not presets and not
  // BUILTIN_PIPELINE_DEFINITIONS: each one is seeded once (pipelineStore.seeded); a deleted one is not restored.
  const BUILTIN_SCHEMAS = Object.freeze({
    user_doc: Object.freeze({
      schemaVersion: 1, origin: 'user',
      description: 'Опросник: DeepSeek составляет опросник по задаче из поля модератора, User заполняет его и нажимает «Отправить», ответы отправляются DeepSeek, он пересказывает их по пунктам.',
      run: Object.freeze({ policy: 'auto' }),
      steps: Object.freeze([
        Object.freeze({ ref: 'r1', kind: 'round', models: Object.freeze([Object.freeze({ name: 'DeepSeek' })]),
          task: 'Составь опросник из 5–7 пунктов, чтобы уточнить у пользователя его задачу. Используй разные типы пунктов; ключевые пометь обязательными.',
          output: Object.freeze({ format: 'json', document: 'form' }) }),
        Object.freeze({ ref: 'owner:fill', kind: 'owner', models: Object.freeze([]),
          task: 'Заполните опросник и нажмите «Отправить».',
          document: 'r1' }),
        Object.freeze({ ref: 'r2', kind: 'round', models: Object.freeze([Object.freeze({ name: 'DeepSeek' })]), input: 'previous',
          task: 'Тебе передан заполненный пользователем опросник (вопрос — ответ). Перечисли по пунктам, какие ответы ты получил, и в двух предложениях скажи, что понял о задаче пользователя.' })
      ]),
      end: Object.freeze({ from: Object.freeze(['r2']) })
    })
  });

  // Revision of each built-in schema. A higher revision replaces the copy already seeded into the list (results.js, seedBuiltinSchemas).
  const BUILTIN_SCHEMA_REVISIONS = Object.freeze({ user_doc: 3 });

  const PRESET_BY_ID =Object.freeze(Object.fromEntries(PIPELINE_PRESETS.map((preset) => [preset.id, preset])));
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
    PIPELINE_PRESETS, BUILTIN_PIPELINE_DEFINITIONS, BUILTIN_SCHEMAS, BUILTIN_SCHEMA_REVISIONS, REASONING_BUDGETS, DEFAULT_PRESET_ID,
    normalizePipelinePreset, resolveRuntimeRoundLimits, resolveFinalizationPolicy, getPipelinePreset,
    isLongPreset, isOpenEndedPreset, isPresetEnabled
  });
  root.PipelinePresets = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
