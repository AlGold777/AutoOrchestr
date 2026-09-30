// background/dispatch-coordinator.js
// Dispatch coordination helpers for prompt delivery and retry supervision.

'use strict';

var dispatchMutexManager = new MutexManager();
var promptDispatchFocusMutex = Promise.resolve();
var promptSubmitWaiters = new Map();
var promptSubmitWaiterArms = new Map();
var promptInsertionWaiters = new Map();
var providerSendOnlyRecoveryTimers = new Map();
var promptDispatchSupervisorTimer = null;
//- 2.1. Лимит ожидания сигнала из контента -//
const PROMPT_SUBMIT_TIMEOUT_MS = TimingConfig.getTiming('promptSubmitTimeoutMs', 15000);
// Per-model submit timeouts live in shared/model-policy.js (single source);
// the legacy PROMPT_SUBMIT_TIMEOUTS_MS map here was a divergent duplicate.
const CLAUDE_TYPING_TIMEOUT_PER_CHAR_MS = 6;
const CLAUDE_TYPING_TIMEOUT_MAX_MS = 180000;
const CLAUDE_TYPING_TIMEOUT_MIN_MS = 30000;
const SEND_PROMPT_DELAY_MS = TimingConfig.getTiming('sendPromptDelayMs', 3000);
// Stage a content script reports while an attachment cascade is still delivering.
// It is the one progress signal allowed to extend the post-command focus hold
// repeatedly, because an upload can legitimately outlast a composer interaction
// by an order of magnitude. Must match ATTACHMENT_PROGRESS_STAGE in
// content-scripts/attachment-handler.js.
const ATTACHMENT_PROGRESS_STAGE = 'attachment_upload_started';
// Ceiling on that repeated extension. Covers the longest configured attachment
// cascade (Qwen, 70 s) plus its dispatch, and bounds how long a single dispatch
// can pin the tab even if progress keeps arriving.
const ATTACHMENT_FOCUS_EXTENSION_CEILING_MS = TimingConfig.getTiming('attachmentFocusExtensionCeilingMs', 90000);
// Safety net only. The normal submit timer starts on the provider's
// send_action_requested evidence, not while it is still uploading a file.
const PROVIDER_SEND_ACTION_FALLBACK_MS = TimingConfig.getTiming(
  'providerSendActionFallbackMs',
  ATTACHMENT_FOCUS_EXTENSION_CEILING_MS + 10000
);
const READY_ACK_TIMEOUT_MS = TimingConfig.getTiming('readyAckTimeoutMs', 6000);
const SEND_PROMPT_DELAY_OVERRIDES = {
  'Perplexity': 1000,
  'Claude': 1500,
  'GPT': 1500,
  'Le Chat': 1000
};
const DISPATCH_SUPERVISOR_TICK_MS = 1200;
// No zero-delay retries: an immediate re-dispatch amplifies exactly the race
// family this project keeps fighting (duplicate sends, overlapping dispatch).
const DISPATCH_RETRY_BACKOFF_MS = [500, 800, 3000, 8000];
const CONSERVATIVE_RETRY_BACKOFF_MS = [2000, 2500, 5000, 9000];
const CONNECTION_RETRY_DELAYS = [500, 1500, 3000];
const CONSERVATIVE_CONNECTION_RETRY_DELAYS = [2000, 4000, 6000];
const CONSERVATIVE_MODELS = ['Grok', 'Qwen', 'DeepSeek', 'Z.ai', 'Kimi'];
const DISPATCH_MAX_ATTEMPTS = 4;
const DEFAULT_RETRY_DELAY_MS = 2000;
// When a recovery (resend) intent is denied because answer-evidence is present,
// back the entry off for this long so the supervisor does not re-attempt — and
// re-emit RECOVERY_INTENT_DENIED — on every tick. Without this the supervisor
// spams identical denials for minutes (observed on Le Chat hard_timeout runs).
const RECOVERY_DENY_BACKOFF_MS = 15000;
const NO_FOCUS_TIMEOUT_MS = TimingConfig.getTiming('noFocusTimeoutMs', 5000);
//-- 1.1. Минимальное удержание фокуса для retry - от CLAUDE --//
const RETRY_FOCUS_HOLD_MS = TimingConfig.getTiming('retryFocusHoldMs', 3000);
// Timeout ladder (timing review 2026-07-02): the hard stop must sit ABOVE the
// content pipeline hardMax (450s Standard / 900s Long) with a margin, and must
// follow the generation wait profile — a fixed 180s killed long generations.
const SCRIPT_RUNTIME_HARD_STOP_SHORT_MS = 480000;
const SCRIPT_RUNTIME_HARD_STOP_LONG_MS = 930000;
const getScriptRuntimeHardStopMs = () => (self.isLongGenerationProfile?.()
  ? SCRIPT_RUNTIME_HARD_STOP_LONG_MS
  : SCRIPT_RUNTIME_HARD_STOP_SHORT_MS);
const SCRIPT_RUNTIME_HARD_STOP_ACTIVITY_WINDOW_MS = 15000;
const SCRIPT_RUNTIME_HARD_STOP_GRACE_MS = 12000;
const SCRIPT_RUNTIME_HARD_STOP_MAX_GRACE_EXTENSIONS = 2;
const TRANSPORT_RECOVER_BACKOFF_MS = 12000;
const getProviderPipelineOwnershipTtlMs = () => getScriptRuntimeHardStopMs();
const PROVIDER_SEND_ONLY_RECOVERY_DELAY_MS = 5000;
const PROVIDER_SEND_ONLY_RECOVERY_TIMEOUT_MS = 15000;

function isProviderPipelineOwnershipActive(entry, now = Date.now()) {
  if (!entry) return false;
  const active = entry.providerComposerTransactionActive === true
    || (entry.providerComposerTransactionActive == null && entry.providerPipelineActive === true);
  if (!active) return false;
  const activeAt = Number(entry.providerComposerTransactionActiveAt || entry.providerPipelineActiveAt || 0);
  return activeAt > 0 && Math.max(0, Number(now) - activeAt) < getProviderPipelineOwnershipTtlMs();
}

function cancelProviderSendOnlyRecovery(llmName) {
  const timer = providerSendOnlyRecoveryTimers.get(llmName);
  if (!timer) return false;
  clearTimeout(timer);
  dispatchDeregisterSessionTimer(timer);
  providerSendOnlyRecoveryTimers.delete(llmName);
  return true;
}

function isInitialPromptPassActive() {
  return jobState?.session?.roundsInProgress === true
    && ['round0', 'round1'].includes(jobState.session.roundPhase);
}
self.isInitialPromptPassActive = isInitialPromptPassActive;

function scheduleProviderSendOnlyRecovery(llmName, options = {}) {
  const entry = jobState?.llms?.[llmName];
  if (!entry || !self.ModelPolicy?.modelSupportsSendOnlyRecovery?.(llmName)) return false;
  const dispatchId = options.dispatchId || entry?.lastDispatchMeta?.dispatchId || null;
  if (!dispatchId) return false;
  cancelProviderSendOnlyRecovery(llmName);
  const delayMs = Math.max(500, Number(options.delayMs || PROVIDER_SEND_ONLY_RECOVERY_DELAY_MS));
  let timer = null;
  timer = dispatchRegisterSessionTimer(setTimeout(async () => {
    dispatchDeregisterSessionTimer(timer);
    providerSendOnlyRecoveryTimers.delete(llmName);
    const liveEntry = jobState?.llms?.[llmName];
    const liveDispatchId = liveEntry?.lastDispatchMeta?.dispatchId || null;
    if (!liveEntry || liveDispatchId !== dispatchId || liveEntry.promptSubmittedAt
      || liveEntry.confirmedDispatchId === dispatchId) return;
    if (isInitialPromptPassActive()) {
      scheduleProviderSendOnlyRecovery(llmName, { ...options, dispatchId, delayMs: 1000 });
      return;
    }
    if (!['prompt_inserted', 'send_action_failed'].includes(String(liveEntry.providerDispatchStage || ''))) return;
    const tabId = resolveBoundTabIdForDispatch(llmName, liveEntry);
    if (!isValidTabId(tabId)) return;
    let result = null;
    try {
      result = await withPromptDispatchFocusLock(async () => {
        const current = jobState?.llms?.[llmName];
        if (current !== liveEntry || current.lastDispatchMeta?.dispatchId !== dispatchId
          || current.promptSubmittedAt || current.confirmedDispatchId === dispatchId
          || isInitialPromptPassActive()) return { ok: false, status: 'recovery_no_longer_needed' };
        await activateTabForDispatch(tabId);
        await dispatchSleepMs(250);
        if (jobState?.llms?.[llmName] !== liveEntry || liveEntry.promptSubmittedAt
          || liveEntry.lastDispatchMeta?.dispatchId !== dispatchId || isInitialPromptPassActive()) {
          return { ok: false, status: 'recovery_no_longer_needed' };
        }
        return sendMessageWithTimeout(tabId, llmName, {
          type: 'RECOVER_PROVIDER_SEND',
          llmName,
          prompt: self.TransportPolicy?.resolvePromptForModel
            ? self.TransportPolicy.resolvePromptForModel(jobState?.session?.promptsByModel, llmName, jobState.prompt)
            : jobState.prompt,
          meta: { ...(liveEntry.lastDispatchMeta || {}), dispatchId, runSessionId: jobState?.session?.startTime || null },
          reason: options.reason || 'send_only_watchdog'
        }, PROVIDER_SEND_ONLY_RECOVERY_TIMEOUT_MS);
      });
    } catch (error) {
      result = { ok: false, status: 'recovery_transport_failed', reason: error?.message || 'unknown_error' };
    }
    emitTelemetry(llmName, 'PROVIDER_DISPATCH_STAGE_OBSERVED', {
      level: result?.ok === true ? 'info' : 'warning',
      details: result?.reason || result?.status || (result?.ok ? 'confirmed' : 'failed'),
      meta: {
        tabId,
        dispatchId,
        stage: 'send_only_recovery_result',
        outcome: result?.ok === true ? 'confirmed' : 'failed',
        resultStatus: result?.status || null,
        recoveryReason: options.reason || 'send_only_watchdog'
      },
      force: true
    });
  }, delayMs));
  providerSendOnlyRecoveryTimers.set(llmName, timer);
  return true;
}

const dispatchSessionTimerManager = (() => {
  const register = (typeof self?.registerSessionTimer === 'function')
    ? self.registerSessionTimer
    : (timerId) => timerId;
  const deregister = (typeof self?.deregisterSessionTimer === 'function')
    ? self.deregisterSessionTimer
    : () => {};
  return { register, deregister };
})();
const dispatchRegisterSessionTimer = dispatchSessionTimerManager.register;
const dispatchDeregisterSessionTimer = dispatchSessionTimerManager.deregister;
const scriptRuntimeHardStopTimers = new Map();

function resolveBoundTabIdForDispatch(llmName, entry = null) {
  if (typeof self.getBoundTabId === 'function') {
    return self.getBoundTabId(llmName, entry);
  }
  if (typeof TabMapManager !== 'undefined' && typeof TabMapManager.get === 'function') {
    return TabMapManager.get(llmName) || null;
  }
  return null;
}

function markModelRuntimeActivity(llmName, ts = Date.now(), source = 'runtime_signal') {
  const entry = jobState?.llms?.[llmName];
  if (!entry) return;
  const stamp = Number(ts) || Date.now();
  const prev = Number(entry.lastRuntimeActivityAt || 0);
  if (stamp >= prev) {
    entry.lastRuntimeActivityAt = stamp;
    entry.lastRuntimeActivitySource = source || 'runtime_signal';
  }
}

function clearScriptRuntimeHardStop(llmName, dispatchId = null) {
  if (!llmName) return;
  const active = scriptRuntimeHardStopTimers.get(llmName);
  if (!active) return;
  if (dispatchId && active.dispatchId && active.dispatchId !== dispatchId) return;
  clearTimeout(active.timerId);
  dispatchDeregisterSessionTimer(active.timerId);
  scriptRuntimeHardStopTimers.delete(llmName);
}

function clearAllScriptRuntimeHardStops() {
  scriptRuntimeHardStopTimers.forEach((active, llmName) => {
    try {
      clearTimeout(active.timerId);
      dispatchDeregisterSessionTimer(active.timerId);
    } catch (_) {}
    scriptRuntimeHardStopTimers.delete(llmName);
  });
}

function scheduleScriptRuntimeHardStop(llmName, tabId, message, attempt = 1, options = null) {
  const opts = options && typeof options === 'object' ? options : {};
  if (!llmName || !isValidTabId(tabId)) return;
  if (attempt !== 1 && !opts.force) return;
  const messageType = String(message?.type || '').toUpperCase();
  if (messageType !== 'GET_ANSWER' && messageType !== 'GET_FINAL_ANSWER') return;

  const entry = jobState?.llms?.[llmName];
  if (!entry) return;
  const promptSubmittedAt = Number(entry?.promptSubmittedAt || 0);
  if (!promptSubmittedAt && !opts.allowUnconfirmedStart) return;

  const dispatchId = message?.meta?.dispatchId || null;
  const sessionId = Number(jobState?.session?.startTime || 0) || null;
  const startedAt = promptSubmittedAt || Date.now();
  const elapsedMs = Math.max(0, Date.now() - startedAt);
  const remainingMs = Math.max(0, getScriptRuntimeHardStopMs() - elapsedMs);
  const active = scriptRuntimeHardStopTimers.get(llmName);
  if (active && active.dispatchId === dispatchId && active.tabId === tabId) {
    return;
  }
  if (active) {
    clearTimeout(active.timerId);
    dispatchDeregisterSessionTimer(active.timerId);
    scriptRuntimeHardStopTimers.delete(llmName);
  }

  const scheduleGuardTimer = (delayMs, graceExtensions = 0) => {
    let guardTimerId = null;
    guardTimerId = dispatchRegisterSessionTimer(setTimeout(() => {
      dispatchDeregisterSessionTimer(guardTimerId);
      const liveGuard = scriptRuntimeHardStopTimers.get(llmName);
      if (!liveGuard || liveGuard.timerId !== guardTimerId) return;

      const activeSessionId = Number(jobState?.session?.startTime || 0) || null;
      if (sessionId && activeSessionId && sessionId !== activeSessionId) {
        scriptRuntimeHardStopTimers.delete(llmName);
        return;
      }
      const entry = jobState?.llms?.[llmName];
      if (!entry) {
        scriptRuntimeHardStopTimers.delete(llmName);
        return;
      }
      const isFinal = isTerminalLlmEntry(entry);
      if (isFinal) {
        scriptRuntimeHardStopTimers.delete(llmName);
        return;
      }
      const liveDispatchId = entry?.lastDispatchMeta?.dispatchId || null;
      if (dispatchId && liveDispatchId && dispatchId !== liveDispatchId) {
        scriptRuntimeHardStopTimers.delete(llmName);
        return;
      }

      const now = Date.now();
      const lastActivityAt = Number(entry.lastRuntimeActivityAt || entry.lastDispatchAt || entry.promptSubmittedAt || 0);
      const activityAgeMs = lastActivityAt ? Math.max(0, now - lastActivityAt) : null;
      const canExtendByActivity = Number(graceExtensions || 0) < SCRIPT_RUNTIME_HARD_STOP_MAX_GRACE_EXTENSIONS
        && Number.isFinite(activityAgeMs)
        && activityAgeMs >= 0
        && activityAgeMs <= SCRIPT_RUNTIME_HARD_STOP_ACTIVITY_WINDOW_MS;

      if (canExtendByActivity) {
        emitTelemetry(llmName, 'SCRIPT_RUNTIME_HARD_STOP_GRACE', {
          level: 'warning',
          details: `${SCRIPT_RUNTIME_HARD_STOP_GRACE_MS}ms`,
          meta: {
            timeoutMs: getScriptRuntimeHardStopMs(),
            graceMs: SCRIPT_RUNTIME_HARD_STOP_GRACE_MS,
            graceExtensions: Number(graceExtensions || 0) + 1,
            activityAgeMs,
            lastActivityAt,
            startedAt,
            tabId,
            dispatchId: dispatchId || liveDispatchId || null,
            messageType
          }
        });
        const nextGrace = Number(graceExtensions || 0) + 1;
        const nextTimerId = scheduleGuardTimer(SCRIPT_RUNTIME_HARD_STOP_GRACE_MS, nextGrace);
        scriptRuntimeHardStopTimers.set(llmName, {
          timerId: nextTimerId,
          tabId,
          dispatchId,
          sessionId,
          startedAt,
          graceExtensions: nextGrace
        });
        return;
      }

      scriptRuntimeHardStopTimers.delete(llmName);
      emitTelemetry(llmName, 'SCRIPT_RUNTIME_HARD_STOP', {
        level: 'warning',
        details: `${getScriptRuntimeHardStopMs()}ms`,
        meta: {
          timeoutMs: getScriptRuntimeHardStopMs(),
          elapsedMs: Math.max(0, Date.now() - startedAt),
          startedAt,
          tabId,
          dispatchId: dispatchId || liveDispatchId || null,
          messageType,
          lastActivityAt,
          activityAgeMs,
          graceExtensions: Number(graceExtensions || 0)
        }
      });

      try {
        chrome.tabs.sendMessage(tabId, {
          type: 'HUMANOID_FORCE_STOP',
          payload: { reason: 'script_runtime_hard_stop', timeoutMs: getScriptRuntimeHardStopMs() }
        }).catch(() => {});
        chrome.tabs.sendMessage(tabId, {
          type: 'STOP_AND_CLEANUP',
          reason: 'script_runtime_hard_stop',
          payload: { timeoutMs: getScriptRuntimeHardStopMs() }
        }).catch(() => {});
      } catch (_) {}

      updateModelState(llmName, 'RECOVERABLE_ERROR', {
        message: `script_runtime_hard_stop_${getScriptRuntimeHardStopMs()}ms`
      });

      handleLLMResponse(
        llmName,
        '',
        { type: 'script_runtime_hard_stop', message: `Timed out after ${getScriptRuntimeHardStopMs()}ms` },
        {
          dispatchId: dispatchId || liveDispatchId || null,
          sessionId: activeSessionId,
          runSessionId: activeSessionId
        },
        ''
      );
    }, Math.max(1, Number(delayMs) || 0)));
    return guardTimerId;
  };

  const timerId = scheduleGuardTimer(remainingMs, 0);
  scriptRuntimeHardStopTimers.set(llmName, {
    timerId,
    tabId,
    dispatchId,
    sessionId,
    startedAt,
    graceExtensions: 0
  });
}

