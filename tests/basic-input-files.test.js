const Schema = require('../disput/basic-schema');
const Files = require('../disput/basic-input-files');

const file = (id, name, extra = {}) => ({ id, name, ...extra });
const round = (ref, models, extra = {}) => ({ ref, kind: 'round', models, ...extra });
const schema = (schemaVersion = 1, steps = []) => ({ schemaVersion, origin: 'user', steps });

const makeStore = (entries = {}) => ({ get: async ({ id }) => entries[id] || null });

function indexedDBMock() {
  const values = new Map();
  const db = {
    objectStoreNames: { contains: () => false },
    createObjectStore() {},
    transaction() {
      const tx = {};
      tx.objectStore = () => ({
        put(record, key) { values.set(JSON.stringify(key), record); },
        get(id) {
          const request = {};
          setTimeout(() => { request.result = values.get(JSON.stringify(id)); request.onsuccess?.(); }, 0);
          return request;
        },
        delete(id) { values.delete(JSON.stringify(id)); }
      });
      setTimeout(() => tx.oncomplete?.(), 0);
      return tx;
    }
  };
  return { open: () => {
    const request = {};
    setTimeout(() => { request.result = db; request.onupgradeneeded?.({ oldVersion: 0 }); request.onsuccess?.(); }, 0);
    return request;
  } };
}

 describe('Basic user input files', () => {
  test.each(Schema.SUPPORTED_VERSIONS)('schema format %i validates files and preserves them through assemble and settings', (schemaVersion) => {
    const shared = [file('shared', 'brief.txt', { type: 'text/plain', size: 3, content: 'abc' })];
    const personal = [file('private', 'notes.txt', { content: 'xyz' })];
    const source = schema(schemaVersion, [round('r1', [{ name: 'A', ...(schemaVersion === 2 ? { id: 'a' } : {}), files: personal }], { files: shared })]);
    expect(Schema.validate(source)).toEqual([]);
    expect(Schema.assemble(source)[0]).toMatchObject({ files: shared, models: [{ files: personal }] });
    const settings = Schema.toSettings(source);
    expect(settings.customRoundSettings.r1.files).toEqual(shared);
    expect(settings.customModelSettings.r1[schemaVersion === 2 ? 'a' : 'A'].files).toEqual(personal);
  });

  test('validates descriptor shape and duplicate IDs within each list', () => {
    const invalid = schema(1, [round('r1', [{ name: 'A', files: [file('dup', 'a'), file('dup', 'b')] }], { files: [{ id: '', name: ' ' }, { id: 'x', name: 'ok', size: -1, content: 3 }] })]);
    expect(Schema.validate(invalid).map(({ path }) => path)).toEqual([
      'steps[0].files[0].id', 'steps[0].files[0].name', 'steps[0].files[1].size', 'steps[0].files[1].content', 'steps[0].models[0].files[1].id'
    ]);
  });

  test('participant files are scoped with shared step files; identical IDs dedupe and conflicts fail', () => {
    const shared = file('s', 'shared.txt');
    const own = file('p', 'own.txt');
    const step = round('r1', [{ name: 'A', id: 'a', files: [own, shared] }, { name: 'B', id: 'b', files: [file('b', 'b.txt')] }], { files: [shared] });
    expect(Files.filesFor(step, 'a')).toEqual([shared, own]);
    expect(Files.filesFor(step, 'b').map(({ id }) => id)).toEqual(['s', 'b']);
    expect(Files.filesFor({ kind: 'owner', files: [shared] }, 'owner')).toEqual([shared]);
    expect(() => Files.filesFor({ files: [shared], models: [{ id: 'a', name: 'A', files: [file('s', 'changed.txt')] }] }, 'a')).toThrow(/конфликтующие/);
  });

  test('shared file metadata from one participant binding enriches partial descriptors for every step consumer', async () => {
    const partial = file('shared', 'brief.txt');
    const bound = file('shared', 'brief.txt', { type: 'text/plain', size: 3 });
    const steps = [
      round('r1', [{ id: 'a', name: 'A', files: [partial] }], { files: [partial] }),
      round('r2', [{ id: 'b', name: 'B', files: [bound] }], { files: [partial] }),
      round('r3', [{ id: 'c', name: 'C' }], { files: [partial] })
    ];
    const stored = Object.assign(new Blob(['abc'], { type: 'text/plain' }), { name: 'brief.txt' });
    const store = { get: jest.fn(async () => stored) };

    const all = Files.collect(steps);
    expect(all).toEqual([bound]);
    expect(steps.map((step, index) => Files.filesFor(step, ['a', 'b', 'c'][index])[0].id)).toEqual(['shared', 'shared', 'shared']);
    const resolved = await Files.resolve(steps, { store });
    expect(store.get).toHaveBeenCalledWith(bound);
    expect(resolved.shared).toMatchObject({ name: 'brief.txt', type: 'text/plain', size: 3 });
  });

  test('resolves by persistent ID, including distinct files with the same name', async () => {
    const one = file('one', 'same.txt', { type: 'text/plain', size: 3 });
    const two = file('two', 'same.txt', { type: 'text/plain', size: 3 });
    const steps = [round('r1', [{ name: 'A', id: 'a', files: [one, two] }])];
    const store = makeStore({
      one: new Blob(['one'], { type: 'text/plain' }),
      two: new Blob(['two'], { type: 'text/plain' })
    });
    // Blob has no name, so mimic the File metadata supplied by IndexedDB.
    store.get = async ({ id }) => Object.assign(new Blob([id], { type: 'text/plain' }), { name: 'same.txt' });
    const resolved = await Files.resolve(steps, { store });
    expect(Buffer.from(resolved.one.base64, 'base64').toString()).toBe('one');
    expect(Buffer.from(resolved.two.base64, 'base64').toString()).toBe('two');
  });

  test('UTF-8 inline content encodes exactly and missing file errors name and ID', async () => {
    const inline = file('utf8', 'текст.txt', { content: 'Привет 🧪' });
    const result = await Files.payload(inline);
    expect(Buffer.from(result.base64, 'base64').toString('utf8')).toBe('Привет 🧪');
    await expect(Files.payload(file('missing', 'gone.pdf'))).rejects.toThrow(/gone\.pdf.*ID missing/);
  });

  test('available payload fallback matches exact filename and rejects ambiguity', async () => {
    const available = [{ name: 'a.txt', type: 'text/plain', size: 1, base64: 'YQ==' }];
    await expect(Files.payload(file('id', 'a.txt', { type: 'text/plain', size: 1 }), { available })).resolves.toMatchObject({ base64: 'YQ==' });
    await expect(Files.payload(file('id', 'a.txt'), { available: [...available, ...available] })).rejects.toThrow(/не найдено/i);
    await expect(Files.payload(file('id', 'A.txt'), { available })).rejects.toThrow(/не найдено/i);
  });

  test('enforces per-file and batch byte limits', () => {
    expect(() => Files.validateBatch([{ name: 'large', size: Files.MAX_FILE_BYTES + 1 }])).toThrow(/30 МиБ/);
    expect(() => Files.validateBatch(Array.from({ length: 6 }, (_, i) => ({ name: String(i), size: Files.MAX_FILE_BYTES })))).toThrow(/30 МиБ/);
    expect(Files.validateBatch([{ name: 'a', size: 30 * 1024 * 1024 }])).toBe(30 * 1024 * 1024);
    expect(Files.validateBatch([{ name: 'a', size: 0 }])).toBe(0);
  });

  test('store persists and retrieves files by ID, including an explicitly bound imported ID', async () => {
    const store = Files.createStore({ indexedDB: indexedDBMock() });
    const source = new File(['payload'], 'source.txt', { type: 'text/plain' });
    const desc = await store.put(source, { id: 'imported-id' });
    expect(desc).toEqual({ id: 'imported-id', name: 'source.txt', type: 'text/plain', size: 7 });
    const stored = await store.get(desc);
    expect(stored.name).toBe('source.txt');
    expect(Buffer.from((await Files.payload(desc, { store })).base64, 'base64').toString()).toBe('payload');
    await store.remove(desc.id);
    await expect(Files.payload(desc, { store })).rejects.toThrow(/ID imported-id/);
  });

  test('run snapshots are durable copies under a run-specific key', async () => {
    const store = Files.createStore({ indexedDB: indexedDBMock() });
    const payloads = { f1: { name: 'a.txt', type: 'text/plain', size: 1, base64: 'YQ==' } };
    await store.putRun('run-1', payloads);
    payloads.f1.base64 = 'Yg==';
    expect(await store.getRun('run-1')).toEqual({ f1: { name: 'a.txt', type: 'text/plain', size: 1, base64: 'YQ==' } });
    expect(await store.getRun('run-2')).toBeNull();
    await expect(store.putRun('', {})).rejects.toThrow(/ID запуска/);
  });

  test('collects enabled model files, shared files, and dedupes descriptors globally', () => {
    const same = file('same', 'x.txt');
    const steps = [round('r1', [{ name: 'A', files: [same] }, { name: 'B', enabled: false, files: [file('off', 'off')] }], { files: [same] })];
    expect(Files.collect(steps)).toEqual([same]);
    expect(() => Files.collect([round('r1', [{ name: 'A', files: [same] }], { files: [file('same', 'different')] })])).toThrow(/конфликтующие/);
  });
});
