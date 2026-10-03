// background/telemetry-logs.js
// Diagnostics logs + telemetry sampling helpers.

'use strict';

const PLATFORM_DEGRADED_WINDOW = 10;
const PLATFORM_DEGRADED_THRESHOLD = 0.5;
const PLATFORM_DEGRADED_COOLDOWN_MS = 15 * 60 * 1000;
const PLATFORM_DEGRADED_HOURLY_THRESHOLD = 0.7;
const PLATFORM_DEGRADED_HOURLY_COOLDOWN_MS = 60 * 60 * 1000;
const PLATFORM_HISTORY_MAX = 50;
const MAX_LOG_ENTRIES = 120;
const DIAG_KEY = '__diagnostics_events__';
const DIAGNOSTICS_EVENTS_MAX_ITEMS = 2000;
const DIAGNOSTICS_EVENTS_MAX_BYTES = 1500000;
// v2.54.24 (2025-12-22 23:14 UTC): Telemetry sampling (Purpose: cap diagnostics volume to 5% of sessions).
const TELEMETRY_SAMPLE_RATE = 0.05;
const TELEMETRY_SCHEMA_VERSION = 2;
const TELEMETRY_TAXONOMY_SCHEMA_VERSION = 1;
// v2.81.122 (2026-07-28): DIAG_KEY storage delta-compacts event.meta on write and
// expands it back on read (shared/telemetry-meta-delta.js) to stop persisting/
// exporting the same mostly-constant meta fields on every single event.
// This counter tracks storage generations, not the delta marker written into the
// data (that is TelemetryMetaDelta's own format number, currently 3): gen 2 wrote
// top-level diffs, gen 3 added nested diffs, gen 4 moved the diff baseline from
// "previous event of this model" to "previous event of this model AND label",
// which is what actually removed the per-event removed-key bookkeeping.
// Every generation stays readable: expand() dispatches on each event's marker,
// and legacy full-meta entries expand as a no-op.
const DIAGNOSTICS_STORAGE_ENCODING_VERSION = 4;
const telemetrySampleCache = new TTLMap({ ttlMs: 10 * 60 * 1000, maxSize: 50 });
const pipelineCompleteCache = new TTLMap({ ttlMs: 10 * 60 * 1000, maxSize: 200 });
const POST_TERMINAL_NOISE_LABELS = new Set([
  'ANSWER_GENERATING',
  'ANSWER_COMPLETE_TIMEOUT',
  'ANSWER_PARTIAL_ON_TIMEOUT',
  'ANSWER: LAYER SEMANTIC',
  'PIPELINE_ERROR',
  'SELECTOR_STATS',
  'SELECTOR_RESOLVE',
  'SELECTOR_RESOLVE_FAIL',
  'FOCUS_STUCK',
  'BUDGET_EXHAUSTED',
  'DETECT_DONE',
  'DOM_FALLBACK_START',
  'DOM_FALLBACK_TIMEOUT',
  'LATE_COLLECT_DECISION_TRACE',
  'PING_TRANSPORT_ERROR',
  'RETRY ANSWER EXTRACTION',
  'WAITING FOR ANSWER TO APPEAR',
  'ANSWER UNCHANGED AFTER PING',
  'GETRESPONSES COMMAND SENT',
  'TAB_VISIT',
  'VISIT_QUOTA_BACKOFF',
  'HUMAN_VISIT_START',
  'HUMAN_VISIT_END',
  'HUMAN_VISIT_HARD_CAP',
  'LEASE_GRANTED',
  'LEASE_RELEASED',
  'USER_FOCUS_CHANGE',
  'USER_FOCUS_OBSERVATION_STARTED',
  'USER_FOCUS_OBSERVATION_ENDED',
  'AUTOMATION_VISIT_SKIPPED',
  'AUTOMATION_VISIT_HARD_CAP'
]);

// Every event.meta carries ~15-20 mostly-constant fields (extVersion,
// runSessionId, llmName, tabId, pipelineRunId, ...) rebuilt fresh on every
// call (see appendLogEntry/ensureTelemetryMeta below). Left as-is, that
// duplication is what was persisted to storage and re-serialized on every
// export. Delta-compact on write, expand on read, so every consumer of
// these functions keeps seeing full per-event meta exactly as before.
const expandStoredDiagnostics = (arr) => (
  self.TelemetryMetaDelta?.expandTelemetryEvents ? self.TelemetryMetaDelta.expandTelemetryEvents(arr) : arr
);
const compactDiagnosticsForStorage = (arr) => (
  self.TelemetryMetaDelta?.compactTelemetryEvents ? self.TelemetryMetaDelta.compactTelemetryEvents(arr) : arr
);

async function readDiagnosticsEvents() {
  if (self.CompressedStorage?.get) {
    const stored = await self.CompressedStorage.get(DIAG_KEY);
    return expandStoredDiagnostics(Array.isArray(stored) ? stored : []);
  }
  const res = await chrome.storage.local.get([DIAG_KEY]);
  return expandStoredDiagnostics(Array.isArray(res?.[DIAG_KEY]) ? res[DIAG_KEY] : []);
}

async function writeDiagnosticsEvents(entries = []) {
  const payload = compactDiagnosticsForStorage(Array.isArray(entries) ? entries : []);
  if (self.CompressedStorage?.set) {
    await self.CompressedStorage.set(DIAG_KEY, payload);
    return;
  }
  await chrome.storage.local.set({ [DIAG_KEY]: payload });
}

