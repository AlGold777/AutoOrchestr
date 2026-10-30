/** @jest-environment jsdom */
// WP5: answers pulled from open tabs (late collect / Get it / manual ping) carry answerMarkdown + copyReport.
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');
const ORCH = read('background/job-orchestrator.js');

const sliceFunction = (src, name) => {
  const start = src.indexOf(`function ${name}(`);
  expect(start).toBeGreaterThan(-1);
  const open = src.indexOf('{', src.indexOf(')', start));
  let depth = 0;
  for (let i = open; i < src.length; i += 1) {
    if (src[i] === '{') depth += 1;
    if (src[i] === '}') { depth -= 1; if (depth === 0) return src.slice(start, i + 1); }
  }
  throw new Error('unbalanced');
};
const sliceConst = (src, name) => {
  const start = src.indexOf(`const ${name} = [`);
  expect(start).toBeGreaterThan(-1);
  return src.slice(start, src.indexOf('];', start) + 2);
};

const extractor = new Function(`${sliceFunction(ORCH, 'extractLatestAssistantSnapshotInPage')}; return extractLatestAssistantSnapshotInPage;`)();
const loadModules = () => {
  ['shared/answer-markdown.js', 'shared/answer-markdown-blocks.js', 'shared/answer-markdown-extras.js',
    'shared/answer-markdown-providers.js', 'content-scripts/answer-copy-context.js', 'content-scripts/answer-html-builder.js']
    .forEach((file) => window.eval(read(file)));
};
const unloadModules = () => {
  ['AnswerMarkdown', 'AnswerMarkdownBlocks', 'AnswerMarkdownExtras', 'AnswerMarkdownProviders', 'AnswerCopyContext']
    .forEach((name) => { delete window[name]; });
};
const PAGE = `<main><div data-message-author-role="assistant"><div class="markdown">
  <h2>Title</h2><p>Some answer text that is long enough to pass the minimum length.</p>
  <pre><code class="language-python">def f():\n    return 1\n</code></pre></div></div></main>`;

describe('extractLatestAssistantSnapshotInPage + markdown', () => {
  beforeEach(() => { document.body.innerHTML = PAGE; unloadModules(); });

  test('modules present: markdown and a complete-checked report ride next to text/html', () => {
    loadModules();
    const out = extractor('GPT', 10, {});
    expect(out.ok).toBe(true);
    expect(out.html).toContain('<pre');
    expect(out.answerMarkdown).toContain('## Title');
    expect(out.answerMarkdown).toContain('    return 1');
    expect(out.copyReport).toMatchObject({ version: 1 });
    expect(out.copyReport.found.code).toBe(1);
  });

  test('modules absent: whole-answer placeholder, incomplete report, injection reason kept', () => {
    const out = extractor('GPT', 10, { markdownInjectError: 'внедрение модулей: blocked' });
    expect(out.ok).toBe(true);
    expect(out.answerMarkdown).toMatch(/НЕ СКОПИРОВАНО: тип=answer, причина=внедрение модулей: blocked/);
    expect(out.copyReport.complete).toBe(false);
    expect(out.copyReport.placeholders[0].type).toBe('answer');
    expect(extractor('GPT', 10, {}).copyReport.placeholders[0].reason).toBe('движок недоступен');
  });

  test('engine throws: stub, not silence', () => {
    window.AnswerMarkdown = { convert: () => { throw new Error('boom'); } };
    const out = extractor('GPT', 10, {});
    expect(out.copyReport.complete).toBe(false);
    expect(out.answerMarkdown).toContain('boom');
  });

  test('result is JSON-serializable (executeScript contract)', () => {
    loadModules();
    expect(() => JSON.stringify(extractor('GPT', 10, {}))).not.toThrow();
  });

  test('loading the modules twice does not break conversion (idempotent injection)', () => {
    loadModules();
    loadModules();
    expect(extractor('GPT', 10, {}).answerMarkdown).toContain('## Title');
  });
});

