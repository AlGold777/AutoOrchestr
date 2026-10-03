/** @jest-environment jsdom */
const fs = require('fs');
const path = require('path');
const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
const adapter = read('content-scripts/content-lechat.js');
const extractionStart = adapter.indexOf('  function getProseNodes()');
const extractionEnd = adapter.indexOf('  // Ожидание ответа', extractionStart);
const background = read('background/job-orchestrator.js');
const snapshotStart = background.indexOf('function extractLatestAssistantSnapshotInPage(');
const snapshotEnd = background.indexOf('\nconst normalizeSnapshotKeyPart', snapshotStart);
let legacy, inline;

function visible() {
  document.querySelectorAll('*').forEach(node => {
    node.getClientRects = () => [{ width: 100, height: 40 }];
  });
}

// Mirrors the observed typed LeChat DOM, including split-letter disclosure
// labels, an expanded reasoning region, answer markdown and a turn timestamp.
function message(answer = 'A public answer about reasoning, with the full final paragraph.') {
  return `<div data-message-author-role="assistant">
    <button aria-label="Thought for 6s"><span>T</span><span>h</span><span>o</span><span>u</span><span>g</span><span>h</span><span>t</span></button>
    <div role="region"><div data-message-part-type="reasoning"><div class="markdown-container-style prose">Private reasoning must never enter the answer.</div></div></div>
    ${answer ? `<div data-message-part-type="answer" data-testid="text-message-part"><div class="markdown-container-style"><p>${answer}</p></div></div>` : ''}
    <button>Copy to clipboard</button><div class="text-hint" data-state="closed">5:20pm</div>
  </div>`;
}

beforeEach(() => {
  document.head.innerHTML = '';
  document.body.innerHTML = '';
  delete window.ContentUtils;
  delete window.AnswerPipelineSelectors;
  window.__LLMLateAnswerSnapshotObserverStarted = true;
  window.eval(read('content-scripts/answer-structure.js'));
  window.eval(read('content-scripts/turn-resolver.js'));
  window.eval(read('content-scripts/answer-pipeline-selectors.js'));
  window.eval(read('content-scripts/content-utils.js'));
  legacy = new Function('window', 'document', 'buildInlineHtml',
    adapter.slice(extractionStart, extractionEnd) + '\nreturn { getProseNodes, extractResponseText, grabLatestAssistantMarkup };'
  )(window, document, window.ContentUtils.buildInlineHtml);
  inline = new Function('window', 'document',
    background.slice(snapshotStart, snapshotEnd) + '\nreturn extractLatestAssistantSnapshotInPage;'
  )(window, document);
});

afterEach(() => {
  delete window.ContentUtils;
  delete window.AnswerStructure;
  delete window.TurnResolver;
  delete window.AnswerPipelineSelectors;
  delete window.__LLMLateAnswerSnapshotObserverStarted;
});

test.each(['legacy', 'inline', 'late snapshot', 'pipeline'])('%s returns public text and HTML without reasoning or turn controls', route => {
  const answer = 'A public answer about reasoning, with the full final paragraph.';
  document.body.innerHTML = message();
  visible();
  let payload;
  if (route === 'legacy') payload = legacy.grabLatestAssistantMarkup();
  if (route === 'inline') payload = inline('Le Chat', 20);
  if (route === 'late snapshot') payload = window.ContentUtils.collectLateSnapshotCandidate('Le Chat', 20);
  if (route === 'pipeline') {
    const turn = window.TurnResolver.resolveTurn({ platform: 'lechat', document,
      selectors: window.AnswerPipelineSelectors.PLATFORM_SELECTORS.lechat });
    payload = { text: window.AnswerStructure.linearizeText(turn.answerNode),
      html: window.ContentUtils.buildInlineHtml(turn.answerNode) };
    expect(window.AnswerStructure.inspect(turn.messageRoot, turn.answerNode).complete).toBe(true);
  }
  expect(payload.text).toBe(answer);
  expect(payload.html).toContain(answer);
  for (const noise of ['Private reasoning', 'Thought', 'Copy to clipboard', '5:20pm']) {
    expect(payload.text).not.toContain(noise);
    expect(payload.html).not.toContain(noise);
  }
});

test('typed wrapper linearization and coverage preserve every answer part', () => {
  document.body.innerHTML = message('Opening paragraph');
  const root = document.querySelector('[data-message-author-role="assistant"]');
  root.insertAdjacentHTML('beforeend', '<div data-message-part-type="answer"><p>Final paragraph with code Copy()</p></div>');
  expect(window.AnswerStructure.linearizeText(root)).toBe('Opening paragraph Final paragraph with code Copy()');
  const first = root.querySelector('[data-message-part-type="answer"]');
  expect(window.AnswerStructure.inspect(root, first).issues).toContain('uncovered_message_blocks');
  const payload = legacy.grabLatestAssistantMarkup();
  expect(payload.text).toBe('Opening paragraph\n\nFinal paragraph with code Copy()');
  expect(payload.html).toContain('Opening paragraph');
  expect(payload.html).toContain('Final paragraph');
});

test('reasoning-only newest turn never falls back to an older public answer', () => {
  document.body.innerHTML = message('Old public answer that must not be reused.') + message('');
  visible();
  expect(legacy.grabLatestAssistantMarkup().text).toBe('');
  expect(inline('Le Chat', 20).ok).toBe(false);
  expect(window.ContentUtils.collectLateSnapshotCandidate('Le Chat', 20).ok).toBe(false);
  expect(window.AnswerStructure.linearizeText(document.querySelectorAll('[data-message-author-role="assistant"]')[1])).toBe('');
});

test('a late prose reasoning candidate cannot replace the typed final answer', () => {
  document.body.innerHTML = message();
  const root = document.querySelector('[data-message-author-role="assistant"]');
  root.appendChild(root.querySelector('[role="region"]'));
  const turn = window.TurnResolver.resolveTurn({ platform: 'lechat', document,
    selectors: window.AnswerPipelineSelectors.PLATFORM_SELECTORS.lechat });
  expect(turn.answerNode).toBe(root.querySelector('[data-message-part-type="answer"]'));
});

test('legacy prose still captures the latest assistant and excludes a later user prompt', () => {
  document.body.innerHTML = '<div data-testid="lechat-response"><div class="prose"><p>Legacy full public answer</p></div></div><div data-message-author-role="user"><div class="prose">Later user prompt</div></div>';
  expect(legacy.grabLatestAssistantMarkup().text).toBe('Legacy full public answer');
});

test('HTML cleanup removes expanded typed reasoning from a broad assistant wrapper', () => {
  document.body.innerHTML = message();
  const html = window.ContentUtils.buildInlineHtml(document.querySelector('[data-message-author-role="assistant"]'));
  expect(html).toContain('A public answer about reasoning');
  expect(html).not.toContain('Private reasoning');
  expect(html).not.toContain('Thought');
});
