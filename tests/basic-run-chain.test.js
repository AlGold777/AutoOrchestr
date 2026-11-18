const crypto = require('crypto');
const BasicRunChain = require('../disput/basic-run-chain');

const sha = (text) => crypto.createHash('sha256').update(text, 'utf8').digest('hex');

// Фейк папки документов с тем же контрактом, что у DocumentsFolder: readAt, writeAt, ensureAccess.
const makeFolder = ({ access = 'granted', readError = null, writeError = null } = {}) => {
  const files = new Map();
  const folder = {
    files,
    ensureAccess: jest.fn(async () => access),
    readAt: jest.fn(async ({ dirs = [], file }) => {
      if (access === 'none') return { ok: false, reason: 'none' };
      if (readError) return { ok: false, reason: 'error', message: readError };
      const key = [...dirs, file].join('/');
      if (!files.has(key)) return { ok: false, reason: 'missing' };
      return { ok: true, text: files.get(key) };
    }),
    writeAt: jest.fn(async ({ dirs = [], file, text }) => {
      if (access !== 'granted') return { ok: false, reason: 'denied' };
      if (writeError) return { ok: false, reason: 'error', message: writeError };
      const key = [...dirs, file].join('/');
      files.set(key, text);
      return { ok: true, path: key };
    })
  };
  return folder;
};

describe('basic-run-chain: sha256Hex', () => {
  test('SHA-256 от строки abc', async () => {
    expect(await BasicRunChain.sha256Hex('abc'))
      .toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });

  test('кириллица считается по байтам UTF-8', async () => {
    expect(await BasicRunChain.sha256Hex('привет')).toBe(sha('привет'));
  });
});

describe('basic-run-chain: sectionsOf', () => {
  const task = 'Вводная часть\n=== ЗАДАЧА ===\nТекст задачи\n=== ПРАВИЛА ===\nПравило\n=== ФОРМАТ ===\nФормат\n';

  test('делит текст на три раздела по заголовкам', () => {
    const sections = BasicRunChain.sectionsOf(task);
    expect(sections.map((s) => s.title)).toEqual(['', 'ЗАДАЧА', 'ПРАВИЛА', 'ФОРМАТ']);
  });

  test('текст до первого заголовка идёт отдельным разделом, текст раздела начинается со строки заголовка', () => {
    const sections = BasicRunChain.sectionsOf(task);
    expect(sections[0].text).toBe('Вводная часть\n');
    expect(sections[1].text).toBe('=== ЗАДАЧА ===\nТекст задачи\n');
  });

  test('сумма длин разделов равна длине текста', () => {
    const sections = BasicRunChain.sectionsOf(task);
    expect(sections.reduce((sum, s) => sum + s.text.length, 0)).toBe(task.length);
    expect(sections.map((s) => s.text).join('')).toBe(task);
  });

  test('текст без заголовков — один раздел с пустым названием; пустой текст — без разделов', () => {
    expect(BasicRunChain.sectionsOf('только текст')).toEqual([{ title: '', text: 'только текст' }]);
    expect(BasicRunChain.sectionsOf('')).toEqual([]);
  });
});

describe('basic-run-chain: taskSections', () => {
  test('даёт название, длину и SHA-256 каждого раздела', async () => {
    const result = await BasicRunChain.taskSections('=== А ===\nтекст\n');
    expect(result).toEqual([{ title: 'А', chars: '=== А ===\nтекст\n'.length, sha256: sha('=== А ===\nтекст\n') }]);
  });
});

describe('basic-run-chain: chainLine и lastLine', () => {
  test('строка из пяти полей через пробел; пробелы в пути заменяются на %20', () => {
    const line = BasicRunChain.chainLine({
      number: 2,
      at: '2026-11-18T10:00:00.000Z',
      file: 'Пайплайн/2026-11-18_13-00-00/run_1.json',
      fileSha256: 'a'.repeat(64),
      prevSha256: 'b'.repeat(64)
    });
    expect(line).toBe(`2 2026-11-18T10:00:00.000Z Пайплайн/2026-11-18_13-00-00/run_1.json ${'a'.repeat(64)} ${'b'.repeat(64)}`);
    expect(BasicRunChain.chainLine({ number: 1, at: 't', file: 'мой файл.json', fileSha256: 'x', prevSha256: '-' }))
      .toBe('1 t мой%20файл.json x -');
  });

  test('lastLine — последняя непустая строка или null', () => {
    expect(BasicRunChain.lastLine('1 a\n2 b\n\n')).toBe('2 b');
    expect(BasicRunChain.lastLine('')).toBeNull();
    expect(BasicRunChain.lastLine('\n\n')).toBeNull();
  });
});

describe('basic-run-chain: append', () => {
  test('к пустой цепочке даёт номер 1 и - в пятом поле', async () => {
    const { line, text } = await BasicRunChain.append('', { at: 't1', file: 'P/S/run_1.json', fileText: 'файл' });
    const fields = line.split(' ');
    expect(fields[0]).toBe('1');
    expect(fields[2]).toBe('P/S/run_1.json');
    expect(fields[3]).toBe(sha('файл'));
    expect(fields[4]).toBe('-');
    expect(text).toBe(`${line}\n`);
  });

  test('вторая строка получает сумму первой строки вместе с переводом строки', async () => {
    const first = await BasicRunChain.append('', { at: 't1', file: 'a.json', fileText: 'один' });
    const second = await BasicRunChain.append(first.text, { at: 't2', file: 'b.json', fileText: 'два' });
    const fields = second.line.split(' ');
    expect(fields[0]).toBe('2');
    expect(fields[4]).toBe(sha(`${first.line}\n`));
    expect(second.text).toBe(`${first.text}${second.line}\n`);
  });
});

