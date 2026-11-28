'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { fixture, json, isVerifier } = require('./thecycle-g3-fixture.js');
const { parseVerification, COVERS_TASK } = require('../disput/thecycle/circle-policy.js');
const REF = 'cycle=1 step=1 model=GPT';
const proc = [{ id: 'p1', check: 'пересчитать' }, { id: 'p2', check: 'найти контрпример' }];
const verify = json({ action: 'VERIFY', reason: 'SECRET-ANALYST-REASON', refs: [REF], claim: 'x=1', procedure: proc });
const complete = json({ action: 'COMPLETE', reason: 'ok', refs: [REF] });
const checks = (r1 = 'PASS', r2 = 'PASS') => [{ id: 'p1', result: r1, evidence: 'e1' }, { id: 'p2', result: r2, evidence: 'e2' }];
// A live verifier also answers the check the code adds to every procedure.
const cover = { id: 'COVERS_TASK', result: 'PASS', evidence: 'covers' };
const verdict = (v, c = checks(), extra = {}) => json({ verdict: v, checks: [...c, cover], limitations: [], ...extra });
const TWO = ['GPT', 'Claude'];

const work2 = { schemaVersion: 1, origin: 'user', run: { policy: 'manual' }, steps: [{ ref: 'r1', kind: 'round', models: [{ name: 'GPT' }, { name: 'DeepSeek' }] }] };
const kn = (claim) => ({ bases: [{ id: 'b1', kind: 'EXPERT_CONFIRMATION', ref: { cycleId: 1, step: 1, model: 'GPT' }, provenance: { model: 'GPT', role: 'work' } }], claims: [{ id: 'k1', rev: 1, statement: claim, status: 'SUPPORTED', basisRefs: ['b1'] }] });
const verifyDS = json({ action: 'VERIFY', reason: 'SECRET-ANALYST-REASON', refs: ['cycle=1 step=1 model=DeepSeek'], claim: 'x=1', procedure: proc, knowledge: kn('x=1') });
const completeK = json({ action: 'COMPLETE', reason: 'ok', refs: [REF], verifies: 'k1' });

test('verifier is a third model: not in refs, not the analyst, not a work answerer; fresh independence; sees only task, claim and procedure', async () => {
  const x = await fixture({ models: ['GPT', 'DeepSeek', 'Qwen'], workSchema: work2, analystAnswers: [verifyDS, completeK], verifierAnswers: [verdict('VERIFIED')] });
  const r = await x.runner.start({ task: 'Solve it', maxCalls: 12 });
  assert.equal(r.state.phase, 'COMPLETED'); assert.equal(r.state.finalStatus, 'VERIFIED_SOLUTION');
  const v = x.sent.filter((s) => isVerifier(s.text));
  assert.equal(v.length, 1); assert.equal(v[0].model, 'Qwen');
  assert.match(v[0].text, /ИСХОДНАЯ ЗАДАЧА:\nSolve it/); assert.match(v[0].text, /x=1/); assert.match(v[0].text, /p1: пересчитать/);
  assert.doesNotMatch(v[0].text, /Work (GPT|DeepSeek)/); assert.doesNotMatch(v[0].text, /SECRET-ANALYST-REASON/);
  const verifyPacket = await x.store.getPacket(r.researchId, 3);
  assert.match(verifyPacket.pipelineRef, /:verify:c2$/);
  const rec = verifyPacket.decision.detail.verificationRecord;
  assert.deepEqual({ ...rec, checks: undefined }, { claim: 'x=1', procedure: [...proc, { ...COVERS_TASK }], verdict: 'VERIFIED', checks: undefined, independence: 'FRESH_TAB_OTHER_MODEL', verifierModel: 'Qwen', limitations: [], standard: 'E1', claimRef: 'k1@1' });
  assert.equal(rec.checks.length, 3);
  const second = x.sent.filter((s) => s.text.includes('Ты управляешь исследованием'))[1];
  assert.match(second.text, /РЕЗУЛЬТАТ ПРОВЕРКИ:\nвердикт: VERIFIED/);
  assert.equal(r.state.budget.usedCalls, 2 + 1 + 1 + 1);
});

