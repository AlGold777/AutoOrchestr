/** @jest-environment jsdom */
// A pulled answer is ONE answer node: never a page/conversation container; text, html and
// markdown come from that same node; a card without html shows the markdown with line breaks.
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');
const fixtureHtml = (name) => JSON.parse(read(`tests/fixtures/live-answer-skeletons/${name}.json`)).capture.html;
const ORCH = read('background/job-orchestrator.js');

const sliceFunction = (src, name) => {
  const start = src.indexOf(`function ${name}(`);
  expect(start).toBeGreaterThan(-1);
  const open = src.indexOf('{', src.indexOf(')', start));
  let depth = 0;
  for (let i = open; i < src.length; i += 1) {
    if (src[i] === '{') depth += 1;
    if (src[i] === '}') { depth -= 1; if (depth === 0) return src.slice(start, i + 1); }
  }
  throw new Error('unbalanced');
};
const extractor = new Function(`${sliceFunction(ORCH, 'extractLatestAssistantSnapshotInPage')}; return extractLatestAssistantSnapshotInPage;`)();

const loadUtils = () => {
  delete window.ContentUtils;
  window.chrome = { runtime: { id: 'x', sendMessage: jest.fn() } };
  window.eval(read('content-scripts/answer-html-builder.js'));
  window.eval(read('content-scripts/content-utils.js'));
};
const loadEngine = () => {
  ['AnswerMarkdown', 'AnswerMarkdownBlocks', 'AnswerMarkdownExtras', 'AnswerMarkdownProviders', 'AnswerCopyContext', 'AnswerStructure']
    .forEach((k) => { delete window[k]; });
  ['content-scripts/answer-structure.js', 'shared/answer-markdown.js', 'shared/answer-markdown-blocks.js',
    'shared/answer-markdown-extras.js', 'shared/answer-markdown-providers.js'].forEach((f) => window.eval(read(f)));
};
beforeEach(() => { loadEngine(); loadUtils(); });

describe('Le Chat: assistant turn without data-message-part-type (live skeleton)', () => {
  const old = () => fixtureHtml('lechat').replace(/⟦TEXT:/g, '⟦OLD:');
  const cur = () => fixtureHtml('lechat');
  const page = (extra = '') => `<div id="page"><div class="chat">
    <div data-message-author-role="user"><p>user question that is long enough</p></div>
    ${old()}
    <div data-message-author-role="user"><p>second user question here</p></div>
    ${cur()}${extra}</div><form><textarea></textarea></form></div>`;

  test('the in-page extractor picks the latest assistant turn only', () => {
    document.body.innerHTML = page();
    const out = extractor('Le Chat', 10, {});
    expect(out.ok).toBe(true);
    expect(out.html).toContain('⟦TEXT:');
    expect(out.html).not.toContain('⟦OLD:');
    expect(out.text).not.toContain('OLD');
    expect(out.selectorUsed).toBe('[data-message-author-role="assistant"]');
  });

  test('ContentUtils.collectLateSnapshotCandidate agrees', () => {
    document.body.innerHTML = page();
    const snap = window.ContentUtils.collectLateSnapshotCandidate('Le Chat', 10);
    expect(snap.ok).toBe(true);
    expect(snap.html).toContain('⟦TEXT:');
    expect(snap.html).not.toContain('⟦OLD:');
  });
});

describe('general rule: a page-level container is never the answer', () => {
  test('only a container matches (user message + answer inside): failure with a reason, not the container', () => {
    document.body.innerHTML = `<main><div class="prose"><div data-role="user"><p>the question text is here</p></div>
      <div class="reply"><p>${'The answer text. '.repeat(10)}</p></div></div></main>`;
    const out = extractor('Perplexity', 10, {});
    expect(out.ok).toBe(false);
    expect(out.reason).toBe('wide_container_only');
  });

  test.each([
    ['several assistant turns', '<div class="prose"><div data-role="assistant"><p>FIRST turn answer text here</p></div><div data-role="assistant"><p>SECOND turn answer text here</p></div></div>'],
    ['composer inside', `<div class="prose"><p>${'answer words '.repeat(10)}</p><textarea></textarea></div>`],
    ['navigation inside', `<div class="prose"><nav><a href="#">x</a></nav><p>${'answer words '.repeat(10)}</p></div>`]
  ])('container rejected: %s', (_, html) => {
    document.body.innerHTML = `<main>${html}</main>`;
    const out = extractor('Perplexity', 10, {});
    if (out.ok) expect(out.html).not.toMatch(/FIRST turn[\s\S]*SECOND turn/);
    else expect(out.reason).toBe('wide_container_only');
  });

  test('nested candidates with the same text: the inner one wins', () => {
    document.body.innerHTML = `<main><article><div class="prose"><p>${'same text '.repeat(20)}</p></div></article></main>`;
    const out = extractor('Perplexity', 10, {});
    expect(out.ok).toBe(true);
    expect(out.selectorUsed).toBe('.prose');
  });
});

