const fs = require('fs');
const path = require('path');
const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const results = read('results.js');

describe('Circle takes its cycle schema from the canvas or a saved Basic schema', () => {
  test('both pages carry the select with the canvas as the first option', () => {
    for (const file of ['pipeline_panel.html', 'result_new.html']) {
      const html = read(file);
      expect(html).toMatch(/id="circle-pipeline-controls"[\s\S]*?<select id="circle-schema-select"><option value="">Холст Circle<\/option><\/select>/);
    }
  });

  test('the list holds saved schemas, without the built-in templates', () => {
    expect(results).toMatch(/circleSavedSchemaNames = \(\) => Object\.keys\(pipelineStore\.pipelines \|\| \{\}\)\s*\.filter\(\(name\) => !isDefaultPipelineName\(name\) && pipelineStore\.pipelines\[name\]\?\.schema/);
    expect(results).toMatch(/add\('', 'Холст Circle'\)/);
  });

  test('capture returns a deep copy of the chosen schema, else the canvas', () => {
    const body = results.match(/capture\(\) \{[\s\S]*?policy: built\.run\.policy \};/)[0];
    expect(body).toMatch(/circleChosenSchemaRecord\(\)/);
    expect(body).toMatch(/JSON\.parse\(JSON\.stringify\(chosen\.schema\)\)/);
    expect(body).toMatch(/window\.BasicSchema\.validate\(own\)/);
    expect(body).toMatch(/: buildBasicRun\(draftPlanForCanvas\(getActiveDraftPlan\(\)\)\)/);
  });

  test('the list is refreshed on showing Circle and locked during a run; choice is in memory only', () => {
    expect(results).toMatch(/!circleControls\.hidden && !pipelineRunActive\) refreshCircleSchemaSelect\(\)/);
    expect(results).toMatch(/circleSchemaSelect\.disabled = disabled/);
    expect(results).not.toMatch(/(localStorage|chrome\.storage)[^\n]*circleSchemaChoice/);
  });

  test('chooser logic runs: canvas by default, saved schema by name', () => {
    const code = results.match(/let circleSchemaChoice = '';[\s\S]*?\n        const refreshCircleSchemaSelect/)[0]
      .replace(/\n        const refreshCircleSchemaSelect$/, '');
    const fn = new Function('pipelineStore', 'isDefaultPipelineName',
      code + '; return { names: circleSavedSchemaNames, rec: circleChosenSchemaRecord, set: (v) => { circleSchemaChoice = v; } };');
    const store = { pipelines: { Circle: { schema: { steps: [] } }, A: { schema: { steps: [{}] } }, B: { protocol: {} } } };
    const api = fn(store, (n) => n === 'Circle');
    expect(api.names()).toEqual(['A']);
    expect(api.rec()).toBeNull();
    api.set('A');
    expect(api.rec()).toBe(store.pipelines.A);
    api.set('Circle');
    expect(api.rec()).toBeNull();
  });
});
