// A round's model block can choose "None": no mini prompt is attached to that block's round.
// Universal and Test start with None; everything else keeps its previous default.
const fs = require('fs');
const path = require('path');

const prompts = [{ id: 'critical', label: 'Critical' }, { id: 'meta_synthesis', label: 'Meta' }];
const source = fs.readFileSync(path.join(__dirname, '..', 'results.js'), 'utf8');
// The runtime attaches itself to window, as the page loads it.
window.eval(fs.readFileSync(path.join(__dirname, '..', 'pipeline', 'pipeline-runtime.js'), 'utf8'));
const Runtime = window.PipelineRuntime;
const Presets = require('../disput/pipeline-presets');

const render = () => {
  document.body.innerHTML = `<div id="r2-models">${Runtime.buildModelBlocksHtml({ activeIndices: [0, 1], withRole: true, onlyActive: true, orderedPrompts: prompts })}</div>`;
  return document.querySelectorAll('#r2-models .role-selector');
};

describe('None in the mini prompt list of a model block', () => {
  test('the list starts with None; a new block keeps the former default prompt', () => {
    const [first, second] = render();
    expect(Array.from(first.options).map((option) => option.value)).toEqual(['', 'critical', 'meta_synthesis']);
    expect(first.options[0].textContent).toBe('None');
    expect(first.value).toBe('critical');
    expect(second.value).toBe('meta_synthesis');
  });

  test('choosing None is captured as no prompt; the other block keeps its own choice', () => {
    const selectors = render();
    selectors[0].value = '';
    selectors[1].value = 'critical';
    expect(Runtime.captureModelStackState(document, 'r2-models').items.map((item) => item.role)).toEqual([null, 'critical']);
  });
});

describe('which templates start with None', () => {
  test('only Universal and Test (the Architecture template carries its own stage brief)', () => {
    expect(Presets.BUILTIN_PIPELINE_DEFINITIONS.filter((item) => item.noMiniPrompts).map((item) => item.name)).toEqual(['Universal', 'Test']);
    expect(source).toContain('withRoles: !stageTemplate && !noMiniPrompts');
    expect(source).toContain('noMiniPrompts: definition.noMiniPrompts === true');
  });

  test('the choice survives rebuilds and is restored from a saved pipeline (id or None)', () => {
    expect(source).toContain("roleByName.set(name, roleSelect.value || '')");
    expect(source).toContain('previousRole !== undefined');
    expect(source).toContain('} else if (role && item.role === null) {');
    expect(source).toContain("if (roleSelect && roleSelect.value !== '') { roleSelect.value = ''; changed = true; }");
  });
});
