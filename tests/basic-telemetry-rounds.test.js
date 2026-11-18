/** @jest-environment node */
const BasicTelemetry = require('../shared/basic-telemetry.js');
const CustomRunRecord = require('../disput/custom-run-record.js');
const Diagnosis = require('../shared/message-delivery-diagnosis.js');

const EXPORTED_AT = '2026-10-27T10:00:00.000Z';

const build = (customRun, { executionActive = false, events = [], journal = [] } = {}) => BasicTelemetry.buildReport({
  customRun, delivery: { journal }, events, executionActive, extensionVersion: '2.81.904', exportedAt: EXPORTED_AT
});

const attempt = (participant, no, state, extra = {}) => ({
  ref: 'r1', step: 0, visit: 1, participant, model: extra.model || participant, attempt: no, state, ...extra
});

const roundRun = (models, attempts, extra = {}) => ({
  runId: 'run-p', steps: [{ ref: 'r1', kind: 'round', models }], attempts, waits: [], ...extra
});

const participantsOf = (customRun, options) => build(customRun, options).rounds[0].participants;

describe('Basic telemetry: participants of a round', () => {
  test('accepted: some attempt was accepted; the entry comes from the accepted attempt and counts all attempts', () => {
    const [entry] = participantsOf(roundRun([{ id: 'C1', name: 'Claude' }], [
      attempt('C1', 1, 'done', { model: 'Claude', accepted: false, reason: 'empty', status: 'SUCCESS', transportRequestId: 'req-1' }),
      attempt('C1', 2, 'done', { model: 'Claude', accepted: true, reason: '', status: 'SUCCESS', transportRequestId: 'req-2' })
    ]));

    expect(entry).toEqual({ participant: 'C1', model: 'Claude', outcome: 'accepted', reason: null, status: 'SUCCESS', attempts: 2, transportRequestId: 'req-2' });
  });

  test('rejected: it answered (done) but nothing was accepted; reason, status and request come from the latest attempt', () => {
    const [entry] = participantsOf(roundRun([{ id: 'C1', name: 'Claude' }], [
      attempt('C1', 1, 'done', { model: 'Claude', accepted: false, reason: 'empty', status: 'SUCCESS', transportRequestId: 'req-1' }),
      attempt('C1', 2, 'done', { model: 'Claude', accepted: false, reason: 'too_long', status: 'PARTIAL', transportRequestId: 'req-2' })
    ]));

    expect(entry).toEqual({ participant: 'C1', model: 'Claude', outcome: 'rejected', reason: 'too_long', status: 'PARTIAL', attempts: 2, transportRequestId: 'req-2' });
  });

  test('no_answer: the latest attempt is unknown (interrupted in flight), also after an earlier rejected answer', () => {
    const [entry] = participantsOf(roundRun([{ id: 'C1', name: 'Claude' }], [
      attempt('C1', 1, 'done', { model: 'Claude', accepted: false, reason: 'empty', transportRequestId: 'req-1' }),
      attempt('C1', 2, 'unknown', { model: 'Claude', reason: 'interrupted_in_flight', status: 'UNCERTAIN', transportRequestId: 'req-2' })
    ]));

    expect(entry).toEqual({ participant: 'C1', model: 'Claude', outcome: 'no_answer', reason: 'interrupted_in_flight', status: 'UNCERTAIN', attempts: 2, transportRequestId: 'req-2' });
  });

  test('not_sent: the latest attempt was refused before dispatch', () => {
    const [entry] = participantsOf(roundRun([{ id: 'C1', name: 'Claude' }], [
      attempt('C1', 1, 'not_sent', { model: 'Claude', reason: 'context_full' })
    ]));

    expect(entry).toEqual({ participant: 'C1', model: 'Claude', outcome: 'not_sent', reason: 'context_full', status: null, attempts: 1, transportRequestId: null });
  });

  test('in_flight only while the run executes; a sent attempt of a stopped run is no_answer', () => {
    const run = roundRun([{ id: 'C1', name: 'Claude' }], [attempt('C1', 1, 'sent', { model: 'Claude', sentAt: 5 })]);

    expect(participantsOf(run, { executionActive: true })[0]).toMatchObject({ outcome: 'in_flight', attempts: 1 });
    expect(participantsOf(run, { executionActive: false })[0]).toMatchObject({ outcome: 'no_answer', attempts: 1 });
  });

  test('no_attempt: an expected participant without any attempt is listed; a participant outside the schema is appended', () => {
    const participants = participantsOf(roundRun([{ id: 'A', name: 'Claude' }, { id: 'B', name: 'GPT' }], [
      attempt('A', 1, 'done', { model: 'Claude', accepted: true }),
      attempt('X', 1, 'unknown', { model: 'Gemini', reason: 'interrupted_in_flight' })
    ]));

    expect(participants.map((p) => [p.participant, p.model, p.outcome, p.attempts])).toEqual([
      ['A', 'Claude', 'accepted', 1],
      ['B', 'GPT', 'no_attempt', 0],
      ['X', 'Gemini', 'no_answer', 1]
    ]);
    expect(participants[1]).toEqual({ participant: 'B', model: 'GPT', outcome: 'no_attempt', reason: null, status: null, attempts: 0, transportRequestId: null });
  });

  test('the latest attempt is chosen by attempt number, not by position in the list', () => {
    const [entry] = participantsOf(roundRun([{ id: 'C1', name: 'Claude' }], [
      attempt('C1', 2, 'not_sent', { model: 'Claude', reason: 'context_full' }),
      attempt('C1', 1, 'done', { model: 'Claude', accepted: false, reason: 'empty' })
    ]));

    expect(entry).toMatchObject({ outcome: 'not_sent', reason: 'context_full', attempts: 2 });
  });

  test('two participants of the same model are separate entries, also in a real record that keeps only model names per step', () => {
    const steps = [{ ref: 'r1', kind: 'round', models: [{ id: 'C1', name: 'Claude' }, { id: 'C2', name: 'Claude' }] }];
    const record = CustomRunRecord.createRun({ runId: 'run-same-model', steps });
    expect(record.steps[0].models).toEqual(['Claude', 'Claude']);
    CustomRunRecord.setSnapshot(record, { schema: { steps }, state: { pc: 'r1', visits: { r1: 1 }, decisions: {}, results: [] } });
    CustomRunRecord.recordAttempt(record, { step: 0, ref: 'r1', participant: 'C1', model: 'Claude', attempt: 1, visit: 1, state: 'sent', prompt: 'p' });
    CustomRunRecord.recordAttempt(record, { step: 0, ref: 'r1', participant: 'C1', model: 'Claude', attempt: 1, visit: 1, state: 'done', accepted: true, answer: 'a', transportRequestId: 'req-1' });
    CustomRunRecord.recordAttempt(record, { step: 0, ref: 'r1', participant: 'C2', model: 'Claude', attempt: 1, visit: 1, state: 'not_sent', reason: 'context_full' });

    const round = build(CustomRunRecord.exportRun(record)).rounds[0];

    expect(round.expectedParticipants).toEqual(['C1', 'C2']);
    expect(round.participants.map((p) => [p.participant, p.model, p.outcome])).toEqual([
      ['C1', 'Claude', 'accepted'],
      ['C2', 'Claude', 'not_sent']
    ]);
  });

  test('a step known only by model names does not report no_attempt for a participant whose attempts name the same model', () => {
    const participants = participantsOf({ runId: 'run-names', steps: [{ ref: 'r1', kind: 'round', models: ['Claude'] }],
      attempts: [attempt('C1', 1, 'done', { model: 'Claude', accepted: true })], waits: [] });

    expect(participants.map((p) => [p.participant, p.outcome])).toEqual([['C1', 'accepted']]);
  });

  test('participants are listed per visit', () => {
    const run = roundRun([{ id: 'C1', name: 'Claude' }], [
      attempt('C1', 1, 'done', { model: 'Claude', accepted: true }),
      attempt('C1', 1, 'not_sent', { model: 'Claude', visit: 2, reason: 'context_full' })
    ]);

    const rounds = build(run).rounds;

    expect(rounds.map((r) => [r.visit, r.participants[0].outcome])).toEqual([[1, 'accepted'], [2, 'not_sent']]);
  });
});

