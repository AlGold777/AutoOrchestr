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
    expect(resultsSource).toContain("const reconciliationState = response?.runtimeReset === true");
    expect(resultsSource).toContain(': (response?.state || {});');
    expect(resultsSource).toContain('syncStatusFromGlobalState(reconciliationState, { replace: true });');
    expect(resultsSource).not.toContain('syncStatusFromGlobalState(pageWasReloaded ? {}');
    expect(resultsSource).toContain('clearLiveResponseCards();');
    expect(resultsSource).toContain('applyModelButtonSelection([]);');
    expect(resultsSource).toContain("new CustomEvent('extension-runtime-reset'");
    expect(resultsSource).toContain('resetLiveStatusIndicators();');
    expect(resultsSource).toContain("detail: { source: 'extension_reload_reconcile' }");
  });

  test('telemetry UI drops its in-page cache on runtime reset', () => {
    const devtoolsSource = read('results-devtools.js');
    expect(devtoolsSource).toContain("document.addEventListener('extension-runtime-reset'");
    expect(devtoolsSource).toContain('telemetryCache = [];');
    expect(devtoolsSource).toContain('telemetryEventKeys = new Set();');
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
