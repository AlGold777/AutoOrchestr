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

  function loadDeferral({ entry, jobState, nudge = undefined }) {
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
      runPreCollectScrollNudge: nudge,
      resolveBoundTabIdForOrchestrator: () => 7,
      Date
    };
    // eslint-disable-next-line no-new-func
    const factory = new Function(...Object.keys(context), `${router.slice(start, end)}\nreturn { deferUncertainCompletionTerminal, UNCERTAIN_TERMINAL_QUIET_MS };`);
    return { ...factory(...Object.values(context)), timers, context };
  }

  test('an uncertain terminal waits while the answer grows and yields to a real answer', () => {
    const entry = { promptSubmittedAt: Date.now(), pendingFinalAnswer: 'a', lastDispatchMeta: { dispatchId: 'X:1:1' } };
    const jobState = { session: { startTime: 1 }, llms: { X: entry } };
    const { deferUncertainCompletionTerminal, timers, context } = loadDeferral({ entry, jobState });
    const finalize = jest.fn();
    deferUncertainCompletionTerminal('X', entry, finalize, { status: 'CONTEXT_LOST', reason: 'context_invalidated' });
    expect(finalize).not.toHaveBeenCalled();
    expect(context.reportDispatchPhase).toHaveBeenCalledWith('X', entry, 'terminal_deferred', expect.objectContaining({ reason: 'CONTEXT_LOST:context_invalidated' }));
    entry.pendingFinalAnswer = 'ab';
    timers.shift().fn();
    expect(finalize).not.toHaveBeenCalled();
    expect(timers).toHaveLength(1);
    // The real answer arrived: nothing to commit.
    entry.finalStatusRecorded = true;
    timers.shift().fn();
    expect(finalize).not.toHaveBeenCalled();
  });

  test('tab activity that does not grow the answer (visits, probes) does not postpone the terminal', () => {
    const entry = { promptSubmittedAt: Date.now() - 120000, pendingFinalAnswer: 'complete text', lastRuntimeActivityAt: 0, lastDispatchMeta: { dispatchId: 'X:1:1' } };
    const jobState = { session: { startTime: 1 }, llms: { X: entry } };
    const { deferUncertainCompletionTerminal, timers, context } = loadDeferral({ entry, jobState });
    const finalize = jest.fn();
    const realNow = Date.now;
    deferUncertainCompletionTerminal('X', entry, finalize, { status: 'AMBIGUOUS', reason: 'ownership_conflict' });
    try {
      // Fresh runtime activity on every poll, but the text is unchanged.
      let offset = 0;
      for (let i = 0; i < 12 && !finalize.mock.calls.length; i += 1) {
        offset += 5000;
        Date.now = () => realNow() + offset;
        entry.lastRuntimeActivityAt = Date.now();
        timers.shift().fn();
      }
    } finally {
      Date.now = realNow;
    }
    expect(finalize).toHaveBeenCalledTimes(1);
    expect(context.reportDispatchPhase).toHaveBeenCalledWith('X', entry, 'terminal_deferral_ended', expect.objectContaining({ reason: 'answer_quiet', answerChars: 13 }));
  });

  test('the deferral is capped even while the answer keeps changing', () => {
    const entry = { promptSubmittedAt: Date.now(), pendingFinalAnswer: '', lastDispatchMeta: { dispatchId: 'X:1:1' } };
    const jobState = { session: { startTime: 1 }, llms: { X: entry } };
    const { deferUncertainCompletionTerminal, timers, context } = loadDeferral({ entry, jobState });
    const finalize = jest.fn();
    const realNow = Date.now;
    deferUncertainCompletionTerminal('X', entry, finalize, { status: 'CONTEXT_LOST', reason: 'context_invalidated' });
    try {
      let offset = 0;
      for (let i = 0; i < 60 && !finalize.mock.calls.length; i += 1) {
        offset += 5000;
        Date.now = () => realNow() + offset;
        entry.pendingFinalAnswer += 'x';
        timers.shift().fn();
      }
    } finally {
      Date.now = realNow;
    }
    expect(finalize).toHaveBeenCalledTimes(1);
    expect(context.reportDispatchPhase).toHaveBeenCalledWith('X', entry, 'terminal_deferral_ended', expect.objectContaining({ reason: 'max_defer_reached' }));
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

describe('prompt and answer text in the journal', () => {
  test('the prompt, the final answer and a dropped stale answer are kept (capped) and shown as tooltips', () => {
    const { Delivery, Diagnosis } = loadModules();
    Delivery.reset();
    const prompts = Delivery.prepare({ prompt: 'Вопрос '.repeat(400), models: ['GPT'], requestIds: { GPT: 'treq-p' } });
    Delivery.receive({ llmName: 'GPT', transportRequestId: 'treq-p', answer: `${'Ответ '.repeat(400)}\n${tokenOf(prompts.GPT)}`, metadata: { status: 'SUCCESS', terminal: true } }, { final: true });
    const journal = Delivery.journal();
    expect(journal[0].prompt.length).toBeLessThanOrEqual(1500);
    expect(journal.find((e) => e.kind === 'verified').answer.length).toBeLessThanOrEqual(1200);
    const { sends } = Diagnosis.diagnose(journal);
    expect(sends[0].prompt).toContain('Вопрос');
    expect(sends[0].terminal.answer).toContain('Ответ');
  });
});

describe('card marks: incomplete and verify', () => {
  function loadMarkers() {
    const results = read('results.js');
    const start = results.indexOf('    function applyPartialMarker(container, meta = {}) {');
    const end = results.indexOf('    // A model has at most ONE open (not-yet-approved) answer card per session.');
    // eslint-disable-next-line no-new-func
    return new Function('window', 'document', `${results.slice(start, end)}\nreturn { applyPartialMarker, applyAttributionMarker };`)(window, document);
  }
  const card = () => {
    document.body.innerHTML = '<div class="debate-model-card"><span class="debate-model-card-title-main">GPT <input type="checkbox" class="debate-approval-check"></span><div class="debate-model-card-output">x</div></div>';
    return document.querySelector('.debate-model-card');
  };

  test('a cut-off answer gets a gray mark next to the model name; a complete one does not', () => {
    const { applyAttributionMarker } = loadMarkers();
    const el = card();
    applyAttributionMarker(el, { status: 'STREAM_TIMEOUT' });
    expect(el.querySelector('.debate-model-card-title-main > .answer-partial-mark').textContent).toBe('неполный');
    // A later message without a status keeps the mark; a complete one removes it.
    applyAttributionMarker(el, {});
    expect(el.querySelector('.answer-partial-mark')).not.toBeNull();
    applyAttributionMarker(el, { status: 'SUCCESS' });
    expect(el.querySelector('.answer-partial-mark')).toBeNull();
  });

  test('the approval checkbox doubles as verification of an unproven answer', () => {
    const { applyAttributionMarker } = loadMarkers();
    const el = card();
    applyAttributionMarker(el, { status: 'SUCCESS', attributionState: 'unproven', attributionLabel: 'Без метки доставки' });
    expect(el.querySelector('.attribution-unproven-banner').textContent).toBe('Без метки доставки');
    expect(el.querySelector('.debate-approval-check').title).toBe('Verify and approve this answer');
    // Approval marks the answer verified by the user; later updates do not bring the banner back.
    el.dataset.attributionState = 'user_verified';
    applyAttributionMarker(el, { status: 'SUCCESS', attributionState: 'unproven' });
    expect(el.querySelector('.attribution-unproven-banner')).toBeNull();
    expect(el.dataset.attributionState).toBe('user_verified');
  });

  test('approval of an unproven answer is recorded as the user\'s verification; partial answers stay approvable', () => {
    const results = read('results.js');
    expect(results).toContain("card.dataset.attributionState = 'user_verified';");
    // No guard on completion in the approval path: the semi-automatic flow is intended.
    const approve = results.slice(results.indexOf('    function approveDebateCard(card) {'), results.indexOf('    window.approveDebateCheckbox'));
    expect(approve).not.toContain('partial');
  });
});

describe('deferred uncertain terminal keeps the text the model produced', () => {
  test('when no final arrives, the produced text is committed as a partial answer instead of an empty failure', () => {
    const router = read('background/message-router.js');
    const finalize = router.slice(router.indexOf('const finalize = () => {'), router.indexOf('const liveEntry = jobState?.llms?.[message.llmName];'));
    expect(finalize).toContain("live?.pendingFinalAnswer || live?.answer");
    expect(finalize).toContain("commitIncompleteAnswer(message.llmName, live, {");
    expect(finalize).toContain("source: 'deferred_terminal_snapshot'");
    // Still an empty failure when the model produced nothing.
    expect(finalize).toContain("handleLLMResponse(message.llmName, '', {");
  });
});

describe('focus moves and stuck waiting in the journal', () => {
  test('programmatic focus is journaled per request with its source, counted exactly and diagnosed', () => {
    const { Delivery, Diagnosis } = loadModules();
    Delivery.reset();
    Delivery.prepare({ prompt: 'Q', models: ['Le Chat'], requestIds: { 'Le Chat': 'treq-f' } });
    for (let i = 0; i < 40; i += 1) {
      Delivery.observeRuntime({ type: 'TRANSPORT_FOCUS', llmName: 'Le Chat', transportRequestId: 'treq-f', tabId: 9, source: i % 2 ? 'human_visit_activate' : 'automation_visit_activate' });
    }
    const kinds = Delivery.journal().map((e) => e.kind);
    expect(kinds.filter((k) => k === 'focus')).toHaveLength(30);
    expect(kinds.filter((k) => k === 'focus_count').map((_, i) => i)).toHaveLength(1);
    const { sends, problems, matrix } = Diagnosis.diagnose(Delivery.journal());
    expect(sends[0].focus.count).toBe(40);
    expect(problems.find((p) => p.code === 'focus_churn').reason).toContain('human_visit_activate');
    expect(matrix[0].focus).toBe(40);
  });

  test('a send that has text but no final for minutes is reported as stuck, with the deferral named', () => {
    const { Delivery, Diagnosis } = loadModules();
    Delivery.reset();
    Delivery.prepare({ prompt: 'Q', models: ['Perplexity'], requestIds: { Perplexity: 'treq-s' } });
    Delivery.observeRuntime({ type: 'TRANSPORT_DISPATCH_PHASE', llmName: 'Perplexity', transportRequestId: 'treq-s', phase: 'terminal_deferred', dispatchId: 'P:1:1', reason: 'CONTEXT_LOST:context_invalidated' });
    Delivery.receive({ llmName: 'Perplexity', transportRequestId: 'treq-s', answer: 'часть ответа', metadata: { status: 'RECEIVING' } }, { final: false });
    const early = Diagnosis.diagnose(Delivery.journal(), { now: Date.now() + 30000 });
    expect(early.problems.map((p) => p.code)).toEqual(['waiting']);
    const late = Diagnosis.diagnose(Delivery.journal(), { now: Date.now() + 300000 });
    expect(late.problems.map((p) => p.code)).toEqual(['stuck_waiting']);
    expect(late.problems[0].reason).toContain('финал отложен протоколом');
  });

  test('every programmatic tab activation reports itself to the journal', () => {
    const presence = read('background/human-presence.js');
    const fn = presence.slice(presence.indexOf('function markProgrammaticTabFocus('), presence.indexOf('function consumeProgrammaticTabFocus('));
    expect(fn).toContain("type: 'TRANSPORT_FOCUS'");
    expect(read('results.js')).toContain("'TRANSPORT_FOCUS']");
  });
});

describe('visits give up on answer content, not on activity', () => {
  const presence = read('background/human-presence.js');
  function loadVisits(overrides = {}) {
    const start = presence.indexOf('const HUMAN_VISIT_STATIC_MIN_VISITS');
    const end = presence.indexOf('function raiseHumanVisitAlert(');
    const context = {
      emitTelemetry: jest.fn(),
      reportDispatchPhase: jest.fn(),
      commitIncompleteAnswer: jest.fn(() => true),
      handleLLMResponse: jest.fn(),
      isTerminalEntry: (e) => Boolean(e?.finalStatusRecorded),
      ...overrides
    };
    // eslint-disable-next-line no-new-func
    const factory = new Function(...Object.keys(context), `${presence.slice(start, end)}\nreturn { trackVisitAnswerProgress, commitStaticAnswerAfterVisits };`);
    return { ...factory(...Object.values(context)), context };
  }

  test('growth resets the static count; an unchanged text increments it; visits activity is irrelevant', () => {
    const { trackVisitAnswerProgress } = loadVisits();
    const entry = { answer: 'abc', lastRuntimeActivityAt: 1 };
    expect(trackVisitAnswerProgress(entry).staticVisits).toBe(0);
    entry.lastRuntimeActivityAt = Date.now(); // a visit's own activity
    expect(trackVisitAnswerProgress(entry).staticVisits).toBe(1);
    expect(trackVisitAnswerProgress(entry).staticVisits).toBe(2);
    entry.answer = 'abcd';
    expect(trackVisitAnswerProgress(entry).staticVisits).toBe(0);
  });

  test('static text after the visits gave up is committed as a partial answer; no text is left alone', () => {
    const { commitStaticAnswerAfterVisits, context } = loadVisits();
    const entry = {
      promptSubmittedAt: 1, humanVisits: 6, humanStaticVisits: 3, pendingFinalAnswer: 'готовый текст',
      lastDispatchMeta: { dispatchId: 'X:1:1', runSessionId: 1 }
    };
    expect(commitStaticAnswerAfterVisits('X', entry)).toBe(true);
    expect(context.commitIncompleteAnswer).toHaveBeenCalledWith('X', entry,
      expect.objectContaining({ text: 'готовый текст', source: 'static_answer_snapshot', completionReason: 'static_answer_after_visits' }));
    expect(context.reportDispatchPhase).toHaveBeenCalledWith('X', entry, 'static_answer_committed', expect.objectContaining({ answerChars: 13 }));
    const none = loadVisits();
    expect(none.commitStaticAnswerAfterVisits('X', { promptSubmittedAt: 1, humanStaticVisits: 3, answer: '' })).toBe(false);
    const growing = loadVisits();
    expect(growing.commitStaticAnswerAfterVisits('X', { promptSubmittedAt: 1, humanStaticVisits: 1, answer: 'text' })).toBe(false);
    expect(growing.context.commitIncompleteAnswer).not.toHaveBeenCalled();
  });

  test('the double click on a status indicator asks the model again in the Pipeline panel too', () => {
    const results = read('results.js');
    expect(results).toContain("const indicator = event.target?.closest?.('.status-indicator');");
    expect(results).toContain("triggerManualPing(llmName, indicator, { source: 'status_indicator_dblclick' });");
    // Model blocks of the Pipeline panel render the same indicator with the model name.
    expect(read('pipeline/pipeline-runtime.js')).toContain('class="status-indicator" data-llm-name=');
    // A recovered answer after a committed terminal is a revision, never a second terminal.
    expect(read('background/job-orchestrator.js')).toContain('revision: true,');
  });
});

describe('the bottom nudge (what the status-indicator double click does) in automatic recovery', () => {
  const router = read('background/message-router.js');
  function loadDeferral(entry, nudge) {
    const start = router.indexOf('const UNCERTAIN_TERMINAL_QUIET_MS');
    const end = router.indexOf('const validateCompletionAuthorityDelivery');
    const timers = [];
    const context = {
      jobState: { session: { startTime: 1 }, llms: { X: entry } },
      emitTelemetry: jest.fn(),
      reportDispatchPhase: jest.fn(),
      isTerminalRouterEntry: (e) => Boolean(e?.finalStatusRecorded),
      routerRegisterSessionTimer: (id) => id,
      routerDeregisterSessionTimer: () => {},
      setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length; },
      runPreCollectScrollNudge: nudge,
      resolveBoundTabIdForOrchestrator: () => 7,
      Date
    };
    // eslint-disable-next-line no-new-func
    const factory = new Function(...Object.keys(context), `${router.slice(start, end)}\nreturn { deferUncertainCompletionTerminal };`);
    return { ...factory(...Object.values(context)), timers, context };
  }
  const flush = async () => { for (let i = 0; i < 10; i += 1) await Promise.resolve(); };

  test('the deferral pulls the page to the bottom early and once more before committing, then commits', async () => {
    const entry = { promptSubmittedAt: 1, pendingFinalAnswer: 'готовый текст', lastDispatchMeta: { dispatchId: 'X:1:1' } };
    const nudge = jest.fn(async () => true);
    const { deferUncertainCompletionTerminal, timers, context } = loadDeferral(entry, nudge);
    const finalize = jest.fn();
    const realNow = Date.now;
    deferUncertainCompletionTerminal('X', entry, finalize, { status: 'CONTEXT_LOST', reason: 'context_invalidated' });
    try {
      let offset = 0;
      for (let i = 0; i < 80 && !finalize.mock.calls.length; i += 1) {
        offset += 5000;
        Date.now = () => realNow() + offset;
        const timer = timers.shift();
        if (!timer) break;
        timer.fn();
        await flush();
      }
    } finally {
      Date.now = realNow;
    }
    expect(nudge).toHaveBeenCalledTimes(2);
    expect(nudge).toHaveBeenCalledWith('X', 7, 1, 'deferred_terminal_early', { getIt: true });
    expect(nudge).toHaveBeenCalledWith('X', 7, 1, 'deferred_terminal_before_commit', { getIt: true });
    const phases = context.reportDispatchPhase.mock.calls.map((c) => c[2]);
    expect(phases.filter((p) => p === 'bottom_nudge')).toHaveLength(2);
    expect(phases[phases.length - 1]).toBe('terminal_deferral_ended');
    expect(finalize).toHaveBeenCalledTimes(1);
  });

  test('a nudge that wakes the page (the answer grows or a final arrives) postpones the commit', async () => {
    const entry = { promptSubmittedAt: 1, pendingFinalAnswer: 'a', lastDispatchMeta: { dispatchId: 'X:1:1' } };
    const nudge = jest.fn(async () => { entry.pendingFinalAnswer += 'bcdef'; return true; });
    const { deferUncertainCompletionTerminal, timers } = loadDeferral(entry, nudge);
    const finalize = jest.fn();
    const realNow = Date.now;
    deferUncertainCompletionTerminal('X', entry, finalize, { status: 'AMBIGUOUS', reason: 'ownership_conflict' });
    try {
      let offset = 0;
      for (let i = 0; i < 5; i += 1) {
        offset += 5000;
        Date.now = () => realNow() + offset;
        timers.shift().fn();
        await flush();
      }
      // The page finished by itself after the early nudge: nothing is committed.
      entry.finalStatusRecorded = true;
      offset += 5000;
      Date.now = () => realNow() + offset;
      timers.shift().fn();
      await flush();
    } finally {
      Date.now = realNow;
    }
    expect(finalize).not.toHaveBeenCalled();
  });

  test('visits that give up on static text pull the page down first; growth resumes the visits, otherwise the text is kept', () => {
    const presence = read('background/human-presence.js');
    const block = presence.slice(presence.indexOf('async function settleStaticAnswerAfterVisits('), presence.indexOf('function raiseHumanVisitAlert('));
    expect(block).toContain("'visits_give_up_bottom_nudge', { getIt: true }");
    expect(block).toContain('if (lengthAfter > lengthBefore) {');
    expect(block).toContain('scheduleHumanPresenceLoop(true);');
    expect(block).toContain('commitStaticAnswerAfterVisits(llmName, live);');
    expect(presence).toContain('void settleStaticAnswerAfterVisits(llmName, entry);');
  });
});

describe('forced commit shape, stale background, skipped nudges', () => {
  const coordinator = read('background/dispatch-coordinator.js');

  function loadCommit() {
    const start = coordinator.indexOf('function commitIncompleteAnswer(');
    const end = coordinator.indexOf('function scheduleDispatchRetry(');
    const timers = [];
    const context = {
      jobState: { session: { startTime: 5 }, llms: {} },
      handleLLMResponse: jest.fn(),
      reportDispatchPhase: jest.fn(),
      setTimeout: (fn) => { timers.push(fn); return timers.length; }
    };
    // eslint-disable-next-line no-new-func
    const factory = new Function(...Object.keys(context), `${coordinator.slice(start, end)}\nreturn { commitIncompleteAnswer };`);
    return { ...factory(...Object.values(context)), timers, context };
  }

  test('an incomplete answer is committed with the gate-passing shape and its outcome is journaled', () => {
    const { commitIncompleteAnswer, timers, context } = loadCommit();
    const entry = { lastDispatchMeta: { dispatchId: 'X:1:1', runSessionId: 5 }, status: 'RECEIVING' };
    context.jobState.llms.X = entry;
    expect(commitIncompleteAnswer('X', entry, { text: ' текст ', source: 'deferred_terminal_snapshot', completionReason: 'deferred_terminal_snapshot' })).toBe(true);
    const [, sent, error, meta] = context.handleLLMResponse.mock.calls[0];
    expect(sent).toBe('текст');
    expect(error).toBeNull();
    expect(meta).toMatchObject({
      dispatchId: 'X:1:1', lastResortTerminal: true, preTerminalMaterializeFinal: true, finalizationDeferredCheck: true,
      responseMeta: { partial: true, lateCollectFinal: true, forceTerminalSuccess: true, source: 'deferred_terminal_snapshot' }
    });
    // The gates turned it back into an open request: the report says so.
    timers.shift()();
    expect(context.reportDispatchPhase).toHaveBeenCalledWith('X', entry, 'commit_not_final', expect.objectContaining({ reason: 'status=RECEIVING:deferred_terminal_snapshot' }));
    // And when it became final:
    entry.finalStatusRecorded = true;
    entry.finalStatus = 'PARTIAL';
    commitIncompleteAnswer('X', entry, { text: 'a', source: 's', completionReason: 'c' });
    timers.shift()();
    expect(context.reportDispatchPhase).toHaveBeenLastCalledWith('X', entry, 'incomplete_answer_committed', expect.objectContaining({ reason: 'PARTIAL:s' }));
    expect(commitIncompleteAnswer('X', entry, { text: '   ', source: 's' })).toBe(false);
  });

  test('every dispatch phase names the background build; a build different from the panel is diagnosed', () => {
    expect(coordinator).toContain("backgroundVersion: chrome?.runtime?.getManifest?.()?.version || null,");
    const { Delivery, Diagnosis } = loadModules();
    Delivery.reset();
    Delivery.prepare({ prompt: 'Q', models: ['GPT'], requestIds: { GPT: 'treq-v' } });
    Delivery.observeRuntime({ type: 'TRANSPORT_DISPATCH_PHASE', llmName: 'GPT', transportRequestId: 'treq-v', phase: 'dispatch_started', dispatchId: 'G:1:1', backgroundVersion: '2.81.515' });
    const same = Diagnosis.diagnose(Delivery.journal(), { version: '2.81.515' });
    expect(same.problems.some((p) => p.code === 'stale_background')).toBe(false);
    const other = Diagnosis.diagnose(Delivery.journal(), { version: '2.81.518' });
    expect(other.problems[0]).toMatchObject({ code: 'stale_background', severity: 'critical', reason: 'фон: 2.81.515; панель: 2.81.518' });
  });

  test('a nudge that cannot run says why', () => {
    const router = read('background/message-router.js');
    expect(router).toContain("'bottom_nudge_skipped'");
    expect(router).toContain("skip('no_nudge_function')");
    expect(router).toContain("skip('no_bound_tab')");
  });
});

describe('visits pull the page down when the text stopped changing', () => {
  test('the first unchanged visit is replaced by one bottom nudge per send', () => {
    const presence = read('background/human-presence.js');
    const loop = presence.slice(presence.indexOf('const progress = trackVisitAnswerProgress(liveEntry);'), presence.indexOf('await visitTabWithHumanity(llmName, boundTabId);'));
    expect(loop).toContain('progress.length > 0 && progress.staticVisits >= 1');
    expect(loop).toContain('liveEntry.staticTextNudgedFor !== sendKey');
    expect(loop).toContain("'static_text_bottom_nudge', { getIt: true }");
    expect(loop).toContain("reason: 'static_text'");
  });
});
