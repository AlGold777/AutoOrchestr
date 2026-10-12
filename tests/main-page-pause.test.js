const fs = require('fs');
const path = require('path');
const vm = require('vm');
const source = fs.readFileSync(path.join(__dirname, '..', 'results.js'), 'utf8');

function createPage(sendToBackground) {
  document.body.innerHTML = '<button id="start-button"><i class="ti ti-send"></i></button>';
  const button = document.getElementById('start-button');
  let click;
  button.addEventListener = (_type, handler) => { click = handler; };
  const context = {
    document, console, sendToBackground, setTimeout, clearTimeout,
    window: { TransportContract: { makeTransportRequestId: () => 'request' }, MessageDelivery: { prepare: () => ({ GPT: 'Q' }) } },
    pastedTextComposer: { getText: () => 'Q' },
    ensureNoOtherViewRun: async () => true,
    applySelectedModifiersToPrompt: value => value,
    getSelectedLLMs: () => ['GPT'], getCurrentViewKey: () => 'main',
    mainRunActive: false,
    buildAttachmentPayload: async () => [],
    newPagesCheckbox: null, apiModeCheckbox: null, longModeCheckbox: null,
    lastGenerationWaitProfile: '', ATTACH_CAPABILITY: {}, getItButton: null,
    clearModelStatusMemory: jest.fn(), updateModelStatusUI: jest.fn(),
    syncProStreamVisibility: jest.fn(), resetPromptInputSize: jest.fn(), clearPromptAttachments: jest.fn(),
    showNotification: jest.fn()
  };
  context.replaceCurrentMainRequestIds = jest.fn(requestIds => { context.currentMainRequestIds = { ...requestIds }; });
  context.markCurrentMainRequestsCancelled = jest.fn();
  vm.createContext(context);
  const controlsStart = source.indexOf("const startButton = document.getElementById('start-button');");
  const controlsEnd = source.indexOf('const promptInput =', controlsStart);
  vm.runInContext(source.slice(controlsStart, controlsEnd), context);
  const handlerStart = source.indexOf("startButton?.addEventListener('click', async () => {");
  const handlerEnd = source.indexOf('// Get it for any page:', handlerStart);
  vm.runInContext(source.slice(handlerStart, handlerEnd), context);
  return { button, context, click };
}

const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };

test('Stop cancels an unfinished start, restores Start, and a late old reply cannot disturb the next request', async () => {
  const releases = [];
  const send = jest.fn(message => message.type === 'STOP_ALL'
    ? Promise.resolve({ success: true })
    : new Promise(resolve => releases.push(resolve)));
  const { button, context, click } = createPage(send);
  const first = click();
  await flush();
  expect(context.currentMainRequestIds).toEqual({ GPT: 'request' });
  expect(button.getAttribute('aria-label')).toBe('Стоп');
  expect(button.querySelector('i').className).toBe('ti ti-player-stop');
  context.pastedTextComposer.getText = () => '';
  await click();
  expect(send).toHaveBeenCalledWith({ type: 'STOP_ALL' });
  expect(context.markCurrentMainRequestsCancelled).toHaveBeenCalledTimes(1);
  expect(button.disabled).toBe(false);
  expect(button.getAttribute('aria-label')).toBe('Пуск');
  context.pastedTextComposer.getText = () => 'Next request';
  const second = click();
  await flush();
  expect(releases).toHaveLength(2);
  releases[0]({ status: 'process_started' });
  await first;
  expect(button.getAttribute('aria-label')).toBe('Стоп');
  expect(button.querySelector('i').className).toBe('ti ti-player-stop');
  expect(context.clearPromptAttachments).not.toHaveBeenCalled();
  releases[1]({ status: 'process_started' });
  await second;
  expect(context.clearPromptAttachments).toHaveBeenCalledTimes(1);
});

