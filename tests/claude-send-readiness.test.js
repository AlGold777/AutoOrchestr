/** @jest-environment jsdom */
// Claude's Send button follows the rich editor's own state. When the prompt is only
// visible in the DOM, Send stays disabled: the gate must repair the editor through
// other input paths and must not wait for an answer that cannot come.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'content-scripts/content-claude.js'), 'utf8');
function section(start, end) {
  const a = source.indexOf(start);
  const b = source.indexOf(end, a + start.length);
  if (a < 0 || b < 0) throw new Error('Claude send-readiness boundaries changed');
  return source.slice(a, b);
}
const code = section('  const readComposerValue = ', '  const pipelineExpectedLength');
const prompt = 'Задача: ' + 'архитектура '.repeat(60) + 'Последней строкой ответа напиши только метку [[AO-au8cny]]';

// Fake editor: its internal state (what Send is enabled from) changes only through the
// input paths the scenario accepts; the DOM text can change without it.
function setup({ acceptPaste = false, acceptExec = false, hasButton = true } = {}) {
  document.body.innerHTML = '<div id="composer" contenteditable="true"></div>'
    + (hasButton ? '<button data-testid="chat-input-send" disabled>Send</button>' : '');
  const composer = document.getElementById('composer');
  const button = document.querySelector('button[data-testid="chat-input-send"]');
  composer.textContent = prompt; // the DOM shows the whole prompt; the editor state is still empty
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
  let now = 0;
  const ctx = {
    document, Event, Date: { now: () => now }, console,
    sleep: async (ms) => { now += ms; }
  };
  vm.createContext(ctx);
  const api = vm.runInContext(code + `\n({ ensureClaudeSendReady, composerStillHoldsPrompt, readClaudeSendButton, waitForClaudeSendReady });`, ctx);
  return { api, composer, button, clock: () => now };
}

describe('Claude send readiness gate', () => {
  afterEach(() => { delete document.execCommand; });

  test('a paste that the editor accepts enables Send without further repair', async () => {
    const { api, button } = setup({ acceptPaste: true });
    const sent = await api.ensureClaudeSendReady(document.getElementById('composer'), prompt, []);
    expect(sent).toBe(true);
    expect(button.disabled).toBe(false);
  });

  test('when paste is ignored, chunked insertion through the native input path enables Send', async () => {
    const { api, button, composer } = setup({ acceptExec: true });
    const sent = await api.ensureClaudeSendReady(composer, prompt, []);
    expect(sent).toBe(true);
    expect(button.disabled).toBe(false);
    expect(composer.textContent).toBe(prompt);
  });

  test('an editor that never takes the text blocks Send after all repair methods and fails fast', async () => {
    const { api, button, composer, clock } = setup({});
    const sent = await api.ensureClaudeSendReady(composer, prompt, []);
    expect(sent).toBe(false);
    expect(button.disabled).toBe(true);
    // Bounded: a few seconds per method, never the 420 s wait of the answer pipeline.
    expect(clock()).toBeLessThan(15000);
  });

  test('an enabled Send is accepted at once without touching the composer', async () => {
    const { api, button, composer } = setup({});
    button.disabled = false;
    const sent = await api.ensureClaudeSendReady(composer, prompt, []);
    expect(sent).toBe(true);
    expect(document.execCommand).not.toHaveBeenCalled();
  });

  test('a page without a Send button does not block the existing send path', async () => {
    const { api, composer } = setup({ hasButton: false });
    expect(await api.ensureClaudeSendReady(composer, prompt, [])).toBe(true);
  });

  test('attachments pending: no repair, the existing send path decides', async () => {
    const { api, composer } = setup({ acceptPaste: true });
    const text = composer.textContent;
    const sent = await api.ensureClaudeSendReady(composer, prompt, [], { allowRepair: false });
    expect(sent).toBe(false);
    expect(composer.textContent).toBe(text);
    expect(document.execCommand).not.toHaveBeenCalled();
  });

  test('composerStillHoldsPrompt is true while the prompt head is in the composer and false after it clears', () => {
    const { api, composer } = setup({});
    expect(api.composerStillHoldsPrompt(composer, prompt)).toBe(true);
    composer.textContent = '';
    expect(api.composerStillHoldsPrompt(composer, prompt)).toBe(false);
  });
});
