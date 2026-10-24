// Choice dialog: a modal with any number of buttons, and an optional text field or document for the answer.
// ask() resolves to the value of the pressed button (choices[].value), or to the text of the field when textInput is set
// (the button pressed then is the one submit button), or to null when the owner cancels (the Cancel button, Escape).
// document { kind: 'read' } shows a text to read with an optional comment; document { kind: 'form' } shows a questionnaire
// (window.OwnerAsk) and gives its answer in answerFormat ('text' or 'json').
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
  // Title of a document: "name vN"; without a name only "vN"; without a version only the name.
  const docTitle = (spec) => {
    const hasVersion = spec.version != null && spec.version !== '';
    return [String(spec.name || ''), hasVersion ? `v${spec.version}` : ''].filter(Boolean).join(' ');
  };

  function ask({ title = '', message = '', choices = [], textInput = null, document: documentSpec = null, answerFormat = 'text', cancelText = null, signal = null, documentRef = root.document } = {}) {
    const doc = documentRef;
    return new Promise((resolve) => {
      const dialog = el(doc, 'dialog', 'choice-dialog');
      dialog.append(el(doc, 'h2', 'choice-dialog-title', String(title)));
      if (message) dialog.append(el(doc, 'p', 'choice-dialog-message', String(message)));
      const kind = documentSpec?.kind || null;
      // Modes of kind 'read' with the new fields: unavailable, readOnly, editable; otherwise the plain reading mode.
      const mode = kind !== 'read' ? null
        : documentSpec.unavailable === true ? 'unavailable'
          : documentSpec.readOnly === true ? 'readOnly'
            : documentSpec.editable === true ? 'editable' : null;
      let area = null;
      let formBox = null;
      let formAsks = [];
      if (mode === 'unavailable') {
        dialog.append(el(doc, 'h3', 'choice-dialog-document-title', docTitle(documentSpec)));
        dialog.append(el(doc, 'p', 'choice-dialog-document-unavailable', `Документ «${String(documentSpec.name || '')}»${documentSpec.version != null && documentSpec.version !== '' ? ` v${documentSpec.version}` : ''} недоступен. Другая версия вместо него не подставляется.`));
      } else if (mode === 'readOnly') {
        dialog.append(el(doc, 'h3', 'choice-dialog-document-title', docTitle(documentSpec)));
        dialog.append(el(doc, 'pre', 'choice-dialog-document', String(documentSpec.text ?? '')));
      } else if (mode === 'editable') {
        dialog.append(el(doc, 'h3', 'choice-dialog-document-title', docTitle(documentSpec)));
        area = el(doc, 'textarea', 'choice-dialog-document-edit');
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
        if (mode === 'unavailable') return choice.value;
        if (mode === 'editable') return area.value;
        if (kind === 'read') return clean(area.value) || READ_DONE;
        if (kind === 'form') return root.OwnerAsk.formAnswer(formBox, documentSpec.form?.items || [], answerFormat);
        if (textInput) return area.value;
        return choice.value;
      };
      const actions = el(doc, 'div', 'choice-dialog-actions');
      const submits = [];
      // A read-only document has no answer: its window gives no buttons but Close.
      (mode === 'readOnly' ? [] : choices).forEach((choice) => {
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
        signal.addEventListener('abort', () => finish(null), { once: true });
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
