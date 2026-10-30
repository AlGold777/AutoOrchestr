/** @jest-environment jsdom */
const fs = require('fs');
const path = require('path');

const load = (file) => window.eval(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'));

function bootstrap() {
  document.head.replaceChildren();
  document.body.replaceChildren();
  delete window.AnswerPipeline;
  delete window.AnswerPipelineConfig;
  delete window.AnswerPipelineSelectors;
  delete window.TurnResolver;
  delete window.AnswerStructure;
  delete window.UnifiedPipelineModules;
  delete window.UnifiedAnswerPipeline;
  load('content-scripts/pipeline-config.js');
  window.AnswerPipelineConfig.streaming.completionCriteria = {
    completionSignalEnabled: false,
    mutationIdle: 35,
    scrollStable: 20,
    contentStable: 20,
    contentStableChecks: 2,
    contentStableDelta: 0,
    minMetCriteria: 4,
    checkInterval: 20,
    copyButtonSignalEnabled: false,
    scoring: { enabled: false }
  };
  load('content-scripts/turn-resolver.js');
  load('content-scripts/answer-structure.js');
  load('content-scripts/pipeline-modules.js');
  window.AnswerPipelineSelectors = {
    PLATFORM_SELECTORS: {
      testmodel: { lastMessage: '.answer-root', messageRoot: '.answer-root', answerContainer: 'main' },
      generic: { lastMessage: '.answer-root', messageRoot: '.answer-root' }
    },
    detectPlatform: () => 'testmodel'
  };
  window.ContentUtils = {
    observeMutations(target, options, callback) {
      const observer = new MutationObserver(callback);
      observer.observe(target, options);
      return () => observer.disconnect();
    }
  };
  load('content-scripts/unified-answer-watcher.js');
}

describe('authoritative answer text linearization', () => {
  beforeEach(bootstrap);

  test('watcher and extractor read exactly the same filtered text', () => {
    document.body.innerHTML = `
      <main><article class="answer-root">
        <section data-testid="thinking-block">private reasoning placeholder</section>
        <div class="final-answer"><p>public answer placeholder</p><pre>code placeholder</pre></div>
        <div role="toolbar"><button>copy placeholder</button></div>
      </article></main>`;
    const Watcher = window.AnswerPipeline.UnifiedAnswerCompletionWatcher;
    const watcher = new Watcher('testmodel');

    class Dummy { constructor() {} start() {} stop() {} }
    class DummyTelemetry { constructor() { this.traceId = 'linearization'; } record() {} logPhase() {} }
    window.UnifiedPipelineModules = {
      ...window.UnifiedPipelineModules,
      AdaptiveTimeoutManager: Dummy, coordinationModes: {}, selectMode: () => ({}),
      IntelligentRetryManager: Dummy, ContinuousHumanActivity: Dummy, MaintenanceScroll: Dummy,
      ComprehensiveTelemetry: DummyTelemetry, PerplexityStabilization: Dummy, HumanSessionController: Dummy
    };
    window.AnswerPipeline.SanityCheck = Dummy;
    load('content-scripts/unified-answer-pipeline.js');
    const pipeline = new window.UnifiedAnswerPipeline('testmodel');
    const node = document.querySelector('.answer-root');
    const watched = watcher.readAnswerText(node);
    const extracted = pipeline.extractText(node);

    // Blocks keep their break (M-6); watcher and extractor still read the same text (next line).
    expect(watched).toBe('public answer placeholder\n\ncode placeholder');
    expect(extracted).toBe(watched);
    expect(watched).not.toContain('reasoning');
    expect(watched).not.toContain('copy');

    // A newer answer with a broadly configured paragraph selector must travel
    // through the same resolver in both observation and extraction.
    document.querySelector('main').insertAdjacentHTML('beforeend',
      '<article class="answer-root"><p>First new paragraph</p><p>Last new paragraph</p></article>');
    watcher.options.answerSelectors = ['p'];
    pipeline.config.answerSelectors = ['p'];
    const latest = document.querySelectorAll('.answer-root')[1];
    expect(watcher.getAnswerElement()).toBe(latest);
    expect(pipeline.getAnswerElement()).toBe(latest);
    expect(pipeline.extractText(pipeline.getAnswerElement())).toBe('First new paragraph\n\nLast new paragraph');
    latest.textContent = '42';
    expect(watcher.getAnswerElement()).toBe(latest);
    expect(pipeline.getAnswerElement()).toBe(latest);
    expect(pipeline.extractText(latest)).toBe('42');

  });

  test('stable thinking tail cannot finish the watcher while filtered answer keeps growing', async () => {
    document.body.innerHTML = `
      <main><article class="answer-root">
        <div class="final-answer"></div>
        <section data-testid="thinking-block">stable private reasoning tail</section>
      </article></main>`;
    const Watcher = window.AnswerPipeline.UnifiedAnswerCompletionWatcher;
    const watcher = new Watcher('testmodel');
    let settled = false;
    const completion = watcher.waitForCompletion({ container: document.querySelector('main') })
      .then((result) => { settled = true; return result; });
    const answer = document.querySelector('.final-answer');
    for (let index = 1; index <= 5; index += 1) {
      await new Promise((resolve) => setTimeout(resolve, 12));
      answer.textContent += ` public-chunk-${index}`;
    }
    expect(settled).toBe(false);
    window.__LLMScrollHardStop = true;
    await new Promise((resolve) => setTimeout(resolve, 30));
    const result = await completion;
    expect(result.completed).toBe(false);
    expect(result.reason).toBe('hard_stop');
    expect(watcher.latestContentLength).toBeGreaterThan(0);
    expect(watcher.latestContentLength).toBeLessThanOrEqual(watcher.readAnswerText(document.querySelector('.answer-root')).length);
    delete window.__LLMScrollHardStop;
  });
});
