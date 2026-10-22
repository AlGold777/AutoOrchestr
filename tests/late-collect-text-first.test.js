/** @jest-environment jsdom */
// The TEXT of an answer is primary and independent of enrichment: observation frames (passive ping failed, adaptive / round collects)
// get the text and the plain html at once, with no module injection, no Markdown, no layout build; enrichment failures never zero the text;
// the extractor failure reason is reported; the pulling paths give the same text for the same page.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');
const ORCH = read('background/job-orchestrator.js');
const sliceFunction = (src, header) => {
  const start = src.indexOf(header);
  expect(start).toBeGreaterThan(-1);
  const open = src.indexOf('{', src.indexOf(')', start));
  let depth = 0;
  for (let i = open; i < src.length; i += 1) {
    if (src[i] === '{') depth += 1;
    if (src[i] === '}') { depth -= 1; if (depth === 0) return src.slice(start, i + 1); }
  }
  throw new Error('unbalanced');
};
const extractor = new Function(`${sliceFunction(ORCH, 'function extractLatestAssistantSnapshotInPage(')}; return extractLatestAssistantSnapshotInPage;`)();

const loadModules = () => {
  ['AnswerMarkdown', 'AnswerMarkdownBlocks', 'AnswerMarkdownExtras', 'AnswerMarkdownProviders', 'AnswerHtmlBuilder', 'ContentUtils', 'AnswerStructure'].forEach((k) => { delete window[k]; });
  window.chrome = window.chrome || { runtime: { id: 'x', sendMessage: jest.fn() } };
  ['content-scripts/answer-structure.js', 'shared/answer-markdown.js', 'shared/answer-markdown-blocks.js', 'shared/answer-markdown-extras.js',
    'shared/answer-markdown-providers.js', 'content-scripts/answer-html-builder.js', 'content-scripts/content-utils.js'].forEach((f) => window.eval(read(f)));
};
beforeEach(loadModules);

const lorem = (n) => { const w = 'lorem ipsum dolor sit amet consectetur adipiscing elit sed do '; let s = ''; while (s.length < n) s += w; return s.slice(0, n).trim() || 'x'; };
const PROVIDERS = [['GPT', 'chatgpt'], ['Claude', 'claude'], ['Gemini', 'gemini'], ['Grok', 'grok'], ['Perplexity', 'perplexity'], ['Qwen', 'qwen'], ['DeepSeek', 'deepseek'], ['Le Chat', 'lechat'], ['Z.ai', 'zai']];
const page = (fixture) => {
  const html = JSON.parse(read(`tests/fixtures/live-answer-skeletons/${fixture}.json`)).capture.html;
  document.body.innerHTML = html.replace(/⟦TEXT:(\d+)⟧/g, (_, n) => lorem(Number(n)));
};

describe('observation frame: text first, no enrichment', () => {
  test.each(PROVIDERS)('%s: enrich:false returns the text and the plain html, builder and engine are not called', (model, fixture) => {
    page(fixture);
    const build = jest.fn(() => { throw new Error('must not run'); });
    const convert = jest.fn(() => { throw new Error('must not run'); });
    window.AnswerHtmlBuilder = { ...window.AnswerHtmlBuilder, build };
    window.AnswerMarkdown = { ...window.AnswerMarkdown, convert };
    const out = extractor(model, 80, { enrich: false });
    expect(out.ok).toBe(true);
    expect(out.text.length).toBeGreaterThan(200);
    expect(out.html.length).toBeGreaterThan(200);
    expect(build).not.toHaveBeenCalled();
    expect(convert).not.toHaveBeenCalled();
    expect(out.answerMarkdown).toBe('');
    expect(out.copyReport).toBeNull();
  });

  test.each(PROVIDERS)('%s: the text of an enriched pull is the same as the observation frame', (model, fixture) => {
    page(fixture);
    const plain = extractor(model, 80, { enrich: false });
    const rich = extractor(model, 80, {});
    expect(rich.text).toBe(plain.text);
  });

  test.each(PROVIDERS)('%s: enrichment failures never zero the text', (model, fixture) => {
    page(fixture);
    window.AnswerHtmlBuilder = { ...window.AnswerHtmlBuilder, build: () => { throw new Error('boom'); } };
    window.AnswerMarkdown = { ...window.AnswerMarkdown, convert: () => { throw new Error('boom'); }, normalizeCodeBlocks: () => { throw new Error('boom'); } };
    const out = extractor(model, 80, {});
    expect(out.ok).toBe(true);
    expect(out.text.length).toBeGreaterThan(200);
  });
});

