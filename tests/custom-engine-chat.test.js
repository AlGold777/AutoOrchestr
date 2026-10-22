const Engine = require('../disput/custom-engine');

// A transport by participants: the requests come with their chat; every participant gets its own answers, in order.
function participantTransport(answers, log) {
  const used = {};
  return async (requests) => {
    log.push(requests.map((request) => ({ ...request })));
    const byParticipant = {};
    requests.forEach((request) => {
      const index = used[request.participantId] || 0;
      used[request.participantId] = index + 1;
      const text = (answers[request.participantId] || [])[index] || '';
      byParticipant[request.participantId] = { text, status: text ? 'SUCCESS' : 'TIMEOUT', transportRequestId: `${request.participantId}-${index + 1}` };
    });
    return { byParticipant, closedByOwner: false };
  };
}

const FAIL = 'Разбор.\nНЕ ВЫПОЛНЕНО: x\nВЕРДИКТ: НЕ ПРОШЁЛ';
const PASS = 'Разбор.\nВЕРДИКТ: ПРОШЁЛ';

describe('Custom engine chat (chat: new, 4.2, T07)', () => {
  test('a new chat is asked on the first request of the step; a correction inside the visit continues that chat', async () => {
    const log = [];
    const steps = [{ ref: 'S1', kind: 'round', chat: 'new', input: 'none', models: ['A'] }];
    const result = await Engine.run({ task: 'T', steps, sendParticipants: participantTransport({ A: ['', 'a2'] }, log) });
    expect(result.stopReason).toBe('steps_done');
    expect(log.map((call) => call.map((request) => [request.participantId, request.attempt, request.chat]))).toEqual([
      [['A', 1, 'new']],
      [['A', 2, 'continue']]
    ]);
  });

  test('a participant without chat, and the default, keep continue', async () => {
    const log = [];
    const steps = [{ ref: 'S1', kind: 'round', input: 'none', models: ['A'] }];
    await Engine.run({ task: 'T', steps, sendParticipants: participantTransport({ A: ['a1'] }, log) });
    expect(log[0][0].chat).toBe('continue');
  });

  test('a new visit of the step starts a new chat again; the same visit does not', async () => {
    const log = [];
    const steps = [
      { ref: 'S10', kind: 'round', chat: 'new', input: 'none', models: ['A'] },
      { ref: 'G1', kind: 'gate', criteria: ['c'], models: ['B'], onFail: { goto: 'S10', maxLoops: 1 } }
    ];
    const result = await Engine.run({ task: 'T', steps, sendParticipants: participantTransport({ A: ['a1', 'a2'], B: [FAIL, PASS] }, log) });
    expect(result.stopReason).toBe('steps_done');
    const aCalls = log.flat().filter((request) => request.participantId === 'A').map((request) => [request.visit, request.attempt, request.chat]);
    expect(aCalls).toEqual([[1, 1, 'new'], [2, 1, 'new']]);
  });

  test('a chat other than continue or new is refused before the first request, with the address of the step', async () => {
    const log = [];
    const steps = [{ ref: 'S1', kind: 'round', chat: 'shared', input: 'none', models: ['A'] }];
    const error = await Engine.run({ task: 'T', steps, sendParticipants: participantTransport({ A: ['a1'] }, log) }).catch((item) => item);
    expect(error.code).toBe('unsupported_field');
    expect(error.message).toContain('S1');
    expect(log).toEqual([]);
  });

  test('chat new needs the transport by participants: the legacy send refuses it before the first request', async () => {
    const calls = [];
    const send = async (models) => { calls.push(models); return { byModel: { A: { text: 'a1', status: 'SUCCESS' } } }; };
    const steps = [{ ref: 'S1', kind: 'round', chat: 'new', input: 'none', models: ['A'] }];
    const error = await Engine.run({ task: 'T', steps, send }).catch((item) => item);
    expect(error.code).toBe('unsupported_field');
    expect(calls).toEqual([]);
  });
});
