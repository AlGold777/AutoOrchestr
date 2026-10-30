const fs = require('fs');
const path = require('path');
const Detector = require('../shared/usage-limit-detector.js');
const Protocol = require('../shared/completion-protocol.js');

const read = (...parts) => fs.readFileSync(path.join(__dirname, '..', ...parts), 'utf8');

// jsdom reports no layout: every element counts as visible in these fixtures.
const showAll = () => {
  document.querySelectorAll('*').forEach((node) => {
    node.getClientRects = () => [{ width: 100, height: 40 }];
  });
};

describe('usage limit: pure decision', () => {
  test('RU banner with reset time is a usage limit', () => {
    const result = Detector.evaluate({ surfaces: [{ kind: 'banner', text: 'Достигнут лимит использования. Сброс в 16:30.' }] });
    expect(result.detected).toBe(true);
    expect(result.reason).toBe('usage_limit');
    expect(result.resetAt).toBe('16:30');
    expect(result.reasonCode).toBe('usage_limit:16:30');
  });

  test('EN banner without reset time is a usage limit with the plain reason', () => {
    const result = Detector.evaluate({ surfaces: [{ kind: 'banner', text: "You've reached your usage limit for this model." }] });
    expect(result.detected).toBe(true);
    expect(result.resetAt).toBeNull();
    expect(result.reasonCode).toBe('usage_limit');
  });

  test('other provider limit wordings are recognised', () => {
    for (const text of [
      'You have reached your message limit for this hour. Try again after 10:15.',
      'Rate limit exceeded. Too many requests.',
      'Квота исчерпана, попробуйте после 09:00.',
      'Лимит сообщений исчерпан до 18:45.'
    ]) {
      expect(Detector.evaluate({ surfaces: [{ kind: 'banner', text }] }).detected).toBe(true);
    }
  });

  test('a long answer that discusses limits is not a limit', () => {
    const answer = 'Лимит использования API бывает двух видов: по запросам и по токенам. '.repeat(10);
    expect(answer.length).toBeGreaterThan(400);
    const result = Detector.evaluate({
      surfaces: [{ kind: 'answer', text: answer }], stopVisible: false, textGrowing: false, retryVisible: true
    });
    expect(result.detected).toBe(false);
  });

  test('a short answer that explains rate limits is not a limit without Retry, or while it grows or Stop is visible', () => {
    const text = 'Rate limit means the provider caps requests per minute.';
    expect(Detector.evaluate({ surfaces: [{ kind: 'answer', text }], retryVisible: false }).detected).toBe(false);
    expect(Detector.evaluate({ surfaces: [{ kind: 'answer', text }], retryVisible: true, textGrowing: true }).detected).toBe(false);
    expect(Detector.evaluate({ surfaces: [{ kind: 'answer', text }], retryVisible: true, stopVisible: true }).detected).toBe(false);
  });

  test('a short answer with a limit notice, Retry, no Stop and no growth is a limit', () => {
    const result = Detector.evaluate({
      surfaces: [{ kind: 'answer', text: 'Достигнут лимит использования. Сброс в 16:30.' }],
      stopVisible: false, textGrowing: false, retryVisible: true
    });
    expect(result.detected).toBe(true);
    expect(result.kind).toBe('answer');
    expect(result.resetAt).toBe('16:30');
  });

  test('an ordinary error banner is not a usage limit', () => {
    expect(Detector.evaluate({ surfaces: [{ kind: 'banner', text: 'Something went wrong. Please try again later.' }] }).detected).toBe(false);
  });

  test('reason strings round-trip through parseReason', () => {
    expect(Detector.parseReason(Detector.reasonOf('16:30'))).toEqual({ reason: 'usage_limit', resetAt: '16:30' });
    expect(Detector.parseReason(Detector.reasonOf(null))).toEqual({ reason: 'usage_limit', resetAt: null });
    expect(Detector.parseReason('provider_error_visible')).toBeNull();
  });
});

