const fs = require('fs');
const path = require('path');
const vm = require('vm');
const StatusContract = require('../shared/status-contract.js');

const source = fs.readFileSync(path.join(__dirname, '..', 'background', 'ui-broadcast.js'), 'utf8');
const resultsSource = fs.readFileSync(path.join(__dirname, '..', 'results.js'), 'utf8');

function buildSnapshot(jobState) {
  const context = {
    Date, jobState,
    TabMapManager: { get: () => 17, entries: () => [] },
    resultsTabId: 4,
    self: {
      ModelRunState: { deriveModelRunState: () => null, buildRunMetrics: () => null },
      LLMStatusContract: {
        deriveStatusContract: entry => ({
          uiStatus: entry?.status || 'UNKNOWN',
          finalStatus: entry?.finalStatus || null,
          rank: 2
        })
      }
    }
  };
  vm.createContext(context);
  const start = source.indexOf('function buildGlobalStateSnapshot(options = {})');
  const end = source.indexOf('\nfunction broadcastGlobalState()', start);
  vm.runInContext(source.slice(start, end), context);
  return JSON.parse(JSON.stringify(vm.runInContext('buildGlobalStateSnapshot({ includeAnswers: true })', context)));
}

function createResultsConsumer() {
  document.body.innerHTML = '<button id="start-button"><i></i></button><section id="panel-gpt"><span class="status-indicator" data-llm-name="GPT"></span><div class="output"></div></section>';
  const context = {
    document, console, Date, Map, Object, Number, Boolean, String,
    window: { LLMStatusContract: StatusContract },
    chrome: { runtime: { sendMessage: jest.fn() } },
    location: { pathname: '/result_new.html' },
    statusStateByModel: {}, deferredSuccessStatusByModel: {},
    getCurrentViewKey: () => 'main',
    mergeLLMMetadata: jest.fn(), updateDebateModelCardOutput: jest.fn(() => ({ updated: true })),
    isErrorOutput: () => false, sanitizeInlineHtml: value => value,
    resolveCompleteAnswerHtml: text => text,
    replaceChildrenFromSanitizedHtml: (element, html) => { element.textContent = html; },
    decorateLinksForNewTab: jest.fn(), setApiIndicatorState: jest.fn(),
    pipelineWaiter: { waiting: false, handleFinal: jest.fn(), handlePartial: jest.fn(), missReason: () => 'rejected' },
    applyAttributionMarker: jest.fn(), revealPanelForLargeContent: jest.fn(),
    makeLocalDiagEntry: () => ({}), ingestLogs: jest.fn(),
    autoCollapseDiagnostics: jest.fn(), checkCompareButtonState: jest.fn()
  };
  vm.createContext(context);
  const controlsStart = resultsSource.indexOf("const startButton = document.getElementById('start-button');");
  const controlsEnd = resultsSource.indexOf('const promptInput =', controlsStart);
  vm.runInContext(resultsSource.slice(controlsStart, controlsEnd), context);
  const statusStart = resultsSource.indexOf('const statusClassMap =');
  const statusEnd = resultsSource.indexOf('// --- END STATUS INDICATOR LOGIC ---', statusStart);
  vm.runInContext(resultsSource.slice(statusStart, statusEnd), context);
  return { context, button: document.getElementById('start-button'), indicator: document.querySelector('.status-indicator'), output: document.querySelector('.output') };
}

test('global state snapshot carries the session and per-model completion fields consumed by results.js', () => {
  const context = {
    Date,
    jobState: {
      session: {
        startTime: 123,
        sourceView: 'main',
        roundsInProgress: true,
        pipelineRunId: null,
        internalField: 'omitted'
      },
      llms: {
        GPT: {
          status: 'RECEIVING',
          transportRequestId: 'main-request',
          cardAnswerComplete: true,
          answer: 'Complete answer'
        }
      }
    },
    TabMapManager: { get: () => 17, entries: () => [] },
    resultsTabId: 4,
    self: {
      ModelRunState: {
        deriveModelRunState: () => null,
        buildRunMetrics: () => null
      },
      LLMStatusContract: { deriveStatusContract: () => ({ uiStatus: 'RECEIVING', rank: 2 }) }
    }
  };
  vm.createContext(context);
  const start = source.indexOf('function buildGlobalStateSnapshot(options = {})');
  const end = source.indexOf('\nfunction broadcastGlobalState()', start);
  vm.runInContext(source.slice(start, end), context);

  const snapshot = vm.runInContext('buildGlobalStateSnapshot({ includeAnswers: true })', context);
  expect(snapshot.session).toEqual({
    startTime: 123,
    sourceView: 'main',
    roundsInProgress: true,
    pipelineRunId: null
  });
  expect(snapshot.llms.GPT).toMatchObject({
    transportRequestId: 'main-request',
    cardAnswerComplete: true,
    answer: 'Complete answer'
  });
});

test('producer snapshots drive the real main Stop button and stale snapshots cannot replace the current request', () => {
  const { context, button, indicator, output } = createResultsConsumer();
  context.replaceCurrentMainRequestIds({ GPT: 'current-request' });

  const activeSnapshot = buildSnapshot({
    session: { startTime: 123, sourceView: 'main', roundsInProgress: true },
    llms: { GPT: { status: 'RECEIVING', transportRequestId: 'current-request' } }
  });
  context.syncStatusFromGlobalState(activeSnapshot);
  expect(button.getAttribute('aria-label')).toBe('Стоп');

  const completedSnapshot = buildSnapshot({
    session: { startTime: 123, sourceView: 'main', roundsInProgress: false },
    llms: { GPT: {
      status: 'SUCCESS', finalStatus: 'SUCCESS', finalStatusRecorded: true,
      cardAnswerComplete: true, transportRequestId: 'current-request', answer: 'Complete answer'
    } }
  });
  context.syncStatusFromGlobalState(completedSnapshot);
  expect(button.getAttribute('aria-label')).toBe('Пуск');
  expect(output.textContent).toBe('Complete answer');
  expect(indicator.classList.contains('success')).toBe(true);

  context.replaceCurrentMainRequestIds({ GPT: 'next-request' });
  context.clearModelStatusMemory('GPT');
  context.updateModelStatusUI('GPT', 'INITIALIZING', { reset: true, force: true });
  vm.runInContext('setMainRunActive(true)', context);
  const staleSnapshot = buildSnapshot({
    session: { startTime: 123, sourceView: 'main', roundsInProgress: true },
    llms: { GPT: { status: 'RECEIVING', transportRequestId: 'current-request', answer: 'Old answer' } }
  });
  context.syncStatusFromGlobalState(staleSnapshot);
  expect(button.getAttribute('aria-label')).toBe('Стоп');
  expect(indicator.dataset.currentStatus).toBe('INITIALIZING');
  expect(output.textContent).toBe('Complete answer');

  const stoppedSnapshot = buildSnapshot({ session: {}, llms: {} });
  context.syncStatusFromGlobalState(stoppedSnapshot);
  expect(button.getAttribute('aria-label')).toBe('Пуск');
});
