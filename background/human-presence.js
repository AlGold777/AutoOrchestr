// background/human-presence.js
// Human visit loop and tab visit tracking.

'use strict';

const HUMAN_VISIT_INITIAL_DELAY_MS = 7000;
//- 4.1. Ускоряем технические визиты, чтобы не "залипать" на вкладках -//
const HUMAN_VISIT_DWELL_MS = 3000;
const HUMAN_VISIT_SCROLL_DURATION_MS = 3600;
const HUMAN_VISIT_LOOP_PAUSE_MS = 1500;
const HUMAN_VISIT_ALERT_THRESHOLD = 6;
const HUMAN_VISIT_HARD_CAP_MS = 12000;
const VISIT_QUOTA_WINDOW_MS = 60000;
// T5 (timing review): the scheduled visits (round2 2x5-8s + round3 precollect
// 5-8s + post-R2 5-8s + materialize 5-7.6s) plan 20-30s of foreground time per
// minute; a 12s quota made planned visits block each other in every real run.
const VISIT_QUOTA_MAX_MS = 20000;
const VISIT_QUOTA_COOLDOWN_MS = 15000;
const HUMAN_VISIT_MIN_USEFUL_MS = 1500;
const POST_SUCCESS_SCROLL_ATTEMPTS_MS = [0, 1200, 3600];
const POST_SUCCESS_AUDIT_ALARM_PREFIX = 'post_success_answer_audit::';
const DEFERRED_VISIT_DELAYS_MS = [15000, 45000, 90000];
const TAB_LEASE_TTL_MS = HUMAN_VISIT_HARD_CAP_MS;
const PROGRAMMATIC_FOCUS_GRACE_MS = 1500;

// Reported 2026-07-31: the extension "stays active 10-15 minutes and steals
// focus even from other programs". The human/automation visit loop runs while
// any model is non-terminal, and each visit called
// chrome.windows.update({ focused: true }), which raises the Chrome window over
// whatever application the user is actually working in.
//
// A visit needs the tab foregrounded *inside Chrome*; it does not need Chrome
// itself pulled in front of another app. If no Chrome window currently holds
// focus the user is elsewhere, so the window raise is skipped and only the tab
// activation proceeds. Returns whether the window was raised.
async function raiseWindowUnlessUserIsElsewhere(windowId, context = '', isCurrent = () => true) {
  const browserHasFocus = await new Promise((resolve) => {
    try {
      chrome.windows.getLastFocused({}, (win) => {
        if (chrome.runtime.lastError || !win) {
          // Unknown state: do not steal focus on a guess.
          resolve(false);
          return;
        }
        resolve(win.focused === true);
      });
    } catch (_) {
      resolve(false);
    }
  });
  if (!browserHasFocus || !isCurrent()) {
    try {
      emitTelemetry?.('SYSTEM', 'WINDOW_FOCUS_YIELDED_TO_USER', {
        details: context,
        meta: { windowId, context, reason: 'browser_not_frontmost' }
      });
    } catch (_) {}
    return false;
  }
  await new Promise((resolve) => {
    try {
      chrome.windows.update(windowId, { focused: true }, () => {
        if (chrome.runtime.lastError) {
          console.warn(`[VISIT] Window focus failed (${context}):`, chrome.runtime.lastError.message);
        }
        resolve();
      });
    } catch (_) {
      resolve();
    }
  });
  return true;
}

var humanPresenceLoopTimeout = null;
var humanPresenceActive = false;
var humanPresencePaused = false;
var humanPresenceManuallyStopped = false;
var currentHumanVisit = null;
var browserHasFocus = true;
const FOCUS_STUCK_THRESHOLD_MS = 30000;
let focusStuckTimer = null;
let focusStuckMeta = null;
let visitHardCapTimer = null;
let userFocusObservation = null;
const automationVisitLocks = new Map();
const deferredAnswerTimers = {};
const postSuccessScrollTimers = new Map();
const programmaticFocusByTabId = new Map();

const resolveBoundTabIdForHuman = (llmName, entry = null) => {
  if (typeof self.getBoundTabId === 'function') {
    return self.getBoundTabId(llmName, entry);
  }
  if (typeof TabMapManager !== 'undefined' && typeof TabMapManager.get === 'function') {
    return TabMapManager.get(llmName) || null;
  }
  return null;
};

const isTerminalEntry = (entry) => {
  if (!entry) return false;
  if (self.ModelRunState?.isTerminalRunState?.(entry)) return true;
  if (self.ModelRunState?.isTerminalStatus?.(entry.status)) return true;
  if (entry.finalStatusRecorded || entry.finalStatus) return true;
  return false;
};

const isActiveFocusWindowOpen = (llmName, entry, source = 'focus_check') => {
  if (!entry) return false;
  const allowed = typeof self.isActiveFocusAllowedForEntry === 'function'
    ? self.isActiveFocusAllowedForEntry(entry)
    : true;
  if (allowed) return true;
  entry.skipHumanLoop = true;
  if (!entry.activeFocusExhaustedAt) {
    entry.activeFocusExhaustedAt = Date.now();
    emitTelemetry(llmName, 'ACTIVE_FOCUS_WINDOW_EXHAUSTED', {
      level: 'info',
      details: source,
      meta: {
        source,
        startedAt: entry.activeFocusStartedAt || entry?.budgetTimers?.generation?.startedAt || entry.promptSubmittedAt || null,
        budgetMs: entry.activeFocusBudgetMs || self.getActiveFocusWindowMs?.() || null,
        deadlineAt: entry.activeFocusDeadlineAt || null,
        passiveGenerationContinues: true
      },
      force: true
    });
    saveJobState(jobState);
  }
  return false;
};

const isSuccessTerminalEntry = (entry) => {
  if (!entry) return false;
  if (entry.modelRunState?.terminalState === 'success') return true;
  const status = String(entry.finalStatus || entry.status || '').toUpperCase();
  if (self.ModelRunState?.isSuccessStatus) {
    return self.ModelRunState.isSuccessStatus(status) && Boolean(entry.finalStatusRecorded || entry.finalStatus || entry.finalizedAt);
  }
  const successStatuses = Array.isArray(SUCCESS_STATUSES)
    ? SUCCESS_STATUSES
    : ['COPY_SUCCESS', 'SUCCESS', 'DONE', 'PARTIAL', 'STREAM_TIMEOUT_HIDDEN'];
  return successStatuses.includes(status) && Boolean(entry.finalStatusRecorded || entry.finalStatus || entry.finalizedAt);
};

function completeHumanPresenceForModel(llmName, reason = 'terminal_success') {
  if (!llmName) return;
  const entry = jobState?.llms?.[llmName];
  if (entry) {
    entry.automationVisitActive = false;
    entry.automationVisitStartedAt = null;
    entry.skipHumanLoop = true;
    entry.visitQuotaBackoffUntil = 0;
    entry.transportBackoffUntil = 0;
  }
  clearPostSuccessScrollAudit(llmName);
  Array.from(automationVisitLocks.keys()).forEach((key) => {
    if (key.startsWith(`${llmName}:`)) automationVisitLocks.delete(key);
  });
  if (currentHumanVisit?.llmName === llmName) {
    try { currentHumanVisit.cancel?.(); } catch (_) { /* noop */ }
    currentHumanVisit = null;
    return;
  }
  if (tabVisitTracker.llmName === llmName) {
    finalizeTabVisit(reason);
    return;
  }
  if (focusStuckMeta?.llmName === llmName) {
    clearFocusStuckTimer(reason);
  }
}

function stopHumanPresenceLoop() {
  if (humanPresenceLoopTimeout) {
    clearTimeout(humanPresenceLoopTimeout);
    humanPresenceLoopTimeout = null;
  }
  clearVisitHardCapTimer('stop_loop');
  humanPresenceActive = false;
  broadcastHumanVisitStatus();
}

// Reported 2026-08-04: a run with an attachment on existing pages never
// inserted the prompt — the ledger shows only human_visit leases cycling over
// the model tabs while no dispatch was in flight. `promptDispatchInProgress`
// covers a single in-flight dispatch, but Round 0 and the gaps between models
// leave it at zero, so any restart trigger (window focus regained, job state
// rehydrated after a worker restart) let the loop foreground another model's
// tab while the rounds were still acquiring tabs and inserting the prompt.
// Rounds own tab focus for their whole duration.
function dispatchOwnsTabFocus() {
  return promptDispatchInProgress > 0 || jobState?.session?.roundsInProgress === true;
}

function scheduleHumanPresenceLoop(immediate = false) {
  if (dispatchOwnsTabFocus()) return;
  if (humanPresencePaused || humanPresenceManuallyStopped) return;
  if (!hasPendingHumanVisits()) {
    stopHumanPresenceLoop();
    if (!jobState?.session?.roundsInProgress) {
      focusResultsTab();
    }
    return;
  }
  if (!browserHasFocus) {
    humanPresenceActive = false;
    broadcastHumanVisitStatus();
    return;
  }
  if (humanPresenceLoopTimeout) {
    clearTimeout(humanPresenceLoopTimeout);
  }
  humanPresenceActive = true;
  const delay = immediate ? 0 : HUMAN_VISIT_INITIAL_DELAY_MS;
  humanPresenceLoopTimeout = setTimeout(() => {
    humanPresenceLoopTimeout = null;
    runHumanPresenceCycle();
  }, delay);
  broadcastHumanVisitStatus();
}

function hasPendingHumanVisits() {
  const selectedModels = Array.isArray(jobState?.session?.selectedModels)
    ? jobState.session.selectedModels
    : Object.keys(jobState?.llms || {});
  if (!selectedModels.length) return false;
  return selectedModels.some((llmName) => {
    const entry = jobState?.llms?.[llmName];
    if (!entry) return true;
    if (isTerminalEntry(entry) || entry.skipHumanLoop) {
      return false;
    }
    return true;
  });
}

