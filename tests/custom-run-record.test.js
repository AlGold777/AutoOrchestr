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
      { label: '', source: { step: 0, visit: 1, label: 'Раунд 1', model: 'A', attempt: 1 }, text: 'a1' },
      { label: '', source: { step: 0, visit: 1, label: 'Раунд 1', model: 'B', attempt: 1 }, text: 'b1' }
    ]);
    expect(second.answer).toBe('a2');
    expect(second).toMatchObject({ state: 'done', accepted: true, attribution: 'verified', transportRequestId: 'A-2' });
  });

  test('a request the transport refused for the budget stays not_sent, with its reason, also after storage', async () => {
    const record = Record.createRun({ runId: 'run-ns', pipelineName: 'Mine', task: 'T', steps: [{ task: 'x', input: 'none', models: ['A'] }] });
    const send = async () => { throw Object.assign(new Error('too long'), { code: 'context_full' }); };
    const result = await Engine.run({
      task: 'T', steps: [{ task: 'x', input: 'none', models: ['A'] }], send,
      onRequest: (entry) => Record.recordAttempt(record, entry), onResponse: (entry) => Record.recordAttempt(record, entry)
    });
    Record.finishRun(record, { stopReason: result.stopReason });
    expect(result.stopReason).toBe('context_full');
    expect(record.attempts[0]).toMatchObject({ state: 'not_sent', reason: 'context_full' });
    const revived = Record.revive(JSON.parse(JSON.stringify(Record.serialize(record))));
    expect(revived.attempts[0]).toMatchObject({ state: 'not_sent', reason: 'context_full' });
    expect(Record.exportRun(revived).attempts[0]).toMatchObject({ state: 'not_sent', reason: 'context_full' });
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
    expect(attempts[1].prompt).toBe(attempts[0].prompt);
    expect(attempts[1].instructions.correction).toBeUndefined();
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


// Version 2 (ТЗ 8.2): the registry and the snapshot keep their texts by reference; the texts are the record's own.
function recordedOwnerRun({ runId = 'run-owner', text = 'Тезис владельца' } = {}) {
  const record = Record.createRun({ runId, pipelineName: 'Mine', task: 'Задача T', steps: [{ ref: 'owner:evidence', kind: 'owner' }] });
  const steps = [{ ref: 'owner:evidence', kind: 'owner', task: 'Дай тезис', output: { format: 'json', requiredFields: ['/thesis'], artifacts: [{ id: 'thesis', name: 'Тезис', pointer: '/thesis' }] } }];
  return Engine.run({
    task: 'Задача T', steps, send: async () => ({ byModel: {} }), runId,
    provideOwnerResult: async () => JSON.stringify({ thesis: text }),
    putText: (value) => record.put(value), getText: (ref) => (ref && record.texts[ref] !== undefined ? record.texts[ref] : undefined),
    onRequest: (entry) => Record.recordAttempt(record, entry), onResponse: (entry) => Record.recordAttempt(record, entry)
  }).then((result) => { record.artifacts = result.artifacts; Record.finishRun(record, { stopReason: result.stopReason }); return { record, result }; });
}

describe('Custom run record, version 2 (8.2)', () => {
  test('a text that only the registry keeps (an owner answer has no attempt) survives serialize and reload', async () => {
    const storage = memoryStorage();
    const store = Record.createStore({ storage });
    const { record, result } = await recordedOwnerRun();
    expect(record.attempts).toEqual([]);
    expect(result.artifacts[0].content.answerRef).toBeTruthy();
    await store.save(record);
    const back = await store.load('run-owner');
    expect(Record.textOf(back, back.artifacts[0].content.answerRef)).toBe(JSON.stringify({ thesis: 'Тезис владельца' }));
    expect(Record.exportRun(back).artifacts[0]).toMatchObject({ id: 'thesis', name: 'Тезис', text: JSON.stringify({ thesis: 'Тезис владельца' }), source: { step: 'owner:evidence', participant: 'owner', visit: 1 } });
  });

  test('a new record is version 2; an attempt key is the step, participant, visit, attempt and phase', () => {
    const record = Record.createRun({ runId: 'k', pipelineName: 'Mine', task: 'T', steps: [{ ref: 'r1', kind: 'round', models: ['A'] }] });
    expect(record.version).toBe(2);
    const base = { ref: 'r1', participant: 'A', model: 'A', attempt: 1, phase: 'answer', prompt: 'p', parts: {} };
    Record.recordAttempt(record, { ...base, step: 0, visit: 1, state: 'sent' });
    Record.recordAttempt(record, { ...base, step: 0, visit: 2, state: 'sent' });
    Record.recordAttempt(record, { ...base, step: 0, visit: 2, phase: 'route', state: 'sent' });
    expect(record.attempts).toHaveLength(3);
    Record.recordAttempt(record, { ...base, step: 0, visit: 2, state: 'done', answer: 'a', accepted: true });
    expect(record.attempts[1]).toMatchObject({ state: 'done', accepted: true });
    expect(record.attempts[0].state).toBe('sent');
  });

  test('version 1 stays readable and exportable; without a snapshot it is history, not a resumable run', () => {
    const v1 = { version: 1, runId: 'old', pipelineName: 'Mine', startedAt: 1, finishedAt: 2, stopReason: 'steps_done', taskRef: 't1', steps: [],
      texts: { t1: 'Задача' }, attempts: [{ key: 'k', step: 0, model: 'A', attempt: 1, state: 'done', accepted: true, promptRef: null, answerRef: 'a1', parts: {} }] };
    const back = Record.revive(JSON.parse(JSON.stringify(v1)));
    expect(back.version).toBe(1);
    const exported = Record.exportRun(back);
    expect(exported).toMatchObject({ task: 'Задача', resumable: false, attempts: [expect.objectContaining({ state: 'done' })] });
  });

  test('the snapshot has the fields of 8.2 and keeps every text by reference; it is plain JSON', async () => {
    const { record, result } = await recordedOwnerRun();
    Record.setSnapshot(record, { schema: [{ ref: 'owner:evidence', kind: 'owner' }], runSettings: { semiAuto: false, maxAttempts: 2 }, state: result.state,
      routes: [], ownerAnswers: result.ownerAnswers });
    const snapshot = record.snapshot;
    // The registry is record.artifacts (5.3), not a second copy in the snapshot.
    expect(Object.keys(snapshot).sort()).toEqual(['chatBindings', 'continuationStack', 'current', 'decisions', 'dependencies', 'feedback', 'loopCounters', 'ownerAnswers', 'pc', 'pendingOwner', 'results', 'routes', 'runSettings', 'schema', 'taskRef', 'visits']);
    expect(snapshot.chatBindings).toEqual({});
    expect(snapshot.current).toMatchObject({ stepRef: null, phase: 'done' });
    expect(Record.canResume(record)).toBe(true);
    expect(JSON.parse(JSON.stringify(snapshot))).toEqual(snapshot);
  });

  test('serialize keeps the texts of the snapshot feedback; export resolves them with their sources', async () => {
    const { record, result } = await recordedOwnerRun();
    const feedbackText = 'Замечание по тезису';
    const ref = record.put(feedbackText);
    Record.setSnapshot(record, { schema: [], runSettings: {}, state: { pc: 'owner:evidence', visits: { 'owner:evidence': 1 }, feedback: { 'owner:evidence': [{ label: 'Владелец', source: { step: 0, visit: 1 }, textRef: ref, pointer: '' }] } }, routes: [], ownerAnswers: result.ownerAnswers });
    const stored = JSON.parse(JSON.stringify(Record.serialize(record)));
    const back = Record.revive(stored);
    expect(Record.textOf(back, back.snapshot.feedback['owner:evidence'][0].textRef)).toBe(feedbackText);
    expect(Record.exportRun(back).snapshot.feedback['owner:evidence'][0]).toMatchObject({ text: feedbackText, source: { step: 0, visit: 1 }, label: 'Владелец' });
  });
});

// The real adapter (chromeStorage) over a fake chrome.storage.local: its callbacks report a failure through chrome.runtime.lastError.
function chromeArea({ failGet = '', failSet = '', failRemove = '', throwOn = '', quotaBytes = Infinity, setFailFrom = Infinity } = {}) {
  const data = {};
  let setCalls = 0;
  const reply = (callback, error, value) => {
    globalThis.chrome = { runtime: { lastError: error ? { message: error } : undefined } };
    try { callback(value); } finally { globalThis.chrome = { runtime: {} }; }
  };
  return {
    data,
    setCalls: () => setCalls,
    get(key, callback) {
      if (throwOn === 'get') throw new Error('get threw');
      if (failGet) return reply(callback, failGet, {});
      return reply(callback, '', { [key]: data[key] });
    },
    set(items, callback) {
      if (throwOn === 'set') throw new Error('set threw');
      setCalls += 1;
      if (setCalls >= setFailFrom) return reply(callback, failSet || 'set failed', undefined);
      if (JSON.stringify(items).length > quotaBytes) return reply(callback, 'QUOTA_BYTES quota exceeded', undefined);
      Object.assign(data, JSON.parse(JSON.stringify(items)));
      return reply(callback, '', undefined);
    },
    remove(key, callback) {
      if (throwOn === 'remove') throw new Error('remove threw');
      if (failRemove) return reply(callback, failRemove, undefined);
      delete data[key];
      return reply(callback, '', undefined);
    }
  };
}

// The page path of a run (results.js): the checkpoint takes the state into the record and waits for the store.
function pageCheckpoint(record, store, steps) {
  return (state) => {
    Record.setArtifacts(record, state.artifacts);
    Record.setSnapshot(record, { schema: steps, runSettings: {}, state, current: state.current, routes: state.routes, ownerAnswers: state.ownerAnswers, pendingOwner: state.pendingOwner });
    return store.save(record);
  };
}

describe('Custom run record storage: the chrome.storage adapter rejects every failure (R03)', () => {
  const steps = [{ ref: 'S1', kind: 'round', input: 'none', models: ['A'] }, { ref: 'S2', kind: 'round', input: 'previous', models: ['B'] }];
  const oneRun = (runId, answer = 'a1') => recordedRun({ runId, steps: [{ task: 'x', input: 'none', models: ['A'] }], answers: { A: [answer] } });

  test('a successful write and read go through the adapter', async () => {
    const store = Record.createStore({ storage: Record.chromeStorage(chromeArea()) });
    const { record } = await oneRun('run-ok');
    await store.save(record);
    const back = await store.load('run-ok');
    expect(Record.textOf(back, back.attempts[0].answerRef)).toBe('a1');
  });

  test('a read the area refuses rejects; it is not an empty record', async () => {
    const store = Record.createStore({ storage: Record.chromeStorage(chromeArea({ failGet: 'get failed' })) });
    await expect(store.load('run-x')).rejects.toThrow('get failed');
    await expect(store.list()).rejects.toThrow('get failed');
  });

  test('a quota error on write rejects the save', async () => {
    const store = Record.createStore({ storage: Record.chromeStorage(chromeArea({ quotaBytes: 50 })) });
    const { record } = await oneRun('run-q');
    await expect(store.save(record)).rejects.toThrow('QUOTA_BYTES');
  });

  test('a refused remove rejects the save that removes an old run', async () => {
    const store = Record.createStore({ storage: Record.chromeStorage(chromeArea({ failRemove: 'remove failed' })), maxBytes: 6000 });
    const first = await recordedRun({ runId: 'run-1', steps: [{ task: 'x', input: 'none', models: ['A'] }], answers: { A: ['1'.repeat(2000)] } });
    await store.save(first.record);
    const big = await recordedRun({ runId: 'run-2', steps: [{ task: 'x', input: 'none', models: ['A'] }], answers: { A: ['2'.repeat(9000)] } });
    await expect(store.save(big.record)).rejects.toThrow('remove failed');
  });

  test('a synchronous throw of the area rejects the promise too', async () => {
    const { record } = await oneRun('run-t');
    await expect(Record.createStore({ storage: Record.chromeStorage(chromeArea({ throwOn: 'get' })) }).list()).rejects.toThrow('get threw');
    await expect(Record.createStore({ storage: Record.chromeStorage(chromeArea({ throwOn: 'set' })) }).save(record)).rejects.toThrow('set threw');
  });

  test('engine → page → adapter: a failed checkpoint before the first send sends nothing', async () => {
    const store = Record.createStore({ storage: Record.chromeStorage(chromeArea({ setFailFrom: 1 })) });
    const record = Record.createRun({ runId: 'run-cp', pipelineName: 'Mine', task: 'T', steps });
    const sent = [];
    const send = async (models) => { sent.push(models.slice()); return { byModel: Object.fromEntries(models.map((model) => [model, { text: 'a', status: 'SUCCESS' }])) }; };
    await expect(Engine.run({ task: 'T', steps, send, checkpoint: pageCheckpoint(record, store, steps) })).rejects.toThrow('checkpoint_failed');
    expect(sent).toEqual([]);
  });

  test('engine → page → adapter: a refused save of an answer already received sends no next request and makes no transition', async () => {
    // The checkpoint before the send of A writes two sets (the run, the index); the one after the answer of A is the third.
    const store = Record.createStore({ storage: Record.chromeStorage(chromeArea({ setFailFrom: 3 })) });
    const record = Record.createRun({ runId: 'run-ans', pipelineName: 'Mine', task: 'T', steps });
    const sent = [];
    const send = async (models) => { sent.push(models.slice()); return { byModel: Object.fromEntries(models.map((model) => [model, { text: 'a1', status: 'SUCCESS' }])) }; };
    await expect(Engine.run({ task: 'T', steps, send, checkpoint: pageCheckpoint(record, store, steps) })).rejects.toThrow('checkpoint_failed');
    expect(sent).toEqual([['A']]);
  });

  test('a refused save of the final checkpoint is not a success: the run rejects with checkpoint_failed', async () => {
    const counting = chromeArea();
    const store = Record.createStore({ storage: Record.chromeStorage(counting) });
    const probe = Record.createRun({ runId: 'run-probe', pipelineName: 'Mine', task: 'T', steps });
    const ok = async (models) => ({ byModel: Object.fromEntries(models.map((model) => [model, { text: 'a', status: 'SUCCESS' }])) });
    await Engine.run({ task: 'T', steps, send: ok, checkpoint: pageCheckpoint(probe, store, steps) });
    const total = counting.setCalls();
    // The last checkpoint writes the run and then the index: the failure starts with its run write.
    const failing = chromeArea({ setFailFrom: total - 1 });
    const failStore = Record.createStore({ storage: Record.chromeStorage(failing) });
    const record = Record.createRun({ runId: 'run-done', pipelineName: 'Mine', task: 'T', steps });
    await expect(Engine.run({ task: 'T', steps, send: ok, checkpoint: pageCheckpoint(record, failStore, steps) })).rejects.toThrow('checkpoint_failed');
  });
});
