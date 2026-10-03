// Behavioural tests for results/boot-utils.js — enabled by extracting the
// helpers out of the results.js monolith into an independently testable module.
require('../results/boot-utils');
const BootUtils = window.ResultsBootUtils;

describe('ResultsBootUtils.normalizeExternalLinkUrl', () => {
  test('accepts http/https and returns the resolved href', () => {
    expect(BootUtils.normalizeExternalLinkUrl('https://example.com/x')).toBe('https://example.com/x');
    expect(BootUtils.normalizeExternalLinkUrl('http://example.com/')).toBe('http://example.com/');
  });

  test('accepts mailto links', () => {
    expect(BootUtils.normalizeExternalLinkUrl('mailto:a@b.com')).toBe('mailto:a@b.com');
  });

  test('rejects javascript:, fragment, empty, and unsupported protocols', () => {
    expect(BootUtils.normalizeExternalLinkUrl('javascript:alert(1)')).toBe('');
    expect(BootUtils.normalizeExternalLinkUrl('#section')).toBe('');
    expect(BootUtils.normalizeExternalLinkUrl('')).toBe('');
    expect(BootUtils.normalizeExternalLinkUrl('ftp://host/file')).toBe('');
  });
});

describe('ResultsBootUtils.decorateLinksForNewTab', () => {
  test('hardens external anchors and skips non-external ones', () => {
    const container = document.createElement('div');
    container.innerHTML = '<a id="ext" href="https://example.com/a">ext</a><a id="frag" href="#x">frag</a>';
    document.body.appendChild(container);

    BootUtils.decorateLinksForNewTab(container);

    const ext = container.querySelector('#ext');
    expect(ext.target).toBe('_blank');
    expect(ext.rel).toBe('noopener noreferrer');
    expect(ext.getAttribute('contenteditable')).toBe('false');
    expect(ext.classList.contains('response-external-link')).toBe(true);

    const frag = container.querySelector('#frag');
    expect(frag.target).toBe('');
    expect(frag.classList.contains('response-external-link')).toBe(false);

    container.remove();
  });

  test('is a no-op for non-container input', () => {
    expect(() => BootUtils.decorateLinksForNewTab(null)).not.toThrow();
    expect(() => BootUtils.decorateLinksForNewTab({})).not.toThrow();
  });
});

describe('ResultsBootUtils.isPageReloadNavigation', () => {
  test('returns a boolean without throwing', () => {
    expect(typeof BootUtils.isPageReloadNavigation()).toBe('boolean');
  });
});

describe('ResultsBootUtils.clearDebateTranscriptOnReload', () => {
  test('resolves false when navigation is not a reload', async () => {
    // jsdom navigation type is not "reload", so this short-circuits to false.
    await expect(BootUtils.clearDebateTranscriptOnReload()).resolves.toBe(false);
  });
});

describe('ResultsBootUtils.resetSessionOnReload', () => {
  test('ordinary navigation keeps the current session', async () => {
    await expect(BootUtils.resetSessionOnReload()).resolves.toBe(false);
  });

  test('reload waits for an explicit background reset acknowledgment', async () => {
    const navigation = Object.getOwnPropertyDescriptor(performance, 'getEntriesByType');
    Object.defineProperty(performance, 'getEntriesByType', { configurable: true, value: () => [{ type: 'reload' }] });
    const previousChrome = window.chrome;
    let respond;
    window.chrome = { runtime: { sendMessage: jest.fn((_, callback) => { respond = callback; }) } };
    try {
      const reset = BootUtils.resetSessionOnReload();
      expect(window.chrome.runtime.sendMessage).toHaveBeenCalledWith({ type: 'REGISTER_RESULTS_TAB', resetSession: true }, expect.any(Function));
      respond({ sessionReset: true });
      await expect(reset).resolves.toBe(true);
      const failed = BootUtils.resetSessionOnReload();
      respond({ error: 'storage_failed' });
      await expect(failed).rejects.toThrow('storage_failed');
    } finally {
      window.chrome = previousChrome;
      if (navigation) Object.defineProperty(performance, 'getEntriesByType', navigation);
      else delete performance.getEntriesByType;
    }
  });

  test.each([
    [{ llms: {} }, null],
    [{ llms: { GPT: { answer: 'old' } } }, 'previous_session_still_active'],
    [undefined, 'previous_session_still_active']
  ])('older background reset is verified against its snapshot %j', async (state, error) => {
    const navigation = Object.getOwnPropertyDescriptor(performance, 'getEntriesByType');
    Object.defineProperty(performance, 'getEntriesByType', { configurable: true, value: () => [{ type: 'reload' }] });
    const previousChrome = window.chrome;
    let registrations = 0;
    window.chrome = {
      runtime: { sendMessage: jest.fn((message, callback) => {
        if (message.type === 'REGISTER_RESULTS_TAB') {
          registrations += 1;
          callback({ status: 'registered', state: registrations === 1 ? { llms: { GPT: { answer: 'old' } } } : state });
        } else callback({ success: true });
      }) },
      storage: { local: { remove: jest.fn(async () => {}) }, session: { remove: jest.fn(async () => {}) } }
    };
    try {
      const reset = BootUtils.resetSessionOnReload();
      if (error) await expect(reset).rejects.toThrow(error);
      else await expect(reset).resolves.toBe(true);
      expect(window.chrome.runtime.sendMessage.mock.calls.map(([message]) => message.type))
        .toEqual(['REGISTER_RESULTS_TAB', 'STOP_ALL', 'CLEAR_DIAG_EVENTS', 'REGISTER_RESULTS_TAB']);
      expect(window.chrome.storage.session.remove).toHaveBeenCalledWith('messageDelivery.journal');
    } finally {
      window.chrome = previousChrome;
      if (navigation) Object.defineProperty(performance, 'getEntriesByType', navigation);
      else delete performance.getEntriesByType;
    }
  });

  test('a silent background produces an actionable error instead of hanging boot', async () => {
    jest.useFakeTimers();
    const navigation = Object.getOwnPropertyDescriptor(performance, 'getEntriesByType');
    Object.defineProperty(performance, 'getEntriesByType', { configurable: true, value: () => [{ type: 'reload' }] });
    const previousChrome = window.chrome;
    window.chrome = { runtime: { sendMessage: jest.fn() } };
    try {
      const check = expect(BootUtils.resetSessionOnReload()).rejects.toThrow('REGISTER_RESULTS_TAB: background_timeout');
      jest.advanceTimersByTime(10000);
      await check;
    } finally {
      window.chrome = previousChrome;
      if (navigation) Object.defineProperty(performance, 'getEntriesByType', navigation);
      else delete performance.getEntriesByType;
      jest.useRealTimers();
    }
  });
});
