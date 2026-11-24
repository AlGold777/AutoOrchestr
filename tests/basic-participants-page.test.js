/** @jest-environment jsdom */
const H = require('./helpers/results-page-harness');

const schemaV2 = (steps, extra = {}) => ({ schemaVersion: 2, origin: 'user', steps, ...extra });
const round = (ref, models, extra = {}) => ({ ref, kind: 'round', models, ...extra });
const resizeObservers = [];
const NativeResizeObserver = globalThis.ResizeObserver;

describe('Basic participant page integration', () => {
  beforeAll(async () => {
    globalThis.ResizeObserver = class ResizeObserverHarness {
      constructor(callback) { this.callback = callback; this.targets = new Set(); resizeObservers.push(this); }
      observe(target) { this.targets.add(target); }
      unobserve(target) { this.targets.delete(target); }
      disconnect() { this.targets.clear(); }
    };
    H.renderDebateDom();
    document.body.classList.add('pipeline-page');
    ['disput/basic-input-files.js', 'results/basic-input-canvas.js'].forEach((file) => {
      window.eval(require('fs').readFileSync(require('path').join(__dirname, '..', file), 'utf8'));
    });
    await H.loadResultsScript();
  });

  afterAll(() => { globalThis.ResizeObserver = NativeResizeObserver; });

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

  test('the switch button changes the model of a participant in every round and keeps its ID', async () => {
    resetPipelineStore();
    const name = 'Switch participant model';
    const schema = schemaV2([
      round('r1', [{ id: 'Claude', name: 'Claude' }, { id: 'GPT', name: 'GPT' }]),
      round('r2', [{ id: 'Claude', name: 'Claude' }])
    ]);
    expect(await debug().installBasicSchema(name, schema)).toEqual({ ok: true, errors: [] });
    await selectPipeline(name);

    const ask = jest.fn().mockResolvedValue('Gemini');
    window.ChoiceDialog = { ask };
    document.querySelector('#r1-models [data-participant-id="Claude"] [data-participant-switch]').click();
    await H.delay(30);

    expect(ask.mock.calls[0][0].choices.map((choice) => choice.value)).not.toContain('Claude');
    const saved = debug().basicSchemaFromPage(
      window.__pipelineDraftPlanForCanvas(window.__getActivePipelineDraftPlan()), null, { forSave: true, basedOn: '' }
    );
    expect(saved.steps.map((step) => step.models.map((model) => [model.id, model.name]))).toEqual([
      [['Claude', 'Gemini'], ['GPT', 'GPT']],
      [['Claude', 'Gemini']]
    ]);
    expect(document.querySelector('#r2-models [data-participant-id="Claude"]').dataset.providerName).toBe('Gemini');
  });

  test('dragging an empty place of the canvas scrolls it; dragging a block does not', async () => {
    resetPipelineStore();
    const name = 'Canvas pan';
    expect(await debug().installBasicSchema(name, schemaV2([round('r1', [{ id: 'claude-main', name: 'Claude' }])]))).toEqual({ ok: true, errors: [] });
    await selectPipeline(name);
    const canvas = document.querySelector('#pipeline-panel .pipeline-canvas');
    const pointer = (target, type, x, y) => {
      const event = new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, clientX: x, clientY: y });
      Object.defineProperty(event, 'pointerId', { value: 7 });
      target.dispatchEvent(event);
    };
    canvas.scrollLeft = 100; canvas.scrollTop = 50;
    pointer(canvas, 'pointerdown', 200, 200);
    pointer(document, 'pointermove', 150, 170);
    expect([canvas.scrollLeft, canvas.scrollTop]).toEqual([150, 80]);
    expect(canvas.classList.contains('is-panning')).toBe(true);
    pointer(document, 'pointerup', 150, 170);
    expect(canvas.classList.contains('is-panning')).toBe(false);

    canvas.scrollLeft = 100;
    pointer(document.querySelector('#r1-models .model-block'), 'pointerdown', 200, 200);
    pointer(document, 'pointermove', 150, 200);
    pointer(document, 'pointerup', 150, 200);
    expect(canvas.scrollLeft).toBe(100);
  });

  test('participant edit actions require a 550ms press and cancel on short press or movement', async () => {
    resetPipelineStore();
    const name = 'Participant long press';
    expect(await debug().installBasicSchema(name, schemaV2([round('r1', [{ id: 'claude-main', name: 'Claude' }])]))).toEqual({ ok: true, errors: [] });
    await selectPipeline(name);

    const block = document.querySelector('#r1-models [data-participant-id="claude-main"]');
    const label = block.querySelector('.model-name');
    const pointer = (target, type, { x = 10, y = 10, pointerId = 1 } = {}) => {
      const event = new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, clientX: x, clientY: y });
      Object.defineProperty(event, 'pointerId', { value: pointerId });
      target.dispatchEvent(event);
    };

    pointer(label, 'pointerdown');
    await H.delay(100);
    pointer(document, 'pointerup');
    await H.delay(500);
    expect(block.classList.contains('is-participant-editing')).toBe(false);

    pointer(label, 'pointerdown', { pointerId: 2 });
    pointer(document, 'pointermove', { x: 19, y: 10, pointerId: 2 });
    await H.delay(570);
    expect(block.classList.contains('is-participant-editing')).toBe(false);

    pointer(label, 'pointerdown', { pointerId: 3 });
    await H.delay(570);
    expect(block.classList.contains('is-participant-editing')).toBe(true);
    pointer(document.body, 'pointerdown', { pointerId: 4 });
    expect(block.classList.contains('is-participant-editing')).toBe(false);
  });

  test('round territory guide appears only during file dragover, not ordinary pointer movement', async () => {
    resetPipelineStore();
    const name = 'File drop territory';
    expect(await debug().installBasicSchema(name, schemaV2([round('r1', [{ id: 'claude-main', name: 'Claude' }])]))).toEqual({ ok: true, errors: [] });
    await selectPipeline(name);
    const canvas = document.querySelector('#pipeline-panel .pipeline-canvas');
    // The results-page harness omits the real page's .pipeline-flow wrapper.
    const flow = document.createElement('div');
    flow.className = 'pipeline-flow';
    Array.from(canvas.children).filter((node) => node.matches('.stage-column, .connector-group')).forEach((node) => flow.append(node));
    canvas.append(flow);
    canvas.dispatchEvent(new MouseEvent('pointermove', { bubbles: true, clientX: 20, clientY: 20 }));
    expect(document.querySelector('.pipeline-round-territory')).toBeNull();

    const dragover = () => {
      const event = new Event('dragover', { bubbles: true, cancelable: true });
      Object.defineProperty(event, 'clientX', { value: 20 });
      Object.defineProperty(event, 'clientY', { value: 20 });
      Object.defineProperty(event, 'dataTransfer', { value: { types: ['Files'], dropEffect: 'none' } });
      canvas.dispatchEvent(event);
      return event;
    };
    expect(dragover().defaultPrevented).toBe(true);
    expect(flow.querySelector('.pipeline-round-territory')).not.toBeNull();
    document.dispatchEvent(new Event('dragend'));
    expect(flow.querySelector('.pipeline-round-territory')).toBeNull();
    dragover();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(flow.querySelector('.pipeline-round-territory')).toBeNull();
    dragover();
    document.dispatchEvent(new Event('drop', { bubbles: true }));
    expect(flow.querySelector('.pipeline-round-territory')).toBeNull();
  });

  test('unlinking one shared file binding preserves the same ID in another scope and keeps IndexedDB bytes', async () => {
    resetPipelineStore();
    const descriptor = { id: 'shared-file-id', name: 'brief.txt', type: 'text/plain', size: 4 };
    const storedFile = { name: descriptor.name, type: descriptor.type, bytes: 'keep' };
    const bytesById = new Map([[descriptor.id, storedFile]]);
    const previousIndexedDB = Object.getOwnPropertyDescriptor(window, 'indexedDB');
    const openIndexedDB = jest.fn();
    Object.defineProperty(window, 'indexedDB', { configurable: true, value: { open: openIndexedDB } });
    const name = 'Scoped file unlink';
    const schema = schemaV2([round('r1', [{ id: 'claude-main', name: 'Claude', files: [descriptor] }], { files: [descriptor] })]);
    try {
      expect(await debug().installBasicSchema(name, schema)).toEqual({ ok: true, errors: [] });
      await selectPipeline(name);
      const sharedChip = document.querySelector('.stage-column[data-round="1"] .basic-input-canvas-layer .basic-input-file-wrap [data-file-id="shared-file-id"]');
      expect(sharedChip).not.toBeNull();
      const down = new MouseEvent('pointerdown', { bubbles: true, cancelable: true, button: 0, clientX: 10, clientY: 10 });
      Object.defineProperty(down, 'pointerId', { value: 9 });
      sharedChip.dispatchEvent(down);
      await H.delay(570);
      const remove = sharedChip.parentElement.querySelector('.basic-input-file-delete');
      expect(remove.hidden).toBe(false);
      remove.click();
      await H.delay(30);

      const activePlan = window.__getActivePipelineDraftPlan();
      const updated = debug().basicSchemaFromPage(window.__pipelineDraftPlanForCanvas(activePlan), null, { forSave: true, basedOn: '' });
      expect(updated.steps[0].files || []).toEqual([]);
      expect(updated.steps[0].models[0].files).toEqual([descriptor]);
      expect(openIndexedDB).not.toHaveBeenCalled();
      expect(bytesById.get(descriptor.id)).toBe(storedFile);
      expect(bytesById.get(descriptor.id).bytes).toBe('keep');
    } finally {
      if (previousIndexedDB) Object.defineProperty(window, 'indexedDB', previousIndexedDB);
      else delete window.indexedDB;
    }
  });

  test('canvas alignment ResizeObserver excludes rebuilt owner stacks', async () => {
    resetPipelineStore();
    const name = 'Owner ResizeObserver targets';
    const schema = schemaV2([
      round('r1', [{ id: 'claude-main', name: 'Claude' }]),
      { ref: 'owner:a', kind: 'owner', input: [{ step: 'r1', participant: 'claude-main' }], models: [], task: 'Approve the draft.' },
      { ref: 'owner:b', kind: 'owner', input: [{ step: 'owner:a', participant: 'owner' }], models: [], task: 'Review the approval.' },
      round('r2', [{ id: 'gpt-main', name: 'GPT' }])
    ]);
    expect(await debug().installBasicSchema(name, schema)).toEqual({ ok: true, errors: [] });
    await selectPipeline(name);
    await H.delay(30);

    const observer = resizeObservers[0];
    const ownerStacks = Array.from(document.querySelectorAll('.pipeline-control-step .model-stack'));
    expect(ownerStacks).toHaveLength(2);
    expect(Array.from(observer.targets).some((target) => target.closest('.pipeline-control-step'))).toBe(false);
    expect(Array.from(observer.targets).some((target) => target.matches('#r1-models, #r2-models'))).toBe(true);

    observer.callback([], observer);
    await H.delay(50);
    expect(Array.from(observer.targets).some((target) => target.closest('.pipeline-control-step'))).toBe(false);
    expect(document.querySelectorAll('.pipeline-control-step .model-stack')).toHaveLength(2);
  });

  test('an owner card is not taller than the model blocks of its round together', async () => {
    resetPipelineStore();
    const name = 'Owner card height';
    const schema = schemaV2([
      round('r1', [{ id: 'claude-main', name: 'Claude' }, { id: 'gpt-main', name: 'GPT' }]),
      { ref: 'owner:a', kind: 'owner', input: [{ step: 'r1', participant: 'claude-main' }], models: [], task: 'Approve the draft.' },
      round('r2', [{ id: 'gemini-main', name: 'Gemini' }])
    ]);
    const heightDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetHeight');
    Object.defineProperty(HTMLElement.prototype, 'offsetHeight', { configurable: true, get() { return this.classList.contains('model-block') ? 40 : 0; } });
    try {
      expect(await debug().installBasicSchema(name, schema)).toEqual({ ok: true, errors: [] });
      await selectPipeline(name);
      await H.delay(30);
      const card = document.querySelector('.pipeline-control-card');
      expect(card.style.maxHeight).toBe('80px');
    } finally {
      Object.defineProperty(HTMLElement.prototype, 'offsetHeight', heightDescriptor);
    }
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

  test('schema selection renders a shortened provider-prefixed label without changing saved label', async () => {
    resetPipelineStore();
    const name = 'Provider-prefixed participant label';
    const otherName = 'Other canvas schema';
    const schema = schemaV2([round('r1', [
      { id: 'gpt-variant-2', name: 'GPT', label: 'GPT · Вариант 2', enabled: true, onCanvas: true, settingsMode: 'explicit' }
    ])]);
    const otherSchema = schemaV2([round('r1', [{ id: 'claude-main', name: 'Claude' }])]);
    expect(await debug().installBasicSchema(name, schema)).toEqual({ ok: true, errors: [] });
    expect(await debug().installBasicSchema(otherName, otherSchema)).toEqual({ ok: true, errors: [] });

    const assertCanvasLabel = () => {
      const block = document.querySelector('#r1-models [data-participant-id="gpt-variant-2"]');
      expect(block).not.toBeNull();
      expect(block.querySelector('.model-name').textContent).toBe('GPT');
      expect(block.querySelector('.model-participant-label')).toBeNull();
      expect(block.dataset.participantLabelValue).toBe('GPT · Вариант 2');
    };

    await selectPipeline(name);
    assertCanvasLabel();
    const activePlan = window.__pipelineDraftPlanForCanvas(window.__getActivePipelineDraftPlan());
    const saved = debug().basicSchemaFromPage(activePlan, null, { forSave: true, basedOn: '' });
    expect(saved.steps[0].models[0]).toMatchObject({ id: 'gpt-variant-2', name: 'GPT', label: 'GPT · Вариант 2' });

    await selectPipeline(otherName);
    await selectPipeline(name);
    assertCanvasLabel();
    const schemaAfterReselect = debug().getPipelineStoreSnapshot().pipelines[name].schema;
    expect(schemaAfterReselect.steps[0].models[0]).toMatchObject({ id: 'gpt-variant-2', name: 'GPT', label: 'GPT · Вариант 2' });
  });

  test('Default fills the participant editor draft without saving or enabling Send', async () => {
    resetPipelineStore();
    const name = 'Explicit participant defaults';
    const schema = schemaV2([round('r1', [
      { id: 'claude-review', name: 'Claude', label: 'Claude 2', enabled: false, onCanvas: true, settingsMode: 'explicit' },
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
    expect(document.getElementById('notification-message').textContent).toBe('Claude нельзя убрать из R1: по схеме его ответ берут R2.');
  });
});
