'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const K = require('../disput/thecycle/knowledge.js');

const basis = (id, cycle, kind = 'MODEL_ANSWER', extra = {}) => ({ id, kind, ref: { cycleId: cycle, runId: 'r' + cycle, eventId: 'e' }, provenance: { model: 'M', role: 'work' }, ...extra });
const pk = (cycleId, knowledge) => ({ cycleId, knowledge });
const code = (fn) => { try { fn(); } catch (e) { return e.code; } return null; };

const c1 = pk(1, {
  knowledgeFormat: 1,
  bases: [basis('b1', 1, 'REPRODUCIBLE_CHECK')],
  obligations: [{ id: 'o1', rev: 1, requirementRef: 'R1', status: 'OPEN' }],
  claims: [{ id: 'k1', rev: 1, statement: 'A верно', status: 'SUPPORTED', basisRefs: ['b1'] }]
});

test('старое исследование без knowledge читается как пустое состояние', () => {
  const s = K.fold([{ cycleId: 1 }, { cycleId: 2, knowledge: null }]);
  assert.deepEqual(s.claims, {});
  assert.equal(K.openObligations(s).length, 0);
});

test('верный результат сохраняется при null/молчании/ответе модели без основания', () => {
  const s = K.fold([c1, pk(2, {}), pk(3, { claims: [{ id: 'k1', rev: 2, statement: 'A верно', status: 'REFUTED', basisRefs: [] }] }).knowledge === undefined ? pk(3, {}) : pk(3, {})]);
  assert.equal(s.claims.k1.status, 'SUPPORTED');
  assert.equal(code(() => K.fold([c1, pk(2, { claims: [{ id: 'k1', rev: 2, statement: 'A верно', status: 'REFUTED', basisRefs: [] }] })])), 'KNOWLEDGE_NO_BASIS');
});

test('ложное опровержение ответом модели даёт максимум спор; прежнее основание остаётся', () => {
  const refute = pk(2, { bases: [basis('b2', 2)], claims: [{ id: 'k1', rev: 2, statement: 'A верно', status: 'REFUTED', basisRefs: ['b2'] }] });
  assert.equal(code(() => K.fold([c1, refute])), 'KNOWLEDGE_WEAK_BASIS');
  const dispute = pk(2, { bases: [basis('b2', 2)], claims: [{ id: 'k1', rev: 2, statement: 'A верно', status: 'DISPUTED', basisRefs: ['b2'] }] });
  const s = K.fold([c1, dispute]);
  assert.equal(s.claims.k1.status, 'DISPUTED');
  assert.deepEqual(s.claims.k1.basisRefs, ['b1', 'b2']);
});

test('реальное опровержение (воспроизводимая проверка) принимается', () => {
  const real = pk(2, { bases: [basis('b2', 2, 'REPRODUCIBLE_CHECK')], claims: [{ id: 'k1', rev: 2, statement: 'A верно', status: 'REFUTED', basisRefs: ['b2'] }] });
  assert.equal(K.fold([c1, real]).claims.k1.status, 'REFUTED');
});

test('повторное основание из прошлого цикла не обосновывает смену статуса', () => {
  const again = pk(2, { claims: [{ id: 'k1', rev: 2, statement: 'A верно', status: 'DISPUTED', basisRefs: ['b1'] }] });
  assert.equal(code(() => K.fold([c1, again])), 'KNOWLEDGE_NO_BASIS');
});

test('открытое обязательство не исчезает; закрытие требует основание; исходное нельзя снять', () => {
  assert.equal(K.openObligations(K.fold([c1, pk(2, {}), pk(3, {})])).length, 1);
  assert.equal(code(() => K.fold([c1, pk(2, { obligations: [{ id: 'o1', rev: 2, status: 'CLOSED', closeBasisRefs: [] }] })])), 'KNOWLEDGE_NO_BASIS');
  assert.equal(code(() => K.fold([c1, pk(2, { obligations: [{ id: 'o1', rev: 2, status: 'WITHDRAWN', reason: 'лишнее' }] })])), 'KNOWLEDGE_OWNER_ONLY');
  const closed = pk(2, { bases: [basis('b2', 2, 'EXPERT_CONFIRMATION')], obligations: [{ id: 'o1', rev: 2, status: 'CLOSED', closeBasisRefs: ['b2'] }] });
  assert.equal(K.openObligations(K.fold([c1, closed])).length, 0);
});

