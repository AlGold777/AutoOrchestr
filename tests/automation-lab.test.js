/** @jest-environment node */
const path = require('path');
const crypto = require('crypto');

const Canonical = require('../automation/al-canonical.js');
const Schema = require('../automation/al-schema.js');
const Parser = require('../automation/al-response-parser.js');
const Spec = require('../automation/al-spec.js');
const Store = require('../automation/al-store.js');
const Snapshot = require('../automation/al-snapshot.js');
const Compiler = require('../automation/al-prompt-compiler.js');
const Validator = require('../automation/al-validator.js');
const Committer = require('../automation/al-committer.js');
const { createEngine } = require('../automation/al-engine.js');
const Sim = require('../automation/al-simulator.js');
const Transport = require('../automation/al-transport.js');
const SpecSync = require('../scripts/automation-spec-sync.js');

const SPEC_DIR = path.join(__dirname, '..', 'automation-spec');
const loadFiles = () => {
  const spec = Spec.loadFromDir(SPEC_DIR);
  return JSON.parse(JSON.stringify(spec.files));
};
const spec = Spec.loadFromDir(SPEC_DIR);
const clone = (value) => JSON.parse(JSON.stringify(value));
const IDEA = 'Сервис онлайн-записи к врачу для небольших клиник';

async function newEngine({ faults = [], styles = {}, store = Store.createMemoryStore(), transport } = {}) {
  const sim = transport || Sim.createSimulatorTransport({ latencyMs: 0, faults, styles });
  const engine = createEngine({ spec, store, transport: sim });
  return { engine, sim, store };
}

async function answerFirstOptions(engine, projectId, pick = 0) {
  const state = await engine.getState(projectId);
  const answers = {};
  state.project.wait.qst_ids.forEach((id) => {
    const qst = state.latest.find((entry) => entry.object_id === id);
    answers[id] = [qst.payload.options[pick].option_id];
  });
  return engine.answer(projectId, answers);
}

async function runToCompletion(engine, projectId) {
  for (let i = 0; i < 6; i += 1) {
    await engine.run(projectId);
    const state = await engine.getState(projectId);
    if (state.project.workflow_state !== 'WAITING_FOR_SELECTION') return state;
    await answerFirstOptions(engine, projectId);
  }
  return engine.getState(projectId);
}

// Builds a real prompt + simulator answer for a stage from a live project state.
async function stageFixture(stageN) {
  const { engine, store } = await newEngine();
  const projectId = await engine.createProject({ ideaText: IDEA, models: ['Claude', 'GPT', 'Gemini'] });
  let state = await engine.getState(projectId);
  const runUntil = async () => {
    while (state.project.next_stage !== stageN || state.project.workflow_state !== 'READY') {
      if (state.project.workflow_state === 'WAITING_FOR_SELECTION') await answerFirstOptions(engine, projectId);
      else {
        // execute exactly the next stage
        if (state.project.next_stage === stageN) break;
        await engine.run(projectId, { untilStage: stageN });
      }
      state = await engine.getState(projectId);
      if (state.project.workflow_state === 'PILOT_COMPLETE') break;
    }
  };
  if (stageN > 1) await runUntil();
  const stage = spec.stage(stageN);
  const latest = state.latest;
  const { entries } = Snapshot.resolveInputs(stage, latest);
  const snapshot = Snapshot.buildSnapshot({ projectId, stage, entries });
  const tokens = { callToken: 'Ctest0001', attemptToken: 'Atest0001' };
  const compiled = Compiler.compile({ spec, stage, snapshot, tokens });
  const parsed = Sim.parsePrompt(compiled.text);
  const value = Sim.respond(stageN, parsed.active, 'GPT');
  return { stage, snapshot, value, compiled, tokens, store, engine, projectId };
}

describe('canonical primitives', () => {
  test('sha256Hex matches node crypto and JCS sorts keys', () => {
    ['', 'abc', 'x'.repeat(1000), 'привет 🌍'].forEach((text) => {
      expect(Canonical.sha256Hex(text)).toBe(crypto.createHash('sha256').update(text).digest('hex'));
    });
    expect(Canonical.jcs({ b: 1, a: [true, null, 'é'], c: undefined })).toBe('{"a":[true,null,"é"],"b":1}');
    expect(Canonical.isBareHash('sha256:' + 'a'.repeat(64))).toBe(false);
  });
});

describe('spec bundle', () => {
  test('manifest_lint passes for the v2.2.4 bundle and the runtime copy is in sync', () => {
    expect(spec.ok).toBe(true);
    expect(spec.problems).toEqual([]);
    expect(spec.version).toBe('2.2.4');
    expect(SpecSync.run({ check: true })).toEqual([]);
  });

  test('the bundle static contract runner passes', () => {
    const { execFileSync } = require('child_process');
    const out = execFileSync(process.execPath, [path.join(SpecSync.BUNDLE, 'tests', 'automation-static-contracts.mjs')], { encoding: 'utf8' });
    expect(out).toMatch(/^PASS v2\.2\.4/);
  });

  test('lint detects the v2.2.3 dead ends (DPL and PCON never activated)', () => {
    const files = loadFiles();
    const s1 = files.stages.find((stage) => stage.n === 1);
    const s4 = files.stages.find((stage) => stage.n === 4);
    delete s1.contract.runtime_questionnaire;
    s4.contract.initial_statuses.PCON = 'DRAFT';
    const problems = Spec.lint(files).map((problem) => `${problem.code} ${problem.detail}`);
    expect(problems).toEqual(expect.arrayContaining([
      expect.stringContaining('INPUT_STATUS_UNREACHABLE stage 4 requires DPL'),
      expect.stringContaining('INPUT_STATUS_UNREACHABLE stage 5 requires PCON')
    ]));
  });

  test('lint detects a stale compact contract and contradictory repair budgets', () => {
    const files = loadFiles();
    files.alSchema.title = 'changed';
    files.stages.find((stage) => stage.n === 2).execution.repair_attempts = 2;
    const codes = Spec.lint(files).map((problem) => problem.code);
    expect(codes).toEqual(expect.arrayContaining(['COMPACT_CONTRACT_STALE', 'REPAIR_BUDGET_CONTRADICTION']));
  });

  test('engine refuses to start when lint fails', () => {
    const files = loadFiles();
    files.promptContract.full_schema_hash = 'a'.repeat(64);
    expect(() => createEngine({ spec: Spec.create(files), store: Store.createMemoryStore(), transport: {} })).toThrow(/MANIFEST_LINT_FAILED/);
  });
});

