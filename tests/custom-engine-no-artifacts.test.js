// Basic engine without output and without artifacts: a two-round schema with no `output`, `artifacts` or `document`
// runs from the first step to the last. Fake transport only: no provider is called.
const Engine = require('../disput/custom-engine');
const Schema = require('../disput/basic-schema');

const SCHEMA = {
  schemaVersion: 1,
  origin: 'user',
  steps: [
    { ref: 'r1', kind: 'round', models: [{ id: 'a', name: 'Claude' }] },
    { ref: 'r2', kind: 'round', input: ['r1'], models: [{ id: 'b', name: 'GPT' }] }
  ]
};

const REPLY_A = 'Ответ участника A первого раунда: достаточно длинный и осмысленный текст, который движок должен передать дальше без изменений и без каких-либо меток документа.';
const REPLY_B = 'Ответ участника B второго раунда: тоже длинный и осмысленный текст, который служит заглушкой для проверки завершения прогона.';

// Fake transport by participants: replies[participantId] is a list, one reply per request to that participant.
function participantTransport(replies) {
  const calls = [];
  const used = {};
  const sendParticipants = async (requests, meta) => {
    calls.push({ requests: requests.map((item) => ({ ...item })), meta });
    const byParticipant = {};
    requests.forEach(({ participantId }) => {
      const index = used[participantId] || 0;
      used[participantId] = index + 1;
      const text = (replies[participantId] || [])[index] || '';
      byParticipant[participantId] = { text, status: text ? 'SUCCESS' : 'TIMEOUT' };
    });
    return { byParticipant, closedByOwner: false };
  };
  return { sendParticipants, calls };
}

const runSchema = (schema, replies) => {
  const transport = participantTransport(replies);
  return Engine.run({ task: 'T', sendParticipants: transport.sendParticipants, steps: Schema.assemble(schema) })
    .then((result) => ({ result, calls: transport.calls }));
};

describe('Basic engine without output and artifacts', () => {
  test('1. the schema without output, artifacts or document is valid', () => {
    expect(Schema.validate(SCHEMA)).toEqual([]);
  });

  test('2. the whole schema runs to the end: both rounds are done, no stop by error', async () => {
    const { result } = await runSchema(SCHEMA, { a: [REPLY_A], b: [REPLY_B] });
    expect(result.stopReason).toBe('steps_done');
    expect(result.steps.map((step) => step.ref)).toEqual(['r1', 'r2']);
    expect(result.steps.every((step) => step.skipped === false)).toBe(true);
    expect(result.steps[0].outcome.a).toMatchObject({ ok: true, text: REPLY_A });
    expect(result.steps[1].outcome.b).toMatchObject({ ok: true, text: REPLY_B });
    expect(JSON.stringify(result.texts)).not.toContain('[[DOC');
  });

  test('3. the request of the second round contains the verbatim answer of the first round', async () => {
    const { calls } = await runSchema(SCHEMA, { a: [REPLY_A], b: [REPLY_B] });
    const requestB = calls[1].requests.find((item) => item.participantId === 'b');
    expect(requestB.prompt).toContain(REPLY_A);
  });

  test('4. the list of artifacts of the result is empty', async () => {
    const { result } = await runSchema(SCHEMA, { a: [REPLY_A], b: [REPLY_B] });
    expect(result.artifacts).toEqual([]);
  });

  test('5. without input in the second round the previous step is the default source: its request contains the first answer', async () => {
    const schema = {
      schemaVersion: 1,
      origin: 'user',
      steps: [
        { ref: 'r1', kind: 'round', models: [{ id: 'a', name: 'Claude' }] },
        { ref: 'r2', kind: 'round', models: [{ id: 'b', name: 'GPT' }] }
      ]
    };
    const { result, calls } = await runSchema(schema, { a: [REPLY_A], b: [REPLY_B] });
    expect(result.stopReason).toBe('steps_done');
    const requestB = calls[1].requests.find((item) => item.participantId === 'b');
    expect(requestB.prompt).toContain(REPLY_A);
  });
});
