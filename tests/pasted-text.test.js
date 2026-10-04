require('../results/pasted-text');
require('../results/attachments');

const longText = `  <script>alert('text only')</script>\n${'Большой текст 😀\n'.repeat(250)}  `;

function makeComposer(id = 'prompt-input') {
  document.body.innerHTML = `<div class="prompt-container"><div id="chips"></div><textarea id="${id}"></textarea></div>`;
  const input = document.querySelector('textarea');
  const bar = document.getElementById('chips');
  const api = window.ResultsPastedText.create({ input, bar });
  return { api, input, bar };
}

function replaceVisible(input, start, end, text) {
  input.setSelectionRange(start, end);
  input.dispatchEvent(new InputEvent('beforeinput', { inputType: 'insertText', data: text }));
  input.setRangeText(text, start, end, 'end');
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

test('collapses long or many-line pastes, leaving short pastes to the browser', () => {
  const { api, input, bar } = makeComposer();
  expect(api.tryPaste('a'.repeat(2999))).toBe(false);
  expect(api.tryPaste('a'.repeat(3000))).toBe(true);
  expect(input.value).toBe('');
  expect(api.getText()).toBe('a'.repeat(3000));
  expect(bar.hidden).toBe(false);
  api.setText('');
  expect(api.tryPaste(Array(39).fill('x').join('\n'))).toBe(false);
  expect(api.tryPaste(Array(40).fill('x').join('\n'))).toBe(true);
});

test.each(['prompt-input', 'modTa'])('full %s prompt retains the selection position, whitespace and Unicode', (id) => {
  const { api, input } = makeComposer(id);
  api.setText('before [replace] after');
  input.setSelectionRange(7, 16);
  expect(api.tryPaste(longText)).toBe(true);
  expect(input.value).toBe('before  after');
  expect(api.getText()).toBe(`before ${longText} after`);
});

test('multiple pastes and ordinary typing assemble in order without separators or truncation', () => {
  const { api, input } = makeComposer();
  api.tryPaste(longText);
  replaceVisible(input, 0, 0, '\nquestion\n');
  api.tryPaste('second'.repeat(600));
  replaceVisible(input, input.value.length, input.value.length, 'tail');
  expect(api.getText()).toBe(`${longText}\nquestion\n${'second'.repeat(600)}tail`);
});

test('editing visible text before a card moves its insertion position', () => {
  const { api, input } = makeComposer();
  api.setText('intro suffix');
  input.setSelectionRange(6, 6);
  api.tryPaste(longText);
  replaceVisible(input, 0, 5, 'new introduction');
  expect(api.getText()).toBe(`new introduction ${longText}suffix`);
  input.value = ' suffix';
  input.dispatchEvent(new Event('input'));
  expect(api.getText()).toBe(` ${longText}suffix`);
});

test('selection-aware insertion handles repeated surrounding characters', () => {
  const { api, input } = makeComposer();
  api.setText('aaaa');
  input.setSelectionRange(2, 2);
  api.tryPaste(longText);
  replaceVisible(input, 0, 0, 'a');
  expect(api.getText()).toBe(`aaa${longText}aa`);
});

test('a short HTML paste without beforeinput retains the real selection among repeated text', () => {
  const { api, input } = makeComposer();
  api.setText('aaaa');
  input.setSelectionRange(2, 2);
  api.tryPaste(longText);
  input.setSelectionRange(0, 0);
  input.dispatchEvent(new Event('paste'));
  // The existing HTML-to-plain paste handler inserts directly and emits input.
  input.setRangeText('a', 0, 0, 'end');
  input.dispatchEvent(new Event('input', { bubbles: true }));
  expect(api.getText()).toBe(`aaa${longText}aa`);
});

test('each restore returns its original text without reversing co-located cards', () => {
  const { api, input, bar } = makeComposer();
  const other = 'second'.repeat(600);
  api.tryPaste(longText);
  api.tryPaste(other);
  bar.querySelectorAll('.pasted-text-restore')[0].click();
  expect(api.getText()).toBe(longText + other);
  bar.querySelector('.pasted-text-restore').click();
  expect(input.value).toBe(longText + other);
  expect(bar.hidden).toBe(true);
});

test('restoring the last of co-located cards keeps the preceding card before it', () => {
  const { api, input, bar } = makeComposer();
  const other = 'second'.repeat(600);
  api.tryPaste(longText);
  api.tryPaste(other);
  bar.querySelectorAll('.pasted-text-restore')[1].click();
  expect(api.getText()).toBe(longText + other);
  bar.querySelector('.pasted-text-restore').click();
  expect(input.value).toBe(longText + other);
});

test('view opens the entire text safely, save updates only that card, cancel discards edits', () => {
  const { api, bar } = makeComposer();
  api.tryPaste(longText);
  bar.querySelector('.pasted-text-open').click();
  const dialog = document.querySelector('dialog');
  const editor = dialog.querySelector('textarea');
  expect(dialog.hasAttribute('open')).toBe(true);
  expect(editor.value).toBe(longText);
  expect(document.querySelector('script')).toBeNull();
  editor.value = '<b>edited</b>\n  exact whitespace  ';
  dialog.querySelector('.pasted-text-save').click();
  expect(api.getText()).toBe('<b>edited</b>\n  exact whitespace  ');
  expect(dialog.hasAttribute('open')).toBe(false);
  bar.querySelector('.pasted-text-open').click();
  editor.value = 'discard';
  dialog.querySelector('button').click();
  expect(api.getText()).toBe('<b>edited</b>\n  exact whitespace  ');
});

test('Escape cancels and Ctrl+Enter saves without invoking outer composer shortcuts', () => {
  const { api, bar } = makeComposer();
  api.tryPaste(longText);
  const outerShortcut = jest.fn();
  document.addEventListener('keydown', outerShortcut);
  try {
    bar.querySelector('.pasted-text-open').click();
    const editor = document.querySelector('.pasted-text-editor');
    editor.value = 'discard';
    editor.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(api.getText()).toBe(longText);
    bar.querySelector('.pasted-text-open').click();
    editor.value = 'saved';
    editor.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true }));
    expect(api.getText()).toBe('saved');
    expect(outerShortcut).not.toHaveBeenCalled();
  } finally { document.removeEventListener('keydown', outerShortcut); }
});

