'use strict';
// R01–R05 of the G3 code review: no false VERIFIED_SOLUTION, no lost verdict, no reference to an unaccepted answer.
// R04 lives in thecycle-g3-policy.test.js.
const test = require('node:test');
const assert = require('node:assert/strict');
const { fixture, json, isAnalyst, isVerifier } = require('./thecycle-g3-fixture.js');
const { parseDecision, parseVerification, COVERS_TASK, VERIFIER_PROMPT } = require('../disput/thecycle/circle-policy.js');
const REF = 'cycle=1 step=1 model=GPT';
const proc = [{ id: 'p1', check: 'пересчитать' }];
const p1 = { id: 'p1', result: 'PASS', evidence: 'e1' };
const cover = (result = 'PASS') => ({ id: 'COVERS_TASK', result, evidence: 'охват' });
const verdict = (v, checks = [p1, cover()], limitations = []) => json({ verdict: v, checks, limitations });
const kn = (claim) => ({ bases: [{ id: 'b1', kind: 'EXPERT_CONFIRMATION', ref: { cycleId: 1, step: 1, model: 'GPT' }, provenance: { model: 'GPT', role: 'work' } }], claims: [{ id: 'k1', rev: 1, statement: claim, status: 'SUPPORTED', basisRefs: ['b1'] }] });
const verify = (procedure = proc, claim = 'часть задачи решена') => json({ action: 'VERIFY', reason: 'r', refs: [REF], claim, procedure, knowledge: kn(claim) });
const complete = json({ action: 'COMPLETE', reason: 'ok', refs: [REF] });
const completeK = json({ action: 'COMPLETE', reason: 'ok', refs: [REF], verifies: 'k1' });
const cont = json({ action: 'CONTINUE', reason: 'ещё', refs: [REF] });
const work = { schemaVersion: 1, origin: 'user', run: { policy: 'manual' }, steps: [{ ref: 'r1', kind: 'round', models: [{ name: 'GPT' }] }] };
const THREE = ['GPT', 'Claude', 'Qwen'];
const run = async (analystAnswers, verifierAnswers, options = {}) => {
  const x = await fixture({ models: THREE, workSchema: work, analystAnswers, verifierAnswers });
  const r = await x.runner.start({ task: 'Solve the whole task', maxCalls: 20, ...options });
  return { x, r, rec: async () => (await x.store.getPacket(r.researchId, 3)).decision.detail.verificationRecord };
};

test('R01: the code adds COVERS_TASK to the procedure; the verifier sees it with the original task', async () => {
  const { x, r, rec } = await run([verify(), completeK], [verdict('VERIFIED')]);
  const sent = x.sent.find((s) => isVerifier(s.text)).text;
  assert.match(sent, /ИСХОДНАЯ ЗАДАЧА:\nSolve the whole task/);
  assert.ok(sent.includes('COVERS_TASK: ' + COVERS_TASK.check));
  assert.deepEqual((await rec()).procedure.map((p) => p.id), ['p1', 'COVERS_TASK']);
  assert.equal(r.state.finalStatus, 'VERIFIED_SOLUTION');
});

test('R01: a narrow claim answered VERIFIED without PASS on COVERS_TASK gives PARTIAL', async () => {
  for (const checks of [[p1], [p1, cover('FAIL')]]) {
    const { r, rec } = await run([verify(), complete], [verdict('VERIFIED', checks)]);
    assert.equal((await rec()).verdict, 'INSUFFICIENT');
    assert.equal(r.state.phase, 'COMPLETED'); assert.equal(r.state.finalStatus, 'PARTIAL');
  }
});

test('R01: the analyst cannot replace the text of COVERS_TASK; ten own checks still leave room for it', async () => {
  const own = [{ id: 'COVERS_TASK', check: 'достаточно части' }, ...Array.from({ length: 9 }, (_, i) => ({ id: 'q' + i, check: 'c' }))];
  const ten = Array.from({ length: 10 }, (_, i) => ({ id: 'q' + i, check: 'c' }));
  for (const procedure of [own, ten]) {
    const checks = [...procedure.filter((p) => p.id !== 'COVERS_TASK').map((p) => ({ id: p.id, result: 'PASS', evidence: 'e' })), cover()];
    const { x, r, rec } = await run([verify(procedure), completeK], [verdict('VERIFIED', checks)]);
    assert.doesNotMatch(x.sent.find((s) => isVerifier(s.text)).text, /достаточно части/);
    assert.equal((await rec()).procedure.length, checks.length);
    assert.equal(r.state.finalStatus, 'VERIFIED_SOLUTION');
  }
});

