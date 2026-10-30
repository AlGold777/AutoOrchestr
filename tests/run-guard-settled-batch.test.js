const RunGuard = require('../shared/run-guard');

const stuck = { GPT: { promptSubmittedAt: Date.now() - 1000, cardAnswerComplete: false, finalStatusRecorded: false } };
const session = { roundsInProgress: true, sessionId: 's1' };
const custom = (settledBatches) => ({ pipelineContext: { custom: true, settledBatches } });

describe('a Basic batch after a settled batch of the same run', () => {
  test('is not refused for a tail the background still holds', () => {
    expect(RunGuard.canStartNewRun(session, custom(1), stuck)).toEqual({ ok: true });
  });

  test('the first batch of a run still waits for a running session and a generating model', () => {
    expect(RunGuard.canStartNewRun(session, custom(0), stuck).errorCode).toBe('RUN_ALREADY_ACTIVE');
    expect(RunGuard.canStartNewRun({ roundsInProgress: false }, custom(0), stuck).reason).toBe('model_still_generating');
  });

  test('a start that is not a Basic batch is refused as before', () => {
    expect(RunGuard.canStartNewRun(session, { pipelineContext: { settledBatches: 3 } }, stuck).errorCode).toBe('RUN_ALREADY_ACTIVE');
  });
});
