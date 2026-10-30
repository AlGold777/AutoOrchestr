const Presets = require('../disput/pipeline-presets');

describe('pipeline presets: the one runner is the Basic engine', () => {
  test('offers the one preset, the Default template, run by the Basic engine', () => {
    expect(Presets.DEFAULT_PRESET_ID).toBe('CUSTOM');
    expect(Presets.PIPELINE_PRESETS.map((preset) => preset.id)).toEqual(['CUSTOM']);
    expect(Presets.BUILTIN_PIPELINE_DEFINITIONS.map((item) => item.name)).toEqual(['Default']);
    expect(JSON.stringify(Presets.PIPELINE_PRESETS)).not.toMatch(/topology|scheme|roundLimit|waveLimit|turnLimit/i);
    expect(Presets.isPresetEnabled('CUSTOM')).toBe(true);
    expect(Presets.getPipelinePreset('CUSTOM').runner).toBe('custom');
  });

  test('normalizes an explicit stage budget', () => {
    expect(Presets.normalizePipelinePreset('CUSTOM', {
      currentUiLimits: { maxTotalStages: 18 }
    })).toMatchObject({
      presetId: 'CUSTOM', profileId: 'UNIVERSAL_STANDARD',
      maxTotalStages: 18, resourceBudget: { limit: 18 }
    });
  });

  test('an unknown or retired id falls back to the Basic engine, never to a Debate preset', () => {
    ['removed-mode', 'UNIVERSAL_STANDARD', 'UNIVERSAL_RED_TEAM', 'POLISHING', 'DELTA', 'TEST', 'UNIVERSAL_RESEARCH', 'ARCHITECTURE'].forEach((id) => {
      expect(Presets.getPipelinePreset(id)).toBe(Presets.getPipelinePreset('CUSTOM'));
      expect(Presets.getPipelinePreset(id).runner).toBe('custom');
      expect(Presets.isPresetEnabled(id)).toBe(true);
    });
  });

  test('maps the preset finalization policy into the runtime policy contract', () => {
    expect(Presets.normalizePipelinePreset('CUSTOM').finalization)
      .toMatchObject({ mode: 'after_required_goals', synthesis: 'optional', audit: 'optional' });
  });
});
