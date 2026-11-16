const fs = require('fs');
const path = require('path');
const { delay, renderDebateDom, loadResultsScript } = require('./helpers/results-page-harness');
const CustomRunRecord = require('../disput/custom-run-record');

const inputFilePayload = (name, text) => ({ name, type: 'text/plain', size: Buffer.byteLength(text), base64: Buffer.from(text).toString('base64') });
const descriptor = (id, name, content) => ({ id, name, type: 'text/plain', size: Buffer.byteLength(content), content });
const transportDataUrl = (payload) => `data:${payload.type};base64,${payload.base64}`;

function indexedDBHarness() {
  const data = new Map();
  const writes = [];
  let hasStore = false;
  const db = {
    get objectStoreNames() { return { contains: (name) => name === 'files' && hasStore }; },
    createObjectStore() { hasStore = true; },
    close() {},
    transaction() {
      const tx = {};
      tx.objectStore = () => ({
        put(value, key) { writes.push(key); data.set(JSON.stringify(key), value); return { result: undefined }; },
        get(key) {
          const request = {};
          setTimeout(() => { request.result = data.get(JSON.stringify(key)); request.onsuccess?.(); }, 0);
          return request;
        },
        delete(key) { data.delete(JSON.stringify(key)); return { result: undefined }; }
      });
      setTimeout(() => tx.oncomplete?.(), 0);
      return tx;
    }
  };
  const factory = { open: (_name, version) => {
    const request = {};
    setTimeout(() => {
      request.result = db;
      if (!hasStore || version > 2) request.onupgradeneeded?.({ oldVersion: hasStore ? 2 : 0 });
      request.onsuccess?.();
    }, 0);
    return request;
  } };
  return { factory, data, writes };
}

