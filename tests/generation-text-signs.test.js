/** @jest-environment jsdom */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ORCH = fs.readFileSync(path.join(__dirname, '..', 'background', 'job-orchestrator.js'), 'utf8');
const start = ORCH.indexOf('function detectActiveGenerationInPage(modelName) {');
const end = ORCH.indexOf('self.detectActiveGenerationInPage = detectActiveGenerationInPage;');
if (start < 0 || end < 0) throw new Error('detectActiveGenerationInPage boundaries changed');

// jsdom has no innerText: the page's text is its textContent with line breaks kept.
Object.defineProperty(HTMLElement.prototype, 'innerText', { configurable: true, get() { return this.textContent; } });

const detect = vm.runInNewContext(`${ORCH.slice(start, end)}\ndetectActiveGenerationInPage`, { document, window, getComputedStyle: window.getComputedStyle.bind(window) });
// jsdom reports no layout: every element counts as visible in these fixtures.
const page = (html) => {
  document.body.innerHTML = html;
  document.querySelectorAll('*').forEach((node) => { node.getClientRects = () => [{ width: 100, height: 40 }]; });
  return detect('Perplexity');
};

describe('generation signs that are text, not controls', () => {
  afterEach(() => { document.body.innerHTML = ''; });

  test('Perplexity: a status line «Выполняется 11 с» at the end of the page is generation', () => {
    expect(page('<main><p>Начало ответа и ссылки на источники.</p><div>Подробнее\nВыполняется\n11 с</div></main>').active).toBe(true);
  });

  test('a braille spinner glyph in the last lines is generation', () => {
    expect(page('<main><p>Ответ</p><p>⠏</p></main>').active).toBe(true);
  });

  test('ChatGPT: «Идёт поиск в интернете» and «Думаю» are generation', () => {
    expect(page('<main>Сведены выводы\nИдёт поиск в интернете</main>').active).toBe(true);
    expect(page('<main><p>Думаю</p></main>').active).toBe(true);
  });

  test('a finished answer that merely uses these words in a long line is not generation', () => {
    expect(page('<main><p>В этом разделе выполняется проверка дескриптора и поиск в документации описан подробно, это обычный абзац ответа.</p></main>').active).toBe(false);
  });

  test('a plain finished answer is not generation', () => {
    expect(page('<main><p>Итог. Метка [[AO-abc123]]</p></main>').active).toBe(false);
  });

  test('the stop button signal still works', () => {
    expect(page('<main><button aria-label="Остановить">x</button></main>').active).toBe(true);
  });
});
