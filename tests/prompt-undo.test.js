require('../results/pasted-text');

const fragment = 'Большая вставка 😀\r\n'.repeat(250);

function setup(id = 'prompt-input') {
  document.body.innerHTML = `<div class="prompt-container"><div id="bar"></div><textarea id="${id}"></textarea></div>`;
  const input = document.querySelector('textarea');
  const bar = document.getElementById('bar');
  const api = window.ResultsPastedText.create({ input, bar });
  return { input, bar, api };
}

function edit(input, text, inputType = 'insertText') {
  input.dispatchEvent(new InputEvent('beforeinput', { inputType, data: text, cancelable: true }));
  input.setRangeText(text, input.selectionStart, input.selectionEnd, 'end');
  input.dispatchEvent(new InputEvent('input', { inputType, data: text, bubbles: true }));
}

function shortcut(input, options = {}) {
  const event = new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true, cancelable: true, ...options });
  input.dispatchEvent(event);
  return event;
}

test.each(['prompt-input', 'modTa'])('%s undo/redo groups typing and restores the caret and draft notifications', (id) => {
  const { input, api } = setup(id);
  api.setText('prefix ');
  input.setSelectionRange(7, 7);
  edit(input, 'a');
  edit(input, 'b');
  const changed = jest.fn();
  input.addEventListener('input', changed);
  expect(shortcut(input).defaultPrevented).toBe(true);
  expect(api.getText()).toBe('prefix ');
  expect(input.selectionStart).toBe(7);
  shortcut(input, { shiftKey: true });
  expect(api.getText()).toBe('prefix ab');
  expect(input.selectionStart).toBe(9);
  expect(changed).toHaveBeenCalledTimes(2);
});

test('HTML-to-plain programmatic paste undoes to the original selected text', () => {
  const { input, api } = setup();
  api.setText('before REPLACE after');
  input.setSelectionRange(7, 14, 'backward');
  input.dispatchEvent(new Event('paste'));
  input.setRangeText('clipboard', 7, 14, 'end');
  input.dispatchEvent(new Event('input', { bubbles: true }));
  shortcut(input);
  expect(input.value).toBe('before REPLACE after');
  expect([input.selectionStart, input.selectionEnd, input.selectionDirection]).toEqual([7, 14, 'backward']);
  shortcut(input, { key: 'y' });
  expect(api.getText()).toBe('before clipboard after');
});

test('folded paste, surrounding typing, restore and removal undo in order without losing hidden text', () => {
  const { input, bar, api } = setup();
  api.setText('intro tail');
  input.setSelectionRange(6, 6);
  api.tryPaste(fragment);
  edit(input, 'between ');
  const typed = api.getText();
  bar.querySelector('.pasted-text-restore').click();
  expect(bar.hidden).toBe(true);
  shortcut(input);
  expect(api.getText()).toBe(typed);
  expect(input.value).toBe('intro between tail');
  expect(bar.hidden).toBe(false);
  bar.querySelector('.pasted-text-remove').click();
  expect(api.getText()).toBe('intro between tail');
  shortcut(input);
  expect(api.getText()).toBe(typed);
  shortcut(input);
  expect(api.getText()).toBe(`intro ${fragment}tail`);
  shortcut(input);
  expect(api.getText()).toBe('intro tail');
  expect(bar.hidden).toBe(true);
  shortcut(input, { shiftKey: true });
  expect(api.getText()).toBe(`intro ${fragment}tail`);
});

test('chip edits undo and redo with exact original CRLF content', () => {
  const { input, bar, api } = setup();
  api.tryPaste(fragment);
  bar.querySelector('.pasted-text-open').click();
  document.querySelector('.pasted-text-editor').value = 'edited';
  document.querySelector('.pasted-text-save').click();
  shortcut(input);
  expect(api.getText()).toBe(fragment);
  shortcut(input, { key: 'y' });
  expect(api.getText()).toBe('edited');
});

