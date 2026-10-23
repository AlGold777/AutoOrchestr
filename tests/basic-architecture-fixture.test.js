// T18 and T19 (ТЗ 10): the architecture of 30 stages (design-system-architecture.md) as one Basic schema,
// the S01–S30 → technical refs table, the count of steps, and runs of the whole schema on a fake transport.
// The schema and the table are fixtures: tests/fixtures/basic-architecture-s01-s30.json and …map.json.
// The schema is linear: the checks G1–G4 are rounds of one model (criteria in the task), the choices of User are owner
// steps; the synthetic return conditions (Q10) are gone. Fake send and owner callbacks only: no provider is called.
const fs = require('fs');
const path = require('path');
const Engine = require('../disput/custom-engine');
const Schema = require('../disput/basic-schema');

const fixture = (name) => JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', name), 'utf8'));
const schema = fixture('basic-architecture-s01-s30.json');
const map = fixture('basic-architecture-s01-s30.map.json');
const byRef = Object.fromEntries(schema.steps.map((step) => [step.ref, step]));
const MODELS = ['Claude', 'GPT', 'Gemini', 'Grok', 'Qwen', 'DeepSeek', 'Kimi'];

// Fake transport: the reply of a participant comes from `replyFor(stepRef, participantId, attempt)`.
function fakeTransport(replyFor) {
  const calls = [];
  const sendParticipants = async (requests) => {
    calls.push(requests.map((request) => ({ ...request })));
    const byParticipant = {};
    requests.forEach((request) => {
      const text = replyFor(request.stepRef, request.participantId, request.attempt);
      byParticipant[request.participantId] = { text, status: text ? 'SUCCESS' : 'TIMEOUT', transportRequestId: `${request.participantId}-${request.attempt}` };
    });
    return { byParticipant, closedByOwner: false };
  };
  return { calls, sendParticipants };
}

// The plain answers of the architecture (the JSON answers have their required fields).
function baseReply(opts = {}) {
  return (stepRef, participantId) => {
    if (participantId === 'S12-reviewer') return JSON.stringify({ decisionImpact: 'no', findings: 'ЗАМЕЧАНИЕ_S12' });
    if (participantId === 'S19-a' || participantId === 'S19-b') return JSON.stringify({ chgProposal: 'no', review: 'r' });
    if (participantId === 'S26-closer') return JSON.stringify({ closedDecisions: 'c', directionBroken: false });
    if (participantId === 'S27-a' || participantId === 'S27-b') return JSON.stringify({ requiresVerification: false, failures: 'x' });
    if (participantId === 'S29-reviewer') return JSON.stringify({ outcome: 'baseline' });
    return opts.text?.(stepRef, participantId) ?? `ответ ${stepRef} ${participantId}`;
  };
}

// The owner of the architecture: gives the text of each owner step and approves.
function owners(opts = {}) {
  const asked = [];
  return {
    asked,
    provideOwnerResult: async ({ stepRef }) => { asked.push(stepRef); return `текст User ${stepRef}`; },
    decide: async (arg) => { asked.push('decide'); return opts.decide ? opts.decide(arg) : 'continue'; }
  };
}

const run = (extra, options = {}) => Engine.run({ task: 'T', steps: Schema.assemble(schema), ...options, ...extra });

