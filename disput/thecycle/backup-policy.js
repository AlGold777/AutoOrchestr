// TheCycle C02: backup policy. The host must provide a persistent alarm
// (e.g. chrome.alarms); this module does not pretend a page timer survives sleep.
(function initTheCycleBackupPolicy(root) {
  'use strict';
  const INTERVAL_MS = 10 * 60 * 1000;
  function createBackupPolicy({ backup, now = () => Date.now(), onFailure = () => {} } = {}) {
    if (!backup || typeof backup.save !== 'function' || typeof now !== 'function' ||
        typeof onFailure !== 'function') throw new TypeError('INVALID_BACKUP_POLICY');
    let lastSuccess = null;
    let sequence = 0;
    let pending = null;
    let blocked = false;
    const status = () => Object.freeze({ lastSuccess, blocked, pending: !!pending });
    async function persist(reason) {
      if (!['interval', 'cycle'].includes(reason)) throw new TypeError('INVALID_BACKUP_REASON');
      if (pending) return pending;
      const stamp = now();
      if (!Number.isSafeInteger(stamp) || stamp < 0) throw new TypeError('INVALID_CLOCK');
      const key = 'thecycle-' + stamp + '-' + (++sequence) + '-' + reason;
      pending = (async () => {
        try {
          const result = await backup.save(key);
          if (!result || result.verified !== true) throw new Error('BACKUP_UNVERIFIED');
          lastSuccess = stamp;
          blocked = false;
          return result;
        } catch (error) {
          blocked = true;
          await onFailure(error);
          throw error;
        } finally {
          pending = null;
        }
      })();
      return pending;
    }
    async function onAlarm() {
      if (lastSuccess !== null && now() - lastSuccess < INTERVAL_MS) return null;
      return persist('interval');
    }
    const onCycleCommitted = () => persist('cycle');
    const assertCanStartCycle = () => {
      if (blocked) throw new Error('BACKUP_REQUIRED');
    };
    return Object.freeze({ onAlarm, onCycleCommitted, assertCanStartCycle, status, INTERVAL_MS });
  }
  const api = Object.freeze({ createBackupPolicy, INTERVAL_MS });
  root.TheCycleBackupPolicy = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