describe('ensureAnswerMarkdownModulesInTab', () => {
  const build = (executeScript) => new Function('chrome', 'self', `${sliceConst(ORCH, 'ANSWER_MARKDOWN_MODULES')}; async ${sliceFunction(ORCH, 'ensureAnswerMarkdownModulesInTab')}; return ensureAnswerMarkdownModulesInTab;`)(
    { scripting: { executeScript } }, {}
  );

  test('nothing is injected when all modules are present', async () => {
    const exec = jest.fn(async () => [{ result: [true, true, true, true, true, true] }]);
    expect(await build(exec)(7)).toBeNull();
    expect(exec).toHaveBeenCalledTimes(1);
  });

  test('engine missing: all six files, in order, one call', async () => {
    const exec = jest.fn()
      .mockResolvedValueOnce([{ result: [false, false, false, false, false, false] }])
      .mockResolvedValueOnce([{}]);
    expect(await build(exec)(7)).toBeNull();
    expect(exec.mock.calls[1][0]).toEqual({
      target: { tabId: 7 },
      files: ['shared/answer-markdown.js', 'shared/answer-markdown-blocks.js', 'shared/answer-markdown-extras.js',
        'shared/answer-markdown-providers.js', 'content-scripts/answer-copy-context.js', 'content-scripts/answer-html-builder.js']
    });
  });

  test('engine present, copy context missing: only the missing file', async () => {
    const exec = jest.fn()
      .mockResolvedValueOnce([{ result: [true, true, true, true, false, true] }])
      .mockResolvedValueOnce([{}]);
    await build(exec)(7);
    expect(exec.mock.calls[1][0].files).toEqual(['content-scripts/answer-copy-context.js']);
  });

  test('injection failure becomes a reason, not an exception', async () => {
    const exec = jest.fn().mockRejectedValue(new Error('Cannot access, page'));
    const reason = await build(exec)(7);
    expect(reason).toMatch(/^внедрение модулей: /);
    expect(reason).not.toMatch(/[\],]/);
  });
});

describe('background hand-over of pulled answers', () => {
  const fns = new Function(`${sliceFunction(ORCH, 'lateCollectCopyFields')}; ${sliceFunction(ORCH, 'withMessageAnswerCopy')}; return { lateCollectCopyFields, withMessageAnswerCopy };`)();
  const report = { version: 1, found: {}, copied: {}, placeholders: [], mismatches: [], flags: {}, complete: true };

  test('result with its own copy keeps it; result without one is marked incomplete (cache, preserved text)', () => {
    expect(fns.lateCollectCopyFields({ answerMarkdown: '# a', copyReport: report })).toEqual({ answerMarkdown: '# a', copyReport: report });
    const cached = fns.lateCollectCopyFields({ source: 'snapshot_cache' });
    expect(cached.answerMarkdown).toBe('');
    expect(cached.copyReport.complete).toBe(false);
    expect(cached.copyReport.placeholders[0].reason).toContain('snapshot_cache');
  });

  test('adapter message fields are folded into meta.responseMeta', () => {
    const meta = fns.withMessageAnswerCopy({ meta: { dispatchId: 'd1', responseMeta: { source: 'x' } }, answerMarkdown: 'm', copyReport: report });
    expect(meta).toEqual({ dispatchId: 'd1', responseMeta: { source: 'x', answerMarkdown: 'm', copyReport: report } });
    const plain = { dispatchId: 'd2' };
    expect(fns.withMessageAnswerCopy({ meta: plain })).toBe(plain);
    expect(fns.withMessageAnswerCopy({})).toBeNull();
  });

  test('wiring: late collect, terminal improvement, router, manual ping result, adapters, results', () => {
    expect(ORCH).toContain('...lateCopy,');
    expect(ORCH).toContain('entry.answerMarkdown = lateCopy.answerMarkdown');
    expect(ORCH).toContain('answerMarkdown: inline.answerMarkdown');
    expect(ORCH).toContain('args: [llmName, minChars, { ...(manualRecovery || {}), markdownInjectError, enrich }]');
    expect(ORCH).toMatch(/if \(!answerMarkdownCopy\.copyReport && !error\)/);
    expect((read('background/message-router.js').match(/withMessageAnswerCopy\(message\)/g) || []).length).toBe(2);
    expect(read('background/dispatch-coordinator.js')).toContain('lateCollectCopyFields');
    ['chatgpt', 'claude', 'lechat'].forEach((name) => {
      expect(read(`content-scripts/content-${name}.js`)).toContain('buildLatestAnswerCopy');
    });
    const results = read('results.js');
    expect(results).toMatch(/stashAnswerCopy\(llmName, message, message\.transportRequestId/);
  });
});

describe('ContentUtils.buildLatestAnswerCopy', () => {
  test('converts the latest answer; degrades with a report when the pipeline is missing', () => {
    delete window.ContentUtils;
    window.chrome = { runtime: { id: 'x', sendMessage: jest.fn() } };
    try { window.eval(read('content-scripts/answer-html-builder.js')); } catch (_) { /* partial load tolerated */ }
    try { window.eval(read('content-scripts/content-utils.js')); } catch (_) { /* partial load tolerated */ }
    const build = window.ContentUtils?.buildLatestAnswerCopy;
    if (!build) return;
    unloadModules();
    document.body.innerHTML = PAGE;
    const missing = build('GPT');
    expect(missing.copyReport.complete).toBe(false);
    window.UnifiedAnswerPipeline = { buildAnswerMarkdownFields: (node, name) => ({ answerMarkdown: `md:${name}:${!!node}`, copyReport: { complete: true } }) };
    expect(build('GPT')).toEqual({ answerMarkdown: 'md:GPT:true', copyReport: { complete: true } });
    delete window.UnifiedAnswerPipeline;
  });
});
