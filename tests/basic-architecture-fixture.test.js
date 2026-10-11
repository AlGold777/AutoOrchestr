// T18 and T19 (ТЗ 10): the architecture of 30 stages (design-system-architecture.md) as one Basic schema,
// the S01–S30 → technical refs table, the count of steps, and runs of the whole schema on a fake transport.
// The schema and the table are fixtures: tests/fixtures/basic-architecture-s01-s30.json and …map.json.
// Synthetic conditions (Q10: return and change conditions the architecture does not define) are marked in the
// table (`synthetic`). Fake send and owner callbacks only: no provider is called.
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

// The plain answers of the architecture: gates pass, the synthetic conditions are off unless the test turns them on.
function baseReply(opts = {}) {
  return (stepRef, participantId) => {
    if (stepRef.startsWith('gate:')) return 'ВЕРДИКТ: ПРОШЁЛ';
    if (participantId === 'S12-reviewer') return JSON.stringify({ decisionImpact: opts.decisionImpact?.() ?? 'no', findings: 'ЗАМЕЧАНИЕ_S12' });
    if (participantId === 'S19-a' || participantId === 'S19-b') return JSON.stringify({ chgProposal: opts.chg?.(participantId) ? 'yes' : 'no', review: 'r' });
    if (participantId === 'S26-closer') return JSON.stringify({ closedDecisions: 'c', directionBroken: false });
    if (participantId === 'S27-a' || participantId === 'S27-b') return JSON.stringify({ requiresVerification: false, failures: 'x' });
    if (participantId === 'S29-reviewer') return JSON.stringify({ outcome: opts.outcome?.() ?? 'baseline' });
    return opts.text?.(stepRef, participantId) ?? `ответ ${stepRef} ${participantId}`;
  };
}

// The owner and the route choices of the architecture: the owner approves, chooses «next» and, where it is set, returns.
function owners(opts = {}) {
  const asked = [];
  return {
    asked,
    provideOwnerResult: async ({ stepRef }) => { asked.push(stepRef); return `текст владельца ${stepRef}`; },
    chooseRoute: async ({ stepRef }) => { asked.push(stepRef); return opts.choose?.(stepRef) ?? 'next'; },
    decide: async () => { asked.push('decide'); return opts.decide ? opts.decide() : 'continue'; }
  };
}

const run = (extra, options = {}) => Engine.run({ task: 'T', steps: Schema.assemble(schema), ...options, ...extra });

