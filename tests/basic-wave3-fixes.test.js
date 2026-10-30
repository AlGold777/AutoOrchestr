const fs = require('fs');
const path = require('path');
const Engine = require('../disput/custom-engine');
const DocumentsFolder = require('../results/documents-folder');

const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

// A scripted transport: each reply is { text, status } for one request to the model, in order.
function scripted(replies) {
  const calls = [];
  let index = 0;
  const send = async (models, prompts) => {
    calls.push({ models: models.slice(), prompts: { ...prompts } });
    const reply = replies[index] || { text: '', status: 'TIMEOUT' };
    index += 1;
    return { byModel: Object.fromEntries(models.map((model) => [model, { ...reply }])), closedByOwner: false };
  };
  return { send, calls };
}

const ROUND = [{ ref: 'r1', kind: 'round', input: 'none', models: ['A'] }];

describe('B6: причина пустого ответа несёт статус (не отправлено / таймаут)', () => {
  test('NO_SEND без текста дает причину not_sent и тот же запрос уходит повторно (без правки)', async () => {
    const transport = scripted([{ text: '', status: 'NO_SEND' }, { text: 'Полный ответ модели.', status: 'SUCCESS' }]);
    const result = await Engine.run({ task: 'T', steps: ROUND, send: transport.send });
    expect(transport.calls).toHaveLength(2);
    expect(transport.calls[1].prompts.A).toBe(transport.calls[0].prompts.A);
    expect(result.history.find((item) => item.attempt === 2).triggerReason).toBe('empty_answer');
    expect(result.steps[0].outcome.A.ok).toBe(true);
  });

  test('NO_SEND дважды подряд: окно решения владельца получает причину not_sent и вариант «повторить»', async () => {
    const transport = scripted([{ text: '', status: 'NO_SEND' }, { text: '', status: 'NO_SEND' }]);
    const asked = [];
    await Engine.run({ task: 'T', steps: ROUND, send: transport.send, decide: (problem) => { asked.push(problem); return 'skip'; } });
    expect(transport.calls).toHaveLength(2);
    expect(asked[0].reasons.A).toBe('not_sent');
    expect(asked[0].choices).toContain('retry');
  });

  test('таймаут без текста дает причину timeout, а не «пустой»', async () => {
    const transport = scripted([{ text: '', status: 'STREAM_TIMEOUT' }, { text: 'Полный ответ модели.', status: 'SUCCESS' }]);
    const result = await Engine.run({ task: 'T', steps: ROUND, send: transport.send });
    expect(transport.calls[1].prompts.A).toBe(transport.calls[0].prompts.A);
    expect(Engine.REASON_TEXT.timeout).toBe('таймаут');
    expect(Engine.REASON_TEXT.not_sent).toBe('не отправлено');
  });

  test('ключи причин, которых не хватало, есть в REASON_TEXT по-русски', () => {
    ['missing_sections', 'invalid_json', 'invalid_audit_verdict', 'rejected', 'missing_section'].forEach((key) => {
      expect(typeof Engine.REASON_TEXT[key]).toBe('string');
      expect(Engine.REASON_TEXT[key]).toMatch(/[а-яё]/i);
    });
  });
});

describe('B10: одинаковое имя файла документа не затирает чужой файл', () => {
  const makeFolder = (store) => DocumentsFolder.create({ store, picker: async () => null });
  const startedAt = new Date(2026, 9, 30, 8, 8, 0).getTime();
  const doc = (runId, text) => ({ pipeline: 'Basic', startedAt, runId, name: 'Отчёт', kind: 'read', text });

  // Real directory handles of the File System Access API are needed for the write: a small in-memory tree.
  const tree = () => {
    const make = (kind, name) => ({
      kind, name, children: new Map(),
      async getDirectoryHandle(part, { create } = {}) {
        if (!this.children.has(part)) { if (!create) throw new Error('NotFound'); this.children.set(part, make('directory', part)); }
        return this.children.get(part);
      },
      async getFileHandle(file, { create } = {}) {
        if (!this.children.has(file)) { if (!create) throw new Error('NotFound'); this.children.set(file, { kind: 'file', text: '' }); }
        const node = this.children.get(file);
        return { createWritable: async () => ({ write: async (value) => { node.text = value; }, close: async () => {} }) };
      },
      async queryPermission() { return 'granted'; }
    });
    return make('directory', 'Папка');
  };

  test('второй прогон с тем же именем получает суффикс (2)', async () => {
    const root = tree();
    const folder = makeFolder({ get: async () => root, set: async () => {} });
    const first = await folder.write(doc('run-1', 'A'));
    const second = await folder.write(doc('run-2', 'B'));
    expect(first.path.endsWith('/Отчёт.md')).toBe(true);
    expect(second.path.endsWith('/Отчёт (2).md')).toBe(true);
  });

  test('повторное OK того же прогона перезаписывает свой файл, суффикса нет', async () => {
    const root = tree();
    const folder = makeFolder({ get: async () => root, set: async () => {} });
    const first = await folder.write(doc('run-1', 'A'));
    const again = await folder.write(doc('run-1', 'A2'));
    expect(again.path).toBe(first.path);
  });

  test('отказ доступа не открывает файл (denied)', async () => {
    const folder = makeFolder({ get: async () => ({ kind: 'directory', name: 'X', queryPermission: async () => 'denied' }), set: async () => {} });
    await expect(folder.write(doc('run-1', 'A'))).resolves.toEqual({ ok: false, reason: 'denied' });
  });
});

describe('B5, B7, B8, B9: контракт правок интерфейса (results.js, styles/pipeline.css)', () => {
  const results = read('results.js');
  const css = read('styles/pipeline.css');
  const panel = read('pipeline_panel.html');

  test('B5: failed и stopped дают свой класс и бейдж «!» с причиной, не «не начат»', () => {
    expect(results).toContain("const PIPELINE_RUN_STATE_RANK = { pending: 0, stopped: 1, failed: 2, done: 3, running: 4 };");
    expect(results).toContain("data-run-failed");
    expect(results).toContain("stage.reason = stageFailureReason(index);");
    expect(css).toMatch(/\.pipeline-flow \.model-block\.pipeline-run-failed\s*\{/);
    expect(css).toMatch(/\.pipeline-flow \.model-block\.pipeline-run-stopped\s*\{/);
  });

  test('B7: строка «Продолжить» возвращается после перезагрузки для последней остановленной записи', () => {
    expect(results).toContain('const offerStoredResumeLine = async () => {');
    expect(results).toContain("record.stopReason !== 'steps_done') offerResumeLine(record);");
    expect(results).toContain('void offerStoredResumeLine();');
  });

  test('B8: пустой идентификатор карточки не считается чужой карточкой', () => {
    expect(results).toContain('(expectedCardId && observedCardId && expectedCardId !== observedCardId)');
  });

  test('B9: вставка схемы предлагает уникальное имя из заголовка и русские подписи', () => {
    expect(results).toContain("importBasicSchemaFile(value, uniquePipelineName(String(value?.title || '').trim() || 'Новая схема'))");
    expect(results).toContain("confirmText || 'Сохранить'");
    expect(panel).toContain('title="Удалить раунд"');
    expect(panel).toContain('title="Импорт схемы"');
  });
});
