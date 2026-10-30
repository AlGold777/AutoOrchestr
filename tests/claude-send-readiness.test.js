/** @jest-environment jsdom */
// Send readiness: a prompt visible in the composer does not mean the editor took it.
// The shared gate (content-utils ensureSendReady) waits for Send, repairs the editor
// through other input paths, and fails at once when Send stays disabled. Claude's
// gate is a thin wrapper over it.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
const claudeSource = read('content-scripts/content-claude.js');
function section(source, start, end) {
  const a = source.indexOf(start);
  const b = source.indexOf(end, a + start.length);
  if (a < 0 || b < 0) throw new Error(`boundaries changed: ${start}`);
  return source.slice(a, b);
}

const prompt = 'Задача: ' + 'архитектура '.repeat(60) + 'Последней строкой ответа напиши только метку [[AO-au8cny]]';
const SEND = ['button[data-testid="chat-input-send"]'];

// Fake editor: its state (what Send is enabled from) changes only through the input paths
// the scenario accepts; the DOM text can show the prompt without the editor taking it.
function setup({ acceptPaste = false, acceptExec = false, hasButton = true, buttonHtml = null } = {}) {
  document.body.innerHTML = '<div id="composer" contenteditable="true"></div>'
    + (buttonHtml !== null ? buttonHtml : (hasButton ? '<button data-testid="chat-input-send" disabled>Send</button>' : ''));
  const composer = document.getElementById('composer');
  const button = document.querySelector('button[data-testid="chat-input-send"]');
  composer.textContent = prompt;
  let state = '';
  const sync = () => { if (button) button.disabled = state !== prompt; };
  composer.addEventListener('paste', () => {
    if (acceptPaste) state = prompt;
    composer.textContent = prompt;
    composer.dispatchEvent(new Event('input', { bubbles: true }));
    sync();
  });
  document.execCommand = jest.fn((command, _ui, value) => {
    if (command === 'delete') composer.textContent = '';
    if (command === 'insertText') composer.textContent += String(value);
    if (acceptExec) state = composer.textContent;
    composer.dispatchEvent(new Event('input', { bubbles: true }));
    sync();
    return true;
  });
  sync();
  return { composer, button };
}

// Jest fake timers drive the gate's sleeps; Date.now follows them.
// Advances the fake clock in 50 ms steps until the gate settles; elapsed is the time it took.
async function run(fn) {
  const started = Date.now();
  let done = false;
  const pending = fn().finally(() => { done = true; });
  for (let i = 0; i < 1000; i += 1) {
    for (let k = 0; k < 10; k += 1) await Promise.resolve();
    if (done) break;
    await jest.advanceTimersByTimeAsync(50);
  }
  const result = await pending;
  return { result, elapsed: Date.now() - started };
}

beforeAll(() => {
  if (!window.ContentUtils) window.eval(read('content-scripts/content-utils.js'));
});