// S01–S05 are the five stages checked in practice (docs/Pipeline scenarios/basic_review_s01_s05_oct14.md): the schema must keep what
// the Design System says about them.
describe('S01–S05 follow the Design System', () => {
  test('the file for a live run of S01–S05 is the first seven steps of the whole schema (import it in the Pipeline panel)', () => {
    const five = fixture('basic-architecture-s01-s05.json');
    expect(Schema.validate(five)).toEqual([]);
    expect(five.steps.map((step) => step.ref)).toEqual(['r1', 'owner:s01', 'r2', 'synth:s03', 'r3', 'synth:s04', 'r4']);
    expect(five.steps).toEqual(schema.steps.slice(0, 7));
  });

  const first = { ...schema, steps: schema.steps.slice(0, 7) };
  test('the Decision Closer receives the Decision Policy, and S05 asks for no owner approval', async () => {
    expect(byRef['r4'].owner).toBeUndefined();
    const transport = fakeTransport(baseReply());
    const decided = [];
    const ownerGot = [];
    const result = await Engine.run({
      task: 'T', steps: Schema.assemble(first), sendParticipants: transport.sendParticipants,
      provideOwnerResult: async (arg) => { ownerGot.push(arg); return 'ПОЛИТИКА_S01'; }, decide: async () => { decided.push('decide'); return 'continue'; }
    });
    expect(result.stopReason).toBe('steps_done');
    const closer = transport.calls.flat().find((request) => request.participantId === 'S03-closer');
    expect(closer.prompt).toContain('ПОЛИТИКА_S01');
    expect(decided).toEqual([]);
    // The owner of S01 sees the answer of the Producer when it approves the policy (N07).
    expect(ownerGot).toHaveLength(1);
    expect(ownerGot[0].input).toEqual([expect.objectContaining({ text: 'ответ r1 S01-producer' })]);
  });
});