// Telemetry arrives concurrently from multiple model tabs. A raw
// read -> append -> write sequence loses events when two writers read the same
// snapshot. Keep all mutations on one chain and expose the same chain to the
// message router so both ingestion paths share a single writer.
let diagnosticsMutationChain = Promise.resolve();
const diagnosticsMutationQueue = [];
let diagnosticsDrainScheduled = false;
function mutateDiagnosticsEventsConsistent(mutator) {
  const operation = new Promise((resolve, reject) => diagnosticsMutationQueue.push({ mutator, resolve, reject }));
  if (!diagnosticsDrainScheduled) {
    diagnosticsDrainScheduled = true;
    diagnosticsMutationChain = diagnosticsMutationChain.catch(() => {}).then(async () => {
      try {
        while (diagnosticsMutationQueue.length) {
          // Read/expand and compress/write once per burst, not once per event.
          // Provider ACKs share this worker with diagnostics. Recompressing the
          // entire 1.5 MB ring for each row blocked those ACKs and their timers.
          let current;
          try { current = await readDiagnosticsEvents(); }
          catch (error) {
            diagnosticsMutationQueue.splice(0).forEach((item) => item.reject(error));
            continue;
          }
          const batch = diagnosticsMutationQueue.splice(0);
          let payload = Array.isArray(current) ? current : [];
          const applied = [];
          for (const item of batch) {
            try {
              const next = await item.mutator(payload.slice());
              if (Array.isArray(next)) payload = next;
              applied.push(item);
            } catch (error) { item.reject(error); }
          }
          try {
            if (applied.length) await writeDiagnosticsEvents(payload);
            applied.forEach((item) => item.resolve(payload));
          } catch (error) { applied.forEach((item) => item.reject(error)); }
        }
      } finally { diagnosticsDrainScheduled = false; }
    });
  }
  return operation;
}

const readDiagnosticsEventsConsistent = () => diagnosticsMutationChain
  .catch(() => {})
  .then(() => readDiagnosticsEvents());

// Export/preview reads must never wait for the persistence backlog. Storage writes
// are atomic, so reading the last committed value gives a valid point-in-time
// snapshot while diagnosticsMutationChain continues flushing newer events.
const readDiagnosticsEventsSnapshot = () => readDiagnosticsEvents();

const replaceDiagnosticsEventsConsistent = (entries = []) => (
  mutateDiagnosticsEventsConsistent(() => (Array.isArray(entries) ? entries.slice() : []))
);

function ensureLogBuffer(llmName) {
  if (!jobState?.llms?.[llmName]) return null;
  if (!Array.isArray(jobState.llms[llmName].logs)) {
    jobState.llms[llmName].logs = [];
  }
  return jobState.llms[llmName].logs;
}

function getAppVersion() {
  try {
    return chrome?.runtime?.getManifest?.().version || 'unknown';
  } catch (_) {
    return 'unknown';
  }
}

function normalizeTelemetryTaxonomy(entry = {}) {
  const label = String(entry?.label || entry?.event || entry?.meta?.event || '').trim();
  const eventKey = label
    ? label.toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '')
    : 'UNKNOWN';
  const haystack = [
    eventKey,
    entry?.details || '',
    entry?.meta?.reason || '',
    entry?.meta?.failureClass || ''
  ].join(' ').toLowerCase();

  const stage = (() => {
    if (/round|run_summary|run_start|collection_start/.test(haystack)) return 'rounds';
    if (/dispatch|prompt|send|ack|handshake|page_ready|port_closed/.test(haystack)) return 'dispatch';
    if (/materialize|extract|answer|selector|late_collect|response/.test(haystack)) return 'extraction';
    if (/recovery|retry|budget/.test(haystack)) return 'recovery';
    if (/lease|focus|visit|tab_/.test(haystack)) return 'lease';
    if (/final|terminal|model_final|model_missing/.test(haystack)) return 'finalization';
    return 'runtime';
  })();

  const domain = (() => {
    if (stage === 'lease') return 'tab_lifecycle';
    if (stage === 'extraction') return 'answer_extraction';
    if (stage === 'dispatch') return 'prompt_dispatch';
    if (stage === 'finalization') return 'finalization';
    if (stage === 'recovery') return 'recovery';
    if (stage === 'rounds') return 'round_orchestration';
    return 'runtime';
  })();

  const outcome = (() => {
    if (/duplicate|deduplicated|ignored/.test(haystack)) return 'ignored';
    if (/success|accepted|granted|consumed|complete| ok\b|_ok\b/.test(haystack)) return 'success';
    if (/fail|error|timeout|denied|blocked|exhausted|missing|rejected/.test(haystack)) return 'failure';
    if (/start|begin/.test(haystack)) return 'start';
    if (/end|finish|done/.test(haystack)) return 'complete';
    return 'info';
  })();

  const eventClass = (() => {
    if (
      eventKey.includes('MODEL_FINAL_IGNORED_DEDUPLICATED')
      || (eventKey === 'MODEL_FINAL' && /duplicate|deduplicated|duplicate_final/.test(haystack))
      || /duplicate_final/.test(haystack)
    ) {
      return 'finalization_duplicate_ignored';
    }
    if (stage === 'dispatch' && outcome === 'failure') return 'dispatch_failure';
    if (stage === 'extraction' && outcome === 'failure') return 'extraction_failure';
    if (stage === 'recovery' && outcome === 'failure') return 'recovery_failure';
    if (stage === 'lease' && outcome === 'failure') return 'lease_lifecycle_failure';
    if (stage === 'finalization' && outcome === 'success') return 'finalization_success';
    return `${stage}_${outcome}`;
  })();

  return {
    schemaVersion: TELEMETRY_TAXONOMY_SCHEMA_VERSION,
    eventKey,
    domain,
    stage,
    outcome,
    eventClass
  };
}

