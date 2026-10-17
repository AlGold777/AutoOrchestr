// background/health-monitor.js
// Health check + heartbeat monitor for content scripts.

'use strict';

// --- V2.0 START: Health Check System ---
// NOTE: Health-check is advisory; it must never stop active jobs.
// Tabs can be temporarily unresponsive during navigation/throttling.
const HEALTH_CHECK_TIMEOUT_MS = 15000;   // 15 секунд
const HEALTH_CHECK_FAILURE_THRESHOLD = 3;
const HEALTH_CHECK_ERROR_COOLDOWN_MS = 30000;
var pendingPings = new Map();
var pendingPingByTabId = new Map();
var healthCheckFailuresByTabId = new Map();
var lastHealthCheckReportAtByTabId = new Map();

function isTerminalHealthEntry(entry) {
  if (!entry) return false;
  if (entry.cardAnswerComplete) return true;
  if (self.ModelRunState?.isTerminalRunState?.(entry)) return true;
  const status = String(entry.status || entry.finalStatus || '').toUpperCase();
  return Boolean(entry.finalStatusRecorded || entry.finalStatus || TERMINAL_STATUSES.includes(status));
}

const SCRIPT_MAP = {
  'GPT': 'content-scripts/content-chatgpt.js',
  'Gemini': 'content-scripts/content-gemini.js',
  'Claude': 'content-scripts/content-claude.js',
  'Grok': 'content-scripts/content-grok.js',
  'Le Chat': 'content-scripts/content-lechat.js',
  'Qwen': 'content-scripts/content-qwen.js',
  'DeepSeek': 'content-scripts/content-deepseek.js',
  'Perplexity': 'content-scripts/content-perplexity.js',
  'Z.ai': 'content-scripts/content-zai.js',
  'Kimi': 'content-scripts/content-kimi.js'
};

const healthSessionTimerManager = (() => {
  const register = (typeof self?.registerSessionTimer === 'function') ? self.registerSessionTimer : (id) => id;
  const deregister = (typeof self?.deregisterSessionTimer === 'function') ? self.deregisterSessionTimer : () => {};
  return { register, deregister };
})();
const healthRegisterSessionTimer = healthSessionTimerManager.register;
const healthDeregisterSessionTimer = healthSessionTimerManager.deregister;

const awaitSessionDelay = (ms) => new Promise((resolve) => {
  const duration = Math.max(0, ms || 0);
  if (duration <= 0) {
    resolve();
    return;
  }
  let timer = null;
  timer = healthRegisterSessionTimer(setTimeout(() => {
    healthDeregisterSessionTimer(timer);
    resolve();
  }, duration));
});

