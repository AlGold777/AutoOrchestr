// Retention of the content of the response viewer window (key `llmResponseViewer.<timestamp>-<random>`).
// The content is a copy of rendered cards (hundreds of KB each) that is read by one window: it lives in the session
// storage only (the local storage is the fallback when the session write fails), and only the newest few are kept.
// Before this, every opened window left a copy in chrome.storage.local for good and filled the 10 MB of the extension.
(function initResponseViewerRetention(root) {
  'use strict';
  const PREFIX = 'llmResponseViewer.';
  const KEEP = 10;
  const stampOf = (key) => {
    const match = /^llmResponseViewer\.(\d+)-/.exec(String(key));
    return match ? Number(match[1]) : 0;
  };
  // The keys of the viewer content to remove: all but the `keep` newest. A key with no timestamp counts as the oldest.
  function keysToRemove(keys = [], keep = KEEP) {
    return (Array.isArray(keys) ? keys : [])
      .filter((key) => String(key).startsWith(PREFIX))
      .sort((a, b) => stampOf(b) - stampOf(a))
      .slice(Math.max(0, keep));
  }
  const api = Object.freeze({ PREFIX, KEEP, stampOf, keysToRemove });
  root.ResponseViewerRetention = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof self !== 'undefined' ? self : globalThis);
