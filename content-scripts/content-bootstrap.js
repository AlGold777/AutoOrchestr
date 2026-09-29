/* Lightweight bootstrap: initializes shared namespaces without altering behavior. */
(function initContentBootstrap() {
  const root = typeof window !== 'undefined' ? window : globalThis;
  root.LLMExtension = root.LLMExtension || {};
  root.SelectorConfig = root.SelectorConfig || {};
  const safeRuntimeSendMessage = (payload) => {
    try {
      if (!chrome?.runtime?.id) return false;
      chrome.runtime.sendMessage(payload, () => {
        const errMsg = chrome.runtime?.lastError?.message || '';
        if (errMsg.includes('Extension context invalidated')) {
          root.__LLMCodexContextInvalidated = true;
        }
      });
      return true;
    } catch (err) {
      if ((err?.message || '').includes('Extension context invalidated')) {
        root.__LLMCodexContextInvalidated = true;
        return false;
      }
      throw err;
    }
  };
  const manifestVersion = (() => {
    try {
      return chrome?.runtime?.getManifest?.()?.version || 'unknown';
    } catch (_) {
      return 'unknown';
    }
  })();
  // Purpose: keep track of the latest dispatch meta propagated to this tab.
  const captureDispatchMeta = (meta = {}) => {
    const runSessionId = meta.runSessionId || meta.sessionId || null;
    if (runSessionId) {
      root.__CURRENT_SESSION_ID__ = runSessionId;
      if (root.ContentUtils?.storeSessionId) {
        root.ContentUtils.storeSessionId(runSessionId);
      }
    }
    if (meta.pipelineRunId) {
      if (root.ContentUtils?.storeDispatchMeta) {
        root.ContentUtils.storeDispatchMeta({ pipelineRunId: meta.pipelineRunId });
      }
    }
    if (root.ContentUtils?.storeDispatchMeta) {
      root.ContentUtils.storeDispatchMeta(meta);
    }
  };
  try {
    chrome.runtime.onMessage.addListener((message) => {
      const meta = message?.meta && typeof message.meta === 'object' ? message.meta : {};
      const merged = {
        runSessionId: meta.runSessionId || message?.runSessionId || null,
        sessionId: meta.sessionId || message?.sessionId || null,
        dispatchId: meta.dispatchId || message?.dispatchId || null,
        tabSessionId: meta.tabSessionId || message?.tabSessionId || null,
        pipelineRunId: meta.pipelineRunId || message?.pipelineRunId || null
      };
      captureDispatchMeta(merged);
    });
  } catch (_) {
    // Ignore if runtime messaging is unavailable during bootstrap.
  }
  if (root.__llmCodexVersion && root.__llmCodexVersion !== manifestVersion) {
    Object.keys(root).forEach((key) => {
      if (key.endsWith('ContentScriptLoaded')) {
        try { delete root[key]; } catch (_) {}
      }
    });
  }
  root.__llmCodexVersion = manifestVersion;

  // v2.54.24 (2025-12-22 23:14 UTC): Verbose feature flags (Purpose: toggle deep diagnostics without code changes).
  const defaultFlags = {
    buildVersion: 'dev',
    selectorV2: false,
    extractorV2: false,
    humanoidV2: false,
    adaptersV2: {},
    verboseLogging: false,
    verboseSelectors: false,
    verboseAnswerWatcher: false,
    verboseTelemetry: false
  };
  root.LLMExtension.flags = Object.assign({}, defaultFlags, root.LLMExtension.flags || {});

  // Budgets/Contracts (Embedded Pragmatist v2.0)
  if (!root.__PRAGMATIST_BUDGETS && typeof root.__loadPragmatistBudgets !== 'function') {
    try {
      // Attempt to load shared budgets module if present
      // eslint-disable-next-line global-require, import/no-unresolved
      require?.('../shared/budgets');
    } catch (_) {}
  }

  // Stamp build info once per page
  if (!root.LLMExtension.__bootstrapInfo) {
    root.LLMExtension.__bootstrapInfo = {
      ts: Date.now(),
      source: 'content-bootstrap'
    };
  }

  try {
    chrome?.storage?.local?.onChanged?.addListener((changes, area) => {
      if (area !== 'local') return;
      const payload = changes.kill_switch?.newValue;
      const isAuthorized = payload && typeof payload === 'object' && payload.source === 'background';
      if (isAuthorized) {
        try {
          if (root.humanSessionController?.forceHardStop) {
            root.humanSessionController.forceHardStop('kill-switch');
          } else if (root.humanSessionController?._hardStop) {
            root.humanSessionController._hardStop('kill-switch');
          }
          root.__LLMScrollHardStop = true;
        } catch (_) {}
      }
    });
  } catch (_) {}

  // Main-world bridge (единый для текста и вложений)
  try {
    if (!root.__LLMMainBridgeInjected) {
      root.__LLMMainBridgeInjected = true;
      const bridgeToken = `bridge_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
      // content-bootstrap is loaded before content-utils in the manifest. Keep the
      // token on the isolated-world global so ContentUtils can adopt it when it
      // initializes; otherwise every authenticated bridge event is sent with a
      // null token and the main-world listener silently rejects it.
      root.__LLMMainBridgeToken = bridgeToken;
      root.ContentUtils?.setMainBridgeToken?.(bridgeToken);
      void (async () => {
        // CSP-safe path first: the background injects the bridge file into the
        // MAIN world via chrome.scripting (immune to the page's CSP) and hands
        // the token over through extension args, never through the DOM.
        const injectViaBackground = () => new Promise((resolve) => {
          try {
            chrome.runtime.sendMessage({ type: 'BRIDGE_INJECT_REQUEST', bridgeToken }, (response) => {
              if (chrome.runtime.lastError) { resolve(null); return; }
              resolve(response || null);
            });
          } catch (_) { resolve(null); }
        });
        try {
          const injected = await injectViaBackground();
          if (injected?.ok && injected.tokenAccepted) return;
          // Keep the legacy path as a last-resort recovery. Declarative MAIN-world
          // registration and chrome.scripting are the preferred CSP-safe paths,
          // but field tabs can survive an extension reload without either bridge
          // instance. In that state silently giving up drops every EXT_SET_TEXT and
          // EXT_ATTACH command. The inline path is best-effort and is removed from
          // the DOM immediately; strict-CSP pages simply reject it and surface the
          // explicit warning below.
          const bridgeUrl = chrome.runtime?.getURL('content-scripts/content-bridge.js');
          const bridgeSource = await fetch(bridgeUrl).then((resp) => resp.text());
          const bridgedSource = bridgeSource.replaceAll('__LLM_BRIDGE_TOKEN__', JSON.stringify(bridgeToken));
          const s = document.createElement('script');
          s.textContent = bridgedSource;
          s.onload = () => { try { s.remove(); } catch (_) {} };
          (document.documentElement || document.head || document.body).appendChild(s);
          try { s.remove(); } catch (_) {}
          console.warn('[content-bootstrap] CSP-safe bridge injection was not accepted; attempted legacy recovery', injected || {});
        } catch (err) {
          console.warn('[content-bootstrap] Failed to inject bridge script', err);
        }
      })();
    }
  } catch (_) {}

  // Script-ready handshake helper (retries until ACK_READY).
  if (!root.LLMExtension.sendScriptReady) {
    const readyStateByModel = new Map();
    const MAX_READY_ATTEMPTS = 5;
    // Bare `typeof X` only: `typeof X?.y` evaluates X and throws ReferenceError
    // on an undeclared global instead of falling back to the literal. TimingConfig
    // ships as its own manifest entry, so a load failure there must not take the
    // handshake down with it.
    const hasTimingConfig = typeof TimingConfig !== 'undefined'
      && typeof TimingConfig?.getTiming === 'function';
    const READY_RETRY_MS = hasTimingConfig
      ? TimingConfig.getTiming('handshakeRetryMs', 2000)
      : 2000;
    const LOCATION_POLL_MS = hasTimingConfig
      ? TimingConfig.getTiming('handshakeLocationPollMs', 1000)
      : 1000;

    const buildSessionId = () => `sess_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    const ensureState = (llmName) => {
      if (!readyStateByModel.has(llmName)) {
        readyStateByModel.set(llmName, {
          llmName,
          tabSessionId: buildSessionId(),
          attempts: 0,
          acked: false,
          popstateBound: false,
          retryTimer: null,
          hrefTimer: null,
          lastHref: location.href
        });
      }
      return readyStateByModel.get(llmName);
    };

    const clearRetryTimer = (state) => {
      if (state.retryTimer) {
        clearInterval(state.retryTimer);
        state.retryTimer = null;
      }
    };

    const clearHrefTimer = (state) => {
      if (state.hrefTimer) {
        clearInterval(state.hrefTimer);
        state.hrefTimer = null;
      }
    };

    const notifySpaNavigation = (state, reason, previousUrl, nextUrl) => {
      if (!state || !previousUrl || !nextUrl || previousUrl === nextUrl) return;
      try {
        const event = new CustomEvent('LLM_CODEX_SPA_NAVIGATION', {
          detail: {
            llmName: state.llmName,
            reason,
            previousUrl,
            nextUrl
          }
        });
        window.dispatchEvent(event);
      } catch (_) {}
      safeRuntimeSendMessage({
        type: 'SPA_NAVIGATION',
        llmName: state.llmName,
        oldUrl: previousUrl,
        newUrl: nextUrl,
        reason
      });
    };

    const completionRuntimeSnapshot = () => {
      const detector = root.LLMExtension?.ResponseLifecycleDetector || root.ResponseLifecycleDetector;
      const protocol = root.CompletionProtocol;
      return {
        buildVersion: detector?.buildVersion || manifestVersion,
        detectorVersion: detector?.version || null,
        protocolVersion: detector?.protocolVersion || protocol?.version || null,
        completionSessionAvailable: typeof protocol?.CompletionSession === 'function'
          && typeof detector?.startResponseLifecycleTracking === 'function'
      };
    };

    const sendReady = (state, meta = {}, reason = 'init') => {
      if (!state || state.acked) {
        clearRetryTimer(state);
        return;
      }
      if (state.attempts >= MAX_READY_ATTEMPTS) {
        clearRetryTimer(state);
        return;
      }
      state.attempts += 1;
      safeRuntimeSendMessage({
        type: 'SCRIPT_READY',
        llmName: state.llmName,
        tabSessionId: state.tabSessionId,
        meta: {
          ...meta,
          completionRuntime: completionRuntimeSnapshot(),
          tabSessionId: state.tabSessionId,
          reason,
          url: location.href
        }
      });
    };

    const resetSession = (state, meta = {}, reason = 'navigation') => {
      if (!state) return;
      clearRetryTimer(state);
      state.acked = false;
      state.attempts = 0;
      state.tabSessionId = buildSessionId();
      const previousUrl = state.lastHref;
      state.lastHref = location.href;
      notifySpaNavigation(state, reason, previousUrl, state.lastHref);
      sendReady(state, meta, reason);
      state.retryTimer = setInterval(() => sendReady(state, meta, 'retry'), READY_RETRY_MS);
    };

    root.LLMExtension.sendScriptReady = (input, meta = {}) => {
      const options = typeof input === 'string' ? { llmName: input } : (input || {});
      const llmName = options.llmName;
      if (!llmName) return;
      const state = ensureState(llmName);
      if (state.acked) return state.tabSessionId;
      const payload = { ...options.meta, ...meta };
      if (!state.retryTimer) {
        sendReady(state, payload, 'init');
        state.retryTimer = setInterval(() => sendReady(state, payload, 'retry'), READY_RETRY_MS);
      }
      if (!state.hrefTimer) {
        state.hrefTimer = setInterval(() => {
          if (state.lastHref !== location.href) {
            resetSession(state, payload, 'url_change');
          }
        }, LOCATION_POLL_MS);
      }
      if (!state.popstateBound) {
        window.addEventListener('popstate', () => resetSession(state, payload, 'popstate'), { passive: true });
        state.popstateBound = true;
      }
      return state.tabSessionId;
    };

    root.LLMExtension.replayScriptReady = (input, meta = {}) => {
      const options = typeof input === 'string' ? { llmName: input } : (input || {});
      const llmName = options.llmName;
      if (!llmName) return null;
      const state = ensureState(llmName);
      const payload = { ...options.meta, ...meta };
      clearRetryTimer(state);
      state.acked = false;
      state.attempts = 0;
      sendReady(state, payload, 'background_recovery_request');
      state.retryTimer = setInterval(() => sendReady(state, payload, 'retry'), READY_RETRY_MS);
      return state.tabSessionId;
    };

    chrome.runtime?.onMessage?.addListener?.((message) => {
      if (message?.type === 'REQUEST_SCRIPT_READY') {
        root.LLMExtension.replayScriptReady(message.llmName, {
          reason: message.reason || 'background_request'
        });
        return;
      }
      if (message?.type !== 'ACK_READY') return;
      const llmName = message.llmName;
      if (!llmName) return;
      const state = readyStateByModel.get(llmName);
      if (!state) return;
      if (message.tabSessionId && message.tabSessionId !== state.tabSessionId) return;
      state.acked = true;
      clearRetryTimer(state);
    });
  }
})();
