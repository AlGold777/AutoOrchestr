/** @jest-environment node */
// L-23: a Basic reply takes the DOM->Markdown copy (answerMarkdown + copyReport) of the answer.
// Claude's DOM fallback (text read by extractClaudeResponseFromDOM, used when the pipeline text is empty,
// a thinking block or differs) used to build its response meta without any copy, so the reply fell back to the
// flat text with reason no_markdown. The fallback now takes the copy of the element the text came from.
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const read = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
const CONTENT_UTILS_SOURCE = read('content-scripts/content-utils.js');
const CLAUDE_SOURCE = read('content-scripts/content-claude.js');
const { choose } = require('../shared/basic-reply-text.js');

function loadContentUtils() {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { runScripts: 'outside-only' });
  dom.window.eval(CONTENT_UTILS_SOURCE);
  return dom.window.ContentUtils;
}

describe('L-23: DOM fallback keeps the answer copy for a Basic reply', () => {
  test('buildResponseMeta carries the copy the caller passes for a dom_fallback source', () => {
    const utils = loadContentUtils();
    const copyReport = { version: 1, found: { table: 1 }, copied: { table: 1 }, placeholders: [], complete: true };
    const meta = utils.buildResponseMeta(null, {
      source: 'dom_fallback',
      answerMarkdown: '| a | b |\n| --- | --- |\n| 1 | 2 |',
      copyReport
    });
    expect(meta.source).toBe('dom_fallback');
    expect(meta.answerMarkdown).toBe('| a | b |\n| --- | --- |\n| 1 | 2 |');
    expect(meta.copyReport).toEqual(copyReport);
  });

  test('without a copy a dom_fallback meta has no answerMarkdown (the 948 loss: reason no_markdown)', () => {
    const utils = loadContentUtils();
    const meta = utils.buildResponseMeta(null, { source: 'dom_fallback' });
    expect(meta.answerMarkdown).toBeUndefined();
    expect(meta.copyReport).toBeUndefined();
  });

  test('content-claude builds the fallback copy from the element the fallback text was read from', () => {
    expect(CLAUDE_SOURCE).toContain("const copyElement = getLatestClaudeResponseMarkup(prompt, baselineElement).element;");
    expect(CLAUDE_SOURCE).toContain('window.ContentUtils?.buildLatestAnswerCopy?.(undefined, copyElement)');
    expect(CLAUDE_SOURCE).toMatch(/source: 'dom_fallback',\s*answerVerification: await fallbackVerifier\?\.\(cleanedResponse\),\s*answerMarkdown: fallbackCopy\.answerMarkdown,\s*copyReport: fallbackCopy\.copyReport/);
  });

  test('a complete fallback copy that matches the flat text is the Basic reply (tables stay)', () => {
    const plain = 'Сводка. Замечание Причина П.1 Принято частично П.6 Отклонено резерв. Итог принят.';
    const markdown = 'Сводка.\n\n| Замечание | Причина |\n| --- | --- |\n| П.1 | Принято частично |\n| П.6 | Отклонено резерв |\n\nИтог принят.';
    const r = choose({ plain, markdown, report: { complete: true, placeholders: [] } });
    expect(r.text_source).toBe('markdown');
    expect(r.text).toBe(markdown);
  });
});