test('a new edit after undo discards redo; caret movement starts another typing group', () => {
  const { input } = setup();
  edit(input, 'first');
  input.setSelectionRange(0, 0);
  edit(input, 'prefix ');
  shortcut(input);
  expect(input.value).toBe('first');
  edit(input, 'new ');
  shortcut(input, { key: 'y' });
  expect(input.value).toBe('new first');
  shortcut(input);
  shortcut(input);
  expect(input.value).toBe('');
});

test('loading another draft resets history, including restored folded fragments', () => {
  const { input, api } = setup();
  edit(input, 'old draft');
  api.restoreSnapshot({ version: 1, visibleText: 'tail', chips: [{ offset: 0, text: fragment }] }, fragment + 'tail');
  shortcut(input);
  expect(api.getText()).toBe(fragment + 'tail');
  input.setSelectionRange(4, 4);
  edit(input, '!');
  shortcut(input);
  expect(api.getText()).toBe(fragment + 'tail');
  shortcut(input);
  expect(api.getText()).toBe(fragment + 'tail');
});

test('Cmd shortcuts and physical keys on a Russian layout work; unrelated shortcuts stay native', () => {
  const { input } = setup();
  edit(input, 'text');
  shortcut(input, { key: 'я', code: 'KeyZ', ctrlKey: false, metaKey: true });
  expect(input.value).toBe('');
  shortcut(input, { key: 'я', code: 'KeyZ', ctrlKey: false, metaKey: true, shiftKey: true });
  expect(input.value).toBe('text');
  for (const options of [{ altKey: true }, { isComposing: true }, { ctrlKey: false }, { key: 'c' }]) {
    expect(shortcut(input, options).defaultPrevented).toBe(false);
    expect(input.value).toBe('text');
  }
  input.readOnly = true;
  expect(shortcut(input).defaultPrevented).toBe(false);
  input.readOnly = false;
  input.disabled = true;
  expect(shortcut(input).defaultPrevented).toBe(false);
});

test('beforeinput history actions use the same history and do not fall through to stale browser edits', () => {
  const { input } = setup();
  edit(input, 'text');
  for (const [inputType, value] of [['historyUndo', ''], ['historyRedo', 'text']]) {
    const event = new InputEvent('beforeinput', { inputType, cancelable: true });
    input.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(input.value).toBe(value);
  }
});

test('a pause starts a separate undo step and grouped deletion restores removed characters', () => {
  const { input } = setup();
  const clock = jest.spyOn(Date, 'now');
  try {
    clock.mockReturnValue(1000);
    edit(input, 'first');
    clock.mockReturnValue(2101);
    edit(input, 'second');
    shortcut(input);
    expect(input.value).toBe('first');
    shortcut(input, { key: 'y' });
    for (let index = 0; index < 2; index++) {
      const caret = input.selectionStart;
      input.dispatchEvent(new InputEvent('beforeinput', { inputType: 'deleteContentBackward' }));
      input.setRangeText('', caret - 1, caret, 'end');
      input.dispatchEvent(new InputEvent('input', { inputType: 'deleteContentBackward', bubbles: true }));
    }
    expect(input.value).toBe('firstseco');
    shortcut(input);
    expect(input.value).toBe('firstsecond');
  } finally { clock.mockRestore(); }
});

test('history is bounded and retains the newest edits', () => {
  const { input } = setup();
  for (let index = 0; index < 110; index++) edit(input, 'a', 'insertFromPaste');
  for (let index = 0; index < 110; index++) shortcut(input);
  expect(input.value).toBe('a'.repeat(10));
  for (let index = 0; index < 110; index++) shortcut(input, { key: 'y' });
  expect(input.value).toBe('a'.repeat(110));
});

test('co-located folded fragments preserve their ordering across undo and redo', () => {
  const { input, api } = setup();
  api.tryPaste(fragment);
  api.tryPaste('second'.repeat(600));
  shortcut(input);
  expect(api.getText()).toBe(fragment);
  shortcut(input, { shiftKey: true });
  expect(api.getText()).toBe(fragment + 'second'.repeat(600));
});
