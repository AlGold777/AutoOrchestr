const fs = require('fs');
const path = require('path');
const Engine = require('../disput/custom-engine');
const Record = require('../disput/custom-run-record');

const clone = (val) => JSON.parse(JSON.stringify(val));

describe('B02: Individual wave results preservation (ТЗ 7, 8.2)', () => {
  const STEP_WITH_TWO_PARTICIPANTS = [
    {
      ref: 'S1',
      kind: 'round',
      input: 'none',
      models: [
        { id: 'A', name: 'Model1' },
        { id: 'B', name: 'Model1' }
      ],
      output: {
        artifacts: [{ id: 'art1', name: 'Artifact 1', pointer: '' }]
      }
    }
  ];

  test('B02 (a, b): accepted wave 1 participant is committed to checkpoint before wave 2, and wave 2 cancellation marks participant not_sent without losing A', async () => {
    const record = Record.createRun({ runId: 'run-b02', pipelineName: 'P', task: 'Task', steps: STEP_WITH_TWO_PARTICIPANTS });
    const controller = new AbortController();
    const checkpoints = [];

    let waveMeta = null;

    const runResult = await Engine.run({
      task: 'Task',
      steps: STEP_WITH_TWO_PARTICIPANTS,
      signal: controller.signal,
      onRequest: (entry) => Record.recordAttempt(record, entry),
      onResponse: (entry) => Record.recordAttempt(record, entry),
      putText: (v) => record.put(v),
      getText: (ref) => record.texts[ref],
      checkpoint: async (state) => {
        checkpoints.push(clone(state));
        Record.setArtifacts(record, state.artifacts);
        Record.setSnapshot(record, { schema: STEP_WITH_TWO_PARTICIPANTS, state });
      },
      sendParticipants: async (requests, meta) => {
        waveMeta = meta;

        // Wave 1 execution for participant A
        const reqA = requests.find((r) => r.participantId === 'A');
        expect(reqA).toBeDefined();

        if (typeof meta?.onWaveResult === 'function') {
          await meta.onWaveResult({
            byParticipant: {
              A: { text: 'Answer of A', status: 'SUCCESS', transportRequestId: 'req-A-1' }
            }
          });
        }

        // Wave 2 is cancelled before/during dispatch (e.g. Stop / AbortError)
        controller.abort();
        const abortErr = new Error('The operation was aborted');
        abortErr.name = 'AbortError';
        throw abortErr;
      }
    });

    expect(runResult.stopReason).toBe('cancelled');

    // Engine must provide onWaveResult callback in meta to allow incremental wave commits
    expect(typeof waveMeta?.onWaveResult).toBe('function');

    // a) Participant A must be accepted and committed to checkpoint before wave B started
    const wave1Checkpoint = checkpoints.find((cp) => cp.current?.stepRef === 'S1' && cp.current?.accepted?.includes('A'));
    expect(wave1Checkpoint).toBeDefined();

    // In record snapshot: participant A is accepted, artifact is registered
    expect(record.snapshot.current.accepted).toContain('A');
    const artifactA = record.artifacts.find((art) => art.id === 'art1' && art.source?.participant === 'A');
    expect(artifactA).toBeDefined();

    // Attempt A in record must be 'done' and accepted
    const attemptA = record.attempts.find((a) => a.participant === 'A');
    expect(attemptA).toBeDefined();
    expect(attemptA.state).toBe('done');
    expect(attemptA.accepted).toBe(true);

    // b) Participant B was cancelled before dispatch: marked not_sent or cancelled_before_dispatch, not lost
    const attemptB = record.attempts.find((a) => a.participant === 'B');
    expect(attemptB).toBeDefined();
    expect(attemptB.state).toBe('not_sent');
    expect(attemptB.reason).toBe('cancelled_before_dispatch');
  });

  test('B02 (c): resuming after wave 2 stop does not re-send already accepted participant A and runs without settleUnknown dialog', async () => {
    const record = Record.createRun({ runId: 'run-b02-resume', pipelineName: 'P', task: 'Task', steps: STEP_WITH_TWO_PARTICIPANTS });
    const controller = new AbortController();

    await Engine.run({
      task: 'Task',
      steps: STEP_WITH_TWO_PARTICIPANTS,
      signal: controller.signal,
      onRequest: (entry) => Record.recordAttempt(record, entry),
      onResponse: (entry) => Record.recordAttempt(record, entry),
      putText: (v) => record.put(v),
      getText: (ref) => record.texts[ref],
      checkpoint: async (state) => {
        Record.setArtifacts(record, state.artifacts);
        Record.setSnapshot(record, { schema: STEP_WITH_TWO_PARTICIPANTS, state });
      },
      sendParticipants: async (requests, meta) => {
        if (typeof meta?.onWaveResult === 'function') {
          await meta.onWaveResult({
            byParticipant: {
              A: { text: 'Answer of A', status: 'SUCCESS', transportRequestId: 'req-A-1' }
            }
          });
        }
        controller.abort();
        const abortErr = new Error('aborted');
        abortErr.name = 'AbortError';
        throw abortErr;
      }
    });

    // Make sure snapshot was revived / serialized as on page reload
    const revived = Record.revive(clone(Record.serialize(record)));

    const sentOnResume = [];
    const resolveUnknownMock = jest.fn();
    const resumeResult = await Engine.run({
      task: 'Task',
      steps: STEP_WITH_TWO_PARTICIPANTS,
      resume: { ...clone(revived.snapshot), artifacts: revived.artifacts },
      putText: (v) => revived.put(v),
      getText: (ref) => revived.texts[ref],
      resolveUnknown: resolveUnknownMock,
      sendParticipants: async (requests) => {
        requests.forEach((r) => sentOnResume.push(r.participantId));
        return {
          byParticipant: {
            B: { text: 'Answer of B', status: 'SUCCESS', transportRequestId: 'req-B-1' }
          },
          closedByOwner: false
        };
      }
    });

    expect(resumeResult.stopReason).toBe('steps_done');
    // c) Participant A must NOT be sent again upon resume!
    expect(sentOnResume).not.toContain('A');
    expect(sentOnResume).toContain('B');
    // B was cleanly cancelled_before_dispatch, so settleUnknown / resolveUnknown is not triggered
    expect(resolveUnknownMock).not.toHaveBeenCalled();
  });

  test('B02: repeated notifications via onWaveResult are idempotent and do not create duplicate artifacts', async () => {
    const record = Record.createRun({ runId: 'run-b02-idempotent', pipelineName: 'P', task: 'Task', steps: STEP_WITH_TWO_PARTICIPANTS });
    const runResult = await Engine.run({
      task: 'Task',
      steps: STEP_WITH_TWO_PARTICIPANTS,
      onRequest: (entry) => Record.recordAttempt(record, entry),
      onResponse: (entry) => Record.recordAttempt(record, entry),
      putText: (v) => record.put(v),
      getText: (ref) => record.texts[ref],
      checkpoint: async (state) => {
        Record.setArtifacts(record, state.artifacts);
        Record.setSnapshot(record, { schema: STEP_WITH_TWO_PARTICIPANTS, state });
      },
      sendParticipants: async (requests, meta) => {
        const replyA = { text: 'Answer of A', status: 'SUCCESS', transportRequestId: 'req-A-1' };
        // First wave notification for A
        await meta.onWaveResult({ byParticipant: { A: replyA } });
        // Duplicate notification for A
        await meta.onWaveResult({ byParticipant: { A: replyA } });

        // Wave 2 for B
        const replyB = { text: 'Answer of B', status: 'SUCCESS', transportRequestId: 'req-B-1' };
        await meta.onWaveResult({ byParticipant: { B: replyB } });

        return {
          byParticipant: { A: replyA, B: replyB },
          closedByOwner: false
        };
      }
    });

    expect(runResult.stopReason).toBe('steps_done');
    // Exactly 1 artifact for participant A, no duplicates created
    const artifactsA = runResult.artifacts.filter((art) => art.id === 'art1' && art.source?.participant === 'A');
    expect(artifactsA).toHaveLength(1);
    const artifactsB = runResult.artifacts.filter((art) => art.id === 'art1' && art.source?.participant === 'B');
    expect(artifactsB).toHaveLength(1);
  });

  test('B02 (wiring): results.js sendParticipants integrates with onWaveResult', () => {
    const resultsSource = fs.readFileSync(path.join(__dirname, '..', 'results.js'), 'utf8');
    const sendFn = resultsSource.slice(resultsSource.indexOf('sendParticipants: async (requests, meta) => {'), resultsSource.indexOf('onEvent: (kind, fields) => {'));
    expect(sendFn).toContain('onWaveResult');
  });
});
