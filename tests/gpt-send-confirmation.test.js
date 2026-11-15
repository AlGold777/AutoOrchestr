/** @jest-environment jsdom */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'content-scripts', 'content-chatgpt.js'), 'utf8');

function createConfirmation({ onPoll, prompt } = {}) {
  const helperStart = source.indexOf('  const FALLBACK_LAST_MESSAGE_SELECTORS = [');
  const helperEnd = source.indexOf('  const generatePingId', helperStart);
  const gateStart = source.indexOf('        const userTurnSelector =');
  const gateEnd = source.indexOf('        let sendButton = null;', gateStart);
  if ([helperStart, helperEnd, gateStart, gateEnd].some(index => index < 0)) {
    throw new Error('ChatGPT send confirmation boundaries changed');
  }

  let now = 0;
  let pollCount = 0;
  const context = vm.createContext({
    document,
    Node,
    window: { ContentUtils: { buildInlineHtml: node => node.innerHTML } },
    console,
    Date: { now: () => now },
    sleep: async ms => {
      now += ms;
      pollCount += 1;
      onPoll?.(pollCount);
    },
    isElementInteractable: () => true,
    ...(typeof prompt === 'string' ? { prompt } : {})
  });
  vm.runInContext(source.slice(helperStart, helperEnd), context);
  return vm.runInContext(`${source.slice(gateStart, gateEnd)}\nconfirmChatgptSend;`, context);
}

const answer = text => `<div data-markdown-text-style="assistant-message"><p>${text}</p></div>`;

beforeEach(() => {
  document.body.replaceChildren();
});

test('a new modern assistant snapshot confirms GPT send without user-role markers', async () => {
  document.body.innerHTML = answer('Previous assistant answer');
  const prior = document.body.innerHTML;
  const confirm = createConfirmation({
    onPoll: pollCount => {
      if (pollCount === 1) document.body.innerHTML = answer('New assistant answer');
    }
  });

  await expect(confirm()).resolves.toBe(true);
  expect(document.querySelectorAll('[data-message-author-role="user"]')).toHaveLength(0);
  expect(document.body.innerHTML).not.toBe(prior);
});

test('a modern user bubble confirms GPT send before the assistant starts answering', async () => {
  document.body.replaceChildren();
  const confirm = createConfirmation({
    onPoll: pollCount => {
      if (pollCount === 1) {
        document.body.innerHTML = '<div data-user-message-bubble="true">The submitted prompt</div>';
      }
    }
  });

  await expect(confirm()).resolves.toBe(true);
  expect(document.querySelector('[data-user-message-bubble="true"]')).not.toBeNull();
  expect(document.querySelector('[data-markdown-text-style="assistant-message"]')).toBeNull();
});

test.each([
  ['an unchanged assistant snapshot', answer('Previous assistant answer')],
  ['an empty assistant snapshot', '']
])('%s does not confirm GPT send', async (_label, initialDom) => {
  document.body.innerHTML = initialDom;
  const confirm = createConfirmation();

  await expect(confirm()).resolves.toBe(false);
});

test('GPT send is not confirmed while the composer still holds the prompt', async () => {
  const gateStart = source.indexOf('const composerStillHoldsPrompt =');
  const gateEnd = source.indexOf('        let sendButton = null;', gateStart);
  expect(gateStart).toBeGreaterThan(0);
  const body = source.slice(gateStart, gateEnd);
  expect(body).toMatch(/if \(composerStillHoldsPrompt\(\)\) \{ await sleep\(120\); continue; \}/);
});

test('a long request gets more time to be taken: a user bubble at 8 s confirms a 21 000 character prompt but not a short one', async () => {
  const bubbleAfter = (pollCount) => { if (pollCount === 66) document.body.innerHTML = '<div data-user-message-bubble="true">The submitted prompt</div>'; };
  document.body.replaceChildren();
  await expect(createConfirmation({ onPoll: bubbleAfter, prompt: 'x'.repeat(21000) })()).resolves.toBe(true);
  document.body.replaceChildren();
  await expect(createConfirmation({ onPoll: bubbleAfter, prompt: 'short' })()).resolves.toBe(false);
});

test('the Send button of the Russian UI («Отправить», no data-testid) is found by the selectors and by the filter', () => {
  expect(source).toMatch(/'button\[aria-label\*="отправить" i\]'/);
  expect(source).toMatch(/aria\.includes\('отправ'\)/);
});
