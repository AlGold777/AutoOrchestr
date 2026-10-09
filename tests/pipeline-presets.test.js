const Presets = require('../disput/pipeline-presets');

describe('universal pipeline presets', () => {
  test('offers purpose profiles without execution topologies', () => {
    expect(Presets.DEFAULT_PRESET_ID).toBe('UNIVERSAL_STANDARD');
    expect(Presets.PIPELINE_PRESETS.map((preset) => preset.id)).toEqual([
      'UNIVERSAL_STANDARD', 'CUSTOM', 'TEST', 'UNIVERSAL_RESEARCH', 'UNIVERSAL_RED_TEAM', 'ARCHITECTURE', 'POLISHING', 'DELTA'
    ]);
    expect(Presets.BUILTIN_PIPELINE_DEFINITIONS.map((item) => item.name)).toEqual([
      'Basic', 'Polishing', 'Delta', 'Test', 'Research', 'Architecture'
    ]);
    expect(JSON.stringify(Presets.PIPELINE_PRESETS)).not.toMatch(/topology|scheme|roundLimit|waveLimit|turnLimit/i);
    expect(Presets.isPresetEnabled('CUSTOM')).toBe(true);
    expect(Presets.getPipelinePreset('CUSTOM').runner).toBe('custom');
    expect(Presets.isPresetEnabled('UNIVERSAL_RED_TEAM')).toBe(false);
  });

  test('normalizes an explicit universal stage budget', () => {
    expect(Presets.normalizePipelinePreset('UNIVERSAL_RESEARCH', {
      currentUiLimits: { maxTotalStages: 18 }
    })).toMatchObject({
      presetId: 'UNIVERSAL_RESEARCH', profileId: 'DEEP_RESEARCH_ALPHA',
      maxTotalStages: 18, resourceBudget: { limit: 18 }
    });
  });

  test('unknown IDs fail safely to the standard profile', () => {
    expect(Presets.getPipelinePreset('removed-mode')).toBe(Presets.getPipelinePreset('UNIVERSAL_STANDARD'));
    expect(Presets.isPresetEnabled('removed-mode')).toBe(true);
  });

  test('maps each preset finalization policy into the runtime policy contract', () => {
    expect(Presets.normalizePipelinePreset('UNIVERSAL_STANDARD').finalization)
      .toMatchObject({ mode: 'after_required_goals', synthesis: 'optional', audit: 'optional' });
    expect(Presets.normalizePipelinePreset('UNIVERSAL_RESEARCH').finalization)
      .toMatchObject({ mode: 'after_required_goals', synthesis: 'optional', audit: 'optional' });
    expect(Presets.normalizePipelinePreset('UNIVERSAL_RED_TEAM').finalization)
      .toEqual({
        mode: 'after_synthesis',
        synthesis: 'required',
        audit: 'required',
        allowContinueAfterSynthesis: false
      });
  });
});
