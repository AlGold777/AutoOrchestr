/** @jest-environment jsdom */
const fs = require('fs');
const path = require('path');
const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
const adapter = read('content-scripts/content-chatgpt.js');
const background = read('background/job-orchestrator.js');
let legacy, inline;

// Semantic attributes observed on both short and multi-page live GPT answers.
function message(text, modern = true) {
  return `<div><h4>ChatGPT сказал:</h4><div ${modern
    ? 'data-markdown-text-style="assistant-message"'
    : 'data-message-author-role="assistant"'}><p>${text}</p></div><button>Copy</button></div>`;
}
beforeEach(() => {
  document.body.innerHTML = '';
  delete window.ContentUtils;
  delete window.AnswerPipelineSelectors;
  window.__LLMLateAnswerSnapshotObserverStarted = true;
  for (const file of ['answer-structure', 'turn-resolver', 'answer-pipeline-selectors', 'content-utils']) {
    window.eval(read(`content-scripts/${file}.js`));
  }
  legacy = new Function('window', 'document', adapter.slice(
    adapter.indexOf('  const FALLBACK_LAST_MESSAGE_SELECTORS'),
    adapter.indexOf('  const generatePingId')
  ) + '\nreturn grabLatestAssistantMarkup;')(window, document);
  inline = new Function('window', 'document', background.slice(
    background.indexOf('function extractLatestAssistantSnapshotInPage('),
    background.indexOf('\nconst normalizeSnapshotKeyPart')
  ) + '\nreturn extractLatestAssistantSnapshotInPage;')(window, document);
});
afterEach(() => {
  for (const key of ['ContentUtils', 'AnswerStructure', 'TurnResolver', 'AnswerPipelineSelectors', '__LLMLateAnswerSnapshotObserverStarted']) delete window[key];
});

test.each(['legacy', 'inline', 'late snapshot', 'pipeline', 'legacy without bundle'])(
  '%s finds the latest complete modern answer and excludes surrounding controls', route => {
    const answer = 'Last answer paragraph. '.repeat(120) + 'The end.';
    document.body.innerHTML = message('Older answer that should not be reused.') + message(answer)
      + '<div><h4>Вы сказали:</h4><p>Later user question</p></div>';
    document.querySelectorAll('*').forEach((node, index) => {
      node.getClientRects = () => [{ width: 100, height: 40 }];
      node.getBoundingClientRect = () => ({ top: index * 50, bottom: index * 50 + 40 });
    });
    let payload;
    if (route === 'legacy without bundle') delete window.AnswerPipelineSelectors;
    if (route.startsWith('legacy')) payload = legacy();
    if (route === 'inline') payload = inline('GPT', 20, { strategyId: 'bottom_most' });
    if (route === 'late snapshot') payload = window.ContentUtils.collectLateSnapshotCandidate('GPT', 20);
    if (route === 'pipeline') {
      const turn = window.TurnResolver.resolveTurn({ platform: 'chatgpt', document,
        selectors: window.AnswerPipelineSelectors.PLATFORM_SELECTORS.chatgpt });
      payload = { text: window.AnswerStructure.linearizeText(turn.answerNode),
        html: window.ContentUtils.buildInlineHtml(turn.answerNode) };
      expect(turn.resolution).toBe('exact');
      expect(window.AnswerStructure.inspect(turn.messageRoot, turn.answerNode).complete).toBe(true);
    }
    expect(payload.text).toBe(answer);
    expect(payload.html).toContain('The end.');
    expect(payload.html).not.toContain('Copy');
  }
);

test.each([true, false])('inline Get it preserves a short numeric answer (modern=%s)', modern => {
  document.body.innerHTML = message('0.0000009386313895162496', modern);
  expect(inline('GPT', 20).text).toBe('0.0000009386313895162496');
});
