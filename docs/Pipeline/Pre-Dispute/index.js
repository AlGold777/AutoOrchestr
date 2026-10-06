// background/index.js
// Entry point for MV3 service worker (non-module, importScripts only).

// Register the browser-action handler before the heavy orchestration bundle is
// imported. On MV3 cold start this lets the UI tab open immediately, while the
// rest of the service worker continues loading.
self.__codexFastActionOpenRegistered = false;

// Extension updates/reloads dispatch onInstalled only after the service-worker
// script has been evaluated. Without a startup barrier, message-router can
// restore the previous jobState before the update cleanup removes it, leaving
// stale telemetry and status indicators in the results page. Register this
// listener before importScripts and let state hydration wait for the cleanup.
const EXTENSION_RUNTIME_EPOCH_KEY = '__llm_extension_runtime_epoch_v1';
const EXTENSION_VOLATILE_LOCAL_KEYS = [
  'llmTabMap',
  'jobState',
  '__diagnostics_events__',
  'llmComparatorSelectedModelsByView.main',
  'llmComparatorSelectedModelsByView.pipeline',
  'llmComparatorCrossViewUiState',
  'llm_saved_sessions_v1'
];

self.__extensionLifecycleReady = new Promise((resolve) => {
  let settled = false;
  let resetPromise = null;
  let normalStartTimer = null;
  let fallbackTimer = null;
  const settle = (result) => {
    if (settled) return;
    settled = true;
    clearTimeout(normalStartTimer);
    clearTimeout(fallbackTimer);
    self.__extensionLifecycleResult = result || { reset: false, reason: 'normal_start' };
    if (self.__extensionLifecycleResult.reset) {
      self.__extensionRuntimeResetAt = Date.now();
    }
    resolve(result || { reset: false, reason: 'normal_start' });
  };
  const resetVolatileRuntime = (reason) => {
    if (resetPromise) return resetPromise;
    // An unpacked-extension reload can report the retained session epoch before
    // Chrome dispatches onInstalled(update). Cancel the tentative normal wake so
    // stale jobState cannot be hydrated while reload cleanup is still pending.
    clearTimeout(normalStartTimer);
    resetPromise = (async () => {
      const localError = await new Promise((done) => chrome.storage.local.remove(
        EXTENSION_VOLATILE_LOCAL_KEYS,
        () => done(chrome.runtime.lastError?.message || null)
      ));
      let sessionError = null;
      if (chrome.storage?.session?.clear && chrome.storage?.session?.set) {
        sessionError = await new Promise((done) => chrome.storage.session.clear(() => {
          const clearError = chrome.runtime.lastError?.message || null;
          if (clearError) { done(clearError); return; }
          chrome.storage.session.set({ [EXTENSION_RUNTIME_EPOCH_KEY]: Date.now() }, () => {
            done(chrome.runtime.lastError?.message || null);
          });
        }));
      }
      const error = localError || sessionError || null;
      const result = { reset: !error, reason, error };
      settle(result);
      return result;
    })();
    return resetPromise;
  };
  const settleNormalStart = (reason) => {
    clearTimeout(normalStartTimer);
    normalStartTimer = setTimeout(() => settle({ reset: false, reason }), 100);
  };
  // Safety fallback only. Normal worker wakes settle from the epoch read, while
  // a missing epoch performs the reset before state hydration can begin.
  fallbackTimer = setTimeout(() => settle({ reset: false, reason: 'normal_start_timeout' }), 2000);

  try {
    if (chrome.storage?.session?.get) {
      chrome.storage.session.get(EXTENSION_RUNTIME_EPOCH_KEY, (stored) => {
        if (chrome.runtime.lastError) {
          settle({ reset: false, reason: 'session_epoch_read_failed', error: chrome.runtime.lastError.message });
          return;
        }
        if (!stored?.[EXTENSION_RUNTIME_EPOCH_KEY]) {
          void resetVolatileRuntime('new_extension_runtime');
        } else {
          settleNormalStart('worker_wake');
        }
      });
    }
    chrome.runtime.onInstalled.addListener((details) => {
      if (details?.reason !== 'update') {
        settle({ reset: false, reason: details?.reason || 'installed' });
        return;
      }
      void resetVolatileRuntime('extension_update');
    });
  } catch (err) {
    settle({ reset: false, reason: 'lifecycle_listener_failed', error: err?.message || String(err) });
  }
});

