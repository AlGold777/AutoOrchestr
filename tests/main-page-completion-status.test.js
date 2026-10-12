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
    pipelineWaiter: { waiting: false }
  };
  vm.createContext(context);
  const start = source.indexOf('const statusClassMap =');
  const end = source.indexOf('// --- END STATUS INDICATOR LOGIC ---', start);
  vm.runInContext(source.slice(start, end), context);
  const renderStart = source.indexOf('function emitAnswerCardRenderEvidence(');
  const renderEnd = source.indexOf('const normalizeRenderedAnswerText', renderStart);
  vm.runInContext(source.slice(renderStart, renderEnd), context);
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
