// M-11: before a repeat of a Basic request the page is read again. An answer of the same request that is on the page is taken
// (judged, not sent again); a repeat is sent only when the page has no new answer of that request.
const fs = require('fs');
const path = require('path');
const Engine = require('../disput/custom-engine');

const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

// The acceptance of this test: only a complete answer is accepted, so a partial one is rejected with partial_unproven.
const accept = ({ completion }) => (completion === 'complete' ? { ok: true } : { ok: false, reason: 'partial_unproven' });
const complete = (text) => ({ text, status: 'SUCCESS', completion: 'complete', sentPrompt: 'Задание. [[AO-abc123]]', transportRequestId: 't1' });
const partial = (text) => ({ text, status: 'PARTIAL', completion: 'partial', sentPrompt: 'Задание. [[AO-abc123]]', transportRequestId: 't1' });
const r1 = { ref: 'r1', kind: 'round', input: 'none', models: ['A'] };

// A scripted transport: replies[n] is the reply to the n-th request to the model.
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
    const reply = replies[index] || { found: false, reason: 'no_own_turn' };
    index += 1;
    return reply;
  };
  return { reread, calls };
}

describe('M-11: a partial answer that is complete on the page is read before any correction', () => {
  test('the page holds the longer answer of the request: it is accepted and nothing is sent again', async () => {
    const { sendParticipants, calls } = transport([partial('Начало ответа')]);
    const { reread, calls: reads } = rereads([{ found: true, text: 'Полный ответ целиком.', confirmed: true, status: 'SUCCESS', completion: 'complete' }]);
    const events = [];
    const result = await Engine.run({ task: 'T', steps: [r1], sendParticipants, reread, accept, onEvent: (kind, fields) => events.push({ kind, ...fields }) });
    expect(calls).toHaveLength(1);
    expect(reads).toHaveLength(1);
    expect(reads[0]).toMatchObject({ participantId: 'A', sentPrompt: 'Задание. [[AO-abc123]]', previousText: 'Начало ответа' });
    expect(result.steps[0].outcome.A).toMatchObject({ ok: true, text: 'Полный ответ целиком.' });
    expect(events.find((event) => event.kind === 'retry_reread_page')).toMatchObject({ outcome: 'accepted', participant: 'A' });
  });

  test('the page holds no new answer of the request: the correction goes out once', async () => {
    const { sendParticipants, calls } = transport([partial('Начало ответа'), complete('Исправленный полный ответ.')]);
    const { reread } = rereads([{ found: false, reason: 'no_new_answer' }]);
    const events = [];
    const result = await Engine.run({ task: 'T', steps: [r1], sendParticipants, reread, accept, onEvent: (kind, fields) => events.push({ kind, ...fields }) });
    expect(calls).toHaveLength(2);
    expect(result.steps[0].outcome.A).toMatchObject({ ok: true, text: 'Исправленный полный ответ.' });
    expect(events.find((event) => event.kind === 'retry_reread_page')).toMatchObject({ outcome: 'resent', participant: 'A' });
  });

  test('without the host callback the engine behaves as before: the correction goes out', async () => {
    const { sendParticipants, calls } = transport([partial('Начало ответа'), complete('Полный.')]);
    await Engine.run({ task: 'T', steps: [r1], sendParticipants, accept });
    expect(calls).toHaveLength(2);
  });
});

describe('M-11: a repeat of a request reads the page before it sends the request again', () => {
  test('an empty answer whose request is on the page is taken: the request is sent once', async () => {
    const { sendParticipants, calls } = transport([{ text: '', status: 'TIMEOUT', sentPrompt: 'Задание. [[AO-abc123]]', transportRequestId: 't1' }]);
    const { reread, calls: reads } = rereads([{ found: true, text: 'Ответ, пришедший позже.', confirmed: true, status: 'SUCCESS', completion: 'complete' }]);
    const result = await Engine.run({ task: 'T', steps: [r1], sendParticipants, reread, accept });
    expect(calls).toHaveLength(1);
    expect(reads).toHaveLength(1);
    expect(result.steps[0].outcome.A).toMatchObject({ ok: true, text: 'Ответ, пришедший позже.' });
  });

  test('an empty answer with no answer on the page: the same request goes out again, once', async () => {
    const { sendParticipants, calls } = transport([
      { text: '', status: 'TIMEOUT', sentPrompt: 'Задание. [[AO-abc123]]', transportRequestId: 't1' },
      complete('Ответ на повтор.')
    ]);
    const { reread, calls: reads } = rereads([{ found: false, reason: 'no_own_turn' }]);
    const events = [];
    const result = await Engine.run({ task: 'T', steps: [r1], sendParticipants, reread, accept, onEvent: (kind, fields) => events.push({ kind, ...fields }) });
    expect(reads).toHaveLength(1);
    expect(calls).toHaveLength(2);
    expect(calls[1][0].prompt).toBe(calls[0][0].prompt);
    expect(result.steps[0].outcome.A).toMatchObject({ ok: true, text: 'Ответ на повтор.' });
    expect(events.filter((event) => event.kind === 'retry_reread_page').map((event) => event.outcome)).toEqual(['resent']);
  });
});

describe('M-11: the background and the host route the re-read', () => {
  test('the host sends the re-read with the request of the participant and its tab', () => {
    const results = read('results.js');
    expect(results).toContain("type: 'BASIC_REREAD_OWN_TURN'");
    expect(results).toMatch(/reread: async \(request\) => \{[\s\S]*?chatBindings\[request\.participantId\][\s\S]*?sentPrompt: request\.sentPrompt/);
  });

  test('the message router answers the re-read through the own-turn check of the job', () => {
    const router = read('background/message-router.js');
    expect(router).toMatch(/case 'BASIC_REREAD_OWN_TURN': \{[\s\S]*?rereadOwnTurnForBasic\(message\)/);
    const job = read('background/job-orchestrator.js');
    const fn = job.slice(job.indexOf('async function rereadOwnTurnForBasic'), job.indexOf('function collectGetItBatch('));
    // The own user turn is checked before any collection; the collection is the Get it ping.
    expect(fn.indexOf('pageHoldsOwnPromptTurn(tabId, sentPrompt)')).toBeGreaterThan(0);
    expect(fn.indexOf('pageHoldsOwnPromptTurn(tabId, sentPrompt)')).toBeLessThan(fn.indexOf('handleManualResponsePing('));
    expect(fn).toMatch(/confirmed \|\| \(text && quiet >= RETRY_REREAD_QUIET_POLLS\)/);
    expect(fn).toMatch(/text\.length <= previousLength/);
  });

  test('a repeat that finds its own turn on the page also collects the answer of that turn', () => {
    const dispatch = read('background/dispatch-coordinator.js');
    expect(dispatch).toContain("triggerResponseCollectionPing(llmName, tabId, 'retry_reread_page')");
    expect(dispatch).toContain("result?.reason === 'repeat_own_turn_on_page'");
  });
});
