// background/lifecycle-runtime.js
// Consolidated lifecycle + runtime listeners.

'use strict';

const TAB_STOP_PREFIX = 'tab_stop_';
const STORAGE_CLEANUP_ALARM = 'pragmatist_storage_cleanup';
const SELECTOR_CACHE_CLEANUP_ALARM = 'selector_cache_cleanup';
const SELECTOR_CACHE_PREFIX = 'selector_cache';
const SELECTOR_CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const SELECTOR_CACHE_CLEANUP_LIMIT = 100;

async function setTabStopState(tabId, state) {
  const key = `${TAB_STOP_PREFIX}${tabId}`;
  if (state === 'HARD_STOP') {
    const payload = {};
    payload[key] = { state, timestamp: Date.now() };
    await chrome.storage.session.set(payload);
    closePingWindowForTab(tabId);
  } else {
    await chrome.storage.session.remove(key);
  }
}

async function getHardStoppedTabs() {
  const all = await chrome.storage.session.get(null);
  const ids = new Set();
  Object.keys(all || {}).forEach((key) => {
    if (key.startsWith(TAB_STOP_PREFIX) && all[key]?.state === 'HARD_STOP') {
      const id = Number(key.replace(TAB_STOP_PREFIX, ''));
      if (Number.isFinite(id)) ids.add(id);
    }
  });
  return ids;
}

function getInactivityMs(tabId) {
  return llmActivityMap[tabId] ? (Date.now() - llmActivityMap[tabId]) : Infinity;
}

function getLlmNameByTabId(tabId) {
  return TabMapManager.getNameByTabId(tabId);
}

function isTabSessionCompleted(tabId) {
  const llmName = getLlmNameByTabId(tabId);
  if (!llmName) return false;
  const entry = jobState?.llms?.[llmName];
  if (!entry) return false;
  if (self.ModelRunState?.isTerminalRunState?.(entry)) return true;
  const status = String(entry.status || entry.finalStatus || '').toUpperCase();
  return Boolean(entry.finalStatusRecorded || entry.finalStatus || TERMINAL_STATUSES.includes(status));
}

async function cleanupStorageBudgets() {
  try {
    if (self.__extensionLifecycleReady) await self.__extensionLifecycleReady;
    const now = Date.now();
    const { __PRAGMATIST_BUDGETS: budgets = {} } = globalThis || {};
    const timing = budgets?.timing || {};
    const ackTtl = timing.ackTTL || 300000; // 5m
    const cmdTtl = timing.commandTTL || 60000; // 60s
    const maxStateAge = 24 * 60 * 60 * 1000; // 24h
    const maxKeys = budgets?.storage?.maxKeys || 50;
    const all = await chrome.storage.local.get(null);
    const compute = typeof globalThis.computeStorageCleanup === 'function' ? globalThis.computeStorageCleanup : null;
    if (compute) {
      const { removals, updates } = compute(all, {
        now,
        timing: { ackTTL: ackTtl, commandTTL: cmdTtl, stateTTL: maxStateAge },
        storage: { maxKeys }
      });
      if (updates && Object.keys(updates).length) {
        await chrome.storage.local.set(updates);
      }
      if (removals && removals.length) {
        await chrome.storage.local.remove(removals);
        try {
          chrome.runtime.sendMessage({
            type: 'DIAG_EVENT',
            event: { type: 'storage_cleanup', removed: removals.length, reason: 'ttl/maxKeys', ts: Date.now() }
          });
        } catch (_) {}
      }
    }
  } catch (err) {
    console.warn('[STORAGE CLEANUP] Failed', err);
  }
}

