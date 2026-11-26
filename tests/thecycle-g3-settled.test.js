'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { isCycleSettled, fixedPolicy } = require('../disput/thecycle/controller.js');
const { createPolicy } = require('../disput/thecycle/circle-policy.js');
const ctx = require('../disput/thecycle/circle-context.js');

const ok = (text) => ({ ok: true, text });
const partial = (steps, extra = {}) => ({ status: 'PARTIAL', stopReason: 'steps_done', unresolvedBatchIds: [], steps, ...extra });
// round 1: GPT answered, DeepSeek dropped; round 2: summary
const dropped = () => partial([{ outcome: { GPT: ok('a'), DeepSeek: { ok: false } } }, { outcome: { Claude: ok('summary') } }]);
const state = (extra = {}) => ({ stopRequested: false, budget: { usedCalls: 2, maxCalls: 10 }, researchId: 'r', lastCommittedPacket: 1, ...extra });
const packet = (ref = 'work') => ({ status: 'RECORDED_RESULT', usedCalls: 3, pipelineRef: ref });

test('settled: dropped participant with answers in every step is technically complete', () => {
  assert.equal(isCycleSettled(dropped()), true);
  assert.equal(isCycleSettled({ status: 'PIPELINE_COMPLETE', unresolvedBatchIds: [], steps: [] }), true);
});
test('not settled: step without any answer, unresolved batch, UNKNOWN, other stop reason', () => {
  assert.equal(isCycleSettled(partial([{ outcome: { GPT: { ok: false } } }, { outcome: { Claude: ok('s') } }])), false);
  assert.equal(isCycleSettled(dropped() && { ...dropped(), unresolvedBatchIds: ['b1'] }), false);
  assert.equal(isCycleSettled({ ...dropped(), status: 'UNKNOWN' }), false);
  assert.equal(isCycleSettled({ ...dropped(), stopReason: 'UNKNOWN_DISPATCH' }), false);
});
test('fixedPolicy continues after a dropped participant, pauses on empty step', () => {
  assert.equal(fixedPolicy({ state: state(), packet: packet(), report: dropped() }).action, 'CONTINUE');
  const empty = partial([{ outcome: { GPT: { ok: false } } }]);
  assert.equal(fixedPolicy({ state: state(), packet: packet(), report: empty }).action, 'PAUSE');
  assert.equal(fixedPolicy({ state: state(), packet: packet(), report: { ...dropped(), unresolvedBatchIds: ['b'] } }).action, 'PAUSE');
});
test('analyst policy: work cycle with dropped participant goes to analyst; empty step pauses', async () => {
  const policy = createPolicy({ registry: [{ ref: 'work', role: 'work' }, { ref: 'an', role: 'analyst' }] });
  const d = await policy({ state: state(), packet: packet(), report: dropped(), store: {} });
  assert.equal(d.action, 'CONTINUE');
  assert.equal(d.pipelineRef, 'an');
  const e = await policy({ state: state(), packet: packet(), report: partial([{ outcome: {} }]), store: {} });
  assert.equal(e.action, 'PAUSE');
});
test('latest-summary: next cycle gets the summary of the last step after a dropped participant', async () => {
  const report = dropped();
  const store = {
    getPacket: async () => ({ status: 'RECORDED_RESULT', cycleId: 1, researchId: 'r', runId: 'run1', resultEventId: 'e1' }),
    getEvents: async () => [{ eventId: 'e1', payload: { report } }]
  };
  const task = await ctx.buildTask({ state: { researchId: 'r', task: 'Task', nextCycle: 2, lastCommittedPacket: 1 }, store, mode: 'latest-summary' });
  assert.match(task, /step=2 model=Claude\]\nsummary/);
});
