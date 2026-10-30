/** @jest-environment jsdom */
// Tables of ChatGPT and Perplexity answers reach the text as markdown tables. Their fallback text path is
// contentCleaner.cleanContent(html): it parses the HTML and takes body.textContent, which glues the cells.
// The shared converter runs on the parsed body before textContent (same order as in content-claude.js).
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const Providers = require('../shared/answer-markdown-providers.js');

// ChatGPT: the table sits in a scroll wrapper (class names from tests/fixtures/live-answer-skeletons/chatgpt.json),
// its copy button is a sibling with an aria-label and an svg, no text.
const CHATGPT_FIXTURE = `
<div data-markdown-text-style="assistant-message">
  <p>Сводка по отклонённым замечаниям:</p>
  <div class="TyagGW_tableContainer">
    <div class="group TyagGW_tableWrapper flex flex-col-reverse w-fit">
      <table class="w-fit min-w-(--thread-content-width)">
        <thead><tr><th class="last:pe-10">Замечание</th><th class="last:pe-10">Причина</th></tr></thead>
        <tbody>
          <tr><td><code>П.1</code></td><td>Принято частично</td></tr>
          <tr><td><code>П.6</code></td><td>Отклонено | резерв</td></tr>
        </tbody>
      </table>
      <div class="relative h-0 self-end select-none"><div class="absolute end-0 flex items-end"><span><button aria-label="Copy table"><svg aria-hidden="true"><use></use></svg></button></span></div></div>
    </div>
  </div>
  <p>Итог. [[AO-a1b2c3]]</p>
</div>`;

// Perplexity: no table markup is confirmed yet (the skeleton has none). The fixture only follows the answer root
// id prefix from the provider rules (shared/answer-markdown-providers.js, perplexity). Unverified, see report.
const PERPLEXITY_FIXTURE = `
<div id="markdown-content-0">
  <p>Сравнение вариантов:</p>
  <table>
    <thead><tr><th>Вариант</th><th>Срок</th></tr></thead>
    <tbody>
      <tr><td>A</td><td>2 недели</td></tr>
      <tr><td>B</td><td>1 месяц</td></tr>
    </tbody>
  </table>
  <p>Вывод.</p>
</div>`;

// Mirrors the order inside cleanContent's DOMParser branch: UI removal, then the table conversion, then textContent.
function cleanLikeContentCleaner(html) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  doc.querySelectorAll('script,style,svg,canvas,noscript,header,footer,nav,aside,[aria-hidden="true"]').forEach((el) => el.remove());
  Providers.replaceTablesWithMarkdown(doc.body);
  return doc.body?.textContent || '';
}

describe('ChatGPT answer: tables keep their cells as markdown', () => {
  test('the scroll wrapper and its copy button leave one markdown table, cells are not glued', () => {
    const text = cleanLikeContentCleaner(CHATGPT_FIXTURE);
    expect(text).not.toContain('ЗамечаниеПричина');
    expect(text).not.toContain('Copy table');
    expect(text).toContain('| Замечание | Причина |\n| --- | --- |\n| П.1 | Принято частично |\n| П.6 | Отклонено \\| резерв |');
  });

  test('the text keeps order: intro before the table, the table before the closing line and the delivery token', () => {
    const text = cleanLikeContentCleaner(CHATGPT_FIXTURE);
    expect(text.indexOf('Сводка')).toBeLessThan(text.indexOf('| Замечание'));
    expect(text.indexOf('| П.6')).toBeLessThan(text.indexOf('Итог.'));
    expect(text).toContain('[[AO-a1b2c3]]');
  });
});

describe('Perplexity answer: tables keep their cells as markdown', () => {
  test('a plain table in the answer root becomes a markdown table with a delimiter row', () => {
    const text = cleanLikeContentCleaner(PERPLEXITY_FIXTURE);
    expect(text).not.toContain('ВариантСрок');
    expect(text).toContain('| Вариант | Срок |\n| --- | --- |\n| A | 2 недели |\n| B | 1 месяц |');
    expect(text.indexOf('Сравнение')).toBeLessThan(text.indexOf('| Вариант'));
    expect(text.indexOf('| B')).toBeLessThan(text.indexOf('Вывод.'));
  });
});

describe('cleanContent of both providers calls the converter before textContent', () => {
  const sourceOf = (file) => fs.readFileSync(path.join(ROOT, 'content-scripts', file), 'utf8');

  test.each(['content-chatgpt.js', 'content-perplexity.js'])('%s: replaceTablesWithMarkdown precedes body.textContent', (file) => {
    const src = sourceOf(file);
    const call = src.indexOf('AnswerMarkdownProviders?.replaceTablesWithMarkdown?.(doc.body)');
    const textOf = src.indexOf("textContent = doc.body?.textContent || ''", call);
    expect(call).toBeGreaterThan(-1);
    expect(textOf).toBeGreaterThan(call);
  });

  test('the converter leaves a page without tables unchanged', () => {
    expect(cleanLikeContentCleaner('<div><p>Просто текст</p></div>')).toBe('Просто текст');
  });
});
