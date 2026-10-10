/** @jest-environment jsdom */
const fs = require('fs');
const path = require('path');
const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

let inline;
beforeEach(() => {
  jest.useFakeTimers();
  document.body.innerHTML = '';
  window.__LLMLateAnswerSnapshotObserverStarted = true;
  delete window.ContentUtils;
  window.eval(read('shared/answer-content-classifier.js'));
  window.eval(read('content-scripts/answer-structure.js'));
  window.eval(read('content-scripts/turn-resolver.js'));
  window.eval(read('content-scripts/answer-pipeline-selectors.js'));
  window.eval(read('content-scripts/content-utils.js'));
  const src = read('background/job-orchestrator.js');
  inline = new Function('window', 'document', src.slice(
    src.indexOf('function extractLatestAssistantSnapshotInPage('),
    src.indexOf('\nconst normalizeSnapshotKeyPart')
  ) + '\nreturn extractLatestAssistantSnapshotInPage;')(window, document);
});
afterEach(() => {
  jest.useRealTimers();
  delete window.__LLMLateAnswerSnapshotObserverStarted;
  delete window.ContentUtils;
});

function page(heading = '', answer = '') {
  // Field DOM: the announcer is itself caught by div[class*="model-response"].
  document.body.innerHTML = `<main><model-response>${heading ? `<h3>${heading}</h3>` : ''}
    <div class="model-response-label-announcer"><h6 class="cdk-visually-hidden screen-reader-model-response-label">Ответ Gemini</h6></div>
    ${answer ? `<message-content><p>${answer}</p></message-content>` : ''}
  </model-response></main>`;
  document.querySelectorAll('*').forEach(node => {
    node.getClientRects = () => [{ width: 100, height: 40 }];
  });
}

test.each(['', 'Анализирую русский запрос'])('13+ seconds of heading/label are not a turn; then the full answer excludes its service label (%s)', async heading => {
  page(heading);
  let candidate;
  const sample = () => {
    const turn = window.TurnResolver.resolveTurn({ platform: 'gemini', document,
      selectors: window.AnswerPipelineSelectors.PLATFORM_SELECTORS.gemini });
    candidate = turn.answerNode;
  };
  const timer = setInterval(sample, 500);
  await jest.advanceTimersByTimeAsync(13500);
  expect(candidate).toBeNull();
  page('', 'Полный ответ со всеми абзацами. [[AO-abc123]]');
  await jest.advanceTimersByTimeAsync(500);
  clearInterval(timer);
  expect(window.AnswerStructure.linearizeText(candidate)).toBe(
    'Полный ответ со всеми абзацами. [[AO-abc123]]');
});

test.each(['inline', 'late snapshot'])('%s ignores a long thinking heading and the announcer, then collects the current full turn', route => {
  const collect = () => route === 'inline' ? inline('Gemini', 1)
    : window.ContentUtils.collectLateSnapshotCandidate('Gemini', 1);
  page('Размышление о задаче. '.repeat(10));
  expect(collect().ok).toBe(false);
  page('', 'Полный ответ. [[AO-abc123]]');
  const result = collect();
  expect(result.ok).toBe(true);
  expect(result.text).toBe('Полный ответ. [[AO-abc123]]');
  expect(result.html).not.toContain('screen-reader-model-response-label');
});

test('inline recovery also waits for the body when content helpers are unavailable', () => {
  delete window.AnswerStructure;
  page('Размышление о задаче. '.repeat(10));
  expect(inline('Gemini', 1).ok).toBe(false);
  page('', 'Ответ после паузы. [[AO-abc123]]');
  expect(inline('Gemini', 1).text).toBe('Ответ после паузы. [[AO-abc123]]');
});

