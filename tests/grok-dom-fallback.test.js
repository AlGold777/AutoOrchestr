const fs = require('fs');
const path = require('path');
const vm = require('vm');
const source = fs.readFileSync(path.join(__dirname, '..', 'content-scripts', 'content-grok.js'), 'utf8');

const loadScript = (filename) => {
  const content = fs.readFileSync(path.join(__dirname, '..', filename), 'utf8');
  // eslint-disable-next-line no-eval
  eval(content);
};

function createSubmittedPromptMatcher({ onSleep } = {}) {
  const normalizationStart = source.indexOf('  const normalizeForComparison =');
  const normalizationEnd = source.indexOf('  function buildBaselineSnapshot()', normalizationStart);
  const matcherStart = source.indexOf('  const GROK_USER_MESSAGE_SELECTORS =');
  const matcherEnd = source.indexOf('  function grabLatestAssistantText()', matcherStart);
  if ([normalizationStart, normalizationEnd, matcherStart, matcherEnd].some(index => index < 0)) {
    throw new Error('Grok submitted-prompt boundaries changed');
  }

  let now = 0;
  const context = vm.createContext({
    document,
    Node,
    Date: { now: () => now },
    sleep: async ms => {
      now += ms;
      onSleep?.(now);
    }
  });
  vm.runInContext(source.slice(normalizationStart, normalizationEnd), context);
  vm.runInContext(source.slice(matcherStart, matcherEnd), context);
  return {
    grabLatestGrokUserMessage: context.grabLatestGrokUserMessage,
    waitForGrokSubmittedPrompt: context.waitForGrokSubmittedPrompt
  };
}

function addGrokUserBubble(text) {
  const bubble = document.createElement('div');
  bubble.setAttribute('data-message-author-role', 'user');
  bubble.innerHTML = `<h2 class="sr-only" data-no-copy="true">Ты</h2>
    <div class="response-content-markdown">
      <h2 class="sr-only" data-no-copy="true">Ты</h2>
      <p>${text}</p><button data-no-copy="true">Copy</button>
    </div>`;
  document.body.appendChild(bubble);
  return bubble;
}

