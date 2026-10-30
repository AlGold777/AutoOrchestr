/** @jest-environment jsdom */
// An answer that is several blocks (prose, diagram widgets, prose...) must be pulled WHOLE: the node found by a
// selector (".prose") may be only one block of the turn. Common rule for every provider (no provider names inside).
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');
const ORCH = read('background/job-orchestrator.js');
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
const extractor = new Function(`${sliceFunction(ORCH, 'extractLatestAssistantSnapshotInPage')}; return extractLatestAssistantSnapshotInPage;`)();
const SOURCE = 'flowchart LR\n  A[Start] --> B[Done]';
const prose = (text) => `<div class="prose"><p>${text}</p></div>`;
const widget = (n) => `<div><div><div><iframe title="Mermaid diagram" sandbox="allow-scripts" src="https://render.example.test/m${n}"></iframe></div><div style="display:none"><pre>${SOURCE.replace('Start', `Start${n}`)}</pre></div></div></div>`;

beforeEach(() => {
  ['AnswerHtmlBuilder', 'ContentUtils', 'AnswerMarkdown', 'AnswerMarkdownBlocks', 'AnswerMarkdownExtras', 'AnswerMarkdownProviders', 'AnswerStructure'].forEach((k) => { delete window[k]; });
  window.chrome = { runtime: { id: 'x', sendMessage: jest.fn() } };
  ['content-scripts/answer-structure.js', 'shared/answer-markdown.js', 'shared/answer-markdown-blocks.js', 'shared/answer-markdown-extras.js',
    'shared/answer-markdown-providers.js', 'content-scripts/answer-html-builder.js'].forEach((file) => window.eval(read(file)));
});

describe('one turn made of several blocks', () => {
  test('prose, N diagram widgets (iframe + hidden source), prose: the whole turn, all sources, no "not copied" notes', () => {
    document.body.innerHTML = `<main><div id="thread"><h1>The question of the user</h1>
      <div id="turn">${prose('First paragraph of the answer, long enough.')}${widget(1)}${prose('Second paragraph between diagrams, long enough.')}${widget(2)}${prose('Last paragraph of the answer, long enough.')}</div>
      </div></main>`;
    const out = extractor('Perplexity', 10, {});
    expect(out.ok).toBe(true);
    expect(out.turnExpanded).toBe(true);
    ['First paragraph', 'Second paragraph', 'Last paragraph'].forEach((word) => expect(out.text).toContain(word));
    expect(out.text).not.toContain('question of the user');
    const host = document.createElement('div');
    host.innerHTML = out.html;
    expect(host.querySelectorAll('pre[data-code-lang="mermaid"]')).toHaveLength(2);
    expect(host.querySelector('iframe')).toBeNull();
    expect(host.textContent).not.toContain('не скопирован');
    expect(out.copyReport.placeholders.filter((item) => item.type === 'embed')).toEqual([]);
    expect(out.answerMarkdown).toContain('Last paragraph');
  });

  test('several prose blocks only', () => {
    document.body.innerHTML = `<main><h1>Question</h1><div id="turn">${prose('Block one of the answer, long enough for the text.')}${prose('Block two of the answer, long enough for the text.')}</div></main>`;
    const out = extractor('Perplexity', 10, {});
    expect(out.ok).toBe(true);
    expect(out.text).toContain('Block one');
    expect(out.text).toContain('Block two');
    expect(out.text).not.toContain('Question');
  });

  test('a diagram AFTER the last prose block is taken in too (only media neighbours are absorbed)', () => {
    document.body.innerHTML = `<main><h1>Question</h1><div id="turn">${prose('The only text block of this answer, long enough to be an answer.')}${widget(1)}</div></main>`;
    const out = extractor('Perplexity', 10, {});
    expect(out.ok).toBe(true);
    const host = document.createElement('div');
    host.innerHTML = out.html;
    expect(host.querySelectorAll('pre[data-code-lang="mermaid"]')).toHaveLength(1);
  });

  test('earlier turns are not pulled in: a question lies between them', () => {
    document.body.innerHTML = `<main><div id="thread">
      <h1>Question one</h1><div>${prose('Answer to the first question, long enough here.')}${prose('Second block of the first answer, long enough.')}</div>
      <h1>Question two</h1><div id="turn">${prose('Answer to the second question, long enough here.')}${prose('Second block of the second answer, long enough.')}</div></div></main>`;
    const out = extractor('Perplexity', 10, {});
    expect(out.ok).toBe(true);
    expect(out.text).toContain('Answer to the second question');
    expect(out.text).toContain('Second block of the second answer');
    expect(out.text).not.toContain('first question');
    expect(out.text).not.toContain('first answer');
  });

  test('the related-questions panel and links next to the answer are not taken in', () => {
    document.body.innerHTML = `<main><h1>Question</h1><div id="turn">${prose('The text of the answer, long enough to be the answer.')}${widget(1)}</div>
      <div id="related"><p>Related question one</p><a href="#">Source link</a></div></main>`;
    const out = extractor('Perplexity', 10, {});
    expect(out.text).not.toContain('Related question');
    expect(out.html).not.toContain('Source link');
  });

  test('peers whose only common container is the page itself: fail with a reason, not half an answer', () => {
    document.body.innerHTML = `<main><section>${prose('Block A of an answer, long enough to be found.')}</section><section>${prose('Block B of an answer, long enough to be found.')}</section></main>`;
    const out = extractor('Perplexity', 10, {});
    expect(out.ok).toBe(false);
    expect(out.reason).toBe('answer_split_across_blocks');
  });

  test('an ordinary one-block answer is unchanged', () => {
    document.body.innerHTML = `<main><h1>Question</h1><div id="turn">${prose('A single block answer, long enough to be chosen here.')}</div></main>`;
    const out = extractor('Perplexity', 10, {});
    expect(out.ok).toBe(true);
    expect(out.turnExpanded).toBe(false);
  });

  test('the same rule for a provider with other selectors (a generic assistant markdown list)', () => {
    document.body.innerHTML = `<main><h1>Q</h1><div id="turn"><div class="markdown"><p>Part one of a generic answer, long enough here.</p></div><div class="markdown"><p>Part two of a generic answer, long enough here.</p></div></div></main>`;
    const out = extractor('Some Other Model', 10, {});
    expect(out.ok).toBe(true);
    expect(out.text).toContain('Part one');
    expect(out.text).toContain('Part two');
  });
});

describe('expandToTurn on its own', () => {
  test('returns the node itself without peers and for nodes without a parent', () => {
    document.body.innerHTML = '<div id="a"><p>x</p></div>';
    const a = document.getElementById('a');
    expect(window.AnswerHtmlBuilder.expandToTurn(a, []).status).toBe('same');
    expect(window.AnswerHtmlBuilder.expandToTurn(null, []).status).toBe('same');
  });

  test('a user message between peers separates the turns (role marks)', () => {
    document.body.innerHTML = `<div id="thread"><div id="t1"><div class="prose" id="p1"><p>one</p></div></div><div data-message-author-role="user"><p>ask</p></div><div id="t2"><div class="prose" id="p2"><p>two</p></div></div></div>`;
    const turn = window.AnswerHtmlBuilder.expandToTurn(document.getElementById('p2'), [document.getElementById('p1')]);
    expect(turn.status).toBe('same');
    expect(turn.node.id).toBe('p2');
  });
});