describe('basic-run-chain: verify', () => {
  const build = async (count) => {
    let text = '';
    for (let i = 0; i < count; i += 1) {
      const next = await BasicRunChain.append(text, { at: `t${i}`, file: `f${i}.json`, fileText: `текст ${i}` });
      text = next.text;
    }
    return text;
  };

  test('верная цепочка проходит проверку', async () => {
    const text = await build(4);
    expect(await BasicRunChain.verify(text)).toEqual({ ok: true, brokenAt: null });
  });

  test('пустая цепочка проходит проверку', async () => {
    expect(await BasicRunChain.verify('')).toEqual({ ok: true, brokenAt: null });
  });

  test('изменение символа во второй строке ломает третью строку', async () => {
    const text = await build(4);
    const lines = text.split('\n');
    lines[1] = lines[1].replace('f1.json', 'f9.json');
    expect(await BasicRunChain.verify(lines.join('\n'))).toEqual({ ok: false, brokenAt: 3 });
  });

  test('пятое поле первой строки не проверяется: цепочка User с любой суммой в начале продолжается', async () => {
    const userChain = `1 2026-01-01T00:00:00Z old.md ${'a'.repeat(64)} ${'c'.repeat(64)}\n`;
    const next = await BasicRunChain.append(userChain, { at: 't', file: 'new.json', fileText: 'новый' });
    expect(next.line.split(' ')[0]).toBe('2');
    expect(await BasicRunChain.verify(next.text)).toEqual({ ok: true, brokenAt: null });
  });
});

describe('basic-run-chain: saveRun', () => {
  const report = { runId: 'R1', steps: [{ name: 'раунд' }] };
  const dirs = ['Пайплайн', '2026-11-18_10-00-00'];
  const at = '2026-11-18T10:05:00.000Z';

  test('пишет run_<runId>.json и дописывает строку в chain.txt в корне', async () => {
    const folder = makeFolder();
    const result = await BasicRunChain.saveRun({ folder, dirs, report, at });

    const text = JSON.stringify(report, null, 2);
    expect(result).toEqual({
      ok: true,
      path: 'Пайплайн/2026-11-18_10-00-00/run_R1.json',
      line: expect.any(String),
      number: 1,
      fileSha256: sha(text)
    });
    expect(folder.files.get('Пайплайн/2026-11-18_10-00-00/run_R1.json')).toBe(text);
    const chain = folder.files.get('chain.txt');
    expect(chain).toBe(`${result.line}\n`);
    expect(chain.split(' ')[3]).toBe(sha(text));
    expect(folder.writeAt).toHaveBeenCalledWith({ dirs, file: 'run_R1.json', text });
  });

  test('вторая запись дописывает строку с номером 2 и суммой первой', async () => {
    const folder = makeFolder();
    const first = await BasicRunChain.saveRun({ folder, dirs, report, at });
    const second = await BasicRunChain.saveRun({ folder, dirs, report: { runId: 'R2' }, at });
    expect(second.number).toBe(2);
    expect(folder.files.get('chain.txt').split('\n')[0]).toBe(first.line);
    expect(folder.files.get('chain.txt').split('\n')[1]).toBe(second.line);
    expect(second.line.split(' ')[4]).toBe(sha(`${first.line}\n`));
  });

  test('без доступа — ok: false и ни одной записи', async () => {
    const folder = makeFolder({ access: 'denied' });
    const result = await BasicRunChain.saveRun({ folder, dirs, report, at });
    expect(result).toEqual({ ok: false, reason: 'denied', message: '' });
    expect(folder.writeAt).not.toHaveBeenCalled();
    expect(folder.files.size).toBe(0);
  });

  test('без выбранной папки — reason none', async () => {
    const folder = makeFolder({ access: 'none' });
    expect(await BasicRunChain.saveRun({ folder, dirs, report, at })).toEqual({ ok: false, reason: 'none', message: '' });
  });

  test('ошибка чтения цепочки возвращается, chain.txt не тронут', async () => {
    const folder = makeFolder({ readError: 'чтение сломано' });
    folder.files.set('chain.txt', '1 t x y -\n');
    const result = await BasicRunChain.saveRun({ folder, dirs, report, at });
    expect(result).toEqual({ ok: false, reason: 'error', message: 'чтение сломано' });
    expect(folder.files.get('chain.txt')).toBe('1 t x y -\n');
  });

  test('ошибка записи файла прогона возвращается как ok: false с message, цепочка не пишется', async () => {
    const folder = makeFolder({ writeError: 'диск полон' });
    const result = await BasicRunChain.saveRun({ folder, dirs, report, at });
    expect(result).toEqual({ ok: false, reason: 'error', message: 'диск полон' });
    expect(folder.files.has('chain.txt')).toBe(false);
  });
});