test('no third model: the check runs by a non-analyst, UNPROVEN, never VERIFIED_SOLUTION', async () => {
  const x = await fixture({ models: TWO, analystAnswers: [verify, complete], verifierAnswers: [verdict('VERIFIED')] });
  const r = await x.runner.start({ task: 'Solve it', maxCalls: 12 });
  assert.equal(x.sent.filter((s) => isVerifier(s.text))[0].model, 'Claude'); // analyst is GPT
  const rec = (await x.store.getPacket(r.researchId, 3)).decision.detail.verificationRecord;
  assert.equal(rec.independence, 'UNPROVEN'); assert.equal(rec.verdict, 'INSUFFICIENT');
  assert.equal(r.state.finalStatus, 'PARTIAL');
});

test('verifier prompt larger than 0.8 of maxPromptChars pauses before sending', async () => {
  const big = json({ action: 'VERIFY', reason: 'r', refs: [REF], claim: 'x'.repeat(2000), procedure: Array.from({ length: 10 }, (_, i) => ({ id: 'p' + i, check: 'y'.repeat(600) })) });
  const x = await fixture({ models: TWO, analystAnswers: [big], verifierAnswers: [verdict('VERIFIED')] });
  const r = await x.runner.start({ task: 'Solve it', maxCalls: 12, maxPromptChars: 8000 });
  assert.equal(r.state.phase, 'PAUSED'); assert.equal(r.state.lastDecision.reason, 'VERIFY_PROMPT_TOO_LARGE');
  assert.equal(x.sent.filter((s) => isVerifier(s.text)).length, 0);
});

test('no other model: the check runs but is UNPROVEN; VERIFIED is downgraded and VERIFIED_SOLUTION is impossible', async () => {
  const x = await fixture({ models: ['GPT'], analystAnswers: [verify, complete], verifierAnswers: [verdict('VERIFIED')] });
  const r = await x.runner.start({ task: 'Solve it', maxCalls: 10 });
  assert.equal(x.sent.filter((s) => isVerifier(s.text))[0].model, 'GPT');
  const rec = (await x.store.getPacket(r.researchId, 3)).decision.detail.verificationRecord;
  assert.equal(rec.independence, 'UNPROVEN'); assert.equal(rec.verdict, 'INSUFFICIENT'); assert.ok(rec.downgrades.length);
  assert.equal(r.state.phase, 'COMPLETED'); assert.equal(r.state.finalStatus, 'PARTIAL');
});

test('incomplete, extra, repeated or unknown checks lower the verdict to INSUFFICIENT; other verdicts keep their checks', () => {
  const opt = { procedure: proc, independence: 'FRESH_TAB_OTHER_MODEL' };
  const parse = (o) => parseVerification(json(o), opt);
  const base = { verdict: 'VERIFIED', checks: checks(), limitations: [] };
  assert.equal(parse(base).verdict, 'VERIFIED');
  assert.equal(parse({ ...base, checks: [checks()[0]] }).verdict, 'INSUFFICIENT');
  assert.equal(parse({ ...base, checks: [...checks(), { id: 'p3', result: 'PASS', evidence: 'x' }] }).verdict, 'INSUFFICIENT');
  assert.equal(parse({ ...base, checks: [checks()[0], checks()[0]] }).verdict, 'INSUFFICIENT');
  assert.equal(parse({ ...base, extra: 1 }).verdict, 'INSUFFICIENT');
  assert.equal(parse({ ...base, checks: checks('PASS', 'FAIL') }).verdict, 'INSUFFICIENT');
  assert.equal(parse({ ...base, verdict: 'SUPPORTED', checks: [checks()[0]] }).verdict, 'INSUFFICIENT');
  assert.equal(parse({ ...base, verdict: 'CONTRADICTED', checks: checks('PASS', 'FAIL') }).verdict, 'CONTRADICTED');
  assert.equal(parse({ ...base, verdict: 'SUPPORTED' }).verdict, 'SUPPORTED');
  assert.equal(parseVerification(json(base), { ...opt, independence: 'UNPROVEN' }).verdict, 'INSUFFICIENT');
  assert.equal(parseVerification('нет json', opt).ok, false);
  assert.equal(parseVerification(verdict('VERIFIED') + verdict('VERIFIED'), opt).ok, false);
});

test('incomplete checks in a live run: INSUFFICIENT, COMPLETE gives PARTIAL', async () => {
  const x = await fixture({ models: TWO, analystAnswers: [verify, complete], verifierAnswers: [verdict('VERIFIED', [checks()[0]])] });
  const r = await x.runner.start({ task: 'Solve it', maxCalls: 12 });
  const rec = (await x.store.getPacket(r.researchId, 3)).decision.detail.verificationRecord;
  assert.equal(rec.verdict, 'INSUFFICIENT');
  assert.equal(r.state.finalStatus, 'PARTIAL');
});

