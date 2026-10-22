const fs = require('fs');
const vm = require('vm');
const read = file => fs.readFileSync(require.resolve(`../${file}`), 'utf8');
const handler = read('content-scripts/attachment-handler.js');
const bridge = read('content-scripts/content-bridge.js');
const gpt = read('content-scripts/content-chatgpt.js');
const dispatch = read('background/dispatch-coordinator.js');
const PipelineFSM = require('../shared/pipeline-fsm');
const files = Array.from({ length: 9 }, (_, index) => {
  const size = index === 8 ? 21000 : 21500; // 193 kB in total.
  return { name: `document-${index}.txt`, type: 'text/plain', base64: `data:text/plain;base64,${Buffer.alloc(size, 120).toString('base64')}` };
});

beforeEach(() => {
  jest.useFakeTimers();
  delete window.AttachmentHandler;
  window.ContentUtils = { ensureMainWorldBridge: async () => false, reportDispatchStage: jest.fn() };
  Object.defineProperty(document.body, 'innerText', { configurable: true, get() { return this.textContent; } });
  document.body.innerHTML = '<input id="image" type="file" accept="image/*" multiple><input id="documents" type="file" multiple>';
});
afterEach(() => { jest.useRealTimers(); delete window.AttachmentHandler; delete window.ContentUtils; });

function inputs() {
  for (const input of document.querySelectorAll('input')) Object.defineProperty(input, 'files', { value: [], writable: true });
  const docs = document.getElementById('documents');
  docs.addEventListener('change', () => {
    const chips = document.createElement('div');
    chips.textContent = docs.files.map(file => file.name).join(' ');
    document.body.append(chips);
  });
  return docs;
}
function transfer() {
  const result = [];
  return { files: result, items: { add: file => result.push(file) } };
}

test('all nine 193 kB files reach the compatible native input and are observed before success', async () => {
  const docs = inputs();
  const prior = window.DataTransfer;
  window.DataTransfer = function() { return transfer(); };
  window.eval(handler);
  try {
    const pending = window.AttachmentHandler.attach('GPT', files, {
      strategies: ['input'], timeoutMs: 1000, pollMs: 25, settleMs: 100,
      scaleTimeoutByFileCount: false, attachSelectors: []
    });
    await jest.advanceTimersByTimeAsync(4000);
    expect(await pending).toMatchObject({ success: true, uploadedCount: 9 });
    expect(docs.files).toHaveLength(9);
    expect(docs.files.reduce((sum, file) => sum + file.size, 0)).toBe(193000);
    expect(document.getElementById('image').files).toHaveLength(0);
    expect(window.ContentUtils.reportDispatchStage).toHaveBeenCalledWith('GPT', {}, 'attachment_upload_completed', {
      outcome: 'confirmed', attachmentCount: 9, uploadedCount: 9
    });
  } finally { window.DataTransfer = prior; }
});

test('main-world bridge chooses a batch-compatible input instead of the first image input', () => {
  const docs = inputs();
  const start = bridge.indexOf('  const acceptsAttachmentFiles');
  const end = bridge.indexOf("  window.addEventListener('EXT_ATTACH'", start);
  const inputStart = bridge.indexOf('      const tryInput = () => {');
  const inputEnd = bridge.indexOf('      const tryPaste', inputStart);
  const fn = new Function('d', 'dt', 'files', 'shadowRoots', 'findFirst',
    `${bridge.slice(start, end)}\n${bridge.slice(inputStart, inputEnd)}\nreturn tryInput();`);
  const nativeFiles = files.map(item => new File(['text'], item.name, { type: item.type }));
  expect(fn({ inputSelectors: ['input[accept*="image"]', 'input[type="file"]'] }, { files: nativeFiles }, nativeFiles, [], () => null)).toBe(true);
  expect(docs.files).toHaveLength(9);
  expect(document.getElementById('image').files).toHaveLength(0);
});

test('one invalid attachment cannot silently reduce a nine-file batch', async () => {
  window.eval(handler);
  const batch = files.map(item => ({ ...item }));
  delete batch[4].base64;
  await expect(window.AttachmentHandler.attach('GPT', batch)).resolves.toMatchObject({
    success: false, reason: 'INCOMPLETE_FILE_BATCH'
  });
});