describe('T18: the architecture schema is valid, shows on the canvas and keeps its settings', () => {
  test('validate passes, the canvas has no errors, the rounds are counted (the limit is 50 rounds)', () => {
    expect(Schema.validate(schema)).toEqual([]);
    const canvas = Schema.toCanvas(schema, { models: MODELS });
    expect(canvas.errors).toEqual([]);
    expect(canvas.rounds).toHaveLength(map.summary.rounds);
    // 30 business stages, 49 technical steps, 37 rounds (the checks G1–G4 are rounds; owner steps and syntheses do not count
    // toward the 50-round limit), 7 owner steps (the former choices of User included).
    expect(map.summary).toMatchObject({ businessStages: 30, technicalSteps: 49, rounds: 37, syntheses: 5, owners: 7, ownerApprovals: 3 });
    expect(schema.steps.map((step) => step.kind).every((kind) => ['round', 'synthesis', 'owner'].includes(kind))).toBe(true);
    expect(map.summary.rounds).toBeLessThanOrEqual(50);
  });

  test('every business stage S01–S30 maps to existing steps, and every step belongs to a stage', () => {
    const stages = map.stages.map((item) => item.stage);
    expect(stages).toEqual(Array.from({ length: 30 }, (_, i) => `S${String(i + 1).padStart(2, '0')}`));
    const mapped = map.stages.flatMap((item) => item.refs);
    mapped.forEach((ref) => expect(byRef[ref]).toBeDefined());
    expect(new Set(mapped).size).toBe(mapped.length);
    expect(new Set(mapped)).toEqual(new Set(schema.steps.map((step) => step.ref)));
  });

  test('the table marks the mechanics of every stage: proven, or waiting for a business decision (the decisions are not guessed)', () => {
    expect(map.stages.every((item) => ['доказана', 'ждёт бизнес-решения'].includes(item.mechanics))).toBe(true);
    expect(map.stages.filter((item) => item.mechanics === 'ждёт бизнес-решения').map((item) => item.stage)).toEqual(['S25', 'S26', 'S27', 'S29']);
    map.stages.filter((item) => item.mechanics === 'ждёт бизнес-решения').forEach((item) => expect(item.mechanicsNote).toBeTruthy());
  });

  test('the seven independent stages have parallel rounds with at least two participants', () => {
    ['S02', 'S05', 'S14', 'S18', 'S19', 'S20', 'S27'].forEach((stage) => {
      const rounds = map.stages.find((item) => item.stage === stage).refs.map((ref) => byRef[ref]).filter((step) => step.kind === 'round');
      const parallel = rounds.filter((step) => step.order === 'parallel' && step.models.length >= 2);
      expect(parallel.length).toBeGreaterThanOrEqual(1);
    });
  });

  test('two-role stages are expressed as several technical steps', () => {
    ['S03', 'S08', 'S09', 'S12', 'S17', 'S20', 'S21', 'S29'].forEach((stage) => {
      expect(map.stages.find((item) => item.stage === stage).refs.length).toBeGreaterThanOrEqual(2);
    });
  });

  test('S18 has two independent participants with their own ids; the author revises in its own chat (same id, chat continue)', () => {
    const s18 = byRef[map.stages.find((item) => item.stage === 'S18').refs[0]];
    expect(s18.models.map((model) => [model.name, model.id])).toEqual([['Claude', 'S18-a'], ['GPT', 'S18-b']]);
    expect(s18.chat).toBe('new');
    const revisionA = byRef[map.stages.find((item) => item.stage === 'S20').refs[1]];
    expect(revisionA.models).toEqual([{ name: 'Claude', id: 'S18-a' }]);
    expect(revisionA.chat).toBeUndefined();
    expect(revisionA.output.artifacts[0].revisionOf).toEqual({ artifact: { step: s18.ref, participant: 'S18-a', id: 'candidate' }, version: 'latest', required: true });
  });

  test('the checks G1–G4 are rounds of one model after S13, S17, S22 and S30, with the criteria in the task', () => {
    const checks = ['r16', 'r20', 'r28', 'r37'].map((ref) => byRef[ref]);
    checks.forEach((step, at) => {
      expect(step.kind).toBe('round');
      expect(step.models).toHaveLength(1);
      expect(step.task).toContain(`Проверка G${at + 1}`);
      expect(step.task).toContain('Критерии:');
    });
    expect(byRef['r15'].owner).toBe('approve');
    expect(byRef['r36'].owner).toBe('approve');
  });

  test('there is no way back and no branch: the former choices of User are owner steps, the synthetic conditions are gone', () => {
    expect(map.ownerChoices).toEqual(['owner:chg13', 'owner:chg17', 'owner:chg18', 'owner:chg25', 'owner:s29']);
    map.ownerChoices.forEach((ref) => expect(byRef[ref]).toMatchObject({ kind: 'owner', models: [] }));
    expect(JSON.stringify(schema)).not.toMatch(/maxLoops|resumeAt|"return"\s*:\s*true|"goto"|"select"|"criteria"|"onFail"/);
    expect(map).not.toHaveProperty('synthetic');
  });

  test('the settings of the canvas keep every explicit field of every step (no silent loss)', () => {
    const settings = Schema.toSettings(schema);
    schema.steps.forEach((step) => {
      if (step.kind === 'round') {
        const expected = Object.fromEntries(['order', 'input', 'task', 'require', 'owner', 'chat', 'output'].filter((key) => key in step).map((key) => [key, step[key]]));
        expect(settings.customRoundSettings[step.ref]).toEqual(expected);
      } else {
        const fields = ['input', 'task', 'require', 'owner', 'chat', 'output'];
        const expected = Object.fromEntries(fields.filter((key) => key in step).map((key) => [key, step[key]]));
        expect(settings.customStepSettings[step.ref]).toEqual(expected);
      }
    });
    // Per-participant inputs of S19 (each reviewer sees the other candidate) are kept with the participant.
    expect(settings.customModelSettings['r22']['S19-a'].input).toEqual(byRef.r22.models[0].input);
  });
});

// T07 (engine): two participants of one model in one step are two requests with two ids in two chats. The page does not
// install such a step yet (A06 test in results-debate-favorites.test.js), so this runs on the engine only.
describe('T07: two ids of one model in S18 go as two independent chats', () => {
  test('two Claude ids in one step: two requests, each with its participant id and chat new; the author of the revision keeps its id', async () => {
    const twin = { schemaVersion: 1, origin: 'user', steps: [
      { ref: 'r1', kind: 'round', order: 'parallel', chat: 'new', require: 2, input: 'none', models: [{ name: 'Claude', id: 'S18-a' }, { name: 'Claude', id: 'S18-b' }] },
      { ref: 'r2', kind: 'round', input: [{ step: 'r1', participant: 'S18-a', required: true }], models: [{ name: 'Claude', id: 'S18-a' }] }
    ] };
    expect(Schema.validate(twin)).toEqual([]);
    const transport = fakeTransport((ref, pid) => `ответ ${ref} ${pid}`);
    const result = await run({ sendParticipants: transport.sendParticipants, steps: Schema.assemble(twin) }, owners());
    expect(result.stopReason).toBe('steps_done');
    const first = transport.calls[0].map((request) => [request.participantId, request.modelName, request.chat]);
    expect(first).toEqual([['S18-a', 'Claude', 'new'], ['S18-b', 'Claude', 'new']]);
    expect(transport.calls[1][0]).toMatchObject({ participantId: 'S18-a', chat: 'continue' });
  });
});