describe('Basic telemetry: owner (User) steps', () => {
  const ownerRun = (extra = {}) => ({
    runId: 'run-o', steps: [{ ref: 'o1', kind: 'owner', models: [] }], attempts: [], waits: [], ...extra
  });
  const ownerWait = (extra = {}) => ({ waitId: 'w1', kind: 'owner', stepRef: 'o1', visit: 1, startedAt: 1000, endedAt: 2000, outcome: 'answered', ...extra });
  const only = (run, options) => {
    const round = build(run, options).rounds[0];
    expect(round.expectedParticipants).toEqual(['owner']);
    expect(round.participants).toHaveLength(1);
    return round.participants[0];
  };

  test('no owner window recorded: no_attempt', () => {
    expect(only(ownerRun())).toEqual({ participant: 'owner', model: null, outcome: 'no_attempt', reason: null, status: null, attempts: null, transportRequestId: null });
  });

  test('accepted: the snapshot keeps the owner answer of this visit', () => {
    const run = ownerRun({ waits: [ownerWait()], snapshot: { results: [{ stepRef: 'o1', visit: 1, owner: { textRef: 't1', binary: false, file: null } }], current: null } });

    expect(only(run)).toMatchObject({ outcome: 'accepted', reason: null });
  });

  test('accepted: the step-end event of the engine says the owner answer was kept', () => {
    const run = ownerRun({ waits: [ownerWait()] });
    const events = [{ kind: 'custom_step_end', step: 0, ref: 'o1', visit: 1, outcome: 'completed', accepted: 1, endedAt: 3000 }];

    expect(only(run, { events: [{ ...events[0], pipelineRunId: 'run-o' }] })).toMatchObject({ outcome: 'accepted' });
  });

  test('in_flight: the owner window is open while the run executes; no_answer when it is open in a run that is not executing', () => {
    const run = ownerRun({ waits: [ownerWait({ endedAt: null, outcome: null })] });

    expect(only(run, { executionActive: true })).toMatchObject({ outcome: 'in_flight' });
    expect(only(run, { executionActive: false })).toMatchObject({ outcome: 'no_answer', reason: 'unclosed_wait' });
  });

  test('rejected: the last owner answer did not pass the check', () => {
    const run = ownerRun({ waits: [ownerWait()] });
    const events = [{ pipelineRunId: 'run-o', kind: 'custom_owner', step: 0, ref: 'o1', visit: 1, accepted: false, reason: 'empty' }];

    expect(only(run, { events })).toMatchObject({ outcome: 'rejected', reason: 'empty' });
  });

  test('no_answer: the owner was asked and the window closed without an accepted answer', () => {
    const run = ownerRun({ waits: [ownerWait({ outcome: 'stopped' })] });

    expect(only(run)).toMatchObject({ outcome: 'no_answer', reason: 'stopped' });
  });
});

