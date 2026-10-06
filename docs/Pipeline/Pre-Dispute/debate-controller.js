// Pure Debate UI view-model selectors. DOM rendering stays in the page adapter.
(function initDebateController(root) {
  'use strict';

  function deriveRunControls({ aggregate = null, approvalWaiting = false, startPending = false, autoMode = false } = {}) {
    const status = String(aggregate?.status || 'idle');
    const paused = ['paused', 'technical_pause', 'paused_by_moderator'].includes(status);
    if (startPending) {
      return Object.freeze({
        action: 'wait', icon: 'ti ti-loader-2', title: 'Starting debate',
        active: true, enabled: false, stepEnabled: false
      });
    }
    if (paused) {
      return Object.freeze({
        action: 'resume', icon: 'ti ti-player-play',
        title: autoMode ? 'Resume debate' : 'Продолжить диспут',
        active: true, enabled: true, stepEnabled: approvalWaiting
      });
    }
    if (status === 'finalization_pending') {
      return Object.freeze({
        action: 'wait', icon: 'ti ti-loader-2', title: 'Finalizing debate',
        active: true, enabled: false, stepEnabled: false
      });
    }
    if (status === 'awaiting_approval' || approvalWaiting) {
      if (!autoMode) {
        return Object.freeze({
          action: 'approve', icon: 'ti ti-check', title: 'Approve and continue',
          active: true, enabled: approvalWaiting, stepEnabled: approvalWaiting
        });
      }
      return Object.freeze({
        action: 'pause', icon: 'ti ti-player-pause', title: 'Pause after current turn',
        active: true, enabled: true, stepEnabled: approvalWaiting
      });
    }
    if (status === 'running') {
      if (!autoMode) {
        return Object.freeze({
          action: 'next', icon: 'ti ti-send', title: 'Запустить следующий раунд',
          active: true, enabled: true, stepEnabled: false
        });
      }
      return Object.freeze({
        action: 'pause', icon: 'ti ti-player-pause', title: 'Pause after current turn',
        active: true, enabled: true, stepEnabled: false
      });
    }
    return Object.freeze({
      action: 'run', icon: 'ti ti-send', title: 'Run debate',
      active: false, enabled: true, stepEnabled: false
    });
  }

  const api = Object.freeze({ deriveRunControls });
  root.DebateController = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
