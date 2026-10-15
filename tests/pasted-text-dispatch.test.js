const fs = require('fs');
const path = require('path');
require('../results/pasted-text');

// Execute the actual main-page send listener, with its background boundary
// mocked. This catches lost hidden content even when the input value is empty.
const source = fs.readFileSync(path.join(__dirname, '..', 'results.js'), 'utf8');
const start = source.indexOf("    startButton?.addEventListener('click', async () => {");
const end = source.indexOf('\n// Get it for any page:', start);
if (start < 0 || end < 0) throw new Error('Main prompt dispatch listener not found');

function setupSend() {
  document.body.innerHTML = '<div class="prompt-container"><div id="bar"></div><textarea></textarea></div>';
  const input = document.querySelector('textarea');
  const bar = document.getElementById('bar');
  const composer = window.ResultsPastedText.create({ input, bar });
  const button = { addEventListener: jest.fn() };
  const sendToBackground = jest.fn(async () => ({ status: 'process_started' }));
  const showNotification = jest.fn();
  const dependencies = {
    startButton: button,
    pastedTextComposer: composer,
    showNotification,
    ensureNoOtherViewRun: async () => true,
    applySelectedModifiersToPrompt: (text) => `<Prompt>\n${text}\n</Prompt>`,
    getSelectedLLMs: () => ['GPT'],
    newPagesCheckbox: { checked: false },
    apiModeCheckbox: { checked: false },
    longModeCheckbox: null,
    buildAttachmentPayload: async () => [],
    ATTACH_CAPABILITY: {},
    sendToBackground,
    getCurrentViewKey: () => 'main',
    syncProStreamVisibility: jest.fn(),
    resetPromptInputSize: jest.fn(),
    clearPromptAttachments: jest.fn(),
    resetNewPagesCheckboxAfterOpen: jest.fn(),
    getItButton: null
  };
  new Function(...Object.keys(dependencies), `let lastGenerationWaitProfile;\n${source.slice(start, end)}`)(...Object.values(dependencies));
  return { input, bar, composer, sendToBackground, showNotification, send: button.addEventListener.mock.calls[0][1] };
}

test('send accepts a chip-only prompt and passes every character to the background', async () => {
  const { composer, input, send, sendToBackground, showNotification } = setupSend();
  const text = '  first line\n' + 'Юникод 😀 and spaces  \n'.repeat(200) + 'last line  ';
  composer.tryPaste(text);
  expect(input.value).toBe('');
  await send();
  expect(showNotification).not.toHaveBeenCalled();
  expect(sendToBackground).toHaveBeenCalledWith(expect.objectContaining({
    type: 'START_FULLPAGE_PROCESS', prompt: `<Prompt>\n${text}\n</Prompt>`, attachments: []
  }));
});

test('send uses saved edits and surrounding input in their original order', async () => {
  const { composer, input, bar, send, sendToBackground } = setupSend();
  composer.setText('before REPLACE after');
  input.setSelectionRange(7, 14);
  composer.tryPaste('large'.repeat(700));
  bar.querySelector('.pasted-text-open').click();
  document.querySelector('.pasted-text-editor').value = 'edited text\nwith another line';
  document.querySelector('.pasted-text-save').click();
  await send();
  expect(sendToBackground.mock.calls[0][0].prompt).toBe('<Prompt>\nbefore edited text\nwith another line after\n</Prompt>');
});

test('a rejected background send retains the complete draft for retry', async () => {
  const { composer, send, sendToBackground, showNotification } = setupSend();
  const text = 'retry'.repeat(700);
  composer.tryPaste(text);
  sendToBackground.mockResolvedValue({ status: 'error', errorCode: 'RUN_ALREADY_ACTIVE' });
  const log = jest.spyOn(console, 'error').mockImplementation(() => {});
  try {
    await send();
    expect(showNotification).toHaveBeenCalled();
    expect(composer.getText()).toBe(text);
  } finally { log.mockRestore(); }
});

test('send preserves multiple fragments and the typed text between them', async () => {
  const { composer, input, send, sendToBackground } = setupSend();
  const first = 'first fragment\n'.repeat(220);
  const second = 'second fragment\n'.repeat(220);
  composer.setText('intro tail');
  input.setSelectionRange(6, 6);
  composer.tryPaste(first);
  input.setRangeText('between ', 6, 6, 'end');
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.setSelectionRange(14, 14);
  composer.tryPaste(second);
  await send();
  expect(sendToBackground.mock.calls[0][0].prompt).toBe(`<Prompt>\nintro ${first}between ${second}tail\n</Prompt>`);
});

function moderatorRecovery(input, composer) {
  const begin = source.indexOf('    function restoreModeratorComposer(text) {');
  const finish = source.indexOf('    function clearModeratorComposer()', begin);
  if (begin < 0 || finish < 0) throw new Error('Moderator recovery function not found');
  return new Function('promptInput', 'isModeratorTextarea', 'pastedTextComposer', 'autoGrowDebateTextarea',
    `${source.slice(begin, finish)}\nreturn restoreModeratorComposer;`
  )(input, true, composer, jest.fn());
}

test('failed moderator recovery never replaces a newer chip-only draft', () => {
  const { composer, input } = setupSend();
  const draft = 'new draft'.repeat(400);
  composer.tryPaste(draft);
  moderatorRecovery(input, composer)('older failed message');
  expect(input.value).toBe('');
  expect(composer.getText()).toBe(draft);
});

test('failed moderator recovery restores the entire message to an empty composer', () => {
  const { composer, input } = setupSend();
  const original = 'original text\n'.repeat(250);
  moderatorRecovery(input, composer)(original);
  expect(input.value).toBe(original);
  expect(composer.getText()).toBe(original);
});

test('large text pasted while editing a rich Note keeps the native note paste behavior', () => {
  const { composer, input } = setupSend();
  const noteView = document.createElement('div');
  const begin = source.indexOf('const handlePromptPaste = (event) => {');
  const finish = source.indexOf('const promptDragTargets =', begin);
  if (begin < 0 || finish < 0) throw new Error('Prompt paste handler not found');
  const dependencies = {
    promptInput: input,
    promptNoteView: noteView,
    tryAddTransferAttachments: () => false,
    plainTextFromHtml: () => '',
    editorState: { mode: 'EDITING' },
    pastedTextComposer: composer,
    useInputRichMode: true,
    syncPromptViewMode: jest.fn(),
    isPromptRichEditable: () => true,
    insertTextAtCursor: jest.fn()
  };
  const handler = new Function(...Object.keys(dependencies), `${source.slice(begin, finish)}\nreturn handlePromptPaste;`)(...Object.values(dependencies));
  const event = {
    currentTarget: noteView,
    clipboardData: { getData: (type) => type === 'text/plain' ? 'Note content\n'.repeat(300) : '' },
    preventDefault: jest.fn()
  };
  handler(event);
  expect(event.preventDefault).not.toHaveBeenCalled();
  expect(dependencies.insertTextAtCursor).not.toHaveBeenCalled();
  expect(composer.getSnapshot().chips).toHaveLength(0);
});
