/** @jest-environment jsdom */
const fs = require('node:fs');
const path = require('node:path');

const resultsSource = fs.readFileSync(path.join(__dirname, '..', 'results.js'), 'utf8');

const makeDropPanel = ({ files = [], setFailure = null, pipelineRunActive = false } = {}) => {
  document.body.innerHTML = `
    <section id="pipeline-panel">
      <div class="pipeline-canvas">
        <div class="pipeline-flow">
          <div class="stage-column entry-column" id="entry-column"></div>
          <div class="connector-group" id="connector-before-round"></div>
          <div class="stage-column" id="round1" data-round="1"><span id="round-target"></span></div>
          <div class="connector-group" id="connector-between-rounds"></div>
          <div class="stage-column" id="round2" data-round="2"><span id="second-round-target"></span></div>
          <div class="connector-group" id="connector-before-control"></div>
          <div class="stage-column pipeline-control-step" id="control" data-round="3"><span id="control-target"></span></div>
        </div>
      </div>
    </section>`;
  const panel = document.querySelector('#pipeline-panel');
  const canvas = panel.querySelector('.pipeline-canvas');
  const flow = panel.querySelector('.pipeline-flow');
  const rect = (left, top, right, bottom) => ({
    x: left, y: top, left, top, right, bottom, width: right - left, height: bottom - top,
    toJSON() { return { x: left, y: top, left, top, right, bottom, width: right - left, height: bottom - top }; }
  });
  const setRect = (element, bounds) => { element.getBoundingClientRect = () => bounds; };
  setRect(canvas, rect(0, 0, 600, 300));
  setRect(flow, rect(10, 10, 590, 300));
  setRect(document.querySelector('#entry-column'), rect(10, 20, 110, 120));
  setRect(document.querySelector('#round1'), rect(160, 20, 260, 120));
  setRect(document.querySelector('#round2'), rect(310, 20, 410, 120));
  setRect(document.querySelector('#control'), rect(460, 20, 560, 120));
  const settings = { r1: { files: files.slice() } };
  const removed = [];
  const put = jest.fn(async (file) => ({ id: `stored-${file.name}`, name: file.name, type: file.type, size: file.size }));
  const remove = jest.fn(async (id) => removed.push(id));
  const store = { put, remove, get: jest.fn(async () => null) };
  const validateBatch = jest.fn((batch) => batch.reduce((sum, item) => sum + item.size, 0));
  const setCustomRoundSetting = jest.fn(async (ref, key, next) => {
    if (setFailure) throw setFailure;
    settings[ref] ||= {};
    settings[ref][key] = next;
  });
  const notices = [];
  const addCommon = jest.fn();
  const marker = 'let fileDropQueue = Promise.resolve();';
  const endMarker = "pipelinePanel?.addEventListener('change'";
  const start = resultsSource.indexOf(marker);
  const end = resultsSource.indexOf(endMarker, start);
  if (start < 0 || end <= start) throw new Error('Basic round drop handlers are missing from results.js');
  const handlerSetup = resultsSource.slice(start, end);
  window.BasicInputFiles = { createStore: () => store, validateBatch };
  const getQueue = new Function('pipelinePanel', 'pipelineCanvas', 'pipelineRunActive', 'usesBasicCanvas', 'draftPlanStorageKey',
    'getCustomRoundSettings', 'window', 'setCustomRoundSetting', 'syncBasicInputCanvas', 'showNotification', 'tryAddTransferAttachments',
    `${handlerSetup}; return () => fileDropQueue;`)(panel, canvas, pipelineRunActive, () => true, () => 'pipeline-A',
    () => settings, window, setCustomRoundSetting,
    jest.fn(), (message) => notices.push(message), addCommon);
  return { panel, canvas, settings, store, removed, put, validateBatch, setCustomRoundSetting, notices, addCommon, queue: getQueue };
};

const dragEvent = (type, files = [], { x = 200, y = 80 } = {}) => {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'dataTransfer', { value: { types: ['Files'], files, dropEffect: 'none' } });
  Object.defineProperties(event, { clientX: { value: x }, clientY: { value: y } });
  return event;
};

