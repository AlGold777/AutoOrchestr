(function initAnswerPipelineConfig() {
  if (window.AnswerPipelineConfig) return;

  // ---- Standard profile: the former patient Long timings. ----
  const CONFIG = {
    preparation: {
      tabActivationTimeout: 3000,
      allowTabActivation: false,
      streamStartTimeout: 60000,
      streamStartPollInterval: 100
    },
    streaming: {
      coordinationMode: 'balanced',
      platformOverrides: {
        chatgpt: {
          maintenanceScroll: { enabled: false },
          continuousActivity: { enabled: false },
          initialScrollKick: { enabled: true, delay: 1000 }
        }
      },
      adaptiveTimeout: {
        short: { maxChars: 500, timeout: 50000 },
        medium: { maxChars: 2000, timeout: 112000 },
        long: { maxChars: 5000, timeout: 225000 },
        veryLong: { maxChars: Infinity, timeout: 450000 },
        softExtension: 75000,
        hardMax: 450000
      },
      intelligentRetry: {
        enabled: true,
        maxRetries: 8,
        backoffSequence: [500, 1000, 2000, 3000, 4000, 5000, 5000, 5000],
        noGrowthThreshold: 4
      },
      initialScrollKick: {
        enabled: true,
        delay: 0
      },
      settlementWatcher: {
        idleThreshold: 3500,
        maxDuration: 120000
      },
      completionCriteria: {
        completionSignalEnabled: true,
        mutationIdle: 4500,
        scrollStable: 6000,
        contentStable: 4500,
        contentStableChecks: 4,
        contentStableDelta: 5,
        copyButtonSignalEnabled: true,
        copyButtonRequiresStableText: true,
        copyButtonMinAnswerLength: 80,
        copyButtonMaxDistancePx: 900,
        minMetCriteria: 3,
        stopButtonCheckMode: 'fresh',
        stopButtonCacheMaxAgeMs: 3000,
        checkInterval: 1000
      },
      // v2.54.24 (2025-12-22 23:14 UTC): Verbose criteria logging (Purpose: toggle detailed completion logs).
      verboseCriteria: true,
      continuousActivity: {
        enabled: true,
        interval: 5000,
        scrollRange: [50, 200],
        pauseBetweenMoves: 3000
      },
      maintenanceScroll: {
        enabled: true,
        checkInterval: 3000,
        growthThreshold: 50,
        scrollStep: 120,
        idleThreshold: 5000,
        maxDuration: 60000
      }
    },
    finalization: {
      stabilityChecks: 4,
      stabilityRetryBudget: 2,
      stabilityInterval: 2500,
      sanityCheck: {
        enabled: true,
        warnOnHardTimeout: true,
        warnOnActiveIndicators: true,
        recentGrowthWindow: 2000,
        recentGrowthThreshold: 10
      }
    },
    telemetry: {
      enabled: true,
      useTraceId: true,
      sendToBackground: true,
      consoleLog: false,
      sessionStorage: false,
      sessionStorageKey: '__answer_pipeline_telemetry'
    },
    platforms: {
      deepseek: {
        preparation: { streamStartTimeout: 45000 }
      },
      perplexity: {
        preparation: { streamStartTimeout: 20000 }
      }
    }
  };

  // ---- Long profile overrides: passive generation wait up to 15 minutes. ----
  // Active tab focus is governed separately in background (90 seconds max).
  const LONG_OVERRIDES = {
    preparation: { streamStartTimeout: 90000 },
    streaming: {
      adaptiveTimeout: {
        short: { timeout: 100000 },
        medium: { timeout: 225000 },
        long: { timeout: 450000 },
        veryLong: { timeout: 900000 },
        softExtension: 150000,
        hardMax: 900000
      },
      intelligentRetry: {
        maxRetries: 10,
        backoffSequence: [500, 1000, 2000, 3000, 4000, 5000, 6000, 7000, 8000, 8000],
        noGrowthThreshold: 5
      },
      settlementWatcher: {
        maxDuration: 180000
      },
      completionCriteria: {
        contentStableChecks: 5
      }
    },
    finalization: {
      stabilityChecks: 5,
      stabilityRetryBudget: 3
    }
  };

  const STORAGE_KEY = 'longGenerationMode';
  const clone = (value) => (typeof structuredClone === 'function'
    ? structuredClone(value)
    : JSON.parse(JSON.stringify(value)));
  // Pristine Standard snapshot to restore from when switching Long off.
  const STANDARD_SNAPSHOT = clone(CONFIG);

  const deepAssign = (target, source) => {
    Object.keys(source || {}).forEach((key) => {
      const value = source[key];
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        if (!target[key] || typeof target[key] !== 'object' || Array.isArray(target[key])) {
          target[key] = {};
        }
        deepAssign(target[key], value);
      } else {
        target[key] = value;
      }
    });
    return target;
  };

  let activeProfile = 'standard';
  let profileLoaded = false;
  let resolveProfileReady;
  const profileReadyPromise = new Promise((resolve) => { resolveProfileReady = resolve; });

  function markProfileLoaded() {
    if (profileLoaded) return;
    profileLoaded = true;
    resolveProfileReady?.(getEffectiveSnapshot());
  }

  // Mutates AnswerPipelineConfig in place so consumers that read it fresh on each
  // run (the answer watcher / finalizer) pick up the active profile.
  function applyTimingProfile(profile) {
    const next = profile === 'long' ? 'long' : 'standard';
    deepAssign(CONFIG, clone(STANDARD_SNAPSHOT));
    if (next === 'long') {
      deepAssign(CONFIG, LONG_OVERRIDES);
    }
    activeProfile = next;
    return activeProfile;
  }

  function getTimingProfile() {
    return activeProfile;
  }

  function getEffectiveSnapshot() {
    return {
      profile: activeProfile,
      profileLoaded,
      streaming: clone(CONFIG.streaming || {}),
      finalization: clone(CONFIG.finalization || {})
    };
  }

  function whenProfileReady(timeoutMs = 0) {
    if (profileLoaded) return Promise.resolve(getEffectiveSnapshot());
    const timeout = Math.max(0, Number(timeoutMs || 0));
    if (!timeout) return profileReadyPromise;
    return Promise.race([
      profileReadyPromise,
      new Promise((resolve) => setTimeout(() => resolve(getEffectiveSnapshot()), timeout))
    ]);
  }

  window.AnswerPipelineConfig = CONFIG;
  window.AnswerPipelineTiming = Object.freeze({
    applyTimingProfile,
    getTimingProfile,
    getEffectiveSnapshot,
    whenProfileReady,
    STANDARD_SNAPSHOT,
    // Compatibility alias for integrations compiled before Standard replaced Short.
    SHORT_SNAPSHOT: STANDARD_SNAPSHOT,
    LONG_OVERRIDES
  });

  // In a model tab (content-script world) keep the active profile synced to the
  // Long checkbox on the results page via chrome.storage.local. Read once on load
  // and react to live toggles.
  try {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      chrome.storage.local.get(STORAGE_KEY, (data) => {
        try { applyTimingProfile(data && data[STORAGE_KEY] ? 'long' : 'standard'); markProfileLoaded(); } catch (_) {}
      });
      // Shortening the deadlines under a generation in flight made it time out
      // early (e.g. a finished Disput restoring Standard while this tab still
      // generates a Long answer). A downgrade waits until the tab has no request
      // in flight, bounded by the Long hard maximum; an upgrade applies at once.
      let pendingDowngradeTimer = null;
      const applyWhenIdle = (profile, startedAt = Date.now()) => {
        clearTimeout(pendingDowngradeTimer);
        pendingDowngradeTimer = null;
        const busy = window.ContentUtils?.hasActiveRequest?.() === true;
        const expired = Date.now() - startedAt > LONG_OVERRIDES.streaming.adaptiveTimeout.hardMax;
        if (profile === 'standard' && activeProfile === 'long' && busy && !expired) {
          pendingDowngradeTimer = setTimeout(() => applyWhenIdle(profile, startedAt), 2000);
          return;
        }
        applyTimingProfile(profile);
        markProfileLoaded();
      };
      chrome.storage.onChanged?.addListener?.((changes, area) => {
        if (area !== 'local' || !changes || !changes[STORAGE_KEY]) return;
        try { applyWhenIdle(changes[STORAGE_KEY].newValue ? 'long' : 'standard'); } catch (_) {}
      });
    } else {
      markProfileLoaded();
    }
  } catch (_) { markProfileLoaded(); }
})();