const opt = { procedure: proc, independence: 'FRESH_TAB_OTHER_MODEL' };
const one = (check, limitations = [], v = 'VERIFIED') => parseVerification(json({ verdict: v, checks: [check], limitations }), opt);

test('R02: PASS with empty evidence is a defect: INSUFFICIENT', () => {
  for (const evidence of ['', '  \n ']) {
    for (const v of ['VERIFIED', 'SUPPORTED']) {
      const res = one({ ...p1, evidence }, [], v);
      assert.equal(res.verdict, 'INSUFFICIENT'); assert.match(res.downgrades.join('\n'), /без evidence/);
    }
  }
  assert.equal(one({ id: 'p1', result: 'FAIL', evidence: '' }, [], 'CONTRADICTED').verdict, 'CONTRADICTED');
});

test('R02: PASS evidence is checked as stored, after the 1000-character cut', () => {
  const res = one({ ...p1, evidence: ' '.repeat(1000) + 'proof' });
  assert.equal(res.verdict, 'INSUFFICIENT'); assert.match(res.downgrades.join('\n'), /без evidence/);
});

test('R02: VERIFIED with limitations is lowered to SUPPORTED; other verdicts stay', async () => {
  const res = one(p1, ['проверен только частный случай']);
  assert.equal(res.verdict, 'SUPPORTED'); assert.match(res.downgrades.join('\n'), /limitations/);
  assert.equal(one(p1).verdict, 'VERIFIED');
  assert.equal(one(p1, ['x'], 'INSUFFICIENT').verdict, 'INSUFFICIENT');
  assert.match(VERIFIER_PROMPT, /только существенные ограничения/);
  const { r } = await run([verify(), complete], [verdict('VERIFIED', [p1, cover()], ['только частный случай'])]);
  assert.equal(r.state.finalStatus, 'PARTIAL');
});

const BLOCK = /\[CIRCLE: latest independent verification[^\n]*\]\nвердикт: (\w+)/;
const workPrompts = (x) => x.sent.filter((s) => !isAnalyst(s.text) && !isVerifier(s.text)).map((s) => s.text);

test('R03: a CONTRADICTED verdict reaches the next work cycle, whole, and stays until a newer check', async () => {
  const two = { ...work, steps: [...work.steps, { ref: 'r2', kind: 'round', input: 'previous', models: [{ name: 'GPT' }] }] };
  for (const [task, workSchema] of [['Solve the whole task', work], ['[CIRCLE_CONTEXT: latest-summary]\nSolve the whole task', two]]) {
    const evidence = 'контрпример x=2 ' + 'z'.repeat(900);
    const contradicted = verdict('CONTRADICTED', [{ id: 'p1', result: 'FAIL', evidence }, cover('FAIL')]);
    const x = await fixture({ models: THREE, workSchema, analystAnswers: [verify(), cont, cont, verify(), cont, complete], verifierAnswers: [contradicted, verdict('SUPPORTED')] });
    const r = await x.runner.start({ task, maxCalls: 30 });
    assert.equal(r.state.phase, 'COMPLETED');
    const prompts = workPrompts(x);
    const checked = prompts.filter((t) => BLOCK.test(t)).map((t) => BLOCK.exec(t)[1]);
    assert.doesNotMatch(prompts[0], BLOCK);
    assert.deepEqual([...new Set(checked)], ['CONTRADICTED', 'SUPPORTED']);
    const first = prompts.find((t) => BLOCK.test(t));
    assert.ok(first.includes(evidence)); assert.match(first, /\[END OF VERIFICATION\]/);
    assert.doesNotMatch(prompts.at(-1), /контрпример x=2/);
    if (workSchema === work) assert.deepEqual(checked, ['CONTRADICTED', 'CONTRADICTED', 'SUPPORTED']);
  }
});

test('R05: a reference needs an accepted, non-empty answer of the model on that step', () => {
  const report = { steps: [{ outcome: { GPT: { ok: true, text: 'a' }, Claude: { ok: false, text: 'отклонён' }, Qwen: { ok: true, text: '  ' }, Grok: { text: 'без ok' } } }] };
  const parse = (model) => parseDecision(json({ action: 'COMPLETE', reason: 'r', refs: ['cycle=1 step=1 model=' + model] }), { lastCommittedPacket: 1, packets: new Map([[1, report]]) });
  assert.equal(parse('GPT').ok, true);
  for (const model of ['Claude', 'Qwen', 'Grok']) {
    const res = parse(model);
    assert.equal(res.ok, false, model); assert.match(res.errors.join('\n'), /нет принятого ответа модели/);
  }
  assert.match(parse('Nope').errors.join('\n'), /нет такой модели/);
});
