const fs = require('fs');
const path = require('path');

const loadScript = (filename) => {
  window.eval(fs.readFileSync(path.join(__dirname, '..', filename), 'utf8'));
};

// Drives the production watcher, not a pure function beside it: the gate under
// test is the one `waitForCompletion` actually runs.
const bootstrapWatcher = (streamEvents) => {
  ['AnswerPipeline', 'AnswerPipelineConfig', 'AnswerPipelineSelectors', 'TurnResolver',
    'UnifiedPipelineModules', 'SelectorCircuit', 'RunResultContract', 'ObserverHealth',
    'CompletionEvidenceLadder', 'ProviderStreamSemantics', 'TransportEvidence'
  ].forEach((key) => { delete window[key]; });
  document.head.replaceChildren();
  document.body.replaceChildren();
  window.SelectorCircuit = { shouldUse: jest.fn(() => true), report: jest.fn() };

  const listeners = new Set();
  window.onHumanoidStreamEvent = (listener) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  };
  window.humanoidFetchMonitorState = () => ({ injected: true, hasGenerationContract: true, platform: 'chatgpt' });
  streamEvents.emit = (event) => listeners.forEach((listener) => listener(event));

  loadScript('shared/run-result-contract.js');
  loadScript('shared/observer-health.js');
  loadScript('shared/completion-evidence-ladder.js');
  loadScript('shared/provider-stream-semantics.js');
  loadScript('content-scripts/transport-evidence.js');
  loadScript('content-scripts/pipeline-config.js');
  loadScript('content-scripts/answer-pipeline-selectors.js');
  loadScript('content-scripts/turn-resolver.js');
  loadScript('content-scripts/answer-structure.js');
  loadScript('content-scripts/generation-signal.js');
  loadScript('content-scripts/pipeline-modules.js');
  loadScript('content-scripts/unified-answer-watcher.js');
  window.TransportEvidence.reset();
};

const setVisibleRects = () => {
  Object.defineProperty(window.HTMLElement.prototype, 'getBoundingClientRect', {
    configurable: true,
    value() {
      return { width: 120, height: 32, top: 10, bottom: 42, left: 10, right: 130, x: 10, y: 10, toJSON() { return this; } };
    }
  });
};

const settledAnswerDom = () => {
  document.body.innerHTML = `
    <main>
      <article data-message-author-role="assistant">
        <div class="prose">${'Finished answer text. '.repeat(40)}</div>
      </article>
    </main>
  `;
};

const tick = async (times = 60, ms = 500) => {
  for (let i = 0; i < times; i += 1) {
    jest.advanceTimersByTime(ms);
    await Promise.resolve();
  }
};

