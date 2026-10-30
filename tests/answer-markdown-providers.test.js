/** @jest-environment jsdom */
const fs = require('fs');
const path = require('path');
const Providers = require('../shared/answer-markdown-providers');

const FIX = path.join(__dirname, 'fixtures', 'answer-markdown');
const FILES = { GPT: 'gpt', Gemini: 'gemini', Claude: 'claude', Grok: 'grok', 'Le Chat': 'lechat', Qwen: 'qwen', DeepSeek: 'deepseek', Perplexity: 'perplexity', 'Z.ai': 'zai', Kimi: 'kimi' };

// returns the first element of <section data-case="..."> from the provider fixture
function load(provider, caseName) {
  const html = fs.readFileSync(path.join(FIX, `${FILES[provider]}.html`), 'utf8');
  document.body.innerHTML = html;
  const section = document.querySelector(`section[data-case="${caseName}"]`);
  if (!section) throw new Error(`no case ${caseName} in ${provider}`);
  return section;
}
const rules = (p) => Providers.RULES[p];

describe('registration', () => {
  test('rules exist for all 10 providers with the contract fields', () => {
    expect(Providers.PROVIDERS.sort()).toEqual(Object.keys(FILES).sort());
    Object.keys(FILES).forEach((p) => {
      ['isUiNode', 'codeBlock', 'tableRoot', 'answerRoot'].forEach((f) => expect(typeof rules(p)[f]).toBe('function'));
    });
  });

  test('register() calls registerProvider once per provider', () => {
    const calls = [];
    expect(Providers.register({ registerProvider: (n, r) => calls.push([n, r]) })).toBe(true);
    expect(calls.map((c) => c[0]).sort()).toEqual(Object.keys(FILES).sort());
    expect(Providers.register({})).toBe(false);
  });
});

describe('code blocks (confirmed by skeletons)', () => {
  test('GPT: language from header label, exact text, no Copy label, tab and trailing spaces kept', () => {
    const el = load('GPT', 'code-labelled').querySelector('pre');
    expect(rules('GPT').codeBlock(el)).toEqual({ lang: 'python', text: 'def f(x):\n    if x:\n\n        return "a\tb"   \n    return None' });
  });

  test('GPT: inner cm-content resolves to the same block as the outer <pre>', () => {
    const outer = load('GPT', 'code-labelled').querySelector('pre');
    expect(rules('GPT').codeBlock(outer.querySelector('pre.cm-content'))).toEqual(rules('GPT').codeBlock(outer));
  });

  test('GPT: unlabelled block gives empty lang; NBSP and box-drawing characters are kept', () => {
    const el = load('GPT', 'code-unlabelled').querySelector('pre');
    expect(rules('GPT').codeBlock(el)).toEqual({ lang: '', text: '├── src\n│   └── a.js\n└── b.txt\u00a0x' });
  });

  test('DeepSeek: language from banner span (hashed class), buttons and svg excluded', () => {
    const wrap = load('DeepSeek', 'code-labelled').querySelector('.md-code-block');
    const expected = { lang: 'json', text: '{\n  "a": 1,\n\n  "b": [1, 2]\n}' };
    expect(rules('DeepSeek').codeBlock(wrap)).toEqual(expected);
    expect(rules('DeepSeek').codeBlock(wrap.querySelector('pre'))).toEqual(expected);
  });

  test('Grok: per-line spans joined with newline, diff markers and blank line kept, header excluded', () => {
    const wrap = load('Grok', 'code-labelled').querySelector('[data-testid="code-block"]');
    const expected = { lang: 'diff', text: '- old\n+ new\n\n  same' };
    expect(rules('Grok').codeBlock(wrap)).toEqual(expected);
    expect(rules('Grok').codeBlock(wrap.querySelector('pre'))).toEqual(expected);
  });

  test('Grok: an inline span is not a block', () => {
    const p = load('Grok', 'inline-not-block').querySelector('p');
    expect(rules('Grok').codeBlock(p)).toBeNull();
  });

  test('Le Chat: data-testid="code-block" on inline <code> is not a fenced block', () => {
    const code = load('Le Chat', 'inline-testid').querySelector('code');
    expect(code.getAttribute('data-testid')).toBe('code-block');
    expect(rules('Le Chat').codeBlock(code)).toBeNull();
  });
});

