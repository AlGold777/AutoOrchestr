const RunGuard = require('../shared/run-guard');

describe('RunGuard.canStartNewRun', () => {
  test('allows a run when no session exists', () => {
    expect(RunGuard.canStartNewRun(null)).toEqual({ ok: true });
  });

  test('allows a run when session is not active', () => {
    expect(RunGuard.canStartNewRun({ roundsInProgress: false })).toEqual({ ok: true });
  });

  test('blocks a second run while rounds are in progress', () => {
    expect(RunGuard.canStartNewRun({
      roundsInProgress: true,
      sessionId: 'session-1'
    })).toEqual({
      ok: false,
      errorCode: 'RUN_ALREADY_ACTIVE',
      activeSessionId: 'session-1'
    });
  });

  test('allows an explicit forced run', () => {
    expect(RunGuard.canStartNewRun({ roundsInProgress: true }, { force: true })).toEqual({ ok: true });
  });
});

describe('RunGuard: the next batch of a Basic run does not wait for the tail of the rounds', () => {
  const answered = { cardAnswerComplete: true };
  const final = { finalStatusRecorded: true };
  const open = { promptSubmittedAt: Date.now() };

  test('rounds still in progress, every model of the previous batch final: a Basic batch may start', () => {
    const llms = { GPT: answered, Claude: final, Gemini: { status: 'STOPPED' } };
    expect(RunGuard.canStartNewRun({ roundsInProgress: true }, { pipelineContext: { custom: true } }, llms)).toEqual({ ok: true });
  });

  test('a model still open, no models at all, or a run that is not a Basic batch: the refusal stays', () => {
    expect(RunGuard.canStartNewRun({ roundsInProgress: true }, { pipelineContext: { custom: true } }, { GPT: answered, Claude: open }).ok).toBe(false);
    expect(RunGuard.canStartNewRun({ roundsInProgress: true }, { pipelineContext: { custom: true } }, {}).ok).toBe(false);
    expect(RunGuard.canStartNewRun({ roundsInProgress: true }, { pipelineContext: { custom: true } }, null).ok).toBe(false);
    expect(RunGuard.canStartNewRun({ roundsInProgress: true }, {}, { GPT: answered }).ok).toBe(false);
    expect(RunGuard.canStartNewRun({ roundsInProgress: true }, { pipelineContext: { custom: false } }, { GPT: answered }).ok).toBe(false);
  });

  test('the tail does not hide a model that is still generating (that guard is separate)', () => {
    const generating = { promptSubmittedAt: Date.now() - 1000 };
    expect(RunGuard.canStartNewRun({ roundsInProgress: false }, { pipelineContext: { custom: true } }, { GPT: generating })).toMatchObject({ ok: false, reason: 'model_still_generating' });
  });
});
