/** @jest-environment jsdom */
const fs = require('fs');
const path = require('path');
const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

// V10: the html of a captured answer carries the computed styles it needs, not all of them on every element
// (the old form was ~800 bytes per element and made the html of an answer ~20 times its text).
describe('inline html of a captured answer is compact', () => {
  beforeEach(() => {
    document.head.innerHTML = '';
    document.body.innerHTML = '';
    delete window.ContentUtils;
    window.__LLMLateAnswerSnapshotObserverStarted = true;
    window.eval(read('content-scripts/content-utils.js'));
  });

  const styleOf = (element) => element.getAttribute('style') || '';

  test('an inherited value equal to the parent one is not repeated; a different one is kept; neutral values are not written', () => {
    document.body.innerHTML = `<div id="root" style="color: rgb(1, 2, 3); font-size: 16px; margin-top: 0px; padding-left: 0px; background-color: rgba(0, 0, 0, 0)">
      <div id="box" style="color: rgb(1, 2, 3); font-size: 16px; margin-top: 4px">
        <p id="deep" style="color: rgb(1, 2, 3); font-size: 16px; margin-top: 0px">
          <span id="inner" style="color: rgb(1, 2, 3)">a</span><strong id="mark" style="color: rgb(9, 9, 9); font-weight: 700">b</strong>
        </p>
      </div></div>`;
    const clone = window.ContentUtils.cloneElementWithInlineStyles(document.getElementById('root'));
    // The root carries every inherited value it has; its neutral values are left out.
    expect(styleOf(clone)).toContain('color:rgb(1, 2, 3);');
    expect(styleOf(clone)).toContain('font-size:16px;');
    expect(styleOf(clone)).not.toContain('margin-top');
    expect(styleOf(clone)).not.toContain('background-color');
    // A child of the root carries its inherited values too (the html without the root stays whole) and its real margin.
    const box = clone.querySelector('#box');
    expect(styleOf(box)).toContain('color:rgb(1, 2, 3);');
    expect(styleOf(box)).toContain('margin-top:4px;');
    // Deeper elements keep only what differs from the parent.
    expect(styleOf(clone.querySelector('#deep'))).toBe('');
    expect(styleOf(clone.querySelector('#inner'))).toBe('');
    expect(styleOf(clone.querySelector('#mark'))).toContain('color:rgb(9, 9, 9);');
    expect(styleOf(clone.querySelector('#mark'))).toContain('font-weight:700;');
  });

  test('the shorthands that repeat the longhands are not written', () => {
    document.body.innerHTML = '<div id="root" style="margin: 2px; padding: 3px; border: 1px solid rgb(0, 0, 0)"><p id="p">x</p></div>';
    const clone = window.ContentUtils.cloneElementWithInlineStyles(document.getElementById('root'));
    expect(styleOf(clone)).not.toMatch(/(^|;)(margin|padding|border):/);
    expect(styleOf(clone)).toContain('margin-top:2px;');
  });

  test('a long answer is a small multiple of its text, not twenty', () => {
    const paragraphs = Array.from({ length: 30 }, (_, i) => `<p style="color: rgb(32, 31, 28); font-family: Inter; font-size: 16px; line-height: 24px; margin-top: 0px; margin-bottom: 0px"><strong style="color: rgb(32, 31, 28); font-family: Inter; font-size: 16px; line-height: 24px; font-weight: 700">Пункт ${i}</strong> текст ответа номер ${i}</p>`).join('');
    document.body.innerHTML = `<div id="root" style="color: rgb(32, 31, 28); font-family: Inter; font-size: 16px; line-height: 24px">${paragraphs}</div>`;
    const html = window.ContentUtils.buildInlineHtml(document.getElementById('root'), { includeRoot: false });
    const text = document.getElementById('root').textContent;
    expect(html.length).toBeLessThan(text.length * 8);
  });
});
