/** @jest-environment jsdom */
const fs = require('fs');
const path = require('path');
const GenerationSignal = require('../content-scripts/generation-signal');

const SELECTOR_SOURCE = fs.readFileSync(
  path.join(__dirname, '..', 'content-scripts', 'answer-pipeline-selectors.js'), 'utf8'
);

const PLATFORM_INDICATORS = {
  chatgpt: '<button aria-label="Stop generating">stop</button>',
  claude: '<div data-is-streaming="true">stream</div>',
  gemini: '<div aria-busy="true">busy</div>',
  grok: '<div data-generating="true">busy</div>',
  perplexity: '<div data-generating="true">busy</div>',
  qwen: '<div data-streaming="true">busy</div>',
  deepseek: '<div data-generating="true">busy</div>',
  lechat: '<div data-testid="generation">busy</div>',
  zai: '<div data-generating="true">busy</div>'
};

const makeVisible = (node) => {
  node.getBoundingClientRect = () => ({ width: 24, height: 12, top: 0, left: 0, right: 24, bottom: 12 });
  return node;
};

describe('per-platform generation signal', () => {
  beforeAll(() => {
    delete window.AnswerPipelineSelectors;
    window.eval(SELECTOR_SOURCE);
  });

  test.each(Object.entries(PLATFORM_INDICATORS))('%s uses configured active-generation selectors', (platform, html) => {
    document.body.innerHTML = html;
    makeVisible(document.body.firstElementChild);
    const result = GenerationSignal.inspect({
      selectors: window.AnswerPipelineSelectors.PLATFORM_SELECTORS[platform], document, view: window
    });
    expect(result.active).toBe(true);
    expect(result.selector).not.toBeNull();
    expect(result.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({ selector: result.selector, foundCount: 1, availableCount: 1, visibleCount: 1 })
    ]));
  });

  test.each([
    ['display none', 'style', 'display:none'],
    ['visibility hidden', 'style', 'visibility:hidden'],
    ['aria hidden', 'aria-hidden', 'true'],
    ['disabled', 'disabled', ''],
    ['aria disabled', 'aria-disabled', 'true'],
    ['inert', 'inert', '']
  ])('present but %s indicator is inactive', (_name, attribute, value) => {
    document.body.innerHTML = '<button aria-label="Stop generating">stop</button>';
    const node = makeVisible(document.querySelector('button'));
    node.setAttribute(attribute, value);
    const result = GenerationSignal.inspect({
      selectors: { stopButton: 'button[aria-label*="Stop" i]' }, document, view: window
    });
    expect(result.active).toBe(false);
  });

  test('zero-size indicator is inactive', () => {
    document.body.innerHTML = '<div data-generating="true">busy</div>';
    const result = GenerationSignal.inspect({
      selectors: { generatingIndicators: ['[data-generating="true"]'] }, document, view: window
    });
    expect(result.active).toBe(false);
    expect(result.checks[0]).toEqual(expect.objectContaining({
      foundCount: 1, availableCount: 1, visibleCount: 0
    }));
  });

  test('no configured selector matches means generation state is unknown', () => {
    document.body.innerHTML = '<button data-provider-control="new-stop-shape">stop</button>';
    const result = GenerationSignal.inspect({
      selectors: { stopButton: 'button[data-testid="old-stop-shape"]' }, document, view: window
    });
    expect(result.active).toBeNull();
    expect(result.checks).toEqual([
      expect.objectContaining({ foundCount: 0, availableCount: 0, visibleCount: 0 })
    ]);
  });
});

test('stop control inside an aria-hidden ancestor cannot keep generation active', () => {
  document.body.innerHTML = '<section aria-hidden="true"><button>Stop</button></section>';
  makeVisible(document.querySelector('button'));
  expect(GenerationSignal.inspect({ document, view: window, selectors: { stopButton: 'button' } }).active).toBe(false);
});