test('производное обязательство требует происхождение; модель может снять только своё производное', () => {
  const bad = pk(2, { obligations: [{ id: 'o2', rev: 1, status: 'OPEN' }] });
  assert.equal(code(() => K.fold([c1, bad])), 'KNOWLEDGE_BAD_REF');
  const derived = pk(2, { obligations: [{ id: 'o2', rev: 1, status: 'OPEN', derivedFrom: 'o1', derivationReason: 'нужна проверка границ' }] });
  const w = pk(3, { obligations: [{ id: 'o2', rev: 2, status: 'WITHDRAWN', reason: 'дубль o1' }] });
  assert.equal(K.fold([c1, derived, w]).obligations.o2.status, 'WITHDRAWN');
});

test('частичное основание сохраняется как частичное и не поддерживает SUPPORTED', () => {
  const partial = pk(2, { bases: [basis('p1', 2, 'EXPERT_CONFIRMATION', { partial: true })] });
  const s = K.fold([c1, partial]);
  assert.equal(K.partialBases(s).length, 1);
  const weak = pk(2, { bases: [basis('p1', 2, 'EXPERT_CONFIRMATION', { partial: true })], claims: [{ id: 'k2', rev: 1, statement: 'B', status: 'SUPPORTED', basisRefs: ['p1'] }] });
  assert.equal(code(() => K.fold([c1, weak])), 'KNOWLEDGE_WEAK_BASIS');
});

test('висящие ссылки, ревизии и будущие циклы отклоняются', () => {
  assert.equal(code(() => K.fold([pk(1, { claims: [{ id: 'k', rev: 1, statement: 'x', status: 'CANDIDATE', basisRefs: ['нет'] }] })])), 'KNOWLEDGE_BAD_REF');
  assert.equal(code(() => K.fold([pk(1, { bases: [basis('b', 5)] })])), 'KNOWLEDGE_BAD_REF');
  assert.equal(code(() => K.fold([c1, pk(2, { claims: [{ id: 'k1', rev: 5, statement: 'x', status: 'SUPPORTED', basisRefs: ['b1'] }] })])), 'KNOWLEDGE_REV_INVALID');
});

test('новая ревизия утверждения помечает зависимые; смена версии задачи помечает, но не стирает', () => {
  const dep = pk(2, { claims: [{ id: 'k2', rev: 1, statement: 'B из A', status: 'CANDIDATE', basisRefs: [], dependsOn: ['k1:1'] }] });
  const rev = pk(3, { bases: [basis('b3', 3, 'OWNER_EVIDENCE')], claims: [{ id: 'k1', rev: 2, statement: 'A верно при X', status: 'SUPPORTED', basisRefs: ['b3'] }] });
  const s = K.fold([c1, dep, rev]);
  assert.deepEqual(s.needsReassessment, ['claim:k2']);
  const v = K.fold([c1, dep], [{ taskVersion: 2, atCycle: 2 }]);
  assert.equal(v.taskVersion, 2);
  assert.ok(v.needsReassessment.includes('obligation:o1') && v.needsReassessment.includes('claim:k1'));
  assert.equal(v.claims.k1.status, 'SUPPORTED');
});

test('формат новее известного не активируется; неизвестные ключи отклоняются', () => {
  assert.equal(code(() => K.fold([pk(1, { knowledgeFormat: 2 })])), 'KNOWLEDGE_FORMAT_UNSUPPORTED');
  assert.equal(code(() => K.fold([pk(1, { лишнее: [] })])), 'KNOWLEDGE_SHAPE_INVALID');
});

test('формально корректная, но ложная ссылка принимается: код не объявляет истину', () => {
  const lie = pk(1, { bases: [basis('b1', 1, 'EXPERT_CONFIRMATION')], claims: [{ id: 'k', rev: 1, statement: '2+2=5', status: 'SUPPORTED', basisRefs: ['b1'] }] });
  assert.equal(K.fold([lie]).claims.k.status, 'SUPPORTED');
});
