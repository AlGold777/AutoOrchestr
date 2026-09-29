(function (global) {
  if (global.BaseLLMAdapter) {
    console.warn('[BaseLLMAdapter] Already defined, skipping duplicate load.');
    return;
  }

  const NAVIGATION_POLL_MS = 250;
  const DEFAULT_WAIT_STEP_MS = 75;
  const DEFAULT_WAIT_TIMEOUT_MS = 10000;
  const DOCUMENT_BODY_OBSERVE_OPTIONS = { childList: true, subtree: true };

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  class BaseLLMAdapter {
    constructor(config = {}) {
      if (!config.model) {
        throw new Error('BaseLLMAdapter requires a `model` identifier.');
      }
      this.MODEL = config.model;
      this.SELECTORS = config.selectors || {};
      this.TIMEOUTS = config.timeouts || {};
      this._isValidUrlFn = typeof config.isValidUrl === 'function'
        ? config.isValidUrl
        : (typeof config.isValidPlatformUrl === 'function' ? config.isValidPlatformUrl : null);
      this._observers = new Set();
      this._intervals = new Set();
      this._cleanupReason = null;
      this._initialUrl = window.location.href;
      this._currentUrl = this._initialUrl;
      this._currentPathname = window.location.pathname;
      this._isCleaningUp = false;

      // Guard against duplicate injections.
      if (window[`${this.MODEL}ContentScriptLoaded`]) {
        console.warn(`[${this.MODEL}] Duplicate content script prevented from initializing.`);
        return;
      }
      window[`${this.MODEL}ContentScriptLoaded`] = true;

      this._setupNavigationWatcher();
    }

    async waitForElement(selector, timeoutMs = DEFAULT_WAIT_TIMEOUT_MS) {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        const element = document.querySelector(selector);
        if (element) {
          return element;
        }
        await sleep(DEFAULT_WAIT_STEP_MS);
      }
      throw new Error(`[${this.MODEL}] Element not found: ${selector}`);
    }

    async humanType(element, text, options = {}) {
      if (!element) throw new Error('humanType requires an element');
      const wpm = options.wpm || 110;
      const msPerChar = 60000 / (wpm * 5);
      for (const char of text) {
        element.value += char;
        element.dispatchEvent(new Event('input', { bubbles: true }));
        await sleep(msPerChar + Math.random() * 25);
      }
    }

    registerObserver(observer) {
      if (observer && typeof observer.disconnect === 'function') {
        this._observers.add(observer);
      }
    }

    registerInterval(intervalId) {
      if (intervalId) {
        this._intervals.add(intervalId);
      }
    }

    _setupNavigationWatcher() {
      const checkUrl = () => {
        const current = window.location.href;
        if (current !== this._currentUrl) {
          this._handleNavigation();
        }
      };

      const mutationObserver = new MutationObserver(() => checkUrl());
      const observeTarget = document.documentElement || document.body;
      if (observeTarget) {
        mutationObserver.observe(observeTarget, DOCUMENT_BODY_OBSERVE_OPTIONS);
        this.registerObserver(mutationObserver);
      }

      window.addEventListener('popstate', () => checkUrl());
      window.addEventListener('hashchange', () => checkUrl());
      window.addEventListener('pagehide', () => this._cleanup('pagehide'));
      window.addEventListener('beforeunload', () => this._cleanup('beforeunload'));
      this._navigationCheckInterval = setInterval(checkUrl, NAVIGATION_POLL_MS);
      this.registerInterval(this._navigationCheckInterval);
    }

    _handleNavigation() {
      const previousUrl = this._currentUrl;
      const currentUrl = window.location.href;
      const currentPathname = window.location.pathname;
      const pathChanged = currentPathname !== this._currentPathname;
      this._currentUrl = currentUrl;
      this._currentPathname = currentPathname;
      const stillOnPlatform = this._isValidPlatformUrl(currentUrl);
      if (!stillOnPlatform) {
        this._cleanup('navigation');
        return;
      }
      if (pathChanged) {
        if (window.ResponseLifecycleDetector?.shouldPreserveNavigation?.({
          modelName: this.MODEL, previousUrl, nextUrl: currentUrl
        })) return;
        this._cleanup('spa-navigation');
        this._isCleaningUp = false;
        this._cleanupReason = null;
        this._setupNavigationWatcher();
      }
    }

    _isValidPlatformUrl(url = window.location.href) {
      if (typeof this._isValidUrlFn === 'function') {
        try {
          return !!this._isValidUrlFn(url);
        } catch (err) {
          console.warn(`[${this.MODEL}] isValidUrl threw`, err);
        }
      }
      return true;
    }

    _cleanup(reason = 'unspecified') {
      if (this._isCleaningUp) return;
      this._isCleaningUp = true;
      this._cleanupReason = reason;

      this._observers.forEach((observer) => {
        try {
          observer.disconnect();
        } catch (err) {
          console.warn(`[${this.MODEL}] Observer cleanup failed`, err);
        }
      });
      this._observers.clear();

      this._intervals.forEach((id) => {
        try {
          clearInterval(id);
        } catch (err) {
          console.warn(`[${this.MODEL}] Interval cleanup failed`, err);
        }
      });
      this._intervals.clear();

      this._emitCleanupEvent(reason);

      try {
        window[`${this.MODEL}ContentScriptLoaded`] = false;
      } catch (_) {}
    }

    _emitCleanupEvent(reason) {
      chrome?.runtime?.sendMessage?.({
        type: 'CONTENT_SCRIPT_UNLOADED',
        model: this.MODEL,
        reason
      }).catch(() => {});
    }

    handleMessage(message, sender, sendResponse) {
      if (!message || typeof message !== 'object') return false;
      if (message.type === 'STOP_AND_CLEANUP') {
        this._cleanup(message.reason || 'stop_request');
        if (typeof sendResponse === 'function') {
          sendResponse({ status: 'stopped', model: this.MODEL });
        }
        return false;
      }
      if (message.type === 'HEALTH_CHECK_PING') {
        if (typeof sendResponse === 'function') {
          sendResponse({ type: 'HEALTH_CHECK_PONG', pingId: message.pingId, model: this.MODEL });
        }
        return true;
      }
      if (message.type === 'PAGE_NAVIGATED') {
        this._handleNavigation();
        return true;
      }
      return false;
    }
  }

  global.BaseLLMAdapter = BaseLLMAdapter;
})(typeof window !== 'undefined' ? window : self);
