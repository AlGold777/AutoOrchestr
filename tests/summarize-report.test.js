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

const Digest = require('../shared/report-digest');

describe('Disput Flow extract v2', () => {
  const T = 1790980000000;
  const at = (n) => new Date(T + n).toISOString();
  const event = (type, n, extra = {}) => ({ eventType: type, sourceTimestamp: T + n,
    correlation: { stageId: 's1', dispatchId: 'A:1', pipelineRoundId: 'r1', tabId: '123', correlationQuality: 'exact', ...extra.correlation },
    provenance: 'legacy_adapter', reasonCode: extra.reasonCode || '', payload: { model: 'A', originalLabel: type, ...extra.payload } });
  const flow = () => ({ metadata: { debateRunId: 'run', dataCompleteness: 'incomplete' },
    runOutcome: { startedAt: T, completedAt: T + 10000 }, health: { manualRecoveryCount: 0, forcedCompletionCount: 0 },
    stageExecutions: [{ stageId: 's1', durationMs: 10000, status: 'success', actual: { startedAt: T, completedAt: T + 10000, participants: ['A'] } }],
    events: [], diagnoses: [], dispatchAttempts: [], integrity: {}, delivery: { diagnosis: { sends: [], batches: [], problems: [] }, journal: [
      { kind: 'batch_start', at: at(0), batchId: 's1:a1', stageId: 's1', models: ['A'], requestIds: { A: 'q1' } },
      { kind: 'prepared', at: at(1), batchId: 's1:a1', model: 'A', requestId: 'q1', token: 'AO-aaaaaa', prompt: 'p', chars: 1 },
      { kind: 'tab', at: at(2), model: 'A', requestId: 'q1', tabId: 123 },
      { kind: 'dispatch', phase: 'dispatch_started', at: at(100), model: 'A', requestId: 'q1', dispatchId: 'A:1' },
      { kind: 'dispatch', phase: 'submitted', at: at(200), model: 'A', requestId: 'q1', dispatchId: 'A:1' },
      { kind: 'focus', at: at(250), model: 'A', requestId: 'q1', source: 'automation_visit_activate' },
      { kind: 'first_text', at: at(300), model: 'A', requestId: 'q1', chars: 100 },
      { kind: 'verified', at: at(9000), model: 'A', requestId: 'q1', dispatchId: 'A:1', status: 'SUCCESS', chars: 100 }
    ] } });

  test('JSON is structured; Markdown uses the same facts and all requests, including a clean request', () => {
    const d = flow(), before = JSON.stringify(d), x = Digest.extractTransport(d, 'source.json');
    expect(x.DIGEST_VERSION).toBe('3.2.0');
    expect(x).not.toHaveProperty('digest');
    expect(x.requests).toHaveLength(1);
    expect(x.requests[0].identity.tabIds).toEqual(['123']);
    expect(x.stageTimeline[0].rows.map((r) => r.type)).toEqual(['tab', 'dispatch', 'dispatch', 'focus']);
    expect(x.requests[0].transitions.some((r) => ['focus', 'tab', 'dispatch'].includes(r.first.type))).toBe(false);
    expect(x.requests[0].coverage.omittedRecords).toBe(0);
    expect(JSON.stringify(d)).toBe(before);
    const text = Digest.renderTransportMarkdown(x);
    expect(text).toContain('DIGEST_VERSION=3.2.0');
    expect(text).toContain('Q1: stage-1/A');
    expect(text).toContain('### 15. Delivery batches');
    expect(text).not.toContain('### 16.');
    expect(summarize(write('flow.json', d))).toBe(Digest.renderTransportMarkdown(Digest.extractTransport(d)));
  });

  test('zero text and every return/change in length, dispatch, reason or status survive grouping', () => {
    const d = flow();
    d.events = [
      event('TEXT_STABLE', 1000, { payload: { evidence: { textLength: 100 } } }),
      event('TEXT_STABLE', 1100, { payload: { evidence: { textLength: 100 } } }),
      event('TEXT_STABLE', 1200, { payload: { evidence: { textLength: 0 } } }),
      event('TEXT_STABLE', 1300, { payload: { evidence: { textLength: 100 } } }),
      event('TEXT_STABLE', 1400, { correlation: { dispatchId: 'A:2' }, payload: { transportRequestId: 'q1', evidence: { textLength: 100 } } }),
      event('TEXT_STABLE', 1500, { payload: { evidence: { textLength: 100 }, status: 'FAILED' } }),
      event('TEXT_STABLE', 1600, { payload: { evidence: { textLength: 100 }, status: 'FAILED' }, reasonCode: 'new_reason' })
    ];
    const a = Digest.extractTransport(d).requests[0];
    const stable = a.transitions.filter((r) => r.first.type === 'TEXT_STABLE');
    expect(stable.map((r) => r.first.path)).toEqual(['events[0]', 'events[2]', 'events[3]', 'events[4]', 'events[5]', 'events[6]']);
    expect(stable[0].paths).toEqual(['events[0]', 'events[1]']);
    expect(stable[1].first.textLength).toBe(0);
    expect(a.coverage.representedRecords + a.coverage.sharedStageRecords).toBe(a.coverage.totalRecords);
  });

  test('terminal pairs preserve both labels, both length fields and registered evidence, without conflating null and missing', () => {
    const d = flow();
    d.events = [
      event('MODEL_TERMINAL_COMMITTED', 8000, { payload: { originalLabel: 'FINALIZATION_DECISION', answerLength: 100,
        evidence: { finalStatus: 'SUCCESS', completionReason: 'lifecycle_complete_snapshot', answerLength: 100 } } }),
      event('MODEL_TERMINAL_COMMITTED', 8007, { payload: { originalLabel: 'MODEL_FINAL', answerLength: null,
        evidence: { finalStatus: 'SUCCESS', completionReason: 'lifecycle_complete_snapshot', answerLen: 100,
          foregroundMsUsed: 400, focusSwitchesUsed: 0, doneReason: 'success', durationMs: 8007 } } })
    ];
    const x = Digest.extractTransport(d), g = x.requests[0].terminalGroups[0];
    expect(x.counters.terminal).toEqual({ records: 2, groups: 1, uniqueRequests: 1 });
    expect(g.intervalMs).toBe(7);
    expect(g.members.map((m) => m.path)).toEqual(['events[0]', 'events[1]']);
    expect(g.members[0].evidenceAnswerLen.state).toBe('missing');
    expect(g.members[1].answerLength).toMatchObject({ state: 'present', value: null });
    expect(g.members[1].registered.focusSwitchesUsed.value).toBe(0);
    expect(Digest.renderTransportMarkdown(x)).toContain('null / 100 / no field');
    d.events[1].payload.evidence.answerLen = 101;
    expect(Digest.extractTransport(d).requests[0].terminalGroups).toHaveLength(2);
  });

  test('request summary includes paths, accepted=false, first stable/completion, UI counts and quality separately', () => {
    const d = flow();
    d.events = [
      event('TEXT_STABLE', 1000, { payload: { evidence: { textLength: 100 } } }),
      event('COMPLETION_DETECTED', 2000),
      event('ANSWER_COLLECTED', 9001, { payload: { accepted: false, pipelineBatchId: null, answerLength: 100 } }),
      event('DUPLICATE_FINAL_REJECTED', 9100),
      event('LEGACY_DIAGNOSTIC_EVENT', 9200, { payload: { originalLabel: 'ANSWER_CARD_RENDER_EVALUATED', details: 'wrong_card' } }),
      event('MANUAL_RECOVERY_REQUESTED', 9300, { correlation: { correlationQuality: 'inferred', pipelineRoundId: undefined }, payload: { details: 'UI button' } })
    ];
    d.delivery.journal.push({ kind: 'displayed', at: at(9400), model: 'A', requestId: 'q1' });
    const x = Digest.extractTransport(d), a = x.requests[0];
    expect(a.times.firstStable).toMatchObject({ path: 'events[0]', t: 1, stageSeconds: 1, submitSeconds: 0.8 });
    expect(a.times.firstCompletionDetected.path).toBe('events[1]');
    expect(a.collected[0].accepted.value).toBe(false);
    expect(a.collected[0].pipelineBatchId.value).toBeNull();
    expect(a.counts).toMatchObject({ wrongCard: 1, displayed: 1, duplicateFinalRejected: 1, manualRecords: 1, uiButtonRecords: 1 });
    expect(x.quality.correlationQuality).toEqual({ exact: 5, inferred: 1 });
    expect(x.quality.provenance).toEqual({ legacy_adapter: 6 });
    expect(x.quality.eventsWithoutRound.paths).toEqual(['events[5]']);
    expect(a.identity.pipelineRoundIds).toEqual(['r1']);
  });

  test('foreign dispatch does not move previous events to a later request; background retains all paths beyond the old cap', () => {
    const d = flow();
    d.stageExecutions.push({ stageId: 's2', durationMs: 10000, status: 'success', actual: { startedAt: T + 10000, completedAt: T + 20000, participants: ['A'] } });
    d.delivery.journal.push(
      { kind: 'batch_start', at: at(10000), stageId: 's2', batchId: 's2:a1', models: ['A'], requestIds: { A: 'q2' } },
      { kind: 'completion_terminal', at: at(10100), requestId: 'q2', model: 'A', dispatchId: 'A:1', status: 'CONTEXT_LOST' },
      { kind: 'dispatch', phase: 'dispatch_started', at: at(10200), requestId: 'q2', model: 'A', dispatchId: 'A:2' }
    );
    d.events = Array.from({ length: 170 }, (_, i) => event('TEXT_STABLE', 1000 + i, { payload: { evidence: { textLength: i } } }));
    d.events.push(event('STAGE_FAILED', 10150, { correlation: { stageId: 's2' } }));
    const x = Digest.extractTransport(d);
    expect(x.requests[1].identity.foreignDispatchIds[0].ownerRequestId).toBe('q1');
    expect(x.requests[0].transitions.filter((r) => r.first.type === 'TEXT_STABLE')).toHaveLength(170);
    expect(x.requests[0].transitions.find((r) => r.first.type === 'STAGE_FAILED').first.flags).toContain('record stageId=s2');
    expect(x.requests.every((r) => r.coverage.omittedRecords === 0)).toBe(true);
  });

  test('stage timeline interleaves both models; per-request transitions do not repeat shared records', () => {
    const d = flow();
    d.delivery.journal[0].models.push('B');
    d.delivery.journal[0].requestIds.B = 'qB';
    d.delivery.journal.push(
      { kind: 'dispatch', phase: 'dispatch_started', at: at(150), model: 'B', requestId: 'qB', dispatchId: 'B:1' },
      { kind: 'dispatch', phase: 'submitted', at: at(220), model: 'B', requestId: 'qB', dispatchId: 'B:1' }
    );
    const x = Digest.extractTransport(d);
    const row = x.stageTimeline[0].rows.filter((r) => r.type === 'dispatch');
    expect(row.map((r) => r.model)).toEqual(['A', 'B', 'A', 'B']);
    expect(x.requests).toHaveLength(2);
    expect(x.requests.flatMap((a) => a.transitions).some((r) => r.first.type === 'dispatch')).toBe(false);
  });

  test('prompt match means a stored fragment only; same-name comparisons and true median use explicit units', () => {
    const d = flow(), answer = 'A long answer with more than fifty characters for checking the stored prompt fragment.';
    d.delivery.journal[7].answer = answer;
    d.delivery.journal.push({ kind: 'prepared', at: at(10000), prompt: answer, chars: 1000 });
    d.stageExecutions.push({ stageId: 's2', durationMs: 20000, actual: { startedAt: T + 11000, completedAt: T + 31000 }, status: 'success' });
    d.integrity.eventsTotal = 10;
    const x = Digest.extractTransport(d);
    expect(x.promptChecks[0]).toMatchObject({ result: 'stored_fragment_found', submissionProven: false, fullAnswerInclusionProven: false });
    expect(x.promptChecks[0].laterPrompts[0].found).toBe(true);
    expect(x.calculations.medianDurationMs).toBe(15000);
    expect(x.comparisons.map((r) => r.name)).toEqual(['eventsTotal']);
    expect(x.counters.forced).toEqual({ events: 0, terminalRecords: 0, uniqueRequests: 0 });
    expect(Digest.renderTransportMarkdown(x)).not.toContain('confirms it was sent');
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

test('trace-only requests retain distinct canonical identities and ambiguous stage-only evidence stays unassigned', () => {
  const d={metadata:{debateRunId:'r'},stageExecutions:[{stageId:'s',actual:{startedAt:0,participants:['M']}}],events:[
    {eventType:'TEXT_STABLE',sourceTimestamp:1,correlation:{stageId:'s',transportRequestId:'q1',dispatchId:'d1'},payload:{model:'M',answerLength:5}},
    {eventType:'TEXT_STABLE',sourceTimestamp:2,correlation:{stageId:'s',transportRequestId:'q2',dispatchId:'d2'},payload:{model:'M',answerLength:6}},
    {eventType:'TEXT_STABLE',sourceTimestamp:3,correlation:{stageId:'s'},payload:{model:'M',answerLength:7}}
  ]};
  const x=Digest.extractTransport(d);
  expect(x.requests.map(a=>a.requestId)).toEqual(['q1','q2']);
  expect(x.availability.unassigned.map(r=>r.path)).toEqual(['events[2]']);
});

test('compressed source registry can reconstruct every event and journal member without interleaving fragmentation', () => {
  const t=1700000000000, event=(model,i,length)=>({eventType:'TEXT_STABLE',sourceTimestamp:t+i,correlation:{stageId:'s',requestId:`q${model}`,dispatchId:`d${model}`},payload:{model,answerLength:length}});
  const events=Array.from({length:50},(_,i)=>event(i%2?'B':'A',i,i<30?10:20));
  const d={metadata:{debateRunId:'r'},runOutcome:{startedAt:t,completedAt:t+10},stageExecutions:[{stageId:'s',actual:{startedAt:t,participants:['A','B']}}],events};
  const x=Digest.extractTransport(d), text=Digest.renderTransportMarkdown(x);
  expect(x.requests.every(a=>a.transitions.length===2)).toBe(true);
  const refs=new Set();
  for (const m of text.matchAll(/\bE\[([\d,./]+)\]/g)) for(const part of m[1].split(',')) {
    const r=/^(\d+)\.\.(\d+)(?:\/(\d+))?$/.exec(part);
    if(r)for(let i=+r[1];i<=+r[2];i+=+(r[3]||1))refs.add(i);else refs.add(+part);
  }
  expect([...refs].filter(i=>i<events.length).sort((a,b)=>a-b)).toEqual(events.map((_,i)=>i));
  expect(text).not.toContain('Full parameters in JSON');
  expect(text).not.toContain('JSON quality');
});
