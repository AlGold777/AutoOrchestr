const fs = require('fs');
const path = require('path');

const RESULTS_SRC = fs.readFileSync(path.join(__dirname, '..', 'results.js'), 'utf8');
const BOOT_UTILS_SRC = fs.readFileSync(path.join(__dirname, '..', 'results', 'boot-utils.js'), 'utf8');
const ROUTER_SRC = fs.readFileSync(path.join(__dirname, '..', 'background', 'message-router.js'), 'utf8');

const installBootUtils = () => {
  delete window.ResultsBootUtils;
  jest.resetModules();
  require('../results/boot-utils');
  return window.ResultsBootUtils;
};

const extractArrowFunction = (source, declaration) => {
  const start = source.indexOf(declaration);
  if (start < 0) throw new Error(`Function not found: ${declaration}`);
  const arrow = source.indexOf('=>', start);
  const open = source.indexOf('{', arrow + 2);
  let depth = 0;
  for (let index = open; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1;
    else if (source[index] === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(start, index + 1);
    }
  }
  throw new Error(`Unclosed function: ${declaration}`);
};

const makeCrossViewPersistFromSource = ({ workingSessionStartedAt, safeStorageLocalGet, safeStorageLocalSet }) => {
  const declaration = extractArrowFunction(RESULTS_SRC, 'const persistCrossViewUiState = () => {');
  const create = new Function(
    'getCurrentViewKey', 'collectCurrentViewUiState', 'collectSharedUiState', 'document',
    'safeStorageLocalGet', 'normalizeCrossViewUiState', 'workingSessionStartedAt', 'crossViewUiStateKey',
    'safeStorageLocalSet',
    `let crossViewUiPersistQueue = Promise.resolve();\nlet crossViewUiPersistTimer = null;\n${declaration}\nreturn persistCrossViewUiState;`
  );
  return create(
    () => 'pipeline',
    () => ({ promptText: 'current draft' }),
    () => ({ outputs: { outputGPT: 'current output' } }),
    { querySelector: () => null },
    safeStorageLocalGet,
    (state) => state
      ? ({ ...state, views: state?.views || {}, shared: state?.shared || {} })
      : ({ views: { main: {}, pipeline: {} }, shared: {} }),
    workingSessionStartedAt,
    'llmComparatorCrossViewUiState',
    safeStorageLocalSet
  );
};

const makeApplyCrossViewUiStateFromSource = ({ notifySelectionChanged, clearLiveFeed, restorePrompt, syncModeratorSelectors }) => {
  const declaration = extractArrowFunction(RESULTS_SRC, 'const applyCrossViewUiState = (rawState = null) => {');
  const run = new Function(
    'normalizeCrossViewUiState', 'workingSessionStartedAt', 'getCurrentViewKey',
    'safeStorageLocalSet', 'crossViewUiStateKey', 'document', 'promptInput',
    'pastedTextComposer', 'preserveCrossViewStateOnLoad', 'pipelineViewDraftHandlers',
    'replaceChildrenFromSanitizedHtml', 'sanitizeInlineHtml', 'currentModifierPresetId',
    'selectedModifierIds', 'clearModifierOverrides', 'modifierCustomText',
    'checkCompareButtonState', 'renderDiagnosticsModal', 'notifySelectionChanged',
    'syncModeratorSelectors', 'isPageReloadNavigation', 'syncModeratorMiniPrompts',
    `${declaration}\nreturn applyCrossViewUiState;`
  );
  return run(
    (state) => ({
      workingSessionStartedAt: Number(state?.workingSessionStartedAt) || 0,
      views: state?.views || { main: {}, pipeline: {} },
      shared: state?.shared || {}
    }),
    77,
    () => 'main',
    jest.fn(async () => true),
    'llmComparatorCrossViewUiState',
    { getElementById: jest.fn(() => null), querySelectorAll: jest.fn(() => []), body: { classList: { contains: jest.fn(() => false) } } },
    {},
    { restoreSnapshot: restorePrompt },
    false,
    null,
    jest.fn(),
    jest.fn((value) => value),
    '',
    [],
    jest.fn(),
    {},
    jest.fn(),
    jest.fn(),
    (...args) => { notifySelectionChanged(...args); clearLiveFeed(); },
    syncModeratorSelectors,
    () => false,
    jest.fn()
  );
};

