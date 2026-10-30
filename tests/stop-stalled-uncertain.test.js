/** @jest-environment node */
// A Stop button that stays visible while the text stops growing is UNCERTAIN
// (reason stop_stalled): text is kept, the answer is never a success, and the
// Basic acceptance gate rejects it as unproven_status.
const fs = require('fs');
const path = require('path');
const Protocol = require('../shared/completion-protocol.js');
const Acceptance = require('../disput/debate-response-acceptance.js');

const read = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');

const PROMPT_AT = 1000;
const session = () => new Protocol.CompletionSession(
  { promptSubmittedAt: PROMPT_AT, dispatchId: 'd1' },
  { timeouts: { progressTimeoutMs: 500, hardAttemptTimeoutMs: 2000 } }
);

describe('stop visible without text growth', () => {
  test('timeout with Stop visible is STALLED with reason stop_stalled', () => {
    const s = session();
    s.observe({ type: 'GENERATION_ACTIVE', observedAt: PROMPT_AT + 10 });
    s.observe({ type: 'CONTENT_PROGRESS', observedAt: PROMPT_AT + 20 });
    s.observe({ type: 'STOP_VISIBLE', observedAt: PROMPT_AT + 30 });
    const result = s.evaluate(PROMPT_AT + 1000);
    expect(result).toEqual(expect.objectContaining({ status: 'STALLED', reason: 'stop_stalled' }));
    expect(result.status).not.toBe('SUCCESS_TERMINAL');
  });

  test('timeout without Stop keeps the plain timeout reason', () => {
    const s = session();
    s.observe({ type: 'GENERATION_ACTIVE', observedAt: PROMPT_AT + 10 });
    s.observe({ type: 'STOP_VISIBLE', observedAt: PROMPT_AT + 30 });
    s.observe({ type: 'STOP_ABSENT', observedAt: PROMPT_AT + 40 });
    const result = s.evaluate(PROMPT_AT + 1000);
    expect(result).toEqual(expect.objectContaining({ status: 'STALLED', reason: 'timeout_progress' }));
  });

  test('final status: stop_stalled is UNCERTAIN, other stream timeouts stay STREAM_TIMEOUT', () => {
    expect(Protocol.FinalizationAdapter.toFinalStatus({ status: 'STALLED', reason: 'stop_stalled' })).toBe('UNCERTAIN');
    expect(Protocol.FinalizationAdapter.toFinalStatus({ status: 'STALLED', reason: 'timeout_progress' })).toBe('STREAM_TIMEOUT');
    expect(Protocol.FinalizationAdapter.toFinalStatus({ status: 'STALLED' })).toBe('STREAM_TIMEOUT');
  });

  test('stop_stalled never satisfies the success conjunction', () => {
    const facts = {
      generationObserved: true, producerState: 'TERMINAL', contentTerminal: true, ownership: 'CONFIRMED',
      activeVetoes: ['ACTIVE_STOP'], timeoutState: 'HARD'
    };
    expect(Protocol.CompletionPolicy.evaluate(facts, {}).status).toBe('STALLED');
    expect(Protocol.CompletionPolicy.canSucceed({ ...facts, timeoutState: null })).toBe(false);
  });
});

describe('Basic acceptance rejects UNCERTAIN', () => {
  const longText = 'Ответ достаточно длинный и заканчивается точкой.';

  test('UNCERTAIN status is rejected as unproven_status even with complete-looking text', () => {
    expect(Acceptance.evaluate({ text: longText, meta: { status: 'UNCERTAIN', completion: 'partial' } }))
      .toEqual(expect.objectContaining({ ok: false, reason: 'unproven_status' }));
  });

  test('other statuses are not affected by the new check', () => {
    expect(Acceptance.evaluate({ text: longText, meta: { status: 'SUCCESS', completion: 'complete' } }).ok).toBe(true);
    expect(Acceptance.evaluate({ text: longText, meta: { completion: 'complete' } }).ok).toBe(true);
  });
});

describe('wiring: stop_stalled path keeps text and is not a success', () => {
  test('lifecycle detector sends the last text with the terminal decision for stop_stalled only', () => {
    const src = read('content-utils/response-lifecycle-detector.js');
    expect(src).toContain("answerText: transition.terminalResult.reason === 'stop_stalled' ? (tracker.latestAnswerText || '') : undefined");
  });

  test('message router turns stop_stalled into an uncertain error carrying the text', () => {
    const src = read('background/message-router.js');
    const start = src.indexOf("case 'LLM_COMPLETION_TERMINAL'");
    const block = src.slice(start, src.indexOf("case 'LLM_RESPONSE'", start));
    expect(block).toContain("const stopStalled = terminalResult.status === 'STALLED' && terminalResult.reason === 'stop_stalled';");
    expect(block).toContain("const errorType = stopStalled ? 'uncertain'");
    expect(block).toContain("String(message.meta?.answerText || '')");
    expect(block).toContain("message: 'stop_stalled'");
  });
});
