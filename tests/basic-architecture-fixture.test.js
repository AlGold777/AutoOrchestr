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
    decide: async (arg) => { asked.push('decide'); return opts.decide ? opts.decide(arg) : 'continue'; }
  };
}

const run = (extra, options = {}) => Engine.run({ task: 'T', steps: Schema.assemble(schema), ...options, ...extra });

// S01–S05 are the five stages checked in practice (docs/Pipeline scenarios/basic_review_s01_s05_oct14.md): the schema must keep what
// the Design System says about them.
describe('S01–S05 follow the Design System', () => {
  const first = { ...schema, steps: schema.steps.slice(0, 7) };
  test('the Decision Closer receives the Decision Policy, and S05 asks for no owner approval', async () => {
    expect(byRef['r4'].owner).toBeUndefined();
    const transport = fakeTransport(baseReply());
    const decided = [];
    const result = await Engine.run({
      task: 'T', steps: Schema.assemble(first), sendParticipants: transport.sendParticipants,
      provideOwnerResult: async () => 'ПОЛИТИКА_S01', decide: async () => { decided.push('decide'); return 'continue'; }
    });
    expect(result.stopReason).toBe('steps_done');
    const closer = transport.calls.flat().find((request) => request.participantId === 'S03-closer');
    expect(closer.prompt).toContain('ПОЛИТИКА_S01');
    expect(decided).toEqual([]);
  });
});