test.each(['structure', 'inline', 'inline without helpers', 'late snapshot', 'late snapshot without helpers', 'legacy'])(
  '%s removes the service label but retains the same phrase inside the answer', route => {
    const answer = 'Здесь есть цитата «Ответ Gemini», которую нужно сохранить. [[AO-abc123]]';
    page('', answer);
    if (route.includes('without helpers')) delete window.AnswerStructure;
    let result;
    if (route === 'structure') {
      const node = document.querySelector('model-response');
      result = { text: window.AnswerStructure.linearizeText(node), html: window.ContentUtils.buildInlineHtml(node) };
    } else if (route.startsWith('inline')) result = inline('Gemini', 1);
    else if (route.startsWith('late snapshot')) result = window.ContentUtils.collectLateSnapshotCandidate('Gemini', 1);
    else {
      const src = read('content-scripts/content-gemini.js');
      const grab = new Function('window', 'document', 'Node', 'buildInlineHtml', 'GEMINI_FALLBACK_LAST_MESSAGE_SELECTORS',
        src.slice(src.indexOf('function grabLatestAssistantMarkup()'), src.indexOf('\nasync function trySelectorFinderResponse'))
        + '\nreturn grabLatestAssistantMarkup;')(window, document, Node, window.ContentUtils.buildInlineHtml, ['model-response']);
      result = grab();
    }
    expect(result.text.replace(/\s+/g, ' ').trim()).toBe(answer);
    expect(result.html).not.toContain('screen-reader-model-response-label');
    expect(result.html).toContain('«Ответ Gemini»');
    expect(document.querySelector('h6.screen-reader-model-response-label')).not.toBeNull();
  }
);

test('SelectorFinder checks pending raw text before removing the leading service label', async () => {
  const src = read('content-scripts/content-gemini.js');
  const start = src.indexOf('async function trySelectorFinderResponse(');
  const finder = new Function('window', 'MODEL', src.slice(start, src.indexOf('// --- Idempotency', start))
    + '\nreturn trySelectorFinderResponse;')(window, 'Gemini');
  window.SelectorFinder = { waitForElement: jest.fn(async () => ({ text: 'Ответ Gemini' })) };
  expect(await finder('prompt')).toBe('');
  window.SelectorFinder.waitForElement.mockResolvedValue({ text: 'Ответ Gemini\n\nПолный ответ с цитатой «Ответ Gemini».' });
  expect(await finder('prompt')).toBe('Полный ответ с цитатой «Ответ Gemini».');
  delete window.SelectorFinder;
});

test('label cleanup preserves the rendered separation between answer paragraphs', () => {
  page('', 'Первый абзац.');
  const turn = document.querySelector('model-response');
  turn.querySelector('message-content').innerHTML = '<p>Первый абзац.</p><p>Второй абзац.</p>';
  Object.defineProperty(turn, 'innerText', { configurable: true,
    value: 'Ответ Gemini\n\nПервый абзац.\n\nВторой абзац.' });
  delete window.AnswerStructure;
  expect(inline('Gemini', 1).text).toBe('Первый абзац. Второй абзац.');
  expect(window.ContentUtils.collectLateSnapshotCandidate('Gemini', 1).text).toBe('Первый абзац. Второй абзац.');
});

test('rendering removes the actual label from lifecycle HTML without removing quoted answer text', () => {
  page('', 'В ответе остаётся цитата «Ответ Gemini».');
  const src = read('results.js');
  const start = src.indexOf('    const normalizeRenderedAnswerText =');
  const end = src.indexOf('\n    function updateLLMPanelOutput', start);
  const plainTextFromHtml = html => {
    const node = document.createElement('div'); node.innerHTML = html; return node.textContent;
  };
  const resolve = new Function('sanitizeInlineHtml', 'convertMarkdownToHTML', 'plainTextFromHtml',
    src.slice(start, end) + '\nreturn resolveCompleteAnswerHtml;')(x => x, x => `<p>${x}</p>`, plainTextFromHtml);
  const html = resolve('В ответе остаётся цитата «Ответ Gemini».', document.querySelector('model-response').innerHTML);
  expect(html).not.toContain('screen-reader-model-response-label');
  expect(plainTextFromHtml(html).trim()).toBe('В ответе остаётся цитата «Ответ Gemini».');
});