function armScriptRuntimeHardStopForConfirmedPrompt(llmName, options = null) {
  if (!llmName) return false;
  const opts = options && typeof options === 'object' ? options : {};
  const entry = jobState?.llms?.[llmName];
  if (!entry || !entry.promptSubmittedAt) return false;
  const dispatchId = opts.dispatchId || entry?.confirmedDispatchId || entry?.lastDispatchMeta?.dispatchId || null;
  const tabId = isValidTabId(opts.tabId)
    ? opts.tabId
    : resolveBoundTabIdForDispatch(llmName, entry);
  if (!isValidTabId(tabId)) return false;
  scheduleScriptRuntimeHardStop(
    llmName,
    tabId,
    { type: 'GET_ANSWER', meta: { dispatchId } },
    1,
    { force: true }
  );
  return true;
}

const dispatchSleepMs = (ms) => new Promise((resolve) => {
  const duration = Math.max(0, ms || 0);
  if (duration <= 0) {
    resolve();
    return;
  }
  // Stop clears scheduled session work, but an awaited delay must still settle
  // so the current focus owner can release its lock. Callers recheck dispatch
  // identity before sending; clearing this timer stranded the promise forever.
  setTimeout(resolve, duration);
});

function resolveDispatchFlags(llmName, entry) {
  if (self.getDispatchFlags) {
    return self.getDispatchFlags(llmName, entry);
  }
  return {
    machine: null,
    state: entry?.dispatchState || 'UNKNOWN',
    isSent: !!entry?.messageSent,
    isInFlight: !!entry?.dispatchInFlight,
    isQueued: false,
    isTerminal: false,
    isInProgress: false,
    entry
  };
}

function scheduleDispatchRetry(entry, llmName, error) {
  if (!entry) return;
  const attempt = Number(entry.dispatchAttempts || 0);
  const decision = self.DispatchRetry?.getDispatchRetryDecision
    ? self.DispatchRetry.getDispatchRetryDecision(attempt, error)
    : { shouldRetry: true, delayMs: DEFAULT_RETRY_DELAY_MS, classification: 'UNKNOWN' };
  entry.lastDispatchError = error || null;
  entry.lastDispatchErrorClass = decision.classification || 'UNKNOWN';
  if (!decision.shouldRetry) {
    entry.retryAfterAt = null;
    entry.dispatchAttempts = DISPATCH_MAX_ATTEMPTS;
    return;
  }
  entry.retryAfterAt = Date.now() + Math.max(0, decision.delayMs || DEFAULT_RETRY_DELAY_MS);
}

function sendMessageWithTimeout(tabId, llmName, message, timeoutMs = NO_FOCUS_TIMEOUT_MS) {
  return new Promise((resolve) => {
    if (!isValidTabId(tabId)) {
      resolve({ error: 'invalid_tab', requiresFocus: true });
      return;
    }
    let settled = false;
    let timer = null;
    // This timeout settles an in-flight request, rather than scheduling new
    // session work. Keep it alive across Stop so its focus lock can be released.
    timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      resolve({ timeout: true, requiresFocus: true });
    }, Math.max(0, timeoutMs));
    chrome.tabs.sendMessage(tabId, message, (response) => {
      if (settled) return;
      settled = true;
      if (timer) {
        clearTimeout(timer);
      }
      if (chrome.runtime.lastError) {
        const errMsg = chrome.runtime.lastError.message || 'send_failed';
        if (errMsg.includes('message port closed')) {
          emitTelemetry(llmName, 'PORT_CLOSED', {
            level: 'warning',
            details: errMsg,
            meta: {
              errorType: 'PORT_CLOSED',
              code: 'PORT_CLOSED',
              phase: 'dispatch_send',
              dispatchId: message?.meta?.dispatchId || null,
              tabId,
              messageType: message?.type || null,
              source: 'sendMessageWithTimeout'
            }
          });
        }
        resolve({ error: errMsg, requiresFocus: true });
        return;
      }
      resolve(response || { status: 'ok', requiresFocus: false });
    });
  });
}

function normalizePageReadyState(response = null) {
  const raw = response && typeof response === 'object' ? response : {};
  const status = String(raw.status || '').toLowerCase();
  const blockers = Array.isArray(raw.blockers)
    ? raw.blockers.map((item) => String(item || '').trim()).filter(Boolean)
    : [];
  const pageReady = typeof raw.pageReady === 'boolean'
    ? raw.pageReady
    : (typeof raw.ready === 'boolean' ? raw.ready : null);
  const composerReady = typeof raw.composerReady === 'boolean' ? raw.composerReady : null;
  const requiresFocus = raw.requiresFocus === true || raw.timeout === true || Boolean(raw.error);
  const blockerPolicy = self.PageBlockerPolicy?.classify
    ? self.PageBlockerPolicy.classify({ status, reason: raw.reason, blockers })
    : null;
  const terminalStatuses = new Set([
    'login_required',
    'captcha_required',
    'wrong_page',
    'page_not_ready',
    'not_ready',
    'blocked',
    'composer_missing',
    'composer_not_ready'
  ]);
  const terminalBlockers = new Set([
    'login_required',
    'captcha_required',
    'wrong_page',
    'page_not_ready',
    'composer_missing',
    'composer_not_ready',
    'unsupported_page'
  ]);

  let ok = true;
  let reason = 'ready';
  if (blockerPolicy?.blocker && blockerPolicy.terminal) {
    ok = false;
    reason = blockerPolicy.blocker;
  } else if (terminalStatuses.has(status)) {
    ok = false;
    reason = status;
  } else {
    const blocker = blockers.find((item) => terminalBlockers.has(item));
    if (blocker) {
      ok = false;
      reason = blocker;
    } else if (pageReady === false) {
      ok = false;
      reason = raw.reason || 'page_not_ready';
    } else if (composerReady === false && !requiresFocus) {
      ok = false;
      reason = raw.reason || 'composer_not_ready';
    }
  }

  return {
    ok,
    reason,
    status: status || null,
    requiresFocus,
    pageReady,
    composerReady,
    blockers,
    blockerPolicy,
    source: raw.source || null,
    raw
  };
}

function getSendPromptDelay(llmName) {
  return SEND_PROMPT_DELAY_OVERRIDES[llmName] || SEND_PROMPT_DELAY_MS;
}

function getRetryBackoffForModel(llmName) {
  const conservative = self.ModelPolicy?.modelUsesConservativeDispatch
    ? self.ModelPolicy.modelUsesConservativeDispatch(llmName)
    : CONSERVATIVE_MODELS.includes(llmName);
  if (conservative) {
    return CONSERVATIVE_RETRY_BACKOFF_MS;
  }
  return DISPATCH_RETRY_BACKOFF_MS;
}

function getConnectionRetryDelaysForModel(llmName) {
  const conservative = self.ModelPolicy?.modelUsesConservativeDispatch
    ? self.ModelPolicy.modelUsesConservativeDispatch(llmName)
    : CONSERVATIVE_MODELS.includes(llmName);
  if (conservative) {
    return CONSERVATIVE_CONNECTION_RETRY_DELAYS;
  }
  return CONNECTION_RETRY_DELAYS;
}

async function withPromptDispatchLock(llmName, fn) {
  const key = llmName || 'global';
  try {
    // A mutex timeout only rejects its caller; it does not cancel fn. Returning
    // after 30s let Round 2 begin while Round 1 was still queued for focus.
    // Individual browser/readiness operations own deadlines; await the actual
    // transaction here, including its time in the shared focus queue.
    return await dispatchMutexManager.withLock(key, fn, { timeoutMs: 0 });
  } catch (err) {
    console.error('[DISPATCH] lock fn failed', err);
    throw err;
  }
}

function withPromptDispatchFocusLock(fn) {
  const run = promptDispatchFocusMutex.then(() => fn());
  // The focus queue continues after a failure, but the caller still receives
  // the failure: resolving to undefined made an error look like success.
  promptDispatchFocusMutex = run.catch((err) => {
    console.warn('[DISPATCH] focus lock fn failed', err);
  });
  return run;
}

function resolvePromptSubmitted(llmName, payload = {}) {
  const dispatchId = payload?.dispatchId || payload?.meta?.dispatchId || null;
  if (!llmName || !dispatchId) return false;
  const modelWaiters = promptSubmitWaiters.get(llmName);
  const waiters = modelWaiters?.get?.(String(dispatchId));
  if (!waiters?.size) return false;
  waiters.forEach((cb) => {
    try { cb(payload); } catch (_) {}
  });
  waiters.clear();
  modelWaiters.delete(String(dispatchId));
  if (!modelWaiters.size) promptSubmitWaiters.delete(llmName);
  return true;
}

function createPromptSubmittedWaiter(llmName, dispatchId, timeoutMs = PROMPT_SUBMIT_TIMEOUT_MS) {
  let arm = () => false;
  let armAfter = () => false;
  const promise = new Promise((resolve) => {
    if (!llmName || !dispatchId) {
      resolve(false);
      return;
    }
    const modelWaiters = promptSubmitWaiters.get(llmName) || new Map();
    const waiterKey = String(dispatchId);
    const waiters = modelWaiters.get(waiterKey) || new Set();
    modelWaiters.set(waiterKey, waiters);
    promptSubmitWaiters.set(llmName, modelWaiters);
    const modelArms = promptSubmitWaiterArms.get(llmName) || new Map();
    promptSubmitWaiterArms.set(llmName, modelArms);
    let settled = false;
    let fallbackArmTimer = null;
    const done = (ok, payload) => {
      if (settled) return;
      settled = true;
      if (fallbackArmTimer) {
        clearTimeout(fallbackArmTimer);
        dispatchDeregisterSessionTimer(fallbackArmTimer);
        fallbackArmTimer = null;
      }
      if (timer) {
        clearTimeout(timer);
        dispatchDeregisterSessionTimer(timer);
        timer = null;
      }
      waiters.delete(handler);
      if (!waiters.size) modelWaiters.delete(waiterKey);
      if (!modelWaiters.size) promptSubmitWaiters.delete(llmName);
      modelArms.delete(waiterKey);
      if (!modelArms.size) promptSubmitWaiterArms.delete(llmName);
      resolve(ok ? (payload || true) : false);
    };
    const handler = (payload) => done(true, payload);
    waiters.add(handler);
    let timer = null;
    arm = () => {
      if (settled || timer) return false;
      if (fallbackArmTimer) {
        clearTimeout(fallbackArmTimer);
        dispatchDeregisterSessionTimer(fallbackArmTimer);
        fallbackArmTimer = null;
      }
      timer = dispatchRegisterSessionTimer(setTimeout(() => done(false), Math.max(0, timeoutMs)));
      return true;
    };
    armAfter = (delayMs) => {
      if (settled || timer || fallbackArmTimer) return false;
      fallbackArmTimer = dispatchRegisterSessionTimer(setTimeout(() => {
        dispatchDeregisterSessionTimer(fallbackArmTimer);
        fallbackArmTimer = null;
        arm();
      }, Math.max(0, Number(delayMs) || 0)));
      return true;
    };
    modelArms.set(waiterKey, arm);
  });
  return { promise, arm, armAfter };
}

function armPromptSubmittedWaiter(llmName, dispatchId) {
  const arm = promptSubmitWaiterArms.get(llmName)?.get?.(String(dispatchId));
  return typeof arm === 'function' ? arm() : false;
}

function waitForPromptSubmitted(llmName, dispatchId, timeoutMs = PROMPT_SUBMIT_TIMEOUT_MS) {
  const waiter = createPromptSubmittedWaiter(llmName, dispatchId, timeoutMs);
  waiter.arm();
  return waiter.promise;
}

function resolvePromptInsertion(llmName, payload = {}) {
  const dispatchId = payload?.dispatchId || payload?.meta?.dispatchId || null;
  if (!llmName || !dispatchId) return false;
  const modelWaiters = promptInsertionWaiters.get(llmName);
  const waiters = modelWaiters?.get?.(String(dispatchId));
  if (!waiters?.size) return false;
  waiters.forEach((cb) => {
    try { cb(payload); } catch (_) {}
  });
  waiters.clear();
  modelWaiters.delete(String(dispatchId));
  if (!modelWaiters.size) promptInsertionWaiters.delete(llmName);
  return true;
}