// Resolve which panel to open when none is already open: the page the user last
// opened (recorded by results.js as `lastOpenedPage`), defaulting to the main
// results page on a fresh install / no stored preference.
const codexResolveStartPage = (callback) => {
  let settled = false;
  const done = (file) => {
    if (settled) return;
    settled = true;
    callback(file === 'pipeline_panel.html' ? 'pipeline_panel.html' : 'result_new.html');
  };
  try {
    if (chrome?.storage?.local?.get) {
      chrome.storage.local.get('lastOpenedPage', (data) => done(data && data.lastOpenedPage));
      return;
    }
  } catch (_) {}
  done('result_new.html');
};

// Reported 2026-07-31: the main page periodically goes blank — an empty tab with
// no address — and comes back with all its data as soon as the extension button
// is clicked. That is Chrome's memory saver discarding the tab: the document is
// torn down, the tab keeps its slot, and re-activation reloads it and rehydrates
// state from storage. A long run leaves the page in the background for minutes
// at a time, which is exactly when discard happens.
// Marking it non-auto-discardable keeps the live page alive.
const codexProtectExtensionPageTab = (tabId) => {
  if (!Number.isInteger(tabId) || tabId <= 0) return;
  try {
    chrome.tabs.update(tabId, { autoDiscardable: false }, () => chrome.runtime.lastError);
  } catch (_) {}
};
self.codexProtectExtensionPageTab = codexProtectExtensionPageTab;

const codexExtensionPageUrls = () => [
  chrome.runtime.getURL('pipeline_panel.html'),
  chrome.runtime.getURL('result_new.html')
];

// Re-assert on startup and whenever such a page finishes loading: the flag is
// per-tab and does not survive a reload or a browser restart.
try {
  if (chrome?.tabs?.onUpdated && chrome?.runtime?.getURL) {
    chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
      if (changeInfo.status !== 'complete') return;
      const url = String(tab?.url || '');
      if (!url) return;
      if (!codexExtensionPageUrls().some((base) => url.startsWith(base))) return;
      codexProtectExtensionPageTab(tabId);
    });
    chrome.tabs.query({ url: codexExtensionPageUrls() }, (tabs = []) => {
      if (chrome.runtime.lastError) return;
      (Array.isArray(tabs) ? tabs : []).forEach((tab) => codexProtectExtensionPageTab(tab?.id));
    });
  }
} catch (err) {
  console.warn('[BACKGROUND] Extension page discard protection failed:', err);
}

try {
  if (chrome?.action?.onClicked && chrome?.tabs && chrome?.runtime?.getURL) {
    chrome.action.onClicked.addListener(() => {
      const urls = codexExtensionPageUrls();
      chrome.tabs.query({ url: urls }, (tabs = []) => {
        const existing = Array.isArray(tabs) ? tabs.find((tab) => tab?.id) : null;
        if (existing?.id) {
          codexProtectExtensionPageTab(existing.id);
          chrome.windows?.update?.(existing.windowId, { focused: true }, () => chrome.runtime.lastError);
          chrome.tabs.update(existing.id, { active: true }, () => chrome.runtime.lastError);
          return;
        }
        codexResolveStartPage((file) => {
          chrome.tabs.create({ url: chrome.runtime.getURL(file), active: true }, (tab) => {
            if (chrome.runtime.lastError) return;
            codexProtectExtensionPageTab(tab?.id);
          });
        });
      });
    });
    self.__codexFastActionOpenRegistered = true;
  }
} catch (err) {
  console.warn('[BACKGROUND] Fast action open registration failed:', err);
}

// On fresh install, open the main results page automatically.
try {
  if (chrome?.runtime?.onInstalled) {
    chrome.runtime.onInstalled.addListener((details) => {
      if (details?.reason !== 'install') return;
      try {
        chrome.tabs?.create?.({ url: chrome.runtime.getURL('result_new.html'), active: true }, () => chrome.runtime.lastError);
      } catch (_) {}
    });
  }
} catch (err) {
  console.warn('[BACKGROUND] onInstalled open handler registration failed:', err);
}

