const fs = require('fs');
const path = require('path');
const results = fs.readFileSync(path.join(__dirname, '..', 'results.js'), 'utf8');

describe('Circle edits the Basic canvas and schema', () => {
  test('usesBasicCanvas is the custom or circle runner', () => {
    expect(results).toMatch(/const usesBasicCanvas = \(\) => \{\s*const runner = window\.PipelinePresets\?\.getPipelinePreset\?\.\(getSelectedPipelinePresetId\(\)\)\?\.runner;\s*return runner === 'custom' \|\| runner === 'circle';\s*\};/);
  });

  test('isCustomEnginePipeline is only the definition: every editing place uses the canvas check', () => {
    const uses = results.match(/isCustomEnginePipeline\(\)/g) || [];
    expect(uses.length).toBe(0);
    expect(results).toContain("const isCustomEnginePipeline = () => window.PipelinePresets?.getPipelinePreset?.(getSelectedPipelinePresetId())?.runner === 'custom';");
  });

  test('add model, save, drag, drop, export and capture follow the canvas', () => {
    expect(results).toContain('const canAddModel = editable && (custom || draft) && usesBasicCanvas() && !pipelineRunActive;');
    expect(results).toContain('if (usesBasicCanvas()) config.schema = basicSchemaFromPage(draftPlan, null, { forSave: true, basedOn });');
    expect(results).toContain('if (pipelineRunActive || !usesBasicCanvas() || !block || event.button !== 0');
    expect(results).toContain("if (!usesBasicCanvas()) return { ok: false, errors: [{ path: '', message: 'Экспорт доступен для схем Basic.' }] };");
    expect(results).toContain("if (!usesBasicCanvas()) throw new Error('THECYCLE_REQUIRES_BASIC_OR_CIRCLE_SELECTED');");
  });

  test('the run still goes by the runner: circle to runCircleFromPage, custom to Basic', () => {
    expect(results).toMatch(/if \(selectedPreset\?\.runner === 'circle'\) \{\s*return runCircleFromPage\(/);
    expect(results).toMatch(/if \(selectedPreset\?\.runner === 'custom'\) \{[\s\S]*?runCustomFromPage\(\{ task \}\)/);
  });

  test('resume between circle cycles is refused with the same notice as a start', () => {
    expect(results).toMatch(/const resumeCustomFromPage = async[\s\S]*?if \(circlePageRunner \|\| theCycleHeld\) \{ showNotification\('Pipeline already running', 'warn'\); return false; \}[\s\S]*?const latest =/);
  });
});