describe('JSON Schema interpreter agrees with Ajv', () => {
  const Ajv = require('ajv');
  const ajv = new Ajv({ strict: false, allErrors: true });
  const ajvValidate = ajv.compile(spec.files.alSchema);

  test('valid and mutated AL-STRUCT-1 responses get the same verdict', async () => {
    const samples = [];
    for (const n of [1, 2, 3, 4, 5]) samples.push((await stageFixture(n)).value);
    const mutations = [
      (v) => { delete v.passport; },
      (v) => { v.passport.input_snapshot_hash = 'sha256:' + 'a'.repeat(64); },
      (v) => { v.outputs[0].type = 'SUMMARY'; },
      (v) => { v.extra = 1; },
      (v) => { v.changes[0].op = 'DELETE'; },
      (v) => { v.changes[0].target_ref = { code: 'IDEA', object_id: 'IDEA-0001', version: 1 }; },
      (v) => { v.changes.push({ op: 'MERGE', object_type: 'PD', temp_id: 'tmp-x', source_output_id: 'OUT-1', source_refs: [] }); },
      (v) => { v.completion.empty_by_design = true; },
      (v) => { v.dispositions.push({ input_ref: { code: 'PRP', object_id: 'PRP-0001', version: 1 }, action: 'KEEP', result_temp_ids: [], reason_code: 'X' }); },
      (v) => { v.changes[0].state_patch = {}; },
      (v) => { v.trace[0].source_ids = ['a', 'a']; },
      (v) => { v.passport.stage = 0; }
    ];
    const cases = [...samples, ...samples.flatMap((sample) => mutations.map((mutate) => { const copy = clone(sample); try { mutate(copy); } catch (_) { /* shape-dependent */ } return copy; }))];
    cases.forEach((value) => {
      expect(Schema.validate(spec.files.alSchema, value).length === 0).toBe(ajvValidate(value));
    });
    Object.entries(spec.files.objectSchemas).forEach(([code, schema]) => {
      const compiled = ajv.compile(schema);
      [{}, { question: 'q', impacts: [], evidence_required: 'x', route: 'DEFER' }].forEach((payload) => {
        expect([code, Schema.validate(schema, payload).length === 0]).toEqual([code, compiled(payload)]);
      });
    });
  });
});

describe('response frame extraction', () => {
  const tokens = { callToken: 'Cabc12345', attemptToken: 'Axyz67890' };
  const frame = (inner, t = tokens) => `PAF_RESPONSE_BEGIN ${t.callToken} ${t.attemptToken}\n${inner}\nPAF_RESPONSE_END ${t.callToken} ${t.attemptToken}`;
  const obj = '{"passport":{"a":1},"text":"x"}';

  test('accepts the three deterministic modes', () => {
    expect(Parser.extract(frame(obj), tokens)).toMatchObject({ ok: true, mode: 'WHOLE_TEXT_JSON' });
    expect(Parser.extract(`Here you go:\n${frame(`Sure!\n\`\`\`json\n${obj}\n\`\`\`\nDone.`)}`, tokens)).toMatchObject({ ok: true, mode: 'SINGLE_FENCED_JSON' });
    expect(Parser.extract(frame(`json\nCopy code\n${obj}`), tokens)).toMatchObject({ ok: true, mode: 'SINGLE_BALANCED_JSON' });
  });

  test('tolerates markdown punctuation around markers and raw newlines in strings', () => {
    const text = `**PAF_RESPONSE_BEGIN ${tokens.callToken} ${tokens.attemptToken}**\n{"a":"line1\nline2"}\n<<<PAF_RESPONSE_END ${tokens.callToken} ${tokens.attemptToken}>>>`;
    const result = Parser.extract(text, tokens);
    expect(result).toMatchObject({ ok: true, controlCharsEscaped: true });
    expect(result.value.a).toBe('line1\nline2');
  });

  test('survives whitespace-collapsed DOM text (fences and JSON on one line)', () => {
    const collapsed = `ChatGPT said: PAF_RESPONSE_BEGIN ${tokens.callToken} ${tokens.attemptToken} \`\`\`json Copy code {"passport": {"a": 1}, "text": "a b"} \`\`\` PAF_RESPONSE_END ${tokens.callToken} ${tokens.attemptToken}`;
    expect(Parser.extract(collapsed, tokens)).toMatchObject({ ok: true, mode: 'SINGLE_BALANCED_JSON', value: { passport: { a: 1 } } });
  });

  test('rejects ambiguity, foreign tokens, missing and incomplete frames', () => {
    expect(Parser.extract(frame(`\`\`\`json\n${obj}\n\`\`\`\n\`\`\`json\n${obj}\n\`\`\``), tokens).code).toBe('STRUCTURE_AMBIGUOUS_JSON');
    expect(Parser.extract(frame(`${obj}\n${obj}`), tokens).code).toBe('STRUCTURE_AMBIGUOUS_JSON');
    expect(Parser.extract(frame(obj, { callToken: 'Cother', attemptToken: 'Aother' }), tokens).code).toBe('FRAME_TOKEN_MISMATCH');
    expect(Parser.extract(obj, tokens).code).toBe('FRAME_MISSING');
    expect(Parser.extract(`PAF_RESPONSE_BEGIN ${tokens.callToken} ${tokens.attemptToken}\n${obj}`, tokens).code).toBe('FRAME_INCOMPLETE');
    expect(Parser.extract(`${frame(obj)}\n${frame(obj)}`, tokens).code).toBe('FRAME_AMBIGUOUS');
    expect(Parser.extract(frame('{"a": }'), tokens).code).toBe('STRUCTURE_INVALID_JSON');
    expect(Parser.extract(frame('no json here'), tokens).code).toBe('STRUCTURE_NO_JSON');
  });
});