describe('Basic telemetry: unknown is not zero and not a guess', () => {
  const waitRun = (extra = {}) => ({ runId: 'run-w', steps: [{ ref: 'r1', kind: 'round', models: [{ id: 'C1', name: 'Claude' }] }],
    attempts: [attempt('C1', 1, 'done', { model: 'Claude', accepted: true })], ...extra });

  test('a record without waits has unknown user wait time (null, no_wait_records), not 0', () => {
    const round = build(waitRun()).rounds[0];

    expect(round.userWaitDurationMs).toBeNull();
    expect(round.userWaitDurationReason).toBe('no_wait_records');
  });

  test('a record whose waits list exists but has none for the visit has 0 ms without a reason', () => {
    const round = build(waitRun({ waits: [{ waitId: 'w9', kind: 'asks', stepRef: 'r1', visit: 2, startedAt: 1, endedAt: 5 }] })).rounds[0];

    expect(round.userWaitDurationMs).toBe(0);
    expect(round).not.toHaveProperty('userWaitDurationReason');
    expect(build(waitRun({ waits: [] })).rounds[0].userWaitDurationMs).toBe(0);
  });

  test('without a step-start event the start is null: the time an attempt was prepared is not the start of the step', () => {
    const run = waitRun({ attempts: [attempt('C1', 1, 'done', { model: 'Claude', accepted: true, sentAt: 1000 })], waits: [] });
    const events = [{ kind: 'custom_step_end', pipelineRunId: 'run-w', step: 0, ref: 'r1', visit: 1, outcome: 'completed', endedAt: 4000 }];

    const round = build(run, { events }).rounds[0];

    expect(round.startedAt).toBeNull();
    expect(round.endedAt).toBe(4000);
    expect(round.durationMs).toBeNull();
  });

  test('with the step-start event the duration is measured', () => {
    const events = [
      { kind: 'custom_step_start', pipelineRunId: 'run-w', step: 0, ref: 'r1', visit: 1, startedAt: 900 },
      { kind: 'custom_step_end', pipelineRunId: 'run-w', step: 0, ref: 'r1', visit: 1, outcome: 'completed', endedAt: 4000 }
    ];

    expect(build(waitRun({ waits: [] }), { events }).rounds[0]).toMatchObject({ startedAt: 900, endedAt: 4000, durationMs: 3100 });
  });
});

