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
  const STATE_KEY = 'localModelState';
  const CONTEXT_CHARS = 12000;
  const CHAT_TURNS = 20;
  const HINT_INSTRUCTIONS = 10;
  const LOG_LIMIT = 200;
  const LOG_LABELS = Object.freeze({
    service_off: 'Сервис недоступен',
    model_missing: 'Модель не установлена',
    http_error: 'Ошибка сервиса',
    timeout: 'Модель не успела ответить',
    bad_reply: 'Ответ не в нужном формате',
    quote_rejected: 'Цитаты нет в тексте',
    rule_failed: 'Не удалось открыть доступ к сервису',
    file_rejected: 'Файл не принят'
  });

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

  const storage = () => root.chrome?.storage?.local || null;
  const emptyState = () => ({ system: '', files: [], chat: [], log: [] });

  const loadState = async () => {
    const area = storage();
    if (!area) return emptyState();
    const data = await area.get(STATE_KEY);
    return { ...emptyState(), ...(data?.[STATE_KEY] || {}) };
  };

  // Writes go one after another: a hint and the tab can write at the same moment.
  let writes = Promise.resolve();
  const updateState = (change) => {
    writes = writes.catch(() => {}).then(async () => {
      const area = storage();
      if (!area) return emptyState();
      const current = await loadState();
      const next = { ...current, ...change(current) };
      await area.set({ [STATE_KEY]: next });
      return next;
    });
    return writes;
  };

  const addLog = (kind, detail = '') => updateState((state) => ({
    log: [{ at: Date.now(), kind, detail: String(detail).slice(0, 400) }, ...state.log].slice(0, LOG_LIMIT)
  })).catch(() => {});

  // What the owner told the model: the instruction, the files and, for a hint, the owner's chat messages.
  const contextOf = (state, { withChat = false } = {}) => {
    const parts = [];
    if (String(state.system || '').trim()) parts.push(String(state.system).trim());
    (state.files || []).forEach((file) => parts.push(`Файл «${file.name}»:\n${file.text}`));
    if (withChat) {
      const said = (state.chat || []).filter((turn) => turn.role === 'user').slice(-HINT_INSTRUCTIONS).map((turn) => `- ${turn.content}`);
      if (said.length) parts.push(`Дополнительные указания пользователя:\n${said.join('\n')}`);
    }
    return parts.join('\n\n').slice(0, CONTEXT_CHARS);
  };

  const buildRequest = (text, context = '') => ({
    model: MODEL,
    stream: false,
    think: false,
    keep_alive: '10m',
    messages: [...(context ? [{ role: 'system', content: context }] : []), { role: 'user', content: buildPrompt(text) }],
    format: {
      type: 'object',
      properties: { label: { type: 'string', enum: LABELS.slice() }, quote: { type: 'string' } },
      required: ['label', 'quote']
    },
    options: { temperature: 0, num_ctx: 16384, num_predict: 160 }
  });

  const buildChatRequest = (history, context = '') => ({
    model: MODEL,
    stream: false,
    think: false,
    keep_alive: '10m',
    messages: [...(context ? [{ role: 'system', content: context }] : []), ...history.slice(-CHAT_TURNS).map(({ role, content }) => ({ role, content }))],
    options: { temperature: 0.3, num_ctx: 16384, num_predict: 1200 }
  });

  // Text collected from a site can lose spaces and line breaks between lines: the quote is compared by letters and digits only.
  const squeeze = (value) => String(value == null ? '' : value).replace(/[\s\p{P}]+/gu, '').toLowerCase();

  // A reply of the model: a suggestion, a problem for the log, or neither (the text has no conclusion of a reviewer).
  const reviewReply = (raw, text) => {
    let reply;
    try { reply = JSON.parse(raw); } catch (_) { return { problem: { kind: 'bad_reply', detail: String(raw ?? '').slice(0, 200) } }; }
    if (reply?.label === 'none') return {};
    if (!reply || !ADVICE[reply.label]) return { problem: { kind: 'bad_reply', detail: String(raw ?? '').slice(0, 200) } };
    const quote = String(reply.quote == null ? '' : reply.quote).trim().replace(/^[«"„]+|[»"“]+$/g, '').trim();
    // A model shortens a long quote with an ellipsis: every part around it must be in the text.
    const parts = quote.split(/\.{3,}|…/).map(squeeze).filter(Boolean);
    const source = squeeze(text);
    if (quote.length < MIN_QUOTE_CHARS || !parts.length || !parts.every((part) => source.includes(part))) {
      return { problem: { kind: 'quote_rejected', detail: quote.slice(0, 200) } };
    }
    return { suggestion: { label: reply.label, quote } };
  };

  // The checked reply of the model, or null when it gives nothing the owner can rely on.
  const parseReply = (raw, text) => reviewReply(raw, text).suggestion || null;

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
    const state = { signal: controller.signal, timedOut: false };
    const timer = setTimeout(() => { state.timedOut = true; controller.abort(); }, TIMEOUT_MS);
    const abort = () => controller.abort();
    if (signal) {
      if (signal.aborted) controller.abort();
      else signal.addEventListener('abort', abort, { once: true });
    }
    state.done = () => { clearTimeout(timer); if (signal) signal.removeEventListener('abort', abort); };
    return state;
  };

  // A request to the service. Gives the text of the reply or a problem; a request cancelled by the owner is neither.
  const post = async (body, { signal, fetchImpl = (...args) => root.fetch(...args) }) => {
    const limit = withTimeout(signal);
    try {
      const response = await fetchImpl(`${ENDPOINT}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: limit.signal
      });
      if (response.status === 404) return { problem: { kind: 'model_missing', detail: MODEL } };
      if (!response.ok) return { problem: { kind: 'http_error', detail: `HTTP ${response.status}` } };
      const data = await response.json();
      return { content: data?.message?.content };
    } catch (error) {
      if (limit.timedOut) return { problem: { kind: 'timeout', detail: `${TIMEOUT_MS / 1000} с` } };
      if (signal?.aborted) return {};
      return { problem: { kind: 'service_off', detail: ENDPOINT } };
    } finally {
      limit.done();
    }
  };

  // Never throws: without the service the owner window simply has no hint. What went wrong goes to the log of the Local LLM tab.
  const suggest = async (text, { signal = null, fetchImpl, context = '', log = addLog } = {}) => {
    const answer = await post(buildRequest(text, context), { signal, fetchImpl });
    if (answer.problem) { log(answer.problem.kind, answer.problem.detail); return null; }
    if (answer.content === undefined) return null;
    const result = reviewReply(answer.content, text);
    if (result.problem) log(result.problem.kind, result.problem.detail);
    return result.suggestion || null;
  };

  // One turn of the chat of the Local LLM tab: the history ends with the owner's message.
  const chat = async (history, { signal = null, fetchImpl, context = '', log = addLog, prepare = allowOwnOrigin } = {}) => {
    try { await prepare(); } catch (error) { log('rule_failed', error?.message || ''); return { ok: false, error: LOG_LABELS.rule_failed }; }
    const answer = await post(buildChatRequest(history, context), { signal, fetchImpl });
    if (answer.problem) { log(answer.problem.kind, answer.problem.detail); return { ok: false, error: LOG_LABELS[answer.problem.kind] }; }
    if (answer.content === undefined) return { ok: false, error: '' };
    return { ok: true, text: String(answer.content) };
  };

  const hintLine = (source, suggestion) => `${source ? `${source}: ` : ''}${ADVICE[suggestion.label]}. Основание: «${suggestion.quote}»`;

  // The lines of the hint for the input items of an owner step, one model request at a time.
  const ownerHint = async (input, { signal = null, fetchImpl, prepare = allowOwnOrigin, log = addLog } = {}) => {
    const items = (Array.isArray(input) ? input : [])
      .filter((item) => !item?.file && String(item?.text ?? '').trim().length >= MIN_ITEM_CHARS)
      .slice(0, MAX_ITEMS);
    if (!items.length) return [];
    try { await prepare(); } catch (error) { log('rule_failed', error?.message || ''); return []; }
    let context = '';
    try { context = contextOf(await loadState(), { withChat: true }); } catch (_) { /* the hint goes without the owner's context */ }
    const lines = [];
    for (const item of items) {
      if (signal?.aborted) break;
      const suggestion = await suggest(item.text, { signal, fetchImpl, context, log });
      if (suggestion) lines.push(hintLine(item.label || item.participant || item.step || '', suggestion));
    }
    return lines;
  };

  const api = Object.freeze({ MODEL, ENDPOINT, STATE_KEY, LOG_LABELS, buildPrompt, buildRequest, buildChatRequest, parseReply, reviewReply, suggest, chat, ownerHint, hintLine, allowOwnOrigin, loadState, updateState, addLog, contextOf });
  root.LocalModel = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