function broadcastHumanVisitStatus() {
  if (!chrome?.runtime?.sendMessage) return;
  const llmEntries = jobState?.llms
    ? Object.entries(jobState.llms).map(([name, entry]) => ({
      name,
      status: entry?.status || 'IDLE',
      visits: entry?.humanVisits || 0,
      stalled: !!entry?.humanStalled,
      skipped: !!entry?.skipHumanLoop,
      enabled: !entry?.skipHumanLoop,
      state: deriveHumanState(entry, name)
    }))
    : [];
  const payload = {
    active: humanPresenceActive,
    paused: humanPresencePaused,
    stopped: humanPresenceManuallyStopped,
    pending: hasPendingHumanVisits(),
    llms: llmEntries
  };
  chrome.runtime.sendMessage({ type: 'HUMAN_VISIT_STATUS', payload }, () => {
    if (chrome.runtime.lastError) {
      // ignore; overlay may not be listening
    }
  });
  TabMapManager.entries().forEach(([, tabId]) => {
    if (!isValidTabId(tabId)) return;
    chrome.tabs.sendMessage(tabId, { type: 'HUMAN_VISIT_STATUS', payload }, () => {
      if (chrome.runtime.lastError) {
        // ignore missing scripts
      }
    });
  });
}

function raiseHumanVisitAlert(llmName, visits) {
  const entry = jobState?.llms?.[llmName];
  if (!entry || entry.humanStalled) return;
  entry.humanStalled = true;
  entry.skipHumanLoop = true;
  broadcastHumanVisitStatus();
  if (!hasPendingHumanVisits()) {
    stopHumanPresenceLoop();
    focusResultsTab();
  }
}

function handleHumanVisitControl(action) {
  if (!action) return;
  if (action === 'pause') {
    humanPresencePaused = true;
    stopHumanPresenceLoop();
  } else if (action === 'continue') {
    humanPresencePaused = false;
    humanPresenceManuallyStopped = false;
    if (hasPendingHumanVisits()) {
      scheduleHumanPresenceLoop(true);
    }
  } else if (action === 'stop') {
    humanPresenceManuallyStopped = true;
    stopHumanPresenceLoop();
  }
  broadcastHumanVisitStatus();
}

function handleHumanVisitModelToggle(llmName, enabled) {
  if (!llmName || !jobState?.llms?.[llmName]) return;
  const entry = jobState.llms[llmName];
  entry.skipHumanLoop = enabled === false ? true : false;
  if (!entry.skipHumanLoop) {
    entry.humanVisits = 0;
    entry.humanStalled = false;
  }
  if (entry.skipHumanLoop && currentHumanVisit?.llmName === llmName) {
    currentHumanVisit.cancel?.();
  }
  broadcastHumanVisitStatus();
  if (entry.skipHumanLoop) {
    if (!hasPendingHumanVisits()) {
      stopHumanPresenceLoop();
      focusResultsTab();
    }
  } else if (!humanPresencePaused && !humanPresenceManuallyStopped) {
    scheduleHumanPresenceLoop(true);
  }
}

function handleBrowserFocusChange(hasFocus) {
  if (browserHasFocus === hasFocus) return;
  browserHasFocus = hasFocus;
  if (!hasFocus) {
    finalizeUserFocusObservation('window_blur');
    finalizeTabVisit('window_blur');
    clearFocusStuckTimer('window_blur');
    if (currentHumanVisit?.cancel) {
      try { currentHumanVisit.cancel(); } catch (_) { /* noop */ }
    }
    stopHumanPresenceLoop();
  } else if (!humanPresencePaused && !humanPresenceManuallyStopped && hasPendingHumanVisits()) {
    scheduleHumanPresenceLoop(true);
  } else {
    broadcastHumanVisitStatus();
  }
  if (hasFocus) {
    chrome.tabs.query({ active: true, lastFocusedWindow: true }, (tabs) => {
      const activeTab = tabs && tabs.length ? tabs[0] : null;
      if (!activeTab) return;
      handleTabActivation(activeTab.id, activeTab.windowId);
    });
  }
}

function handleTabActivation(tabId, _windowId) {
  if (!isValidTabId(tabId)) return;
  const llmName = TabMapManager.getNameByTabId(tabId);
  const programmaticFocus = consumeProgrammaticTabFocus(tabId);
  if (programmaticFocus) {
    if (userFocusObservation?.tabId !== tabId) {
      finalizeUserFocusObservation('programmatic_tab_switch');
    }
    emitTelemetry(llmName || programmaticFocus.llmName || 'ROUNDS', 'TAB_ACTIVATION_IGNORED_PROGRAMMATIC', {
      details: programmaticFocus.source || 'programmatic_focus',
      meta: {
        tabId,
        llmName: llmName || programmaticFocus.llmName || null,
        source: programmaticFocus.source || 'programmatic_focus',
        markedAt: programmaticFocus.markedAt,
        expiresAt: programmaticFocus.expiresAt
      },
      force: true
    });
    return;
  }
  if (!llmName) {
    finalizeUserFocusObservation('non_llm_focus');
    finalizeTabVisit('tab_switch');
    clearFocusStuckTimer('non_llm_focus');
    return;
  }
  recordUserFocusObservation(tabId, llmName);
}

function finalizeUserFocusObservation(reason = 'tab_switch') {
  if (!userFocusObservation) return null;
  const endedAt = Date.now();
  const summary = {
    ...userFocusObservation,
    endedAt,
    durationMs: Math.max(0, endedAt - Number(userFocusObservation.startedAt || endedAt)),
    reason
  };
  emitTelemetry(summary.llmName || 'ROUNDS', 'USER_FOCUS_OBSERVATION_ENDED', {
    meta: summary,
    force: true
  });
  userFocusObservation = null;
  return summary;
}

function recordUserFocusObservation(tabId, llmName) {
  if (!isValidTabId(tabId) || !llmName) return false;
  if (userFocusObservation?.tabId === tabId && userFocusObservation?.llmName === llmName) {
    return true;
  }
  finalizeUserFocusObservation('tab_switch');
  if (currentHumanVisit?.cancel) {
    try { currentHumanVisit.cancel(); } catch (_) { /* noop */ }
  } else if (tabVisitTracker.tabId || tabVisitTracker.llmName) {
    finalizeTabVisit('user_focus_preempt');
  }
  clearFocusStuckTimer('user_focus_observation');
  clearVisitHardCapTimer('user_focus_observation');
  userFocusObservation = {
    tabId,
    llmName,
    startedAt: Date.now(),
    source: 'user_focus'
  };
  emitTelemetry(llmName, 'USER_FOCUS_CHANGE', {
    meta: { tabId, source: 'user_focus' },
    force: true
  });
  emitTelemetry(llmName, 'USER_FOCUS_OBSERVATION_STARTED', {
    meta: { ...userFocusObservation },
    force: true
  });
  return true;
}

function clearExpiredProgrammaticFocus(now = Date.now()) {
  programmaticFocusByTabId.forEach((entry, key) => {
    if (!entry || Number(entry.expiresAt || 0) <= now) {
      programmaticFocusByTabId.delete(key);
    }
  });
}

function markProgrammaticTabFocus(tabId, source = 'programmatic_focus', options = {}) {
  if (!isValidTabId(tabId)) return false;
  clearExpiredProgrammaticFocus();
  const now = Date.now();
  const ttlMs = Math.max(250, Number(options.ttlMs || PROGRAMMATIC_FOCUS_GRACE_MS) || PROGRAMMATIC_FOCUS_GRACE_MS);
  const llmName = options.llmName || TabMapManager.getNameByTabId(tabId) || null;
  const entry = {
    tabId,
    llmName,
    source: source || 'programmatic_focus',
    markedAt: now,
    expiresAt: now + ttlMs
  };
  programmaticFocusByTabId.set(tabId, entry);
  emitTelemetry(llmName || 'ROUNDS', 'PROGRAMMATIC_FOCUS_START', {
    details: entry.source,
    meta: entry,
    force: true
  });
  // Every programmatic tab activation (dispatch, human visit, recovery visit)
  // goes through here: the Automation journal shows who moved the focus and why.
  try {
    if (typeof sendMessageToResultsTab === 'function') {
      sendMessageToResultsTab({
        type: 'TRANSPORT_FOCUS',
        llmName,
        tabId,
        source: entry.source,
        transportRequestId: (llmName && jobState?.llms?.[llmName]?.transportRequestId) || null,
        at: now
      });
    }
  } catch (_) {}
  return true;
}

function consumeProgrammaticTabFocus(tabId, now = Date.now()) {
  if (!isValidTabId(tabId)) return null;
  clearExpiredProgrammaticFocus(now);
  const entry = programmaticFocusByTabId.get(tabId) || null;
  if (!entry) return null;
  programmaticFocusByTabId.delete(tabId);
  return entry;
}

function clearFocusStuckTimer(reason = 'unknown') {
  if (focusStuckTimer) {
    clearTimeout(focusStuckTimer);
    focusStuckTimer = null;
  }
  focusStuckMeta = null;
}

function clearVisitHardCapTimer(reason = 'unknown') {
  if (visitHardCapTimer) {
    clearTimeout(visitHardCapTimer);
    visitHardCapTimer = null;
  }
}

