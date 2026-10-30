/** @jest-environment jsdom */
// L-27: [data-testid="chat-loader"] is the history loading indicator (C10, L-16), not an active generation.
// It must not make the generation signal of Claude or Qwen report an active generation.
const fs = require('fs');
const path = require('path');
const GenerationSignal = require('../content-scripts/generation-signal');

const SELECTOR_SOURCE = fs.readFileSync(
  path.join(__dirname, '..', 'content-scripts', 'answer-pipeline-selectors.js'), 'utf8'
);

const makeVisible = (node) => {
  node.getBoundingClientRect = () => ({ width: 24, height: 12, top: 0, left: 0, right: 24, bottom: 12 });
  return node;
};

describe('L-27: history loading is not a generation indicator', () => {
  beforeAll(() => {
    delete window.AnswerPipelineSelectors;
    window.eval(SELECTOR_SOURCE);
  });

  test.each(['claude', 'qwen'])('%s: a visible chat-loader does not count as generating', (platform) => {
    const selectors = window.AnswerPipelineSelectors.PLATFORM_SELECTORS[platform];
    expect(JSON.stringify(selectors.generatingIndicators)).not.toContain('chat-loader');
    document.body.innerHTML = '<div data-testid="chat-loader">loading history</div>';
    makeVisible(document.body.firstElementChild);
    const result = GenerationSignal.inspect({ selectors, document, view: window });
    expect(result.active).toBeFalsy();
  });

  test.each([
    ['claude', '<div data-is-streaming="true">x</div>'],
    ['qwen', '<div data-streaming="true">x</div>']
  ])('%s: a real streaming marker still counts as generating beside the loader', (platform, marker) => {
    const selectors = window.AnswerPipelineSelectors.PLATFORM_SELECTORS[platform];
    document.body.innerHTML = `<div data-testid="chat-loader">loading history</div>${marker}`;
    makeVisible(document.querySelector('[data-testid="chat-loader"]'));
    makeVisible(document.body.lastElementChild);
    const result = GenerationSignal.inspect({ selectors, document, view: window });
    expect(result.active).toBeTruthy();
  });
});