function appendLogEntry(llmName, entry = {}) {
  const buffer = ensureLogBuffer(llmName);
  if (!buffer) return null;
  const resolvedDispatchId = jobState?.llms?.[llmName]?.lastDispatchMeta?.dispatchId
    || jobState?.llms?.[llmName]?.requestId
    || null;
  const pipelineContext = jobState?.session?.pipelineContext || {};
  const runtimeEntry = jobState?.llms?.[llmName];
  const sameDispatch = Boolean(entry.meta?.dispatchId && entry.meta.dispatchId === resolvedDispatchId);
  const registeredRequestId = entry.meta?.transportRequestId || (sameDispatch ? runtimeEntry?.transportRequestId : null) || null;
  const identityKeys = ['transportRequestId','requestId','dispatchId','stageId','stageAttemptId','debateRunId','pipelineRunId','pipelineRoundId','pipelineBatchId','tabId'];
  const sharedMeta = {
    extVersion: getAppVersion(),
    runSessionId: jobState?.session?.startTime || null,
    dispatchId: resolvedDispatchId,
    transportRequestId: registeredRequestId, requestId: registeredRequestId,
    correlationQuality: entry.meta?.correlationQuality || (registeredRequestId || sameDispatch ? 'exact' : 'inferred'),
    incomingIdentity: Object.fromEntries(identityKeys.filter(k => Object.prototype.hasOwnProperty.call(entry.meta || {}, k)).map(k => [k, entry.meta[k]])),
    schemaVersion: TELEMETRY_SCHEMA_VERSION,
    llmName,
    tabId: jobState?.llms?.[llmName]?.tabId || null,
    debateRunId: pipelineContext.debateRunId || pipelineContext.pipelineRunId || jobState?.session?.pipelineRunId || null,
    planId: pipelineContext.planId || null,
    stageId: pipelineContext.stageId || pipelineContext.pipelineStageId || null,
    stageAttemptId: pipelineContext.stageAttemptId || null,
    pipelineRunId: pipelineContext.pipelineRunId || jobState?.session?.pipelineRunId || null,
    pipelineRoundId: pipelineContext.pipelineRoundId || jobState?.session?.pipelineRoundId || null,
    pipelineBatchId: pipelineContext.pipelineBatchId || jobState?.session?.pipelineBatchId || null
  };
  const mergedMeta = { expectedIdentity: { ...Object.fromEntries(identityKeys.filter(k => sharedMeta[k] != null).map(k => [k, sharedMeta[k]])), transportRequestId: runtimeEntry?.transportRequestId || null }, ...sharedMeta, ...(entry.meta || {}) };
  if (!mergedMeta.telemetryTaxonomy) {
    mergedMeta.telemetryTaxonomy = normalizeTelemetryTaxonomy({
      label: entry.label || '',
      details: entry.details || '',
      level: entry.level || 'info',
      meta: mergedMeta
    });
  }
  const logEntry = {
    ts: entry.ts ?? Date.now(),
    type: entry.type || 'INFO',
    label: entry.label || '',
    details: entry.details || '',
    level: entry.level || 'info',
    meta: mergedMeta
  };
  buffer.push(logEntry);
  if (runtimeEntry) runtimeEntry.telemetryLogRecordedCount = (runtimeEntry.telemetryLogRecordedCount || 0) + 1;
  while (buffer.length > MAX_LOG_ENTRIES) {
    const removableIndex = buffer.findIndex((item) => !isPinnedTelemetryEvent(item));
    buffer.splice(removableIndex >= 0 ? removableIndex : 0, 1);
    if (runtimeEntry) runtimeEntry.telemetryLogEvictedCount = (runtimeEntry.telemetryLogEvictedCount || 0) + 1;
  }
  logEntry.meta.logCollection = { scope: 'current_model_run_entry', limit: MAX_LOG_ENTRIES,
    appended: runtimeEntry?.telemetryLogRecordedCount ?? null, evicted: runtimeEntry?.telemetryLogEvictedCount ?? 0, retained: buffer.length };
  saveJobState(jobState);
  return logEntry;
}

function isSuccessTerminalDiagnosticState(llmName) {
  const resolvedName = resolveLlmName(llmName);
  const entry = jobState?.llms?.[resolvedName || llmName];
  if (!entry) return false;
  const successStatuses = Array.isArray(SUCCESS_STATUSES)
    ? SUCCESS_STATUSES
    : ['COPY_SUCCESS', 'SUCCESS', 'DONE', 'PARTIAL', 'STREAM_TIMEOUT_HIDDEN'];
  const status = String(entry.finalStatus || entry.status || '').toUpperCase();
  if (!successStatuses.includes(status)) return false;
  return Boolean(entry.finalStatusRecorded || entry.finalStatus || entry.finalizedAt);
}

