// shared/message-delivery-diagnosis.js
// Turns the delivery journal into per-message timelines, per-batch outcomes, a per-model
// matrix and plain-language problems with a next step. Pure functions (used by the telemetry
// Automation tab and its report).
(function initMessageDeliveryDiagnosis(root) {
  'use strict';

  const Contract = root.TransportContract
    || globalThis.TransportContract
    || (typeof require === 'function' ? require('./transport-contract.js') : null);

  const TEXT = {
    no_tab: ['Вкладка модели не открылась или не получила запрос', 'Фон не сообщил ни о вкладке, ни об отправке, ни о статусе, ни о тексте ответа.', 'Откройте сайт модели вручную: проверьте вход в аккаунт и не блокирует ли браузер новые вкладки.'],
    not_submitted: ['Промпт не был отправлен', 'Фон начинал отправку, но отправка на странице модели не подтвердилась.', 'Причина указана в строке; откройте вкладку модели: поле ввода, модальные окна, вход в аккаунт.'],
    no_answer: ['Запрос отправлен, ответа нет', 'Промпт отправлен, но завершённого ответа модель не дала.', 'Откройте вкладку модели: капча, лимит сообщений, выбранная модель.'],
    empty: ['Модель завершила работу с пустым ответом', 'Фон сообщил о завершении, но текста ответа нет.', 'Откройте вкладку модели и посмотрите, что на странице; отправьте сообщение ещё раз.'],
    partial: ['Ответ неполный', 'Текст получен, но генерация не завершилась (таймаут или обрыв) — ответ может быть обрезан.', 'Проверьте конец ответа во вкладке модели; при необходимости повторите этап.'],
    no_token: ['Ответ без метки доставки', 'Текст получен, но модель не повторила метку — нельзя доказать, что это ответ на этот запрос.', 'Ответ показан с пометкой. Если повторяется у одной модели — она игнорирует инструкцию.'],
    error: ['Завершение с ошибкой', 'Фон сообщил об ошибке при получении ответа.', 'Причина указана в строке; проверьте вкладку модели.'],
    cancelled: ['Запрос отменён', 'Запуск остановлен или отменён до получения ответа.', ''],
    identity: ['Ответ отклонён по принадлежности', 'Пришёл ответ, который не относится ни к одному ожидаемому запросу (чужой или прежний запрос, без идентификатора, повтор после финала).', 'Если повторяется — вкладка модели показывает ответ на другой запрос; проверьте, что в ней открыт нужный диалог.'],
    stale: ['Отброшен устаревший ответ', 'Пришёл ответ с меткой другого запроса (остался на странице модели).', 'Ничего делать не нужно: он не попал в ленту.'],
    stop_unconfirmed: ['Генерация у провайдера не остановлена', 'При отмене кнопка остановки не найдена или генерация не прекратилась.', 'Остановите генерацию во вкладке модели вручную перед следующим запуском.'],
    start_refused: ['Старт пакета откладывался', 'Фон отклонял старт: шли раунды предыдущего пакета или вкладка ещё генерировала.', 'Ничего делать не нужно, если пакет затем стартовал.'],
    start_rejected: ['Пакет не стартовал', 'Фон отказал в старте, панель завершила пакет без отправки.', 'Причина указана в строке; остановите предыдущий запуск или дождитесь окончания генерации.'],
    premature_terminal: ['Запрос закрыт раньше, чем модель ответила', 'Фон зафиксировал финал без текста, но модель продолжила отвечать — ответ потерян для пайплайна.', 'Причина финала указана в строке (протокол завершения, навигация вкладки). Это дефект транспорта: приложите JSON-отчёт.'],
    batch_timeout: ['Пакет завершён по таймауту', 'Не все модели ответили до срока ожидания панели.', 'Модели без ответа указаны в строке; проверьте их вкладки.'],
    waiting: ['Ответ ещё не получен', 'Запрос подготовлен, ожидается ответ.', '']
  };
  const SEVERITY = {
    no_tab: 'critical', not_submitted: 'critical', premature_terminal: 'critical', no_answer: 'critical', empty: 'critical', start_rejected: 'critical', batch_timeout: 'critical',
    partial: 'warning', error: 'warning', no_token: 'warning', identity: 'warning', stop_unconfirmed: 'warning',
    cancelled: 'info', stale: 'info', start_refused: 'info', waiting: 'info'
  };
  const RESULTS = ['delivered', 'partial', 'no_token', 'empty', 'no_answer', 'not_submitted', 'no_tab', 'error', 'cancelled', 'waiting'];
  const TERMINAL_KINDS = ['verified', 'missing_token', 'empty_answer', 'no_answer', 'cancelled'];

  function completionOf(event) {
    if (event.completion) return event.completion;
    // Journals written before 2.81.507 have no completion: derive it from the status.
    if (!Contract?.classifyCompletion) return null;
    return Contract.classifyCompletion(event.status || 'SUCCESS', event.chars ? 'x' : '');
  }

  function sends(journal) {
    const out = [];
    const byToken = new Map();
    const byRequest = new Map();
    (journal || []).forEach((event) => {
      // 'prepared' opens a request ('sent' in journals written before 2.81.503).
      if (event.kind === 'prepared' || event.kind === 'sent') {
        const send = {
          model: event.model, token: event.token, requestId: event.requestId || null, batchId: event.batchId || '', at: event.at, chars: event.chars,
          tab: null, statuses: [], firstTextMs: null, terminal: null, stale: 0,
          dispatch: [], dispatchIds: [], submittedMs: null, rejections: [], revisions: 0, providerStop: null,
          completionTerminals: [], navigations: [], lateText: null
        };
        byToken.set(event.token, send);
        if (send.requestId) byRequest.set(send.requestId, send);
        out.push(send);
        return;
      }
      const send = (event.requestId && byRequest.get(event.requestId)) || (event.token && byToken.get(event.token)) || null;
      // batch_start follows 'prepared': it links the requests to their batch.
      if (event.kind === 'batch_start' && event.requestIds) {
        Object.values(event.requestIds).forEach((id) => { const linked = byRequest.get(id); if (linked && !linked.batchId) linked.batchId = event.batchId || ''; });
        return;
      }
      if (!send) return;
      if (event.kind === 'tab') send.tab = event.tabId;
      else if (event.kind === 'status') send.statuses.push(event.status);
      else if (event.kind === 'first_text') send.firstTextMs = event.ms;
      else if (event.kind === 'stale_dropped') send.stale += 1;
      else if (event.kind === 'revision') send.revisions += 1;
      else if (event.kind === 'identity_rejected') send.rejections.push(event);
      else if (event.kind === 'provider_stop') send.providerStop = event;
      else if (event.kind === 'completion_terminal') send.completionTerminals.push({ status: event.status, reason: event.reason, ms: event.ms });
      else if (event.kind === 'navigation') send.navigations.push({ from: event.from, to: event.to, reason: event.reason, ms: event.ms });
      else if (event.kind === 'late_text') send.lateText = { chars: event.chars, ms: event.ms };
      else if (event.kind === 'dispatch') {
        const last = send.dispatch[send.dispatch.length - 1];
        if (last && last.phase === event.phase && last.dispatchId === event.dispatchId && last.ms === event.ms) return;
        send.dispatch.push({ phase: event.phase, dispatchId: event.dispatchId, reason: event.reason, ms: event.ms, attempt: event.attempt, dispatchReason: event.dispatchReason });
        if (event.dispatchId && !send.dispatchIds.includes(event.dispatchId)) send.dispatchIds.push(event.dispatchId);
        if (event.tabId != null && send.tab == null) send.tab = event.tabId;
        if (event.phase === 'submitted' && send.submittedMs == null) send.submittedMs = event.ms;
      } else if (TERMINAL_KINDS.includes(event.kind)) send.terminal = event;
    });
    out.forEach((send) => {
      send.result = resultOf(send);
      send.prematureTerminal = isPrematureTerminal(send);
    });
    return out;
  }

  // An empty/failed terminal followed by answer text of the same request.
  function isPrematureTerminal(send) {
    const t = send.terminal;
    if (!t || !['empty_answer', 'no_answer'].includes(t.kind)) return false;
    if (send.lateText) return true;
    return send.firstTextMs != null && t.ms != null && send.firstTextMs > t.ms;
  }

  function terminalCause(send) {
    const completion = send.completionTerminals[send.completionTerminals.length - 1];
    const navigation = send.navigations[send.navigations.length - 1];
    return [
      send.terminal?.detail || null,
      completion ? `протокол завершения: ${completion.status}${completion.reason ? ` (${completion.reason})` : ''}` : null,
      navigation ? `навигация ${navigation.from} → ${navigation.to}` : null
    ].filter(Boolean).join(' · ');
  }

  function lastBlockReason(send) {
    const blocked = send.dispatch.filter((d) => ['blocked', 'command_not_delivered', 'submit_unconfirmed'].includes(d.phase));
    if (!blocked.length) return '';
    const last = blocked[blocked.length - 1];
    return last.reason || last.phase;
  }

  function resultOf(send) {
    const t = send.terminal;
    if (!t) return 'waiting';
    if (t.kind === 'cancelled') return 'cancelled';
    const seen = send.tab != null || send.statuses.length || send.firstTextMs != null || send.dispatch.length;
    if (t.kind === 'verified' || (t.kind === 'missing_token' && t.chars)) {
      // A failure status with text (e.g. an error page captured as the answer) is an error;
      // an incomplete generation (timeout, cut stream) is partial.
      if ((Contract?.FAILED_STATUSES || []).includes(String(t.status || '').toUpperCase())) return 'error';
      const completion = completionOf(t);
      if (completion === 'partial') return 'partial';
      if (completion === 'failed' || completion === 'cancelled') return 'error';
      return t.kind === 'verified' ? 'delivered' : 'no_token';
    }
    const emptyText = t.kind === 'empty_answer' || (t.kind === 'missing_token' && t.chars === 0); // older journals
    if (emptyText) return seen ? 'empty' : 'no_tab';
    if (!seen) return 'no_tab';
    if (send.dispatch.length && send.submittedMs == null && send.firstTextMs == null) return 'not_submitted';
    return 'no_answer';
  }

  function batches(journal) {
    const map = new Map();
    const get = (event) => {
      const key = event.waitId || event.batchId || '';
      if (!map.has(key)) map.set(key, { waitId: event.waitId || null, batchId: event.batchId || '', at: event.at, models: [], refusals: [], accepted: null, outcome: null });
      return map.get(key);
    };
    (journal || []).forEach((event) => {
      if (event.kind === 'batch_start') {
        Object.assign(get(event), {
          at: event.at, models: event.models || [], requestIds: event.requestIds || {}, timeoutMs: event.timeoutMs ?? null,
          stageId: event.stageId || null, stageAttemptId: event.stageAttemptId || null, pipelineRunId: event.pipelineRunId || null,
          generationProfile: event.generationProfile || null, judge: event.judge === true, manual: event.manual === true
        });
      } else if (event.kind === 'start_refused') {
        get(event).refusals.push({ at: event.at, attempt: event.attempt, errorCode: event.errorCode, reason: event.reason, blockingModel: event.blockingModel, waitedMs: event.waitedMs });
      } else if (event.kind === 'start_accepted' || event.kind === 'start_unconfirmed') {
        get(event).accepted = { status: event.status, waitedMs: event.waitedMs, confirmed: event.kind === 'start_accepted' };
      } else if (event.kind === 'batch_end') {
        Object.assign(get(event), {
          outcome: event.outcome, durationMs: event.durationMs ?? null, reason: event.reason || '', errorCode: event.errorCode || null,
          missing: event.missing || [], failed: event.failed || {}, completion: event.completion || {}
        });
      }
    });
    return [...map.values()];
  }

  function unattachedRejections(journal, list) {
    const known = new Set(list.map((send) => send.requestId).filter(Boolean));
    return (journal || []).filter((event) => event.kind === 'identity_rejected' && !(event.requestId && known.has(event.requestId)));
  }

  function problems(list, batchList = [], orphanRejections = []) {
    const out = [];
    const make = (code, base, extra = {}) => ({
      code, severity: SEVERITY[code], model: base.model || null, at: base.at, batchId: base.batchId || '',
      title: `${base.model ? `${base.model}: ` : ''}${TEXT[code][0]}`, detail: TEXT[code][1], hint: TEXT[code][2], ...extra
    });
    list.forEach((send) => {
      if (send.prematureTerminal) {
        out.push(make('premature_terminal', send, {
          reason: [send.terminal?.status, terminalCause(send), send.lateText ? `текст ${send.lateText.chars} симв. через ${Math.round(send.lateText.ms / 1000)} с` : null].filter(Boolean).join(' · ')
        }));
      } else if (send.result !== 'delivered') {
        const reason = [
          send.terminal?.status, send.terminal?.reason, terminalCause(send),
          send.result === 'not_submitted' || send.result === 'no_tab' ? lastBlockReason(send) : ''
        ].filter(Boolean).join(' · ');
        out.push(make(send.result, send, reason ? { reason } : {}));
      }
      if (send.stale) out.push(make('stale', send, { count: send.stale }));
      if (send.rejections.length) {
        out.push(make('identity', send, { count: send.rejections.length, reason: [...new Set(send.rejections.map((r) => r.reason))].join(', ') }));
      }
      if (send.providerStop && !send.providerStop.stopped && send.providerStop.reason !== 'no_stop_control') {
        out.push(make('stop_unconfirmed', send, { reason: send.providerStop.reason }));
      }
    });
    orphanRejections.forEach((event) => out.push(make('identity', event, { reason: event.reason, count: 1 })));
    batchList.forEach((batch) => {
      const base = { at: batch.at, batchId: batch.batchId };
      if (batch.outcome === 'rejected') out.push(make('start_rejected', base, { reason: [batch.errorCode, batch.reason].filter(Boolean).join(' · ') }));
      else if (batch.refusals.length) {
        const last = batch.refusals[batch.refusals.length - 1];
        out.push(make('start_refused', base, { count: batch.refusals.length, reason: [last.reason, last.blockingModel].filter(Boolean).join(' · ') }));
      }
      if (batch.outcome === 'timeout') out.push(make('batch_timeout', base, { reason: (batch.missing || []).join(', ') }));
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
      const row = rows.get(send.model) || {
        model: send.model, sent: 0, stale: 0, rejected: 0, premature: 0, times: [], submitTimes: [],
        ...Object.fromEntries(RESULTS.map((result) => [result, 0]))
      };
      row.sent += 1;
      row[send.result] += 1;
      row.stale += send.stale;
      row.rejected += send.rejections.length;
      if (send.prematureTerminal) row.premature += 1;
      if (['delivered', 'no_token', 'partial'].includes(send.result) && send.terminal?.ms != null) row.times.push(send.terminal.ms);
      if (send.submittedMs != null) row.submitTimes.push(send.submittedMs);
      rows.set(send.model, row);
    });
    return [...rows.values()].map((row) => ({ ...row, medianMs: median(row.times), medianSubmitMs: median(row.submitTimes) }));
  }

  function diagnose(journal) {
    const list = sends(journal);
    const batchList = batches(journal);
    const orphans = unattachedRejections(journal, list);
    return { sends: list, batches: batchList, rejections: orphans, problems: problems(list, batchList, orphans), matrix: matrix(list) };
  }

  const api = Object.freeze({ diagnose, sends, batches, problems, matrix, TEXT, RESULTS });
  root.MessageDeliveryDiagnosis = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
