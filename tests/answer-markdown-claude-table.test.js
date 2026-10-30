/** @jest-environment jsdom */
// A table of a chat answer reaches the text as a markdown table: the cells keep their boundaries (textContent alone
// glues them: «ЗамечаниеПричина»). The converter is shared; the Claude extractor calls it before textContent.
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const Providers = require('../shared/answer-markdown-providers.js');

const FIXTURE = `
<div class="font-claude-response">
  <p>Журнал отклонённых замечаний:</p>
  <table>
    <thead><tr><th>Замечание</th><th>Причина</th></tr></thead>
    <tbody>
      <tr><td>П.1: «архитектура не готова»</td><td>Принято   частично | см. этап 0</td></tr>
      <tr><td>П.6: резерв</td><td>Отклонено</td></tr>
    </tbody>
  </table>
  <p>Итог.</p>
</div>`;

describe('Claude answer: tables keep their cells as markdown', () => {
  test('tableToMarkdown: header row, delimiter row, one line per row, pipes escaped', () => {
    const doc = document.implementation.createHTMLDocument('t');
    doc.body.innerHTML = '<table><tr><th>A</th><th>B</th></tr><tr><td>x</td><td>y | z</td></tr></table>';
    expect(Providers.tableToMarkdown(doc.querySelector('table'))).toBe('| A | B |\n| --- | --- |\n| x | y \\| z |');
  });

  test('replaceTablesWithMarkdown: the text of a fixture keeps the table rows apart', () => {
    const doc = document.implementation.createHTMLDocument('t');
    doc.body.innerHTML = FIXTURE;
    const clone = doc.querySelector('.font-claude-response').cloneNode(true);
    Providers.replaceTablesWithMarkdown(clone);
    const text = clone.textContent;
    expect(clone.querySelector('table')).toBeNull();
    expect(text).not.toContain('ЗамечаниеПричина');
    expect(text).toContain('| Замечание | Причина |\n| --- | --- |\n| П.1: «архитектура не готова» | Принято частично \\| см. этап 0 |\n| П.6: резерв | Отклонено |');
    expect(text.indexOf('Журнал')).toBeLessThan(text.indexOf('| Замечание'));
    expect(text.indexOf('| П.6')).toBeLessThan(text.indexOf('Итог.'));
  });

  test('a page without tables is unchanged, and the Claude extractor calls the converter before textContent', () => {
    const doc = document.implementation.createHTMLDocument('t');
    doc.body.innerHTML = '<p>Просто текст</p>';
    const clone = doc.body.cloneNode(true);
    Providers.replaceTablesWithMarkdown(clone);
    expect(clone.textContent).toBe('Просто текст');
    const src = fs.readFileSync(path.join(ROOT, 'content-scripts/content-claude.js'), 'utf8');
    const call = src.indexOf('replaceTablesWithMarkdown?.(clone)');
    const textOf = src.indexOf('return (clone.textContent || clone.innerText', call);
    expect(call).toBeGreaterThan(-1);
    expect(textOf).toBeGreaterThan(call);
  });
});