function gptAttachmentGate(attachments) {
  const start = gpt.indexOf('        if (Array.isArray(attachments) && attachments.length)');
  const end = gpt.indexOf('        const resolveLiveComposer', start);
  const AsyncFunction = Object.getPrototypeOf(async function(){}).constructor;
  return new AsyncFunction('attachments', 'MODEL', 'sleep', 'emitDiagnostic', 'dispatchMeta',
    `${gpt.slice(start, end)}\nreturn 'ready_to_prepare_prompt';`)(attachments, 'GPT', async () => {}, jest.fn(), { dispatchId: 'GPT:1:1' });
}

test('missing GPT handler blocks the prompt instead of trusting synthetic paste', async () => {
  await expect(gptAttachmentGate(files)).rejects.toMatchObject({ type: 'attachment_failed' });
});
test('GPT uses a handler loaded after the adapter and requires confirmation of all nine files', async () => {
  window.AttachmentHandler = { attach: jest.fn(async () => ({ success: true, uploadedCount: 9 })) };
  await expect(gptAttachmentGate(files)).resolves.toBe('ready_to_prepare_prompt');
  window.AttachmentHandler.attach.mockResolvedValue({ success: true, uploadedCount: 1 });
  await expect(gptAttachmentGate(files)).rejects.toMatchObject({ type: 'attachment_failed' });
});

test('attachment runtime is restored before a command, with a bounded failure if injection hangs', async () => {
  const start = dispatch.indexOf('async function ensureAttachmentHandlerForDispatch');
  const end = dispatch.indexOf('async function dispatchSimpleFirstPass', start);
  const executeScript = jest.fn(async () => []);
  const context = { chrome: { scripting: { executeScript } }, setTimeout, clearTimeout };
  vm.createContext(context); vm.runInContext(dispatch.slice(start, end), context);
  await context.ensureAttachmentHandlerForDispatch(123, files);
  expect(executeScript).toHaveBeenCalledWith(expect.objectContaining({
    target: { tabId: 123 }, files: ['content-scripts/attachment-handler.js'], injectImmediately: true
  }));
  executeScript.mockImplementation(() => new Promise(() => {}));
  const pending = context.ensureAttachmentHandlerForDispatch(123, files);
  const rejection = expect(pending).rejects.toMatchObject({ type: 'attachment_failed' });
  await jest.advanceTimersByTimeAsync(5000);
  await rejection;
  expect(jest.getTimerCount()).toBe(0);
});


test('save and worker restore preserve every byte of the nine-file batch before hydration', async () => {
  const orch = read('background/job-orchestrator.js');
  let stored;
  const context = { console, jobState: {},
    CompressedStorage: { set: async (_, value) => { stored = JSON.parse(JSON.stringify(value)); }, get: async () => JSON.parse(JSON.stringify(stored)) },
    updateMv3SurvivalAlarm: jest.fn(), rehydrateActiveJobRuntime: jest.fn(), broadcastHumanVisitStatus: jest.fn(),
    DispatchIntentStore: { restore: async () => {} },
    PipelineFSM: { compactJobStateForStorage: PipelineFSM.compactJobStateForStorage, hydrateJobState: PipelineFSM.hydrateJobState, loadControlState: async () => null }
  };
  context.self = context;
  vm.createContext(context);
  vm.runInContext(orch.slice(orch.indexOf('async function persistJobStateSnapshot'), orch.indexOf('function getActivePipelineControlState')), context);
  await context.persistJobStateSnapshot({ session: { startTime: 1 }, llms: {}, attachments: files });
  await context.loadJobState();
  expect(context.jobState.attachments).toEqual(files);
  window.eval(handler);
  const hydrated = window.AttachmentHandler.hydrateAttachments(context.jobState.attachments);
  expect(hydrated).toHaveLength(9);
  expect(hydrated.reduce((sum, file) => sum + file.size, 0)).toBe(193000);
});