function runHealthChecks() {
  const activeTabs = TabMapManager.entries();
  if (!activeTabs.length) {
    return;
  }

  // Avoid false alarms during active prompt dispatch (focus changes, navigation, CPU spikes).
  if (typeof promptDispatchInProgress === 'number' && promptDispatchInProgress > 0) {
    return;
  }

  globalThis.LLMLog?.debug?.('[HEALTH-CHECK] Running checks for active tabs.');
  activeTabs.forEach(async ([llmName, tabId]) => {
    const entry = jobState?.llms?.[llmName];
    // Avoid false alarms before we even dispatch a prompt.
    if (entry) {
      const flags = self.getDispatchFlags ? self.getDispatchFlags(llmName, entry) : null;
      if (flags && !flags.isInProgress && !flags.isSent) {
        return;
      }
    }

    // Skip tabs that have already completed their session.
    if (isTerminalHealthEntry(entry)) {
      globalThis.LLMLog?.debug?.(`[HEALTH-CHECK] Skipping ${llmName} - session in terminal state: ${entry?.modelRunState?.terminalStatus || entry?.finalStatus || entry?.status || 'terminal'}`);
      return;
    }

    const hardStopped = await getHardStoppedTabs();
    if (hardStopped.has(tabId)) return;
    if (pendingPingByTabId.has(tabId)) return;
    const pingId = `${llmName}-${Date.now()}`;
    pendingPings.set(pingId, { llmName, tabId });
    pendingPingByTabId.set(tabId, pingId);

    let timeoutTimer = null;
    timeoutTimer = healthRegisterSessionTimer(setTimeout(() => {
      healthDeregisterSessionTimer(timeoutTimer);
      if (pendingPings.has(pingId)) {
        console.error(`[HEALTH-CHECK] Timeout: No PONG received from ${llmName} (tab ${tabId}).`);
        pendingPings.delete(pingId);
        if (pendingPingByTabId.get(tabId) === pingId) pendingPingByTabId.delete(tabId);

        // Skip counting failures while we're actively dispatching prompts.
        if (typeof promptDispatchInProgress === 'number' && promptDispatchInProgress > 0) {
          return;
        }

        // Advisory only: never STOP_AND_CLEANUP all tabs from a single missed pong.
        const failures = (healthCheckFailuresByTabId.get(tabId) || 0) + 1;
        healthCheckFailuresByTabId.set(tabId, failures);

        if (failures >= HEALTH_CHECK_FAILURE_THRESHOLD) {
          const now = Date.now();
          const lastReportAt = lastHealthCheckReportAtByTabId.get(tabId) || 0;
          if (now - lastReportAt >= HEALTH_CHECK_ERROR_COOLDOWN_MS) {
            lastHealthCheckReportAtByTabId.set(tabId, now);
            updateModelState(llmName, 'UNRESPONSIVE', {
              message: `Tab for ${llmName} is unresponsive (${failures}× missed).`,
              failures
            });
          }
        }
      }
    }, HEALTH_CHECK_TIMEOUT_MS));

    chrome.tabs.sendMessage(tabId, { type: 'HEALTH_CHECK_PING', pingId: pingId }, (response) => {
      if (chrome.runtime.lastError) {
        if (timeoutTimer) {
          clearTimeout(timeoutTimer);
          healthDeregisterSessionTimer(timeoutTimer);
          timeoutTimer = null;
        }
        console.error(
          `[HEALTH-CHECK] Immediate error pinging ${llmName} (tab ${tabId}).`,
          chrome.runtime.lastError.message
        );
        // No receiver / navigation / permission issues: clear pending ping to avoid counting a timeout.
        pendingPings.delete(pingId);
        if (pendingPingByTabId.get(tabId) === pingId) pendingPingByTabId.delete(tabId);
        return;
      }
      // Handle PONG response from content script's sendResponse.
      if (timeoutTimer) {
        clearTimeout(timeoutTimer);
        healthDeregisterSessionTimer(timeoutTimer);
        timeoutTimer = null;
      }
      if (response?.type === 'HEALTH_CHECK_PONG' && response?.pingId === pingId) {
        globalThis.LLMLog?.debug?.(`[HEALTH-CHECK] PONG received from ${llmName} (via callback)`);
        pendingPings.delete(pingId);
        if (pendingPingByTabId.get(tabId) === pingId) pendingPingByTabId.delete(tabId);
        healthCheckFailuresByTabId.set(tabId, 0);
      }
    });

  });
}
// --- V2.0 END: Health Check System ---

//-- 14.1. Heartbeat система для отслеживания активности content scripts --//
const HEARTBEAT_INTERVAL = TimingConfig.getTiming('heartbeatIntervalMs', 5000); // 5 секунд
const HEARTBEAT_TIMEOUT = TimingConfig.getTiming('heartbeatTimeoutMs', 15000); // 15 секунд

let heartbeatTimer = null;

function startHeartbeatMonitor() {
  if (heartbeatTimer) return;

  globalThis.LLMLog?.debug?.('[HEARTBEAT] Starting monitor...');
  heartbeatTimer = healthRegisterSessionTimer(setInterval(async () => {
    const entries = TabMapManager.entries();
    if (!entries.length) {
      pendingPings.clear();
      stopHeartbeatMonitor();
      return;
    }

    // Filter to only active (non-terminal) sessions.
    const activeEntries = entries.filter(([llmName]) => {
      return !isTerminalHealthEntry(jobState?.llms?.[llmName]);
    });

    if (!activeEntries.length) {
      globalThis.LLMLog?.debug?.('[HEARTBEAT] All sessions in terminal state, stopping monitor');
      pendingPings.clear();
      stopHeartbeatMonitor();
      return;
    }

    runHealthChecks();
  }, HEARTBEAT_INTERVAL));
}

function stopHeartbeatMonitor() {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    healthDeregisterSessionTimer(heartbeatTimer);
    heartbeatTimer = null;
    globalThis.LLMLog?.debug?.('[HEARTBEAT] Monitor stopped');
  }
}

