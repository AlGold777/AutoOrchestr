// Choice dialog: a modal with any number of buttons, and an optional text field or document for the answer.
// ask() resolves to the value of the pressed button (choices[].value), or to the text of the field when textInput is set
// (the button pressed then is the one submit button), or to null when the owner cancels (the Cancel button, Escape).
// document { kind: 'read' } shows a text to read with an optional comment; document { kind: 'form' } shows a questionnaire
// (window.OwnerAsk) and gives its answer in answerFormat ('text' or 'json').
// folder { name, onPick } shows the row «Папка документов» with the name of the folder; onPick() gives the new name or null.
// hint: a promise of text lines, shown above the buttons when ready; it does not change the answer.
// Texts are written with textContent only.
(function initChoiceDialog(root) {
  'use strict';

  const READ_DONE = 'Документ прочитан, замечаний нет.';
  const el = (doc, tag, className, text) => {
    const node = doc.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  };
  const clean = (value) => String(value == null ? '' : value).trim();
  // Title of a document: its name only; without a name there is no title.
  const docTitle = (spec) => String(spec.name || '');
  const decodeBase64 = (value) => {
    const binary = root.atob(String(value || '').replace(/^data:[^,]*;base64,/i, ''));
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return bytes;
  };

  function ask({ title = '', message = '', choices = [], textInput = null, document: documentSpec = null, answerFormat = 'text', cancelText = null, signal = null, folder = null, allowChoicesWithReadOnlyDocument = false, inputFiles = [], hint = null, documentRef = root.document } = {}) {
    const doc = documentRef;
    return new Promise((resolve) => {
      const objectUrls = [];
      let abortHandler = null;
      const dialog = el(doc, 'dialog', 'choice-dialog');
      dialog.append(el(doc, 'h2', 'choice-dialog-title', String(title)));
      if (message) dialog.append(el(doc, 'p', 'choice-dialog-message', String(message)));
      if (Array.isArray(inputFiles) && inputFiles.length) {
        const filesBox = el(doc, 'div', 'choice-dialog-input-files');
        inputFiles.forEach((file) => {
          try {
            const blob = new Blob([decodeBase64(file.base64)], { type: String(file.type || '') });
            const url = root.URL.createObjectURL(blob);
            objectUrls.push(url);
            const link = el(doc, 'a', 'choice-dialog-input-file', `📎 ${String(file.name || 'Файл')}`);
            link.href = url;
            link.download = String(file.name || 'file');
            filesBox.append(link);
          } catch (_) { /* an invalid payload does not prevent reading the step */ }
        });
        if (filesBox.childNodes.length) dialog.append(filesBox);
      }
      const kind = documentSpec?.kind || null;
      // Modes of kind 'read' with the new fields: readOnly, editable; otherwise the plain reading mode.
      const mode = kind !== 'read' ? null
        : documentSpec.readOnly === true ? 'readOnly'
          : documentSpec.editable === true ? 'editable' : null;
      const docHeading = mode ? docTitle(documentSpec) : '';
      let area = null;
      let formBox = null;
      let formAsks = [];
      if (mode === 'readOnly') {
        if (docHeading) dialog.append(el(doc, 'h3', 'choice-dialog-document-title', docHeading));
        dialog.append(el(doc, 'pre', 'choice-dialog-document', String(documentSpec.text ?? '')));
      } else if (mode === 'editable') {
        if (docHeading) dialog.append(el(doc, 'h3', 'choice-dialog-document-title', docHeading));
        area =el(doc, 'textarea', 'choice-dialog-document-edit');
        area.value = String(documentSpec.text ?? '');
        area.rows = 16;
        area.spellcheck = false;
        area.setAttribute('aria-label', 'Документ');
        dialog.append(area);
      } else if (kind === 'read') {
        dialog.append(el(doc, 'pre', 'choice-dialog-document', String(documentSpec.text ?? '')));
        area = el(doc, 'textarea', 'choice-dialog-text');
        area.rows = 2;
        area.spellcheck = false;
        area.setAttribute('aria-label', 'Комментарий (необязательно)');
        dialog.append(area);
      } else if (kind === 'form') {
        formBox = el(doc, 'div', 'choice-dialog-form');
        formAsks = root.OwnerAsk.formAsks(documentSpec.form?.items || []);
        root.OwnerAsk.render(formBox, formAsks);
        dialog.append(formBox);
      } else if (textInput) {
        area = el(doc, 'textarea', 'choice-dialog-text');
        area.rows = 6;
        area.spellcheck = false;
        area.setAttribute('aria-label', String(textInput.label || 'Текст'));
        dialog.append(area);
      }
      let finished = false;
      const finish = (value) => {
        if (finished) return;
        finished = true;
        if (signal && abortHandler) signal.removeEventListener('abort', abortHandler);
        objectUrls.forEach((url) => root.URL.revokeObjectURL(url));
        objectUrls.length = 0;
        if (typeof dialog.close === 'function') dialog.close();
        dialog.remove();
        resolve(value);
      };
      const isValid = () => {
        if (kind === 'form') return root.OwnerAsk.complete(formBox, formAsks);
        if (mode === 'editable') return clean(area.value) !== '';
        if (!kind && textInput?.required === true) return clean(area.value) !== '';
        return true;
      };
      const answerOf = (choice) => {
        if (mode === 'editable') return area.value;
        if (kind === 'read') {
          if (mode === 'readOnly' && allowChoicesWithReadOnlyDocument) return choice.value;
          return clean(area.value) || READ_DONE;
        }
        if (kind === 'form') return root.OwnerAsk.formAnswer(formBox, documentSpec.form?.items || [], answerFormat);
        if (textInput) return area.value;
        return choice.value;
      };
      if (folder) {
        const row = el(doc, 'div', 'choice-dialog-folder');
        const pick = el(doc, 'button', 'choice-dialog-folder-pick', 'Папка документов');
        pick.type = 'button';
        const name = el(doc, 'span', 'choice-dialog-folder-name', folder.name || 'не выбрана');
        pick.addEventListener('click', async () => {
          try {
            const picked = await folder.onPick();
            if (picked) name.textContent = picked;
          } catch (_) { /* the window stays open: the folder keeps its name */ }
        });
        row.append(pick, name);
        dialog.append(row);
      }
      const actions = el(doc, 'div', 'choice-dialog-actions');
      const submits = [];
      // A read-only document has no editable answer; callers may explicitly add choice buttons for confirmation.
      (mode === 'readOnly' && !allowChoicesWithReadOnlyDocument ? [] : choices).forEach((choice) => {
        const button = el(doc, 'button', 'choice-dialog-choice', String(choice.label ?? choice.value));
        button.type = 'button';
        button.addEventListener('click', () => finish(answerOf(choice)));
        actions.append(button);
        submits.push(button);
      });
      const cancel = el(doc, 'button', 'choice-dialog-cancel', String(cancelText ?? (mode === 'readOnly' ? 'Закрыть' : 'Отмена')));
      cancel.type = 'button';
      cancel.addEventListener('click', () => finish(null));
      actions.append(cancel);
      dialog.append(actions);
      const refresh = () => {
        const valid = isValid();
        submits.forEach((button) => { button.disabled = !valid; });
      };
      refresh();
      if (area) area.addEventListener('input', refresh);
      if (formBox) {
        formBox.addEventListener('change', refresh);
        formBox.addEventListener('input', refresh);
      }
      // A Stop of the run closes the window at once: the answer is a cancel (R07).
      if (signal) {
        if (signal.aborted) { finish(null); return; }
        abortHandler = () => finish(null);
        signal.addEventListener('abort', abortHandler, { once: true });
      }
      // A hint never holds the window: its lines appear when they are ready; no lines, a failure or a closed window show nothing.
      if (hint) {
        Promise.resolve(hint).then((lines) => {
          if (finished || !Array.isArray(lines) || !lines.length) return;
          dialog.insertBefore(el(doc, 'p', 'choice-dialog-hint', ['Подсказка локальной модели (решаете вы):', ...lines].join('\n')), actions);
        }).catch(() => {});
      }
      // Escape closes the native dialog: the answer is a cancel.
      dialog.addEventListener('cancel', (event) => { event.preventDefault(); finish(null); });
      doc.body.append(dialog);
      if (typeof dialog.showModal === 'function') dialog.showModal();
      else dialog.setAttribute('open', '');
      (area || formBox?.querySelector('input, textarea') || actions.querySelector('button'))?.focus?.();
    });
  }

  const api = Object.freeze({ ask });
  root.ChoiceDialog = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