function waitForPromptInsertion(llmName, dispatchId, timeoutMs) {
  return new Promise((resolve) => {
    if (!llmName || !dispatchId) {
      resolve(false);
      return;
    }
    const modelWaiters = promptInsertionWaiters.get(llmName) || new Map();
    const waiterKey = String(dispatchId);
    const waiters = modelWaiters.get(waiterKey) || new Set();
    modelWaiters.set(waiterKey, waiters);
    promptInsertionWaiters.set(llmName, modelWaiters);
    let settled = false;
    const done = (payload) => {
      if (settled) return;
      settled = true;
      if (timer) {
        clearTimeout(timer);
        dispatchDeregisterSessionTimer(timer);
        timer = null;
      }
      waiters.delete(handler);
      if (!waiters.size) modelWaiters.delete(waiterKey);
      if (!modelWaiters.size) promptInsertionWaiters.delete(llmName);
      resolve(payload || false);
    };
    const handler = (payload) => done(payload);
    waiters.add(handler);
    let timer = null;
    timer = dispatchRegisterSessionTimer(setTimeout(
      () => done(false),
      Math.max(0, Number(timeoutMs) || 0)
    ));
  });
}

async function waitForPromptFocusBoundary(submitWaiter, insertionWaiter, holdMs) {
  const never = () => new Promise(() => {});
  return Promise.race([
    Promise.resolve(submitWaiter).then((payload) => (
      payload?.ok === true
        ? { reason: 'submit_confirmed', payload }
        : (payload ? { reason: 'submit_failed', payload } : never())
    )),
    Promise.resolve(insertionWaiter).then((payload) => (
      payload && payload.insertionState !== 'inserted'
        ? { reason: 'insertion_failed', payload }
        : never()
    )),
    dispatchSleepMs(Math.max(0, Number(holdMs) || 0)).then(() => ({ reason: 'hold_elapsed', payload: null }))
  ]);
}

function getPromptSubmitTimeoutMs(llmName) {
  if (!llmName) return PROMPT_SUBMIT_TIMEOUT_MS;
  if (self.ModelPolicy?.getPromptSubmitTimeoutMs) {
    return self.ModelPolicy.getPromptSubmitTimeoutMs(llmName, PROMPT_SUBMIT_TIMEOUT_MS);
  }
  return PROMPT_SUBMIT_TIMEOUT_MS;
}

function updateTypingStateFromDiagnostic(llmName, event) {
  if (!llmName) return;
  const entry = jobState?.llms?.[llmName];
  if (!entry || !event) return;
  const label = String(event.label || '').trim().toLowerCase();
  const ts = Number(event.ts) || Date.now();
  // A completion diagnostic is actionable even after an extraction failure was
  // provisionally made terminal. Runs such as 1784306613833 finalized DeepSeek
  // and Z.ai on an early empty/scaffolding scrape, then discarded the later
  // COMPLETE signal as generic post-terminal noise. Preserve the lifecycle
  // evidence and let the orchestrator re-read the now-stable page.
  if (label === 'answer_complete_detected') {
    const textLength = Number(event?.meta?.textLength || event?.textLength || 0) || 0;
    const eventDispatchId = event?.meta?.dispatchId || event?.dispatchId || null;
    const entryDispatchId = entry?.lastDispatchMeta?.dispatchId || entry?.confirmedDispatchId || null;
    const belongsToCurrentDispatch = !eventDispatchId
      || !entryDispatchId
      || String(eventDispatchId) === String(entryDispatchId);
    if (belongsToCurrentDispatch) {
      entry.lifecycleReadyAt = ts;
      entry.lifecycleReadyMeta = {
        ...(event?.meta || {}),
        state: 'COMPLETE',
        source: event?.source || 'diagnostic',
        event: 'ANSWER_COMPLETE_DETECTED'
      };
      entry.answerCompleteDetectedAt = ts;
      entry.answerCompleteTextLength = textLength;
      if (self.ModelRunState?.isTerminalRunState?.(entry)) {
        self.recoverTerminalFailureAfterLifecycle?.(llmName, {
          ts,
          textLength,
          dispatchId: entryDispatchId || eventDispatchId || null,
          source: event?.source || 'diagnostic'
        });
      }
    }
  }
  if (self.ModelRunState?.isTerminalRunState?.(entry)) {
    if (self.commitModelRunTransition) {
      self.commitModelRunTransition(llmName, entry, 'POST_TERMINAL_NOISE', {
        label: event?.label || event?.event || null,
        source: 'updateTypingStateFromDiagnostic_terminal',
        dispatchId: entry?.lastDispatchMeta?.dispatchId || null,
        tabId: entry?.tabId || null,
        runSessionId: jobState?.session?.startTime || null
      });
    } else {
      self.ModelRunState.recordPostTerminalNoise?.(entry, event);
    }
    saveJobState(jobState);
    return;
  }
  if (!label) return;
  markModelRuntimeActivity(llmName, ts, 'diagnostic');
  if (label === 'answer_complete_detected') {
    const textLength = Number(event?.meta?.textLength || event?.textLength || 0) || 0;
    entry.lifecycleReadyAt = ts;
    entry.lifecycleReadyMeta = {
      ...(event?.meta || {}),
      state: 'COMPLETE',
      source: event?.source || 'diagnostic',
      event: 'ANSWER_COMPLETE_DETECTED'
    };
    entry.answerCompleteDetectedAt = ts;
    entry.answerCompleteTextLength = textLength;
    if (self.commitModelRunTransition) {
      self.commitModelRunTransition(llmName, entry, 'LIFECYCLE_READY', {
        status: 'RECEIVING',
        source: 'answer_complete_detected_diagnostic',
        dispatchId: entry?.lastDispatchMeta?.dispatchId || null,
        tabId: entry?.tabId || null,
        runSessionId: jobState?.session?.startTime || null
      });
    } else if (self.ModelRunState?.applyModelRunTransition) {
      self.ModelRunState.applyModelRunTransition(entry, 'LIFECYCLE_READY', {
        status: 'RECEIVING',
        dispatchId: entry?.lastDispatchMeta?.dispatchId || null,
        tabId: entry?.tabId || null,
        runSessionId: jobState?.session?.startTime || null
      });
    }
    saveJobState(jobState);
    return;
  }
  if (llmName !== 'Claude') return;
  if (label.startsWith('typing start')) {
    entry.typingActive = true;
    entry.typingStartedAt = ts;
    entry.typingEndedAt = null;
    if (!entry.typingGuardUntil) {
      entry.typingGuardUntil = ts + CLAUDE_TYPING_TIMEOUT_MIN_MS;
    }
    entry.typingGuardReason = entry.typingGuardReason || 'diagnostic';
    saveJobState(jobState);
  } else if (label.startsWith('typing done')) {
    entry.typingActive = false;
    entry.typingEndedAt = ts;
    entry.typingGuardUntil = 0;
    entry.typingGuardReason = null;
    saveJobState(jobState);
  }
}

function isTypingGuardActive(entry) {
  if (!entry || !entry.typingActive) return false;
  const guardUntil = Number(entry.typingGuardUntil || 0);
  const now = Date.now();
  if (guardUntil && now > guardUntil) {
    entry.typingActive = false;
    entry.typingEndedAt = now;
    entry.typingGuardUntil = 0;
    entry.typingGuardReason = null;
    return false;
  }
  return true;
}

function isTerminalLlmEntry(entry) {
  if (!entry) return false;
  if (self.ModelRunState?.isTerminalRunState?.(entry)) return true;
  return TERMINAL_STATUSES.includes(entry.status)
    || Boolean(entry.finalStatusRecorded || entry.finalStatus);
}

function isTransientBlockerDispatchSuspended(llmName, entry, now = Date.now()) {
  const blocker = entry?.transientBlocker || null;
  if (llmName !== 'Perplexity' || blocker?.kind !== 'file_upload_paywall') return false;
  if (!['ARMED', 'ACTIVE', 'PROBING', 'RESUMING'].includes(String(blocker.phase || '').toUpperCase())) return false;
  const startedAt = Number(blocker.startedAt || blocker.armedAt || 0);
  if (!startedAt || now - startedAt > 120000) return false;
  const runSessionId = Number(jobState?.session?.startTime || 0) || null;
  const boundTabId = Number(resolveBoundTabIdForDispatch(llmName, entry) || 0) || null;
  return Number(blocker.runSessionId || 0) === Number(runSessionId || 0)
    && Number(blocker.tabId || 0) === Number(boundTabId || 0);
}

function hasPendingPromptDispatches() {
  if (!jobState?.llms) return false;
  return Object.keys(jobState.llms).some((llmName) => {
    const entry = jobState.llms[llmName];
    if (!entry) return false;
    if (isTerminalLlmEntry(entry)) return false;
    if (isTransientBlockerDispatchSuspended(llmName, entry)) return false;
    const flags = resolveDispatchFlags(llmName, entry);
    if (flags.isSent || flags.isInProgress || flags.isTerminal) return false;
    const boundTabId = resolveBoundTabIdForDispatch(llmName, entry);
    if (!isValidTabId(boundTabId)) return false;
    const attempts = entry.dispatchAttempts || 0;
    // The supervisor owns retries only. Initial dispatch remains exclusively
    // owned by Round 1; otherwise a stalled first provider causes the
    // supervisor to start every untouched model concurrently.
    const hasScheduledRetry = Number(entry.retryAfterAt || 0) > 0
      && entry.lastDispatchError != null;
    return attempts > 0 && attempts < DISPATCH_MAX_ATTEMPTS && hasScheduledRetry;
  });
}

function countPendingRetries() {
  if (!jobState?.llms) return 0;
  const now = Date.now();
  let count = 0;

  for (const llmName of Object.keys(jobState.llms)) {
    const entry = jobState.llms[llmName];
    if (!entry) continue;
    const flags = resolveDispatchFlags(llmName, entry);
    if (flags.isSent || flags.isInProgress) continue;
    if (isTerminalLlmEntry(entry)) continue;
    if (isTransientBlockerDispatchSuspended(llmName, entry, now)) continue;
    const busyUntil = Number(entry.csBusyUntil || 0);
    if (busyUntil && now < busyUntil) continue;
    const boundTabId = resolveBoundTabIdForDispatch(llmName, entry);
    if (!isValidTabId(boundTabId)) continue;
    const attempts = entry.dispatchAttempts || 0;
    if (attempts >= DISPATCH_MAX_ATTEMPTS || attempts === 0) continue;
    if (!(Number(entry.retryAfterAt || 0) > 0 && entry.lastDispatchError != null)) continue;
    if (isTypingGuardActive(entry)) continue;
    if (entry.retryAfterAt && now < entry.retryAfterAt) continue;

    const backoffArray = getRetryBackoffForModel(llmName);
    const backoff = backoffArray[Math.min(attempts, backoffArray.length - 1)] || 0;
    const lastAt = entry.lastDispatchAt || 0;
    if (now - lastAt >= backoff) {
      count++;
    }
  }

  return count;
}

function schedulePromptDispatchSupervisor() {
  if (promptDispatchSupervisorTimer) return;
  if (!hasPendingPromptDispatches()) return;

  const pendingRetries = countPendingRetries();
  const hasConservativePending = Object.keys(jobState?.llms || {}).some(llmName => {
    const entry = jobState.llms[llmName];
    if (!entry) return false;
    const flags = resolveDispatchFlags(llmName, entry);
    if (flags.isSent) return false;
    if (isTransientBlockerDispatchSuspended(llmName, entry)) return false;
    const conservative = self.ModelPolicy?.modelUsesConservativeDispatch
      ? self.ModelPolicy.modelUsesConservativeDispatch(llmName)
      : CONSERVATIVE_MODELS.includes(llmName);
    return conservative
      && (entry.dispatchAttempts || 0) > 0
      && Number(entry.retryAfterAt || 0) > 0
      && entry.lastDispatchError != null;
  });

  const adaptiveTick = (hasConservativePending || pendingRetries === 0)
    ? DISPATCH_SUPERVISOR_TICK_MS
    : 400;

  const timer = dispatchRegisterSessionTimer(setTimeout(() => {
    promptDispatchSupervisorTimer = null;
    dispatchDeregisterSessionTimer(timer);
    void runPromptDispatchSupervisor();
  }, adaptiveTick));
  promptDispatchSupervisorTimer = timer;
}

//-- 5.1. Supervisor: защита от конкуренции с Rounds --//
async function runPromptDispatchSupervisor() {
  if (!jobState?.llms) return;
  if (promptDispatchInProgress > 0) {
    schedulePromptDispatchSupervisor();
    return;
  }
  
  // Защита: не запускаем supervisor если Rounds ещё активны
  if (jobState?.session?.roundsInProgress === true) {
    globalThis.LLMLog?.debug?.('[SUPERVISOR] Waiting for rounds to complete');
    schedulePromptDispatchSupervisor();
    return;
  }
  const now = Date.now();
  for (const llmName of Object.keys(jobState.llms)) {
    const entry = jobState.llms[llmName];
    if (!entry) continue;
    const flags = resolveDispatchFlags(llmName, entry);
    if (flags.isSent || flags.isInProgress) continue;
    if (isTerminalLlmEntry(entry)) continue;
    if (isTransientBlockerDispatchSuspended(llmName, entry, now)) continue;
    const busyUntil = Number(entry.csBusyUntil || 0);
    if (busyUntil && now < busyUntil) continue;
    const tabId = resolveBoundTabIdForDispatch(llmName, entry);
    if (!isValidTabId(tabId)) continue;
    const attempts = entry.dispatchAttempts || 0;
    if (attempts <= 0 || attempts >= DISPATCH_MAX_ATTEMPTS) continue;
    if (!(Number(entry.retryAfterAt || 0) > 0 && entry.lastDispatchError != null)) continue;
    if (attempts > 0 && isTypingGuardActive(entry)) continue;
    if (entry.retryAfterAt && now < entry.retryAfterAt) continue;
    if (entry.recoveryDeniedUntil && now < entry.recoveryDeniedUntil) continue;
    const backoffArray = getRetryBackoffForModel(llmName);
    const backoff = backoffArray[Math.min(attempts, backoffArray.length - 1)] || 0;
    const lastAt = entry.lastDispatchAt || 0;
    if (now - lastAt < backoff) continue;
    //-- 2.1. Retry supervisor с удержанием фокуса --//
    // One retry transaction at a time. Starting all eligible retries in the
    // same tick replaces dispatch identities before older provider signals can
    // be correlated and turns valid confirmations into dispatch_mismatch.
    // Resend the exact per-model prompt (role, delivery token), never the
    // shared fallback prompt.
    await dispatchPromptToTab(llmName, tabId, resolvePromptForDispatch(llmName, jobState.prompt), jobState.attachments || [], 'retry_supervisor', {
      deferSendMs: 500,
      minFocusHoldMs: RETRY_FOCUS_HOLD_MS
    });
    break;
  }
  schedulePromptDispatchSupervisor();
}