describe('Basic telemetry: records written before the waits were kept', () => {
  const stored = () => {
    const steps = [{ ref: 'r1', kind: 'round', models: [{ id: 'C1', name: 'Claude' }] }];
    const record = CustomRunRecord.createRun({ runId: 'run-old', steps });
    CustomRunRecord.recordAttempt(record, { step: 0, ref: 'r1', participant: 'C1', model: 'Claude', attempt: 1, visit: 1, state: 'sent', prompt: 'p' });
    CustomRunRecord.recordAttempt(record, { step: 0, ref: 'r1', participant: 'C1', model: 'Claude', attempt: 1, visit: 1, state: 'done', accepted: true, answer: 'a' });
    const plain = JSON.parse(JSON.stringify(CustomRunRecord.serialize(record)));
    delete plain.waits; // what an older extension stored
    return plain;
  };

  test('a stored record without waits exports waits: null and the Basic report says the wait time was not recorded', () => {
    const revived = CustomRunRecord.revive(stored());
    const exported = CustomRunRecord.exportRun(revived);

    expect(revived.waits).toBeNull();
    expect(exported.waits).toBeNull();
    expect(build(exported).rounds[0]).toMatchObject({ userWaitDurationMs: null, userWaitDurationReason: 'no_wait_records', waitIds: [] });
  });

  test('a new record exports waits: [] and 0 ms; the stored form round-trips both', () => {
    const fresh = CustomRunRecord.createRun({ runId: 'run-new', steps: [{ ref: 'r1', kind: 'round', models: ['Claude'] }] });
    const roundTrip = (record) => CustomRunRecord.revive(JSON.parse(JSON.stringify(CustomRunRecord.serialize(record))));

    expect(CustomRunRecord.exportRun(fresh).waits).toEqual([]);
    expect(CustomRunRecord.exportRun(roundTrip(fresh)).waits).toEqual([]);
    expect(build(CustomRunRecord.exportRun(roundTrip(fresh))).rounds[0]).toMatchObject({ userWaitDurationMs: 0 });
    expect(CustomRunRecord.exportRun(roundTrip(CustomRunRecord.revive(stored()))).waits).toBeNull();
  });

  test('a resumed old record starts collecting waits', () => {
    const revived = CustomRunRecord.revive(stored());

    CustomRunRecord.recordWaitEnd(revived, { waitId: 'none' });
    CustomRunRecord.finishRun(revived, { stopReason: 'stopped' });
    expect(revived.waits).toBeNull();

    CustomRunRecord.recordWaitStart(revived, { waitId: 'w1', kind: 'decision', stepRef: 'r1', visit: 1, startedAt: 100, endedAt: 400 });
    expect(CustomRunRecord.exportRun(revived).waits).toHaveLength(1);
    expect(build(CustomRunRecord.exportRun(revived)).rounds[0]).toMatchObject({ userWaitDurationMs: 300 });
  });
});