describe('working session reload reset', () => {
  const originalGetEntriesDescriptor = Object.getOwnPropertyDescriptor(performance, 'getEntriesByType');
  const startedAtKey = 'llmComparatorWorkingSessionStartedAt';
  let boot;

  beforeEach(() => {
    chrome.runtime.sendMessage.mockReset();
    chrome.runtime.lastError = null;
    chrome.storage.local._store.clear();
    chrome.storage.local.get = jest.fn((key, callback) => {
      const value = chrome.storage.local._store.get(key);
      if (typeof callback === 'function') callback({ [key]: value });
      else return Promise.resolve({ [key]: value });
    });
    Object.defineProperty(performance, 'getEntriesByType', {
      configurable: true,
      value: () => [{ type: 'navigate' }]
    });
    boot = installBootUtils();
  });

  afterAll(() => {
    if (originalGetEntriesDescriptor) Object.defineProperty(performance, 'getEntriesByType', originalGetEntriesDescriptor);
    else delete performance.getEntriesByType;
  });

  test('a normal page load reads the current start time without resetting the working session', async () => {
    chrome.storage.local._store.set(startedAtKey, 1234);

    await expect(boot.prepareWorkingSession()).resolves.toEqual({ startedAt: 1234 });

    expect(BOOT_UTILS_SRC).toContain("storage.get('llmComparatorWorkingSessionStartedAt'");
    expect(chrome.runtime.sendMessage).not.toHaveBeenCalled();
  });

  test('reload waits for the reset acknowledgement before returning the new cutoff', async () => {
    Object.defineProperty(performance, 'getEntriesByType', {
      configurable: true,
      value: () => [{ type: 'reload' }]
    });
    let acknowledge;
    chrome.runtime.sendMessage.mockImplementation((message, callback) => {
      acknowledge = callback;
    });
    let settled = false;
    const pending = boot.prepareWorkingSession().then((value) => {
      settled = true;
      return value;
    });

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(
      { type: 'RESET_WORKING_SESSION', reason: 'page_reload' },
      expect.any(Function)
    );
    expect(settled).toBe(false);

    acknowledge({ success: true, startedAt: 5678 });
    await expect(pending).resolves.toEqual({ startedAt: 5678 });
  });

  test('a failed reload reset rejects rather than claiming an empty working session', async () => {
    Object.defineProperty(performance, 'getEntriesByType', {
      configurable: true,
      value: () => [{ type: 'reload' }]
    });
    chrome.runtime.sendMessage.mockImplementation((_message, callback) => callback({ success: false, error: 'reset_failed' }));

    await expect(boot.prepareWorkingSession()).rejects.toThrow();
  });

  test('an old background worker gives a reload instruction when it does not know the reset message', async () => {
    Object.defineProperty(performance, 'getEntriesByType', {
      configurable: true,
      value: () => [{ type: 'reload' }]
    });
    chrome.runtime.sendMessage.mockImplementation((_message, callback) => callback({
      success: false,
      status: 'unknown_message'
    }));

    await expect(boot.prepareWorkingSession()).rejects.toThrow(
      'Фоновый процесс расширения ещё не обновлён. Выполните chrome://extensions → Reload, затем обновите страницу.'
    );
  });

  test('malformed reload acknowledgements reject instead of reporting a successful reset', async () => {
    Object.defineProperty(performance, 'getEntriesByType', {
      configurable: true,
      value: () => [{ type: 'reload' }]
    });
    chrome.runtime.sendMessage.mockImplementation((_message, callback) => callback({ success: true }));

    await expect(boot.prepareWorkingSession()).rejects.toThrow(
      'Фоновый процесс не подтвердил очистку. Выполните chrome://extensions → Reload, затем обновите страницу.'
    );
  });

  test('an explicit background reset error is preserved in the rejected result', async () => {
    Object.defineProperty(performance, 'getEntriesByType', {
      configurable: true,
      value: () => [{ type: 'reload' }]
    });
    chrome.runtime.sendMessage.mockImplementation((_message, callback) => callback({
      success: false,
      error: 'storage_clear_denied'
    }));

    await expect(boot.prepareWorkingSession()).rejects.toThrow('storage_clear_denied');
  });

  test('a missing reload acknowledgement times out and does not claim success', async () => {
    jest.useFakeTimers();
    Object.defineProperty(performance, 'getEntriesByType', {
      configurable: true,
      value: () => [{ type: 'reload' }]
    });
    chrome.runtime.sendMessage.mockImplementation(() => {});
    try {
      const pending = boot.prepareWorkingSession();
      for (let turn = 0; turn < 8; turn += 1) {
        await Promise.resolve();
        await jest.advanceTimersByTimeAsync(0);
      }
      expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(
        { type: 'RESET_WORKING_SESSION', reason: 'page_reload' },
        expect.any(Function)
      );
      let settled = false;
      pending.catch(() => { settled = true; });
      await jest.advanceTimersByTimeAsync(10000);
      expect(settled).toBe(true);
      await expect(pending).rejects.toThrow('Сброс рабочей сессии не подтверждён. Перезагрузите страницу ещё раз.');
    } finally {
      jest.useRealTimers();
    }
  });
});