describe('code blocks (generic heuristics, unverified live)', () => {
  test('language-* class on <code>; final newline artefact dropped', () => {
    const pre = load('Qwen', 'code-generic-unverified').querySelector('pre');
    expect(rules('Qwen').codeBlock(pre)).toEqual({ lang: 'python', text: 'x = 1' });
  });

  test('language label as a separate header node, Copy ignored', () => {
    const pre = load('Claude', 'code-header-label-unverified').querySelector('pre');
    expect(rules('Claude').codeBlock(pre)).toEqual({ lang: 'bash', text: 'ls -la\necho "x"' });
  });

  test('<code-block> custom element (Gemini)', () => {
    const el = load('Gemini', 'code-block-element-unverified').querySelector('code-block');
    expect(rules('Gemini').codeBlock(el)).toEqual({ lang: 'python', text: 'print(1)' });
  });

  test('line numbers and gutters never reach the text', () => {
    document.body.innerHTML = '<pre data-language="js"><span class="line-numbers"><span>1</span><span>2</span></span><code>a();\nb();</code></pre>';
    expect(Providers.genericCodeBlock(document.querySelector('pre'))).toEqual({ lang: 'js', text: 'a();\nb();' });
    document.body.innerHTML = '<pre><code><span class="linenumber">1</span>a<br>b</code></pre>';
    expect(Providers.genericCodeBlock(document.querySelector('pre')).text).toBe('a\nb');
  });

  test('not a code block: plain div, bare <code>', () => {
    document.body.innerHTML = '<div id="d"><code id="c">x</code></div>';
    expect(Providers.genericCodeBlock(document.getElementById('d'))).toBeNull();
    expect(Providers.genericCodeBlock(document.getElementById('c'))).toBeNull();
  });
});

describe('tableRoot', () => {
  test.each([
    ['GPT', 'table'], ['DeepSeek', 'table'], ['Grok', 'table'], ['Qwen', 'table']
  ])('%s: scroll wrapper resolves to its <table>', (p, c) => {
    const section = load(p, c);
    const table = section.querySelector('table');
    expect(rules(p).tableRoot(section.firstElementChild)).toBe(table);
    expect(rules(p).tableRoot(table)).toBe(table);
  });

  test('Grok: every nesting level of the wrapper resolves to the table', () => {
    const section = load('Grok', 'table');
    const table = section.querySelector('table');
    expect(rules('Grok').tableRoot(section.querySelector('.table-container'))).toBe(table);
    expect(rules('Grok').tableRoot(section.querySelector('.peer\\/table'))).toBe(table);
  });

  test('an answer root that merely contains one table is not a table root', () => {
    document.body.innerHTML = '<div id="r"><p>text</p><div><table><tr><td>1</td></tr></table></div></div>';
    expect(rules('GPT').tableRoot(document.getElementById('r'))).toBeNull();
    document.body.innerHTML = '<div id="r"><div><table></table></div><div><table></table></div></div>';
    expect(rules('GPT').tableRoot(document.getElementById('r'))).toBeNull();
  });
});

