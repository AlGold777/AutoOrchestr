// background/message-delivery-store.js
// Sole writer for the delivery journal in chrome.storage.session.
// Key: 'messageDelivery.journal.v2'
// Envelope: { version: 2, events: [...], collection: { retained, totalAppended, overflowOmitted, bytesEstimate } }

(function initMessageDeliveryStore(root) {
  'use strict';

  const STORAGE_KEY = 'messageDelivery.journal.v2';
  const LEGACY_STORAGE_KEY = 'messageDelivery.journal';
  const MAX_EVENTS = 3000;
  const MAX_BYTES = 3 * 1024 * 1024; // 3 MiB UTF-8 JSON quota
  // Long-lived compressed copy in chrome.storage.local (survives Reload / browser restart).
  const LOCAL_MIRROR_KEY = 'messageDelivery.journal.v2.local';
  const MIRROR_DEBOUNCE_MS = 2000;
  const MIRROR_MAX_WAIT_MS = 10000; // copy is written at most this long after the first unsaved append

  let initialized = false;
  let initPromise = null;
  let opQueue = Promise.resolve();
  let mirrorTimer = null;
  let mirrorGen = 0; // bumped by clear() so pending mirror writes become no-ops
  let mirrorPendingSince = null; // time of the first append not yet mirrored

  const events = [];
  const eventIdSet = new Set();
  const collection = {
    retained: 0,
    totalAppended: 0,
    overflowOmitted: 0,
    bytesEstimate: 0
  };

  const getStorage = () => root.chrome?.storage?.session || globalThis.chrome?.storage?.session || null;

  function callStorage(fnName, ...args) {
    const storage = getStorage();
    if (!storage || typeof storage[fnName] !== 'function') {
      const err = new Error(`storage_unavailable: ${fnName}`);
      err.code = 'storage_unavailable';
      return Promise.reject(err);
    }
    return new Promise((resolve, reject) => {
      let settled = false;
      const done = (val) => {
        if (!settled) {
          settled = true;
          const lastErr = root.chrome?.runtime?.lastError || globalThis.chrome?.runtime?.lastError;
          if (lastErr) {
            reject(new Error(lastErr.message || String(lastErr)));
          } else {
            resolve(val);
          }
        }
      };
      const fail = (err) => {
        if (!settled) {
          settled = true;
          reject(err instanceof Error ? err : new Error(String(err)));
        }
      };
      try {
        const res = storage[fnName](...args, (cbResult) => {
          const lastErr = root.chrome?.runtime?.lastError || globalThis.chrome?.runtime?.lastError;
          if (lastErr) {
            fail(new Error(lastErr.message || String(lastErr)));
          } else {
            done(cbResult);
          }
        });
        if (res && typeof res.then === 'function') {
          res.then(done, fail);
        }
      } catch (err) {
        fail(err);
      }
    });
  }

  function estimateBytes(payload) {
    try {
      const str = JSON.stringify(payload);
      if (typeof TextEncoder !== 'undefined') {
        return new TextEncoder().encode(str).length;
      }
      return str.length;
    } catch (_) {
      return 0;
    }
  }

  function getMirror() {
    const mirror = root.CompressedStorage || globalThis.CompressedStorage;
    return mirror && typeof mirror.set === 'function' && typeof mirror.get === 'function' && typeof mirror.remove === 'function'
      ? mirror
      : null;
  }

  const hasEvents = (env) => !!(env && env.version === 2 && Array.isArray(env.events) && env.events.length > 0);

  async function readMirror() {
    const mirror = getMirror();
    if (!mirror) return null;
    try {
      return await mirror.get(LOCAL_MIRROR_KEY);
    } catch (err) {
      console.warn('[MessageDeliveryStore] local mirror read failed', err?.message || err);
      return null;
    }
  }

  // Runs inside the op queue. Errors (including local quota) are logged, never thrown.
  async function writeMirror() {
    const mirror = getMirror();
    if (!mirror) return;
    try {
      await mirror.set(LOCAL_MIRROR_KEY, { version: 2, events: events.slice(), collection: { ...collection } });
    } catch (err) {
      console.warn('[MessageDeliveryStore] local mirror write failed', err?.message || err);
    }
  }

  function scheduleMirror() {
    if (!getMirror()) return;
    const now = Date.now();
    if (mirrorPendingSince === null) mirrorPendingSince = now;
    clearTimeout(mirrorTimer);
    const gen = mirrorGen;
    // Debounce, but never later than MIRROR_MAX_WAIT_MS after the first unsaved append.
    const delay = Math.max(0, Math.min(MIRROR_DEBOUNCE_MS, mirrorPendingSince + MIRROR_MAX_WAIT_MS - now));
    mirrorTimer = setTimeout(() => {
      mirrorTimer = null;
      enqueue(async () => {
        if (gen !== mirrorGen) return;
        mirrorPendingSince = null;
        await writeMirror();
      }).catch(() => {});
    }, delay);
  }

  async function internalInit() {
    if (root.__extensionLifecycleReady && typeof root.__extensionLifecycleReady.then === 'function') {
      try {
        await root.__extensionLifecycleReady;
      } catch (_) { /* ignore */ }
    }

    try {
      const data = await callStorage('get', [STORAGE_KEY, LEGACY_STORAGE_KEY]) || {};
      let envelope = data?.[STORAGE_KEY];
      let fromMirror = false;
      if (!hasEvents(envelope)) {
        const mirrored = await readMirror();
        if (hasEvents(mirrored)) {
          envelope = mirrored;
          fromMirror = true;
        }
      }
      if (envelope && envelope.version === 2 && Array.isArray(envelope.events)) {
        events.length = 0;
        eventIdSet.clear();
        envelope.events.forEach((evt) => {
          events.push(evt);
          if (evt.eventId) eventIdSet.add(evt.eventId);
        });
        if (envelope.collection) {
          collection.totalAppended = Number(envelope.collection.totalAppended) || events.length;
          collection.overflowOmitted = Number(envelope.collection.overflowOmitted) || 0;
        } else {
          collection.totalAppended = events.length;
          collection.overflowOmitted = 0;
        }
        collection.retained = events.length;
        collection.bytesEstimate = estimateBytes({ version: 2, events, collection });
        if (fromMirror) {
          // Session was empty: put the restored journal back into session storage.
          await persist(events, collection);
        }
      } else if (Array.isArray(data?.[LEGACY_STORAGE_KEY])) {
        // One-time legacy import if present
        const legacyEvents = data[LEGACY_STORAGE_KEY];
        events.length = 0;
        eventIdSet.clear();
        legacyEvents.forEach((evt, idx) => {
          const item = { ...evt, legacy: true };
          if (!item.eventId) item.eventId = `legacy:${idx}:${Date.now()}`;
          events.push(item);
          eventIdSet.add(item.eventId);
        });
        collection.retained = events.length;
        collection.totalAppended = events.length;
        collection.overflowOmitted = 0;
        collection.bytesEstimate = estimateBytes({ version: 2, events, collection });
        await persist(events, collection);
      } else {
        events.length = 0;
        eventIdSet.clear();
        collection.retained = 0;
        collection.totalAppended = 0;
        collection.overflowOmitted = 0;
        collection.bytesEstimate = 0;
      }
    } catch (_) {
      // Keep memory store intact on storage error
    }

    initialized = true;
  }

  function init() {
    return enqueue(async () => {
      await internalInit();
    });
  }

  async function persist(candidateEvents, candidateCollection) {
    candidateCollection.retained = candidateEvents.length;
    let envelope = { version: 2, events: candidateEvents, collection: candidateCollection };
    let bytes = estimateBytes(envelope);

    // Evict oldest events if bytes exceed MAX_BYTES
    while (candidateEvents.length > 0 && bytes > MAX_BYTES) {
      const evicted = candidateEvents.shift();
      candidateCollection.overflowOmitted += 1;
      candidateCollection.retained = candidateEvents.length;
      envelope = { version: 2, events: candidateEvents, collection: candidateCollection };
      bytes = estimateBytes(envelope);
    }

    candidateCollection.bytesEstimate = bytes;
    envelope.collection = { ...candidateCollection };

    await callStorage('set', { [STORAGE_KEY]: envelope });
    return { envelope, bytes };
  }

  function enqueue(task) {
    const next = opQueue.then(async () => {
      if (!initialized) {
        await internalInit();
      }
      return task();
    });
    opQueue = next.catch(() => {});
    return next;
  }

  async function append(newEvents = []) {
    return enqueue(async () => {
      const list = Array.isArray(newEvents) ? newEvents : [newEvents];
      const candidateEvents = events.slice();
      const candidateEventIdSet = new Set(eventIdSet);
      const candidateCollection = { ...collection };
      let added = 0;

      for (let i = 0; i < list.length; i++) {
        const evt = list[i];
        if (!evt || typeof evt !== 'object') continue;

        // Idempotency: skip if already retained in store
        if (evt.eventId && candidateEventIdSet.has(evt.eventId)) {
          continue;
        }

        if (evt.eventId) {
          candidateEventIdSet.add(evt.eventId);
        }
        candidateEvents.push(evt);
        candidateCollection.totalAppended += 1;
        added += 1;

        // FIFO eviction on exceeding MAX_EVENTS
        if (candidateEvents.length > MAX_EVENTS) {
          const evicted = candidateEvents.shift();
          if (evicted?.eventId) candidateEventIdSet.delete(evicted.eventId);
          candidateCollection.overflowOmitted += 1;
        }
      }

      candidateCollection.retained = candidateEvents.length;

      try {
        await persist(candidateEvents, candidateCollection);
      } catch (err) {
        // Storage write failed: do not commit candidate mutations to in-memory state
        return {
          ok: false,
          error: String(err?.message || err),
          added: 0,
          retained: events.length,
          totalAppended: collection.totalAppended,
          overflowOmitted: collection.overflowOmitted
        };
      }

      // Storage write succeeded: commit candidate state to in-memory store
      events.length = 0;
      candidateEvents.forEach((e) => events.push(e));
      eventIdSet.clear();
      events.forEach((e) => { if (e.eventId) eventIdSet.add(e.eventId); });
      Object.assign(collection, candidateCollection);
      scheduleMirror();

      return {
        ok: true,
        added,
        retained: events.length,
        totalAppended: collection.totalAppended,
        overflowOmitted: collection.overflowOmitted
      };
    });
  }

  async function snapshot() {
    return enqueue(async () => {
      return {
        version: 2,
        events: events.map((e) => ({ ...e })),
        collection: { ...collection }
      };
    });
  }

  async function clear() {
    // Cancel a pending mirror write now, and make any already-queued one a no-op.
    mirrorGen += 1;
    clearTimeout(mirrorTimer);
    mirrorTimer = null;
    mirrorPendingSince = null;
    return enqueue(async () => {
      mirrorGen += 1;
      clearTimeout(mirrorTimer);
      mirrorTimer = null;
      mirrorPendingSince = null;
      events.length = 0;
      eventIdSet.clear();
      collection.retained = 0;
      collection.totalAppended = 0;
      collection.overflowOmitted = 0;
      collection.bytesEstimate = 0;

      try {
        const storage = getStorage();
        if (storage) {
          if (storage.remove) {
            await callStorage('remove', STORAGE_KEY);
          } else if (storage.set) {
            await callStorage('set', { [STORAGE_KEY]: { version: 2, events: [], collection } });
          }
        }
      } finally {
        // Remove the durable copy even if the session removal failed, so it cannot resurrect cleared events.
        const mirror = getMirror();
        if (mirror) {
          try {
            await mirror.remove(LOCAL_MIRROR_KEY);
          } catch (err) {
            console.warn('[MessageDeliveryStore] local mirror remove failed', err?.message || err);
          }
        }
      }

      return { ok: true };
    });
  }

  const api = Object.freeze({
    STORAGE_KEY,
    init,
    append,
    snapshot,
    clear,
    collection: () => ({ ...collection })
  });

  root.MessageDeliveryStore = api;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(typeof window !== 'undefined' ? window : globalThis);
