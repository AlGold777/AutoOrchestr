'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { fixture, json, isAnalyst, createStateStore } = require('./thecycle-g3-fixture.js');
const REF = 'cycle=1 step=1 model=GPT';
const round = (ref, extra = {}, model = 'GPT') => ({ ref, kind: 'round', models: [{ name: model }], ...extra });
const change = (schema) => json({ action: 'CHANGE_STRATEGY', reason: 'другая стратегия', refs: [REF], schema });
const newSchema = () => ({ schemaVersion: 1, origin: 'user', run: { policy: 'manual' }, steps: [round('r1', { input: 'none', task: 'NEWSTRATEGY' })] });
const done = json({ action: 'COMPLETE', reason: 'ok', refs: [REF] });
const rejected = (r, pattern) => {
  assert.equal(r.state.phase, 'PAUSED'); assert.equal(r.state.lastDecision.reason, 'STRATEGY_REJECTED');
  assert.ok(r.state.lastDecision.detail.errors.length >= 1);
  if (pattern) assert.match(r.state.lastDecision.detail.errors.join('\n'), pattern);
};

test('valid schema: the next work cycle runs by it (policy forced to auto), stored on the analyst packet and survives reopening', async () => {
  const x = await fixture({ analystAnswers: [change(newSchema()), done] });
  const r = await x.runner.start({ task: 'Solve it', maxCalls: 10 });
  assert.equal(r.state.phase, 'COMPLETED');
  assert.deepEqual(x.begins.map((b) => b.ref), ['work', 'single', 'NEWSTRATEGY', 'single']); // work, analyst, new work, analyst
  const newCycle = x.sent[2];
  assert.ok(!isAnalyst(newCycle.text)); assert.match(newCycle.text, /NEWSTRATEGY/); assert.match(newCycle.text, /Work GPT 1/);
  const reopened = await createStateStore({ indexedDB: x.indexedDB });
  const analyst = await reopened.getPacket(r.researchId, 2), third = await reopened.getPacket(r.researchId, 3);
  const ref = 'thecycle:circle:' + r.researchId + ':schema:c2';
  assert.equal(third.pipelineRef, ref);
  assert.equal(analyst.decision.detail.schema.run.policy, 'auto'); assert.equal(analyst.decision.detail.schema.steps[0].task, 'NEWSTRATEGY');
  assert.equal(analyst.decision.action, 'CONTINUE');
  // the next analyst sees the new schema and the work after it continues by the new schema, not the original
  assert.match(x.sent[3].text, /NEWSTRATEGY/);
  const events = await reopened.getEvents(r.researchId, third.runId);
  const intent = events.find((e) => JSON.stringify(e).includes('RUN_INTENT'));
  assert.ok(intent, JSON.stringify(events.map((e) => Object.keys(e))));
  assert.equal((intent.payload || intent).schema.steps[0].task, 'NEWSTRATEGY');
});

test('after a strategy change the following work cycle keeps the new schema and counts as work evidence', async () => {
  const x = await fixture({ analystAnswers: [change(newSchema()), json({ action: 'CONTINUE', reason: 'ещё', refs: [REF] }), done] });
  const r = await x.runner.start({ task: 'Solve it', maxCalls: 10 });
  assert.equal(r.state.phase, 'COMPLETED');
  assert.deepEqual(x.begins.map((b) => b.ref), ['work', 'single', 'NEWSTRATEGY', 'single', 'NEWSTRATEGY', 'single']);
  assert.match(x.sent[4].text, /Work GPT 1/); assert.match(x.sent[4].text, /Work GPT 2/); // both work cycles are evidence
  assert.doesNotMatch(x.sent[4].text, /другая стратегия/);
});

test('rejected: invalid schema, foreign model, stopMarks, too expensive, too big', async () => {
  const cases = [
    [{ schemaVersion: 1, origin: 'user', steps: [round('r1', { bogus: 1 })] }, null],
    [{ schemaVersion: 1, origin: 'user', steps: [round('r1', { input: 'none' }, 'Gemini')] }, null],
    [{ schemaVersion: 1, origin: 'user', run: { stopMarks: ['STOP'] }, steps: [round('r1', { input: 'none' })] }, /stopMarks/],
    [{ schemaVersion: 1, origin: 'user', steps: [round('r1', { input: 'none' }), round('r2'), round('r3'), round('r4'), round('r5')] }, /осталось/],
    [{ schemaVersion: 1, origin: 'user', steps: [round('r1', { input: 'none', task: 'x'.repeat(70000) })] }, /больше/]
  ];
  for (const [schema, pattern] of cases) {
    const x = await fixture({ analystAnswers: [change(schema)] });
    const r = await x.runner.start({ task: 'Solve it', maxCalls: 6 });
    rejected(r, pattern);
    assert.equal(x.sent.length, 2); // work + analyst only: nothing sent for the rejected schema
    assert.equal(r.state.lastDecision.detail.action, 'CHANGE_STRATEGY');
  }
});

test('limit: the sixth strategy change is rejected', async () => {
  const answers = Array.from({ length: 5 }, () => change(newSchema()));
  answers.push(change(newSchema()));
  const x = await fixture({ analystAnswers: answers });
  const r = await x.runner.start({ task: 'Solve it', maxCalls: 40 });
  rejected(r, /лимит/);
  assert.equal(x.begins.filter((b) => b.ref === 'NEWSTRATEGY').length, 5);
});

test('latest-summary: a new schema without a summary step is rejected', async () => {
  const two = { schemaVersion: 1, origin: 'user', run: { policy: 'manual' }, steps: [round('r1'), round('r2', { input: 'previous' })] };
  const x = await fixture({ workSchema: two, analystAnswers: [change(newSchema())] });
  const r = await x.runner.start({ task: 'Solve it', maxCalls: 10, contextMode: 'latest-summary' });
  rejected(r, /SUMMARY/);
});

test('schema that does not fit the analyst prompt is rejected with SCHEMA_TOO_LARGE_FOR_PROMPT', async () => {
  const schema = newSchema(); schema.steps[0].task = 'y'.repeat(7000);
  const x = await fixture({ analystAnswers: [change(schema)] });
  const r = await x.runner.start({ task: 'Solve it', maxCalls: 10, maxPromptChars: 12000 });
  rejected(r, /SCHEMA_TOO_LARGE_FOR_PROMPT/);
});
