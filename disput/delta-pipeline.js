// Delta: models take turns adding exactly one word to a phrase. Only the change is passed on:
// a model gets the whole phrase on its first turn, and on later turns only the words added
// after its own previous word — the rest is already in its own chat. A turn without an answer
// makes the next turn of that model a full one again (its chat may be lost).
// Stops after the last round, after a round in which nobody added a word, or on Stop.
(function initDeltaPipeline(root) {
  'use strict';

  // The delivery token the transport asks for, if the answer still carries it.
  const TOKEN_RE = /\[\[AO-[^\]]*\]\]/g;
  const ASK = 'Добавь одно слово. Ответь только этим словом.';
  const STOP_TEXT = Object.freeze({
    rounds_done: 'все круги пройдены',
    all_failed: 'за круг ни одна модель не добавила слово',
    cancelled: 'остановлено пользователем'
  });

  const phraseOf = (start, words = []) => [String(start || '').trim(), ...words.map((item) => item.text)].filter(Boolean).join(' ');

  function fullPrompt(start, words = []) {
    return [
      'Игра: модели по очереди продолжают фразу, каждая добавляет в её конец ровно одно слово.',
      `Фраза: «${phraseOf(start, words)}»`,
      ASK
    ].join('\n\n');
  }

  function deltaPrompt(newWords = []) {
    return [
      newWords.length
        ? `После твоего слова добавлено: «${newWords.map((item) => item.text).join(' ')}»`
        : 'После твоего слова ничего не добавлено.',
      ASK
    ].join('\n\n');
  }

  // The first word of the answer; quotes and markdown around it are not part of the word.
  function parseWord(text) {
    const tokens = String(text || '').replace(TOKEN_RE, ' ').replace(/[*_`"«»„“”]/g, ' ').trim().split(/\s+/).filter(Boolean);
    return { word: tokens[0] || '', extra: Math.max(0, tokens.length - 1) };
  }

  // rounds: [[model, ...], ...] — the order of models inside a round is the order of turns.
  // send(model, prompt, { round, full }) → { text, status }; a thrown error skips the model.
  async function run({ start, rounds = [], send, signal = null, onAnswer = null }) {
    if (typeof send !== 'function') throw new Error('delta_send_required');
    const words = [];
    const log = [];
    // How many words of the phrase each model has already seen (its own included).
    const seenBy = new Map();
    const aborted = () => Boolean(signal?.aborted);
    let stopReason = 'rounds_done';
    outer:
    for (let index = 0; index < rounds.length; index += 1) {
      const round = index + 1;
      let added = 0;
      for (const model of rounds[index]) {
        if (aborted()) { stopReason = 'cancelled'; break outer; }
        const seen = seenBy.get(model);
        const full = seen === undefined;
        const prompt = full ? fullPrompt(start, words) : deltaPrompt(words.slice(seen));
        let entry;
        try {
          const result = await send(model, prompt, { round, full });
          const { word, extra } = parseWord(result?.text);
          if (!word) {
            seenBy.delete(model);
            entry = { round, model, full, status: 'FAILED', reason: result?.status || 'no_answer', word: '' };
          } else {
            words.push({ text: word, model, round });
            seenBy.set(model, words.length);
            added += 1;
            // More than one word: the first one is taken, the rest is dropped.
            entry = { round, model, full, status: 'OK', word, extra };
          }
        } catch (error) {
          if (error?.name === 'AbortError' || aborted()) { stopReason = 'cancelled'; break outer; }
          seenBy.delete(model);
          entry = { round, model, full, status: 'FAILED', reason: String(error?.message || error), word: '' };
        }
        log.push(entry);
        if (typeof onAnswer === 'function') onAnswer(entry, words.slice());
      }
      if (!added) { stopReason = 'all_failed'; break; }
    }
    return { phrase: phraseOf(start, words), words, log, stopReason };
  }

  function formatResult({ phrase = '', words = [], stopReason = '' } = {}) {
    return [
      phrase,
      words.map((item) => `${item.text} — ${item.model}, круг ${item.round}`).join('\n'),
      `Остановка: ${STOP_TEXT[stopReason] || stopReason}.`
    ].filter(Boolean).join('\n\n');
  }

  const api = Object.freeze({ STOP_TEXT, fullPrompt, deltaPrompt, parseWord, run, formatResult });
  root.DeltaPipeline = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