function shouldIgnorePostTerminalDiagnostic(llmName, entry = {}) {
  const resolvedNameForRunState = resolveLlmName(llmName);
  const runStateEntry = jobState?.llms?.[resolvedNameForRunState || llmName];
  if (runStateEntry && self.ModelRunState?.isPostTerminalNoiseEvent?.(runStateEntry, entry)) {
    if (self.commitModelRunTransition) {
      self.commitModelRunTransition(resolvedNameForRunState || llmName, runStateEntry, 'POST_TERMINAL_NOISE', {
        label: entry?.label || entry?.event || entry?.meta?.event || null,
        source: 'telemetry_post_terminal_filter',
        dispatchId: runStateEntry?.lastDispatchMeta?.dispatchId || runStateEntry?.confirmedDispatchId || null,
        tabId: runStateEntry?.tabId || null,
        runSessionId: jobState?.session?.startTime || null
      });
    } else {
      self.ModelRunState.recordPostTerminalNoise?.(runStateEntry, entry);
    }
    try { saveJobState(jobState); } catch (_) {}
    return true;
  }
  if (!isSuccessTerminalDiagnosticState(llmName)) return false;
  const resolvedName = resolveLlmName(llmName);
  const stateEntry = jobState?.llms?.[resolvedName || llmName];
  const finalizedAt = Number(stateEntry?.finalizedAt || 0);
  const eventTs = Number(entry?.ts || Date.now());
  if (finalizedAt && eventTs && eventTs + 1000 < finalizedAt) return false;
  const label = String(entry?.label || entry?.event || entry?.meta?.event || '').toUpperCase();
  if (POST_TERMINAL_NOISE_LABELS.has(label)) return true;
  if (label.startsWith('ANSWER: LAYER ')) return true;
  const type = String(entry?.type || '').toUpperCase();
  const level = String(entry?.level || '').toLowerCase();
  return level === 'error' && (type === 'TELEMETRY' || type === 'PIPELINE');
}

function getLogSnapshot(llmName) {
  const buffer = ensureLogBuffer(llmName);
  return buffer ? [...buffer] : [];
}

function downgradePipelineHardTimeoutLogs(llmName) {
  const buffer = ensureLogBuffer(llmName);
  if (!buffer) return false;
  let changed = false;
  buffer.forEach((entry) => {
    if (!entry || entry.label !== 'PIPELINE_ERROR') return;
    const reason = String(entry?.meta?.message || entry?.details || '').toLowerCase();
    const downgradeReasons = ['hard_timeout', 'soft_timeout', 'stream_start_timeout', 'streaming_incomplete', 'script_runtime_hard_stop'];
    const matched = downgradeReasons.find((value) => reason.includes(value));
    if (!matched) return;
    entry.level = 'warning';
    entry.meta = {
      ...(entry.meta || {}),
      degraded: true,
      degradedReason: entry?.meta?.degradedReason || matched
    };
    changed = true;
  });
  if (changed) saveJobState(jobState);
  return changed;
}

function downgradePipelineHardTimeoutStorage(llmName) {
  const runSessionId = jobState?.session?.startTime || null;
  readDiagnosticsEvents().then((arr) => {
    let changed = false;
    const next = arr.map((evt) => {
      if (!evt || evt.label !== 'PIPELINE_ERROR') return evt;
      const eventRunSessionId = evt?.meta?.runSessionId || evt?.meta?.sessionId || null;
      if (runSessionId && eventRunSessionId && eventRunSessionId !== runSessionId) return evt;
      const name = evt?.meta?.llmName || evt?.platform || evt?.llmName;
      if (llmName && name && name !== llmName) return evt;
      const reason = String(evt?.meta?.message || evt?.details || '').toLowerCase();
      const downgradeReasons = ['hard_timeout', 'soft_timeout', 'stream_start_timeout', 'streaming_incomplete', 'script_runtime_hard_stop'];
      const matched = downgradeReasons.find((value) => reason.includes(value));
      if (!matched) return evt;
      changed = true;
      return {
        ...evt,
        level: 'warning',
        meta: {
          ...(evt.meta || {}),
          degraded: true,
          degradedReason: evt?.meta?.degradedReason || matched
        }
      };
    });
    if (changed) {
      writeDiagnosticsEvents(next).catch(() => {});
    }
  }).catch(() => {});
}

function broadcastDiagnostic(llmName, entry = {}) {
  if (shouldIgnorePostTerminalDiagnostic(llmName, entry)) return null;
  const saved = appendLogEntry(llmName, entry);
  if (saved) {
    sendMessageToResultsTab({
      type: 'LLM_DIAGNOSTIC_EVENT',
      llmName,
      event: saved,
      logs: getLogSnapshot(llmName)
    });
  }
  return saved;
}

// v2.54.24 (2025-12-22 23:14 UTC): Telemetry dispatch + sampling (Purpose: unify storage + sample by session).
const LLM_NAME_ALIASES = {
  chatgpt: 'GPT',
  gpt: 'GPT',
  gemini: 'Gemini',
  claude: 'Claude',
  grok: 'Grok',
  lechat: 'Le Chat',
  mistral: 'Le Chat',
  qwen: 'Qwen',
  deepseek: 'DeepSeek',
  perplexity: 'Perplexity',
  'z.ai': 'Z.ai',
  zai: 'Z.ai',
  kimi: 'Kimi',
  moonshot: 'Kimi'
};