importScripts(
  '../shared/logger.js',
  '../selectors/chatgpt.config.js',
  '../selectors/claude.config.js',
  '../selectors/deepseek.config.js',
  '../selectors/gemini.config.js',
  '../selectors/grok.config.js',
  '../selectors/lechat.config.js',
  '../selectors/perplexity.config.js',
  '../selectors/qwen.config.js',
  '../selectors/zai.config.js',
  '../selectors/kimi.config.js',
  '../selectors-config.js',
  '../shared/storage-budgets.js',
  '../notes/notes-constants.js',
  '../notes/notes-idb.js',
  '../notes/notes-orderkey.js',
  '../notes/notes-chunks.js',
  '../notes/notes-service.js',
  '../config/timing.js',
  '../lib/lz-string.min.js',
  '../utils/storage-compress.js',
  '../utils/ttl-map.js',
  '../utils/safe-mutex.js',
  '../utils/retry-strategy.js',
  '../utils/api-key-storage.js',
  '../shared/status-contract.js',
  '../shared/model-run-state.js',
  '../shared/answer-length-policy.js',
  '../shared/answer-proof-normalization.js',
  '../shared/answer-evidence.js',
  '../shared/answer-verification.js',
  '../shared/answer-content-classifier.js',
  '../shared/finalization-controller.js',
  '../shared/recovery-intent.js',
  '../shared/run-identity.js',
  '../shared/decision-ledger.js',
  '../shared/page-blocker-policy.js',
  '../shared/log-replay-harness.js',
  '../shared/selector-profile-lifecycle.js',
  '../shared/model-policy.js',
  '../shared/transport-policy.js',
  '../shared/secret-redaction.js',
  '../shared/run-guard.js',
  '../shared/run-error.js',
  '../shared/judge-prompt-builder.js',
  '../shared/visit-policy.js',
  '../shared/pipeline-fsm.js',
  '../shared/telemetry-meta-delta.js',
  '../shared/proof-telemetry-contracts.js',
  '../shared/proof-telemetry-inventory.js',
  '../shared/proof-telemetry-clock.js',
  '../shared/proof-telemetry-incidents.js',
  '../shared/proof-telemetry-policy.js',
  '../shared/proof-oriented-telemetry.js',
  '../shared/proof-telemetry-audit.js',
  // disput/* модули загружаются только страницами UI (result_new.html,
  // pipeline_panel.html): фоновый слой не знает про Speaker/роли/очерёдность,
  // и это инвариант транспорта (см. docs/graph-mode/AUDIT_REPORT.md).
  'shared-state.js',
  'llm-targets.js',
  'b1-skeleton-collector.js',
  'proof-telemetry-store.js',
  'proof-telemetry-ledger.js',
  'telemetry-logs.js',
  'human-presence.js',
  'rate-limit.js',
  'dispatch-retry.js',
  'tab-manager.js',
  'dispatch-state-machine.js',
  'dispatch-intent-store.js',
  'dispatch-coordinator.js',
  'pipeline-run-state.js',
  'job-orchestrator.js',
  'ui-broadcast.js',
  'state-manager.js',
  'evaluation-manager.js',
  'selector-metrics.js',
  'api-fallback.js',
  'remote-selectors.js',
  'ready-signal-manager.js',
  'health-monitor.js',
  'cleanup-manager.js',
  'lifecycle-runtime.js',
  'pipeline-message-handlers.js',
  'message-router.js'
);

// One-time cleanup: the shadow debate background executor was removed when the
// disput runtime was consolidated onto results.js/serialDebateState. Drop its
// orphaned persisted state so it does not linger in existing installs.
try {
  chrome?.storage?.local?.remove?.('llmCortexDebateBackgroundExecutor.v1', () => chrome.runtime.lastError);
} catch (err) {
  console.warn('[BACKGROUND] Debate executor state cleanup failed:', err);
}