test.each(['Настоящий ответ.', 'Настоящий ответ. '.repeat(20)])('the panel renders committed text when stale HTML contains only its heading and label (%s)', body => {
  const src = read('results.js');
  const start = src.indexOf('    const normalizeRenderedAnswerText =');
  const end = src.indexOf('\n    function updateLLMPanelOutput', start);
  const plainTextFromHtml = html => {
    const node = document.createElement('div'); node.innerHTML = html; return node.textContent;
  };
  const resolve = new Function('sanitizeInlineHtml', 'convertMarkdownToHTML', 'plainTextFromHtml',
    src.slice(start, end) + '\nreturn resolveCompleteAnswerHtml;')(x => x, x => `<p>${x}</p>`, plainTextFromHtml);
  const heading = 'Анализирую условия поставленной задачи';
  const text = `${heading}\nОтвет Gemini\n\n${body}`;
  const html = `<h3>${heading}</h3> <h6>Ответ Gemini</h6>`;
  expect(plainTextFromHtml(resolve(text, html))).toContain('Настоящий ответ.');
});

test('a previous turn cannot fill the 13-second gap in Gemini legacy collection', async () => {
  page();
  const previous = document.createElement('model-response');
  previous.innerHTML = '<p>Ответ Gemini Предыдущий ответ</p>';
  document.querySelector('main').prepend(previous);
  const src = read('content-scripts/content-gemini.js');
  const grab = src.slice(src.indexOf('function grabLatestAssistantMarkup()'), src.indexOf('\nasync function trySelectorFinderResponse'));
  const fresh = src.slice(src.indexOf('function quickHash('), src.indexOf('\nfunction readComposerText'));
  const wait = new Function('window', 'document', 'Node', 'buildInlineHtml', 'GEMINI_FALLBACK_LAST_MESSAGE_SELECTORS', 'sleep',
    grab + '\n' + fresh + '\nreturn waitForFreshGeminiAnswer;')(
    window, document, Node, window.ContentUtils.buildInlineHtml, ['model-response'],
    ms => new Promise(resolve => setTimeout(resolve, ms)));
  let result = null;
  const waiting = wait(null, 30000, 500).then(value => { result = value; });
  await jest.advanceTimersByTimeAsync(13500);
  expect(result).toBeNull();
  page('', 'Новый полный ответ. [[AO-abc123]]');
  await jest.advanceTimersByTimeAsync(1500);
  await waiting;
  expect(result.text).toContain('Новый полный ответ. [[AO-abc123]]');
});

test.each(['Ответ Gemini', 'Анализирую русский запрос Ответ Gemini'])('a closed Gemini placeholder is replaced in the main card, not hidden in Δ (%s)', placeholder => {
  document.body.innerHTML = '<div id="cards"><div class="debate-model-card" data-session-id="s1" data-llm-name="Gemini" data-turn-closed="true" data-request-id="r1"><div class="debate-model-card-output"></div></div></div>';
  const cards = document.getElementById('cards');
  const output = cards.querySelector('.debate-model-card-output');
  output.textContent = placeholder;
  const src = read('results.js');
  const fn = src.slice(src.indexOf('    function appendPostTerminalAnswerRevision('), src.indexOf('    const cleanFeedText =', src.indexOf('    function appendPostTerminalAnswerRevision(')));
  const patched = jest.fn();
  const append = new Function('debateModelCards', 'resolveDebateFeedMeta', 'cleanFeedText', 'cleanFeedHtml', 'sanitizeInlineHtml',
    'isFinalResponseMeta', 'debateRenderedPlainText', 'renderedAnswerPlainText', 'setDebateCardRound', 'applyPartialMarker',
    'renderDebateResponseBody', 'appendDebateResponseGrowth', 'syncDebateCardOutputLayout', 'patchDebateCardMessage', 'ensurePostTerminalBadge',
    fn + '\nreturn appendPostTerminalAnswerRevision;')(
    cards, x => x, x => x, x => x, x => x, () => true, node => node.textContent, text => text,
    () => {}, () => {}, (node, text) => { node.textContent = text; },
    (node, text) => { node.textContent = text; }, () => {}, patched,
    () => { throw new Error('answer incorrectly routed into Δ'); });
  const answer = 'Ответ Gemini Настоящий ответ со всеми абзацами.';
  expect(append({ id: 's1' }, 'Gemini', answer, '', { requestId: 'r1', status: 'SUCCESS' })).toBe(true);
  expect(output.textContent).toBe(answer);
  expect(patched).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ text: answer }));
});
