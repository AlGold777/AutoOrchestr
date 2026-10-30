// A model block on the Basic canvas has no Send checkbox: participation in a round is set by Input alone.
const fs = require('fs');
const path = require('path');

window.eval(fs.readFileSync(path.join(__dirname, '..', 'pipeline', 'pipeline-runtime.js'), 'utf8'));
const Runtime = window.PipelineRuntime;

describe('model block in a round has no Send checkbox', () => {
  test('buildModelBlocksHtml renders Input only, with no Send checkbox or Send title', () => {
    const html = Runtime.buildModelBlocksHtml({ activeIndices: [0, 1], withRole: false });
    expect(html).not.toContain('model-send-checkbox');
    expect(html).not.toContain('title="Input"');
    expect(html).toContain('model-input-checkbox');
  });

  test('captureModelStackState: unchecking Input also leaves the model out of send', () => {
    document.body.innerHTML = `<div id="r1-models">${Runtime.buildModelBlocksHtml({ activeIndices: [0, 1] })}</div>`;
    document.querySelector('#r1-models .model-input-checkbox').checked = false;
    const { items } = Runtime.captureModelStackState(document, 'r1-models');
    expect(items[0].input).toBe(false);
    expect(items[0].send).toBe(false);
    expect(items[1].send).toBe(true);
  });

  test('getRoundModelsState: sendModels follows inputModels for the same round', () => {
    document.body.innerHTML = `<div id="r1-models">${Runtime.buildModelBlocksHtml({ activeIndices: [0, 1] })}</div>`;
    const { items } = Runtime.captureModelStackState(document, 'r1-models');
    const first = items[0].name;
    document.querySelector('#r1-models .model-input-checkbox').checked = false;
    const { inputModels, sendModels } = Runtime.getRoundModelsState(document, 1);
    expect(sendModels).toEqual(inputModels);
    expect(sendModels).not.toContain(first);
    expect(sendModels.length).toBeGreaterThan(0);
  });
});
