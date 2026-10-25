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

  let initialized = false;
  let initPromise = null;
  let opQueue = Promise.resolve();

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
    if (!storage || typeof storage[fnName] !== 'function') return Promise.resolve(null);
    return new Promise((resolve) => {
      let settled = false;
      const done = (val) => {
        if (!settled) {
          settled = true;
          resolve(val);
        }
      };
      try {
        const res = storage[fnName](...args, (cbResult) => {
          done(cbResult);
        });
        if (res && typeof res.then === 'function') {
          res.then(done, () => done(null));
        }
      } catch (err) {
        done(null);
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

  async function internalInit() {
    if (root.__extensionLifecycleReady && typeof root.__extensionLifecycleReady.then === 'function') {
      try {
        await root.__extensionLifecycleReady;
      } catch (_) { /* ignore */ }
    }

    try {
      const data = await callStorage('get', [STORAGE_KEY, LEGACY_STORAGE_KEY]) || {};
      const envelope = data?.[STORAGE_KEY];
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
        await persist();
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

  async function persist() {
    collection.retained = events.length;
    let envelope = { version: 2, events, collection };
    let bytes = estimateBytes(envelope);

    // Evict oldest events if bytes exceed MAX_BYTES
    while (events.length > 0 && bytes > MAX_BYTES) {
      const evicted = events.shift();
      if (evicted?.eventId) eventIdSet.delete(evicted.eventId);
      collection.overflowOmitted += 1;
      collection.retained = events.length;
      envelope = { version: 2, events, collection };
      bytes = estimateBytes(envelope);
    }

    collection.bytesEstimate = bytes;
    envelope.collection = { ...collection };

    await callStorage('set', { [STORAGE_KEY]: envelope });
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
      let added = 0;

      for (let i = 0; i < list.length; i++) {
        const evt = list[i];
        if (!evt || typeof evt !== 'object') continue;

        // Idempotency: skip if already retained in store
        if (evt.eventId && eventIdSet.has(evt.eventId)) {
          continue;
        }

        if (evt.eventId) {
          eventIdSet.add(evt.eventId);
        }
        events.push(evt);
        collection.totalAppended += 1;
        added += 1;

        // FIFO eviction on exceeding MAX_EVENTS
        if (events.length > MAX_EVENTS) {
          const evicted = events.shift();
          if (evicted?.eventId) eventIdSet.delete(evicted.eventId);
          collection.overflowOmitted += 1;
        }
      }

      await persist();
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
    return enqueue(async () => {
      events.length = 0;
      eventIdSet.clear();
      collection.retained = 0;
      collection.totalAppended = 0;
      collection.overflowOmitted = 0;
      collection.bytesEstimate = 0;

      const storage = getStorage();
      if (storage) {
        if (storage.remove) {
          await callStorage('remove', STORAGE_KEY);
        } else if (storage.set) {
          await callStorage('set', { [STORAGE_KEY]: { version: 2, events: [], collection } });
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
