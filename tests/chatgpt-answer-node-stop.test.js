/** @jest-environment jsdom */
const fs = require('fs');
const path = require('path');

const loadScript = (filename) => {
  window.eval(fs.readFileSync(path.join(__dirname, '..', filename), 'utf8'));
};

const bootstrap = () => {
  delete window.AnswerPipeline;
  delete window.AnswerPipelineConfig;
  delete window.AnswerPipelineSelectors;
  delete window.TurnResolver;
  delete window.UnifiedPipelineModules;
  delete window.SelectorCircuit;
  delete window.ResponseLifecycleDetector;
  delete window.LLMExtension;
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

const resolveChatGpt = () => window.TurnResolver.resolveTurn({
  platform: 'chatgpt',
  selectors: window.AnswerPipelineSelectors.PLATFORM_SELECTORS.chatgpt,
  anchorAnswerCount: 0,
  minimumTextLength: 1
});

// Блок состояния: span > span, как в живой разметке ChatGPT во время хода.
const status = (text) => `<span><span><div data-markdown-text-style="assistant-message">${text}</div></span></span>`;
const block = (text) => `<div data-markdown-text-style="assistant-message">${text}</div>`;
// Обёртка хода без атрибутов роли: иначе сама обёртка стала бы кандидатом и поглотила блоки.
const turn = (inner) => `<main><section class="turn">${inner}</section></main>`;
const DRAFT = 'Черновик ответа. '.repeat(540).trim();
const FINAL = 'Итоговый ответ по архитектуре. '.repeat(180).trim();

describe('ChatGPT answer node during a turn', () => {
  beforeEach(() => { bootstrap(); setVisibleRects(); });

  test('the last block carrying the delivery token is the answer', () => {
    document.body.innerHTML = turn([
      status('Уточнил план ответа и проверил технические риски'),
      block(DRAFT),
      status('Поиск выполнен на 4 сайтах'),
      block(`${FINAL} [[AO-k7m2qp]]`)
    ].join(''));
    const turnResult = resolveChatGpt();
    expect(turnResult.answerNode.textContent).toMatch(/\[\[AO-k7m2qp\]\]$/);
  });

  test('without a token a progress line at the end is skipped in favour of the last real block', () => {
    document.body.innerHTML = turn([
      status('Уточнил план ответа и проверил технические риски'),
      block(DRAFT),
      status('Проведён аудит архитектуры, список рисков уточнён')
    ].join(''));
    const turnResult = resolveChatGpt();
    expect(turnResult.answerNode.textContent.startsWith('Черновик ответа.')).toBe(true);
  });

  test('a short block without a token is a progress line only when a longer block follows it', () => {
    document.body.innerHTML = turn([
      block('Короткий итог одной строкой.'),
      block(FINAL)
    ].join(''));
    expect(resolveChatGpt().answerNode.textContent.startsWith('Итоговый ответ')).toBe(true);
  });

  test('a lone progress line is still the answer when nothing else is in the turn', () => {
    document.body.innerHTML = turn(status('Уточнил план ответа'));
    expect(resolveChatGpt().answerNode.textContent).toBe('Уточнил план ответа');
  });
});

describe('ChatGPT visible Stop ends the wait only at the general limit', () => {
  beforeEach(() => { bootstrap(); setVisibleRects(); });

  test('silence with Stop visible is not a finish while the lifecycle wait runs', async () => {
    jest.useFakeTimers();
    document.body.innerHTML = `
      <main>
        <article data-message-author-role="assistant">
          <div class="prose">Short partial answer.</div>
        </article>
        <button aria-label="Stop generating" data-testid="stop-button">Stop</button>
      </main>`;
    window.ResponseLifecycleDetector = {
      completionWaitMs: () => 450000,
      getCompletionSnapshot: () => null,
      getTerminalResult: () => null,
      observeWitness: () => true
    };
    try {
      const watcher = new window.AnswerPipeline.UnifiedAnswerCompletionWatcher('chatgpt', { llmName: 'GPT', expectedLength: 'short' });
      let settled = null;
      watcher.waitForCompletion({ container: document.querySelector('main') }).then((r) => { settled = r; });

      // 400 s of silence past the own short hard deadline (100 s), while Stop stays visible.
      for (let i = 0; i < 800; i += 1) { jest.advanceTimersByTime(500); await Promise.resolve(); }
      expect(settled).toBeNull();

      // The general limit: lifecycle wait 450 s plus the 5 s decision margin (455 s), reached at 460 s.
      for (let i = 0; i < 120; i += 1) { jest.advanceTimersByTime(500); await Promise.resolve(); }
      expect(settled).not.toBeNull();
      expect(settled.reason).toBe('stop_stalled');
      expect(settled.completed).toBe(false);
    } finally {
      delete window.ResponseLifecycleDetector;
      jest.useRealTimers();
    }
  });
});

describe('ChatGPT visible Stop without a lifecycle detector', () => {
  beforeEach(() => { bootstrap(); setVisibleRects(); });

  test('the own hard timer (about 200 s) does not end the wait; the profile hardMax does', async () => {
    jest.useFakeTimers();
    document.body.innerHTML = `
      <main>
        <article data-message-author-role="assistant">
          <div class="prose">Short partial answer.</div>
        </article>
        <button aria-label="Stop generating" data-testid="stop-button">Stop</button>
      </main>`;
    try {
      const watcher = new window.AnswerPipeline.UnifiedAnswerCompletionWatcher('chatgpt', { llmName: 'GPT', expectedLength: 'short' });
      let settled = null;
      watcher.waitForCompletion({ container: document.querySelector('main') }).then((r) => { settled = r; });

      // 300 s of silence with Stop visible: past the own hard timer, still before the general limit.
      for (let i = 0; i < 600; i += 1) { jest.advanceTimersByTime(500); await Promise.resolve(); }
      expect(settled).toBeNull();

      // Profile hardMax 450 s plus the 5 s margin: 455 s.
      for (let i = 0; i < 320; i += 1) { jest.advanceTimersByTime(500); await Promise.resolve(); }
      expect(settled).not.toBeNull();
      expect(settled.reason).toBe('stop_stalled');
    } finally {
      jest.useRealTimers();
    }
  });
});
