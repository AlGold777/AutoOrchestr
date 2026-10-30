// M-17: a partial answer is collected by the engine itself before the owner window. The page is read (the same collection as
// Get it) after a partial or empty reply, once per sent request; a text that the page has grown to is judged before the window.
const Engine = require('../disput/custom-engine');

const accept = ({ completion }) => (completion === 'complete' ? { ok: true } : { ok: false, reason: 'partial_unproven' });
const complete = (text, sentPrompt = 'Задание. [[AO-abc123]]') => ({ text, status: 'SUCCESS', completion: 'complete', sentPrompt, transportRequestId: 't1' });
const partial = (text, sentPrompt = 'Задание. [[AO-abc123]]') => ({ text, status: 'PARTIAL', completion: 'partial', sentPrompt, transportRequestId: 't1' });
const r1 = { ref: 'r1', kind: 'round', input: 'none', models: ['A'] };

function transport(replies) {
  const calls = [];
  let index = 0;
  const sendParticipants = async (requests) => {
    calls.push(requests.map((request) => ({ ...request })));
    const request = requests[0];
    const reply = replies[index];
    index += 1;
    return { byParticipant: { [request.participantId]: reply }, closedByOwner: false };
  };
  return { sendParticipants, calls };
}

function rereads(replies) {
  const calls = [];
  let index = 0;
  const reread = async (request) => {
    calls.push(request);
    const reply = replies[index] || { found: false, reason: 'no_new_answer' };
    index += 1;
    return reply;
  };
  return { reread, calls };
}

describe('M-17: a partial answer is read by the engine before the owner window', () => {
  test('on the last attempt a partial reply is read once before the window; the page holds the complete text: it is taken', async () => {
    const { sendParticipants, calls } = transport([partial('Начало'), partial('Начало ответа')]);
    const { reread, calls: reads } = rereads([
      { found: false, reason: 'no_new_answer' },
      { found: true, text: 'Полный ответ целиком.', confirmed: true, status: 'SUCCESS', completion: 'complete' }
    ]);
    const result = await Engine.run({ task: 'T', steps: [r1], sendParticipants, reread, accept });
    // Two requests (the default of two attempts), and one read after each reply; none of the reads is repeated.
    expect(calls).toHaveLength(2);
    expect(reads).toHaveLength(2);
    expect(reads[1]).toMatchObject({ participantId: 'A', previousText: 'Начало ответа' });
    expect(result.steps[0].outcome.A).toMatchObject({ ok: true, text: 'Полный ответ целиком.' });
  });

  test('a partial reply with nothing new on the page: the window gets the rejection, with one read per reply', async () => {
    const { sendParticipants, calls } = transport([partial('Начало'), partial('Начало')]);
    const { reread, calls: reads } = rereads([]);
    const result = await Engine.run({ task: 'T', steps: [r1], sendParticipants, reread, accept });
    expect(calls).toHaveLength(2);
    expect(reads).toHaveLength(2);
    expect(result).toBeDefined();
  });

  test('a rejected answer that is neither partial nor empty is read once before its correction goes out', async () => {
    const { sendParticipants, calls } = transport([
      { text: 'Ответ без метки', status: 'SUCCESS', completion: 'complete', sentPrompt: 'Задание. [[AO-abc123]]', transportRequestId: 't1' },
      { text: 'Ответ без метки', status: 'SUCCESS', completion: 'complete', sentPrompt: 'Исправление. [[AO-yahx37]]', transportRequestId: 't2' }
    ]);
    const { reread, calls: reads } = rereads([]);
    await Engine.run({ task: 'T', steps: [r1], sendParticipants, reread, accept: () => ({ ok: false, reason: 'format_invalid' }) });
    expect(reads).toHaveLength(1);
    expect(reads[0].previousText).toBe('Ответ без метки');
    expect(calls).toHaveLength(2);
  });
});