async function cleanupExpiredSelectorCache() {
  try {
    const now = Date.now();
    const all = await chrome.storage.local.get(null);
    const expired = Object.entries(all)
      .filter(([key, value]) => key.startsWith(SELECTOR_CACHE_PREFIX) && value?.timestamp && now - value.timestamp > SELECTOR_CACHE_TTL_MS)
      .map(([key]) => key)
      .slice(0, SELECTOR_CACHE_CLEANUP_LIMIT);
    if (expired.length) {
      await chrome.storage.local.remove(expired);
      globalThis.LLMLog?.debug?.(`[SelectorCache] Removed ${expired.length} expired entries`);
    }
  } catch (err) {
    console.warn('[SelectorCache] Cleanup failed', err);
  }
}

chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'update') {
    // Never reload every provider page as an extension-update side effect.
    // Existing tabs are recovered lazily, one model at a time, at its dispatch
    // boundary. A mass reload creates a browser-wide load storm and makes the
    // slowest provider block the first Round 1 request.
    globalThis.LLMLog?.debug?.('[BACKGROUND] Extension updated; provider tabs will recover lazily');
  }
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.url) {
    if (self.ReadySignalManager?.markTabNotReady) {
      self.ReadySignalManager.markTabNotReady(tabId);
    }
    const llmName = TabMapManager.getNameByTabId(tabId);
    if (llmName && tab && !isEligibleTabForLlm(llmName, tab)) {
      globalThis.LLMLog?.debug?.(`[BACKGROUND] Tab ${tabId} navigated away from ${llmName}, releasing resources.`);
      cleanupTabResources(tabId, 'url_changed');
    }
  }
});

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo) => {
  if (changeInfo.status === 'complete') {
    const key = `${TAB_STOP_PREFIX}${tabId}`;
    try {
      const data = await chrome.storage.session.get(key);
      if (data?.[key]?.state === 'HARD_STOP') {
        chrome.tabs.sendMessage(tabId, { type: 'FORCE_HARD_STOP_RESTORE' }).catch(() => {});
      } else {
        await chrome.storage.session.remove(key);
      }
    } catch (_) {}
  }
});

chrome.runtime.onMessage.addListener((message, sender) => {
  if (message.type === 'LLM_ACTIVITY_PONG' && sender.tab?.id) {
    llmActivityMap[sender.tab.id] = Date.now();
    return;
  }
  if (message.type === 'STOP_AND_CLEANUP' && sender.tab?.id) {
    closePingWindowForTab(sender.tab.id);
    delete llmActivityMap[sender.tab.id];
    return;
  }
  if (message.type === 'SCROLL_HARD_STOP' && sender.tab?.id) {
    setTabStopState(sender.tab.id, message.state).catch(() => {});
  }
});

chrome.alarms.create(STORAGE_CLEANUP_ALARM, { periodInMinutes: 5 });
chrome.alarms.create(SELECTOR_CACHE_CLEANUP_ALARM, { periodInMinutes: 10 });
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === STORAGE_CLEANUP_ALARM) {
    cleanupStorageBudgets().catch(() => {});
    return;
  }
  if (alarm.name === SELECTOR_CACHE_CLEANUP_ALARM) {
    cleanupExpiredSelectorCache().catch(() => {});
  }
});
cleanupStorageBudgets().catch(() => {});
cleanupExpiredSelectorCache().catch(() => {});

self.TAB_STOP_PREFIX = TAB_STOP_PREFIX;
self.setTabStopState = setTabStopState;
self.getHardStoppedTabs = getHardStoppedTabs;
self.getInactivityMs = getInactivityMs;
self.getLlmNameByTabId = getLlmNameByTabId;
self.isTabSessionCompleted = isTabSessionCompleted;
self.STORAGE_CLEANUP_ALARM = STORAGE_CLEANUP_ALARM;
self.cleanupStorageBudgets = cleanupStorageBudgets;
self.SELECTOR_CACHE_CLEANUP_ALARM = SELECTOR_CACHE_CLEANUP_ALARM;
self.cleanupExpiredSelectorCache = cleanupExpiredSelectorCache;

globalThis.LLMLog?.debug?.('[LifecycleRuntime] Module loaded');