describe('T18: the architecture schema is valid, shows on the canvas and keeps its settings', () => {
  test('validate passes, the canvas has no errors, the rounds are counted (the limit is 50 rounds)', () => {
    expect(Schema.validate(schema)).toEqual([]);
    const canvas = Schema.toCanvas(schema, { models: MODELS });
    expect(canvas.errors).toEqual([]);
    expect(canvas.rounds).toHaveLength(map.summary.rounds);
    // Counted by the fixture generator: 30 business stages, 52 technical steps, 33 rounds (gates, routes, owner
    // steps and syntheses do not count toward the 50-round limit).
    expect(map.summary).toMatchObject({ businessStages: 30, technicalSteps: 52, rounds: 33, syntheses: 5, gates: 4, routes: 8, owners: 2, ownerApprovals: 4 });
    expect(map.summary.rounds).toBeLessThanOrEqual(50);
    expect(Schema.graph(schema.steps).cycle).toBeNull();
  });

  test('every business stage S01–S30 maps to existing steps, and every step belongs to a stage', () => {
    const stages = map.stages.map((item) => item.stage);
    expect(stages).toEqual(Array.from({ length: 30 }, (_, i) => `S${String(i + 1).padStart(2, '0')}`));
    const mapped = map.stages.flatMap((item) => item.refs);
    mapped.forEach((ref) => expect(byRef[ref]).toBeDefined());
    expect(new Set(mapped).size).toBe(mapped.length);
    expect(new Set(mapped)).toEqual(new Set(schema.steps.map((step) => step.ref)));
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

  test('gates G1–G4 are gate steps after S13, S17, S22 and S30 with criteria and pass rules', () => {
    const gates = schema.steps.filter((step) => step.kind === 'gate');
    expect(gates.map((gate) => gate.ref)).toEqual(['gate:g1', 'gate:g2', 'gate:g3', 'gate:g4']);
    gates.forEach((gate) => {
      expect(gate.criteria.length).toBeGreaterThan(0);
      expect(gate.pass).toBe('all');
      expect(gate.onFail).toBe('ask');
    });
    expect(byRef['r15'].owner).toBe('approve');
    expect(byRef['r33'].owner).toBe('approve');
  });

  test('the returns and controlled changes are transitions with a limit (synthetic conditions are marked in the table)', () => {
    const actionOf = (ref, caseId) => byRef[ref].select.cases.find((item) => item.id === caseId)?.action;
    expect(actionOf('route:s12', 'back_s10_synthetic')).toMatchObject({ goto: 'r11', maxLoops: 2 });
    expect(actionOf('route:chg19', 'chg_pfb_synthetic')).toMatchObject({ goto: 'r11', maxLoops: 1, resumeAt: 'r20' });
    expect(actionOf('route:chg13', 'return')).toMatchObject({ return: true, maxLoops: 1 });
    expect(actionOf('route:chg25', 'chg_aip')).toMatchObject({ goto: 'r17', maxLoops: 1, resumeAt: 'owner:s25' });
    expect(actionOf('route:chg17', 'return')).toMatchObject({ return: true, maxLoops: 1 });
    expect(actionOf('route:s26', 'direction_broken_synthetic')).toMatchObject({ goto: 'r25', maxLoops: 1 });
    expect(actionOf('route:s27', 'verify_s24_synthetic')).toMatchObject({ goto: 'r27', maxLoops: 1 });
    expect(actionOf('route:s29', 'close_s26_synthetic')).toMatchObject({ goto: 'r28', maxLoops: 1 });
    expect(actionOf('route:s29', 'revise_s28_synthetic')).toMatchObject({ goto: 'r30', maxLoops: 2 });
    expect(actionOf('route:s29', 'baseline_s30')).toEqual({ goto: 'r33' });
    expect(map.synthetic.map((item) => item.ref)).toEqual(['route:s12', 'route:chg19', 'route:s26', 'route:s27', 'route:s29']);
  });

  test('the settings of the canvas keep every explicit field of every step (no silent loss)', () => {
    const settings = Schema.toSettings(schema);
    schema.steps.forEach((step) => {
      if (step.kind === 'round') {
        const expected = Object.fromEntries(['order', 'input', 'task', 'require', 'owner', 'chat', 'output'].filter((key) => key in step).map((key) => [key, step[key]]));
        expect(settings.customRoundSettings[step.ref]).toEqual(expected);
      } else {
        const fields = ['input', 'task', 'require', 'owner', 'chat', 'output', 'criteria', 'pass', 'onFail', 'onPass', 'select'];
        const expected = Object.fromEntries(fields.filter((key) => key in step).map((key) => [key, step[key]]));
        expect(settings.customStepSettings[step.ref]).toEqual(expected);
      }
    });
    // Per-participant inputs of S19 (each reviewer sees the other candidate) are kept with the participant.
    expect(settings.customModelSettings['r20']['S19-a'].input).toEqual(byRef.r20.models[0].input);
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
  test('the linear run goes through all 52 steps in order; gates and owner steps are asked where the table says', async () => {
    const transport = fakeTransport(baseReply());
    const ask = owners();
    const result = await run({ sendParticipants: transport.sendParticipants }, ask);
    expect(result.stopReason).toBe('steps_done');
    expect(result.steps.map((step) => step.ref)).toEqual(schema.steps.map((step) => step.ref));
    // One request per participant of the schema (53); the transport gets one batch per wave of a step.
    expect(transport.calls.reduce((sum, call) => sum + call.length, 0)).toBe(map.summary.participantsTotal);
    // The owner in the order of the run: the text of owner:s01; approvals of S05, S13, S22, S30 (decide);
    // route choices after G1 (chg13), after G2 (chg17), owner:s25 and its route (chg25).
    expect(ask.asked).toEqual(['owner:s01', 'decide', 'decide', 'route:chg13', 'route:chg17', 'decide', 'owner:s25', 'route:chg25', 'decide']);
  });

  test('S12 returns to S10 once: the second visit of S10 gets the reviewer findings in the feedback block, the limit is 2', async () => {
    let returned = false;
    const transport = fakeTransport(baseReply({ decisionImpact: () => (returned ? 'no' : (returned = true, 'yes')) }));
    const result = await run({ sendParticipants: transport.sendParticipants }, owners());
    expect(result.stopReason).toBe('steps_done');
    const s10 = transport.calls.filter((call) => call[0].stepRef === 'r11');
    expect(s10).toHaveLength(2);
    expect(s10[0][0].prompt).not.toContain('ЗАМЕЧАНИЕ_S12');
    expect(s10[1][0].prompt).toContain('ЗАМЕЧАНИЕ_S12');
  });

  test('S12 that always returns stops at the third transition: loop_limit, the counter keeps its value', async () => {
    const transport = fakeTransport(baseReply({ decisionImpact: () => 'yes' }));
    const result = await run({ sendParticipants: transport.sendParticipants }, owners());
    expect(result.stopReason).toBe('loop_limit');
    expect(transport.calls.filter((call) => call[0].stepRef === 'r11')).toHaveLength(3);
  });

  test('a null owner decision on the approved last step is no_decision, and the run does not finish', async () => {
    const transport = fakeTransport(baseReply());
    const ask = owners({ decide: () => null });
    const result = await run({ sendParticipants: transport.sendParticipants }, ask);
    expect(result.stopReason).toBe('no_decision');
    expect(result.steps.at(-1).ref).not.toBe('gate:g4');
  });

  test('CHG S19 → S10 with resumeAt S19: the run stops with missing_input on S19 (the candidates of S18 are stale through the changed baseline); not a silent continuation', async () => {
    let fired = false;
    let returned = false;
    const transport = fakeTransport(baseReply({ chg: (who) => who === 'S19-a' && !fired && (fired = true) }));
    // The owner returns at the first choice after the change; before the change every choice is next.
    const choose = (ref) => (ref === 'route:chg13' && fired && !returned ? (returned = true, 'return') : 'next');
    const result = await run({ sendParticipants: transport.sendParticipants }, owners({ choose }));
    expect(result.stopReason).toBe('missing_input');
    expect(result.stopDetail).toContain('S18-b');
    expect(result.stopDetail).toContain('r20');
  });

  test('CHG S25 → AIP: the owner returns to owner:s25 after G2; the next transition is counted once; the stale backlog S24 stops S26 with missing_input (fail-closed)', async () => {
    let aip = false;
    let returned = false;
    // S25 asks for the change once; the owner returns at the choice after G2 that follows the change.
    const choose = (ref) => {
      if (ref === 'route:chg25' && !aip) { aip = true; return 'chg_aip'; }
      if (ref === 'route:chg17' && aip && !returned) { returned = true; return 'return'; }
      return 'next';
    };
    const ask = owners({ choose });
    const transport = fakeTransport(baseReply());
    const result = await run({ sendParticipants: transport.sendParticipants }, ask);
    expect(result.stopReason).toBe('missing_input');
    expect(result.stopDetail).toContain('S24-synth');
    expect(result.stopDetail).toContain('r27');
    expect(result.steps.map((step) => step.ref)).toContain('owner:s25');
    expect(transport.calls.some((call) => call[0].stepRef === 'r28')).toBe(false);
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

describe('T19: a large input is not cut and stops before the request (stress fixture: synthetic sizes, not real documents)', () => {
  const big = 'Ж'.repeat(100000);
  test('the input of S30 larger than the budget stops before its request; the stored texts are whole', async () => {
    const transport = fakeTransport(baseReply({ text: (ref, pid) => (pid === 'S28-producer' || pid === 'S29-verifier' ? big : `ответ ${ref} ${pid}`) }));
    const result = await run({ sendParticipants: transport.sendParticipants, maxPromptChars: 150000 }, owners());
    expect(result.stopReason).toBe('context_full');
    expect(transport.calls.some((call) => call[0].stepRef === 'r33')).toBe(false);
    const s28 = transport.calls.find((call) => call[0].stepRef === 'r28');
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
    const s29 = transport.calls.find((call) => call[0].stepRef === 'r31');
    expect(s29[0].prompt).toContain(big);
  });
});