describe('T18: runs of the whole architecture on a fake transport', () => {
  test('the linear run goes through all 49 steps in order; the owner steps and approvals are asked where the table says', async () => {
    const transport = fakeTransport(baseReply());
    const ask = owners();
    const result = await run({ sendParticipants: transport.sendParticipants }, ask);
    expect(result.stopReason).toBe('steps_done');
    expect(result.steps.map((step) => step.ref)).toEqual(schema.steps.map((step) => step.ref));
    // One request per participant of the schema (49); the transport gets one batch per wave of a step.
    expect(transport.calls.reduce((sum, call) => sum + call.length, 0)).toBe(map.summary.participantsTotal);
    // The owner in the order of the run: the text of owner:s01; approvals of S13, S22, S30 (decide; S05 asks none: the Design System has only an escalation there);
    // the owner steps after G1 (chg13), after G2 (chg17), after S18 (chg18), owner:s25, chg25 and the outcome of S29.
    expect(ask.asked).toEqual(['owner:s01', 'decide', 'owner:chg13', 'owner:chg17', 'owner:chg18', 'decide', 'owner:s25', 'owner:chg25', 'owner:s29', 'decide']);
  });

  test('a null owner decision on the approved last step is no_decision, and the run does not finish', async () => {
    const transport = fakeTransport(baseReply());
    const ask = owners({ decide: () => null });
    const result = await run({ sendParticipants: transport.sendParticipants }, ask);
    expect(result.stopReason).toBe('no_decision');
    expect(result.steps.at(-1).ref).not.toBe('r37');
  });
});

describe('T02, T04, T03: inputs of the architecture chosen by address', () => {
  test('S03 (synthesis) gets the owner policy and the S02 answers, not the S01 draft; the order of the list is kept', async () => {
    const transport = fakeTransport(baseReply({ text: (ref, pid) => (ref === 'r1' ? 'ЧЕРНОВИК_S01' : `ответ ${ref} ${pid}`) }));
    const ownerAsk = owners();
    await run({ sendParticipants: transport.sendParticipants }, { ...ownerAsk, provideOwnerResult: async () => 'ПОЛИТИКА_S01' });
    const s03 = transport.calls.find((call) => call[0].stepRef === 'synth:s03');
    expect(s03[0].prompt).toContain('ПОЛИТИКА_S01');
    expect(s03[0].prompt).toContain('ответ r2 S02-a');
    expect(s03[0].prompt).not.toContain('ЧЕРНОВИК_S01');
    expect(s03[0].prompt.indexOf('ПОЛИТИКА_S01')).toBeLessThan(s03[0].prompt.indexOf('ответ r2 S02-a'));
  });

  test('S08 → S09 and S10: the reviewer of S09 gets the map only; S10 gets the findings, not the map', async () => {
    const transport = fakeTransport(baseReply({ text: (ref, pid) => (pid === 'S08-producer' ? 'КАРТА_S08' : pid === 'S08-reviewer' ? 'ЗАМЕЧАНИЕ_АУДИТА' : `ответ ${ref} ${pid}`) }));
    await run({ sendParticipants: transport.sendParticipants }, owners());
    const s09 = transport.calls.find((call) => call[0].stepRef === 'r9');
    expect(s09[0].prompt).toContain('КАРТА_S08');
    expect(s09[0].prompt).not.toContain('ЗАМЕЧАНИЕ_АУДИТА');
    const s10 = transport.calls.find((call) => call[0].stepRef === 'r11');
    expect(s10[0].prompt).toContain('ЗАМЕЧАНИЕ_АУДИТА');
    expect(s10[0].prompt).not.toContain('КАРТА_S08');
  });

  test('T05: require 2 with one empty answer in S02: the empty answer is retried, continue is not offered, no_decision; S03 is not sent', async () => {
    const transport = fakeTransport(baseReply({ text: (ref, pid) => (pid === 'S02-b' ? '' : `ответ ${ref} ${pid}`) }));
    const result = await run({ sendParticipants: transport.sendParticipants }, owners());
    expect(result.stopReason).toBe('no_decision');
    expect(transport.calls.filter((call) => call.some((request) => request.participantId === 'S02-b'))).toHaveLength(2);
    expect(transport.calls.some((call) => call[0].stepRef === 'synth:s03')).toBe(false);
  });
});