// Reused documents can outlive the extension runtime. Restore the selected
// document inside its ordered foreground slot.
async function prepareReusableTabReceiver(tabId, llmName, current) {
  const startedAt = Date.now();
  const deadline = startedAt + 20000;
  let reloaded = false;
  let reloadError = null;
  let reloadAcknowledged = false;
  let tabLookup = null;
  let lookupTimedOut = false;
  const probe = () => new Promise(resolve => {
    let settled = false;
    let cancelTimer;
    const done = value => {
      if (settled) return;
      settled = true; clearTimeout(timer); clearTimeout(cancelTimer); resolve(value);
    };
    // One slow but valid PONG must remain usable. Repeated 750ms probes used
    // to discard every response from a busy renderer, even inside this budget.
    const timer = setTimeout(() => done('timeout'), Math.max(0, deadline - Date.now()));
    const checkCancellation = () => {
      if (!current()) return done('cancelled');
      cancelTimer = setTimeout(checkCancellation, 100);
    };
    checkCancellation();
    if (settled) return;
    try {
      chrome.tabs.sendMessage(tabId, {type:'HEALTH_CHECK_PING'}, response => {
        const error = chrome.runtime.lastError?.message || '';
        done(error.includes('Receiving end does not exist') ? 'missing'
          : response?.type === 'HEALTH_CHECK_PONG' && (!response.llmName || response.llmName === llmName)
            ? 'ready' : 'unavailable');
      });
    } catch (_) { done('unavailable'); }
  });
  const finish = reason => {
    const result = {ok:reason === 'ready', reason, tabId, reloaded, reloadAcknowledged, reloadError};
    emitTelemetry(llmName, 'REUSED_TAB_RECEIVER_PREPARED', {
      details:reason, meta:{...result, durationMs:Date.now()-startedAt}, force:true
    });
    return result;
  };
  while (current() && Date.now() < deadline) {
    if (reloadError) return finish('reload_failed');
    const state = await probe();
    if (!current()) return finish('session_changed');
    if (state === 'ready') return finish('ready');
    if (reloadError) return finish('reload_failed');
    if (state === 'missing' && !reloaded) {
      let tabTimer;
      // A slow tabs.get is unknown, not proof that the conversation is invalid.
      // Keep the same lookup in flight; never accumulate abandoned API calls.
      if (!tabLookup) tabLookup = getTabSafe(tabId);
      const tab = await Promise.race([tabLookup,
        new Promise(resolve => { tabTimer = setTimeout(() => resolve(undefined), 1000); })
      ]).finally(() => clearTimeout(tabTimer));
      if (!current()) return finish('session_changed');
      if (tab === undefined) {
        lookupTimedOut = true;
        await dispatchSleepMs(250);
        continue;
      }
      tabLookup = null;
      lookupTimedOut = false;
      if (!tab) return finish('tab_missing');
      if (!isEligibleTabForLlm(llmName, tab)) return finish('tab_ineligible');
      // A navigation already in flight will install the manifest naturally.
      // Reload only a settled orphan document; never navigate to a new chat.
      if (tab.status === 'complete') {
        reloaded = true;
        // Request once, then observe the receiver. The reload callback is an
        // acknowledgement, not a deadline for the page to become usable.
        try {
          chrome.tabs.reload(tabId, {}, () => {
            const error = chrome.runtime.lastError?.message;
            reloadAcknowledged = !error;
            if (error) reloadError = error;
          });
        } catch (err) { reloadError = err?.message || 'reload_exception'; }
        if (reloadError) return finish('reload_failed');
      }
    }
    await dispatchSleepMs(250);
  }
  return finish(current() ? (lookupTimedOut ? 'tab_lookup_timeout' : 'receiver_timeout') : 'session_changed');
}

async function dispatchSimpleFirstPass(llmName, tabId, prompt, attachments, entry, options, machine) {
  const meta = { ...entry.lastDispatchMeta, simpleFirstPass: true };
  const current = () => jobState?.session?.startTime === meta.runSessionId
    && jobState?.llms?.[llmName] === entry && entry.lastDispatchMeta?.dispatchId === meta.dispatchId;
  const pause = async ms => {
    const end = Date.now() + ms;
    while (current() && Date.now() < end) await dispatchSleepMs(Math.min(100, end - Date.now()));
  };
  const defer = reason => {
    if (current()) {
      entry.firstPassResult = {dispatchId: meta.dispatchId, outcome: reason, commandAt: null, finishedAt: Date.now()};
      machine?.error?.({code: 'ROUND1_DEFERRED', error: reason});
      emitTelemetry(llmName, 'ROUND1_SIMPLE_DISPATCH_RESULT', {
        details: reason,
        meta: {...meta, tabId, stage: 'first_pass_deferred', outcome: reason, commandIssued: false},
        force: true
      });
    }
    return {ok: false, deferred: true, reason};
  };
  const hasAttachments = Boolean(attachments?.length);
  entry.dispatchCheckpoint = {dispatchId: meta.dispatchId, phase: 'command_intent'};
  // Persist only command ownership here. Full job snapshots can be queued
  // behind active generation writes and must not prevent a ready page sending.
  const durable = self.DispatchIntentStore.persist(llmName, tabId, entry);
  return withPromptDispatchFocusLock(async () => {
    if (!current()) return {ok: false, reason: 'session_changed'};
    const activation = await activateTabForDispatch(tabId, 'round1_simple', {allowUnconfirmed: true});
    if (activation !== true && activation !== 'unconfirmed') {
      return defer('focus_unavailable');
    }
    const visitStartedAt = Date.now();
    const [, preparation] = await Promise.all([
      pause(Number(options.deferSendMs ?? 2000)),
      prepareReusableTabReceiver(tabId, llmName, current)
    ]);
    if (!current()) return {ok: false, reason: 'session_changed'};
    entry.receiverPreparation = preparation;
    if (!preparation.ok) return defer(preparation.reason || 'receiver_unavailable');
    // Focus and editor settling overlap the write; ordinary storage latency
    // adds no extra pause. Still require ownership to be durable before Send.
    if (!await durable || !current()) return defer('checkpoint_not_ready');
    machine?.ready?.();
    const commandAt = Date.now();
    let deliveryError = null;
    // Exactly one prompt delivery after transport preparation; no send retry.
    // Provider-specific editing remains in the existing page adapter.
    try {
      chrome.tabs.sendMessage(tabId, {type: 'GET_ANSWER', prompt, attachments, meta}, response => {
        const runtimeError = chrome.runtime.lastError?.message;
        if (!current()) return;
        if (runtimeError) deliveryError = runtimeError;
        else if (response?.accepted === false) deliveryError = response.reason || 'command_rejected';
        else if (response?.accepted === true && response.dispatchId === meta.dispatchId) {
          entry.lastCommandAcceptedAt = Date.now();
          entry.lastCommandAcceptedDispatchId = meta.dispatchId;
        }
      });
    } catch (error) { deliveryError = error?.message || 'delivery_failed'; }
    const sendObserved = () => entry.providerSendActionObservedDispatchId === meta.dispatchId
      || entry.confirmedDispatchId === meta.dispatchId
      || (entry.promptSubmittedAt && entry.lastDispatchMeta?.dispatchId === meta.dispatchId);
    const failed = () => entry.providerDispatchStageDispatchId === meta.dispatchId
      && /failed|blocked/.test(entry.providerDispatchStage || '');
    // Upload belongs to the initial ordered pass, not the globally budgeted
    // repair round. The provider adapter retains its upload-before-Send gate.
    // Hold this tab while it prepares the attachment, without issuing another
    // command. A stalled upload cannot starve all subsequent models.
    if (hasAttachments) {
      const uploadDeadline = commandAt + 60000;
      while (current() && !sendObserved() && !failed() && !deliveryError && Date.now() < uploadDeadline) {
        await pause(Math.min(100, uploadDeadline - Date.now()));
      }
    }
    // Text-only visits retain their fixed slot. Attachment visits allow five
    // seconds after the upload/send stage, while Round 1 still owns the queue.
    const leaveAt = (hasAttachments ? Date.now() : commandAt) + Number(options.postSendMs ?? 5000);
    await pause(Math.max(0, leaveAt - Date.now()));
    if (!current()) return {ok: false, reason: 'session_changed'};
    const attempted = Boolean(sendObserved());
    const outcome = attempted ? 'send_attempt_observed' : (deliveryError || (failed() ? 'provider_failed' : 'send_unconfirmed'));
    if (!entry.promptSubmittedAt) {
      entry.awaitingSubmitConfirmation = true;
      entry.awaitingSubmitConfirmationAt = Date.now();
      entry.awaitingSubmitConfirmationDispatchId = meta.dispatchId;
    }
    entry.firstPassResult = {dispatchId: meta.dispatchId, outcome, commandAt, finishedAt: Date.now()};
    // Content may already have advanced the machine to WAITING/STREAMING.
    // Closing a foreground slot must not rewind a successful submission.
    if (machine?.is?.(self.DISPATCH_STATES?.TYPING)) {
      if (attempted) machine.submit();
      else machine.error({code: 'ROUND1_DEFERRED', error: outcome});
    }
    emitTelemetry(llmName, 'ROUND1_SIMPLE_DISPATCH_RESULT', {
      details: outcome,
      meta: {...meta, tabId, stage: 'first_pass_finished', outcome, commandIssued: true, visitMs: Date.now() - visitStartedAt, commandAt, leaveAt},
      force: true
    });
    return {ok: attempted, deferred: !attempted, dispatchId: meta.dispatchId, reason: outcome};
  });
}

