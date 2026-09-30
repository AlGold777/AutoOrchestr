// Automation Lab — diagnosis of a project from its persisted journal.
// Pure functions over engine.getState(): the lab page, the Automation tab of the telemetry window
// and the "report for Claude" all use the same explanations, so what the user sees and what is
// sent for analysis never disagree.
(function initAlDiagnostics(root) {
  'use strict';

  const ERROR_TEXT = {
    FRAME_MISSING: ['Ответ без служебных маркеров', 'Модель ответила, но в тексте нет строк PAF_RESPONSE_BEGIN/END с токенами этого запроса, поэтому ответ нельзя надёжно привязать к запросу.', 'Откройте «Сырой ответ». Если там обычный текст, модель проигнорировала формат — система сама попросит исправить. Если повторяется у одной модели, уберите её из стадии.'],
    FRAME_TOKEN_MISMATCH: ['Получен устаревший ответ', 'В ответе маркеры другого запроса — это ответ на предыдущую попытку, оставшийся на странице модели.', 'Обычно исправляется следующей попыткой в новом чате.'],
    FRAME_INCOMPLETE: ['Ответ оборван', 'Есть начальный маркер, но нет закрывающего: модель не дописала ответ или упёрлась в лимит длины.', 'Проверьте вкладку модели: нет ли кнопки «Продолжить» или сообщения о лимите.'],
    FRAME_AMBIGUOUS: ['Два ответа в одном сообщении', 'Маркеры ответа встретились дважды.', 'Система запросит единственный ответ.'],
    STRUCTURE_NO_JSON: ['Внутри рамки нет JSON', 'Модель написала текст вместо JSON-объекта.', 'Автоматический ремонт попросит JSON.'],
    STRUCTURE_AMBIGUOUS_JSON: ['Несколько JSON в ответе', 'Нельзя однозначно выбрать, какой объект — ответ.', 'Автоматический ремонт попросит один объект.'],
    STRUCTURE_INVALID_JSON: ['Повреждённый JSON', 'JSON внутри рамки не разбирается (скобки, кавычки, обрезка).', 'Автоматический ремонт попросит полный повтор.'],
    SNAPSHOT_HASH_MISMATCH: ['Модель исказила хеш снимка', 'input_snapshot_hash в ответе не совпадает с отправленным — модель могла работать не с теми данными.', 'Исправляется ремонтом; если повторяется, модель не копирует значения точно.'],
    AL_STRUCT_SCHEMA: ['Нарушена схема AL-STRUCT-1', 'Структура ответа не соответствует контракту.', 'Ремонт в том же чате с перечнем ошибок.'],
    OBJECT_SCHEMA: ['Неверные поля объекта', 'Поля созданного объекта не соответствуют его схеме.', 'Ремонт в том же чате с перечнем ошибок.'],
    DUPLICATE_SOURCE_MESSAGE: ['Повтор уже принятого сообщения', 'Этот ответ уже был принят для другого вызова.', 'Будет запрошен новый ответ.'],
    TIMEOUT: ['Нет ответа за отведённое время', 'Модель не завершила ответ до таймаута.', 'Проверьте вкладку модели: вход в аккаунт, капча, лимит сообщений. Таймаут можно увеличить при создании проекта.'],
    NOT_STARTED: ['Запрос не отправлен', 'Фон расширения отказался запускать отправку.', 'Смотрите код причины.'],
    RUN_ALREADY_ACTIVE: ['Идёт другой запуск', 'Pipeline или Debate ещё выполняет свой запуск, поэтому отправка Automation отклонена.', 'Дождитесь окончания или остановите другой запуск, затем «Повторить стадию».'],
    TOS_ACK_REQUIRED: ['Не принято предупреждение об автоматизации', 'Расширение требует подтвердить условия использования.', 'Перезагрузите страницу и подтвердите окно предупреждения.'],
    CONTROLLER_RESTARTED: ['Страница перезагружалась', 'Во время ожидания ответа страница Automation Lab закрылась или перезагрузилась.', 'Нажмите «Продолжить»: уже принятые ответы сохранены, прерванные запросы будут повторены.'],
    INDEPENDENCE_UNSATISFIED: ['Мало моделей для независимой стадии', 'Стадии 2 и 5 требуют ответов минимум двух разных моделей.', 'Выберите 2–4 модели.'],
    STAGE_ATTEMPTS_EXHAUSTED: ['Стадия не прошла', 'Все попытки исчерпаны, данных для фиксации недостаточно.', 'Разберите ошибки моделей ниже; затем «Повторить стадию».'],
    VERSION_CONFLICT: ['Данные изменились во время стадии', 'Входные объекты поменялись после снимка.', 'Повторите стадию.']
  };
  const SEMANTIC_HINT = 'Содержательная ошибка ответа: система запросит новый ответ в новом чате.';

  const explain = (code, message) => {
    const known = ERROR_TEXT[code];
    if (known) return { title: known[0], detail: message ? `${known[1]} (${message})` : known[1], hint: known[2] };
    return { title: `Ошибка ${code}`, detail: message || '', hint: SEMANTIC_HINT };
  };

  const stageTitle = (spec, n) => spec?.stage?.(n)?.title || `Стадия ${n}`;

  // Groups transport events by dispatch batch (DISPATCH_SENT ... next DISPATCH_SENT).
  function batches(diag) {
    const out = [];
    let current = null;
    diag.forEach((event) => {
      if (event.source === 'transport' && event.kind === 'DISPATCH_SENT') {
        current = { start: event, events: [] };
        out.push(current);
      } else if (current && event.source === 'transport' && event.exec_id === current.start.exec_id) {
        current.events.push(event);
      }
    });
    return out;
  }

  function diagnose(state, { spec = null } = {}) {
    const { project, execs = [], calls = [], diag = [] } = state;
    const problems = [];
    const add = (severity, code, stage, model, at, override = {}) => {
      const text = explain(code, override.message);
      problems.push({ severity, code, stage: stage ?? null, model: model || null, at: at || null, ...text, ...override });
    };

    // 1. transport-level: did each requested model get a tab, text and a terminal result?
    batches(diag).forEach(({ start, events }) => {
      const rejected = events.find((event) => event.kind === 'DISPATCH_REJECTED');
      if (rejected) { add('critical', rejected.code in ERROR_TEXT ? rejected.code : 'NOT_STARTED', start.stage, null, rejected.at, { message: rejected.code }); return; }
      if (events.some((event) => event.kind === 'BACKGROUND_BUSY_TIMEOUT')) add('warning', 'RUN_ALREADY_ACTIVE', start.stage, null, start.at);
      (start.models || []).forEach((model) => {
        const own = events.filter((event) => event.model === model || (event.kind === 'TABS' && event.models?.[model]));
        const tab = own.some((event) => event.kind === 'TABS' && event.models[model]?.tab);
        const status = own.some((event) => event.kind === 'MODEL_STATUS');
        const text = own.find((event) => event.kind === 'MODEL_FIRST_TEXT');
        const terminal = own.find((event) => event.kind === 'MODEL_TERMINAL');
        const timeout = own.find((event) => event.kind === 'MODEL_TIMEOUT');
        const cancelled = events.some((event) => event.kind === 'CANCELLED' && (event.models || []).includes(model));
        if (cancelled) return;
        if (!tab && !status && !text && (timeout || terminal)) {
          add('critical', 'NO_TAB', start.stage, model, start.at, {
            title: `${model}: вкладка не открылась или не получила запрос`,
            detail: `Фон не сообщил ни о вкладке ${model}, ни о статусе, ни о тексте ответа.`,
            hint: `Откройте сайт ${model} вручную и проверьте вход в аккаунт. Убедитесь, что браузер не блокирует новые вкладки. В окне телеметрии → Telemetry смотрите события ${model}.`
          });
        } else if (!text && timeout) {
          add('critical', 'NO_ANSWER', start.stage, model, timeout.at, {
            title: `${model}: запрос отправлен, ответа нет`,
            detail: `Вкладка ${model} была, но текст ответа так и не появился за ${Math.round((timeout.timeoutMs || 0) / 1000)} с.`,
            hint: `Перейдите во вкладку ${model}: вход в аккаунт, капча, лимит сообщений, выбранная модель. Затем «Повторить стадию».`
          });
        } else if (terminal && !terminal.ok) {
          add('warning', 'TERMINAL_FAILURE', start.stage, model, terminal.at, {
            title: `${model}: транспорт завершился ошибкой ${terminal.status}`,
            detail: terminal.reason ? `Причина: ${terminal.reason}.` : 'Фон сообщил об ошибке без текста ответа.',
            hint: 'Проверьте вкладку модели; система повторит попытку в новом чате.'
          });
        }
      });
      const stale = events.filter((event) => event.kind === 'STALE_FRAME_IGNORED');
      stale.forEach((event) => add('info', 'FRAME_TOKEN_MISMATCH', start.stage, event.model, event.at));
    });

    // 2. per-attempt validation outcomes
    calls.forEach((call) => {
      call.attempts.forEach((attempt, index) => {
        if (attempt.outcome === 'ACCEPTED') {
          if (index > 0) problems.push({ severity: 'info', code: 'RECOVERED', stage: call.stage, model: call.model, at: attempt.finished_at, title: `${call.model}: принято с попытки ${index + 1}`, detail: `Предыдущие попытки: ${call.attempts.slice(0, index).map((a) => a.outcome).join(', ')}.`, hint: '' });
          return;
        }
        if (!attempt.outcome || attempt.outcome === 'INTERRUPTED') return;
        const first = (attempt.errors || [])[0];
        if (!first || first.class === 'TRANSPORT') return; // explained by the transport rules above or TIMEOUT below
        const severity = attempt.outcome === 'REPAIRABLE' ? 'warning' : 'warning';
        const text = explain(first.code, first.message);
        problems.push({ severity, code: first.code, stage: call.stage, model: call.model, at: attempt.finished_at, attempt: index + 1, ...text, title: `${call.model}: ${text.title}`, more: (attempt.errors || []).slice(1, 6).map((error) => `${error.code}: ${error.message}`) });
      });
      const last = call.attempts[call.attempts.length - 1];
      if (call.status === 'FAILED' && last) {
        const code = (last.errors || [])[0]?.code || last.outcome;
        add('critical', 'MODEL_FAILED', call.stage, call.model, last.finished_at, { title: `${call.model}: все попытки исчерпаны`, detail: `Последняя ошибка: ${code}.`, hint: call.stage && !spec?.stage?.(call.stage)?.execution?.fanout ? 'Стадия переключилась на следующую выбранную модель (если она есть).' : 'Если осталось ≥2 принятых моделей, стадия всё равно будет зафиксирована.' });
      }
    });

    // 3. stage / workflow level
    diag.filter((event) => event.kind === 'STAGE_FAILED').forEach((event) => add('critical', event.code in ERROR_TEXT ? event.code : 'STAGE_ATTEMPTS_EXHAUSTED', event.stage, null, event.at, { message: event.message }));
    diag.filter((event) => event.kind === 'CONTROLLER_RESTARTED').forEach((event) => add('info', 'CONTROLLER_RESTARTED', null, (event.interrupted || []).map((item) => item.model).join(', '), event.at));
    if (project?.workflow_state === 'WAITING_FOR_SELECTION') {
      problems.push({ severity: 'action', code: 'OWNER_DECISION', stage: project.wait?.resume_stage ? project.wait.resume_stage - 1 : null, model: null, at: project.updated_at, title: 'Ждём вашего решения', detail: 'Модели не вызываются, пока вы не ответите на вопросы в центральной колонке.', hint: 'Выберите варианты и нажмите «Применить выбор и продолжить».' });
    }
    if (project?.workflow_state === 'PAUSED') {
      problems.push({ severity: 'action', code: 'PAUSED', stage: project.next_stage, model: null, at: project.updated_at, title: 'Процесс на паузе', detail: 'Запуск остановлен или страница перезагружалась.', hint: 'Нажмите «Продолжить».' });
    }

    const order = { critical: 0, action: 1, warning: 2, info: 3 };
    problems.sort((a, b) => (order[a.severity] - order[b.severity]) || String(b.at || '').localeCompare(String(a.at || '')));

    // 4. stage plan vs actual (what the user should have seen)
    const stagesView = (spec?.pilotStages || [1, 2, 3, 4, 5]).map((n) => {
      const stage = spec?.stage?.(n);
      const fanout = stage?.execution?.fanout;
      const started = diag.filter((event) => event.kind === 'STAGE_STARTED' && event.stage === n);
      const lastStart = started[started.length - 1];
      const stageExecs = execs.filter((exec) => exec.stage === n);
      const exec = stageExecs[stageExecs.length - 1];
      const stageCalls = exec ? calls.filter((call) => exec.call_ids.includes(call.call_id)) : [];
      const models = project?.config?.models || [];
      const plannedModels = fanout ? models.slice(0, fanout.max_runs) : [project?.config?.primary || models[0]].filter(Boolean);
      return {
        stage: n,
        title: stageTitle(spec, n),
        mode: fanout ? 'FANOUT' : 'SINGLE',
        planned_models: plannedModels,
        expected_tabs: plannedModels.length,
        expectation: fanout
          ? `${plannedModels.length} ${plural(plannedModels.length, 'вкладка', 'вкладки', 'вкладок')} параллельно (${plannedModels.join(', ')}), каждая модель в новом чате`
          : `1 вкладка — основная модель ${plannedModels[0] || '—'}`,
        runs: started.length,
        status: exec?.status || 'NOT_STARTED',
        models: stageCalls.map((call) => ({ model: call.model, status: call.status, attempts: call.attempts.length, last_outcome: call.attempts[call.attempts.length - 1]?.outcome || null })),
        last_started_at: lastStart?.at || null
      };
    });

    return { problems, stages: stagesView, providers: providerMatrix(calls) };
  }

  function plural(n, one, few, many) {
    const mod10 = n % 10;
    const mod100 = n % 100;
    if (mod10 === 1 && mod100 !== 11) return one;
    if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
    return many;
  }

  function providerMatrix(calls) {
    const byModel = new Map();
    const quantile = (values, q) => {
      if (!values.length) return null;
      const sorted = values.slice().sort((a, b) => a - b);
      return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
    };
    calls.forEach((call) => {
      const row = byModel.get(call.model) || { model: call.model, calls: 0, attempts: 0, firstPass: 0, repairs: 0, repairOk: 0, accepted: 0, extractFail: 0, schemaFail: 0, hashMismatch: 0, transportFail: 0, durations: [], modes: {} };
      row.calls += 1;
      if (call.attempts[0]?.outcome === 'ACCEPTED') row.firstPass += 1;
      if (call.status === 'ACCEPTED' || call.status === 'COMMITTED') row.accepted += 1;
      call.attempts.forEach((attempt) => {
        row.attempts += 1;
        if (attempt.duration_ms != null) row.durations.push(attempt.duration_ms);
        if (attempt.extraction_mode) row.modes[attempt.extraction_mode] = (row.modes[attempt.extraction_mode] || 0) + 1;
        if (attempt.extraction_mode === 'FAILED') row.extractFail += 1;
        if (attempt.outcome === 'TRANSPORT_FAILED') row.transportFail += 1;
        if ((attempt.errors || []).some((error) => error.code === 'AL_STRUCT_SCHEMA' || error.code === 'OBJECT_SCHEMA')) row.schemaFail += 1;
        if ((attempt.errors || []).some((error) => error.code === 'SNAPSHOT_HASH_MISMATCH')) row.hashMismatch += 1;
        if (attempt.kind === 'repair') { row.repairs += 1; if (attempt.outcome === 'ACCEPTED') row.repairOk += 1; }
      });
      byModel.set(call.model, row);
    });
    return [...byModel.values()].map((row) => ({ ...row, median: quantile(row.durations, 0.5), p95: quantile(row.durations, 0.95) }));
  }

  const clip = (text, head = 3000, tail = 1500) => {
    const value = String(text || '');
    return value.length <= head + tail ? value : `${value.slice(0, head)}\n…[${value.length - head - tail} chars omitted]…\n${value.slice(-tail)}`;
  };

  // Self-contained report for analysis by Claude: diagnosis, journal, attempts with clipped raw
  // answers. Prompts are included as hash + size (they are reproducible from spec + snapshot) and
  // the first attempt's prompt of each stage in full, so the exact instructions can be reviewed.
  function buildReport(state, { spec = null, extensionVersion = null } = {}) {
    const diagnosis = diagnose(state, { spec });
    const seenStagePrompt = new Set();
    return {
      report: 'automation-lab-diagnostics',
      version: 1,
      generated_at: new Date().toISOString(),
      extension_version: extensionVersion,
      spec_version: spec?.version || null,
      user_agent: typeof navigator !== 'undefined' ? navigator.userAgent : null,
      project: { project_id: state.project.project_id, title: state.project.title, workflow_state: state.project.workflow_state, next_stage: state.project.next_stage, wait: state.project.wait, last_error: state.project.last_error, config: state.project.config, created_at: state.project.created_at },
      diagnosis,
      execs: state.execs,
      calls: state.calls.map((call) => ({
        call_id: call.call_id, stage: call.stage, model: call.model, status: call.status, failover_of: call.failover_of || null,
        attempts: call.attempts.map((attempt) => {
          const firstOfStage = !seenStagePrompt.has(call.stage) && attempt.kind !== 'repair';
          if (firstOfStage) seenStagePrompt.add(call.stage);
          return {
            attempt_id: attempt.attempt_id, kind: attempt.kind, outcome: attempt.outcome, transport_status: attempt.transport_status,
            extraction_mode: attempt.extraction_mode, duration_ms: attempt.duration_ms, errors: attempt.errors, anomalies: attempt.anomalies,
            prompt_hash: attempt.prompt_hash, prompt_chars: attempt.prompt_chars,
            prompt_text: firstOfStage || attempt.kind === 'repair' ? attempt.prompt_text : undefined,
            raw_text: clip(attempt.raw_text)
          };
        })
      })),
      journal: state.diag,
      events: state.events,
      objects: state.latest.map((entry) => ({ object_id: entry.object_id, code: entry.code, version: entry.version, status: entry.status, created_stage: entry.created_stage }))
    };
  }

  const api = Object.freeze({ diagnose, buildReport, providerMatrix, explain, ERROR_TEXT, plural });
  root.AlDiagnostics = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