describe('T04: a JSON answer without a required field is corrected alone; the accepted neighbour is not sent again', () => {
  test('S27: S27-a lacks /failures (a required field), S27-b is accepted: only S27-a gets the correction, and the reason names the field', async () => {
    const transport = fakeTransport((ref, pid, attempt) => {
      if (ref === 'r32' && pid === 'S27-a' && attempt === 1) return JSON.stringify({ requiresVerification: false });
      return baseReply()(ref, pid);
    });
    const result = await run({ sendParticipants: transport.sendParticipants }, owners());
    expect(result.stopReason).toBe('steps_done');
    const batches = transport.calls.filter((call) => call[0].stepRef === 'r32');
    expect(batches).toHaveLength(2);
    expect(batches[0].map((request) => request.participantId)).toEqual(['S27-a', 'S27-b']);
    expect(batches[1].map((request) => request.participantId)).toEqual(['S27-a']);
    expect(batches[1][0].prompt).toContain('failures');
    // The first request of the visit opened the chat (chat new); the correction goes on in it (continue).
    expect(batches[0][0].chat).toBe('new');
    expect(batches[1][0].chat).toBe('continue');
  });
});

describe('T19: a large input is not cut and stops before the request (stress fixture: synthetic sizes, not real documents)', () => {
  const big = 'Ж'.repeat(100000);
  test('the input of S30 larger than the budget stops before its request; the stored texts are whole', async () => {
    const transport = fakeTransport(baseReply({ text: (ref, pid) => (pid === 'S28-producer' || pid === 'S29-verifier' ? big : `ответ ${ref} ${pid}`) }));
    const result = await run({ sendParticipants: transport.sendParticipants, maxPromptChars: 150000 }, owners());
    expect(result.stopReason).toBe('context_full');
    expect(transport.calls.some((call) => call[0].stepRef === 'r36')).toBe(false);
    const s28 = transport.calls.find((call) => call[0].stepRef === 'r33');
    expect(s28).toBeDefined();
  });

  test('S13: two large inputs (the map and the specification) stop before the request of S13 with context_full; nothing is cut', async () => {
    const transport = fakeTransport(baseReply({ text: (ref, pid) => (pid === 'S08-producer' || pid === 'S12-producer' ? big : `ответ ${ref} ${pid}`) }));
    const result = await run({ sendParticipants: transport.sendParticipants, maxPromptChars: 150000 }, owners());
    expect(result.stopReason).toBe('context_full');
    expect(transport.calls.some((call) => call[0].stepRef === 'r15')).toBe(false);
    expect(transport.calls.some((call) => call[0].stepRef === 'r9')).toBe(true);
  });

  test('the same input within the budget is sent whole: the prompt keeps every character of the answer', async () => {
    const transport = fakeTransport(baseReply({ text: (ref, pid) => (pid === 'S28-producer' ? big : `ответ ${ref} ${pid}`) }));
    const result = await run({ sendParticipants: transport.sendParticipants, maxPromptChars: 1000000 }, owners());
    expect(result.stopReason).toBe('steps_done');
    const s29 = transport.calls.find((call) => call[0].stepRef === 'r34');
    expect(s29[0].prompt).toContain(big);
  });
});
