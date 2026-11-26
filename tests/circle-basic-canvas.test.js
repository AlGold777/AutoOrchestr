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

describe('TheCycle bridge always opens new model tabs', () => {
  const start = results.indexOf('window.TheCycleMainPageBridge = Object.freeze({');
  const bridge = results.slice(start, results.indexOf("window.dispatchEvent(new Event('thecycle:basic-bridge-ready'))", start));
  const begin = bridge.slice(bridge.indexOf('begin({ runId, schema })'), bridge.indexOf('async send('));

  test('begin sets forceNewTabs true and does not read the new pages checkbox', () => {
    expect(begin).toMatch(/forceNewTabs: true,/);
    expect(bridge).not.toContain('newPagesCheckbox');
  });

  test('every begin starts with an empty set of opened models', () => {
    expect(begin).toMatch(/newPagesModels: new Set\(\),\s*newPagesDispatched: false/);
  });

  test('send passes the run context forceNewTabs to runModelBatch', () => {
    expect(bridge).toMatch(/forceNewTabs: runContext\.forceNewTabs,/);
  });
});

describe('TheCycle bridge: a missing answer is reread and waited as in Basic', () => {
  const start = results.indexOf('window.TheCycleMainPageBridge = Object.freeze({');
  const bridge = results.slice(start, results.indexOf("window.dispatchEvent(new Event('thecycle:basic-bridge-ready'))", start));

  test('send returns the sent prompt of each model', () => {
    expect(bridge).toMatch(/sentPrompt: window\.TransportPolicy\?\.resolvePromptForModel\?\.\(batch\?\.sentPrompts, model, null\) \?\? null,/);
  });

  test('reread sends the same message as the Basic page and has the no_reply fallback', () => {
    expect(bridge).toMatch(/async reread\(request\)[\s\S]*?type: 'BASIC_REREAD_OWN_TURN', llmName: request\.modelName[\s\S]*?sentPrompts: request\.sentPrompts, previousText: request\.previousText[\s\S]*?\{ found: false, reason: 'no_reply' \}/);
  });

  test('settings come from the one Basic settings object', () => {
    expect(bridge).toMatch(/settings\(\) \{\s*return \{ waitMinutes: basicSettings\.waitMinutes, skipNoAnswer: basicSettings\.skipNoAnswer \};/);
  });
});