function forceTerminateVisitByHardCap(tabId, llmName, source, startedAt, reason = 'hard_cap_timeout') {
  if (!tabId || !llmName) return;
  if (tabVisitTracker.tabId !== tabId || tabVisitTracker.llmName !== llmName) return;
  const durationMs = Math.max(0, Date.now() - Number(startedAt || Date.now()));
  const eventName = reason === 'focus_stuck' ? 'HUMAN_VISIT_FOCUS_STUCK_TERMINATED' : 'HUMAN_VISIT_HARD_CAP';
  emitTelemetry(llmName, eventName, {
    level: 'warning',
    details: `${durationMs}ms`,
    meta: {
      tabId,
      source: source || 'unknown',
      startedAt: Number(startedAt || Date.now()),
      durationMs,
      hardCapMs: HUMAN_VISIT_HARD_CAP_MS
    },
    force: true
  });
  broadcastDiagnostic(llmName, {
    type: 'VISIT',
    label: eventName,
    details: `${durationMs}ms`,
    level: 'warning',
    meta: {
      tabId,
      source: source || 'unknown',
      durationMs,
      hardCapMs: HUMAN_VISIT_HARD_CAP_MS
    }
  });
  const entry = jobState?.llms?.[llmName];
  if (entry) {
    entry.automationVisitActive = false;
    entry.automationVisitStartedAt = null;
  }
  if (currentHumanVisit?.llmName === llmName && typeof currentHumanVisit.cancel === 'function') {
    try { currentHumanVisit.cancel(); } catch (_) { /* noop */ }
    currentHumanVisit = null;
  } else {
    finalizeTabVisit(reason);
  }
  if (browserHasFocus && typeof focusResultsTab === 'function') {
    focusResultsTab();
  }
  broadcastHumanVisitStatus();
}

function scheduleVisitHardCapTimer(tabId, llmName, source, startedAt) {
  clearVisitHardCapTimer('reschedule');
  visitHardCapTimer = setTimeout(() => {
    visitHardCapTimer = null;
    forceTerminateVisitByHardCap(tabId, llmName, source, startedAt);
  }, HUMAN_VISIT_HARD_CAP_MS);
}

function buildTabLeaseKey(tabId, llmName) {
  return `${llmName || 'unknown'}:${Number(tabId || 0)}`;
}

function isTabLeaseExpired(now = Date.now()) {
  const expiresAt = Number(tabVisitTracker.leaseExpiresAt || 0);
  return Boolean(expiresAt && expiresAt <= now);
}

function canPreemptActiveTabLease(tabId, llmName, source = 'tab_focus', now = Date.now()) {
  if (!tabVisitTracker.tabId || !tabVisitTracker.llmName) {
    return { ok: true, reason: 'no_active_lease' };
  }
  if (tabVisitTracker.tabId === tabId && tabVisitTracker.llmName === llmName) {
    return { ok: true, reason: 'same_lease' };
  }
  if (isTabLeaseExpired(now)) {
    return { ok: true, reason: 'lease_expired' };
  }
  if (source === 'user_focus') {
    return { ok: true, reason: 'user_focus_preempt' };
  }
  return {
    ok: false,
    reason: 'active_lease',
    owner: tabVisitTracker.leaseOwner || tabVisitTracker.source || 'unknown',
    leaseKey: tabVisitTracker.leaseKey || buildTabLeaseKey(tabVisitTracker.tabId, tabVisitTracker.llmName),
    expiresAt: Number(tabVisitTracker.leaseExpiresAt || 0)
  };
}

function denyTabLease(tabId, llmName, source, decision) {
  const meta = {
    tabId,
    source: source || 'tab_focus',
    reason: decision?.reason || 'active_lease',
    owner: decision?.owner || 'unknown',
    activeLeaseKey: decision?.leaseKey || null,
    leaseExpiresAt: decision?.expiresAt || null,
    activeTabId: tabVisitTracker.tabId || null,
    activeLlmName: tabVisitTracker.llmName || null
  };
  emitTelemetry(llmName, 'LEASE_DENIED', {
    level: 'warning',
    details: meta.reason,
    meta,
    force: true
  });
  broadcastDiagnostic(llmName, {
    type: 'VISIT',
    label: 'LEASE_DENIED',
    details: meta.reason,
    level: 'warning',
    meta
  });
}

async function emitFocusStuckIfStillActive() {
  if (!focusStuckMeta) return;
  const { tabId, llmName, startedAt, source } = focusStuckMeta;
  if (!tabId || !llmName) return;
  if (tabVisitTracker.tabId !== tabId || tabVisitTracker.llmName !== llmName) return;
  const now = Date.now();
  const durationMs = Math.max(0, now - startedAt);
  const snapshot = tabVisitTracker.snapshot || (self.buildTabSnapshot && self.getTabSafe ? self.buildTabSnapshot(await self.getTabSafe(tabId)) : null);
  const timingMeta = self.buildTabTimingMeta ? self.buildTabTimingMeta(snapshot) : {};
  emitTelemetry(llmName, 'FOCUS_STUCK', {
    level: 'warning',
    meta: {
      tabId,
      startedAt,
      durationMs,
      source: source || 'unknown',
      snapshot,
      ...timingMeta
    },
    force: true
  });
  forceTerminateVisitByHardCap(tabId, llmName, source || 'focus_stuck', startedAt, 'focus_stuck');
}

function startTabVisit(tabId, llmName, source = 'tab_focus') {
  if (!isValidTabId(tabId) || !llmName) return false;
  // A real user viewing a tab is an observation, not a lease owned by the
  // automation scheduler. It has no TTL, hard cap or FOCUS_STUCK timer.
  if (source === 'user_focus') {
    return recordUserFocusObservation(tabId, llmName);
  }
  const entry = jobState?.llms?.[llmName];
  if (isTerminalEntry(entry)) {
    if (tabVisitTracker.tabId === tabId || tabVisitTracker.llmName === llmName) {
      finalizeTabVisit('terminal_focus_skip');
    }
    clearFocusStuckTimer('terminal_focus_skip');
    return false;
  }
  const leaseDecision = canPreemptActiveTabLease(tabId, llmName, source);
  if (!leaseDecision.ok) {
    denyTabLease(tabId, llmName, source, leaseDecision);
    return false;
  }
  const cappedSources = new Set(['human_visit', 'automation_focus']);
  if (tabVisitTracker.tabId === tabId) {
    const nextSource = source || tabVisitTracker.source || 'tab_focus';
    const sourceChanged = tabVisitTracker.source !== nextSource;
    if (sourceChanged) {
      tabVisitTracker.source = nextSource;
      if (cappedSources.has(nextSource)) {
        // Switching ownership to an active visit must restart timing and hard-cap guard.
        tabVisitTracker.startedAt = Date.now();
      }
    }
    tabVisitTracker.leaseOwner = tabVisitTracker.source || nextSource;
    tabVisitTracker.leaseKey = buildTabLeaseKey(tabId, llmName);
    tabVisitTracker.leaseExpiresAt = Date.now() + TAB_LEASE_TTL_MS;
    if (cappedSources.has(tabVisitTracker.source)) {
      scheduleVisitHardCapTimer(tabId, llmName, tabVisitTracker.source, tabVisitTracker.startedAt || Date.now());
    } else {
      clearVisitHardCapTimer('same_tab_non_capped');
    }
    return true;
  }
  if (leaseDecision.reason === 'lease_expired') {
    emitTelemetry(tabVisitTracker.llmName, 'LEASE_EXPIRED', {
      level: 'warning',
      details: tabVisitTracker.leaseKey || buildTabLeaseKey(tabVisitTracker.tabId, tabVisitTracker.llmName),
      meta: {
        tabId: tabVisitTracker.tabId,
        llmName: tabVisitTracker.llmName,
        source: tabVisitTracker.source || 'unknown',
        startedAt: tabVisitTracker.startedAt || null,
        leaseExpiresAt: tabVisitTracker.leaseExpiresAt || null
      },
      force: true
    });
    finalizeTabVisit('lease_expired_preempted');
  }
  finalizeTabVisit('tab_switch');
  tabVisitTracker.tabId = tabId;
  tabVisitTracker.llmName = llmName;
  tabVisitTracker.startedAt = Date.now();
  tabVisitTracker.source = source || 'tab_focus';
  tabVisitTracker.leaseOwner = tabVisitTracker.source;
  tabVisitTracker.leaseKey = buildTabLeaseKey(tabId, llmName);
  tabVisitTracker.leaseExpiresAt = tabVisitTracker.startedAt + TAB_LEASE_TTL_MS;
  if (self.getTabSafe && self.buildTabSnapshot) {
    self.getTabSafe(tabId).then((tab) => {
      tabVisitTracker.snapshot = self.buildTabSnapshot(tab);
    }).catch(() => {});
  }
  if (source === 'user_focus') {
    emitTelemetry(llmName, 'USER_FOCUS_CHANGE', {
      meta: {
        tabId,
        source
      },
      force: true
    });
  }
  emitTelemetry(llmName, 'LEASE_GRANTED', {
    meta: {
      tabId,
      source,
      startedAt: tabVisitTracker.startedAt,
      leaseKey: tabVisitTracker.leaseKey,
      leaseOwner: tabVisitTracker.leaseOwner,
      leaseTtlMs: TAB_LEASE_TTL_MS,
      leaseExpiresAt: tabVisitTracker.leaseExpiresAt
    },
    force: true
  });
  emitTelemetry(llmName, 'HUMAN_VISIT_START', {
    meta: {
      tabId,
      source
    },
    force: true
  });
  clearFocusStuckTimer('focus_changed');
  focusStuckMeta = { tabId, llmName, startedAt: tabVisitTracker.startedAt, source };
  focusStuckTimer = setTimeout(() => {
    focusStuckTimer = null;
    emitFocusStuckIfStillActive().catch(() => {});
  }, FOCUS_STUCK_THRESHOLD_MS);
  if (cappedSources.has(source)) {
    scheduleVisitHardCapTimer(tabId, llmName, source, tabVisitTracker.startedAt);
  } else {
    clearVisitHardCapTimer('non_capped_source');
  }
  return true;
}

