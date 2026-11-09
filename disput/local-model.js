// Local model hint for the owner step. A model running on this computer (Ollama) reads what the owner received and
// suggests one of two ways, with a quote it is based on. It is a hint only: the run does not depend on it, the owner decides.
// The hint is dropped when the service is off, when the text has no conclusion of a reviewer (none), and when the quote is not
// literally in the text: an invented basis is never shown.
(function initLocalModel(root) {
  'use strict';

  const MODEL = 'qwen3.5:4b-mlx';
  const ENDPOINT = 'http://127.0.0.1:11434';
  const TIMEOUT_MS = 120000;
  const HEAD_CHARS = 8000;
  const TAIL_CHARS = 24000;
  const MIN_ITEM_CHARS = 300;
  const MIN_QUOTE_CHARS = 10;
  const MAX_ITEMS = 6;
  const RULE_ID = 94211;
  const LABELS = Object.freeze(['pass', 'rework', 'none']);
  const ADVICE = Object.freeze({ pass: 'можно принимать', rework: 'вернуть на доработку' });

  // Reviewers state the conclusion at the start or at the end: the middle of a very long text is what is left out.
  const excerpt = (value) => {
    const text = String(value == null ? '' : value);
    return text.length <= HEAD_CHARS + TAIL_CHARS ? text : `${text.slice(0, HEAD_CHARS)}\n…\n${text.slice(-TAIL_CHARS)}`;
  };

  const buildPrompt = (text) => `Ты читаешь текст, который человек получил перед решением. Определи, есть ли в нём итоговый вывод проверяющего о проверенном документе.
pass — вывод: документ можно принимать, препятствий нет, допустимы мелкие локальные правки;
rework — вывод: документ надо вернуть на доработку, есть обязательные исправления или проверки до использования;
none — итогового вывода проверяющего нет: это сам документ, план или ответ на задачу, а не отзыв.
В quote приведи дословную фразу из текста до 200 символов, на которой основан вывод. Для none — пустая строка.
Текст:
${excerpt(text)}
Ответь JSON.`;

  const buildRequest = (text) => ({
    model: MODEL,
    stream: false,
    think: false,
    keep_alive: '10m',
    messages: [{ role: 'user', content: buildPrompt(text) }],
    format: {
      type: 'object',
      properties: { label: { type: 'string', enum: LABELS.slice() }, quote: { type: 'string' } },
      required: ['label', 'quote']
    },
    options: { temperature: 0, num_ctx: 16384, num_predict: 160 }
  });

  // Text collected from a site can lose spaces and line breaks between lines: the quote is compared by letters and digits only.
  const squeeze = (value) => String(value == null ? '' : value).replace(/[\s\p{P}]+/gu, '').toLowerCase();

  // The checked reply of the model, or null when it gives nothing the owner can rely on.
  const parseReply = (raw, text) => {
    let reply;
    try { reply = JSON.parse(raw); } catch (_) { return null; }
    if (!reply || !ADVICE[reply.label]) return null;
    const quote = String(reply.quote == null ? '' : reply.quote).trim().replace(/^[«"„]+|[»"“]+$/g, '').trim();
    if (quote.length < MIN_QUOTE_CHARS || !squeeze(text).includes(squeeze(quote))) return null;
    return { label: reply.label, quote };
  };

  // Ollama refuses the origin of an extension. The rule lets through the requests of this extension only, not of the pages.
  const allowOwnOrigin = async () => {
    await root.chrome.declarativeNetRequest.updateSessionRules({
      removeRuleIds: [RULE_ID],
      addRules: [{
        id: RULE_ID,
        priority: 1,
        action: { type: 'modifyHeaders', requestHeaders: [{ header: 'origin', operation: 'set', value: ENDPOINT }] },
        condition: { urlFilter: `|${ENDPOINT}/`, initiatorDomains: [root.chrome.runtime.id], resourceTypes: ['xmlhttprequest'] }
      }]
    });
  };

  const withTimeout = (signal) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    const abort = () => controller.abort();
    if (signal) {
      if (signal.aborted) controller.abort();
      else signal.addEventListener('abort', abort, { once: true });
    }
    return { signal: controller.signal, done: () => { clearTimeout(timer); if (signal) signal.removeEventListener('abort', abort); } };
  };

  // Never throws: without the service the owner window simply has no hint.
  const suggest = async (text, { signal = null, fetchImpl = (...args) => root.fetch(...args) } = {}) => {
    const limit = withTimeout(signal);
    try {
      const response = await fetchImpl(`${ENDPOINT}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildRequest(text)),
        signal: limit.signal
      });
      if (!response.ok) return null;
      const body = await response.json();
      return parseReply(body?.message?.content, text);
    } catch (_) {
      return null;
    } finally {
      limit.done();
    }
  };

  const hintLine = (source, suggestion) => `${source ? `${source}: ` : ''}${ADVICE[suggestion.label]}. Основание: «${suggestion.quote}»`;

  // The lines of the hint for the input items of an owner step, one model request at a time.
  const ownerHint = async (input, { signal = null, fetchImpl, prepare = allowOwnOrigin } = {}) => {
    const items = (Array.isArray(input) ? input : [])
      .filter((item) => !item?.file && String(item?.text ?? '').trim().length >= MIN_ITEM_CHARS)
      .slice(0, MAX_ITEMS);
    if (!items.length) return [];
    try { await prepare(); } catch (_) { return []; }
    const lines = [];
    for (const item of items) {
      if (signal?.aborted) break;
      const suggestion = await suggest(item.text, { signal, fetchImpl });
      if (suggestion) lines.push(hintLine(item.label || item.participant || item.step || '', suggestion));
    }
    return lines;
  };

  const api = Object.freeze({ MODEL, ENDPOINT, buildPrompt, buildRequest, parseReply, suggest, ownerHint, hintLine, allowOwnOrigin });
  root.LocalModel = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
