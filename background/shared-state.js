// background/shared-state.js
// Shared state singletons (loaded early, no module dependencies).

'use strict';

// Core job/runtime state.
let jobState = {};
let activeListeners = new Map();
let resultsTabId = null;
let resultsWindowId = null;
let llmTabMap = {};
let evaluatorTabId = null;
const jobMetadata = new Map();
const llmRequestMap = {};
const pickerRequests = new Map();
let cachedApiMode = true;
let autoFocusNewTabsEnabled = false;

// Selector metrics/state.
const selectorResolutionMetrics = new TTLMap({ ttlMs: 30 * 60 * 1000, maxSize: 100 });
const selectorFailureMetrics = {};
const selectorHealthMeta = { updatedAt: null, perKey: {} };
const selectorHealthChecks = {};
const platformRunHistory = new TTLMap({ ttlMs: 60 * 60 * 1000, maxSize: 200 });
const platformDegradedAt = new Map();
const platformDegradedHourlyAt = new Map();
let selectorMetricsDirty = false;
let selectorMetricsFlushTimer = null;
let selectorMetricsFlushInFlight = false;
var promptDispatchInProgress = 0;

// Ping/visit tracking.
const pingWindowByTabId = {};
const pingStartByTabId = {};
const llmActivityMap = {};
const SESSION_TAB_IDS_KEY = 'llm_session_tab_ids_v1';
const sessionTabIds = new Set();
let sessionTabsLoaded = false;
const tabVisitTracker = {
  tabId: null,
  llmName: null,
  startedAt: 0,
  source: null
};
const STATUS_CONTRACT = self.LLMStatusContract || {};
const SUCCESS_STATUSES = Array.from(STATUS_CONTRACT.SUCCESS_STATUSES || ['COPY_SUCCESS', 'SUCCESS', 'DONE', 'PARTIAL', 'STREAM_TIMEOUT_HIDDEN']);
const FAILURE_STATUSES = Array.from(STATUS_CONTRACT.FAILURE_STATUSES || [
  'ERROR',
  'CRITICAL_ERROR',
  'UNRESPONSIVE',
  'CIRCUIT_OPEN',
  'API_FAILED',
  'NO_SEND',
  'EXTRACT_FAILED',
  'STREAM_TIMEOUT',
  'EXTERNAL_LLM_FAILURE',
  'USER_ACTION_REQUIRED',
  'UNCERTAIN'
]);
const TERMINAL_STATUSES = Array.from(STATUS_CONTRACT.TERMINAL_STATUSES || [...SUCCESS_STATUSES, ...FAILURE_STATUSES]);

// Expose for module access and legacy global references.
self.jobState = jobState;
self.activeListeners = activeListeners;
self.resultsTabId = resultsTabId;
self.resultsWindowId = resultsWindowId;
self.llmTabMap = llmTabMap;
self.evaluatorTabId = evaluatorTabId;
self.jobMetadata = jobMetadata;
self.llmRequestMap = llmRequestMap;
self.pickerRequests = pickerRequests;
self.cachedApiMode = cachedApiMode;
self.autoFocusNewTabsEnabled = autoFocusNewTabsEnabled;
self.selectorResolutionMetrics = selectorResolutionMetrics;
self.selectorFailureMetrics = selectorFailureMetrics;
self.selectorHealthMeta = selectorHealthMeta;
self.selectorHealthChecks = selectorHealthChecks;
self.platformRunHistory = platformRunHistory;
self.platformDegradedAt = platformDegradedAt;
self.platformDegradedHourlyAt = platformDegradedHourlyAt;
self.selectorMetricsDirty = selectorMetricsDirty;
self.selectorMetricsFlushTimer = selectorMetricsFlushTimer;
self.selectorMetricsFlushInFlight = selectorMetricsFlushInFlight;
self.promptDispatchInProgress = promptDispatchInProgress;
self.pingWindowByTabId = pingWindowByTabId;
self.pingStartByTabId = pingStartByTabId;
self.llmActivityMap = llmActivityMap;
self.SESSION_TAB_IDS_KEY = SESSION_TAB_IDS_KEY;
self.sessionTabIds = sessionTabIds;
self.sessionTabsLoaded = sessionTabsLoaded;
self.tabVisitTracker = tabVisitTracker;
self.SUCCESS_STATUSES = SUCCESS_STATUSES;
self.FAILURE_STATUSES = FAILURE_STATUSES;
self.TERMINAL_STATUSES = TERMINAL_STATUSES;

// ── Generation wait profile (standard/long) ──────────────────────────────────
// results.js writes 'longGenerationMode' to chrome.storage.local; the content
// side already scales its pipeline ceilings from it (pipeline-config.js), but
// the background ladder stayed fixed — SCRIPT_RUNTIME_HARD_STOP killed long
// generations at 180s while the content was patiently waiting up to 450s
// (timing review 2026-07-02). The background now reads the same flag and every
// ladder ceiling resolves through profiledTimeoutMs(). The persisted boolean
// key stays unchanged for backwards compatibility: false = Standard, true = Long.
const ACTIVE_FOCUS_WINDOW_STANDARD_MS = 60000;
const ACTIVE_FOCUS_WINDOW_LONG_MS = 90000;
let generationWaitProfileLong = false;
const hydrateGenerationWaitProfile = () => {
  try {
    chrome?.storage?.local?.get?.('longGenerationMode', (data) => {
      generationWaitProfileLong = data?.longGenerationMode === true;
    });
  } catch (_) {}
};
hydrateGenerationWaitProfile();
try {
  chrome?.storage?.onChanged?.addListener?.((changes, area) => {
    if (area === 'local' && changes && 'longGenerationMode' in changes) {
      generationWaitProfileLong = changes.longGenerationMode?.newValue === true;
    }
  });
} catch (_) {}
self.isLongGenerationProfile = () => generationWaitProfileLong === true;
self.profiledTimeoutMs = (shortMs, longMs) => (generationWaitProfileLong ? longMs : shortMs);
self.getActiveFocusWindowMs = () => (generationWaitProfileLong
  ? ACTIVE_FOCUS_WINDOW_LONG_MS
  : ACTIVE_FOCUS_WINDOW_STANDARD_MS);
self.isActiveFocusAllowedForEntry = (entry, now = Date.now()) => {
  if (!entry || entry.cardAnswerComplete) return false;
  const startedAt = Number(
    entry.activeFocusStartedAt
    || entry?.budgetTimers?.generation?.startedAt
    || entry.promptSubmittedAt
    || 0
  );
  // Focus needed to submit the prompt is outside the post-submit activity window.
  if (!startedAt) return true;
  const budgetMs = Number(entry.activeFocusBudgetMs || self.getActiveFocusWindowMs()) || 0;
  const deadlineAt = Number(entry.activeFocusDeadlineAt || (startedAt + budgetMs));
  return budgetMs > 0 && Number(now) < deadlineAt;
};
self.__setGenerationWaitProfileForTests = (long) => { generationWaitProfileLong = long === true; };
