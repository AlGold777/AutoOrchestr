/** @jest-environment jsdom */
// L-5: the copy of each provider for table, code and diagram, on the fixtures and live skeletons in the repository.
// Where a provider has no fixture for a case, the matrix (docs/Architecture/answer-markdown-matrix.md) names the GPT-extension task.
const fs = require('fs');
const path = require('path');
const AM = require('../shared/answer-markdown.js');
const Providers = require('../shared/answer-markdown-providers.js');
const BRT = require('../shared/basic-reply-text.js');

const FIX = path.join(__dirname, 'fixtures', 'answer-markdown');
const SKEL = path.join(__dirname, 'fixtures', 'live-answer-skeletons');
const FILES = { GPT: 'gpt', Gemini: 'gemini', Claude: 'claude', Grok: 'grok', 'Le Chat': 'lechat', Qwen: 'qwen', DeepSeek: 'deepseek', Perplexity: 'perplexity', 'Z.ai': 'zai', Kimi: 'kimi' };

beforeAll(() => {
  Providers.register(AM);
});

// Converts the section of a provider fixture with the given case name.
function convertCase(provider, caseName) {
  document.body.innerHTML = fs.readFileSync(path.join(FIX, `${FILES[provider]}.html`), 'utf8');
  const section = document.querySelector(`section[data-case="${caseName}"]`);
  if (!section) throw new Error(`no case ${caseName} in ${provider}`);
  return AM.convert(section.firstElementChild || section, { provider, context: {} });
}

describe('code blocks: fenced with the language, the text kept', () => {
  test.each([
    ['GPT', 'code-labelled', '```python\ndef f(x):'],
    ['GPT', 'code-unlabelled', '```\n├── src'],
    ['Grok', 'code-labelled', '```diff\n- old'],
    ['DeepSeek', 'code-labelled', '```json\n{'],
    ['Gemini', 'code-block-element-unverified', '```python\nprint(1)\n```'],
    ['Qwen', 'code-generic-unverified', '```python\nx = 1\n```'],
    ['Claude', 'code-header-label-unverified', '```bash\nls -la\necho "x"\n```']
  ])('%s %s starts a fence', (provider, caseName, expected) => {
    const r = convertCase(provider, caseName);
    expect(r.markdown).toContain(expected);
    expect(r.report.complete).toBe(true);
  });

  test('a code block is reported as copied (no placeholder, no mismatch)', () => {
    const r = convertCase('GPT', 'code-labelled');
    expect(r.report.found.code).toBe(1);
    expect(r.report.copied.code).toBe(1);
    expect(r.report.mismatches).toEqual([]);
  });
});

describe('tables: GFM pipe tables with the cells kept', () => {
  test.each([
    ['GPT', 'table', '| Key | Value |\n| --- | --- |\n| `a` | one |'],
    ['Grok', 'table', '| A | B |\n| --- | --- |\n| 1 | 2 c |'],
    ['DeepSeek', 'table', '| A | B |\n| --- | --- |\n| x `y\\|z` | 1 |'],
    ['Qwen', 'table', '| A |\n| --- |\n| `x` |']
  ])('%s table is a pipe table', (provider, caseName, expected) => {
    const r = convertCase(provider, caseName);
    expect(r.markdown).toContain(expected);
    expect(r.report.complete).toBe(true);
  });
});

describe('Perplexity: source chips do not make the copy incomplete (live skeleton)', () => {
  test('the live answer skeleton converts to a complete copy with its links', () => {
    const sk = JSON.parse(fs.readFileSync(path.join(SKEL, 'perplexity.json'), 'utf8'));
    document.body.innerHTML = sk.capture.html;
    const node = document.querySelector('[id^="markdown-content-"]');
    expect(node).not.toBeNull();
    const r = AM.convert(node, { provider: 'Perplexity', context: {} });
    expect(r.report.placeholders.filter((p) => p.type === 'svg')).toEqual([]);
    expect(r.report.complete).toBe(true);
  });
});

describe('Z.ai and Kimi: markdown without cleanContent', () => {
  test.each(['Z.ai', 'Kimi'])('%s has its own rules and a complete copy of a text answer', (provider) => {
    expect(Providers.RULES[provider]).toBeDefined();
    const r = convertCase(provider, 'answer-root');
    expect(r.markdown).toBe('answer');
    expect(r.report.complete).toBe(true);
  });

  test('the Basic reply takes the copy of a Z.ai or Kimi answer when the plain text is the same answer', () => {
    const r = convertCase('Z.ai', 'answer-root');
    const choice = BRT.choose({ plain: 'answer', markdown: r.markdown, report: r.report });
    expect(choice.text_source).toBe('markdown');
  });
});
