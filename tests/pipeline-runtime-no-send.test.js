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

describe('participant labels on the Basic canvas', () => {
  test('hides a repeated provider prefix in the caption while preserving the full saved label and identity', () => {
    const html = Runtime.buildModelBlocksHtml({
      items: [{ name: 'GPT', id: 'gpt-variant-2', label: 'GPT · Вариант 2', input: true }],
      participantControls: true
    });
    document.body.innerHTML = `<div id="r1-models">${html}</div>`;
    const block = document.querySelector('#r1-models .model-block');
    expect(block.querySelector('.model-name').textContent).toBe('GPT');
    expect(block.querySelector('.model-participant-label').textContent).toBe('✎');
    expect(block.dataset.participantLabelValue).toBe('GPT · Вариант 2');
    expect(Runtime.captureModelStackState(document, 'r1-models').items[0]).toMatchObject({
      name: 'GPT', id: 'gpt-variant-2', label: 'GPT · Вариант 2'
    });
  });

  test('shows only the rename pencil in the block, never the participant name', () => {
    expect(Runtime.buildModelBlocksHtml({
      items: [{ name: 'GPT', id: 'gpt-editor', label: 'Редактор' }], participantControls: true
    })).not.toContain('>Редактор</button>');
    expect(Runtime.buildModelBlocksHtml({
      items: [{ name: 'GPT', id: 'gpt', label: 'GPT' }], participantControls: true
    })).toContain('>✎</button>');
  });

  test('display helper removes only a provider prefix followed by a separator', () => {
    expect(Runtime.getParticipantDisplayLabel('GPT', 'GPT · Вариант 2')).toBe('Вариант 2');
    expect(Runtime.getParticipantDisplayLabel('GPT', 'Редактор')).toBe('Редактор');
    expect(Runtime.getParticipantDisplayLabel('GPT', 'GPT 2')).toBe('2');
  });

  test('removes provider prefixes separated from participant labels by a space', () => {
    expect(Runtime.getParticipantDisplayLabel('Claude', 'Claude 2')).toBe('2');
    expect(Runtime.getParticipantDisplayLabel('GPT', 'GPT Research')).toBe('Research');
    expect(Runtime.getParticipantDisplayLabel('GPT', 'GPTish')).toBe('GPTish');
    expect(Runtime.getParticipantDisplayLabel('Le Chat', 'Le Chaton')).toBe('Le Chaton');
  });
});
