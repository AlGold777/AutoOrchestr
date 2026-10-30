/* Embedded Pragmatist v2.0 core (StateManager, StreamWatcher, NavigationDetector, CommandExecutor, BroadcastListener)
 * Lightweight, debounced, budget-aware implementations. Text stays in-memory; storage holds only metadata.
 */

(function initPragmatistCore() {
  if (window.PragmatistCore) return;

  const B = (window.__PRAGMATIST_BUDGETS) || {
    timing: {
      debounceStorage: 2000,
      debounceLocalStorage: 1000,
      navigationPollInterval: 1000,
      commandPollInterval: 2000,
      foregroundTimeout: 500,
      backgroundTimeout: 3000,
      commandTTL: 60000,
      ackTTL: 300000,
      streamingStorageThrottleMs: 2000
    }
  };

  const sendDiagEvent = (payload = {}) => {
    try {
      chrome.runtime?.sendMessage?.({ type: 'DIAG_EVENT', event: payload });
    } catch (_) {}
  };

  const isHardStopped = () => {
    try {
      if (window.__LLMScrollHardStop) return true;
      const state = window.__HumanoidSessionState?.state || window.humanSessionController?.getState?.();
      return state === 'HARD_STOP';
    } catch (_) {
      return false;
    }
  };

  class StateManager {
    constructor(sessionId, platform) {
      this.sessionId = sessionId;
      this.platform = platform;
      this.currentText = '';
      this.status = 'idle';
      this.streamStartedAt = null;
      this.lastTokenAt = null;
      this.chromeStorageTimer = null;
      this.lastStorageWriteAt = 0;
      this.COMPLETION_IDLE_MS = 2000;
    }

    async restore() {
      const storageKey = `state_${this.sessionId}`;
      const store = chrome.storage?.session || chrome.storage?.local;
      if (store) {
        try {
          const res = await store.get(storageKey);
          const stored = res?.[storageKey];
          if (stored?.status) {
            this.status = stored.status;
          }
        } catch (_) {}
      }
    }

    onStreamUpdate(text, isGenerating) {
      const textChanged = text !== this.currentText;
      const wasGenerating = this.status === 'generating';
      if (textChanged) {
        this.currentText = text;
        this.lastTokenAt = Date.now();
      }
      if (isGenerating && !wasGenerating) {
        this.status = 'generating';
        this.streamStartedAt = Date.now();
      }
      if (!isGenerating && wasGenerating) {
        this._onGenerationComplete();
      }
      if (isGenerating) {
        this._throttledSaveStorage();
      } else {
        this._debouncedSaveStorage();
      }
    }

    _onGenerationComplete() {
      this.status = 'completed';
      this._stopCompletionDetection();
      this._saveStorage();
    }

    // Completion detection выключен: метод оставлен для совместимости с тестами/вызовами.
    _stopCompletionDetection() {}

    async _saveStorage() {
      const key = `state_${this.sessionId}`;
      const platformKey = `state_${this.platform}_${this.sessionId}`;
      const preview = this.currentText.slice(0, 512); // keep small for 1KB budget
      const data = {
        sessionId: this.sessionId,
        platform: this.platform,
        url: location.href,
        status: this.status,
        preview,
        textLength: this.currentText.length,
        updatedAt: Date.now()
      };
      const store = chrome.storage?.session || chrome.storage?.local;
      if (!store) return;
      try {
        // crude guard to stay within ~1KB budget
        const approxSize = JSON.stringify(data).length;
        if (approxSize <= 1024) {
          await store.set({ [key]: data, [platformKey]: data });
          this.lastStorageWriteAt = Date.now();
        }
      } catch (_) {}
    }

    _debouncedSaveStorage() {
      if (this.chromeStorageTimer) clearTimeout(this.chromeStorageTimer);
      this.chromeStorageTimer = window.setTimeout(() => {
        this._saveStorage();
        this.chromeStorageTimer = null;
      }, B.timing.debounceStorage);
    }

    _throttledSaveStorage() {
      const throttleMs = B.timing.streamingStorageThrottleMs ?? 2000;
      const now = Date.now();
      if (now - this.lastStorageWriteAt < throttleMs) return;
      this._saveStorage();
    }

    getSessionId() { return this.sessionId; }
    getStatus() { return this.status; }
    getText() { return this.currentText; }
  }

  class StreamWatcher {
    constructor(adapter, stateManager) {
      this.adapter = adapter;
      this.stateManager = stateManager;
      this.observer = null;
      this.observedNode = null;
      this.debounceTimer = null;
      this.DEBOUNCE_MS = 300;
    }
    connect() {
      if (isHardStopped()) return false;
      const found = this._findResponseContainer();
      const node = found?.el || found;
      const target = (node && typeof node.nodeType === 'number') ? node : (document.body || document.documentElement);
      if (!target || typeof target.nodeType !== 'number') return false;
      this.disconnect();
      const stopObserve = window.ContentUtils?.observeMutations
        ? window.ContentUtils.observeMutations(target, { childList: true, subtree: true, characterData: true }, (muts) => this._queue(muts))
        : null;
      if (stopObserve) {
        this.observer = { disconnect: stopObserve };
        this.observedNode = target;
      } else {
        return false;
      }
      // Первичный прогон, чтобы зафиксировать стартовое состояние
      this._queue([{ type: 'init' }]);
      this._process();
      return true;
    }
    disconnect() {
      if (this.observer) this.observer.disconnect();
      this.observer = null;
      this.observedNode = null;
      if (this.debounceTimer) clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    async reconnect() {
      if (isHardStopped()) {
        this.disconnect();
        return false;
      }
      this.disconnect();
      await this._waitForDOM();
      return this.connect();
    }
    _queue(mutations) {
      if (this.debounceTimer) clearTimeout(this.debounceTimer);
      this.debounceTimer = window.setTimeout(() => this._process(mutations), this.DEBOUNCE_MS);
    }
    _process() {
      if (isHardStopped()) {
        sendDiagEvent({ type: 'stream_watcher_stop', reason: 'hard_stop' });
        return;
      }
      const text = this.adapter.extractResponseText();
      const isGen = this.adapter.isGenerating();
      this.stateManager.onStreamUpdate(text, isGen);
    }
    _findResponseContainer() {
      const selectors = this.adapter.selectors?.responseContainer || [];
      const list = Array.isArray(selectors) ? selectors : [selectors];
      for (const sel of list) {
        try {
          const el = document.querySelector(sel);
          if (el) {
            if (typeof this.adapter.onContainerResolved === 'function') {
              try { this.adapter.onContainerResolved(sel, el); } catch (_) {}
            }
            return { el, selector: sel };
          }
        } catch (_) {}
      }
      return null;
    }
    async _waitForDOM(maxWait = 5000) {
      const start = Date.now();
      while (Date.now() - start < maxWait) {
        if (this._findResponseContainer()) return true;
        await new Promise(r => setTimeout(r, 200));
      }
      return false;
    }
  }

  class NavigationDetector {
    constructor(onNavigate) {
      this.onNavigate = onNavigate;
      this.lastPath = location.pathname;
      this.lastSearch = location.search;
      this.timer = null;
    }
    start() {
      if (this.timer) return;
      this.timer = window.setInterval(() => this._check(), B.timing.navigationPollInterval || 1000);
    }
    stop() { if (this.timer) { clearInterval(this.timer); this.timer = null; } }
    _check() {
      if (location.pathname !== this.lastPath || location.search !== this.lastSearch) {
        this.lastPath = location.pathname;
        this.lastSearch = location.search;
        this.onNavigate?.();
      }
    }
  }

  class CommandExecutor {
    constructor(adapter, stateManager) {
      this.adapter = adapter;
      this.stateManager = stateManager;
      this.isExecuting = false;
      this.queue = [];
      this.started = false;
      this.messageHandler = (msg, sender, sendResponse) => {
        if (!msg || msg.type !== 'EXECUTE_COMMAND') return;
        this._ingestCommand(msg.command, 'runtime');
        if (sendResponse) sendResponse({ accepted: true });
      };
    }
    start() {
      if (this.started) return;
      this.started = true;
      this._recoverPendingCommand();
      try { chrome.runtime?.onMessage?.addListener?.(this.messageHandler); } catch (_) {}
    }
    stop() {
      if (!this.started) return;
      this.started = false;
      try { chrome.runtime?.onMessage?.removeListener?.(this.messageHandler); } catch (_) {}
      this.queue = [];
    }
    async _recoverPendingCommand() {
      try {
        const store = chrome.storage?.session || chrome.storage?.local;
        let all = {};
        if (store?.get) {
          try { all = await store.get(null); } catch (_) {}
        }
        let candidates = Object.entries(all || {})
          .filter(([k]) => k.startsWith('pending_command_'))
          .map(([, v]) => v)
          .filter(Boolean);
        if (!candidates.length) {
          const res = await chrome.storage.local.get('pending_command');
          const cmd = res?.pending_command;
          if (cmd) candidates.push(cmd);
        }
        candidates.sort((a, b) => (b?.createdAt || 0) - (a?.createdAt || 0));
        const latest = candidates[0];
        this._ingestCommand(latest, 'storage');
      } catch (err) {
        console.warn('[CommandExecutor] recover error', err);
      }
    }
    async _check() {
      // Legacy entry point for tests/fallback: single recovery attempt from storage.
      await this._recoverPendingCommand();
    }
    _ingestCommand(cmd, source = 'unknown') {
      if (!cmd) return;
      const ttl = B.timing.commandTTL || 60000;
      if (Date.now() - (cmd?.createdAt || 0) > ttl) return;
      if (cmd?.payload?.platforms && Array.isArray(cmd.payload.platforms)) {
        if (!cmd.payload.platforms.includes(this.adapter.name)) return;
      }
      this.queue.push({ cmd, source });
      this._drainQueue();
    }
    async _drainQueue() {
      if (this.isExecuting) return;
      this.isExecuting = true;
      while (this.queue.length) {
        const { cmd } = this.queue.shift();
        await this._execute(cmd);
      }
      this.isExecuting = false;
    }
    async _execute(cmd) {
      const ttl = B.timing.commandTTL || 60000;
      if (Date.now() - (cmd?.createdAt || 0) > ttl) return;
      if (isHardStopped()) {
        sendDiagEvent({ type: 'cmd_skip', reason: 'hard_stop' });
        return;
      }
      if (cmd?.payload?.platforms && Array.isArray(cmd.payload.platforms)) {
        if (!cmd.payload.platforms.includes(this.adapter.name)) return;
      }
      const ackKey = `cmd_ack_${cmd.id}_${this.stateManager.getSessionId()}`;
      try {
        const existingAck = await chrome.storage.local.get(ackKey);
        if (existingAck?.[ackKey]) return;
      } catch (_) {}
      let status = 'executed';
      let error;
      try {
        if (cmd.action === 'submit_prompt' && cmd.payload?.prompt) {
          await this.adapter.submitPrompt(cmd.payload.prompt);
        } else if (cmd.action === 'stop_generation') {
          await this.adapter.stopGeneration();
        } else if (cmd.action === 'collect_response') {
          const text = this.stateManager.getText();
          const payload = { type: 'RESPONSE_COLLECTED', sessionId: this.stateManager.getSessionId(), platform: this.adapter.name, text };
          const safeSend = window.ContentUtils?.safeRuntimeSendMessage;
          if (safeSend) {
            safeSend(payload);
          } else {
            chrome.runtime.sendMessage(payload);
          }
        } else {
          status = 'skipped';
        }
      } catch (err) {
        status = 'failed';
        error = err?.message || String(err);
      }
      const ack = {
        commandId: cmd.id,
        sessionId: this.stateManager.getSessionId(),
        platform: this.adapter.name,
        status,
        error,
        executedAt: Date.now()
      };
      try { await chrome.storage.local.set({ [ackKey]: ack }); } catch (_) {}
      try {
        const ackPayload = { type: 'COMMAND_ACK', ack, commandId: cmd.id };
        const safeSend = window.ContentUtils?.safeRuntimeSendMessage;
        if (safeSend) {
          safeSend(ackPayload);
        } else {
          chrome.runtime?.sendMessage?.(ackPayload);
        }
      } catch (_) {}
    }
  }

  class BroadcastListener {
    constructor(onStopAll) {
      this.onStopAll = onStopAll;
      this.handler = this._handle.bind(this);
      this.platform = null;
    }
    setPlatform(name) { this.platform = name; }
    start() {
      try {
        chrome.storage?.onChanged?.addListener?.(this.handler);
      } catch (_) {}
    }
    stop() { chrome.storage.onChanged.removeListener(this.handler); }
    _handle(changes, area) {
      if (area !== 'local') return;
      if (changes.global_command?.newValue) {
        const cmd = changes.global_command.newValue;
        if (Date.now() - (cmd.timestamp || 0) > 5000) return;
        if (cmd.action === 'STOP_ALL') {
          if (Array.isArray(cmd.platforms) && this.platform && !cmd.platforms.includes(this.platform)) {
            return;
          }
          if (typeof window.ContentUtils?.isStopCommandCurrent === 'function'
              && !window.ContentUtils.isStopCommandCurrent(cmd, { requireKnownIdentity: true })) return;
          this.onStopAll?.();
        }
      }
    }
  }

  window.PragmatistCore = {
    StateManager,
    StreamWatcher,
    NavigationDetector,
    CommandExecutor,
    BroadcastListener
  };
})();
