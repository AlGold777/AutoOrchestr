// M-18: before any repeat (a repeat of a request, a correction) the page is read again, and the answer of any request of the
// participant in this round that is on the page is taken. A new request goes out only when there is no such answer.
const fs = require('fs');
const path = require('path');
const Engine = require('../disput/custom-engine');

const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

const accept = ({ completion }) => (completion === 'complete' ? { ok: true } : { ok: false, reason: 'partial_unproven' });
const r1 = { ref: 'r1', kind: 'round', input: 'none', models: ['A'] };
const ORIGINAL = 'Задание. [[AO-abc123]]';
const CORRECTION = 'Твой предыдущий ответ не подтверждён. [[AO-yahx37]]';

function transport(replies) {
  const calls = [];
  let index = 0;
  const sendParticipants = async (requests) => {
    calls.push(requests.map((request) => ({ ...request })));
    const reply = replies[index];
    index += 1;
    return { byParticipant: { [requests[0].participantId]: reply }, closedByOwner: false };
  };
  return { sendParticipants, calls };
}

function rereads(replies) {
  const calls = [];
  let index = 0;
  const reread = async (request) => {
    calls.push(request);
    const reply = replies[index] || { found: false, reason: 'no_own_turn' };
    index += 1;
    return reply;
  };
  return { reread, calls };
}

describe('M-18: a repeat takes the ready answer of the round before it sends a request', () => {
  test('a correction whose answer is empty reads the page: the answer of the original request is taken, nothing is sent', async () => {
    const { sendParticipants, calls } = transport([
      { text: 'Начало', status: 'PARTIAL', completion: 'partial', sentPrompt: ORIGINAL, transportRequestId: 't1' },
      { text: '', status: 'TIMEOUT', sentPrompt: CORRECTION, transportRequestId: 't2' }
    ]);
    const { reread, calls: reads } = rereads([
      { found: false, reason: 'no_new_answer' },
      { found: true, text: 'Полный ответ на исходный запрос.', confirmed: true, status: 'SUCCESS', completion: 'complete' }
    ]);
    const result = await Engine.run({ task: 'T', steps: [r1], sendParticipants, reread, accept, maxAttempts: 3 });
    expect(calls).toHaveLength(2);
    expect(reads).toHaveLength(2);
    // The last read names the request of the correction and the original one: the answer of either is taken.
    expect(reads[1].sentPrompts).toEqual([ORIGINAL, CORRECTION]);
    expect(result.steps[0].outcome.A).toMatchObject({ ok: true, text: 'Полный ответ на исходный запрос.' });
  });

  test('a correction is read before it is sent: the page holds no answer, the correction goes out', async () => {
    const { sendParticipants, calls } = transport([
      { text: 'Начало', status: 'PARTIAL', completion: 'partial', sentPrompt: ORIGINAL, transportRequestId: 't1' },
      { text: 'Полный исправленный.', status: 'SUCCESS', completion: 'complete', sentPrompt: CORRECTION, transportRequestId: 't2' }
    ]);
    const { reread, calls: reads } = rereads([{ found: false, reason: 'no_new_answer' }]);
    const result = await Engine.run({ task: 'T', steps: [r1], sendParticipants, reread, accept });
    expect(reads).toHaveLength(1);
    expect(calls).toHaveLength(2);
    expect(calls[1][0].prompt).not.toBe(calls[0][0].prompt);
    expect(result.steps[0].outcome.A).toMatchObject({ ok: true, text: 'Полный исправленный.' });
  });

  test('the repeat reads the page before the send: an empty answer with the answer of the earlier request on the page', async () => {
    const { sendParticipants, calls } = transport([
      { text: '', status: 'TIMEOUT', sentPrompt: ORIGINAL, transportRequestId: 't1' },
      { text: '', status: 'TIMEOUT', sentPrompt: CORRECTION, transportRequestId: 't2' }
    ]);
    const { reread, calls: reads } = rereads([{ found: true, text: 'Ответ уже на странице.', confirmed: true, status: 'SUCCESS', completion: 'complete' }]);
    const result = await Engine.run({ task: 'T', steps: [r1], sendParticipants, reread, accept, maxAttempts: 3 });
    expect(reads).toHaveLength(1);
    expect(calls).toHaveLength(1);
    expect(result.steps[0].outcome.A).toMatchObject({ ok: true, text: 'Ответ уже на странице.' });
  });
});

describe('M-18: the host and the background take the answer of any request of the round', () => {
  test('the host forwards every request of the round to the background', () => {
    const results = read('results.js');
    expect(results).toContain('sentPrompts: request.sentPrompts');
  });

  test('the background probes the page for each request of the round and confirms the answer by any of their tokens', () => {
    const job = read('background/job-orchestrator.js');
    const fn = job.slice(job.indexOf('async function rereadOwnTurnForBasic'), job.indexOf('function collectGetItBatch('));
    expect(fn).toContain('message.sentPrompts');
    expect(fn).toMatch(/for \(const prompt of roundPrompts\)[\s\S]*?pageHoldsOwnPromptTurn\(tabId, prompt(?:, llmName)?\)/);
    expect(fn).toMatch(/roundTags\.some\(\(tag\) => answerHasDeliveryToken\(llmName, text, tag\)\)/);
    expect(fn).toMatch(/text === previousText/);
  });

  test('the delivery token check takes the token of the request it is given', () => {
    const dispatch = read('background/dispatch-coordinator.js');
    expect(dispatch).toContain('function answerHasDeliveryToken(llmName, text, tag = \'\')');
    expect(dispatch).toContain("String(tag || prompt).match(");
  });

  test('the engine gives the host the requests of the round and reads the corrections too', () => {
    const engine = read('disput/custom-engine.js');
    expect(engine).toContain('sentPrompts: roundPrompts(model.id, step)');
    expect(engine).not.toMatch(/rereadNeeded = pending\.filter\(\(model\) => current\[model\.id\]\?\.retryOf && !current\[model\.id\]\?\.parts\?\.correction\)/);
  });
});
