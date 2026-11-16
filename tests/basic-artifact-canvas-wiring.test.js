/** @jest-environment jsdom */
const fs = require('node:fs');
const path = require('node:path');
const StageCard = require('../results/stage-card');
const BasicOutput = require('../disput/basic-output');

const resultsSource = fs.readFileSync(path.join(__dirname, '..', 'results.js'), 'utf8');
const functionExpression = (startMarker, endMarker, label) => {
  const start = resultsSource.indexOf(startMarker);
  const end = resultsSource.indexOf(endMarker, start);
  if (start < 0 || end <= start) throw new Error(`${label} block is missing from results.js`);
  return resultsSource.slice(start, end).replace(/^\s*const \w+ = /, '').trim().replace(/;$/, '');
};

describe('Basic artifact canvas and inspection wiring', () => {
  beforeEach(() => {
    document.body.innerHTML = '<section id="panel"><div class="stage-column" data-round="1"></div><div class="pipeline-control-step" data-control-ref="owner:edit"></div></section>';
  });

  test('renders each model artifact version and User version in its source column; each opens its own recorded answer', () => {
    const panel = document.querySelector('#panel');
    const opened = [];
    const modelV1 = { id: 'report', name: 'Report', source: { step: 'r1', participant: 'claude', visit: 1 }, content: { answerRef: 't1', pointer: '/title' } };
    const modelV2 = { id: 'report', name: 'Report', source: { step: 'r1', participant: 'claude', visit: 2 }, content: { answerRef: 't2', pointer: '/title' } };
    const sameIdOtherParticipant = { id: 'report', name: 'Report', source: { step: 'r1', participant: 'gpt', visit: 1 }, content: { answerRef: 't3', pointer: '/title' } };
    const userVersion = { id: 'report', name: 'Report', source: { step: 'owner:edit', participant: 'owner', visit: 1 }, content: { answerRef: 't4', pointer: '' } };
    const steps = [
      { ref: 'r1', kind: 'round', models: [
        { id: 'claude', name: 'Claude', output: { artifacts: [{ id: 'report', name: 'Report' }] } },
        { id: 'gpt', name: 'GPT', output: { artifacts: [{ id: 'report', name: 'Report' }] } }
      ] },
      { ref: 'owner:edit', kind: 'owner', models: [], output: { artifacts: [{ id: 'report', name: 'Report' }] } }
    ];
    const frameRecord = { artifacts: [modelV1, modelV2, sameIdOtherParticipant, userVersion], snapshot: { results: [] } };
    const expression = functionExpression('const syncDocumentFrames =', '// Tooltips of the canvas', 'syncDocumentFrames');
    const sync = new Function('pipelinePanel', 'frameRecord', 'draftPlanForCanvas', 'getActiveDraftPlan',
      'basicSchemaFromPage', 'setCanvasTooltip', 'openDocumentFrame', 'syncBasicInputCanvas',
      `return ${expression}`)(panel, frameRecord, () => ({}), () => ({}), () => ({ steps }), () => {},
      (entry) => opened.push(entry), () => {});

    sync();
    const roundFrames = Array.from(panel.querySelectorAll('.stage-column[data-round="1"] .pipeline-doc-frame'));
    const userFrames = Array.from(panel.querySelectorAll('[data-control-ref="owner:edit"] .pipeline-doc-frame'));
    expect(roundFrames).toHaveLength(3);
    expect(roundFrames.map((frame) => frame.dataset.docParticipant)).toEqual(['claude', 'claude', 'gpt']);
    expect(roundFrames.map((frame) => frame.dataset.docRef)).toEqual(['r1', 'r1', 'r1']);
    expect(userFrames).toHaveLength(1);
    expect(userFrames[0].dataset.docParticipant).toBe('owner');

    [...roundFrames, ...userFrames].forEach((frame) => frame.click());
    expect(opened).toEqual([modelV1, modelV2, sameIdOtherParticipant, userVersion]);
  });

  test('JSON Pointer artifact values are extracted for display without changing the source answer', () => {
    const payload = JSON.stringify({ sections: [{ 'short/title': 'Summary', details: ['one', 'two'] }] });
    expect(StageCard.feed.artifactText(payload, '/sections/0/short~1title', BasicOutput.readPointer)).toBe('Summary');
    expect(StageCard.feed.artifactText(payload, '/sections/0/details', BasicOutput.readPointer)).toBe('[\n  "one",\n  "two"\n]');
    expect(StageCard.feed.artifactText(payload, '/missing', BasicOutput.readPointer)).toContain('не найден');
  });

  test('checkpoint attaches a chat URL only to the matching participant step and visit and preserves an existing URL', async () => {
    const prior = { lineage: { step: 'r1', participant: 'claude', id: 'a' }, source: { step: 'r1', participant: 'claude', visit: 1 }, sourceUrl: 'https://model.test/chat/original' };
    const record = { artifacts: [prior] };
    const state = { artifacts: [
      { ...prior, sourceUrl: undefined },
      { lineage: { step: 'r1', participant: 'gpt', id: 'b' }, source: { step: 'r1', participant: 'gpt', visit: 2 }, content: {} },
      { lineage: { step: 'r2', participant: 'claude', id: 'c' }, source: { step: 'r2', participant: 'claude', visit: 1 }, content: {} }
    ] };
    const chatBindings = {
      claude: { stepRef: 'r2', visit: 1, chatUrl: 'https://model.test/chat/new' },
      gpt: { stepRef: 'r1', visit: 1, chatUrl: 'https://model.test/chat/wrong-visit' }
    };
    const customRunRecord = {
      setArtifacts: jest.fn((target, artifacts) => { target.artifacts = artifacts; }),
      setSnapshot: jest.fn()
    };
    const expression = functionExpression('const checkpointRecord = (state) => {', '\n            // L-20:', 'checkpointRecord');
    const checkpoint = new Function('record', 'chatBindings', 'window', 'buildSnapshotPayload', 'syncDocumentFrames', 'writeRecord',
      `return ${expression}`) (record, chatBindings, { CustomRunRecord: customRunRecord }, (next) => next, () => {}, async () => 'saved');

    await expect(checkpoint(state)).resolves.toBe('saved');
    const saved = record.artifacts;
    expect(saved[0].sourceUrl).toBe('https://model.test/chat/original');
    expect(saved[1].sourceUrl).toBeUndefined();
    expect(saved[2].sourceUrl).toBe('https://model.test/chat/new');
  });
});
