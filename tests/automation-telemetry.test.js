// Automation tab telemetry: dispatch phases, batch lifecycle, identity rejections,
// cancellation, provider stop and completion are journaled, diagnosed and rendered.
const fs = require('fs');
const path = require('path');

const read = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');

function loadModules() {
  delete window.MessageDelivery;
  delete window.MessageDeliveryDiagnosis;
  window.eval(read('shared/message-delivery.js'));
  window.eval(read('shared/message-delivery-diagnosis.js'));
  return { Delivery: window.MessageDelivery, Diagnosis: window.MessageDeliveryDiagnosis };
}

const tokenOf = (prompt) => /\[\[AO-[a-z0-9]{6}\]\]/.exec(prompt)[0];

describe('Automation journal', () => {
  test('a full successful path: prepared → dispatch phases → answer with completion', () => {
    const { Delivery, Diagnosis } = loadModules();
    Delivery.reset();
    Delivery.batchEvent('batch_start', { batchId: 'S1:a1', waitId: 'wait-1', models: ['GPT'], requestIds: { GPT: 'treq-1' }, timeoutMs: 1110000, stageAttemptId: 'S1:a1' });
    const prompts = Delivery.prepare({ prompt: 'Q', models: ['GPT'], requestIds: { GPT: 'treq-1' }, batchId: 'S1:a1' });
    Delivery.batchEvent('start_accepted', { batchId: 'S1:a1', waitId: 'wait-1', status: 'process_started', waitedMs: 40 });
    ['dispatch_started', 'command_accepted', 'submitted'].forEach((phase) => Delivery.observeRuntime({
      type: 'TRANSPORT_DISPATCH_PHASE', llmName: 'GPT', transportRequestId: 'treq-1', phase, dispatchId: 'GPT:1:1', tabId: 7
    }));
    Delivery.receive({ llmName: 'GPT', transportRequestId: 'treq-1', dispatchId: 'GPT:1:1', answer: `Ответ\n${tokenOf(prompts.GPT)}`, metadata: { status: 'SUCCESS', terminal: true } }, { final: true });
    Delivery.batchEvent('batch_end', { batchId: 'S1:a1', waitId: 'wait-1', outcome: 'settled', durationMs: 5000, missing: [], completion: { GPT: 'complete' } });

    const { sends, batches, problems, matrix } = Diagnosis.diagnose(Delivery.journal());
    expect(sends[0]).toMatchObject({ requestId: 'treq-1', tab: 7, dispatchIds: ['GPT:1:1'], result: 'delivered' });
    expect(sends[0].dispatch.map((d) => d.phase)).toEqual(['dispatch_started', 'command_accepted', 'submitted']);
    expect(sends[0].terminal).toMatchObject({ completion: 'complete', dispatchId: 'GPT:1:1', source: 'live' });
    expect(batches[0]).toMatchObject({ waitId: 'wait-1', outcome: 'settled', accepted: { confirmed: true } });
    expect(problems).toEqual([]);
    expect(matrix[0].medianSubmitMs).not.toBeNull();
  });

  test('a command that never got submitted is diagnosed with its block reason', () => {
    const { Delivery, Diagnosis } = loadModules();
    Delivery.reset();
    Delivery.prepare({ prompt: 'Q', models: ['Claude'], requestIds: { Claude: 'treq-2' } });
    Delivery.observeRuntime({ type: 'TRANSPORT_DISPATCH_PHASE', llmName: 'Claude', transportRequestId: 'treq-2', phase: 'dispatch_started', tabId: 3 });
    Delivery.observeRuntime({ type: 'TRANSPORT_DISPATCH_PHASE', llmName: 'Claude', transportRequestId: 'treq-2', phase: 'blocked', reason: 'page_not_ready' });
    Delivery.closeBatch({ models: ['Claude'], requestIds: { Claude: 'treq-2' }, timedOut: true });
    const { sends, problems } = Diagnosis.diagnose(Delivery.journal());
    expect(sends[0].result).toBe('not_submitted');
    expect(problems[0]).toMatchObject({ code: 'not_submitted', severity: 'critical', reason: 'page_not_ready' });
  });

  test('cancellation, refused start, timeout, identity rejections and provider stop are problems', () => {
    const { Delivery, Diagnosis } = loadModules();
    Delivery.reset();
    Delivery.batchEvent('batch_start', { batchId: 'B', waitId: 'wait-1', models: ['GPT', 'Grok'] });
    Delivery.prepare({ prompt: 'Q', models: ['GPT', 'Grok'], requestIds: { GPT: 'treq-a', Grok: 'treq-b' } });
    Delivery.batchEvent('start_refused', { batchId: 'B', waitId: 'wait-1', attempt: 1, errorCode: 'RUN_ALREADY_ACTIVE', reason: 'model_still_generating', blockingModel: 'Grok' });
    Delivery.batchEvent('start_accepted', { batchId: 'B', waitId: 'wait-1', status: 'process_started', waitedMs: 1500 });
    Delivery.batchEvent('identity_rejected', { model: 'GPT', requestId: 'treq-a', reason: 'duplicate_terminal' });
    Delivery.batchEvent('identity_rejected', { model: 'GPT', requestId: 'treq-old', reason: 'unknown_request' });
    Delivery.observeRuntime({ type: 'PROVIDER_STOP_RESULT', llmName: 'Grok', stopped: false, reason: 'stop_unconfirmed' });
    Delivery.closeBatch({ models: ['GPT', 'Grok'], requestIds: { GPT: 'treq-a', Grok: 'treq-b' }, cancelled: true, reason: 'cancelled_while_waiting' });
    Delivery.batchEvent('batch_end', { batchId: 'B', waitId: 'wait-1', outcome: 'timeout', missing: ['GPT', 'Grok'] });

    const { sends, problems, rejections, batches } = Diagnosis.diagnose(Delivery.journal());
    expect(sends.map((s) => s.result)).toEqual(['cancelled', 'cancelled']);
    expect(rejections).toHaveLength(1);
    expect(batches[0].refusals[0]).toMatchObject({ reason: 'model_still_generating', blockingModel: 'Grok' });
    const codes = problems.map((p) => p.code);
    expect(codes).toEqual(expect.arrayContaining(['cancelled', 'identity', 'stop_unconfirmed', 'start_refused', 'batch_timeout']));
  });

  test('an upgrade after an empty terminal and a revision are journaled', () => {
    const { Delivery, Diagnosis } = loadModules();
    Delivery.reset();
    const prompts = Delivery.prepare({ prompt: 'Q', models: ['GPT'], requestIds: { GPT: 'treq-u' } });
    Delivery.receive({ llmName: 'GPT', transportRequestId: 'treq-u', answer: '', metadata: { status: 'STREAM_TIMEOUT' } }, { final: true });
    Delivery.receive({ llmName: 'GPT', transportRequestId: 'treq-u', answer: `Готово\n${tokenOf(prompts.GPT)}`, metadata: { status: 'SUCCESS' } }, { final: true });
    Delivery.receive({ llmName: 'GPT', transportRequestId: 'treq-u', answer: 'Готово полнее', metadata: { status: 'SUCCESS', revision: true } }, { final: true });
    const kinds = Delivery.journal().map((e) => e.kind);
    expect(kinds).toEqual(['prepared', 'empty_answer', 'first_text', 'verified', 'revision']);
    const { sends } = Diagnosis.diagnose(Delivery.journal());
    expect(sends[0]).toMatchObject({ result: 'delivered', revisions: 1 });
  });
});