test('viewing and saving unchanged text preserves original CRLF newlines', () => {
  const { api, bar } = makeComposer();
  const text = 'original\r\n'.repeat(400);
  api.tryPaste(text);
  bar.querySelector('.pasted-text-open').click();
  document.querySelector('.pasted-text-save').click();
  expect(api.getText()).toBe(text);
});

test('remove deletes only its fragment and emits input for draft persistence', () => {
  const { api, input, bar } = makeComposer();
  api.setText('intro');
  input.setSelectionRange(5, 5);
  api.tryPaste(longText);
  replaceVisible(input, 5, 5, 'tail');
  const changed = jest.fn();
  input.addEventListener('input', changed);
  bar.querySelector('.pasted-text-remove').click();
  expect(api.getText()).toBe('introtail');
  expect(changed).toHaveBeenCalledTimes(1);
  expect(bar.hidden).toBe(true);
});

test('a blank saved edit removes the card', () => {
  const { api, bar } = makeComposer();
  api.tryPaste(longText);
  bar.querySelector('.pasted-text-open').click();
  document.querySelector('.pasted-text-editor').value = '';
  document.querySelector('.pasted-text-save').click();
  expect(api.getText()).toBe('');
  expect(bar.hidden).toBe(true);
});

test('draft restoration preserves all cards and full text across a new composer', () => {
  const first = makeComposer();
  first.api.setText('intro tail');
  first.input.setSelectionRange(6, 6);
  first.api.tryPaste(longText);
  first.api.tryPaste('other'.repeat(700));
  const snapshot = JSON.parse(JSON.stringify(first.api.getSnapshot()));
  const full = first.api.getText();
  const second = makeComposer();
  second.api.restoreSnapshot(snapshot, full);
  expect(second.api.getText()).toBe(full);
  expect(second.input.value).toBe('intro tail');
  expect(second.bar.querySelectorAll('.pasted-text-chip')).toHaveLength(2);
});

test('stale or malformed snapshot falls back to the complete saved prompt', () => {
  const { api, bar } = makeComposer();
  api.restoreSnapshot({ version: 1, visibleText: '', chips: [{ text: 'lost', offset: 0 }] }, longText);
  expect(api.getText()).toBe(longText);
  api.restoreSnapshot({ version: 1, visibleText: '', chips: [{ text: 'bad', offset: -1 }] }, longText);
  expect(api.getText()).toBe(longText);
  expect(bar.hidden).toBe(true);
});

test('programmatic replacement clears old cards and closes their editor', () => {
  const { api, bar } = makeComposer();
  api.tryPaste(longText);
  bar.querySelector('.pasted-text-open').click();
  api.setText('replacement');
  expect(api.getText()).toBe('replacement');
  expect(bar.hidden).toBe(true);
  expect(document.querySelector('dialog').hasAttribute('open')).toBe(false);
});

test('read-only and disabled composers do not consume a paste', () => {
  const { api, input } = makeComposer();
  input.readOnly = true;
  expect(api.tryPaste(longText)).toBe(false);
  input.readOnly = false;
  input.disabled = true;
  expect(api.tryPaste(longText)).toBe(false);
});

test('text cards never enter the provider file payload and do not clear selected files', async () => {
  const { api, bar } = makeComposer();
  const files = window.ResultsAttachments.create({ promptAttachmentBar: document.createElement('div') });
  files.addPromptAttachments([new File(['file body'], 'actual.txt', { type: 'text/plain' })]);
  api.tryPaste(longText);
  bar.querySelector('.pasted-text-remove').click();
  const payload = await files.buildAttachmentPayload();
  expect(payload.map((file) => file.name)).toEqual(['actual.txt']);
  api.tryPaste(longText);
  files.clearPromptAttachments();
  expect(api.getText()).toBe(longText);
});
