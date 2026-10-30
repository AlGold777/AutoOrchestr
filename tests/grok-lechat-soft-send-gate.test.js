// L-7: Grok and Le Chat send with Ctrl+Enter first and do not depend on the Send button. The shared
// readiness gate is attached in its soft form only: a found, disabled button after the insertion
// repeats the insertion once; no button is not an error; the send order does not change.
const fs = require('fs');
const path = require('path');

const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
const grok = read('content-scripts/content-grok.js');
const lechat = read('content-scripts/content-lechat.js');

describe('Grok soft send gate', () => {
  test('the gate runs after the insertion and before the Ctrl+Enter attempt, without repair', () => {
    const gate = grok.indexOf('window.ContentUtils?.ensureSendReady?.(composer, prompt, {');
    const stage = grok.indexOf("reportStage('send_action_requested');");
    const ctrlEnter = grok.indexOf('dispatchSuccess = await attemptSendViaCtrlEnter(composer);', stage);
    expect(gate).toBeGreaterThan(0);
    expect(gate).toBeLessThan(stage);
    expect(stage).toBeLessThan(ctrlEnter);
    expect(grok.slice(gate, stage)).toContain('allowRepair: false');
  });

  test('a disabled button repeats the insertion; the Send button is looked up on its own selector', () => {
    const gate = grok.slice(grok.indexOf('window.ContentUtils?.ensureSendReady?.(composer, prompt, {'), grok.indexOf("reportStage('send_action_requested');"));
    expect(gate).toContain('getSendButton: () => document.querySelector(GROK_SEND_CONTROL_SELECTOR)');
    expect(gate).toContain('await clearComposer(composer);');
    expect(gate).toContain('if (!await grokClipboardPaste(composer, prompt)) await grokInsertText(composer, prompt);');
  });
});

describe('Le Chat soft send gate', () => {
  test('the gate runs after the insertion and before the send request, without repair', () => {
    const gate = lechat.indexOf('window.ContentUtils?.ensureSendReady?.(composer, prompt, {');
    const stage = lechat.indexOf("window.ContentUtils?.reportDispatchStage?.(MODEL, dispatchMeta, 'send_action_requested');", gate);
    expect(gate).toBeGreaterThan(0);
    expect(stage).toBeGreaterThan(gate);
    expect(lechat.slice(gate, stage)).toContain('allowRepair: false');
    expect(lechat.slice(gate, stage)).toContain('selectors: SEND_BUTTON_SELECTORS');
  });

  test('a disabled button repeats the insertion and the Ctrl+Enter strategy still comes first', () => {
    const gate = lechat.indexOf('window.ContentUtils?.ensureSendReady?.(composer, prompt, {');
    const block = lechat.slice(gate, gate + 700);
    expect(block).toContain('await window.ContentUtils?.ensurePromptPrepared?.(composer, prompt, {');
    const sendComposerStart = lechat.indexOf('async function sendComposer');
    const ctrl = lechat.indexOf("runStrategy('ctrl_enter'", sendComposerStart);
    const button = lechat.indexOf('runStrategy(', ctrl + 1);
    expect(ctrl).toBeGreaterThan(sendComposerStart);
    expect(ctrl).toBeLessThan(button);
  });
});
