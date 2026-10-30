const BasicTelemetry = require('../shared/basic-telemetry');

const run = (overrides = {}) => ({
  runId: 'run-1',
  pipelineName: 'Pipeline A',
  lifecycle: 'RUNNING',
  startedAt: 10,
  finishedAt: null,
  stopReason: null,
  attempts: [
    { step: 0, participant: 'A', model: 'Claude', attempt: 1, state: 'done', accepted: false, reason: 'empty', transportRequestId: 'req-a1', input: { mode: 'none', items: [] } },
    { step: 0, participant: 'B', model: 'Claude', attempt: 1, state: 'done', accepted: true, answer: 'accepted B', transportRequestId: 'req-b1', input: { mode: 'none', items: [] } },
    { step: 0, participant: 'A', model: 'Claude', attempt: 2, retryOf: 1, state: 'sent', accepted: false, transportRequestId: 'req-a2', input: { mode: 'previous', items: [{ source: { participant: 'B', attempt: 1 }, text: 'accepted B' }] } }
  ],
  ownerSnapshot: { choice: 'keep B', capturedAt: 11 },
  ...overrides
});

const report = (customRun, delivery = {}, events = []) => BasicTelemetry.buildReport({
  customRun, delivery, events, extensionVersion: '2.81.874', exportedAt: '2026-10-25T10:00:00.000Z'
});

describe('Basic telemetry export', () => {
  test('keeps the frozen unfinished run, its attempts, input lineage, accepted state, retry and owner snapshot', () => {
    const customRun = run();
    const result = report(customRun);

    expect(result.customRun).toBe(customRun);
    expect(result).toMatchObject({ format: 'basic-telemetry/3', runId: 'run-1', extensionVersion: '2.81.874' });
    expect(result.customRun).toMatchObject({ lifecycle: 'RUNNING', finishedAt: null, stopReason: null });
    expect(result.customRun.attempts).toHaveLength(3);
    expect(result.customRun.attempts[1]).toMatchObject({ participant: 'B', model: 'Claude', accepted: true });
    expect(result.customRun.attempts[2]).toMatchObject({ participant: 'A', attempt: 2, retryOf: 1, state: 'sent' });
    expect(result.customRun.attempts[2].input.items[0].source).toMatchObject({ participant: 'B', attempt: 1 });
    expect(result.customRun.ownerSnapshot).toEqual({ choice: 'keep B', capturedAt: 11 });
  });

  test('preserves live execution state even when a resumed record retains an earlier stop marker', () => {
    const customRun = run({ lifecycle: 'STOPPED', finishedAt: 9, stopReason: 'stopped' });
    const result = BasicTelemetry.buildReport({ customRun, executionActive: true });

    expect(result.executionActive).toBe(true);
    expect(result.customRun).toMatchObject({ lifecycle: 'STOPPED', finishedAt: 9, stopReason: 'stopped' });
  });

  test('separates participants using request IDs when they used the same model', () => {
    const result = report(run(), { journal: [
      { kind: 'accepted', model: 'Claude', participant: 'A', requestId: 'req-a1' },
      { kind: 'accepted', model: 'Claude', participant: 'B', requestId: 'req-b1' },
      { kind: 'accepted', model: 'Claude', participant: 'C', requestId: 'req-c1' }
    ] });

    expect(result.delivery.journal.map(entry => entry.requestId)).toEqual(['req-a1', 'req-b1']);
  });

  test('excludes another run even when its request ID collides with this run', () => {
    const result = report(run(), { journal: [
      { kind: 'displayed', runId: 'run-other', requestId: 'req-a1' },
      { kind: 'displayed', runId: 'run-1', requestId: 'req-a1' }
    ] }, [
      { event: 'foreign', meta: { pipelineRunId: 'run-other', requestId: 'req-a1' } },
      { event: 'own', meta: { pipelineRunId: 'run-1', requestId: 'req-a1' } }
    ]);

    expect(result.delivery.journal.map(entry => entry.kind)).toEqual(['displayed']);
    expect(result.telemetry.events.map(entry => entry.event)).toEqual(['own']);
  });

  test('includes delivery requests correlated through this run batch ID', () => {
    const result = report(run(), { journal: [
      { kind: 'batch-sent', batchId: 'run-1:step-0:visit-1', requestIds: { Claude: 'batch-req-a' } },
      { kind: 'request-only', requestId: 'batch-req-a' },
      { kind: 'prepared', correlation: { requestId: 'batch-req-a' } },
      { kind: 'batch-sent', batchId: 'run-other:step-0:visit-1', requestIds: { Claude: 'foreign-req' } }
    ] }, [
      { event: 'batch-event', correlation: { batchId: 'run-1:step-0:visit-1' } },
      { event: 'foreign-batch-event', correlation: { batchId: 'run-other:step-0:visit-1' } }
    ]);

    expect(result.delivery.journal.map(entry => entry.kind)).toEqual(['batch-sent', 'request-only', 'prepared']);
    expect(result.telemetry.events.map(entry => entry.event)).toEqual(['batch-event']);
  });

  test('selects correlated events when custom_start was lost, and excludes unbound events', () => {
    const result = report(run(), {}, [
      { event: 'request-start', correlation: { requestId: 'req-a1' } },
      { event: 'stage-finished', meta: { pipelineRunId: 'run-1', stageId: 'custom:run-1:step-0' } },
      { event: 'same-model-only', modelId: 'Claude' },
      { event: 'unrelated', meta: { pipelineRunId: 'run-other' } }
    ]);

    expect(result.telemetry.events.map(entry => entry.event)).toEqual(['request-start', 'stage-finished']);
    expect(result.telemetry.selection).toMatchObject({ basis: 'explicit_run_or_request_identity', sourceRetained: 4, selected: 2, excluded: 2 });
  });

  test('a run-prefixed batch ID explicitly binds raw diagnostics to the run', () => {
    const result = report(run(), {}, [
      { event: 'batch-only', correlation: { batchId: 'run-1:step-0:visit-1' } },
      { event: 'explicit-request', correlation: { requestId: 'req-a1', batchId: 'run-other:step-0' } },
      { event: 'foreign-batch', correlation: { batchId: 'run-other:step-0' } }
    ]);

    expect(result.telemetry.events.map(entry => entry.event)).toEqual(['batch-only', 'explicit-request']);
  });

  test('exports only the selected run journal and does not treat model equality as identity', () => {
    const result = report(run(), {
      journal: [
        { kind: 'ours', stageId: 'custom:run-1:step-1', model: 'Claude' },
        { kind: 'same-model-unbound', model: 'Claude' },
        { kind: 'another-run', pipelineRunId: 'run-other', stageId: 'custom:run-1:step-1' }
      ],
      collection: { captured: true }
    });

    expect(result.delivery.journal.map(entry => entry.kind)).toEqual(['ours']);
    expect(result.delivery.collection).toEqual({ captured: true });
  });
});
