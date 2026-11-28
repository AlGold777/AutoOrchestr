/** @jest-environment jsdom */
// DeepSeek (live, 2026-10-28): the assistant message holds a header "Thought for N seconds" with its icons, the reasoning
// (ds-think-content) and the answer (.ds-markdown.ds-assistant-message-main-content). The answer is the marked block alone:
// widening the turn to the whole message put the header and the reasoning text into the answer of a pulled Get It.
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');
const sliceFunction = (src, name) => {
  const start = src.indexOf(`function ${name}(`);
  const open = src.indexOf('{', src.indexOf(')', start));
  let depth = 0;
  for (let i = open; i < src.length; i += 1) {
    if (src[i] === '{') depth += 1;
    if (src[i] === '}') { depth -= 1; if (depth === 0) return src.slice(start, i + 1); }
  }
  throw new Error('unbalanced');
};
const extractor = new Function(`${sliceFunction(read('background/job-orchestrator.js'), 'extractLatestAssistantSnapshotInPage')}; return extractLatestAssistantSnapshotInPage;`)();

const icon = '<div class="ds-icon"><svg><path></path></svg></div>';
// The reasoning of the live page is plain text in divs (no <p>): nothing marks it as a text block, so the turn widened over it.
const message = (header, thinkWord, answerWord) => `
  <div class="ds-virtual-list-item"><div class="ds-message"><div class="_74c0879">
    <div class="_245c867"><div class="_5ab5d64">${icon}<span class="_5255ff8">${header}</span>${icon}</div></div>
    <div class="c2b72bb8"><div class="ds-think-content"><div class="ds-markdown"><div>${(`${thinkWord} `).repeat(120)}</div></div></div></div>
    <div class="_8f7678d"></div>
  </div><div class="ds-markdown ds-assistant-message-main-content"><p>${(`${answerWord} `).repeat(200)}</p></div></div></div>`;

const loadAll = () => {
  ['AnswerMarkdown', 'AnswerMarkdownBlocks', 'AnswerMarkdownExtras', 'AnswerMarkdownProviders', 'AnswerHtmlBuilder', 'ContentUtils', 'AnswerStructure']
    .forEach((k) => { delete window[k]; });
  window.chrome = window.chrome || { runtime: { id: 'x', sendMessage: jest.fn() } };
  ['content-scripts/answer-structure.js', 'shared/answer-markdown.js', 'shared/answer-markdown-blocks.js', 'shared/answer-markdown-extras.js',
    'shared/answer-markdown-providers.js', 'content-scripts/answer-html-builder.js', 'content-scripts/content-utils.js'].forEach((f) => window.eval(read(f)));
};

const onlyAnswer = (out) => {
  expect(out.ok).toBe(true);
  expect(out.text).toContain('ANSWERWORD');
  expect(out.text).not.toMatch(/Thought for|THINKWORD/);
  expect(out.html).toContain('ANSWERWORD');
  expect(out.html).not.toMatch(/Thought for|THINKWORD/);
};

describe.each([['Thought for 4 seconds'], ['Thinking']])('header "%s"', (header) => {
  beforeEach(() => {
    loadAll();
    document.body.innerHTML = `<div class="ds-scroll-area">
      <div class="ds-virtual-list-item"><div class="ds-message"><div>${'PROMPTWORD '.repeat(60)}</div></div></div>
      ${message(header, 'THINKWORD', 'ANSWERWORD')}</div>`;
  });

  test('in-page extractor (Get It): the marked answer block only', () => {
    onlyAnswer(extractor('DeepSeek', 80, {}));
  });

  test('late snapshot: the marked answer block only', () => {
    onlyAnswer(window.ContentUtils.collectLateSnapshotCandidate('DeepSeek', 80, { withMarkdown: true }));
  });
});

describe('DeepSeek adapter fallback with a reasoning-only turn', () => {
  const source = read('content-scripts/content-deepseek.js');
  const start = source.indexOf('  const DEEPSEEK_FALLBACK_LAST_MESSAGE_SELECTORS');
  const end = source.indexOf('  const findDeepSeekContinueButton', start);

  function grabAdapterAnswer() {
    return new Function('buildInlineHtml', source.slice(start, end) + '\nreturn grabLatestAssistantText();')(
      (node) => node.outerHTML
    );
  }

  beforeEach(() => {
    loadAll();
    window.eval(read('content-scripts/answer-pipeline-selectors.js'));
    document.body.innerHTML = `<div class="ds-message"><div class="ds-think-content">
      <div class="ds-markdown">${'We need to solve the task before we write the final answer. '.repeat(200)}</div>
    </div></div>`;
  });

  test('a markdown node inside reasoning is not a reply candidate', () => {
    expect(grabAdapterAnswer()).toMatchObject({ text: '', html: '', node: null });
  });

  test('the actual answer block remains readable beside a reasoning block', () => {
    const reply = document.createElement('div');
    reply.className = 'ds-markdown ds-assistant-message-main-content';
    reply.textContent = 'The completed answer.';
    document.querySelector('.ds-message').append(reply);

    const answer = grabAdapterAnswer();
    expect(answer.text).toBe('The completed answer.');
    expect(answer.node).toBe(reply);
  });
});
