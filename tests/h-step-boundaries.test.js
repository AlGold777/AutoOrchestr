/** @jest-environment node */
const Engine = require('../disput/custom-engine.js');
const CustomRunRecord = require('../disput/custom-run-record.js');
const BasicTelemetry = require('../shared/basic-telemetry.js');
const ReportDigest = require('../shared/report-digest.js');

const clone = (v) => JSON.parse(JSON.stringify(v));
const textStore = () => {
  const map = new Map();
  let next = 1;
  return {
    putText: (text) => { const ref = `t_${next++}`; map.set(ref, text); return ref; },
    getText: (ref) => map.get(ref) ?? null
  };
};

describe('Package H: Step Boundaries and Rounds Summary (R01 / ТЗ 5.H)', () => {
  test('custom_step_start is emitted before first external action for round and owner steps', async () => {
    const emitted = [];
    const steps = [
      { ref: 'r1', kind: 'round', input: 'none', models: [{ id: 'C1', name: 'Claude' }] },
      { ref: 'owner:1', kind: 'owner', input: 'previous', task: 'Check answer' }
    ];

    await Engine.run({
      task: 'Task',
      steps,
      onEvent: (name, payload) => emitted.push({ name, ...payload }),
      sendParticipants: async () => ({ C1: { text: 'Round 1 answer', status: 'SUCCESS' } }),
      provideOwnerResult: async () => 'Owner approved'
    });

    const stepStarts = emitted.filter((e) => e.name === 'custom_step_start');
    expect(stepStarts).toHaveLength(2);

    expect(stepStarts[0]).toMatchObject({
      step: 0,
      ref: 'r1',
      kind: 'round',
      visit: 1
    });
    expect(typeof stepStarts[0].startedAt).toBe('number');

    expect(stepStarts[1]).toMatchObject({
      step: 1,
      ref: 'owner:1',
      kind: 'owner',
      visit: 1
    });

    // custom_step_start precedes any custom_answer or custom_wait_start
    const names = emitted.map((e) => e.name);
    expect(names.indexOf('custom_step_start')).toBeLessThan(names.indexOf('custom_answer'));
  });

  test('step with ASK emits custom_step_end AFTER askOwner, not before it', async () => {
    const eventLog = [];
    const steps = [
      { ref: 'r1', kind: 'round', input: 'none', models: [{ id: 'C1', name: 'Claude' }] }
    ];

    await Engine.run({
      task: 'Task',
      steps,
      onEvent: (name, payload) => eventLog.push(name),
      sendParticipants: async () => ({ C1: { text: 'Please answer: [[ASK: What is the target?]]', status: 'SUCCESS' } }),
      parseAsks: (text) => {
        const match = text.match(/\[\[ASK:\s*([^\]]+)\]\]/);
        return match ? [match[1]] : [];
      },
      askOwner: async (asks) => {
        eventLog.push('ask_dialog_opened');
        return [{ ask: asks[0], answer: 'Target is 42' }];
      }
    });

    expect(eventLog).toContain('ask_dialog_opened');
    expect(eventLog).toContain('custom_step_end');

    // Crucial R01 invariant: askOwner must precede custom_step_end
    expect(eventLog.indexOf('ask_dialog_opened')).toBeLessThan(eventLog.indexOf('custom_step_end'));
  });

  test('interruption during ASK emits custom_step_interrupted and DOES NOT emit custom_step_end', async () => {
    const emitted = [];
    const controller = new AbortController();
    const steps = [
      { ref: 'r1', kind: 'round', input: 'none', models: [{ id: 'C1', name: 'Claude' }] }
    ];

    const runPromise = Engine.run({
      task: 'Task',
      steps,
      signal: controller.signal,
      onEvent: (name, payload) => emitted.push({ name, ...payload }),
      sendParticipants: async () => ({ C1: { text: 'Question: [[ASK: Confirm please]]', status: 'SUCCESS' } }),
      parseAsks: (text) => (text.includes('[[ASK:') ? ['Confirm please'] : []),
      askOwner: async () => {
        // Run aborted while user is looking at ASK dialog
        controller.abort();
        const err = new Error('The operation was aborted');
        err.name = 'AbortError';
        throw err;
      }
    });

    const result = await runPromise.catch(() => null);
    if (result) expect(result.stopReason).toBe('cancelled');

    const ends = emitted.filter((e) => e.name === 'custom_step_end');
    const interrupted = emitted.filter((e) => e.name === 'custom_step_interrupted');

    expect(ends).toHaveLength(0);
    expect(interrupted).toHaveLength(1);
    expect(interrupted[0]).toMatchObject({
      step: 0,
      ref: 'r1',
      kind: 'round',
      visit: 1,
      outcome: 'cancelled'
    });
  });

  test('resuming interrupted step emits custom_step_resumed without second custom_step_start', async () => {
    const emitted = [];
    const texts = textStore();
    const steps = [
      { ref: 'r1', kind: 'round', input: 'none', owner: 'approve', models: [{ id: 'C1', name: 'Claude' }] }
    ];

    let savedState = null;
    const controller = new AbortController();

    // First session: aborts during decide
    await Engine.run({
      task: 'Task',
      steps,
      signal: controller.signal,
      putText: texts.putText,
      getText: texts.getText,
      checkpoint: async (state) => { savedState = clone(state); },
      sendParticipants: async () => ({ C1: { text: 'Done', status: 'SUCCESS' } }),
      decide: async () => {
        controller.abort();
        const err = new Error('The operation was aborted');
        err.name = 'AbortError';
        throw err;
      }
    }).catch(() => null);

    expect(savedState).toBeDefined();

    // Second session: resumes the interrupted visit
    await Engine.run({
      task: 'Task',
      steps,
      resume: clone(savedState),
      putText: texts.putText,
      getText: texts.getText,
      sendParticipants: async () => ({ C1: { text: 'Done', status: 'SUCCESS' } }),
      onEvent: (name, payload) => emitted.push({ name, ...payload }),
      decide: async () => 'continue'
    });

    const starts = emitted.filter((e) => e.name === 'custom_step_start');
    const resumed = emitted.filter((e) => e.name === 'custom_step_resumed');
    const ends = emitted.filter((e) => e.name === 'custom_step_end');

    expect(starts).toHaveLength(0); // No duplicate custom_step_start for resumed visit
    expect(resumed).toHaveLength(1);
    expect(resumed[0]).toMatchObject({
      step: 0,
      ref: 'r1',
      visit: 1
    });
    expect(ends).toHaveLength(1);
    expect(ends[0].outcome).toBe('completed');
  });

  test('BasicTelemetry.buildReport constructs rounds summary with boundaries, waits and non-overlapping wait duration', () => {
    const record = CustomRunRecord.createRun({
      runId: 'run-h01',
      steps: [
        { ref: 's1', kind: 'round', models: ['Claude', 'GPT'] },
        { ref: 'owner:s2', kind: 'owner', models: [] }
      ]
    });

    // Register attempts
    CustomRunRecord.recordAttempt(record, {
      ref: 's1',
      participant: 'Claude',
      model: 'Claude',
      visit: 1,
      attempt: 1,
      phase: 'answer',
      state: 'done',
      accepted: true,
      sentAt: 1000,
      finishedAt: 2000,
      transportRequestId: 'req-claude-1'
    });
    CustomRunRecord.recordAttempt(record, {
      ref: 's1',
      participant: 'GPT',
      model: 'GPT',
      visit: 1,
      attempt: 1,
      phase: 'answer',
      state: 'done',
      accepted: true,
      sentAt: 1000,
      finishedAt: 2500,
      transportRequestId: 'req-gpt-1'
    });

    // Register waits in s1: two waits, one overlapping
    CustomRunRecord.recordWaitStart(record, {
      waitId: 'w1',
      kind: 'decision',
      stepRef: 's1',
      visit: 1,
      startedAt: 3000,
      endedAt: 5000, // duration: 2000ms
      outcome: 'approved'
    });
    CustomRunRecord.recordWaitStart(record, {
      waitId: 'w2',
      kind: 'asks',
      stepRef: 's1',
      visit: 1,
      startedAt: 4000, // overlaps with w1 (3000-5000)
      endedAt: 6000, // extends to 6000 -> merged interval 3000-6000 = 3000ms
      outcome: 'answered'
    });

    const events = [
      { kind: 'custom_step_start', pipelineRunId: 'run-h01', step: 0, ref: 's1', visit: 1, startedAt: 900 },
      { kind: 'custom_step_end', pipelineRunId: 'run-h01', step: 0, ref: 's1', visit: 1, outcome: 'completed', endedAt: 7000 }
    ];

    const report = BasicTelemetry.buildReport({
      customRun: CustomRunRecord.exportRun(record),
      events
    });

    expect(Array.isArray(report.rounds)).toBe(true);
    expect(report.rounds).toHaveLength(2); // s1 and owner:s2

    const round1 = report.rounds.find((r) => r.stepRef === 's1');
    expect(round1).toBeDefined();
    expect(round1).toMatchObject({
      stepRef: 's1',
      index: 0,
      kind: 'round',
      visit: 1,
      expectedParticipants: ['Claude', 'GPT'],
      attemptCount: 2,
      sentCount: 2,
      startedAt: 900,
      endedAt: 7000,
      outcome: 'completed',
      durationMs: 6100,
      waitIds: ['w1', 'w2']
    });

    // Overlapping intervals 3000-5000 and 4000-6000 must merge into 3000ms, not 4000ms
    expect(round1.userWaitDurationMs).toBe(3000);
  });

  test('ReportDigest.customFlowReport uses step boundaries with fallback to legacy_check', () => {
    const RUN = 'run-h02';
    const at = (ms) => new Date(1700000000000 + ms).toISOString();

    // 1. Modern journal with custom_step_start and custom_step_end
    const modernJournal = [
      { at: at(0), kind: 'custom_start', pipelineRunId: RUN, steps: [{ step: 0, label: 'R1', input: 'none', models: ['A'] }] },
      { at: at(500), kind: 'custom_step_start', pipelineRunId: RUN, step: 0, ref: 'r1', visit: 1, startedAt: 500 },
      { at: at(1000), kind: 'batch_start', batchId: `${RUN}:r1:g0`, stageId: ReportDigest.customStageId(RUN, 0), models: ['A'], requestIds: { A: 'q1' } },
      { at: at(4000), kind: 'custom_step_end', pipelineRunId: RUN, step: 0, ref: 'r1', visit: 1, outcome: 'completed', endedAt: 4000 }
    ];

    const modernReport = ReportDigest.customFlowReport({ runId: RUN, delivery: { journal: modernJournal } });
    const stage0 = modernReport.stageExecutions[0];
    expect(stage0.actual.startedAt).toBe(at(500));
    expect(stage0.actual.completedAt).toBe(at(4000));
    expect(stage0.durationMs).toBe(3500);

    // 2. Legacy journal with custom_step only (fallback with basis: legacy_check)
    const legacyJournal = [
      { at: at(0), kind: 'custom_start', pipelineRunId: RUN, steps: [{ step: 0, label: 'R1', input: 'none', models: ['A'] }] },
      { at: at(1000), kind: 'batch_start', batchId: `${RUN}:r1:g0`, stageId: ReportDigest.customStageId(RUN, 0), models: ['A'], requestIds: { A: 'q1' } },
      { at: at(2500), kind: 'custom_step', pipelineRunId: RUN, step: 0, accepted: 1, failed: 0 }
    ];

    const legacyReport = ReportDigest.customFlowReport({ runId: RUN, delivery: { journal: legacyJournal } });
    const legacyStage0 = legacyReport.stageExecutions[0];
    expect(legacyStage0.actual.completedAt).toBe(at(2500));
    expect(legacyStage0.endBasis).toBe('legacy_check');
  });
});