describe('Basic input-file delivery', () => {
  let oldIndexedDB;
  let dbHarness;

  beforeAll(async () => {
    renderDebateDom();
    document.body.classList.add('pipeline-page');
    await loadResultsScript();
    ['basic-input-files', 'basic-file-delivery'].forEach((module) => {
      window.eval(fs.readFileSync(path.join(__dirname, '..', 'disput', `${module}.js`), 'utf8'));
    });
    ['debate-response-acceptance', 'choice-dialog'].forEach((module) => {
      window.eval(fs.readFileSync(path.join(__dirname, '..', module === 'choice-dialog' ? 'results' : 'disput', `${module}.js`), 'utf8'));
    });
  });

  beforeEach(() => {
    dbHarness = indexedDBHarness();
    oldIndexedDB = Object.getOwnPropertyDescriptor(window, 'indexedDB');
    Object.defineProperty(window, 'indexedDB', { configurable: true, value: dbHarness.factory });
    window.BasicInputFiles.createStore();
    document.getElementById('notification-message').textContent = '';
  });

  afterEach(() => {
    if (oldIndexedDB) Object.defineProperty(window, 'indexedDB', oldIndexedDB);
    else delete window.indexedDB;
    window.__pipelineLifecycleDebug?.pipelineWaiter?.reset();
  });

  test('snapshot chat bindings preserve inputFileIds when omitted and clear them for a new chat', () => {
    const record = CustomRunRecord.createRun({ runId: 'input-file-bindings', steps: [{ ref: 'r1', kind: 'round', models: [{ name: 'GPT' }] }] });
    const schema = { steps: [{ ref: 'r1', kind: 'round', models: [{ name: 'GPT' }] }] };
    const snapshot = (chatBindings) => CustomRunRecord.setSnapshot(record, {
      schema,
      state: { pc: 'r1', visits: { r1: 1 }, results: [], chatBindings }
    });

    snapshot({ p: { modelName: 'GPT', chatVisit: 1, inputFileIds: ['file-a', 'file-b'] } });
    snapshot({ p: { modelName: 'GPT', chatVisit: 2 } });
    expect(record.snapshot.chatBindings.p.inputFileIds).toEqual(['file-a', 'file-b']);

    snapshot({ p: { modelName: 'GPT', chatVisit: 3, inputFileIds: [] } });
    expect(record.snapshot.chatBindings.p.inputFileIds).toEqual([]);
  });

  test('selects files by participant ID, not provider name, and adds only the current step files', () => {
    const common = descriptor('common', 'common.txt', 'common');
    const a = descriptor('a', 'same.txt', 'A');
    const b = descriptor('b', 'same.txt', 'B');
    const c = descriptor('c', 'claude.txt', 'C');
    const later = descriptor('later', 'later.txt', 'L');
    const steps = [
      { ref: 'r1', kind: 'round', files: [common], models: [
        { id: 'gpt-a', name: 'GPT', files: [a] },
        { id: 'gpt-b', name: 'GPT', files: [b] },
        { id: 'claude', name: 'Claude', files: [c] }
      ] },
      { ref: 'r2', kind: 'round', files: [later], models: [{ id: 'gpt-a', name: 'GPT' }] }
    ];
    const payloads = Object.fromEntries([common, a, b, c, later].map((item) => [item.id, inputFilePayload(item.name, item.content)]));
    const bindings = {};
    const delivery = window.BasicFileDelivery.create({ steps, payloads, bindings, isNewChat: () => true });
    const forA = delivery.pending({ participantId: 'gpt-a', stepRef: 'r1' });
    const forB = delivery.pending({ participantId: 'gpt-b', stepRef: 'r1' });
    const forClaude = delivery.pending({ participantId: 'claude', stepRef: 'r1' });
    expect(forA.files.map((item) => item.base64)).toEqual([transportDataUrl(inputFilePayload('common.txt', 'common')), transportDataUrl(inputFilePayload('same.txt', 'A'))]);
    expect(forB.files.map((item) => item.base64)).toEqual([transportDataUrl(inputFilePayload('common.txt', 'common')), transportDataUrl(inputFilePayload('same.txt', 'B'))]);
    expect(forClaude.files.map((item) => item.base64)).toEqual([transportDataUrl(inputFilePayload('common.txt', 'common')), transportDataUrl(inputFilePayload('claude.txt', 'C'))]);
    expect(delivery.pending({ participantId: 'gpt-a', stepRef: 'r2' }).files.map((item) => item.name)).toEqual(['later.txt']);
    expect(delivery.groups([
      { participantId: 'gpt-a', stepRef: 'r1' },
      { participantId: 'gpt-b', stepRef: 'r1' },
      { participantId: 'claude', stepRef: 'r1' }
    ], 'w0').map(([key, group]) => [key, group.map((item) => item.participantId)])).toEqual([
      ['w0f0', ['gpt-a']], ['w0f1', ['gpt-b']], ['w0f2', ['claude']]
    ]);
  });

  test('raw scoped payloads become valid Gemini data URLs without changing their bytes', () => {
    const source = descriptor('raw-gemini', 'evidence.txt', 'evidence');
    const delivery = window.BasicFileDelivery.create({
      steps: [{ ref: 'r1', kind: 'round', models: [{ id: 'gemini', name: 'Gemini', files: [source] }] }],
      payloads: { 'raw-gemini': inputFilePayload(source.name, source.content) },
      bindings: {}, isNewChat: () => true
    });
    const [sent] = delivery.pending({ participantId: 'gemini', stepRef: 'r1' }).files;
    expect(sent.base64).toMatch(/^data:text\/plain;base64,/);
    expect(Buffer.from(sent.base64.split(',')[1], 'base64').toString()).toBe('evidence');
  });

  test('a scoped raw payload matching a global data URL is sent once', () => {
    const source = descriptor('shared', 'same.txt', 'same');
    const global = { name: source.name, type: source.type, size: source.size, base64: 'data:text/plain;base64,c2FtZQ==' };
    const delivery = window.BasicFileDelivery.create({
      steps: [{ ref: 'r1', kind: 'round', models: [{ id: 'p', name: 'GPT', files: [source] }] }],
      globalFiles: [global], payloads: { shared: inputFilePayload(source.name, source.content) },
      bindings: {}, isNewChat: () => true
    });
    const pending = delivery.pending({ participantId: 'p', stepRef: 'r1' });
    expect(pending.files).toEqual([global]);
    expect(pending.files).toHaveLength(1);
    expect(Buffer.from(pending.files[0].base64.split(',')[1], 'base64').toString()).toBe('same');
  });

  test('only SUCCESS confirms input files for an existing chat; retry resends after failure and a new chat always resends', () => {
    const file = descriptor('f', 'input.txt', 'body');
    const steps = [{ ref: 'r1', kind: 'round', files: [file], models: [{ id: 'p', name: 'GPT' }] }];
    const payloads = { f: inputFilePayload(file.name, file.content) };
    const request = { participantId: 'p', stepRef: 'r1', attempt: 1 };
    const bindings = { p: { chatVisit: 1, attachedChatVisit: 1, inputFileIds: [] } };
    const delivery = window.BasicFileDelivery.create({ steps, payloads, bindings, isNewChat: (item) => item.attempt === 1 && item.chat === 'new' });
    const pending = delivery.pending(request);
    expect(pending.ids).toEqual(['f']);
    expect(delivery.confirmed(request, 'ERROR', pending)).toEqual([]);
    expect(delivery.pending({ ...request, attempt: 2 }).ids).toEqual(['f']);
    const confirmed = delivery.confirmed(request, 'SUCCESS', pending);
    bindings.p.inputFileIds = confirmed;
    expect(delivery.pending({ ...request, attempt: 2 }).ids).toEqual([]);
    expect(delivery.pending({ ...request, chat: 'new' }).ids).toEqual(['f']);
    expect(delivery.confirmed(request, 'FAILED', pending)).toEqual(['f']);
  });

  test('actual Basic run sends participant-specific files through the engine and reuses them on the next step chat', async () => {
    const storedDescriptor = (id, name, content) => {
      const item = descriptor(id, name, content);
      delete item.content;
      return item;
    };
    const sourceFiles = [
      ['shared', 'shared.txt', 'S'], ['gpt-a-file', 'same.txt', 'A'], ['gpt-b-file', 'same.txt', 'B'],
      ['claude-file', 'claude.txt', 'C'], ['later', 'later.txt', 'L']
    ];
    const fileStore = window.BasicInputFiles.createStore();
    for (const [id, name, text] of sourceFiles) await fileStore.put(new File([text], name, { type: 'text/plain' }), { id });
    const schema = {
      schemaVersion: 1, origin: 'user', run: { policy: 'auto' },
      steps: [
        { ref: 'r1', kind: 'round', files: [storedDescriptor('shared', 'shared.txt', 'S')], models: [
          { id: 'gpt-a', name: 'GPT', files: [storedDescriptor('gpt-a-file', 'same.txt', 'A')] },
          { id: 'gemini-b', name: 'Gemini', files: [storedDescriptor('gpt-b-file', 'same.txt', 'B')] },
          { id: 'claude', name: 'Claude', files: [storedDescriptor('claude-file', 'claude.txt', 'C')] }
        ] },
        { ref: 'r2', kind: 'round', files: [storedDescriptor('later', 'later.txt', 'L')], models: [
          { id: 'gpt-a', name: 'GPT' }
        ] }
      ]
    };
    const installed = await window.__pipelineLifecycleDebug.installBasicSchema('file delivery e2e', schema);
    expect(installed.ok).toBe(true);
    document.querySelector('.pipeline-item[data-name="file delivery e2e"]')?.click();
    await delay(80);
    document.getElementById('new-pages-checkbox').checked = true;
    const starts = [];
    chrome.runtime.sendMessage.mockImplementation((message, callback) => {
      if (message.type !== 'START_FULLPAGE_PROCESS') {
        callback?.({ status: 'ok', active: false, bindings: {} });
        return;
      }
      starts.push(message);
      callback?.({ status: 'process_started' });
      setTimeout(() => message.selectedLLMs.forEach((model) => window.__pipelineLifecycleDebug.pipelineWaiter.handleFinal({
        type: 'LLM_RESPONSE', llmName: model,
        transportRequestId: message.pipelineContext.transportRequestIds[model],
        answer: `Answer ${model}`,
        metadata: { ...message.pipelineContext, status: 'SUCCESS', attribution: 'verified', completion: 'complete' }
      })), 0);
    });
    const runResult = await window.__pipelineLifecycleDebug.runCustomFromPage({ task: 'Check attached inputs' });
    expect(runResult).toBe(true);
    expect(dbHarness.writes.filter((key) => Array.isArray(key) && key[0] === 'run')).toHaveLength(1);
    const sentInFirstStep = new Map();
    starts.forEach((message) => {
      const participant = Object.values(message.pipelineContext.participants)[0]?.participantId;
      if (message.pipelineContext.stageId?.includes('s1')) sentInFirstStep.set(participant, message.attachments.map((item) => item.base64));
    });
    expect(sentInFirstStep.get('gpt-a')).toEqual(['data:text/plain;base64,Uw==', 'data:text/plain;base64,QQ==']);
    expect(sentInFirstStep.get('gemini-b')).toEqual(['data:text/plain;base64,Uw==', 'data:text/plain;base64,Qg==']);
    expect(sentInFirstStep.get('claude')).toEqual(['data:text/plain;base64,Uw==', 'data:text/plain;base64,Qw==']);
    // r2's chat already contains r1's participant inputs, so only r2's new step file is sent.
    const later = starts.find((message) => Object.values(message.pipelineContext.participants).some((item) => item.participantId === 'gpt-a')
      && message.pipelineContext.stageId?.includes('s2'));
    expect(later.attachments.map((item) => item.base64)).toEqual(['data:text/plain;base64,TA==']);

    const runStore = window.CustomRunRecord.createStore({ storage: window.CustomRunRecord.chromeStorage(chrome.storage.local) });
    const savedRecord = await runStore.latest('file delivery e2e');
    const snapshot = dbHarness.data.get(JSON.stringify(['run', savedRecord.runId])).payloadMap;
    expect(snapshot['gpt-a-file'].base64).toBe('QQ==');
    expect(snapshot.later.base64).toBe('TA==');
    // Replacing the selected local bytes cannot alter the run's immutable snapshot.
    await fileStore.put(new File(['X'], 'later.txt', { type: 'text/plain' }), { id: 'later' });
    await fileStore.put(new File(['Y'], 'same.txt', { type: 'text/plain' }), { id: 'gpt-a-file' });
    expect((await fileStore.getRun(savedRecord.runId)).later.base64).toBe('TA==');

    // Resume from r2 in a new chat: the existing run snapshot supplies the original bytes even after the local IDB file changed.
    savedRecord.snapshot.pc = 'r2';
    savedRecord.snapshot.results = savedRecord.snapshot.results.filter((item) => item.stepRef === 'r1');
    savedRecord.snapshot.schema.steps[1].chat = 'new';
    // A continuation runs the steps the run was assembled with (plan 4.6): the same change goes there.
    savedRecord.snapshot.steps.find((step) => step.ref === 'r2').chat = 'new';
    const startCount = starts.length;
    await window.__pipelineLifecycleDebug.runCustomFromPage({ task: 'Check attached inputs', resumeRecord: savedRecord });
    const resumedStart = starts.slice(startCount).find((message) => message.pipelineContext.stageId?.includes('s2'));
    expect(resumedStart.attachments.map((item) => item.base64)).toEqual(['data:text/plain;base64,TA==']);
  }, 60000);

  test('a resumed run with a missing byte snapshot stops before any model dispatch', async () => {
    const file = descriptor('lost', 'lost.txt', 'bytes');
    const schema = { schemaVersion: 1, origin: 'user', steps: [{ ref: 'r1', kind: 'round', files: [file], models: [{ name: 'GPT' }] }] };
    const starts = [];
    chrome.runtime.sendMessage.mockImplementation((message, callback) => {
      if (message.type === 'START_FULLPAGE_PROCESS') starts.push(message);
      callback?.({ status: 'ok', active: false });
    });
    const result = await window.__pipelineLifecycleDebug.runCustomFromPage({ task: 'T', resumeRecord: {
      runId: 'missing-snapshot', attempts: [], attachments: [], snapshot: { schema, state: { pc: 'r1' } }
    } });
    expect(result).toBe(false);
    expect(starts).toHaveLength(0);
    expect(document.getElementById('notification-message').textContent).toContain('Сохранённые файлы этого прогона недоступны');
  });

  test('owner ask shows downloadable links for attached input files', async () => {
    const oldCreate = URL.createObjectURL;
    const oldRevoke = URL.revokeObjectURL;
    URL.createObjectURL = jest.fn(() => 'blob:basic-input-test');
    URL.revokeObjectURL = jest.fn();
    try {
      const pending = window.ChoiceDialog.ask({ title: 'Ответ User', inputFiles: [inputFilePayload('brief.txt', 'brief')], choices: [{ value: 'send', label: 'Отправить' }] });
      const link = document.querySelector('.choice-dialog-input-file');
      expect(link.textContent).toContain('brief.txt');
      expect(link.download).toBe('brief.txt');
      expect(link.href).toContain('blob:basic-input-test');
      document.querySelector('.choice-dialog-choice').click();
      await expect(pending).resolves.toBe('send');
    } finally {
      URL.createObjectURL = oldCreate;
      URL.revokeObjectURL = oldRevoke;
    }
  });

  test('core file resolution preserves hostile-looking IDs and trusts inline source content over stored bytes', async () => {
    const core = window.BasicInputFiles;
    const current = descriptor('__proto__', 'same.txt', 'new');
    const stored = new File(['old'], 'same.txt', { type: 'text/plain' });
    const get = jest.fn(async () => stored);
    const result = await core.resolve([{ ref: 'r1', kind: 'round', files: [current], models: [] }], { store: { get } });
    expect(Object.getPrototypeOf(result)).toBeNull();
    expect(Object.hasOwn(result, '__proto__')).toBe(true);
    expect(Buffer.from(result.__proto__.base64, 'base64').toString()).toBe('new');
    expect(get).not.toHaveBeenCalled();
    expect(() => core.createStore({ indexedDB: null })).toThrow(/IndexedDB недоступна/);
  });
});
