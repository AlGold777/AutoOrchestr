/** @jest-environment node */
// Review 2026-10-30, section C (C4, C8, C9, C11, C12). Behaviour is checked on extracted
// self-contained snippets in JSDOM; wiring is checked on the sources.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { JSDOM } = require('jsdom');
const Delivery = require('../shared/message-delivery.js');

const read = (...p) => fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8');
const TOKEN_RE = /\[\[AO-[a-z0-9]{6}\]\]/;

describe('C4: Claude completion and empty answers', () => {
  beforeEach(() => Delivery.reset());

  test('an empty final is journaled as FAILED, not success', () => {
    const prompts = Delivery.prepare({ prompt: 'Q', models: ['Claude'] });
    Delivery.receive({ llmName: 'Claude', answer: '', metadata: { status: 'SUCCESS' } }, { final: true });
    const last = Delivery.journal().at(-1);
    expect(last.kind).toBe('empty_answer');
    expect(last.status).toBe('FAILED');
    expect(last.chars).toBe(0);
    expect(prompts.Claude).toMatch(TOKEN_RE);
  });

  // Extract the completion predicate (and its state) from the adapter and run it on a DOM.
  const claudeSource = read('content-scripts', 'content-claude.js');
  const start = claudeSource.indexOf('let claudeDeliveryTag');
  const end = claudeSource.indexOf('  async function waitForClaudeResponseForPing');
  const predicateSource = claudeSource.slice(start, end);

  const checkOn = (html, tag) => {
    const dom = new JSDOM(html);
    const context = vm.createContext({ document: dom.window.document, window: { Node: dom.window.Node } });
    vm.runInContext(`${predicateSource}\n;globalThis.__check = (t) => { claudeDeliveryTag = t; return hasClaudeCompletionSignal(); };`, context);
    return context.__check(tag);
  };
  const TAG = '[[ao-abc234]]';
  const userTurn = (text) => `<div data-testid="user-message">${text}</div>`;
  const retry = '<button aria-label="Retry">Retry</button>';

  test('Retry after the user turn that carries the request tag completes the answer', () => {
    expect(checkOn(`${userTurn(`Q [[AO-abc234]]`)}<div>Answer</div>${retry}`, TAG)).toBe(true);
  });

  test('a Retry left from an earlier answer (before the tagged turn) is no completion', () => {
    expect(checkOn(`<div>Old</div>${retry}${userTurn('Q2 [[AO-abc234]]')}<div>New, writing</div>`, TAG)).toBe(false);
  });

  test('a visible Stop button in English or Russian blocks completion', () => {
    const turn = `${userTurn('Q [[AO-abc234]]')}${retry}`;
    expect(checkOn(`${turn}<button aria-label="Stop response">x</button>`, TAG)).toBe(false);
    expect(checkOn(`${turn}<button aria-label="Остановить ответ">x</button>`, TAG)).toBe(false);
    expect(checkOn(`${turn}<button aria-label="остановить">x</button>`, TAG)).toBe(false);
  });

  test('no tagged user turn or no tag means no completion', () => {
    expect(checkOn(`${userTurn('Other turn')}${retry}`, TAG)).toBe(false);
    expect(checkOn(`${userTurn('Q [[AO-abc234]]')}${retry}`, '')).toBe(false);
  });

  test('ping wait no longer ends on text stability alone', () => {
    expect(claudeSource).not.toContain('stableHits >= 2');
    expect(claudeSource).toContain('if (hasClaudeCompletionSignal()) {');
  });

  test('an empty extracted text is reported as extract_failed, not as a success answer', () => {
    expect(claudeSource).toContain("throw { type: 'extract_failed', message: 'Claude answer text is empty after extraction' };");
  });
});

describe('C8: repeat send checks the page for an own turn', () => {
  const dispatchSource = read('background', 'dispatch-coordinator.js');
  const probeMatch = dispatchSource.match(/const OWN_PROMPT_TURN_PROBE = (\(tag(?:, newMarkup = null)?\) => \{[\s\S]*?\n\});/);

  test('the probe sees an own user turn with the tag', () => {
    expect(probeMatch).not.toBeNull();
    const dom = new JSDOM('<main><div data-testid="user-message">Q [[AO-abc234]]</div></main>');
    const probe = vm.runInContext(`(${probeMatch[1]})`, vm.createContext({ document: dom.window.document }));
    expect(probe('[[ao-abc234]]')).toBe(true);
    expect(probe('[[ao-zzzzzz]]')).toBe(false);
  });

  test('the probe ignores the composer and assistant turns', () => {
    const dom = new JSDOM('<textarea>Q [[AO-abc234]]</textarea><div data-message-author-role="assistant">[[AO-abc234]]</div>');
    const probe = vm.runInContext(`(${probeMatch[1]})`, vm.createContext({ document: dom.window.document }));
    expect(probe('[[ao-abc234]]')).toBe(false);
  });

  test('both undelivered paths check the page before settling or retrying', () => {
    expect(dispatchSource.match(/await deliverOrVerifyCommand\(\)/g)).toHaveLength(2);
    expect(dispatchSource).toContain("'DISPATCH_DELIVERY_VERIFIED_ON_PAGE'");
  });
});

