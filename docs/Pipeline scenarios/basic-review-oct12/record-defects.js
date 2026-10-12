const Record = require(require('path').resolve(__dirname, '../../../disput/custom-run-record.js'));

(async () => {
  // Simulate Chrome invoking the callback while exposing lastError for the duration of the callback.
  const persisted = new Map();
  global.chrome = { runtime: { lastError: null } };
  const chromeArea = {
    get(key, callback) {
      global.chrome.runtime.lastError = { message: 'Quota exceeded' };
      callback({ [key]: persisted.get(key) });
      global.chrome.runtime.lastError = null;
    },
    set(values, callback) {
      global.chrome.runtime.lastError = { message: 'Quota exceeded' };
      callback(); // Failed Chrome writes do not persist the value.
      global.chrome.runtime.lastError = null;
    },
    remove(key, callback) {
      global.chrome.runtime.lastError = { message: 'Quota exceeded' };
      callback();
      global.chrome.runtime.lastError = null;
    }
  };
  const store = Record.createStore({ storage: Record.chromeStorage(chromeArea) });
  const checkpoint = Record.createRun({ runId: 'checkpoint-run', task: 'task' });
  Record.setSnapshot(checkpoint, { schema: [{ ref: 'r1' }], state: { pc: 'r1' } });
  const saveResult = await store.save(checkpoint);
  const loaded = await store.load('checkpoint-run');
  console.log('Chrome storage failure:', JSON.stringify({
    saveResolved: Boolean(saveResult),
    reloadedRecordExists: Boolean(loaded),
    runtimeLastError: 'Quota exceeded'
  }));

  const record = Record.createRun({ runId: 'export-run', task: 'task' });
  const answerRef = record.put('accepted answer');
  Record.recordAttempt(record, {
    step: 2, ref: 'route:choice', participant: 'reviewer-2', visit: 3, phase: 'route',
    model: 'Claude', attempt: 4, state: 'done', accepted: true,
    answer: '{"route":"go"}', prompt: 'Choose a route'
  });
  Record.setSnapshot(record, {
    schema: [],
    state: {
      pc: 'route:choice',
      results: [{ stepRef: 'r1', outcome: { A: { ok: true, textRef: answerRef } } }],
      current: { active: false, stepRef: 'route:choice', outcome: { A: { ok: true, textRef: answerRef } } }
    }
  });
  const exported = Record.exportRun(record);
  const attempt = exported.attempts[0];
  console.log('Exported snapshot reference:', JSON.stringify(exported.snapshot.results[0].outcome.A));
  console.log('Export contains texts table:', Object.hasOwn(exported, 'texts'));
  console.log('Exported attempt identity:', JSON.stringify({
    hasRef: Object.hasOwn(attempt, 'ref'),
    hasParticipant: Object.hasOwn(attempt, 'participant'),
    hasVisit: Object.hasOwn(attempt, 'visit'),
    hasPhase: Object.hasOwn(attempt, 'phase'),
    exportedKeys: Object.keys(attempt)
  }));
})();
