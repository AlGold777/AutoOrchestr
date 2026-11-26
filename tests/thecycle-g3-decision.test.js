'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { parseDecision, buildAnalystTask, buildAnalystSchema, ANALYST_PROMPT, VERIFIER_PROMPT } = require('../disput/thecycle/circle-policy.js');

const report = { status: 'PIPELINE_COMPLETE', steps: [{ outcome: { GPT: { ok: true, text: 'a' }, DeepSeek: { ok: true, text: 'b' } } }, { outcome: { S: { ok: true, text: 's' } } }] };
const ctx = { lastCommittedPacket: 2, packets: new Map([[1, report], [2, report]]) };
const REF = 'cycle=1 step=1 model=GPT';
const ok = (obj, text) => parseDecision(text ?? JSON.stringify(obj), ctx);
const bad = (obj, pattern, text) => {
  const r = ok(obj, text);
  assert.equal(r.ok, false);
  if (pattern) assert.match(r.errors.join('\n'), pattern);
};
const proc = [{ id: 'p1', check: 'recompute' }];

test('each action is valid in its own shape', () => {
  for (const d of [
    { action: 'CONTINUE', reason: 'go on', refs: [] },
    { action: 'CHANGE_STRATEGY', reason: 'new plan', refs: [REF], schema: { steps: [] } },
    { action: 'VERIFY', reason: 'check', refs: [REF], claim: 'x=1', procedure: proc },
    { action: 'COMPLETE', reason: 'done', refs: [REF, 'cycle=2 step=2 model=S'] },
    { action: 'WAIT_OWNER', reason: 'need owner', refs: [], question: 'which?' },
    { action: 'WAIT_OWNER', reason: 'need owner', refs: [] }
  ]) { const r = ok(d); assert.equal(r.ok, true, JSON.stringify(r)); assert.deepEqual(r.decision, d); }
});

test('format errors are rejected', () => {
  bad({ action: 'CONTINUE', reason: 'r', refs: [], extra: 1 }, /лишний ключ/);
  bad({ action: 'STOP', reason: 'r', refs: [] }, /неизвестное action/);
  bad({ action: 'CONTINUE', refs: [] }, /reason/);
  bad({ action: 'CONTINUE', reason: 'x'.repeat(201), refs: [] }, /reason/);
  bad({ action: 'CONTINUE', reason: 'r' }, /refs/);
  bad({ action: 'CONTINUE', reason: 'r', refs: ['nonsense'] }, /refs/);
});

test('refs must point to existing committed cycle, step and model', () => {
  bad({ action: 'CONTINUE', reason: 'r', refs: ['cycle=3 step=1 model=GPT'] }, /вне диапазона/);
  bad({ action: 'CONTINUE', reason: 'r', refs: ['cycle=0 step=1 model=GPT'] }, /вне диапазона/);
  bad({ action: 'CONTINUE', reason: 'r', refs: ['cycle=1 step=3 model=GPT'] }, /нет такого шага/);
  bad({ action: 'CONTINUE', reason: 'r', refs: ['cycle=1 step=2 model=GPT'] }, /нет такой модели/);
  bad({ action: 'CONTINUE', reason: 'r', refs: ['cycle=1 step=1 model=Nope'] }, /нет такой модели/);
});

test('required and forbidden fields per action', () => {
  bad({ action: 'COMPLETE', reason: 'r', refs: [] }, /хотя бы одна/);
  bad({ action: 'VERIFY', reason: 'r', refs: [], claim: 'c', procedure: proc }, /хотя бы одна/);
  bad({ action: 'CONTINUE', reason: 'r', refs: [], schema: {} }, /только при CHANGE_STRATEGY/);
  bad({ action: 'CHANGE_STRATEGY', reason: 'r', refs: [] }, /требует schema/);
  bad({ action: 'VERIFY', reason: 'r', refs: [REF], claim: 'c' }, /требует procedure/);
  bad({ action: 'VERIFY', reason: 'r', refs: [REF], procedure: proc }, /требует claim/);
  bad({ action: 'CONTINUE', reason: 'r', refs: [], claim: 'c' }, /только при VERIFY/);
  bad({ action: 'CONTINUE', reason: 'r', refs: [], question: 'q' }, /только при WAIT_OWNER/);
  bad({ action: 'VERIFY', reason: 'r', refs: [REF], claim: 'c', procedure: [] }, /1–10/);
  bad({ action: 'VERIFY', reason: 'r', refs: [REF], claim: 'c', procedure: Array.from({ length: 11 }, (_, i) => ({ id: 'p' + i, check: 'c' })) }, /1–10/);
  bad({ action: 'VERIFY', reason: 'r', refs: [REF], claim: 'c', procedure: [{ id: 'p1', check: 'a' }, { id: 'p1', check: 'b' }] }, /повтор id/);
  bad({ action: 'VERIFY', reason: 'r', refs: [REF], claim: 'c', procedure: [{ id: 'p1', check: 'a', x: 1 }] }, /\{id,check\}/);
});

test('exactly one JSON object with action; surrounding text is allowed', () => {
  const one = '{"action":"CONTINUE","reason":"r","refs":[]}';
  assert.equal(ok(null, 'Вот решение:\n```json\n' + one + '\n```\nготово').ok, true);
  assert.equal(ok(null, 'prefix {not json} ' + one).ok, true);
  bad(null, /несколько/, one + '\n' + one);
  bad(null, /нет JSON/, 'никакого JSON');
  bad(null, /нет JSON/, '{"reason":"r"}');
  bad(null, /нет JSON/, '{"action":"CONTINUE"');
  assert.equal(parseDecision(42, ctx).ok, false);
});

test('prompts are inserted verbatim and substitution is single-pass', () => {
  assert.match(ANALYST_PROMPT, /Ты управляешь исследованием/);
  assert.match(VERIFIER_PROMPT, /Ты независимый проверяющий/);
  const text = buildAnalystTask({ task: 'T {{summary}}', summary: 'S', budget: 'B', schema: { a: 1 }, actions: ['CONTINUE', 'COMPLETE'] });
  assert.match(text, /ИСХОДНАЯ ЗАДАЧА:\nT \{\{summary\}\}/);
  assert.match(text, /ДОСТУПНЫЕ ДЕЙСТВИЯ:\nCONTINUE, COMPLETE\n?$/);
  assert.doesNotMatch(text.replace('T {{summary}}', ''), /\{\{/);
});

test('analyst schema: one round, one model, no input', () => {
  const work = { schemaVersion: 1, run: { policy: 'auto' }, steps: [{ ref: 'a', kind: 'round', models: [{ name: 'Off', enabled: false }, { name: 'GPT' }] }, { ref: 'b', kind: 'round', models: [{ name: 'S' }] }] };
  const s = buildAnalystSchema(work);
  assert.deepEqual(s.steps, [{ ref: 'r1', kind: 'round', input: 'none', models: [{ name: 'GPT' }] }]);
  assert.equal(work.steps.length, 2);
  assert.throws(() => buildAnalystSchema({ steps: [] }), /CIRCLE_ANALYST_NO_MODEL/);
});
