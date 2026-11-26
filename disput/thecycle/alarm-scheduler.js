// TheCycle: persistent MV3 alarm registration and fail-closed alarm dispatch.
(function initTheCycleAlarmScheduler(root) {
  'use strict';
  const ALARM = 'thecycle-backup-interval';
  function createAlarmScheduler({ alarms = root.chrome?.alarms, onBackupDue,
    onFailure = () => {} } = {}) {
    if (!alarms || typeof alarms.create !== 'function' ||
        typeof alarms.get !== 'function' || typeof onBackupDue !== 'function')
      throw new TypeError('INVALID_ALARM_SCHEDULER');
    async function register() {
      const existing = await alarms.get(ALARM);
      if (!existing || existing.periodInMinutes !== 10)
        await alarms.create(ALARM, { periodInMinutes: 10 });
      return ALARM;
    }
    async function dispatch(alarm) {
      if (!alarm || alarm.name !== ALARM) return false;
      try { await onBackupDue(); return true; }
      catch (error) { await onFailure(error); throw error; }
    }
    return Object.freeze({ register, dispatch, alarmName: ALARM });
  }
  const api = Object.freeze({ createAlarmScheduler, ALARM });
  root.TheCycleAlarmScheduler = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
