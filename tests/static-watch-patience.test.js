const fs = require('fs');
const path = require('path');

const ORCH = fs.readFileSync(path.join(__dirname, '..', 'background', 'job-orchestrator.js'), 'utf8');

const flush = async () => { for (let i = 0; i < 8; i += 1) await Promise.resolve(); };

function setup(probeResult) {
  const start = ORCH.indexOf('const STATIC_WATCH_TICK_MS');
  const end = ORCH.indexOf('function startStaticAnswerWatchdog(');
  const calls = { commit: [], telemetry: [], probe: 0 };
  const context = {
    jobState: { session: { startTime: 7 }, llms: {} },
    isSessionActive: (id) => id === 7,
    isFinalizedEntry: (e) => Boolean(e?.finalStatusRecorded),
    answerHasDeliveryToken: () => false,
    answerHasNoBodyYet: () => false,
    commitIncompleteAnswer: (...args) => { calls.commit.push(args); return true; },
    reportDispatchPhase: () => {},
    emitTelemetry: (...args) => { calls.telemetry.push(args); },
    runAutomaticGetItForModel: async () => ({ status: 'manual_ping_sent' }),
    resolveBoundTabIdForOrchestrator: () => 5,
    isValidTabId: (id) => Number(id) > 0,
    detectActiveGenerationInPage: function detect() {},
    GENERATION_WAIT_CEILING_MS: 3600000,
    chrome: { scripting: { executeScript: async () => { calls.probe += 1; return probeResult(); } } },
    Date
  };
  // eslint-disable-next-line no-new-func
  const factory = new Function(...Object.keys(context), `${ORCH.slice(start, end)}\nreturn { runStaticAnswerWatchTick };`);
  const { runStaticAnswerWatchTick } = factory(...Object.values(context));
  return { run: runStaticAnswerWatchTick, context, calls };
}

describe('static text watch: patience while the page still generates', () => {
  const realNow = Date.now;
  afterEach(() => { Date.now = realNow; });
  const at = (ms, fn) => { Date.now = () => realNow() + ms; return fn(); };

  test('a quiet text without the token is not committed while the page generates; the quiet window starts again', async () => {
    const { run, context, calls } = setup(() => [{ result: { active: true } }]);
    const entry = { promptSubmittedAt: realNow(), answer: 'Начало ответа модели, которая ещё думает' };
    context.jobState.llms = { Qwen: entry };
    at(0, () => run(7));
    at(40000, () => run(7));
    await flush();
    expect(calls.probe).toBe(1);
    expect(calls.commit).toHaveLength(0);
    expect(calls.telemetry.map((c) => c[1])).toContain('STATIC_WATCH_GENERATION_ACTIVE');
    // The window starts again: 10 s later the text is not quiet long enough for a new commit.
    at(50000, () => run(7));
    await flush();
    expect(calls.commit).toHaveLength(0);
  });

  test('the same quiet text is committed as incomplete when the page does not generate', async () => {
    const { run, context, calls } = setup(() => [{ result: { active: false } }]);
    context.jobState.llms = { Qwen: { promptSubmittedAt: realNow(), answer: 'Обрыв ответа без метки' } };
    at(0, () => run(7));
    at(40000, () => run(7));
    await flush();
    expect(calls.commit.map((c) => c[0])).toEqual(['Qwen']);
    expect(calls.commit[0][2].completionReason).toBe('static_text_quiet');
  });

  test('a page that cannot be probed keeps the old behaviour: the quiet text is committed', async () => {
    const { run, context, calls } = setup(() => { throw new Error('no access'); });
    context.jobState.llms = { Qwen: { promptSubmittedAt: realNow(), answer: 'Обрыв ответа без метки' } };
    at(0, () => run(7));
    at(40000, () => run(7));
    await flush();
    expect(calls.commit.map((c) => c[0])).toEqual(['Qwen']);
  });

  test('after the ceiling the quiet text is committed without a probe', async () => {
    const { run, context, calls } = setup(() => [{ result: { active: true } }]);
    context.jobState.llms = { Qwen: { promptSubmittedAt: realNow() - 3700000, answer: 'Очень долгий ответ' } };
    at(0, () => run(7));
    at(40000, () => run(7));
    await flush();
    expect(calls.probe).toBe(0);
    expect(calls.commit.map((c) => c[0])).toEqual(['Qwen']);
  });
});