test('invalid verifier JSON pauses with DECISION_FORMAT_INVALID, no retry', async () => {
  const x = await fixture({ models: TWO, analystAnswers: [verify, complete], verifierAnswers: ['не JSON', verdict('VERIFIED')] });
  const r = await x.runner.start({ task: 'Solve it', maxCalls: 12 });
  assert.equal(r.state.phase, 'PAUSED'); assert.equal(r.state.lastDecision.reason, 'DECISION_FORMAT_INVALID');
  assert.equal(x.sent.filter((s) => isVerifier(s.text)).length, 1);
});

test('COMPLETE after a work cycle that followed the verification is only PARTIAL', async () => {
  const cont = json({ action: 'CONTINUE', reason: 'ещё', refs: [REF] });
  const x = await fixture({ models: TWO, analystAnswers: [verify, cont, complete], verifierAnswers: [verdict('VERIFIED')] });
  const r = await x.runner.start({ task: 'Solve it', maxCalls: 20 });
  assert.equal(r.state.phase, 'COMPLETED'); assert.equal(r.state.finalStatus, 'PARTIAL');
});

test('budget must cover the check plus the analyst after it, before anything is sent', async () => {
  // 1 model: work 1 + analyst 1 = 2 used, 1 left: not enough for check + analyst
  const x = await fixture({ models: ['GPT'], analystAnswers: [verify], verifierAnswers: [verdict('VERIFIED')] });
  const r = await x.runner.start({ task: 'Solve it', maxCalls: 3 });
  assert.equal(r.state.phase, 'PAUSED'); assert.equal(r.state.lastDecision.reason, 'BUDGET_INSUFFICIENT_FOR_VERIFY');
  assert.equal(x.sent.length, 2);
});

// P6: проверка привязана к утверждению реестра; финал, не совпадающий с проверенным, не получает VERIFIED_SOLUTION.
const bas = (id, cycleId) => ({ id, kind: 'EXPERT_CONFIRMATION', ref: { cycleId, step: 1, model: 'GPT' }, provenance: { model: 'GPT', role: 'work' } });
const k1 = { bases: [bas('b1', 1)], claims: [{ id: 'k1', rev: 1, statement: 'x=1', status: 'SUPPORTED', basisRefs: ['b1'] }] };
const verifyK = json({ action: 'VERIFY', reason: 'r', refs: ['cycle=1 step=1 model=DeepSeek'], claim: 'x=1', procedure: proc, knowledge: k1 });
const p6 = (analystAnswers) => fixture({ models: ['GPT', 'DeepSeek', 'Qwen'], workSchema: work2, analystAnswers, verifierAnswers: [verdict('VERIFIED')] });

test('P6: COMPLETE с verifies на проверенное SUPPORTED-утверждение даёт VERIFIED_SOLUTION', async () => {
  const x = await p6([verifyK, json({ action: 'COMPLETE', reason: 'ok', refs: [REF], verifies: 'k1' })]);
  const r = await x.runner.start({ task: 'Solve it', maxCalls: 12 });
  assert.equal(r.state.finalStatus, 'VERIFIED_SOLUTION');
});

test('P6: проверка без привязки к утверждению не засчитывается: возобновляемая пауза VERIFICATION_MISMATCH', async () => {
  const x = await p6([verifyK, json({ action: 'COMPLETE', reason: 'ok', refs: [REF] })]);
  const r = await x.runner.start({ task: 'Solve it', maxCalls: 12 });
  assert.equal(r.state.phase, 'PAUSED'); assert.equal(r.state.lastDecision.reason, 'VERIFICATION_MISMATCH');
  assert.equal(r.state.finalStatus, undefined);
  assert.match(r.state.lastDecision.detail.errors[0], /verifies/);
});

test('P6: финал с иным содержанием (утверждение пересмотрено после проверки) не получает VERIFIED_SOLUTION', async () => {
  const revised = { bases: [bas('b2', 4)], claims: [{ id: 'k1', rev: 2, statement: 'x=2', status: 'SUPPORTED', basisRefs: ['b2'] }] };
  const x = await p6([verifyK, json({ action: 'COMPLETE', reason: 'ok', refs: [REF], verifies: 'k1', knowledge: revised })]);
  const r = await x.runner.start({ task: 'Solve it', maxCalls: 12 });
  assert.equal(r.state.phase, 'PAUSED'); assert.equal(r.state.lastDecision.reason, 'VERIFICATION_MISMATCH');
  assert.match(r.state.lastDecision.detail.errors[0], /не совпадает с проверенным/);
});

