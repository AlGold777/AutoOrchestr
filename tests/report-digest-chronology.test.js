// Transport extract 3.7.0: time axis without the first stage start, per-request chronology of deviations,
// explicit empty sections, and the removal of repeated or unreadable cells.
const Digest = require('../shared/report-digest');

const T = 1700000000000;
const iso = (ms) => new Date(T + ms).toISOString();
const event = (at, eventType, { model = 'A', requestId = 'q1', dispatchId = 'd1', stageId = 's1', payload = {}, reasonCode = '' } = {}) => ({
  eventType, sourceTimestamp: T + at, reasonCode,
  correlation: { stageId, requestId, dispatchId },
  payload: { model, ...payload }
});
const report = (extra = {}) => ({
  metadata: { debateRunId: 'run' }, runOutcome: {},
  stageExecutions: [{ stageId: 's1', status: 'success', actual: { startedAt: T, completedAt: T + 9000, participants: ['A'] }, durationMs: 9000 }],
  events: [], delivery: { journal: [], diagnosis: { batches: [] } }, ...extra
});
const section = (md, from, to) => md.split(from)[1].split(to)[0];

test('without the first stage start the time axis falls back to a labelled record instead of printing dashes', () => {
  const d = report();
  d.stageExecutions[0].actual.startedAt = null;
  d.stageExecutions[0].durationMs = null;
  d.delivery.diagnosis.batches = [{ at: iso(100), models: ['A'], durationMs: 5000, stageAttemptId: 's1:a1' }];
  d.events = [event(1500, 'TEXT_STABLE', { payload: { evidence: { textLength: 10 } } })];
  const x = Digest.extractTransport(d);
  const md = Digest.renderTransportMarkdown(x);
  expect(x.base).toMatchObject({ path: 'delivery.diagnosis.batches[0].at', fallback: true, primary: { path: 'stageExecutions[0].actual.startedAt', state: 'null' } });
  expect(x.requests[0].times.firstStable.t).toBe(1.4);
  expect(md).toContain('fallback: stageExecutions[0].actual.startedAt is null');
  expect(md).toContain('— in time columns means no usable time field (never zero)');
});

test('stage table prints field values, never [object Object], and marks LONG as unknown without durationMs', () => {
  const d = report();
  d.stageExecutions = [
    { stageId: 's1', status: 'success', durationMs: null, actual: { startedAt: T, completedAt: T + 1000, participants: ['A'] } },
    { stageId: 's2', status: 'failed', durationMs: 130000, actual: { startedAt: T + 1100, completedAt: T + 131100, participants: ['A'] } }
  ];
  const md = Digest.renderTransportMarkdown(Digest.extractTransport(d));
  const stages = section(md, '### 2. Stages', '### 3.');
  expect(md).not.toContain('[object Object]');
  expect(stages).toContain('| null / 0.100 | success/n/a (no durationMs) |');
  expect(stages).toContain('| 130000 / — | failed/true |');
});

test('chronology lists deviations in time order, shares a line within 50 ms, and keeps routine and background records out', () => {
  const d = report();
  d.events = [
    event(1000, 'TEXT_STABLE', { payload: { evidence: { textLength: 100 } } }),
    event(2000, 'STAGE_FAILED', { reasonCode: 'PIPELINE_ERROR' }),
    event(2030, 'MANUAL_RECOVERY_REQUESTED', { payload: { details: 'UI button' } }),
    event(4000, 'LEGACY_DIAGNOSTIC_EVENT', { payload: { originalLabel: 'PING_TRANSPORT_ERROR', details: 'port closed' } }),
    event(4100, 'LEGACY_DIAGNOSTIC_EVENT', { payload: { originalLabel: 'PING_TRANSPORT_ERROR', details: 'port closed' } }),
    event(5000, 'CORRELATION_REJECTED', { reasonCode: 'dispatch_mismatch' }),
    event(1000, 'TEXT_STABLE', { model: 'B', requestId: 'q2', dispatchId: 'd2', payload: { evidence: { textLength: 50 } } })
  ];
  d.stageExecutions[0].actual.participants = ['A', 'B'];
  const md = Digest.renderTransportMarkdown(Digest.extractTransport(d));
  const chronology = section(md, '### 6. Request chronology (deviations)', '### 7.');
  expect(chronology).toContain('Q1 stage-1/A');
  expect(chronology).toMatch(/2\.000 · STAGE_FAILED\/PIPELINE_ERROR E\[1\] · MANUAL_RECOVERY_REQUESTED E\[2\]/);
  expect(chronology).toContain('CORRELATION_REJECTED');
  expect(chronology).not.toContain('TEXT_STABLE');
  expect(chronology).not.toContain('PING_TRANSPORT_ERROR');
  expect(chronology).toContain('No deviation transitions: Q2.');
  // The same labels are counted once, in the background table.
  expect(section(md, '### Background counters', '### Collection coverage')).toContain('PING_TRANSPORT_ERROR | 2 |');
});