describe('the pulling paths give one text for one page', () => {
  test.each(PROVIDERS)('%s: in-page extractor, late snapshot (rich and plain)', (model, fixture) => {
    page(fixture);
    const a = extractor(model, 80, { enrich: false });
    const b = window.ContentUtils.collectLateSnapshotCandidate(model, 80);
    const c = window.ContentUtils.collectLateSnapshotCandidate(model, 80, { enrich: false });
    expect(b.ok && c.ok).toBe(true);
    expect(b.text).toBe(a.text);
    expect(c.text).toBe(a.text);
    expect(c.html.length).toBeGreaterThan(100);
  });

  test('the observer snapshot builds no layout html', () => {
    page('qwen');
    const build = jest.fn(() => { throw new Error('must not run'); });
    window.AnswerHtmlBuilder = { ...window.AnswerHtmlBuilder, build };
    const snap = window.ContentUtils.collectLateSnapshotCandidate('Qwen', 80, { enrich: false });
    expect(snap.ok).toBe(true);
    expect(build).not.toHaveBeenCalled();
    expect(fs.readFileSync(path.join(ROOT, 'content-scripts/content-utils.js'), 'utf8')).toContain('collectLateSnapshotCandidate(llmName, 80, { enrich: false })');
  });
});

describe('background: runInlineLateExtract', () => {
  const make = (executeResult) => {
    const c = {
      ensureAnswerMarkdownModulesInTab: jest.fn(async () => null),
      withLateCollectExecutionLock: async (fn) => fn(), withLateCollectTimeout: (p) => p,
      LATE_COLLECT_EXECUTE_TIMEOUT_MS: 1000, DOM_SNAPSHOT_RECOVERY_MIN_CHARS: 80,
      extractLatestAssistantSnapshotInPage: () => ({}),
      chrome: { scripting: { executeScript: jest.fn(async () => [{ result: executeResult }]) } }
    };
    vm.createContext(c);
    vm.runInContext(sliceFunction(ORCH, 'async function runInlineLateExtract('), c);
    return c;
  };
  test('passive: no module injection, enrich:false travels to the page', async () => {
    const c = make({ ok: true, text: 'abc' });
    await c.runInlineLateExtract({ tabId: 1, llmName: 'Qwen', enrich: false });
    expect(c.ensureAnswerMarkdownModulesInTab).not.toHaveBeenCalled();
    expect(c.chrome.scripting.executeScript.mock.calls[0][0].args[2].enrich).toBe(false);
  });
  test('final: modules are injected, enrich:true', async () => {
    const c = make({ ok: true, text: 'abc' });
    await c.runInlineLateExtract({ tabId: 1, llmName: 'Qwen' });
    expect(c.ensureAnswerMarkdownModulesInTab).toHaveBeenCalledTimes(1);
    expect(c.chrome.scripting.executeScript.mock.calls[0][0].args[2].enrich).toBe(true);
  });
  test('a refusal carries the extractor reason', async () => {
    const c = make({ ok: false, reason: 'wide_container_only' });
    const out = await c.runInlineLateExtract({ tabId: 1, llmName: 'Qwen', enrich: false });
    expect(out.ok).toBe(false);
    expect(out.extractReason).toBe('wide_container_only');
  });
  test('lateCollectAnswer: every passive_ping_error / adaptive reason is an observation frame, manual and materialize are not', () => {
    expect(ORCH).toContain("/^(?:passive_ping_error:|observation_unavailable_retry|adaptive)/.test(String(reason))");
    const re = /^(?:passive_ping_error:|observation_unavailable_retry|adaptive)/;
    ['passive_ping_error:adaptive_submit', 'passive_ping_error:round2_batch_timeout', 'passive_ping_error:post_r2_auto', 'passive_ping_error:adaptive_round3', 'observation_unavailable_retry']
      .forEach((r) => expect(re.test(r)).toBe(true));
    ['manual_latest_recovery', 'materialize_latest:x', 'post_success_answer_audit'].forEach((r) => expect(re.test(r)).toBe(false));
  });
});
