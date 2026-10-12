const fs = require('fs');
const path = require('path');
const vm = require('vm');
const StatusContract = require('../shared/status-contract.js');
const source = fs.readFileSync(path.join(__dirname, '..', 'results.js'), 'utf8');

function createPage() {
  document.body.innerHTML = '<section id="panel-gpt" class="llm-panel"><span class="status-indicator" data-llm-name="GPT"></span><div class="output">Complete answer</div></section>';
  const context = {
    document, console, Date, Map, Object, Number, Boolean, String,
    window: { LLMStatusContract: StatusContract },
    chrome: { runtime: { sendMessage: jest.fn() } }, location: { pathname: '/result_new.html' },
    statusStateByModel: {}, deferredSuccessStatusByModel: {},
    isErrorOutput: () => false, sanitizeInlineHtml: value => value, setApiIndicatorState: jest.fn(),
    setMainRunActive: jest.fn(), getCurrentViewKey: () => 'main',
    mainRunActive: false,
    mergeLLMMetadata: jest.fn(), updateDebateModelCardOutput: jest.fn(() => ({ updated: true })),
    looksLikeHtml: () => false, resolveCompleteAnswerHtml: text => text,
    applyAttributionMarker: jest.fn(), replaceChildrenFromSanitizedHtml: (element, html) => { element.textContent = html; },
    decorateLinksForNewTab: jest.fn(), revealPanelForLargeContent: jest.fn(),
    ingestLogs: jest.fn(), makeLocalDiagEntry: () => ({}), autoCollapseDiagnostics: jest.fn(),
    checkCompareButtonState: jest.fn(), convertMarkdownToHTML: text => text,
    pipelineWaiter: { waiting: false }
  };
  vm.createContext(context);
  const start = source.indexOf('const statusClassMap =');
  const end = source.indexOf('// --- END STATUS INDICATOR LOGIC ---', start);
  vm.runInContext(source.slice(start, end), context);
  const renderStart = source.indexOf('function emitAnswerCardRenderEvidence(');
  const renderEnd = source.indexOf('const normalizeRenderedAnswerText', renderStart);
  vm.runInContext(source.slice(renderStart, renderEnd), context);
  const updateStart = source.indexOf('function updateLLMPanelOutput(');
  const updateEnd = source.indexOf('//-- 2. Добавляем обработчик для кнопки "Copy All"', updateStart);
  vm.runInContext(source.slice(updateStart, updateEnd), context);
  const panel = document.getElementById('panel-gpt');
  const indicator = panel.querySelector('.status-indicator');
  return { context, panel, indicator, output: panel.querySelector('.output') };
}

const expectGreen = (indicator) => {
  expect(indicator.classList.contains('success')).toBe(true);
  expect(indicator.dataset.currentStatus).toBe('SUCCESS');
  expect(indicator.dataset.resultPhase).toBe('success');
};

test('a card end marker turns the indicator green and late forced statuses cannot change it', () => {
  const { context, panel, output, indicator } = createPage();
  context.updateModelStatusUI('GPT', 'RECEIVING', { force: true });
  expect(indicator.classList.contains('success')).toBe(false);
  context.emitAnswerCardRenderEvidence('GPT', panel, output, {
    answerEndMarkerSeen: true, status: 'RECEIVING', transportRequestId: 'current-request'
  });
  expectGreen(indicator);
  for (const status of ['RECEIVING', 'ERROR', 'PARTIAL', 'INITIALIZING', 'STOPPED']) {
    context.updateModelStatusUI('GPT', status, { force: true, reset: true });
    expectGreen(indicator);
  }
  context.clearModelStatusMemory('GPT');
  context.updateModelStatusUI('GPT', 'INITIALIZING', { reset: true, force: true });
  expect(indicator.classList.contains('success')).toBe(false);
  expect(indicator.dataset.currentStatus).toBe('INITIALIZING');
});

test('a late old completion cannot repaint the main card after a new job is created', () => {
  const { context, panel, output, indicator } = createPage();
  context.emitAnswerCardRenderEvidence('GPT', panel, output, {
    answerEndMarkerSeen: true, status: 'RECEIVING', transportRequestId: 'old-request'
  });
  expectGreen(indicator);
  context.updateModelStatusUI('GPT', 'ERROR', { force: true, reset: true });
  expectGreen(indicator);

  context.replaceCurrentMainRequestIds({ GPT: 'new-request' });
  expect(context.handleLLMJobCreated({
    llmName: 'GPT', requestId: 'legacy-new', transportRequestId: 'new-request', sourceView: 'main'
  })).toBe(true);
  expect(indicator.dataset.currentStatus).toBe('INITIALIZING');
  output.textContent = 'Current request card';

  expect(context.handleLLMJobCreated({
    llmName: 'GPT', requestId: 'legacy-old', transportRequestId: 'old-request', sourceView: 'main'
  })).toBe(false);
  context.updateLLMPanelOutput('GPT', 'Late old answer', '', {
    transportRequestId: 'old-request', answerEndMarkerSeen: true, status: 'SUCCESS'
  });
  expect(output.textContent).toBe('Current request card');
  expect(indicator.dataset.currentStatus).toBe('INITIALIZING');
  expect(indicator.classList.contains('success')).toBe(false);

  context.emitAnswerCardRenderEvidence('GPT', panel, output, {
    answerEndMarkerSeen: true, status: 'RECEIVING', transportRequestId: 'new-request'
  });
  expectGreen(indicator);
});

