// L-17: the uncertain terminal that reaches its cap without the request's delivery token is PARTIAL
// (reason capped_unproven), never verified; with the token at the end it stays a success.
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');
const ROUTER = read('background/message-router.js');
const COORD = read('background/dispatch-coordinator.js');
const Acceptance = require('../disput/debate-response-acceptance');
const Proof = require('../shared/answer-proof-normalization');

const TAG = '[[AO-abc123]]';
const LONG = Array.from({ length: 40 }, (_, i) => `слово${i}`).join(' ') + '.';

describe('the deferred uncertain terminal at its cap (router)', () => {
  function loadDeferral({ entry, jobState }) {
    const start = ROUTER.indexOf('const UNCERTAIN_TERMINAL_QUIET_MS');
    const end = ROUTER.indexOf('const manualRecoveryRequested');
    const timers = [];
    const context = {
      jobState,
      emitTelemetry: jest.fn(),
      reportDispatchPhase: jest.fn(),
      isTerminalRouterEntry: (e) => Boolean(e?.finalStatusRecorded),
      routerRegisterSessionTimer: (id) => id,
      routerDeregisterSessionTimer: () => {},
      setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length; },
      answerHasDeliveryToken: (llm, text) => Proof.hasDeliveryTokenTail(text, TAG),
      self: { runAutomaticGetItForModel: undefined, resolveBoundTabIdForOrchestrator: () => null },
      Date
    };
    // eslint-disable-next-line no-new-func
    const factory = new Function(...Object.keys(context), `${ROUTER.slice(start, end)}\nreturn { deferUncertainCompletionTerminal };`);
    return { ...factory(...Object.values(context)), timers, context };
  }

  // Runs the deferral's own timers forward past the 180 s cap; `grow` keeps the text growing (not quiet).
  function runToCap(timers, { grow }) {
    const realNow = Date.now;
    const start = realNow();
    let offset = 0;
    try {
      for (let i = 0; i < 200; i += 1) {
        offset += 5000;
        Date.now = () => start + offset;
        if (grow) grow();
        const next = timers.shift();
        if (!next) break;
        next.fn();
      }
    } finally {
      Date.now = realNow;
    }
  }

  test('a text without the token that reaches the cap is finalized with cappedUnproven', () => {
    const entry = { promptSubmittedAt: Date.now(), pendingFinalAnswer: 'paused text', lastDispatchMeta: { dispatchId: 'X:1:1' } };
    const jobState = { session: { startTime: 1 }, llms: { X: entry } };
    const { deferUncertainCompletionTerminal, timers } = loadDeferral({ entry, jobState });
    const finalize = jest.fn();
    deferUncertainCompletionTerminal('X', entry, finalize, { status: 'AMBIGUOUS', reason: 'ownership_conflict' });
    runToCap(timers, { grow: null });
    expect(finalize).toHaveBeenCalledTimes(1);
    expect(finalize).toHaveBeenCalledWith({ cappedUnproven: true });
  });

  test('a text that ends with the token when the cap is reached is not cappedUnproven', () => {
    const entry = { promptSubmittedAt: Date.now(), pendingFinalAnswer: `growing ${TAG}`, lastDispatchMeta: { dispatchId: 'X:1:1' } };
    const jobState = { session: { startTime: 1 }, llms: { X: entry } };
    const { deferUncertainCompletionTerminal, timers } = loadDeferral({ entry, jobState });
    const finalize = jest.fn();
    deferUncertainCompletionTerminal('X', entry, finalize, { status: 'AMBIGUOUS', reason: 'ownership_conflict' });
    // The text keeps growing, so only the cap ends the deferral; the token is still at its end.
    let words = 0;
    runToCap(timers, { grow: () => { words += 1; entry.pendingFinalAnswer = `${'w '.repeat(words)}${TAG}`; } });
    expect(finalize).toHaveBeenCalledTimes(1);
    expect(finalize).toHaveBeenCalledWith({ cappedUnproven: false });
  });
});

describe('the commit of a capped text (dispatch coordinator)', () => {
  function loadCommit(text) {
    const start = COORD.indexOf('function answerHasDeliveryToken');
    const end = COORD.indexOf('function scheduleDispatchRetry');
    const handled = [];
    const context = {
      jobState: { session: { startTime: 1 }, llms: {} },
      handleLLMResponse: (llm, body, error, meta) => { handled.push({ llm, body, error, meta }); },
      reportDispatchPhase: () => {},
      self: { TransportPolicy: undefined, AnswerProofNormalization: Proof },
      setTimeout: () => 0
    };
    // The prompt of this request carries the token; the stored prompt map resolves it.
    context.self.TransportPolicy = { resolvePromptForModel: () => `Ответь. ${TAG}` };
    // eslint-disable-next-line no-new-func
    const factory = new Function(...Object.keys(context), `${COORD.slice(start, end)}\nreturn { commitIncompleteAnswer, answerHasDeliveryToken };`);
    const api = factory(...Object.values(context));
    const entry = { lastDispatchMeta: { dispatchId: 'X:1:1' } };
    const committed = api.commitIncompleteAnswer('X', entry, { text, source: 'deferred_terminal_snapshot', completionReason: 'capped_unproven' });
    return { committed, handled };
  }

  test('a capped text without the token is committed PARTIAL with reason capped_unproven and no forced success', () => {
    const { committed, handled } = loadCommit(`${LONG} Продолжение без конца`);
    expect(committed).toBe(true);
    const meta = handled[0].meta;
    expect(meta.responseMeta).toEqual(expect.objectContaining({
      partial: true, forceTerminalSuccess: false, completionReason: 'capped_unproven'
    }));
  });

  test('a capped text that ends with the token is not PARTIAL: it is forced to success', () => {
    const { handled } = loadCommit(`${LONG}\n${TAG}`);
    const meta = handled[0].meta;
    expect(meta.responseMeta).toEqual(expect.objectContaining({
      partial: false, forceTerminalSuccess: true, completionReason: 'capped_unproven:delivery_token'
    }));
  });
});

describe('acceptance of a capped text (Basic)', () => {
  test('a capped text is refused as unproven at any length', () => {
    const meta = { status: 'PARTIAL', completion: 'partial', reason: 'capped_unproven' };
    expect(Acceptance.evaluate({ text: LONG, meta })).toEqual(expect.objectContaining({ ok: false, reason: 'capped_unproven' }));
    expect(Acceptance.evaluate({ text: 'Да, согласен.', meta: { ...meta, taskClass: 'direct_answer' } }).reason).toBe('capped_unproven');
  });

  test('a PARTIAL without the reason is still refused as partial_unproven', () => {
    expect(Acceptance.evaluate({ text: LONG, meta: { status: 'PARTIAL', completion: 'partial' } }).reason).toBe('partial_unproven');
  });
});

describe('the one delivery-token predicate', () => {
  test('the token counts only at the end of the answer (up to 40 characters after it)', () => {
    expect(Proof.hasDeliveryTokenTail(`${LONG}\n${TAG}`, TAG)).toBe(true);
    expect(Proof.hasDeliveryTokenTail(`${LONG}\n${TAG} 8:55pm`, TAG)).toBe(true);
    expect(Proof.hasDeliveryTokenTail(`${TAG}\n${LONG}`, TAG)).toBe(false);
  });
});
