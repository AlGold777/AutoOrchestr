/** @jest-environment jsdom */
const Exporter = require('../results/debate-export');
const { JSDOM } = require('jsdom');
const { chromium } = require('playwright');
const timers = require('timers');

function openHtml(html) {
  const dom = new JSDOM(html, {
    runScripts: 'dangerously',
    url: 'https://example.test/report.html',
    beforeParse(window) {
      window.HTMLElement.prototype.scrollIntoView = function () {};
      window.requestAnimationFrame = (fn) => window.setTimeout(fn, 0);
      window.URL.createObjectURL = jest.fn(() => 'blob:annotated');
      window.URL.revokeObjectURL = jest.fn();
      window.HTMLElement.prototype.getBoundingClientRect = () => ({ left: 0, right: 20, top: 0, bottom: 20, width: 20, height: 20 });
    }
  });
  return dom;
}

function openReport(body, builder = Exporter.documentHtml) {
  return openHtml(builder('Annotations', body, new Date(), false));
}

function selectText(window, startNode, startOffset, endNode, endOffset) {
  const range = window.document.createRange();
  range.setStart(startNode, startOffset);
  range.setEnd(endNode, endOffset);
  const selection = window.getSelection();
  selection.removeAllRanges();
  selection.addRange(range);
  window.document.dispatchEvent(new window.MouseEvent('mouseup', { bubbles: true, clientX: 50, clientY: 50 }));
  return selection;
}

function selectWhole(window, selector) {
  const node = window.document.querySelector(selector).firstChild;
  return selectText(window, node, 0, node, node.length);
}

function clickToolbar(window, label) {
  const button = [...window.document.querySelectorAll('.hl-bar button')]
    .find((item) => item.textContent.trim() === label || item.textContent.trim().endsWith(label) || item.getAttribute('aria-label') === label);
  if (!button) throw new Error(`Toolbar button not found: ${label}`);
  button.click();
}

afterEach(() => jest.useRealTimers());

test('standalone and feed exports initialize one annotation panel, and selections in p/li/td keep their structure', () => {
  const single = openReport('<p>paragraph</p><ul><li>list item</li></ul><table><tbody><tr><td>cell value</td></tr></tbody></table>');
  const w = single.window, d = w.document;
  expect(d.querySelectorAll('.hl-bar')).toHaveLength(1);
  expect(d.querySelector('#hl-favs').style.display).toBe('none');
  for (const selector of ['p', 'li', 'td']) {
    selectWhole(w, selector);
    clickToolbar(w, 'Подсветить: #ffff00');
  }
  expect(d.querySelector('p').textContent).toBe('paragraph');
  expect(d.querySelector('li').textContent).toBe('list item');
  expect(d.querySelector('td').textContent).toBe('cell value');
  expect(d.querySelectorAll('p > mark.hl, li > mark.hl, td > mark.hl')).toHaveLength(3);
  document.body.innerHTML = '<article class="debate-model-card" data-session-id="1" data-llm-name="GPT"><div class="debate-model-card-output"><p>feed answer</p></div></article>';
  const feed = openHtml(Exporter.buildFeedDocument(document.body, '1'));
  expect(feed.window.document.querySelector('#report .feed-response')).not.toBeNull();
  expect(feed.window.document.querySelector('.hl-bar')).not.toBeNull();
  single.window.close(); feed.window.close();
});

test('one selection across p/li/td keeps each element and marks only selected text', () => {
  const dom = openReport('<div id="fixture"><p>paragraph</p><ul><li>list item</li></ul><table><tbody><tr><td>cell value</td></tr></tbody></table></div>');
  const { window: w } = dom, d = w.document;
  const start = d.querySelector('p').firstChild;
  const end = d.querySelector('td').firstChild;
  selectText(w, start, 3, end, 5);
  clickToolbar(w, 'Подсветить: #ffff00');
  expect(d.querySelector('#fixture').innerHTML).toContain('<p>par<mark');
  expect(d.querySelector('#fixture').innerHTML).toContain('<li><mark');
  expect(d.querySelector('#fixture').innerHTML).toContain('<td><mark');
  expect(d.querySelector('p').textContent).toBe('paragraph');
  expect(d.querySelector('li').textContent).toBe('list item');
  expect(d.querySelector('td').textContent).toBe('cell value');
  expect([...d.querySelectorAll('#fixture mark')].map((mark) => mark.textContent)).toEqual(['agraph', 'list item', 'cell ']);
  dom.window.close();
});

