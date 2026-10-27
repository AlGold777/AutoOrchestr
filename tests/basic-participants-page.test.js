/** @jest-environment jsdom */
const H = require('./helpers/results-page-harness');

const schemaV2 = (steps, extra = {}) => ({ schemaVersion: 2, origin: 'user', steps, ...extra });
const round = (ref, models, extra = {}) => ({ ref, kind: 'round', models, ...extra });

describe('Basic participant page integration', () => {
  beforeAll(async () => {
    H.renderDebateDom();
    document.body.classList.add('pipeline-page');
    await H.loadResultsScript();
  });

  const debug = () => window.__pipelineLifecycleDebug;
  const selectPipeline = async (name) => {
    document.querySelector(`.pipeline-item[data-name="${name}"]`)?.click();
    await H.delay(20);
  };
  const resetPipelineStore = () => debug().setPipelineStoreForTest({ pipelines: {}, order: [], active: '', lastSaved: '' });
  const deliverAnswer = (message) => chrome.runtime.onMessage.addListener.mock.calls
    .forEach(([listener]) => listener(message, {}, jest.fn()));

  test('answer cards display the participant label while retaining its ID in card metadata', async () => {
    const container = document.getElementById('debate-model-cards');
    container.innerHTML = '';
    deliverAnswer({
      type: 'LLM_PARTIAL_RESPONSE', llmName: 'Claude', answer: 'Participant answer',
      transportRequestId: 'request-label', pipelineRunId: 'run-label', pipelineRoundId: 's1',
      participantId: 'claude-reviewer', participantLabel: 'Claude 2', visit: 1,
      metadata: { status: 'SUCCESS', participantId: 'claude-reviewer', participantLabel: 'Claude 2', pipelineRunId: 'run-label', pipelineRoundId: 's1', stepRef: 'r1', visit: 1 }
    });
    await H.delay(10);

    const card = container.querySelector('.debate-model-card[data-participant-id="claude-reviewer"]');
    expect(card).not.toBeNull();
    expect(card.querySelector('.debate-model-card-participant').textContent).toBe('Claude 2');
  });

  test('record conversion accepts two same-provider participants and preserves both IDs in its plan', () => {
    const schema = schemaV2([round('r1', [
      { id: 'claude-writer', name: 'Claude', label: 'Claude' },
      { id: 'claude-reviewer', name: 'Claude', label: 'Claude 2' }
    ])]);
    const built = debug().recordFromSchema('Two Claudes', schema);

    expect(built.ok).toBe(true);
    expect(built.record.draftPlan.plannedStages[0].participantIds).toEqual(['claude-writer', 'claude-reviewer']);
    expect(built.record.modelStacks['r1-models'].items.map((item) => [item.id, item.name, item.label]))
      .toEqual([['claude-writer', 'Claude', 'Claude'], ['claude-reviewer', 'Claude', 'Claude 2']]);
  });

  test('the plus button creates fresh stable IDs and off-canvas-round cards with the next display label', async () => {
    resetPipelineStore();
    const name = 'Add Claude participant';
    const schema = schemaV2([
      round('r1', [{ id: 'Claude', name: 'Claude' }]),
      round('r2', [{ id: 'Claude', name: 'Claude' }])
    ]);
    expect(await debug().installBasicSchema(name, schema)).toEqual({ ok: true, errors: [] });
    await selectPipeline(name);

    const original = document.querySelector('#r1-models [data-participant-id="Claude"]');
    const cryptoDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
    Object.defineProperty(globalThis, 'crypto', { configurable: true, value: { randomUUID: jest.fn()
      .mockReturnValueOnce('new-participant-1').mockReturnValueOnce('new-participant-2') } });
    original.querySelector('[data-participant-add]').click();
    await H.delay(20);
    let saved = debug().basicSchemaFromPage(
      window.__pipelineDraftPlanForCanvas(window.__getActivePipelineDraftPlan()), null, { forSave: true, basedOn: '' }
    );
    const first = saved.steps[0].models.find((model) => model.name === 'Claude' && model.id !== 'Claude');
    expect(first).toMatchObject({ label: 'Claude 2', enabled: false, settingsMode: 'explicit' });
    expect(saved.steps[1].models.find((model) => model.id === first.id)).toMatchObject({ name: 'Claude', label: 'Claude 2', enabled: false });

    document.querySelector(`#r1-models [data-participant-id="${first.id}"] [data-participant-remove]`).click();
    await H.delay(20);
    document.querySelector(`#r2-models [data-participant-id="${first.id}"] [data-participant-remove]`).click();
    await H.delay(20);
    document.querySelector('#r1-models [data-participant-id="Claude"] [data-participant-add]').click();
    await H.delay(20);
    saved = debug().basicSchemaFromPage(
      window.__pipelineDraftPlanForCanvas(window.__getActivePipelineDraftPlan()), null, { forSave: true, basedOn: '' }
    );
    const replacement = saved.steps[0].models.find((model) => model.id !== 'Claude');
    expect(replacement.id).not.toBe(first.id);
    expect(replacement.label).toBe('Claude 2');
    if (cryptoDescriptor) Object.defineProperty(globalThis, 'crypto', cryptoDescriptor);
    else delete globalThis.crypto;
  });

  test('schema, canvas, settings and save round-trip keep participant IDs, labels and explicit mode', async () => {
    resetPipelineStore();
    const name = 'Participants round trip';
    const schema = schemaV2([
      round('r1', [
        { id: 'claude-main', name: 'Claude', label: 'Claude' },
        { id: 'claude-review', name: 'Claude', label: 'Claude 2', enabled: false, onCanvas: true, settingsMode: 'explicit' }
      ]),
      round('r2', [{ id: 'claude-review', name: 'Claude', label: 'Claude 2', enabled: false, onCanvas: true, settingsMode: 'explicit' }])
    ]);
    expect(await debug().installBasicSchema(name, schema)).toEqual({ ok: true, errors: [] });
    await selectPipeline(name);
    const activePlan = window.__pipelineDraftPlanForCanvas(window.__getActivePipelineDraftPlan());
    const saved = debug().basicSchemaFromPage(activePlan, null, { forSave: true, basedOn: '' });

    expect(saved.schemaVersion).toBe(2);
    expect(saved.steps.map((step) => step.models.map((model) => [model.id, model.name, model.label, model.enabled, model.settingsMode])))
      .toEqual([
        [['claude-main', 'Claude', 'Claude', undefined, undefined], ['claude-review', 'Claude', 'Claude 2', false, 'explicit']],
        [['claude-review', 'Claude', 'Claude 2', false, 'explicit']]
      ]);
    expect(await debug().installBasicSchema(`${name} again`, JSON.parse(JSON.stringify(saved)))).toEqual({ ok: true, errors: [] });
    await selectPipeline(`${name} again`);
    const again = debug().basicSchemaFromPage(
      window.__pipelineDraftPlanForCanvas(window.__getActivePipelineDraftPlan()), null, { forSave: true, basedOn: '' }
    );
    expect(again.steps).toEqual(saved.steps);
  });

  test('Default fills the participant editor draft without saving or enabling Send', async () => {
    resetPipelineStore();
    const name = 'Explicit participant defaults';
    const schema = schemaV2([round('r1', [
      { id: 'claude-review', name: 'Claude', label: 'Claude 2', enabled: false, settingsMode: 'explicit' },
      { id: 'gpt-main', name: 'GPT' }
    ], { input: 'previous', task: 'ROUND TASK' })], {
      defaults: { roundTask: 'PIPELINE TASK', discipline: { limit: 'PIPELINE LIMIT', content: 'PIPELINE CONTENT' } }
    });
    expect(await debug().installBasicSchema(name, schema)).toEqual({ ok: true, errors: [] });
    await selectPipeline(name);
    const block = document.querySelector('#r1-models [data-participant-id="claude-review"]');
    let modal = document.getElementById('pipeline-block-info-modal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'pipeline-block-info-modal';
      modal.innerHTML = '<div class="modal-content"></div>';
      document.body.appendChild(modal);
    }
    await debug().renderCustomBlockInspector(block, modal);
    const before = debug().getPipelineStoreSnapshot().pipelines[name];
    const defaultButton = modal.querySelector('#custom-card-default');
    const saveButton = modal.querySelector('#custom-card-save');

    expect(defaultButton).not.toBeNull();
    expect(defaultButton.compareDocumentPosition(saveButton) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    defaultButton.click();

    expect(modal.querySelector('#custom-discipline-content').value).toBe('PIPELINE CONTENT');
    expect(modal.querySelector('#custom-discipline-limit').value).toContain('PIPELINE LIMIT');
    expect(modal.querySelector('#custom-card-length').value).toBe('300');
    expect(block.querySelector('.model-input-checkbox').checked).toBe(false);
    expect(debug().getPipelineStoreSnapshot().pipelines[name]).toEqual(before);
  });

  test('removing the last occurrence of a participant with a later artifact dependency leaves the schema intact', async () => {
    resetPipelineStore();
    const name = 'Participant dependency';
    const schema = schemaV2([
      round('r1', [
        { id: 'gpt-main', name: 'GPT' },
        { id: 'claude-review', name: 'Claude', output: {
          format: 'json', requiredFields: ['/answer'], artifacts: [{ id: 'answer', name: 'Answer', pointer: '/answer' }]
        } }
      ]),
      round('r2', [{ id: 'gpt-editor', name: 'GPT', label: 'GPT Editor', input: [{ artifact: { step: 'r1', participant: 'claude-review', id: 'answer' }, version: 'latest' }] }])
    ]);
    expect(await debug().installBasicSchema(name, schema)).toEqual({ ok: true, errors: [] });
    await selectPipeline(name);
    const before = debug().getPipelineStoreSnapshot().pipelines[name].schema;
    const block = document.querySelector('#r1-models [data-participant-id="claude-review"]');
    expect(block).not.toBeNull();
    block.querySelector('[data-participant-remove]').click();
    await H.delay(20);

    expect(debug().getPipelineStoreSnapshot().pipelines[name].schema).toEqual(before);
    expect(document.getElementById('notification-message').textContent).toMatch(/claude-review|answer|steps\[1\]/i);
  });
});
