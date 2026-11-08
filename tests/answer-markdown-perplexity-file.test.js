/**
 * @jest-environment jsdom
 * @jest-environment-options {"url": "https://www.perplexity.ai/session/375efea6-6037-4f87-ae18-c06e312e036e?x=1"}
 */
const Extras = require('../shared/answer-markdown-extras.js');

test('карточка файла Perplexity даёт ссылку на просмотр, а не голый текст', () => {
  const d = document.createElement('div');
  d.innerHTML = '<div class="group"><button aria-label="skeleton-app-prototype" type="button"></button><span><svg><use xlink:href="#pplx-icon-file-type-html"></use></svg></span><div><div><span>skeleton-app-prototype</span></div><div><div>HTML</div></div></div></div>';
  const card = d.firstElementChild;
  const h = Extras.handlers.find((x) => x.name === 'extras-perplexity-file');
  expect(h.match(card)).toBe(true);
  const r = h.render(card, {});
  expect(r.markdown).toBe('[skeleton-app-prototype.html](https://www.perplexity.ai/session/375efea6-6037-4f87-ae18-c06e312e036e?preview=1)');
});

test('обычный div не подходит', () => {
  const d = document.createElement('div');
  d.innerHTML = '<div><button aria-label="x"></button></div>';
  const h = Extras.handlers.find((x) => x.name === 'extras-perplexity-file');
  expect(h.match(d.firstElementChild)).toBe(false);
});
