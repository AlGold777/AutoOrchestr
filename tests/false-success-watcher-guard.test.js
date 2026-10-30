const fs = require('fs');
const path = require('path');

const loadScript = (filename) => {
  window.eval(fs.readFileSync(path.join(__dirname, '..', filename), 'utf8'));
};

const bootstrapWatcher = () => {
  delete window.AnswerPipeline;
  delete window.AnswerPipelineConfig;
  delete window.AnswerPipelineSelectors;
  delete window.TurnResolver;
  delete window.UnifiedPipelineModules;
  delete window.SelectorCircuit;
  document.head.replaceChildren();
  document.body.replaceChildren();
  window.SelectorCircuit = { shouldUse: jest.fn(() => true), report: jest.fn() };
  loadScript('content-scripts/pipeline-config.js');
  loadScript('content-scripts/answer-pipeline-selectors.js');
  loadScript('content-scripts/turn-resolver.js');
  loadScript('content-scripts/answer-structure.js');
  loadScript('content-scripts/generation-signal.js');
  loadScript('content-scripts/pipeline-modules.js');
  loadScript('content-scripts/unified-answer-watcher.js');
};

const setVisibleRects = () => {
  Object.defineProperty(window.HTMLElement.prototype, 'getBoundingClientRect', {
    configurable: true,
    value() {
      return { width: 120, height: 32, top: 10, bottom: 42, left: 10, right: 130, x: 10, y: 10, toJSON() { return this; } };
    }
  });
};

describe('false success: watcher completion guards', () => {
  beforeEach(() => { bootstrapWatcher(); setVisibleRects(); });

  test('visible Stop blocks success after soft deadline and ends only as hard timeout', async () => {
    jest.useFakeTimers();
    document.body.innerHTML = `
      <main>
        <article data-message-author-role="assistant">
          <div class="prose">${'Partial answer text. '.repeat(30)}</div>
        </article>
        <button aria-label="Stop generating" data-testid="stop-button">Stop</button>
      </main>
    `;

    const watcher = new window.AnswerPipeline.UnifiedAnswerCompletionWatcher('chatgpt', { llmName: 'GPT' });

    expect(watcher.getStopVisible()).toBe(true);
    expect(window.GenerationSignal.inspect({
      selectors: window.AnswerPipelineSelectors.PLATFORM_SELECTORS.chatgpt
    }).active).toBe(true);

    // Общий предел при видимом Stop: hardMax профиля (+ запас 5 с), здесь 300 с.
    const adaptive = window.AnswerPipelineConfig.streaming.adaptiveTimeout;
    const savedHardMax = adaptive.hardMax;
    adaptive.hardMax = 300000;
    try {
      let settled = null;
      watcher.waitForCompletion({ container: document.querySelector('main') })
        .then((r) => { settled = r; });

      for (let i = 0; i < 40; i += 1) { jest.advanceTimersByTime(500); await Promise.resolve(); }
      const at20s = settled;

      for (let i = 0; i < 460; i += 1) { jest.advanceTimersByTime(500); await Promise.resolve(); }
      // 250 s: собственный hard watcher уже истёк, общий предел (305 s) ещё нет.
      const beforeHardDeadline = settled;
      expect(watcher.timeoutManager.checkExpiration().hardExpired).toBe(true);
      expect(beforeHardDeadline).toBeNull();

      for (let i = 0; i < 120; i += 1) { jest.advanceTimersByTime(500); await Promise.resolve(); }
      const afterHardDeadline = settled;

      expect(document.querySelector('button[data-testid="stop-button"]')).not.toBeNull();
      expect(at20s).toBeNull();
      expect(afterHardDeadline).not.toBeNull();
      expect(afterHardDeadline.reason).toBe('stop_stalled');
      expect(afterHardDeadline.completed).toBe(false);
      expect(watcher.getStopVisible()).toBe(true);
    } finally {
      adaptive.hardMax = savedHardMax;
      jest.useRealTimers();
    }
  });

  test('expected very-long answer selects the profile hard maximum', () => {
    document.body.innerHTML = `<main><article data-message-author-role="assistant"><div class="prose">x</div></article></main>`;
    const watcher = new window.AnswerPipeline.UnifiedAnswerCompletionWatcher('chatgpt', { llmName: 'GPT', expectedLength: 'veryLong' });
    const t = watcher.timeoutManager.calculateTimeout(watcher.getCurrentContentLength());
    expect(t.soft).toBe(450000);
    expect(t.hard).toBe(450000);
  });

  test('content growth extends a short deadline without exceeding hardMax', () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
    try {
      const watcher = new window.AnswerPipeline.UnifiedAnswerCompletionWatcher('chatgpt', { llmName: 'GPT' });
      const initial = watcher.timeoutManager.calculateTimeout(1);
      const grown = watcher.timeoutManager.recalculateOnGrowth(6000);

      expect(initial).toEqual({ soft: 50000, hard: 100000 });
      expect(grown.softRemaining).toBe(450000);
      expect(grown.hardRemaining).toBe(450000);
    } finally {
      jest.useRealTimers();
    }
  });

  test('while the lifecycle detector tracks the dispatch, only its terminal result ends the wait', async () => {
    jest.useFakeTimers();
    document.body.innerHTML = `
      <main>
        <article data-message-author-role="assistant">
          <div class="prose">Short partial answer.</div>
        </article>
      </main>
    `;
    let terminal = null;
    window.ResponseLifecycleDetector = {
      completionWaitMs: () => 450000,
      getCompletionSnapshot: () => ({ facts: {} }),
      getTerminalResult: () => terminal,
      observeWitness: () => true
    };
    try {
      const watcher = new window.AnswerPipeline.UnifiedAnswerCompletionWatcher('chatgpt', { llmName: 'GPT', expectedLength: 'short' });
      let settled = null;
      watcher.waitForCompletion({ container: document.querySelector('main') }).then((r) => { settled = r; });

      // Past the watcher's own short soft (50 s) and hard (100 s) deadlines.
      for (let i = 0; i < 600; i += 1) { jest.advanceTimersByTime(500); await Promise.resolve(); }
      expect(settled).toBeNull();

      terminal = { status: 'STALLED', reason: 'timeout_hard' };
      for (let i = 0; i < 4; i += 1) { jest.advanceTimersByTime(500); await Promise.resolve(); }
      expect(settled).not.toBeNull();
      expect(settled.terminalResult).toEqual(terminal);
      expect(settled.completed).toBe(false);
    } finally {
      delete window.ResponseLifecycleDetector;
      jest.useRealTimers();
    }
  });
});
