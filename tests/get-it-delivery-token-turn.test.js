/** @jest-environment jsdom */
// Manual "latest answer" on Perplexity: the last block is a short follow-up without the delivery token;
// the earlier block (with the table and [[AO-xxxxxx]]) is the answer to the extension's request.
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '..', 'background/job-orchestrator.js'), 'utf8');
const sliceFunction = (code, name) => {
  const start = code.indexOf(`function ${name}(`);
  const open = code.indexOf('{', code.indexOf(')', start));
  let depth = 0;
  for (let i = open; i < code.length; i += 1) {
    if (code[i] === '{') depth += 1;
    if (code[i] === '}') { depth -= 1; if (depth === 0) return code.slice(start, i + 1); }
  }
  throw new Error('unbalanced');
};
const extractor = new Function(`${sliceFunction(src, 'extractLatestAssistantSnapshotInPage')}; return extractLatestAssistantSnapshotInPage;`)();

const words = (w, n) => `<p>${(`${w} `).repeat(n)}</p>`;
const turn = (inner) => `<div class="group/final-text"><div class="prose" data-renderer="lm">${inner}</div></div>`;

test('a short last turn without a token loses to the earlier turn with the delivery token', () => {
  document.body.innerHTML = turn(`${words('TABLEANSWER', 120)}<p>[[AO-5vj2cj]]</p>`) + turn(words('DUPLICATEREPLY', 20));
  const out = extractor('Perplexity', 80, { manualLatestRecovery: true });
  expect(out.ok).toBe(true);
  expect(out.text).toContain('TABLEANSWER');
  expect(out.text).not.toContain('DUPLICATEREPLY');
});

// 800 characters and more is an answer of its own (the owner went on with the chat by hand).
test('a long last turn without a token is the answer even after a tokened one', () => {
  document.body.innerHTML = turn(`${words('TABLEANSWER', 120)}<p>[[AO-5vj2cj]]</p>`) + turn(words('HANDWRITTEN', 120));
  const out = extractor('Perplexity', 80, { manualLatestRecovery: true });
  expect(out.ok).toBe(true);
  expect(out.text).toContain('HANDWRITTEN');
  expect(out.text).not.toContain('TABLEANSWER');
});

test('without any token the last turn is still the answer', () => {
  document.body.innerHTML = turn(words('FIRSTTURN', 120)) + turn(words('LASTTURN', 120));
  const out = extractor('Perplexity', 80, { manualLatestRecovery: true });
  expect(out.ok).toBe(true);
  expect(out.text).toContain('LASTTURN');
});
