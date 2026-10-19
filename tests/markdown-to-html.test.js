/** @jest-environment jsdom */
// shared/markdown-to-html.js: the GFM subset a card shows when an answer has a markdown copy but no html.
const fs = require('fs');
const path = require('path');
const { render } = require('../shared/markdown-to-html');

const dom = (md) => { const host = document.createElement('div'); host.innerHTML = render(md); return host; };

describe('MarkdownToHtml', () => {
  test('headings, paragraphs with line breaks, emphasis, strikethrough, links', () => {
    const host = dom('# One\n\n### Three\n\nline a\nline b **bold** *it* ~~gone~~ `code` [doc](https://example.com/x)');
    expect(host.querySelector('h1').textContent).toBe('One');
    expect(host.querySelector('h3').textContent).toBe('Three');
    expect(host.querySelector('p').innerHTML).toBe('line a<br>line b <strong>bold</strong> <em>it</em> <del>gone</del> <code>code</code> <a href="https://example.com/x">doc</a>');
  });

  test('nested mixed lists, start number, tight and loose items', () => {
    const host = dom('- a\n  1. b\n     - c\n- d\n\n5. five\n6. six');
    expect(host.querySelector('ul > li > ol > li > ul > li').textContent).toBe('c');
    const ordered = host.querySelectorAll(':scope > ol')[0];
    expect(ordered.getAttribute('start')).toBe('5');
    expect(ordered.children).toHaveLength(2);
    expect(host.querySelector('ul > li').firstChild.textContent).toBe('a');
  });

  test('task lists and footnotes', () => {
    const host = dom('- [ ] open\n- [x] done\n\nclaim[^n] again[^n]\n\n[^n]: the source');
    expect(Array.from(host.querySelectorAll('li'), (li) => li.textContent.trim())).toEqual(['☐ open', '☑ done', 'the source']);
    expect(host.querySelectorAll('sup')).toHaveLength(2);
    expect(host.querySelector('sup').textContent).toBe('[1]');
  });

  test('fenced code keeps every character, the language, and longer outer fences', () => {
    const host = dom('````md\n```js\nlet a = 1;   \n\n  <b>&amp;</b>\n```\n````\n\n~~~python\nprint(1)\n~~~');
    const [outer, py] = host.querySelectorAll('pre code');
    expect(outer.className).toBe('language-md');
    expect(outer.textContent).toBe('```js\nlet a = 1;   \n\n  <b>&amp;</b>\n```');
    expect(py.className).toBe('language-python');
    expect(host.querySelector('b')).toBeNull();
  });

  test('pipe tables: alignment, escaped pipe, inline code, line break in a cell', () => {
    const host = dom('| Name | Qty | Note |\n|:--|--:|:-:|\n| `a\\|b` | 2 | x<br>y |\n| plain | 3 | |');
    const heads = host.querySelectorAll('th');
    expect(Array.from(heads, (th) => th.style.textAlign)).toEqual(['left', 'right', 'center']);
    expect(host.querySelector('td code').textContent).toBe('a|b');
    expect(host.querySelector('tbody tr td:nth-child(3)').innerHTML).toBe('x<br>y');
    expect(host.querySelectorAll('tbody tr')).toHaveLength(2);
  });

  test('block quotes (nested), horizontal rule, the not-copied placeholder stays text', () => {
    const host = dom('> q1\n> > q2\n\n---\n\n[НЕ СКОПИРОВАНО: тип=mermaid, причина=нет, позиция=1]');
    expect(host.querySelector('blockquote blockquote p').textContent).toBe('q2');
    expect(host.querySelector('hr')).not.toBeNull();
    expect(host.lastElementChild.textContent).toContain('НЕ СКОПИРОВАНО');
  });

  test('raw html and unsafe links are never live', () => {
    const host = dom('<script>alert(1)</script> <img src=x onerror=alert(1)>\n\n[click](javascript:alert(1)) ![pic](data:text/html;base64,AA)');
    expect(host.querySelector('script, img')).toBeNull();
    expect(host.querySelector('a')).toBeNull();
    expect(host.textContent).toContain('<script>alert(1)</script>');
  });

  test('an unterminated fence is shown whole; empty input gives nothing', () => {
    expect(dom('```js\nlet a').querySelector('pre code').textContent).toBe('let a');
    expect(render('')).toBe('');
  });

  test('the result survives sanitizeHTML (DOMPurify) with its structure', () => {
    window.eval(fs.readFileSync(path.join(__dirname, '..', 'lib', 'purify.min.js'), 'utf8'));
    delete window.sanitizeHTML;
    window.eval(fs.readFileSync(path.join(__dirname, '..', 'utils', 'sanitize.js'), 'utf8'));
    const clean = window.sanitizeHTML(render('## T\n\n5. a\n6. b\n\n| a | b |\n|:-:|--:|\n| 1 | 2 |\n\n```js\nx\n```\n\n[l](https://e.com)'));
    const host = document.createElement('div');
    host.innerHTML = clean;
    expect(host.querySelector('h2')).not.toBeNull();
    expect(host.querySelector('ol').getAttribute('start')).toBe('5');
    expect(host.querySelector('th').style.textAlign).toBe('center');
    expect(host.querySelector('pre code').className).toBe('language-js');
    expect(host.querySelector('a').getAttribute('href')).toBe('https://e.com');
  });
});