test('P6: verifies допустим только при COMPLETE', () => {
  const p = require('../disput/thecycle/circle-policy.js').parseDecision(json({ action: 'CONTINUE', reason: 'x', refs: [], verifies: 'k1' }), { lastCommittedPacket: 1, packets: new Map() });
  assert.equal(p.ok, false);
});

// P6 (замечания GPT): реестр обязателен; изоляция проверяющего — по фактически отправленному запросу; привязка к ревизии.
const noKn = json({ action: 'VERIFY', reason: 'r', refs: ['cycle=1 step=1 model=DeepSeek'], claim: 'x=1', procedure: proc });
const completeK2 = json({ action: 'COMPLETE', reason: 'ok', refs: [REF], verifies: 'k1' });
const run6 = async (analystAnswers, extra = {}) => {
  const x = await fixture({ models: ['GPT', 'DeepSeek', 'Qwen'], workSchema: work2, analystAnswers, verifierAnswers: [verdict('VERIFIED')], ...extra });
  const r = await x.runner.start({ task: 'Solve it', maxCalls: 12 });
  const rec = (await x.store.getPacket(r.researchId, 3)).decision.detail.verificationRecord;
  return { x, r, rec };
};

test('P6: без реестра знаний VERIFIED_SOLUTION невозможен даже при полной проверке: пауза с причиной', async () => {
  const { r } = await run6([noKn, completeK2]);
  assert.equal(r.state.phase, 'PAUSED'); assert.equal(r.state.lastDecision.reason, 'VERIFICATION_MISMATCH');
  assert.match(r.state.lastDecision.detail.errors[0], /реестр знаний пуст/);
});

test('P6: запрос проверяющему не зафиксирован в журнале отправки — независимость UNPROVEN, финал PARTIAL', async () => {
  const { r, rec } = await run6([verifyDS, completeK2], { noJournal: true });
  assert.equal(rec.independence, 'UNPROVEN'); assert.match(rec.downgrades.join(' '), /не зафиксирован/);
  assert.equal(r.state.finalStatus, 'PARTIAL');
});

test('P6: в отправленный проверяющему запрос попал чужой ответ — независимость UNPROVEN, финал PARTIAL', async () => {
  const { r, rec } = await run6([verifyDS, completeK2], { verifierJournalSuffix: ' ' + verifyDS });
  assert.equal(rec.independence, 'UNPROVEN'); assert.match(rec.downgrades.join(' '), /ответ другой модели/);
  assert.equal(r.state.finalStatus, 'PARTIAL');
});

test('P6: проверка записана с ревизией утверждения и стандартом; новая ревизия с тем же текстом допустима', async () => {
  const rev2 = { bases: [{ id: 'b2', kind: 'REPRODUCIBLE_CHECK', ref: { cycleId: 3, step: 1, model: 'Qwen' }, provenance: { model: 'Qwen', role: 'verify' } }],
    claims: [{ id: 'k1', rev: 2, statement: 'x=1', status: 'SUPPORTED', basisRefs: ['b1', 'b2'] }] };
  const { r, rec } = await run6([verifyDS, json({ action: 'COMPLETE', reason: 'ok', refs: [REF], verifies: 'k1', knowledge: rev2 })]);
  assert.equal(rec.claimRef, 'k1@1'); assert.equal(rec.standard, 'E1');
  assert.equal(r.state.finalStatus, 'VERIFIED_SOLUTION');
});

test('P6: утверждение зарегистрировано только при COMPLETE — проверка не привязана к ревизии, VERIFIED_SOLUTION невозможен', async () => {
  const { r } = await run6([noKn, json({ action: 'COMPLETE', reason: 'ok', refs: [REF], verifies: 'k1', knowledge: kn('x=1') })]);
  assert.equal(r.state.phase, 'PAUSED'); assert.equal(r.state.lastDecision.reason, 'VERIFICATION_MISMATCH');
  assert.match(r.state.lastDecision.detail.errors.join(' '), /не привязана к утверждению реестра/);
});