describe('isUiNode', () => {
  const ui = (p, el) => rules(p).isUiNode(el);

  test('common: buttons and role=button are UI, text and tables are not', () => {
    document.body.innerHTML = '<div><button id="b">Copy</button><div role="button" id="rb"></div><p id="p">x</p><table id="t"><tr><td>1</td></tr></table><svg id="s"></svg></div>';
    ['b', 'rb'].forEach((id) => Object.keys(FILES).forEach((p) => expect(ui(p, document.getElementById(id))).toBe(true)));
    ['p', 't', 's'].forEach((id) => Object.keys(FILES).forEach((p) => expect(ui(p, document.getElementById(id))).toBe(false)));
  });

  test('DeepSeek: banner, ds-button text, decorative svg after <pre>', () => {
    const wrap = load('DeepSeek', 'code-labelled').querySelector('.md-code-block');
    expect(ui('DeepSeek', wrap.querySelector('.md-code-block-banner-wrap'))).toBe(true);
    expect(ui('DeepSeek', wrap.querySelector('.code-info-button-text'))).toBe(true);
    expect(ui('DeepSeek', wrap.querySelector(':scope > svg'))).toBe(true);
    expect(ui('DeepSeek', wrap.querySelector('pre'))).toBe(false);
  });

  test('Gemini: action tags and screen-reader label are UI, content container is not', () => {
    const s = load('Gemini', 'answer-root');
    ['copy-button', 'message-actions', 'thumb-up-button', 'mat-icon', 'thinking-overlay', 'h2.screen-reader-model-response-label']
      .forEach((sel) => expect(ui('Gemini', s.querySelector(sel))).toBe(true));
    expect(ui('Gemini', s.querySelector('structured-content-container'))).toBe(false);
  });

  test('Claude: sr-only label and status', () => {
    const s = load('Claude', 'answer-root');
    expect(ui('Claude', s.querySelector('h2.sr-only'))).toBe(true);
    expect(ui('Claude', s.querySelector('[role="status"]'))).toBe(true);
    expect(ui('Claude', s.querySelector('.standard-markdown'))).toBe(false);
  });

  test('reasoning blocks are service nodes (Le Chat, Qwen, Z.ai, Grok)', () => {
    expect(ui('Le Chat', load('Le Chat', 'answer-root').querySelector('[data-message-part-type="reasoning"]'))).toBe(true);
    expect(ui('Qwen', load('Qwen', 'answer-root').querySelector('.qwen-chat-tool-status-card'))).toBe(true);
    expect(ui('Z.ai', load('Z.ai', 'answer-root').querySelector('.thinking-chain-container'))).toBe(true);
    expect(ui('Grok', load('Grok', 'answer-root').querySelector('.thinking-container'))).toBe(true);
  });

  test('Qwen table toolbar; Perplexity citation spacer but not the citation chip itself', () => {
    expect(ui('Qwen', load('Qwen', 'table').querySelector('.qwen-markdown-table-header'))).toBe(true);
    const s = load('Perplexity', 'answer-root');
    expect(ui('Perplexity', s.querySelector('.citation-nbsp'))).toBe(true);
    expect(ui('Perplexity', s.querySelector('.citation'))).toBe(false); // source chips belong to WP3, never dropped silently
  });
});

describe('answerRoot', () => {
  test.each([
    ['GPT', 'answer-root', '.markdown'],
    ['Gemini', 'answer-root', 'structured-content-container'],
    ['Claude', 'answer-root', '.font-claude-response'],
    ['Grok', 'answer-root', '.response-content-markdown'],
    ['Le Chat', 'answer-root', '[data-message-part-type="answer"]'],
    ['Qwen', 'answer-root', '.qwen-markdown'],
    ['Perplexity', 'answer-root', '[id^="markdown-content-"]'],
    ['Z.ai', 'answer-root', '.chat-assistant.markdown-prose']
  ])('%s', (p, c, sel) => {
    const s = load(p, c);
    expect(rules(p).answerRoot(s.firstElementChild)).toBe(s.querySelector(sel));
  });

  test('DeepSeek and Kimi pick the answer, not the reasoning trace', () => {
    const d = load('DeepSeek', 'answer-root');
    expect(rules('DeepSeek').answerRoot(d.firstElementChild).textContent).toBe('answer');
    const k = load('Kimi', 'answer-root');
    expect(rules('Kimi').answerRoot(k.firstElementChild).textContent).toBe('answer');
  });

  test('returns null when nothing matches', () => {
    document.body.innerHTML = '<div id="x"><p>t</p></div>';
    Object.keys(FILES).forEach((p) => expect(rules(p).answerRoot(document.getElementById('x'))).toBeNull());
  });
});

describe('optional: engine integration', () => {
  let AM = null;
  try { AM = require('../shared/answer-markdown'); } catch (_) { AM = null; }
  (AM && AM.registerProvider ? test : test.skip)('rules register against the real engine', () => {
    expect(Providers.register(AM)).toBe(true);
  });
});
