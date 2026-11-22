const LocalModel = require('../disput/local-model');

const M4 = 'qwen3.5:4b-mlx';
const quote = 'Извините, не могу ответить';

describe('answer label', () => {
  beforeEach(() => { LocalModel.setModel(M4); });
  afterEach(() => { LocalModel.setModel(''); });

  test('the request: question 1000, answer 2000 + 2000, schema, options', () => {
    const answer = `${'a'.repeat(2000)}${'m'.repeat(500)}${'z'.repeat(2000)}b`;
    const body = LocalModel.buildAnswerLabelRequest('q'.repeat(1500), answer, 'контекст');
    const user = body.messages[1].content;
    expect(body.messages[0]).toEqual({ role: 'system', content: 'контекст' });
    expect(user).toContain('q'.repeat(1000));
    expect(user).not.toContain('q'.repeat(1001));
    expect(user).toContain(`${'a'.repeat(2000)}\n…\n${'z'.repeat(1999)}b`);
    expect(user).not.toContain('m');
    expect(body).toMatchObject({ stream: false, think: false, keep_alive: '10m', model: M4 });
    expect(body.format.properties.label.enum).toEqual(Object.keys(LocalModel.ANSWER_LABELS));
    expect(body.format.required).toEqual(['label', 'quote']);
    expect(body.options).toEqual({ temperature: 0, num_ctx: 8192, num_predict: 160 });
    expect(LocalModel.buildAnswerLabelRequest('q', 'short').messages).toHaveLength(1);
  });

  test('checkAnswerLabel', () => {
    const answer = `${quote} на это.`;
    expect(LocalModel.checkAnswerLabel('{bad', answer).problem.kind).toBe('bad_reply');
    expect(LocalModel.checkAnswerLabel(JSON.stringify({ label: 'maybe', quote: '' }), answer).problem.kind).toBe('bad_reply');
    expect(LocalModel.checkAnswerLabel(JSON.stringify({ label: 'ok', quote: '' }), answer)).toEqual({});
    expect(LocalModel.checkAnswerLabel(JSON.stringify({ label: 'unclear', quote: '' }), answer)).toEqual({});
    expect(LocalModel.checkAnswerLabel(JSON.stringify({ label: 'refusal', quote: 'Это выдумка модели' }), answer).problem.kind).toBe('quote_rejected');
    expect(LocalModel.checkAnswerLabel(JSON.stringify({ label: 'refusal', quote }), answer).result).toEqual({ label: 'refusal', quote });
    expect(LocalModel.checkAnswerLabel(JSON.stringify({ label: 'cut_off', quote: 'Извините…на это' }), answer).result.label).toBe('cut_off');
  });

  test('the line for the owner', () => {
    expect(LocalModel.answerLabelLine('GPT', { label: 'refusal', quote: 'цитата' })).toBe('GPT: похоже на отказ. «цитата»');
    expect(LocalModel.answerLabelLine('GPT', { label: 'cut_off', quote: 'q' })).toContain('оборван');
    expect(LocalModel.answerLabelLine('GPT', { label: 'off_topic', quote: 'q' })).toContain('не на вопрос');
  });

  test('labelAnswer goes through post with owner_hint priority, logs problems, never throws', async () => {
    const answer = `${quote} на это.`;
    const reply = (content) => jest.fn(async () => ({ ok: true, status: 200, json: async () => ({ message: { content } }) }));
    const log = jest.fn();
    const good = reply(JSON.stringify({ label: 'refusal', quote }));
    await expect(LocalModel.labelAnswer({ prompt: 'q', answer, participant: 'GPT' }, { fetchImpl: good, log })).resolves.toEqual({ label: 'refusal', quote });
    expect(JSON.parse(good.mock.calls[0][1].body).format.required).toEqual(['label', 'quote']);
    await expect(LocalModel.labelAnswer({ prompt: 'q', answer, participant: 'GPT' }, { fetchImpl: reply(JSON.stringify({ label: 'refusal', quote: 'выдумка выдумка' })), log })).resolves.toBeNull();
    expect(log).toHaveBeenCalledWith('quote_rejected', expect.stringContaining('GPT'));
    await expect(LocalModel.labelAnswer({ prompt: 'q', answer, participant: 'GPT' }, { fetchImpl: jest.fn(async () => { throw new Error('off'); }), log })).resolves.toBeNull();
    expect(log).toHaveBeenCalledWith('service_off', expect.any(String));
    await expect(LocalModel.labelAnswer(undefined, { fetchImpl: jest.fn(), log })).resolves.toBeNull();
  });
});