describe('C9: a stalled Stop is diagnosed', () => {
  const watcherSource = read('content-scripts', 'unified-answer-watcher.js');

  test('a Stop with no text growth for 120 s emits STOP_STALLED once, as UNCERTAIN', () => {
    expect(watcherSource).toContain('const STOP_STALL_MS = 120000;');
    expect(watcherSource).toContain("this.emitDetectorEvent('STOP_STALLED', this.stopStalled);");
    expect(watcherSource).toContain("status: 'UNCERTAIN',");
    expect(watcherSource).toContain('if (silentMs >= STOP_STALL_MS && !this.stopStallReported) {');
  });

  test('the stall is carried in the run result and DETECT_DONE, and never completes the run', () => {
    expect(watcherSource).toContain('stopStalled: this.stopStalled || null');
    expect(watcherSource).toContain('stopStalled: result?.stopStalled || null');
    const from = watcherSource.indexOf('// Stop visible with no text growth');
    const to = watcherSource.indexOf('// The provider said the turn is over');
    expect(from).toBeGreaterThan(-1);
    expect(to).toBeGreaterThan(from);
    expect(watcherSource.slice(from, to)).not.toMatch(/completed:\s*true|SUCCESS_TERMINAL/);
  });
});

describe('C11: terminal telemetry carries timers, flags and the log buffer', () => {
  const watcherSource = read('content-scripts', 'unified-answer-watcher.js');
  const pipelineSource = read('content-scripts', 'unified-answer-pipeline.js');
  const utilsSource = read('content-scripts', 'content-utils.js');
  const orchestratorSource = read('background', 'job-orchestrator.js');
  const logsSource = read('background', 'telemetry-logs.js');

  test('the watcher records timer limits, expiry and the hard-stop setter', () => {
    expect(watcherSource).toContain('this.timerConfig = {');
    expect(watcherSource).toContain('generalExpired: Date.now() >= config.generalDeadlineAt');
    expect(watcherSource).toContain('hardStopSetBy: window.__LLMScrollHardStopSetBy?.source || null');
  });

  test('the response meta passes timers, flags and stall to the background', () => {
    expect(utilsSource).toContain('timers: pipelineMeta.answer?.timers || null,');
    expect(utilsSource).toContain('flags: pipelineMeta.answer?.flags || null,');
  });

  test('MODEL_FINAL and the hard-timeout PIPELINE_ERROR write timers, flags and timeoutMs/startedAt', () => {
    expect(orchestratorSource).toContain('timers: metaObj?.responseMeta?.timers || null,');
    expect(orchestratorSource).toContain('timeoutMs: metaObj?.responseMeta?.timers?.hardTimeoutMs ?? null,');
    expect(orchestratorSource).toContain('startedAt: metaObj?.responseMeta?.timers?.startedAt ?? null');
  });

  test('the content pipeline records the expired hard timer', () => {
    expect(pipelineSource).toContain('this.hardTimerInfo = { timeoutMs: timeouts.hard, startedAt: hardTimerStartedAt };');
    expect(pipelineSource).toContain('timeoutMs: this.hardTimerInfo?.timeoutMs ?? null,');
  });

  test('the per-model log buffer keeps the early events of a long run (x3)', () => {
    expect(logsSource).toContain('const MAX_LOG_ENTRIES = 360;');
    expect(logsSource).not.toContain('const MAX_LOG_ENTRIES = 120;');
  });
});

describe('C12: Kimi waits for an enabled send button', () => {
  const kimiSource = read('content-scripts', 'content-kimi.js');

  test('the click waits up to 3 s, polling every 100 ms, instead of one 250 ms pause', () => {
    expect(kimiSource).toContain('const sendReadyDeadline = Date.now() + 3000;');
    expect(kimiSource).toContain('while (sendDisabled(button) && Date.now() < sendReadyDeadline) {');
    expect(kimiSource).toContain('await sleep(100);');
    expect(kimiSource).not.toContain('await sleep(250);\n      button = findFirst(SEND_SELECTORS);');
  });
});