async function checkScriptHealth(tabId, llmName, { silent = false, timeoutMs = HEALTH_CHECK_TIMEOUT_MS } = {}) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (healthy) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(healthy);
    };
    const timer = setTimeout(() => finish(false), timeoutMs);
    try {
    chrome.tabs.sendMessage(tabId, { type: 'HEALTH_CHECK_PING', pingId: `health_${Date.now()}` }, (response) => {
      const runtimeError = chrome.runtime.lastError;
      if (settled) return;
      if (runtimeError || !response) {
        if (!silent) {
          const errMsg = chrome.runtime.lastError?.message || 'no response';
          emitTelemetry(llmName, 'SCRIPT_HEALTH_FAIL', {
            details: errMsg,
            level: 'warning',
            meta: { tabId, reason: 'health_ping_failed' }
          });
          console.warn(`[BACKGROUND] Script health check failed for ${llmName}`);
        }
        finish(false);
        return;
      }
      if (!silent) {
        globalThis.LLMLog?.debug?.(`[BACKGROUND] Script healthy for ${llmName}`);
      }
      finish(true);
    });
    } catch (_) {
      finish(false);
    }
  });
}

const READY_WAIT_TIMEOUT_MS = TimingConfig.getTiming('readyAckTimeoutMs', 8000);

function requestFreshScriptReady(tabId, llmName) {
  try {
    chrome.tabs.sendMessage(tabId, {
      type: 'REQUEST_SCRIPT_READY',
      llmName,
      reason: 'dispatch_handshake_recovery'
    }, () => {
      // The request is a wake-up signal. SCRIPT_READY arrives through the
      // runtime channel, so this callback intentionally ignores the body.
      void chrome.runtime.lastError;
    });
    return true;
  } catch (_) {
    return false;
  }
}

async function waitForScriptReady(tabId, llmName, { timeoutMs = READY_WAIT_TIMEOUT_MS, intervalMs = 250 } = {}) {
  if (self.ReadySignalManager?.waitForReady) {
    // MV3 can restart the service worker while an old provider page remains
    // fully alive. In that case the in-memory handshake maps are empty, but the
    // page has already stopped its finite SCRIPT_READY retry loop. Ask that page
    // to replay the same tab-session handshake instead of spending the entire
    // ACK timeout before reloading it.
    const handshakeCurrent = self.ReadySignalManager.hasCorrelatedHandshake?.(tabId) === true;
    if (!handshakeCurrent) {
      const requested = requestFreshScriptReady(tabId, llmName);
      emitTelemetry(llmName, 'READY_REANNOUNCE_REQUESTED', {
        details: requested ? 'requested' : 'send_failed',
        level: requested ? 'info' : 'warning',
        meta: { tabId, requested, reason: 'handshake_not_correlated' }
      });
    }
    let info = null;
    try {
      info = await self.ReadySignalManager.waitForReady(tabId, timeoutMs);
    } catch (err) {
      console.warn('[READY] waitForReady failed', err?.message || err);
      return false;
    }
    if (self.ReadySignalManager.waitForAck) {
      try {
        await self.ReadySignalManager.waitForAck(tabId, info?.tabSessionId || null, timeoutMs);
      } catch (ackErr) {
        console.warn('[READY] waitForAck failed', ackErr?.message || ackErr);
        return false;
      }
    }
    return true;
  }
  const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const ok = await checkScriptHealth(tabId, llmName, { silent: true });
      if (ok) return true;
      await awaitSessionDelay(intervalMs);
    }
    return false;
  }