test('a failed stop reports the background error and stays available for retry', async () => {
  const { button, context, click } = createPage(async message => message.type === 'STOP_ALL'
    ? { success: false, error: 'Stop cleanup failed' } : { status: 'process_started' });
  await click();
  await click();
  expect(button.disabled).toBe(false);
  expect(button.getAttribute('aria-label')).toBe('Стоп');
  expect(button.querySelector('i').className).toBe('ti ti-player-stop');
  expect(context.showNotification).toHaveBeenCalledWith('Stop cleanup failed', 'error');
  expect(context.markCurrentMainRequestsCancelled).not.toHaveBeenCalled();
});

test('a lost Stop response reconciles an inactive worker and the next prompt still starts', async () => {
  const send = jest.fn(async message => {
    if (message.type === 'STOP_ALL') throw new Error('The message port closed before a response was received.');
    if (message.type === 'GET_ACTIVE_RUN_STATE') return { status: 'ok', active: false };
    return { status: 'process_started' };
  });
  const { button, context, click } = createPage(send);
  await click();
  await click();
  expect(button.getAttribute('aria-label')).toBe('Пуск');
  expect(button.disabled).toBe(false);
  expect(context.markCurrentMainRequestsCancelled).toHaveBeenCalledTimes(1);
  expect(context.showNotification).not.toHaveBeenCalled();
  context.pastedTextComposer.getText = () => 'Next request';
  await click();
  expect(send.mock.calls.filter(([message]) => message.type === 'START_FULLPAGE_PROCESS')).toHaveLength(2);
  expect(button.getAttribute('aria-label')).toBe('Стоп');
});

test('a lost Stop response cannot unlock Start while the worker is still active', async () => {
  const { button, context, click } = createPage(async message => {
    if (message.type === 'STOP_ALL') throw new Error('port closed');
    if (message.type === 'GET_ACTIVE_RUN_STATE') return { status: 'ok', active: true };
    return { status: 'process_started' };
  });
  await click();await click();
  expect(button.getAttribute('aria-label')).toBe('Стоп');
  expect(button.disabled).toBe(false);
  expect(context.markCurrentMainRequestsCancelled).not.toHaveBeenCalled();
});

test('a silent Stop response has a bounded wait and checks actual worker state', async () => {
  jest.useFakeTimers();
  try {
    const { button, click } = createPage(async message => {
      if (message.type === 'STOP_ALL') return new Promise(() => {});
      if (message.type === 'GET_ACTIVE_RUN_STATE') return { status: 'ok', active: false };
      return { status: 'process_started' };
    });
    await click();const stopping = click();
    expect(button.disabled).toBe(true);
    await jest.advanceTimersByTimeAsync(2500);await stopping;
    expect(button.getAttribute('aria-label')).toBe('Пуск');
    expect(button.disabled).toBe(false);
  } finally { jest.useRealTimers(); }
});

test('an inactive stale session is not confirmation that Stop completed', async () => {
  const { button, context, click } = createPage(async message => {
    if (message.type === 'STOP_ALL') throw new Error('port closed');
    if (message.type === 'GET_ACTIVE_RUN_STATE') return { status: 'ok', active: false, sessionId: 123, staleActiveRun: true };
    return { status: 'process_started' };
  });
  await click();await click();
  expect(button.getAttribute('aria-label')).toBe('Стоп');
  expect(button.disabled).toBe(false);
  expect(context.markCurrentMainRequestsCancelled).not.toHaveBeenCalled();
});

test('silent Stop and state replies release the button for retry without enabling a new run', async () => {
  jest.useFakeTimers();
  try {
    const { button, context, click } = createPage(async message => message.type === 'START_FULLPAGE_PROCESS'
      ? { status: 'process_started' } : new Promise(() => {}));
    await click();const stopping = click();
    await jest.advanceTimersByTimeAsync(5000);await stopping;
    expect(button.getAttribute('aria-label')).toBe('Стоп');
    expect(button.disabled).toBe(false);
    expect(context.markCurrentMainRequestsCancelled).not.toHaveBeenCalled();
    expect(context.showNotification).toHaveBeenCalled();
  } finally { jest.useRealTimers(); }
});
