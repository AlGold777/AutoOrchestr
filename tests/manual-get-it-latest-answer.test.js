/** @jest-environment jsdom */
// Get It / indicator double-click: the answer of the LAST turn, also when the run itself sent no request.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');
const ORCH = read('background/job-orchestrator.js');
const ROUTER = read('background/message-router.js');

const sliceFunction = (src, name) => {
  const start = src.indexOf(`function ${name}(`);
  expect(start).toBeGreaterThan(-1);
  const open = src.indexOf('{', src.indexOf(')', start));
  let depth = 0;
  for (let i = open; i < src.length; i += 1) {
    if (src[i] === '{') depth += 1;
    if (src[i] === '}') { depth -= 1; if (depth === 0) return src.slice(start, i + 1); }
  }
  throw new Error('unbalanced');
};
const extractor = new Function(`${sliceFunction(ORCH, 'extractLatestAssistantSnapshotInPage')}; return extractLatestAssistantSnapshotInPage;`)();

const OLD_LONG = 'An earlier, much longer answer of the same chat. '.repeat(12);
const LATEST = 'The newest answer is shorter than the old one.';

describe('manual latest recovery never prefers an earlier turn by size', () => {
  beforeEach(() => {
    document.body.innerHTML = `<main>
      <div data-message-author-role="assistant"><div class="markdown">${OLD_LONG}</div></div>
      <div data-message-author-role="assistant"><div class="markdown">${LATEST}</div></div></main>`;
  });

  test('"longest" is skipped for a manual latest recovery and the newest answer is taken', () => {
    const out = extractor('GPT', 10, { enrich: false, strategyId: 'longest', strategyIndex: 3, manualLatestRecovery: true });
    expect(out.ok).toBe(true);
    expect(out.text).toContain('The newest answer');
    expect(out.text).not.toContain('earlier, much longer');
  });

  test('without a manual latest recovery "longest" still means the longest', () => {
    const out = extractor('GPT', 10, { enrich: false, strategyId: 'longest', strategyIndex: 3 });
    expect(out.text).toContain('earlier, much longer');
  });
});

describe('the delivery gate and a manual recovery', () => {
  const gate = () => {
    const context = { Date, jobState: { llms: {} }, saveJobState: jest.fn(), completionAuthorityAttempts: new Map() };
    context.self = context;
    vm.createContext(context);
    vm.runInContext(ROUTER.slice(ROUTER.indexOf('const completionAuthorityKey'),
      ROUTER.indexOf('const PERPLEXITY_TRANSIENT_BLOCKER_KIND')), context);
    return context.CompletionAuthorityRegistry;
  };

  test('Get It is delivered although this run registered no attempt', () => {
    const meta = { source: 'manual_ping', getIt: true, manualRecovery: { manualRecovery: true, manualLatestRecovery: true },
      responseMeta: { manualRecovery: true, source: 'manual_latest_recovery' } };
    expect(gate().validateDelivery('DeepSeek', { answer: 'A real answer', meta })).toMatchObject({ ok: true, reason: 'manual_recovery_explicit' });
  });

  test('an observer payload without an attempt is still rejected', () => {
    expect(gate().validateDelivery('DeepSeek', { answer: 'A real answer', meta: { dispatchId: 'd1' } })).toMatchObject({
      ok: false, reason: 'completion_attempt_unregistered'
    });
  });
});
