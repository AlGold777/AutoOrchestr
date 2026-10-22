(function initDebateVersionManifest(root) {
  'use strict';
  // Schema policy: increment runStoreSchema for persisted state/event shape;
  // increment protocol for phase semantics or mandatory prompt sections.
  function getVersions() {
    let implementation = 'dev';
    try { implementation = root.chrome?.runtime?.getManifest?.().version || 'dev'; } catch (_) {}
    const promptPackVersion = String(root.DebatePromptPack?.VERSION || '1.0.0');
    const promptPackMajor = Number.parseInt(promptPackVersion.split('.')[0], 10) || 1;
    return Object.freeze({
      implementation,
      // Protocol 5 adds typed moderator decisions, parameterized rule traces,
      // explicit progress windows and diagnostic-only model signals.
      protocol: 5,
      planSchema: 3,
      profileSchema: Number(root.DebateProfileSchema?.VERSION || 1),
      promptPack: promptPackMajor,
      promptPackVersion,
      runStoreSchema: Number(root.DebateRunStore?.VERSION || 1),
      traceSchema: Number(root.DebateTraceSchema?.VERSION || 1)
    });
  }
  const api = Object.freeze({ getVersions });
  root.DebateVersionManifest = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
