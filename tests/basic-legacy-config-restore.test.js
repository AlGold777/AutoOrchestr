const H = require('./helpers/results-page-harness');
const fs = require('fs');
const path = require('path');

describe('Basic legacy pipeline restore', () => {
  let debug;
  const pipelineName = 'Legacy Basic';
  const draftPlan = () => window.__pipelineDraftPlanForCanvas(window.__getActivePipelineDraftPlan());

  beforeAll(async () => {
    H.renderDebateDom();
    document.body.classList.add('pipeline-page');
    await H.loadResultsScript();
    ['debate-response-acceptance', 'stage-markers'].forEach((mod) => {
      window.eval(fs.readFileSync(path.join(__dirname, '..', 'disput', `${mod}.js`), 'utf8'));
    });
    debug = window.__pipelineLifecycleDebug;
  });

  test('a legacy Basic record without explicit model stacks does not invent participants on a fresh canvas', () => {
    const legacy = {
      version: 3,
      roundCounter: 2,
      protocol: { type: 'universal', presetId: 'CUSTOM', selectedModels: [], roundLimit: '2', runPolicy: 'auto' },
      modelStacks: {}
    };
    debug.clearCustomSessionForTest();
    debug.setPipelineStoreForTest({ active: pipelineName, pipelines: { [pipelineName]: legacy }, order: [pipelineName] });
    debug.applyPipelineConfig(legacy);
    expect(document.querySelectorAll('#r1-models .model-block')).toHaveLength(0);
    expect(document.querySelectorAll('#r2-models .model-block')).toHaveLength(0);
  });

  test('legacy records with provider names alone remain format 1 when saved', () => {
    const legacy = {
      version: 3,
      roundCounter: 1,
      protocol: { type: 'universal', presetId: 'CUSTOM', selectedModels: ['GPT'], roundLimit: '1', runPolicy: 'auto' },
      modelStacks: { 'r1-models': { items: [{ name: 'GPT', input: true, send: true, role: null }] } }
    };
    debug.setPipelineStoreForTest({ active: pipelineName, pipelines: { [pipelineName]: legacy }, order: [pipelineName] });
    debug.applyPipelineConfig(legacy);
    expect(debug.buildBasicRun(draftPlan()).schema.schemaVersion).toBe(1);
  });

  test('a saved explicit Basic canvas loads, dispatches both rounds and saves as a schema', async () => {
    const legacy = {
      version: 3,
      roundCounter: 2,
      protocol: { type: 'universal', presetId: 'CUSTOM', selectedModels: ['GPT', 'Claude', 'Gemini'], length: '300', roundLimit: '2', runPolicy: 'auto' },
      modelStacks: {
        'r1-models': { items: [
          { name: 'GPT', id: 'gpt-planner', label: 'GPT planner', input: true, send: true, role: null },
          { name: 'Claude', id: 'claude-author', label: 'Claude author', input: true, send: true, role: 'interaction_meta_synthesis' },
          { name: 'Claude', id: 'claude-reviewer', label: 'Claude reviewer', input: false, send: false, role: 'interaction_meta_synthesis' }
        ] },
        'r2-models': { items: [
          { name: 'Gemini', id: 'gemini-review', label: 'Gemini reviewer', input: true, send: true, role: null },
          { name: 'Claude', id: 'claude-reviewer', label: 'Claude reviewer', input: false, send: false, role: 'interaction_meta_synthesis' }
        ] }
      }
    };
    debug.clearCustomSessionForTest();
    debug.setPipelineStoreForTest({ active: pipelineName, pipelines: { [pipelineName]: legacy }, order: [pipelineName] });
    debug.applyPipelineConfig(legacy);

    const stackIds = (round) => [...document.querySelectorAll(`#r${round}-models .model-block`)].map((block) => block.dataset.participantId);
    expect(stackIds(1)).toEqual(['gpt-planner', 'claude-author', 'claude-reviewer']);
    expect(stackIds(2)).toEqual(['gemini-review', 'claude-reviewer']);
    const reviewer = document.querySelector('#r1-models [data-participant-id="claude-reviewer"]');
    expect(reviewer.querySelector('.model-name').textContent).toBe('Claude');
    expect(reviewer.querySelector('.model-participant-label').textContent).toBe('✎');
    expect(reviewer.dataset.participantLabelValue).toBe('Claude reviewer');
    expect(reviewer.querySelector('.model-input-checkbox').checked).toBe(false);
    expect(reviewer.querySelector('.role-selector').value).toBe('interaction_meta_synthesis');
    expect(document.querySelector('#r1-models [data-participant-id="claude-author"] .role-selector').value).toBe('interaction_meta_synthesis');
    expect([...document.querySelector('#r1-models [data-participant-id="claude-author"] .role-selector').options]
      .some((option) => option.value === 'interaction_meta_synthesis')).toBe(true);
    const authorRole = document.querySelector('#r1-models [data-participant-id="claude-author"] .role-selector');
    authorRole.value = '';
    authorRole.dispatchEvent(new Event('change', { bubbles: true }));
    const reviewerInput = reviewer.querySelector('.model-input-checkbox');
    const reviewerRole = reviewer.querySelector('.role-selector');
    reviewerInput.checked = true;
    reviewerInput.dispatchEvent(new Event('change', { bubbles: true }));
    reviewerRole.value = '';
    reviewerRole.dispatchEvent(new Event('change', { bubbles: true }));
    reviewerInput.checked = false;
    reviewerInput.dispatchEvent(new Event('change', { bubbles: true }));

    const built = debug.buildBasicRun(draftPlan());
    expect(built.errors).toEqual([]);
    expect(built.steps.map((step) => step.ref)).toEqual(['r1', 'r2']);
    expect(built.schema.steps[0].models.map((model) => [model.id, model.enabled])).toEqual([
      ['gpt-planner', undefined], ['claude-author', undefined], ['claude-reviewer', false]
    ]);
    expect(built.schema.steps[0].models.find((model) => model.id === 'claude-author').role).toBeUndefined();
    expect(built.schema.steps[0].models.find((model) => model.id === 'claude-reviewer').role).toBeUndefined();
    expect(built.schema.steps[1].models.find((model) => model.id === 'claude-reviewer').role).toBe('interaction_meta_synthesis');

    const starts = [];
    const oldMessageDelivery = window.MessageDelivery;
    window.MessageDelivery = require('../shared/message-delivery');
    chrome.runtime.sendMessage.mockImplementation((message, callback) => {
      if (message.type !== 'START_FULLPAGE_PROCESS') {
        callback?.({ status: 'ok', active: false, bindings: {} });
        return;
      }
      starts.push(message);
      callback?.({ status: 'process_started' });
      setTimeout(() => message.selectedLLMs.forEach((model) => debug.pipelineWaiter.handleFinal({
        type: 'LLM_RESPONSE',
        llmName: model,
        transportRequestId: message.pipelineContext.transportRequestIds[model],
        answer: `Accepted ${model} in ${message.pipelineContext.stageId}.`,
        metadata: { ...message.pipelineContext, status: 'SUCCESS', attribution: 'verified', completion: 'complete' }
      })), 0);
    });
    try {
      document.getElementById('modTa').value = 'Legacy schema migration';
      expect(await window.runPipeline()).toBe(true);
      expect(starts.map((message) => message.pipelineContext.stageId)).toEqual(expect.arrayContaining([
        expect.stringMatching(/:s1$/), expect.stringMatching(/:s2$/)
      ]));
      expect(starts).toHaveLength(2);

      window.prompt = jest.fn(() => 'Legacy Basic saved');
      document.getElementById('pipeline-save-btn').click();
      await H.delay(30);
      const stored = (await chrome.storage.local.get('llmComparatorPipelines')).llmComparatorPipelines;
      const saved = stored.pipelines['Legacy Basic saved'].schema;
      expect(saved.schemaVersion).toBe(2);
      expect(saved.steps.map((step) => step.ref)).toEqual(['r1', 'r2']);
      expect(saved.steps[0].models.map((model) => [model.id, model.enabled, model.role || null])).toEqual([
        ['gpt-planner', undefined, null],
        ['claude-author', undefined, null],
        ['claude-reviewer', false, null]
      ]);
      expect(saved.steps[1].models.find((model) => model.id === 'claude-reviewer').role).toBe('interaction_meta_synthesis');
      expect(saved.steps[0].models.find((model) => model.id === 'claude-reviewer').label).toBe('Claude reviewer');
    } finally {
      window.MessageDelivery = oldMessageDelivery;
      debug.pipelineWaiter.reset();
    }
  }, 30000);

});
