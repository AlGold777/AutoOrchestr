'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createFakeIndexedDB, installKeyRange } = require('./thecycle-fake-idb.js');
require('../disput/custom-engine.js');
require('../disput/basic-schema.js');
const { createStateStore } = require('../disput/thecycle/state-store.js');
const { createBasicAdapter } = require('../disput/thecycle/basic-adapter.js');
const { createController } = require('../disput/thecycle/controller.js');
const context = require('../disput/thecycle/circle-context.js');
const policyApi = require('../disput/thecycle/circle-policy.js');
const { createCircleRunner } = require('../disput/thecycle/circle-runtime.js');
const { createBackupGate } = require('../disput/thecycle/backup-gate.js');
installKeyRange();
const clone = (v) => JSON.parse(JSON.stringify(v));
const json = (o) => JSON.stringify(o);
const REF = 'cycle=1 step=1 model=GPT';

// analystAnswers: queue of texts the model returns to each analyst request, in order.
async function fixture({ analystAnswers = [], withAnalyst = true, workText = null, policyOverride = null } = {}) {
  const indexedDB = createFakeIndexedDB();
  const store = await createStateStore({ indexedDB });
  const values = new Map(), prompts = [], metadata = new Map(), begins = []; let seq = 0, bridgeRun = null, backups = 0;
  const storage = { async get(k) { return { [k]: values.get(k) }; }, async set(o) { for (const [k, v] of Object.entries(o)) values.set(k, clone(v)); } };
  const bridge = {
    capture: () => ({ models: ['GPT'], errors: [], schema: { schemaVersion: 1, origin: 'user', run: { policy: 'manual' }, steps: [{ ref: 'r1', kind: 'round', models: [{ name: 'GPT' }] }] } }),
    accept: () => ({ ok: true }), roleText: () => '',
    begin({ runId, schema }) { bridgeRun = runId; begins.push(schema.steps[0].input === 'none' ? 'analyst' : 'work'); }, end() { bridgeRun = null; },
    async send(models, byModel, meta) {
      const text = byModel.GPT;
      prompts.push(text);
      if (text.includes('Ты управляешь исследованием')) {
        const next = analystAnswers.shift();
        return { byModel: { GPT: { text: next, status: 'SUCCESS', answered: true } } };
      }
      return { byModel: { GPT: { text: workText || 'Work evidence ' + prompts.length, status: 'SUCCESS', answered: true } } };
    }
  };
  const gate = createBackupGate({ clock: () => 1000 + backups, metadata: {
    async get(id) { return metadata.get(id) || null; },
    async put(id, rev, v) { if ((metadata.get(id)?.revision || 0) !== rev) return false; metadata.set(id, clone(v)); return true; } },
    backup: { async save(key, { requiredCommitId }) { backups++; return { key, verified: true, packetCommitId: requiredCommitId }; } } });
  const runner = createCircleRunner({ bridge, storage, activeStore: { async createActiveStateStore() { return { store, database: 'test', close() {} }; } },
    controllerApi: { createController }, adapterApi: { createBasicAdapter }, contextApi: context, policyApi: withAnalyst ? (policyOverride || policyApi) : null,
    createBackup: async () => ({ gate, close() {} }), uuid: () => String(++seq) });
  return { runner, store, indexedDB, prompts, begins };
}
const isAnalyst = (t) => t.includes('Ты управляешь исследованием');

test('work -> analyst CONTINUE -> work -> analyst COMPLETE: COMPLETED with finalStatus PARTIAL', async () => {
  const x = await fixture({ analystAnswers: [
    'Решение: ' + json({ action: 'CONTINUE', reason: 'ещё один круг', refs: [REF] }),
    json({ action: 'COMPLETE', reason: 'готово', refs: ['cycle=3 step=1 model=GPT'] })
  ] });
  const r = await x.runner.start({ task: 'Solve it', maxCalls: 10 });
  assert.equal(r.state.phase, 'COMPLETED'); assert.equal(r.state.finalStatus, 'PARTIAL');
  assert.deepEqual(x.prompts.map(isAnalyst), [false, true, false, true]);
  assert.deepEqual(x.begins, ['work', 'analyst', 'work', 'analyst']);
  assert.match(x.prompts[1], /ИСХОДНАЯ ЗАДАЧА:\nSolve it/); assert.match(x.prompts[1], /Work evidence 1/);
  assert.match(x.prompts[1], /использовано вызовов 1 из 10, осталось 9/);
  // the work cycle after the analyst sees only work evidence, never the analyst answer
  assert.match(x.prompts[2], /Work evidence 1/); assert.doesNotMatch(x.prompts[2], /ещё один круг/);
  assert.equal(r.state.budget.usedCalls, 4); assert.equal(r.state.lastDecision.action, 'COMPLETE');
  assert.equal(r.state.lastDecision.detail.action, 'COMPLETE'); assert.deepEqual(r.state.lastDecision.detail.refs, ['cycle=3 step=1 model=GPT']);
  assert.equal(r.outcomes.at(-1).outcome, 'DECISION');
});

