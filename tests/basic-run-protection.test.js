/** @jest-environment node */
// A run survives the owner's own actions: closing a tab and leaving the pipeline page.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
const ROUTER = read('background/message-router.js');
const RESULTS = read('results.js');

function between(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);
  if (start < 0 || end < 0) throw new Error(`marker not found: ${startMarker}`);
  return source.slice(start, end);
}

// Runs the real onRemoved listener of the background and returns the reasons it stopped the run for.
function closeTab(tabId, { map = {}, session = { pipelineRunId: 'run-1' } } = {}) {
  let listener;
  const stops = [];
  const context = {
    chrome: { tabs: { onRemoved: { addListener: (fn) => { listener = fn; } }, sendMessage: () => Promise.resolve() } },
    TabMapManager: {
      entries: () => Object.entries(map),
      getNameByTabId: (id) => Object.keys(map).find((name) => map[name] === id) || null,
      removeByName() {}
    },
    jobState: { session, llms: Object.fromEntries(Object.entries(map).map(([name, id]) => [name, { tabId: id }])) },
    pendingPings: new Map(), pendingPingByTabId: new Map(), healthCheckFailuresByTabId: new Map(),
    lastHealthCheckReportAtByTabId: new Map(), llmActivityMap: {}, evaluatorTabId: null, resultsTabId: 1,
    closePingWindowForTab() {}, removeActiveListenerForTab() {}, isTerminalRouterEntry: () => false,
    emitTelemetry() {}, clearDeferredAnswerTimer() {}, handleLLMResponse: jest.fn(), cleanupTabResources() {}
  };
  context.self = { setTabBinding: async () => {}, stopAllProcesses: (reason) => stops.push(reason) };
  vm.createContext(context);
  vm.runInContext(between(ROUTER, 'chrome.tabs.onRemoved.addListener(', 'const OPENAI_STATIC_IMAGE_MAX_BYTES'), context);
  listener(tabId, { isWindowClosing: false });
  return { stops, handled: context.handleLLMResponse };
}

describe('closing a tab', () => {
  test('a tab that is not a model tab never stops anything', () => {
    expect(closeTab(99).stops).toEqual([]);
    expect(closeTab(99, { session: null }).stops).toEqual([]);
  });

  test('the only model tab of a pipeline run: the model gets its error, the run goes on', () => {
    const { stops, handled } = closeTab(11, { map: { Claude: 11 } });
    expect(handled).toHaveBeenCalledWith('Claude', '', { type: 'tab_closed_prematurely' });
    expect(stops).toEqual([]);
  });

  test('outside a pipeline run the last model tab still ends the processes', () => {
    expect(closeTab(11, { map: { Claude: 11 }, session: {} }).stops).toEqual(['no_llm_tabs']);
  });

  test('closing the pipeline page still stops the run', () => {
    expect(closeTab(1, { map: { Claude: 11 } }).stops).toEqual(['results_tab_closed']);
  });
});

describe('leaving the pipeline page', () => {
  const guard = between(RESULTS, "window.addEventListener('beforeunload', (event) => {\n        if (!pipelineRunActive)", 'const debateApprovalBridge');
  const leave = (pipelineRunActive) => {
    let handler;
    const context = { window: { addEventListener: (_type, fn) => { handler = fn; } }, pipelineRunActive, crossViewNavigationSaved: true };
    vm.createContext(context);
    vm.runInContext(guard, context);
    const event = { preventDefault: jest.fn(), returnValue: undefined };
    handler(event);
    return { event, context };
  };

  test('during a run the browser asks first, and the view state is saved again on the next leave', () => {
    const { event, context } = leave(true);
    expect(event.preventDefault).toHaveBeenCalled();
    expect(event.returnValue).toBe('');
    expect(context.crossViewNavigationSaved).toBe(false);
  });

  test('without a run the page is left without a question', () => {
    const { event, context } = leave(false);
    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(context.crossViewNavigationSaved).toBe(true);
  });
});