describe('watcher: transport evidence gates the commit', () => {
  const streamEvents = {};

  beforeEach(() => {
    bootstrapWatcher(streamEvents);
    setVisibleRects();
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test('an open provider stream vetoes a commit the DOM signals would have made', async () => {
    settledAnswerDom();
    const watcher = new window.AnswerPipeline.UnifiedAnswerCompletionWatcher('chatgpt', { llmName: 'GPT' });

    let settled = null;
    watcher.waitForCompletion({ container: document.querySelector('main') }).then((r) => { settled = r; });

    streamEvents.emit({ kind: 'stream', phase: 'request', at: Date.now(), streamId: 's1', url: '/backend-api/conversation' });
    streamEvents.emit({ kind: 'stream', phase: 'start', at: Date.now(), streamId: 's1' });
    streamEvents.emit({ kind: 'stream', phase: 'first_chunk', at: Date.now(), streamId: 's1' });

    await tick(40);
    // The DOM is quiet and stable, which alone used to be enough.
    expect(watcher.criteria.criteria.contentStable.met).toBe(true);
    expect(settled).toBeNull();
    expect(watcher.lastLadderVerdict.veto.kinds).toContain('stream_open');
  });

  test('a terminal marker correlated only by time does not commit the run', async () => {
    settledAnswerDom();
    const watcher = new window.AnswerPipeline.UnifiedAnswerCompletionWatcher('chatgpt', { llmName: 'GPT' });

    let settled = null;
    watcher.waitForCompletion({ container: document.querySelector('main') }).then((r) => { settled = r; });

    const now = Date.now();
    streamEvents.emit({ kind: 'stream', phase: 'request', at: now, streamId: 's1', url: '/backend-api/conversation' });
    streamEvents.emit({ kind: 'stream', phase: 'start', at: now, streamId: 's1' });
    streamEvents.emit({
      kind: 'stream', phase: 'terminal_marker', at: now, streamId: 's1',
      markerKind: 'stream_done_token', terminalReason: 'STOP'
    });
    streamEvents.emit({ kind: 'stream', phase: 'end', at: now, streamId: 's1', bytes: 900, chunkCount: 7, terminalMarkerSeen: true });

    await tick(20);

    // The watcher records the transport marker but has no terminal authority.
    expect(settled).toBeNull();
    expect(watcher.lastLadderVerdict.strongestClass).toBe('P0');
    expect(watcher.lastTransportSnapshot.streamOpen).toBe(false);
    expect(watcher.lastLadderVerdict.guarantee).toBe('DEGRADED');
    expect(watcher.lastLadderVerdict.reasons).toContain('terminal_fact_not_attributed_to_this_run');
  });

  test('the run proof names the dispatch it claims to be about', async () => {
    settledAnswerDom();
    const watcher = new window.AnswerPipeline.UnifiedAnswerCompletionWatcher('chatgpt', { llmName: 'GPT' });

    let settled = null;
    watcher.waitForCompletion({
      container: document.querySelector('main'),
      dispatchId: 'GPT:1781159284885:3'
    }).then((r) => { settled = r; });

    await tick(40);

    expect(settled).toBeNull();
    expect(watcher.buildRunProof('witness_only', false).serialize().dispatchId).toBe('GPT:1781159284885:3');
  });

  test('a DOM-only completion remains a witness and never commits', async () => {
    settledAnswerDom();
    // No transport observer available at all: the DOM is the only witness.
    window.humanoidFetchMonitorState = () => ({ injected: false, hasGenerationContract: false });
    window.TransportEvidence.reset();

    const watcher = new window.AnswerPipeline.UnifiedAnswerCompletionWatcher('chatgpt', { llmName: 'GPT' });
    let settled = null;
    watcher.waitForCompletion({ container: document.querySelector('main') }).then((r) => { settled = r; });

    await tick(40);

    expect(settled).toBeNull();
    const proof = watcher.buildRunProof('witness_only', false).serialize();
    expect(proof.type).not.toBe('COMMITTED');
    expect(proof.axes.terminality).not.toBe('proven');
  });

  test('text shorter than its own maximum vetoes the commit until it recovers', async () => {
    document.body.innerHTML = `
      <main>
        <article data-message-author-role="assistant">
          <div class="prose">${'Long answer body. '.repeat(60)}</div>
        </article>
      </main>
    `;
    window.humanoidFetchMonitorState = () => ({ injected: false, hasGenerationContract: false });
    window.TransportEvidence.reset();

    const watcher = new window.AnswerPipeline.UnifiedAnswerCompletionWatcher('chatgpt', { llmName: 'GPT' });
    let settled = null;
    watcher.waitForCompletion({ container: document.querySelector('main') }).then((r) => { settled = r; });

    await tick(2);
    // The turn re-renders and the visible answer collapses to a fragment.
    document.querySelector('.prose').textContent = 'Long answer body.';
    await tick(30);

    expect(settled).toBeNull();
    expect(watcher.lastLadderVerdict.veto.kinds).toContain('text_shrunk');
  });

  test('a hard timeout still ends the run, and is typed as unproven rather than done', async () => {
    document.body.innerHTML = `
      <main>
        <article data-message-author-role="assistant">
          <div class="prose">short</div>
        </article>
        <button aria-label="Stop generating" data-testid="stop-button">Stop</button>
      </main>
    `;
    const adaptive = window.AnswerPipelineConfig.streaming.adaptiveTimeout;
    const savedHardMax = adaptive.hardMax;
    adaptive.hardMax = 300000;
    try {
      const watcher = new window.AnswerPipeline.UnifiedAnswerCompletionWatcher('chatgpt', { llmName: 'GPT' });
      let settled = null;
      watcher.waitForCompletion({ container: document.querySelector('main') }).then((r) => { settled = r; });

      // 230 s: собственный hard истёк, но общий предел (305 s) ещё нет, при видимом Stop ответ не закрыт.
      await tick(460);
      expect(settled).toBeNull();

      // 315 s: общий предел достигнут, завершение только как hard_timeout.
      await tick(170);
      expect(settled).not.toBeNull();
      expect(settled.reason).toBe('hard_timeout');
      expect(settled.completed).toBe(false);
      expect(['UNKNOWN', 'SUSPECTED_COMPLETE']).toContain(settled.runProof.type);
      expect(settled.runProof.textReadable).toBe(false);
    } finally {
      adaptive.hardMax = savedHardMax;
    }
  });

  test('the detector tick names why it did not conclude, in the form the export keeps', async () => {
    settledAnswerDom();
    const sent = [];
    global.chrome = Object.assign({}, global.chrome, {
      runtime: Object.assign({}, global.chrome?.runtime, {
        id: 'test-extension',
        sendMessage: (message) => { sent.push(message); }
      })
    });

    const watcher = new window.AnswerPipeline.UnifiedAnswerCompletionWatcher('chatgpt', { llmName: 'GPT' });
    watcher.waitForCompletion({ container: document.querySelector('main') });

    streamEvents.emit({ kind: 'stream', phase: 'request', at: Date.now(), streamId: 's1', url: '/backend-api/conversation' });
    streamEvents.emit({ kind: 'stream', phase: 'start', at: Date.now(), streamId: 's1' });
    streamEvents.emit({ kind: 'stream', phase: 'first_chunk', at: Date.now(), streamId: 's1' });

    await tick(40);

    const ticks = sent.filter((m) => m?.event?.label === 'DETECTOR_TICK');
    expect(ticks.length).toBeGreaterThan(0);
    const reasons = new Set(ticks.map((m) => m.event.meta.reason));
    // The stream is open, so every tick must say so rather than staying silent.
    expect([...reasons].some((reason) => reason.startsWith('veto:stream_open'))).toBe(true);
    expect([...reasons].every((reason) => reason.includes('transport:'))).toBe(true);
    // Low cardinality is the contract: the ledger keeps ten distinct reasons.
    expect(reasons.size).toBeLessThanOrEqual(4);
  });

  test('a run with no fresh answer says exactly that', async () => {
    document.body.innerHTML = '<main><article data-message-author-role="assistant"><div class="prose"></div></article></main>';
    const watcher = new window.AnswerPipeline.UnifiedAnswerCompletionWatcher('chatgpt', { llmName: 'GPT' });
    watcher.waitForCompletion({ container: document.querySelector('main') });
    await tick(20);

    expect(watcher.describeEvidenceState()).toMatch(/^no_fresh_answer\|transport:/);
  });
});