async function dispatchPromptToTab(llmName, tabId, prompt, attachments = [], reason = 'auto', options = {}) {
  if (!llmName || !isValidTabId(tabId) || !prompt) return;
  const entry = jobState?.llms?.[llmName];
  if (!entry) return;
  const capturedSessionId = jobState?.session?.startTime || null;
  const isCurrentDispatchContext = () => (!capturedSessionId || jobState?.session?.startTime === capturedSessionId)
    && jobState?.llms?.[llmName] === entry;
  const recoveryDispatch = ['retry_supervisor', 'round2_repair', 'round2_repair_pre_visit'].includes(reason);
  if (recoveryDispatch && isProviderPipelineOwnershipActive(entry)) {
    emitTelemetry(llmName, 'DISPATCH_DEFERRED_PROVIDER_PIPELINE_ACTIVE', {
      level: 'info',
      details: reason,
      meta: {
        tabId,
        dispatchReason: reason,
        providerPipelineDispatchId: entry.providerPipelineDispatchId || null,
        providerPipelineActiveAt: entry.providerPipelineActiveAt || null
      },
      force: true
    });
    return { ok: false, deferred: true, reason: 'provider_pipeline_active' };
  }
  if (reason !== 'perplexity_paywall_resume'
    && isTransientBlockerDispatchSuspended(llmName, entry)) {
    return { ok: false, deferred: true, reason: 'transient_blocker_active' };
  }
  const currentDispatchId = entry?.lastDispatchMeta?.dispatchId || null;
  const currentProviderStage = String(entry?.providerDispatchStage || '');
  if (recoveryDispatch
    && currentDispatchId
    && entry.providerSendActionObservedDispatchId === currentDispatchId
    && currentProviderStage !== 'send_action_failed'
    && !entry.promptSubmittedAt) {
    emitTelemetry(llmName, 'DISPATCH_DEFERRED_SEND_ACTION_OBSERVED', {
      level: 'info',
      details: reason,
      meta: { tabId, dispatchReason: reason, dispatchId: currentDispatchId, providerStage: currentProviderStage || null },
      force: true
    });
    return { ok: false, deferred: true, reason: 'send_action_pending_confirmation' };
  }
  const recoveryIntent = options.recoveryIntent || (
    reason === 'manual_resend' || reason === 'round2_repair'
      ? 'resend_prompt'
      : (reason === 'retry_supervisor' ? 'resend_prompt' : null)
  );
  if (recoveryIntent && self.RecoveryIntent?.authorize) {
    const intentDecision = self.RecoveryIntent.authorize(entry, {
      intent: recoveryIntent,
      reason,
      minChars: self.AnswerLengthPolicy?.getPolicy?.(llmName)?.minTerminalChars
        || self.DOM_SNAPSHOT_RECOVERY_MIN_CHARS
        || 80,
      explicitUserOverride: options.explicitUserOverride === true,
      allowAfterEvidence: options.allowAfterEvidence === true
    });
    entry.lastRecoveryIntentDecision = {
      ...intentDecision,
      reasonLabel: reason,
      decidedAt: Date.now()
    };
    if (!intentDecision.ok) {
      // Back the entry off so periodic callers (retry_supervisor) stop re-attempting
      // and re-emitting this denial on every tick while answer-evidence persists.
      const nowTs = Date.now();
      entry.recoveryDeniedUntil = nowTs + RECOVERY_DENY_BACKOFF_MS;
      const denialSignature = `${intentDecision.intent}:${intentDecision.reason}`;
      const alreadyDenied = entry.lastRecoveryDeniedSignature === denialSignature
        && entry.lastRecoveryDeniedAt
        && (nowTs - entry.lastRecoveryDeniedAt) < RECOVERY_DENY_BACKOFF_MS;
      entry.lastRecoveryDeniedSignature = denialSignature;
      entry.lastRecoveryDeniedAt = nowTs;
      self.DecisionLedger?.append?.(entry, {
        decision: 'deny_recovery_intent',
        reason: intentDecision.reason || 'recovery_intent_denied',
        source: 'dispatchPromptToTab',
        inputs: { tabId, dispatchReason: reason, intentDecision },
        resultingState: entry.finalStatus || entry.status || 'open'
      });
      // Suppress duplicate telemetry within the backoff window: emit only on the
      // first denial of a given signature, not once per tick.
      if (!alreadyDenied) {
        emitTelemetry(llmName, 'RECOVERY_INTENT_DENIED', {
          level: 'warning',
          details: denialSignature,
          meta: { tabId, dispatchReason: reason, intentDecision },
          force: true
        });
        broadcastDiagnostic(llmName, {
          type: 'RECOVERY',
          label: 'Recovery intent denied',
          details: denialSignature,
          level: 'warning',
          meta: { tabId, dispatchReason: reason, intentDecision }
        });
      }
      return;
    }
  }
  // A retry-supervisor timer may fire after the content adapter has already
  // confirmed the submit. Check ownership before the health probe: the old
  // order pinged first, reloaded an apparently unresponsive provider page on
  // attempt 2, and only then noticed flags.isSent and returned. That destroyed
  // a live Gemini generation without ever resending the prompt.
  const preHealthFlags = resolveDispatchFlags(llmName, entry);
  if (isTerminalLlmEntry(entry)) return;
  if (preHealthFlags.isSent || preHealthFlags.isInProgress) {
    emitTelemetry(llmName, 'PRE_DISPATCH_RECOVERY_SKIPPED', {
      level: 'info',
      details: preHealthFlags.isSent ? 'submission_already_confirmed' : 'dispatch_in_progress',
      meta: {
        tabId,
        dispatchReason: reason,
        dispatchId: entry?.confirmedDispatchId || entry?.lastDispatchMeta?.dispatchId || null
      },
      force: true
    });
    return;
  }
  //-- 1.1. Быстрая проверка связи перед захватом фокуса (без агрессивного reload в Round1) --//
  const isAlive = options.simpleFirstPass === true || await new Promise(r => {
    chrome.tabs.sendMessage(tabId, { type: 'HEALTH_CHECK_PING' }, resp => {
      if (chrome.runtime.lastError || !resp) r(false); else r(true);
    });
    setTimeout(() => r(false), 1000);
  });
  if (!isAlive) {
    const attempts = Number(entry.dispatchAttempts || 0);
    const allowPreDispatchReload = reason === 'retry_supervisor' && attempts >= 2;
    emitTelemetry(llmName, 'PRE_DISPATCH_HEALTH_PING_FAIL', {
      level: 'warning',
      details: allowPreDispatchReload ? 'reload_attempted' : 'reload_skipped',
      meta: { tabId, reason, attempts, allowPreDispatchReload }
    });
    // The health ping took up to a second: a submit confirmation or a new
    // generation may have arrived meanwhile. Re-check right before the reload;
    // reloading a tab that already received the prompt destroys the answer.
    const reloadFlags = resolveDispatchFlags(llmName, entry);
    const reloadStillSafe = isCurrentDispatchContext()
      && !isTerminalLlmEntry(entry)
      && !reloadFlags.isSent
      && !reloadFlags.isInProgress
      && !entry.promptSubmittedAt
      && !isProviderPipelineOwnershipActive(entry);
    if (allowPreDispatchReload && !reloadStillSafe) {
      emitTelemetry(llmName, 'PRE_DISPATCH_RELOAD_SKIPPED', {
        level: 'info',
        details: 'state_changed_during_health_ping',
        meta: { tabId, reason, attempts },
        force: true
      });
      return;
    }
    if (allowPreDispatchReload) {
      console.warn(`[Dispatch] Tab ${tabId} unresponsive, retry path will reload before send (${llmName})`);
      await new Promise((resolve) => chrome.tabs.reload(tabId, {}, () => setTimeout(resolve, 1200)));
    } else {
      console.warn(`[Dispatch] Tab ${tabId} health ping failed for ${llmName}, continuing without pre-dispatch reload`);
    }
  }
  if (!isCurrentDispatchContext()) return;
  const pipelineRunId = jobState?.session?.pipelineRunId || jobState?.session?.pipelineControl?.pipelineRunId || null;
  const flags = resolveDispatchFlags(llmName, entry);
  if (isTerminalLlmEntry(entry)) return;
  if (reason === 'retry_supervisor' && isTypingGuardActive(entry)) return;
  const busyUntil = Number(entry.csBusyUntil || 0);
  if (busyUntil && Date.now() < busyUntil) return;
  if (flags.isSent) return;
  if (flags.isInProgress) return;
  const circuitState = self.DispatchCircuit?.canDispatchWithCircuit
    ? self.DispatchCircuit.canDispatchWithCircuit(llmName)
    : { ok: true, retryAfterMs: 0 };
  if (!circuitState.ok) {
    updateModelState(llmName, 'CIRCUIT_OPEN', { message: 'Dispatch circuit open', retryAfterMs: circuitState.retryAfterMs });
    broadcastDiagnostic(llmName, {
      type: 'DISPATCH',
      label: 'Circuit breaker OPEN',
      details: `${circuitState.retryAfterMs}ms`,
      level: 'warning'
    });
    // An open circuit on the first attempt used to return silently: the retry
    // supervisor only picks up entries with attempts > 0 and a recorded error,
    // so the model hung until the panel deadline. Record an explicit, retryable
    // state instead; the next attempt re-checks the circuit.
    entry.lastDispatchError = { type: 'circuit_open', retryAfterMs: circuitState.retryAfterMs || 0 };
    entry.lastDispatchErrorClass = 'CIRCUIT_OPEN';
    entry.retryAfterAt = Date.now() + Math.max(1000, Number(circuitState.retryAfterMs || 0));
    entry.dispatchAttempts = Math.max(1, Number(entry.dispatchAttempts || 0));
    schedulePromptDispatchSupervisor();
    return { ok: false, deferred: true, reason: 'circuit_open' };
  }

  entry.dispatchAttempts = (entry.dispatchAttempts || 0) + 1;
  entry.dispatchQueuedAt = Date.now();
  const sessionId = jobState?.session?.startTime || Date.now();
  const dispatchId = `${llmName}:${sessionId}:${entry.dispatchAttempts || 0}`;
  const registryResult = self.DispatchIdRegistry?.registerDispatchId
    ? self.DispatchIdRegistry.registerDispatchId(dispatchId, { llmName, tabId, reason })
    : { ok: true };
  if (!registryResult.ok) {
    if (registryResult.reason === 'already_confirmed') {
      console.warn(`[DISPATCH] Duplicate dispatch blocked for ${llmName} (${dispatchId})`);
      emitTelemetry(llmName, 'DUPLICATE_DISPATCH_BLOCKED', {
        level: 'warning',
        details: dispatchId,
        meta: { dispatchId, reason }
      });
      return { ok: false, errorCode: 'DUPLICATE_DISPATCH' };
    }
    broadcastDiagnostic(llmName, {
      type: 'DISPATCH',
      label: 'Dispatch skipped (duplicate)',
      details: registryResult.reason || 'duplicate',
      level: 'warning',
      meta: { dispatchId }
    });
    return;
  }
  if (flags.machine) {
    if (flags.machine.is(self.DISPATCH_STATES?.ERROR)) {
      flags.machine.reset();
    }
    flags.machine.queue({
      prompt,
      attachments,
      dispatchId,
      dispatchAttempts: entry.dispatchAttempts
    });
  }
  saveJobState(jobState);

  return withPromptDispatchLock(llmName, async () => {
    if (capturedSessionId && jobState?.session?.startTime !== capturedSessionId) {
      return;
    }
    promptDispatchInProgress += 1;
    stopHumanPresenceLoop();
    const lockAcquiredAt = Date.now();
    const machine = resolveDispatchFlags(llmName, entry).machine;
  entry.generationEpoch = Number(entry.generationEpoch || 0) + 1;
  const attemptId = `${dispatchId}:generation:${entry.generationEpoch}`;
  const dispatchIdentityMeta = {
    runSessionId: sessionId,
    dispatchId,
    generationEpoch: entry.generationEpoch,
    attemptId
  };
  entry.lastDispatchAt = Date.now();
  entry.lastDispatchMeta = { dispatchReason: reason, sessionId, ...dispatchIdentityMeta };
  entry.dispatchCheckpoint = { dispatchId, phase: 'preparing' };
  entry.answerVerification = null;
  if (self.AnswerVerification?.appendTimeline) {
    self.AnswerVerification.appendTimeline(entry, {
      stage: 'command', state: 'dispatch_created', runSessionId: sessionId, dispatchId,
      generationEpoch: entry.generationEpoch, tabId, source: reason,
      details: { attempt: entry.dispatchAttempts || 0 }
    });
  }
  if (self.RunIdentity?.build) {
    entry.runIdentity = self.RunIdentity.build({
      runSessionId: sessionId,
      dispatchId,
      tabId,
      prompt
    });
  }
  entry.dispatchSource = 'web';
  entry.pipelineRunId = pipelineRunId || entry.pipelineRunId || null;
  entry.recentDispatchIds = Array.isArray(entry.recentDispatchIds) ? entry.recentDispatchIds : [];
  entry.recentDispatchIds = [...entry.recentDispatchIds.filter(Boolean), dispatchId].slice(-8);
  if (self.PipelineFSM?.registerDispatch) {
    const currentControl = typeof self.getActivePipelineControlState === 'function'
      ? self.getActivePipelineControlState()
      : (jobState?.session?.pipelineControl || null);
    const seedState = currentControl || (self.PipelineFSM.createState ? self.PipelineFSM.createState({ pipelineRunId, sessionId }) : null);
    if (seedState) {
      const nextControl = self.PipelineFSM.registerDispatch(seedState, {
        llmName,
        dispatchId,
        tabId,
        tabSessionId: null,
        pipelineRunId,
        sessionId,
        stage: reason,
        reason: 'dispatch_registered'
      });
      if (typeof self.persistPipelineControlState === 'function') {
        self.persistPipelineControlState(nextControl);
      }
    }
  }
  if (!options.simpleFirstPass) await saveJobState(jobState);
    let submitTimeoutMs = getPromptSubmitTimeoutMs(llmName);
    if (llmName === 'Claude' && !options.skipTypingGuard) {
      const promptLength = String(prompt || '').length;
      const typingBudget = CLAUDE_TYPING_TIMEOUT_PER_CHAR_MS * promptLength;
      const computed = Math.round(20000 + typingBudget);
      submitTimeoutMs = Math.max(
        submitTimeoutMs,
        Math.min(CLAUDE_TYPING_TIMEOUT_MAX_MS, Math.max(CLAUDE_TYPING_TIMEOUT_MIN_MS, computed))
      );
      entry.typingActive = true;
      entry.typingStartedAt = Date.now();
      entry.typingEndedAt = null;
      entry.typingGuardUntil = Date.now() + submitTimeoutMs;
      entry.typingGuardReason = 'typing_budget';
    }
  const queueWaitMs = entry.dispatchQueuedAt ? Math.max(0, lockAcquiredAt - entry.dispatchQueuedAt) : null;
  const lastTabState = (() => {
    const cache = self.__TAB_STATE_CACHE__;
    return cache && cache.get ? cache.get(tabId) : null;
  })();
  const visibilityState = lastTabState?.visibilityState ?? null;
  const hasFocus = typeof lastTabState?.hasFocus === 'boolean' ? lastTabState.hasFocus : null;
  emitTelemetry(llmName, 'DISPATCH_LOCK_ACQUIRE', {
    details: queueWaitMs !== null ? `${queueWaitMs}ms` : '',
    meta: { queueWaitMs, ...dispatchIdentityMeta, dispatchReason: reason, attempt: entry.dispatchAttempts, visibilityState, hasFocus }
  });
  emitTelemetry(llmName, 'DISPATCH_START', {
    meta: { ...dispatchIdentityMeta, dispatchReason: reason, attempt: entry.dispatchAttempts, visibilityState, hasFocus }
  });
    try {
      if (machine) {
        machine.activate({ tabId });
      }
      if (options.simpleFirstPass) {
        return await dispatchSimpleFirstPass(llmName, tabId, prompt, attachments, entry, options, machine);
      }
      const tabReadyStartedAt = Date.now();
      const readiness = await ensureTabReadyForDispatch(tabId, llmName, { reason });
      const tabReadyMs = Date.now() - tabReadyStartedAt;
      let ackWaitMs = 0;
      let noFocusProbeMs = 0;
      if (!readiness.ok) {
        broadcastDiagnostic(llmName, {
          type: 'DISPATCH',
          label: 'Tab not ready for dispatch',
          details: readiness.reason || 'unknown',
          level: 'warning',
          meta: { snapshot: readiness.snapshot || null, dispatchId, dispatchReason: reason }
        });
        if (machine) {
          machine.error({ error: readiness.reason || 'tab_not_ready', code: 'TAB_NOT_READY' });
        }
        return;
      }
      broadcastDiagnostic(llmName, {
        type: 'DISPATCH',
        label: 'Dispatch tab activation',
        details: reason,
        level: 'info',
        meta: { snapshot: readiness.snapshot || null, dispatchId, dispatchReason: reason }
      });
      let waiter = null;
      let waiterController = null;
      let insertionWaiter = null;
      const shouldBypassAck = self.ModelPolicy?.modelRequiresAckReady
        ? !self.ModelPolicy.modelRequiresAckReady(llmName)
        : llmName === 'Perplexity';
      let readyOk = true;
      const ackWaitStartedAt = Date.now();
      if (shouldBypassAck) {
        emitTelemetry(llmName, 'PERPLEXITY_ACK_BYPASS', {
          details: 'skip ACK_READY wait',
          meta: { dispatchId, dispatchReason: reason, tabId }
        });
      } else {
        // SCRIPT_READY is a tab/runtime capability, not a per-dispatch
        // transaction. Requiring a replayed two-way handshake here cost six
        // seconds on every hidden provider tab. Probe/repair Completion directly
        // and use the provider's synchronous health PONG; exact dispatch
        // ownership is proven later by COMMAND_ACCEPTED.
        const runtimeGate = typeof self.ensureCompletionRuntimeInTab === 'function'
          ? await self.ensureCompletionRuntimeInTab(tabId, llmName)
          : null;
        const adapterHealthy = runtimeGate?.ok === true && typeof self.checkScriptHealth === 'function'
          ? await self.checkScriptHealth(tabId, llmName, { silent: true, timeoutMs: READY_ACK_TIMEOUT_MS })
          : false;
        readyOk = runtimeGate?.ok === true && adapterHealthy === true;
        if (!readyOk && runtimeGate == null) {
          readyOk = await waitForScriptReady(tabId, llmName, { timeoutMs: READY_ACK_TIMEOUT_MS, intervalMs: 250 });
        }
      }
      if (!readyOk) {
        broadcastDiagnostic(llmName, {
          type: 'DISPATCH',
          label: 'ACK_READY not received',
          details: `${READY_ACK_TIMEOUT_MS}ms`,
          level: 'warning',
          meta: { dispatchId, dispatchReason: reason }
        });
        const timeoutTab = await (self.getTabSafe ? self.getTabSafe(tabId) : null);
        const timeoutSnapshot = self.buildTabSnapshot ? self.buildTabSnapshot(timeoutTab) : null;
        const timeoutTiming = self.buildTabTimingMeta ? self.buildTabTimingMeta(timeoutSnapshot) : {};
        emitTelemetry(llmName, 'HANDSHAKE_TIMEOUT', {
          level: 'warning',
          details: `${READY_ACK_TIMEOUT_MS}ms`,
          meta: {
            errorType: 'HANDSHAKE_TIMEOUT',
            code: 'HANDSHAKE_TIMEOUT',
            phase: 'handshake',
            dispatchId,
            dispatchReason: reason,
            tabId,
            timeoutMs: READY_ACK_TIMEOUT_MS,
            snapshot: timeoutSnapshot || null,
            ...timeoutTiming
          }
        });
        let recoveryOk = false;
        let recoveryAction = null;
        if (self.reinjectScript) {
          recoveryAction = 'reinject_script';
          recoveryOk = await self.reinjectScript(tabId, llmName);
        } else if (self.reloadTab) {
          recoveryAction = 'reload_tab';
          recoveryOk = await self.reloadTab(tabId);
        }
        if (recoveryAction) {
          emitTelemetry(llmName, 'RECOVERY_ACTION', {
            level: recoveryOk ? 'info' : 'warning',
            details: recoveryOk ? 'ok' : 'failed',
            meta: {
              errorType: 'RECOVERY_ACTION',
              code: 'RECOVERY_ACTION',
              phase: 'handshake',
              dispatchId,
              dispatchReason: reason,
              tabId,
              action: recoveryAction,
              ok: recoveryOk
            }
          });
        }
        if (recoveryOk) {
          broadcastDiagnostic(llmName, {
            type: 'DISPATCH',
            label: 'ACK_READY recovery attempt',
            details: 'reinject/reload completed',
            level: 'info',
            meta: { dispatchId, dispatchReason: reason }
          });
          emitTelemetry(llmName, 'ACK_READY_RECOVERY_OK', {
            details: 'reinject/reload completed',
            meta: { dispatchId, dispatchReason: reason, tabId }
          });
          readyOk = await waitForScriptReady(tabId, llmName, { timeoutMs: READY_ACK_TIMEOUT_MS, intervalMs: 250 });
        }
        if (!readyOk) {
          scheduleDispatchRetry(entry, llmName, { type: 'ack_timeout' });
          if (self.DispatchCircuit?.recordDispatchFailure) {
            self.DispatchCircuit.recordDispatchFailure(llmName, { type: 'ack_timeout' });
          }
          if (llmName === 'Perplexity' && entry) {
            entry.retryAfterAt = Date.now();
            emitTelemetry(llmName, 'PERPLEXITY_ACK_RETRY', {
              details: 'forced immediate retry',
              meta: { dispatchId, retryAt: entry.retryAfterAt }
            });
          }
          return;
        }
      }

      ackWaitMs = Date.now() - ackWaitStartedAt;

      const readyInfo = self.ReadySignalManager?.getReadyInfo
        ? self.ReadySignalManager.getReadyInfo(tabId)
        : null;
      const dispatchSendPayload = {
        type: 'SMART_DISPATCH_SEND',
        llmName,
        tabId,
        dispatchId,
        dispatchAt: Date.now(),
        tabSessionId: readyInfo?.tabSessionId || null
      };
      try {
        if (typeof sendMessageToResultsTab === 'function') {
          sendMessageToResultsTab(dispatchSendPayload);
        }
      } catch (_) {}

      let needsFocus = false;
      let noFocusResponse = null;
      if (options.skipNoFocusProbe) {
        needsFocus = true;
      } else {
        const noFocusStartedAt = Date.now();
        noFocusResponse = await sendMessageWithTimeout(tabId, llmName, {
          type: 'GET_ANSWER_NO_FOCUS',
          prompt,
          attachments,
          meta: {
            dispatchReason: reason,
            sessionId,
            pipelineRunId,
            ...dispatchIdentityMeta,
            tabSessionId: readyInfo?.tabSessionId || null
          }
        }, NO_FOCUS_TIMEOUT_MS);
        noFocusProbeMs = Date.now() - noFocusStartedAt;
        needsFocus = !noFocusResponse || noFocusResponse.requiresFocus === true || noFocusResponse.timeout;
      }
      if (options.forceFocus) {
        needsFocus = true;
      }
      const pageReadyState = normalizePageReadyState(noFocusResponse);
      emitTelemetry(llmName, 'PAGE_READY_STATE', {
        level: pageReadyState.ok ? 'info' : 'warning',
        details: pageReadyState.reason || 'ready',
        meta: {
          ...dispatchIdentityMeta,
          dispatchReason: reason,
          tabId,
          status: pageReadyState.status,
          pageReady: pageReadyState.pageReady,
          composerReady: pageReadyState.composerReady,
          requiresFocus: pageReadyState.requiresFocus,
          blockers: pageReadyState.blockers,
          blockerPolicy: pageReadyState.blockerPolicy || null,
          source: pageReadyState.source
        }
      });
      if (!pageReadyState.ok) {
        entry.lastPageReadyState = {
          ok: false,
          reason: pageReadyState.reason,
          status: pageReadyState.status,
          pageReady: pageReadyState.pageReady,
          composerReady: pageReadyState.composerReady,
          requiresFocus: pageReadyState.requiresFocus,
          blockers: pageReadyState.blockers,
          blockerPolicy: pageReadyState.blockerPolicy || null,
          checkedAt: Date.now(),
          dispatchId
        };
        broadcastDiagnostic(llmName, {
          type: 'DISPATCH',
          label: 'Page not ready for dispatch',
          details: pageReadyState.reason || 'page_not_ready',
          level: 'warning',
          meta: {
            dispatchId,
            dispatchReason: reason,
            tabId,
            status: pageReadyState.status,
            pageReady: pageReadyState.pageReady,
            composerReady: pageReadyState.composerReady,
            blockers: pageReadyState.blockers,
            blockerPolicy: pageReadyState.blockerPolicy || null
          }
        });
        emitTelemetry(llmName, 'PAGE_READY_BLOCKED', {
          level: 'warning',
          details: pageReadyState.reason || 'page_not_ready',
          meta: {
            dispatchId,
            dispatchReason: reason,
            tabId,
            status: pageReadyState.status,
            blockers: pageReadyState.blockers,
            blockerPolicy: pageReadyState.blockerPolicy || null
          }
        });
        if (pageReadyState.blockerPolicy?.retryable !== false) {
          scheduleDispatchRetry(entry, llmName, { type: 'page_not_ready', reason: pageReadyState.reason });
        } else if (typeof handleLLMResponse === 'function') {
          handleLLMResponse(
            llmName,
            '',
            {
              type: 'user_action_required',
              message: pageReadyState.reason || 'User action required before dispatch'
            },
            {
              dispatchId,
              sessionId,
              runSessionId: sessionId,
              responseMeta: {
                failureClass: 'page_readiness',
                blockerPolicy: pageReadyState.blockerPolicy || null,
                source: 'page_ready_blocked'
              }
            },
            ''
          );
        }
        if (machine) {
          machine.error({ error: pageReadyState.reason || 'page_not_ready', code: 'PAGE_NOT_READY' });
        }
        return;
      }

      if (machine) {
        machine.ready();
      }

      // Register before delivery so a very fast provider cannot outrun the
      // listener, but do not start the timeout until the content script has
      // explicitly accepted this dispatch.
      waiterController = createPromptSubmittedWaiter(llmName, dispatchId, submitTimeoutMs);
      waiter = waiterController.promise;
      const postCommandFocusHoldMs = Math.max(0, Number(options.postCommandFocusHoldMs || 0));
      const progressFocusExtensionMs = Math.max(0, Number(options.progressFocusExtensionMs || 0));
      const prepareInsertionWaiter = () => {
        if (postCommandFocusHoldMs <= 0 || insertionWaiter) return;
        // Sized for the longest hold that is actually reachable, otherwise the
        // waiter expires while an attachment-extended hold is still running and
        // the boundary can never resolve as an insertion.
        insertionWaiter = waitForPromptInsertion(
          llmName,
          dispatchId,
          postCommandFocusHoldMs
            + Math.max(progressFocusExtensionMs, ATTACHMENT_FOCUS_EXTENSION_CEILING_MS)
            + 1000
        );
      };
      const readyWaitMs = Math.max(0, Date.now() - lockAcquiredAt);

      const answerCommand = {
        type: 'GET_ANSWER',
        prompt,
        attachments,
        meta: {
          dispatchReason: reason,
          runSessionId: sessionId,
          sessionId,
          pipelineRunId,
          ...dispatchIdentityMeta,
          tabSessionId: readyInfo?.tabSessionId || null
        }
      };
      const requireCommandAcceptance = options.requireCommandAcceptance === true;
      const commandWasAccepted = (result) => {
        if (!requireCommandAcceptance) return result?.ok === true;
        const acceptance = result?.response || null;
        return result?.ok === true
          && result?.accepted === true
          && acceptance?.accepted === true
          && acceptance?.dispatchId === dispatchId;
      };
      let commandDeliveryReported = false;
      // The submit waiter is armed only by an accepted command. When the command
      // was not delivered or not accepted, settle it now: an unarmed waiter never
      // resolves and kept this transaction (and the model's dispatch lock) forever.
      const settleUndeliveredCommand = (result) => {
        resolvePromptSubmitted(llmName, {
          ok: false,
          reason: result?.reason || result?.response?.reason || 'command_not_delivered',
          dispatchId,
          meta: answerCommand.meta
        });
      };
      const reportCommandDelivered = (result) => {
        if (commandDeliveryReported || !commandWasAccepted(result)) return false;
        commandDeliveryReported = true;
        waiterController?.armAfter?.(PROVIDER_SEND_ACTION_FALLBACK_MS);
        const commandTiming = {
          readyWaitMs,
          tabReadyMs,
          ackWaitMs,
          noFocusProbeMs,
          requiresFocus: needsFocus,
          visibilityState,
          hasFocus,
          commandAccepted: requireCommandAcceptance ? true : null
        };
        entry.lastCommandAcceptedAt = Date.now();
        entry.lastCommandAcceptedDispatchId = dispatchId;
        entry.lastCommandAcceptedTiming = commandTiming;
        emitTelemetry(llmName, 'DISPATCH_COMMAND_ACCEPTED', {
          details: `readyWaitMs=${readyWaitMs}`,
          meta: {
            ...dispatchIdentityMeta,
            dispatchReason: reason,
            attempt: entry.dispatchAttempts,
            ...commandTiming
          }
        });
        return true;
      };
      const deliverAnswerCommand = async () => {
        if (!isCurrentDispatchContext()) return { ok: false, stale: true, reason: 'session_mismatch' };
        prepareInsertionWaiter();
        // Persist intent before delivery: after a restart an uncertain send must
        // be reconciled, while a preparation-only attempt can safely resume.
        entry.dispatchCheckpoint = { dispatchId, phase: 'command_intent' };
        const intentPersisted = await saveJobState(jobState);
        // Without a durable intent a restart cannot reconcile an uncertain
        // send: do not act on the provider page.
        if (intentPersisted === false) {
          emitTelemetry(llmName, 'DISPATCH_INTENT_NOT_PERSISTED', {
            level: 'error',
            details: 'command_intent',
            meta: { tabId, dispatchId, dispatchReason: reason },
            force: true
          });
          return { ok: false, reason: 'intent_not_persisted' };
        }
        if (!isCurrentDispatchContext()) {
          return { ok: false, stale: true, reason: 'session_mismatch' };
        }
        if (!requireCommandAcceptance) {
          sendMessageSafely(tabId, llmName, answerCommand);
          return Promise.resolve({ ok: true, accepted: null, asynchronous: true });
        }
        return new Promise((resolve) => {
          let settled = false;
          const finish = (result) => {
            if (settled) return;
            settled = true;
            clearTimeout(timeoutId);
            resolve(result || { ok: false, reason: 'empty_command_delivery_result' });
          };
          const timeoutId = setTimeout(() => finish({ ok: false, reason: 'command_acceptance_timeout' }), READY_ACK_TIMEOUT_MS);
          sendMessageSafely(tabId, llmName, answerCommand, 1, finish);
        });
      };
      let commandDeliveryResult = null;
      let providerTransactionBoundary = null;
      if (needsFocus) {
        entry.focusSwitches = Number(entry.focusSwitches || 0) + 1;
        if (jobState?.session) {
          jobState.session.focusSwitches = Number(jobState.session.focusSwitches || 0) + 1;
        }
        await withPromptDispatchFocusLock(async () => {
          if (!isCurrentDispatchContext()) return;
          await activateTabForDispatch(tabId);
          if (options.deferSendMs) {
            await dispatchSleepMs(options.deferSendMs);
          }
          commandDeliveryResult = await deliverAnswerCommand();
          const commandAccepted = reportCommandDelivered(commandDeliveryResult);
          if (!commandAccepted) settleUndeliveredCommand(commandDeliveryResult);
          if (commandAccepted && postCommandFocusHoldMs > 0) {
            const holdStartedAt = Date.now();
            let boundary = await waitForPromptFocusBoundary(
              waiter,
              insertionWaiter,
              postCommandFocusHoldMs
            );
            const extendableStages = new Set([
              'composer_transaction_started',
              'composer_ready',
              'prompt_insertion_started',
              'send_action_requested'
            ]);
            // An attachment cascade materializes the file, tries several delivery
            // vectors and waits for observable upload evidence between them, so it
            // outlasts a composer interaction by an order of magnitude. It reports
            // this stage repeatedly while it works; each report buys one more
            // extension step, up to the ceiling. The moment the reports stop the
            // loop below sees a stale timestamp and releases focus immediately.
            const attachmentCeilingMs = Math.max(
              progressFocusExtensionMs,
              ATTACHMENT_FOCUS_EXTENSION_CEILING_MS
            );
            let extendedMs = 0;
            let progressFloorAt = holdStartedAt;
            let progressStage = String(entry.providerDispatchStage || '');
            let progressIsCurrent = entry.providerDispatchStageDispatchId === dispatchId
              && Number(entry.providerDispatchStageAt || 0) >= holdStartedAt;
            while (isCurrentDispatchContext() && progressFocusExtensionMs > 0
              && (boundary.reason === 'hold_elapsed' || boundary.reason === 'progress_extension_elapsed')) {
              progressStage = String(entry.providerDispatchStage || '');
              const sendActionObserved = entry.providerSendActionObservedDispatchId === dispatchId
                || progressStage === 'send_action_requested'
                || progressStage === 'send_action_completed';
              if (sendActionObserved) {
                boundary = { reason: 'send_action_observed', payload: { dispatchId, stage: progressStage } };
                break;
              }
              const stageAt = Number(entry.providerDispatchStageAt || 0);
              const stageIsCurrent = entry.providerDispatchStageDispatchId === dispatchId;
              progressIsCurrent = stageIsCurrent && stageAt >= holdStartedAt;
              const composerTransactionActive = entry.providerComposerTransactionActive === true
                && entry.providerComposerTransactionDispatchId === dispatchId;
              // Stale or foreign progress ends the hold, so a stalled provider
              // cannot keep the tab pinned on a report it filed once. A live
              // composer lease is the exception: preflight/background ACK may
              // legitimately be quiet, and remains bounded by the same ceiling.
              if (!composerTransactionActive && (!stageIsCurrent || stageAt < progressFloorAt)) break;
              const attachmentInFlight = progressStage === ATTACHMENT_PROGRESS_STAGE;
              if (!composerTransactionActive && !attachmentInFlight && !extendableStages.has(progressStage)) break;
              // Everything except an in-flight attachment keeps the historical
              // single extension: ceiling equals one step.
              const ceilingMs = attachmentInFlight
                ? attachmentCeilingMs
                : progressFocusExtensionMs;
              if (extendedMs >= ceilingMs) break;
              const stepMs = Math.min(progressFocusExtensionMs, ceilingMs - extendedMs);
              progressFloorAt = Date.now();
              extendedMs += stepMs;
              const extendedBoundary = await waitForPromptFocusBoundary(
                waiter,
                insertionWaiter,
                stepMs
              );
              boundary = {
                ...extendedBoundary,
                reason: extendedBoundary.reason === 'hold_elapsed'
                  ? 'progress_extension_elapsed'
                  : extendedBoundary.reason
              };
            }
            emitTelemetry(llmName, 'DISPATCH_POST_COMMAND_FOCUS_HOLD', {
              details: boundary.reason,
              meta: {
                tabId,
                dispatchId,
                dispatchReason: reason,
                configuredHoldMs: postCommandFocusHoldMs,
                configuredProgressExtensionMs: progressFocusExtensionMs,
                extendedMs,
                progressStage: progressStage || null,
                progressIsCurrent,
                heldMs: Math.max(0, Date.now() - holdStartedAt),
                boundaryReason: boundary.reason,
                insertionState: boundary.payload?.insertionState || null,
                submitConfirmed: boundary.reason === 'submit_confirmed'
              }
            });
            providerTransactionBoundary = boundary;
          }
        });
      } else {
        if (options.deferSendMs) {
          await dispatchSleepMs(options.deferSendMs);
        }
        commandDeliveryResult = await deliverAnswerCommand();
        if (!reportCommandDelivered(commandDeliveryResult)) settleUndeliveredCommand(commandDeliveryResult);
      }
      // Not delivered and no acceptance contract to report it below: stop here
      // instead of treating an undelivered command as submitted.
      if (!commandDeliveryReported && !requireCommandAcceptance) {
        const reasonCode = commandDeliveryResult?.reason || 'command_not_delivered';
        if (machine?.isInProgress?.()) machine.error({ error: reasonCode, code: 'COMMAND_NOT_DELIVERED' });
        if (!commandDeliveryResult?.stale) scheduleDispatchRetry(entry, llmName, { type: 'command_not_delivered', reason: reasonCode });
        return { ok: false, accepted: false, dispatchId, reason: reasonCode };
      }
      const focusMetricPayload = {
        type: 'SMART_FOCUS_METRIC',
        llmName,
        focusSwitches: Number(entry.focusSwitches || 0),
        sessionFocusSwitches: Number(jobState?.session?.focusSwitches || 0),
        requiresFocus: Boolean(needsFocus),
        dispatchId
      };
      try {
        if (typeof sendMessageToResultsTab === 'function') {
          sendMessageToResultsTab(focusMetricPayload);
        }
      } catch (_) {}
      const submittedPayload = options.skipSubmitWait ? null : (waiter ? await waiter : false);
      if (requireCommandAcceptance) {
        const acceptance = commandDeliveryResult?.response || null;
        const accepted = commandDeliveryResult?.ok === true
          && commandDeliveryResult?.accepted === true
          && acceptance?.accepted === true
          && acceptance?.dispatchId === dispatchId;
        if (!accepted) {
          const reasonCode = commandDeliveryResult?.reason || acceptance?.reason || 'command_not_accepted';
          resolvePromptSubmitted(llmName, {
            ok: false,
            busy: true,
            reason: reasonCode,
            dispatchId,
            meta: answerCommand.meta
          });
          emitTelemetry(llmName, 'DISPATCH_COMMAND_NOT_ACCEPTED', {
            level: 'error',
            details: reasonCode,
            meta: { tabId, dispatchId, dispatchReason: reason, commandDeliveryResult },
            force: true
          });
          if (machine?.isInProgress?.()) {
            machine.error({ error: reasonCode, code: 'COMMAND_NOT_ACCEPTED' });
          }
          return { ok: false, accepted: false, dispatchId, reason: reasonCode };
        }
      }
      if (['submit_failed', 'insertion_failed'].includes(providerTransactionBoundary?.reason)) {
        const reasonCode = providerTransactionBoundary?.payload?.reason || providerTransactionBoundary.reason;
        if (machine?.isInProgress?.()) machine.error({ error: reasonCode, code: 'PROVIDER_TRANSACTION_FAILED' });
        return { ok: false, accepted: true, dispatchId, reason: reasonCode };
      }
      if (machine?.isInProgress?.()) machine.submit();
      //-- 2.1. Если Round 1 (skipSubmitWait), выходим сразу после клика, не блокируя очередь --//
      if (options.skipSubmitWait) {
        const dispatchAlreadyConfirmed = entry.confirmedDispatchId === dispatchId
          || self.DispatchIdRegistry?.isDispatchConfirmed?.(dispatchId) === true;
        if (!dispatchAlreadyConfirmed) {
          entry.awaitingSubmitConfirmation = true;
          entry.awaitingSubmitConfirmationAt = Date.now();
          entry.awaitingSubmitConfirmationDispatchId = dispatchId;
          entry.submitSource = entry.submitSource || null;
          emitTelemetry(llmName, 'PROMPT_SUBMITTED_PENDING', {
            details: 'skip_submit_wait',
            meta: {
              ...dispatchIdentityMeta,
              dispatchReason: reason,
              tabId,
              submitTimeoutMs
            }
          });
          broadcastDiagnostic(llmName, {
            type: 'DISPATCH',
            label: 'Prompt submit confirmation pending',
            details: 'Round1 command sent; waiting for content confirmation or Round2 repair',
            level: 'info',
            meta: { ...dispatchIdentityMeta, dispatchReason: reason, tabId }
          });
        }
        if (options.resetStateAfterSend && machine) {
          machine.reset();
        }
        return {
          ok: true,
          accepted: requireCommandAcceptance ? true : null,
          dispatchId,
          response: commandDeliveryResult?.response || null
        };
      }
      const submittedOk = submittedPayload === true || (submittedPayload && submittedPayload.ok === true);
      if (submittedOk) {
        entry.promptSubmittedAt = Date.now();
        entry.awaitingSubmitConfirmation = false;
        entry.awaitingSubmitConfirmationAt = null;
        entry.awaitingSubmitConfirmationDispatchId = null;
        broadcastDiagnostic(llmName, { type: 'DISPATCH', label: 'Prompt submitted (confirmed)', level: 'success' });
        armScriptRuntimeHardStopForConfirmedPrompt(llmName, {
          dispatchId: entry?.confirmedDispatchId || dispatchId || null,
          tabId
        });
      } else if (submittedPayload && submittedPayload.busy) {
        broadcastDiagnostic(llmName, { type: 'DISPATCH', label: 'Content script busy — no retry', level: 'warning' });
      } else {
        const timeoutSnapshot = await captureTabSnapshot(tabId);
        emitTelemetry(llmName, 'PROMPT_SUBMITTED_TIMEOUT', {
          details: `${submitTimeoutMs}ms`,
          level: 'warning',
          meta: { dispatchId, dispatchReason: reason, timeoutMs: submitTimeoutMs, snapshot: timeoutSnapshot || null }
        });
        broadcastDiagnostic(llmName, {
          type: 'DISPATCH',
          label: 'Prompt confirmation timeout',
          details: `${submitTimeoutMs}ms`,
          level: 'warning',
          meta: { snapshot: timeoutSnapshot || null, dispatchId, dispatchReason: reason }
        });
        scheduleDispatchRetry(entry, llmName, { type: 'submit_timeout' });
        if (self.DispatchCircuit?.recordDispatchFailure) {
          self.DispatchCircuit.recordDispatchFailure(llmName, { type: 'submit_timeout' });
        }
        if (machine) {
          machine.error({ error: 'prompt_submit_timeout', code: 'PROMPT_SUBMIT_TIMEOUT' });
        }
      }
    } catch (err) {
      console.warn('[DISPATCH] dispatchPromptToTab failed', llmName, err);
      broadcastDiagnostic(llmName, { type: 'DISPATCH', label: 'Prompt dispatch error', details: err?.message || String(err), level: 'error' });
      scheduleDispatchRetry(entry, llmName, { type: err?.message || 'dispatch_error' });
      if (self.DispatchCircuit?.recordDispatchFailure) {
        self.DispatchCircuit.recordDispatchFailure(llmName, { type: err?.message || 'dispatch_error' });
      }
      const machine = resolveDispatchFlags(llmName, entry).machine;
      if (machine) {
        machine.error({ error: err?.message || String(err), code: 'DISPATCH_ERROR' });
      }
      return { ok: false, accepted: false, reason: err?.message || String(err) };
    } finally {
      try {
        saveJobState(jobState);
      } catch (_) {}
      promptDispatchInProgress = Math.max(0, promptDispatchInProgress - 1);
      schedulePromptDispatchSupervisor();
    }
  });
}