function resolveLlmName(value) {
  if (!value) return null;
  const raw = String(value).trim();
  const normalized = raw.toLowerCase();
  if (LLM_NAME_ALIASES[normalized]) return LLM_NAME_ALIASES[normalized];
  const match = Object.keys(LLM_TARGETS || {}).find((name) => name.toLowerCase() === normalized);
  return match || raw;
}

function hashTelemetryKey(value = '') {
  let hash = 0;
  const str = String(value);
  for (let i = 0; i < str.length; i += 1) {
    hash = ((hash << 5) - hash) + str.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

function resolveTelemetrySampling(sessionId) {
  const runSessionId = sessionId;
  if (!runSessionId) return Math.random() < TELEMETRY_SAMPLE_RATE;
  if (jobState?.session?.startTime && jobState.session.startTime === runSessionId && typeof jobState.session.telemetrySampled === 'boolean') {
    return jobState.session.telemetrySampled;
  }
  const key = String(runSessionId);
  if (telemetrySampleCache.has(key)) return telemetrySampleCache.get(key);
  const bucket = hashTelemetryKey(key) % 100;
  const sampled = bucket < (TELEMETRY_SAMPLE_RATE * 100);
  telemetrySampleCache.set(key, sampled);
  return sampled;
}

function ensureTelemetryMeta(meta = {}, llmName) {
  const normalized = { ...(meta || {}) };
  const resolvedName = resolveLlmName(llmName || normalized.llmName || normalized.platform);
  const activeDispatchMeta = jobState?.llms?.[resolvedName || llmName]?.lastDispatchMeta || null;
  if (resolvedName && !normalized.llmName) normalized.llmName = resolvedName;
  if (!normalized.extVersion) normalized.extVersion = getAppVersion();
  const runSessionId = normalized.runSessionId || normalized.sessionId || jobState?.session?.startTime || null;
  if (runSessionId && !normalized.runSessionId) normalized.runSessionId = runSessionId;
  const dispatchId = normalized.dispatchId
    || normalized.requestId
    || activeDispatchMeta?.dispatchId
    || null;
  if (dispatchId && !normalized.dispatchId) normalized.dispatchId = dispatchId;
  const matchesActiveDispatch = Boolean(dispatchId && activeDispatchMeta?.dispatchId
    && String(dispatchId) === String(activeDispatchMeta.dispatchId));
  if ((normalized.generationEpoch === undefined || normalized.generationEpoch === null)
    && matchesActiveDispatch
    && Number.isFinite(Number(activeDispatchMeta.generationEpoch))) {
    normalized.generationEpoch = Number(activeDispatchMeta.generationEpoch);
  }
  if (!normalized.attemptId && matchesActiveDispatch && activeDispatchMeta.attemptId) {
    normalized.attemptId = activeDispatchMeta.attemptId;
  }
  const tabId = normalized.tabId || jobState?.llms?.[resolvedName || llmName]?.tabId || null;
  if (tabId && !normalized.tabId) normalized.tabId = tabId;
  if (!normalized.schemaVersion) normalized.schemaVersion = TELEMETRY_SCHEMA_VERSION;
  return normalized;
}

function isTelemetryEntry(entry = {}) {
  const type = String(entry.type || '').toUpperCase();
  return type === 'TELEMETRY' || type === 'PIPELINE';
}

const PINNED_LABELS = new Set([
  'ATTEMPT_CONTEXT_CAPTURED',
  'COMPLETION_ATTEMPT_ACCEPTED',
  'COMPLETION_ATTEMPT_REJECTED',
  'GENERATION_OBSERVED',
  'OWNERSHIP_CONFIRMED',
  'OWNERSHIP_CONFLICT',
  'PRODUCER_TERMINAL',
  'CONTENT_TERMINAL',
  'TIMEOUT_PROGRESS',
  'TIMEOUT_PRODUCER_STUCK',
  'TIMEOUT_HARD',
  'TERMINAL_DECISION',
  'EXTRACTION_SNAPSHOT_CAPTURED',
  'TURN_RESOLUTION',
  'ANSWER_VERIFICATION_RESULT',
  'MODEL_FINAL',
  'FINAL_STATUS',
  'MODEL_MISSING',
  'FOCUS_STUCK',
  'BUDGET_EXHAUSTED',
  'MATERIALIZE_RECOVERY_CONTEXT',
  'MATERIALIZE_RECOVERY_VISIT_RESULT',
  'LATE_COLLECT_DECISION_TRACE',
  'FINAL_ERROR_AFTER_RECOVERY',
  'MATERIALIZE_RECOVERY_VISIT_FALLBACK',
  'ROUND1_TAB_RECOVERY_START',
  'ROUND1_TAB_RECOVERY_OK',
  'ROUND1_TAB_RECOVERY_MISS',
  'ROUND1_TAB_RECOVERY_ERROR',
  'GROK_PROMPT_ECHO_REJECTED',
  'GROK_COMPOSER_SNAPSHOT',
  'GEMINI_STALE_BASELINE_REJECTED',
  'GEMINI_CDP_ATTACH_REQUESTED',
  'GEMINI_CDP_FILES_MATERIALIZED',
  'GEMINI_CDP_DEBUGGER_ATTACHED',
  'GEMINI_CDP_UPLOAD_TRIGGER_CLICKED',
  'GEMINI_CDP_FILE_INPUT_FOUND',
  'GEMINI_CDP_FILES_ASSIGNED',
  'GEMINI_CDP_ATTACH_FAILED',
  'ATTACHMENT_STRATEGY_START',
  'ATTACHMENT_DISPATCHED',
  'ATTACHMENT_DISPATCH_FAILED',
  'ATTACHMENT_CONFIRMED',
  'ATTACHMENT_CONFIRM_TIMEOUT',
  'ATTACHMENT_ACCEPTED_UNPROVEN',
  'TERMINAL_UPGRADE_BLOCKED_UNCONFIRMED_SEND',
  'PRE_INSERTION_FAILURE_DEFERRED',
  'GROK_TRUSTED_INPUT_FAILED',
  'GROK_COMPOSER_COMMIT_CONFIRMED',
  'GROK_COMPOSER_COMMIT_MISMATCH',
  'GROK_SENT_PROMPT_CONFIRMED',
  'GROK_SENT_PROMPT_MISMATCH',
  'GROK_SENT_PROMPT_UNVERIFIED',
  'STALE_BASELINE_ANSWER_IGNORED',
  'RECOVERY_STALE_BASELINE_REJECTED',
  'RECOVERY_BLOCKED_SUBMIT_UNCONFIRMED',
  'PRESERVED_EVIDENCE_REJECTED',
  'ANSWER_SANITY_REJECTED',
  'TERMINAL_FAILURE_BLOCKED_BY_ANSWER_EVIDENCE',
  'ANSWER_LENGTH_SUSPECT',
  'FINALIZATION_DECISION',
  'MODEL_RUN_TRANSITION',
  'STATE_DIVERGENCE_DETECTED',
  'STATE_PROJECTION_COMMITTED',
  // One-shot causal dispatch events: emitted at run start (1-2 per model) and
  // first to be evicted by per-tick noise. Run 1782997990116: the baseline
  // guard fired (STALE_BASELINE_ANSWER_IGNORED survived), but the causal
  // DISPATCH_BASELINE_CAPTURED carrying anchorAnswerCount was evicted, so the
  // export could not show why the guard had a baseline.
  'TRANSPORT_DECISION',
  'PROMPT_SUBMITTED_ACCEPTED',
  'PROMPT_SUBMITTED_INFERRED',
  'PROMPT_SUBMITTED_PENDING',
  'PROMPT_SUBMITTED_UNCONFIRMED',
  'PROVIDER_SUBMIT_METHOD_OBSERVED',
  'PROVIDER_DISPATCH_STAGE_OBSERVED',
  'DISPATCH_POST_COMMAND_FOCUS_HOLD',
  'PAGE_READY_BLOCKED',
  'DISPATCH_BASELINE_CAPTURED',
  'UNSAFE_REUSE_SKIPPED',
  'DONOR_STICKY_TAB_REUSED',
  'PROVIDER_TRUSTED_ENTER_DISPATCHED',
  'PROVIDER_TRUSTED_SEND_CLICKED',
  'PROVIDER_TRUSTED_ENTER_FAILED',
  'PROVIDER_TRUSTED_SEND_FAILED',
  'PERPLEXITY_DUPLICATE_DISPATCH_SUPPRESSED',
  'PERPLEXITY_CONCURRENT_DISPATCH_REJECTED',
  'FINALIZE_BLOCKED_SUBMIT_PENDING',
  'SENDER_TAB_MISMATCH_REJECTED',
  'STALE_SNAPSHOT_SIGNATURE_EXCLUDED',
  'TAB_CREATE_FAILED'
]);

const isPinnedTelemetryEvent = (entry = {}) => {
  const label = String(entry?.label || entry?.meta?.event || '').toUpperCase();
  if (!label) return false;
  if (label.startsWith('ROUND')) return true;
  return PINNED_LABELS.has(label);
};

const trimDiagnosticsBuffer = (entries = [], maxItems = 200) => {
  let next = Array.isArray(entries) ? entries.slice() : [];
  if (next.length <= maxItems) return next;
  const pinned = next.filter(isPinnedTelemetryEvent);
  const unpinned = next.filter((entry) => !isPinnedTelemetryEvent(entry));
  const capacity = Math.max(0, maxItems - pinned.length);
  const trimmed = capacity ? unpinned.slice(-capacity) : [];
  next = trimmed.concat(pinned);
  next.sort((a, b) => (a?.ts || 0) - (b?.ts || 0));
  return next;
};

const dropOldestUnpinned = (entries = []) => {
  if (!entries.length) return entries;
  const idx = entries.findIndex((entry) => !isPinnedTelemetryEvent(entry));
  if (idx === -1) {
    return entries.slice(1);
  }
  return entries.slice(0, idx).concat(entries.slice(idx + 1));
};

function normalizeTelemetryEntry(entry = {}, llmName) {
  const meta = ensureTelemetryMeta({ ...(entry.meta || {}) }, llmName);
  if (!meta.telemetryTaxonomy) {
    meta.telemetryTaxonomy = normalizeTelemetryTaxonomy({ ...entry, meta });
  }
  return {
    ts: entry.ts ?? Date.now(),
    type: entry.type || 'TELEMETRY',
    label: entry.label || meta.event || entry.event || '',
    details: entry.details || '',
    level: entry.level || 'info',
    meta
  };
}

async function persistDiagnosticEvent(llmName, entry = {}, { sender, source } = {}) {
  const normalizedName = resolveLlmName(llmName || entry?.platform || entry?.meta?.platform || entry?.llmName);
  if (shouldIgnorePostTerminalDiagnostic(normalizedName, entry)) return null;
  const evt = Object.assign({}, entry || {}, {
    ts: entry?.ts || Date.now(),
    platform: normalizedName || entry?.platform || 'unknown',
    source: entry?.source || source || sender?.url || sender?.tab?.url || null
  });
  await mutateDiagnosticsEventsConsistent((arr) => {
    let next = trimDiagnosticsBuffer([...arr, evt], DIAGNOSTICS_EVENTS_MAX_ITEMS);
    const stringify = () => JSON.stringify(next);
    while (stringify().length > DIAGNOSTICS_EVENTS_MAX_BYTES && next.length > 1) {
      next = dropOldestUnpinned(next);
    }
    return next;
  });
  return evt;
}

function dispatchTelemetry(llmName, entry = {}, { sender, source, force = false } = {}) {
  if (!entry) return null;
  const normalized = normalizeTelemetryEntry(entry, llmName);
  // The schema 5 ledger is the unsampled source of truth. Record before legacy
  // post-terminal suppression and UI sampling so audits can see late changes
  // and absence of a legacy row never becomes absence of evidence.
  self.ProofTelemetryLedger?.record?.(normalized, llmName, {
    runSessionId: normalized.meta?.runSessionId || jobState?.session?.startTime || null,
    producerComponent: source || normalized.type || 'background-telemetry'
  }).catch((err) => console.warn('[proof-telemetry] append failed', err));
  const runEntry = jobState?.llms?.[llmName];
  if (runEntry && self.AnswerVerification?.appendTimeline) {
    const label = String(normalized.label || '').toUpperCase();
    const stage = /DISPATCH|COMMAND|PROMPT_READY|TYPING/.test(label) ? 'command'
      : /SUBMIT|PROMPT_SENT|PROMPT_CONFIRMED/.test(label) ? 'submit'
        : /GENERAT|STREAMING|LIFECYCLE/.test(label) ? 'generation'
          : /EXTRACT|ANSWER_CANDIDATE|ANSWER RECEIVED/.test(label) ? 'extraction'
            : /VERIFICATION|FINALIZATION/.test(label) ? 'verification'
              : /MODEL_FINAL|PIPELINE_COMPLETE/.test(label) ? 'applied' : null;
    if (stage) self.AnswerVerification.appendTimeline(runEntry, {
      stage,
      state: label.toLowerCase(),
      ts: normalized.ts,
      runSessionId: normalized.meta?.runSessionId || jobState?.session?.startTime || null,
      dispatchId: normalized.meta?.dispatchId || null,
      tabId: sender?.tab?.id || runEntry.tabId || null,
      source: source || normalized.type || null,
      details: { label, level: normalized.level || null }
    });
  }
  if (shouldIgnorePostTerminalDiagnostic(llmName, normalized)) return null;
  if (normalized.label === 'PIPELINE_COMPLETE') {
    const dedupeKey = [
      normalized.meta?.runSessionId || 'no_run',
      normalized.meta?.dispatchId || 'no_dispatch',
      normalized.meta?.llmName || llmName || 'unknown'
    ].join('|');
    if (pipelineCompleteCache.has(dedupeKey)) {
      return null;
    }
    pipelineCompleteCache.set(dedupeKey, true);
  }
  const runSessionId = normalized.meta?.runSessionId || jobState?.session?.startTime || null;
  // Pinned labels are explicitly declared important — never let sampling drop them at
  // ingest (the pin only protects already-stored entries from pruning otherwise).
  const sampled = force || normalized.level === 'error' || isPinnedTelemetryEvent(normalized) || resolveTelemetrySampling(runSessionId);
  if (!sampled) return null;
  if (runSessionId && !normalized.meta.runSessionId) normalized.meta.runSessionId = runSessionId;
  const saved = broadcastDiagnostic(llmName, normalized);
  persistDiagnosticEvent(llmName, saved || normalized, { sender, source }).catch((err) => {
    console.warn('[dispatchTelemetry] store failed', err);
  });
  return saved || normalized;
}

function resolveEventLlmName(message, event, sender) {
  const direct = resolveLlmName(message?.llmName || event?.llmName || event?.meta?.llmName || event?.platform || event?.meta?.platform);
  if (direct) return direct;
  const tabId = sender?.tab?.id;
  const mapped = tabId && TabMapManager?.getNameByTabId ? TabMapManager.getNameByTabId(tabId) : null;
  return resolveLlmName(mapped);
}

function emitTelemetry(llmName, event, { label, details, level = 'info', meta = {}, force = false } = {}) {
  if (!llmName || !event) return null;
  return dispatchTelemetry(llmName, {
    type: 'TELEMETRY',
    label: label || event,
    details: details || '',
    level,
    meta: { event, ...meta }
  }, { force });
}

function recordPlatformRun(llmName, isSuccess) {
  const resolved = resolveLlmName(llmName);
  if (!resolved) return;
  const history = platformRunHistory.get(resolved) || [];
  const now = Date.now();
  history.push({ ts: now, success: !!isSuccess });
  while (history.length > PLATFORM_HISTORY_MAX) {
    history.shift();
  }
  platformRunHistory.set(resolved, history);
  const recentWindow = history.slice(-PLATFORM_DEGRADED_WINDOW);
  if (recentWindow.length >= PLATFORM_DEGRADED_WINDOW) {
    const successCount = recentWindow.filter((entry) => entry.success).length;
    const successRate = successCount / recentWindow.length;
    if (successRate < PLATFORM_DEGRADED_THRESHOLD) {
      const lastAlert = platformDegradedAt.get(resolved) || 0;
      if (now - lastAlert >= PLATFORM_DEGRADED_COOLDOWN_MS) {
        platformDegradedAt.set(resolved, now);
        emitTelemetry(resolved, 'PLATFORM_DEGRADED', {
          level: 'warning',
          details: `successRate=${Math.round(successRate * 100)}%`,
          meta: {
            successRate,
            windowSize: recentWindow.length,
            threshold: PLATFORM_DEGRADED_THRESHOLD
          }
        });
      }
    }
  }
  const hourlyCutoff = now - 60 * 60 * 1000;
  const hourly = history.filter((entry) => entry.ts >= hourlyCutoff);
  if (hourly.length >= 4) {
    const hourlySuccess = hourly.filter((entry) => entry.success).length;
    const hourlyRate = hourlySuccess / hourly.length;
    if (hourlyRate < PLATFORM_DEGRADED_HOURLY_THRESHOLD) {
      const lastHourlyAlert = platformDegradedHourlyAt.get(resolved) || 0;
      if (now - lastHourlyAlert >= PLATFORM_DEGRADED_HOURLY_COOLDOWN_MS) {
        platformDegradedHourlyAt.set(resolved, now);
        emitTelemetry(resolved, 'PLATFORM_DEGRADED_HOURLY', {
          level: 'warning',
          details: `successRate=${Math.round(hourlyRate * 100)}%`,
          meta: {
            successRate: hourlyRate,
            windowSize: hourly.length,
            threshold: PLATFORM_DEGRADED_HOURLY_THRESHOLD
          }
        });
      }
    }
  }
}

self.PLATFORM_DEGRADED_WINDOW = PLATFORM_DEGRADED_WINDOW;
self.PLATFORM_DEGRADED_THRESHOLD = PLATFORM_DEGRADED_THRESHOLD;
self.PLATFORM_DEGRADED_COOLDOWN_MS = PLATFORM_DEGRADED_COOLDOWN_MS;
self.PLATFORM_DEGRADED_HOURLY_THRESHOLD = PLATFORM_DEGRADED_HOURLY_THRESHOLD;
self.PLATFORM_DEGRADED_HOURLY_COOLDOWN_MS = PLATFORM_DEGRADED_HOURLY_COOLDOWN_MS;
self.PLATFORM_HISTORY_MAX = PLATFORM_HISTORY_MAX;
self.MAX_LOG_ENTRIES = MAX_LOG_ENTRIES;
self.DIAGNOSTICS_EVENTS_MAX_ITEMS = DIAGNOSTICS_EVENTS_MAX_ITEMS;
self.DIAGNOSTICS_EVENTS_MAX_BYTES = DIAGNOSTICS_EVENTS_MAX_BYTES;
self.TELEMETRY_SAMPLE_RATE = TELEMETRY_SAMPLE_RATE;
self.TELEMETRY_TAXONOMY_SCHEMA_VERSION = TELEMETRY_TAXONOMY_SCHEMA_VERSION;
self.telemetrySampleCache = telemetrySampleCache;
self.isPinnedTelemetryEvent = isPinnedTelemetryEvent;
self.trimDiagnosticsBuffer = trimDiagnosticsBuffer;
self.appendLogEntry = appendLogEntry;
self.getLogSnapshot = getLogSnapshot;
self.downgradePipelineHardTimeoutLogs = downgradePipelineHardTimeoutLogs;
self.downgradePipelineHardTimeoutStorage = downgradePipelineHardTimeoutStorage;
self.broadcastDiagnostic = broadcastDiagnostic;
self.LLM_NAME_ALIASES = LLM_NAME_ALIASES;
self.resolveLlmName = resolveLlmName;
self.hashTelemetryKey = hashTelemetryKey;
self.resolveTelemetrySampling = resolveTelemetrySampling;
self.isTelemetryEntry = isTelemetryEntry;
self.normalizeTelemetryTaxonomy = normalizeTelemetryTaxonomy;
self.normalizeTelemetryEntry = normalizeTelemetryEntry;
self.shouldIgnorePostTerminalDiagnostic = shouldIgnorePostTerminalDiagnostic;
self.persistDiagnosticEvent = persistDiagnosticEvent;
self.mutateDiagnosticsEventsConsistent = mutateDiagnosticsEventsConsistent;
self.readDiagnosticsEventsConsistent = readDiagnosticsEventsConsistent;
self.readDiagnosticsEventsSnapshot = readDiagnosticsEventsSnapshot;
self.replaceDiagnosticsEventsConsistent = replaceDiagnosticsEventsConsistent;
self.dispatchTelemetry = dispatchTelemetry;
self.resolveEventLlmName = resolveEventLlmName;
self.emitTelemetry = emitTelemetry;
self.recordPlatformRun = recordPlatformRun;