test('decision detail is stored on the packet and survives reopening the database', async () => {
  const x = await fixture({ analystAnswers: [json({ action: 'COMPLETE', reason: 'ok', refs: [REF] })] });
  const r = await x.runner.start({ task: 'Solve it', maxCalls: 10 });
  const reopened = await createStateStore({ indexedDB: x.indexedDB });
  const state = await reopened.load(r.researchId);
  assert.equal(state.phase, 'COMPLETED'); assert.equal(state.finalStatus, 'PARTIAL');
  assert.deepEqual(state.lastDecision.detail, { action: 'COMPLETE', refs: [REF], reason: 'ok' });
  const work = await reopened.getPacket(r.researchId, 1), analyst = await reopened.getPacket(r.researchId, 2);
  assert.equal(work.decision.action, 'CONTINUE'); assert.equal(work.decision.reason, 'ANALYST_NEXT');
  assert.equal(analyst.decision.action, 'COMPLETE'); assert.deepEqual(analyst.decision.detail.refs, [REF]);
});

test('format errors pause with DECISION_FORMAT_INVALID and are never retried', async () => {
  for (const answer of ['просто текст', json({ action: 'COMPLETE', reason: 'r', refs: [] }), json({ action: 'CONTINUE', reason: 'r', refs: ['cycle=9 step=1 model=GPT'] })]) {
    const x = await fixture({ analystAnswers: [answer, json({ action: 'CONTINUE', reason: 'r', refs: [] })] });
    const r = await x.runner.start({ task: 'Solve it', maxCalls: 10 });
    assert.equal(r.state.phase, 'PAUSED'); assert.equal(r.state.lastDecision.reason, 'DECISION_FORMAT_INVALID');
    assert.ok(r.state.lastDecision.detail.errors.length >= 1);
    assert.equal(x.prompts.length, 2); // work + one analyst request only
  }
});

test('WAIT_OWNER pauses with the question; CHANGE_STRATEGY and VERIFY are not implemented yet', async () => {
  const cases = [
    [{ action: 'WAIT_OWNER', reason: 'нужен выбор', refs: [], question: 'A или B?' }, 'WAIT_OWNER'],
    [{ action: 'CHANGE_STRATEGY', reason: 'r', refs: [], schema: { steps: [] } }, 'NOT_IMPLEMENTED_YET'],
    [{ action: 'VERIFY', reason: 'r', refs: [REF], claim: 'c', procedure: [{ id: 'p1', check: 'x' }] }, 'NOT_IMPLEMENTED_YET']
  ];
  for (const [answer, reason] of cases) {
    const x = await fixture({ analystAnswers: [json(answer)] });
    const r = await x.runner.start({ task: 'Solve it', maxCalls: 10 });
    assert.equal(r.state.phase, 'PAUSED'); assert.equal(r.state.lastDecision.reason, reason);
    assert.equal(r.state.lastDecision.detail.action, answer.action);
    if (answer.question) assert.equal(r.state.lastDecision.detail.question, 'A или B?');
    assert.equal(r.state.finalStatus, undefined);
    assert.equal(x.prompts.length, 2);
  }
});

test('budget must cover a work cycle plus the analyst', async () => {
  const none = await fixture();
  const tight = await none.runner.start({ task: 'Solve it', maxCalls: 1 });
  assert.equal(none.prompts.length, 0); assert.equal(tight.state.phase, 'PAUSED'); assert.equal(tight.state.lastDecision.reason, 'BUDGET_INSUFFICIENT_FOR_CYCLE');
  // 3 calls: work + analyst CONTINUE, then 1 left: the next work cycle cannot be followed by the analyst
  const x = await fixture({ analystAnswers: [json({ action: 'CONTINUE', reason: 'more', refs: [] })] });
  const r = await x.runner.start({ task: 'Solve it', maxCalls: 3 });
  assert.equal(x.prompts.length, 2); assert.equal(r.state.phase, 'PAUSED'); assert.equal(r.state.lastDecision.reason, 'BUDGET_INSUFFICIENT_FOR_CYCLE');
});

test('without the policy module Circle keeps the fixed policy (no analyst)', async () => {
  const x = await fixture({ withAnalyst: false });
  const r = await x.runner.start({ task: 'Solve it', maxCalls: 2 });
  assert.equal(x.prompts.length, 2); assert.ok(x.prompts.every((t) => !isAnalyst(t))); assert.equal(r.state.phase, 'PAUSED');
});

test('analyst summary is truncated like the work context: within 0.8 of maxPromptChars, with a mark', async () => {
  const x = await fixture({ workText: 'W'.repeat(30000), analystAnswers: [json({ action: 'COMPLETE', reason: 'ok', refs: [REF] })] });
  const r = await x.runner.start({ task: 'Solve it', maxCalls: 10, maxPromptChars: 8000 });
  assert.equal(r.state.phase, 'COMPLETED');
  const analyst = x.prompts.find(isAnalyst);
  assert.ok(analyst.length < 6400 + 300, String(analyst.length)); // the adapter adds its own suffix to the task assert.match(analyst, /\[TRUNCATED\]/);
  assert.match(analyst, /ДОСТУПНЫЕ ДЕЙСТВИЯ:/);
});

test('a decision the store refuses to record pauses instead of sticking in EVALUATE', async () => {
  const bad = { ...policyApi, createPolicy: (o) => { const p = policyApi.createPolicy(o); return async (a) => { const d = await p(a); return d.action === 'COMPLETE' ? { ...d, detail: { ...d.detail, junk: 1 } } : d; }; } };
  const x = await fixture({ policyOverride: bad, analystAnswers: [json({ action: 'COMPLETE', reason: 'ok', refs: [REF] })] });
  const r = await x.runner.start({ task: 'Solve it', maxCalls: 10 });
  assert.equal(r.state.phase, 'PAUSED'); assert.equal(r.state.lastDecision.reason, 'DECISION_RECORD_INVALID');
  assert.equal(r.state.finalStatus, undefined);
});