describe('Basic telemetry: delivery diagnosis', () => {
  const RUN = 'run-p';
  const journal = [
    { eventId: 'e1', at: '2026-10-27T09:00:00.000Z', kind: 'prepared', pipelineRunId: RUN, model: 'Claude', token: 'tok-a', requestId: 'req-a', batchId: `${RUN}:r1:g0`, chars: 120, prompt: 'SECRET PROMPT TEXT' },
    { eventId: 'e2', at: '2026-10-27T09:00:01.000Z', kind: 'first_text', pipelineRunId: RUN, model: 'Claude', token: 'tok-a', requestId: 'req-a', chars: 50, ms: 1500 },
    { eventId: 'e3', at: '2026-10-27T09:00:05.000Z', kind: 'verified', pipelineRunId: RUN, model: 'Claude', token: 'tok-a', requestId: 'req-a', chars: 300, ms: 5000, status: 'SUCCESS', completion: 'complete', answer: 'SECRET ANSWER TEXT', answerArtifacts: { raw: { text: 'SECRET ARTIFACT TEXT' } } },
    { eventId: 'e4', at: '2026-10-27T09:00:00.000Z', kind: 'prepared', pipelineRunId: RUN, model: 'GPT', token: 'tok-g', requestId: 'req-g', batchId: `${RUN}:r1:g0`, chars: 120, prompt: 'SECRET PROMPT TEXT' },
    { eventId: 'e5', at: '2026-10-27T09:00:09.000Z', kind: 'no_answer', pipelineRunId: RUN, model: 'GPT', token: 'tok-g', requestId: 'req-g', chars: 0, ms: 9000, status: 'FAILED', completion: 'failed' },
    { eventId: 'e6', at: '2026-10-27T09:00:09.000Z', kind: 'prepared', pipelineRunId: 'run-other', model: 'GPT', token: 'tok-x', requestId: 'req-x', chars: 1, prompt: 'FOREIGN' }
  ];
  const run = () => roundRun([{ id: 'C1', name: 'Claude' }, { id: 'G1', name: 'GPT' }], [
    attempt('C1', 1, 'done', { model: 'Claude', accepted: true, transportRequestId: 'req-a' }),
    attempt('G1', 1, 'unknown', { model: 'GPT', reason: 'interrupted_in_flight', transportRequestId: 'req-g' })
  ]);

  test('is computed over the run journal, without any text, and points at the journal entries', () => {
    const report = build(run(), { journal });
    const { diagnosis } = report.delivery;

    expect(report.delivery.journal.map((e) => e.eventId)).toEqual(['e1', 'e2', 'e3', 'e4', 'e5']);
    expect(Object.keys(diagnosis)).toEqual(['sends', 'problems']);
    expect(diagnosis.sends.map((s) => [s.model, s.requestId, s.batchId, s.result])).toEqual([
      ['Claude', 'req-a', `${RUN}:r1:g0`, 'delivered'],
      ['GPT', 'req-g', `${RUN}:r1:g0`, 'no_tab']
    ]);
    const claude = diagnosis.sends[0];
    expect(claude).toMatchObject({ chars: 120, firstTextMs: 1500, firstTextChars: 50 });
    expect(claude.terminal).toMatchObject({ journalPath: 'delivery.journal[2]', kind: 'verified', chars: 300, ms: 5000, status: 'SUCCESS' });
    expect(diagnosis.problems).toEqual([expect.objectContaining({ code: 'no_tab', severity: 'critical', model: 'GPT', batchId: `${RUN}:r1:g0`, title: expect.any(String), detail: expect.any(String), hint: expect.any(String) })]);
    expect(JSON.stringify(diagnosis)).not.toMatch(/SECRET|FOREIGN|"prompt"|"answer"|"html"|"text"/);
  });

  test('is judged at the export time and uses the extension version for the stale-background check', () => {
    const withBg = [...journal, { eventId: 'e7', at: '2026-10-27T09:00:02.000Z', kind: 'dispatch', pipelineRunId: RUN, model: 'Claude', requestId: 'req-a', phase: 'submitted', dispatchId: 'd1', ms: 800, bg: '2.81.900' }];

    const { problems } = build(run(), { journal: withBg }).delivery.diagnosis;

    expect(problems.find((p) => p.code === 'stale_background')).toMatchObject({ severity: 'critical', reason: expect.stringContaining('2.81.904') });
  });

  test('is an empty verdict for an empty journal and null when the module is not loaded', () => {
    expect(build(run()).delivery.diagnosis).toEqual({ sends: [], problems: [] });

    const loaded = globalThis.MessageDeliveryDiagnosis;
    delete globalThis.MessageDeliveryDiagnosis;
    try {
      const report = build(run(), { journal });
      expect(report.delivery.diagnosis).toBeNull();
      expect(report.delivery.journal).toHaveLength(5);
    } finally {
      globalThis.MessageDeliveryDiagnosis = loaded;
    }
    expect(Diagnosis).toBe(loaded);
  });

  test('a failing diagnosis does not fail the export: null with the error named', () => {
    const loaded = globalThis.MessageDeliveryDiagnosis;
    globalThis.MessageDeliveryDiagnosis = { diagnose: () => { throw new Error('boom'); } };
    try {
      const { delivery } = build(run(), { journal });
      expect(delivery.diagnosis).toBeNull();
      expect(delivery.diagnosisError).toBe('boom');
    } finally {
      globalThis.MessageDeliveryDiagnosis = loaded;
    }
  });

  test('the format is basic-telemetry/3', () => {
    expect(build(run()).format).toBe('basic-telemetry/3');
  });
});

