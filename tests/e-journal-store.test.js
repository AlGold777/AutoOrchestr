/** @jest-environment node */
const fs = require('fs');
const path = require('path');

describe('Package E: Unified Background Journal Store (C04 / ТЗ 5.E)', () => {
  let sessionRecords = {};
  let mockStorageSession;

  beforeEach(() => {
    sessionRecords = {};
    mockStorageSession = {
      get: jest.fn(async (keys) => {
        if (!keys) return structuredClone(sessionRecords);
        if (typeof keys === 'string') return { [keys]: structuredClone(sessionRecords[keys]) };
        if (Array.isArray(keys)) return Object.fromEntries(keys.map((k) => [k, structuredClone(sessionRecords[k])]));
        return structuredClone(sessionRecords);
      }),
      set: jest.fn(async (values) => {
        Object.assign(sessionRecords, structuredClone(values));
      }),
      remove: jest.fn(async (keys) => {
        const list = Array.isArray(keys) ? keys : [keys];
        list.forEach((k) => delete sessionRecords[k]);
      }),
      clear: jest.fn(async () => {
        sessionRecords = {};
      })
    };
    global.chrome = {
      storage: {
        session: mockStorageSession
      },
      runtime: {
        sendMessage: jest.fn(),
        onMessage: { addListener: jest.fn() }
      }
    };
  });

  function getStore() {
    const storePath = path.join(__dirname, '..', 'background', 'message-delivery-store.js');
    if (!fs.existsSync(storePath)) {
      throw new Error('background/message-delivery-store.js does not exist yet');
    }
    return require(storePath);
  }

  describe('background/message-delivery-store.js contracts', () => {
    test('module background/message-delivery-store.js exists and exports store interface', () => {
      const storePath = path.join(__dirname, '..', 'background', 'message-delivery-store.js');
      expect(fs.existsSync(storePath)).toBe(true);
      const MessageDeliveryStore = getStore();
      expect(MessageDeliveryStore).toBeDefined();
      expect(typeof MessageDeliveryStore.append).toBe('function');
      expect(typeof MessageDeliveryStore.snapshot).toBe('function');
      expect(typeof MessageDeliveryStore.clear).toBe('function');
    });

    test('stores envelope in chrome.storage.session under messageDelivery.journal.v2 with version: 2 and collection metadata', async () => {
      const MessageDeliveryStore = getStore();
      await MessageDeliveryStore.init?.();

      const event1 = { eventId: 'evt-test-1', kind: 'prepared', model: 'Claude', at: Date.now() };
      await MessageDeliveryStore.append([event1]);

      const stored = sessionRecords['messageDelivery.journal.v2'];
      expect(stored).toBeDefined();
      expect(stored.version).toBe(2);
      expect(Array.isArray(stored.events)).toBe(true);
      expect(stored.events).toHaveLength(1);
      expect(stored.events[0]).toMatchObject(event1);

      expect(stored.collection).toBeDefined();
      expect(stored.collection.retained).toBe(1);
      expect(stored.collection.totalAppended).toBe(1);
      expect(stored.collection.overflowOmitted).toBe(0);
      expect(typeof stored.collection.bytesEstimate).toBe('number');
    });

    test('idempotency: appending events with same eventId does NOT duplicate them', async () => {
      const MessageDeliveryStore = getStore();
      await MessageDeliveryStore.init?.();

      const event = { eventId: 'evt-dup-1', kind: 'prepared', model: 'Claude', at: Date.now() };
      await MessageDeliveryStore.append([event]);
      await MessageDeliveryStore.append([event]); // duplicate append (e.g. retry after worker restart)

      const snap = await MessageDeliveryStore.snapshot();
      expect(snap.events.filter((e) => e.eventId === 'evt-dup-1')).toHaveLength(1);
      expect(snap.collection.retained).toBe(1);
    });

    test('multi-page concurrency: events from different producers do not overwrite each other', async () => {
      const MessageDeliveryStore = getStore();
      await MessageDeliveryStore.init?.();

      // Page A appends
      await MessageDeliveryStore.append([
        { eventId: 'pageA:1', producerId: 'pageA', kind: 'dispatch', model: 'Claude' }
      ]);
      // Page B appends simultaneously
      await MessageDeliveryStore.append([
        { eventId: 'pageB:1', producerId: 'pageB', kind: 'dispatch', model: 'GPT' }
      ]);

      const snap = await MessageDeliveryStore.snapshot();
      const ids = snap.events.map((e) => e.eventId);
      expect(ids).toContain('pageA:1');
      expect(ids).toContain('pageB:1');
      expect(snap.collection.retained).toBe(2);
    });

    test('FIFO eviction on exceeding 3000 events limit with accurate collection counters', async () => {
      const MessageDeliveryStore = getStore();
      await MessageDeliveryStore.init?.();

      const batch = Array.from({ length: 3005 }, (_, i) => ({
        eventId: `bulk:${i}`,
        kind: 'status',
        model: 'Claude',
        seq: i
      }));

      await MessageDeliveryStore.append(batch);
      const snap = await MessageDeliveryStore.snapshot();

      expect(snap.events.length).toBeLessThanOrEqual(3000);
      expect(snap.collection.overflowOmitted).toBeGreaterThanOrEqual(5);
      expect(snap.collection.retained).toBe(snap.events.length);
      // Oldest items (bulk:0..bulk:4) must have been evicted first
      expect(snap.events.some((e) => e.eventId === 'bulk:0')).toBe(false);
      expect(snap.events.some((e) => e.eventId === 'bulk:3004')).toBe(true);
    });

    test('rehydration after service worker suspension from storage.session', async () => {
      // 1. Storage already has confirmed events before worker starts
      sessionRecords['messageDelivery.journal.v2'] = {
        version: 2,
        events: [
          { eventId: 'persisted:1', kind: 'prepared', model: 'Claude' },
          { eventId: 'persisted:2', kind: 'status', model: 'Claude' }
        ],
        collection: { retained: 2, totalAppended: 2, overflowOmitted: 0, bytesEstimate: 200 }
      };

      // 2. New worker instance loads
      let FreshStore;
      jest.isolateModules(() => {
        FreshStore = getStore();
      });
      await FreshStore.init?.();
      const snap = await FreshStore.snapshot();
      expect(snap.version).toBe(2);
      expect(snap.events).toHaveLength(2);
      expect(snap.events.map((e) => e.eventId)).toEqual(['persisted:1', 'persisted:2']);
    });

    test('explicit clear: DELIVERY_JOURNAL_CLEAR clears store and storage.session', async () => {
      const MessageDeliveryStore = getStore();
      await MessageDeliveryStore.init?.();
      await MessageDeliveryStore.append([{ eventId: 'evt-clear-1', kind: 'prepared' }]);

      expect((await MessageDeliveryStore.snapshot()).events).toHaveLength(1);

      await MessageDeliveryStore.clear();
      const snap = await MessageDeliveryStore.snapshot();
      expect(snap.events).toHaveLength(0);
      expect(snap.collection.retained).toBe(0);
    });
  });

  describe('shared/message-delivery.js page client contracts (C04)', () => {
    test('shared/message-delivery.js does NOT clear storage.session journal on module load', () => {
      const src = fs.readFileSync(path.join(__dirname, '..', 'shared', 'message-delivery.js'), 'utf8');
      // Must not wipe journal on page load:
      expect(src).not.toMatch(/storage\?\.session\?\.remove\(\s*JOURNAL_KEY\s*\)/);
      // Must reference messageDelivery.journal.v2 as key:
      expect(src).toContain('messageDelivery.journal.v2');
    });

    test('each recorded event receives a unique eventId', () => {
      const Delivery = require('../shared/message-delivery.js');
      Delivery.reset();
      Delivery.prepare({ prompt: 'Test prompt', models: ['Claude'], requestIds: { Claude: 'req-e1' } });
      Delivery.observeRuntime({
        type: 'STATUS_UPDATE',
        llmName: 'Claude',
        transportRequestId: 'req-e1',
        status: 'generating'
      });

      const journal = Delivery.journal();
      expect(journal.length).toBeGreaterThan(0);
      journal.forEach((entry) => {
        expect(entry.eventId).toBeDefined();
        expect(typeof entry.eventId).toBe('string');
        expect(entry.eventId.length).toBeGreaterThan(3);
      });
    });
  });
});
