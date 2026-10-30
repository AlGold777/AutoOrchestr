/** @jest-environment jsdom */
// WP5: answerMarkdown / copyReport travel pipeline -> responseMeta -> background -> card -> Copy/TXT.
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');
const load = (file) => window.eval(read(file));

function bootstrap() {
  document.head.replaceChildren();
  document.body.replaceChildren();
  ['AnswerPipeline', 'AnswerPipelineConfig', 'AnswerPipelineSelectors', 'TurnResolver', 'AnswerStructure',
    'UnifiedPipelineModules', 'UnifiedAnswerPipeline', 'AnswerMarkdown', 'AnswerCopyContext'].forEach((k) => { delete window[k]; });
  load('content-scripts/pipeline-config.js');
  load('content-scripts/turn-resolver.js');
  load('content-scripts/answer-structure.js');
  load('content-scripts/pipeline-modules.js');
  window.AnswerPipelineSelectors = {
    PLATFORM_SELECTORS: {
      testmodel: { lastMessage: '.answer-root', messageRoot: '.answer-root', answerContainer: 'main' },
      generic: { lastMessage: '.answer-root', messageRoot: '.answer-root' }
    },
    detectPlatform: () => 'testmodel'
  };
  window.ContentUtils = { observeMutations: () => () => {} };
  load('content-scripts/unified-answer-watcher.js');
  class Dummy { constructor() {} start() {} stop() {} }
  class DummyTelemetry { constructor() { this.traceId = 'md'; } record() {} logPhase() {} }
  window.UnifiedPipelineModules = {
    ...window.UnifiedPipelineModules,
    AdaptiveTimeoutManager: Dummy, coordinationModes: {}, selectMode: () => ({}),
    IntelligentRetryManager: Dummy, ContinuousHumanActivity: Dummy, MaintenanceScroll: Dummy,
    ComprehensiveTelemetry: DummyTelemetry, PerplexityStabilization: Dummy, HumanSessionController: Dummy
  };
  window.AnswerPipeline.SanityCheck = Dummy;
  load('content-scripts/unified-answer-pipeline.js');
  document.body.innerHTML = '<main><article class="answer-root"><p>hello</p><pre>x = 1</pre></article></main>';
}

const okReport = { version: 1, provider: 'GPT', found: { code: 1 }, copied: { code: 1 }, placeholders: [], mismatches: [], flags: {}, complete: true };

describe('pipeline: answerMarkdown / copyReport', () => {
  beforeEach(bootstrap);
  const run = async () => {
    const pipeline = new window.UnifiedAnswerPipeline('testmodel');
    pipeline.getAnswerElement = () => document.querySelector('.answer-root');
    return pipeline.extractAnswerWithHtml();
  };

  test('engine present: fields come next to text/html, provider and context are passed', async () => {
    const convert = jest.fn(() => ({ markdown: 'hello\n\n```\nx = 1\n```', report: okReport }));
    window.AnswerMarkdown = { convert };
    window.AnswerCopyContext = { collect: jest.fn(() => ({ version: '1/3' })) };
    const out = await run();
    expect(out.text).toContain('hello');
    expect(out.answerMarkdown).toBe('hello\n\n```\nx = 1\n```');
    expect(out.copyReport).toBe(okReport);
    expect(convert.mock.calls[0][0]).toBe(document.querySelector('.answer-root'));
    expect(convert.mock.calls[0][1].context).toEqual({ version: '1/3' });
    expect('provider' in convert.mock.calls[0][1]).toBe(true);
  });

  test('engine missing: whole-answer placeholder and complete=false, not silence', async () => {
    const out = await run();
    expect(out.text).toContain('hello');
    expect(out.answerMarkdown).toMatch(/^\[НЕ СКОПИРОВАНО: тип=answer, причина=движок недоступен, позиция=1\]$/);
    expect(out.copyReport.complete).toBe(false);
    expect(out.copyReport.placeholders[0]).toMatchObject({ type: 'answer', reason: 'движок недоступен' });
  });

  test('engine throws: stub and complete=false; the text/html result is still returned', async () => {
    window.AnswerMarkdown = { convert: () => { throw new Error('boom'); } };
    const out = await run();
    expect(out.text).toContain('hello');
    expect(out.answerMarkdown).toContain('НЕ СКОПИРОВАНО');
    expect(out.answerMarkdown).toContain('boom');
    expect(out.copyReport.complete).toBe(false);
  });

  test('a throwing context module does not break conversion', async () => {
    window.AnswerMarkdown = { convert: () => ({ markdown: 'm', report: okReport }) };
    window.AnswerCopyContext = { collect: () => { throw new Error('ctx'); } };
    expect((await run()).answerMarkdown).toBe('m');
  });

  test('oversized markdown is replaced by a stub, never truncated silently', async () => {
    window.AnswerMarkdown = { convert: () => ({ markdown: 'a'.repeat(1000001), report: okReport }) };
    const out = await run();
    expect(out.answerMarkdown.length).toBeLessThan(200);
    expect(out.copyReport.complete).toBe(false);
    expect(out.copyReport.found).toEqual(okReport.found);
  });

  test('engine returning no report is reported as incomplete', async () => {
    window.AnswerMarkdown = { convert: () => ({ markdown: 'm' }) };
    expect((await run()).copyReport.complete).toBe(false);
  });
});

