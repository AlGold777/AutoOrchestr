// Polishing: collects fresh improvements of one idea. The idea itself never changes;
// there is no merge, ranking or synthesis — only an append-only list of lines.
// A round calls the round's models one after another; every model sees the idea and
// the whole list collected so far and adds at most K new lines. The transport adds the
// delivery token and drops foreign (stale) answers; an answer without the token is kept.
// Stops after the last round, after a round that answered but added nothing, after two
// rounds in a row without any answer, before the prompt outgrows its budget, or on Stop.
// What was collected is always returned, also on Stop.
(function initPolishingPipeline(root) {
  'use strict';

  const DEFAULT_MAX_IDEAS = 3;
  // Rounds in a row without a single answer before the run gives up: one bad round
  // (a provider hiccup) must not end a run that was collecting.
  const MAX_SILENT_ROUNDS = 2;
  // Bullets and numbering a model puts before a line: "- ", "* ", "• ", "1. ", "2) ".
  const LINE_PREFIX_RE = /^\s*(?:[-*•–—]+|\d{1,3}[.)])\s+/;
  // A whole-line refusal ("Новых улучшений нет.") is the EMPTY answer, not an idea.
  const NO_IDEAS_RE = /^(?:нет\s+новых|новых\s+(?:улучшений|идей)?\s*нет|улучшений\s+нет|no\s+new\b|none\b)/i;
  // Headings ("Улучшения:", "## Идеи") and code fences are layout, not ideas.
  const LAYOUT_RE = /^(?:#{1,6}\s|```|~~~|.{0,60}:\s*$)/;

  const normalize = (line) => String(line || '').toLowerCase().replace(/[*_`"«»]/g, '').replace(/\s+/g, ' ').replace(/[.;:!]+$/, '').trim();
  // "**Text**" → "Text": emphasis around a whole line carries nothing in a plain list.
  const unwrap = (line) => line.replace(/^(\*\*|__)(.+)\1$/, '$2').trim();

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

  // One line of the answer is one idea. Exact repeats of the list or of the idea (an echo)
  // are dropped; anything else is kept: deduplication by meaning is outside the pipeline.
  function parseIdeas(text, known = []) {
    const seen = new Set(known.map((item) => normalize(item.text ?? item)));
    const out = [];
    String(text || '').split(/\r?\n/).forEach((raw) => {
      const line = unwrap(raw.replace(LINE_PREFIX_RE, '').trim());
      if (!line || NO_IDEAS_RE.test(line) || LAYOUT_RE.test(line)) return;
      const key = normalize(line);
      if (!key || seen.has(key)) return;
      seen.add(key);
      out.push(line);
    });
    return out;
  }

  // rounds: [[model, ...], ...] — the order of models inside a round is the call order.
  // send(model, prompt, { round }) → { text, status, answered }; a thrown error skips the model.
  // answered: the model finished its answer (delivery token seen) even if no text is left once the
  // token is removed — "nothing new" is said with the token alone, and that is EMPTY, not a failure.
  // K is a hard limit: lines beyond the first K of an answer are dropped (counted in `dropped`).
  // maxPromptChars: the run stops before a prompt (with the whole list) would exceed it,
  // instead of letting the transport cut the prompt's tail with the instruction.
  async function run({ idea, rounds = [], maxIdeas = DEFAULT_MAX_IDEAS, maxPromptChars = Infinity, send, signal = null, onAnswer = null }) {
    if (typeof send !== 'function') throw new Error('delta_send_required');
    const ideas = [];
    const log = [];
    const known = () => [String(idea || ''), ...ideas];
    let stopReason = 'rounds_done';
    let silentRounds = 0;
    const aborted = () => Boolean(signal?.aborted);
    outer:
    for (let index = 0; index < rounds.length; index += 1) {
      const round = index + 1;
      let added = 0;
      let answered = 0;
      for (const model of rounds[index]) {
        if (aborted()) { stopReason = 'cancelled'; break outer; }
        const prompt = buildPrompt({ idea, ideas, maxIdeas });
        if (prompt.length > maxPromptChars) { stopReason = 'list_full'; break outer; }
        let entry;
        try {
          const result = await send(model, prompt, { round });
          const text = String(result?.text || '').trim();
          if (!text && result?.answered) {
            answered += 1;
            entry = { round, model, status: 'EMPTY', added: 0, dropped: 0, text: '' };
          } else if (!text) {
            entry = { round, model, status: 'FAILED', reason: result?.status || 'no_answer', added: 0, text: '' };
          } else {
            const fresh = parseIdeas(text, known());
            const kept = fresh.slice(0, maxIdeas);
            kept.forEach((line) => ideas.push({ text: line, model, round }));
            answered += 1;
            added += kept.length;
            entry = { round, model, status: kept.length ? 'OK' : 'EMPTY', added: kept.length, dropped: fresh.length - kept.length, text };
          }
        } catch (error) {
          if (error?.name === 'AbortError' || aborted()) { stopReason = 'cancelled'; break outer; }
          entry = { round, model, status: 'FAILED', reason: String(error?.message || error), added: 0, text: '' };
        }
        log.push(entry);
        if (typeof onAnswer === 'function') onAnswer(entry, ideas.slice());
      }
      if (added) { silentRounds = 0; continue; }
      if (answered) { stopReason = 'no_new_ideas'; break; }
      silentRounds += 1;
      if (silentRounds >= MAX_SILENT_ROUNDS) { stopReason = 'all_failed'; break; }
    }
    return { ideas, log, stopReason };
  }

  const STOP_TEXT = Object.freeze({
    rounds_done: 'все круги пройдены',
    no_new_ideas: 'круг без новых улучшений',
    all_failed: `${MAX_SILENT_ROUNDS} круга подряд без ответов`,
    list_full: 'список достиг предела промпта',
    cancelled: 'остановлено пользователем'
  });

  function formatIdeas(ideas = []) {
    return ideas.map((item, index) => `${index + 1}. ${item.text} — ${item.model}, круг ${item.round}`).join('\n');
  }

  // Who answered what, per round: "Круг 1: GPT +3, Claude пусто, Gemini сбой (timeout)".
  function formatRounds(log = []) {
    const byRound = new Map();
    log.forEach((entry) => {
      const part = entry.status === 'OK' ? `${entry.model} +${entry.added}${entry.dropped ? ` (сверх K отброшено ${entry.dropped})` : ''}`
        : entry.status === 'EMPTY' ? `${entry.model} пусто`
          : `${entry.model} сбой${entry.reason ? ` (${entry.reason})` : ''}`;
      byRound.set(entry.round, [...(byRound.get(entry.round) || []), part]);
    });
    return Array.from(byRound, ([round, parts]) => `Круг ${round}: ${parts.join(', ')}`).join('\n');
  }

  function formatResult({ ideas = [], log = [], stopReason = '' } = {}) {
    return [
      formatIdeas(ideas) || 'Новых улучшений нет.',
      formatRounds(log),
      `Остановка: ${STOP_TEXT[stopReason] || stopReason}.`
    ].filter(Boolean).join('\n\n');
  }

  const api = Object.freeze({ DEFAULT_MAX_IDEAS, MAX_SILENT_ROUNDS, STOP_TEXT, buildPrompt, parseIdeas, run, formatIdeas, formatRounds, formatResult });
  root.PolishingPipeline = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
