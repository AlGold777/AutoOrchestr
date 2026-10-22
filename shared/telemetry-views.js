// shared/telemetry-views.js
// Telemetry export profiles: the raw event ring cut down to what one kind of
// problem needs, so the file handed to a model is small enough to read.
// Pure functions, no storage and no DOM; used by results-devtools.js and tests.

(function initTelemetryViews(root) {
  'use strict';

  const RAW = 'raw';

  const re = (source) => new RegExp(source, 'i');

  // Every profile keeps its labels plus errors/warnings of the same file, so a
  // cause outside the list still shows up as a failure next to the symptom.
  const PROFILES = Object.freeze({
    [RAW]: {
      id: RAW,
      title: 'Raw (all events)',
      task: null
    },
    send: {
      id: 'send',
      title: 'Prompt not sent',
      types: ['DISPATCH', 'SEND', 'COMPOSER_TRANSACTION'],
      // The send phase of one dispatch is over once it was accepted: later events of
      // that dispatch (tab checks, focus, polling) belong to other questions.
      closeAfterAcceptedMs: 30000,
      task: 'Запрос не дошёл до модели или не подтверждён. Событие может не иметь dispatchId или иметь другой (ROUND0_TAB_OPENED), поэтому связывай по transportRequestId и tabId. Проследи цепочку: подготовка вкладки и поля ввода → вставка текста (PROMPT_INSERTION_*) → стадии PROVIDER_DISPATCH_STAGE_OBSERVED → способ отправки (PROVIDER_SUBMIT_METHOD_OBSERVED) → PROMPT_SUBMITTED_*. Назови первую стадию, на которой цепочка оборвалась, и что сказано в details. Если события вставки нет вовсе, так и напиши: «не зафиксировано» (не «не было»), и перечисли, какие соседние события есть.',
      labels: re('^(RUN_START|DISPATCH_|PROMPT_INSERTION|PROMPT_SUBMITTED|PROVIDER_|SEND_|COMMAND_SEND|COMPOSER|CHECK_READINESS|PAGE_READY|TAB_|ATTACH|GEMINI_CDP|QWEN_CDP|GROK_|PERPLEXITY_|HANDSHAKE|SCRIPT_(HEALTH|LOADED|REINJECT)|READY_REANNOUNCE|PRE_DISPATCH|PRE_INSERTION|PASSIVE_SEND|RECOVERY_(BLOCKED_SUBMIT|ACTION)|UNCONFIRMED_SEND|FINALIZE_BLOCKED_SUBMIT|DUPLICATE_DISPATCH|MANUAL_RESEND|ROUND\\d+_(TAB_OPENED|BIND|SIMPLE_DISPATCH|RECOVERY)|ROUND2_REPAIR_DISPATCH|BRIDGE_TOKEN|LEASE_|ACK_READY|EARLY_GESTURE|MV3_|DEBUGGER_|DONOR_|SOFT_REUSE|UNSAFE_REUSE|SENDER_|STALE_(SEND|TAB)|REUSED_TAB|BUDGET_EXHAUSTED|PING_TRANSPORT|PORT_CLOSED)')
    },
    completion: {
      id: 'completion',
      title: 'End of generation',
      types: ['LIFECYCLE'],
      task: 'Система неверно определила окончание генерации (слишком рано или слишком поздно). Для модели и dispatchId сопоставь по ts: последний признак генерации (ANSWER_GENERATING, STREAMING), признаки стабильности и завершения (ANSWER_TEXT_STABLE, ANSWER_COMPLETE_DETECTED, COMPLETION_*), решение (FINALIZATION_DECISION, MODEL_FINAL). Назови сигнал, по которому принято решение, и сколько прошло от последнего признака генерации до решения.',
      labels: re('^(RUN_START|ANSWER_(START|GENERATING|TEXT_STABLE|COMPLETE|PARTIAL|NODE|LENGTH)|LIFECYCLE|COMPLETION|COPY_COMPLETION|DETECT_DONE|STOP_DISAPPEARED|FINALIZ|MODEL_FINAL|MODEL_TERMINAL|LLM_RESPONSE|LLM_PARTIAL|ROUND4|AUTOMATION_DEADLINE|HARD_STOP|SCRIPT_RUNTIME_HARD_STOP|TERMINAL_|POST_TERMINAL|PIPELINE_COMPLETE|STATE_DIVERGENCE|STATUS_UPDATE|MODEL_RUN_TRANSITION|STATE_PROJECTION|PROMPT_SUBMITTED_ACCEPTED|STABLE_PENDING|PROVIDER_TRANSIENT_BLOCKER|streaming|finalization|stable)')
    },
    lastAnswer: {
      id: 'lastAnswer',
      title: 'Which answer is last',
      task: 'Принят не тот ответ (старый, чужой или не из текущего запроса). Для модели и dispatchId проследи: базовое состояние до отправки (DISPATCH_BASELINE_CAPTURED), отклонения устаревшего (STALE_*, *_STALE_BASELINE_*), источник и проверку принятого ответа (ANSWER_SOURCE_MATERIALIZED, ANSWER_VERIFICATION_*, ANSWER_COMMIT_EVALUATED, ANSWER_DELIVERY_*), решение (FINALIZATION_DECISION, MODEL_FINAL). Совпадает ли принятый ответ с базовым и кто его принял.',
      labels: re('^(RUN_START|DISPATCH_BASELINE|DISPATCH_START|DISPATCH_SEND|PROMPT_SUBMITTED_ACCEPTED|ANSWER_(CARD|SOURCE|EXTRACTION|COMMIT|SANITY|VERIFICATION|MATERIALIZE|DELIVERY|COMPLETE_DETECTED)|TURN_RESOLUTION|LATE_COLLECT|MATERIALIZE|SHORTER_EXTRACTION|PRESERVED_EVIDENCE|SNAPSHOT_|LIFECYCLE_(SNAPSHOT|CORRELATION)|LLM_RESPONSE|MODEL_FINAL|MODEL_TERMINAL|FINALIZ|CORRELATION|RETRY_EXTRACTION|COLLECTION|RESPONSE$|TERMINAL_|RECOVERED_FINAL|AUTOMATIC_LATE|PRECOLLECT|TRANSIENT_BLOCKER_RESPONSE|.*STALE|GEMINI_STALE|GROK_PROMPT_ECHO|SENDER_|STALE_|RECOVERY_STALE)')
    },
    truncated: {
      id: 'truncated',
      title: 'Truncated answer',
      types: ['LIFECYCLE'],
      task: 'Зафиксирован успех, а текст явно неполный. Для модели и dispatchId найди MODEL_FINAL и FINALIZATION_DECISION, причины приёма. Проверь длины и стабильность: ANSWER_LENGTH_*, ANSWER_TEXT_STABLE, ANSWER_COMPLETE_*, ANSWER_PARTIAL_ON_TIMEOUT, ANSWER_COMMIT_EVALUATED, POST_TERMINAL_*. Принят ли ответ по таймауту или по стабильности, был ли признак завершения от самой модели, рос ли текст после решения.',
      labels: re('^(RUN_START|ANSWER_(LENGTH|PARTIAL|COMPLETE|TEXT_STABLE|COMMIT|SANITY|VERIFICATION|GENERATING|NODE)|STABLE_PENDING|SHORTER|FINAL_STABILITY|FINALIZ|MODEL_FINAL|MODEL_TERMINAL|LLM_PARTIAL|LLM_RESPONSE|POST_TERMINAL|MATERIALIZE|LATE_COLLECT|PRECOLLECT|COPY|TERMINAL_|ROUND4|AUTOMATION_DEADLINE|COMPLETION|LIFECYCLE|RECOVERED_FINAL|PIPELINE_COMPLETE)')
    }
  });

  const DROP_META_KEYS = new Set([
    'telemetryTaxonomy', 'runSessionId', 'sessionId', 'traceId', 'llmName', 'platform', 'source', 'event', 'schemaVersion',
    // Repeated on almost every event of a dispatch: carry no information of their own.
    'expectedIdentity', 'incomingIdentity', 'extVersion', 'logCollection', 'requestId', 'correlationQuality', 'tabSessionId'
  ]);
  const MAX_STRING = 160;
  const MAX_ARRAY = 8;
  const MAX_DEPTH = 3;

  const shrink = (value, depth = 0) => {
    if (value == null) return value;
    if (typeof value === 'string') return value.length > MAX_STRING ? `${value.slice(0, MAX_STRING)}…(${value.length})` : value;
    if (typeof value !== 'object') return value;
    if (depth >= MAX_DEPTH) return Array.isArray(value) ? `[${value.length}]` : '{…}';
    if (Array.isArray(value)) {
      const head = value.slice(0, MAX_ARRAY).map((item) => shrink(item, depth + 1));
      return value.length > MAX_ARRAY ? head.concat(`…+${value.length - MAX_ARRAY}`) : head;
    }
    const out = {};
    Object.keys(value).forEach((key) => {
      if (depth === 0 && DROP_META_KEYS.has(key)) return;
      const next = shrink(value[key], depth + 1);
      if (next === '' || next === null || next === undefined) return;
      out[key] = next;
    });
    return out;
  };

  const eventPlatform = (event) => String(event?.platform || event?.llmName || event?.meta?.llmName || event?.meta?.platform || '');
  const eventLabel = (event) => String(event?.label || event?.meta?.event || event?.event || '');
  const isProblem = (event) => {
    const level = String(event?.level || '').toLowerCase();
    return level === 'error' || level === 'warning' || level === 'critical';
  };

  const getProfile = (id) => PROFILES[id] || PROFILES[RAW];
  const listProfiles = () => Object.values(PROFILES).map(({ id, title }) => ({ id, title }));

  // Compact event: t = ms since the first kept event, p = platform, l = label,
  // v = level (omitted when info), d = details, m = trimmed meta, n = repeats.
  const compactEvent = (event, startTs) => {
    const out = { t: Math.max(0, Number(event.ts || 0) - startTs), p: eventPlatform(event), l: eventLabel(event) };
    const type = String(event.type || '');
    if (type && type !== 'TELEMETRY' && type !== 'PIPELINE') out.y = type;
    const level = String(event.level || '').toLowerCase();
    if (level && level !== 'info') out.v = level;
    const details = event.details;
    if (details) out.d = shrink(String(typeof details === 'string' ? details : JSON.stringify(details)));
    const meta = shrink(event.meta || {});
    if (meta && Object.keys(meta).length) out.m = meta;
    return out;
  };

  // Identical neighbours (same model, label, details and meta) collapse into one
  // row with a count: polling labels such as ANSWER_GENERATING repeat hundreds of times.
  const collapseRepeats = (rows) => {
    const out = [];
    rows.forEach((row) => {
      const prev = out[out.length - 1];
      if (prev && prev.p === row.p && prev.l === row.l && prev.v === row.v && prev.d === row.d
        && JSON.stringify(prev.m) === JSON.stringify(row.m)) {
        prev.n = (prev.n || 1) + 1;
        prev.t2 = row.t;
        return;
      }
      out.push({ ...row });
    });
    return out;
  };

  const eventDispatchId = (event) => String(event?.meta?.dispatchId || event?.dispatchId || '');

  // Drops non-problem events of a dispatch that happened long after that dispatch
  // was accepted by the provider (PROMPT_SUBMITTED_ACCEPTED).
  const closeAfterAccepted = (events, windowMs) => {
    const acceptedAt = new Map();
    events.forEach((event) => {
      if (eventLabel(event) !== 'PROMPT_SUBMITTED_ACCEPTED') return;
      const key = `${eventPlatform(event)}|${eventDispatchId(event)}`;
      if (!acceptedAt.has(key)) acceptedAt.set(key, Number(event.ts || 0));
    });
    return events.filter((event) => {
      if (isProblem(event)) return true;
      const closedAt = acceptedAt.get(`${eventPlatform(event)}|${eventDispatchId(event)}`);
      return closedAt === undefined || Number(event.ts || 0) <= closedAt + windowMs;
    });
  };

  // dispatchId is kept in meta only when it changes for a model, so a chain of
  // events of one dispatch states it once.
  const dedupeDispatchId = (rows) => {
    const last = new Map();
    return rows.map((row) => {
      const id = row.m?.dispatchId;
      if (!id) return row;
      if (last.get(row.p) === id) {
        const { dispatchId, ...rest } = row.m;
        const next = { ...row };
        if (Object.keys(rest).length) next.m = rest; else delete next.m;
        return next;
      }
      last.set(row.p, id);
      return row;
    });
  };

  // Returns the events to export. For RAW the input is returned untouched.
  const buildTelemetryView = (events, profileId = RAW) => {
    const source = Array.isArray(events) ? events : [];
    const profile = getProfile(profileId);
    if (profile.id === RAW) return { profile: RAW, compact: false, events: source, sourceCount: source.length };
    const kept = source
      .filter((event) => event && (profile.labels.test(eventLabel(event))
        || (profile.types && profile.types.includes(String(event.type || '').toUpperCase()))
        || isProblem(event)))
      .sort((a, b) => (a.ts || 0) - (b.ts || 0));
    const windowed = profile.closeAfterAcceptedMs ? closeAfterAccepted(kept, profile.closeAfterAcceptedMs) : kept;
    const startTs = windowed.length ? Number(windowed[0].ts || 0) : 0;
    const rows = collapseRepeats(dedupeDispatchId(windowed.map((event) => compactEvent(event, startTs))));
    return {
      profile: profile.id,
      compact: true,
      startTs,
      events: rows,
      sourceCount: source.length,
      keptCount: windowed.length
    };
  };

  const api = Object.freeze({ RAW, PROFILES, getProfile, listProfiles, buildTelemetryView });
  root.TelemetryViews = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