describe('T18: the architecture schema is valid, shows on the canvas and keeps its settings', () => {
  test('validate passes, the canvas has no errors, the rounds are counted (the limit is 50 rounds)', () => {
    expect(Schema.validate(schema)).toEqual([]);
    const canvas = Schema.toCanvas(schema, { models: MODELS });
    expect(canvas.errors).toEqual([]);
    expect(canvas.rounds).toHaveLength(map.summary.rounds);
    // Counted by the fixture generator: 30 business stages, 53 technical steps (with the route of S18's change), 33 rounds (gates, routes, owner
    // steps and syntheses do not count toward the 50-round limit).
    expect(map.summary).toMatchObject({ businessStages: 30, technicalSteps: 53, rounds: 33, syntheses: 5, gates: 4, routes: 9, owners: 2, ownerApprovals: 3 });
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
    // The owner in the order of the run: the text of owner:s01; approvals of S13, S22, S30 (decide; S05 asks none: the Design System has only an escalation there);
    // route choices after G1 (chg13), after G2 (chg17), after the recomputed S18 (chg18), owner:s25 and its route (chg25).
    expect(ask.asked).toEqual(['owner:s01', 'decide', 'route:chg13', 'route:chg17', 'route:chg18', 'decide', 'owner:s25', 'route:chg25', 'decide']);
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

// T12 (N05): the controlled change of S19. S19-a asks the change once. The baseline is reviewed again (S10, G1), the owner
// goes on (chg13), S14–S18 are recomputed (G2 passes, chg17 goes on), the candidates of S18 are recomputed (r19), and the
// owner returns to S19 (chg18). The first candidates are «КАНДИДАТ_1», the recomputed ones «КАНДИДАТ_2».
// Options are functions of the scenario state: `fired` is true once the change is asked.
function changeRun(opts = {}) {
  const state = { fired: false };
  const transport = fakeTransport(baseReply({
    chg: (who) => {
      if (who !== 'S19-a') return false;
      if (state.fired && !opts.chgAgain) return false;
      state.fired = true;
      return true;
    },
    text: (ref, pid) => {
      if (ref !== 'r19') return undefined;
      if (opts.dead?.(pid, state)) return '';
      return `КАНДИДАТ_${state.fired ? 2 : 1}_${pid}`;
    }
  }));
  const choose = (ref) => {
    if (ref === 'route:chg13' && opts.returnAtChg13 && state.fired) return 'return';
    if (ref === 'route:chg18' && state.fired) return 'return';
    return 'next';
  };
  const ask = owners({ choose, decide: (arg) => (opts.decide ? opts.decide(arg, state) : 'continue') });
  return { state, transport, ask };
}
const callsOf = (transport, ref) => transport.calls.filter((call) => call[0].stepRef === ref);
const orderOf = (transport) => transport.calls.map((call) => call[0].stepRef);

describe('T12: the change of S19 is run to the end (N05): recomputation, then return to S19', () => {
  test('the run goes back to S19 after every recomputed input, and finishes: the stack is empty, the visits and the new versions are right', async () => {
    const { transport, ask, state } = changeRun();
    const result = await run({ sendParticipants: transport.sendParticipants }, ask);
    expect(result.stopReason).toBe('steps_done');
    expect(state.fired).toBe(true);
    expect(result.state.continuationStack).toEqual([]);
    const visits = (ref) => result.steps.filter((step) => step.ref === ref).map((step) => step.visit);
    ['r11', 'r15', 'r16', 'r18', 'r19', 'r20', 'route:chg18'].forEach((ref) => expect(visits(ref)).toEqual([1, 2]));
    // Order: the baseline, then the recomputed candidates, then S19 again; nothing of S19 before its candidates are new.
    const order = orderOf(transport);
    const second = (ref) => order.indexOf(ref, order.indexOf(ref) + 1);
    expect(second('r11')).toBeLessThan(second('r19'));
    expect(second('r19')).toBeLessThan(second('r20'));
    // The second round of S18 sends both participants again without the first candidates; S19 reads the new candidate of the other one.
    expect(callsOf(transport, 'r19')[1].every((request) => !request.prompt.includes('КАНДИДАТ_1'))).toBe(true);
    const reviewB = callsOf(transport, 'r20')[1].find((request) => request.participantId === 'S19-a');
    expect(reviewB.prompt).toContain('КАНДИДАТ_2_S18-b');
    expect(reviewB.prompt).not.toContain('КАНДИДАТ_1');
    // The author of the revision of S18-a (r22) takes the recomputed candidate of its own line, not the first one.
    const revision = callsOf(transport, 'r22')[0][0];
    expect(revision.prompt).toContain('КАНДИДАТ_2_S18-a');
    expect(revision.prompt).not.toContain('КАНДИДАТ_1_S18-a');
    // The line of S18-a: the first candidate is stale; the recomputed one and its revision (by S18-a, r22) are valid,
    // and the revision starts from the recomputed candidate.
    const line = result.artifacts.filter((entry) => entry.lineage.step === 'r19' && entry.lineage.participant === 'S18-a');
    expect(line.find((entry) => entry.source.step === 'r19' && entry.source.visit === 1)).toMatchObject({ valid: false });
    expect(line.filter((entry) => entry.valid).map((entry) => [entry.source.step, entry.source.participant])).toEqual([['r19', 'S18-a'], ['r22', 'S18-a']]);
    expect(line.find((entry) => entry.source.step === 'r22').inputs[0].source).toMatchObject({ step: 'r19', visit: 2 });
    expect(result.artifacts.find((entry) => entry.lineage.step === 'r19' && entry.lineage.participant === 'S18-b' && entry.source.visit === 2)).toMatchObject({ valid: true });
  });

  test('a reload in the change is applied once: from the snapshot before the transition and from the one after it, S10 is sent once', async () => {
    const snapshots = [];
    const first = changeRun();
    const original = await run({ sendParticipants: first.transport.sendParticipants,
      checkpoint: async (state) => { snapshots.push(JSON.parse(JSON.stringify(state))); } }, first.ask);
    expect(original.stopReason).toBe('steps_done');
    const before = snapshots.find((state) => state.pc === 'route:chg19' && state.current?.phase === 'transition' && !state.current.applied);
    const after = snapshots.find((state) => state.pc === 'route:chg19' && state.current?.applied?.target === 'r11');
    expect(before).toBeDefined();
    expect(after).toBeDefined();
    for (const snapshot of [before, after]) {
      const store = { ...original.texts };
      const replay = changeRun();
      replay.state.fired = true;
      const resumed = await run({ sendParticipants: replay.transport.sendParticipants, resume: snapshot,
        getText: (ref) => store[ref], putText: (value) => { const ref = `new-${Object.keys(store).length}`; store[ref] = value; return ref; } }, replay.ask);
      expect(resumed.stopReason).toBe('steps_done');
      expect(callsOf(replay.transport, 'r11')).toHaveLength(1);
      expect(resumed.state.loopCounters['route:chg19:chg_pfb_synthetic']).toBe(1);
      expect(resumed.state.continuationStack).toEqual([]);
    }
  });

  test('the change is not run twice: a second review that asks it again stops at the limit (loop_limit), and S10 is not sent a third time', async () => {
    const { transport, ask } = changeRun({ chgAgain: true });
    const result = await run({ sendParticipants: transport.sendParticipants }, ask);
    expect(result.stopReason).toBe('loop_limit');
    expect(result.stopDetail).toContain('chg_pfb_synthetic');
    expect(callsOf(transport, 'r11')).toHaveLength(2);
  });

  test('stale input: the owner returns at chg13 before S18 is recomputed; S19 gets no request, the stop names S18-b and S19', async () => {
    const { transport, ask } = changeRun({ returnAtChg13: true });
    const result = await run({ sendParticipants: transport.sendParticipants }, ask);
    expect(result.stopReason).toBe('missing_input');
    expect(result.stopDetail).toContain('S18-b');
    expect(result.stopDetail).toContain('r20');
    // S19 was sent once (the first review); the second one did not go out.
    expect(callsOf(transport, 'r20')).toHaveLength(1);
  });

  test('failed recomputation: a candidate of S18 with no answer in the recomputed round stops before the return; no owner route, no request of S19', async () => {
    const { transport, ask } = changeRun({ dead: (pid, state) => state.fired && pid === 'S18-b', decide: (arg, state) => (state.fired && arg.failed.includes('S18-b') ? null : 'continue') });
    const result = await run({ sendParticipants: transport.sendParticipants }, ask);
    expect(result.stopReason).toBe('no_decision');
    expect(callsOf(transport, 'r20')).toHaveLength(1);
    expect(result.steps.some((step) => step.ref === 'route:chg18' && step.visit === 2)).toBe(false);
  });

  test('skipped recomputation: the owner skips the recomputed S18 round; the required candidate is missing, the route does not return to S19', async () => {
    const { transport, ask } = changeRun({ dead: (pid, state) => state.fired && pid === 'S18-b', decide: (arg, state) => (state.fired && arg.failed.includes('S18-b') ? 'skip' : 'continue') });
    const result = await run({ sendParticipants: transport.sendParticipants }, ask);
    expect(result.stopReason).toBe('missing_input');
    expect(result.stopDetail).toContain('r19');
    expect(result.stopDetail).toContain('route:chg18');
    expect(callsOf(transport, 'r20')).toHaveLength(1);
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
      if (ref === 'r29' && pid === 'S27-a' && attempt === 1) return JSON.stringify({ requiresVerification: false });
      return baseReply()(ref, pid);
    });
    const result = await run({ sendParticipants: transport.sendParticipants }, owners());
    expect(result.stopReason).toBe('steps_done');
    const batches = transport.calls.filter((call) => call[0].stepRef === 'r29');
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
