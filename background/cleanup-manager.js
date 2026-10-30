// background/cleanup-manager.js
// Tab cleanup helpers and snapshots.

'use strict';

const DEBUG_CLEANUP_LOGS = false;
const DEBUG_CLEANUP_TELEMETRY = false;

function shouldPreserveRunModelEntry(llmName) {
  if (!llmName) return false;
  const session = jobState?.session;
  if (!session?.startTime) return false;
  const selected = Array.isArray(session.selectedModels) ? session.selectedModels : [];
  return selected.includes(llmName);
}

function cleanupTabResources(tabId, reason = 'unknown') {
  const llmName = TabMapManager.getNameByTabId(tabId);
  if (DEBUG_CLEANUP_LOGS || DEBUG_CLEANUP_TELEMETRY) {
    logCleanupSnapshot(tabId, llmName, 'before', { reason });
  }
  if (typeof untrackSessionTab === 'function') {
    untrackSessionTab(tabId);
  }
  closePingWindowForTab(tabId);
  pendingPingByTabId.delete(tabId);
  if (pendingPings.size) {
    Array.from(pendingPings.entries()).forEach(([pingId, meta]) => {
      if (meta?.tabId === tabId) {
        pendingPings.delete(pingId);
      }
    });
  }
  healthCheckFailuresByTabId.delete(tabId);
  lastHealthCheckReportAtByTabId.delete(tabId);
  delete llmActivityMap[tabId];
  removeActiveListenerForTab(tabId);
  if (!llmName) {
    if (DEBUG_CLEANUP_LOGS || DEBUG_CLEANUP_TELEMETRY) {
      logCleanupSnapshot(tabId, llmName, 'after', { reason });
    }
    return;
  }
  promptSubmitWaiters.delete(llmName);
  void Promise.resolve(self.cancelRateLimitRetry(llmName)).catch((err) => {
    console.warn(`[BACKGROUND] Failed to clear rate-limit retry for ${llmName}:`, err?.message || err);
  });
  dispatchMutexManager.clear(llmName);
  clearDeferredAnswerTimer(llmName);
  clearPostSuccessScrollAudit(llmName);
  if (llmStartChains[llmName]) {
    delete llmStartChains[llmName];
  }
  if (jobState?.llms?.[llmName]) {
    const preserveEntry = shouldPreserveRunModelEntry(llmName);
    if (preserveEntry) {
      const entry = jobState.llms[llmName];
      if (entry) {
        entry.tabId = null;
        entry.dispatchInFlight = false;
        entry.messageSent = false;
        entry.dispatchState = 'IDLE';
        entry.automationVisitActive = false;
        entry.automationVisitStartedAt = null;
        entry.transientBlocker = null;
        entry.transientBlockerActive = null;
        entry.transientBlockerActiveAt = 0;
        entry.transientBlockerRunSessionId = null;
        entry.transientBlockerDispatchId = null;
        entry.transientBlockerTabId = null;
      }
    } else {
      delete jobState.llms[llmName];
    }
  }
  const finalizeSnapshot = (extra = {}) => {
    if (DEBUG_CLEANUP_LOGS || DEBUG_CLEANUP_TELEMETRY) {
      logCleanupSnapshot(tabId, llmName, 'after', { reason, ...extra });
    }
  };
  const reportCleanupStatus = (extra = {}) => {
    const payload = {
      type: 'SMART_CLEANUP_EVENT',
      llmName: llmName || null,
      tabId,
      reason,
      jobStateEntryRemaining: !!(llmName && jobState?.llms?.[llmName]),
      tabMapHasEntry: !!(llmName && TabMapManager.get(llmName)),
      sessionTabTracked: sessionTabIds.has(tabId),
      ...extra
    };
    try {
      if (typeof sendMessageToResultsTab === 'function') {
        sendMessageToResultsTab(payload);
      }
    } catch (_) {}
  };
  TabMapManager.removeByTabId(tabId)
    .then(() => {
      finalizeSnapshot();
      reportCleanupStatus({ status: 'success' });
    })
    .catch((err) => {
      console.warn('[BACKGROUND] Failed to remove tab from map during cleanup:', err);
      finalizeSnapshot({ tabMapRemoveError: err?.message || String(err) });
      reportCleanupStatus({ status: 'failed', error: err?.message || String(err) });
    });
}

function buildCleanupSnapshot(tabId, llmName, phase) {
  const pendingPingsForTab = pendingPings.size
    ? Array.from(pendingPings.values()).filter((meta) => meta?.tabId === tabId).length
    : 0;
  return {
    phase,
    tabId,
    llmName,
    tabMapNameForTabId: TabMapManager.getNameByTabId(tabId),
    jobState: !!(llmName && jobState?.llms?.[llmName]),
    rateLimitState: !!(llmName && rateLimitState.has(llmName)),
    promptSubmitWaiters: !!(llmName && promptSubmitWaiters.has(llmName)),
    llmStartChain: !!(llmName && llmStartChains[llmName]),
    rateLimitRetry: !!(llmName && self.hasRateLimitRetry(llmName)),
    deferredAnswerTimer: !!(llmName && deferredAnswerTimers[llmName]),
    postSuccessScrollTimers: !!(llmName && postSuccessScrollTimers.has(llmName)),
    pingWindow: !!pingWindowByTabId[tabId],
    pendingPingByTabId: pendingPingByTabId.has(tabId),
    pendingPingsForTab,
    activeListener: activeListeners.has(tabId),
    healthCheckFailures: healthCheckFailuresByTabId.has(tabId),
    lastHealthCheckReport: lastHealthCheckReportAtByTabId.has(tabId)
  };
}

function logCleanupSnapshot(tabId, llmName, phase, extra = {}) {
  const snapshot = Object.assign(buildCleanupSnapshot(tabId, llmName, phase), extra);
  if (DEBUG_CLEANUP_LOGS) {
    globalThis.LLMLog?.debug?.('[CLEANUP]', snapshot);
  }
  if (DEBUG_CLEANUP_TELEMETRY && llmName) {
    emitTelemetry(llmName, 'CLEANUP_STATE', {
      level: 'info',
      details: phase,
      meta: snapshot,
      force: true
    });
  }
}

self.cleanupTabResources = cleanupTabResources;
self.buildCleanupSnapshot = buildCleanupSnapshot;
self.logCleanupSnapshot = logCleanupSnapshot;

globalThis.LLMLog?.debug?.('[CleanupManager] Module loaded');