function finalizeTabVisit(reason = 'tab_switch') {
  if (!tabVisitTracker.tabId || !tabVisitTracker.llmName) {
    clearVisitHardCapTimer('empty_visit');
    tabVisitTracker.tabId = null;
    tabVisitTracker.llmName = null;
    tabVisitTracker.startedAt = 0;
    tabVisitTracker.source = null;
    tabVisitTracker.snapshot = null;
    tabVisitTracker.leaseOwner = null;
    tabVisitTracker.leaseKey = null;
    tabVisitTracker.leaseExpiresAt = null;
    return null;
  }
  const endedAt = Date.now();
  const startedAt = tabVisitTracker.startedAt || endedAt;
  const durationMs = Math.max(0, endedAt - startedAt);
  const llmName = tabVisitTracker.llmName;
  const tabId = tabVisitTracker.tabId;
  const source = tabVisitTracker.source || 'unknown';
  const entry = jobState?.llms?.[llmName];
  const snapshot = tabVisitTracker.snapshot || null;
  const timingMeta = self.buildTabTimingMeta ? self.buildTabTimingMeta(snapshot) : {};
  const policySummary = self.VisitPolicy?.classifyVisit
    ? self.VisitPolicy.classifyVisit({
      durationMs,
      source,
      reason: reason || 'unknown',
      minUsefulMs: HUMAN_VISIT_MIN_USEFUL_MS
    })
    : {
      schemaVersion: 1,
      durationMs,
      source,
      reason: reason || 'unknown',
      minUsefulMs: HUMAN_VISIT_MIN_USEFUL_MS,
      shortVisit: durationMs < HUMAN_VISIT_MIN_USEFUL_MS,
      usefulVisit: durationMs >= HUMAN_VISIT_MIN_USEFUL_MS,
      retryable: durationMs < HUMAN_VISIT_MIN_USEFUL_MS
    };
  const visitSummary = {
    tabId,
    llmName,
    startedAt,
    endedAt,
    durationMs,
    source,
    reason: reason || 'unknown',
    snapshot,
    ...policySummary
  };
  if (entry) {
    if (!Array.isArray(entry.humanVisitDurations)) entry.humanVisitDurations = [];
    entry.lastTabVisitSummary = visitSummary;
    if (source === 'automation_focus') {
      entry.lastAutomationVisitSummary = visitSummary;
    }
    entry.humanVisitDurations.push({
      startedAt,
      endedAt,
      durationMs,
      source,
      reason: reason || 'unknown',
      shortVisit: visitSummary.shortVisit,
      usefulVisit: visitSummary.usefulVisit,
      minUsefulMs: visitSummary.minUsefulMs
    });
    if (entry.humanVisitDurations.length > 50) {
      entry.humanVisitDurations.splice(0, entry.humanVisitDurations.length - 50);
    }
    if (visitSummary.shortVisit) {
      if (!Array.isArray(entry.shortHumanVisitDurations)) entry.shortHumanVisitDurations = [];
      entry.shortHumanVisitDurations.push({
        startedAt,
        endedAt,
        durationMs,
        source,
        reason: reason || 'unknown',
        minUsefulMs: visitSummary.minUsefulMs
      });
      if (entry.shortHumanVisitDurations.length > 50) {
        entry.shortHumanVisitDurations.splice(0, entry.shortHumanVisitDurations.length - 50);
      }
    }
    entry.humanVisitTotalMs = (entry.humanVisitTotalMs || 0) + durationMs;
    const now = Date.now();
    const recentVisits = entry.humanVisitDurations.filter((visit) =>
      Number(visit?.endedAt || 0) >= (now - VISIT_QUOTA_WINDOW_MS)
    );
    const recentWindowMs = recentVisits.reduce((sum, visit) =>
      sum + Math.max(0, Number(visit?.durationMs || 0)), 0
    );
    if (recentWindowMs > VISIT_QUOTA_MAX_MS) {
      const backoffUntil = now + VISIT_QUOTA_COOLDOWN_MS;
      entry.visitQuotaBackoffUntil = Math.max(Number(entry.visitQuotaBackoffUntil || 0), backoffUntil);
      emitTelemetry(llmName, 'VISIT_QUOTA_BACKOFF', {
        level: 'warning',
        details: `${recentWindowMs}ms/${VISIT_QUOTA_WINDOW_MS}ms`,
        meta: {
          tabId,
          reason: reason || 'unknown',
          source,
          recentWindowMs,
          quotaMs: VISIT_QUOTA_MAX_MS,
          quotaWindowMs: VISIT_QUOTA_WINDOW_MS,
          cooldownMs: VISIT_QUOTA_COOLDOWN_MS,
          backoffUntil
        },
        force: true
      });
    }
    saveJobState(jobState);
    broadcastDiagnostic(llmName, {
      type: 'VISIT',
      label: visitSummary.shortVisit ? 'TAB_VISIT_SHORT' : 'TAB_VISIT',
      details: `${durationMs}ms`,
      level: visitSummary.shortVisit ? 'warning' : 'info',
      meta: {
        startedAt,
        endedAt,
        durationMs,
        source,
        reason: reason || 'unknown',
        shortVisit: visitSummary.shortVisit,
        usefulVisit: visitSummary.usefulVisit,
        minUsefulMs: visitSummary.minUsefulMs,
        snapshot,
        ...timingMeta
      }
    });
  }
  emitTelemetry(llmName, 'HUMAN_VISIT_END', {
    meta: {
      tabId,
      startedAt,
      endedAt,
      durationMs,
      source,
      reason: reason || 'unknown',
      shortVisit: visitSummary.shortVisit,
      usefulVisit: visitSummary.usefulVisit,
      minUsefulMs: visitSummary.minUsefulMs,
      snapshot,
      ...timingMeta
    },
    force: true
  });
  emitTelemetry(llmName, 'LEASE_RELEASED', {
    meta: {
      tabId,
      startedAt,
      endedAt,
      durationMs,
      source,
      reason: reason || 'unknown',
      shortVisit: visitSummary.shortVisit,
      usefulVisit: visitSummary.usefulVisit,
      minUsefulMs: visitSummary.minUsefulMs,
      foregroundMsUsed: entry?.humanVisitTotalMs || 0,
      snapshot,
      ...timingMeta
    },
    force: true
  });
  clearFocusStuckTimer('visit_end');
  clearVisitHardCapTimer('visit_end');
  tabVisitTracker.tabId = null;
  tabVisitTracker.llmName = null;
  tabVisitTracker.startedAt = 0;
  tabVisitTracker.source = null;
  tabVisitTracker.snapshot = null;
  tabVisitTracker.leaseOwner = null;
  tabVisitTracker.leaseKey = null;
  tabVisitTracker.leaseExpiresAt = null;
  return visitSummary;
}

function startAutomationVisit(tabId, llmName) {
  if (!llmName || !tabId) return false;
  const entry = jobState?.llms?.[llmName];
  if (isTerminalEntry(entry)) return false;
  if (!isActiveFocusWindowOpen(llmName, entry, 'start_automation_visit')) return false;
  const granted = startTabVisit(tabId, llmName, 'automation_focus');
  if (!granted) return false;
  if (entry) {
    entry.lastAutomationVisitSummary = null;
    entry.automationVisitActive = true;
    entry.automationVisitStartedAt = Date.now();
  }
  return true;
}

function endAutomationVisit(llmName, reason = 'automation_focus_end') {
  if (!llmName) return null;
  const entry = jobState?.llms?.[llmName];
  if (entry) {
    entry.automationVisitActive = false;
    entry.automationVisitStartedAt = null;
  }
  if (tabVisitTracker.llmName !== llmName) {
    return entry?.lastAutomationVisitSummary || null;
  }
  const summary = finalizeTabVisit(reason);
  return summary || entry?.lastAutomationVisitSummary || null;
}

async function runHumanPresenceCycle() {
  if (!humanPresenceActive || !jobState?.llms) return;
  // The cycle reschedules itself, so the guard in scheduleHumanPresenceLoop is
  // only evaluated once. A loop that was already running has to yield as soon
  // as a run starts instead of competing with it for tab focus.
  if (dispatchOwnsTabFocus()) {
    if (humanPresenceLoopTimeout) {
      clearTimeout(humanPresenceLoopTimeout);
    }
    humanPresenceLoopTimeout = setTimeout(() => {
      humanPresenceLoopTimeout = null;
      runHumanPresenceCycle();
    }, HUMAN_VISIT_INITIAL_DELAY_MS);
    return;
  }
  const modelNames = Array.isArray(jobState?.session?.selectedModels)
    ? jobState.session.selectedModels
    : Object.keys(jobState.llms);
  const now = Date.now();
  const pendingEntries = modelNames
    .map((llmName) => [llmName, jobState.llms?.[llmName]])
    .filter(([_, entry]) => (
      entry
      && !isTerminalEntry(entry)
      && isActiveFocusWindowOpen(_, entry, 'human_presence_cycle')
      && !entry.skipHumanLoop
      && !entry.automationVisitActive
      && !(Number(entry.visitQuotaBackoffUntil || 0) > now)
      && !(Number(entry.transportBackoffUntil || 0) > now)
    ));
  if (!pendingEntries.length) {
    if (hasPendingHumanVisits()) {
      humanPresenceLoopTimeout = setTimeout(() => {
        humanPresenceLoopTimeout = null;
        runHumanPresenceCycle();
      }, HUMAN_VISIT_LOOP_PAUSE_MS);
      return;
    }
    stopHumanPresenceLoop();
    return;
  }
  for (const [llmName, entry] of pendingEntries) {
    if (!humanPresenceActive) break;
    const boundTabId = resolveBoundTabIdForHuman(llmName, entry);
    if (!isValidTabId(boundTabId)) continue;
    const liveEntry = jobState.llms?.[llmName];
    if (!liveEntry || isTerminalEntry(liveEntry) || liveEntry.skipHumanLoop) continue;
    if (Number(liveEntry.visitQuotaBackoffUntil || 0) > Date.now()) continue;
    if (Number(liveEntry.transportBackoffUntil || 0) > Date.now()) continue;
    if (!liveEntry.humanVisits) liveEntry.humanVisits = 0;
    liveEntry.humanVisits += 1;
    const visitsCount = liveEntry.humanVisits;
    if (visitsCount >= HUMAN_VISIT_ALERT_THRESHOLD && !liveEntry.humanStalled) {
      raiseHumanVisitAlert(llmName, visitsCount);
      return;
    }
    await visitTabWithHumanity(llmName, boundTabId);
    broadcastHumanVisitStatus();
  }
  if (humanPresenceActive) {
    humanPresenceLoopTimeout = setTimeout(() => {
      humanPresenceLoopTimeout = null;
      runHumanPresenceCycle();
    }, HUMAN_VISIT_LOOP_PAUSE_MS);
  }
}