describe('prompt compiler', () => {
  test('is deterministic, layered and carries the snapshot identity', async () => {
    const { stage, snapshot, tokens, compiled } = await stageFixture(1);
    const again = Compiler.compile({ spec, stage, snapshot, tokens });
    expect(again.prompt_hash).toBe(compiled.prompt_hash);
    const order = ['## RULES', '## STATE', '## ACTIVE', '## DELTA', '## TASK'].map((marker) => compiled.text.indexOf(marker));
    expect(order.every((index, i) => index > 0 && (i === 0 || index > order[i - 1]))).toBe(true);
    expect(compiled.text).toContain(snapshot.input_snapshot_hash);
    expect(compiled.text).toContain(`PAF_RESPONSE_BEGIN ${tokens.callToken} ${tokens.attemptToken}`);
    expect(compiled.text).toContain(spec.files.promptContract.full_schema_hash);
    expect(compiled.text).not.toContain('"$id"');
  });

  test('fails closed with PROMPT_TOO_LARGE and compacts context with [OBJ:TRUNC]', async () => {
    const { stage, snapshot, tokens } = await stageFixture(1);
    const tiny = Spec.create({ ...clone(spec.files), contextPolicy: { ...spec.files.contextPolicy, maxPromptChars: 500 } });
    expect(Compiler.compile({ spec: tiny, stage, snapshot, tokens })).toMatchObject({ ok: false, code: 'PROMPT_TOO_LARGE' });
    const big = clone(snapshot);
    big.items[0].payload.raw_text = 'x'.repeat(70000);
    const compiled = Compiler.compile({ spec, stage, snapshot: big, tokens });
    expect(compiled.ok).toBe(true);
    expect(compiled.compacted).toBe(true);
    expect(compiled.text).toContain('[OBJ:TRUNC]');
    expect(big.items[0].payload.raw_text.length).toBe(70000);
  });
});

describe('response validation and policy engine', () => {
  const run = (fixture, mutate) => {
    const value = clone(fixture.value);
    mutate?.(value);
    return Validator.validateResponse({ spec, stage: fixture.stage, snapshot: fixture.snapshot, value, model: 'GPT' });
  };
  const codes = (result) => result.errors.map((error) => error.code);

  test('simulator answers validate for all five stages', async () => {
    for (const n of [1, 2, 3, 4, 5]) {
      const fixture = await stageFixture(n);
      const result = run(fixture);
      expect([n, result.ok, result.errors]).toEqual([n, true, []]);
    }
  });

  test('stage 1: snapshot ack, reference-first and emptiness rules', async () => {
    const f = await stageFixture(1);
    expect(codes(run(f, (v) => { v.passport.input_snapshot_hash = 'f'.repeat(64); }))).toContain('SNAPSHOT_HASH_MISMATCH');
    expect(run(f, (v) => { v.passport.input_snapshot_hash = 'f'.repeat(64); }).errors[0].class).toBe('REPRESENTATION');
    expect(codes(run(f, (v) => { v.passport.input_refs.push({ code: 'IDEA', object_id: 'IDEA-0099', version: 1 }); }))).toContain('CANONICAL_ID_INVENTION');
    expect(codes(run(f, (v) => { v.changes[0].payload.selected_from = [{ code: 'IDEA', object_id: 'IDEA-0001', version: 7 }]; }))).toContain('REFERENCE_NOT_IN_SNAPSHOT');
    expect(codes(run(f, (v) => { v.changes[0].payload.status = 'ACTIVE'; }))).toContain('RESERVED_RUNTIME_FIELD');
    expect(codes(run(f, (v) => { v.changes[0].state_patch = { status: 'ACTIVE' }; }))).toContain('STATUS_NOT_PROPOSABLE');
    expect(codes(run(f, (v) => { v.changes = v.changes.filter((c) => c.object_type !== 'DPL'); }))).toContain('CARDINALITY_MIN');
    expect(codes(run(f, (v) => { v.changes.push({ ...clone(v.changes[0]), temp_id: 'tmp-dpl-2' }); }))).toContain('CARDINALITY_MAX');
    expect(codes(run(f, (v) => { v.outputs = []; v.changes = []; v.trace = []; v.input_fate = []; Object.assign(v.completion, { output_ids: [], output_count: 0, empty_by_design: true, reason: 'NO_MATERIAL_DELTA' }); })))
      .toEqual(expect.arrayContaining(['EMPTY_NOT_ALLOWED', 'MATERIAL_OUTPUT_REQUIRED']));
    expect(codes(run(f, (v) => { v.completion.output_count = 3; }))).toContain('OUTPUT_COUNT_MISMATCH');
    expect(codes(run(f, (v) => { v.changes[2].payload.relied_on_by = [{ code: 'DPL', temp_id: 'tmp-nope' }]; }))).toContain('TEMP_REF_UNRESOLVED');
    expect(codes(run(f, (v) => { v.changes.push({ op: 'CREATE', object_type: 'PD', temp_id: 'tmp-pd-1', source_output_id: 'OUT-1', payload: {} }); }))).toContain('MUTATION_NOT_PERMITTED');
    expect(codes(run(f, (v) => { v.dispositions = [{ input_ref: v.passport.input_refs[0], action: 'PRESERVE', result_temp_ids: [], reason_code: 'X' }]; }))).toContain('DISPOSITIONS_MUST_BE_EMPTY');
  });

  test('bare object ids in input_fate/trace are normalized to input keys before schema validation', async () => {
    const f = await stageFixture(1);
    const result = run(f, (v) => { v.input_fate[0].input_id = 'IDEA-0001'; v.trace[0].source_ids = ['IDEA-0001']; });
    expect(result.ok).toBe(true);
    expect(result.anomalies.join(' ')).toContain('IDEA-0001 -> IDEA-0001@v1');
  });

  test('the stage 3 prompt narrows QST effects to the stage contract', async () => {
    const f = await stageFixture(3);
    const shapes = f.compiled.text.split('Payload shapes')[1].split('Schema example')[0];
    expect(shapes).toContain('CLOSE_PD|DEFER_PD|CREATE_ASM');
    expect(shapes).not.toContain('ACTIVATE_DPL');
    expect(shapes).toContain('TempRef');
  });

  test('stage 2: runtime-injected identity cannot come from the model', async () => {
    const f = await stageFixture(2);
    expect(codes(run(f, (v) => { v.changes[0].payload.source_model = 'Claude'; }))).toContain('RUNTIME_INJECTED_FIELD');
  });

  test('stage 3: disposition reconciliation and authority routing', async () => {
    const f = await stageFixture(3);
    expect(f.snapshot.accountable.length).toBeGreaterThanOrEqual(6);
    expect(codes(run(f, (v) => { v.dispositions.pop(); }))).toContain('DISPOSITION_INCOMPLETE');
    expect(codes(run(f, (v) => { v.dispositions.push(clone(v.dispositions[0])); }))).toContain('DISPOSITION_DUPLICATE');
    expect(codes(run(f, (v) => { v.dispositions[0].input_ref = { code: 'IDEA', object_id: 'IDEA-0001', version: 1 }; }))).toContain('DISPOSITION_FOREIGN_REF');
    expect(codes(run(f, (v) => {
      const rejected = v.dispositions.find((d) => d.action === 'REJECT');
      v.changes.find((c) => c.object_type === 'PD' && c.op === 'CREATE').source_refs.push(rejected.input_ref);
    }))).toContain('HIDDEN_TRANSFORMATION');
    expect(codes(run(f, (v) => { const pd = v.changes.find((c) => c.temp_id === 'tmp-pd-1'); pd.state_patch.status = 'CLOSED'; pd.payload.decision = 'x'; }))).toContain('AUTHORITY_EXPANSION');
    expect(codes(run(f, (v) => { v.changes = v.changes.filter((c) => c.object_type !== 'QST'); }))).toContain('QST_REQUIRED');
    expect(codes(run(f, (v) => { v.changes.find((c) => c.object_type === 'QST').payload.options[0].effects[0].effect_type = 'ACTIVATE_DPL'; }))).toContain('QST_EFFECT_NOT_ALLOWED');
    expect(codes(run(f, (v) => { v.changes.find((c) => c.object_type === 'PD').state_patch = { status: 'OPEN' }; }))).toContain('STATE_PATCH_REQUIRED');
    expect(codes(run(f, (v) => { const d = v.dispositions.find((x) => x.action === 'REJECT'); v.input_fate.find((x) => x.input_id === `${d.input_ref.object_id}@v1`).disposition = 'PRESERVED'; }))).toContain('INPUT_FATE_CONFLICT');
    const ok = run(f);
    const a1 = ok.plan.creates.find((item) => item.code === 'PD' && item.authority_class === 'A1');
    expect(a1.status).toBe('NEEDS_EVIDENCE');
    expect(ok.plan.consequences.map((c) => c.to_status)).toEqual(expect.arrayContaining(['MERGED', 'SUPERSEDED', 'REJECTED']));
  });

  test('a DPL can never widen A2/A3 to automatic closure', () => {
    const dpl = { authority_rules: [{ authority_class: 'A2', decision_kinds: ['x'], mode: 'AUTO_POLICY', max_risk: 'HIGH' }, { authority_class: 'A4', decision_kinds: ['y'], mode: 'AUTO_POLICY', max_risk: 'LOW' }] };
    expect(Validator.policyMode(dpl, 'A2')).toBe('REQUIRE_OWNER_SELECTION');
    expect(Validator.policyMode(dpl, 'A4')).toBe('PROHIBITED');
    expect(Validator.policyMode(null, 'A1')).toBe('REQUIRE_EVIDENCE');
  });

  test('stage 5: findings must target the reviewed PCON', async () => {
    const f = await stageFixture(5);
    expect(codes(run(f, (v) => { v.changes[0].payload.target = v.passport.input_refs.find((r) => r.code === 'IDEA'); }))).toContain('PAYLOAD_REF_CONSTRAINT');
  });
});

