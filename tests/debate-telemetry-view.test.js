const View = require('../results/debate-telemetry-view');

describe('Disput telemetry view', () => {
  test('renders health, diagnoses and raw trace from one report', () => {
    document.body.innerHTML = `
      <div id="disput-health-summary"></div><div id="disput-problems"></div>
      <div id="disput-raw-events"></div>
      <span id="disput-trace-status"></span>`;
    const report = {
      metadata: { topology: 'universal', presetId: 'UNIVERSAL_RED_TEAM', dataCompleteness: 'complete' },
      health: { classification: 'degraded_success', terminalOutcome: 'completed', severity: 'warning', manualRecoveryCount: 1, forcedCompletionCount: 0, stateDivergenceCount: 1 },
      runOutcome: { durationMs: 10000 },
      diagnoses: [{ severity: 'high', code: 'STATE_DIVERGENCE', affectedStageId: 'r1:wave', affectedParticipant: 'DeepSeek', summary: 'status mismatch' }],
      stageExecutions: [{ stageId: 'r1:wave', kind: 'opening_batch', expected: { participants: ['Qwen'] }, actual: { participants: ['Qwen'] }, durationMs: 5000, status: 'success', deviations: [] }],
      participantExecutions: [{ participantId: 'Qwen', completedStages: 1, expectedStages: 1, submitStatus: 'confirmed', completionStatus: 'detected', recoveries: 0, finalStatus: 'SUCCESS' }],
      criticalPath: { stageId: 'r1:wave', durationMs: 5000 }, barriers: [],
      events: [{ receivedSeq: 1, sourceTimestamp: Date.now(), eventType: 'RUN_STARTED', source: 'application', severity: 'info', correlation: { stageId: '' }, reasonCode: '' }],
      integrity: { eventsTotal: 1 }
    };
    expect(View.render(report, document)).toBe(true);
    expect(document.getElementById('disput-health-summary').textContent).toContain('degraded_success');
    expect(document.getElementById('disput-problems').textContent).toContain('STATE_DIVERGENCE');
    expect(document.getElementById('disput-raw-events').textContent).toContain('RUN_STARTED');
  });

  test('Only problems keeps preceding events from the same stage as context', () => {
    document.body.innerHTML = `
      <input type="checkbox" id="disput-only-problems" checked>
      <div id="disput-health-summary"></div><div id="disput-problems"></div>
      <div id="disput-raw-events"></div>
      <span id="disput-trace-status"></span>`;
    const baseEvent = { sourceTimestamp: Date.now(), source: 'application', reasonCode: '' };
    const report = {
      metadata: { topology: 'universal', presetId: 'UNIVERSAL', dataCompleteness: 'complete' },
      health: { classification: 'failed', terminalOutcome: 'failed', severity: 'critical', manualRecoveryCount: 0, forcedCompletionCount: 0 },
      runOutcome: { durationMs: 1000 },
      diagnoses: [],
      stageExecutions: [],
      participantExecutions: [],
      criticalPath: null,
      barriers: [],
      events: [
        { ...baseEvent, receivedSeq: 1, eventType: 'STAGE_STARTED', severity: 'info', correlation: { stageId: 'stage-a' } },
        { ...baseEvent, receivedSeq: 2, eventType: 'OTHER_STAGE_PROGRESS', severity: 'info', correlation: { stageId: 'stage-b' } },
        { ...baseEvent, receivedSeq: 3, eventType: 'MODEL_TIMEOUT', severity: 'critical', correlation: { stageId: 'stage-a' } }
      ],
      integrity: { eventsTotal: 3 }
    };

    expect(View.render(report, document)).toBe(true);
    const trace = document.getElementById('disput-raw-events').textContent;
    expect(trace).toContain('STAGE_STARTED');
    expect(trace).toContain('MODEL_TIMEOUT');
    expect(trace).not.toContain('OTHER_STAGE_PROGRESS');
  });
});
