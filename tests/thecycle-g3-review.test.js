'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createFakeIndexedDB, installKeyRange } = require('./thecycle-fake-idb.js');
require('../disput/custom-engine.js');
require('../disput/basic-schema.js');
const { createStateStore } = require('../disput/thecycle/state-store.js');
const { createBasicAdapter } = require('../disput/thecycle/basic-adapter.js');
const { parseDecision, buildAnalystSchema } = require('../disput/thecycle/circle-policy.js');
installKeyRange();

const report = { steps: [{ outcome: { GPT: { ok: true, text: 'a' } } }] };
const ctx = { lastCommittedPacket: 1, packets: new Map([[1, report]]) };
const REF = 'cycle=1 step=1 model=GPT';

test('refs: more than 50 or duplicates are a format error', () => {
  const dup = parseDecision(JSON.stringify({ action: 'CONTINUE', reason: 'r', refs: [REF, REF] }), ctx);
  assert.equal(dup.ok, false); assert.match(dup.errors.join('\n'), /refs/);
  const many = parseDecision(JSON.stringify({ action: 'CONTINUE', reason: 'r', refs: Array.from({ length: 51 }, () => REF) }), ctx);
  assert.equal(many.ok, false);
  assert.equal(parseDecision(JSON.stringify({ action: 'CONTINUE', reason: 'r', refs: [REF] }), ctx).ok, true);
});

test('question: longer than 2000 characters is a format error', () => {
  const mk = (q) => parseDecision(JSON.stringify({ action: 'WAIT_OWNER', reason: 'r', refs: [], question: q }), ctx);
  assert.equal(mk('q'.repeat(2000)).ok, true);
  const r = mk('q'.repeat(2001)); assert.equal(r.ok, false); assert.match(r.errors.join('\n'), /question/);
});

test('analyst schema passes the adapter even when the work schema has defaults.roundTask and strict length', () => {
  const adapter = createBasicAdapter({ availableModels: ['GPT'], isRole: () => true, roleText: () => '', accept: () => ({ ok: true }), journal: async () => {}, send: async () => ({}) });
  const work = { schemaVersion: 1, origin: 'user', defaults: { roundTask: 'Общая задача раунда' },
    run: { policy: 'auto', maxWords: 300, strictLength: true, repeat: { count: 2 }, stopMarks: [] },
    steps: [{ ref: 'r1', kind: 'round', models: [{ name: 'GPT' }] }] };
  assert.equal(adapter.validate(work).ok, false, 'work schema itself is not valid for input:none');
  const s = buildAnalystSchema(work);
  assert.equal(s.defaults, undefined); assert.equal(s.run.strictLength, false); assert.equal(s.run.repeat, undefined);
  assert.equal(s.run.policy, 'auto');
  const v = adapter.validate(s); assert.equal(v.ok, true, JSON.stringify(v.errors));
  assert.equal(work.defaults.roundTask, 'Общая задача раунда');
});

async function ready() {
  const store = await createStateStore({ indexedDB: createFakeIndexedDB() });
  await store.createResearch({ researchId: 'r', task: 't', pipelineRef: 'p', maxCalls: 5 });
  const fence = await store.acquire({ researchId: 'r', ownerId: 'o' });
  return { store, fence };
}

test('finalStatus only with COMPLETE; VERIFIED_SOLUTION only with a verification record', async () => {
  for (const args of [
    { action: 'PAUSE', finalStatus: 'PARTIAL' },
    { action: 'CONTINUE', finalStatus: 'PARTIAL' },
    { action: 'COMPLETE', finalStatus: 'VERIFIED_SOLUTION' },
    { action: 'COMPLETE', finalStatus: 'VERIFIED_SOLUTION', verificationRecord: 'yes' }
  ]) {
    const { store, fence } = await ready();
    await assert.rejects(store.decide(fence, { expectedVersion: 0, ...args }), /INVALID_FINAL_STATUS/);
  }
  const a = await ready();
  assert.equal((await a.store.decide(a.fence, { expectedVersion: 0, action: 'COMPLETE', finalStatus: 'PARTIAL' })).finalStatus, 'PARTIAL');
  const b = await ready();
  assert.equal((await b.store.decide(b.fence, { expectedVersion: 0, action: 'COMPLETE', finalStatus: 'VERIFIED_SOLUTION', verificationRecord: true })).finalStatus, 'VERIFIED_SOLUTION');
});
