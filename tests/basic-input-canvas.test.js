const BasicInputCanvas = require('../results/basic-input-canvas');

const panelHtml = () => `
  <section id="panel">
    <div class="pipeline-canvas">
      <div class="pipeline-flow">
        <div class="stage-column entry-column"><span class="entry-badge">In</span></div>
        <div class="stage-column" data-round="1">
          <div class="model-block" data-participant-id="claude-id"><span class="model-name">Claude</span></div>
          <div class="model-block" data-participant-id="gpt-id"><span class="model-name">GPT</span></div>
        </div>
        <div class="stage-column" data-round="2">
          <div class="model-block" data-participant-id="gemini-id"><span class="model-name">Gemini</span></div>
        </div>
        <div class="stage-column pipeline-control-step" data-control-ref="owner:approve">
          <button class="pipeline-control-card" data-control-card="owner:approve">Owner</button>
        </div>
        <div class="stage-column pipeline-control-step" data-control-ref="owner:review">
          <button class="pipeline-control-card" data-control-card="owner:review">Reviewer</button>
        </div>
      </div>
    </div>
  </section>`;

describe('Basic input canvas', () => {
  let panel;

  beforeEach(() => {
    document.body.innerHTML = panelHtml();
    panel = document.querySelector('#panel');
  });

  test('renders step, model, and owner output artifacts in their source columns', () => {
    const result = BasicInputCanvas.sync({ panel, schema: { steps: [
      { ref: 'r1', kind: 'round', output: { artifacts: [{ id: 'shared', name: 'Shared' }] }, models: [
        { id: 'claude-id', name: 'Claude' },
        { id: 'gpt-id', name: 'GPT', output: { artifacts: [{ id: 'private', name: 'Private' }] } }
      ] },
      { ref: 'owner:approve', kind: 'owner', output: { artifacts: [{ id: 'decision', name: 'Decision' }] }, models: [] }
    ] } });

    expect(result.chips).toBe(3);
    const artifactIn = (column, ref, participant, id) => {
      const key = JSON.stringify([ref, participant, id]);
      return Array.from(column.querySelectorAll('.basic-input-canvas-layer [data-artifact-key]'))
        .find((chip) => chip.dataset.artifactKey === key);
    };
    const round1 = panel.querySelector('.stage-column[data-round="1"]');
    const owner = panel.querySelector('.pipeline-control-step[data-control-ref="owner:approve"]');
    expect(artifactIn(round1, 'r1', 'claude-id', 'shared')?.textContent).toBe('Shared');
    expect(artifactIn(round1, 'r1', 'gpt-id', 'private')?.textContent).toBe('Private');
    expect(artifactIn(owner, 'owner:approve', 'owner', 'decision')?.textContent).toBe('Decision');
    expect(round1.querySelectorAll('.basic-input-canvas-layer')).toHaveLength(1);
    expect(owner.querySelectorAll('.basic-input-canvas-layer')).toHaveLength(1);
  });

  test('draws only explicit step, participant, and artifact references', () => {
    const result = BasicInputCanvas.sync({ panel, schema: { steps: [
      { ref: 'r1', kind: 'round', output: { artifacts: [{ id: 'draft', name: 'Draft' }] }, models: [
        { id: 'claude-id', name: 'Claude' }, { id: 'gpt-id', name: 'GPT' }
      ] },
      { ref: 'r2', kind: 'round', input: [
        { artifact: { step: 'r1', participant: 'claude-id', id: 'draft' }, version: 'latest', required: true },
        { step: 'r1', participant: 'gpt-id', required: true }
      ], models: [{ id: 'gemini-id', name: 'Gemini', input: [{ step: 'r1', participant: 'claude-id', required: true }] }] },
      { ref: 'owner:approve', kind: 'owner', input: [{ step: 'r2', required: true }], models: [] }
    ] } });
    expect(result.links).toBe(4);
    const paths = Array.from(panel.querySelectorAll('.basic-input-canvas-svg path'));
    expect(paths).toHaveLength(4);
    expect(paths.find((path) => path.dataset.target === 'gemini-id')?.dataset.source).toBe('claude-id');
    expect(paths.find((path) => path.dataset.target === 'owner:approve')?.dataset.source).toBe('r2');
  });

  test('owner inputs terminate at the User card', () => {
    BasicInputCanvas.sync({ panel, schema: { steps: [
      { ref: 'owner:approve', kind: 'owner', input: [{ step: 'r1', participant: 'owner', required: true }], models: [] },
      { ref: 'r1', kind: 'round', models: [{ id: 'claude-id', name: 'Claude' }] }
    ] } });
    // Backwards links are not emitted by the canvas; a valid owner consumer is tested below.
    expect(panel.querySelectorAll('.basic-input-canvas-svg path')).toHaveLength(0);
    BasicInputCanvas.sync({ panel, schema: { steps: [
      { ref: 'r1', kind: 'round', models: [{ id: 'claude-id', name: 'Claude' }] },
      { ref: 'owner:approve', kind: 'owner', input: [{ step: 'r1', participant: 'claude-id', required: true }], models: [] }
    ] } });
    const path = panel.querySelector('.basic-input-canvas-svg path');
    expect(path.dataset.target).toBe('owner:approve');
    expect(path.dataset.source).toBe('claude-id');
  });

  test('owner links start and end at centered cards between rounds', () => {
    const result = BasicInputCanvas.sync({ panel, schema: { steps: [
      { ref: 'r1', kind: 'round', models: [{ id: 'claude-id', name: 'Claude' }] },
      { ref: 'owner:approve', kind: 'owner', input: [{ step: 'r1', participant: 'claude-id' }], models: [] },
      { ref: 'owner:review', kind: 'owner', input: [{ step: 'owner:approve', participant: 'owner' }], models: [] },
      { ref: 'r2', kind: 'round', models: [{ id: 'gemini-id', name: 'Gemini', input: [{ step: 'owner:review', participant: 'owner' }] }] }
    ] } });

    const bounds = (left, right, top, height) => ({
      left, right, top, height, width: right - left, bottom: top + height, x: left, y: top, toJSON: () => ({})
    });
    panel.querySelector('.pipeline-canvas').getBoundingClientRect = () => bounds(0, 400, 0, 400);
    panel.querySelector('.model-block[data-participant-id="claude-id"]').getBoundingClientRect = () => bounds(10, 40, 20, 40);
    panel.querySelector('[data-control-card="owner:approve"]').getBoundingClientRect = () => bounds(70, 100, 100, 60);
    panel.querySelector('[data-control-card="owner:review"]').getBoundingClientRect = () => bounds(130, 160, 200, 80);
    panel.querySelector('.model-block[data-participant-id="gemini-id"]').getBoundingClientRect = () => bounds(190, 220, 300, 20);
    result.redraw();

    const paths = Array.from(panel.querySelectorAll('.basic-input-canvas-svg path'));
    expect(paths).toHaveLength(3);
    expect(paths.map((path) => [path.dataset.source, path.dataset.target])).toEqual([
      ['claude-id', 'owner:approve'],
      ['owner:approve', 'owner:review'],
      ['owner:review', 'gemini-id']
    ]);
    expect(paths.map((path) => path.getAttribute('d'))).toEqual([
      'M 40 40 C 52 40, 58 130, 70 130',
      'M 100 130 C 112 130, 118 240, 130 240',
      'M 160 240 C 172 240, 178 310, 190 310'
    ]);
  });

  test('global attachment names appear under In without inferred links', () => {
    const result = BasicInputCanvas.sync({ panel, schema: { steps: [
      { ref: 'r1', kind: 'round', input: 'none', models: [{ id: 'claude-id', name: 'Claude' }] }
    ] }, attachments: [{ id: 'upload-1', name: 'brief.pdf' }] });
    expect(panel.querySelector('.entry-column .basic-input-canvas-chip')?.textContent).toBe('brief.pdf');
    expect(result.links).toBe(0);
    expect(panel.querySelectorAll('.basic-input-canvas-svg path')).toHaveLength(0);
  });

  test('step and model files are shown in their target columns, with optional file callback', () => {
    const onFile = jest.fn();
    BasicInputCanvas.sync({ panel, onFile, schema: { steps: [
      { ref: 'r1', kind: 'round', files: [{ id: 'step-file', name: 'input.txt' }], models: [
        { id: 'claude-id', name: 'Claude', files: [{ id: 'model-file', name: 'model.csv' }] }
      ] }
    ] } });
    panel.querySelector('[data-file-id="step-file"]').click();
    expect(onFile).toHaveBeenCalledWith({ id: 'step-file', name: 'input.txt' });
    expect(panel.querySelector('.model-block[data-participant-id="claude-id"] [data-file-id="model-file"]')?.textContent).toBe('model.csv');
  });

  test('document artifact frames move into the output row and keep their handlers across syncs', () => {
    const column = panel.querySelector('.stage-column[data-round="1"]');
    const frame = document.createElement('button');
    frame.className = 'pipeline-doc-frame';
    frame.dataset.docId = 'spec';
    frame.textContent = 'Spec';
    const onClick = jest.fn();
    frame.addEventListener('click', onClick);
    column.appendChild(frame);
    const schema = { steps: [
      { ref: 'r1', kind: 'round', output: { artifacts: [{ id: 'spec', name: 'Spec' }] }, models: [
        { id: 'claude-id', name: 'Claude' }
      ] }
    ] };

    const first = BasicInputCanvas.sync({ panel, schema });
    expect(first.chips).toBe(1);
    expect(column.querySelector('.basic-input-canvas-layer .pipeline-doc-frame')).toBe(frame);
    expect(frame.dataset.artifactKey).toBe(JSON.stringify(['r1', 'claude-id', 'spec']));

    const second = BasicInputCanvas.sync({ panel, schema, attachments: [{ id: 'brief', name: 'Brief' }] });
    expect(second.chips).toBe(2);
    expect(column.querySelectorAll('.basic-input-canvas-layer')).toHaveLength(1);
    expect(column.querySelectorAll('.basic-input-canvas-layer .pipeline-doc-frame')).toHaveLength(1);
    expect(column.querySelector('.basic-input-canvas-layer .pipeline-doc-frame')).toBe(frame);
    frame.click();
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  test('repeated sync replaces its own chips and links, and respects the hidden-arrows class', () => {
    const schema = { steps: [
      { ref: 'r1', kind: 'round', output: { artifacts: [{ id: 'draft', name: 'Draft' }] }, models: [{ id: 'claude-id', name: 'Claude' }] },
      { ref: 'r2', kind: 'round', input: [{ artifact: { step: 'r1', participant: 'claude-id', id: 'draft' }, version: 'latest' }], models: [{ id: 'gemini-id', name: 'Gemini' }] }
    ] };
    BasicInputCanvas.sync({ panel, schema });
    panel.querySelector('.pipeline-canvas').classList.add('arrows-hidden');
    const result = BasicInputCanvas.sync({ panel, schema });
    expect(panel.querySelectorAll('.basic-input-canvas-chip')).toHaveLength(1);
    const sourceColumn = panel.querySelector('.stage-column[data-round="1"]');
    const artifactLayer = sourceColumn.querySelector('.basic-input-canvas-layer');
    expect(sourceColumn.querySelectorAll('.basic-input-canvas-layer')).toHaveLength(1);
    expect(artifactLayer.querySelectorAll('[data-artifact-key]')).toHaveLength(1);
    expect(artifactLayer.querySelector('[data-artifact-key]')?.dataset.artifactKey)
      .toBe(JSON.stringify(['r1', 'claude-id', 'draft']));
    expect(panel.querySelectorAll('.basic-input-canvas-svg')).toHaveLength(1);
    expect(panel.querySelector('.basic-input-canvas-svg').dataset.hidden).toBe('true');
    expect(result.links).toBe(1);
  });

  test('resize redraws explicit connectors from the current element positions', () => {
    BasicInputCanvas.sync({ panel, schema: { steps: [
      { ref: 'r1', kind: 'round', models: [{ id: 'claude-id', name: 'Claude' }] },
      { ref: 'r2', kind: 'round', input: [{ step: 'r1', required: true }], models: [{ id: 'gemini-id', name: 'Gemini' }] }
    ] } });
    const source = panel.querySelector('.stage-column[data-round="1"]');
    const target = panel.querySelector('.stage-column[data-round="2"]');
    const bounds = (left, right) => ({ left, right, top: 0, height: 20, width: right - left, bottom: 20, x: left, y: 0, toJSON: () => ({}) });
    jest.spyOn(source, 'getBoundingClientRect').mockReturnValue(bounds(10, 20));
    jest.spyOn(target, 'getBoundingClientRect').mockReturnValue(bounds(100, 110));
    window.dispatchEvent(new Event('resize'));
    const first = panel.querySelector('.basic-input-canvas-link').getAttribute('d');
    target.getBoundingClientRect.mockReturnValue(bounds(200, 210));
    window.dispatchEvent(new Event('resize'));
    const second = panel.querySelector('.basic-input-canvas-link').getAttribute('d');
    expect(first).not.toBe(second);
    expect(second.endsWith('200 10')).toBe(true);
  });
});