test('zero-length stable text and a foreign dispatch stay visible in the chronology', () => {
  const d = report();
  d.events = [
    event(1000, 'STAGE_FAILED', { reasonCode: 'PIPELINE_ERROR' }),
    event(3000, 'TEXT_STABLE', { payload: { evidence: { textLength: 0 } } })
  ];
  const md = Digest.renderTransportMarkdown(Digest.extractTransport(d));
  expect(section(md, '### 6. Request chronology (deviations)', '### 7.')).toContain('TEXT_STABLE len=0');
});

test('consecutive equal single terminal decisions are one row with every path and the length series', () => {
  const d = report();
  d.events = [100, 110, 120, 130, 140].map((length, i) => event(1000 + i * 100, 'MODEL_TERMINAL_COMMITTED', {
    payload: { originalLabel: 'FINALIZATION_DECISION', answerLength: length,
      evidence: { finalStatus: 'SUCCESS', completionReason: 'stable_pending_auto_finalization', doneReason: 'success' } }
  }));
  const md = Digest.renderTransportMarkdown(Digest.extractTransport(d));
  const terminals = section(md, '### 5. Terminal decisions', '### 6.');
  expect(terminals).toContain('Q1.T1-T5/Q1.D1');
  expect(terminals).toContain('E[0],E[1],E[2],E[3],E[4] FINALIZATION_DECISION: AL 100→110→120→130→140');
  expect(terminals).toContain('SUCCESS/stable_pending_auto_finalization/×5');
});

test('manual records of one stage and model within one second are one action; every path stays', () => {
  const d = report();
  d.events = [
    event(1000, 'MANUAL_RECOVERY_REQUESTED', { payload: { details: 'UI button' } }),
    event(1003, 'MANUAL_RECOVERY_REQUESTED', { payload: { details: 'Skipping content-script getResponses' } }),
    event(6000, 'MANUAL_RECOVERY_REQUESTED', { payload: { details: 'UI button' } })
  ];
  const manual = section(Digest.renderTransportMarkdown(Digest.extractTransport(d)), '### 8. Manual actions', '### 9.');
  expect(manual).toContain('MANUAL_RECOVERY_REQUESTED=3; UI=2;');
  expect(manual).toContain('actions (records of one stage/model within 1 s grouped)=2');
  expect(manual).toContain('E[0] +E[1] | stage-1/A | UI button \\| Skipping content-script getResponses');
  expect(manual).toContain('E[2] | stage-1/A | UI button');
});

test('empty sections state the zero explicitly', () => {
  const md = Digest.renderTransportMarkdown(Digest.extractTransport(report()));
  expect(section(md, '### 9. Start refusals', '### 10.')).toContain('0 refusals in delivery.diagnosis.batches[].refusals.');
  expect(section(md, '### 8. Manual actions', '### 9.')).toContain('Moderator, pause, get-it and owner actions: 0 records.');
  expect(section(md, '### 11. Run window', '### 12.')).toContain('0 records outside the run window.');
  expect(section(md, '### 12. Prompt checks', '### 13.')).toContain('0 delivered answers with at least 40 normalized characters.');
  const withoutDelivery = report();
  delete withoutDelivery.delivery;
  expect(section(Digest.renderTransportMarkdown(Digest.extractTransport(withoutDelivery)), '### 9. Start refusals', '### 10.')).toContain('no field delivery.');
});

test('focus problem rows are folded with their paths; a problem without a reason is not printed as undefined', () => {
  const d = report();
  d.delivery.diagnosis.problems = [
    { code: 'focus_moves', severity: 'info', model: 'A', count: 6, reason: '6 switches' },
    { code: 'stale', severity: 'info', model: 'A', count: 1 }
  ];
  const md = Digest.renderTransportMarkdown(Digest.extractTransport(d));
  const delivery = section(md, '### 15. Delivery batches and problems', '### Background counters');
  expect(delivery).toContain('Focus problem rows folded (same facts as section 10): 1 (focus_moves:1)');
  expect(delivery).toContain('delivery.diagnosis.problems[0]');
  expect(delivery).toContain('stale/info/A');
  expect(md).not.toContain('undefined');
});
