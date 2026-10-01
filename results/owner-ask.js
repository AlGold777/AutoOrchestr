// "Вопрос владельцу": the dialog body for [[ASK: …]] markers of a stage. Pure helpers plus a
// textContent-only renderer; the page decides what to do with the collected answers.
(function initOwnerAsk(root) {
  'use strict';

  const clean = (value) => String(value == null ? '' : value).trim();

  function render(container, asks = []) {
    const doc = container.ownerDocument;
    container.replaceChildren();
    asks.forEach((ask, index) => {
      const row = doc.createElement('div');
      row.className = 'owner-ask-item';
      const label = doc.createElement('label');
      label.htmlFor = `owner-ask-answer-${index}`;
      label.textContent = ask.participantId ? `${ask.participantId}: ${ask.question}` : String(ask.question || '');
      const field = doc.createElement('textarea');
      field.id = `owner-ask-answer-${index}`;
      field.rows = 2;
      field.dataset.askIndex = String(index);
      field.setAttribute('aria-label', String(ask.question || 'Ответ'));
      row.append(label, field);
      container.append(row);
    });
  }

  // Only answered questions are kept; an empty field means "not answered".
  function collect(container, asks = []) {
    return Array.from(container.querySelectorAll('textarea[data-ask-index]'))
      .map((field) => ({ ask: asks[Number(field.dataset.askIndex)], answer: clean(field.value) }))
      .filter((item) => item.ask && item.answer)
      .map((item) => ({ question: clean(item.ask.question), answer: item.answer, participantId: item.ask.participantId || '' }));
  }

  // The text that reaches the prompts of the next stages ("Текущее указание человека").
  function toInstruction(answers = []) {
    return answers
      .filter((item) => clean(item.question) && clean(item.answer))
      .map((item) => `Ответ владельца на вопрос «${clean(item.question)}»: ${clean(item.answer)}`)
      .join('\n');
  }

  const api = Object.freeze({ render, collect, toInstruction });
  root.OwnerAsk = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
