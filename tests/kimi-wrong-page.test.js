// M-15: a Kimi tab on kimi.ai/make3d (not a chat page) must never receive the prompt.
// The guard in ensureTabReadyForDispatch navigates it to the chat address once; if it is
// still not a chat page, the attempt ends with reason `wrong_page`.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const targetsSource = fs.readFileSync(path.join(root, 'background', 'llm-targets.js'), 'utf8');
const tabSource = fs.readFileSync(path.join(root, 'background', 'tab-manager.js'), 'utf8');

function section(source, start, end) {
  const a = source.indexOf(start);
  const b = source.indexOf(end, a + start.length);
  if (a < 0 || b < 0) throw new Error(`boundaries changed: ${start}`);
  return source.slice(a, b);
}

// Guard-related helpers, plus the head of ensureTabReadyForDispatch up to the
// point where the normal readiness flow starts (the guard runs before it).
const helpers = section(tabSource, 'function isChatPageUrlForLlm', 'function isEligibleTabForLlm');
const ensureHead = section(tabSource, 'async function ensureTabReadyForDispatch', '  // A correlated provider PONG')
  + '\n  return { ok: true, tab: initialTab, snapshot: initialSnapshot };\n}\n';

function load({ tabUrl, navigateLands = null }) {
  const state = { tab: { id: 7, url: tabUrl, status: 'complete', discarded: false }, updates: [] };
  const context = {
    console,
    URL,
    Promise,
    TAB_READY_RELOAD_TIMEOUT_MS: 25000,
    emitTelemetry: jest.fn(),
    getTabSafe: async () => ({ ...state.tab }),
    buildTabSnapshot: (tab) => (tab ? { url: tab.url } : null),
    buildTabTimingMeta: () => ({}),
    isPlaceholderTabUrl: () => false,
    shouldWaitForInitialTabUrl: () => false,
    isEligibleTabForLlm: (_llm, tab) => /^https:\/\/(www\.)?kimi\.ai\//.test(tab?.url || ''),
    waitForTabComplete: jest.fn(async () => true),
    chrome: {
      runtime: { lastError: null },
      tabs: {
        update: jest.fn((tabId, options, cb) => {
          state.updates.push({ tabId, url: options.url });
          if (navigateLands !== null) state.tab = { ...state.tab, url: navigateLands };
          cb?.();
        })
      }
    }
  };
  context.self = context;
  vm.createContext(context);
  vm.runInContext(`${targetsSource}\n;${helpers}\n;${ensureHead}\n;this.api = { ensureTabReadyForDispatch, isChatPageUrlForLlm };`, context);
  return { api: context.api, state, context };
}

describe('Kimi chat-page guard', () => {
  test('config: only root and /chat paths are chat pages for Kimi', () => {
    const { api } = load({ tabUrl: 'https://www.kimi.ai/' });
    expect(api.isChatPageUrlForLlm('Kimi', 'https://www.kimi.ai/')).toBe(true);
    expect(api.isChatPageUrlForLlm('Kimi', 'https://www.kimi.ai/chat/new-id?chat_enter_method=home')).toBe(true);
    expect(api.isChatPageUrlForLlm('Kimi', 'https://www.kimi.ai/make3d')).toBe(false);
    expect(api.isChatPageUrlForLlm('Kimi', 'https://kimi.ai/make3d/projects')).toBe(false);
    expect(api.isChatPageUrlForLlm('Kimi', 'https://www.kimi.ai/chatty')).toBe(false);
  });

  test('providers without chatPathPrefixes are not path-checked', () => {
    const { api } = load({ tabUrl: 'https://chat.z.ai/' });
    expect(api.isChatPageUrlForLlm('Z.ai', 'https://chat.z.ai/anything')).toBe(true);
  });

  test('chat tab is used as is, without navigation', async () => {
    const { api, state } = load({ tabUrl: 'https://www.kimi.ai/chat/abc' });
    const result = await api.ensureTabReadyForDispatch(7, 'Kimi', { reason: 'test' });
    expect(result.ok).toBe(true);
    expect(state.updates).toHaveLength(0);
  });

  test('make3d tab is navigated to the chat address and then used', async () => {
    const { api, state } = load({ tabUrl: 'https://www.kimi.ai/make3d', navigateLands: 'https://www.kimi.ai/chat/new-id' });
    const result = await api.ensureTabReadyForDispatch(7, 'Kimi', { reason: 'test' });
    expect(state.updates).toEqual([{ tabId: 7, url: 'https://www.kimi.ai/' }]);
    expect(result.ok).toBe(true);
  });

  test('make3d tab that stays on make3d ends with wrong_page and nothing is sent', async () => {
    const { api, state } = load({ tabUrl: 'https://www.kimi.ai/make3d', navigateLands: 'https://www.kimi.ai/make3d' });
    const result = await api.ensureTabReadyForDispatch(7, 'Kimi', { reason: 'test' });
    expect(state.updates).toHaveLength(1);
    expect(result).toEqual(expect.objectContaining({ ok: false, reason: 'wrong_page' }));
    expect(result.message).toMatch(/make3d/);
  });

  test('a navigation that fails ends with wrong_page without retrying', async () => {
    const { api, state, context } = load({ tabUrl: 'https://www.kimi.ai/make3d' });
    context.chrome.tabs.update = jest.fn((_id, _o, cb) => {
      context.chrome.runtime.lastError = { message: 'no tab' };
      cb?.();
      context.chrome.runtime.lastError = null;
    });
    const result = await api.ensureTabReadyForDispatch(7, 'Kimi', { reason: 'test' });
    expect(context.chrome.tabs.update).toHaveBeenCalledTimes(1);
    expect(result).toEqual(expect.objectContaining({ ok: false, reason: 'wrong_page' }));
    expect(state.updates).toHaveLength(0);
  });
});
