const fs = require('fs');
const path = require('path');
const Documents = require('../disput/basic-documents');

function memoryStorage() {
  const data = new Map();
  return {
    data,
    get: async (key) => (data.has(key) ? JSON.parse(JSON.stringify(data.get(key))) : undefined),
    set: async (key, value) => { data.set(key, JSON.parse(JSON.stringify(value))); },
    remove: async (key) => { data.delete(key); }
  };
}

const at = 1000;

describe('BasicDocuments store', () => {
  test('putVersion creates a document and keeps versions 1 and 2 in ascending order', async () => {
    const store = Documents.createStore({ storage: memoryStorage(), now: () => at });
    const first = await store.putVersion({ runId: 'r1', pipeline: 'P', id: 'd1', name: 'Doc', version: 1, author: 'model', text: 'one', source: { step: 'a', participant: 'gpt', visit: 1 }, at: 1 });
    expect(first).toEqual({ key: 'r1:d1', id: 'd1', version: 1, approved: false });
    await store.putVersion({ runId: 'r1', id: 'd1', version: 2, author: 'user', text: 'two', at: 2 });
    const doc = await store.get('r1', 'd1');
    expect(doc.key).toBe('r1:d1');
    expect(doc.runId).toBe('r1');
    expect(doc.pipeline).toBe('P');
    expect(doc.name).toBe('Doc');
    expect(doc.versions.map((v) => v.n)).toEqual([1, 2]);
    expect(doc.versions[0]).toMatchObject({ n: 1, author: 'model', text: 'one', source: { step: 'a', participant: 'gpt', visit: 1 }, approved: false });
    expect(doc.versions[1]).toMatchObject({ n: 2, author: 'user', text: 'two', approved: false });
  });

  test('a repeated put of the same version with the same text changes nothing', async () => {
    const storage = memoryStorage();
    const store = Documents.createStore({ storage, now: () => at });
    const args = { runId: 'r1', id: 'd1', version: 1, author: 'model', text: 'one', at: 1 };
    await store.putVersion(args);
    const before = JSON.stringify(storage.data.get(Documents.KEY));
    await store.putVersion(args);
    expect(JSON.stringify(storage.data.get(Documents.KEY))).toBe(before);
    expect((await store.get('r1', 'd1')).versions).toHaveLength(1);
  });

  test('the same version number with another text is refused', async () => {
    const store = Documents.createStore({ storage: memoryStorage(), now: () => at });
    await store.putVersion({ runId: 'r1', id: 'd1', version: 1, author: 'model', text: 'one', at: 1 });
    await expect(store.putVersion({ runId: 'r1', id: 'd1', version: 1, author: 'model', text: 'other', at: 1 }))
      .rejects.toThrow('document_version_conflict');
    expect(await store.getVersion('r1', 'd1', 1)).toBe('one');
  });

  test('approve marks the version and sets approvedAt', async () => {
    const store = Documents.createStore({ storage: memoryStorage(), now: () => at });
    await store.putVersion({ runId: 'r1', id: 'd1', version: 1, author: 'model', text: 'one', at: 1 });
    await store.putVersion({ runId: 'r1', id: 'd1', version: 2, author: 'user', text: 'two', at: 2 });
    const result = await store.approve({ runId: 'r1', id: 'd1', version: 1 });
    expect(result).toEqual({ key: 'r1:d1', id: 'd1', version: 1, approved: true });
    const doc = await store.get('r1', 'd1');
    expect(doc.versions[0].approved).toBe(true);
    expect(typeof doc.versions[0].approvedAt).toBe('number');
    expect(doc.versions[1].approved).toBe(false);
  });

  test('approve of a missing version is refused', async () => {
    const store = Documents.createStore({ storage: memoryStorage(), now: () => at });
    await store.putVersion({ runId: 'r1', id: 'd1', version: 1, author: 'model', text: 'one', at: 1 });
    await expect(store.approve({ runId: 'r1', id: 'd1', version: 5 })).rejects.toThrow('document_version_missing');
    await expect(store.approve({ runId: 'r1', id: 'nope', version: 1 })).rejects.toThrow('document_version_missing');
  });

  test('getVersion, get and list read the documents', async () => {
    const store = Documents.createStore({ storage: memoryStorage(), now: () => at });
    await store.putVersion({ runId: 'r1', pipeline: 'P', id: 'old', name: 'Old', version: 1, author: 'model', text: 'a', at: 10 });
    await store.putVersion({ runId: 'r1', pipeline: 'P', id: 'old', name: 'Old', version: 2, author: 'user', text: 'b', at: 20 });
    await store.approve({ runId: 'r1', id: 'old', version: 1 });
    await store.putVersion({ runId: 'r2', pipeline: 'Q', id: 'new', name: 'New', version: 1, author: 'model', text: 'c', at: 30 });

    expect(await store.getVersion('r1', 'old', 2)).toBe('b');
    expect(await store.getVersion('r1', 'old', 9)).toBeNull();
    expect(await store.get('r1', 'missing')).toBeNull();

    const copy = await store.get('r1', 'old');
    copy.versions[0].text = 'changed';
    expect(await store.getVersion('r1', 'old', 1)).toBe('a');

    const list = await store.list();
    expect(list.map((item) => item.key)).toEqual(['r2:new', 'r1:old']);
    expect(list[0]).toMatchObject({ key: 'r2:new', runId: 'r2', pipeline: 'Q', id: 'new', name: 'New', versions: 1, latest: 1, approved: null, at: 30 });
    expect(list[1]).toMatchObject({ key: 'r1:old', versions: 2, latest: 2, approved: 1, at: 20 });
  });

  test('remove deletes one document only', async () => {
    const store = Documents.createStore({ storage: memoryStorage(), now: () => at });
    await store.putVersion({ runId: 'r1', id: 'd1', version: 1, author: 'model', text: 'one', at: 1 });
    await store.putVersion({ runId: 'r1', id: 'd2', version: 1, author: 'model', text: 'two', at: 1 });
    await store.remove('r1', 'd1');
    expect(await store.get('r1', 'd1')).toBeNull();
    expect(await store.get('r1', 'd2')).not.toBeNull();
  });

  test('usage reports the count and the size of the documents', async () => {
    const store = Documents.createStore({ storage: memoryStorage(), now: () => at });
    expect(await store.usage()).toMatchObject({ documents: 0 });
    await store.putVersion({ runId: 'r1', id: 'd1', version: 1, author: 'model', text: 'one', at: 1 });
    const usage = await store.usage();
    expect(usage.documents).toBe(1);
    expect(usage.bytes).toBeGreaterThan(0);
  });

  test('nothing is evicted: 50 documents of 100 KB all stay', async () => {
    const storage = memoryStorage();
    const store = Documents.createStore({ storage, now: () => at });
    const text = 'x'.repeat(100 * 1024);
    for (let index = 0; index < 50; index += 1) {
      await store.putVersion({ runId: `run-${index}`, id: 'd', version: 1, author: 'model', text, at: index });
    }
    const list = await store.list();
    expect(list).toHaveLength(50);
    expect(await store.getVersion('run-0', 'd', 1)).toBe(text);
    expect(await store.getVersion('run-49', 'd', 1)).toBe(text);
  });

  test('a quota refusal rejects the call, keeps the old documents and the next write goes through after recovery', async () => {
    const storage = memoryStorage();
    const store = Documents.createStore({ storage, now: () => at });
    await store.putVersion({ runId: 'r1', id: 'd1', version: 1, author: 'model', text: 'one', at: 1 });
    const realSet = storage.set;
    storage.set = async () => { throw new Error('QUOTA_BYTES quota exceeded'); };
    await expect(store.putVersion({ runId: 'r1', id: 'd2', version: 1, author: 'model', text: 'two', at: 2 })).rejects.toThrow(/quota/i);
    expect(await store.getVersion('r1', 'd1', 1)).toBe('one');
    expect(await store.get('r1', 'd2')).toBeNull();
    storage.set = realSet;
    await store.putVersion({ runId: 'r1', id: 'd3', version: 1, author: 'model', text: 'three', at: 3 });
    expect(await store.getVersion('r1', 'd3', 1)).toBe('three');
    expect(await store.getVersion('r1', 'd1', 1)).toBe('one');
  });

  test('parallel puts do not lose each other', async () => {
    const store = Documents.createStore({ storage: memoryStorage(), now: () => at });
    await Promise.all(Array.from({ length: 10 }, (_, index) => store.putVersion({ runId: 'r1', id: `d${index}`, version: 1, author: 'model', text: `t${index}`, at: index })));
    const list = await store.list();
    expect(list).toHaveLength(10);
  });

  test('a failed write does not break the queue of the next writes', async () => {
    const storage = memoryStorage();
    const store = Documents.createStore({ storage, now: () => at });
    const realSet = storage.set;
    storage.set = async () => { throw new Error('boom'); };
    const failed = store.putVersion({ runId: 'r1', id: 'd1', version: 1, author: 'model', text: 'one', at: 1 });
    await expect(failed).rejects.toThrow('boom');
    storage.set = realSet;
    await expect(store.putVersion({ runId: 'r1', id: 'd2', version: 1, author: 'model', text: 'two', at: 2 })).resolves.toMatchObject({ id: 'd2' });
    expect(await store.get('r1', 'd1')).toBeNull();
  });

  test('without storage the store is refused', () => {
    expect(() => Documents.createStore({})).toThrow('basic_documents_storage_required');
  });

  test('chromeStorage rejects when chrome.runtime.lastError is set', async () => {
    const area = {
      get: (key, cb) => cb({}),
      set: (value, cb) => cb(),
      remove: (key, cb) => cb()
    };
    const realChrome = global.chrome;
    global.chrome = { runtime: { lastError: { message: 'Quota exceeded' } } };
    try {
      const adapter = Documents.chromeStorage(area);
      await expect(adapter.set('k', 1)).rejects.toThrow('Quota exceeded');
      await expect(adapter.get('k')).rejects.toThrow('Quota exceeded');
      await expect(adapter.remove('k')).rejects.toThrow('Quota exceeded');
    } finally {
      global.chrome = realChrome;
    }
  });

  test('chromeStorage resolves values without error', async () => {
    const data = {};
    const area = {
      get: (key, cb) => cb({ [key]: data[key] }),
      set: (value, cb) => { Object.assign(data, value); cb(); },
      remove: (key, cb) => { delete data[key]; cb(); }
    };
    const realChrome = global.chrome;
    global.chrome = { runtime: {} };
    try {
      const adapter = Documents.chromeStorage(area);
      await adapter.set('k', { a: 1 });
      expect(await adapter.get('k')).toEqual({ a: 1 });
      await adapter.remove('k');
      expect(await adapter.get('k')).toBeUndefined();
    } finally {
      global.chrome = realChrome;
    }
  });

  test('the documents key is not mentioned in the background, so an update of the extension does not erase them', () => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'background', 'index.js'), 'utf8');
    expect(source).not.toContain('llmComparatorDocuments');
  });

  test('the manifest asks for unlimitedStorage and keeps storage', () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'manifest.json'), 'utf8'));
    expect(manifest.permissions).toEqual(expect.arrayContaining(['storage', 'unlimitedStorage']));
  });

  test('the public api is exposed', () => {
    expect(Documents.KEY).toBe('llmComparatorDocuments');
    expect(typeof Documents.createStore).toBe('function');
    expect(typeof Documents.chromeStorage).toBe('function');
    expect(Object.isFrozen(Documents)).toBe(true);
  });
});
