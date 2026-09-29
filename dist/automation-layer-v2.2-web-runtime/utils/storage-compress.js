// Purpose: central wrapper around chrome.storage.local to compress large payloads and keep quota under control.
(function(global) {
  const COMPRESSION_THRESHOLD = 10 * 1024;
  const COMPRESSED_PREFIX = '__LZ__';
  const MIGRATION_FLAG = '__storage_migrated_v2';
  const COMPRESSION_RATIO_THRESHOLD = 0.9;
  const PRUNE_THRESHOLD_PERCENT = 80;
  const PRUNE_OLDER_THAN_MS = 7 * 24 * 60 * 60 * 1000;

  const formatBytes = (bytes = 0) => `${(bytes / 1024 / 1024).toFixed(2)}MB`;

  function decodeStoredValue(raw) {
    if (typeof raw === 'string' && raw.startsWith(COMPRESSED_PREFIX)) {
      try {
        const decompressed = global.LZString.decompressFromUTF16(raw.slice(COMPRESSED_PREFIX.length));
        return JSON.parse(decompressed);
      } catch (err) {
        console.warn('[COMPRESSION] Failed to decompress', err);
        return null;
      }
    }
    if (typeof raw === 'string') {
      try {
        return JSON.parse(raw);
      } catch (err) {
        return raw;
      }
    }
    return raw;
  }

  async function set(key, value) {
    if (!key) return;
    if (typeof value === 'undefined') {
      await chrome.storage.local.remove(key);
      return;
    }
    const payload = value === null || typeof value === 'undefined' ? value : value;
    let json = null;
    try {
      json = JSON.stringify(payload);
    } catch (err) {
      console.warn('[COMPRESSION] Failed to serialize payload, storing raw value', err);
    }
    if (typeof json === 'string' && json.length >= COMPRESSION_THRESHOLD && global.LZString?.compressToUTF16) {
      const compressed = global.LZString.compressToUTF16(json);
      if (compressed.length < json.length * COMPRESSION_RATIO_THRESHOLD) {
        await chrome.storage.local.set({ [key]: `${COMPRESSED_PREFIX}${compressed}` });
        return;
      }
    }
    await chrome.storage.local.set({ [key]: payload });
  }

  async function get(key) {
    if (!key) return null;
    const result = await chrome.storage.local.get(key);
    if (!result || !(key in result)) return null;
    return decodeStoredValue(result[key]);
  }

  async function remove(key) {
    if (!key) return;
    await chrome.storage.local.remove(key);
  }

  async function checkQuota() {
    const bytesInUse = await chrome.storage.local.getBytesInUse(null);
    const quota = chrome.storage.local.QUOTA_BYTES || 10 * 1024 * 1024;
    const percentUsed = quota ? (bytesInUse / quota) * 100 : 0;
    console.log(`[STORAGE] ${bytesInUse} bytes used of ${quota} (${percentUsed.toFixed(1)}%)`);
    return { bytesInUse, quota, percentUsed };
  }

  async function pruneIfNeeded(threshold = PRUNE_THRESHOLD_PERCENT) {
    const { percentUsed } = await checkQuota();
    if (percentUsed < threshold) return;
    console.warn(`[STORAGE] ${percentUsed.toFixed(1)}% used, pruning stale entries`);
    const keys = await chrome.storage.local.get(null);
    const toRemove = [];
    const now = Date.now();
    ['logs', 'results'].forEach((candidate) => {
      if (!(candidate in keys)) return;
      const entry = decodeStoredValue(keys[candidate]);
      if (!entry || typeof entry !== 'object') return;
      const timestamp = entry?.updatedAt || entry?.timestamp || entry?.createdAt;
      if (typeof timestamp === 'number' && now - timestamp > PRUNE_OLDER_THAN_MS) {
        toRemove.push(candidate);
      }
    });
    if (toRemove.length) {
      await chrome.storage.local.remove(toRemove);
      console.log(`[STORAGE] Pruned keys: ${toRemove.join(', ')}`);
    }
  }

  async function migrate(keys = []) {
    const migrated = await chrome.storage.local.get(MIGRATION_FLAG);
    if (migrated?.[MIGRATION_FLAG]) return;
    for (const key of keys) {
      if (!key) continue;
      const existing = await chrome.storage.local.get(key);
      if (!(key in existing)) continue;
      const raw = existing[key];
      const decoded = decodeStoredValue(raw);
      await set(key, decoded === null ? raw : decoded);
    }
    await chrome.storage.local.set({ [MIGRATION_FLAG]: Date.now() });
  }

  global.CompressedStorage = {
    set,
    get,
    remove,
    checkQuota,
    pruneIfNeeded,
    migrate
  };
})(typeof self !== 'undefined' ? self : this);
