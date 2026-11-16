/** @jest-environment jsdom */
const fs = require('node:fs');
const path = require('node:path');

const resultsSource = fs.readFileSync(path.join(__dirname, '..', 'results.js'), 'utf8');

const makeDropPanel = ({ files = [], setFailure = null, pipelineRunActive = false } = {}) => {
  document.body.innerHTML = '<section id="pipeline"><div class="stage-column" data-round="1"><span id="round-target"></span></div><div class="pipeline-control-step" data-round="2"><span id="control-target"></span></div></section>';
  const panel = document.querySelector('#pipeline');
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
  const marker = 'let fileDropQueue = Promise.resolve();';
  const endMarker = "pipelinePanel?.addEventListener('change'";
  const start = resultsSource.indexOf(marker);
  const end = resultsSource.indexOf(endMarker, start);
  if (start < 0 || end <= start) throw new Error('Basic round drop handlers are missing from results.js');
  const handlerSetup = resultsSource.slice(start, end);
  const getQueue = new Function('pipelinePanel', 'pipelineRunActive', 'isCustomEnginePipeline', 'draftPlanStorageKey',
    'getCustomRoundSettings', 'window', 'setCustomRoundSetting', 'syncBasicInputCanvas', 'showNotification',
    `${handlerSetup}; return () => fileDropQueue;`)(panel, pipelineRunActive, () => true, () => 'pipeline-A',
    () => settings, { BasicInputFiles: { createStore: () => store, validateBatch } }, setCustomRoundSetting,
    jest.fn(), (message) => notices.push(message));
  return { panel, settings, store, removed, put, validateBatch, setCustomRoundSetting, notices, queue: getQueue };
};

const dragEvent = (type, files = []) => {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'dataTransfer', { value: { types: ['Files'], files, dropEffect: 'none' } });
  return event;
};

describe('Basic round file drop integration', () => {
  test('dropping files on a round stores them and persists them as shared step.files', async () => {
    const h = makeDropPanel();
    const file = new File(['brief'], 'brief.txt', { type: 'text/plain' });
    const target = document.querySelector('#round-target');
    const dragover = dragEvent('dragover');
    target.dispatchEvent(dragover);
    expect(dragover.defaultPrevented).toBe(true);
    expect(dragover.dataTransfer.dropEffect).toBe('copy');

    target.dispatchEvent(dragEvent('drop', [file]));
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
    document.querySelector('#round-target').dispatchEvent(dragEvent('drop', files));
    await h.queue();

    expect(h.validateBatch).toHaveBeenCalledWith(files);
    expect(h.put.mock.calls.map(([file]) => file.name)).toEqual(['brief.txt', 'sample.bin']);
    expect(h.settings.r1.files.map((file) => [file.name, file.type, file.size])).toEqual([
      ['brief.txt', 'text/plain', 5], ['sample.bin', 'application/octet-stream', 2]
    ]);
  });

  test('dropping onto a User/control column is not consumed', () => {
    makeDropPanel();
    const event = dragEvent('dragover');
    document.querySelector('#control-target').dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
  });

  test('a failed schema write rolls back stored bytes and reports the failure', async () => {
    const h = makeDropPanel({ setFailure: new Error('schema write failed') });
    document.querySelector('#round-target').dispatchEvent(dragEvent('drop', [new File(['x'], 'x.txt')]));
    await h.queue();
    expect(h.put).toHaveBeenCalledTimes(1);
    expect(h.store.remove).toHaveBeenCalledWith('stored-x.txt');
    expect(h.settings.r1.files).toEqual([]);
    expect(h.notices).toEqual(['Файлы не добавлены: schema write failed']);
  });

  test('a run in progress refuses the drop without writing', async () => {
    const h = makeDropPanel({ pipelineRunActive: true });
    document.querySelector('#round-target').dispatchEvent(dragEvent('drop', [new File(['x'], 'x.txt')]));
    await h.queue();
    expect(h.put).not.toHaveBeenCalled();
    expect(h.setCustomRoundSetting).not.toHaveBeenCalled();
  });
});
