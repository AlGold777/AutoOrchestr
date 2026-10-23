// results/debate-ui.js
// Small pure helpers for Debate page UI decisions. Keep DOM mutation in results.js;
// this module owns visibility decisions that are easy to test and reuse.

(function initResultsDebateUi(root) {
  'use strict';

  function getPresetDuration(presetMeta = {}) {
    return String(presetMeta?.duration || '').trim();
  }

  function shouldShowRoundLimitControl(presetMeta = {}) {
    return getPresetDuration(presetMeta) === 'open_ended';
  }

  const api = Object.freeze({
    shouldShowRoundLimitControl
  });

  root.ResultsDebateUi = api;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