test('one favorite spans paragraphs and shows the complete selected text', () => {
  const dom = openReport('<p>first paragraph</p><p>second paragraph</p>');
  const { window: w } = dom, d = w.document;
  const last = d.querySelectorAll('p')[1].firstChild;
  selectText(w, d.querySelector('p').firstChild, 0, last, last.length);
  clickToolbar(w, 'В избранное');
  expect(d.querySelectorAll('mark.hl[data-fav]')).toHaveLength(2);
  expect(d.querySelector('#hl-favs .hl-fav-t').textContent).toBe('first paragraphsecond paragraph');
  dom.window.close();
});

test('changing a partial favorite selection keeps outside text highlighted and keeps the favorite complete', () => {
  const dom = openReport('<p>alpha beta gamma</p>');
  const { window: w } = dom, d = w.document;
  const text = d.querySelector('p').firstChild;
  selectText(w, text, 0, text, text.length);
  clickToolbar(w, 'В избранное');
  const markedText = d.querySelector('mark.hl[data-fav]').firstChild;
  selectText(w, markedText, 6, markedText, 10);
  clickToolbar(w, 'Подсветить: #a5d6a7');
  const marks = [...d.querySelectorAll('mark.hl')];
  expect(marks.map((mark) => [mark.textContent, mark.style.background])).toEqual([
    ['alpha ', 'rgb(255, 255, 0)'], ['beta', 'rgb(165, 214, 167)'], [' gamma', 'rgb(255, 255, 0)']
  ]);
  expect(d.querySelectorAll('mark[data-fav]')).toHaveLength(3);
  expect(d.querySelector('#hl-favs .hl-fav-t').textContent).toBe('alpha beta gamma');
  dom.window.close();
});

test('removing a selected part of a favorite removes the whole note; removing a favorite preserves its color', () => {
  const dom = openReport('<p>favorite words</p><p>keep color</p>');
  const { window: w } = dom, d = w.document;
  let text = d.querySelector('p').firstChild;
  selectText(w, text, 0, text, text.length); clickToolbar(w, 'В избранное');
  text = d.querySelector('p mark').firstChild;
  selectText(w, text, 0, text, 8); clickToolbar(w, 'Снять подсветку');
  expect(d.querySelector('#hl-favs').style.display).toBe('none');
  expect(d.querySelectorAll('mark[data-fav]')).toHaveLength(0);
  expect(d.querySelector('p').textContent).toBe('favorite words');

  text = d.querySelectorAll('p')[1].firstChild;
  selectText(w, text, 0, text, text.length); clickToolbar(w, 'В избранное');
  d.querySelector('#hl-favs .hl-fav-x').click();
  expect(d.querySelector('#hl-favs').style.display).toBe('none');
  expect(d.querySelector('p mark.hl').textContent).toBe('keep color');
  expect(d.querySelector('p mark.hl').style.background).toBe('rgb(255, 255, 0)');
  dom.window.close();
});

test('annotation selection is ignored in the favorite panel; repeated initialization does not duplicate controls', () => {
  const dom = openReport('<p>source text</p>');
  const { window: w } = dom, d = w.document;
  w.eval(d.querySelector('script').textContent);
  w.eval(d.querySelector('script').textContent);
  expect(d.querySelectorAll('.hl-bar')).toHaveLength(1);
  expect(d.querySelectorAll('#hl-style')).toHaveLength(1);
  const p = d.querySelector('p').firstChild;
  selectText(w, p, 0, p, p.length); clickToolbar(w, 'В избранное');
  const note = d.querySelector('.hl-fav-t').firstChild;
  selectText(w, note, 0, note, note.length);
  expect(d.querySelector('.hl-bar').style.display).toBe('none');
  expect(d.querySelectorAll('mark.hl')).toHaveLength(1);
  dom.window.close();
});