describe('Automation producers', () => {
  const results = read('results.js');
  const coordinator = read('background/dispatch-coordinator.js');
  const contentUtils = read('content-scripts/content-utils.js');

  test('the panel journals the batch lifecycle and forwards dispatch phases', () => {
    ['batch_start', 'start_refused', 'start_accepted', 'batch_end'].forEach((kind) => expect(results).toContain(`'${kind}'`));
    expect(results).toContain("'TRANSPORT_DISPATCH_PHASE',");
    expect(results).toContain("'PROVIDER_STOP_RESULT',");
    expect(results).toContain("globalThis.MessageDelivery?.batchEvent?.('identity_rejected'");
  });

  test('the background reports every dispatch phase on both dispatch paths', () => {
    ['dispatch_started', 'command_accepted', 'command_not_delivered', 'blocked'].forEach((phase) => {
      expect((coordinator.match(new RegExp(`reportDispatchPhase\\([^)]*'${phase}'`, 'g')) || []).length).toBeGreaterThanOrEqual(2);
    });
    expect(coordinator).toContain("'submitted' : 'submit_unconfirmed'");
  });

  test('the tab reports the provider stop result', () => {
    expect(contentUtils).toContain("type: 'PROVIDER_STOP_RESULT'");
  });
});

describe('Automation view', () => {
  test('renders batches, dispatch path and new result columns', async () => {
    document.body.innerHTML = `
      <section id="automation-tabpanel">
        <select id="automation-model-filter"><option value="all">All</option></select>
        <input type="checkbox" id="automation-only-problems">
        <span id="automation-status"></span>
        <div id="automation-health"></div><div id="automation-batches"></div><div id="automation-problems"></div>
        <div id="automation-messages"></div><div id="automation-raw"></div>
      </section>`;
    const { Delivery } = loadModules();
    Delivery.reset();
    Delivery.batchEvent('batch_start', { batchId: 'S:a1', waitId: 'wait-9', models: ['GPT'], stageAttemptId: 'S:a1', timeoutMs: 1000 });
    Delivery.prepare({ prompt: 'Q', models: ['GPT'], requestIds: { GPT: 'treq-abcdef123' } });
    Delivery.observeRuntime({ type: 'TRANSPORT_DISPATCH_PHASE', llmName: 'GPT', transportRequestId: 'treq-abcdef123', phase: 'dispatch_started', dispatchId: 'GPT:1:2', tabId: 5 });
    Delivery.receive({ llmName: 'GPT', transportRequestId: 'treq-abcdef123', answer: 'обрыв', metadata: { status: 'STREAM_TIMEOUT' } }, { final: true });
    Delivery.batchEvent('batch_end', { batchId: 'S:a1', waitId: 'wait-9', outcome: 'settled', completion: { GPT: 'partial' } });
    const journal = Delivery.journal();
    const originalChrome = window.chrome;
    const listeners = [];
    window.chrome = { storage: { session: { get: async () => ({ 'messageDelivery.journal': journal }) }, onChanged: { addListener: (fn) => listeners.push(fn) } } };
    try {
      window.eval(read('shared/message-delivery-view.js'));
      document.dispatchEvent(new CustomEvent('devtools-tab-change', { detail: { targetId: 'automation-tabpanel' } }));
      await new Promise((resolve) => setTimeout(resolve, 20));
      const text = document.getElementById('automation-tabpanel').textContent;
      expect(document.getElementById('automation-status').textContent).toContain('1 partial');
      expect(document.getElementById('automation-batches').textContent).toContain('S:a1');
      expect(text).toContain('abcdef12');
      expect(text).toContain('#2');
      expect(text).toContain('отправка');
      expect(text).toContain('неполный');
      expect(document.querySelector('#automation-health th:nth-child(4)').textContent).toBe('Partial');
    } finally {
      window.chrome = originalChrome;
    }
  });

  test('the Pipeline panel has a Batches card', () => {
    expect(read('pipeline_panel.html')).toContain('id="automation-batches"');
  });
});