// All automatic visits share the dispatch queue for their entire lifetime.
// Expiration revokes the operation before releasing the queue: a late browser
// callback must not activate its old tab after the next owner has started.
function withBackgroundVisitFocus(task) {
  const sessionId = jobState?.session?.startTime;
  const run = () => new Promise(resolve => {
    let active = true;
    const lease = {
      isCurrent: () => active && jobState?.session?.startTime === sessionId
        && !self.isInitialPromptPassActive?.(),
      onExpire: null
    };
    let timer;
    const finish = result => {
      if (!active) return;
      active = false;
      clearTimeout(timer);
      try { lease.onExpire?.(); } catch (_) {}
      resolve(result);
    };
    if (!lease.isCurrent()) { finish(false); return; }
    timer = setTimeout(() => finish(false), HUMAN_VISIT_HARD_CAP_MS);
    Promise.resolve().then(() => task(lease)).then(finish, () => finish(false));
  });
  return self.withPromptDispatchFocusLock ? self.withPromptDispatchFocusLock(run) : run();
}

function visitTabWithHumanity(llmName, tabId) {
  return withBackgroundVisitFocus(lease => new Promise((resolve) => {
    const entry = jobState?.llms?.[llmName];
    if (isTerminalEntry(entry)) {
      if (isSuccessTerminalEntry(entry)) {
        completeHumanPresenceForModel(llmName, 'terminal_success_pre_visit');
      }
      resolve();
      return;
    }
    if (!isActiveFocusWindowOpen(llmName, entry, 'human_visit')) {
      resolve();
      return;
    }
    if (!browserHasFocus) {
      resolve();
      return;
    }
    if (!humanPresenceActive || !isValidTabId(tabId)) {
      resolve();
      return;
    }
    const capturedSessionId = jobState?.session?.startTime || null;
    chrome.tabs.get(tabId, (tab) => {
      if (!lease.isCurrent()) { resolve(false); return; }
      if (chrome.runtime.lastError || !tab) {
        resolve();
        return;
      }
      if (!browserHasFocus) {
        resolve();
        return;
      }
      const startTs = Date.now();
      let dwellTimer = null;
      let terminalPollTimer = null;
      let localHardCapTimer = null;
      let settled = false;
      const sessionStillValid = () =>
        lease.isCurrent() && (!capturedSessionId || jobState?.session?.startTime === capturedSessionId);
      const modelStillPending = () => {
        const liveEntry = jobState?.llms?.[llmName];
        return !isTerminalEntry(liveEntry)
          && isActiveFocusWindowOpen(llmName, liveEntry, 'human_visit_active');
      };
      const finalizeVisit = () => {
        if (settled) return;
        settled = true;
        if (dwellTimer) {
          clearTimeout(dwellTimer);
          dwellTimer = null;
        }
        if (terminalPollTimer) {
          clearInterval(terminalPollTimer);
          terminalPollTimer = null;
        }
        if (localHardCapTimer) {
          clearTimeout(localHardCapTimer);
          localHardCapTimer = null;
        }
        if (tabVisitTracker.tabId === tabId) {
          finalizeTabVisit('human_visit_end');
        }
        if (currentHumanVisit && currentHumanVisit.llmName === llmName) {
          currentHumanVisit = null;
        }
        resolve();
      };
      lease.onExpire = finalizeVisit;
      const focusWindow = () => raiseWindowUnlessUserIsElsewhere(tab.windowId, `human_visit:${llmName}`, lease.isCurrent);
      focusWindow().then(() => {
        if (!sessionStillValid() || !modelStillPending()) {
          finalizeVisit();
          return;
        }
        markProgrammaticTabFocus(tabId, 'human_visit_activate', { llmName });
        chrome.tabs.update(tabId, { active: true }, () => {
          if (chrome.runtime.lastError) {
            finalizeVisit();
            return;
          }
          if (!sessionStillValid() || !modelStillPending()) {
            finalizeVisit();
            return;
          }
          startTabVisit(tabId, llmName, 'human_visit');
          currentHumanVisit = {
            llmName,
            cancel: finalizeVisit,
            sessionId: capturedSessionId
          };
          localHardCapTimer = setTimeout(() => {
            forceTerminateVisitByHardCap(tabId, llmName, 'human_visit_local_cap', startTs);
          }, HUMAN_VISIT_HARD_CAP_MS);
          terminalPollTimer = setInterval(() => {
            if (!sessionStillValid() || !modelStillPending()) {
              finalizeVisit();
            }
          }, 500);
          performTabHumanSimulation(tabId, llmName).finally(() => {
            if (settled || !lease.isCurrent()) return;
            const elapsed = Date.now() - startTs;
            const remaining = Math.max(0, HUMAN_VISIT_DWELL_MS - elapsed);
            dwellTimer = setTimeout(finalizeVisit, remaining);
          });
        });
      });
    });
  }));
}

function visitTabWithAutomation(llmName, tabId, options = {}) {
  if (self.isInitialPromptPassActive?.()) return Promise.resolve(false);
  return withBackgroundVisitFocus(lease => new Promise((resolve) => {
    if (self.isInitialPromptPassActive?.()) {
      resolve(false);
      return;
    }
    if (!isValidTabId(tabId) || !llmName) {
      resolve(false);
      return;
    }
    const lockKey = `${llmName}:${tabId}`;
    const initialEntry = jobState?.llms?.[llmName];
    if (isTerminalEntry(initialEntry)) {
      completeHumanPresenceForModel(llmName, 'terminal_success_automation_skip');
      resolve(false);
      return;
    }
    if (!isActiveFocusWindowOpen(llmName, initialEntry, 'automation_visit')) {
      resolve(false);
      return;
    }
    if (automationVisitLocks.has(lockKey)) {
      emitTelemetry(llmName, 'AUTOMATION_VISIT_SKIPPED', {
        level: 'warning',
        details: 'overlap_guard',
        meta: { tabId, reason: options.reason || 'automation_visit' },
        force: true
      });
      resolve(false);
      return;
    }
    automationVisitLocks.set(lockKey, Date.now());
    lease.onExpire = () => automationVisitLocks.delete(lockKey);
    const liveEntry = jobState?.llms?.[llmName];
    const quotaBackoffUntil = Number(liveEntry?.visitQuotaBackoffUntil || 0);
    if (quotaBackoffUntil > Date.now()) {
      emitTelemetry(llmName, 'AUTOMATION_VISIT_SKIPPED', {
        level: 'warning',
        details: 'quota_backoff_active',
        meta: { tabId, reason: options.reason || 'automation_visit', backoffUntil: quotaBackoffUntil },
        force: true
      });
      automationVisitLocks.delete(lockKey);
      resolve(false);
      return;
    }
    const dwellMs = Math.max(0, Number(options.dwellMs || HUMAN_VISIT_DWELL_MS) || 0);
    const scrollDurationMs = Math.max(0, Number(options.scrollDurationMs || Math.min(HUMAN_VISIT_SCROLL_DURATION_MS, Math.max(1200, Math.floor(dwellMs * 0.6)))) || 0);
    const automationHardCapMs = Math.max(2500, Math.min(HUMAN_VISIT_HARD_CAP_MS, dwellMs + 2500));
    const reason = options.reason || 'automation_visit';
    const sessionId = options.sessionId || jobState?.session?.startTime || null;
    chrome.tabs.get(tabId, (tab) => {
      if (!lease.isCurrent()) { resolve(false); return; }
      if (chrome.runtime.lastError || !tab) {
        automationVisitLocks.delete(lockKey);
        resolve(false);
        return;
      }
      const startTs = Date.now();
      let dwellTimer = null;
      let hardCapTimer = null;
      let terminalPollTimer = null;
      let settled = false;
      const sessionStillValid = () =>
        lease.isCurrent() && (!sessionId || jobState?.session?.startTime === sessionId);
      const modelStillPending = () => {
        const pendingEntry = jobState?.llms?.[llmName];
        return !isTerminalEntry(pendingEntry)
          && isActiveFocusWindowOpen(llmName, pendingEntry, 'automation_visit_active');
      };
      const finalizeVisit = (finalizeReason = reason) => {
        if (settled) return;
        settled = true;
        if (dwellTimer) {
          clearTimeout(dwellTimer);
          dwellTimer = null;
        }
        if (hardCapTimer) {
          clearTimeout(hardCapTimer);
          hardCapTimer = null;
        }
        if (terminalPollTimer) {
          clearInterval(terminalPollTimer);
          terminalPollTimer = null;
        }
        automationVisitLocks.delete(lockKey);
        const visitSummary = endAutomationVisit(llmName, finalizeReason) || {
          llmName,
          tabId,
          durationMs: Math.max(0, Date.now() - startTs),
          source: 'automation_focus',
          reason: finalizeReason,
          shortVisit: false,
          usefulVisit: true,
          retryable: false
        };
        resolve(visitSummary);
      };
      lease.onExpire = () => finalizeVisit('automation_operation_ended');
      const focusWindow = () => raiseWindowUnlessUserIsElsewhere(tab.windowId, `automation_visit:${llmName}`, lease.isCurrent);
        focusWindow().then(() => {
          if (!sessionStillValid() || !modelStillPending()) {
            finalizeVisit('automation_session_stale');
            return;
          }
          markProgrammaticTabFocus(tabId, 'automation_visit_activate', { llmName });
          chrome.tabs.update(tabId, { active: true }, () => {
            if (chrome.runtime.lastError) {
              finalizeVisit('automation_tab_update_failed');
              return;
            }
            if (!sessionStillValid() || !modelStillPending()) {
              finalizeVisit('automation_terminal_success');
              return;
            }
            if (!startAutomationVisit(tabId, llmName)) {
              automationVisitLocks.delete(lockKey);
              resolve(false);
              return;
            }
            terminalPollTimer = setInterval(() => {
              if (!sessionStillValid() || !modelStillPending()) {
                finalizeVisit(modelStillPending() ? 'automation_session_stale' : 'automation_terminal_success');
              }
            }, 500);
            dwellTimer = setTimeout(() => finalizeVisit(reason), dwellMs);
            hardCapTimer = setTimeout(() => {
              const durationMs = Math.max(0, Date.now() - startTs);
              emitTelemetry(llmName, 'AUTOMATION_VISIT_HARD_CAP', {
                level: 'warning',
                details: `${durationMs}ms`,
                meta: {
                  tabId,
                  reason,
                  durationMs,
                  hardCapMs: automationHardCapMs
                },
                force: true
              });
              finalizeVisit('automation_hard_cap');
            }, automationHardCapMs);
            performTabHumanSimulation(tabId, llmName, scrollDurationMs).catch(() => {});
          });
        }).catch(() => {
        automationVisitLocks.delete(lockKey);
        resolve(false);
      });
    });
  }));
}

