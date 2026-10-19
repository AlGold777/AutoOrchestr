/** @jest-environment jsdom */
const fs = require('fs');
const path = require('path');
const { collect } = require('../content-scripts/answer-copy-context.js');

function mount(html) { document.body.innerHTML = html; return document.body; }
function skeleton(name) {
  const f = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/live-answer-skeletons', name + '.json'), 'utf8'));
  return f.capture.html;
}

describe('реальные скелеты', () => {
  test('claude.json: data-is-streaming=false → не генерация, нет усечения', () => {
    const b = mount(skeleton('claude'));
    const c = collect(b.querySelector('[data-is-streaming]'));
    expect(c).toMatchObject({ generating: false, truncated: false, version: null, regenerated: false, continuationParts: 0 });
  });
  test('gemini.json: aria-busy=false, regenerate-кнопка не даёт версии', () => {
    const b = mount(skeleton('gemini'));
    const c = collect(b.firstElementChild, { turn: b.firstElementChild });
    expect(c.generating).toBe(false);
    expect(c.version).toBeNull();
  });
  test.each(['chatgpt', 'grok', 'perplexity', 'qwen', 'deepseek', 'lechat', 'zai'])('%s: скелет завершённого ответа не помечается неполным', (n) => {
    const b = mount(skeleton(n));
    const c = collect(b.firstElementChild);
    expect(c.generating).toBe(false);
    expect(c.truncated).toBe(false);
  });
  test('claude.json с подменой data-is-streaming=true → generating', () => {
    const b = mount(skeleton('claude'));
    b.querySelector('[data-is-streaming]').setAttribute('data-is-streaming', 'true');
    expect(collect(b.querySelector('[data-is-streaming]')).generating).toBe(true);
  });
});

describe('синтетика, по известной структуре', () => {
  test('генерация: aria-busy и кнопка Stop только для последнего ответа', () => {
    mount('<div id="m" aria-busy="true">x</div>');
    expect(collect(document.getElementById('m')).generating).toBe(true);
    mount('<div id="m">x</div><button aria-label="Stop generating"></button>');
    const m = document.getElementById('m');
    expect(collect(m, { document, isLatest: false }).generating).toBe(false);
    expect(collect(m, { document, isLatest: true }).generating).toBe(true);
  });
  test('Continue generating → truncated', () => {
    mount('<div id="m">x<button>Continue generating</button></div>');
    const c = collect(document.getElementById('m'));
    expect(c.truncated).toBe(true);
    expect(c.notes.join()).toMatch(/оборван/);
  });
  test('переключатель 1/3 фиксирует версию; 1/1 не считается', () => {
    mount('<div id="t"><div id="m">x</div><div><button>‹</button><span>2/3</span><button>›</button></div></div>');
    const c = collect(document.getElementById('m'), { turn: document.getElementById('t') });
    expect(c).toMatchObject({ version: '2/3', regenerated: true });
    expect(c.versionInfo).toMatchObject({ index: 2, total: 3 });
    mount('<div id="m">x<span>1/1</span></div>');
    expect(collect(document.getElementById('m')).version).toBeNull();
  });
  test('продолжения: ассистентские сообщения до следующего пользовательского', () => {
    mount(`<div id="a" data-message-author-role="assistant">1</div>
      <div data-message-author-role="assistant" id="b">2</div><div data-message-author-role="assistant" id="c">3</div>
      <div data-message-author-role="user">q</div><div data-message-author-role="assistant">other</div>`);
    const c = collect(document.getElementById('a'));
    expect(c.continuationParts).toBe(2);
    expect(c.parts.map((p) => p.id)).toEqual(['b', 'c']);
    expect(JSON.parse(JSON.stringify(c)).parts).toBeUndefined();
  });
  test('свёрнутое: по умолчанию только пометка, ничего не меняется', () => {
    mount('<div id="m"><details><summary>s</summary>t</details><button aria-expanded="false" aria-controls="p">x</button><div id="p" hidden>y</div><button>Show more</button><button aria-expanded="false">menu</button></div>');
    const c = collect(document.getElementById('m'));
    expect(c.collapsed).toBe(3); // details, aria-controls внутри, Show more; «menu» без controls — не блок
    expect(document.querySelector('details').open).toBe(false);
  });
  test('options.expand раскрывает details и кликает кнопки; остаток считается', () => {
    mount('<div id="m"><details><summary>s</summary>t</details><button id="b">Show more</button></div>');
    let clicked = 0;
    document.getElementById('b').addEventListener('click', () => { clicked += 1; });
    const c = collect(document.getElementById('m'), { expand: true });
    expect(document.querySelector('details').open).toBe(true);
    expect(clicked).toBe(1);
    expect(c.collapsed).toBe(1); // кнопка остаётся: результат клика не проверен
    expect(c.notes.join()).toMatch(/раскрыто/);
  });
  test('виртуализация: частично вне скроллера → lazy (прямоугольники подменены)', () => {
    mount('<div id="s"></div><div id="m">x</div>');
    const rect = (top, bottom) => ({ top, bottom, height: bottom - top });
    document.getElementById('s').getBoundingClientRect = () => rect(0, 500);
    document.getElementById('m').getBoundingClientRect = () => rect(-80, 200);
    const c = collect(document.getElementById('m'), { scroller: document.getElementById('s') });
    expect(c.lazy).toBe(true);
    expect(c.notes.join()).toMatch(/виртуализац/);
    document.getElementById('m').getBoundingClientRect = () => rect(10, 200);
    expect(collect(document.getElementById('m'), { scroller: document.getElementById('s') }).lazy).toBe(false);
  });
  test('нет элемента → безопасный объект с пометкой', () => {
    expect(collect(null).notes.length).toBe(1);
  });
});