describe('working session startup wiring', () => {
  test('working-session reset completes before startup hydration can restore stored UI state', () => {
    const listenerAt = RESULTS_SRC.indexOf("document.addEventListener('DOMContentLoaded', async () => {");
    const resetAt = RESULTS_SRC.indexOf('await prepareWorkingSession()', listenerAt);
    const failedResetAt = RESULTS_SRC.indexOf("console.error('[RESULTS] Working session reset failed'", resetAt);
    const failedResetReturnAt = RESULTS_SRC.indexOf('return;', failedResetAt);
    const firstPageInitializationAt = RESULTS_SRC.indexOf('const favoritePanelId =', listenerAt);
    const hydrationAt = RESULTS_SRC.indexOf('const hydrateStartupState = async () => {');
    const restoreAt = RESULTS_SRC.indexOf('await restoreCrossViewUiState();', hydrationAt);

    expect(listenerAt).toBeGreaterThanOrEqual(0);
    expect(resetAt).toBeGreaterThan(listenerAt);
    expect(failedResetAt).toBeGreaterThan(resetAt);
    expect(failedResetReturnAt).toBeGreaterThan(failedResetAt);
    expect(firstPageInitializationAt).toBeGreaterThan(failedResetReturnAt);
    expect(hydrationAt).toBeGreaterThan(resetAt);
    expect(restoreAt).toBeGreaterThan(hydrationAt);
  });

  test('resume and latest-run discovery use the working-session cutoff', () => {
    const latestRunAt = RESULTS_SRC.indexOf('const readLatestCustomRun = async () => {');
    const latestRun = RESULTS_SRC.slice(latestRunAt, latestRunAt + 1000);
    const resumeAt = RESULTS_SRC.indexOf('const offerStoredResumeLine = async () => {');
    const resume = RESULTS_SRC.slice(resumeAt, resumeAt + 700);

    expect(latestRunAt).toBeGreaterThanOrEqual(0);
    expect(latestRun).toContain('entry.startedAt >= workingSessionStartedAt');
    expect(resumeAt).toBeGreaterThanOrEqual(0);
    expect(resume).toContain('record?.startedAt >= workingSessionStartedAt');
  });

  test('a late cross-view writer from the previous working session cannot restore its draft', async () => {
    let resolveStored;
    const storedRead = new Promise((resolve) => { resolveStored = resolve; });
    const safeStorageLocalGet = jest.fn(() => storedRead);
    const safeStorageLocalSet = jest.fn(async () => true);
    const persist = makeCrossViewPersistFromSource({
      workingSessionStartedAt: 100,
      safeStorageLocalGet,
      safeStorageLocalSet
    });

    const pending = persist();
    await Promise.resolve();
    resolveStored({
      llmComparatorWorkingSessionStartedAt: 200,
      llmComparatorCrossViewUiState: {
        workingSessionStartedAt: 100,
        views: { pipeline: { pipelineDraft: { config: { schema: 'stale' } } } },
        shared: { outputs: { outputGPT: 'stale output' } }
      }
    });
    await pending;

    expect(safeStorageLocalGet).toHaveBeenCalledWith([
      'llmComparatorCrossViewUiState',
      'llmComparatorWorkingSessionStartedAt'
    ]);
    expect(safeStorageLocalSet).not.toHaveBeenCalled();
  });

  test('a current cross-view snapshot carries the current working-session marker', async () => {
    const safeStorageLocalGet = jest.fn(async () => ({
      llmComparatorWorkingSessionStartedAt: 100,
      llmComparatorCrossViewUiState: {
        workingSessionStartedAt: 50,
        views: {
          main: { promptText: 'stale prompt', modifiers: { selectedIds: ['old'] } },
          pipeline: { pipelineDraft: { config: { schema: 'stale' } } }
        },
        shared: { outputs: { outputOld: 'stale output' } }
      }
    }));
    const safeStorageLocalSet = jest.fn(async () => true);
    const persist = makeCrossViewPersistFromSource({
      workingSessionStartedAt: 100,
      safeStorageLocalGet,
      safeStorageLocalSet
    });

    await persist();

    const [[payload]] = safeStorageLocalSet.mock.calls;
    expect(payload.llmComparatorCrossViewUiState.workingSessionStartedAt).toBe(100);
    expect(payload.llmComparatorCrossViewUiState.views.pipeline).toEqual({ promptText: 'current draft' });
    expect(payload.llmComparatorCrossViewUiState.views.main).toEqual({});
    expect(payload.llmComparatorCrossViewUiState.shared.outputs).toEqual({ outputGPT: 'current output' });
  });

  test('missing cross-view state does not emit selection changes or clear the live feed', () => {
    const clearLiveFeed = jest.fn();
    const notifySelectionChanged = jest.fn();
    const restorePrompt = jest.fn();
    const syncModeratorSelectors = jest.fn();
    const apply = makeApplyCrossViewUiStateFromSource({
      notifySelectionChanged, clearLiveFeed, restorePrompt, syncModeratorSelectors
    });

    apply(undefined);
    apply(null);

    expect(notifySelectionChanged).not.toHaveBeenCalled();
    expect(clearLiveFeed).not.toHaveBeenCalled();
    expect(restorePrompt).not.toHaveBeenCalled();

    apply({ workingSessionStartedAt: 77, views: { main: { promptText: 'current draft' } }, shared: {} });

    expect(restorePrompt).toHaveBeenCalledWith(undefined, 'current draft');
    expect(syncModeratorSelectors).toHaveBeenCalledWith({ preserveRoute: true });
    expect(notifySelectionChanged).not.toHaveBeenCalled();
    expect(clearLiveFeed).not.toHaveBeenCalled();
  });

  test('pipeline draft-plan writes and restore are scoped to the current working-session marker', () => {
    const persistAt = RESULTS_SRC.indexOf('const persistPipelineStore = async () => {');
    const persist = RESULTS_SRC.slice(persistAt, persistAt + 1400);
    const normalizeAt = RESULTS_SRC.indexOf('const normalizePipelineStore = (input) => {');
    const normalize = RESULTS_SRC.slice(normalizeAt, normalizeAt + 3300);

    expect(persistAt).toBeGreaterThanOrEqual(0);
    expect(persist).toContain('workingSessionStartedAt,');
    expect(persist).toContain('draftPlans: pipelineStore.draftPlans');
    expect(normalizeAt).toBeGreaterThanOrEqual(0);
    expect(normalize).toContain('(Number(value.workingSessionStartedAt) || 0) === workingSessionStartedAt');
    expect(normalize).toContain("? value.draftPlans : {}");
    expect(normalize).toContain('const pipelines = value.pipelines');
  });

  test('reload reset clears current UI state and telemetry while retaining saved pipeline and archive stores', () => {
    const caseAt = ROUTER_SRC.indexOf("case 'RESET_WORKING_SESSION'");
    const handler = ROUTER_SRC.slice(caseAt, caseAt + 5000);

    expect(caseAt).toBeGreaterThanOrEqual(0);
    expect(handler).toContain('llmComparatorCrossViewUiState');
    expect(handler).toContain('llmComparatorCrossViewNavigationIntent');
    expect(handler).toContain('aoEngineState.v1');
    expect(handler).toContain('writeDiagnosticsEventsToStorage([])');
    expect(handler).toContain('llmComparatorSelectedModelsByView.main');
    expect(handler).toContain('llmComparatorSelectedModelsByView.pipeline');
    expect(handler).toContain('jobState');
    expect(handler).not.toMatch(/storage\.local\.remove\([^)]*(?:llmComparatorPipelines|customRunRecords\.index)/);
  });
});