describe('field report: UNCERTAIN terminal before the answer (Le Chat, Perplexity)', () => {
  const { journal } = JSON.parse(read('tests/fixtures/delivery-journal-premature-uncertain.json'));

  test('the diagnosis names the premature terminal instead of an empty answer', () => {
    const { Diagnosis } = loadModules();
    const { sends, problems, matrix } = Diagnosis.diagnose(journal);
    expect(sends.map((s) => [s.model, s.prematureTerminal, s.batchId])).toEqual([
      ['Le Chat', true, 'unscoped:a1'],
      ['Perplexity', true, 'unscoped:a1']
    ]);
    expect(problems.filter((p) => p.code === 'premature_terminal')).toHaveLength(2);
    expect(problems.some((p) => p.code === 'empty')).toBe(false);
    expect(matrix.every((row) => row.premature === 1)).toBe(true);
    // The duplicated dispatch_started delivery is counted once.
    expect(sends[0].dispatch.map((d) => d.phase)).toEqual(['dispatch_started', 'command_accepted', 'submitted']);
  });

  test('the protocol terminal, navigation and late text are journaled with the cause', () => {
    const { Delivery, Diagnosis } = loadModules();
    Delivery.reset();
    Delivery.prepare({ prompt: 'Q', models: ['Le Chat'], requestIds: { 'Le Chat': 'treq-l' } });
    Delivery.observeRuntime({ type: 'SPA_NAVIGATION', llmName: 'Le Chat', oldUrl: 'https://chat.mistral.ai/chat', newUrl: 'https://chat.mistral.ai/chat/abc', reason: 'pushState' });
    Delivery.observeRuntime({ type: 'LLM_COMPLETION_TERMINAL', llmName: 'Le Chat', meta: { dispatchId: 'Le Chat:1:1', terminalResult: { status: 'CONTEXT_LOST', reason: 'context_invalidated' } } });
    Delivery.receive({ llmName: 'Le Chat', transportRequestId: 'treq-l', answer: '', metadata: { status: 'UNCERTAIN', terminal: true, reason: 'uncertain', errorType: 'uncertain', errorMessage: 'context_invalidated' } }, { final: true });
    Delivery.receive({ llmName: 'Le Chat', transportRequestId: 'treq-l', answer: 'текст ответа', metadata: { status: 'RECEIVING' } }, { final: false });
    const kinds = Delivery.journal().map((e) => e.kind);
    expect(kinds).toEqual(['prepared', 'navigation', 'completion_terminal', 'empty_answer', 'late_text', 'first_text']);
    const { sends, problems } = Diagnosis.diagnose(Delivery.journal());
    expect(sends[0]).toMatchObject({ prematureTerminal: true, lateText: { chars: 12 } });
    expect(problems[0].code).toBe('premature_terminal');
    expect(problems[0].reason).toContain('CONTEXT_LOST (context_invalidated)');
    expect(problems[0].reason).toContain('/chat → /chat/abc');
    expect(problems[0].reason).toContain('uncertain: context_invalidated');
  });
});

