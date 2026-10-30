// The text of a Basic reply: the markdown copy when it is complete and matches the plain answer, else the plain answer.
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const { choose } = require('../shared/basic-reply-text.js');
const BasicOutput = require('../disput/basic-output.js');

// The flat text of the same answer: cells run together with spaces, the code and the diagram source appear as plain words.
const PLAIN = 'Сводка по замечаниям. Замечание Причина П.1 Принято частично П.6 Отклонено резерв. const x = 1; graph TD; A-->B Итог принят. [[AO-a1b2c3]]';
const MARKDOWN = [
  'Сводка по замечаниям.',
  '',
  '| Замечание | Причина |',
  '| --- | --- |',
  '| П.1 | Принято частично |',
  '| П.6 | Отклонено резерв |',
  '',
  '```js',
  'const x = 1;',
  '```',
  '',
  '```mermaid',
  'graph TD; A-->B',
  '```',
  '',
  'Итог принят. [[AO-a1b2c3]]'
].join('\n');
const COMPLETE = { complete: true, placeholders: [] };

describe('Basic reply text: markdown when complete and matching', () => {
  test('a complete copy that matches the plain answer is the reply: tables, fences and mermaid stay', () => {
    const r = choose({ plain: PLAIN, markdown: MARKDOWN, report: COMPLETE });
    expect(r.text_source).toBe('markdown');
    expect(r.reason).toBe('complete');
    expect(r.text).toBe(MARKDOWN);
    expect(r.text).toContain('| Замечание | Причина |\n| --- | --- |');
    expect(r.text).toContain('```mermaid\ngraph TD; A-->B\n```');
  });

  test('a plain text with extra text (a reasoning trace) does not drop a complete copy of the answer', () => {
    const trace = 'Сначала разбираю требования, сравниваю варианты и проверяю ограничения бюджета и сроков. '.repeat(3);
    const r = choose({ plain: `${trace}${PLAIN}`, markdown: MARKDOWN, report: COMPLETE });
    expect(r.text_source).toBe('markdown');
    expect(r.text).toBe(MARKDOWN);
  });

  test('the delivery mark is cut from the markdown reply by the Basic output', () => {
    const r = choose({ plain: PLAIN, markdown: MARKDOWN, report: COMPLETE });
    expect(BasicOutput.cleanAnswer(r.text)).not.toMatch(/\[\[AO-/);
    expect(BasicOutput.cleanAnswer(r.text).endsWith('Итог принят.')).toBe(true);
  });

  test('DOC marks inside the markdown are cut too', () => {
    const md = `[[DOC: spec]]\n${MARKDOWN}\n[[/DOC]]`;
    expect(BasicOutput.cleanAnswer(md)).not.toMatch(/\[\[\/?DOC/);
  });
});

describe('Basic reply text: the plain answer stays when the copy is not usable', () => {
  test.each([
    ['incomplete copy', { plain: PLAIN, markdown: MARKDOWN, report: { complete: false } }, 'incomplete_copy'],
    ['no copy report', { plain: PLAIN, markdown: MARKDOWN, report: null }, 'incomplete_copy'],
    ['empty markdown', { plain: PLAIN, markdown: '', report: COMPLETE }, 'no_markdown'],
    ['whole-answer placeholder', { plain: PLAIN, markdown: '[НЕ СКОПИРОВАНО: тип=answer, причина=x, позиция=1]', report: COMPLETE }, 'placeholder'],
    ['markdown much shorter', { plain: PLAIN, markdown: 'Итог принят. [[AO-a1b2c3]]', report: COMPLETE }, 'short_markdown'],
    ['tail of the answer missing', { plain: PLAIN, markdown: MARKDOWN.replace('Итог принят.', 'Другое.'), report: COMPLETE }, 'tail_missing'],
    ['marker missing in markdown', { plain: PLAIN, markdown: MARKDOWN.replace(' [[AO-a1b2c3]]', ''), report: COMPLETE }, 'marker_missing'],
    ['empty plain answer', { plain: '', markdown: MARKDOWN, report: COMPLETE }, 'empty_plain']
  ])('%s: plain text, reason is recorded', (_, input, reason) => {
    const r = choose(input);
    expect(r.text_source).toBe('plain');
    expect(r.reason).toBe(reason);
    expect(r.text).toBe(input.plain);
  });
});

describe('Basic reply text: the wiring is limited to the Basic reply', () => {
  const src = fs.readFileSync(path.join(ROOT, 'results.js'), 'utf8');

  test('the converter is called only inside the Basic send wave, not in the shared final-answer handler', () => {
    const uses = [...src.matchAll(/BasicReplyText\.(?:choose|flattened|copyWaitNeeded|copyDropReason)\(/g)].map((m) => m.index);
    expect(uses.length).toBeGreaterThan(0);
    expect(uses[0]).toBeGreaterThan(src.indexOf('const sendWave = async'));
    expect(uses[uses.length - 1]).toBeLessThan(src.indexOf('const byParticipant = {};', uses[0]));
  });

  test('an empty reply is reported as empty_plain; no_converter means the converter is missing (L-23, M-6)', () => {
    const block = src.slice(src.indexOf('const replyChoice = text.trim()'), src.indexOf('// Diagnostics for L-23'));
    expect(block).toContain("reason: text.trim() ? 'no_converter' : 'empty_plain'");
    expect(block).toContain("globalThis.BasicReplyText");
  });

  test('the handler keeps the plain text of every answer; the copy is only stored next to it', () => {
    const handler = src.slice(src.indexOf('handleFinal(messageOrName, answer) {'), src.indexOf('handleResponse(llmName, answer'));
    expect(handler).toContain('batch.responses[llmName] = text;');
    expect(handler).toContain('answerMarkdown: typeof envelope.answerMarkdown');
    expect(handler).not.toContain('BasicReplyText');
  });

  test('the extension pages load the converter before results.js', () => {
    for (const page of ['pipeline_panel.html', 'result_new.html']) {
      const html = fs.readFileSync(path.join(ROOT, page), 'utf8');
      expect(html.indexOf('shared/basic-reply-text.js')).toBeGreaterThan(-1);
      expect(html.indexOf('shared/basic-reply-text.js')).toBeLessThan(html.indexOf('results.js"'));
    }
  });
});

describe('Basic reply text: a flat text waits for its copy (L-4)', () => {
  const FLAT = 'абв '.repeat(600); // 2400 characters, no line break: the paragraphs were joined on extraction

  test('flattened() marks a long text without a line break only', () => {
    expect(BasicReplyText.flattened(FLAT)).toBe(true);
    expect(BasicReplyText.flattened(`${FLAT}\n${FLAT}`)).toBe(false);
    expect(BasicReplyText.flattened('короткий ответ')).toBe(false);
    expect(BasicReplyText.flattened('')).toBe(false);
  });

  test('the results page reads the copy by transport request and waits for a flat text', () => {
    const src = fs.readFileSync(path.join(ROOT, 'results.js'), 'utf8');
    expect(src).toContain('answerCopyByRequest.set(String(requestId)');
    expect(src).toContain('const copyWait = text.trim() && globalThis.BasicReplyText');
    expect(src).toContain('await replyCopyFor(model, modelResult.transportRequestId || modelResult.requestId, copyWaitNeeded');
    expect(src).toContain('flatText, copyWaitNeeded, copyWaitMs: copyWait.waitedMs');
  });

  test('the Claude ping path retries the element the copy comes from before it sends the copy', () => {
    const src = fs.readFileSync(path.join(ROOT, 'content-scripts/content-claude.js'), 'utf8');
    expect(src).toContain("let latestMarkup = getLatestClaudeResponseMarkup('', null);");
    expect(src).toContain('await sleep(900);\n                latestMarkup = getLatestClaudeResponseMarkup');
  });
});