function performTabHumanSimulation(tabId, llmName, scrollDurationOverrideMs = null) {
  return new Promise((resolve) => {
    const scrollDuration = Number(scrollDurationOverrideMs || HUMAN_VISIT_SCROLL_DURATION_MS) || HUMAN_VISIT_SCROLL_DURATION_MS;
    chrome.scripting.executeScript({
      target: { tabId },
      func: simulateHumanActivityInPage,
      args: [{ scrollDuration, llmName }]
    }).then(() => resolve()).catch((err) => {
      console.warn(`[HUMAN-VISIT] Activity script failed for ${llmName}:`, err?.message || err);
      resolve();
    });
  });
}

function scrollTabToBottom(tabId) {
  if (!isValidTabId(tabId)) return;
  chrome.scripting.executeScript({
    target: { tabId },
    func: () => {
      try {
        const toolkit = window.__UniversalScrollToolkit || window.ScrollToolkit || window.__codexScrollToolkit;
        if (toolkit?.scrollAllTargets) {
          return Promise.resolve(toolkit.scrollAllTargets());
        }
        const target = document.scrollingElement || document.documentElement || document.body;
        if (target) {
          target.scrollTo({ top: target.scrollHeight || 0, behavior: 'smooth' });
        } else {
          window.scrollTo({ top: document.body?.scrollHeight || 0, behavior: 'smooth' });
        }
      } catch (err) {
        console.warn('[BACKGROUND] scrollTabToBottom fallback', err);
      }
    }
  }, () => {});
}

function clearPostSuccessScrollAudit(llmName) {
  const timers = postSuccessScrollTimers.get(llmName);
  if (timers && timers.length) {
    timers.forEach((timerId) => clearTimeout(timerId));
  }
  postSuccessScrollTimers.delete(llmName);
  POST_SUCCESS_SCROLL_ATTEMPTS_MS.forEach((_, index) => {
    try { chrome.alarms?.clear?.(`${POST_SUCCESS_AUDIT_ALARM_PREFIX}${llmName}::${index}`); } catch (_) {}
  });
}

function schedulePostSuccessScrollAudit(llmName, tabId) {
  if (!llmName || !isValidTabId(tabId)) return;
  clearPostSuccessScrollAudit(llmName);
  const entry = jobState?.llms?.[llmName];
  if (entry) {
    entry.postSuccessAudit = {
      llmName, tabId, runSessionId: jobState?.session?.startTime || null,
      dispatchId: entry.lastDispatchMeta?.dispatchId || entry.confirmedDispatchId || null,
      generationEpoch: Number(entry.generationEpoch || 0),
      turnAnchor: entry.preDispatchAnswerNodeCount ?? entry.anchorAnswerCount ?? entry.baselineAnswerCount ?? null,
      scheduledAt: Date.now(), lastHash: null, lastLength: 0
    };
  }
  const timers = POST_SUCCESS_SCROLL_ATTEMPTS_MS.map((delay, idx) => setTimeout(() => {
    scrollTabToBottom(tabId);
    if (idx === POST_SUCCESS_SCROLL_ATTEMPTS_MS.length - 1) {
      postSuccessScrollTimers.delete(llmName);
    }
  }, delay));
  postSuccessScrollTimers.set(llmName, timers);
  POST_SUCCESS_SCROLL_ATTEMPTS_MS.forEach((delay, index) => {
    try {
      chrome.alarms?.create?.(`${POST_SUCCESS_AUDIT_ALARM_PREFIX}${llmName}::${index}`, {
        when: Date.now() + Math.max(500, delay)
      });
    } catch (_) {}
  });
  saveJobState(jobState);
}

async function runPostSuccessAnswerAudit(llmName, index) {
  const entry = jobState?.llms?.[llmName];
  const plan = entry?.postSuccessAudit;
  if (!entry || !plan || Number(plan.generationEpoch || 0) !== Number(entry.generationEpoch || 0)) return;
  const tabId = Number(plan.tabId || entry.tabId || 0);
  if (!isValidTabId(tabId)) return;
  scrollTabToBottom(tabId);
  if (typeof self.lateCollectAnswer !== 'function') return;
  const result = await self.lateCollectAnswer({
    llmName, tabId, reason: 'post_success_answer_audit',
    meta: { dispatchId: plan.dispatchId, runSessionId: plan.runSessionId, generationEpoch: plan.generationEpoch }
  });
  if (!result?.ok || !result.text) return;
  const hash = self.AnswerVerification?.hashText?.(result.text) || null;
  const stable = Boolean(hash && plan.lastHash === hash && Number(plan.lastLength || 0) === String(result.text).trim().length);
  plan.lastHash = hash;
  plan.lastLength = String(result.text).trim().length;
  plan.lastObservedAt = Date.now();
  self.AnswerVerification?.appendTimeline?.(entry, {
    stage: 'post_success_audit', state: stable ? 'stable' : 'observed', dispatchId: plan.dispatchId,
    generationEpoch: plan.generationEpoch, tabId, source: 'chrome_alarm',
    details: { attempt: index + 1, length: plan.lastLength }
  });
  if (stable) {
    const auditVerification = {
      state: 'candidate',
      reasons: ['post_success_audit_not_structurally_verified'],
      generationActive: null,
      runSessionId: plan.runSessionId,
      dispatchId: plan.dispatchId,
      generationEpoch: plan.generationEpoch,
      turnAnchor: plan.turnAnchor
    };
    self.acceptLateCollectResult?.(llmName, result, {
      source: 'post_success_answer_audit', dispatchId: plan.dispatchId,
      runSessionId: plan.runSessionId, generationEpoch: plan.generationEpoch,
      turnAnchor: plan.turnAnchor,
      answerVerification: auditVerification,
      responseMeta: { source: 'post_success_answer_audit',
        runSessionId: plan.runSessionId, dispatchId: plan.dispatchId,
        generationEpoch: plan.generationEpoch, turnAnchor: plan.turnAnchor,
        answerVerification: auditVerification }
    });
  }
  saveJobState(jobState);
}

try {
  chrome.alarms?.onAlarm?.addListener?.((alarm) => {
    if (!alarm?.name?.startsWith(POST_SUCCESS_AUDIT_ALARM_PREFIX)) return;
    const parts = alarm.name.slice(POST_SUCCESS_AUDIT_ALARM_PREFIX.length).split('::');
    const index = Number(parts.pop() || 0);
    const llmName = parts.join('::');
    void runPostSuccessAnswerAudit(llmName, index);
  });
} catch (_) {}