test('Ctrl+S writes a clean self-contained HTML file that reopens with working annotations', async () => {
  const dom = openReport('<p>save me</p>');
  const { window: w } = dom, d = w.document;
  selectWhole(w, 'p'); clickToolbar(w, 'В избранное');
  let written;
  const close = jest.fn();
  const write = jest.fn(async (content) => { written = content; });
  w.showSaveFilePicker = jest.fn(async () => ({ createWritable: async () => ({ write, close }) }));
  d.dispatchEvent(new w.KeyboardEvent('keydown', { bubbles: true, ctrlKey: true, key: 's' }));
  await new Promise((resolve) => w.setTimeout(resolve, 0));
  expect(w.showSaveFilePicker).toHaveBeenCalledTimes(1);
  expect(close).toHaveBeenCalledTimes(1);
  expect(written).toContain('save me');
  d.dispatchEvent(new w.KeyboardEvent('keydown', { bubbles: true, ctrlKey: true, key: 's' }));
  await new Promise((resolve) => w.setTimeout(resolve, 0));
  expect(w.showSaveFilePicker).toHaveBeenCalledTimes(1);
  expect(close).toHaveBeenCalledTimes(2);
  expect(write).toHaveBeenCalledTimes(2);
  const saved = new JSDOM(written, { runScripts: 'dangerously', url: 'https://example.test/report_annotated.html' });
  const serialized = new JSDOM(written);
  expect(serialized.window.document.querySelectorAll('[data-hl-ui]')).toHaveLength(0);
  expect(serialized.window.document.querySelector('#hl-toast')).toBeNull();
  serialized.window.close();
  expect(saved.window.document.querySelector('#hl-favs .hl-fav-t').textContent).toBe('save me');
  const savedText = saved.window.document.querySelector('mark.hl').firstChild;
  selectText(saved.window, savedText, 0, savedText, savedText.length);
  clickToolbar(saved.window, 'Снять подсветку');
  expect(saved.window.document.querySelector('mark.hl')).toBeNull();
  dom.window.close(); saved.window.close();
});

(process.env.RUN_HTML_EXPORT_BROWSER_TESTS === '1' ? test : test.skip)('Chrome positions the popup after mouseup, handles cross-block selection, and saves a reusable report', async () => {
  const priorSetImmediate = global.setImmediate;
  const priorClearImmediate = global.clearImmediate;
  global.setImmediate = timers.setImmediate;
  global.clearImmediate = timers.clearImmediate;
  const browser = await chromium.launch({ headless: true, channel: 'chrome' });
  try {
    const page = await browser.newPage({ viewport: { width: 1000, height: 700 } });
    await page.goto('about:blank');
    await page.evaluate(() => {
      window.__pickerCalls = 0;
      window.__writeCalls = 0;
      window.__savedHtml = '';
      window.showSaveFilePicker = async () => {
        window.__pickerCalls++;
        return { createWritable: async () => ({ write: async (html) => { window.__savedHtml = html; window.__writeCalls++; }, close: async () => {} }) };
      };
    });
    const html = Exporter.documentHtml('Browser report', '<div id="fixture"><p>paragraph</p><ul><li>list item</li></ul><table><tbody><tr><td>cell value</td></tr></tbody></table><div class="multi"><p>first paragraph</p><p>second paragraph</p></div></div>', new Date(), false);
    await page.setContent(html);
    await page.evaluate(() => {
      const start = document.querySelector('p').firstChild;
      const end = document.querySelector('td').firstChild;
      const range = document.createRange(); range.setStart(start, 3); range.setEnd(end, 5);
      const selection = getSelection(); selection.removeAllRanges(); selection.addRange(range);
      document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientX: 120, clientY: 110 }));
    });
    const popup = page.locator('.hl-bar');
    await expectVisible(popup);
    const position = await popup.evaluate((el) => ({ left: parseFloat(el.style.left), top: parseFloat(el.style.top) }));
    expect(position.left).toBeGreaterThanOrEqual(0);
    expect(position.top).toBeGreaterThanOrEqual(0);
    await page.getByRole('button', { name: 'Подсветить: #ffff00' }).click();
    expect(await page.locator('#fixture').evaluate((el) => [...el.querySelectorAll('mark')].map((mark) => mark.textContent))).toEqual(['agraph', 'list item', 'cell ']);
    await page.evaluate(() => {
      const range = document.createRange(); range.selectNodeContents(document.querySelector('td'));
      const selection = getSelection(); selection.removeAllRanges(); selection.addRange(range);
      document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientX: 140, clientY: 180 }));
    });
    await page.getByRole('button', { name: 'В избранное' }).click();
    await page.keyboard.press('Control+s');
    await page.waitForFunction(() => window.__writeCalls === 1);
    await page.keyboard.press('Control+s');
    await page.waitForFunction(() => window.__writeCalls === 2);
    expect(await page.evaluate(() => window.__pickerCalls)).toBe(1);
    const saved = await page.evaluate(() => window.__savedHtml);
    expect(await page.evaluate((value) => new DOMParser().parseFromString(value, 'text/html').querySelector('[data-hl-ui]'), saved)).toBeNull();
    const reopened = await browser.newPage({ viewport: { width: 1000, height: 700 } });
    await reopened.goto('about:blank');
    await reopened.setContent(saved);
    const reopenedToolbar = reopened.locator('.hl-bar');
    await reopenedToolbar.waitFor({ state: 'attached' });
    expect(await reopenedToolbar.isHidden()).toBe(true);
    expect(await reopened.locator('#hl-favs .hl-fav-t').textContent()).toBe('cell value');
    const selectedText = await reopened.evaluate(() => {
      const paragraphs = document.querySelectorAll('#fixture .multi p');
      const start = paragraphs[0].firstChild, end = paragraphs[1].firstChild;
      const range = document.createRange(); range.setStart(start, 2); range.setEnd(end, end.length - 2);
      const selection = getSelection(); selection.removeAllRanges(); selection.addRange(range);
      document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientX: 160, clientY: 220 }));
      return selection.toString();
    });
    await expectVisible(reopenedToolbar);
    await reopened.getByRole('button', { name: 'В избранное' }).click();
    expect(await reopened.locator('#hl-favs .hl-fav-t').last().textContent()).toBe(selectedText);
    await reopened.close();
  } finally {
    await browser.close();
    global.setImmediate = priorSetImmediate;
    global.clearImmediate = priorClearImmediate;
  }
});