describe('Grok DOM fallback single-flight guard', () => {
  beforeEach(() => {
    document.body.replaceChildren();
    document.head.replaceChildren();
    delete window.grokContentScriptLoaded;
    delete window.__grokAllCopyV6;
    window.scrollBy = jest.fn();
    window.setupHumanoidFetchMonitor = jest.fn();
    window.HumanoidCleanup = {
      createScope: () => ({
        trackInterval: (id) => id,
        trackTimeout: (id) => id,
        trackObserver: (observer) => observer,
        trackAbortController: (controller) => controller,
        register: () => () => {},
        addEventListener: () => () => {},
        cleanup: () => {},
        isCleaned: () => false,
        getReason: () => null
      })
    };
    window.ContentUtils = {
      buildInlineHtml: (node) => String(node?.innerHTML || '').trim()
    };
    window.SelectorFinder = {
      find: jest.fn(() => Promise.resolve(null)),
      findAll: jest.fn(() => Promise.resolve([]))
    };
    loadScript('content-scripts/content-grok.js');
  });

  test('concurrent waits for the same prompt share one in-flight loop', async () => {
    const { waitForDomAnswer } = window.__grokAllCopyV6;
    expect(typeof waitForDomAnswer).toBe('function');

    const first = waitForDomAnswer('test prompt', 150, 30);
    const second = waitForDomAnswer('test prompt', 150, 30);
    expect(second).toBe(first);

    const [firstResult, secondResult] = await Promise.all([first, second]);
    expect(firstResult).toBeNull();
    expect(secondResult).toBeNull();
  });

  test('a new loop starts after the previous one settles', async () => {
    const { waitForDomAnswer } = window.__grokAllCopyV6;

    const first = waitForDomAnswer('test prompt', 100, 30);
    await first;

    const second = waitForDomAnswer('test prompt', 100, 30);
    expect(second).not.toBe(first);
    await second;
  });

  test('different prompts do not join the same loop', async () => {
    const { waitForDomAnswer } = window.__grokAllCopyV6;

    const first = waitForDomAnswer('prompt one', 100, 30);
    const second = waitForDomAnswer('prompt two', 100, 30);
    expect(second).not.toBe(first);
    await Promise.all([first, second]);
  });

  test('composer text is never extracted as an assistant answer', async () => {
    document.body.innerHTML = `
      <div data-testid="grok-editor">
        <div role="article" data-testid="message">Ссылайся на следующее содержимое:</div>
      </div>`;
    const result = await window.__grokAllCopyV6.waitForDomAnswer('real prompt', 80, 20);
    expect(result).toBeNull();
  });

  test('user messages are never extracted as assistant answers', async () => {
    document.body.innerHTML = `
      <div data-message-author-role="user">
        <div role="article" data-testid="message">A user prompt long enough to look like an answer.</div>
      </div>`;
    const result = await window.__grokAllCopyV6.waitForDomAnswer('real prompt', 80, 20);
    expect(result).toBeNull();
  });

  test('Grok reads the actual user body after cloning away the Ты label and controls', () => {
    const expected = 'Пожалуйста, сравни варианты и перечисли два различия.';
    const bubble = addGrokUserBubble(expected);
    const before = bubble.outerHTML;
    const { grabLatestGrokUserMessage } = createSubmittedPromptMatcher();

    expect(grabLatestGrokUserMessage()).toMatchObject({ text: expected, normalized: expected.toLowerCase() });
    expect(bubble.outerHTML).toBe(before);
  });

  test('Grok matches a rich rendered prompt with headings, paragraphs, lists, and links', async () => {
    const prompt = '# Сравнение\n\n- **Первый** пункт\n- [Второй](https://example.com) пункт';
    const bubble = addGrokUserBubble('');
    bubble.querySelector('.response-content-markdown').innerHTML = `
      <h1>Сравнение</h1><ul><li><strong>Первый</strong> пункт</li>
      <li><a href="https://example.com">Второй</a> пункт</li></ul>`;
    const { grabLatestGrokUserMessage, waitForGrokSubmittedPrompt } = createSubmittedPromptMatcher();
    const observed = grabLatestGrokUserMessage();

    expect(observed.text).toContain('\n');
    await expect(waitForGrokSubmittedPrompt(prompt, { node: null, normalized: '' }, 20, 5))
      .resolves.toMatchObject({ observed: true, matches: true, matchMode: 'rendered_markdown' });
  });

  test('Grok keeps polling when a posted user turn is partial, then accepts its completed body', async () => {
    const expected = 'Пожалуйста, сравни варианты и перечисли два различия.';
    const bubble = addGrokUserBubble('Пожалуйста, сравни варианты');
    const body = bubble.querySelector('.response-content-markdown p');
    const { waitForGrokSubmittedPrompt } = createSubmittedPromptMatcher({
      onSleep: now => { if (now === 10) body.textContent = expected; }
    });

    const result = await waitForGrokSubmittedPrompt(expected, { node: null, normalized: '' }, 60, 10);
    expect(result).toMatchObject({ observed: true, matches: true, text: expected, matchMode: 'strict' });
    expect(result.elapsedMs).toBeLessThan(60);
  });

  test('Grok returns a persistent posted-prompt mismatch only after the observation budget', async () => {
    const expected = 'Пожалуйста, сравни варианты и перечисли два различия.';
    addGrokUserBubble('Пожалуйста, сравни варианты');
    const { waitForGrokSubmittedPrompt } = createSubmittedPromptMatcher();

    const result = await waitForGrokSubmittedPrompt(expected, { node: null, normalized: '' }, 60, 20);
    expect(result).toMatchObject({ observed: true, matches: false, matchMode: 'mismatch' });
    expect(result.elapsedMs).toBe(60);
  });
});