async function simulateHumanActivityInPage(options = {}) {
  if (window.__LLMScrollHardStop || window.__HumanoidSessionState?.state === 'HARD_STOP') {
    return { status: 'skipped', reason: 'hard-stop' };
  }
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const llmName = String(options?.llmName || '');
  const shouldRunContinuousPress = /^(Gemini|Perplexity|GPT)$/i.test(llmName);
  const scrollDuration = Number.isFinite(options?.scrollDuration) ? Math.max(1000, options.scrollDuration) : 3500;
  const answerSelectorList = [
    '[data-testid="conversation-turn"]',
    'main article',
    'article',
    '[class*="response"]',
    '.chat-message',
    '.prose',
    '.answer',
    '.assistant-message'
  ];
  const getRecentAnswerElements = () => Array.from(
    document.querySelectorAll(answerSelectorList.join(','))
  )
    .filter((el) => (el.innerText || el.textContent || '').trim().length > 20)
    .slice(-3);
  const ensureScrollToolkit = () => {
    if (window.__codexScrollToolkit) {
      return window.__codexScrollToolkit;
    }
    if (typeof window.__codexBuildScrollToolkit === 'function') {
      window.__codexScrollToolkit = window.__codexBuildScrollToolkit();
      return window.__codexScrollToolkit;
    }
    const buildScrollToolkit = () => {
      const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      const waitForDomStability = (idleMs = 250, windowMs = 1400) => new Promise((resolve) => {
        const target = document.body || document.documentElement;
        if (!target) {
          resolve();
          return;
        }
        let timer = null;
        const finish = () => {
          observer.disconnect();
          resolve();
        };
        const observer = new MutationObserver(() => {
          clearTimeout(timer);
          timer = setTimeout(finish, idleMs);
        });
        observer.observe(target, { subtree: true, childList: true });
        timer = setTimeout(finish, idleMs);
        setTimeout(() => {
          observer.disconnect();
          resolve();
        }, windowMs);
      });
      const isScrollable = (node) => {
        if (!node || !(node instanceof Element)) return false;
        const diff = (node.scrollHeight || 0) - (node.clientHeight || 0);
        if (diff <= 24) return false;
        const style = getComputedStyle(node);
        return /(auto|scroll)/.test(style.overflowY || '');
      };
      const collectScrollableNodes = () => {
        const set = new Set();
        const add = (node) => {
          if (!node) return;
          if (node === document || node === window) return;
          if (node === document.body || node === document.documentElement || node === document.scrollingElement) {
            set.add(document.scrollingElement || document.documentElement);
            return;
          }
          if (isScrollable(node)) set.add(node);
        };
        const scanShadow = (root, depth = 0) => {
          if (!root || depth > 1) return;
          const elements = root.querySelectorAll('*');
          elements.forEach((el, idx) => {
            if (idx > 200) return;
            if (isScrollable(el)) add(el);
            if (el.shadowRoot) scanShadow(el.shadowRoot, depth + 1);
          });
        };
        const scanDocument = (doc, depth = 0) => {
          if (!doc || depth > 1) return;
          add(doc.scrollingElement || doc.documentElement);
          add(doc.body);
          const selectors = '[data-scrollable], [data-scroll="true"], main, section, article, div[class*="scroll"], .chat-container, .conversation, .chat-history';
          doc.querySelectorAll(selectors).forEach((el, idx) => {
            if (idx > 500) return;
            add(el);
            if (el.shadowRoot) scanShadow(el.shadowRoot, depth + 1);
          });
          if (depth === 0) {
            doc.querySelectorAll('iframe').forEach((frame, idx) => {
              if (idx > 5) return;
              try {
                const childDoc = frame.contentWindow?.document;
                if (childDoc) scanDocument(childDoc, depth + 1);
              } catch (_) {}
            });
          }
        };
        const addAnswerAncestors = () => {
          const answers = getRecentAnswerElements();
          answers.forEach((node) => {
            let current = node;
            let steps = 0;
            while (current && steps < 12) {
              if (isScrollable(current)) set.add(current);
              current = current.parentElement;
              steps++;
            }
          });
        };
        scanDocument(document);
        addAnswerAncestors();
        return Array.from(set);
      };
      const scrollNode = async (node) => {
        if (!node) return;
        const maxScroll = (node.scrollHeight || 0) - (node.clientHeight || 0);
        if (maxScroll <= 0) return;
        const start = node.scrollTop || 0;
        const delta = Math.min(maxScroll - start, node.clientHeight * (0.4 + Math.random() * 0.4));
        const target = start + delta;
        node.scrollTo({ top: target, behavior: 'smooth' });
        await sleep(260 + Math.random() * 240);
      };
      const scrollAllTargets = async () => {
        await waitForDomStability(200, 1200);
        const nodes = collectScrollableNodes();
        for (const node of nodes.slice(0, 6)) {
          await scrollNode(node);
        }
      };
      return { scrollAllTargets };
    };
    window.__codexBuildScrollToolkit = buildScrollToolkit;
    window.__codexScrollToolkit = buildScrollToolkit();
    return window.__codexScrollToolkit;
  };

  // Pointer visualization disabled (handled via CursorGhost in content if needed)
  const ensurePointer = () => null;
  const movePointer = () => {};

  const runScrollSequence = async () => {
    const start = performance.now();
    while (performance.now() - start < scrollDuration) {
      const delta = window.innerHeight * (0.22 + Math.random() * 0.15);
      const target = Math.max(0, window.scrollY + delta);
      window.scrollTo({ top: target, behavior: 'smooth' });
      await sleep(420 + Math.random() * 260);
    }
  };

  const runContinuousPressScrollGesture = async () => {
    if (!shouldRunContinuousPress) return { status: 'skipped', reason: 'llm_not_targeted' };
    const root = document.scrollingElement || document.documentElement || document.body;
    if (!root) return { status: 'skipped', reason: 'no_scroll_root' };

    const viewport = Math.max(240, root.clientHeight || window.innerHeight || 0);
    const maxScroll = Math.max(0, (root.scrollHeight || 0) - viewport);
    if (maxScroll <= 20) return { status: 'skipped', reason: 'not_scrollable' };

    const getTop = () => {
      if (root === document.body || root === document.documentElement || root === document.scrollingElement) {
        return window.scrollY || 0;
      }
      return Number(root.scrollTop || 0);
    };

    const setTop = (top) => {
      const targetTop = Math.max(0, Math.min(maxScroll, top));
      if (root === document.body || root === document.documentElement || root === document.scrollingElement) {
        window.scrollTo({ top: targetTop, behavior: 'auto' });
      } else {
        root.scrollTo({ top: targetTop, behavior: 'auto' });
      }
      window.dispatchEvent(new Event('scroll'));
    };

    const clampX = (x) => Math.min(window.innerWidth - 8, Math.max(8, x));
    const clampY = (y) => Math.min(window.innerHeight - 8, Math.max(8, y));
    const makePointerInit = (type, x, y, pressed) => ({
      bubbles: true,
      cancelable: true,
      composed: true,
      pointerId: 1,
      pointerType: 'mouse',
      isPrimary: true,
      clientX: clampX(x),
      clientY: clampY(y),
      buttons: pressed ? 1 : 0,
      button: type === 'pointermove' ? -1 : 0,
      pressure: pressed ? 0.5 : 0
    });
    const emitPointer = (type, x, y, pressed) => {
      const target = document.elementFromPoint(clampX(x), clampY(y)) || document.body || document.documentElement;
      const init = makePointerInit(type, x, y, pressed);
      try {
        if (typeof PointerEvent === 'function') {
          target.dispatchEvent(new PointerEvent(type, init));
        } else {
          target.dispatchEvent(new MouseEvent(type === 'pointermove' ? 'mousemove' : (type === 'pointerup' ? 'mouseup' : 'mousedown'), init));
        }
      } catch (_) {}
    };

    const dragSegment = async ({ fromY, toY, fromTop, toTop, steps }) => {
      for (let i = 1; i <= steps; i += 1) {
        const t = i / steps;
        const y = fromY + (toY - fromY) * t;
        const top = fromTop + (toTop - fromTop) * t;
        setTop(top);
        emitPointer('pointermove', pointerX, y, true);
        movePointer(pointerX, y);
        await sleep(16 + Math.random() * 16);
      }
    };

    let pointerX = clampX(window.innerWidth * 0.52 + (Math.random() * 40 - 20));
    let pointerY = clampY(window.innerHeight * 0.55 + (Math.random() * 30 - 15));
    emitPointer('pointerdown', pointerX, pointerY, true);
    await sleep(50 + Math.random() * 40);

    let currentTop = getTop();
    const dragDistanceY = Math.max(140, window.innerHeight * 0.75);
    const travelTop = Math.max(220, viewport * 1.5);

    for (let cycle = 0; cycle < 2; cycle += 1) {
      const upTop = Math.max(0, currentTop - travelTop);
      const upY = clampY(pointerY - dragDistanceY);
      await dragSegment({
        fromY: pointerY,
        toY: upY,
        fromTop: currentTop,
        toTop: upTop,
        steps: 8
      });
      pointerY = upY;
      currentTop = upTop;

      const downTop = Math.min(maxScroll, currentTop + travelTop);
      const downY = clampY(pointerY + dragDistanceY);
      await dragSegment({
        fromY: pointerY,
        toY: downY,
        fromTop: currentTop,
        toTop: downTop,
        steps: 8
      });
      pointerY = downY;
      currentTop = downTop;
      await sleep(28 + Math.random() * 24);
    }

    emitPointer('pointerup', pointerX, pointerY, false);
    await sleep(40 + Math.random() * 30);
    return { status: 'ok' };
  };

  const performCompletionScrollNudge = async () => {
    const root = document.scrollingElement || document.documentElement || document.body;
    if (!root) return;
    const viewport = Math.max(200, root.clientHeight || window.innerHeight || 0);
    const maxScroll = Math.max(0, (root.scrollHeight || 0) - viewport);
    if (maxScroll <= 0) return;
    const getTop = () => {
      if (typeof root.scrollTop === 'number') return root.scrollTop;
      return window.scrollY || 0;
    };
    const scrollToTop = (top) => {
      const targetTop = Math.max(0, Math.min(maxScroll, top));
      if (root === document.body || root === document.documentElement || root === document.scrollingElement) {
        window.scrollTo({ top: targetTop, behavior: 'smooth' });
      } else {
        root.scrollTo({ top: targetTop, behavior: 'smooth' });
      }
    };
    const current = getTop();
    const upDelta = Math.min(current, viewport * 0.5);
    if (upDelta > 80) {
      scrollToTop(current - upDelta);
      await sleep(260 + Math.random() * 140);
    }
    scrollToTop(maxScroll);
    await sleep(320 + Math.random() * 180);
    window.dispatchEvent(new Event('scroll'));
  };

  const hoverTargets = [
    'textarea:not([disabled])',
    'div[contenteditable="true"]',
    'input[type="text"]:not([disabled])',
    'input[type="search"]:not([disabled])'
  ];

  const actionTargets = [
    'button:not([disabled])',
    '[role="button"]',
    'a[href]'
  ];

  const simulateHover = async (selectorList) => {
    for (const selector of selectorList) {
      const el = document.querySelector(selector);
      if (el) {
        const rect = el.getBoundingClientRect();
        const clientX = Math.min(window.innerWidth - 5, Math.max(5, rect.left + rect.width / 2 + (Math.random() * 40 - 20)));
        const clientY = Math.min(window.innerHeight - 5, Math.max(5, rect.top + rect.height / 2 + (Math.random() * 40 - 20)));
        const moveEvent = new MouseEvent('mousemove', { bubbles: true, clientX, clientY });
        el.dispatchEvent(moveEvent);
        movePointer(clientX, clientY);
        return el;
      }
    }
    return null;
  };

  try {
    await runScrollSequence();
    if (shouldRunContinuousPress) {
      await runContinuousPressScrollGesture();
    }
    const humanoid = window.Humanoid;
    if (humanoid?.readPage) {
      try {
        await humanoid.readPage(600 + Math.random() * 400);
      } catch (_) {}
    }
    const composer = await simulateHover(hoverTargets);
    if (composer) {
      if (humanoid?.moveTo) {
        try { await humanoid.moveTo(composer); } catch (_) {}
      } else {
        composer.dispatchEvent(new Event('focus', { bubbles: true }));
        await sleep(120);
        composer.dispatchEvent(new Event('blur', { bubbles: true }));
      }
    }
    const actionTarget = await simulateHover(actionTargets);
    if (actionTarget && humanoid?.moveTo) {
      try { await humanoid.moveTo(actionTarget); } catch (_) {}
    }
    const centerX = window.innerWidth / 2 + (Math.random() * 60 - 30);
    const centerY = window.innerHeight / 2 + (Math.random() * 60 - 30);
    window.dispatchEvent(new MouseEvent('mousemove', {
      bubbles: true,
      clientX: centerX,
      clientY: centerY
    }));
    movePointer(centerX, centerY);
    await sleep(140);
  } catch (err) {
    console.warn('[HUMAN-VISIT] simulateHumanActivityInPage error:', err);
  }

  try {
    await ensureScrollToolkit().scrollAllTargets();
    await performCompletionScrollNudge();
  } catch (err) {
    console.warn('[HUMAN-VISIT] final scroll error:', err);
  }
}