async function expectVisible(locator) {
  await locator.waitFor({ state: 'visible' });
}

test('Ctrl+S fallback downloads a Blob and AbortError cancels quietly', async () => {
  const dom = openReport('<p>fallback</p>');
  const { window: w } = dom, d = w.document;
  let clicked = 0;
  w.HTMLAnchorElement.prototype.click = function () { clicked++; };
  d.dispatchEvent(new w.KeyboardEvent('keydown', { bubbles: true, ctrlKey: true, key: 's' }));
  await new Promise((resolve) => w.setTimeout(resolve, 0));
  expect(clicked).toBe(1);
  expect(w.URL.createObjectURL).toHaveBeenCalledWith(expect.objectContaining({ type: 'text/html;charset=utf-8' }));
  expect(d.querySelector('#hl-toast').textContent).toBe('Скачано копией — папка «Загрузки»');

  w.showSaveFilePicker = jest.fn(async () => { const error = new Error('cancel'); error.name = 'AbortError'; throw error; });
  d.querySelector('#hl-toast').remove();
  d.dispatchEvent(new w.KeyboardEvent('keydown', { bubbles: true, ctrlKey: true, key: 's' }));
  await new Promise((resolve) => w.setTimeout(resolve, 0));
  expect(w.showSaveFilePicker).toHaveBeenCalledTimes(1);
  expect(clicked).toBe(1);
  expect(d.querySelector('#hl-toast')).toBeNull();
  dom.window.close();
});

test('favorite card has the plain heading and a glyph link with a title and no caption', () => {
  const dom = openReport('<p>card text</p>');
  const { window: w } = dom, d = w.document;
  selectWhole(w, 'p'); clickToolbar(w, 'В избранное');
  expect(d.querySelector('#hl-favs h3').textContent).toBe('Избранное');
  expect(d.querySelector('#hl-favs').firstElementChild.tagName).toBe('H3');
  const link = d.querySelector('#hl-favs .hl-fav-m a');
  expect(link.textContent).toBe('▽');
  expect(link.title).toBe('К месту в тексте');
  expect(link.getAttribute('href')).toBe('#' + d.querySelector('mark.hl[data-fav]').id);
  dom.window.close();
});