describe('usage limit: DOM collection', () => {
  afterEach(() => { document.body.innerHTML = ''; });

  test('a visible alert outside the answer turn is detected as a banner', () => {
    document.body.innerHTML = `
      <main>
        <div data-message-author-role="assistant" class="answer">Предыдущий ответ.</div>
        <div role="alert">Достигнут лимит использования. Сброс в 16:30.</div>
      </main>`;
    showAll();
    const result = Detector.detect({ root: document, answerEl: document.querySelector('.answer') });
    expect(result.detected).toBe(true);
    expect(result.kind).toBe('banner');
    expect(result.resetAt).toBe('16:30');
  });

  test('a short last turn with the limit text and a Retry button is detected as an answer surface', () => {
    document.body.innerHTML = `
      <main>
        <div class="turn">
          <div class="answer">Достигнут лимит использования. Сброс в 16:30.</div>
          <button>Повторить</button>
        </div>
      </main>`;
    showAll();
    const answerEl = document.querySelector('.answer');
    const result = Detector.detect({ root: document, answerEl, stopVisible: false, textGrowing: false });
    expect(result.detected).toBe(true);
    expect(result.kind).toBe('answer');
  });

  test('the same short turn while Stop is visible is not a limit', () => {
    document.body.innerHTML = `
      <main>
        <div class="turn">
          <div class="answer">Достигнут лимит использования. Сброс в 16:30.</div>
          <button>Повторить</button>
          <button aria-label="Stop">Stop</button>
        </div>
      </main>`;
    showAll();
    const result = Detector.detect({ root: document, answerEl: document.querySelector('.answer'), stopVisible: true, textGrowing: false });
    expect(result.detected).toBe(false);
  });

  test('a long answer that discusses limits on the page is not a limit even with Retry', () => {
    const long = 'Лимит использования модели — это ограничение на число запросов в час. '.repeat(8);
    document.body.innerHTML = `
      <main>
        <div class="answer">${long}</div>
        <button>Повторить</button>
      </main>`;
    showAll();
    const result = Detector.detect({ root: document, answerEl: document.querySelector('.answer') });
    expect(result.detected).toBe(false);
  });
});

describe('usage limit: completion protocol', () => {
  const make = () => new Protocol.CompletionSession({ dispatchId: 'd', promptSubmittedAt: 0 });

  test('a usage-limit witness ends the request at once as PROVIDER_ERROR with the reset time in the reason', () => {
    const session = make();
    session.observe({ type: 'USAGE_LIMIT_VISIBLE', observedAt: 1, source: 'w', payload: { resetAt: '16:30', kind: 'banner' } });
    const terminal = session.evaluate(2);
    expect(terminal.status).toBe('PROVIDER_ERROR');
    expect(terminal.reason).toBe('usage_limit:16:30');
    expect(Protocol.FinalizationAdapter.toFinalStatus(terminal)).toBe('FAILED');
  });

  test('a usage limit without a reset time keeps the plain reason', () => {
    const session = make();
    session.observe({ type: 'USAGE_LIMIT_VISIBLE', observedAt: 1, source: 'w', payload: { resetAt: null } });
    expect(session.evaluate(2).reason).toBe('usage_limit');
  });

  test('the witness is a known witness type', () => {
    expect(Protocol.WITNESS_TYPES).toContain('USAGE_LIMIT_VISIBLE');
  });
});

describe('usage limit: wiring', () => {
  test('the detector is loaded before the lifecycle detector in the extension and in both bundles', () => {
    const manifest = JSON.parse(read('manifest.json'));
    const scripts = manifest.content_scripts.flatMap((entry) => entry.js);
    const detectorAt = scripts.indexOf('shared/usage-limit-detector.js');
    expect(detectorAt).toBeGreaterThan(-1);
    expect(detectorAt).toBeLessThan(scripts.indexOf('content-utils/response-lifecycle-detector.js'));
    expect(read('scripts', 'build-bundles.js')).toContain("'shared/usage-limit-detector.js'");
    expect(read('background', 'message-router.js')).toContain("'shared/usage-limit-detector.js'");
  });

  test('the lifecycle poll and the pipeline finalization both consult the detector', () => {
    expect(read('content-utils', 'response-lifecycle-detector.js')).toContain("window.UsageLimitDetector?.detect");
    expect(read('content-scripts', 'unified-answer-pipeline.js')).toContain("finalization_usage_limit");
  });

  test('Basic does not repeat a request that hit the limit and names the reason', () => {
    const engine = read('disput', 'custom-engine.js');
    expect(engine).toContain("usage_limit: 'лимит использования модели'");
    expect(engine).toContain("verdict.reason !== 'usage_limit' && verdict.reason !== 'captcha_required') retry.push(model)");
  });
});
