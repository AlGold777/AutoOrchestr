(function initOrchestratorPersistence(root) {
  'use strict';
  const VERSION = 2;
  const PREFIX = 'disputOrchestratorV2';
  const memory = new Map();
  const clone = (value) => value == null ? value : JSON.parse(JSON.stringify(value));

  function createBackend(options = {}) {
    const supplied = options.storage;
    if (supplied?.getItem && supplied?.setItem) return supplied;
    try {
      const candidate = root.localStorage;
      const probe = `${PREFIX}:probe`;
      candidate?.setItem(probe, '1');
      candidate?.removeItem(probe);
      if (candidate) return candidate;
    } catch (_) {}
    return {
      getItem(key) { return memory.has(key) ? memory.get(key) : null; },
      setItem(key, value) { memory.set(key, String(value)); },
      removeItem(key) { memory.delete(key); }
    };
  }

  function createPersistence(options = {}) {
    const runId = String(options.runId || 'default');
    const baseKey = `${PREFIX}:${runId}`;
    const backend = createBackend(options);
    const durable = Boolean(options.storage?.getItem && options.storage?.setItem)
      || (() => { try { return backend === root.localStorage; } catch (_) { return false; } })();
    const channel = typeof root.BroadcastChannel === 'function'
      ? new root.BroadcastChannel(`${baseKey}:lease`)
      : null;
    let releaseExclusiveLock = null;
    const key = (part) => `${baseKey}:${part}`;
    const read = (part, fallback) => {
      try {
        const raw = backend.getItem(key(part));
        return raw == null ? clone(fallback) : JSON.parse(raw);
      } catch (_) { return clone(fallback); }
    };
    const write = (part, value) => {
      backend.setItem(key(part), JSON.stringify(value));
      return true;
    };
    const publishLeaseChange = (change) => {
      try { channel?.postMessage(clone(change)); } catch (_) {}
    };
    return Object.freeze({
      version: VERSION,
      durable,
      appendEvent(event) {
        const events = read('events', []);
        if (!events.some((item) => item.eventId === event.eventId)) {
          events.push(clone(event));
          events.sort((a, b) => Number(a.eventSequence) - Number(b.eventSequence));
          write('events', events);
        }
      },
      loadEvents(afterSequence = 0) {
        return read('events', []).filter((event) => Number(event.eventSequence) > Number(afterSequence)).map(clone);
      },
      saveSnapshot(snapshot) {
        const snapshots = read('snapshots', []);
        const next = snapshots.filter((item) => Number(item.eventSequence) !== Number(snapshot.eventSequence));
        next.push(clone(snapshot));
        write('snapshots', next.slice(-20));
      },
      loadLatestSnapshot() {
        const snapshots = read('snapshots', []);
        return clone(snapshots.at(-1) || null);
      },
      loadRecoveryCheckpoint() {
        const events = read('events', []);
        const checkpoint = events.slice().reverse().find((event) =>
          event.type === 'RUN_STATE_CHECKPOINTED' && event.payload?.snapshot);
        return clone(checkpoint?.payload?.snapshot || null);
      },
      readLastPublishedSequence() {
        return Math.max(0, Number(read('published', 0) || 0));
      },
      markPublished(sequence) {
        const next = Math.max(this.readLastPublishedSequence(), Number(sequence || 0));
        write('published', next);
        return next;
      },
      readLease() { return clone(read('lease', null)); },
      writeLease(value) {
        write('lease', clone(value));
        const stored = read('lease', null);
        return JSON.stringify(stored) === JSON.stringify(value);
      },
      compareAndSetLease(expectedRevision, value) {
        const current = read('lease', null);
        const currentRevision = Number(current?.leaseRevision || current?.version || 0);
        if (currentRevision !== Number(expectedRevision || 0)) return false;
        write('lease', clone(value));
        const stored = read('lease', null);
        return JSON.stringify(stored) === JSON.stringify(value);
      },
      async acquireExclusiveLease() {
        if (!root.navigator?.locks?.request) return true;
        let settle;
        const acquired = new Promise((resolve) => { settle = resolve; });
        root.navigator.locks.request(`${baseKey}:exclusive`, { ifAvailable: true }, (lock) => {
          if (!lock) { settle(false); return undefined; }
          settle(true);
          return new Promise((resolve) => { releaseExclusiveLock = resolve; });
        }).catch(() => settle(false));
        return acquired;
      },
      releaseExclusiveLease() {
        const release = releaseExclusiveLock;
        releaseExclusiveLock = null;
        release?.();
      },
      publishLeaseChange,
      subscribeLeaseChange(listener) {
        if (!channel) return () => {};
        const handler = (event) => listener(clone(event.data));
        channel.addEventListener('message', handler);
        return () => channel.removeEventListener('message', handler);
      },
      clear() {
        ['events', 'snapshots', 'lease', 'published'].forEach((part) => backend.removeItem(key(part)));
        this.releaseExclusiveLease?.();
        channel?.close?.();
      }
    });
  }

  const api = Object.freeze({ VERSION, PREFIX, createPersistence });
  root.DebateOrchestratorPersistence = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
