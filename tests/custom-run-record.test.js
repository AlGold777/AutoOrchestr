const Engine = require('../disput/custom-engine');
const Record = require('../disput/custom-run-record');

function memoryStorage() {
  const data = new Map();
  return {
    data,
    get: async (key) => (data.has(key) ? JSON.parse(JSON.stringify(data.get(key))) : undefined),
    set: async (key, value) => { data.set(key, JSON.parse(JSON.stringify(value))); },
    remove: async (key) => { data.delete(key); }
  };
}

// Runs the engine with a scripted transport and records every attempt.
async function recordedRun({ steps, answers, runId = 'run-1', pipelineName = 'Mine', task = 'Задача T', ...options }) {
  const record = Record.createRun({ runId, pipelineName, task, steps });
  const used = {};
  const send = async (models, prompts) => ({
    byModel: Object.fromEntries(models.map((model) => {
      const index = used[model] || 0;
      used[model] = index + 1;
      const text = (answers[model] || [])[index] || '';
      return [model, { text, status: text ? 'SUCCESS' : 'TIMEOUT', attribution: text ? 'verified' : 'unproven',
        transportRequestId: `${model}-${index + 1}`, sentPrompt: `${prompts[model]}\n\nПоследней строкой ответа напиши только метку [[AO-xyz${index}]]` }];
    }))
  });
  const result = await Engine.run({
    task, steps, send, ...options,
    onRequest: (entry) => Record.recordAttempt(record, entry),
    onResponse: (entry) => Record.recordAttempt(record, entry)
  });
  Record.finishRun(record, { stopReason: result.stopReason });
  return { record, result };
}