describe('shared Send readiness gate (ContentUtils.ensureSendReady)', () => {
  beforeEach(() => { jest.useFakeTimers(); });
  afterEach(() => { jest.useRealTimers(); delete document.execCommand; });

  test('an enabled Send is accepted at once, without touching the composer or waiting', async () => {
    const { composer, button } = setup({});
    button.disabled = false;
    const { result, elapsed } = await run(() => window.ContentUtils.ensureSendReady(composer, prompt, { selectors: SEND }));
    expect(result).toEqual({ ok: true, reason: 'ready' });
    expect(elapsed).toBe(0);
    expect(document.execCommand).not.toHaveBeenCalled();
  });

  test('a paste the editor accepts enables Send, without repair', async () => {
    const { composer, button } = setup({ acceptPaste: true });
    const { result } = await run(() => window.ContentUtils.ensureSendReady(composer, prompt, { selectors: SEND }));
    expect(result.ok).toBe(true);
    expect(button.disabled).toBe(false);
  });

  test('when the paste is ignored, the native insertion path repairs the editor and Send enables', async () => {
    const { composer, button } = setup({ acceptExec: true });
    const { result } = await run(() => window.ContentUtils.ensureSendReady(composer, prompt, { selectors: SEND }));
    expect(result).toEqual({ ok: true, reason: 'repaired' });
    expect(button.disabled).toBe(false);
    expect(composer.textContent).toBe(prompt);
  });

  test('a Send that stays disabled fails at once with send_disabled, bounded to seconds', async () => {
    const { composer, button } = setup({});
    const { result, elapsed } = await run(() => window.ContentUtils.ensureSendReady(composer, prompt, { selectors: SEND }));
    expect(result).toEqual({ ok: false, reason: 'send_disabled' });
    expect(button.disabled).toBe(true);
    expect(elapsed).toBeLessThan(10000);
  });

  test('no Send button at all (Enter-submit provider) counts as ready and does not repair', async () => {
    const { composer } = setup({ hasButton: false });
    const { result } = await run(() => window.ContentUtils.ensureSendReady(composer, prompt, { selectors: SEND }));
    expect(result.ok).toBe(true);
    expect(document.execCommand).not.toHaveBeenCalled();
  });

  test('a disabled Send is found through selectors that carry :not([disabled])', async () => {
    const { composer } = setup({});
    const { result } = await run(() => window.ContentUtils.ensureSendReady(composer, prompt, {
      selectors: ['button[data-testid*="send" i]:not([disabled])'],
      allowRepair: false
    }));
    expect(result).toEqual({ ok: false, reason: 'send_disabled' });
  });

  test('a container marked with the disabled class blocks Send (Kimi-style control)', async () => {
    const { composer } = setup({ buttonHtml: '<div class="send-button-container disabled"></div>' });
    const { result } = await run(() => window.ContentUtils.ensureSendReady(composer, prompt, {
      selectors: ['.send-button-container:not(.disabled)'],
      allowRepair: false
    }));
    expect(result.ok).toBe(false);
  });

  test('a provider-owned lookup (getSendButton) decides the Send button', async () => {
    const { composer, button } = setup({});
    const first = await run(() => window.ContentUtils.ensureSendReady(composer, prompt, { getSendButton: () => button, allowRepair: false }));
    expect(first.result.ok).toBe(false);
    button.disabled = false;
    const second = await run(() => window.ContentUtils.ensureSendReady(composer, prompt, { getSendButton: () => button }));
    expect(second.result.ok).toBe(true);
  });

  test('without a prompt the gate never repairs (it would wipe the composer)', async () => {
    const { composer } = setup({});
    const { result } = await run(() => window.ContentUtils.ensureSendReady(composer, '', { selectors: SEND }));
    expect(result.ok).toBe(false);
    expect(document.execCommand).not.toHaveBeenCalled();
  });

  test('allowRepair false (attachments pending): no repair, the provider send path decides', async () => {
    const { composer } = setup({ acceptPaste: true });
    const text = composer.textContent;
    const { result } = await run(() => window.ContentUtils.ensureSendReady(composer, prompt, { selectors: SEND, allowRepair: false }));
    expect(result.ok).toBe(false);
    expect(composer.textContent).toBe(text);
    expect(document.execCommand).not.toHaveBeenCalled();
  });
});

describe('Claude send readiness wrapper', () => {
  // The Claude section, run against the real shared gate.
  function claudeApi() {
    const code = section(claudeSource, '  const readComposerValue = ', '  const pipelineExpectedLength');
    const ctx = { window, document, console, Date };
    vm.createContext(ctx);
    return vm.runInContext(`${code}\n({ ensureClaudeSendReady, composerStillHoldsPrompt, readClaudeSendButton });`, ctx);
  }
  beforeEach(() => { jest.useFakeTimers(); });
  afterEach(() => { jest.useRealTimers(); delete document.execCommand; });

  test('a disabled Send is reported as not ready through the shared gate', async () => {
    const api = claudeApi();
    const { composer } = setup({});
    const { result } = await run(() => api.ensureClaudeSendReady(composer, prompt, []));
    expect(result).toBe(false);
  });

  test('a paste the editor takes is accepted', async () => {
    const api = claudeApi();
    const { composer, button } = setup({ acceptPaste: true });
    const { result } = await run(() => api.ensureClaudeSendReady(composer, prompt, []));
    expect(result).toBe(true);
    expect(button.disabled).toBe(false);
  });

  test('composerStillHoldsPrompt tracks whether the prompt head is still in the composer', () => {
    const api = claudeApi();
    const { composer } = setup({});
    expect(api.composerStillHoldsPrompt(composer, prompt)).toBe(true);
    composer.textContent = '';
    expect(api.composerStillHoldsPrompt(composer, prompt)).toBe(false);
  });

  test('the Claude gate has no private repair copy and its disabled-Send throws are send_not_taken', () => {
    const src = section(claudeSource, '  // ==================== Send readiness (2.81.949)', '  const pipelineExpectedLength');
    expect(src).not.toContain('makeClaudePasteEvent');
    expect(src).not.toContain('CLAUDE_SEND_REPAIR_METHODS');
    expect(claudeSource).toContain("type: 'send_not_taken' }");
  });
});