const TRANSIENT_BLOCKER_TRANSPORT_TTL_MS = 120000;

const matchesPerplexityTransientBlockerTransport = (entry, llmName, tabId, message) => {
  const blocker = entry?.transientBlocker || null;
  if (!blocker || blocker.kind !== 'file_upload_paywall') return false;
  if (!['ARMED', 'ACTIVE', 'RESUMING'].includes(String(blocker.phase || '').toUpperCase())) return false;
  if (Date.now() - Number(blocker.startedAt || blocker.armedAt || 0) > TRANSIENT_BLOCKER_TRANSPORT_TTL_MS) return false;
  const messageRunSessionId = Number(message?.meta?.runSessionId || message?.meta?.sessionId || 0) || null;
  const messageDispatchId = message?.meta?.dispatchId || null;
  return llmName === 'Perplexity'
    && Number(blocker.tabId || 0) === Number(tabId || 0)
    && Number(blocker.runSessionId || 0) === Number(messageRunSessionId || 0)
    && blocker.dispatchId === messageDispatchId;
};

function sendMessageSafely(tabId, llmName, message, attempt = 1, onSettled = null) {
  globalThis.LLMLog?.debug?.(`[BACKGROUND] Safely sending message to ${llmName} (tab ${tabId}), attempt ${attempt}`);
  const settle = (result) => {
    if (typeof onSettled !== 'function') return;
    try { onSettled(result); } catch (_) {}
  };
  const currentSessionId = jobState?.session?.startTime || null;
  const messageSessionId = message?.meta?.runSessionId || message?.meta?.sessionId || null;
  if (currentSessionId && messageSessionId && currentSessionId !== messageSessionId) {
    globalThis.LLMLog?.debug?.(`[BACKGROUND] Session mismatch for ${llmName}, aborting send`);
    settle({ ok: false, stale: true, reason: 'session_mismatch' });
    return;
  }
  const initialEntry = jobState?.llms?.[llmName] || null;
  if (isTerminalLlmEntry(initialEntry)) {
    appendLogEntry(llmName, {
      type: 'COMMAND',
      label: 'Send skipped (terminal)',
      details: initialEntry?.status || initialEntry?.finalStatus || 'terminal',
      level: 'warning',
      meta: { messageType: message?.type || 'UNKNOWN', attempt }
    });
    settle({ ok: false, terminal: true, reason: 'model_terminal' });
    return;
  }
  if (attempt === 1) {
    updateModelState(llmName, 'GENERATING');
    if (typeof self.startBudgetPhase === 'function') {
      self.startBudgetPhase(llmName, 'generation', null, { tabId });
    }
    scheduleScriptRuntimeHardStop(llmName, tabId, message, attempt);
  }
  appendLogEntry(llmName, {
    type: 'COMMAND',
    label: `Sending ${message?.type || 'command'}`,
    details: `Attempt ${attempt}`,
    level: 'info',
    meta: { attempt, messageType: message?.type || 'UNKNOWN' }
  });
  const mappedTabId = TabMapManager.get(llmName);
  if (mappedTabId && mappedTabId !== tabId) {
    if (isValidTabId(mappedTabId)) {
      console.warn(`[BACKGROUND] Tab mapping for ${llmName} changed (${tabId} -> ${mappedTabId}), quarantining stale command`);
      emitTelemetry(llmName, 'STALE_TAB_COMMAND_QUARANTINED', {
        level: 'warning',
        details: `${tabId}->${mappedTabId}`,
        meta: {
          originalTabId: tabId,
          currentTabId: mappedTabId,
          dispatchId: message?.meta?.dispatchId || null,
          messageType: message?.type || null
        },
        force: true
      });
      resolvePromptSubmitted(llmName, {
        ok: false,
        busy: true,
        reason: 'tab_mapping_changed',
        dispatchId: message?.meta?.dispatchId || null,
        meta: message?.meta || null
      });
      scheduleDispatchRetry(initialEntry, llmName, { type: 'tab_mapping_changed' });
      settle({ ok: false, stale: true, reason: 'tab_mapping_changed' });
    } else {
      console.warn(`[BACKGROUND] Tab mapping for ${llmName} is invalid (${mappedTabId}), aborting send`);
      handleLLMResponse(llmName, '', self.RunError.makeRunError(self.RunError.CODES.TAB_INVALID, `Tab reference for ${llmName} is invalid`));
      settle({ ok: false, reason: 'tab_mapping_invalid' });
    }
    return;
  }
  extendPingWindowForTab(tabId, AUTO_PING_WINDOW_MS);

  if (!isValidTabId(tabId)) {
    console.error(`[BACKGROUND] Invalid tab id for ${llmName}:`, tabId);
    handleLLMResponse(llmName, '', self.RunError.makeRunError(self.RunError.CODES.TAB_INVALID, `Tab reference for ${llmName} is invalid`));
    settle({ ok: false, reason: 'invalid_tab' });
    return;
  }

  chrome.tabs.get(tabId, (tab) => {
    if (chrome.runtime.lastError || !tab) {
      console.error(`[BACKGROUND] Tab ${tabId} for ${llmName} not found.`, chrome.runtime.lastError?.message);
      appendLogEntry(llmName, {
        type: 'COMMAND',
        label: 'Tab unavailable',
        details: chrome.runtime.lastError?.message || 'Tab not found',
        level: 'error',
        meta: { messageType: message?.type || 'UNKNOWN' }
      });
      handleLLMResponse(llmName, '', self.RunError.makeRunError(self.RunError.CODES.TAB_CLOSED, `Tab for ${llmName} was closed or could not be accessed`));
      settle({ ok: false, reason: 'tab_unavailable', error: chrome.runtime.lastError?.message || 'tab_not_found' });
      return;
    }

    globalThis.LLMLog?.debug?.(`[BACKGROUND] Sending message to ${llmName}:`, message);
    chrome.tabs.sendMessage(tabId, message, (response) => {
      const liveEntry = jobState?.llms?.[llmName] || null;
      const callbackSessionId = Number(message?.meta?.runSessionId || message?.meta?.sessionId || 0) || null;
      const liveSessionId = Number(jobState?.session?.startTime || 0) || null;
      const callbackDispatchId = message?.meta?.dispatchId || null;
      const liveDispatchId = liveEntry?.lastDispatchMeta?.dispatchId || liveEntry?.runIdentity?.dispatchId || null;
      const blockerOwnsCallback = matchesPerplexityTransientBlockerTransport(
        liveEntry,
        llmName,
        tabId,
        message
      );
      const staleCallback = Boolean(
        (callbackSessionId && liveSessionId && callbackSessionId !== liveSessionId)
        || (callbackDispatchId && liveDispatchId && callbackDispatchId !== liveDispatchId)
        || (Number(liveEntry?.tabId || TabMapManager.get(llmName) || 0) > 0
          && Number(liveEntry?.tabId || TabMapManager.get(llmName) || 0) !== Number(tabId))
      );
      if (staleCallback && !blockerOwnsCallback) {
        emitTelemetry(llmName, 'STALE_SEND_CALLBACK_QUARANTINED', {
          level: 'warning',
          details: `${callbackDispatchId || 'no_dispatch'}->${liveDispatchId || 'no_live_dispatch'}`,
          meta: {
            tabId,
            callbackSessionId,
            liveSessionId,
            callbackDispatchId,
            liveDispatchId,
            messageType: message?.type || null,
            attempt
          },
          force: true
        });
        settle({ ok: false, stale: true, reason: 'stale_send_callback' });
        return;
      }
      if (isTerminalLlmEntry(liveEntry)) {
        appendLogEntry(llmName, {
          type: 'COMMAND',
          label: 'Send response ignored (terminal)',
          details: liveEntry?.status || liveEntry?.finalStatus || 'terminal',
          level: 'warning',
          meta: { messageType: message?.type || 'UNKNOWN', attempt }
        });
        settle({ ok: false, terminal: true, reason: 'model_terminal' });
        return;
      }
      if (chrome.runtime.lastError) {
        const errMsg = chrome.runtime.lastError.message || '';
        const errLower = errMsg.toLowerCase();
        const isSendCommand = message?.type === 'GET_ANSWER';
        const isPortClosed = errLower.includes('message port closed');
        const isNoReceiver = errLower.includes('receiving end does not exist');
        const isAsyncChannelClosed = errLower.includes('message channel closed before a response was received');
        const entry = jobState?.llms?.[llmName] || null;
        const isConnectionFailure = errLower.includes('could not establish connection');
        const isExpectedNavigationClose = isSendCommand
          && blockerOwnsCallback
          && (isPortClosed || isNoReceiver || isAsyncChannelClosed || isConnectionFailure);
        if (isExpectedNavigationClose) {
          emitTelemetry(llmName, 'SEND_DEFERRED_TRANSIENT_BLOCKER', {
            level: 'info',
            details: errMsg || 'expected navigation closed the command channel',
            meta: {
              tabId,
              attempt,
              dispatchId: message?.meta?.dispatchId || null,
              runSessionId: message?.meta?.runSessionId || message?.meta?.sessionId || null,
              messageType: message?.type || null,
              blocker: entry?.transientBlocker?.kind || null,
              blockerPhase: entry?.transientBlocker?.phase || null
            },
            force: true
          });
          appendLogEntry(llmName, {
            type: 'COMMAND',
            label: 'SEND_DEFERRED_TRANSIENT_BLOCKER',
            details: errMsg,
            level: 'info',
            meta: { messageType: message?.type || 'UNKNOWN', attempt }
          });
          settle({ ok: false, deferred: true, reason: 'transient_blocker_navigation' });
          return;
        }
        const hasConfirmedSubmit = Boolean(
          entry?.promptSubmittedAt
          || entry?.submitSource === 'content'
          || entry?.submitSource === 'inferred'
        );
        const markTransportDegradedAfterSubmit = () => {
          if (!(isSendCommand && hasConfirmedSubmit)) return false;
          if (entry) {
            markModelRuntimeActivity(llmName, Date.now(), 'transport_degraded_after_submit');
            entry.transportErrorAfterSubmitCount = Number(entry.transportErrorAfterSubmitCount || 0) + 1;
            entry.transportBackoffUntil = Date.now() + TRANSPORT_RECOVER_BACKOFF_MS;
          }
          emitTelemetry(llmName, 'SEND_DEGRADED_AFTER_SUBMIT', {
            level: 'warning',
            details: errMsg || 'channel_closed_after_submit',
            meta: {
              tabId,
              attempt,
              dispatchId: message?.meta?.dispatchId || null,
              messageType: message?.type || null
            }
          });
          appendLogEntry(llmName, {
            type: 'COMMAND',
            label: 'SEND_DEGRADED_AFTER_SUBMIT',
            details: errMsg,
            level: 'warning',
            meta: { messageType: message?.type || 'UNKNOWN', attempt }
          });
          updateModelState(llmName, 'RECOVERABLE_ERROR', {
            message: 'transport_error_after_submit'
          });
          if (typeof self.recoverAnswerViaDomSnapshot === 'function') {
            self.recoverAnswerViaDomSnapshot(llmName, tabId, 'transport_error_after_submit', {
              dispatchId: message?.meta?.dispatchId || null
            }).catch(() => {});
          }
          sendPassiveMessageWithRetries(tabId, llmName, {
            action: 'getResponses',
            meta: {
              source: 'post_send_error_recover',
              runSessionId: message?.meta?.runSessionId || message?.meta?.sessionId || null,
              sessionId: message?.meta?.runSessionId || message?.meta?.sessionId || null,
              dispatchId: message?.meta?.dispatchId || null
            }
          }, {
            maxAttempts: 3,
            baseDelay: 1000,
            allowRecovery: llmName === 'Perplexity',
            onSuccess: () => {
              broadcastDiagnostic(llmName, {
                type: 'PING',
                label: 'post-send recovery probe sent',
                level: 'success'
              });
            },
            onError: (passiveErr) => {
              if (typeof self.recoverAnswerViaDomSnapshot === 'function') {
                self.recoverAnswerViaDomSnapshot(llmName, tabId, 'post_send_recovery_probe_failed', {
                  dispatchId: message?.meta?.dispatchId || null
                }).catch(() => {});
              }
              broadcastDiagnostic(llmName, {
                type: 'PING_ERROR',
                label: 'post-send recovery probe failed',
                details: passiveErr,
                level: 'warning'
              });
            }
          });
          return true;
        };
        const canRecover = isSendCommand && attempt < 2 && (isPortClosed || isNoReceiver || isAsyncChannelClosed);
        console.error(`[BACKGROUND] Error sending message to ${llmName} on tab ${tabId}:`, errMsg);
        if (errMsg.includes('message port closed')) {
          emitTelemetry(llmName, 'PORT_CLOSED', {
            level: 'warning',
            details: errMsg,
            meta: {
              errorType: 'PORT_CLOSED',
              code: 'PORT_CLOSED',
              phase: 'dispatch_send',
              dispatchId: message?.meta?.dispatchId || null,
              tabId,
              messageType: message?.type || null,
              attempt,
              source: 'sendMessageSafely'
            }
          });
        }
        if (canRecover) {
          const dispatchId = message?.meta?.dispatchId || null;
          emitTelemetry(llmName, 'SEND_RECOVERY_ATTEMPT', {
            level: 'warning',
            details: errMsg,
            meta: {
              dispatchId,
              tabId,
              messageType: message?.type || null,
              attempt,
              source: 'sendMessageSafely'
            }
          });
          appendLogEntry(llmName, {
            type: 'COMMAND',
            label: 'Send recovery attempt',
            details: errMsg,
            level: 'warning',
            meta: { messageType: message?.type || 'UNKNOWN', attempt }
          });
          const attemptRecovery = async () => {
            let recoveryOk = false;
            let action = null;
            if (self.reinjectScript) {
              action = 'reinject_script';
              recoveryOk = await self.reinjectScript(tabId, llmName);
            } else if (self.reloadTab) {
              action = 'reload_tab';
              recoveryOk = await self.reloadTab(tabId);
            }
            const readyFn = (typeof waitForScriptReady === 'function')
              ? waitForScriptReady
              : (self.waitForScriptReady || null);
            if (recoveryOk && readyFn) {
              recoveryOk = await readyFn(tabId, llmName, { timeoutMs: READY_ACK_TIMEOUT_MS, intervalMs: 250 });
            }
            emitTelemetry(llmName, 'SEND_RECOVERY_RESULT', {
              level: recoveryOk ? 'info' : 'warning',
              details: recoveryOk ? 'ok' : 'failed',
              meta: {
                dispatchId,
                tabId,
                messageType: message?.type || null,
                attempt,
                action,
                ok: recoveryOk
              }
            });
            if (recoveryOk) {
              sendMessageSafely(tabId, llmName, message, attempt + 1, onSettled);
              return;
            }
            emitTelemetry(llmName, 'SEND_SKIPPED', {
              level: 'warning',
              details: errMsg,
              meta: {
                dispatchId,
                tabId,
                messageType: message?.type || null,
                attempt,
                reason: 'channel_dead'
              }
            });
            appendLogEntry(llmName, {
              type: 'COMMAND',
              label: 'Send recovery failed',
              details: errMsg,
              level: 'error',
              meta: { messageType: message?.type || 'UNKNOWN', attempt }
            });
            if (markTransportDegradedAfterSubmit()) {
              settle({ ok: false, degraded: true, reason: 'transport_degraded_after_submit' });
              return;
            }
            handleLLMResponse(llmName, '', self.RunError.makeRunError(self.RunError.CODES.CONNECTION_FAILED, `Could not establish connection with the ${llmName} tab`));
            settle({ ok: false, reason: 'connection_failed', error: errMsg });
          };
          attemptRecovery();
          return;
        }
        if (errMsg.includes('Could not establish connection') && attempt < 3) {
          const delays = getConnectionRetryDelaysForModel(llmName);
          const retryDelay = delays[attempt - 1] || 3000;
          const retrySessionId = jobState?.session?.startTime || null;
          console.warn(`[BACKGROUND] Retrying message to ${llmName} in ${retryDelay}ms (attempt ${attempt + 1})`);
          const retryTimer = dispatchRegisterSessionTimer(setTimeout(() => {
            if (retrySessionId && jobState?.session?.startTime !== retrySessionId) {
              globalThis.LLMLog?.debug?.(`[BACKGROUND] Session changed, aborting retry for ${llmName}`);
              dispatchDeregisterSessionTimer(retryTimer);
              settle({ ok: false, stale: true, reason: 'session_changed_before_retry' });
              return;
            }
            const currentTabId = TabMapManager.get(llmName);
            if (currentTabId !== tabId) {
              globalThis.LLMLog?.debug?.(`[BACKGROUND] Tab for ${llmName} changed (${tabId} -> ${currentTabId}), aborting retry`);
              dispatchDeregisterSessionTimer(retryTimer);
              settle({ ok: false, stale: true, reason: 'tab_changed_before_retry' });
              return;
            }
            sendMessageSafely(tabId, llmName, message, attempt + 1, onSettled);
            dispatchDeregisterSessionTimer(retryTimer);
          }, retryDelay));
          return;
        }
        appendLogEntry(llmName, {
          type: 'COMMAND',
          label: 'COMMAND_SEND_ERROR',
          details: errMsg,
          level: 'error',
          meta: { messageType: message?.type || 'UNKNOWN', reason: errMsg }
        });
        if (markTransportDegradedAfterSubmit()) {
          settle({ ok: false, degraded: true, reason: 'transport_degraded_after_submit' });
          return;
        }
        handleLLMResponse(llmName, '', self.RunError.makeRunError(self.RunError.CODES.CONNECTION_FAILED, `Could not establish connection with the ${llmName} tab`));
        settle({ ok: false, reason: 'connection_failed', error: errMsg });
      } else {
        globalThis.LLMLog?.debug?.(`[BACKGROUND] Message sent to ${llmName} successfully, response:`, response);
        appendLogEntry(llmName, {
          type: 'COMMAND',
          label: 'Command delivered',
          details: message?.type || 'UNKNOWN',
          level: 'success',
          meta: { messageType: message?.type || 'UNKNOWN' }
        });
        settle({ ok: true, accepted: response?.accepted === true, response: response || null });
      }
    });
  });
}

