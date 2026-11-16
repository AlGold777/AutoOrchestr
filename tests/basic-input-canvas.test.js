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
        <div class="connector-group"><svg><line data-artifact-junction="true"></line></svg></div>
        <div class="stage-column" data-round="2">
          <div class="model-block" data-participant-id="gemini-id"><span class="model-name">Gemini</span></div>
        </div>
        <div class="connector-group"><svg><line data-artifact-junction="true"></line></svg></div>
        <div class="stage-column pipeline-control-step" data-control-ref="owner:approve">
          <button class="pipeline-control-card" data-control-card="owner:approve">Owner</button>
        </div>
        <div class="connector-group"><svg><line data-artifact-junction="true"></line></svg></div>
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
      ], models: [{ id: 'gemini-id', name: 'Gemini', input: [{ artifact: { step: 'r1', participant: 'claude-id', id: 'draft' }, version: 'latest' }] }] },
      { ref: 'owner:approve', kind: 'owner', input: [{ step: 'r2', required: true }], output: { artifacts: [{ id: 'decision', name: 'Decision' }] }, models: [] }
    ] } });
    expect(result.links).toBe(1);
    const paths = Array.from(panel.querySelectorAll('.basic-input-canvas-svg path'));
    expect(paths).toHaveLength(1);
    expect(paths[0]?.dataset.source).toBe('claude-id');
    expect(paths[0]?.dataset.sourceArtifact).toBe(JSON.stringify(['r1', 'claude-id', 'draft']));
    expect(paths[0]?.dataset.target).toBe('r2');
  });

  test('owner inputs terminate at the User card', () => {
    BasicInputCanvas.sync({ panel, schema: { steps: [
      { ref: 'r1', kind: 'round', output: { artifacts: [{ id: 'spec', name: 'Spec' }] }, models: [{ id: 'claude-id', name: 'Claude' }] },
      { ref: 'owner:approve', kind: 'owner', input: [{ step: 'r1', participant: 'claude-id', required: true }], models: [] }
    ] } });
    const path = panel.querySelector('.basic-input-canvas-svg path');
    expect(path.dataset.target).toBe('owner:approve');
    expect(path.dataset.source).toBe('claude-id');
  });

  test('owner links start and end at centered cards between rounds', () => {
    const result = BasicInputCanvas.sync({ panel, schema: { steps: [
      { ref: 'r1', kind: 'round', output: { artifacts: [{ id: 'draft', name: 'Draft' }] }, models: [{ id: 'claude-id', name: 'Claude' }] },
      { ref: 'owner:approve', kind: 'owner', input: [{ step: 'r1', participant: 'claude-id' }], output: { artifacts: [{ id: 'decision', name: 'Decision' }] }, models: [] },
      { ref: 'owner:review', kind: 'owner', input: [{ step: 'owner:approve', participant: 'owner' }], output: { artifacts: [{ id: 'review', name: 'Review' }] }, models: [] },
      { ref: 'r2', kind: 'round', models: [{ id: 'gemini-id', name: 'Gemini', input: [{ step: 'owner:review', participant: 'owner' }] }] }
    ] } });

    const bounds = (left, right, top, height) => ({
      left, right, top, height, width: right - left, bottom: top + height, x: left, y: top, toJSON: () => ({})
    });
    panel.querySelector('.pipeline-canvas').getBoundingClientRect = () => bounds(0, 400, 0, 400);
    const chips = Array.from(panel.querySelectorAll('.basic-input-canvas-layer [data-artifact-key]'));
    chips[0].getBoundingClientRect = () => bounds(20, 40, 50, 18);
    chips[1].getBoundingClientRect = () => bounds(80, 120, 120, 18);
    chips[2].getBoundingClientRect = () => bounds(140, 180, 220, 18);
    const junctions = Array.from(panel.querySelectorAll('[data-artifact-junction]'));
    junctions[0].getBoundingClientRect = () => bounds(190, 220, 310, 0);
    junctions[1].getBoundingClientRect = () => bounds(70, 100, 130, 0);
    junctions[2].getBoundingClientRect = () => bounds(130, 160, 240, 0);
    result.redraw();

    const paths = Array.from(panel.querySelectorAll('.basic-input-canvas-svg path'));
    expect(paths).toHaveLength(3);
    expect(paths.map((path) => [path.dataset.source, path.dataset.target])).toEqual([
      ['claude-id', 'owner:approve'],
      ['owner:approve', 'owner:review'],
      ['owner:review', 'r2']
    ]);
    expect(paths.every((path) => path.dataset.sourceArtifact)).toBe(true);
    expect(paths.map((path) => path.getAttribute('d'))).toEqual([
      'M 40 59 H 85 V 130',
      'M 120 129 H 145 V 240',
      'M 180 229 H 205 V 310'
    ]);
  });

  test('step references resolve to declared artifacts, duplicate refs dedupe, and missing outputs have no links', () => {
    const schema = { steps: [
      { ref: 'r1', kind: 'round', output: { artifacts: [{ id: 'draft', name: 'Draft' }] }, models: [{ id: 'claude-id', name: 'Claude' }] },
      { ref: 'r2', kind: 'round', models: [
        { id: 'gemini-id', name: 'Gemini', input: ['r1', { step: 'r1' }, { artifact: { step: 'r1', participant: 'claude-id', id: 'draft' } }] },
        { id: 'gpt-id', name: 'GPT', input: ['r1'] },
        { id: 'deepseek-id', name: 'DeepSeek', input: ['r1'] }
      ] }
    ] };
    const result = BasicInputCanvas.sync({ panel, schema });
    expect(result.links).toBe(1);
    expect(panel.querySelectorAll('.basic-input-canvas-svg path')).toHaveLength(1);

    const noOutput = BasicInputCanvas.sync({ panel, schema: { steps: [
      { ref: 'r1', kind: 'round', models: [{ id: 'claude-id', name: 'Claude' }] },
      { ref: 'r2', kind: 'round', models: [{ id: 'gemini-id', name: 'Gemini', input: ['r1'] }] }
    ] } });
    expect(noOutput.links).toBe(0);
    expect(panel.querySelectorAll('.basic-input-canvas-svg path')).toHaveLength(0);

    panel.querySelector('.stage-column[data-round="2"]').previousElementSibling.remove();
    const noJunction = BasicInputCanvas.sync({ panel, schema: { steps: [
      { ref: 'r1', kind: 'round', output: { artifacts: [{ id: 'draft', name: 'Draft' }] }, models: [{ id: 'claude-id', name: 'Claude' }] },
      { ref: 'r2', kind: 'round', models: [{ id: 'gemini-id', name: 'Gemini', input: ['r1'] }] }
    ] } });
    expect(noJunction.links).toBe(0);
    expect(panel.querySelectorAll('.basic-input-canvas-svg path')).toHaveLength(0);
  });

  test('a disconnected artifact source is dropped on redraw instead of drawing from the page origin', () => {
    const result = BasicInputCanvas.sync({ panel, schema: { steps: [
      { ref: 'r1', kind: 'round', output: { artifacts: [{ id: 'draft', name: 'Draft' }] }, models: [{ id: 'claude-id', name: 'Claude' }] },
      { ref: 'r2', kind: 'round', models: [{ id: 'gemini-id', name: 'Gemini', input: ['r1'] }] }
    ] } });
    const source = panel.querySelector('[data-artifact-key]');
    expect(panel.querySelectorAll('.basic-input-canvas-svg path')).toHaveLength(1);

    source.remove();
    result.redraw();

    expect(panel.querySelectorAll('.basic-input-canvas-svg path')).toHaveLength(0);
  });

  test('an intervening artifact gets a top bypass and each path ends at the shared junction midpoint', () => {
    const result = BasicInputCanvas.sync({ panel, schema: { steps: [
      { ref: 'r1', kind: 'round', models: [
        { id: 'claude-id', name: 'Claude', output: { artifacts: [{ id: 'first', name: 'First' }] } },
        { id: 'gpt-id', name: 'GPT', output: { artifacts: [{ id: 'second', name: 'Second' }] } }
      ] },
      { ref: 'r2', kind: 'round', models: [
        { id: 'gemini-id', name: 'Gemini', input: ['r1'] },
        { id: 'deepseek-id', name: 'DeepSeek', input: ['r1'] },
        { id: 'qwen-id', name: 'Qwen', input: ['r1'] }
      ] }
    ] } });
    const bounds = (left, right, top, height) => ({ left, right, top, height, width: right - left, bottom: top + height, x: left, y: top, toJSON: () => ({}) });
    const canvas = panel.querySelector('.pipeline-canvas');
    canvas.getBoundingClientRect = () => bounds(0, 400, 0, 200);
    const chips = Array.from(panel.querySelectorAll('.basic-input-canvas-layer [data-artifact-key]'));
    chips[0].getBoundingClientRect = () => bounds(20, 50, 50, 18);
    chips[1].getBoundingClientRect = () => bounds(70, 100, 50, 18);
    const junction = panel.querySelector('.stage-column[data-round="2"]').previousElementSibling.querySelector('[data-artifact-junction]');
    junction.getBoundingClientRect = () => bounds(140, 160, 90, 20);
    result.redraw();

    const paths = Array.from(panel.querySelectorAll('.basic-input-canvas-svg path'));
    expect(result.links).toBe(2);
    expect(paths).toHaveLength(2);
    expect(paths.map((path) => path.dataset.target)).toEqual(['r2', 'r2']);
    expect(paths.map((path) => path.getAttribute('d'))).toEqual([
      'M 50 59 H 68 V 44 H 102 V 59 H 150 V 100',
      'M 100 59 H 150 V 100'
    ]);
    expect(paths[0].getAttribute('d')).toContain('V 44');
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
    expect(onFile).toHaveBeenCalledWith({ id: 'step-file', name: 'input.txt' }, { ref: 'r1' });
    expect(panel.querySelector('.model-block[data-participant-id="claude-id"] [data-file-id="model-file"]')?.textContent).toBe('model.csv');
  });

  test('file long press reveals scoped unlink, suppresses the following click, and dismisses outside or with Escape', () => {
    jest.useFakeTimers();
    const onFile = jest.fn();
    const onRemoveFile = jest.fn();
    const file = { id: 'shared-id', name: 'same.pdf' };
    BasicInputCanvas.sync({ panel, onFile, onRemoveFile, schema: { steps: [
      { ref: 'r1', kind: 'round', files: [file], models: [{ id: 'claude-id', name: 'Claude', files: [file] }] }
    ] } });
    const shared = panel.querySelector('.stage-column[data-round="1"] .basic-input-file-wrap [data-file-id="shared-id"]');
    const privateFile = panel.querySelector('.model-block[data-participant-id="claude-id"] .basic-input-file-wrap [data-file-id="shared-id"]');
    expect(shared.tagName).toBe('BUTTON');
    expect(privateFile.tagName).toBe('BUTTON');

    const pointer = (target, type, { x = 10, y = 10, pointerId = 1 } = {}) => {
      const event = new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, clientX: x, clientY: y });
      Object.defineProperty(event, 'pointerId', { value: pointerId });
      target.dispatchEvent(event);
    };

    pointer(shared, 'pointerdown');
    jest.advanceTimersByTime(550);
    const removeShared = shared.parentElement.querySelector('.basic-input-file-delete');
    expect(removeShared.hidden).toBe(false);
    pointer(document, 'pointerup');
    shared.click();
    expect(onFile).not.toHaveBeenCalled();

    pointer(document.body, 'pointerdown', { pointerId: 2 });
    expect(removeShared.hidden).toBe(true);

    pointer(privateFile, 'pointerdown', { pointerId: 3 });
    jest.advanceTimersByTime(550);
    const removePrivate = privateFile.parentElement.querySelector('.basic-input-file-delete');
    expect(removePrivate.hidden).toBe(false);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(removePrivate.hidden).toBe(true);
    jest.useRealTimers();
  });

  test('movement beyond 8px cancels file long press; exactly 8px remains within tolerance', () => {
    jest.useFakeTimers();
    const onFile = jest.fn();
    const onRemoveFile = jest.fn();
    BasicInputCanvas.sync({ panel, onFile, onRemoveFile, schema: { steps: [
      { ref: 'r1', kind: 'round', files: [{ id: 'step-file', name: 'input.txt' }], models: [] }
    ] } });
    const chip = panel.querySelector('[data-file-id="step-file"]');
    const pointer = (target, type, { x = 10, pointerId = 1 } = {}) => {
      const event = new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, clientX: x, clientY: 10 });
      Object.defineProperty(event, 'pointerId', { value: pointerId });
      target.dispatchEvent(event);
    };
    pointer(chip, 'pointerdown', { pointerId: 1 });
    pointer(document, 'pointermove', { x: 18, pointerId: 1 });
    jest.advanceTimersByTime(550);
    expect(chip.parentElement.querySelector('.basic-input-file-delete').hidden).toBe(false);

    pointer(document, 'pointerup', { pointerId: 1 });
    chip.parentElement.querySelector('.basic-input-file-delete').click();
    expect(onRemoveFile).toHaveBeenCalledWith({ id: 'step-file', name: 'input.txt' }, { ref: 'r1' });

    BasicInputCanvas.sync({ panel, onFile, onRemoveFile, schema: { steps: [
      { ref: 'r1', kind: 'round', files: [{ id: 'step-file', name: 'input.txt' }], models: [] }
    ] } });
    const fresh = panel.querySelector('[data-file-id="step-file"]');
    pointer(fresh, 'pointerdown', { pointerId: 2 });
    pointer(document, 'pointermove', { x: 19, pointerId: 2 });
    jest.advanceTimersByTime(550);
    expect(fresh.parentElement.querySelector('.basic-input-file-delete').hidden).toBe(true);
    jest.useRealTimers();
  });

  test('unlink callback targets only the selected scope and canvas does not delete stored bytes', () => {
    jest.useFakeTimers();
    const shared = { id: 'same-id', name: 'same.txt' };
    const personal = { ...shared };
    const scopes = { shared: [shared], participant: [personal] };
    const store = { remove: jest.fn() };
    const onRemoveFile = jest.fn((file, scope) => {
      if (scope.participant) scopes.participant = scopes.participant.filter((item) => item.id !== file.id);
      else scopes.shared = scopes.shared.filter((item) => item.id !== file.id);
    });
    BasicInputCanvas.sync({ panel, onFile: jest.fn(), onRemoveFile, schema: { steps: [
      { ref: 'r1', kind: 'round', files: scopes.shared, models: [{ id: 'claude-id', name: 'Claude', files: scopes.participant }] }
    ] } });
    const chip = panel.querySelector('.model-block[data-participant-id="claude-id"] [data-file-id="same-id"]');
    const event = new MouseEvent('pointerdown', { bubbles: true, button: 0 });
    Object.defineProperty(event, 'pointerId', { value: 1 });
    chip.dispatchEvent(event);
    jest.advanceTimersByTime(550);
    chip.parentElement.querySelector('.basic-input-file-delete').click();

    expect(onRemoveFile).toHaveBeenCalledWith(personal, { ref: 'r1', participant: 'claude-id' });
    expect(scopes.shared).toEqual([shared]);
    expect(scopes.participant).toEqual([]);
    expect(store.remove).not.toHaveBeenCalled();
    jest.useRealTimers();
  });

  test('rerender removes file long-press document listeners and stale controls', () => {
    const onFile = jest.fn();
    const onRemoveFile = jest.fn();
    const removeSpy = jest.spyOn(document, 'removeEventListener');
    const schema = { steps: [{ ref: 'r1', kind: 'round', files: [{ id: 'file', name: 'a.txt' }], models: [] }] };
    BasicInputCanvas.sync({ panel, schema, onFile, onRemoveFile });
    BasicInputCanvas.sync({ panel, schema, onFile, onRemoveFile });
    expect(removeSpy).toHaveBeenCalledWith('pointermove', expect.any(Function));
    expect(removeSpy).toHaveBeenCalledWith('pointerup', expect.any(Function));
    expect(panel.querySelectorAll('.basic-input-file-wrap')).toHaveLength(1);
    expect(panel.querySelectorAll('.basic-input-file-delete')).toHaveLength(1);
    removeSpy.mockRestore();
  });

  test('document artifact frames move into the output row and keep their handlers across syncs', () => {
    const column = panel.querySelector('.stage-column[data-round="1"]');
    const frame = document.createElement('button');
    frame.className = 'pipeline-doc-frame';
    frame.dataset.docId = 'spec';
    frame.dataset.docParticipant = 'claude-id';
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

  test('document versions are kept with their producing participant when artifact IDs overlap', () => {
    const column = panel.querySelector('.stage-column[data-round="1"]');
    const claudeV1 = document.createElement('button');
    Object.assign(claudeV1.dataset, { docId: 'report', docParticipant: 'claude-id' });
    claudeV1.className = 'pipeline-doc-frame is-ready';
    claudeV1.textContent = 'Claude report · 1';
    const claudeV2 = document.createElement('button');
    Object.assign(claudeV2.dataset, { docId: 'report', docParticipant: 'claude-id' });
    claudeV2.className = 'pipeline-doc-frame is-ready';
    claudeV2.textContent = 'Claude report · 2';
    const geminiV1 = document.createElement('button');
    Object.assign(geminiV1.dataset, { docId: 'report', docParticipant: 'gemini-id' });
    geminiV1.className = 'pipeline-doc-frame is-ready';
    geminiV1.textContent = 'Gemini report';
    column.append(claudeV1, claudeV2, geminiV1);

    const result = BasicInputCanvas.sync({ panel, schema: { steps: [
      { ref: 'r1', kind: 'round', models: [
        { id: 'claude-id', name: 'Claude', output: { artifacts: [{ id: 'report', name: 'Report' }] } },
        { id: 'gemini-id', name: 'Gemini', output: { artifacts: [{ id: 'report', name: 'Report' }] } }
      ] }
    ] } });

    const frames = Array.from(column.querySelectorAll('.basic-input-canvas-layer .pipeline-doc-frame'));
    expect(frames).toEqual([claudeV1, claudeV2, geminiV1]);
    expect(frames.map((frame) => frame.dataset.artifactKey)).toEqual([
      JSON.stringify(['r1', 'claude-id', 'report']),
      undefined,
      JSON.stringify(['r1', 'gemini-id', 'report'])
    ]);
    expect(result.chips).toBe(3);
  });

  test('a document frame recreated by the run-record lifecycle is reclaimed on the next canvas sync', () => {
    const schema = { steps: [
      { ref: 'r1', kind: 'round', output: { artifacts: [{ id: 'spec', name: 'Spec' }] }, models: [
        { id: 'claude-id', name: 'Claude' }
      ] },
      { ref: 'r2', kind: 'round', input: [
        { artifact: { step: 'r1', participant: 'claude-id', id: 'spec' }, version: 'latest' }
      ], models: [{ id: 'gemini-id', name: 'Gemini' }] }
    ] };
    const column = panel.querySelector('.stage-column[data-round="1"]');
    const original = document.createElement('button');
    original.className = 'pipeline-doc-frame is-pending';
    original.dataset.docId = 'spec';
    original.textContent = 'Spec';
    column.appendChild(original);

    BasicInputCanvas.sync({ panel, schema });
    expect(column.querySelector('.basic-input-canvas-layer .pipeline-doc-frame')).toBe(original);
    expect(panel.querySelector('.basic-input-canvas-link')?.dataset.source).toBe('claude-id');

    // syncDocumentFrames removes every old frame and appends fresh frames directly to the round column.
    original.remove();
    const restored = document.createElement('button');
    restored.className = 'pipeline-doc-frame is-ready';
    restored.dataset.docId = 'spec';
    restored.textContent = 'Spec v1';
    column.appendChild(restored);

    BasicInputCanvas.sync({ panel, schema });
    expect(column.querySelectorAll('.basic-input-canvas-layer')).toHaveLength(1);
    expect(column.querySelectorAll('.basic-input-canvas-layer .pipeline-doc-frame')).toHaveLength(1);
    expect(column.querySelector('.basic-input-canvas-layer .pipeline-doc-frame')).toBe(restored);
    expect(panel.querySelectorAll('.basic-input-canvas-svg path')).toHaveLength(1);
    expect(panel.querySelector('.basic-input-canvas-svg path')?.dataset.source).toBe('claude-id');
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
      { ref: 'r1', kind: 'round', output: { artifacts: [{ id: 'draft', name: 'Draft' }] }, models: [{ id: 'claude-id', name: 'Claude' }] },
      { ref: 'r2', kind: 'round', models: [{ id: 'gemini-id', name: 'Gemini', input: [{ step: 'r1', required: true }] }] }
    ] } });
    const source = panel.querySelector('.stage-column[data-round="1"] [data-artifact-key]');
    const target = panel.querySelector('.stage-column[data-round="2"]').previousElementSibling.querySelector('[data-artifact-junction]');
    const bounds = (left, right) => ({ left, right, top: 0, height: 20, width: right - left, bottom: 20, x: left, y: 0, toJSON: () => ({}) });
    jest.spyOn(source, 'getBoundingClientRect').mockReturnValue(bounds(10, 20));
    jest.spyOn(target, 'getBoundingClientRect').mockReturnValue(bounds(100, 110));
    window.dispatchEvent(new Event('resize'));
    const first = panel.querySelector('.basic-input-canvas-link').getAttribute('d');
    target.getBoundingClientRect.mockReturnValue(bounds(200, 210));
    window.dispatchEvent(new Event('resize'));
    const second = panel.querySelector('.basic-input-canvas-link').getAttribute('d');
    expect(first).not.toBe(second);
    expect(second.endsWith('H 205 V 10')).toBe(true);
  });
});
