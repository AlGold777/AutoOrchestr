// Tri-state completion contract (review idea P0.2 + localized stop-button fix):
// completion is inferred only from a CONFIRMED-absent stop button. A present stop
// button — including localized labels (Arrêter/Останов) that the old /stop/i regex
// missed — must block completion. A clean page must still complete (no over-blocking).
const fs = require('fs');
const path = require('path');

const loadScript = (filename) => {
  const content = fs.readFileSync(path.join(__dirname, '..', filename), 'utf8');
  // eslint-disable-next-line no-eval
  eval(content);
};

const setRect = (el, { top, left, width, height }) => {
  el.getBoundingClientRect = () => ({
    top, left, width, height,
    right: left + width, bottom: top + height, x: left, y: top
  });
  Object.defineProperty(el, 'offsetWidth', { configurable: true, value: width });
  Object.defineProperty(el, 'offsetHeight', { configurable: true, value: height });
};

describe('tri-state completion (stop-button)', () => {
  let sentMessages;

  beforeEach(() => {
    delete window.LLMExtension;
    delete window.ResponseLifecycleDetector;
    document.head.replaceChildren();
    document.body.replaceChildren();
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1280 });
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 900 });
    sentMessages = [];
    global.chrome.runtime.sendMessage = (message, callback) => {
      sentMessages.push(message);
      if (typeof callback === 'function') callback(message?.type === 'LLM_COMPLETION_ATTEMPT'
        ? { status: 'completion_attempt_recorded' }
        : {});
    };
    window.chrome = global.chrome;
    loadScript('content-utils/response-lifecycle-detector.js');
    const startLifecycle = window.ResponseLifecycleDetector.startResponseLifecycleTracking;
    window.ResponseLifecycleDetector.startResponseLifecycleTracking = (options) => startLifecycle({ ...options, activateObservation: true });
    loadScript('content-scripts/answer-pipeline-selectors.js');
    loadScript('content-scripts/turn-resolver.js');
    loadScript('content-scripts/answer-structure.js');
    loadScript('content-scripts/generation-signal.js');
    loadScript('shared/answer-verification.js');
    window.AnswerPipelineConfig = {
      finalization: { stabilityChecks: 2, stabilityRetryBudget: 1, stabilityInterval: 5 }
    };
  });

  const completeEvents = () => sentMessages.filter((m) =>
    m?.type === 'LLM_DIAGNOSTIC_EVENT' && m?.event?.label === 'ANSWER_COMPLETE_DETECTED');
  const readyEvents = () => sentMessages.filter((m) => m?.type === 'LLM_RESPONSE_READY');

  const runTracking = async (modelName) => {
    const detector = window.ResponseLifecycleDetector;
    const oldAnswer = document.createElement('article');
    oldAnswer.setAttribute('data-message-author-role', 'assistant');
    oldAnswer.textContent = 'Old response that existed before this dispatch and must not complete it.';
    setRect(oldAnswer, { top: 420, left: 140, width: 720, height: 180 });
    document.body.appendChild(oldAnswer);
    detector.registerAnswerCandidate({ modelName, element: oldAnswer, observedAt: Date.now(), traceId: `d-${modelName}` });
    const submittedAt = Date.now();
    await detector.startResponseLifecycleTracking({ modelName, dispatchId: `d-${modelName}`, runSessionId: 77, promptSubmittedAt: submittedAt, traceId: `d-${modelName}` });
    const answer = document.createElement('article');
    answer.setAttribute('data-message-author-role', 'assistant');
    answer.textContent = 'Stable generated answer long enough to be treated as a real response by the detector.';
    setRect(answer, { top: 540, left: 140, width: 720, height: 180 });
    document.body.appendChild(answer);
    detector.registerAnswerCandidate({ modelName, element: answer, observedAt: Date.now(), traceId: `d-${modelName}` });
    const start = await detector.waitForAnswerStart({ modelName, promptSubmittedAt: submittedAt, timeoutMs: 200, pollIntervalMs: 10, traceId: `d-${modelName}` });
    expect(start.ok).toBe(true);
    const completionResult = await detector.waitForAnswerComplete({ modelName, timeoutMs: 600, stableMs: 60, pollIntervalMs: 20 });
    detector.stopResponseLifecycleTracking({ modelName, reason: 'test_done' });
    return completionResult;
  };

  test('stored legacy disable/shadow settings cannot turn off production Completion authority', async () => {
    const originalGet = global.chrome.storage.local.get;
    window.ResponseLifecycleDetector.dispose({ reason: 'settings_test_reload' });
    delete window.LLMExtension;
    delete window.ResponseLifecycleDetector;
    global.chrome.storage.local.get = jest.fn(async () => ({
      responseLifecycleDetectorSettings: {
        enabled: false,
        completionProtocolV2: 'shadow',
        allowLegacyCompletionRollout: false
      }
    }));
    loadScript('content-utils/response-lifecycle-detector.js');
    const detector = window.ResponseLifecycleDetector;
    const result = await detector.startResponseLifecycleTracking({
      modelName: 'GPT', dispatchId: 'mandatory-authority', runSessionId: 77, promptSubmittedAt: Date.now(), activateObservation: true
    });
    expect(result.ok).toBe(true);
    expect(detector.getCompletionSnapshot({ modelName: 'GPT', dispatchId: 'mandatory-authority' }).rolloutMode)
      .toBe('enforced');
    detector.stopResponseLifecycleTracking({ modelName: 'GPT', reason: 'test_done' });
    global.chrome.storage.local.get = originalGet;
  });

  test('a present localized stop button (Arrêter) blocks completion', async () => {
    const stop = document.createElement('button');
    stop.setAttribute('aria-label', 'Arrêter la génération');
    setRect(stop, { top: 740, left: 140, width: 40, height: 40 });
    document.body.appendChild(stop);

    await runTracking('Grok');

    expect(completeEvents()).toHaveLength(0);
    expect(readyEvents()).toHaveLength(0);
  });

  test('a clean page (confirmed-absent stop) still completes', async () => {
    const completionResult = await runTracking('GPT');
    expect(completionResult).toEqual(expect.objectContaining({ ok: true, state: 'COMPLETE' }));
    expect(completeEvents().length).toBeGreaterThanOrEqual(1);
    expect(readyEvents()).toEqual([
      expect.objectContaining({
        answerText: expect.stringContaining('Stable generated answer'),
        meta: expect.objectContaining({
          textLength: expect.any(Number),
          answerHash: expect.any(String)
        })
      })
    ]);
  });

  test('an empty-chat composer cannot hide the first short answer or rewrite its delivery', async () => {
    loadScript('shared/answer-content-classifier.js');
    const detector = window.ResponseLifecycleDetector;
    document.body.innerHTML = '<main><form><textarea placeholder="Ask anything"></textarea></form></main>';
    window.ContentUtils = { ensureDispatchMeta: (meta) => ({ ...meta, generationEpoch: 1 }) };
    const tracked = await detector.startResponseLifecycleTracking({
      modelName: 'GPT', dispatchId: 'first-short', runSessionId: 77,
      generationEpoch: 1, baselineText: '', traceId: 'first-short'
    });
    expect(tracked.tracker.turnAnchor).toBe(0);
    tracked.tracker.navigationUrl = 'https://chatgpt.com/';
    detector.notePromptSendAttempt({ modelName: 'GPT', dispatchId: 'first-short', runSessionId: 77 });
    window.dispatchEvent(new CustomEvent('LLM_CODEX_SPA_NAVIGATION', { detail: {
      llmName: 'GPT', previousUrl: 'https://chatgpt.com/', nextUrl: 'https://chatgpt.com/c/first-short'
    } }));
    expect(detector.isTrackerActive(tracked.tracker)).toBe(true);
    const answer = document.createElement('div');
    answer.setAttribute('data-message-author-role', 'assistant');
    answer.innerHTML = '<p><strong>2</strong></p>';
    setRect(answer, { top: 300, left: 140, width: 720, height: 80 });
    document.querySelector('main').prepend(answer);
    detector.registerAnswerCandidate({ modelName: 'GPT', element: answer, traceId: 'first-short' });
    await detector.waitForAnswerStart({ modelName: 'GPT', promptSubmittedAt: Date.now(), timeoutMs: 200, pollIntervalMs: 10, traceId: 'first-short' });
    const completion = await detector.waitForAnswerComplete({ modelName: 'GPT', timeoutMs: 900, stableMs: 40, pollIntervalMs: 10 });
    expect(completion).toEqual(expect.objectContaining({ ok: true }));
    expect(readyEvents()).toEqual([expect.objectContaining({ answerText: '2', meta: expect.objectContaining({
      extractionSnapshot: expect.objectContaining({ text: '2', html: '<p><strong>2</strong></p>' })
    }) })]);
    const broadResolver = jest.fn(async () => ({ ok: true, element: document.querySelector('main') }));
    window.LLMExtension.SelectorResolverV2 = { resolveLatestAssistantAnswer: broadResolver };
    const message = { type: 'LLM_RESPONSE', llmName: 'GPT', answer: '2', html: answer.innerHTML };
    chrome.runtime.sendMessage(message);
    expect(sentMessages).toContain(message);
    expect(broadResolver).not.toHaveBeenCalled();
    detector.stopResponseLifecycleTracking({ modelName: 'GPT', reason: 'test_done' });
    delete window.ContentUtils;
  });

  test('lifecycle completion carries strict structural proof for the anchored new turn', async () => {
    delete window.AnswerPipelineSelectors;
    delete window.TurnResolver;
    delete window.AnswerStructure;
    delete window.GenerationSignal;
    delete window.AnswerVerification;
    loadScript('content-scripts/answer-pipeline-selectors.js');
    loadScript('content-scripts/turn-resolver.js');
    loadScript('content-scripts/answer-structure.js');
    loadScript('content-scripts/generation-signal.js');
    loadScript('shared/answer-verification.js');
    window.AnswerPipelineConfig = {
      finalization: { stabilityChecks: 2, stabilityRetryBudget: 0, stabilityInterval: 5 }
    };
    window.ContentUtils = {
      ensureDispatchMeta: (meta) => ({ ...meta, generationEpoch: 3 })
    };

    const detector = window.ResponseLifecycleDetector;
    const oldAnswer = document.createElement('div');
    oldAnswer.className = 'ds-markdown';
    oldAnswer.textContent = 'Old DeepSeek answer that belongs to the previous turn.';
    setRect(oldAnswer, { top: 360, left: 140, width: 720, height: 120 });
    document.body.appendChild(oldAnswer);
    detector.registerAnswerCandidate({ modelName: 'DeepSeek', element: oldAnswer, traceId: 'deepseek-proof' });

    const submittedAt = Date.now();
    const trackingStarted = detector.startResponseLifecycleTracking({
      modelName: 'DeepSeek',
      dispatchId: 'deepseek-proof',
      runSessionId: 93,
      promptSubmittedAt: submittedAt,
      traceId: 'deepseek-proof',
      baselineText: oldAnswer.textContent
    });

    // The provider may insert the new assistant node immediately after Send.
    // Baseline priming must therefore capture the old turn synchronously,
    // without waiting for settings/storage resolution.
    const newAnswer = document.createElement('div');
    newAnswer.className = 'ds-markdown';
    newAnswer.textContent = 'New stable DeepSeek answer with enough meaningful content. B2-END-S1';
    setRect(newAnswer, { top: 520, left: 140, width: 720, height: 160 });
    document.body.appendChild(newAnswer);
    const inactiveStop = document.createElement('button');
    inactiveStop.setAttribute('aria-label', 'Stop generating');
    inactiveStop.disabled = true;
    document.body.appendChild(inactiveStop);
    await trackingStarted;
    detector.registerAnswerCandidate({ modelName: 'DeepSeek', element: newAnswer, traceId: 'deepseek-proof' });

    const start = await detector.waitForAnswerStart({
      modelName: 'DeepSeek',
      promptSubmittedAt: submittedAt,
      timeoutMs: 200,
      pollIntervalMs: 10,
      traceId: 'deepseek-proof'
    });
    expect(start.ok).toBe(true);
    await detector.waitForAnswerComplete({
      modelName: 'DeepSeek',
      timeoutMs: 800,
      stableMs: 60,
      pollIntervalMs: 20,
      traceId: 'deepseek-proof'
    });

    const ready = readyEvents().at(-1);
    expect(ready?.meta?.answerVerification).toEqual(expect.objectContaining({
      verified: true,
      resolution: 'exact',
      structuralComplete: true,
      generationActive: false,
      runSessionId: 93,
      dispatchId: 'deepseek-proof',
      generationEpoch: 3,
      turnAnchor: 1
    }));
    expect(ready.answerText).toContain('B2-END-S1');
    detector.stopResponseLifecycleTracking({ modelName: 'DeepSeek', reason: 'test_done' });
  });

  test('lifecycle structural verifier cannot finalize a smaller post-regression plateau', async () => {
    delete window.AnswerPipelineSelectors;
    delete window.TurnResolver;
    delete window.AnswerStructure;
    delete window.GenerationSignal;
    delete window.AnswerVerification;
    loadScript('content-scripts/answer-pipeline-selectors.js');
    loadScript('content-scripts/turn-resolver.js');
    loadScript('content-scripts/answer-structure.js');
    loadScript('content-scripts/generation-signal.js');
    loadScript('shared/answer-verification.js');
    window.AnswerPipelineConfig = {
      finalization: { stabilityChecks: 4, stabilityRetryBudget: 2, stabilityInterval: 15 }
    };
    window.ContentUtils = {
      ensureDispatchMeta: (meta) => ({ ...meta, generationEpoch: 4 })
    };

    const answer = document.createElement('div');
    answer.className = 'ds-markdown';
    answer.textContent = 'L'.repeat(400);
    setRect(answer, { top: 520, left: 140, width: 720, height: 160 });
    document.body.appendChild(answer);
    const detector = window.ResponseLifecycleDetector;
    const tracker = detector.createTracker({
      modelName: 'DeepSeek',
      dispatchId: 'deepseek-length-regression',
      runSessionId: 94,
      promptSubmittedAt: Date.now()
    });
    tracker.turnAnchor = 0;
    const shrinkTimer = setTimeout(() => { answer.textContent = 'S'.repeat(100); }, 5);
    const proof = await detector.verifyStructuralCompletion(tracker);
    clearTimeout(shrinkTimer);

    expect(proof).toEqual(expect.objectContaining({
      verified: false,
      state: 'candidate',
      maxObservedTextLength: 400,
      lengthDecreaseCount: 1,
      lengthRegressionActive: true,
      lengthRegressionFloor: 400,
      reasons: expect.arrayContaining(['answer_length_regression_unrecovered'])
    }));
  });

  test('platform generation config ignores an unrelated generic loading element', async () => {
    delete window.AnswerPipelineSelectors;
    delete window.TurnResolver;
    delete window.AnswerStructure;
    delete window.GenerationSignal;
    delete window.AnswerVerification;
    loadScript('content-scripts/answer-pipeline-selectors.js');
    loadScript('content-scripts/turn-resolver.js');
    loadScript('content-scripts/answer-structure.js');
    loadScript('content-scripts/generation-signal.js');
    loadScript('shared/answer-verification.js');
    window.AnswerPipelineConfig = {
      finalization: { stabilityChecks: 2, stabilityRetryBudget: 0, stabilityInterval: 5 }
    };
    window.ContentUtils = {
      ensureDispatchMeta: (meta) => ({ ...meta, generationEpoch: 4 })
    };

    const detector = window.ResponseLifecycleDetector;
    const oldAnswer = document.createElement('section');
    oldAnswer.dataset.role = 'assistant';
    oldAnswer.textContent = 'Previous GPT answer.';
    setRect(oldAnswer, { top: 300, left: 100, width: 700, height: 100 });
    document.body.appendChild(oldAnswer);
    detector.registerAnswerCandidate({ modelName: 'GPT', element: oldAnswer, traceId: 'gpt-config' });
    const submittedAt = Date.now();
    await detector.startResponseLifecycleTracking({
      modelName: 'GPT',
      dispatchId: 'gpt-config',
      runSessionId: 94,
      promptSubmittedAt: submittedAt,
      traceId: 'gpt-config'
    });

    const unrelated = document.createElement('div');
    unrelated.className = 'loading';
    unrelated.textContent = 'Persistent page service';
    setRect(unrelated, { top: 50, left: 50, width: 100, height: 20 });
    document.body.appendChild(unrelated);
    const inactiveStop = document.createElement('button');
    inactiveStop.setAttribute('aria-label', 'Stop generating');
    inactiveStop.disabled = true;
    document.body.appendChild(inactiveStop);
    const answer = document.createElement('section');
    answer.dataset.role = 'assistant';
    answer.textContent = 'New stable GPT answer that must complete despite unrelated page loading UI.';
    setRect(answer, { top: 480, left: 100, width: 700, height: 140 });
    document.body.appendChild(answer);
    detector.registerAnswerCandidate({ modelName: 'GPT', element: answer, traceId: 'gpt-config' });

    const start = await detector.waitForAnswerStart({
      modelName: 'GPT',
      promptSubmittedAt: submittedAt,
      timeoutMs: 200,
      pollIntervalMs: 10,
      traceId: 'gpt-config'
    });
    expect(start.ok).toBe(true);
    await detector.waitForAnswerComplete({
      modelName: 'GPT',
      timeoutMs: 800,
      stableMs: 60,
      pollIntervalMs: 20,
      traceId: 'gpt-config'
    });
    expect(readyEvents().at(-1)?.meta?.answerVerification).toEqual(expect.objectContaining({
      verified: true,
      generationActive: false,
      resolution: 'exact'
    }));
    detector.stopResponseLifecycleTracking({ modelName: 'GPT', reason: 'test_done' });
  });

  test('body mutations wake completion checks without waiting for a throttled poll timer', async () => {
    delete window.AnswerPipelineSelectors;
    delete window.TurnResolver;
    delete window.AnswerStructure;
    delete window.GenerationSignal;
    delete window.AnswerVerification;
    loadScript('content-scripts/answer-pipeline-selectors.js');
    loadScript('content-scripts/turn-resolver.js');
    loadScript('content-scripts/answer-structure.js');
    loadScript('content-scripts/generation-signal.js');
    loadScript('shared/answer-verification.js');
    window.AnswerPipelineConfig = {
      finalization: { stabilityChecks: 2, stabilityRetryBudget: 1, stabilityInterval: 5 }
    };
    window.ContentUtils = {
      ensureDispatchMeta: (meta) => ({ ...meta, generationEpoch: 4 })
    };

    const detector = window.ResponseLifecycleDetector;
    const oldAnswer = document.createElement('div');
    oldAnswer.setAttribute('data-message-author-role', 'assistant');
    oldAnswer.textContent = 'Old answer before event-driven lifecycle wake.';
    setRect(oldAnswer, { top: 320, left: 140, width: 720, height: 120 });
    document.body.appendChild(oldAnswer);

    const submittedAt = Date.now();
    await detector.startResponseLifecycleTracking({
      modelName: 'GPT',
      dispatchId: 'gpt-mutation-wake',
      runSessionId: 94,
      promptSubmittedAt: submittedAt,
      traceId: 'gpt-mutation-wake',
      baselineText: oldAnswer.textContent,
      turnAnchor: 1
    });

    const newAnswer = document.createElement('div');
    newAnswer.setAttribute('data-message-author-role', 'assistant');
    newAnswer.textContent = 'New answer that will settle after the external Stop control disappears.';
    setRect(newAnswer, { top: 500, left: 140, width: 720, height: 160 });
    document.body.appendChild(newAnswer);
    detector.registerAnswerCandidate({ modelName: 'GPT', element: newAnswer, traceId: 'gpt-mutation-wake' });

    const stop = document.createElement('button');
    stop.setAttribute('data-testid', 'stop-button');
    setRect(stop, { top: 720, left: 140, width: 40, height: 40 });
    document.body.appendChild(stop);

    const start = await detector.waitForAnswerStart({
      modelName: 'GPT',
      promptSubmittedAt: submittedAt,
      timeoutMs: 200,
      pollIntervalMs: 10,
      traceId: 'gpt-mutation-wake'
    });
    expect(start.ok).toBe(true);

    const completion = detector.waitForAnswerComplete({
      modelName: 'GPT',
      timeoutMs: 1200,
      stableMs: 20,
      pollIntervalMs: 60000,
      traceId: 'gpt-mutation-wake'
    });
    setTimeout(() => {
      newAnswer.textContent += ' Final.';
    }, 30);
    setTimeout(() => {
      stop.disabled = true;
      const wakeMarker = document.createElement('span');
      wakeMarker.hidden = true;
      document.body.appendChild(wakeMarker);
    }, 90);

    const result = await completion;
    expect(result).toEqual(expect.objectContaining({ ok: true, state: 'COMPLETE' }));
    expect(readyEvents().at(-1)?.meta?.answerVerification).toEqual(expect.objectContaining({
      verified: true,
      turnAnchor: 1
    }));
    detector.stopResponseLifecycleTracking({ modelName: 'GPT', reason: 'test_done' });
  });

  test('Qwen reasoning-only snapshot stays non-terminal while structural proof is unavailable', async () => {
    const detector = window.ResponseLifecycleDetector;
    const oldAnswer = document.createElement('article');
    oldAnswer.textContent = 'Old Qwen response from before dispatch.';
    setRect(oldAnswer, { top: 420, left: 140, width: 720, height: 120 });
    document.body.appendChild(oldAnswer);
    detector.registerAnswerCandidate({ modelName: 'Qwen', element: oldAnswer, traceId: 'qwen-phase' });
    const submittedAt = Date.now();
    await detector.startResponseLifecycleTracking({
      modelName: 'Qwen',
      dispatchId: 'qwen-phase',
      runSessionId: 91,
      promptSubmittedAt: submittedAt,
      traceId: 'qwen-phase'
    });

    const reasoning = document.createElement('article');
    reasoning.className = 'thinking-panel';
    reasoning.textContent = 'Reasoning in progress with enough meaningful content to pass the generic content classifier.';
    setRect(reasoning, { top: 560, left: 140, width: 720, height: 160 });
    document.body.appendChild(reasoning);
    detector.registerAnswerCandidate({ modelName: 'Qwen', element: reasoning, traceId: 'qwen-phase' });

    const start = await detector.waitForAnswerStart({
      modelName: 'Qwen',
      promptSubmittedAt: submittedAt,
      timeoutMs: 200,
      pollIntervalMs: 10,
      traceId: 'qwen-phase'
    });
    expect(start.ok).toBe(true);
    await detector.waitForAnswerComplete({
      modelName: 'Qwen',
      timeoutMs: 600,
      stableMs: 60,
      pollIntervalMs: 20,
      traceId: 'qwen-phase'
    });

    const pending = sentMessages.find((message) =>
      message?.type === 'LLM_DIAGNOSTIC_EVENT'
      && message?.event?.label === 'LIFECYCLE_STRUCTURAL_VERIFICATION_PENDING');
    expect(pending?.event).toEqual(expect.objectContaining({
      meta: expect.objectContaining({
        phaseEvidence: expect.objectContaining({
          resolution: 'unresolved',
          structuralComplete: false
        })
      })
    }));
    expect(readyEvents()).toHaveLength(0);
  });

  test('an answer that existed before dispatch never starts or completes the new turn', async () => {
    const detector = window.ResponseLifecycleDetector;
    const oldAnswer = document.createElement('article');
    oldAnswer.textContent = 'Old stable response that must remain quarantined from the new dispatch.';
    setRect(oldAnswer, { top: 540, left: 140, width: 720, height: 180 });
    document.body.appendChild(oldAnswer);
    detector.registerAnswerCandidate({ modelName: 'GPT', element: oldAnswer, traceId: 'old-guard' });
    const submittedAt = Date.now();
    await detector.startResponseLifecycleTracking({ modelName: 'GPT', dispatchId: 'old-guard', runSessionId: 88, promptSubmittedAt: submittedAt, traceId: 'old-guard' });
    const start = await detector.waitForAnswerStart({ modelName: 'GPT', promptSubmittedAt: submittedAt, timeoutMs: 100, pollIntervalMs: 10, traceId: 'old-guard' });
    expect(start.ok).toBe(false);
    await detector.waitForAnswerComplete({ modelName: 'GPT', timeoutMs: 120, stableMs: 40, pollIntervalMs: 10, traceId: 'old-guard' });
    expect(completeEvents()).toHaveLength(0);
    expect(readyEvents()).toHaveLength(0);
  });

  test('C6: the previous answer re-rendered as a new node with identical text is not the start of the new turn', async () => {
    const detector = window.ResponseLifecycleDetector;
    const text = 'Previous continued-chat answer, long enough to be a real response and identical after re-render.';
    const oldAnswer = document.createElement('article');
    oldAnswer.setAttribute('data-message-author-role', 'assistant');
    oldAnswer.textContent = text;
    setRect(oldAnswer, { top: 420, left: 140, width: 720, height: 180 });
    document.body.appendChild(oldAnswer);
    detector.registerAnswerCandidate({ modelName: 'GPT', element: oldAnswer, observedAt: Date.now(), traceId: 'c6-guard' });
    const submittedAt = Date.now();
    await detector.startResponseLifecycleTracking({ modelName: 'GPT', dispatchId: 'c6-guard', runSessionId: 91, promptSubmittedAt: submittedAt, traceId: 'c6-guard' });
    const rerendered = document.createElement('article');
    rerendered.setAttribute('data-message-author-role', 'assistant');
    rerendered.textContent = text;
    setRect(rerendered, { top: 540, left: 140, width: 720, height: 180 });
    oldAnswer.remove();
    document.body.appendChild(rerendered);
    detector.registerAnswerCandidate({ modelName: 'GPT', element: rerendered, observedAt: Date.now(), traceId: 'c6-guard' });
    const start = await detector.waitForAnswerStart({ modelName: 'GPT', promptSubmittedAt: submittedAt, timeoutMs: 120, pollIntervalMs: 10, traceId: 'c6-guard' });
    expect(start.ok).toBe(false);
    detector.stopResponseLifecycleTracking({ modelName: 'GPT', reason: 'test_done' });
  });
});
