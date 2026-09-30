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
