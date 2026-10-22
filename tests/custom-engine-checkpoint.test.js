const Engine = require('../disput/custom-engine');

// A scripted transport that writes its calls into a shared log, so the order of checkpoints and sends can be read back.
function transport(answers, log) {
  const used = {};
  const send = async (models, prompts) => {
    log.push({ kind: 'send', models: models.slice() });
    const byModel = {};
    models.forEach((model) => {
      const index = used[model] || 0;
      used[model] = index + 1;
      const reply = (answers[model] || [])[index];
      byModel[model] = { text: reply || '', status: reply ? 'SUCCESS' : 'TIMEOUT' };
    });
    return { byModel, closedByOwner: false };
  };
  return send;
}

// A checkpoint that writes its phase and pointer into the log; `failAt` names the call (1-based) that fails.
function checkpointing(log, { failAt = 0 } = {}) {
  let calls = 0;
  const states = [];
  const checkpoint = async (state) => {
    calls += 1;
    states.push(JSON.parse(JSON.stringify(state)));
    log.push({ kind: 'checkpoint', phase: state.current.phase, pc: state.pc });
    if (calls === failAt) throw new Error('disk full');
  };
  return { checkpoint, states };
}

const TWO_ROUNDS = [
  { ref: 'S1', kind: 'round', input: 'none', models: ['A'] },
  { ref: 'S2', kind: 'round', input: 'previous', models: ['B'] }
];

describe('Custom engine checkpoint (ТЗ 7, 8.2, T20)', () => {
  test('a checkpoint is saved and awaited before each external send, and after its result', async () => {
    const log = [];
    const { checkpoint } = checkpointing(log);
    const result = await Engine.run({ task: 'T', steps: TWO_ROUNDS, send: transport({ A: ['a1'], B: ['b1'] }, log), checkpoint });
    expect(result.stopReason).toBe('steps_done');
    const kinds = log.map((item) => (item.kind === 'send' ? `send:${item.models[0]}` : `checkpoint:${item.phase}`));
    expect(kinds).toEqual(['checkpoint:send', 'send:A', 'checkpoint:judge', 'checkpoint:send', 'send:B', 'checkpoint:judge', 'checkpoint:done']);
    expect(result.checkpointed).toBe(true);
  });

  test('the state of a checkpoint is the live state: the pointer of the step in progress, its phase and its visit', async () => {
    const log = [];
    const { checkpoint, states } = checkpointing(log);
    await Engine.run({ task: 'T', steps: TWO_ROUNDS, send: transport({ A: ['a1'], B: ['b1'] }, log), checkpoint });
    const beforeB = states.find((state) => state.current.stepRef === 'S2' && state.current.phase === 'send');
    expect(beforeB).toMatchObject({ pc: 'S2', visits: { S1: 1, S2: 1 }, current: { stepRef: 'S2', visit: 1, phase: 'send' } });
    expect(beforeB.current.accepted).toEqual([]);
    const afterA = states.find((state) => state.current.stepRef === 'S1' && state.current.phase === 'judge');
    expect(afterA.current.accepted).toEqual(['A']);
    expect(afterA.artifacts).toEqual([]);
    expect(states.every((state) => state.current.pending !== undefined && Array.isArray(state.routes))).toBe(true);
  });

  test('a failed checkpoint stops the run: the next request is not sent and the error is not swallowed', async () => {
    const log = [];
    const { checkpoint } = checkpointing(log, { failAt: 2 }); // the checkpoint after the answer of A
    const send = transport({ A: ['a1'], B: ['b1'] }, log);
    await expect(Engine.run({ task: 'T', steps: TWO_ROUNDS, send, checkpoint })).rejects.toThrow('checkpoint_failed');
    expect(log.filter((item) => item.kind === 'send').map((item) => item.models[0])).toEqual(['A']);
  });

  test('a failed checkpoint before a send stops before that send', async () => {
    const log = [];
    const { checkpoint } = checkpointing(log, { failAt: 1 });
    const send = transport({ A: ['a1'] }, log);
    await expect(Engine.run({ task: 'T', steps: [{ ref: 'S1', kind: 'round', input: 'none', models: ['A'] }], send, checkpoint })).rejects.toThrow('checkpoint_failed');
    expect(log.filter((item) => item.kind === 'send')).toEqual([]);
  });

  test('a run without a checkpoint callback is allowed, and it says that nothing was saved', async () => {
    const log = [];
    const result = await Engine.run({ task: 'T', steps: TWO_ROUNDS, send: transport({ A: ['a1'], B: ['b1'] }, log) });
    expect(result.stopReason).toBe('steps_done');
    expect(result.checkpointed).toBe(false);
  });

  test('a checkpoint is written before the owner decides and again after it; the pending interaction is named', async () => {
    const log = [];
    const { checkpoint, states } = checkpointing(log);
    const steps = [{ ref: 'S1', kind: 'round', input: 'none', models: ['A'] }];
    const result = await Engine.run({ task: 'T', steps, send: transport({ A: [''] }, log), checkpoint, maxAttempts: 1, decide: async () => 'stop' });
    expect(result.stopReason).toBe('stopped');
    expect(log.map((item) => (item.kind === 'send' ? 'send-request' : item.phase))).toEqual(['send', 'send-request', 'judge', 'decision', 'decision', 'done']);
    const decisions = states.filter((state) => state.current.phase === 'decision');
    expect(decisions.map((state) => state.pendingOwner)).toEqual([{ kind: 'decision', stepRef: 'S1', visit: 1 }, null]);
  });

  test('a checkpoint is written after the invalidation of a transition, too', async () => {
    const log = [];
    const { checkpoint, states } = checkpointing(log);
    const steps = [
      { ref: 'S10', kind: 'round', input: 'none', models: ['A'] },
      { ref: 'G1', kind: 'gate', criteria: ['c'], models: ['B'], onFail: { goto: 'S10', maxLoops: 1 } }
    ];
    const FAIL = 'Разбор.\nНЕ ВЫПОЛНЕНО: x\nВЕРДИКТ: НЕ ПРОШЁЛ';
    const PASS = 'Разбор.\nВЕРДИКТ: ПРОШЁЛ';
    const result = await Engine.run({ task: 'T', steps, send: transport({ A: ['a1', 'a2'], B: [FAIL, PASS] }, log), checkpoint });
    expect(result.stopReason).toBe('steps_done');
    const transitions = states.filter((state) => state.current.phase === 'transition');
    expect(transitions.map((state) => state.pc)).toEqual(['G1', 'G1']);
  });
});
