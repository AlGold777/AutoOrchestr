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
