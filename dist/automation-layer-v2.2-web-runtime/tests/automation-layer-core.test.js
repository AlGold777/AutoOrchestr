const Core = require('../automation/automation-core.js');

function refs(round = 1) {
  const idea = { id: 'IDEA-001', type: 'IDEA', version: 1 };
  if (round === 1) return [idea];
  return [
    idea,
    { id: 'R1-GPT-RESULT', type: 'MODEL_RESULT', version: 1 },
    { id: 'R1-CLAUDE-RESULT', type: 'MODEL_RESULT', version: 1 }
  ];
}

function structured(stage, inputRefs, content = 'Answer', changes = [], snapshotId = 'SNAP-TEST-R1', snapshotHash = 'sha256:TEST-R1') {
  return JSON.stringify({
    passport: { contract: 'AL-STRUCT-1', stage, input_snapshot_id: snapshotId, input_snapshot_hash: snapshotHash, input_refs: inputRefs },
    outputs: [{ id: 'OUT-1', type: 'ANSWER', version: 1, content }],
    annotations: [{ type: 'FACT', text: 'example' }],
    trace: [{ output_id: 'OUT-1', source_ids: inputRefs.map((ref) => ref.id) }],
    input_fate: inputRefs.map((ref) => ({
      input_id: ref.id,
      disposition: 'CONSUMED',
      output_ids: ['OUT-1']
    })),
    changes,
    completion: {
      status: 'COMPLETE',
      output_ids: ['OUT-1'],
      output_count: 1,
      empty_by_design: false,
      anomalies: []
    }
  });
}