test('favorites card sits above the first model answer, below the navigation, and navigation still filters', () => {
  document.body.innerHTML = ['GPT', 'Claude'].map((name) => `<article class="debate-model-card" data-session-id="1" data-llm-name="${name}"><div class="debate-model-card-output"><p>${name} answer</p></div></article>`).join('');
  const dom = openHtml(Exporter.buildFeedDocument(document.body, '1'));
  const { window: w } = dom, d = w.document;
  selectWhole(w, '.feed-response p'); clickToolbar(w, 'В избранное');
  const card = d.querySelector('#hl-favs');
  expect(card.nextElementSibling.classList.contains('feed-response')).toBe(true);
  expect(card.previousElementSibling.tagName).toBe('SECTION');
  d.querySelectorAll('.feed-nav-button')[2].click();
  expect([...d.querySelectorAll('.feed-response')].map((x) => x.hidden)).toEqual([true, false]);
  expect(card.style.display).toBe('');
  dom.window.close();
});

test('bold and italic wrap only the selected text and toggle off; clear removes all formatting of the fragment only', () => {
  const dom = openReport('<p>alpha beta gamma</p>');
  const { window: w } = dom, d = w.document;
  const p = () => d.querySelector('p');
  let text = p().firstChild;
  selectText(w, text, 6, text, 10); clickToolbar(w, 'Жирный');
  expect(p().innerHTML).toBe('alpha <b data-hl-f="">beta</b> gamma');
  text = d.querySelector('b').firstChild;
  selectText(w, text, 0, text, 4); clickToolbar(w, 'Курсив');
  expect(p().innerHTML).toBe('alpha <i data-hl-f=""><b data-hl-f="">beta</b></i> gamma');
  text = d.querySelector('b').firstChild;
  selectText(w, text, 0, text, 4); clickToolbar(w, 'Подсветить: #ffff00');
  expect(d.querySelector('b > mark.hl').style.background).toBe('rgb(255, 255, 0)');
  text = d.querySelector('mark').firstChild;
  selectText(w, text, 1, text, 3); clickToolbar(w, 'Убрать форматирование');
  expect(p().textContent).toBe('alpha beta gamma');
  expect([...d.querySelectorAll('b')].map((node) => node.textContent)).toEqual(['b', 'a']);
  expect([...d.querySelectorAll('mark')].map((node) => node.textContent)).toEqual(['b', 'a']);
  expect(p().innerHTML).toContain('</i>et<i');
  const plain = openReport('<p>one two</p>');
  const pd = plain.window.document;
  text = pd.querySelector('p').firstChild;
  selectText(plain.window, text, 0, text, 3); clickToolbar(plain.window, 'Жирный');
  text = pd.querySelector('b').firstChild;
  selectText(plain.window, text, 0, text, 3); clickToolbar(plain.window, 'Жирный');
  expect(pd.querySelector('p').innerHTML).toBe('one two');
  dom.window.close(); plain.window.close();
});

test('inside a frame Ctrl+S opens the copy window with the full HTML and never writes a file', async () => {
  const dom = new JSDOM(Exporter.documentHtml('Frame', '<p>framed text</p>', new Date(), false), {
    runScripts: 'outside-only',
    url: 'https://example.test/report.html'
  });
  const { window: w } = dom, d = w.document;
  // window.top указывает на другое окно: так выглядит предпросмотр в iframe
  const framed = new Proxy(w, {
    get(target, key) {
      if (key === 'top') return {};
      const value = Reflect.get(target, key);
      return typeof value === 'function' ? value.bind(target) : value;
    }
  });
  w.showSaveFilePicker = jest.fn();
  w.eval(`(function (window) {${d.querySelector('script').textContent}\n})`)(framed);
  d.dispatchEvent(new w.KeyboardEvent('keydown', { bubbles: true, ctrlKey: true, key: 's' }));
  await new Promise((resolve) => w.setTimeout(resolve, 0));
  expect(w.showSaveFilePicker).not.toHaveBeenCalled();
  const area = d.querySelector('[data-hl-copy] textarea');
  expect(area.value.startsWith('<!DOCTYPE html>')).toBe(true);
  expect(area.value).toContain('framed text');
  expect(new w.DOMParser().parseFromString(area.value, 'text/html').querySelector('[data-hl-ui]')).toBeNull();
  dom.window.close();
});

test('embedded annotation initializer stays near 20 KiB (22 KiB under the jest transform)', () => {
  const html = Exporter.documentHtml('size', '<p>x</p>');
  const source = html.match(/<script>\((function initReportAnnotations\(\) \{[\s\S]*?\})\)\(\);<\/script>/);
  expect(source).not.toBeNull();
  expect(Buffer.byteLength(source[1], 'utf8')).toBeLessThanOrEqual(22 * 1024);
});