describe('GPT skeleton: turn container vs answer', () => {
  test('conversation in one article is rejected; the answer inside is chosen, not the page', () => {
    const user = '<div data-message-author-role="user"><p>my question for the model</p></div>';
    document.body.innerHTML = `<main><article class="conversation">${user}${fixtureHtml('chatgpt')}</article><form><textarea></textarea></form></main>`;
    const out = extractor('GPT', 10, {});
    expect(out.ok).toBe(true);
    expect(out.html).toContain('⟦TEXT:');
    expect(out.html).not.toContain('my question');
    expect(out.html).toMatch(/<h1[ >]/);
    expect(out.html).toMatch(/<ul[ >]/);
    expect(out.selectorUsed).not.toBe('article');
  });
});

describe('text, html and markdown come from the same node', () => {
  test('extractor result describes the last turn only, in all three forms', () => {
    document.body.innerHTML = `<main>
      <div data-message-author-role="assistant"><h2>FIRST</h2><p>first answer body that is long enough</p></div>
      <div data-message-author-role="assistant"><h2>SECOND</h2><p>second answer body that is long enough</p></div></main>`;
    const out = extractor('Le Chat', 10, {});
    expect(out.text).toContain('SECOND');
    expect(out.html).toContain('SECOND');
    expect(out.answerMarkdown).toContain('## SECOND');
    [out.text, out.html, out.answerMarkdown].forEach((value) => expect(value).not.toContain('FIRST'));
    expect(out.copyReport).toMatchObject({ version: 1 });
  });
});

describe('card without html shows the markdown, not one flat paragraph', () => {
  const block = () => {
    const src = read('results.js');
    return src.slice(src.indexOf('const answerCopyPending = {};'), src.indexOf('const debateFeedMessageMeta = (message)'));
  };
  const api = () => new Function('replaceChildrenFromSanitizedHtml', 'decorateLinksForNewTab', 'renderMarkdownHtml', `${block()}; return { stashAnswerCopy, applyAnswerCopyToCard, renderMarkdownWhenNoHtml };`)((el, html) => { el.innerHTML = html; }, () => {}, (md) => require('../shared/markdown-to-html').render(md));
  const makeCard = () => {
    const card = document.createElement('div');
    card.innerHTML = '<span class="debate-model-card-meta"></span><div class="debate-model-card-output">flat text one paragraph</div>';
    document.body.appendChild(card);
    return card;
  };
  const report = { version: 1, found: {}, copied: {}, placeholders: [], mismatches: [], flags: {}, complete: true };

  test('empty html + markdown: the markdown is shown as structure, with an "html отсутствует" marker', () => {
    const { stashAnswerCopy, applyAnswerCopyToCard, renderMarkdownWhenNoHtml } = api();
    const card = makeCard();
    stashAnswerCopy('Le Chat', { answerMarkdown: '# Title\n\n- a\n- b\n\n```js\nx = 1\n```', copyReport: report }, '');
    applyAnswerCopyToCard(card, 'Le Chat', '');
    const body = card.querySelector('.debate-model-card-output');
    expect(renderMarkdownWhenNoHtml(body, card, '')).toBe(true);
    expect(body.querySelector('h1').textContent).toBe('Title');
    expect(body.querySelectorAll('li')).toHaveLength(2);
    expect(body.querySelector('pre code').textContent).toBe('x = 1');
    expect(card.querySelector('.debate-copy-incomplete').title).toContain('html');
  });

  test('with html, or without markdown, nothing changes', () => {
    const { stashAnswerCopy, applyAnswerCopyToCard, renderMarkdownWhenNoHtml } = api();
    const card = makeCard();
    stashAnswerCopy('Le Chat', { answerMarkdown: '# T', copyReport: report }, '');
    applyAnswerCopyToCard(card, 'Le Chat', '');
    const body = card.querySelector('.debate-model-card-output');
    expect(renderMarkdownWhenNoHtml(body, card, '<p>x</p>')).toBe(false);
    const bare = makeCard();
    expect(renderMarkdownWhenNoHtml(bare.querySelector('.debate-model-card-output'), bare, '')).toBe(false);
  });
});

describe('every live skeleton inside a conversation container (selection matrix)', () => {
  const NAMES = {
    chatgpt: 'GPT', claude: 'Claude', gemini: 'Gemini', grok: 'Grok', perplexity: 'Perplexity',
    qwen: 'Qwen', deepseek: 'DeepSeek', lechat: 'Le Chat', zai: 'Z.ai'
  };
  const results = {};
  test.each(Object.entries(NAMES))('%s skeleton: %s', (file, model) => {
    const html = fixtureHtml(file);
    document.body.innerHTML = `<main><div id="conversation"><div data-message-author-role="user"><p>QUESTION text of the user</p></div>${html}</div><form><textarea></textarea></form></main>`;
    const out = extractor(model, 10, {});
    results[file] = out.ok ? `ok:${out.selectorUsed}` : `fail:${out.reason}`;
    // Either the answer itself or an explicit failure — never the page with the user's question inside.
    if (out.ok) {
      expect(out.html).not.toContain('QUESTION');
      expect(out.text).not.toContain('QUESTION');
    } else {
      expect(out.reason).toBeTruthy();
    }
  });
  afterAll(() => { console.log('selection matrix', JSON.stringify(results)); });
});
