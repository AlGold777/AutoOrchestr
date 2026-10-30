const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const MESSAGE_ROUTER = fs.readFileSync(path.join(ROOT, 'background', 'message-router.js'), 'utf8');
const CONTENT_UTILS = fs.readFileSync(path.join(ROOT, 'content-scripts', 'content-utils.js'), 'utf8');

// All-presets run 1785603157691. The user reported "the prompt was never
// inserted" for GPT, Z.ai and Claude, and the prompt-not-inserted report could
// neither confirm nor refute it: its critical `insertion_outcome` slot was
// `unavailable` for all nine models, because only a failure was ever reported
// and only by some adapters. Absence of an event is not evidence of failure, so
// every adapter now states the verdict it reached, success as well as failure.
describe('prompt insertion proof contract', () => {
  const PROVIDERS = ['chatgpt', 'claude', 'gemini', 'grok', 'qwen', 'zai', 'deepseek', 'lechat', 'perplexity'];

  const sourceFor = (name) => fs.readFileSync(
    path.join(ROOT, 'content-scripts', `content-${name}.js`), 'utf8'
  );

  test.each(PROVIDERS)('%s reports an insertion verdict for the current dispatch', (provider) => {
    const source = sourceFor(provider);
    expect(source).toContain('reportPromptInsertion');
    // Both outcomes, never only the failure path.
    expect(source).toMatch(/state:\s*[^,\n]*\?\s*'inserted'\s*:\s*'failed'|'inserted'/);
    expect(source).toMatch(/'failed'/);
  });

  test('the shared reporter carries dispatch identity and never blocks dispatch', () => {
    expect(CONTENT_UTILS).toContain("type: 'PROMPT_INSERTION_OBSERVED'");
    expect(CONTENT_UTILS).toMatch(/reportPromptInsertion[\s\S]{0,900}ensureDispatchMeta/);
    // safeRuntimeSendMessage without a response callback: fire-and-forget.
    expect(CONTENT_UTILS).toMatch(/reportPromptInsertion[\s\S]{0,600}safeRuntimeSendMessage/);
  });

  test('the background maps the report onto both canonical insertion labels', () => {
    expect(MESSAGE_ROUTER).toContain("case 'PROMPT_INSERTION_OBSERVED'");
    expect(MESSAGE_ROUTER).toMatch(/inserted \? 'PROMPT_INSERTION_CONFIRMED' : 'PROMPT_INSERTION_FAILED'/);
    // Pinned, so the verdict survives telemetry compaction like the other
    // one-shot causal dispatch events.
    expect(MESSAGE_ROUTER).toContain("'PROMPT_INSERTION_CONFIRMED'");
    expect(MESSAGE_ROUTER).toContain("'PROMPT_INSERTION_FAILED'");
  });
});