function clearDeferredAnswerTimer(llmName) {
  if (!llmName) return;
  const entry = deferredAnswerTimers[llmName];
  if (entry?.handle) {
    clearTimeout(entry.handle);
  }
  delete deferredAnswerTimers[llmName];
}

function clearAllDeferredAnswerTimers() {
  Object.keys(deferredAnswerTimers).forEach((llm) => clearDeferredAnswerTimer(llm));
}

function scheduleDeferredAnswerVisit(llmName, tabId, delays = DEFERRED_VISIT_DELAYS_MS) {
  if (!llmName || !isValidTabId(tabId) || !Array.isArray(delays) || !delays.length) return;
  clearDeferredAnswerTimer(llmName);
  const [nextDelay, ...rest] = delays;
  const handle = setTimeout(() => {
    runDeferredAnswerVisit(llmName, tabId);
    if (rest.length) {
      scheduleDeferredAnswerVisit(llmName, tabId, rest);
    } else {
      delete deferredAnswerTimers[llmName];
    }
  }, nextDelay);
  deferredAnswerTimers[llmName] = { handle, remaining: rest, tabId };
}

function runDeferredAnswerVisit(llmName, tabId) {
  if (!isValidTabId(tabId)) return;
  chrome.scripting.executeScript({
    target: { tabId },
    func: (modelName) => {
      const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      const clickLatestAnswer = async () => {
        const selectors = [
          '[data-testid="conversation-turn"]',
          'main article',
          'article',
          '[class*="response"]',
          '.chat-message',
          '.prose',
          '.answer, .assistant-message'
        ];
        const nodes = Array.from(document.querySelectorAll(selectors.join(',')));
        const target = nodes.filter((el) => (el.innerText || el.textContent || '').trim().length > 20).pop();
        if (!target) return false;
        target.scrollIntoView({ behavior: 'smooth', block: 'end' });
        await sleep(220);
        target.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        await sleep(140);
        window.scrollBy({ top: window.innerHeight * 0.25, behavior: 'smooth' });
        return true;
      };
      clickLatestAnswer().then((ok) => {
        if (!ok) {
          window.scrollTo({ top: document.body?.scrollHeight || 0, behavior: 'smooth' });
        }
      }).catch((err) => console.warn('[HUMAN-VISIT] deferred visit error', modelName, err));
    },
    args: [llmName]
  }).catch((err) => {
    console.warn('[HUMAN-VISIT] deferred visit failed:', err?.message || err);
  });
}

function deriveHumanState(entry, llmName) {
  if (!entry) return 'off';
  if (entry.skipHumanLoop) return 'off';
  if (entry.humanStalled) return 'alert';
  if (self.ModelRunState?.isTerminalRunState?.(entry)) return 'off';
  if (currentHumanVisit?.llmName === llmName) return 'active';
  if (!entry.status || entry.status === 'IDLE') return 'pending';
  return 'pending';
}

self.HUMAN_VISIT_INITIAL_DELAY_MS = HUMAN_VISIT_INITIAL_DELAY_MS;
self.HUMAN_VISIT_DWELL_MS = HUMAN_VISIT_DWELL_MS;
self.HUMAN_VISIT_SCROLL_DURATION_MS = HUMAN_VISIT_SCROLL_DURATION_MS;
self.HUMAN_VISIT_LOOP_PAUSE_MS = HUMAN_VISIT_LOOP_PAUSE_MS;
self.HUMAN_VISIT_ALERT_THRESHOLD = HUMAN_VISIT_ALERT_THRESHOLD;
self.POST_SUCCESS_SCROLL_ATTEMPTS_MS = POST_SUCCESS_SCROLL_ATTEMPTS_MS;
self.DEFERRED_VISIT_DELAYS_MS = DEFERRED_VISIT_DELAYS_MS;
self.TAB_LEASE_TTL_MS = TAB_LEASE_TTL_MS;
self.PROGRAMMATIC_FOCUS_GRACE_MS = PROGRAMMATIC_FOCUS_GRACE_MS;
self.humanPresenceLoopTimeout = humanPresenceLoopTimeout;
self.humanPresenceActive = humanPresenceActive;
self.humanPresencePaused = humanPresencePaused;
self.humanPresenceManuallyStopped = humanPresenceManuallyStopped;
self.currentHumanVisit = currentHumanVisit;
self.browserHasFocus = browserHasFocus;
self.deferredAnswerTimers = deferredAnswerTimers;
self.postSuccessScrollTimers = postSuccessScrollTimers;
self.programmaticFocusByTabId = programmaticFocusByTabId;
self.isSuccessTerminalEntry = isSuccessTerminalEntry;
self.completeHumanPresenceForModel = completeHumanPresenceForModel;
self.stopHumanPresenceLoop = stopHumanPresenceLoop;
self.scheduleHumanPresenceLoop = scheduleHumanPresenceLoop;
self.hasPendingHumanVisits = hasPendingHumanVisits;
self.broadcastHumanVisitStatus = broadcastHumanVisitStatus;
self.raiseHumanVisitAlert = raiseHumanVisitAlert;
self.handleHumanVisitControl = handleHumanVisitControl;
self.handleHumanVisitModelToggle = handleHumanVisitModelToggle;
self.handleBrowserFocusChange = handleBrowserFocusChange;
self.handleTabActivation = handleTabActivation;
self.recordUserFocusObservation = recordUserFocusObservation;
self.finalizeUserFocusObservation = finalizeUserFocusObservation;
self.clearExpiredProgrammaticFocus = clearExpiredProgrammaticFocus;
self.markProgrammaticTabFocus = markProgrammaticTabFocus;
self.consumeProgrammaticTabFocus = consumeProgrammaticTabFocus;
self.buildTabLeaseKey = buildTabLeaseKey;
self.isTabLeaseExpired = isTabLeaseExpired;
self.canPreemptActiveTabLease = canPreemptActiveTabLease;
self.startTabVisit = startTabVisit;
self.finalizeTabVisit = finalizeTabVisit;
self.runHumanPresenceCycle = runHumanPresenceCycle;
self.visitTabWithHumanity = visitTabWithHumanity;
self.visitTabWithAutomation = visitTabWithAutomation;
self.performTabHumanSimulation = performTabHumanSimulation;
self.scrollTabToBottom = scrollTabToBottom;
self.clearPostSuccessScrollAudit = clearPostSuccessScrollAudit;
self.schedulePostSuccessScrollAudit = schedulePostSuccessScrollAudit;
self.runPostSuccessAnswerAudit = runPostSuccessAnswerAudit;
self.simulateHumanActivityInPage = simulateHumanActivityInPage;
self.clearDeferredAnswerTimer = clearDeferredAnswerTimer;
self.clearAllDeferredAnswerTimers = clearAllDeferredAnswerTimers;
self.scheduleDeferredAnswerVisit = scheduleDeferredAnswerVisit;
self.runDeferredAnswerVisit = runDeferredAnswerVisit;
self.deriveHumanState = deriveHumanState;
self.startAutomationVisit = startAutomationVisit;
self.endAutomationVisit = endAutomationVisit;
