// Delta: collects fresh improvements of one idea. The idea itself never changes;
// there is no merge, ranking or synthesis — only an append-only list of lines.
// A round calls the round's models one after another; every model sees the idea and
// the whole list collected so far and adds at most K new lines. The transport adds the
// delivery token and drops foreign (stale) answers; an answer without the token is kept.
// Stops after the last round, or after a full round that added nothing.
(function initDeltaPipeline(root) {
  'use strict';

  const DEFAULT_MAX_IDEAS = 3;
  // Bullets and numbering a model puts before a line: "- ", "* ", "• ", "1. ", "2) ".
  const LINE_PREFIX_RE = /^\s*(?:[-*•–—]+|\d{1,3}[.)])\s+/;
  // A whole-line refusal ("Новых улучшений нет.") is the EMPTY answer, not an idea.
  const NO_IDEAS_RE = /^(?:нет\s+новых|новых\s+(?:улучшений|идей)?\s*нет|улучшений\s+нет|no\s+new\b|none\b)/i;

  const normalize = (line) => String(line || '').toLowerCase().replace(/[*_`"«»]/g, '').replace(/\s+/g, ' ').replace(/[.;:!]+$/, '').trim();

  function buildPrompt({ idea, ideas = [], maxIdeas = DEFAULT_MAX_IDEAS }) {
    const list = ideas.length
      ? ideas.map((item, index) => `${index + 1}. ${item.text}`).join('\n')
      : 'Пока нет.';
    return [
      `Идея:\n${String(idea || '').trim()}`,
      `Уже предложенные улучшения:\n${list}`,
      'Предложи только новые улучшения по существу идеи, которых нет в списке выше. '
        + 'Не повторяй, не уходи в несвязанные области, без вступлений и пояснений. '
        + `Каждое улучшение отдельной строкой, не больше ${maxIdeas}. `
        + 'Если новых нет, не пиши ничего, кроме метки.'
    ].join('\n\n');
  }

  // One line of the answer is one idea. Exact repeats of the list (an echoed list) are dropped;
  // anything else is kept: deduplication by meaning is outside the pipeline.
  function parseIdeas(text, known = []) {
    const seen = new Set(known.map((item) => normalize(item.text ?? item)));
    const out = [];
    String(text || '').split(/\r?\n/).forEach((raw) => {
      const line = raw.replace(LINE_PREFIX_RE, '').trim();
      if (!line || NO_IDEAS_RE.test(line)) return;
      const key = normalize(line);
      if (!key || seen.has(key)) return;
      seen.add(key);
      out.push(line);
    });
    return out;
  }

  // rounds: [[model, ...], ...] — the order of models inside a round is the call order.
  // send(model, prompt, { round }) → { text, status }; a thrown error skips the model.
  async function run({ idea, rounds = [], maxIdeas = DEFAULT_MAX_IDEAS, send, signal = null, onAnswer = null }) {
    if (typeof send !== 'function') throw new Error('delta_send_required');
    const ideas = [];
    const log = [];
    let stopReason = 'rounds_done';
    for (let index = 0; index < rounds.length; index += 1) {
      const round = index + 1;
      let added = 0;
      let answered = 0;
      for (const model of rounds[index]) {
        if (signal?.aborted) throw new DOMException('Pipeline run cancelled', 'AbortError');
        let entry;
        try {
          const result = await send(model, buildPrompt({ idea, ideas, maxIdeas }), { round });
          const text = String(result?.text || '').trim();
          if (!text) {
            entry = { round, model, status: 'FAILED', reason: result?.status || 'no_answer', added: 0, text: '' };
          } else {
            const fresh = parseIdeas(text, ideas);
            fresh.forEach((line) => ideas.push({ text: line, model, round }));
            answered += 1;
            added += fresh.length;
            entry = { round, model, status: fresh.length ? 'OK' : 'EMPTY', added: fresh.length, overLimit: fresh.length > maxIdeas, text };
          }
        } catch (error) {
          if (error?.name === 'AbortError') throw error;
          entry = { round, model, status: 'FAILED', reason: String(error?.message || error), added: 0, text: '' };
        }
        log.push(entry);
        if (typeof onAnswer === 'function') onAnswer(entry, ideas.slice());
      }
      if (!added) {
        stopReason = answered ? 'no_new_ideas' : 'all_failed';
        break;
      }
    }
    return { ideas, log, stopReason };
  }

  function formatIdeas(ideas = []) {
    return ideas.map((item, index) => `${index + 1}. ${item.text} — ${item.model}, круг ${item.round}`).join('\n');
  }

  const api = Object.freeze({ DEFAULT_MAX_IDEAS, buildPrompt, parseIdeas, run, formatIdeas });
  root.DeltaPipeline = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