describe('store atomicity', () => {
  test('a failing transaction leaves no partial writes', async () => {
    const store = Store.createMemoryStore();
    await store.transaction('*', 'readwrite', (t) => t.put('projects', { project_id: 'P1', revision: 1 }));
    await expect(store.transaction('*', 'readwrite', async (t) => {
      await t.put('projects', { project_id: 'P1', revision: 2 });
      await t.put('registry', { project_id: 'P1', object_id: 'X-1', version: 1, entry: {} });
      throw new Error('boom');
    })).rejects.toThrow('boom');
    const after = await store.transaction('*', 'readonly', async (t) => ({ p: await t.get('projects', 'P1'), r: await t.byProject('registry', 'P1') }));
    expect(after.p.revision).toBe(1);
    expect(after.r).toEqual([]);
  });
});

describe('five-stage pilot end to end (simulator)', () => {
  test('IDEA → DPL approval → fan-out → decisions + owner → PCON → independent review', async () => {
    const { engine, sim } = await newEngine();
    const projectId = await engine.createProject({ ideaText: IDEA, models: ['Claude', 'GPT', 'Gemini'], primaryModel: 'GPT' });

    await engine.run(projectId);
    let state = await engine.getState(projectId);
    expect(state.project.workflow_state).toBe('WAITING_FOR_SELECTION');
    expect(state.project.wait.resume_stage).toBe(2);
    const dpl = state.latest.find((entry) => entry.code === 'DPL');
    expect(dpl).toMatchObject({ object_id: 'DPL-0001', status: 'DRAFT', created_stage: 1 });
    const approval = state.latest.find((entry) => entry.code === 'QST');
    expect(approval.payload.session_id).toBe('DPL_APPROVAL');

    await answerFirstOptions(engine, projectId);
    state = await engine.getState(projectId);
    expect(state.latest.find((entry) => entry.object_id === 'DPL-0001')).toMatchObject({ status: 'ACTIVE', version: 2 });
    expect(state.latest.find((entry) => entry.code === 'AEV').payload.action).toBe('AUTHORIZE_POLICY');

    await engine.run(projectId);
    state = await engine.getState(projectId);
    expect(state.project.workflow_state).toBe('WAITING_FOR_SELECTION');
    expect(state.project.wait.resume_stage).toBe(4);
    const prps = state.latest.filter((entry) => entry.code === 'PRP');
    expect(new Set(prps.map((entry) => entry.payload.source_model))).toEqual(new Set(['Claude', 'GPT', 'Gemini']));
    expect(prps.every((entry) => entry.status !== 'PROPOSED')).toBe(true);
    const qst = state.latest.find((entry) => entry.code === 'QST' && entry.status === 'READY');
    const targets = qst.payload.options.flatMap((option) => option.effects.map((effect) => effect.target));
    expect(targets.every((target) => /^PD-\d{4}$/.test(target))).toBe(true);
    expect(qst.payload.decision_ref).toMatchObject({ code: 'PD', version: 1 });

    const stage2Prompts = sim.sent.filter((item) => /of stage 2 "/.test(item.prompt));
    expect(stage2Prompts).toHaveLength(3);
    expect(stage2Prompts.every((item) => item.freshConversation)).toBe(true);
    const hashes = stage2Prompts.map((item) => /"input_snapshot_hash":"([a-f0-9]{64})"/.exec(item.prompt)[1]);
    expect(new Set(hashes).size).toBe(1);
    expect(stage2Prompts.some((item) => item.prompt.includes('PRP-'))).toBe(false);

    await answerFirstOptions(engine, projectId);
    state = await engine.getState(projectId);
    const closed = state.latest.find((entry) => entry.object_id === qst.payload.decision_ref.object_id);
    expect(closed).toMatchObject({ status: 'CLOSED' });
    expect(closed.payload).toMatchObject({ decided_by: 'OWNER_SELECTION', authorization_ref: { code: 'AEV' } });

    await engine.run(projectId);
    state = await engine.getState(projectId);
    expect(state.project.workflow_state).toBe('PILOT_COMPLETE');
    const pcon = state.latest.find((entry) => entry.code === 'PCON');
    expect(pcon.status).toBe('ACTIVE');
    const findings = state.latest.filter((entry) => entry.code === 'FND');
    expect(findings).toHaveLength(6);
    expect(findings.every((entry) => entry.payload.target.object_id === pcon.object_id)).toBe(true);

    state.records.forEach((record) => expect(Schema.validate(spec.files.registryEntry, record.entry)).toEqual([]));
    state.events.forEach((event) => expect(Schema.validate(spec.files.eventSchema, event)).toEqual([]));
    const revisions = state.events.map((event) => event.project_revision);
    expect(revisions).toEqual([...revisions].sort((a, b) => a - b));
    expect(state.execs.filter((exec) => exec.status === 'COMMITTED').map((exec) => exec.stage)).toEqual([1, 2, 3, 4, 5]);
  });

  test('regenerating the DPL supersedes everything stage 1 produced and reruns it', async () => {
    const { engine } = await newEngine();
    const projectId = await engine.createProject({ ideaText: IDEA, models: ['Claude', 'GPT'] });
    await engine.run(projectId);
    await answerFirstOptions(engine, projectId, 1);
    let state = await engine.getState(projectId);
    expect(state.project).toMatchObject({ workflow_state: 'READY', next_stage: 1 });
    expect(state.latest.filter((entry) => entry.created_stage === 1 && ['DPL', 'UNK', 'ASM'].includes(entry.code)).every((entry) => entry.status === 'SUPERSEDED')).toBe(true);
    await engine.run(projectId);
    state = await engine.getState(projectId);
    expect(state.latest.find((entry) => entry.object_id === 'DPL-0002')).toMatchObject({ status: 'DRAFT' });
  });

  test('rendered code blocks from a provider are accepted as SINGLE_BALANCED_JSON', async () => {
    const { engine } = await newEngine({ styles: { GPT: 'rendered-code-block' } });
    const projectId = await engine.createProject({ ideaText: IDEA, models: ['GPT', 'Claude'] });
    const state = await runToCompletion(engine, projectId);
    expect(state.project.workflow_state).toBe('PILOT_COMPLETE');
    const modes = state.calls.filter((call) => call.model === 'GPT').map((call) => call.accepted.extraction_mode);
    expect(new Set(modes)).toEqual(new Set(['SINGLE_BALANCED_JSON']));
  });
});

describe('repair, fresh attempts, failover and independence', () => {
  test('representation errors are repaired once in the same conversation', async () => {
    const { engine, sim } = await newEngine({ faults: [{ model: 'GPT', stage: 1, kind: 'bad_json' }, { model: 'GPT', stage: 4, kind: 'wrong_hash' }] });
    const projectId = await engine.createProject({ ideaText: IDEA, models: ['GPT', 'Claude'] });
    const state = await runToCompletion(engine, projectId);
    expect(state.project.workflow_state).toBe('PILOT_COMPLETE');
    const stage1 = state.calls.find((call) => call.stage === 1);
    expect(stage1.attempts.map((a) => [a.kind, a.outcome])).toEqual([['initial', 'REPAIRABLE'], ['repair', 'ACCEPTED']]);
    const stage4 = state.calls.find((call) => call.stage === 4);
    expect(stage4.attempts[0].errors.map((e) => e.code)).toContain('SNAPSHOT_HASH_MISMATCH');
    const repairs = sim.sent.filter((item) => /was rejected by the validator/.test(item.prompt));
    expect(repairs.every((item) => item.freshConversation === false)).toBe(true);
  });

  test('semantic errors and timeouts start a fresh conversation attempt', async () => {
    const { engine, sim } = await newEngine({ faults: [{ model: 'GPT', stage: 1, kind: 'semantic' }, { model: 'GPT', stage: 4, kind: 'timeout' }] });
    const projectId = await engine.createProject({ ideaText: IDEA, models: ['GPT', 'Claude'] });
    const state = await runToCompletion(engine, projectId);
    expect(state.project.workflow_state).toBe('PILOT_COMPLETE');
    expect(state.calls.find((call) => call.stage === 1).attempts.map((a) => [a.kind, a.outcome])).toEqual([['initial', 'REJECTED'], ['fresh', 'ACCEPTED']]);
    expect(state.calls.find((call) => call.stage === 4).attempts.map((a) => a.outcome)).toEqual(['TRANSPORT_FAILED', 'ACCEPTED']);
    expect(sim.sent.filter((item) => /of stage 1 "/.test(item.prompt)).every((item) => item.freshConversation)).toBe(true);
  });

  test('a single-model stage fails over to the next selected model', async () => {
    const { engine } = await newEngine({ faults: [{ model: 'GPT', stage: 1, kind: 'timeout', times: 99 }] });
    const projectId = await engine.createProject({ ideaText: IDEA, models: ['GPT', 'Claude'], primaryModel: 'GPT' });
    await engine.run(projectId);
    const state = await engine.getState(projectId);
    expect(state.project.workflow_state).toBe('WAITING_FOR_SELECTION');
    const calls = state.calls.filter((call) => call.stage === 1);
    expect(calls.map((call) => [call.model, call.status])).toEqual([['GPT', 'FAILED'], ['Claude', 'COMMITTED']]);
    expect(calls[0].attempts).toHaveLength(3);
  });

  test('fan-out tolerates one failed model when min_distinct_models still holds', async () => {
    const { engine } = await newEngine({ faults: [{ model: 'Gemini', stage: 2, kind: 'timeout', times: 99 }] });
    const projectId = await engine.createProject({ ideaText: IDEA, models: ['Claude', 'GPT', 'Gemini'] });
    const state = await runToCompletion(engine, projectId);
    expect(state.project.workflow_state).toBe('PILOT_COMPLETE');
    expect(new Set(state.latest.filter((e) => e.code === 'PRP').map((e) => e.payload.source_model))).toEqual(new Set(['Claude', 'GPT']));
  });

  test('fan-out below min_distinct_models fails closed with zero stage mutations', async () => {
    const { engine } = await newEngine({ faults: [{ model: 'GPT', stage: 2, kind: 'timeout', times: 99 }] });
    const projectId = await engine.createProject({ ideaText: IDEA, models: ['Claude', 'GPT'] });
    await engine.run(projectId);
    await answerFirstOptions(engine, projectId);
    const before = (await engine.getState(projectId)).records.length;
    await engine.run(projectId);
    const state = await engine.getState(projectId);
    expect(state.project.workflow_state).toBe('STAGE_FAILED');
    expect(state.project.last_error).toMatchObject({ stage: 2, code: 'STAGE_ATTEMPTS_EXHAUSTED' });
    expect(state.records.length).toBe(before);
    expect(state.calls.find((call) => call.stage === 2 && call.model === 'Claude').status).toBe('ACCEPTED');
  });

  test('fan-out needs at least two selected models before any dispatch', async () => {
    const { engine, sim } = await newEngine();
    const projectId = await engine.createProject({ ideaText: IDEA, models: ['Claude'] });
    await engine.run(projectId);
    await answerFirstOptions(engine, projectId);
    const sentBefore = sim.sent.length;
    await engine.run(projectId);
    const state = await engine.getState(projectId);
    expect(state.project.last_error.code).toBe('INDEPENDENCE_UNSATISFIED');
    expect(sim.sent.length).toBe(sentBefore);
  });

  test('a duplicated assistant message is never accepted twice', async () => {
    const { engine } = await newEngine({ faults: [{ model: 'GPT', stage: 2, kind: 'duplicate' }] });
    const projectId = await engine.createProject({ ideaText: IDEA, models: ['Claude', 'GPT'] });
    const state = await runToCompletion(engine, projectId);
    const gpt = state.calls.find((call) => call.stage === 2 && call.model === 'GPT');
    expect(gpt.attempts[0].errors.map((e) => e.code)).toEqual(expect.arrayContaining([expect.stringMatching(/DUPLICATE_SOURCE_MESSAGE|FRAME_TOKEN_MISMATCH/)]));
    const ids = state.calls.filter((call) => call.accepted).map((call) => call.accepted.source_message_id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('crash recovery', () => {
  test('a restarted controller keeps accepted calls and never re-calls them', async () => {
    const store = Store.createMemoryStore();
    const sim = Sim.createSimulatorTransport({ latencyMs: 0 });
    // Transport that answers Claude/GPT but hangs forever on Gemini (page "crashes" mid-stage).
    const hanging = {
      dispatch: async (args) => {
        const live = args.calls.filter((call) => call.model !== 'Gemini');
        const result = live.length ? await sim.dispatch({ ...args, calls: live }) : {};
        if (args.calls.some((call) => call.model === 'Gemini')) await new Promise(() => {});
        return result;
      },
      cancel: async () => {}
    };
    const first = createEngine({ spec, store, transport: hanging });
    const projectId = await first.createProject({ ideaText: IDEA, models: ['Claude', 'GPT', 'Gemini'] });
    await first.run(projectId);
    await answerFirstOptions(first, projectId);
    void first.run(projectId);
    await new Promise((resolve) => setTimeout(resolve, 50));

    const counting = Sim.createSimulatorTransport({ latencyMs: 0 });
    const second = createEngine({ spec, store, transport: counting });
    await second.recover();
    let state = await second.getState(projectId);
    expect(state.project.workflow_state).toBe('PAUSED');
    const gemini = state.calls.find((call) => call.stage === 2 && call.model === 'Gemini');
    expect(gemini.attempts[gemini.attempts.length - 1].outcome).toBe('INTERRUPTED');

    await second.run(projectId);
    state = await second.getState(projectId);
    const stage2Sent = counting.sent.filter((item) => /of stage 2 "/.test(item.prompt)).map((item) => item.model);
    expect(stage2Sent).toEqual(['Gemini']);
    expect(state.execs.filter((exec) => exec.stage === 2 && exec.status === 'COMMITTED')).toHaveLength(1);
  });

  test('commit is idempotent per stage execution', async () => {
    const { engine, store } = await newEngine();
    const projectId = await engine.createProject({ ideaText: IDEA, models: ['Claude', 'GPT'] });
    await engine.run(projectId);
    const state = await engine.getState(projectId);
    const execId = state.execs[0].exec_id;
    const again = await store.transaction('*', 'readwrite', (t) => Committer.commitStageExec(t, { spec, projectId, execId, now: new Date().toISOString() }));
    expect(again.alreadyCommitted).toBe(true);
    expect((await engine.getState(projectId)).records.length).toBe(state.records.length);
  });

  test('a snapshot that changed before commit raises VERSION_CONFLICT and aborts', async () => {
    const { engine, store } = await newEngine();
    const projectId = await engine.createProject({ ideaText: IDEA, models: ['Claude', 'GPT'] });
    await engine.run(projectId);
    const state = await engine.getState(projectId);
    const exec = state.execs[0];
    await store.transaction('*', 'readwrite', async (t) => {
      const e = await t.get('execs', exec.exec_id); e.status = 'RUNNING'; await t.put('execs', e);
      for (const id of e.call_ids) { const c = await t.get('calls', id); c.status = 'ACCEPTED'; await t.put('calls', c); }
      const idea = state.records.find((r) => r.object_id === 'IDEA-0001');
      await t.put('registry', { ...idea, version: 2, entry: { ...idea.entry, version: 2 } });
    });
    await expect(store.transaction('*', 'readwrite', (t) => Committer.commitStageExec(t, { spec, projectId, execId: exec.exec_id, now: 'x' })))
      .rejects.toMatchObject({ code: 'VERSION_CONFLICT' });
  });
});

describe('owner answer compiler', () => {
  test('rejects unknown options and multi-selection on SINGLE questions', async () => {
    const { engine } = await newEngine();
    const projectId = await engine.createProject({ ideaText: IDEA, models: ['Claude', 'GPT'] });
    await engine.run(projectId);
    const state = await engine.getState(projectId);
    const [qstId] = state.project.wait.qst_ids;
    await expect(engine.answer(projectId, { [qstId]: ['NOPE'] })).rejects.toMatchObject({ code: 'UNKNOWN_OPTION' });
    await expect(engine.answer(projectId, { [qstId]: ['APPROVE', 'REGENERATE'] })).rejects.toMatchObject({ code: 'SINGLE_SELECTION' });
    await expect(engine.answer(projectId, {})).rejects.toMatchObject({ code: 'ANSWER_REQUIRED' });
    expect((await engine.getState(projectId)).records.length).toBe(state.records.length);
  });
});

describe('live chrome transport bridge', () => {
  function fakeRuntime({ busyOnce = false } = {}) {
    const listeners = [];
    const sent = [];
    let busy = busyOnce;
    return {
      sent,
      emit: (message) => listeners.forEach((listener) => listener(message)),
      onMessage: { addListener: (fn) => listeners.push(fn), removeListener: () => {} },
      sendMessage: (payload, callback) => {
        sent.push(payload);
        if (payload.type === 'GET_ACTIVE_RUN_STATE') return callback({ roundsInProgress: false });
        if (payload.type === 'START_FULLPAGE_PROCESS') {
          if (busy) { busy = false; return callback({ success: false, errorCode: 'RUN_ALREADY_ACTIVE' }); }
          return callback({ status: 'process_started' });
        }
        return callback({ success: true });
      }
    };
  }
  const tokens = { callToken: 'Cabc', attemptToken: 'Adef' };
  const answer = `PAF_RESPONSE_BEGIN Cabc Adef\n{"a":1}\nPAF_RESPONSE_END Cabc Adef`;

  test('dispatches without API fallback and settles on the final message', async () => {
    const runtime = fakeRuntime({ busyOnce: true });
    const transport = Transport.createChromeTransport({ runtime, guardPollMs: 1 });
    const pending = transport.dispatch({ calls: [{ model: 'GPT', prompt: 'P', tokens }], freshConversation: true, timeoutMs: 5000, context: { pipelineRunId: 'EXEC-1' } });
    await new Promise((resolve) => setTimeout(resolve, 1700));
    runtime.emit({ type: 'LLM_PARTIAL_RESPONSE', llmName: 'GPT', answer: 'PAF_RESPONSE_BEGIN Cold Aold\n{}\nPAF_RESPONSE_END Cold Aold', metadata: { status: 'SUCCESS' } });
    runtime.emit({ type: 'LLM_PARTIAL_RESPONSE', llmName: 'GPT', answer, requestId: 'r1', metadata: { status: 'SUCCESS' } });
    const result = await pending;
    expect(result.GPT).toMatchObject({ ok: true, text: answer });
    expect(result.GPT.sourceMessageId).toMatch(/^GPT:r1:/);
    const start = runtime.sent.filter((payload) => payload.type === 'START_FULLPAGE_PROCESS');
    expect(start).toHaveLength(2);
    expect(start[1]).toMatchObject({ useApiFallback: false, forceNewTabs: true, sourceView: 'automation', selectedLLMs: ['GPT'], promptsByModel: { GPT: 'P' } });
  });

  test('timeout accepts a streamed text only when the frame is complete', async () => {
    const runtime = fakeRuntime();
    const transport = Transport.createChromeTransport({ runtime, guardPollMs: 1 });
    const pending = transport.dispatch({ calls: [{ model: 'GPT', prompt: 'P', tokens }, { model: 'Claude', prompt: 'Q', tokens: { callToken: 'Cx', attemptToken: 'Ay' } }], freshConversation: false, timeoutMs: 80 });
    await new Promise((resolve) => setTimeout(resolve, 10));
    runtime.emit({ type: 'LLM_PARTIAL_RESPONSE', llmName: 'GPT', answer, metadata: { status: 'GENERATING' } });
    runtime.emit({ type: 'LLM_PARTIAL_RESPONSE', llmName: 'Claude', answer: 'PAF_RESPONSE_BEGIN Cx Ay\n{"a":', metadata: { status: 'GENERATING' } });
    const result = await pending;
    expect(result.GPT).toMatchObject({ ok: true, status: 'TIMEOUT_FRAME_COMPLETE' });
    expect(result.Claude).toMatchObject({ ok: false, status: 'TIMEOUT' });
  });
});

describe('diagnostics journal and diagnosis', () => {
  const Diagnostics = require('../automation/al-diagnostics.js');

  test('a simulator run writes a complete journal and explains stage expectations', async () => {
    const { engine } = await newEngine();
    const projectId = await engine.createProject({ ideaText: IDEA, models: ['Claude', 'GPT', 'Gemini'] });
    const state = await runToCompletion(engine, projectId);
    const kinds = new Set(state.diag.map((event) => event.kind));
    ['STAGE_STARTED', 'DISPATCH_SENT', 'DISPATCH_STARTED', 'MODEL_FIRST_TEXT', 'MODEL_TERMINAL', 'ATTEMPT_RESULT', 'STAGE_COMMITTED', 'OWNER_ANSWERED'].forEach((kind) => expect(kinds.has(kind)).toBe(true));
    const diagnosis = Diagnostics.diagnose(state, { spec });
    expect(diagnosis.stages[0].expectation).toBe('1 вкладка — основная модель Claude');
    expect(diagnosis.stages[1].expectation).toMatch(/^3 вкладки параллельно \(Claude, GPT, Gemini\)/);
    expect(diagnosis.problems.filter((problem) => problem.severity === 'critical')).toEqual([]);
    const report = Diagnostics.buildReport(state, { spec, extensionVersion: 'test' });
    expect(report.journal.length).toBe(state.diag.length);
    expect(report.calls.find((call) => call.stage === 1).attempts[0].prompt_text).toContain('## ACTIVE');
    expect(JSON.parse(JSON.stringify(report)).diagnosis.stages).toHaveLength(5);
  });

  const baseState = (diag, calls = []) => ({
    project: { project_id: 'P', workflow_state: 'STAGE_FAILED', config: { models: ['Claude', 'GPT'], primary: 'Claude' } },
    execs: [], calls, latest: [], events: [], diag
  });
  const sent = { source: 'transport', kind: 'DISPATCH_SENT', exec_id: 'E1', stage: 2, models: ['Claude', 'GPT'], at: '2026-09-30T10:00:00.000Z' };

  test('a model that never got a tab is diagnosed as NO_TAB, a silent tab as NO_ANSWER', () => {
    const diag = [
      sent,
      { source: 'transport', kind: 'TABS', exec_id: 'E1', models: { Claude: { tab: 7, status: 'GENERATING' }, GPT: { tab: null, status: null } } },
      { source: 'transport', kind: 'MODEL_TIMEOUT', exec_id: 'E1', model: 'Claude', chars: 0, timeoutMs: 600000 },
      { source: 'transport', kind: 'MODEL_TIMEOUT', exec_id: 'E1', model: 'GPT', chars: 0, timeoutMs: 600000 }
    ];
    const problems = Diagnostics.diagnose(baseState(diag), { spec }).problems;
    expect(problems.find((p) => p.code === 'NO_TAB')).toMatchObject({ model: 'GPT', severity: 'critical' });
    expect(problems.find((p) => p.code === 'NO_ANSWER')).toMatchObject({ model: 'Claude', severity: 'critical' });
  });

  test('a rejected dispatch explains the busy background', () => {
    const diag = [sent, { source: 'transport', kind: 'DISPATCH_REJECTED', exec_id: 'E1', code: 'RUN_ALREADY_ACTIVE' }];
    const problem = Diagnostics.diagnose(baseState(diag), { spec }).problems[0];
    expect(problem).toMatchObject({ code: 'RUN_ALREADY_ACTIVE', severity: 'critical' });
    expect(problem.hint).toMatch(/Дождитесь окончания/);
  });

  test('validation failures are explained in plain language with the next step', () => {
    const calls = [{ call_id: 'C', stage: 1, model: 'GPT', status: 'PENDING', attempts: [{ outcome: 'REPAIRABLE', kind: 'initial', errors: [{ class: 'REPRESENTATION', code: 'FRAME_MISSING', message: 'x' }], finished_at: 'now' }] }];
    const problem = Diagnostics.diagnose(baseState([], calls), { spec }).problems.find((p) => p.code === 'FRAME_MISSING');
    expect(problem.title).toBe('GPT: Ответ без служебных маркеров');
    expect(problem.hint).toMatch(/Сырой ответ/);
  });
});

describe('transport event reporting', () => {
  test('ignores other runs, reports tabs, statuses and first text', async () => {
    const listeners = [];
    const runtime = {
      onMessage: { addListener: (fn) => listeners.push(fn), removeListener: () => {} },
      sendMessage: (payload, cb) => {
        if (payload.type === 'GET_ACTIVE_RUN_STATE') return cb({ roundsInProgress: false });
        if (payload.type === 'START_FULLPAGE_PROCESS') return cb({ status: 'process_started' });
        return cb({});
      }
    };
    const emit = (message) => listeners.forEach((listener) => listener(message));
    const events = [];
    const transport = Transport.createChromeTransport({ runtime, guardPollMs: 1 });
    const tokens = { callToken: 'Cq', attemptToken: 'Aq' };
    const pending = transport.dispatch({ calls: [{ model: 'GPT', prompt: 'P', tokens }], freshConversation: true, timeoutMs: 5000, onEvent: (event) => events.push(event) });
    await new Promise((resolve) => setTimeout(resolve, 5));
    emit({ type: 'LLM_PARTIAL_RESPONSE', llmName: 'GPT', answer: 'from debate', sourceView: 'pipeline', metadata: { status: 'SUCCESS' } });
    emit({ type: 'GLOBAL_STATE_BROADCAST', sourceView: 'automation', state: { tabs: { map: { GPT: 91 } }, llms: { GPT: { status: 'GENERATING' } } } });
    emit({ type: 'STATUS_UPDATE', llmName: 'GPT', status: 'GENERATING', sourceView: 'automation' });
    emit({ type: 'LLM_PARTIAL_RESPONSE', llmName: 'GPT', answer: 'PAF_RESPONSE_BEGIN Cq Aq\n{"a":1}\nPAF_RESPONSE_END Cq Aq', sourceView: 'automation', metadata: { status: 'SUCCESS' } });
    const result = await pending;
    expect(result.GPT.ok).toBe(true);
    expect(result.GPT.text).toContain('PAF_RESPONSE_BEGIN Cq Aq');
    const kinds = events.map((event) => event.kind);
    expect(kinds).toEqual(expect.arrayContaining(['DISPATCH_SENT', 'DISPATCH_STARTED', 'TABS', 'MODEL_STATUS', 'MODEL_FIRST_TEXT', 'MODEL_TERMINAL']));
    expect(events.find((event) => event.kind === 'TABS').models.GPT.tab).toBe(91);
  });
});