describe('Custom run record', () => {
  test('an attempt keeps instructions and input apart; input items name their source', async () => {
    const { record } = await recordedRun({
      steps: [
        { task: 'Ответь', input: 'none', models: ['A', 'B'] },
        { task: 'Улучши', input: 'previous', models: [{ name: 'A', extra: 'Будь критиком.' }] }
      ],
      answers: { A: ['a1', 'a2'], B: ['b1'] }
    });
    const second = Record.exportRun(record).attempts.find((item) => item.step === 1);
    expect(second.instructions).toMatchObject({ task: 'Задача T', stepTask: 'Улучши', extra: 'Будь критиком.' });
    expect(second.input.mode).toBe('previous');
    expect(second.input.items).toEqual([
      { label: '', source: { step: 0, label: 'Раунд 1', model: 'A', attempt: 1 }, text: 'a1' },
      { label: '', source: { step: 0, label: 'Раунд 1', model: 'B', attempt: 1 }, text: 'b1' }
    ]);
    expect(second.answer).toBe('a2');
    expect(second).toMatchObject({ state: 'done', accepted: true, attribution: 'verified', transportRequestId: 'A-2' });
  });

  test('the prompt as dispatched is kept next to the engine prompt, token included', async () => {
    const { record } = await recordedRun({ steps: [{ task: 'x', input: 'none', models: ['A'] }], answers: { A: ['a1'] } });
    const [attempt] = Record.exportRun(record).attempts;
    expect(attempt.prompt).not.toContain('[[AO-');
    expect(attempt.sentPrompt).toBe(`${attempt.prompt}\n\nПоследней строкой ответа напиши только метку [[AO-xyz0]]`);
  });

  test('a retry is a new attempt referring to the one it follows; the first stays as it was', async () => {
    const { record } = await recordedRun({ steps: [{ task: 'x', input: 'none', models: ['A'] }], answers: { A: ['', 'a2'] } });
    const attempts = Record.exportRun(record).attempts;
    expect(attempts.map((item) => [item.attempt, item.retryOf, item.accepted, item.reason])).toEqual([[1, null, false, 'empty'], [2, 1, true, '']]);
    expect(attempts[1].instructions.correction).toBe(Engine.correctionPrompt('empty'));
    const first = record.attempts[0];
    Record.recordAttempt(record, { step: 0, model: 'A', attempt: 1, state: 'done', answer: 'rewritten', accepted: true });
    expect(record.attempts[0]).toBe(first);
    expect(Record.exportRun(record).attempts[0]).toMatchObject({ accepted: false, answer: '' });
  });

  test('every text is stored once: the input of a step refers to the answers of another', async () => {
    const { record } = await recordedRun({
      steps: [{ task: 'x', input: 'none', models: ['A'] }, { task: 'y', input: 'previous', models: ['B'] }],
      answers: { A: ['ОДИН И ТОТ ЖЕ ТЕКСТ'.repeat(50)], B: ['b1'] }
    });
    const stored = Record.serialize(record);
    const copies = Object.values(stored.texts).filter((value) => value === 'ОДИН И ТОТ ЖЕ ТЕКСТ'.repeat(50));
    expect(copies).toHaveLength(1);
    expect(stored.put).toBeUndefined();
  });

  test('storage is bounded by size: whole oldest runs go first, the run being saved stays', async () => {
    const storage = memoryStorage();
    const store = Record.createStore({ storage, maxBytes: 6000 });
    for (let index = 1; index <= 3; index += 1) {
      const { record } = await recordedRun({ runId: `run-${index}`, steps: [{ task: 'x', input: 'none', models: ['A'] }], answers: { A: [`${index}`.repeat(2000)] } });
      record.startedAt = index;
      await store.save(record);
    }
    const index = await store.list();
    expect(index.map((item) => item.runId)).toEqual(['run-3']);
    expect(storage.data.has(`${Record.RUN_KEY_PREFIX}run-1`)).toBe(false);
    const big = await recordedRun({ runId: 'run-big', steps: [{ task: 'x', input: 'none', models: ['A'] }], answers: { A: ['z'.repeat(9000)] } });
    big.record.startedAt = 9;
    await store.save(big.record);
    expect((await store.list()).map((item) => item.runId)).toEqual(['run-big']);
  });

  test('after a reload the record is history: an unfinished attempt is "unknown", nothing is re-sent', async () => {
    const storage = memoryStorage();
    const store = Record.createStore({ storage });
    const record = Record.createRun({ runId: 'r', pipelineName: 'Mine', task: 'T', steps: [{ kind: 'round', models: ['A'] }] });
    Record.recordAttempt(record, { step: 0, label: 'Раунд 1', model: 'A', attempt: 1, prompt: 'p', parts: {}, state: 'sent' });
    await store.save(record);
    const back = await store.latest('Mine');
    expect(back.attempts[0].state).toBe('unknown');
    expect(await store.latest('Other')).toBeNull();
  });

  test('export resolves every text and is plain JSON', async () => {
    const { record } = await recordedRun({ steps: [{ task: 'x', input: 'none', models: ['A'] }], answers: { A: ['a1'] } });
    const exported = Record.exportRun(record);
    expect(JSON.parse(JSON.stringify(exported))).toEqual(exported);
    expect(exported).toMatchObject({ runId: 'run-1', pipelineName: 'Mine', task: 'Задача T', stopReason: 'steps_done' });
  });
});

describe('Custom request preview', () => {
  test('before a run the template marks the data that does not exist yet and lists transport lines apart', () => {
    const preview = Engine.previewPrompt({
      task: 'T',
      steps: [{ task: 'x', input: 'none', models: ['A'] }, { order: 'sequential', task: 'y', input: 'previous', models: ['A', { name: 'B', extra: 'Кратко.' }] }],
      stepIndex: 1, modelName: 'B'
    });
    expect(preview.prompt).toContain(Engine.PLACEHOLDER.previous);
    expect(preview.prompt).toContain(Engine.PLACEHOLDER.earlier);
    expect(preview.prompt).toContain('Дополнительно для тебя:\nКратко.');
    expect(preview.prompt).not.toContain('[[AO-');
    expect(preview.transportLines.join('\n')).toContain('Метка доставки');
    expect(preview.instructions).toMatchObject({ task: 'T', stepTask: 'y', extra: 'Кратко.' });
  });
});

test('the Disput Flow JSON export carries the latest Custom run record, redacted with the rest', () => {
  const source = require('fs').readFileSync(require('path').join(__dirname, '..', 'results.js'), 'utf8');
  const handler = source.slice(source.indexOf("const disputBtn = event.target.closest('#disput-export-json');"));
  expect(handler.slice(0, 1500)).toContain('const customRun = await readLatestCustomRun();');
  expect(handler.slice(0, 1500)).toContain("downloadDiagnosticsJson('Disput Flow', { ...(payload || {}), delivery, ...(customRun ? { customRun } : {}) }, disputBtn);");
});

