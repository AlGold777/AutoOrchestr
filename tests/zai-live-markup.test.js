/** @jest-environment jsdom */
// Z.ai (live 2026-10-22): the id="message-<uuid>" sits on the WRAPPER of a turn (user's and assistant's alike), the assistant block is
// .chat-assistant.markdown-prose inside the wrapper, the reasoning ("Thought Process") is inside it, the user's message (13 K) is longer
// than the answer (7.7 K). The answer is found, and neither the prompt nor the reasoning's wrapper decides.
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');
const sliceFunction = (src, name) => {
  const start = src.indexOf(`function ${name}(`);
  const open = src.indexOf('{', src.indexOf(')', start));
  let depth = 0;
  for (let i = open; i < src.length; i += 1) {
    if (src[i] === '{') depth += 1;
    if (src[i] === '}') { depth -= 1; if (depth === 0) return src.slice(start, i + 1); }
  }
  throw new Error('unbalanced');
};
const extractor = new Function(`${sliceFunction(read('background/job-orchestrator.js'), 'extractLatestAssistantSnapshotInPage')}; return extractLatestAssistantSnapshotInPage;`)();
const words = (tag, n) => `${tag} `.repeat(n);

const answerBlock = (tag, n) => `<div class="chat-assistant w-full min-w-full markdown-prose svelte-1qscqw6"><div><div class="flex relative flex-col w-full" id="response-content-container">
  <div class="markdown-prose"><div class="w-full thinking-chain-container my-4 svelte-bugqhi"><div class="flex gap-1 justify-between items-center pl-1"><button class="flex items-center gap-1">Thought Process</button></div>
  <div class="thinking-content"><p>${words('REASONING', 40)}</p></div></div>
  <p>${words(tag, n)}</p><p>${words(`${tag}Tail`, 10)}</p></div></div></div></div>`;
const userBlock = (tag, n) => `<div class="user-message flex justify-end" id="message-user-${tag}"><div class="bubble"><p>&lt;Prompt&gt; ${words(tag, n)}</p></div></div>`;
const page = () => `<div class="flex overflow-y-scroll" id="chat"><div class="chat">${userBlock('PROMPTONE', 60)}<div id="message-aaa-1" class="flex w-full">${answerBlock('FIRSTANSWER', 200)}</div>
  ${userBlock('PROMPTTWO', 2000)}<div id="message-aaa-2" class="flex w-full">${answerBlock('LASTANSWER', 1300)}</div></div></div>`;

const loadModules = () => {
  ['AnswerMarkdown', 'AnswerMarkdownBlocks', 'AnswerMarkdownExtras', 'AnswerMarkdownProviders', 'AnswerHtmlBuilder', 'ContentUtils', 'AnswerStructure'].forEach((k) => { delete window[k]; });
  window.chrome = window.chrome || { runtime: { id: 'x', sendMessage: jest.fn() } };
  ['content-scripts/answer-structure.js', 'shared/answer-markdown.js', 'shared/answer-markdown-blocks.js', 'shared/answer-markdown-extras.js',
    'shared/answer-markdown-providers.js', 'content-scripts/answer-html-builder.js', 'content-scripts/content-utils.js'].forEach((f) => window.eval(read(f)));
};
beforeEach(() => { loadModules(); document.body.innerHTML = page(); });

const expectLastAnswerOnly = (out) => {
  expect(out.ok).toBe(true);
  expect(out.text).toContain('LASTANSWER');
  expect(out.text).not.toContain('FIRSTANSWER');
  expect(out.text).not.toContain('PROMPTTWO');
  expect(out.text).not.toContain('PROMPTONE');
};

test('the in-page extractor takes the last answer, not the prompt, not the first turn', () => {
  expectLastAnswerOnly(extractor('Z.ai', 80, {}));
});
test('the observation frame (no enrichment) takes it too', () => {
  expectLastAnswerOnly(extractor('Z.ai', 80, { enrich: false }));
});
test('the late snapshot of the content script takes it', () => {
  expectLastAnswerOnly(window.ContentUtils.collectLateSnapshotCandidate('Z.ai', 80, { withMarkdown: true }));
});
test('the reasoning ("Thought Process") is not part of the answer text', () => {
  const out = extractor('Z.ai', 80, {});
  expect(out.html).not.toContain('REASONING');
});
test('the sweep finds the last answer', () => {
  window.eval(read('content-scripts/answer-pipeline-selectors.js'));
  window.eval(read('shared/answer-materialize-sweep.js'));
  const found = window.AnswerMaterializeSweep.findAnswerElement(document, 'Z.ai');
  expect(found && found.textContent).toContain('LASTANSWER');
  expect(found.textContent).not.toContain('PROMPTTWO');
});

test('answers that hold an editable element (a widget inside both turns): the LAST one is returned with a note, not nothing', () => {
  document.body.innerHTML = page().replace(/<p>FIRSTANSWER/, '<div contenteditable="true">x</div><p>FIRSTANSWER').replace(/<p>LASTANSWER/, '<div contenteditable="true">y</div><p>LASTANSWER');
  const out = extractor('Z.ai', 80, {});
  expectLastAnswerOnly(out);
  expect(JSON.stringify(out.copyReport)).toContain('единственный кандидат');
  const late = window.ContentUtils.collectLateSnapshotCandidate('Z.ai', 80, { withMarkdown: true });
  expectLastAnswerOnly(late);
});

test('a refusal says why: found / rejected / kept / wide', () => {
  document.body.innerHTML = '<div class="user-message"><p>only the question here and nothing else at all, long enough to be text</p></div>';
  const out = extractor('Z.ai', 80, {});
  expect(out.ok).toBe(false);
  expect(out.diagnostic).toMatch(/^found=\d+,rejected=\d+,kept=\d+,wide=\d+$/);
});

test('the pipeline selector for the message root takes the assistant wrapper, not the wrapper of the user turn', () => {
  window.eval(read('content-scripts/answer-pipeline-selectors.js'));
  const roots = window.AnswerPipelineSelectors.PLATFORM_SELECTORS.zai.messageRoot;
  const selector = Array.isArray(roots) ? roots[0] : String(roots).split(', ')[0];
  document.body.innerHTML = '<div id="message-u1"><div class="user-message">q</div></div><div id="message-a1"><div class="chat-assistant markdown-prose">a</div></div>';
  let matched = [];
  try { matched = Array.from(document.querySelectorAll(selector)).map((el) => el.id); } catch (_) { matched = null; }
  if (matched) expect(matched).toEqual(['message-a1']);
  expect(selector).toContain(':has(.chat-assistant)');
});
