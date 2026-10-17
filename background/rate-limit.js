// background/rate-limit.js
// MV3-safe rate limit tracking: storage-backed windows with chrome.alarms resume.

'use strict';

const RATE_LIMIT_STORAGE_KEY = 'rateLimitUntilByModel.v1';
const RATE_LIMIT_ALARM_PREFIX = 'rate_limit_retry::';

var rateLimitState = new Map();
var rateLimitRetryCallbacks = new Map();

function resolveRateLimitStorage() {
  if (chrome?.storage?.session) return chrome.storage.session;
  return chrome.storage.local;
}

async function persistRateLimitState() {
  const payload = {};
  rateLimitState.forEach((until, llmName) => {
    if (typeof until === 'number' && until > Date.now()) {
      payload[llmName] = until;
    }
  });
  try {
    await resolveRateLimitStorage().set({ [RATE_LIMIT_STORAGE_KEY]: payload });
  } catch (err) {
    console.warn('[RATE-LIMIT] Failed to persist state:', err?.message || err);
  }
}

async function loadRateLimitState() {
  try {
    const stored = await resolveRateLimitStorage().get(RATE_LIMIT_STORAGE_KEY);
    const payload = stored?.[RATE_LIMIT_STORAGE_KEY] || {};
    rateLimitState = new Map();
    Object.keys(payload).forEach((llmName) => {
      const until = Number(payload[llmName]);
      if (Number.isFinite(until) && until > Date.now()) {
        rateLimitState.set(llmName, until);
        createRateLimitAlarm(llmName, until);
      }
    });
    self.rateLimitState = rateLimitState;
  } catch (err) {
    console.warn('[RATE-LIMIT] Failed to load state:', err?.message || err);
  }
}

function getRateLimitAlarmName(llmName) {
  return `${RATE_LIMIT_ALARM_PREFIX}${llmName}`;
}

function getLlmNameFromRateLimitAlarm(name) {
  if (typeof name !== 'string' || !name.startsWith(RATE_LIMIT_ALARM_PREFIX)) return null;
  return name.slice(RATE_LIMIT_ALARM_PREFIX.length);
}

function createRateLimitAlarm(llmName, until) {
  if (!chrome?.alarms?.create) return;
  chrome.alarms.create(getRateLimitAlarmName(llmName), { when: Math.max(Date.now() + 500, until) });
}

function clearRateLimitAlarm(llmName) {
  if (!chrome?.alarms?.clear) return Promise.resolve(false);
  return chrome.alarms.clear(getRateLimitAlarmName(llmName));
}

function isRateLimited(llmName) {
  const until = rateLimitState.get(llmName);
  if (typeof until !== 'number') return false;
  if (until <= Date.now()) {
    rateLimitState.delete(llmName);
    persistRateLimitState();
    return false;
  }
  return true;
}

function setRateLimit(llmName, ms = 60000, message = '') {
  const until = Date.now() + ms;
  rateLimitState.set(llmName, until);
  createRateLimitAlarm(llmName, until);
  persistRateLimitState();
  updateModelState(llmName, 'RATE_LIMIT', {
    message: message || `Rate limited until ${new Date(until).toLocaleTimeString()}`
  });
  broadcastGlobalState();
}

function clearRateLimit(llmName) {
  rateLimitState.delete(llmName);
  clearRateLimitAlarm(llmName);
  persistRateLimitState();
}

function hasRateLimitRetry(llmName) {
  return rateLimitRetryCallbacks.has(llmName);
}

function cancelRateLimitRetry(llmName) {
  if (!llmName) return Promise.resolve({ ok: false });

  rateLimitRetryCallbacks.delete(llmName);
  rateLimitState.delete(llmName);

  let alarmClear;
  try {
    alarmClear = Promise.resolve(clearRateLimitAlarm(llmName)).catch((err) => {
      console.warn(`[RATE-LIMIT] Failed to clear alarm for ${llmName}:`, err?.message || err);
    });
  } catch (err) {
    console.warn(`[RATE-LIMIT] Failed to clear alarm for ${llmName}:`, err?.message || err);
    alarmClear = Promise.resolve();
  }

  return Promise.all([alarmClear, persistRateLimitState()]).then(() => ({ ok: true }));
}

function cancelAllRateLimitRetries() {
  const llmNames = new Set([
    ...rateLimitState.keys(),
    ...rateLimitRetryCallbacks.keys()
  ]);
  rateLimitRetryCallbacks.clear();
  return Promise.all(Array.from(llmNames, (llmName) => {
    try {
      return Promise.resolve(clearRateLimitAlarm(llmName)).catch((err) => {
        console.warn(`[RATE-LIMIT] Failed to clear alarm for ${llmName}:`, err?.message || err);
      });
    } catch (err) {
      console.warn(`[RATE-LIMIT] Failed to clear alarm for ${llmName}:`, err?.message || err);
      return false;
    }
  }));
}

function clearAllRateLimits() {
  const pendingAlarmClears = cancelAllRateLimitRetries();
  rateLimitState.clear();
  const persist = persistRateLimitState();
  return Promise.all([pendingAlarmClears, persist]).then(() => ({ ok: true }));
}

function scheduleRateLimitRetry(llmName, fn) {
  if (typeof fn === 'function') {
    rateLimitRetryCallbacks.set(llmName, fn);
  }
  const until = rateLimitState.get(llmName);
  if (!until || until <= Date.now()) {
    clearRateLimit(llmName);
    const callback = rateLimitRetryCallbacks.get(llmName);
    rateLimitRetryCallbacks.delete(llmName);
    if (typeof callback === 'function') callback();
    return;
  }
  createRateLimitAlarm(llmName, until);
}

function handleRateLimitAlarm(alarm) {
  const llmName = getLlmNameFromRateLimitAlarm(alarm?.name);
  if (!llmName) return;
  if (!rateLimitState.has(llmName) && !rateLimitRetryCallbacks.has(llmName)) return;
  rateLimitState.delete(llmName);
  persistRateLimitState();
  updateModelState(llmName, 'IDLE', { message: 'Rate limit window expired' });
  broadcastGlobalState();
  const callback = rateLimitRetryCallbacks.get(llmName);
  rateLimitRetryCallbacks.delete(llmName);
  if (typeof callback === 'function') {
    callback();
  }
}

if (chrome?.alarms?.onAlarm?.addListener) {
  chrome.alarms.onAlarm.addListener(handleRateLimitAlarm);
}

loadRateLimitState();

self.rateLimitState = rateLimitState;
self.isRateLimited = isRateLimited;
self.setRateLimit = setRateLimit;
self.clearRateLimit = clearRateLimit;
self.hasRateLimitRetry = hasRateLimitRetry;
self.cancelRateLimitRetry = cancelRateLimitRetry;
self.clearAllRateLimits = clearAllRateLimits;
self.scheduleRateLimitRetry = scheduleRateLimitRetry;
self.loadRateLimitState = loadRateLimitState;
self.RATE_LIMIT_STORAGE_KEY = RATE_LIMIT_STORAGE_KEY;
self.RATE_LIMIT_ALARM_PREFIX = RATE_LIMIT_ALARM_PREFIX;
