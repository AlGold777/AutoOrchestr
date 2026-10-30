/** @jest-environment node */
// L-31: the DOM->Markdown copy of an answer reaches the Basic reply when the full text came by any path
// (GPT and Perplexity dom_fallback used to build their meta without a copy). L-32: a long reply waits for its copy.
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const read = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
const CONTENT_UTILS_SOURCE = read('content-scripts/content-utils.js');
const JOB_ORCHESTRATOR_SOURCE = read('background/job-orchestrator.js');
const RESULTS_SOURCE = read('results.js');
const BRT = require('../shared/basic-reply-text.js');

const COPY_MARKDOWN = '| Замечание | Причина |\n| --- | --- |\n| П.1 | Принято частично |\n\n```js\nconst x = 1;\n```';
const COPY_REPORT = { version: 1, found: { table: 1, code: 1 }, copied: { table: 1, code: 1 }, placeholders: [], mismatches: [], complete: true };

function loadContentUtils(builder) {
  const dom = new JSDOM('<!doctype html><html><body><div id="answer">Ответ</div></body></html>', { runScripts: 'outside-only' });
  dom.window.UnifiedAnswerPipeline = { buildAnswerMarkdownFields: builder };
  dom.window.eval(CONTENT_UTILS_SOURCE);
  return { utils: dom.window.ContentUtils, document: dom.window.document };
}

