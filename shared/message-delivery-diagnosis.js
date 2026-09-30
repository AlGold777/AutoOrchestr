// shared/message-delivery-diagnosis.js
// Turns the delivery journal into per-message timelines, a per-model matrix and plain-language
// problems with a next step. Pure functions (used by the telemetry Automation tab and its report).
(function initMessageDeliveryDiagnosis(root) {
  'use strict';

  const TEXT = {
    no_tab: ['Вкладка модели не открылась или не получила запрос', 'Фон не сообщил ни о вкладке, ни о статусе, ни о тексте ответа.', 'Откройте сайт модели вручную: проверьте вход в аккаунт и не блокирует ли браузер новые вкладки.'],
    no_answer: ['Запрос отправлен, ответа нет', 'Вкладка была, но завершённого ответа модель не дала.', 'Откройте вкладку модели: вход в аккаунт, капча, лимит сообщений, выбранная модель.'],
    empty: ['Модель завершила работу с пустым ответом', 'Фон сообщил о завершении, но текста ответа нет.', 'Откройте вкладку модели и посмотрите, что на странице; отправьте сообщение ещё раз.'],
    no_token: ['Ответ без метки доставки', 'Текст получен, но модель не повторила метку — нельзя доказать, что это ответ на этот запрос.', 'Ответ показан с пометкой. Если повторяется у одной модели — она игнорирует инструкцию.'],
    stale: ['Отброшен устаревший ответ', 'Пришёл ответ с меткой другого запроса (остался на странице модели).', 'Ничего делать не нужно: он не попал в ленту.'],
    error: ['Завершение с ошибкой', 'Фон сообщил об ошибке при получении ответа.', 'Причина указана в строке; проверьте вкладку модели.'],
    waiting: ['Ответ ещё не получен', 'Запрос отправлен, ожидается ответ.', '']
  };
  const SEVERITY = { no_tab: 'critical', no_answer: 'critical', empty: 'critical', error: 'warning', no_token: 'warning', stale: 'info', waiting: 'info' };
  const OK_STATUS = new Set(['', 'SUCCESS', 'DONE', 'FINAL', 'COPY_SUCCESS', 'PARTIAL', 'STREAM_TIMEOUT_HIDDEN']);

  function sends(journal) {
    const out = [];
    const open = new Map();
    (journal || []).forEach((event) => {
      // 'prepared' opens a request ('sent' in journals written before 2.81.503).
      if (event.kind === 'prepared' || event.kind === 'sent') {
        const send = { model: event.model, token: event.token, batchId: event.batchId || '', at: event.at, chars: event.chars, tab: null, statuses: [], firstTextMs: null, terminal: null, stale: 0 };
        open.set(event.token, send);
        out.push(send);
        return;
      }
      const send = open.get(event.token);
      if (!send) return;
      if (event.kind === 'tab') send.tab = event.tabId;
      else if (event.kind === 'status') send.statuses.push(event.status);
      else if (event.kind === 'first_text') send.firstTextMs = event.ms;
      else if (event.kind === 'stale_dropped') send.stale += 1;
      else if (['verified', 'missing_token', 'empty_answer', 'no_answer'].includes(event.kind)) send.terminal = event;
    });
    out.forEach((send) => { send.result = resultOf(send); });
    return out;
  }

  function resultOf(send) {
    const t = send.terminal;
    if (!t) return 'waiting';
    const seen = send.tab != null || send.statuses.length || send.firstTextMs != null;
    if (t.kind === 'verified') return OK_STATUS.has(String(t.status || '').toUpperCase()) ? 'delivered' : 'error';
    const emptyText = t.kind === 'empty_answer' || (t.kind === 'missing_token' && t.chars === 0); // older journals
    if (emptyText) return seen ? 'empty' : 'no_tab';
    if (t.kind === 'missing_token') return 'no_token';
    return seen ? 'no_answer' : 'no_tab';
  }

  function problems(list) {
    const out = [];
    list.forEach((send) => {
      const push = (code, extra = {}) => out.push({ code, severity: SEVERITY[code], model: send.model, at: send.at, batchId: send.batchId, title: `${send.model}: ${TEXT[code][0]}`, detail: TEXT[code][1], hint: TEXT[code][2], ...extra });
      if (send.result !== 'delivered') {
        const reason = send.terminal ? [send.terminal.status, send.terminal.reason].filter(Boolean).join(' · ') : '';
        push(send.result, reason ? { reason } : {});
      }
      if (send.stale) push('stale', { count: send.stale });
    });
    const order = { critical: 0, warning: 1, info: 2 };
    return out.sort((a, b) => order[a.severity] - order[b.severity] || String(b.at).localeCompare(String(a.at)));
  }

  const median = (values) => {
    if (!values.length) return null;
    const sorted = values.slice().sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)];
  };

  function matrix(list) {
    const rows = new Map();
    list.forEach((send) => {
      const row = rows.get(send.model) || { model: send.model, sent: 0, delivered: 0, no_token: 0, empty: 0, no_answer: 0, no_tab: 0, error: 0, waiting: 0, stale: 0, times: [] };
      row.sent += 1;
      row[send.result] += 1;
      row.stale += send.stale;
      if (send.result === 'delivered' && send.terminal?.ms != null) row.times.push(send.terminal.ms);
      rows.set(send.model, row);
    });
    return [...rows.values()].map((row) => ({ ...row, medianMs: median(row.times) }));
  }

  function diagnose(journal) {
    const list = sends(journal);
    return { sends: list, problems: problems(list), matrix: matrix(list) };
  }

  const api = Object.freeze({ diagnose, sends, problems, matrix, TEXT });
  root.MessageDeliveryDiagnosis = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