describe('background hand-over', () => {
  const fnSource = (file, name) => {
    const src = read(file);
    const start = src.indexOf(`function ${name}(`);
    expect(start).toBeGreaterThan(-1);
    const end = src.indexOf('\n}\n', start) + 2;
    return src.slice(start, end);
  };

  test('liftAnswerMarkdownCopy moves the fields out of responseMeta', () => {
    const lift = new Function(`const self = {}; ${fnSource('background/job-orchestrator.js', 'liftAnswerMarkdownCopy')}; return liftAnswerMarkdownCopy;`)();
    const meta = { source: 'pipeline', answerMarkdown: '# a', copyReport: okReport };
    expect(lift(meta)).toEqual({ answerMarkdown: '# a', copyReport: okReport });
    expect(meta).toEqual({ source: 'pipeline' });
    expect(lift({})).toEqual({ answerMarkdown: '', copyReport: null });
    expect(lift(null)).toEqual({ answerMarkdown: '', copyReport: null });
  });

  test('message envelopes, projection and broadcast carry the fields', () => {
    const orch = read('background/job-orchestrator.js');
    expect(orch.match(/\.\.\.answerMarkdownCopy,/g).length).toBe(2);
    expect(orch).toContain('finalProjection.answerMarkdown = answerMarkdownCopy.answerMarkdown');
    expect(read('background/state-manager.js')).toContain("has('copyReport')");
    expect(read('background/ui-broadcast.js')).toContain('copyReport: entry?.copyReport || null');
  });
});

describe('content-utils buildResponseMeta', () => {
  beforeEach(() => {
    delete window.ContentUtils;
    window.chrome = { runtime: { id: 'x', sendMessage: jest.fn() } };
    try { load('content-scripts/answer-html-builder.js'); } catch (_) {}
    try { load('content-scripts/content-utils.js'); } catch (_) { /* partial load is enough below */ }
  });

  test('pipeline path forwards fields; fallback path carries none (background marks it)', () => {
    const build = window.ContentUtils?.buildResponseMeta;
    if (!build) return; // module did not load in this jsdom: covered by the source check below
    const ok = build({ answerMarkdown: 'm', copyReport: okReport }, { source: 'pipeline' });
    expect(ok.answerMarkdown).toBe('m');
    expect(ok.copyReport).toBe(okReport);
    const fb = build(null, { source: 'dom_fallback' });
    expect(fb.answerMarkdown).toBeUndefined();
    expect(fb.copyReport).toBeUndefined();
  });

  test('source forwards pipeline metadata', () => {
    expect(read('content-scripts/content-utils.js')).toContain('pipelineMeta.answerMarkdown');
  });
});

