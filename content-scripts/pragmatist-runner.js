/* Pragmatist Runner
 * Lightweight, host-based adapter that wires PragmatistCore (state/stream/watch/navigation/commands)
 * without touching existing platform scripts.
 * Keeps text in memory, writes only metadata to localStorage/chrome.storage (via StateManager).
 */
(function initPragmatistRunner() {
  if (!window.PragmatistCore || window.__pragmatistRunner) return;

  const {
    StateManager,
    StreamWatcher,
    NavigationDetector,
    CommandExecutor,
    BroadcastListener
  } = window.PragmatistCore;

  const platformFromHost = () => {
    const h = location.hostname || '';
    if (h.includes('openai') || h.includes('chatgpt')) return 'chatgpt';
    if (h.includes('claude.ai')) return 'claude';
    if (h.includes('gemini.google')) return 'gemini';
    if (h.includes('perplexity.ai')) return 'perplexity';
    if (h.includes('grok.com') || h === 'x.com') return 'grok';
    if (h.includes('deepseek')) return 'deepseek';
    if (h.includes('qwen')) return 'qwen';
    if (h.includes('mistral')) return 'lechat';
    if (h === 'chat.z.ai') return 'zai';
    if (h === 'kimi.ai' || h.endsWith('.kimi.ai')) return 'kimi';
    return 'unknown';
  };

  const fallbackSelectorsByPlatform = {
    chatgpt: [
      '[data-message-author-role=\"assistant\"]',
      '.prose',
      'article',
      '.message',
      '[data-testid*=\"response\"], [data-testid*=\"assistant\"]'
    ],
    claude: [
      '[data-testid*=\"message\"] article',
      '[data-testid*=\"message\"]',
      'main article',
      '[role=\"article\"]',
      'section'
    ],
    gemini: [
      'main article',
      'div[data-mdx-content]',
      '[data-message-text]',
      '[data-article-id]',
      '[data-testid*=\"response\"]'
    ],
    perplexity: [
      '[data-testid=\"chat-message\"]',
      '[data-testid*=\"response\"]',
      'article',
      'div[class*=\"markdown\"]',
      '[class*=\"answer\"]'
    ],
    grok: [
      'main article',
      '[data-testid*=\"response\"]',
      '[data-message-author-role=\"assistant\"]',
      '[class*=\"assistant\"]'
    ],
    deepseek: [
      'main article',
      '[data-message-author-role=\"assistant\"]',
      'div[class*=\"markdown\"]',
      '[class*=\"answer\"]'
    ],
    qwen: [
      'main article',
      '[data-message-author-role=\"assistant\"]',
      'div[class*=\"markdown\"]',
      '[class*=\"assistant\"]'
    ],
    zai: [
      '.chat-assistant.markdown-prose',
      '[id^=\"message-\"] .chat-assistant.markdown-prose',
      '[data-message-author-role=\"assistant\"]',
      '[data-role=\"assistant\"]',
      '[data-testid*=\"assistant\"]',
      '[class*=\"assistant-message\"]',
      '[class*=\"assistant\"] [class*=\"markdown\"]'
    ],
    lechat: [
      'main article',
      '[data-testid*=\"message\"]',
      'div[data-message-source=\"assistant\"]',
      '[class*=\"assistant\"]'
    ],
    kimi: [
      '.segment-assistant .markdown-container',
      '.segment-assistant',
      '.markdown-container',
      '[data-message-author-role=\"assistant\"]',
      '[data-role=\"assistant\"]',
      '[class*=\"assistant\"] [class*=\"markdown\"]'
    ]
  };

  const modelKeyMap = {
    chatgpt: 'ChatGPT',
    claude: 'Claude',
    gemini: 'Gemini',
    perplexity: 'Perplexity',
    grok: 'Grok',
    deepseek: 'DeepSeek',
    qwen: 'Qwen',
    lechat: 'LeChat',
    zai: 'Z.ai',
    kimi: 'Kimi'
  };

  const buildSelectors = () => {
    const platform = platformFromHost();
    const modelKey = modelKeyMap[platform];
    const cfg = window.SelectorConfig;
    let response = fallbackSelectorsByPlatform[platform] || fallbackSelectorsByPlatform.chatgpt;
    let generating = ['[aria-busy=\"true\"]', '.loading', '.spinner', '[data-testid*=\"spinner\"]'];
    if (cfg && modelKey) {
      try {
        const version = cfg.detectUIVersion(modelKey) || 'unknown';
        const resp = cfg.getSelectorsFor(modelKey, version, 'response');
        if (Array.isArray(resp) && resp.length) response = resp;
        const gen = cfg.getSelectorsFor(modelKey, version, 'generatingIndicators');
        if (Array.isArray(gen) && gen.length) generating = gen;
      } catch (_) {}
    }
    return { response, generating };
  };

  const pickResponseContainer = (responseSelectors) => {
    for (const sel of responseSelectors || []) {
      try {
        const el = document.querySelector(sel);
        if (el) return { selectors: responseSelectors, element: el };
      } catch (_) {}
    }
    return { selectors: responseSelectors || defaultSelectors, element: document.body || document.documentElement };
  };

  const selectorSets = buildSelectors();

  const lastContainerKey = `__prag_last_response_${platformFromHost() || 'unknown'}`;
  const loadLastContainer = () => {
    try {
      const raw = window.localStorage.getItem(lastContainerKey);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch (_) {
      return null;
    }
  };
  const saveLastContainer = (selector, el) => {
    try {
      const xpath = getXPath(el);
      window.localStorage.setItem(lastContainerKey, JSON.stringify({ selector, xpath }));
    } catch (_) {}
  };
  const getXPath = (el) => {
    if (!el) return '';
    let node = el;
    const parts = [];
    while (node && node.nodeType === 1 && node !== document.body && node !== document.documentElement) {
      let ix = 0;
      let sib = node.previousSibling;
      while (sib) {
        if (sib.nodeType === 1 && sib.nodeName === node.nodeName) ix++;
        sib = sib.previousSibling;
      }
      parts.unshift(`${node.nodeName.toLowerCase()}[${ix + 1}]`);
      node = node.parentNode;
    }
    return '/' + parts.join('/');
  };

  const adapter = {
    name: platformFromHost(),
    selectors: {
      responseContainer: (() => {
        const saved = loadLastContainer();
        if (saved?.selector) {
          const set = new Set([saved.selector, ...selectorSets.response]);
          return Array.from(set);
        }
        return selectorSets.response;
      })()
    },
    getSessionId() {
      return sessionId;
    },
    extractResponseText() {
      const list = Array.isArray(this.selectors.responseContainer)
        ? this.selectors.responseContainer
        : (fallbackSelectorsByPlatform[platformFromHost()] || fallbackSelectorsByPlatform.chatgpt);
      const candidates = Array.from(document.querySelectorAll(list.join(',')));
      const last = candidates.filter((el) => (el.innerText || el.textContent || '').trim().length > 0).pop();
      if (!last) return '';
      return (last.innerText || last.textContent || '').trim();
    },
    onContainerResolved(selector, el) {
      saveLastContainer(selector, el);
    },
    isGenerating() {
      try {
        const genSelectors = Array.isArray(selectorSets.generating) ? selectorSets.generating : [];
        if (genSelectors.length) {
          return genSelectors.some((sel) => {
            try { return !!document.querySelector(sel); } catch (_) { return false; }
          });
        }
        return Boolean(document.querySelector('[data-testid*=\"spinner\"], [aria-busy=\"true\"], .loading, .animate-spin'));
      } catch (_) {
        return false;
      }
    },
    async submitPrompt(prompt) {
      const input = document.querySelector('textarea, [contenteditable=\"true\"]');
      const sendBtn = document.querySelector('button[type=\"submit\"], button[data-testid*=\"send\"], [aria-label*=\"Send\"]');
      if (!input || !sendBtn) throw new Error('input_or_button_missing');
      if ('value' in input) {
        input.value = prompt;
        input.dispatchEvent(new Event('input', { bubbles: true }));
      } else {
        input.textContent = prompt;
        input.dispatchEvent(new Event('input', { bubbles: true }));
      }
      sendBtn.click();
    },
    async stopGeneration() {
      const stopBtn = document.querySelector('[aria-label*=\"Stop\" i], [data-testid*=\"stop\"], button[title*=\"Stop\"], button[aria-label*=\"Cancel\" i]');
      stopBtn?.click();
    }
  };

  let pragmatistSettings = { speedMode: false };
  const applySettings = (settings = {}) => {
    pragmatistSettings = Object.assign({ speedMode: false }, settings || {});
    try { window.__PRAGMATIST_SPEED_MODE = !!pragmatistSettings.speedMode; } catch (_) {}
  };

  const sessionId = (() => {
    const host = platformFromHost() || 'tab';
    const storageKey = `__prag_session_${host}`;
    try {
      const existing = window.localStorage.getItem(storageKey);
      if (existing) return existing;
    } catch (_) {}
    const stamp = `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
    const sid = `${host}_${stamp}`;
    try { window.localStorage.setItem(storageKey, sid); } catch (_) {}
    return sid;
  })();

  const stateManager = new StateManager(sessionId, adapter.name);
  const streamWatcher = new StreamWatcher(adapter, stateManager);
  const navigationDetector = new NavigationDetector(async () => {
    await streamWatcher.reconnect();
  });
  const commandExecutor = new CommandExecutor(adapter, stateManager);
  const broadcastListener = new BroadcastListener(() => {
    try {
      window.__LLMScrollHardStop = true;
      stopAll('stop_all');
    } catch (_) {}
  });
  broadcastListener.setPlatform(adapter.name);

  const sendDiagEvent = (payload = {}) => {
    try { chrome.runtime?.sendMessage?.({ type: 'DIAG_EVENT', event: payload }); } catch (_) {}
  };

  const stopAll = (reason = 'manual') => {
    window.__LLMScrollStopEpoch = Number(window.__LLMScrollStopEpoch || 0) + 1;
    try { commandExecutor.stop(); } catch (_) {}
    try { navigationDetector.stop(); } catch (_) {}
    try { streamWatcher.disconnect(); } catch (_) {}
    if (reason === 'kill_switch') {
      try { window.__LLMScrollHardStop = true; } catch (_) {}
    }
    sendDiagEvent({ type: 'runner_stop', reason });
  };

  const attachKillSwitchListener = () => {
    try {
      chrome.storage.onChanged.addListener((changes, area) => {
        if (area !== 'local') return;
        const payload = changes.kill_switch?.newValue;
        const isAuthorized = payload && typeof payload === 'object' && payload.source === 'background';
        if (isAuthorized) {
          stopAll('kill_switch');
        }
        if (changes.settings) {
          applySettings(changes.settings.newValue || {});
        }
      });
    } catch (_) {}
  };

  const attachRuntimeListener = () => {
    try {
      chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
        if (msg?.type === 'STOP_ALL' || msg?.type === 'STOP_AND_CLEANUP' || msg?.type === 'FORCE_HARD_STOP_RESTORE') {
          if (msg.platforms && Array.isArray(msg.platforms) && !msg.platforms.includes(adapter.name)) {
            return;
          }
          window.__LLMScrollHardStop = true;
          stopAll(msg?.type?.toLowerCase());
          return;
        }
        if (msg?.type === 'SETTINGS_UPDATED') {
          applySettings(msg.settings || {});
          return;
        }
        if (msg?.type === 'SMOKE_CHECK') {
          if (msg.platform && msg.platform !== adapter.name) return;
          try {
            const checker = window.SelectorFinder?.healthCheck;
            if (typeof checker === 'function') {
              Promise.resolve(checker(adapter.name)).then((report) => {
                sendResponse?.({ success: true, report });
              }).catch((err) => {
                sendResponse?.({ success: false, error: err?.message || String(err) });
              });
              return true;
            }
            sendResponse?.({ success: false, error: 'no_checker' });
          } catch (err) {
            sendResponse?.({ success: false, error: err?.message || String(err) });
          }
          return true;
        }
      });
    } catch (_) {}
  };

  const boot = async () => {
    try {
      const res = await chrome.storage.local.get(['settings']);
      applySettings(res?.settings || {});
    } catch (_) {}
    await stateManager.restore();
    if (window.__LLMScrollHardStop) return;
    const connected = await (async () => {
      const deadline = Date.now() + 2500;
      while (Date.now() < deadline) {
        if (streamWatcher.connect()) return true;
        await new Promise(r => setTimeout(r, 250));
      }
      console.warn('[PragmatistRunner] response container not found within timeout');
      return false;
    })();
    if (connected) {
      navigationDetector.start();
    }
    commandExecutor.start();
    broadcastListener.start();
    attachKillSwitchListener();
    attachRuntimeListener();
    try {
      window.__PragmatistAdapter = { adapter, stateManager, streamWatcher, commandExecutor, sessionId };
    } catch (_) {}
  };

  boot().catch((err) => console.warn('[PragmatistRunner] boot failed', err));

  window.__pragmatistRunner = {
    adapter,
    sessionId,
    stateManager,
    streamWatcher,
    navigationDetector,
    commandExecutor,
    broadcastListener
  };
})();
