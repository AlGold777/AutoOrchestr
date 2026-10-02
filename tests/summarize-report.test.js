// The digest script: facts from both report formats, computed (gaps, long stages, text that stood
// still before the terminal), no model involved.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { summarize } = require('../scripts/summarize-report');

const write = (name, data) => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'digest-')), name);
  fs.writeFileSync(file, JSON.stringify(data));
  return file;
};

describe('Disput Flow export', () => {
  const T = 1790940000000;
  const stage = (n, start, end, participants) => ({
    stageId: `stage-9642776a-3c87-479b-9993-ae0a7766ac03-${n}`, status: 'success', deviations: ['unplanned_stage'],
    durationMs: end - start, actual: { participants, startedAt: T + start, completedAt: T + end, terminalEventType: 'STAGE_COMPLETED' }
  });
  const ev = (stageN, eventType, at, model, extra = {}) => ({
    eventType, sourceTimestamp: T + at, reasonCode: extra.reasonCode || '',
    correlation: { stageId: `stage-9642776a-3c87-479b-9993-ae0a7766ac03-${stageN}` },
    payload: { model, details: extra.details || '', answerLength: extra.chars ?? null, evidence: extra.evidence || {} }
  });
  const report = {
    metadata: { debateRunId: 'r', presetId: 'TEST', topology: 'universal', extensionVersion: '2.81.555', exportedAt: '2026-10-02T17:18:05.190Z', dataCompleteness: 'incomplete' },
    plan: null,
    runOutcome: { startedAt: T, completedAt: T + 2400000, durationMs: 2400000, terminalOutcome: 'completed' },
    health: { classification: 'degraded_success', severity: 'warning', diagnosisCount: 1, manualRecoveryCount: 1, forcedCompletionCount: 1, stateDivergenceCount: 0 },
    stageExecutions: [stage(1, 0, 30000, ['A', 'B']), stage(2, 30500, 60000, ['A', 'B']), stage(3, 70000, 2270000, ['A']), stage(4, 2270200, 2300000, ['A'])],
    diagnoses: [{ code: 'STAGE_FAILURE', severity: 'critical', affectedStageId: 'stage-9642776a-3c87-479b-9993-ae0a7766ac03-3', affectedParticipant: 'A', summary: 'PIPELINE_ERROR', reasonCode: 'PIPELINE_ERROR', occurrences: 1, firstObservedAt: T + 1000000, resolvedAt: null }],
    dispatchAttempts: [{ dispatchId: 'A:1', participantId: 'A', stageId: 'stage-9642776a-3c87-479b-9993-ae0a7766ac03-1' }, { dispatchId: null, participantId: 'A', stageId: 'stage-9642776a-3c87-479b-9993-ae0a7766ac03-1' }],
    events: [
      ev(3, 'TEXT_STABLE', 70000 + 16000, 'A', { chars: 2540 }),
      ev(3, 'MANUAL_RECOVERY_REQUESTED', 70000 + 1200000, 'A', { details: 'UI button', reasonCode: 'MANUAL_RECOVERY' }),
      ev(3, 'STABLE_TEXT_FALLBACK_USED', 70000 + 1157000, 'A', { details: 'reason=stable_text len=2696' }),
      ev(3, 'MODEL_TERMINAL_COMMITTED', 2270000 - 10000, 'A', { chars: 2919, evidence: { finalStatus: 'PARTIAL', completionReason: 'hard_stop_recovered_partial' } })
    ],
    integrity: { eventsTotal: 4, sequenceGaps: [], duplicateEventIds: [], uncorrelatedEvents: [], missingTerminalEvents: [], schemaValidationErrors: [] }
  };

  test('shows the stage table with the long stage and the gaps, and the text that stood still', () => {
    const text = summarize(write('flow.json', report));
    expect(text).toContain('## Disput Flow export');
    expect(text).toMatch(/\| 3 \| stage-3 \| A \| 70\.0s \| 2270\.0s \| 36\.7min .*LONG\(>3×median\)/);
    expect(text).toMatch(/\| 1 \| stage-1 .*\| 0\.5s \|/); // gap to the next stage
    expect(text).toContain('stage 3 A: text stable from +16.0s');
    expect(text).toMatch(/\| 3 \| A \| 16\.0s .*PARTIAL\/hard_stop_recovered_partial\/2919ch \| 1 @1157\.0s/);
    expect(text).toContain('- 1270.0s A · UI button · stage-3');
    expect(text).toContain('| STAGE_FAILURE | critical | A@stage-3 |');
    expect(text).toContain('without dispatchId: 1');
    // One line per model, and the notable events of a model that needed a recovery.
    expect(text).toContain('### Per model (whole run)');
    expect(text).toMatch(/\| A \| 3 \| 3:PARTIAL\/hard_stop_recovered_partial \| 1 \| — \| 1 \| stage 3 \|/);
    expect(text).toContain('### Notable events: A');
  });

  test('a model that dropped out is visible in the per-model table, not only the longest stage', () => {
    const dropped = { ...report, stageExecutions: [stage(1, 0, 30000, ['A', 'B']), stage(2, 30100, 60000, ['A'])], diagnoses: [],
      events: [ev(1, 'MODEL_TERMINAL_COMMITTED', 20000, 'B', { evidence: { finalStatus: 'SUCCESS', completionReason: 'forced_success_with_text' } }),
        ev(1, 'MANUAL_RECOVERY_REQUESTED', 19000, 'B', { details: 'UI button' }),
        ev(2, 'MODEL_TERMINAL_COMMITTED', 50000, 'A', { evidence: { finalStatus: 'SUCCESS', completionReason: 'lifecycle_complete_snapshot' } })] };
    const text = summarize(write('dropped.json', dropped));
    expect(text).toMatch(/\| B \| 1 \| 1:SUCCESS\/forced_success_with_text \| 1 \| — \| — \| stage 1 \|/);
    expect(text).toMatch(/\| A \| 2 \| 2:SUCCESS\/lifecycle_complete_snapshot \| — \| — \| — \| — \|/);
  });

  test('a clean flow is reported without flags', () => {
    const clean = { ...report, stageExecutions: [stage(1, 0, 30000, ['A']), stage(2, 30100, 60000, ['A'])], events: [], diagnoses: [] };
    const text = summarize(write('clean.json', clean));
    expect(text).not.toContain('LONG(');
    expect(text).toContain('### Text stable long before the terminal (> 2 min)\n- none');
  });
});