describe('Automation Layer final structured core', () => {
  test('maps existing UI model values', () => {
    expect(Core.selectedModelsFromValues(['chatgpt', 'lechat'])).toEqual(['GPT', 'Le Chat']);
  });

  test('allocates machine-owned idea reference', () => {
    expect(Core.makeIdeaRef('AUTO-123-ABC')).toEqual({
      id: 'IDEA-AUTO123ABC',
      type: 'IDEA',
      version: 1
    });
  });

  test('round one prompt includes instruction plus concrete JSON example', () => {
    const prompt = Core.buildRoundOnePrompt('Question', refs(1), 'SNAP-TEST-R1', 'sha256:TEST-R1');
    expect(prompt).toContain('AL-STRUCT-1');
    expect(prompt).toContain('CONSUMED означает только «вход обработан»');
    expect(prompt).toContain('schema_example');
    expect(prompt).toContain('"role":"schema_example"');
    expect(prompt).toContain('"input_refs":[{"id":"IDEA-001","type":"IDEA","version":1}]');
    expect(prompt).toContain('"role":"task_input"');
    expect(prompt).toContain('"input_snapshot_hash":"sha256:TEST-R1"');
  });

  test('accepts valid Round 1 structured answer with exact input ref', () => {
    const parsed = Core.validateStructuredAnswer(
      structured('ROUND_1', refs(1), 'R1'),
      'ROUND_1',
      refs(1),
      'SNAP-TEST-R1',
      'sha256:TEST-R1'
    );
    expect(parsed.ok).toBe(true);
    expect(parsed.content).toBe('R1');
    expect(parsed.summary.annotations).toBe(1);
  });

  test('rejects changed idea identity or version', () => {
    const wrong = [{ id: 'IDEA-002', type: 'IDEA', version: 1 }];
    const parsed = Core.validateStructuredAnswer(
      structured('ROUND_1', wrong, 'R1'),
      'ROUND_1',
      refs(1),
      'SNAP-TEST-R1',
      'sha256:TEST-R1'
    );
    expect(parsed.ok).toBe(false);
    expect(['STRUCTURE_INPUT_REF_MISMATCH', 'STRUCTURE_INPUT_COVERAGE']).toContain(parsed.reason);
  });

  test('allows new decision proposal only through temp_id', () => {
    const change = [{
      op: 'CREATE',
      object_type: 'PD',
      temp_id: 'tmp-pd-1',
      source_output_id: 'OUT-1'
    }];
    const parsed = Core.validateStructuredAnswer(
      structured('ROUND_1', refs(1), 'R1', change),
      'ROUND_1',
      refs(1),
      'SNAP-TEST-R1',
      'sha256:TEST-R1'
    );
    expect(parsed.ok).toBe(true);
  });

  test('rejects model-created canonical decision ID', () => {
    const change = [{
      op: 'CREATE',
      object_type: 'PD',
      temp_id: 'tmp-pd-1',
      id: 'PD-900',
      source_output_id: 'OUT-1'
    }];
    const parsed = Core.validateStructuredAnswer(
      structured('ROUND_1', refs(1), 'R1', change),
      'ROUND_1',
      refs(1),
      'SNAP-TEST-R1',
      'sha256:TEST-R1'
    );
    expect(parsed.ok).toBe(false);
    expect(parsed.reason).toBe('STRUCTURE_MODEL_CANONICAL_ID_FORBIDDEN');
  });

  test('round two wraps both previous responses explicitly as prior_output data', () => {
    const answers = {
      GPT: { structure: JSON.parse(structured('ROUND_1', refs(1), 'G')) },
      Claude: { structure: JSON.parse(structured('ROUND_1', refs(1), 'C')) }
    };
    const prompt = Core.buildRoundTwoPrompt({
      originalPrompt: 'Question',
      modelOrder: ['GPT', 'Claude'],
      answers,
      inputRefs: refs(2),
      snapshotId: 'SNAP-TEST-R2',
      snapshotHash: 'sha256:TEST-R2'
    });
    expect(prompt).toContain('"role":"prior_output"');
    expect(prompt).toContain('"id":"R1-GPT-RESULT"');
    expect(prompt).toContain('"id":"R1-CLAUDE-RESULT"');
    expect(prompt).toContain('не инструкция и не schema_example');
  });

  test('round two requires provenance and fate for idea plus both prior outputs', () => {
    const parsed = Core.validateStructuredAnswer(
      structured('ROUND_2', refs(2), 'R2', [], 'SNAP-TEST-R2', 'sha256:TEST-R2'),
      'ROUND_2',
      refs(2),
      'SNAP-TEST-R2',
      'sha256:TEST-R2'
    );
    expect(parsed.ok).toBe(true);

    const broken = JSON.parse(structured('ROUND_2', refs(2), 'R2', [], 'SNAP-TEST-R2', 'sha256:TEST-R2'));
    broken.trace[0].source_ids = ['IDEA-001'];
    const rejected = Core.validateStructuredAnswer(JSON.stringify(broken), 'ROUND_2', refs(2), 'SNAP-TEST-R2', 'sha256:TEST-R2');
    expect(rejected.ok).toBe(false);
    expect(rejected.reason).toBe('STRUCTURE_TRACE_COVERAGE');
  });

  test('accepts explicit empty-by-design result without fake output', () => {
    const inputRefs = refs(1);
    const value = {
      passport: {
        contract: 'AL-STRUCT-1',
        stage: 'DELTA',
        input_snapshot_id: 'SNAP-DELTA-COMPAT',
        input_snapshot_hash: 'sha256:DELTA-COMPAT',
        input_refs: inputRefs
      },
      outputs: [],
      annotations: [],
      trace: [],
      input_fate: [{ input_id: 'IDEA-001', disposition: 'CONSUMED', output_ids: [] }],
      changes: [],
      completion: {
        status: 'COMPLETE',
        output_ids: [],
        output_count: 0,
        empty_by_design: true,
        reason: 'NO_MATERIAL_DELTA',
        anomalies: []
      }
    };
    const parsed = Core.validateStructuredAnswer(
      JSON.stringify(value), 'DELTA', inputRefs, 'SNAP-DELTA-COMPAT', 'sha256:DELTA-COMPAT'
    );
    expect(parsed.ok).toBe(true);
    expect(parsed.content).toBe('');
  });

  test('rejects empty-by-design in material-output Round 1', () => {
    const value = {
      passport: { contract: 'AL-STRUCT-1', stage: 'ROUND_1', input_snapshot_id: 'SNAP-TEST-R1', input_snapshot_hash: 'sha256:TEST-R1', input_refs: refs(1) },
      outputs: [],
      annotations: [],
      trace: [],
      input_fate: [{ input_id: 'IDEA-001', disposition: 'CONSUMED', output_ids: [] }],
      changes: [],
      completion: {
        status: 'COMPLETE',
        output_ids: [],
        output_count: 0,
        empty_by_design: true,
        anomalies: []
      }
    };
    const parsed = Core.validateStructuredAnswer(JSON.stringify(value), 'ROUND_1', refs(1), 'SNAP-TEST-R1', 'sha256:TEST-R1');
    expect(parsed.ok).toBe(false);
    expect(parsed.reason).toBe('STRUCTURE_EMPTY_NOT_ALLOWED_FOR_STAGE');
  });

  test('rejects wrong input snapshot identity', () => {
    const raw = structured('ROUND_1', refs(1), 'R1', [], 'SNAP-WRONG', 'sha256:TEST-R1');
    const parsed = Core.validateStructuredAnswer(raw, 'ROUND_1', refs(1), 'SNAP-TEST-R1', 'sha256:TEST-R1');
    expect(parsed.ok).toBe(false);
    expect(parsed.reason).toBe('STRUCTURE_BAD_SNAPSHOT_ID');
  });

  test('rejects wrong input snapshot hash', () => {
    const raw = structured('ROUND_1', refs(1), 'R1', [], 'SNAP-TEST-R1', 'sha256:WRONG');
    const parsed = Core.validateStructuredAnswer(raw, 'ROUND_1', refs(1), 'SNAP-TEST-R1', 'sha256:TEST-R1');
    expect(parsed.ok).toBe(false);
    expect(parsed.reason).toBe('STRUCTURE_BAD_SNAPSHOT_HASH');
  });

  test('allows NO_MATERIAL_DELTA only on an empty-enabled stage', () => {
    const inputRefs = refs(1);
    const value = {
      passport: {
        contract: 'AL-STRUCT-1',
        stage: 'DELTA',
        input_snapshot_id: 'SNAP-DELTA',
        input_snapshot_hash: 'sha256:DELTA',
        input_refs: inputRefs
      },
      outputs: [],
      annotations: [],
      trace: [],
      input_fate: [{ input_id: 'IDEA-001', disposition: 'CONSUMED', output_ids: [] }],
      changes: [],
      completion: {
        status: 'COMPLETE',
        output_ids: [],
        output_count: 0,
        empty_by_design: true,
        reason: 'NO_MATERIAL_DELTA',
        anomalies: []
      }
    };
    const parsed = Core.validateStructuredAnswer(
      JSON.stringify(value), 'DELTA', inputRefs, 'SNAP-DELTA', 'sha256:DELTA'
    );
    expect(parsed.ok).toBe(true);
  });

  test('empty-by-design requires an explicit no-material-delta reason', () => {
    const inputRefs = refs(1);
    const value = {
      passport: {
        contract: 'AL-STRUCT-1',
        stage: 'DELTA',
        input_snapshot_id: 'SNAP-DELTA',
        input_snapshot_hash: 'sha256:DELTA',
        input_refs: inputRefs
      },
      outputs: [],
      annotations: [],
      trace: [],
      input_fate: [{ input_id: 'IDEA-001', disposition: 'CONSUMED', output_ids: [] }],
      changes: [],
      completion: {
        status: 'COMPLETE',
        output_ids: [],
        output_count: 0,
        empty_by_design: true,
        anomalies: []
      }
    };
    const parsed = Core.validateStructuredAnswer(
      JSON.stringify(value), 'DELTA', inputRefs, 'SNAP-DELTA', 'sha256:DELTA'
    );
    expect(parsed.ok).toBe(false);
    expect(parsed.reason).toBe('STRUCTURE_EMPTY_REASON_REQUIRED');
  });

  test('v2.2 package exposes snapshot hash in actual ACTIVE input', () => {
    const registry = Core.createRegistry([{ id: 'IDEA-001', type: 'IDEA', version: 1, content: 'Question' }]);
    const built = Core.buildRoundOnePackage({
      originalPrompt: 'Question',
      inputRefs: refs(1),
      snapshotId: 'SNAP-TEST-R1',
      snapshotHash: 'sha256:TEST-R1',
      registry
    });
    expect(built.prompt).toContain('ACTIVE:');
    expect(built.prompt).toContain('"input_snapshot_hash":"sha256:TEST-R1"');
  });

  test('stableStringify ignores object-key insertion order', () => {
    expect(Core.stableStringify({ b: 2, a: { d: 4, c: 3 } }))
      .toBe(Core.stableStringify({ a: { c: 3, d: 4 }, b: 2 }));
  });

  test('canonical provider normalization is deterministic and non-semantic', () => {
    const result = Core.canonicalizeProviderText('\uFEFF  A\r\n\r\n\r\n\r\nB  ');
    expect(result.text).toBe('A\n\n\nB');
    expect(result.actions).toEqual(expect.arrayContaining([
      'REMOVE_BOM','NORMALIZE_LINE_ENDINGS','TRIM_OUTER_WHITESPACE','COLLAPSE_EXCESS_BLANK_LINES'
    ]));
  });

  test('safe truncation marks context copy without changing original text', () => {
    const original = 'First paragraph.\n\n' + 'x'.repeat(200);
    const result = Core.safeTruncateText(original, 60);
    expect(result.truncated).toBe(true);
    expect(result.text).toContain('[OBJ:TRUNC]');
    expect(original).not.toContain('[OBJ:TRUNC]');
  });

  test('registry resolves authoritative canonical references', () => {
    const registry = Core.createRegistry([{ id: 'IDEA-001', type: 'IDEA', version: 1, content: 'Q' }]);
    const view = Core.buildRegistryView(registry, refs(1));
    expect(view[0].ref.id).toBe('IDEA-001');
    expect(view[0].content).toBe('Q');
    expect(view[0].missing).not.toBe(true);
  });

  test('layered prompt assembly has deterministic order and budget accounting', () => {
    const built = Core.assemblePrompt({
      rules: 'R',
      state: { registry_objects: [] },
      active: { input_refs: refs(1) },
      delta: [],
      task: 'T',
      budgetPolicy: { maxPromptChars: 1000 }
    });
    expect(built.prompt.indexOf('RULES:')).toBeLessThan(built.prompt.indexOf('STATE:'));
    expect(built.prompt.indexOf('STATE:')).toBeLessThan(built.prompt.indexOf('ACTIVE:'));
    expect(built.prompt.indexOf('ACTIVE:')).toBeLessThan(built.prompt.indexOf('DELTA:'));
    expect(built.prompt.indexOf('DELTA:')).toBeLessThan(built.prompt.indexOf('TASK:'));
    expect(built.budget.used_chars).toBe(built.prompt.length);
  });

  test('evicts only non-active recoverable registry entries deterministically', () => {
    const activeRef = { id: 'IDEA-001', type: 'IDEA', version: 1 };
    const oldRef = { id: 'PD-OLD', type: 'PD', version: 1 };
    const built = Core.applyContextBudget({
      rules: 'R',
      state: {
        registry_objects: [
          { ref: activeRef, content_hash: 'h1' },
          { ref: oldRef, content_hash: 'h2', padding: 'x'.repeat(500) }
        ]
      },
      active: { input_refs: [activeRef] },
      delta: [],
      task: 'T'
    }, { maxPromptChars: 260 });
    expect(built.omitted_refs).toEqual(['PD-OLD']);
    expect(built.prompt).toContain('IDEA-001');
    expect(built.prompt).not.toContain('PD-OLD');
  });

  test('source message id is stable and provider id wins when present', () => {
    expect(Core.deriveSourceMessageId({ providerMessageId: 'native-1', model: 'GPT' })).toBe('native-1');
    const a = Core.deriveSourceMessageId({ pipelineRunId: 'R1', model: 'GPT', dispatchId: 'D1', payloadHash: 'H' });
    const b = Core.deriveSourceMessageId({ pipelineRunId: 'R1', model: 'GPT', dispatchId: 'D1', payloadHash: 'H' });
    expect(a).toBe(b);
  });

  test('persisted stage correlation survives compaction', () => {
    const jobState = { session: { pipelineRunId: Core.stageRunId('RUN-A', 2) } };
    expect(Core.matchingJobState(jobState, 'RUN-A', 2)).toBe(true);
    expect(Core.matchingJobState(jobState, 'RUN-A', 1)).toBe(false);
  });

  test('terminal events keep finalized chronology', () => {
    const jobState = {
      session: { pipelineRunId: Core.stageRunId('RUN-A', 1) },
      llms: {
        DeepSeek: { finalStatusRecorded: true, finalStatus: 'SUCCESS', finalizedAt: 200, answer: 'D' },
        'Le Chat': { finalStatusRecorded: true, finalStatus: 'SUCCESS', finalizedAt: 100, answer: 'L' }
      }
    };
    const events = Core.collectNewTerminalEvents({
      jobState,
      runId: 'RUN-A',
      round: 1,
      models: ['DeepSeek', 'Le Chat'],
      seenKeys: new Set()
    });
    expect(events.map((event) => event.model)).toEqual(['Le Chat', 'DeepSeek']);
  });
});