function sendPassiveMessageWithRetries(tabId, llmName, message, {
  attempt = 1,
  maxAttempts = 3,
  baseDelay = 2000,
  transportRetryDelays = null,
  allowRecovery = false,
  recoveryAttempted = false,
  onSuccess,
  onError
} = {}) {
  const initialEntry = jobState?.llms?.[llmName] || null;
  if (isTerminalLlmEntry(initialEntry)) {
    onSuccess?.({ status: 'ignored_terminal' });
    return;
  }
  chrome.tabs.get(tabId, (tab) => {
    if (chrome.runtime.lastError || !tab) {
      const errMsg = chrome.runtime.lastError?.message || 'Tab not found';
      console.warn(`[BACKGROUND] Passive message: tab ${tabId} for ${llmName} unavailable: ${errMsg}`);
      onError?.(errMsg);
      return;
    }

    chrome.tabs.sendMessage(tabId, message, (response) => {
      const liveEntry = jobState?.llms?.[llmName] || null;
      if (isTerminalLlmEntry(liveEntry)) {
        onSuccess?.({ status: 'ignored_terminal' });
        return;
      }
      if (chrome.runtime.lastError) {
        const errMsg = chrome.runtime.lastError.message || 'Unknown error';
        const errLower = errMsg.toLowerCase();
        const isPortClosed = errLower.includes('message port closed');
        const isAsyncChannelClosed = errLower.includes('message channel closed before a response was received');
        const isNoReceiver = errLower.includes('receiving end does not exist')
          || errLower.includes('could not establish connection');
        console.warn(`[BACKGROUND] Passive message error for ${llmName}:`, errMsg);
        const scheduleTransportRetry = () => {
          const retryPlan = Array.isArray(transportRetryDelays) ? transportRetryDelays : null;
          const plannedDelay = retryPlan && retryPlan.length >= attempt
            ? Number(retryPlan[attempt - 1])
            : NaN;
          const nextDelay = Number.isFinite(plannedDelay) && plannedDelay > 0
            ? plannedDelay
            : (baseDelay * attempt);
          const retrySessionId = jobState?.session?.startTime || null;
          globalThis.LLMLog?.debug?.(`[BACKGROUND] Passive retry for ${llmName} in ${nextDelay}ms (attempt ${attempt + 1})`);
          const passiveRetryTimer = dispatchRegisterSessionTimer(setTimeout(() => {
            if (retrySessionId && jobState?.session?.startTime !== retrySessionId) {
              globalThis.LLMLog?.debug?.(`[BACKGROUND] Session changed, aborting passive retry for ${llmName}`);
              dispatchDeregisterSessionTimer(passiveRetryTimer);
              return;
            }
            const latestEntry = jobState?.llms?.[llmName] || null;
            if (isTerminalLlmEntry(latestEntry)) {
              onSuccess?.({ status: 'ignored_terminal' });
              dispatchDeregisterSessionTimer(passiveRetryTimer);
              return;
            }
            sendPassiveMessageWithRetries(tabId, llmName, message, {
              attempt: attempt + 1,
              maxAttempts,
              baseDelay,
              transportRetryDelays,
              allowRecovery,
              recoveryAttempted,
              onSuccess,
              onError
            });
            dispatchDeregisterSessionTimer(passiveRetryTimer);
          }, nextDelay));
        };
        const canRecover = allowRecovery
          && !recoveryAttempted
          && (isPortClosed || isNoReceiver || isAsyncChannelClosed)
          && attempt < maxAttempts
          && (typeof self.reinjectScript === 'function' || typeof self.reloadTab === 'function');
        if (canRecover) {
          emitTelemetry(llmName, 'PASSIVE_SEND_RECOVERY_ATTEMPT', {
            level: 'warning',
            details: errMsg,
            meta: { tabId, attempt, messageType: message?.action || message?.type || 'PASSIVE' }
          });
          (async () => {
            let recoveryOk = false;
            let action = null;
            if (self.reinjectScript) {
              action = 'reinject_script';
              recoveryOk = await self.reinjectScript(tabId, llmName);
            } else if (self.reloadTab) {
              action = 'reload_tab';
              recoveryOk = await self.reloadTab(tabId);
            }
            const readyFn = (typeof self.waitForScriptReady === 'function') ? self.waitForScriptReady : null;
            if (recoveryOk && readyFn) {
              recoveryOk = await readyFn(tabId, llmName, { timeoutMs: READY_ACK_TIMEOUT_MS, intervalMs: 250 });
            }
            emitTelemetry(llmName, 'PASSIVE_SEND_RECOVERY_RESULT', {
              level: recoveryOk ? 'info' : 'warning',
              details: recoveryOk ? 'ok' : 'failed',
              meta: { tabId, attempt, action, messageType: message?.action || message?.type || 'PASSIVE' }
            });
            if (recoveryOk) {
              sendPassiveMessageWithRetries(tabId, llmName, message, {
                attempt: attempt + 1,
                maxAttempts,
                baseDelay,
                transportRetryDelays,
                allowRecovery,
                recoveryAttempted: true,
                onSuccess,
                onError
              });
              return;
            }
            if ((isPortClosed || isNoReceiver || isAsyncChannelClosed) && attempt < maxAttempts) {
              scheduleTransportRetry();
              return;
            }
            onError?.(errMsg);
          })().catch(() => onError?.(errMsg));
          return;
        }
        if ((isPortClosed || isNoReceiver || isAsyncChannelClosed) && attempt < maxAttempts) {
          scheduleTransportRetry();
          return;
        }
        onError?.(errMsg);
      } else {
        onSuccess?.(response);
      }
    });
  });
}

