/** @jest-environment jsdom */
// M-5: Perplexity research answers (run 2.81.950: 469-581 s, pauses over 30 s, fragments of 305-2959 chars).
// Covers: the outermost answer block is read, the provider's generation window replaces the generic
// 30 s quiet commit and 180 s deferral cap, and the page-side hardMax is raised on the Perplexity host only.
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');
const PERPLEXITY = read('content-scripts/content-perplexity.js');
const ROUTER = read('background/message-router.js');
const ORCH = read('background/job-orchestrator.js');
const CONFIG = read('content-scripts/pipeline-config.js');
const Contract = require('../shared/transport-contract.js');

// Source slice from a marker up to and including the first closer after it.
function slice(source, start, closer) {
  const from = source.indexOf(start);
  if (from < 0) throw new Error(`marker not found: ${start}`);
  const to = source.indexOf(closer, from);
  return source.slice(from, to + closer.length);
}

describe('Perplexity answer block (content script)', () => {
  const grabSource = [
    slice(PERPLEXITY, 'const PERPLEXITY_FALLBACK_LAST_MESSAGE_SELECTORS = [', '];'),
    slice(PERPLEXITY, 'const PERPLEXITY_USER_TURN_SELECTORS = [', '];'),
    slice(PERPLEXITY, 'function grabLatestAssistantMarkup() {', '\n}\n')
  ].join('\n');

  function grab(html) {
    document.body.innerHTML = html;
    // eslint-disable-next-line no-new-func
    return new Function('document', 'window', 'buildInlineHtml', `${grabSource}\nreturn grabLatestAssistantMarkup();`)(
      document, {}, () => ''
    );
  }

  test('the answer card with several nested blocks is read as one whole text, not its last block', () => {
    const result = grab(`
      <main>
        <div data-testid="answer-card">
          <div class="prose"><p>Шаг один: выбор приманки.</p></div>
          <div class="prose"><p>Шаг два: выбор ловушки.</p></div>
          <div class="prose"><p>Итог. [[AO-a1b2c3]]</p></div>
        </div>
      </main>`);
    expect(result.text).toContain('Шаг один');
    expect(result.text).toContain('Шаг два');
    expect(result.text).toContain('[[AO-a1b2c3]]');
  });

  test('the prompt bubble is still skipped (the user turn is not the answer)', () => {
    const result = grab(`
      <main>
        <div data-testid="answer-card"><div class="prose"><p>Ответ модели.</p></div></div>
        <div data-testid="chat-message"><div class="prose"><p>Вопрос пользователя.</p></div></div>
      </main>`);
    expect(result.text).toContain('Ответ модели');
    expect(result.text).not.toContain('Вопрос пользователя');
  });
});

describe('Perplexity generation window (shared contract)', () => {
  test('Perplexity has its own quiet commit and deferral cap; other providers keep the fallback', () => {
    expect(Contract.generationWindowMs('Perplexity', 'quietCommitMs', 30000)).toBe(240000);
    expect(Contract.generationWindowMs('perplexity', 'deferCapMs', 180000)).toBe(540000);
    expect(Contract.generationWindowMs('ChatGPT', 'quietCommitMs', 30000)).toBe(30000);
    expect(Contract.generationWindowMs('Perplexity', 'unknownKey', 7)).toBe(7);
  });

  test('the static watch and the deferral read the window, not the generic constants', () => {
    expect(ORCH).toMatch(/generationWindowMs\(llmName, 'quietCommitMs', STATIC_WATCH_COMMIT_AFTER_MS\)/);
    expect(ORCH).toMatch(/if \(quietMs >= quietCommitMs\)/);
    expect(ROUTER).toMatch(/generationWindowMs\(llmName, 'deferCapMs', UNCERTAIN_TERMINAL_MAX_DEFER_MS\)/);
    expect(ROUTER).toMatch(/const capped = now - deferredAt >= maxDeferMs;/);
  });

  test('the page-side hardMax is raised for the Perplexity host only, in the Standard profile', () => {
    expect(CONFIG).toMatch(/hardMax: 540000, veryLong: \{ timeout: 540000 \}/);
    expect(CONFIG).toMatch(/perplexity\\\.ai\$\/i/);
    // The standard CONFIG literal itself stays 450 s (tests/transport-contract.test.js keeps it in sync).
    expect(CONFIG).toMatch(/hardMax: 450000/);
  });
});
