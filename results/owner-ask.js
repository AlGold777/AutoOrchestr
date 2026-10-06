// "Вопрос владельцу": the dialog body for [[ASK: …]] markers of a stage. The owner picks from the
// options the model proposed (one or several) and may add a short comment; nothing has to be
// typed. A question without options offers one standard choice: "decide it yourself". Pure helpers
// plus a textContent-only renderer; the page decides what to do with the collected answers.
(function initOwnerAsk(root) {
  'use strict';

  const DELEGATE_LABEL = 'Решите сами и отметьте это допущением';
  const clean = (value) => String(value == null ? '' : value).trim();
  const optionsOf = (ask) => (Array.isArray(ask?.options) ? ask.options.map(clean).filter(Boolean) : []);

  function render(container, asks = []) {
    const doc = container.ownerDocument;
    container.replaceChildren();
    asks.forEach((ask, index) => {
      const options = optionsOf(ask);
      const choices = options.length ? options : [DELEGATE_LABEL];
      const multi = options.length > 0 && ask?.multi === true;
      const row = doc.createElement('fieldset');
      row.className = 'owner-ask-item';
      const legend = doc.createElement('legend');
      legend.textContent = ask.participantId ? `${ask.participantId}: ${ask.question}` : String(ask.question || '');
      row.append(legend);
      if (multi) {
        const note = doc.createElement('p');
        note.className = 'owner-ask-multi';
        note.textContent = 'Можно выбрать несколько вариантов.';
        row.append(note);
      }
      choices.forEach((label, choiceIndex) => {
        const choice = doc.createElement('label');
        choice.className = 'owner-ask-option';
        const input = doc.createElement('input');
        // A standard "decide it yourself" choice is a checkbox: it can be switched off again.
        input.type = multi || !options.length ? 'checkbox' : 'radio';
        input.name = `owner-ask-${index}`;
        input.dataset.askIndex = String(index);
        input.dataset.choiceIndex = String(choiceIndex);
        input.setAttribute('aria-label', label);
        const text = doc.createElement('span');
        text.textContent = label;
        choice.append(input, text);
        row.append(choice);
      });
      const comment = doc.createElement('textarea');
      comment.className = 'owner-ask-comment';
      comment.rows = 1;
      comment.dataset.askComment = String(index);
      comment.placeholder = 'Комментарий (необязательно)';
      comment.setAttribute('aria-label', `Комментарий: ${clean(ask.question)}`);
      row.append(comment);
      container.append(row);
    });
  }

  // Only answered questions are kept: something was picked, or a comment was written.
  function collect(container, asks = []) {
    const answers = [];
    asks.forEach((ask, index) => {
      const options = optionsOf(ask);
      const choices = options.length ? options : [DELEGATE_LABEL];
      const selected = Array.from(container.querySelectorAll(`input[data-ask-index="${index}"]`))
        .filter((input) => input.checked)
        .map((input) => choices[Number(input.dataset.choiceIndex)])
        .filter(Boolean);
      const field = container.querySelector(`textarea[data-ask-comment="${index}"]`);
      const comment = clean(field?.value);
      if (!selected.length && !comment) return;
      const parts = [];
      if (selected.length) parts.push(selected.join('; '));
      if (comment) parts.push(`Комментарий: ${comment}`);
      answers.push({
        question: clean(ask.question), answer: parts.join('. '), selected, comment,
        participantId: ask.participantId || ''
      });
    });
    return answers;
  }

  // The text that reaches the prompts of the next stages ("Текущее указание человека").
  function toInstruction(answers = []) {
    return answers
      .filter((item) => clean(item.question) && clean(item.answer))
      .map((item) => `Ответ владельца на вопрос «${clean(item.question)}»: ${clean(item.answer)}`)
      .join('\n');
  }

  const api = Object.freeze({ DELEGATE_LABEL, render, collect, toInstruction });
  root.OwnerAsk = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