describe('transport fixes behind the field report', () => {
  const router = read('background/message-router.js');
  const broadcast = read('background/ui-broadcast.js');
  const orchestrator = read('background/job-orchestrator.js');

  function loadDeferral({ entry, jobState }) {
    const start = router.indexOf('const UNCERTAIN_TERMINAL_QUIET_MS');
    const end = router.indexOf('const validateCompletionAuthorityDelivery');
    const timers = [];
    const context = {
      jobState,
      emitTelemetry: jest.fn(),
      reportDispatchPhase: jest.fn(),
      isTerminalRouterEntry: (e) => Boolean(e?.finalStatusRecorded),
      routerRegisterSessionTimer: (id) => id,
      routerDeregisterSessionTimer: () => {},
      setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length; },
      Date
    };
    // eslint-disable-next-line no-new-func
    const factory = new Function(...Object.keys(context), `${router.slice(start, end)}\nreturn { deferUncertainCompletionTerminal, UNCERTAIN_TERMINAL_QUIET_MS };`);
    return { ...factory(...Object.values(context)), timers, context };
  }

  test('an uncertain terminal waits while the tab is active and yields to a real answer', () => {
    const entry = { promptSubmittedAt: Date.now(), lastRuntimeActivityAt: 0, lastDispatchMeta: { dispatchId: 'X:1:1' } };
    const jobState = { session: { startTime: 1 }, llms: { X: entry } };
    const { deferUncertainCompletionTerminal, timers, context } = loadDeferral({ entry, jobState });
    const finalize = jest.fn();
    deferUncertainCompletionTerminal('X', entry, finalize, { status: 'CONTEXT_LOST', reason: 'context_invalidated' });
    expect(finalize).not.toHaveBeenCalled();
    expect(context.reportDispatchPhase).toHaveBeenCalledWith('X', entry, 'terminal_deferred', expect.objectContaining({ reason: 'CONTEXT_LOST:context_invalidated' }));
    // Activity after the deferral postpones the decision.
    entry.lastRuntimeActivityAt = Date.now() + 10000;
    timers.shift().fn();
    expect(finalize).not.toHaveBeenCalled();
    expect(timers).toHaveLength(1);
    // The real answer arrived: nothing to commit.
    entry.finalStatusRecorded = true;
    timers.shift().fn();
    expect(finalize).not.toHaveBeenCalled();
  });

  test('a quiet tab commits the uncertain terminal', () => {
    const entry = { promptSubmittedAt: Date.now() - 120000, lastRuntimeActivityAt: 0, lastDispatchMeta: { dispatchId: 'X:1:1' } };
    const jobState = { session: { startTime: 1 }, llms: { X: entry } };
    const { deferUncertainCompletionTerminal, timers } = loadDeferral({ entry, jobState });
    const finalize = jest.fn();
    const realNow = Date.now;
    deferUncertainCompletionTerminal('X', entry, finalize, { status: 'AMBIGUOUS', reason: 'ownership_conflict' });
    Date.now = () => realNow() + 60000;
    try {
      timers.shift().fn();
    } finally {
      Date.now = realNow;
    }
    expect(finalize).toHaveBeenCalledTimes(1);
  });

  test('only AMBIGUOUS / CONTEXT_LOST after a confirmed send are deferred', () => {
    expect(router).toContain("const DEFERRABLE_COMPLETION_TERMINALS = new Set(['AMBIGUOUS', 'CONTEXT_LOST']);");
    expect(router).toContain('if (DEFERRABLE_COMPLETION_TERMINALS.has(terminalResult.status) && liveEntry?.promptSubmittedAt) {');
  });

  test('a results page that does not answer is not sent the message twice', () => {
    expect(broadcast).toContain('if (/message port closed before a response was received/i.test(errorMessage)) return;');
  });

  test('the final message carries the concrete failure cause', () => {
    expect(orchestrator).toContain("errorMessage: isSuccess ? null : (error?.message ? String(error.message).slice(0, 300) : null),");
  });
});
