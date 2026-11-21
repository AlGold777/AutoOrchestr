/** @jest-environment jsdom */
const LocalModel = require('../disput/local-model');
const MessageDelivery = require('../shared/message-delivery');
const Acceptance = require('../disput/debate-response-acceptance');

const noPrepare = async () => {};
const answer = (content, doneReason = 'stop', extra = {}) => async () => ({
  ok: true, status: 200,
  json: async () => ({ message: { content }, done_reason: doneReason, load_duration: 5, prompt_eval_count: 11, eval_count: 7, total_duration: 99, ...extra })
});
const request = (over = {}) => ({ participantId: 'p1', modelName: 'Qwen 4B', prompt: 'Задание', newChat: false, words: 100, ...over });
const make = (fetchImpl, delivery = null) => LocalModel.createTransport({ fetchImpl, prepare: noPrepare, delivery, makeRequestId: () => 'req-1' });

beforeEach(() => { MessageDelivery.reset?.(); });

describe('Qwen 4B transport', () => {
  test('a finished answer: text, SUCCESS, call parameters, delivery tag verified and removed from the text', async () => {
    const fetchImpl = jest.fn(answer('Готовый ответ.'));
    const transport = make(fetchImpl, MessageDelivery);
    const [reply] = Object.values(await transport.runWave([request({ words: 200 })]));
    expect(reply).toMatchObject({ text: 'Готовый ответ.', status: 'SUCCESS', completion: 'complete', answered: true, attribution: 'verified', doneReason: 'stop' });
    const body = JSON.parse(fetchImpl.mock.calls[0][1].body);
    expect(body).toMatchObject({ model: LocalModel.MODEL, stream: false, think: false, keep_alive: '15m' });
    expect(body.options.temperature).toBe(0.2);
    expect(body.options.num_predict).toBe(200 * 4 + 256);
    expect(body.format).toBeUndefined();
    expect(body.messages).toEqual([{ role: 'user', content: 'Задание' }]);
    const kinds = MessageDelivery.journal().map((event) => event.kind);
    expect(kinds).toEqual(expect.arrayContaining(['prepared', 'verified', 'local_model_call']));
    const call = MessageDelivery.journal().find((event) => event.kind === 'local_model_call');
    expect(call).toMatchObject({ doneReason: 'stop', load_duration: 5, prompt_eval_count: 11, eval_count: 7, total_duration: 99 });
  });

  test('done_reason length is an unfinished answer: PARTIAL, no delivery tag', async () => {
    const transport = make(answer('Оборванный отв', 'length'), MessageDelivery);
    const [reply] = Object.values(await transport.runWave([request()]));
    expect(reply).toMatchObject({ text: 'Оборванный отв', status: 'PARTIAL', completion: 'partial', reason: 'length', answered: false, attribution: '' });
    expect(MessageDelivery.journal().map((event) => event.kind)).toContain('missing_token');
  });

  test('a missing done_reason is not a finished answer either', async () => {
    const transport = make(answer('Текст', ''));
    const [reply] = Object.values(await transport.runWave([request()]));
    expect(reply.status).toBe('PARTIAL');
  });

  test('Ollama is off in the middle of a run: NO_SEND with the cause', async () => {
    const transport = make(async () => { throw new TypeError('Failed to fetch'); }, MessageDelivery);
    const [reply] = Object.values(await transport.runWave([request()]));
    expect(reply).toMatchObject({ text: '', status: 'NO_SEND', reason: 'local_unavailable' });
    expect(reply.detail).toMatch(/Ollama/);
    expect(MessageDelivery.journal().map((event) => event.kind)).toContain('no_answer');
  });

  test('a missing model (404) is also unavailable', async () => {
    const transport = make(async () => ({ ok: false, status: 404 }));
    const [reply] = Object.values(await transport.runWave([request()]));
    expect(reply.status).toBe('NO_SEND');
  });

  test('Stop breaks the call', async () => {
    const controller = new AbortController();
    const fetchImpl = jest.fn((url, options) => new Promise((resolve, reject) => {
      options.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
    }));
    const transport = make(fetchImpl, MessageDelivery);
    const pending = transport.runWave([request()], { signal: controller.signal });
    controller.abort();
    const [reply] = Object.values(await pending);
    expect(reply).toMatchObject({ status: 'CANCELLED', completion: 'cancelled', text: '' });
    expect(MessageDelivery.journal().map((event) => event.kind)).toContain('cancelled');
  });

  test('the history of a participant goes to the next call whole; reasoning blocks are not in it', async () => {
    const replies = ['<think>скрытое</think>Первый ответ.', 'Второй ответ.'];
    const fetchImpl = jest.fn(async () => ({ ok: true, status: 200, json: async () => ({ message: { content: replies.shift() }, done_reason: 'stop' }) }));
    const transport = make(fetchImpl);
    const [first] = Object.values(await transport.runWave([request({ prompt: 'Один' })]));
    expect(first.text).toBe('Первый ответ.');
    await transport.runWave([request({ prompt: 'Два' })]);
    const second = JSON.parse(fetchImpl.mock.calls[1][1].body).messages;
    expect(second).toEqual([
      { role: 'user', content: 'Один' }, { role: 'assistant', content: 'Первый ответ.' }, { role: 'user', content: 'Два' }
    ]);
    expect(JSON.stringify(second)).not.toMatch(/скрытое|think/);
  });

  test('a new chat drops the history; another participant has its own', async () => {
    const fetchImpl = jest.fn(answer('Ответ.'));
    const transport = make(fetchImpl);
    await transport.runWave([request({ prompt: 'Один' })]);
    await transport.runWave([request({ participantId: 'p2', prompt: 'Чужой' })]);
    await transport.runWave([request({ prompt: 'Новый', newChat: true })]);
    expect(JSON.parse(fetchImpl.mock.calls[1][1].body).messages).toHaveLength(1);
    expect(JSON.parse(fetchImpl.mock.calls[2][1].body).messages).toEqual([{ role: 'user', content: 'Новый' }]);
  });

  test('a request that does not fit the context is refused before the send', async () => {
    const fetchImpl = jest.fn(answer('x'));
    const transport = make(fetchImpl);
    await expect(transport.runWave([request({ prompt: 'я'.repeat(40000) })])).rejects.toMatchObject({ code: 'context_full' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  test('the history counts toward the limit', async () => {
    const transport = make(answer('ы'.repeat(12000)));
    await transport.runWave([request({ prompt: 'я'.repeat(12000), words: 10 })]);
    expect(transport.check([request({ prompt: 'я'.repeat(12000), words: 10 })])).toMatchObject({ participantId: 'p1' });
  });

  test('an empty text is a failure, not an answer', async () => {
    const transport = make(answer('<think>только мысли</think>', 'stop'));
    const [reply] = Object.values(await transport.runWave([request()]));
    expect(reply).toMatchObject({ text: '', status: 'FAILED', reason: 'empty_answer' });
    expect(transport.hasHistory('p1')).toBe(false);
  });

  test('ping: Ollama answers, or the cause is given', async () => {
    expect((await LocalModel.ping({ fetchImpl: answer('', 'load'), prepare: noPrepare })).ok).toBe(true);
    const off = await LocalModel.ping({ fetchImpl: async () => { throw new Error('x'); }, prepare: noPrepare });
    expect(off.ok).toBe(false);
    expect(off.problem.kind).toBe('service_off');
  });

  test('the acceptance of the page takes a finished reply and sends a cut one to correction', async () => {
    const judge = async (content, done) => {
      const [reply] = Object.values(await make(answer(content, done)).runWave([request()]));
      return Acceptance.evaluate({ text: reply.text, meta: { completion: reply.completion, status: reply.status, prompt: reply.sentPrompt, reason: reply.reason } });
    };
    const text = 'Полный ответ на задание, который заканчивается точкой и содержит достаточно слов, чтобы считаться настоящим ответом модели без всяких оговорок.';
    expect((await judge(text, 'stop')).ok).toBe(true);
    expect((await judge(text.slice(0, -1), 'length')).ok).toBe(false);
  });
});
