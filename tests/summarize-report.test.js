// The digest script: facts from both report formats with field paths, computed values marked,
// events joined to transport requests by explicit identifiers; no model involved.
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

  test('stage table: true median, LONG, gap, contradiction; attempt, chronology, manual and diagnoses with paths', () => {
    const text = summarize(write('flow.json', report));
    expect(text).toContain('## Disput Flow export');
    expect(text).toContain('calc: median durationMs of sorted [29500, 29800, 30000, 2200000] = 29900');
    expect(text).toContain('| 3 | stage-3 | A | 70.000 | 2270.000 | 2200000 | 0.200 | success | LONG(>3×median) LONG(>120000ms) | success + STAGE_FAILED/STAGE_FAILURE: diagnoses[0] | unplanned_stage |');
    expect(text).toMatch(/\| 1 \| stage-1 \| A\+B \| 0\.000 \| 30\.000 \| 30000 \| 0\.500 \|/);
    expect(text).toMatch(/\| stage-3 \| A \|.*1 · PARTIAL\/hard_stop_recovered_partial\/2919 t=2260\.000/);
    expect(text).toContain('2174000 (>120000) / 2174000 (>120000)');
    expect(text).toContain('#### stage-3 / A');
    expect(text).toContain('events[1] · MANUAL_RECOVERY_REQUESTED MANUAL_RECOVERY · UI button [joined by stageId]');
    expect(text).toContain('  - t=1270.000 stage-3 A · events[1] · UI button');
    expect(text).toContain('| STAGE_FAILURE | PIPELINE_ERROR | critical | A | stage-3 | 1 | 1 | 1 |');
    expect(text).toContain('stageExecutions[2].status=success · STAGE_FAILED/STAGE_FAILURE for this stageId: diagnoses[0]');
    expect(text).toContain('health.forcedCompletionCount=1 · MODEL_TERMINAL_COMMITTED with completionReason forced_*=0');
    expect(text).toContain('without dispatchId 1');
    expect(text).toContain('plan=null');
    expect(text).toContain('delivery=no field');
    expect(text).toContain('| A | 3 | 3:PARTIAL/hard_stop_recovered_partial | 1 | 0 | stage-3 of 4 |');
  });

  test('a model that dropped out is visible in the per-model table, not only the longest stage', () => {
    const dropped = { ...report, stageExecutions: [stage(1, 0, 30000, ['A', 'B']), stage(2, 30100, 60000, ['A'])], diagnoses: [],
      events: [ev(1, 'MODEL_TERMINAL_COMMITTED', 20000, 'B', { evidence: { finalStatus: 'SUCCESS', completionReason: 'forced_success_with_text' } }),
        ev(1, 'MANUAL_RECOVERY_REQUESTED', 19000, 'B', { details: 'UI button' }),
        ev(2, 'MODEL_TERMINAL_COMMITTED', 50000, 'A', { evidence: { finalStatus: 'SUCCESS', completionReason: 'lifecycle_complete_snapshot' } })] };
    const text = summarize(write('dropped.json', dropped));
    expect(text).toContain('| B | 1 | 1:SUCCESS/forced_success_with_text | 1 | 0 | stage-1 of 2 |');
    expect(text).toContain('| A | 2 | 2:SUCCESS/lifecycle_complete_snapshot | 0 | 0 | stage-2 |');
  });

  test('a clean flow is reported without flags', () => {
    const clean = { ...report, stageExecutions: [stage(1, 0, 30000, ['A']), stage(2, 30100, 60000, ['A'])], events: [], diagnoses: [] };
    const text = summarize(write('clean.json', clean));
    expect(text).not.toContain('LONG(');
    expect(text).toContain('or attribution warning\n- none');
    expect(text).toContain("equal to the previous attempt's answer\n- none");
  });

  test('with a delivery section: joins by requestId/dispatchId, foreign dispatchId, stale length, refusals, filtered events, late records, next prompt', () => {
    const S = (n) => `stage-9642776a-3c87-479b-9993-ae0a7766ac03-${n}`;
    const at = (ms) => new Date(T + ms).toISOString();
    const first = 'Первый ответ модели A про путь Дао, достаточно длинный текст для пробы.';
    const flow = {
      ...report,
      stageExecutions: [stage(1, 0, 20000, ['A']), stage(2, 20100, 40000, ['A'])],
      runOutcome: { startedAt: T, completedAt: T + 40000, durationMs: 40000, terminalOutcome: 'completed' },
      health: { classification: 'degraded_success', severity: 'warning', diagnosisCount: 0, manualRecoveryCount: 0, forcedCompletionCount: 0, stateDivergenceCount: 0 },
      diagnoses: [],
      dispatchAttempts: [],
      events: [
        { ...ev(2, 'STAGE_FAILED', 20600, 'A', { reasonCode: 'PIPELINE_ERROR' }), receivedSeq: 5, correlation: { stageId: S(2), dispatchId: 'A:1' } },
        { ...ev(2, 'TEXT_STABLE', 23500, 'A', { evidence: { textLength: 300 } }), receivedSeq: 6, correlation: { stageId: S(2), dispatchId: 'A:2' } },
        { ...ev(2, 'MODEL_TERMINAL_COMMITTED', 38900, 'A', { chars: 400, evidence: { finalStatus: 'SUCCESS', completionReason: 'lifecycle_complete_snapshot' } }), receivedSeq: 9, correlation: { stageId: S(2), dispatchId: 'A:2' } }
      ],
      integrity: { eventsTotal: 10, firstSeq: 1, lastSeq: 10, sequenceGaps: [], duplicateEventIds: [], uncorrelatedEvents: [], missingTerminalEvents: [], schemaValidationErrors: [] },
      delivery: {
        report: 'message-delivery', extension_version: '2.81.568', transport_contract_version: '1.0.0', generated_at: at(200000),
        diagnosis: {
          batches: [{ waitId: 'wait-2', batchId: `${S(2)}:a1`, at: at(20110), models: ['A'], durationMs: 19000, accepted: { waitedMs: 1500 },
            refusals: [{ at: at(20120), attempt: 1, errorCode: 'RUN_ALREADY_ACTIVE', blockingModel: null, waitedMs: 10 }, { at: at(21110), attempt: 2, errorCode: 'RUN_ALREADY_ACTIVE', waitedMs: 1000 }] }],
          sends: [
            { model: 'A', requestId: 'treq-1', batchId: `${S(1)}:a1`, result: 'delivered', terminal: { status: 'SUCCESS', chars: 300 } },
            { model: 'A', requestId: 'treq-2', batchId: `${S(2)}:a1`, result: 'delivered', terminal: { status: 'SUCCESS', chars: 400 } }
          ],
          problems: [], rejections: [], moderator: []
        },
        journal: [
          { at: at(10), kind: 'batch_start', batchId: `${S(1)}:a1`, stageId: S(1), models: ['A'], requestIds: { A: 'treq-1' }, waitId: 'wait-1', stageAttemptId: `${S(1)}:a1` },
          { at: at(11), kind: 'prepared', batchId: `${S(1)}:a1`, model: 'A', requestId: 'treq-1', token: 'AO-aaaaaa', chars: 100, prompt: 'p1' },
          { at: at(1000), kind: 'dispatch', phase: 'dispatch_started', model: 'A', requestId: 'treq-1', dispatchId: 'A:1' },
          { at: at(2000), kind: 'dispatch', phase: 'submitted', model: 'A', requestId: 'treq-1', dispatchId: 'A:1' },
          { at: at(5000), kind: 'first_text', model: 'A', requestId: 'treq-1', chars: 50 },
          { at: at(15000), kind: 'verified', model: 'A', requestId: 'treq-1', dispatchId: 'A:1', chars: 300, status: 'SUCCESS', reason: 'lifecycle_complete_snapshot', answer: first },
          { at: at(20110), kind: 'batch_start', batchId: `${S(2)}:a1`, stageId: S(2), models: ['A'], requestIds: { A: 'treq-2' }, waitId: 'wait-2', stageAttemptId: `${S(2)}:a1` },
          { at: at(20111), kind: 'prepared', batchId: `${S(2)}:a1`, model: 'A', requestId: 'treq-2', token: 'AO-bbbbbb', chars: 5000, prompt: `Контекст: ${first} Дальше обрезано` },
          { at: at(20500), kind: 'completion_terminal', model: 'A', requestId: 'treq-2', dispatchId: 'A:1', status: 'CONTEXT_LOST', reason: 'context_invalidated' },
          { at: at(21000), kind: 'dispatch', phase: 'dispatch_started', model: 'A', requestId: 'treq-2', dispatchId: 'A:2' },
          { at: at(22000), kind: 'dispatch', phase: 'submitted', model: 'A', requestId: 'treq-2', dispatchId: 'A:2' },
          { at: at(23000), kind: 'stale_dropped', model: 'A', requestId: 'treq-2', chars: 300 },
          { at: at(39000), kind: 'verified', model: 'A', requestId: 'treq-2', dispatchId: 'A:2', chars: 400, status: 'SUCCESS', reason: 'lifecycle_complete_snapshot', answer: 'Второй ответ модели A, тоже достаточно длинный для проверки.' },
          { at: at(21610), kind: 'start_accepted', waitId: 'wait-2', waitedMs: 1500 },
          { at: at(100000), kind: 'completion_terminal', model: 'A', requestId: 'treq-2', dispatchId: 'A:2', status: 'INTERRUPTED', reason: 'attempt_interrupted' }
        ]
      }
    };
    const text = summarize(write('flow-delivery.json', flow));
    // Data sufficiency: events[] is a subset of the set integrity describes.
    expect(text).toContain('events[].length ≠ integrity.eventsTotal (calc: 10 − 3 = 7); receivedSeq numbers absent inside the events[] range: 2.');
    expect(text).toContain('stored shorter than prepared.chars: 2');
    // The CONTEXT_LOST terminal recorded under the stage-2 request carries the stage-1 dispatchId.
    expect(text).toContain('A:1 (stage-1 / A)');
    expect(text).toContain('completion_terminal · status=CONTEXT_LOST reason=context_invalidated · dispatchId=A:1 [dispatchId started by the stage-1 / A request]');
    // STAGE_FAILED with the stage-2 stageId belongs, by dispatchId, to the stage-1 request.
    expect(text).toContain('events[0] STAGE_FAILED has stageId=stage-2 but joins by dispatchId to the stage-1 / A request');
    expect(text).toContain('stage-1 / A: delivery.diagnosis.sends[0].result=delivered · STAGE_FAILED events[0]');
    // Text of the length of the previous answer after the new submit.
    expect(text).toContain('- stage-2 / A · stale_dropped len=300 delivery.journal[11] t=23.000 · equals stage-1 / A final length (delivery.diagnosis.sends[0].terminal.chars)');
    expect(text).toContain('- stage-2 / A · TEXT_STABLE len=300 events[1] t=23.500 · equals stage-1 / A final length');
    // Start refusals: per-refusal offsets, acceptance, and no invented lock duration.
    expect(text).toContain('first refusal t=20.120 (calc: at − batch.at = 10 ms) · last refusal t=21.110 (calc: 1000 ms) · refusals[].waitedMs as recorded: 10, 1000');
    expect(text).toContain('start accepted: t=21.610 delivery.journal[13] (calc: 1500 ms after batch.at)');
    expect(text).toContain('lock duration: not measured');
    // A record after the run is listed, with the caution.
    expect(text).toContain('60.000 s after runOutcome.completedAt · delivery.journal[14] · A · completion_terminal');
    expect(text).toContain('does not show that generation continued');
    // The stage-1 answer is found in the stage-2 prompt; the last answer has no later prompt.
    expect(text).toContain('found in delivery.journal[7] (A, stage-2:a1)');
    expect(text).toContain('no later prompt');
    // Zero counts in an existing journal are 0, not "no field"; the embedded delivery section follows.
    expect(text).toContain('run_paused=0');
    expect(text).toContain('delivery.diagnosis.moderator=[]');
    expect(text).toContain('#### Batches (delivery.diagnosis.batches[])');
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