test('a stopped main request cannot repaint until a new request starts', () => {
  const { context, panel, output, indicator } = createPage();
  context.replaceCurrentMainRequestIds({ GPT: 'stopped-request' });
  context.updateModelStatusUI('GPT', 'INITIALIZING', { reset: true, force: true });
  context.markCurrentMainRequestsCancelled();

  expect(context.isCurrentMainRequestResponse('GPT', { transportRequestId: 'stopped-request' })).toBe(false);
  context.updateLLMPanelOutput('GPT', 'Late stopped answer', '', {
    transportRequestId: 'stopped-request', answerEndMarkerSeen: true, status: 'SUCCESS'
  });
  context.emitAnswerCardRenderEvidence('GPT', panel, output, {
    answerEndMarkerSeen: true, status: 'RECEIVING', transportRequestId: 'stopped-request'
  });
  expect(output.textContent).toBe('Complete answer');
  expect(indicator.classList.contains('success')).toBe(false);
  expect(context.setMainRunActive).not.toHaveBeenCalled();

  context.syncStatusFromGlobalState({ session: { startTime: 10, sourceView: 'main', roundsInProgress: true }, llms: {
    GPT: { transportRequestId: 'stopped-request', status: 'RECEIVING', cardAnswerComplete: false }
  } });
  expect(context.setMainRunActive).not.toHaveBeenCalled();

  context.replaceCurrentMainRequestIds({ GPT: 'next-request' });
  expect(context.isCurrentMainRequestResponse('GPT', { transportRequestId: 'next-request' })).toBe(true);
  context.emitAnswerCardRenderEvidence('GPT', panel, output, {
    answerEndMarkerSeen: true, status: 'RECEIVING', transportRequestId: 'next-request'
  });
  expectGreen(indicator);
});

test('pipeline card completion stays on its request card while the main request is active', () => {
  const { context, panel, output, indicator } = createPage();
  context.replaceCurrentMainRequestIds({ GPT: 'main-request' });
  context.handleLLMJobCreated({
    llmName: 'GPT', requestId: 'legacy-main', transportRequestId: 'main-request', sourceView: 'main'
  });
  expect(indicator.dataset.currentStatus).toBe('INITIALIZING');
  context.mainRunActive = true;
  expect(context.handleLLMJobCreated({
    llmName: 'GPT', requestId: 'legacy-pipeline', transportRequestId: 'pipeline-request',
    sourceView: 'main', pipelineRunId: 'pipeline-run'
  })).toBe(false);
  expect(indicator.dataset.currentStatus).toBe('INITIALIZING');

  const pipelineCard = document.createElement('section');
  pipelineCard.className = 'debate-model-card';
  pipelineCard.dataset.llmName = 'GPT';
  pipelineCard.innerHTML = '<span class="status-indicator" data-llm-name="GPT"></span><div class="debate-model-card-output">Pipeline answer</div>';
  document.body.appendChild(pipelineCard);
  const pipelineIndicator = pipelineCard.querySelector('.status-indicator');
  const pipelineOutput = pipelineCard.querySelector('.debate-model-card-output');

  context.emitAnswerCardRenderEvidence('GPT', pipelineCard, pipelineOutput, {
    answerEndMarkerSeen: true, status: 'RECEIVING',
    transportRequestId: 'pipeline-request', pipelineRunId: 'pipeline-run'
  });

  expect(pipelineIndicator.classList.contains('success')).toBe(true);
  expect(pipelineIndicator.dataset.statusFinal).toBe('1');
  expect(indicator.dataset.currentStatus).toBe('INITIALIZING');
  expect(indicator.classList.contains('success')).toBe(false);
  expect(context.statusStateByModel.GPT.cardAnswerComplete).toBe(false);
});

test('completion remains green after restoring a snapshot with a stale internal status', () => {
  const { context, indicator } = createPage();
  context.syncStatusFromGlobalState({ llms: { GPT: {
    answer: 'Complete answer', status: 'RECEIVING', cardAnswerComplete: true,
    modelRunState: { uiStatus: 'RECEIVING', verificationState: 'candidate' }
  } } });
  expectGreen(indicator);
});

test('without a marker receiving statuses remain active; an empty card does not lock success', () => {
  const { context, panel, output, indicator } = createPage();
  context.emitAnswerCardRenderEvidence('GPT', panel, output, { status: 'RECEIVING' });
  context.updateModelStatusUI('GPT', 'RECEIVING', { force: true });
  expect(indicator.dataset.currentStatus).toBe('RECEIVING');
  output.textContent = '';
  context.emitAnswerCardRenderEvidence('GPT', panel, output, { answerEndMarkerSeen: true });
  context.updateModelStatusUI('GPT', 'GENERATING', { force: true });
  expect(indicator.dataset.currentStatus).toBe('GENERATING');
  expect(indicator.classList.contains('success')).toBe(false);
});