async function reinjectScript(tabId, llmName) {
  const scriptFile = SCRIPT_MAP[llmName];
  if (!scriptFile) {
    console.error(`[BACKGROUND] No script mapping for ${llmName}`);
    return false;
  }
  const entry = jobState?.llms?.[llmName] || null;
  const confirmedActiveRun = Boolean(
    entry
    && !isTerminalHealthEntry(entry)
    && (entry.promptSubmittedAt || entry.confirmedDispatchId || entry.submitSource === 'content')
  );
  if (confirmedActiveRun) {
    emitTelemetry(llmName, 'SCRIPT_REINJECT_SKIPPED_ACTIVE_RUN', {
      level: 'warning',
      details: 'preserve_confirmed_provider_page',
      meta: {
        tabId,
        dispatchId: entry.confirmedDispatchId || entry?.lastDispatchMeta?.dispatchId || null,
        status: entry.status || null,
        generationState: entry?.modelRunState?.generationState || null
      },
      force: true
    });
    return false;
  }

  globalThis.LLMLog?.debug?.(`[BACKGROUND] Reinjecting ${scriptFile} into tab ${tabId}...`);
  emitTelemetry(llmName, 'SCRIPT_REINJECT_START', {
    meta: { tabId, scriptFile }
  });

  try {
    return new Promise((resolve) => {
      let reloadTimer = null;
      let settled = false;
      let reloadRequested = false;
      const finish = (ok, reason) => {
        if (settled) return;
        settled = true;
        chrome.tabs.onUpdated.removeListener(listener);
        clearTimeout(reloadTimer);
        healthDeregisterSessionTimer(reloadTimer);
        emitTelemetry(llmName, 'SCRIPT_REINJECT_RESULT', {
          details: reason,
          level: ok ? 'info' : 'warning',
          meta: { tabId, scriptFile, ok, reason }
        });
        resolve(ok);
      };
      const listener = (changedTabId, changeInfo) => {
        if (reloadRequested && changedTabId === tabId && changeInfo.status === 'complete') {
          finish(true, 'ok');
        }
      };
      chrome.tabs.onUpdated.addListener(listener);
      reloadTimer = healthRegisterSessionTimer(setTimeout(() => finish(false, 'timeout'), 30000));
      // Arm before requesting reload: a hanging API promise must not hold the
      // dispatch queue, and a fast complete event must not escape the listener.
      void (async () => {
        try {
          chrome.tabs.sendMessage(tabId, { type: 'FORCE_CLEANUP' }).catch(() => {});
          await awaitSessionDelay(500);
          if (settled) return;
          reloadRequested = true;
          await chrome.tabs.reload(tabId);
        } catch (_) { finish(false, 'exception'); }
      })();
    });
  } catch (err) {
    console.error(`[BACKGROUND] Reinject failed for ${llmName}:`, err);
    emitTelemetry(llmName, 'SCRIPT_REINJECT_RESULT', {
      details: err?.message || 'reinject_failed',
      level: 'error',
      meta: { tabId, scriptFile, ok: false, reason: 'exception' }
    });
    return false;
  }
}

async function prepareTabForUse(tabId, llmName) {
  globalThis.LLMLog?.debug?.(`[BACKGROUND] Preparing tab for ${llmName}...`);
  const isHealthy = await checkScriptHealth(tabId, llmName);
  if (!isHealthy) {
    console.warn(`[BACKGROUND] Script unhealthy for ${llmName}, reinjecting...`);
    const success = await reinjectScript(tabId, llmName);
    if (!success) {
      throw new Error(`Failed to reinject script for ${llmName}`);
    }
  }
  return true;
}

self.HEALTH_CHECK_TIMEOUT_MS = HEALTH_CHECK_TIMEOUT_MS;
self.HEALTH_CHECK_FAILURE_THRESHOLD = HEALTH_CHECK_FAILURE_THRESHOLD;
self.HEALTH_CHECK_ERROR_COOLDOWN_MS = HEALTH_CHECK_ERROR_COOLDOWN_MS;
self.pendingPings = pendingPings;
self.pendingPingByTabId = pendingPingByTabId;
self.healthCheckFailuresByTabId = healthCheckFailuresByTabId;
self.lastHealthCheckReportAtByTabId = lastHealthCheckReportAtByTabId;
self.isTerminalHealthEntry = isTerminalHealthEntry;
self.SCRIPT_MAP = SCRIPT_MAP;
self.HEARTBEAT_INTERVAL = HEARTBEAT_INTERVAL;
self.HEARTBEAT_TIMEOUT = HEARTBEAT_TIMEOUT;
self.runHealthChecks = runHealthChecks;
self.startHeartbeatMonitor = startHeartbeatMonitor;
self.stopHeartbeatMonitor = stopHeartbeatMonitor;
self.checkScriptHealth = checkScriptHealth;
self.requestFreshScriptReady = requestFreshScriptReady;
self.waitForScriptReady = waitForScriptReady;
self.reinjectScript = reinjectScript;
self.prepareTabForUse = prepareTabForUse;
