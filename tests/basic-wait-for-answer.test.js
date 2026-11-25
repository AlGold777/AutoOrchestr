const engine = require('../disput/custom-engine.js');

// An unfinished round: the owner window can wait for the page, and without a choice the run goes on by itself.
const steps = [
  { ref: 'r1', kind: 'round', task: 'Ответь.', models: [{ name: 'GPT', id: 'gpt' }, { name: 'Qwen', id: 'qwen' }] },
  { ref: 'r2', kind: 'round', task: 'Сведи.', models: [{ name: 'Claude', id: 'claude' }] }
];

const run = async ({ decide, pageAnswerAfter = Infinity, decisionTimeoutMs = 300 }) => {
  const sent = [];
  const decisions = [];
  let reads = 0;
  let seq = 0;
  const result = await engine.run({
    task: 'Задача', steps, decisionTimeoutMs, waitPollMs: 10,
    // Qwen gets no answer from the transport; the page may show it later.
    sendParticipants: async (requests) => ({ byParticipant: Object.fromEntries(requests.map((request) => {
      sent.push(request.participantId);
      seq += 1;
      if (request.participantId === 'qwen') return ['qwen', { text: '', status: 'NO_SEND', sentPrompt: request.prompt, transportRequestId: `t${seq}` }];
      return [request.participantId, { text: `Ответ ${request.participantId}`, status: 'SUCCESS', transportRequestId: `t${seq}` }];
    })) }),
    reread: async () => {
      reads += 1;
      return reads > pageAnswerAfter ? { found: true, text: 'Ответ со страницы', status: 'SUCCESS', completion: 'complete' } : { found: false, reason: 'not_found' };
    },
    decide,
    onEvent: (name, data) => { if (name === 'custom_decision') decisions.push(data); }
  });
  return { result, sent, decisions };
};
const never = () => new Promise(() => {});
const qwenOf = (result) => result.steps[0].outcome.qwen;

describe('Basic: waiting for the answer of an unfinished round', () => {
  test('no choice: the window is closed by the time and the participant is skipped, the run goes on', async () => {
    let closed = false;
    const { result, decisions } = await run({ decide: ({ signal }) => { signal.addEventListener('abort', () => { closed = true; }); return never(); }, decisionTimeoutMs: 60 });
    expect(result.stopReason).toBe('steps_done');
    expect(closed).toBe(true);
    expect(qwenOf(result).ok).toBe(false);
    expect(decisions.some((item) => item.action === 'skip_participant' && item.auto)).toBe(true);
    expect(result.steps).toHaveLength(2);
  });

  test('the answer shows on the page while the window is open: it is taken and nothing is sent again', async () => {
    const { result, sent } = await run({ decide: never, pageAnswerAfter: 2, decisionTimeoutMs: 2000 });
    expect(result.stopReason).toBe('steps_done');
    expect(qwenOf(result).ok).toBe(true);
    expect(qwenOf(result).text).toBe('Ответ со страницы');
    expect(sent.filter((id) => id === 'qwen').length).toBeLessThanOrEqual(2);
  });

  test('Wait: the page is watched for the chosen time and the answer is taken', async () => {
    let asked = 0;
    const { result, decisions } = await run({ decide: async ({ choices }) => { asked += 1; expect(choices).toContain('wait'); return { action: 'wait', minutes: 20 }; }, pageAnswerAfter: 3, decisionTimeoutMs: 2000 });
    expect(asked).toBe(1);
    expect(qwenOf(result).ok).toBe(true);
    expect(decisions[0]).toMatchObject({ action: 'wait', minutes: 20 });
    expect(result.stopReason).toBe('steps_done');
  });

  test('Wait without an answer: the participant is skipped, the window is not asked again', async () => {
    let asked = 0;
    const { result } = await run({ decide: async () => { asked += 1; return { action: 'wait', minutes: 0.001 }; } });
    expect(asked).toBe(1);
    expect(qwenOf(result).ok).toBe(false);
    expect(result.stopReason).toBe('steps_done');
  });

  test('Stop run still stops the run', async () => {
    const { result } = await run({ decide: async () => 'stop' });
    expect(result.stopReason).toBe('stopped');
  });
});

describe('Basic page: «Настройки Basic» in ▶', () => {
  const js = require('fs').readFileSync(require('path').join(__dirname, '..', 'results.js'), 'utf8');
  test('one setting for all pipelines in the extension storage; the run and the window take it', () => {
    expect(js).toContain("const BASIC_SETTINGS_KEY = 'basicRunSettings';");
    expect(js).toContain('Настройки Basic (общие для всех pipeline)');
    expect(js).toContain("onNoAnswer: runSettings.skipNoAnswer ? 'skip' : 'ask',");
    expect(js).toContain('decisionTimeoutMs: runSettings.waitMinutes * 60000,');
    expect(js).toContain('!resumeRecord && runSettings.askTaskBrief &&');
    expect(js).toContain('waitDefault: basicSettings.waitMinutes');
    expect(js).toContain('${basicDescriptionBlock()}${basicSettingsBlock()}');
  });
});
