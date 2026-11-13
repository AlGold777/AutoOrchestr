// Local model hint for the owner step. A model running on this computer (Ollama) reads what the owner received and
// suggests one of two ways, with a quote it is based on. It is a hint only: the run does not depend on it, the owner decides.
// The hint is dropped when the service is off, when the text has no conclusion of a reviewer (none), and when the quote is not
// literally in the text: an invented basis is never shown.
(function initLocalModel(root) {
  'use strict';

  const MODEL = 'qwen3.5:4b-mlx';
  const ENDPOINT = 'http://127.0.0.1:11434';
  // The model the owner connected in the list on the pipeline panel. '' = without LLM: no hints and no watching of tabs.
  const MODELS = Object.freeze([
    { id: '', label: 'without LLM' },
    { id: 'qwen3.5:4b-mlx', label: 'Qwen 3.5 4B' },
    { id: 'qwen3.5:9b-mlx', label: 'Qwen 3.5 9B' }
  ]);
  const CHOICE_KEY = 'localModelChoice';
  let selected = '';
  const modelId = () => selected || MODEL;
  const enabled = () => Boolean(selected);
  const modelChoice = () => selected;
  const setModel = (id) => {
    selected = MODELS.some((item) => item.id === id) ? id : '';
    try { root.chrome?.storage?.local?.set({ [CHOICE_KEY]: selected }); } catch (_) { /* the choice lives until the page closes */ }
    return selected;
  };
  const loadChoice = async () => {
    try {
      const data = await root.chrome?.storage?.local?.get(CHOICE_KEY);
      const id = data?.[CHOICE_KEY];
      selected = MODELS.some((item) => item.id === id) ? id : '';
    } catch (_) { selected = ''; }
    return selected;
  };
  try {
    root.chrome?.storage?.onChanged?.addListener((changes, area) => {
      if (area === 'local' && changes[CHOICE_KEY]) selected = MODELS.some((item) => item.id === changes[CHOICE_KEY].newValue) ? changes[CHOICE_KEY].newValue : '';
    });
  } catch (_) { /* no storage events here */ }
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
  const LOG_LIMIT = 200;
  const LOG_LABELS = Object.freeze({
    service_off: 'Сервис недоступен',
    model_missing: 'Модель не установлена',
    http_error: 'Ошибка сервиса',
    timeout: 'Модель не успела ответить',
    bad_reply: 'Ответ не в нужном формате',
    quote_rejected: 'Цитаты нет в тексте',
    rule_failed: 'Не удалось открыть доступ к сервису',
    file_rejected: 'Файл не принят',
    observed: 'Застревание',
    observe_failed: 'Вкладка не прочитана'
  });
  const OBSERVATION_LIMIT = 40;
  const STALL_MS = 4 * 60 * 1000;
  const STALL_TICK_MS = 60 * 1000;
  const STOP_BUTTON = /^(стоп|stop|остановить)/i;
  const END_MARK = /\[\[AO-[^\]]*\]\]|КОНЕЦ-ОТВЕТА/;
  const SITUATIONS = Object.freeze({
    choose_answer: 'страница просит выбрать ответ',
    still_generating: 'модель ещё пишет ответ',
    answer_ready: 'ответ уже готов на странице',
    limit_reached: 'лимит использования',
    login_required: 'нужен вход',
    account_action: 'требуется действие с аккаунтом, оплатой или условиями',
    captcha: 'проверка на робота',
    error_message: 'страница показывает ошибку',
    empty_page: 'страница пуста или не загружена',
    unknown: 'ситуация неясна'
  });
  // These are the owner's to deal with: a button is never named for them, whatever the model answers.
  const NO_BUTTON = new Set(['limit_reached', 'login_required', 'account_action', 'captcha', 'still_generating', 'answer_ready', 'empty_page', 'unknown']);
  const FORBIDDEN_BUTTON = /(войти|вход|зарегистр|log ?in|sign ?(in|up)|оплат|купить|подпис|upgrade|subscribe|payment|обновить (план|аккаунт)|услови|соглас|принять|accept|agree|terms|удалить|delete|отправить|send)/i;

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
  const emptyState = () => ({ system: '', files: [], log: [], observations: [] });

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

  // What the owner told the model: the instruction and the files.
  const contextOf = (state) => {
    const parts = [];
    if (String(state.system || '').trim()) parts.push(String(state.system).trim());
    (state.files || []).forEach((file) => parts.push(`Файл «${file.name}»:
${file.text}`));
    return parts.join('\n\n').slice(0, CONTEXT_CHARS);
  };

  const buildRequest = (text, context = '') => ({
    model: modelId(),
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
      if (response.status === 404) return { problem: { kind: 'model_missing', detail: modelId() } };
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

  // Runs inside the tab of a model: only reads the page.
  /* istanbul ignore next */
  function readPage() {
    const seen = (node) => node.offsetParent !== null;
    const nameOf = (node) => String(node.innerText || node.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim().slice(0, 60);
    const buttons = [...new Set([...document.querySelectorAll('button,[role="button"]')].filter(seen).map(nameOf).filter(Boolean))].slice(-60);
    const dialogs = [...document.querySelectorAll('[role="dialog"],[role="alertdialog"],[role="alert"],dialog[open]')].filter(seen).map((node) => String(node.innerText || '').slice(0, 800)).slice(0, 3);
    return { url: location.href, title: document.title, hidden: document.hidden, text: String(document.body?.innerText || '').slice(-6000), dialogs, buttons };
  }

  const buildObservationPrompt = (page, reason) => `Ты смотришь на вкладку сайта чат-модели. Автоматизация застряла на этой вкладке, причина со стороны приложения: ${reason || 'не указана'}.
Определи, что видно на странице. Выбери ровно одно значение situation:
${Object.entries(SITUATIONS).map(([key, text]) => `${key} — ${text};`).join('\n')}
button — точный текст кнопки из списка, если страница ждёт нажатия, чтобы продолжить. Если нажимать нечего, пустая строка.
note — короткая дословная фраза со страницы, на которой основан вывод.
Окна на странице: ${page.dialogs?.length ? page.dialogs.join(' | ') : 'нет'}
Кнопки: ${(page.buttons || []).join(' | ')}
Конец текста страницы:
${page.text || ''}
Ответь JSON.`;

  const buildObservationRequest = (page, reason, context = '') => ({
    model: modelId(),
    stream: false,
    think: false,
    keep_alive: '10m',
    messages: [...(context ? [{ role: 'system', content: context }] : []), { role: 'user', content: buildObservationPrompt(page, reason) }],
    format: {
      type: 'object',
      properties: { situation: { type: 'string', enum: Object.keys(SITUATIONS) }, button: { type: 'string' }, note: { type: 'string' } },
      required: ['situation', 'button', 'note']
    },
    options: { temperature: 0, num_ctx: 8192, num_predict: 160 }
  });

  // The checked reply: a button is kept only if it is really on the page and pressing it is allowed. Nothing is pressed yet.
  const checkObservation = (raw, page) => {
    let reply;
    try { reply = JSON.parse(raw); } catch (_) { return null; }
    if (!reply || !SITUATIONS[reply.situation]) return null;
    const asked = String(reply.button || '').trim();
    const onPage = (page.buttons || []).find((name) => name.toLowerCase() === asked.toLowerCase()) || '';
    const button = asked && onPage && !NO_BUTTON.has(reply.situation) && !FORBIDDEN_BUTTON.test(onPage) ? onPage : '';
    const note = String(reply.note || '').trim();
    const pageText = squeeze([page.text, ...(page.dialogs || [])].join(' '));
    return { situation: reply.situation, button, note: note && pageText.includes(squeeze(note)) ? note.slice(0, 200) : '' };
  };

  const observationLine = (participant, result) => `${participant}: ${SITUATIONS[result.situation]}${result.button ? `; нажала бы «${result.button}»` : ''}${result.note ? `. «${result.note}»` : ''}`;

  // Observation only: reads the stuck tab, asks the model what it sees, keeps the picture and the verdict. Presses nothing, never throws.
  const observeTab = async ({ tabId, participant = '', reason = '' }, { scripting = root.chrome?.scripting, fetchImpl, prepare = allowOwnOrigin, log = addLog, signal = null } = {}) => {
    if (!tabId || !scripting) return null;
    let page;
    try {
      const [frame] = await scripting.executeScript({ target: { tabId }, func: readPage });
      page = frame?.result;
    } catch (error) {
      log('observe_failed', `${participant}: ${error?.message || ''}`);
      return null;
    }
    if (!page) { log('observe_failed', participant); return null; }
    try { await prepare(); } catch (error) { log('rule_failed', error?.message || ''); return null; }
    let context = '';
    try { context = String((await loadState()).system || '').trim(); } catch (_) { /* the observation goes without the instruction */ }
    const answer = await post(buildObservationRequest(page, reason, context), { signal, fetchImpl });
    if (answer.problem) { log(answer.problem.kind, answer.problem.detail); return null; }
    if (answer.content === undefined) return null;
    const result = checkObservation(answer.content, page);
    if (!result) { log('bad_reply', String(answer.content).slice(0, 200)); return null; }
    log('observed', observationLine(participant, result));
    await updateState((state) => ({
      observations: [{ at: Date.now(), participant, reason, ...result, page: { ...page, text: String(page.text).slice(-2500) } }, ...(state.observations || [])].slice(0, OBSERVATION_LIMIT)
    })).catch(() => {});
    return result;
  };

  const readTab = async (tabId, scripting = root.chrome?.scripting) => {
    const [frame] = await scripting.executeScript({ target: { tabId }, func: readPage });
    return frame?.result || null;
  };

  // Watches the tabs of the participants that have not answered yet. If a page does not change for stallMs, the model looks at it once.
  // It only reads the pages and only writes to the log: acceptance of answers and the course of the run do not depend on it.
  const createStallWatch = ({ tabOf, read = readTab, observe = observeTab, now = Date.now, stallMs = STALL_MS, intervalMs = STALL_TICK_MS, enabled = () => true } = {}) => {
    const waiting = new Map();
    let timer = null;
    let busy = false;
    const tick = async () => {
      if (busy) return;
      // Disabled: no pages are read, the count of the unchanged time starts again when it is enabled.
      if (!enabled()) {
        for (const item of waiting.values()) { item.mark = null; item.since = now(); item.observed = false; item.dialogs = undefined; item.generating = false; }
        return;
      }
      busy = true;
      try {
        for (const [participant, item] of [...waiting]) {
          const tabId = tabOf(participant);
          if (!tabId) continue;
          let page;
          try { page = await read(tabId); } catch (_) { continue; }
          if (!page || !waiting.has(participant)) continue;
          // Two things cannot wait for the stall time: a new window or warning, and a generation that stopped with no end of the answer.
          const dialogs = (page.dialogs || []).join('|');
          const generating = (page.buttons || []).some((name) => STOP_BUTTON.test(name));
          const urgent = dialogs && dialogs !== item.dialogs ? 'new_dialog'
            : item.generating && !generating && !END_MARK.test(String(page.text || '').slice(-300)) ? 'stopped_without_end' : '';
          item.dialogs = dialogs;
          item.generating = generating;
          const mark = `${squeeze(page.text)}|${(page.buttons || []).join('|')}|${dialogs}`;
          if (urgent) {
            item.mark = mark;
            item.since = now();
            item.observed = true;
            await observe({ tabId, participant, reason: urgent });
          } else if (mark !== item.mark) {
            item.mark = mark;
            item.since = now();
            item.observed = false;
          } else if (!item.observed && now() - item.since >= stallMs) {
            item.observed = true;
            await observe({ tabId, participant, reason: 'no_progress' });
          }
        }
      } finally {
        busy = false;
      }
    };
    return {
      note(entry) {
        if (!entry?.participant || (entry.phase && entry.phase !== 'answer')) return;
        if (entry.state === 'done' || entry.finishedAt) waiting.delete(entry.participant);
        else if (!waiting.has(entry.participant)) waiting.set(entry.participant, { mark: null, since: now(), observed: false });
      },
      tick,
      start() { if (!timer) timer = setInterval(tick, intervalMs); },
      stop() { if (timer) clearInterval(timer); timer = null; waiting.clear(); },
      waitingCount: () => waiting.size
    };
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
    try { context = contextOf(await loadState()); } catch (_) { /* the hint goes without the owner's context */ }
    const lines = [];
    for (const item of items) {
      if (signal?.aborted) break;
      const suggestion = await suggest(item.text, { signal, fetchImpl, context, log });
      if (suggestion) lines.push(hintLine(item.label || item.participant || item.step || '', suggestion));
    }
    return lines;
  };

  const api = Object.freeze({ MODEL, MODELS, modelId, enabled, modelChoice, CHOICE_KEY, setModel, loadChoice, ENDPOINT, STATE_KEY, LOG_LABELS, buildPrompt, buildRequest, parseReply, reviewReply, suggest, ownerHint, hintLine, allowOwnOrigin, SITUATIONS, buildObservationRequest, checkObservation, observationLine, observeTab, createStallWatch, loadState, updateState, addLog, contextOf });
  root.LocalModel = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