describe('message-delivery report', () => {
  const report = {
    report: 'message-delivery', extension_version: '2.81.551', transport_contract_version: '1.0.0', generated_at: '2026-10-02T10:20:24.280Z',
    diagnosis: {
      batches: [
        { waitId: 'wait-1', batchId: 'stage-1:a1', stageAttemptId: 'stage-1:a1', at: '2026-10-02T10:08:17.408Z', models: ['G', 'K'], runMode: 'auto', template: 'Test', outcome: 'settled', durationMs: 43220, accepted: { waitedMs: 123 }, refusals: [], skipped: [], adopted: [] },
        { waitId: 'wait-2', batchId: 'stage-2:a1', stageAttemptId: 'stage-2:a1', at: '2026-10-02T10:09:06.372Z', models: ['G', 'K'], runMode: 'auto', template: 'Test', outcome: 'settled', durationMs: 55185, accepted: { waitedMs: 19322 },
          refusals: [{ attempt: 1, errorCode: 'RUN_ALREADY_ACTIVE', reason: null, waitedMs: 121 }], skipped: [], adopted: [] }
      ],
      sends: [{ model: 'G', batchId: 'stage-1:a1', submittedMs: 8225, firstTextMs: 25904, result: 'delivered', terminal: { status: 'SUCCESS', chars: 1332, completion: 'complete' }, focus: { count: 5, sources: { round1_simple: 1 } }, revisions: 1, rejections: [{ reason: 'unknown_request' }] }],
      problems: [{ code: 'late_duplicate', severity: 'info', model: 'G', count: 1, reason: 'unknown_request' }]
    },
    journal: [
      { at: '2026-10-02T10:08:02.216Z', kind: 'prepared', model: 'G' },
      { at: '2026-10-02T10:09:20.000Z', kind: 'stall_adopted', models: ['K'], stallMs: 180000 },
      { at: '2026-10-02T10:09:06.382Z', kind: 'identity_rejected', model: 'G', reason: 'unknown_request' }
    ]
  };

  test('shows batches with the gap before each, refusals, sends, problems, engine events and rejections', () => {
    const text = summarize(write('delivery.json', report));
    expect(text).toContain('## message-delivery report');
    expect(text).toMatch(/\| wait-2 \| stage-2:a1 \| auto \| Test \| G\+K \|.*\| 19\.3s \| 1 \| settled \| 55\.2s \| 5\.7s \|/); // gap 10:08:17.4+43.2 → 10:09:06.4
    expect(text).toContain('wait-2#1 RUN_ALREADY_ACTIVE after 0.1s');
    expect(text).toContain('| G | stage-1:a1 | 8.2s | 25.9s | delivered | SUCCESS | 1332 | complete | 5 round1_simple:1 | 1 | unknown_request |');
    expect(text).toContain('| late_duplicate | info | G | 1 | unknown_request |');
    expect(text).toContain('stall_adopted');
    expect(text).toContain('G:unknown_request×1');
  });
});

test('an unknown report type fails with a clear message instead of a wrong digest', () => {
  expect(() => summarize(write('x.json', { hello: 'world' }))).toThrow(/unknown report type/);
});
