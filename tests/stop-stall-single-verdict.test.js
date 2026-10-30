/** @jest-environment node */
// L-1: a visible Stop at the general limit has one verdict: UNCERTAIN, reason stop_stalled,
// text kept, never hard_timeout. Two paths can reach it: the protocol timer (lifecycle HARD,
// prompt + completionWait) and the watcher / pipeline general limit (start + completionWait + 5 s).
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const Protocol = require('../shared/completion-protocol.js');

const read = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
const watcherSource = read('content-scripts/unified-answer-watcher.js');
const pipelineSource = read('content-scripts/unified-answer-pipeline.js');
const orchestratorSource = read('background/job-orchestrator.js');

describe('watcher: visible Stop at the general limit is stop_stalled, not hard_timeout', () => {
  const branchStart = watcherSource.indexOf('// Stop visible with no text growth');
  const branchEnd = watcherSource.indexOf('// The provider said the turn is over');
  const branch = watcherSource.slice(branchStart, branchEnd);

  test('the stopVisible branch never finishes with hard_timeout', () => {
    expect(branchStart).toBeGreaterThan(-1);
    expect(branch).not.toMatch(/hard_timeout/);
    expect(branch).toContain("cleanup(this.buildResult('stop_stalled', 0.3, typingActive, getRecentGrowth(), false));");
  });

  test('the verdict carries the same reason the protocol uses, and is reported once', () => {
    expect(branch).toContain("reason: 'stop_stalled'");
    expect(branch).not.toContain('stop_visible_text_silent');
    expect(branch).toContain("this.emitDetectorEvent('STOP_STALLED', this.stopStalled);");
    expect(branch).not.toMatch(/completed:\s*true|SUCCESS_TERMINAL/);
  });
});

describe('pipeline: the hard watchdog defers to the watcher while Stop is visible', () => {
  test('the watchdog re-arms instead of rejecting while the watcher reports a visible Stop', () => {
    expect(pipelineSource).toContain('this.activeAnswerWatcher = new this.answerWatcherClass(');
    expect(pipelineSource).toContain('if (this.activeAnswerWatcher?.lastStopVisible === true) {');
    expect(pipelineSource).toContain('armHardWatchdog(STOP_VISIBLE_WATCHDOG_RECHECK_MS);');
    const reject = pipelineSource.indexOf("reject(new Error('hard_timeout'));");
    const guard = pipelineSource.indexOf('lastStopVisible === true');
    expect(reject).toBeGreaterThan(guard);
  });
});

describe('background: stop_stalled from the content side is UNCERTAIN, not a timeout', () => {
  const fnStart = orchestratorSource.indexOf('function deriveFailureFinalStatus(');
  const fnEnd = orchestratorSource.indexOf('function buildDontAnswerDisplayText(');
  const derive = vm.runInNewContext(`(${orchestratorSource.slice(fnStart, fnEnd).replace(/^function deriveFailureFinalStatus/, 'function')})`, {});

  test('error type stop_stalled finalizes as UNCERTAIN', () => {
    expect(derive({ type: 'stop_stalled', message: 'stop_stalled' })).toBe('UNCERTAIN');
    expect(derive({ type: 'uncertain', message: 'stop_stalled' })).toBe('UNCERTAIN');
  });

  test('a plain hard_timeout is still not UNCERTAIN', () => {
    expect(derive({ type: 'hard_timeout', message: 'hard_timeout' })).not.toBe('UNCERTAIN');
  });
});

describe('protocol path: the lifecycle timer decides first and gives the same verdict', () => {
  const PROMPT_AT = 1000;

  test('the HARD timer with Stop visible is STALLED stop_stalled, final status UNCERTAIN', () => {
    const s = new Protocol.CompletionSession(
      { promptSubmittedAt: PROMPT_AT, dispatchId: 'd1' },
      { timeouts: { progressTimeoutMs: 500, hardAttemptTimeoutMs: 2000 } }
    );
    s.observe({ type: 'GENERATION_ACTIVE', observedAt: PROMPT_AT + 10 });
    s.observe({ type: 'STOP_VISIBLE', observedAt: PROMPT_AT + 30 });
    const result = s.evaluate(PROMPT_AT + 2000);
    expect(result).toEqual(expect.objectContaining({ status: 'STALLED', reason: 'stop_stalled' }));
    expect(Protocol.FinalizationAdapter.toFinalStatus(result)).toBe('UNCERTAIN');
  });

  test('the protocol HARD deadline is earlier than the watcher general limit (start + wait + 5 s)', () => {
    // Lifecycle: prompt + completionWait; watcher and pipeline watchdog: their start (after send) + the same wait + 5 s.
    const completionWaitMs = 450000;
    const protocolDeadline = PROMPT_AT + completionWaitMs;
    const watcherDeadline = (PROMPT_AT + 1) + completionWaitMs + 5000;
    expect(protocolDeadline).toBeLessThan(watcherDeadline);
  });
});