describe('Basic telemetry: usage', () => {
  // Two rounds with the same model and a User step between them: the sums must count the rounds only.
  const usageRun = (attempts, extra = {}) => ({
    runId: 'run-u',
    startedAt: 1000,
    finishedAt: 5000,
    steps: [
      { ref: 'r1', kind: 'round', models: [{ id: 'C1', name: 'Claude' }, { id: 'G1', name: 'GPT' }] },
      { ref: 'o1', kind: 'owner', models: [] },
      { ref: 'r2', kind: 'round', models: [{ id: 'C1', name: 'Claude' }] }
    ],
    attempts,
    waits: [{ waitId: 'w1', kind: 'owner', stepRef: 'o1', visit: 1, startedAt: 1000, endedAt: 2000, outcome: 'answered' }],
    ...extra
  });
  const usageOf = (run, options) => {
    const report = build(run, options);
    return { report, usage: report.usage };
  };
  const roundOne = [
    attempt('C1', 1, 'done', { model: 'Claude', accepted: false, prompt: 'p1', answer: 'a1' }),
    attempt('C1', 2, 'done', { model: 'Claude', accepted: true, sentPrompt: 'p2', answer: 'answer' }),
    attempt('G1', 1, 'done', { model: 'GPT', accepted: false, prompt: 'pg', answer: 'x' })
  ];
  const roundTwo = [attempt('C1', 1, 'done', { ref: 'r2', step: 2, model: 'Claude', accepted: true, prompt: 'q', answer: 'yes' })];

  test('two rounds and a User step: the sums count model requests, attempts and participants of the rounds only', () => {
    const { usage } = usageOf(usageRun([...roundOne, ...roundTwo]));

    expect(usage.requestsSent).toBe(4);
    expect(usage.attempts).toBe(4);
    expect(usage.participantsExpected).toBe(3);
    expect(usage.participantsAccepted).toBe(2);
    expect(usage.participantsWithoutAnswer).toBe(1);
  });

  test('a not_sent attempt is not a request sent: it is out of requestsSent and promptChars, its answer is not counted', () => {
    const run = usageRun([
      attempt('C1', 1, 'done', { ref: 'r2', step: 2, model: 'Claude', accepted: true, prompt: 'abcd', answer: 'xy' }),
      attempt('C1', 2, 'not_sent', { ref: 'r2', step: 2, model: 'Claude', prompt: '0123456789' })
    ]);
    const { usage } = usageOf(run);

    expect(usage.requestsSent).toBe(1);
    expect(usage.promptChars).toBe(4);
    expect(usage.answerChars).toBe(2);
  });

  test('requestsUpperBound counts every attempt that may have been sent: not_sent and cancelled before dispatch are out, requestsSent keeps its meaning', () => {
    const run = usageRun([
      attempt('C1', 1, 'done', { ref: 'r2', step: 2, model: 'Claude', accepted: true, prompt: 'a', answer: 'x' }),
      attempt('C1', 2, 'dispatch_created', { ref: 'r2', step: 2, model: 'Claude' }),
      attempt('G1', 1, 'armed', { ref: 'r2', step: 2, model: 'GPT' }),
      attempt('G1', 2, 'failed', { ref: 'r2', step: 2, model: 'GPT' }),
      attempt('G1', 3, 'cancelled', { ref: 'r2', step: 2, model: 'GPT' }),
      attempt('G1', 4, 'cancelled', { ref: 'r2', step: 2, model: 'GPT', reason: 'cancelled_before_dispatch' }),
      attempt('G1', 5, 'not_sent', { ref: 'r2', step: 2, model: 'GPT' })
    ]);
    const { usage } = usageOf(run);

    expect(usage.requestsSent).toBe(1);
    expect(usage.requestsUpperBound).toBe(5);
  });

  test('requestsUpperBound is never below requestsSent', () => {
    const { usage } = usageOf(usageRun([...roundOne, ...roundTwo]));

    expect(usage.requestsUpperBound).toBeGreaterThanOrEqual(usage.requestsSent);
  });

  test('the User step is not in requestsSent, but its wait is in ownerWaitMs', () => {
    const run = { runId: 'run-o', steps: [{ ref: 'o1', kind: 'owner', models: [] }], attempts: [], waits: usageRun([]).waits };
    const { usage } = usageOf(run);

    expect(usage.requestsSent).toBe(0);
    expect(usage.ownerWaitMs).toBe(1000);
    expect(usage.ownerWaitUnknown).toBe(false);
  });

  test('a record without waits gives ownerWaitUnknown: true', () => {
    const run = { runId: 'run-old', steps: [{ ref: 'r1', kind: 'round', models: [{ id: 'C1', name: 'Claude' }] }], attempts: [attempt('C1', 1, 'done', { accepted: true })] };
    const { usage } = usageOf(run);

    expect(usage.ownerWaitUnknown).toBe(true);
  });

  test('an unfinished run gives durationMs: null', () => {
    expect(BasicTelemetry.buildUsage({ customRun: { startedAt: 1000, finishedAt: null, attempts: [] }, rounds: [] }).durationMs).toBeNull();
    expect(BasicTelemetry.buildUsage({ customRun: { startedAt: 1000, finishedAt: 4000, attempts: [] }, rounds: [] }).durationMs).toBe(3000);
  });

  test('byModel counts requests and accepted answers per model name', () => {
    const { usage } = usageOf(usageRun([...roundOne, ...roundTwo]));

    expect(usage.byModel).toEqual({
      Claude: { requestsSent: 3, accepted: 2 },
      GPT: { requestsSent: 1, accepted: 0 }
    });
  });

  test('buildReport returns usage next to rounds and keeps the format basic-telemetry/3', () => {
    const report = build(usageRun([...roundOne, ...roundTwo]));

    expect(report.usage).toMatchObject({ requestsSent: 4, attempts: 4 });
    expect(report.format).toBe('basic-telemetry/3');
  });
});
