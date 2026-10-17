// Choice dialog: a modal with any number of buttons, and an optional text field for the answer.
// ask() resolves to the value of the pressed button (choices[].value), or to the text of the field when textInput is set
// (the button pressed then is the one submit button), or to null when the owner cancels (the Cancel button, Escape).
// Texts are written with textContent only.
(function initChoiceDialog(root) {
  'use strict';

  const el = (doc, tag, className, text) => {
    const node = doc.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  };

  function ask({ title = '', message = '', choices = [], textInput = null, cancelText = 'Отмена', signal = null, documentRef = root.document } = {}) {
    const doc = documentRef;
    return new Promise((resolve) => {
      const dialog = el(doc, 'dialog', 'choice-dialog');
      dialog.append(el(doc, 'h2', 'choice-dialog-title', String(title)));
      if (message) dialog.append(el(doc, 'p', 'choice-dialog-message', String(message)));
      let area = null;
      if (textInput) {
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
      const actions = el(doc, 'div', 'choice-dialog-actions');
      choices.forEach((choice) => {
        const button = el(doc, 'button', 'choice-dialog-choice', String(choice.label ?? choice.value));
        button.type = 'button';
        button.addEventListener('click', () => finish(textInput ? area.value : choice.value));
        actions.append(button);
      });
      const cancel = el(doc, 'button', 'choice-dialog-cancel', String(cancelText));
      cancel.type = 'button';
      cancel.addEventListener('click', () => finish(null));
      actions.append(cancel);
      dialog.append(actions);
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
      (area || actions.querySelector('button'))?.focus?.();
    });
  }

  const api = Object.freeze({ ask });
  root.ChoiceDialog = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
