/** @jest-environment jsdom */
const fs = require('fs');
const path = require('path');

describe('Gemini screen-reader label', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    delete window.ContentUtils;
    window.__LLMLateAnswerSnapshotObserverStarted = true;
    ['answer-structure.js', 'turn-resolver.js', 'answer-pipeline-selectors.js', 'content-utils.js']
      .forEach((file) => window.eval(fs.readFileSync(path.join(__dirname, '..', 'content-scripts', file), 'utf8')));
  });

  test('buildInlineHtml leaves the hidden "Ответ Gemini" label out of the answer', () => {
    document.body.innerHTML = `<model-response><model-response-label-announcer><h6 class="cdk-visually-hidden screen-reader-model-response-label">Ответ Gemini</h6></model-response-label-announcer><div class="markdown"><p>Real answer.</p></div></model-response>`;
    const html = window.ContentUtils.buildInlineHtml(document.querySelector('model-response'));
    expect(html).not.toContain('Ответ Gemini');
    expect(html).toContain('Real answer.');
  });
});
