/** @jest-environment node */
const fs = require('fs');
const vm = require('vm');
const source = fs.readFileSync(require.resolve('../content-scripts/content-perplexity'), 'utf8');

// The DOM fallback must never return the user's own bubble (prompt echo).
function load(nodesBySelector) {
  const slice = (from, to) => source.slice(source.indexOf(from), source.indexOf(to));
  const code = [
    slice('const PERPLEXITY_USER_TURN_SELECTORS', 'const countPerplexityUserTurns'),
    slice('const PERPLEXITY_FALLBACK_LAST_MESSAGE_SELECTORS', 'const buildInlineHtml'),
    slice('function grabLatestAssistantMarkup', 'async function trySelectorFinderResponse'),
    'grabLatestAssistantMarkup;'
  ].join('\n');
  const document = {
    querySelectorAll: (selector) => nodesBySelector[selector] || []
  };
  const context = {
    window: {},
    document,
    console,
    buildInlineHtml: () => '<p>x</p>'
  };
  vm.createContext(context);
  return vm.runInContext(code, context);
}

const userBubble = (text) => ({ innerText: text, textContent: text, closest: () => ({}) });
const answer = (text) => ({ innerText: text, textContent: text, closest: () => null });

test('fallback skips a user bubble that matches the generic .prose selector', () => {
  const grab = load({
    '.prose': [answer('Ответ модели'), userBubble('Архитектура MVP «Remote Viewfinder»')]
  });
  expect(grab().text).toBe('Ответ модели');
});

test('fallback returns nothing when only the user bubble is on the page', () => {
  const grab = load({
    article: [userBubble('Задача: ...')]
  });
  expect(grab().text).toBe('');
});
