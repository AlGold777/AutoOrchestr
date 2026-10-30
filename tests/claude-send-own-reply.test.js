/** @jest-environment jsdom */
// L-6: Claude's Send is confirmed only by this request's own reply on the page. A new response
// node, a spinner or a Stop button left from an earlier turn is no proof (the old oracle
// accepted them and reported `submitted` for a prompt that never left the composer).
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'content-scripts/content-claude.js'), 'utf8');
function section(start, end) {
  const a = source.indexOf(start);
  const b = source.indexOf(end, a + start.length);
  if (a < 0 || b < 0) throw new Error(`boundaries changed: ${start}`);
  return source.slice(a, b);
}
const block = section('const collectClaudeGenerationElements', 'const tryEnterSend');
const TAG = '[[ao-au8cny]]';

function setupPage({ userTurns = [], composer = 'prompt text', responses = 0 } = {}) {
  document.body.innerHTML = '<div id="composer"></div>'
    + userTurns.map((t) => `<div data-testid="user-message">${t}</div>`).join('')
    + Array.from({ length: responses }, () => '<div data-testid="conversation-turn"></div>').join('');
  const composerEl = document.getElementById('composer');
  composerEl.textContent = composer;
  return composerEl;
}

const emitTiming = jest.fn();
function load() {
  const context = {
    document,
    console,
    Date,
    setTimeout,
    clearTimeout,
    claudeDeliveryTag: TAG,
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    emitTiming,
    readComposerValue: (el) => el.textContent,
    normalizeComposerText: (text = '') => String(text || '').replace(/\s+/g, ' ').trim().toLowerCase()
  };
  vm.createContext(context);
  vm.runInContext(block + '\n;this.api = { captureClaudeSendBaseline, confirmClaudeSend };', context);
  return context.api;
}

afterEach(() => { jest.useRealTimers(); emitTiming.mockClear(); });

test('the own delivery tag in the last user turn confirms Send even while the composer keeps the draft', async () => {
  jest.useFakeTimers();
  const composerEl = setupPage({ userTurns: ['first question'], composer: 'draft' });
  const c = load();
  const baseline = c.captureClaudeSendBaseline(composerEl);
  // Long prompts can render as an attachment chip: the tag then sits in the user turn text.
  document.body.insertAdjacentHTML('beforeend', `<div data-testid="user-message">long prompt ${TAG}</div>`);
  const pending = c.confirmClaudeSend(baseline, composerEl);
  await jest.advanceTimersByTimeAsync(200);
  await expect(pending).resolves.toBe(true);
  expect(emitTiming).toHaveBeenCalledWith('Send proven', { signals: 'own_turn_tag' });
});

test('a cleared composer plus a new user turn confirms Send without the tag', async () => {
  jest.useFakeTimers();
  const composerEl = setupPage({ userTurns: ['first question'], composer: 'draft' });
  const c = load();
  const baseline = c.captureClaudeSendBaseline(composerEl);
  composerEl.textContent = '';
  document.body.insertAdjacentHTML('beforeend', '<div data-testid="user-message">another prompt</div>');
  const pending = c.confirmClaudeSend(baseline, composerEl);
  await jest.advanceTimersByTimeAsync(200);
  await expect(pending).resolves.toBe(true);
  expect(emitTiming).toHaveBeenCalledWith('Send proven', { signals: 'composer_cleared_new_user_turn' });
});

test('a new response node and a spinner without the own reply are not a confirmation', async () => {
  jest.useFakeTimers();
  const composerEl = setupPage({ userTurns: ['first question'], composer: 'draft' });
  const c = load();
  const baseline = c.captureClaudeSendBaseline(composerEl);
  document.body.insertAdjacentHTML('beforeend', '<div data-testid="conversation-turn"></div><div data-testid="chat-spinner"></div>');
  const pending = c.confirmClaudeSend(baseline, composerEl);
  await jest.advanceTimersByTimeAsync(4600);
  await expect(pending).resolves.toBe(false);
  expect(emitTiming).not.toHaveBeenCalled();
});

test('a tag only in an earlier user turn does not confirm the current send', async () => {
  jest.useFakeTimers();
  const composerEl = setupPage({ userTurns: [`earlier ${TAG}`], composer: 'draft' });
  const c = load();
  const baseline = c.captureClaudeSendBaseline(composerEl);
  document.body.insertAdjacentHTML('beforeend', '<div data-testid="user-message">newer prompt</div>');
  const pending = c.confirmClaudeSend(baseline, composerEl);
  await jest.advanceTimersByTimeAsync(4600);
  await expect(pending).resolves.toBe(false);
});
