/** @jest-environment node */
const path = require('path');

const STORE_PATH = path.join(__dirname, '..', 'background', 'message-delivery-store.js');
const SESSION_KEY = 'messageDelivery.journal.v2';
const LOCAL_KEY = 'messageDelivery.journal.v2.local';

describe('Delivery journal: long-lived compressed copy in chrome.storage.local', () => {
  let sessionRecords;
  let localRecords;
  let localSet;

  const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));

  beforeEach(() => {
    jest.useFakeTimers();
    sessionRecords = {};
    localRecords = {};
    localSet = jest.fn(async (values) => {
      Object.assign(localRecords, clone(values));
    });
    global.chrome = {
      storage: {
        session: {
          get: jest.fn(async (keys) => {
            const list = Array.isArray(keys) ? keys : [keys];
            return Object.fromEntries(list.map((k) => [k, clone(sessionRecords[k])]));
          }),
          set: jest.fn(async (values) => {
            Object.assign(sessionRecords, clone(values));
          }),
          remove: jest.fn(async (keys) => {
            (Array.isArray(keys) ? keys : [keys]).forEach((k) => delete sessionRecords[k]);
          })
        },
        local: {
          get: jest.fn(async (keys) => {
            const list = Array.isArray(keys) ? keys : [keys];
            const out = {};
            list.forEach((k) => { if (k in localRecords) out[k] = clone(localRecords[k]); });
            return out;
          }),
          set: localSet,
          remove: jest.fn(async (keys) => {
            (Array.isArray(keys) ? keys : [keys]).forEach((k) => delete localRecords[k]);
          })
        }
      },
      runtime: { sendMessage: jest.fn(), onMessage: { addListener: jest.fn() } }
    };
    // Real CompressedStorage wrapper (no LZString here, so values are stored as plain objects).
    globalThis.CompressedStorage = require('../utils/storage-compress.js').CompressedStorage;
  });

  afterEach(() => {
    jest.useRealTimers();
    delete globalThis.CompressedStorage;
    delete globalThis.chrome;
    jest.restoreAllMocks();
  });

  function freshStore() {
    let store;
    jest.isolateModules(() => {
      store = require(STORE_PATH);
    });
    return store;
  }

  // Let the 2 s mirror debounce fire and its queued write complete.
  async function flushMirror() {
    await jest.advanceTimersByTimeAsync(2100);
  }

  test('journal is restored from the local copy after session storage is wiped', async () => {
    const store = freshStore();
    await store.init();
    await store.append([
      { eventId: 'mir:1', kind: 'prepared', model: 'Claude' },
      { eventId: 'mir:2', kind: 'status', model: 'Claude' }
    ]);
    await flushMirror();

    expect(localRecords[LOCAL_KEY]).toBeDefined();
    expect(localRecords[LOCAL_KEY].version).toBe(2);
    expect(localRecords[LOCAL_KEY].events).toHaveLength(2);

    // Simulate Reload / browser restart: session is gone, local copy remains.
    delete sessionRecords[SESSION_KEY];
    const reloaded = freshStore();
    await reloaded.init();

    const snap = await reloaded.snapshot();
    expect(snap.events.map((e) => e.eventId)).toEqual(['mir:1', 'mir:2']);
    expect(snap.collection.retained).toBe(2);
    // Restored journal is written back to session storage.
    expect(sessionRecords[SESSION_KEY].events).toHaveLength(2);
  });

  test('clear() removes both the session key and the local copy', async () => {
    const store = freshStore();
    await store.init();
    await store.append([{ eventId: 'clr:1', kind: 'prepared' }]);
    await flushMirror();
    expect(localRecords[LOCAL_KEY]).toBeDefined();

    await store.clear();

    expect(sessionRecords[SESSION_KEY]).toBeUndefined();
    expect(localRecords[LOCAL_KEY]).toBeUndefined();

    // Nothing comes back after a reload.
    const reloaded = freshStore();
    await reloaded.init();
    expect((await reloaded.snapshot()).events).toHaveLength(0);
  });

  test('clear() cancels a pending debounced copy write', async () => {
    const store = freshStore();
    await store.init();
    await store.append([{ eventId: 'pend:1', kind: 'prepared' }]);
    await store.clear();
    await flushMirror();

    expect(localRecords[LOCAL_KEY]).toBeUndefined();
  });

  test('continuous appends still get a copy written within 10 s of the first unsaved append', async () => {
    const store = freshStore();
    await store.init();
    // One append every 500 ms: the 2 s debounce alone would never fire.
    for (let i = 0; i < 24; i++) {
      await store.append([{ eventId: `stream:${i}`, kind: 'status' }]);
      await jest.advanceTimersByTimeAsync(500);
    }
    // 12 s of activity have passed since the first append.
    expect(localRecords[LOCAL_KEY]).toBeDefined();
    expect(localRecords[LOCAL_KEY].events.length).toBeGreaterThan(0);
  });

  test('legacy journal (messageDelivery.journal array) is migrated into session storage on init', async () => {
    sessionRecords['messageDelivery.journal'] = [
      { eventId: 'legacy-a', kind: 'prepared' },
      { eventId: 'legacy-b', kind: 'status' }
    ];
    const store = freshStore();
    await store.init();

    const snap = await store.snapshot();
    expect(snap.events.map((e) => e.eventId)).toEqual(['legacy-a', 'legacy-b']);
    expect(sessionRecords[SESSION_KEY].version).toBe(2);
    expect(sessionRecords[SESSION_KEY].events).toHaveLength(2);
  });

  test('a failing local copy write (e.g. quota) does not break append and only logs a warning', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    localSet.mockImplementation(async () => {
      throw new Error('QUOTA_BYTES quota exceeded');
    });

    const store = freshStore();
    await store.init();
    const res = await store.append([{ eventId: 'quota:1', kind: 'prepared' }]);
    await flushMirror();

    expect(res.ok).toBe(true);
    expect(res.added).toBe(1);
    expect((await store.snapshot()).events.map((e) => e.eventId)).toEqual(['quota:1']);
    expect(sessionRecords[SESSION_KEY].events).toHaveLength(1);
    expect(warn).toHaveBeenCalled();
  });

  test('without CompressedStorage the journal works as before and touches no local keys', async () => {
    delete globalThis.CompressedStorage;
    const store = freshStore();
    await store.init();
    const res = await store.append([{ eventId: 'nomir:1', kind: 'prepared' }]);
    await flushMirror();

    expect(res.ok).toBe(true);
    expect(chrome.storage.local.set).not.toHaveBeenCalled();
    expect(localRecords).toEqual({});
  });
});
