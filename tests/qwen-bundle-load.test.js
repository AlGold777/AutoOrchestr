/** @jest-environment jsdom */
// Qwen as it really loads: the manifest's script list for chat.qwen.ai (document_end blocks, in order) evaluated in one page with
// realistic Qwen markup (Monaco editor inside every diagram block). No script may throw or log an error at start, and the answer must be found.
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));
const monacoPre = (i) => `<pre class="qwen-markdown-code"><div class="qwen-markdown-code"><div>mermaid</div><button>Код</button></div>
  <div class="mermaid"><div style="display:none"><div class="monaco-editor" role="code"><textarea class="inputarea" aria-label="Editor content"></textarea>
  <div class="view-lines"><div class="view-line">graph TD; A${i}--&gt;B${i}</div></div></div></div><canvas width="2" height="2"></canvas></div></pre>`;
const ANSWER = 'Текст ответа Qwen. '.repeat(30);

test('the Qwen script list loads without errors and the answer is found on a realistic page', async () => {
  const files = manifest.content_scripts
    .filter((c) => c.matches.some((m) => m.includes('chat.qwen.ai')) && c.run_at === 'document_end')
    .flatMap((c) => c.js);
  expect(files).toContain('content-scripts/content-qwen.js');
  expect(files.indexOf('content-scripts/answer-html-builder.js')).toBeLessThan(files.indexOf('content-scripts/content-utils.js'));
  files.forEach((f) => expect(fs.existsSync(path.join(ROOT, f))).toBe(true));

  const listener = () => { const f = jest.fn(); f.addListener = jest.fn(); f.removeListener = jest.fn(); f.hasListener = () => false; return f; };
  window.chrome = {
    runtime: {
      id: 'x', sendMessage: jest.fn((m, cb) => { if (typeof cb === 'function') cb({}); return Promise.resolve({}); }),
      onMessage: listener(), getURL: (p) => p, connect: () => ({ onMessage: listener(), onDisconnect: listener(), postMessage: jest.fn() }),
      lastError: null, getManifest: () => manifest
    },
    storage: {
      local: { get: jest.fn((k, cb) => { if (typeof cb === 'function') cb({}); return Promise.resolve({}); }), set: jest.fn((o, cb) => { if (cb) cb(); return Promise.resolve(); }) },
      onChanged: listener(), session: { get: jest.fn(async () => ({})), set: jest.fn(async () => {}) }
    }
  };
  Object.defineProperty(window, 'location', { value: new URL('https://chat.qwen.ai/c/x'), writable: true });
  document.body.innerHTML = `<main><div class="chat-messages"><div class="qwen-chat-message qwen-chat-message-user"><p>Вопрос пользователя</p></div>
    <div class="chat-response-message-render-flow"><div class="qwen-chat-thinking-tool-status-card">Мышление</div>
    <div class="qwen-chat-message qwen-chat-message-assistant"><div class="response-message-content"><div class="custom-qwen-markdown"><div class="qwen-markdown qwen-markdown-loose">
    <p>${ANSWER}</p>${[1, 2, 3].map(monacoPre).join('<p>Пояснение между диаграммами достаточной длины.</p>')}<p>Заключение ответа.</p>
    </div></div></div></div></div></div><div class="composer"><textarea placeholder="Спросите"></textarea></div></main>`;

  const errors = [];
  window.addEventListener('error', (e) => errors.push(`window.error: ${e.message}`));
  const origError = console.error;
  console.error = (...args) => { errors.push(`console.error: ${args.map(String).join(' ').slice(0, 200)}`); };
  const origLog = console.log; const origWarn = console.warn;
  console.log = () => {}; console.warn = () => {};
  const failed = [];
  try {
    files.forEach((f) => {
      try { window.eval(`${fs.readFileSync(path.join(ROOT, f), 'utf8')}\n//# sourceURL=${f}`); } catch (e) { failed.push(`${f}: ${e.message}`); }
    });
    await new Promise((r) => setTimeout(r, 300));
  } finally { console.error = origError; console.log = origLog; console.warn = origWarn; }
  expect(failed).toEqual([]);
  expect(errors).toEqual([]);

  const snap = window.ContentUtils.collectLateSnapshotCandidate('Qwen', 80, { withMarkdown: true });
  expect(snap.ok).toBe(true);
  expect(snap.text).toContain('Заключение ответа');
  expect(snap.text).not.toContain('Вопрос пользователя');
  expect(snap.html.length).toBeGreaterThan(100);
  expect(snap.copyReport).toBeTruthy();
});