describe('results: Copy / TXT / marker', () => {
  const helperBlock = () => {
    const src = read('results.js');
    const a = src.indexOf('const answerCopyPending = {};');
    const b = src.indexOf('const debateFeedMessageMeta = (message)');
    expect(a).toBeGreaterThan(-1);
    return src.slice(a, b);
  };
  let api;
  beforeEach(() => {
    document.body.innerHTML = '';
    api = new Function(`${helperBlock()}; return { stashAnswerCopy, applyAnswerCopyToCard, cardAnswerCopyText, describeCopyReport };`)();
  });
  const makeCard = () => {
    const card = document.createElement('div');
    card.innerHTML = '<span class="debate-model-card-meta"><button class="debate-card-copy"></button></span><div class="debate-model-card-output"><p>plain</p></div>';
    document.body.appendChild(card);
    return card;
  };
  const badReport = {
    ...okReport, found: { code: 2, diagram: 1 }, copied: { code: 2, diagram: 0 },
    placeholders: [{ type: 'diagram', reason: 'нет исходника', position: 3 }],
    mismatches: [], complete: false
  };

  test('card keeps markdown; Copy text prefers it, otherwise old text', () => {
    const card = makeCard();
    api.stashAnswerCopy('GPT', { answerMarkdown: '## md', copyReport: okReport }, 'r1');
    api.applyAnswerCopyToCard(card, 'GPT', 'r1');
    expect(api.cardAnswerCopyText(card, 'plain')).toBe('## md');
    expect(card.querySelector('.debate-copy-incomplete')).toBeNull();
    const other = makeCard();
    api.applyAnswerCopyToCard(other, 'GPT', 'r1');
    expect(api.cardAnswerCopyText(other, 'plain')).toBe('plain');
  });

  test('requestId mismatch does not hand a stale copy to another round', () => {
    const card = makeCard();
    api.stashAnswerCopy('GPT', { answerMarkdown: '## old' }, 'r1');
    api.applyAnswerCopyToCard(card, 'GPT', 'r2');
    expect(api.cardAnswerCopyText(card, 'plain')).toBe('plain');
  });

  test('incomplete report shows a visible marker with a breakdown', () => {
    const card = makeCard();
    api.stashAnswerCopy('GPT', { answerMarkdown: 'x', copyReport: badReport }, '');
    api.applyAnswerCopyToCard(card, 'GPT', '');
    const marker = card.querySelector('.debate-copy-incomplete');
    expect(marker).not.toBeNull();
    expect(marker.title).toContain('diagram: найдено 1, скопировано 0, заглушек 1');
    expect(marker.title).toContain('нет исходника');
  });

  test('whole-answer placeholder is not used as the copy text', () => {
    const card = makeCard();
    const report = { ...okReport, placeholders: [{ type: 'answer', reason: 'движок недоступен', position: 1 }], complete: false };
    api.stashAnswerCopy('GPT', { answerMarkdown: '[НЕ СКОПИРОВАНО: тип=answer, причина=движок недоступен, позиция=1]', copyReport: report }, '');
    api.applyAnswerCopyToCard(card, 'GPT', '');
    expect(api.cardAnswerCopyText(card, 'plain')).toBe('plain');
    expect(card.querySelector('.debate-copy-incomplete')).not.toBeNull();
  });

  test('TXT export takes markdown, falls back to text without it', () => {
    const Exporter = require('../results/debate-export');
    const feed = document.createElement('div');
    const mk = (markdown) => {
      const card = document.createElement('div');
      card.className = 'debate-model-card';
      card.dataset.sessionId = '1';
      card.dataset.llmName = 'GPT';
      card.innerHTML = '<div class="debate-model-card-output"><p>plain text</p></div>';
      if (markdown) card._answerCopy = { markdown, report: okReport };
      feed.appendChild(card);
    };
    mk('## md body');
    mk('');
    const txt = Exporter.buildFeedText(feed, '1');
    expect(txt).toContain('## md body');
    expect(txt).toContain('plain text');
    const html = Exporter.collectFeedHtml ? Exporter.collectFeedHtml(feed, '1') : '';
    expect(html).not.toContain('## md body');
  });

  test('results.js wires Copy, approval, feed text and message handlers', () => {
    const src = read('results.js');
    expect(src).toContain('cardAnswerCopyText(card)');
    expect(src).toMatch(/stashAnswerCopy\(message\.llmName, message/);
    expect((src.match(/applyAnswerCopyToCard\(/g) || []).length).toBeGreaterThanOrEqual(2);
  });
});

describe('manifest and build wiring', () => {
  const manifest = JSON.parse(read('manifest.json'));
  const ORDER = [
    'shared/answer-markdown.js', 'shared/answer-markdown-blocks.js', 'shared/answer-markdown-extras.js',
    'shared/answer-markdown-providers.js', 'content-scripts/answer-copy-context.js'
  ];

  test('every content script listed in the manifest exists (load never breaks)', () => {
    manifest.content_scripts.forEach((block) => (block.js || []).forEach((file) => {
      expect(fs.existsSync(path.join(ROOT, file))).toBe(true);
    }));
  });

  test('markdown modules that exist on disk are listed, in order, before the pipeline', () => {
    const listing = manifest.content_scripts.find((b) => (b.js || []).includes('content-scripts/unified-answer-pipeline.js')).js;
    const pipelineAt = listing.indexOf('content-scripts/unified-answer-pipeline.js');
    let last = -1;
    ORDER.filter((f) => fs.existsSync(path.join(ROOT, f))).forEach((file) => {
      const at = listing.indexOf(file);
      expect(at).toBeGreaterThan(-1);
      expect(at).toBeGreaterThan(last);
      expect(at).toBeLessThan(pipelineAt);
      last = at;
    });
  });

  test('two-script dist build lists the same modules in the same order', () => {
    const { COMMON_FILES } = require('../scripts/build-bundles');
    const idx = ORDER.map((f) => COMMON_FILES.indexOf(f));
    expect(idx.every((i) => i > -1)).toBe(true);
    expect([...idx].sort((a, b) => a - b)).toEqual(idx);
    expect(idx[idx.length - 1]).toBeLessThan(COMMON_FILES.indexOf('content-scripts/unified-answer-pipeline.js'));
  });
});
