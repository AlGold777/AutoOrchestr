const Engine = require('../disput/custom-engine');

// A scripted transport: answers[model] is a list of replies, one per request to that model.
function transport(answers, { closedByOwner = false } = {}) {
  const calls = [];
  const used = {};
  const send = async (models, prompts, meta) => {
    calls.push({ models: models.slice(), prompts: { ...prompts }, meta });
    const byModel = {};
    models.forEach((model) => {
      const index = used[model] || 0;
      used[model] = index + 1;
      const reply = (answers[model] || [])[index];
      byModel[model] = typeof reply === 'object' ? reply : { text: reply || '', status: reply ? 'SUCCESS' : 'TIMEOUT' };
    });
    return { byModel, closedByOwner };
  };
  return { send, calls };
}

describe('Custom engine', () => {
  test('one setting resolver follows model, reserved round, pipeline, code; empty strings inherit', () => {
    const values = { model: 'M', round: 'R', pipeline: 'P', fallback: 'C' };
    expect(Engine.resolveSetting(values)).toEqual({ value: 'M', source: 'model' });
    expect(Engine.resolveSetting({ ...values, model: '' })).toEqual({ value: 'R', source: 'round' });
    expect(Engine.resolveSetting({ ...values, model: null, round: '  ' })).toEqual({ value: 'P', source: 'pipeline' });
    expect(Engine.resolveSetting({ fallback: 'C' })).toEqual({ value: 'C', source: 'code' });
  });

  test.each(['PERSONAL_ASK', ''])('owner instruction is personal, clearable and only active in semi-auto (%s)', async (instruction) => {
    const { send, calls } = transport({ A: ['a', 'a2'], B: ['b', 'b2'] });
    await Engine.run({ task: 'T', semiAuto: true, askInstruction: 'DEFAULT_ASK',
      steps: [{ models: [{ name: 'A', discipline: { ask: instruction } }, 'B'] }, { models: ['A', 'B'] }],
      decide: async () => 'continue', send });
    if (instruction) expect(calls[0].prompts.A).toContain(instruction);
    expect(calls[0].prompts.A).not.toContain('DEFAULT_ASK');
    expect(calls[0].prompts.B).toContain('DEFAULT_ASK');
    expect(calls[1].prompts.A).toContain('DEFAULT_ASK');
    const auto = transport({ A: ['a'] });
    await Engine.run({ task: 'T', steps: [{ models: [{ name: 'A', discipline: { ask: instruction } }] }], askInstruction: 'DEFAULT_ASK', send: auto.send });
    expect(auto.calls[0].prompts.A).not.toContain('ASK');
  });

  test('card request replaces the prompt only for its model and step; input is substituted at execution', async () => {
    const { send, calls } = transport({ A: ['first {задача}', 'improved', 'third'], B: ['other'] });
    await Engine.run({ task: 'actual task', steps: [
      { input: 'none', models: ['A'] },
      { input: 'previous', models: [{ name: 'A', promptTemplate: 'MY REQUEST: {задача}\nSOURCE: {вход}', maxWords: 77 }, 'B'] },
      { input: 'previous', models: ['A'] }
    ], send });
    expect(calls[1].prompts.A).toBe('MY REQUEST: actual task\nSOURCE: Ответ 1:\nfirst {задача}');
    expect(calls[1].prompts.B).not.toContain('MY REQUEST');
    expect(calls[2].prompts.A).not.toContain('MY REQUEST');
    expect(calls[1].meta.maxWordsByModel).toEqual({ A: 77, B: null });
  });

  test('correction retry preserves the card response length; sequential templates receive earlier answers', async () => {
    const { send, calls } = transport({ A: ['first'], B: ['', 'second'] });
    await Engine.run({ task: 'T', steps: [{ order: 'sequential', input: 'none', models: ['A',
      { name: 'B', promptTemplate: 'Use {ответы до тебя}', maxWords: 51 }] }], send });
    expect(calls[1].prompts.B).toBe('Use Ответ 1:\nfirst');
    expect(calls[2].prompts.B).toBe(Engine.correctionPrompt('empty'));
    expect(calls[1].meta.maxWordsByModel.B).toBe(51);
    expect(calls[2].meta.maxWordsByModel.B).toBe(51);
  });
  test('parallel rounds: every model gets the same input; the next round gets the accepted answers of the previous', async () => {
    const { send, calls } = transport({ A: ['a1', 'a2'], B: ['b1', 'b2'] });
    const result = await Engine.run({
      task: 'Задача T',
      steps: [
        { order: 'parallel', task: 'Ответь', input: 'none', models: ['A', 'B'] },
        { order: 'parallel', task: 'Улучши', input: 'previous', models: ['A', 'B'] }
      ],
      send
    });
    expect(calls.map((call) => call.models)).toEqual([['A', 'B'], ['A', 'B']]);
    expect(calls[0].prompts.A).toBe('Задача:\nЗадача T\n\nЗадание:\nОтветь');
    expect(calls[1].prompts.A).toContain('Ответы предыдущего шага:\n\nОтвет 1:\na1\n\nОтвет 2:\nb1');
    expect(calls[1].prompts.A).toBe(calls[1].prompts.B);
    expect(result.answers).toEqual(['a2', 'b2']);
    expect(result.stopReason).toBe('steps_done');
  });

  test('sequential: each model also gets the answers of the models before it in the step', async () => {
    const { send, calls } = transport({ A: ['a1'], B: ['b1'], C: ['c1'] });
    await Engine.run({ task: 'T', steps: [{ order: 'sequential', task: 'Добавь', input: 'none', models: ['A', 'B', 'C'] }], send });
    expect(calls.map((call) => call.models)).toEqual([['A'], ['B'], ['C']]);
    expect(calls[0].prompts.A).not.toContain('этого раунда');
    expect(calls[2].prompts.C).toContain('Ответы участников этого раунда до тебя:\n\nОтвет 1:\na1\n\nОтвет 2:\nb1');
  });

  test('a model addition goes only to that model', async () => {
    const { send, calls } = transport({ A: ['a'], B: ['b'] });
    await Engine.run({ task: 'T', steps: [{ task: 'Ответь', input: 'none', models: [{ name: 'A', extra: 'Будь критиком.' }, 'B'] }], send });
    expect(calls[0].prompts.A).toContain('Дополнительно для тебя:\nБудь критиком.');
    expect(calls[0].prompts.B).not.toContain('Дополнительно');
  });

  test('synthesis is a step: it replaces the round before it for "previous", "all" keeps both', async () => {
    const { send, calls } = transport({ A: ['a1', 'a3'], B: ['b1', 'b3'], S: ['s1'] });
    await Engine.run({
      task: 'T',
      steps: [
        { task: 'Ответь', input: 'none', models: ['A', 'B'] },
        { kind: 'synthesis', models: ['S'] },
        { task: 'Улучши', input: 'previous', models: ['A'] },
        { task: 'Итог', input: 'all', models: ['B'] }
      ],
      send
    });
    expect(calls[1].prompts.S).toContain('Ответы предыдущего шага:\n\nОтвет 1:\na1\n\nОтвет 2:\nb1');
    expect(calls[1].prompts.S).toContain(Engine.SYNTHESIS_TASK);
    expect(calls[2].prompts.A).toContain('Ответы предыдущего шага:\n\nОтвет 1:\ns1');
    expect(calls[2].prompts.A).not.toContain('b1');
    expect(calls[3].prompts.B).toContain('Раунд 1, ответ 1:\na1');
    expect(calls[3].prompts.B).toContain('Синтез после раунда 1, ответ 1:\ns1');
    expect(calls[3].prompts.B).toContain('Раунд 2, ответ 1:\na3');
  });

  test('empty and token-only answers are not accepted and get a correction retry in the same chat', async () => {
    const { send, calls } = transport({ A: [{ text: '', status: 'SUCCESS', answered: true }, 'a1'], B: ['b1'] });
    const result = await Engine.run({ task: 'T', steps: [{ task: 'Ответь', input: 'none', models: ['A', 'B'] }], send });
    expect(calls[1].models).toEqual(['A']);
    expect(calls[1].prompts.A).toBe(Engine.correctionPrompt('token_only'));
    expect(result.steps[0].outcome.A).toMatchObject({ ok: true, attempt: 2, text: 'a1' });
    expect(result.history.map((item) => `${item.model}${item.attempt}:${item.accepted ? 'ok' : item.reason}`)).toEqual(['A1:token_only', 'B1:ok', 'A2:ok']);
  });

  test('the shared acceptance check rejects a cut-off answer', async () => {
    const { send, calls } = transport({ A: ['обрыв на сере', 'полный ответ.'] });
    const accept = ({ text }) => (text.endsWith('.') ? { ok: true } : { ok: false, reason: 'incomplete_ending' });
    const result = await Engine.run({ task: 'T', steps: [{ task: 'x', input: 'none', models: ['A'] }], send, accept });
    expect(calls[1].prompts.A).toContain('оборван на середине');
    expect(result.answers).toEqual(['полный ответ.']);
  });

  test('Auto goes on with a partial step; the missing model is in the history', async () => {
    const { send } = transport({ A: ['a1', 'a2'], B: [] });
    const decide = jest.fn();
    const result = await Engine.run({
      task: 'T', steps: [{ task: 'x', input: 'none', models: ['A', 'B'] }, { task: 'y', input: 'previous', models: ['A'] }], send, decide
    });
    expect(decide).not.toHaveBeenCalled();
    expect(result.steps[0].outcome.B).toMatchObject({ ok: false, attempt: 2 });
    expect(result.answers).toEqual(['a2']);
  });

  test('no accepted answer: the owner chooses retry, skip or stop — never continue', async () => {
    const { send, calls } = transport({ A: ['', '', 'a1'], B: ['b2'] });
    const decide = jest.fn(async ({ choices }) => (choices.includes('retry') ? 'retry' : 'continue'));
    const result = await Engine.run({
      task: 'T', steps: [{ task: 'x', input: 'none', models: ['A'] }, { task: 'y', input: 'previous', models: ['B'] }], send, decide
    });
    expect(decide.mock.calls[0][0]).toMatchObject({ accepted: [], failed: ['A'], choices: ['retry', 'skip', 'stop'] });
    expect(calls.filter((call) => call.models[0] === 'A')).toHaveLength(3);
    expect(calls[3].prompts.B).toContain('Ответ 1:\na1');
    expect(result.stopReason).toBe('steps_done');
  });

  test('a skipped step passes nothing: the next step gets the last step with accepted answers', async () => {
    const { send, calls } = transport({ A: ['a1'], B: [], C: ['c1'] });
    await Engine.run({
      task: 'T',
      steps: [{ task: 'x', input: 'none', models: ['A'] }, { task: 'y', input: 'previous', models: ['B'] }, { task: 'z', input: 'previous', models: ['C'] }],
      send, decide: async () => 'skip'
    });
    expect(calls[calls.length - 1].prompts.C).toContain('Ответ 1:\na1');
  });

  test('semi-automatic pauses after every step; stop keeps what was collected', async () => {
    const { send, calls } = transport({ A: ['a1', 'a2'] });
    const decide = jest.fn(async () => 'stop');
    const result = await Engine.run({
      task: 'T', semiAuto: true, steps: [{ task: 'x', input: 'none', models: ['A'] }, { task: 'y', input: 'previous', models: ['A'] }], send, decide
    });
    expect(decide.mock.calls[0][0]).toMatchObject({ accepted: ['A'], failed: [], choices: ['continue', 'stop'] });
    expect(calls).toHaveLength(1);
    expect(result).toMatchObject({ stopReason: 'stopped', answers: ['a1'] });
  });

  test('closing a step by the owner takes what was collected without retries', async () => {
    const { send, calls } = transport({ A: ['a1'], B: [] }, { closedByOwner: true });
    const result = await Engine.run({ task: 'T', steps: [{ task: 'x', input: 'none', models: ['A', 'B'] }], send });
    expect(calls).toHaveLength(1);
    expect(result.steps[0].outcome.B).toMatchObject({ ok: false, reason: 'closed_by_owner' });
  });

  test('a prompt over the budget stops the run before sending', async () => {
    const { send, calls } = transport({ A: ['x'.repeat(200)], B: ['y'] });
    const result = await Engine.run({
      task: 'T', maxPromptChars: 150,
      steps: [{ task: 'x', input: 'none', models: ['A'] }, { task: 'y', input: 'previous', models: ['B'] }], send
    });
    expect(calls).toHaveLength(1);
    expect(result).toMatchObject({ stopReason: 'context_full', answers: ['x'.repeat(200)] });
  });

  test('a correction request is checked against the budget before it is sent', async () => {
    const { send, calls } = transport({ A: ['', 'fixed'] });
    const sent = [];
    const result = await Engine.run({
      task: 'T', maxPromptChars: 50, onRequest: (entry) => sent.push(entry.prompt.length),
      steps: [{ task: 'x', input: 'none', models: ['A'] }], send
    });
    expect(calls).toHaveLength(1);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toBeLessThanOrEqual(50);
    expect(result.stopReason).toBe('context_full');
    expect(Math.max(...result.history.map((entry) => entry.prompt.length))).toBeLessThanOrEqual(50);
  });

  test('a correction request that fits the budget is sent', async () => {
    const { send, calls } = transport({ A: ['', 'fixed'] });
    const result = await Engine.run({ task: 'T', maxPromptChars: 500, steps: [{ task: 'x', input: 'none', models: ['A'] }], send });
    expect(calls).toHaveLength(2);
    expect(result.stopReason).toBe('steps_done');
  });

  test('Stop during a request: the run ends as cancelled with what was collected', async () => {
    const controller = new AbortController();
    const send = async (models) => {
      if (models[0] === 'B') { controller.abort(); throw new DOMException('cancelled', 'AbortError'); }
      return { byModel: { [models[0]]: { text: 'a1', status: 'SUCCESS' } } };
    };
    const result = await Engine.run({
      task: 'T', signal: controller.signal, send,
      steps: [{ task: 'x', input: 'none', models: ['A'] }, { task: 'y', input: 'previous', models: ['B'] }]
    });
    expect(result).toMatchObject({ stopReason: 'cancelled', answers: ['a1'] });
  });

  test('Stop in the middle of a sequential step keeps the answers already accepted in it', async () => {
    const controller = new AbortController();
    const send = async (models) => {
      if (models[0] === 'B') { controller.abort(); throw new DOMException('cancelled', 'AbortError'); }
      return { byModel: { A: { text: 'a1', status: 'SUCCESS' } } };
    };
    const result = await Engine.run({
      task: 'T', signal: controller.signal, send, steps: [{ order: 'sequential', task: 'x', input: 'none', models: ['A', 'B'] }]
    });
    expect(result).toMatchObject({ stopReason: 'cancelled', answers: ['a1'] });
  });

  test('Stop while the owner decides ends the run with what was collected', async () => {
    const controller = new AbortController();
    const { send } = transport({ A: ['a1'] });
    const decide = () => { setTimeout(() => controller.abort(), 0); return new Promise(() => {}); };
    const result = await Engine.run({
      task: 'T', semiAuto: true, signal: controller.signal, send, decide,
      steps: [{ task: 'x', input: 'none', models: ['A'] }, { task: 'y', input: 'previous', models: ['A'] }]
    });
    expect(result).toMatchObject({ stopReason: 'cancelled', answers: ['a1'] });
  });

  test('Stop while the owner answers [[ASK]] ends the run with what was collected', async () => {
    const controller = new AbortController();
    const { send, calls } = transport({ A: ['a1\n[[ASK: Срок? || неделя || месяц]]'], B: ['b1'] });
    const result = await Engine.run({
      task: 'T', signal: controller.signal, send,
      steps: [{ task: 'x', input: 'none', models: ['A'] }, { task: 'y', input: 'previous', models: ['B'] }],
      parseAsks: () => [{ question: 'Срок?' }],
      askOwner: async () => { controller.abort(); throw new DOMException('cancelled', 'AbortError'); }
    });
    expect(calls).toHaveLength(1);
    expect(result).toMatchObject({ stopReason: 'cancelled' });
    expect(result.answers[0]).toContain('a1');
  });

  test('closing a sequential step by the owner closes the whole step: later models are not called', async () => {
    const { send, calls } = transport({ A: ['a1'], B: ['b1'], C: ['c1'] }, { closedByOwner: true });
    const result = await Engine.run({ task: 'T', steps: [{ order: 'sequential', task: 'x', input: 'none', models: ['A', 'B', 'C'] }], send });
    expect(calls.map((call) => call.models)).toEqual([['A']]);
    expect(result.steps[0].outcome.A).toMatchObject({ ok: true, text: 'a1' });
    expect(result.steps[0].outcome.B).toMatchObject({ ok: false, reason: 'closed_by_owner' });
    expect(result.steps[0].outcome.C).toMatchObject({ ok: false, reason: 'closed_by_owner' });
  });

  test('[[ASK]] goes to the owner; the answer reaches the next steps', async () => {
    const { send, calls } = transport({ A: ['a1\n[[ASK: Срок? || неделя || месяц]]'], B: ['b1'] });
    await Engine.run({
      task: 'T',
      steps: [{ task: 'x', input: 'none', models: ['A'] }, { task: 'y', input: 'none', models: ['B'] }],
      send,
      parseAsks: (value) => (/\[\[ASK: ([^|]+)/.exec(value) ? [{ question: /\[\[ASK: ([^|]+)/.exec(value)[1].trim() }] : []),
      askOwner: async (asks) => asks.map((item) => ({ question: item.question, answer: 'неделя' }))
    });
    expect(calls[1].prompts.B).toContain('Ответы владельца на вопросы:\n- Срок?: неделя');
  });

  test('the journal names step, model, attempt, input and the request id', async () => {
    const events = [];
    const send = async () => ({ byModel: { A: { text: 'a', status: 'SUCCESS', transportRequestId: 'tr-1' } } });
    await Engine.run({ task: 'T', steps: [{ task: 'x', input: 'none', models: ['A'] }], send, onEvent: (kind, fields) => events.push({ kind, ...fields }) });
    expect(events.find((item) => item.kind === 'custom_answer')).toMatchObject({
      step: 0, label: 'Раунд 1', model: 'A', attempt: 1, input: 'none', accepted: true, transportRequestId: 'tr-1'
    });
    expect(events[events.length - 1]).toMatchObject({ kind: 'custom_end', stopReason: 'steps_done' });
    expect(events[0]).toMatchObject({ kind: 'custom_start', semiAuto: false, taskChars: 1,
      steps: [{ step: 0, label: 'Раунд 1', order: 'parallel', input: 'none', models: ['A'] }] });
  });
});
