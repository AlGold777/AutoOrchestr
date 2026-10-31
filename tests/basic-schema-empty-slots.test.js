/** @jest-environment jsdom */
const H = require('./helpers/results-page-harness');

const round = (ref, models) => ({ ref, kind: 'round', models });
const selectPipeline = async (name) => {
  document.querySelector(`.pipeline-item[data-name="${name}"]`)?.click();
  await H.delay(20);
};

describe('Basic schema capture ignores empty canvas slots', () => {
  beforeAll(async () => {
    globalThis.ResizeObserver = class ResizeObserverHarness {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
    H.renderDebateDom();
    document.body.classList.add('pipeline-page');
    await H.loadResultsScript();
  });

  const debug = () => window.__pipelineLifecycleDebug;
  const resetPipelineStore = () => debug().setPipelineStoreForTest({ pipelines: {}, order: [], active: '', lastSaved: '' });

  test('an empty-slot placeholder in an added round is omitted from the captured schema', async () => {
    resetPipelineStore();
    const name = 'Empty slot capture';
    const schema = {
      schemaVersion: 1,
      origin: 'user',
      steps: [round('r1', [{ name: 'GPT' }]), round('r2', [{ name: 'GPT' }])]
    };
    expect(await debug().installBasicSchema(name, schema)).toEqual({ ok: true, errors: [] });
    await selectPipeline(name);

    // No header model is selected, so addRound builds its one visual capacity
    // slot as a placeholder rather than as a participant.
    document.querySelectorAll('.llm-button').forEach((button) => button.classList.remove('active'));
    document.getElementById('pipeline-add-round-btn').click();
    expect(document.querySelector('#r3-models .model-block.pipeline-empty-slot')).not.toBeNull();

    const config = debug().capturePipelineConfig();
    const thirdRound = config.schema.steps.find((step) => step.ref === 'r3');
    expect(thirdRound.models).toEqual([]);
    expect(window.BasicSchema.validate(config.schema)).toEqual([]);
  });

  test('a real switched-off participant keeps its settings and onCanvas flag', async () => {
    resetPipelineStore();
    const name = 'Off participant capture';
    const schema = {
      schemaVersion: 2,
      origin: 'user',
      steps: [
        round('r1', [
          { id: 'gpt-main', name: 'GPT' },
          { id: 'claude-off', name: 'Claude', label: 'Claude 2', enabled: false, onCanvas: true, task: 'KEEP_OFF_TASK', maxWords: 37 }
        ]),
        round('r2', [{ id: 'gpt-main', name: 'GPT' }])
      ]
    };
    expect(await debug().installBasicSchema(name, schema)).toEqual({ ok: true, errors: [] });
    await selectPipeline(name);

    const captured = debug().capturePipelineConfig().schema;
    const offParticipant = captured.steps.find((step) => step.ref === 'r1').models.find((model) => model.id === 'claude-off');
    expect(offParticipant).toMatchObject({
      id: 'claude-off',
      name: 'Claude',
      label: 'Claude 2',
      enabled: false,
      onCanvas: true,
      task: 'KEEP_OFF_TASK',
      maxWords: 37
    });
    expect(window.BasicSchema.validate(captured)).toEqual([]);
  });
});