describe('Basic round file drop integration', () => {
  test('dropping files on a round stores them and persists them as shared step.files', async () => {
    const h = makeDropPanel();
    const file = new File(['brief'], 'brief.txt', { type: 'text/plain' });
    const target = document.querySelector('#round-target');
    const dragover = dragEvent('dragover', [], { x: 200, y: 80 });
    target.dispatchEvent(dragover);
    expect(dragover.defaultPrevented).toBe(true);
    expect(dragover.dataTransfer.dropEffect).toBe('copy');

    target.dispatchEvent(dragEvent('drop', [file], { x: 200, y: 80 }));
    await h.queue();

    expect(h.validateBatch).toHaveBeenCalledWith([file]);
    expect(h.put).toHaveBeenCalledWith(file);
    expect(h.setCustomRoundSetting).toHaveBeenCalledWith('r1', 'files', [expect.objectContaining({
      id: 'stored-brief.txt', name: 'brief.txt', type: 'text/plain', size: 5
    })]);
    expect(h.settings.r1.files[0].name).toBe('brief.txt');
  });

  test('dropping multiple formats saves each file and descriptor in the round', async () => {
    const h = makeDropPanel();
    const files = [new File(['brief'], 'brief.txt', { type: 'text/plain' }), new File([new Uint8Array([1, 2])], 'sample.bin', { type: 'application/octet-stream' })];
    document.querySelector('#round-target').dispatchEvent(dragEvent('drop', files, { x: 200, y: 80 }));
    await h.queue();

    expect(h.validateBatch).toHaveBeenCalledWith(files);
    expect(h.put.mock.calls.map(([file]) => file.name)).toEqual(['brief.txt', 'sample.bin']);
    expect(h.settings.r1.files.map((file) => [file.name, file.type, file.size])).toEqual([
      ['brief.txt', 'text/plain', 5], ['sample.bin', 'application/octet-stream', 2]
    ]);
  });

  test('the start column is a territory of its own: its files become common attachments, not files of the first round', async () => {
    const h = makeDropPanel();
    const target = document.querySelector('#entry-column');
    const dragover = dragEvent('dragover', [], { x: 1, y: 80 });
    target.dispatchEvent(dragover);
    expect(dragover.defaultPrevented).toBe(true);
    const guide = h.panel.querySelector('.pipeline-round-territory');
    expect([guide.style.left, guide.style.width]).toEqual(['-9px', '134px']);

    const drop = dragEvent('drop', [new File(['x'], 'start.txt')], { x: 60, y: 80 });
    target.dispatchEvent(drop);
    await h.queue();

    expect(drop.defaultPrevented).toBe(true);
    expect(h.addCommon).toHaveBeenCalledWith(drop.dataTransfer);
    expect(h.setCustomRoundSetting).not.toHaveBeenCalled();
  });

  test('a run in progress refuses a drop on the start column', () => {
    const h = makeDropPanel({ pipelineRunActive: true });
    const drop = dragEvent('drop', [new File(['x'], 'start.txt')], { x: 60, y: 80 });
    document.querySelector('#entry-column').dispatchEvent(drop);
    expect(drop.defaultPrevented).toBe(true);
    expect(h.addCommon).not.toHaveBeenCalled();
  });

  test('dropping onto a User/control column is not consumed', () => {
    makeDropPanel();
    const event = dragEvent('dragover', [], { x: 500, y: 80 });
    document.querySelector('#control-target').dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
  });

  test('a failed schema write rolls back stored bytes and reports the failure', async () => {
    const h = makeDropPanel({ setFailure: new Error('schema write failed') });
    document.querySelector('#round-target').dispatchEvent(dragEvent('drop', [new File(['x'], 'x.txt')], { x: 200, y: 80 }));
    await h.queue();
    expect(h.put).toHaveBeenCalledTimes(1);
    expect(h.store.remove).toHaveBeenCalledWith('stored-x.txt');
    expect(h.settings.r1.files).toEqual([]);
    expect(h.notices).toEqual(['Файлы не добавлены: schema write failed']);
  });

  test('a run in progress refuses the drop without writing', async () => {
    const h = makeDropPanel({ pipelineRunActive: true });
    document.querySelector('#round-target').dispatchEvent(dragEvent('drop', [new File(['x'], 'x.txt')], { x: 200, y: 80 }));
    await h.queue();
    expect(h.put).not.toHaveBeenCalled();
    expect(h.setCustomRoundSetting).not.toHaveBeenCalled();
  });

  test('both halves of the connector and blank canvas below a short round map to a round', async () => {
    const h = makeDropPanel();
    const leftHalf = dragEvent('dragover', [], { x: 275, y: 80 });
    document.querySelector('#connector-between-rounds').dispatchEvent(leftHalf);
    expect(leftHalf.defaultPrevented).toBe(true);
    const rightHalf = dragEvent('dragover', [], { x: 285, y: 80 });
    document.querySelector('#connector-between-rounds').dispatchEvent(rightHalf);
    expect(rightHalf.defaultPrevented).toBe(true);
    const blankCanvas = dragEvent('dragover', [], { x: 200, y: 250 });
    document.querySelector('#round-target').dispatchEvent(blankCanvas);
    expect(blankCanvas.defaultPrevented).toBe(true);

    document.querySelector('#connector-between-rounds').dispatchEvent(dragEvent('drop', [new File(['x'], 'left.txt')], { x: 275, y: 80 }));
    document.querySelector('#connector-between-rounds').dispatchEvent(dragEvent('drop', [new File(['y'], 'right.txt')], { x: 285, y: 80 }));
    document.querySelector('#round-target').dispatchEvent(dragEvent('drop', [new File(['z'], 'blank.txt')], { x: 200, y: 250 }));
    await h.queue();

    expect(h.setCustomRoundSetting.mock.calls.map(([ref, , files]) => [ref, files.map((file) => file.name)])).toEqual([
      ['r1', ['left.txt']], ['r2', ['right.txt']], ['r1', ['left.txt', 'blank.txt']]
    ]);
  });

  test('the round guide appears only while files are dragged, and clears on scroll and resize', () => {
    const h = makeDropPanel();
    const target = document.querySelector('#connector-between-rounds');
    target.dispatchEvent(dragEvent('pointermove', [], { x: 275, y: 80 }));
    expect(h.panel.querySelector('.pipeline-round-territory')).toBeNull();
    target.dispatchEvent(dragEvent('dragover', [], { x: 275, y: 80 }));
    const guide = h.panel.querySelector('.pipeline-round-territory');
    expect(guide).not.toBeNull();
    expect(guide.style.left).toBe('125px');
    expect(guide.style.width).toBe('150px');
    expect(guide.style.height).toBe('254px');

    h.canvas.dispatchEvent(new Event('scroll'));
    expect(h.panel.querySelector('.pipeline-round-territory')).toBeNull();
    target.dispatchEvent(dragEvent('dragover', [], { x: 285, y: 80 }));
    expect(h.panel.querySelector('.pipeline-round-territory')).not.toBeNull();
    window.dispatchEvent(new Event('resize'));
    expect(h.panel.querySelector('.pipeline-round-territory')).toBeNull();
  });
});