describe('L-31: a fallback copy comes from the element the fallback text was read from', () => {
  test('buildFallbackAnswerCopy takes the copy of that element; without an element it gives no copy', () => {
    const seen = [];
    const { utils, document } = loadContentUtils((node) => {
      seen.push(node);
      return { answerMarkdown: COPY_MARKDOWN, copyReport: COPY_REPORT };
    });
    const node = document.getElementById('answer');
    expect(utils.buildFallbackAnswerCopy(node)).toEqual({ answerMarkdown: COPY_MARKDOWN, copyReport: COPY_REPORT });
    expect(seen[0]).toBe(node);
    expect(utils.buildFallbackAnswerCopy(null)).toEqual({});
    expect(utils.buildFallbackAnswerCopy(undefined)).toEqual({});
  });

  test('a dom_fallback meta that receives the fallback copy carries answerMarkdown and copyReport', () => {
    const { utils, document } = loadContentUtils(() => ({ answerMarkdown: COPY_MARKDOWN, copyReport: COPY_REPORT }));
    const meta = utils.buildResponseMeta(null, {
      source: 'dom_fallback',
      ...utils.buildFallbackAnswerCopy(document.getElementById('answer'))
    });
    expect(meta.source).toBe('dom_fallback');
    expect(meta.answerMarkdown).toBe(COPY_MARKDOWN);
    expect(meta.copyReport).toEqual(COPY_REPORT);
  });

  test.each([
    ['content-chatgpt.js', /source: 'dom_fallback', \.\.\.\(window\.ContentUtils\?\.buildFallbackAnswerCopy\?\.\(latestMarkup\.node\) \|\| \{\}\)/],
    ['content-perplexity.js', /source: 'dom_fallback', answerVerification: fallbackVerification, \.\.\.\(window\.ContentUtils\?\.buildFallbackAnswerCopy\?\.\(latestMarkup\.node\) \|\| \{\}\)/],
    ['content-gemini.js', /source: 'dom_fallback', answerVerification: fallbackVerification, \.\.\.\(window\.ContentUtils\?\.buildFallbackAnswerCopy\?\.\(latestMarkup\.node\) \|\| \{\}\)/],
    ['content-qwen.js', /source: 'dom_fallback', answerVerification: await fallbackVerifier\?\.\(cleaned\), \.\.\.\(window\.ContentUtils\?\.buildFallbackAnswerCopy\?\.\(latestMarkup\.element \|\| latestMarkup\.node\) \|\| \{\}\)/]
  ])('%s: the dom_fallback meta takes the copy of the element of its text', (file, pattern) => {
    expect(read(`content-scripts/${file}`)).toMatch(pattern);
  });

  test('the pipeline meta of GPT and Perplexity keeps the copy of the pipeline result (metadata.answerMarkdown)', () => {
    expect(read('content-scripts/content-chatgpt.js')).toContain("buildResponseMeta?.(metadata, { source: 'pipeline' })");
    expect(read('content-scripts/content-perplexity.js')).toContain("buildResponseMeta?.(metadata, { source: 'pipeline' })");
    expect(read('content-scripts/unified-answer-pipeline.js')).toMatch(/metadata: \{[\s\S]*answerMarkdown: finalization\.answerMarkdown,\s*copyReport: finalization\.copyReport/);
  });
});

describe('L-31: a pending final answer keeps its copy until a terminal path uses it', () => {
  // The helper is a plain function in the background script: take its source and evaluate it alone.
  const start = JOB_ORCHESTRATOR_SOURCE.indexOf('function heldAnswerCopyFor(');
  const end = JOB_ORCHESTRATOR_SOURCE.indexOf('\nfunction maybeDeferStreamingFinalization(', start);
  const heldAnswerCopyFor = new Function(`${JOB_ORCHESTRATOR_SOURCE.slice(start, end)}; return heldAnswerCopyFor;`)();

  test('returns the held copy for the same text (trimmed)', () => {
    const entry = { pendingFinalAnswerCopy: { texts: ['ответ'], answerMarkdown: COPY_MARKDOWN, copyReport: COPY_REPORT } };
    expect(heldAnswerCopyFor(entry, '  ответ ')).toEqual({ answerMarkdown: COPY_MARKDOWN, copyReport: COPY_REPORT });
  });

  test('returns nothing for another text, an empty text or an entry without a held copy', () => {
    const entry = { pendingFinalAnswerCopy: { texts: ['ответ'], answerMarkdown: COPY_MARKDOWN, copyReport: COPY_REPORT } };
    expect(heldAnswerCopyFor(entry, 'другой текст')).toBeNull();
    expect(heldAnswerCopyFor(entry, '   ')).toBeNull();
    expect(heldAnswerCopyFor({}, 'ответ')).toBeNull();
  });

  test('maybeDeferStreamingFinalization stores the copy with the pending text; handleLLMResponse uses it when the terminal has none', () => {
    expect(JOB_ORCHESTRATOR_SOURCE).toContain('entry.pendingFinalAnswerCopy = {');
    expect(JOB_ORCHESTRATOR_SOURCE).toMatch(/const heldCopy = heldAnswerCopyFor\(entry, answer\);\s*if \(heldCopy\) \{/);
  });
});

describe('L-32: a long reply waits for its copy unless the copy is impossible', () => {
  test('the wait time and the length threshold are constants of the reply module', () => {
    expect(BRT.COPY_WAIT_MS).toBe(4000);
    expect(BRT.COPY_WAIT_POLL_MS).toBe(250);
    expect(BRT.COPY_WAIT_LONG_CHARS).toBe(1500);
  });

  test('a long text with line breaks waits for its copy', () => {
    const text = `${'Абзац ответа. '.repeat(200)}\n\n${'Ещё абзац. '.repeat(30)}`;
    expect(text.length).toBeGreaterThan(1500);
    expect(BRT.copyWaitNeeded(text, null)).toBe(true);
  });

  test('a short text does not wait; an empty text does not wait', () => {
    expect(BRT.copyWaitNeeded('Короткий ответ', null)).toBe(false);
    expect(BRT.copyWaitNeeded('   ', null)).toBe(false);
  });

  test('a flattened text waits as before', () => {
    expect(BRT.copyWaitNeeded('слово '.repeat(400), { complete: false, placeholders: [] })).toBe(true);
  });

  test('a long answer whose source has no DOM->Markdown copy does not wait', () => {
    const report = { placeholders: [{ type: 'answer', reason: 'источник без DOM→Markdown: unknown', position: 1 }], complete: false };
    expect(BRT.copyImpossible(report)).toBe(true);
    expect(BRT.copyWaitNeeded('Абзац. '.repeat(300) + '\n\nхвост', report)).toBe(false);
  });

  test('results.js passes the copy-wait decision and reads the stash by transport request id, then request id', () => {
    expect(RESULTS_SOURCE).toContain('const copyWaitNeeded = Boolean(text.trim() && globalThis.BasicReplyText?.copyWaitNeeded(text, modelResult.copyReport));');
    expect(RESULTS_SOURCE).toContain('replyCopyFor(model, modelResult.transportRequestId || modelResult.requestId, copyWaitNeeded,');
  });

  test('results.js does not let a terminal message without a usable copy overwrite a complete stashed copy', () => {
    expect(RESULTS_SOURCE).toContain('if (heldComplete && !newComplete) return;');
  });
});

describe('L-31: the reply takes the markdown copy with a table and code, and telemetry names where a copy was lost', () => {
  const PLAIN = 'Сводка. Замечание Причина П.1 Принято частично const x = 1; Итог принят.';

  test('a complete copy that matches the flat text is taken: the table and the code block stay', () => {
    const r = BRT.choose({ plain: PLAIN, markdown: `Сводка.\n\n${COPY_MARKDOWN}\n\nИтог принят.`, report: COPY_REPORT });
    expect(r.text_source).toBe('markdown');
    expect(r.text).toContain('| П.1 | Принято частично |');
    expect(r.text).toContain('```js\nconst x = 1;\n```');
  });

  test.each([
    [{}, 'result_without_copy'],
    [{ ownMarkdown: '', ownReport: { placeholders: [{ type: 'answer', reason: 'источник без DOM→Markdown: inline', position: 1 }], complete: false } }, 'source_without_dom_copy'],
    [{ ownMarkdown: '', ownReport: { placeholders: [], complete: true } }, 'result_empty_copy'],
    [{ ownMarkdown: '', ownReport: { placeholders: [], complete: true }, requestId: 'treq-1' }, 'stash_miss'],
    [{ ownMarkdown: '', ownReport: { placeholders: [], complete: true }, requestId: 'treq-1', stashHit: true }, 'copy_not_arrived'],
    [{ pickedMarkdown: '[НЕ СКОПИРОВАНО: тип=answer, причина=x, позиция=1]', pickedReport: { complete: false } }, 'whole_answer_stub'],
    [{ pickedMarkdown: '| a |', pickedReport: { complete: false } }, 'incomplete_copy'],
    [{ pickedMarkdown: '| a |', pickedReport: { complete: true } }, null]
  ])('copyDropReason %j is %s', (input, expected) => {
    expect(BRT.copyDropReason(input)).toBe(expected);
  });

  test('the telemetry event carries copyDropReason and copyWaitNeeded', () => {
    expect(RESULTS_SOURCE).toContain('copyDropReason, resultHasMarkdown');
    expect(RESULTS_SOURCE).toContain('flatText, copyWaitNeeded, copyWaitMs');
  });
});
