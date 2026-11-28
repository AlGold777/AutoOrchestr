'use strict';
// P3: дельта знаний пишется в пакет вместе с решением; недопустимая отклоняется целиком; снимок с формат новее не восстанавливается.
const test = require('node:test');
const assert = require('node:assert/strict');
const { createFakeIndexedDB, installKeyRange } = require('./thecycle-fake-idb.js');
const { createStateStore } = require('../disput/thecycle/state-store.js');
const { validate } = require('../disput/thecycle/restore-service.js');
installKeyRange();

async function cycle1() {
  const store = await createStateStore({ indexedDB: createFakeIndexedDB() });
  await store.createResearch({ researchId: 'r', task: 't', pipelineRef: 'p', maxCalls: 5 });
  const tok = await store.acquire({ researchId: 'r', ownerId: 'o' });
  const base = { researchId: 'r', runId: 'r:1', cycleId: 1 };
  let s = await store.load('r');
  await store.prepareRun(tok, { expectedVersion: s.stateVersion, runId: 'r:1', cycleId: 1, pipelineRef: 'p', maxCalls: 1 });
  const journal = store.journalFor(tok);
  await journal({ type: 'RUN_INTENT', ...base, maxCalls: 1 });
  await journal({ type: 'DISPATCH_INTENT', ...base, batchId: 'b1', models: ['GPT'] });
  await journal({ type: 'DISPATCH_RESPONSE', ...base, batchId: 'b1' });
  await journal({ type: 'RUN_RESULT', ...base, report: { ...base, status: 'PIPELINE_COMPLETE', unresolvedBatchIds: [], steps: [{ outcome: { GPT: { ok: true, text: 'x' } } }] } });
  s = await store.load('r');
  await store.commitPacket(tok, { expectedVersion: s.stateVersion, runId: 'r:1' });
  return { store, tok };
}
const delta = { bases: [{ id: 'b1', kind: 'REPRODUCIBLE_CHECK', ref: { cycleId: 1 }, provenance: { model: 'GPT', role: 'work' } }],
  claims: [{ id: 'k1', rev: 1, statement: 'A', status: 'SUPPORTED', basisRefs: ['b1'] }] };

test('решение записывает допустимую дельту в пакет', async () => {
  const { store, tok } = await cycle1();
  const s = await store.load('r');
  await store.decide(tok, { expectedVersion: s.stateVersion, action: 'CONTINUE', reason: 'r', detail: { action: 'CONTINUE', knowledge: delta } });
  const p = await store.getPacket('r', 1);
  assert.equal(p.knowledge.knowledgeFormat, 1);
  assert.equal(p.knowledge.claims[0].id, 'k1');
  assert.equal(p.knowledgeRejected, undefined);
  assert.equal((await store.load('r')).lastDecision.detail.knowledge, undefined);
});

test('недопустимая дельта отклоняется целиком, решение проходит', async () => {
  const { store, tok } = await cycle1();
  const s = await store.load('r');
  const bad = { claims: [{ id: 'k1', rev: 1, statement: 'A', status: 'REFUTED', basisRefs: [] }] };
  const next = await store.decide(tok, { expectedVersion: s.stateVersion, action: 'CONTINUE', reason: 'r', detail: { knowledge: bad } });
  const p = await store.getPacket('r', 1);
  assert.equal(p.knowledge, undefined);
  assert.equal(p.knowledgeRejected.code, 'KNOWLEDGE_NO_BASIS');
  assert.equal(next.phase, 'READY');
});

const snap = (knowledge) => ({ format: 'thecycle-idb-snapshot', version: 1, databaseVersion: 1,
  stores: { research: [{ researchId: 'r', stateVersion: 0, phase: 'READY', lastCommittedPacket: 1, budget: { maxCalls: 3, usedCalls: 1 } }],
    control: [], runs: [], events: [], packets: [{ researchId: 'r', cycleId: 1, knowledge }] } });

test('restore: знания согласованы или снимок отвергается', () => {
  assert.doesNotThrow(() => validate(snap({ knowledgeFormat: 1, ...delta })));
  assert.doesNotThrow(() => validate(snap(undefined)));
  assert.throws(() => validate(snap({ knowledgeFormat: 2 })), /RESTORE_KNOWLEDGE_UNSUPPORTED/);
  assert.throws(() => validate(snap({ claims: [{ id: 'k', rev: 9, statement: 'x', status: 'CANDIDATE', basisRefs: [] }] })), /RESTORE_KNOWLEDGE_INVALID/);
});
