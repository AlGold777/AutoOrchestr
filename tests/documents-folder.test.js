const DocumentsFolder = require('../results/documents-folder');

const pad = (n) => String(n).padStart(2, '0');
const expectedStamp = (ms) => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`;
};

// Фейки папки и файла, как у File System Access API.
class FakeFile {
  constructor(name, opts = {}) {
    this.name = name;
    this.kind = 'file';
    this.text = '';
    this.opts = opts;
  }

  async getFile() {
    const file = this;
    return { text: async () => file.text };
  }

  async createWritable() {
    if (this.opts.failWrites) throw new Error('disk full');
    const file = this;
    return {
      write(t) { file.text = t; },
      close() {}
    };
  }
}

class FakeDir {
  constructor(name, opts = {}) {
    this.name = name;
    this.kind = 'directory';
    this.children = new Map();
    this.opts = { permission: 'granted', requestResult: 'granted', failWrites: false, ...opts };
    this.permission = this.opts.permission;
    this.requestResult = this.opts.requestResult;
  }

  async queryPermission() {
    return this.permission;
  }

  async requestPermission() {
    return this.requestResult;
  }

  async getDirectoryHandle(name, { create } = {}) {
    if (!this.children.has(name)) {
      if (!create) throw new DOMException(`Нет папки ${name}`, 'NotFoundError');
      this.children.set(name, new FakeDir(name, this.opts));
    }
    return this.children.get(name);
  }

  async getFileHandle(name, { create } = {}) {
    if (!this.children.has(name)) {
      if (!create) throw new DOMException(`Нет файла ${name}`, 'NotFoundError');
      this.children.set(name, new FakeFile(name, this.opts));
    }
    return this.children.get(name);
  }
}

const makeStore = (initial = null) => {
  const store = {
    value: initial,
    get: jest.fn(async () => store.value),
    set: jest.fn(async (handle) => { store.value = handle; })
  };
  return store;
};

const abortError = () => {
  const error = new Error('cancelled');
  error.name = 'AbortError';
  return error;
};

describe('documents-folder: sanitizeName', () => {
  test('заменяет недопустимые символы и управляющие на _, убирает пробелы и точки по краям', () => {
    expect(DocumentsFolder.sanitizeName('a/b\\c:d*e?f"g<h>i|j')).toBe('a_b_c_d_e_f_g_h_i_j');
    expect(DocumentsFolder.sanitizeName('x\u0001y\u001f')).toBe('x_y_');
    expect(DocumentsFolder.sanitizeName('Отчёт.')).toBe('Отчёт');
    expect(DocumentsFolder.sanitizeName('  Отчёт  ')).toBe('Отчёт');
    expect(DocumentsFolder.sanitizeName('один    два')).toBe('один два');
  });

  test('режет имя длиннее 80 символов до 80', () => {
    expect(DocumentsFolder.sanitizeName('а'.repeat(100))).toHaveLength(80);
    expect(DocumentsFolder.sanitizeName('а'.repeat(100))).toBe('а'.repeat(80));
  });

  test('пустое имя (включая одни пробелы и точки) становится document', () => {
    expect(DocumentsFolder.sanitizeName('')).toBe('document');
    expect(DocumentsFolder.sanitizeName('   ')).toBe('document');
    expect(DocumentsFolder.sanitizeName('...')).toBe('document');
  });
});

describe('documents-folder: stamp', () => {
  test('форматирует локальное время как YYYY-MM-DD_HH-mm-ss', () => {
    const ms = new Date(2026, 0, 5, 7, 8, 9).getTime();
    expect(DocumentsFolder.stamp(ms)).toBe('2026-01-05_07-08-09');
    expect(DocumentsFolder.stamp(ms)).toBe(expectedStamp(ms));
  });

  test('месяц и день с двумя цифрами, время на 23:59:58', () => {
    const ms = new Date(2026, 11, 31, 23, 59, 58).getTime();
    expect(DocumentsFolder.stamp(ms)).toBe('2026-12-31_23-59-58');
  });
});

describe('documents-folder: relativePath', () => {
  test('read даёт файл .md, form даёт файл .json', () => {
    const startedAt = new Date(2026, 9, 25, 9, 30, 5).getTime();
    const md = DocumentsFolder.relativePath({ pipeline: 'Пайплайн', startedAt, name: 'Отчёт', kind: 'read' });
    const json = DocumentsFolder.relativePath({ pipeline: 'Пайплайн', startedAt, name: 'Отчёт', kind: 'form' });
    expect(md.file).toBe('Отчёт.md');
    expect(json.file).toBe('Отчёт.json');
    expect(md.dirs).toEqual(['Пайплайн', expectedStamp(startedAt)]);
  });

  test('имя пайплайна и имя документа очищаются', () => {
    const startedAt = new Date(2026, 9, 25, 9, 30, 5).getTime();
    const result = DocumentsFolder.relativePath({ pipeline: 'Пайп:1', startedAt, name: 'Док/1?', kind: 'read' });
    expect(result.dirs[0]).toBe('Пайп_1');
    expect(result.file).toBe('Док_1_.md');
  });
});

describe('documents-folder: folderName и pick', () => {
  test('folderName пуст без дескриптора, после pick равен имени выбранной папки', async () => {
    const root = new FakeDir('Документы');
    const store = makeStore();
    const picker = jest.fn(async () => root);
    const folder = DocumentsFolder.create({ store, picker });

    expect(await folder.folderName()).toBe('');
    expect(await folder.pick()).toBe('Документы');
    expect(store.set).toHaveBeenCalledWith(root);
    expect(await folder.folderName()).toBe('Документы');
  });

  test('pick при AbortError возвращает null и ничего не сохраняет', async () => {
    const store = makeStore();
    const picker = jest.fn(async () => { throw abortError(); });
    const folder = DocumentsFolder.create({ store, picker });

    expect(await folder.pick()).toBeNull();
    expect(store.set).not.toHaveBeenCalled();
    expect(store.value).toBeNull();
  });

  test('pick пробрасывает другие ошибки', async () => {
    const store = makeStore();
    const picker = jest.fn(async () => { throw new Error('boom'); });
    const folder = DocumentsFolder.create({ store, picker });

    await expect(folder.pick()).rejects.toThrow('boom');
    expect(store.set).not.toHaveBeenCalled();
  });
});

describe('documents-folder: ensureAccess', () => {
  test('без дескриптора возвращает none', async () => {
    const folder = DocumentsFolder.create({ store: makeStore(), picker: jest.fn() });
    expect(await folder.ensureAccess({ request: true })).toBe('none');
  });

  test('при granted возвращает granted', async () => {
    const root = new FakeDir('Документы', { permission: 'granted' });
    const folder = DocumentsFolder.create({ store: makeStore(root), picker: jest.fn() });
    expect(await folder.ensureAccess({ request: false })).toBe('granted');
  });

  test('при prompt без request возвращает denied и не запрашивает доступ', async () => {
    const root = new FakeDir('Документы', { permission: 'prompt' });
    const spy = jest.spyOn(root, 'requestPermission');
    const folder = DocumentsFolder.create({ store: makeStore(root), picker: jest.fn() });

    expect(await folder.ensureAccess({ request: false })).toBe('denied');
    expect(spy).not.toHaveBeenCalled();
  });

  test('при prompt с request и ответе granted возвращает granted', async () => {
    const root = new FakeDir('Документы', { permission: 'prompt', requestResult: 'granted' });
    const spy = jest.spyOn(root, 'requestPermission');
    const folder = DocumentsFolder.create({ store: makeStore(root), picker: jest.fn() });

    expect(await folder.ensureAccess({ request: true })).toBe('granted');
    expect(spy).toHaveBeenCalledWith({ mode: 'readwrite' });
  });

  test('при prompt с request и ответе denied возвращает denied', async () => {
    const root = new FakeDir('Документы', { permission: 'prompt', requestResult: 'denied' });
    const folder = DocumentsFolder.create({ store: makeStore(root), picker: jest.fn() });

    expect(await folder.ensureAccess({ request: true })).toBe('denied');
  });
});

describe('documents-folder: write', () => {
  const startedAt = new Date(2026, 9, 25, 9, 30, 5).getTime();
  const stampDir = expectedStamp(startedAt);

  test('пишет файл в корень/пайплайн/штамп/имя.md и возвращает ok с путём; повтор перезаписывает тот же файл', async () => {
    const root = new FakeDir('Документы');
    const folder = DocumentsFolder.create({ store: makeStore(root), picker: jest.fn() });
    const args = { pipeline: 'Пайплайн', startedAt, name: 'Отчёт', kind: 'read' };

    const first = await folder.write({ ...args, text: 'первый текст' });
    expect(first).toEqual({ ok: true, path: `Пайплайн/${stampDir}/Отчёт.md` });

    const pipelineDir = root.children.get('Пайплайн');
    const stampChild = pipelineDir.children.get(stampDir);
    expect(stampChild.children.get('Отчёт.md').text).toBe('первый текст');

    const second = await folder.write({ ...args, text: 'новый текст' });
    expect(second).toEqual({ ok: true, path: `Пайплайн/${stampDir}/Отчёт.md` });
    expect(stampChild.children.size).toBe(1);
    expect(stampChild.children.get('Отчёт.md').text).toBe('новый текст');
  });

  test('без дескриптора возвращает reason none', async () => {
    const folder = DocumentsFolder.create({ store: makeStore(), picker: jest.fn() });
    expect(await folder.write({ pipeline: 'P', startedAt, name: 'N', kind: 'read', text: 't' }))
      .toEqual({ ok: false, reason: 'none' });
  });

  test('при permission prompt возвращает reason denied и ничего не записывает', async () => {
    const root = new FakeDir('Документы', { permission: 'prompt' });
    const folder = DocumentsFolder.create({ store: makeStore(root), picker: jest.fn() });

    expect(await folder.write({ pipeline: 'P', startedAt, name: 'N', kind: 'read', text: 't' }))
      .toEqual({ ok: false, reason: 'denied' });
    expect(root.children.size).toBe(0);
  });

  test('если createWritable бросает ошибку, возвращает reason error с message', async () => {
    const root = new FakeDir('Документы', { failWrites: true });
    const folder = DocumentsFolder.create({ store: makeStore(root), picker: jest.fn() });

    const result = await folder.write({ pipeline: 'P', startedAt, name: 'N', kind: 'read', text: 't' });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('error');
    expect(result.message).toBe('disk full');
  });
});

describe('documents-folder: readAt и writeAt', () => {
  test('writeAt пишет по пути и перезаписывает файл целиком (без «(2)»)', async () => {
    const root = new FakeDir('Документы');
    const folder = DocumentsFolder.create({ store: makeStore(root), picker: jest.fn() });

    expect(await folder.writeAt({ dirs: ['Папка', 'Прогон'], file: 'chain.txt', text: 'один' }))
      .toEqual({ ok: true, path: 'Папка/Прогон/chain.txt' });
    expect(await folder.writeAt({ dirs: ['Папка', 'Прогон'], file: 'chain.txt', text: 'два' }))
      .toEqual({ ok: true, path: 'Папка/Прогон/chain.txt' });
    const dir = root.children.get('Папка').children.get('Прогон');
    expect(dir.children.size).toBe(1);
    expect(dir.children.get('chain.txt').text).toBe('два');
  });

  test('writeAt очищает имена папок и файла, расширение сохраняет', async () => {
    const root = new FakeDir('Документы');
    const folder = DocumentsFolder.create({ store: makeStore(root), picker: jest.fn() });

    const result = await folder.writeAt({ dirs: ['Пайп:1'], file: 'run/1?.json', text: 't' });
    expect(result).toEqual({ ok: true, path: 'Пайп_1/run_1_.json' });
  });

  test('readAt читает текст файла, не создавая папок', async () => {
    const root = new FakeDir('Документы');
    const folder = DocumentsFolder.create({ store: makeStore(root), picker: jest.fn() });
    await folder.writeAt({ dirs: ['П'], file: 'chain.txt', text: 'строка\n' });

    expect(await folder.readAt({ dirs: ['П'], file: 'chain.txt' })).toEqual({ ok: true, text: 'строка\n' });
    expect(await folder.readAt({ dirs: ['Нет'], file: 'chain.txt' })).toEqual({ ok: false, reason: 'missing' });
    expect(root.children.has('Нет')).toBe(false);
  });

  test('readAt без файла в существующей папке — missing', async () => {
    const root = new FakeDir('Документы');
    const folder = DocumentsFolder.create({ store: makeStore(root), picker: jest.fn() });
    expect(await folder.readAt({ file: 'chain.txt' })).toEqual({ ok: false, reason: 'missing' });
  });

  test('без дескриптора readAt и writeAt возвращают none', async () => {
    const folder = DocumentsFolder.create({ store: makeStore(), picker: jest.fn() });
    expect(await folder.readAt({ file: 'chain.txt' })).toEqual({ ok: false, reason: 'none' });
    expect(await folder.writeAt({ file: 'chain.txt', text: 't' })).toEqual({ ok: false, reason: 'none' });
  });

  test('при permission prompt readAt и writeAt возвращают denied и ничего не трогают', async () => {
    const root = new FakeDir('Документы', { permission: 'prompt' });
    const folder = DocumentsFolder.create({ store: makeStore(root), picker: jest.fn() });
    expect(await folder.readAt({ file: 'chain.txt' })).toEqual({ ok: false, reason: 'denied' });
    expect(await folder.writeAt({ file: 'chain.txt', text: 't' })).toEqual({ ok: false, reason: 'denied' });
    expect(root.children.size).toBe(0);
  });

  test('ошибка записи writeAt возвращается как error с message, не бросает', async () => {
    const root = new FakeDir('Документы', { failWrites: true });
    const folder = DocumentsFolder.create({ store: makeStore(root), picker: jest.fn() });
    expect(await folder.writeAt({ file: 'chain.txt', text: 't' })).toEqual({ ok: false, reason: 'error', message: 'disk full' });
  });

  test('ошибка чтения, не являющаяся отсутствием, возвращается как error', async () => {
    const root = new FakeDir('Документы');
    const folder = DocumentsFolder.create({ store: makeStore(root), picker: jest.fn() });
    await folder.writeAt({ file: 'chain.txt', text: 't' });
    const file = root.children.get('chain.txt');
    file.getFile = async () => { throw new Error('io'); };
    expect(await folder.readAt({ file: 'chain.txt' })).toEqual({ ok: false, reason: 'error', message: 'io' });
  });

  test('runDirs — папки прогона, те же, что у relativePath', () => {
    const startedAt = new Date(2026, 9, 25, 9, 30, 5).getTime();
    expect(DocumentsFolder.runDirs({ pipeline: 'П:1', startedAt })).toEqual(['П_1', expectedStamp(startedAt)]);
    expect(DocumentsFolder.relativePath({ pipeline: 'П:1', startedAt, name: 'N', kind: 'read' }).dirs)
      .toEqual(DocumentsFolder.runDirs({ pipeline: 'П:1', startedAt }));
  });
});
