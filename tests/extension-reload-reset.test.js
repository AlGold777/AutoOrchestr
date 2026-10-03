const fs = require('fs');
const path = require('path');

const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

describe('extension reload state reset', () => {
  test('extension update never mass-reloads provider tabs', () => {
    const lifecycleSource = read('background/lifecycle-runtime.js');
    const updateHandler = lifecycleSource.slice(
      lifecycleSource.indexOf('chrome.runtime.onInstalled.addListener'),
      lifecycleSource.indexOf('chrome.tabs.onUpdated.addListener')
    );
    expect(updateHandler).toContain('provider tabs will recover lazily');
    expect(updateHandler).not.toContain('chrome.tabs.reload');
    expect(updateHandler).not.toContain('chrome.tabs.query');
    expect(updateHandler).not.toContain("'llmTabMap'");
  });

  test('state hydration waits for the runtime-epoch cleanup barrier', () => {
    const indexSource = read('background/index.js');
    const routerSource = read('background/message-router.js');

    expect(indexSource).toContain('self.__extensionLifecycleReady = new Promise');
    expect(indexSource).toContain("const EXTENSION_RUNTIME_EPOCH_KEY = '__llm_extension_runtime_epoch_v1'");
    expect(indexSource).toContain("'llmComparatorSelectedModelsByView.main'");
    expect(indexSource).toContain("'llmComparatorSelectedModelsByView.pipeline'");
    expect(indexSource).toContain("'llmComparatorCrossViewUiState'");
    expect(indexSource).toContain("'llm_saved_sessions_v1'");
    expect(indexSource).toContain("resetVolatileRuntime('new_extension_runtime')");
    expect(indexSource).toContain("settleNormalStart('worker_wake')");
    expect(indexSource).toMatch(/resetVolatileRuntime = \(reason\) => \{[\s\S]{0,320}clearTimeout\(normalStartTimer\)/);
    expect(indexSource).toMatch(/onInstalled\.addListener[\s\S]*details\?\.reason !== 'update'/);
    expect(indexSource).toContain('chrome.storage.local.remove(\n        EXTENSION_VOLATILE_LOCAL_KEYS');
    expect(indexSource).toContain('chrome.storage.session.clear');
    expect(routerSource).toMatch(/await self\.__extensionLifecycleReady;[\s\S]*await Promise\.all\(\[loadJobState\(\), TabMapManager\.load\(\)\]\)/);
  });

  test('results registration reconciles an authoritative snapshot', () => {
    const routerSource = read('background/message-router.js');
    const resultsSource = read('results.js');

    expect(routerSource).toMatch(/case 'REGISTER_RESULTS_TAB':[\s\S]*state: buildGlobalStateSnapshot\(\{ includeAnswers: true \}\)/);
    expect(routerSource).toContain('runtimeReset');
    expect(resultsSource).toContain('function clearLiveResponseCards()');
    expect(resultsSource).toContain('const pageWasReloaded = isPageReloadNavigation();');
    expect(resultsSource).toContain("if (pageWasReloaded || response?.runtimeReset === true || !hasLiveSnapshot) {");
    expect(resultsSource).toContain("const reconciliationState = pageWasReloaded || response?.runtimeReset === true");
    expect(resultsSource).toContain(': (response?.state || {});');
    expect(resultsSource).toContain('syncStatusFromGlobalState(reconciliationState, { replace: true });');
    expect(resultsSource).not.toContain('syncStatusFromGlobalState(pageWasReloaded ? {}');
    expect(resultsSource).toContain('clearLiveResponseCards();');
    expect(resultsSource).toContain('applyModelButtonSelection([]);');
    expect(resultsSource).toContain("new CustomEvent('extension-runtime-reset'");
    expect(resultsSource).toContain('resetLiveStatusIndicators();');
    expect(resultsSource).toContain("detail: { source: 'extension_reload_reconcile' }");
  });

  test('page reload cancels the producer and drains old writes before registration responds', async () => {
    const source = read('background/message-router.js');
    const block = source.slice(source.indexOf("case 'REGISTER_RESULTS_TAB':"), source.indexOf("case 'REQUEST_SELECTOR_VERSION_STATUS':"));
    let releaseWrite;
    const writeFlight = new Promise(resolve => { releaseWrite = resolve; });
    const calls = [];
    let state = { llms: { GPT: { answer: 'previous session' } } };
    let reply;
    const completion = new Promise(resolve => { reply = resolve; });
    const context = {
      message: { type: 'REGISTER_RESULTS_TAB', resetSession: true }, sender: { tab: { id: 5 } },
      sendResponse: jest.fn(reply), isAppUiTab: () => true,
      stopAllProcesses: jest.fn(() => { state = {}; calls.push('stop'); }),
      jobState: {}, self: {}, jobStateSaveFlight: writeFlight,
      TabMapManager: { clear: async () => { calls.push('tabs'); } },
      CompressedStorage: { remove: async () => { calls.push('remove'); } },
      clearLateAnswerSnapshotCache: async () => {},
      writeDiagnosticsEventsToStorage: async () => {}, clearDiagnosticsRuntimeLogs: () => {},
      chrome: { storage: { local: { remove: async () => {} }, session: { remove: async () => {} } } },
      buildGlobalStateSnapshot: () => state, resultsTabId: null
    };
    const run = new Function(...Object.keys(context), `switch (message.type) { ${block} }`);
    expect(run(...Object.values(context))).toBe(true);
    expect(context.stopAllProcesses).toHaveBeenCalledWith('page_reload', { closeTabs: false });
    expect(context.sendResponse).not.toHaveBeenCalled();
    expect(calls).toEqual(['stop']);
    releaseWrite();
    await expect(completion).resolves.toMatchObject({ sessionReset: true, state: {} });
    expect(calls).toEqual(['stop', 'tabs', 'remove']);
  });

  test('telemetry UI drops its in-page cache on runtime reset', () => {
    const devtoolsSource = read('results-devtools.js');
    expect(devtoolsSource).toContain("document.addEventListener('extension-runtime-reset'");
    expect(devtoolsSource).toContain('telemetryCache = [];');
    expect(devtoolsSource).toContain('telemetryEventKeys = new Set();');
  });

  test('an old no-receiver callback cannot replay an answer after session reset', () => {
    const vm = require('vm');
    const source = read('background/ui-broadcast.js');
    const block = source.slice(source.indexOf('function sendMessageToResultsTab('), source.indexOf('function focusResultsTab('));
    let acknowledge;
    const context = {
      jobStateStopGeneration: 1, resultsTabId: 5, console,
      chrome: {
        tabs: { sendMessage: jest.fn((_, message, callback) => { acknowledge = callback; }) },
        runtime: { sendMessage: jest.fn(), lastError: { message: 'Receiving end does not exist' } }
      }
    };
    vm.createContext(context);
    vm.runInContext(block, context);
    context.sendMessageToResultsTab({ type: 'LLM_PARTIAL_RESPONSE', answer: 'old answer' });
    context.jobStateStopGeneration += 1;
    acknowledge();
    expect(context.chrome.runtime.sendMessage).not.toHaveBeenCalled();
    expect(context.resultsTabId).toBe(5);
  });

  test('saved sessions clear from memory when runtime reset races sidebar loading', () => {
    const resultsSource = read('results.js');
    expect(resultsSource).toContain('let extensionRuntimeResetObserved = false;');
    expect(resultsSource).toContain('const resetSessionsAfterExtensionRuntimeReset = async () =>');
    expect(resultsSource).toContain("document.addEventListener('extension-runtime-reset'");
    expect(resultsSource).toContain('if (extensionRuntimeResetObserved) {');
    expect(resultsSource).toContain('sessionsState.sessions = [];');
  });

  test('both session imports focus the first imported session', () => {
    const resultsSource = read('results.js');
    expect(resultsSource).toContain('switchSidebarSessionView(normalizedSessions[0].id)');
    expect(resultsSource).toContain('switchSidebarSessionView(addedSessions[0].id)');
  });
});
