const Engine = require('../disput/custom-engine');

// A scripted transport (as in custom-engine-owner.test.js): answers[model] is a list of replies, one per request to that model.
function transport(answers) {
  const calls = [];
  const used = {};
  const send = async (models, prompts, meta) => {
    calls.push({ models: models.slice(), prompts: { ...prompts }, meta });
    const byModel = {};
    models.forEach((model) => {
      const index = used[model] || 0;
      used[model] = index + 1;
      const reply = (answers[model] || [])[index];
      byModel[model] = { text: reply || '', status: reply ? 'SUCCESS' : 'TIMEOUT' };
    });
    return { byModel, closedByOwner: false };
  };
  return { send, calls };
}

const sentTo = (calls, model) => calls.filter((call) => call.models.includes(model));
const FAIL = 'НЕ ВЫПОЛНЕНО: check\nВЕРДИКТ: НЕ ПРОШЁЛ';
const PASS = 'ВЕРДИКТ: ПРОШЁЛ';

// The line of the map that r1 creates (author A); B revises it in r2; a gate may return to r2; the consumer (D) asks r4.
const LINE_A = { step: 'r1', participant: 'A', id: 'map' };
const MAP_OUTPUT = { format: 'json', requiredFields: ['/map'], artifacts: [{ id: 'map', name: 'Map', pointer: '/map' }] };
const REVISION_OUTPUT = { format: 'json', requiredFields: ['/map'], artifacts: [{ id: 'map', name: 'Revised map', pointer: '/map',
  revisionOf: { artifact: LINE_A, version: 'latest', required: true } }] };
const FROM_A = [{ artifact: LINE_A, version: 'latest', required: true }];
const gateStep = (onFail = { goto: 'r2', maxLoops: 1 }) => ({ ref: 'gate:g', kind: 'gate', input: 'previous', criteria: ['check'], models: ['C'], onFail });
const consumerStep = (source = { artifact: LINE_A, version: 'latest', required: true }, models = ['D']) => ({ ref: 'r4', kind: 'round', input: [source], models });
const r1Step = (models = ['A']) => ({ ref: 'r1', kind: 'round', input: 'none', models, output: MAP_OUTPUT });
const r2Step = () => ({ ref: 'r2', kind: 'round', input: 'none', models: [{ name: 'B', id: 'B', input: FROM_A, output: REVISION_OUTPUT }] });

const lineOf = (result, participant) => result.artifacts.filter((entry) => entry.lineage.participant === participant);
const textOf = (result, entry) => result.texts[entry.content.answerRef];