self.dispatchMutexManager = dispatchMutexManager;
self.promptSubmitWaiters = promptSubmitWaiters;
self.promptSubmitWaiterArms = promptSubmitWaiterArms;
self.promptInsertionWaiters = promptInsertionWaiters;
self.providerSendOnlyRecoveryTimers = providerSendOnlyRecoveryTimers;
self.getRetryBackoffForModel = getRetryBackoffForModel;
self.getConnectionRetryDelaysForModel = getConnectionRetryDelaysForModel;
self.withPromptDispatchLock = withPromptDispatchLock;
self.withPromptDispatchFocusLock = withPromptDispatchFocusLock;
self.resolvePromptSubmitted = resolvePromptSubmitted;
self.createPromptSubmittedWaiter = createPromptSubmittedWaiter;
self.armPromptSubmittedWaiter = armPromptSubmittedWaiter;
self.waitForPromptSubmitted = waitForPromptSubmitted;
self.resolvePromptInsertion = resolvePromptInsertion;
self.waitForPromptInsertion = waitForPromptInsertion;
self.waitForPromptFocusBoundary = waitForPromptFocusBoundary;
self.scheduleProviderSendOnlyRecovery = scheduleProviderSendOnlyRecovery;
self.cancelProviderSendOnlyRecovery = cancelProviderSendOnlyRecovery;
self.getPromptSubmitTimeoutMs = getPromptSubmitTimeoutMs;
self.sendMessageWithTimeout = sendMessageWithTimeout;
self.normalizePageReadyState = normalizePageReadyState;
self.markModelRuntimeActivity = markModelRuntimeActivity;
self.updateTypingStateFromDiagnostic = updateTypingStateFromDiagnostic;
self.isTypingGuardActive = isTypingGuardActive;
self.hasPendingPromptDispatches = hasPendingPromptDispatches;
self.schedulePromptDispatchSupervisor = schedulePromptDispatchSupervisor;
self.runPromptDispatchSupervisor = runPromptDispatchSupervisor;
self.dispatchPromptToTab = dispatchPromptToTab;
self.sendMessageSafely = sendMessageSafely;
self.sendPassiveMessageWithRetries = sendPassiveMessageWithRetries;
self.DISPATCH_MAX_ATTEMPTS = DISPATCH_MAX_ATTEMPTS;
self.clearScriptRuntimeHardStop = clearScriptRuntimeHardStop;
self.clearAllScriptRuntimeHardStops = clearAllScriptRuntimeHardStops;
self.armScriptRuntimeHardStopForConfirmedPrompt = armScriptRuntimeHardStopForConfirmedPrompt;
self.isProviderPipelineOwnershipActive = isProviderPipelineOwnershipActive;

globalThis.LLMLog?.debug?.('[DispatchCoordinator] Module loaded');
