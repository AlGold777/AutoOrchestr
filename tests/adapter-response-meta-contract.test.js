const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const ADAPTERS = [
  'chatgpt',
  'claude',
  'gemini',
  'grok',
  'perplexity',
  'qwen',
  'deepseek',
  'lechat',
  'zai'
];

const sourceOf = (name) => fs.readFileSync(
  path.join(ROOT, 'content-scripts', `content-${name}.js`),
  'utf8'
);

describe('adapter response metadata contract', () => {
  beforeEach(() => {
    document.documentElement.replaceChildren(document.createElement('head'), document.createElement('body'));
    delete window.ContentUtils;
    global.chrome = {
      runtime: { id: 'test', onMessage: { addListener: jest.fn() }, sendMessage: jest.fn() },
      storage: { local: { get: jest.fn(), set: jest.fn() } }
    };
    window.eval(fs.readFileSync(path.join(ROOT, 'content-scripts/content-utils.js'), 'utf8'));
  });

  test('pipeline metadata exposes the fields consumed by background finalization', () => {
    const answerVerification = { verified: true, generationActive: false };
    const runResult = { type: 'SUSPECTED_COMPLETE', guarantee: 'HEURISTIC', strongestEvidenceClass: 'P3' };
    const responseMeta = window.ContentUtils.buildResponseMeta({
      completionReason: 'content_mutation_stable',
      sanityCheck: {
        warnings: [{ type: 'streaming_active' }],
        overallConfidence: 0.45
      },
      finalization: { answerVerification, runResult }
    }, { source: 'pipeline' });

    expect(responseMeta).toEqual({
      source: 'pipeline',
      completionReason: 'content_mutation_stable',
      sanityWarnings: [{ type: 'streaming_active' }],
      sanityConfidence: 0.45,
      answerVerification,
      // The typed run result is part of this contract: the background gate
      // reads responseMeta.runResult, so dropping it here silently turns an
      // unproven run back into an ordinary success.
      runResult,
      // Timer limits, the hard-stop flag and a stall diagnosis of the streaming wait (review C11).
      timers: null,
      flags: null,
      stopStalled: null
    });
  });

  test('fallback metadata is explicitly unverified', () => {
    expect(window.ContentUtils.buildResponseMeta(null, { source: 'dom_fallback' })).toEqual({
      source: 'dom_fallback',
      completionReason: 'pipeline_failed',
      sanityWarnings: ['unverified_fallback'],
      sanityConfidence: null,
      answerVerification: null,
      runResult: null,
      timers: null,
      flags: null,
      stopStalled: null
    });
  });

  test.each(ADAPTERS)('%s forwards pipeline and fallback provenance as responseMeta', (adapter) => {
    const source = sourceOf(adapter);
    expect(source).toContain('buildResponseMeta');
    expect(source).toContain("source: 'pipeline'");
    expect(source).toMatch(/source: '(?:dom|fresh|last_chance|selector)[^']*'/);
    expect(source).toContain('responseMeta');
  });
});
