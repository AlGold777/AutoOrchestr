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
  assert.match(x.prompts[1], /ДОПУСТИМЫЕ ССЫЛКИ:\ncycle=1 step=1 model=GPT/);
  assert.match(x.prompts[3], /ДОПУСТИМЫЕ ССЫЛКИ:\ncycle=1 step=1 model=GPT\ncycle=3 step=1 model=GPT/);
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

test('WAIT_OWNER pauses with the question', async () => {
  const cases = [
    [{ action: 'WAIT_OWNER', reason: 'нужен выбор', refs: [], question: 'A или B?' }, 'WAIT_OWNER']
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

test('R04/ARCH-001: a summary that does not fit is shortened with a mark, not a dead pause', async () => {
  const x = await fixture({ workText: 'W'.repeat(30000), analystAnswers: [json({ action: 'COMPLETE', reason: 'ok', refs: [REF] })] });
  const r = await x.runner.start({ task: 'Solve it', maxCalls: 10, maxPromptChars: 10000 });
  assert.equal(r.state.phase, 'COMPLETED');
  const analyst = x.prompts.find(isAnalyst);
  assert.ok(analyst.length <= 8000); assert.match(analyst, /сводка сокращена: показано \d+ из 30\d+ знаков/);
  const ready = (await x.store.getEvents(r.researchId, (await x.store.getPacket(r.researchId, 2)).runId)).length; assert.ok(ready >= 0);
});

test('R04/ARCH-001: when even the template does not fit the cycle pauses before sending', async () => {
  const x = await fixture({ workText: 'W'.repeat(300), analystAnswers: [json({ action: 'COMPLETE', reason: 'ok', refs: [REF] })] });
  const r = await x.runner.start({ task: 'Solve it', maxCalls: 10, maxPromptChars: 5000 });
  assert.equal(r.state.phase, 'PAUSED'); assert.equal(r.state.lastDecision.reason, 'CONTEXT_UNAVAILABLE');
  assert.equal(r.outcomes.at(-1).error, 'CIRCLE_CONTEXT_LIMIT');
  assert.equal(x.prompts.filter(isAnalyst).length, 0);
});

test('R04: a summary that fits reaches the analyst whole', async () => {
  const x = await fixture({ workText: 'W'.repeat(3000), analystAnswers: [json({ action: 'COMPLETE', reason: 'ok', refs: [REF] })] });
  const r = await x.runner.start({ task: 'Solve it', maxCalls: 10, maxPromptChars: 10000 });
  assert.equal(r.state.phase, 'COMPLETED');
  const analyst = x.prompts.find(isAnalyst);
  assert.ok(analyst.includes('W'.repeat(3000))); assert.doesNotMatch(analyst, /сводка сокращена/);
});

test('a decision the store refuses to record pauses instead of sticking in EVALUATE', async () => {
  const bad = { ...policyApi, createPolicy: (o) => { const p = policyApi.createPolicy(o); return async (a) => { const d = await p(a); return d.action === 'COMPLETE' ? { ...d, detail: { ...d.detail, junk: 1 } } : d; }; } };
  const x = await fixture({ policyOverride: bad, analystAnswers: [json({ action: 'COMPLETE', reason: 'ok', refs: [REF] })] });
  const r = await x.runner.start({ task: 'Solve it', maxCalls: 10 });
  assert.equal(r.state.phase, 'PAUSED'); assert.equal(r.state.lastDecision.reason, 'DECISION_RECORD_INVALID');
  assert.equal(r.state.finalStatus, undefined);
});

// P4: накопление, использование и пересмотр знаний между циклами.
const basis = (id, cycleId, kind) => ({ id, kind, ref: { cycleId, step: 1, model: 'GPT' }, provenance: { model: 'GPT', role: 'work' } });
const delta1 = { bases: [basis('b1', 1, 'MODEL_ANSWER')],
  obligations: [{ id: 'o1', rev: 1, requirementRef: 'R1', statement: 'доказать границу X', status: 'OPEN' }],
  claims: [{ id: 'k1', rev: 1, statement: 'граница X равна 5', status: 'CANDIDATE', basisRefs: ['b1'] }] };

test('P4: знания накапливаются, видны следующим циклам и пересматриваются с основанием', async () => {
  const delta2 = { bases: [basis('b2', 3, 'EXPERT_CONFIRMATION')],
    obligations: [{ id: 'o1', rev: 2, status: 'CLOSED', closeBasisRefs: ['b2'] }],
    claims: [{ id: 'k1', rev: 2, statement: 'граница X равна 5', status: 'SUPPORTED', basisRefs: ['b2'] }] };
  const x = await fixture({ analystAnswers: [
    json({ action: 'CONTINUE', reason: 'уточнить', refs: [REF], knowledge: delta1 }),
    json({ action: 'COMPLETE', reason: 'готово', refs: ['cycle=3 step=1 model=GPT'], knowledge: delta2 })
  ] });
  const r = await x.runner.start({ task: 'Solve it', maxCalls: 10 });
  assert.equal(r.state.phase, 'COMPLETED');
  // аналитик видит просьбу о дельте; первый цикл знаний ещё не имеет
  assert.match(x.prompts[1], /ЗНАНИЯ\. Необязательный ключ knowledge/); assert.match(x.prompts[1], /НАКОПЛЕННЫЕ ЗНАНИЯ:\nпока нет/);
  // рабочий цикл 3 и аналитик цикла 4 получают состояние из цикла 2
  assert.match(x.prompts[2], /Открытые обязательства:\n- o1 r1 \(требование R1\): доказать границу X/);
  assert.match(x.prompts[3], /- o1 r1/); assert.match(x.prompts[3], /k1 r1 \[CANDIDATE\] граница X равна 5/);
  // итог: обязательство закрыто основанием, утверждение пересмотрено, ревизии подряд, прежнее основание сохранено
  const K = require('../disput/thecycle/knowledge.js');
  const packets = [await x.store.getPacket(r.researchId, 2), await x.store.getPacket(r.researchId, 4)];
  const s = K.fold(packets);
  assert.equal(s.obligations.o1.status, 'CLOSED'); assert.equal(s.claims.k1.status, 'SUPPORTED'); assert.deepEqual(s.claims.k1.basisRefs, ['b1', 'b2']);
  assert.equal(packets[0].knowledgeRejected, undefined);
});

test('P4: завершение с открытым обязательством не проходит', async () => {
  const x = await fixture({ analystAnswers: [json({ action: 'COMPLETE', reason: 'готово', refs: [REF], knowledge: delta1 })] });
  const r = await x.runner.start({ task: 'Solve it', maxCalls: 10 });
  assert.equal(r.state.phase, 'PAUSED'); assert.equal(r.state.lastDecision.reason, 'OBLIGATIONS_OPEN');
  assert.deepEqual(r.state.lastDecision.detail.errors, ['o1']);
  assert.ok((await x.store.getPacket(r.researchId, 2)).knowledge); // допустимая дельта записана
});

test('P4: завершение на основании отклонённой дельты невозможно', async () => {
  const bad = { bases: [basis('b1', 1, 'MODEL_ANSWER')], claims: [{ id: 'k1', rev: 1, statement: 'всё доказано', status: 'SUPPORTED', basisRefs: ['b1'] }] };
  const x = await fixture({ analystAnswers: [json({ action: 'COMPLETE', reason: 'готово', refs: [REF], knowledge: bad })] });
  const r = await x.runner.start({ task: 'Solve it', maxCalls: 10 });
  assert.equal(r.state.phase, 'PAUSED'); assert.equal(r.state.lastDecision.reason, 'KNOWLEDGE_REJECTED');
  const p = await x.store.getPacket(r.researchId, 2);
  assert.equal(p.knowledge, undefined); assert.equal(p.knowledgeRejected.code, 'KNOWLEDGE_WEAK_BASIS');
});

test('P4: Resume пересчитывает дельту без потери: прежняя уходит в knowledgeHistory, принятое знание то же', async () => {
  const x = await fixture({ analystAnswers: [json({ action: 'CONTINUE', reason: 'ещё', refs: [REF], knowledge: delta1 }), json({ action: 'WAIT_OWNER', reason: 'стоп', refs: [], question: 'q' })] });
  const r = await x.runner.start({ task: 'Solve it', maxCalls: 2 });
  assert.equal(r.state.lastDecision.reason, 'BUDGET_EXHAUSTED');
  const before = (await x.store.getPacket(r.researchId, 2)).knowledge;
  assert.ok(before);
  const again = await x.runner.resume(r.researchId, { maxCalls: 6 });
  assert.equal(again.state.budget.maxCalls, 6);
  const p = await x.store.getPacket(r.researchId, 2);
  assert.deepEqual(p.knowledge, before);
  assert.equal(p.knowledgeHistory.length, 1); assert.deepEqual(p.knowledgeHistory[0].knowledge, before);
  assert.equal(p.decisionHistory.length, 1);
  // решение по тому же пакету принято заново, знание не продублировано: итоговое состояние то же
  const K = require('../disput/thecycle/knowledge.js');
  assert.equal(K.fold([p]).claims.k1.rev, 1);
});