describe('Custom engine: a line that waits for its recomputation (R02, ТЗ 3.4)', () => {
  test('source → revision → return → failed: the consumer of the latest is missing, the stale source is never its input', async () => {
    const { send, calls } = transport({ A: ['{"map":"v1"}'], B: ['{"map":"v2"}', ''], C: [FAIL, PASS], D: ['consumed'] });
    const result = await Engine.run({ task: 'T', steps: [r1Step(), r2Step(), gateStep(), consumerStep()], send, maxAttempts: 1, decide: async () => 'skip' });
    expect(result.stopReason).toBe('missing_input');
    expect(result.stopDetail).toContain('«map»');
    expect(result.stopDetail).toContain('участник «A»');
    expect(sentTo(calls, 'D')).toEqual([]);
    // The revision of the second visit started from the declared input (v1), not from the stale v2.
    const second = sentTo(calls, 'B')[1].prompts.B;
    expect(second).toContain('v1');
    expect(second).not.toContain('v2');
  });

  test('a skipped revision blocks the required latest the same way', async () => {
    const { send, calls } = transport({ A: ['{"map":"v1"}'], B: ['{"map":"v2"}', 'это не json'], C: [FAIL, PASS], D: ['consumed'] });
    const result = await Engine.run({ task: 'T', steps: [r1Step(), r2Step(), gateStep(), consumerStep()], send, maxAttempts: 1, decide: async () => 'skip' });
    expect(result.steps.filter((step) => step.ref === 'r2')[1].outcome.B).toMatchObject({ ok: false, reason: 'invalid_output' });
    expect(result.stopReason).toBe('missing_input');
    expect(sentTo(calls, 'D')).toEqual([]);
  });

  test('an optional consumer gets no old text: it is asked without the stale version', async () => {
    const { send, calls } = transport({ A: ['{"map":"v1"}'], B: ['{"map":"v2"}', ''], C: [FAIL, PASS], D: ['consumed'] });
    const optional = consumerStep({ artifact: LINE_A, version: 'latest' });
    const result = await Engine.run({ task: 'T', steps: [r1Step(), r2Step(), gateStep(), optional], send, maxAttempts: 1, decide: async () => 'skip' });
    expect(result.stopReason).toBe('steps_done');
    const asked = sentTo(calls, 'D')[0].prompts.D;
    expect(asked).not.toContain('v1');
    expect(asked).not.toContain('v2');
  });

  test('an explicitly pinned valid source is the input of a consumer by its exact version, while latest stays blocked', async () => {
    const { send, calls } = transport({ A: ['{"map":"v1"}'], B: ['{"map":"v2"}', ''], C: [FAIL, PASS], D: ['consumed'] });
    const pinned = consumerStep({ artifact: LINE_A, version: { step: 'r1', participant: 'A', visit: 1 }, required: true });
    const result = await Engine.run({ task: 'T', steps: [r1Step(), r2Step(), gateStep(), pinned], send, maxAttempts: 1, decide: async () => 'skip' });
    expect(result.stopReason).toBe('steps_done');
    expect(sentTo(calls, 'D')[0].prompts.D).toContain('v1');
  });

  test('the exact invalidated version is never given as a working input: required is missing, optional gets nothing', async () => {
    const stale = { artifact: LINE_A, version: { step: 'r2', participant: 'B', visit: 1 }, required: true };
    const { send, calls } = transport({ A: ['{"map":"v1"}'], B: ['{"map":"v2"}', ''], C: [FAIL, PASS], D: ['consumed'] });
    const result = await Engine.run({ task: 'T', steps: [r1Step(), r2Step(), gateStep(), consumerStep(stale)], send, maxAttempts: 1, decide: async () => 'skip' });
    expect(result.stopReason).toBe('missing_input');
    expect(result.stopDetail).toContain('нет актуальной версии');
    expect(sentTo(calls, 'D')).toEqual([]);

    const optional = { ...stale, required: false };
    const second = transport({ A: ['{"map":"v1"}'], B: ['{"map":"v2"}', ''], C: [FAIL, PASS], D: ['consumed'] });
    const kept = await Engine.run({ task: 'T', steps: [r1Step(), r2Step(), gateStep(), consumerStep(optional)], send: second.send, maxAttempts: 1, decide: async () => 'skip' });
    expect(kept.stopReason).toBe('steps_done');
    expect(sentTo(second.calls, 'D')[0].prompts.D).not.toContain('v2');
  });

  test('several revisions: the stale chain waits, the author revises the last valid version, and a new accepted revision ends the wait', async () => {
    // r1 creates v1; r2 (B) revises to v2; r3 (E) revises v2 to v3; the gate returns to r2; B revises v1 to v4; E revises v4 to v5.
    const r3 = { ref: 'r3', kind: 'round', input: 'none', models: [{ name: 'E', id: 'E', input: [{ artifact: LINE_A, version: 'latest', required: true }],
      output: { format: 'json', requiredFields: ['/map'], artifacts: [{ id: 'map', name: 'Third', pointer: '/map', revisionOf: { artifact: LINE_A, version: 'latest', required: true } }] } }] };
    const { send, calls } = transport({ A: ['{"map":"v1"}'], B: ['{"map":"v2"}', '{"map":"v4"}'], E: ['{"map":"v3"}', '{"map":"v5"}'], C: [FAIL, PASS], D: ['consumed'] });
    const result = await Engine.run({ task: 'T', steps: [r1Step(), r2Step(), r3, gateStep(), consumerStep()], send, maxAttempts: 1, decide: async () => 'skip' });
    expect(result.stopReason).toBe('steps_done');
    expect(sentTo(calls, 'B')[1].prompts.B).toContain('v1');
    expect(sentTo(calls, 'B')[1].prompts.B).not.toContain('v3');
    expect(sentTo(calls, 'D')[0].prompts.D).toContain('v5');
    expect(sentTo(calls, 'D')[0].prompts.D).not.toContain('v1');
    expect(lineOf(result, 'A').map((entry) => entry.valid)).toEqual([true, false, false, true, true]);
    expect(textOf(result, lineOf(result, 'A')[4])).toBe('{"map":"v5"}');
  });

  test('a new accepted revision ends the wait: the consumer gets the new version of the right author', async () => {
    const { send, calls } = transport({ A: ['{"map":"v1"}'], B: ['{"map":"v2"}', '{"map":"v3"}'], C: [FAIL, PASS], D: ['consumed'] });
    const result = await Engine.run({ task: 'T', steps: [r1Step(), r2Step(), gateStep(), consumerStep()], send, maxAttempts: 1, decide: async () => 'skip' });
    expect(result.stopReason).toBe('steps_done');
    expect(sentTo(calls, 'D')[0].prompts.D).toContain('v3');
    expect(sentTo(calls, 'D')[0].prompts.D).not.toContain('v2');
  });

  test('a line that the return does not touch is not invalidated: its latest is still given', async () => {
    const other = { ref: 'r1', kind: 'round', input: 'none', models: ['A', 'X'], output: MAP_OUTPUT };
    const { send, calls } = transport({ A: ['{"map":"v1"}'], X: ['{"map":"x1"}'], B: ['{"map":"v2"}', ''], C: [FAIL, PASS], D: ['consumed'] });
    const consumer = consumerStep({ artifact: { step: 'r1', participant: 'X', id: 'map' }, version: 'latest', required: true });
    const result = await Engine.run({ task: 'T', steps: [other, r2Step(), gateStep(), consumer], send, maxAttempts: 1, decide: async () => 'skip' });
    expect(result.stopReason).toBe('steps_done');
    expect(sentTo(calls, 'D')[0].prompts.D).toContain('x1');
  });

  test('a reload at the moment of invalidation keeps the stale version stale: the transition is applied once', async () => {
    const snapshots = [];
    const first = transport({ A: ['{"map":"v1"}'], B: ['{"map":"v2"}', ''], C: [FAIL, PASS], D: ['consumed'] });
    const original = await Engine.run({ task: 'T', steps: [r1Step(), r2Step(), gateStep(), consumerStep()], send: first.send, maxAttempts: 1,
      decide: async () => 'skip', checkpoint: async (state) => { snapshots.push(JSON.parse(JSON.stringify(state))); } });
    expect(original.stopReason).toBe('missing_input');
    // The snapshot taken right after the transition is applied: the revision is stale, the return is recorded.
    const applied = snapshots.find((state) => state.current && state.current.applied);
    expect(applied).toBeDefined();
    expect(applied.artifacts.find((entry) => entry.source.step === 'r2')).toMatchObject({ valid: false });

    const replay = transport({ B: [''], C: [PASS], D: ['consumed'] });
    const resumed = await Engine.run({ task: 'T', steps: [r1Step(), r2Step(), gateStep(), consumerStep()], send: replay.send, maxAttempts: 1,
      decide: async () => 'skip', resume: applied, getText: (ref) => original.texts[ref], putText: (value) => `new-${value.length}` });
    expect(resumed.stopReason).toBe('missing_input');
    expect(sentTo(replay.calls, 'D')).toEqual([]);
    // One revision after the return, not a second return: the revision was asked once more.
    expect(sentTo(replay.calls, 'B')).toHaveLength(1);
  });
});
