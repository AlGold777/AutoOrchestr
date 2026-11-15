// Storage report for the panel: how much room every chrome.storage.local key takes, and removal of disposable keys only.
// It talks through DOM events, so a script that cannot reach chrome.storage (an injected one) can still ask:
//   document.dispatchEvent(new CustomEvent('ao-storage-report'))            → document.documentElement.dataset.aoStorage (JSON)
//   document.dispatchEvent(new CustomEvent('ao-storage-remove', { detail: { keys: [...] } })) → dataset.aoStorageRemoved (JSON)
(function initStorageReport(root) {
  'use strict';
  const DISPOSABLE = [/^__diagnostics_events__$/, /^selector_cache/i, /^selectors_remote_/i, /^__storage_migrated/i, /^diagnostics_/i];

  const sizeOf = (value) => {
    try { return JSON.stringify(value).length; } catch (_) { return 0; }
  };

  const report = async () => {
    const all = await chrome.storage.local.get(null);
    const rows = Object.keys(all).map((key) => [key, sizeOf(all[key])]).sort((a, b) => b[1] - a[1]);
    let total = null;
    try { total = await chrome.storage.local.getBytesInUse(null); } catch (_) { /* optional */ }
    return { at: Date.now(), total, quota: chrome.storage.local.QUOTA_BYTES || 10485760, keys: rows.length, top: rows.slice(0, 25) };
  };

  const remove = async (keys) => {
    const allowed = (Array.isArray(keys) ? keys : []).filter((key) => typeof key === 'string' && DISPOSABLE.some((pattern) => pattern.test(key)));
    if (allowed.length) await chrome.storage.local.remove(allowed);
    return { at: Date.now(), removed: allowed, refused: (Array.isArray(keys) ? keys : []).filter((key) => !allowed.includes(key)) };
  };

  const out = (name, value) => { root.document.documentElement.dataset[name] = JSON.stringify(value); };

  if (root.document && root.chrome?.storage?.local) {
    root.document.addEventListener('ao-storage-report', () => { report().then((r) => out('aoStorage', r)).catch((e) => out('aoStorage', { error: String(e?.message || e) })); });
    root.document.addEventListener('ao-storage-remove', (event) => { remove(event?.detail?.keys).then((r) => out('aoStorageRemoved', r)).catch((e) => out('aoStorageRemoved', { error: String(e?.message || e) })); });
  }
  const api = Object.freeze({ report, remove, DISPOSABLE });
  root.StorageReport = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
