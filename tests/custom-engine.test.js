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
    expect(calls[2].prompts.B).toBe('Use Ответ 1:\nfirst'); // empty: the same request again, not a correction
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
    const { send, calls } = transport({ A: ['cut', 'fixed.'] });
    const accept = ({ text }) => (text.endsWith('.') ? { ok: true } : { ok: false, reason: 'incomplete_ending' });
    const sent = [];
    const result = await Engine.run({
      task: 'T', maxPromptChars: 50, accept, onRequest: (entry) => sent.push(entry.prompt.length),
      steps: [{ task: 'x', input: 'none', models: ['A'] }], send
    });
    expect(calls).toHaveLength(1);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toBeLessThanOrEqual(50);
    expect(result.stopReason).toBe('context_full');
    expect(Math.max(...result.history.map((entry) => entry.prompt.length))).toBeLessThanOrEqual(50);
  });

  test('no text at all: the same request is sent again, not a correction', async () => {
    const { send, calls } = transport({ A: ['', 'second'] });
    await Engine.run({ task: 'T', steps: [{ task: 'x', input: 'none', models: ['A'] }], send });
    expect(calls[1].prompts.A).toBe(calls[0].prompts.A);
    expect(calls[1].prompts.A).not.toContain('Твой предыдущий ответ');
  });

  test('a correction request that fits the budget is sent', async () => {
    const { send, calls } = transport({ A: ['cut', 'fixed.'] });
    const accept = ({ text }) => (text.endsWith('.') ? { ok: true } : { ok: false, reason: 'incomplete_ending' });
    const result = await Engine.run({ task: 'T', maxPromptChars: 500, accept, steps: [{ task: 'x', input: 'none', models: ['A'] }], send });
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

// Fail-closed (A02, pack P02 step 1): a field the engine does not execute stops the run before the first request,
// with the address of the step. Nothing is replaced silently and no request is sent.
describe('Custom engine refuses what it does not execute yet', () => {
  const ask = () => transport({ A: ['a1'], B: ['b1'] });
  const cases = [
    ['a gate without criteria', [{ ref: 'gate:g1', kind: 'gate', models: [{ name: 'A' }] }], 'invalid_field', 'criteria'],
    ['a gate with a transition on pass (not yet executed)', [{ ref: 'gate:g1', kind: 'gate', criteria: ['c'], onPass: { goto: 'r1' }, models: [{ name: 'A' }] }], 'unsupported_field', 'onPass'],
    ['a gate with pass other than all or any', [{ ref: 'gate:g1', kind: 'gate', criteria: ['c'], pass: 'most', models: [{ name: 'A' }] }], 'invalid_field', 'pass'],
    ['a route with no models is not dropped', [{ ref: 'route:x', kind: 'route', models: [] }], 'unsupported_kind', 'route:x'],
    ['an owner step', [{ ref: 'owner:o', kind: 'owner', models: [] }], 'unsupported_kind', 'owner:o'],
    ['an output format other than json', [{ ref: 'r1', kind: 'round', output: { format: 'xml' }, models: ['A'] }], 'unsupported_field', 'output.format'],
    ['an empty list of artifacts', [{ ref: 'r1', kind: 'round', output: { format: 'json', requiredFields: ['/m'], artifacts: [] }, models: ['A'] }], 'invalid_field', 'output.artifacts'],
    ['require other than any, all or a number', [{ ref: 'r1', kind: 'round', require: 'some', models: ['A', 'B'] }], 'invalid_field', 'require'],
    ['an owner value other than approve', [{ ref: 'r1', kind: 'round', owner: 'sign', models: ['A'] }], 'invalid_field', 'owner'],
    ['chat new', [{ ref: 'r1', kind: 'round', chat: 'new', models: ['A'] }], 'unsupported_field', 'chat'],
    ['an artifact source without its version', [{ ref: 'r1', kind: 'round', models: ['A'] }, { ref: 'r2', kind: 'round', input: [{ artifact: { step: 'r1', participant: 'A', id: 'map' } }], models: ['B'] }], 'invalid_input', 'r2'],
    ['a string input that is not a value', [{ ref: 'r1', kind: 'round', input: 'some', models: ['A'] }], 'invalid_input', 'r1'],
    ['a synthesis with input all', [{ ref: 'r1', kind: 'round', models: ['A'] }, { ref: 'synth:s', kind: 'synthesis', input: 'all', models: ['B'] }], 'invalid_input', 'synth:s'],
    ['two participants of one model', [{ ref: 'r1', kind: 'round', models: ['A', 'A'] }], 'participant_transport_required', 'r1']
  ];
  test.each(cases)('%s stops the run before any request (%s)', async (_label, steps, code, mention) => {
    const { send, calls } = ask();
    const error = await Engine.run({ task: 'T', steps, send }).catch((item) => item);
    expect(error).toBeInstanceOf(Engine.EngineError);
    expect(error.code).toBe(code);
    expect(error.message).toContain(mention);
    expect(calls).toHaveLength(0);
  });

  test('a later unsupported step is refused before the first step is sent', async () => {
    const { send, calls } = ask();
    await expect(Engine.run({ task: 'T', send, steps: [{ ref: 'r1', kind: 'round', models: ['A'] }, { ref: 'r2', kind: 'round', chat: 'new', models: ['B'] }] }))
      .rejects.toMatchObject({ code: 'unsupported_field' });
    expect(calls).toHaveLength(0);
  });

  test('the executed fields still run: any, continue, a plain input, a synthesis with previous', async () => {
    const { send, calls } = ask();
    const result = await Engine.run({ task: 'T', send, steps: [
      { ref: 'r1', kind: 'round', require: 'any', owner: undefined, chat: 'continue', input: 'none', models: ['A'] },
      { ref: 'synth:s', kind: 'synthesis', input: 'previous', models: ['B'] }
    ] });
    expect(result.stopReason).toBe('steps_done');
    expect(calls).toHaveLength(2);
  });

  test('the preview of an unsupported step gives no prompt; a supported step still has one', () => {
    const steps = [{ ref: 'r1', kind: 'round', models: ['A'] }, { ref: 'r2', kind: 'round', chat: 'new', models: ['A'] }];
    expect(Engine.previewPrompt({ task: 'T', steps, stepIndex: 1, modelName: 'A' })).toBeNull();
    expect(Engine.previewPrompt({ task: 'T', steps, stepIndex: 0, modelName: 'A' }).label).toBe('Раунд 1');
  });
});

// Addressed inputs (4.3, A02 step 2): a string is all accepted answers of a step, an object is one participant's
// answer; a list keeps its order; required missing stops the run before the first request; nothing is replaced.
describe('Custom engine addressed inputs', () => {
  const twoRounds = (extra = []) => [
    { ref: 'r1', kind: 'round', input: 'none', models: ['A', 'B'] },
    { ref: 'r2', kind: 'round', input: 'none', models: ['C', 'D'] },
    ...extra
  ];

  test('a list gives exactly the chosen answers, in the order of the list, each with step, participant and visit', async () => {
    const { send, calls } = transport({ A: ['a1', 'a3'], B: ['b1', 'b3'], C: ['c1'], D: ['d1'], E: ['e1'] });
    await Engine.run({ task: 'T', send, steps: [
      { ref: 'r1', kind: 'round', input: 'none', models: ['A', 'B'] },
      { ref: 'r2', kind: 'round', input: 'none', models: ['C', 'D'] },
      { ref: 'r3', kind: 'round', input: [{ step: 'r2', participant: 'D' }, 'r1'], models: ['E'] }
    ] });
    const prompt = calls[2].prompts.E;
    expect(prompt).toContain('Ответы выбранных источников:\n\nРаунд 2, участник D, визит 1:\nd1\n\nРаунд 1, участник A, визит 1:\na1\n\nРаунд 1, участник B, визит 1:\nb1');
    expect(prompt).not.toContain('c1');
  });

  test('a participant that failed is not replaced by the nearest accepted answer', async () => {
    const { send, calls } = transport({ A: ['a1'], B: [], C: ['c1'] });
    await Engine.run({ task: 'T', send, steps: [
      { ref: 'r1', kind: 'round', input: 'none', models: ['A', 'B'] },
      { ref: 'r2', kind: 'round', input: [{ step: 'r1', participant: 'B' }], models: ['C'] }
    ] });
    expect(calls[calls.length - 1].models).toEqual(['C']);
    expect(calls[calls.length - 1].prompts.C).not.toContain('a1');
    expect(calls[calls.length - 1].prompts.C).not.toContain('Ответы выбранных');
  });

  test('a required source without an actual answer stops the run before the request; nothing is sent', async () => {
    const { send, calls } = transport({ A: ['a1'], B: [], C: ['c1'] });
    const result = await Engine.run({ task: 'T', send, steps: [
      { ref: 'r1', kind: 'round', input: 'none', models: ['A', 'B'] },
      { ref: 'r2', kind: 'round', input: [{ step: 'r1', participant: 'B', required: true }], models: ['C'] }
    ] });
    expect(result).toMatchObject({ stopReason: 'missing_input', stopDetail: expect.stringContaining('r1') });
    expect(result.stopDetail).toContain('B');
    expect(calls.some((call) => call.models.includes('C'))).toBe(false);
  });

  test('an optional source without an answer gives no text; the others still go in', async () => {
    const { send, calls } = transport({ A: ['a1'], B: [], C: ['c1'], E: ['e1'] });
    const result = await Engine.run({ task: 'T', send, steps: [
      { ref: 'r1', kind: 'round', input: 'none', models: ['A', 'B'] },
      { ref: 'r2', kind: 'round', input: 'none', models: ['C'] },
      { ref: 'r3', kind: 'round', input: [{ step: 'r1', participant: 'B' }, { step: 'r2', participant: 'C', required: true }, { step: 'r9', participant: 'Z' }], models: ['E'] }
    ] });
    expect(result.stopReason).toBe('steps_done');
    const prompt = calls[calls.length - 1].prompts.E;
    expect(prompt).toContain('Раунд 2, участник C, визит 1:\nc1');
    expect(prompt).not.toContain('Раунд 1');
  });

  test('a switched-off step (not in the list) gives nothing: optional is empty, required stops', async () => {
    const first = transport({ A: ['a1', 'a2'] });
    const optional = await Engine.run({ task: 'T', send: first.send, steps: [
      { ref: 'r1', kind: 'round', input: 'none', models: ['A'] },
      { ref: 'r2', kind: 'round', input: ['r9'], models: ['A'] }
    ] });
    expect(optional.stopReason).toBe('steps_done');
    expect(first.calls[1].prompts.A).not.toContain('Ответы выбранных');
    const { send } = transport({ A: ['a1'] });
    const required = await Engine.run({ task: 'T', send, steps: [
      { ref: 'r1', kind: 'round', input: 'none', models: ['A'] },
      { ref: 'r2', kind: 'round', input: [{ step: 'r9', participant: 'Z', required: true }], models: ['A'] }
    ] });
    expect(required.stopReason).toBe('missing_input');
  });

  test('a synthesis takes a list too; the answers of the list reach its request', async () => {
    const { send, calls } = transport({ A: ['a1'], B: ['b1'], S: ['s1'] });
    await Engine.run({ task: 'T', send, steps: [
      { ref: 'r1', kind: 'round', input: 'none', models: ['A'] },
      { ref: 'r2', kind: 'round', input: 'none', models: ['B'] },
      { ref: 'synth:s', kind: 'synthesis', input: ['r1'], models: ['S'] }
    ] });
    expect(calls[2].prompts.S).toContain('Раунд 1, участник A, визит 1:\na1');
    expect(calls[2].prompts.S).not.toContain('b1');
  });

  test('a source that is malformed, names an unknown participant or a later step is refused before the first request', async () => {
    const { send, calls } = transport({ A: ['a1'], B: ['b1'] });
    const base = { ref: 'r1', kind: 'round', input: 'none', models: ['A'] };
    const cases = [
      [[{ step: 'r1' }], 'invalid_input'],
      [[42], 'invalid_input'],
      [[{ step: 'r1', participant: 'Z' }], 'invalid_input'],
      [['r2'], 'invalid_input']
    ];
    for (const [input, code] of cases) {
      const error = await Engine.run({ task: 'T', send, steps: [base, { ref: 'r2', kind: 'round', input, models: ['B'] }] }).catch((item) => item);
      expect(error).toMatchObject({ code });
    }
    expect(calls).toHaveLength(0);
  });

  test('the preview shows that the answers of the chosen steps come at the run', () => {
    const steps = [{ ref: 'r1', kind: 'round', models: ['A'] }, { ref: 'r2', kind: 'round', input: [{ step: 'r1', participant: 'A' }], models: ['A'] }];
    expect(Engine.previewPrompt({ task: 'T', steps, stepIndex: 1, modelName: 'A' }).prompt)
      .toContain('‹ответы выбранных этапов появятся при запуске›');
  });
});

// Participants (A02, pack P02 step 3): a participant is an id; two participants of one model are two requests
// through sendParticipants; a participant's own input replaces the shared one; the answers before a participant
// in a sequential round stay a separate block.
describe('Custom engine participants', () => {
  // A transport with participant ids: replies[participantId] is a list, one reply per request to that participant.
  function participantTransport(replies) {
    const calls = [];
    const used = {};
    const sendParticipants = async (requests, meta) => {
      calls.push({ requests: requests.map((item) => ({ ...item })), meta });
      const byParticipant = {};
      requests.forEach(({ participantId }) => {
        const index = used[participantId] || 0;
        used[participantId] = index + 1;
        const reply = (replies[participantId] || [])[index];
        byParticipant[participantId] = typeof reply === 'object' ? reply : { text: reply || '', status: reply ? 'SUCCESS' : 'TIMEOUT' };
      });
      return { byParticipant, closedByOwner: false };
    };
    return { sendParticipants, calls };
  }
  const expert = (id, extra = {}) => ({ name: 'GPT', id, ...extra });

  test('two participants of one model are two requests with their ids, chat and step; results are keyed by id', async () => {
    const { sendParticipants, calls } = participantTransport({ 'expert-A': ['a1'], 'expert-B': ['b1'] });
    const result = await Engine.run({ task: 'T', sendParticipants, steps: [
      { ref: 'r1', kind: 'round', input: 'none', models: [expert('expert-A'), expert('expert-B')] }
    ] });
    expect(calls[0].requests).toEqual([
      expect.objectContaining({ participantId: 'expert-A', modelName: 'GPT', chat: 'continue', stepRef: 'r1', visit: 1, attempt: 1 }),
      expect.objectContaining({ participantId: 'expert-B', modelName: 'GPT', chat: 'continue', stepRef: 'r1', visit: 1, attempt: 1 })
    ]);
    expect(result.steps[0].outcome['expert-A']).toMatchObject({ ok: true, text: 'a1' });
    expect(result.steps[0].outcome['expert-B']).toMatchObject({ ok: true, text: 'b1' });
    expect(result.answers).toEqual(['a1', 'b1']);
  });

  test('two participants of one model without sendParticipants are refused before the first request', async () => {
    const { sendParticipants } = participantTransport({});
    const legacy = transport({ GPT: ['x'] });
    await expect(Engine.run({ task: 'T', send: legacy.send, steps: [{ ref: 'r1', kind: 'round', input: 'none', models: [expert('expert-A'), expert('expert-B')] }] }))
      .rejects.toMatchObject({ code: 'participant_transport_required' });
    expect(legacy.calls).toHaveLength(0);
    expect(sendParticipants).toBeDefined();
  });

  test('a participant with its own input gets that input only; the shared input goes to the others', async () => {
    const { sendParticipants, calls } = participantTransport({ 'expert-A': ['a1'], 'expert-B': ['b1'], 'expert-C': ['c1'] });
    await Engine.run({ task: 'T', sendParticipants, steps: [
      { ref: 'r1', kind: 'round', input: 'none', models: [{ name: 'GPT', id: 'expert-A' }] },
      { ref: 'r2', kind: 'round', input: 'previous', models: [expert('expert-B', { input: 'none' }), expert('expert-C')] }
    ] });
    const second = calls[1].requests;
    expect(second.find((item) => item.participantId === 'expert-B').prompt).not.toContain('Ответы предыдущего шага');
    expect(second.find((item) => item.participantId === 'expert-C').prompt).toContain('Ответы предыдущего шага:\n\nОтвет 1:\na1');
  });

  test('a participant input replaces the shared one; it does not add to it', async () => {
    const { sendParticipants, calls } = participantTransport({ 'expert-A': ['a1'], 'expert-B': ['b1'], 'expert-C': ['c1'] });
    await Engine.run({ task: 'T', sendParticipants, steps: [
      { ref: 'r1', kind: 'round', input: 'none', models: [{ name: 'GPT', id: 'expert-A' }, { name: 'Gemini', id: 'expert-B' }] },
      { ref: 'r2', kind: 'round', input: 'previous', models: [expert('expert-C', { input: [{ step: 'r1', participant: 'expert-B' }] })] }
    ] });
    const prompt = calls[1].requests[0].prompt;
    expect(prompt).toContain('Ответы выбранных источников:\n\nРаунд 1, участник expert-B, визит 1:\nb1');
    expect(prompt).not.toContain('a1');
  });

  test('in a sequential round the answers before a participant stay a separate block even when its input is none', async () => {
    const { sendParticipants, calls } = participantTransport({ 'expert-A': ['a1'], 'expert-B': ['b1'] });
    await Engine.run({ task: 'T', sendParticipants, steps: [
      { ref: 'r1', kind: 'round', order: 'sequential', input: 'none', models: [expert('expert-A'), expert('expert-B', { input: 'none' })] }
    ] });
    expect(calls[1].requests[0].prompt).toContain('Ответы участников этого раунда до тебя:\n\nОтвет 1:\na1');
  });

  test('a retry sends only the failed participant, under the same id, in its own chat', async () => {
    const { sendParticipants, calls } = participantTransport({ 'expert-A': ['a1'], 'expert-B': ['', 'b2'] });
    const result = await Engine.run({ task: 'T', sendParticipants, steps: [
      { ref: 'r1', kind: 'round', input: 'none', models: [expert('expert-A'), expert('expert-B')] }
    ] });
    expect(calls).toHaveLength(2);
    expect(calls[1].requests.map((item) => item.participantId)).toEqual(['expert-B']);
    expect(calls[1].requests[0]).toMatchObject({ attempt: 2, chat: 'continue' });
    expect(result.steps[0].outcome['expert-A']).toMatchObject({ ok: true, attempt: 1 });
    expect(result.steps[0].outcome['expert-B']).toMatchObject({ ok: true, attempt: 2, text: 'b2' });
  });

  test('a participant id that differs from its name is still one participant for the legacy send', async () => {
    const { send, calls } = transport({ GPT: ['g1'] });
    const result = await Engine.run({ task: 'T', send, steps: [{ ref: 'r1', kind: 'round', input: 'none', models: [{ name: 'GPT', id: 'expert-A' }] }] });
    expect(calls[0].models).toEqual(['GPT']);
    expect(result.steps[0].outcome['expert-A']).toMatchObject({ ok: true, model: 'GPT', text: 'g1' });
  });

  test('two participants with the same id in one step are refused before the first request', async () => {
    const { sendParticipants, calls } = participantTransport({});
    await expect(Engine.run({ task: 'T', sendParticipants, steps: [{ ref: 'r1', kind: 'round', input: 'none', models: [expert('same'), expert('same')] }] }))
      .rejects.toMatchObject({ code: 'participant_duplicate' });
    expect(calls).toHaveLength(0);
  });

  test('a participant input that names a missing participant is refused before the first request', async () => {
    const { sendParticipants, calls } = participantTransport({});
    await expect(Engine.run({ task: 'T', sendParticipants, steps: [
      { ref: 'r1', kind: 'round', input: 'none', models: [expert('expert-A')] },
      { ref: 'r2', kind: 'round', input: 'none', models: [expert('expert-B', { input: [{ step: 'r1', participant: 'nobody' }] })] }
    ] })).rejects.toMatchObject({ code: 'invalid_input' });
    expect(calls).toHaveLength(0);
  });
});

// Output (A02, pack P02 step 4): the answer is checked by the output of its step after the technical acceptance;
// the failed participant is sent a correction that names the section, the pointer or the limit; the accepted one is not sent again.
describe('Custom engine output check', () => {
  test('a missing section is a rejection that names the section; only the rejected participant is corrected', async () => {
    const { send, calls } = transport({ A: ['Карта: готово\nЗамечания: нет'], B: ['Только текст', 'Карта\nЗамечания'] });
    const result = await Engine.run({ task: 'T', send, steps: [
      { ref: 'r1', kind: 'round', input: 'none', output: { name: 'Аудит', sections: ['Карта', 'Замечания'] }, models: ['A', 'B'] }
    ] });
    expect(calls[1].models).toEqual(['B']);
    expect(calls[1].prompts.B).toBe('Твой предыдущий ответ не содержит раздел «Карта». Дай ответ на задание полностью.');
    expect(result.history.find((item) => item.model === 'B' && item.attempt === 1)).toMatchObject({ accepted: false, reason: 'missing_section', detail: '«Карта»' });
    expect(result.steps[0].outcome.B).toMatchObject({ ok: true, attempt: 2 });
    expect(result.steps[0].outcome.A).toMatchObject({ ok: true, attempt: 1 });
  });

  test('the sections are found in any case; the answer with them is accepted', async () => {
    const { send } = transport({ A: ['КАРТА\nзамечания'] });
    const result = await Engine.run({ task: 'T', send, steps: [{ ref: 'r1', kind: 'round', input: 'none', output: { sections: ['Карта', 'Замечания'] }, models: ['A'] }] });
    expect(result.steps[0].outcome.A).toMatchObject({ ok: true });
  });

  test('a strict length: exactly the model limit is allowed, one word more is too_long with the count', async () => {
    const five = 'один два три четыре пять';
    const { send } = transport({ A: [five], B: [`${five} шесть`, five] });
    const result = await Engine.run({ task: 'T', send, steps: [
      { ref: 'r1', kind: 'round', input: 'none', output: { strictLength: true }, models: [{ name: 'A', maxWords: 5 }, { name: 'B', maxWords: 5 }] }
    ] });
    expect(result.steps[0].outcome.A).toMatchObject({ ok: true, attempt: 1 });
    expect(result.history.find((item) => item.model === 'B' && item.attempt === 1)).toMatchObject({ accepted: false, reason: 'too_long', detail: '(6 из 5 слов)' });
    expect(result.steps[0].outcome.B).toMatchObject({ ok: true, attempt: 2 });
  });

  test('without the model limit the run limit applies (default 300 words): 300 is allowed, 301 is not', async () => {
    const words300 = Array.from({ length: 300 }, (_, index) => `w${index}`).join(' ');
    const { send } = transport({ A: [`${words300} лишнее`, words300] });
    const result = await Engine.run({ task: 'T', send, steps: [{ ref: 'r1', kind: 'round', input: 'none', output: { strictLength: true }, models: ['A'] }] });
    expect(result.steps[0].outcome.A).toMatchObject({ ok: true, attempt: 2 });
    expect(result.history[0]).toMatchObject({ attempt: 1 });
    const explicit = await Engine.run({ task: 'T', runMaxWords: 4, send: transport({ A: ['а б в г д', 'а б в г'] }).send, steps: [{ ref: 'r1', kind: 'round', input: 'none', output: { strictLength: true }, models: ['A'] }] });
    expect(explicit.stopReason).toBe('steps_done');
    expect(explicit.history[0]).toMatchObject({ accepted: false, reason: 'too_long', detail: '(5 из 4 слов)' });
    expect(explicit.steps[0].outcome.A).toMatchObject({ ok: true, attempt: 2 });
  });

  test('a json answer: the missing field is named in the correction; the fenced answer is accepted', async () => {
    const { send, calls } = transport({ A: ['{"correctedMap": {}}', '```json\n{"correctedMap": null, "auditFindings": []}\n```'] });
    const result = await Engine.run({ task: 'T', send, steps: [
      { ref: 'r1', kind: 'round', input: 'none', output: { format: 'json', requiredFields: ['/correctedMap', '/auditFindings'] }, models: ['A'] }
    ] });
    expect(calls[1].prompts.A).toBe('Твой предыдущий ответ без обязательного поля /auditFindings. Дай ответ на задание полностью.');
    expect(result.steps[0].outcome.A).toMatchObject({ ok: true, attempt: 2 });
  });

  test('the format of the output is in the request: its form, its sections, and in the request of the model itself', () => {
    const output = { form: 'Сформируй карту и замечания', sections: ['Карта', 'Замечания'] };
    const steps = [{ ref: 'r1', kind: 'round', input: 'none', output, models: ['A'] }, { ref: 'r2', kind: 'round', input: 'none', output, models: [{ name: 'B', promptTemplate: 'Свой запрос: {задача}' }] }];
    const plain = Engine.previewPrompt({ task: 'T', steps, stepIndex: 0, modelName: 'A' });
    expect(plain.prompt).toContain('Формат ответа:\nСформируй карту и замечания\nРазделы ответа: «Карта», «Замечания».');
    const own = Engine.previewPrompt({ task: 'T', steps, stepIndex: 1, modelName: 'B' });
    expect(own.prompt).toContain('Свой запрос: T');
    expect(own.prompt).toContain('Формат ответа:\nСформируй карту и замечания');
  });

  test('a declared artifact whose pointer is missing is missing_artifact; the rejected attempt makes no version', async () => {
    const { send } = transport({ A: ['{"correctedMap": {}}', '{"correctedMap": {"nodes": ["M1"]}, "auditFindings": ["F1"]}'] });
    const result = await Engine.run({ task: 'T', send, steps: [{ ref: 'r1', kind: 'round', input: 'none', output: {
      format: 'json', requiredFields: ['/correctedMap'], artifacts: [{ id: 'map', name: 'Corrected Map', pointer: '/correctedMap' }, { id: 'findings', name: 'Audit Findings', pointer: '/auditFindings' }]
    }, models: ['A'] }] });
    expect(result.history[0]).toMatchObject({ accepted: false, reason: 'missing_artifact', detail: '«findings» (/auditFindings)' });
    expect(result.artifacts.map((item) => item.id)).toEqual(['map', 'findings']);
    expect(result.artifacts.every((item) => item.source.visit === 1 && item.lineage.participant === 'A')).toBe(true);
  });
});

// Required number of answers (A02, pack P02 step 5; ТЗ 4.2, plan 1.3): the step ends when the threshold is met;
// below it the owner decides (retry, skip, stop), and "continue" is never offered; an absent or invalid decision
// below the threshold is no_decision, even when some answers were accepted.
describe('Custom engine required answers', () => {
  const two = (require) => ({ ref: 'r1', kind: 'round', input: 'none', require, models: ['A', 'B'] });

  test('all: one failed participant leaves the step below the threshold; the owner decides and gets no "continue"', async () => {
    // B fails its request and its correction: only then the owner decides (a correction inside the attempt comes first).
    const { send, calls } = transport({ A: ['a1'], B: ['', '', 'b3'] });
    const decide = jest.fn(async ({ choices }) => (choices.includes('retry') ? 'retry' : 'continue'));
    const result = await Engine.run({ task: 'T', send, decide, steps: [two('all')] });
    expect(decide).toHaveBeenCalledTimes(1);
    expect(decide.mock.calls[0][0]).toMatchObject({ accepted: ['A'], failed: ['B'], choices: ['retry', 'skip', 'stop'], required: 2 });
    expect(calls.map((call) => call.models)).toEqual([['A', 'B'], ['B'], ['B']]);
    expect(result.steps[0].outcome.B).toMatchObject({ ok: true, attempt: 3 });
    expect(result.stopReason).toBe('steps_done');
  });

  test('N of the participants: the threshold is met by accepted answers, a retry counts them; below it the step is not left by the fallback', async () => {
    const met = transport({ A: ['a1'], B: ['b1'], C: [''] });
    const enough = await Engine.run({ task: 'T', send: met.send, steps: [{ ref: 'r1', kind: 'round', input: 'none', require: 2, models: ['A', 'B', 'C'] }] });
    expect(enough.stopReason).toBe('steps_done');
    expect(met.calls.map((call) => call.models)).toEqual([['A', 'B', 'C'], ['C']]); // the usual retry of C, then the step goes on
    const short = transport({ A: ['a1'], B: [''], C: [''] });
    const result = await Engine.run({ task: 'T', send: short.send, decide: jest.fn(async () => 'continue'), steps: [{ ref: 'r1', kind: 'round', input: 'none', require: 2, models: ['A', 'B', 'C'] }] });
    expect(result.stopReason).toBe('no_decision');
  });

  test('below the threshold without a decision the run stops with no_decision, even with an accepted answer', async () => {
    const { send } = transport({ A: ['a1'], B: [''] });
    const result = await Engine.run({ task: 'T', send, steps: [two('all')] });
    expect(result).toMatchObject({ stopReason: 'no_decision' });
    const invalid = transport({ A: ['a1'], B: [''] });
    const bad = await Engine.run({ task: 'T', send: invalid.send, decide: async () => 'continue', steps: [two('all')] });
    expect(bad.stopReason).toBe('no_decision');
  });

  test('the manual last step asks the owner when the threshold is not met, and does not finish on its own', async () => {
    const { send } = transport({ A: ['a1'], B: [''] });
    const decide = jest.fn(async () => 'stop');
    const result = await Engine.run({ task: 'T', semiAuto: true, send, decide, steps: [{ ref: 'r1', kind: 'round', input: 'none', require: 'all', models: ['A', 'B'] }] });
    expect(decide).toHaveBeenCalledTimes(1);
    expect(result.stopReason).toBe('stopped');
  });

  test('a threshold above the number of participants is refused before the first request', async () => {
    const { send, calls } = transport({ A: ['a1'] });
    await expect(Engine.run({ task: 'T', send, steps: [{ ref: 'r1', kind: 'round', input: 'none', require: 2, models: ['A'] }] }))
      .rejects.toMatchObject({ code: 'invalid_field' });
    expect(calls).toHaveLength(0);
  });

  test('"any" and the whole threshold met: the run goes on without a question, as before', async () => {
    const { send } = transport({ A: ['a1'], B: ['b1'] });
    const decide = jest.fn();
    await Engine.run({ task: 'T', send, decide, steps: [two('all')] });
    expect(decide).not.toHaveBeenCalled();
  });
});

// Owner approval (A02, pack P02 step 6; ТЗ 4.2, plan 1.4): owner "approve" asks the owner after the step even in Auto and
// on the last step; an absent or invalid decision is no_decision, also when answers were accepted; in manual the step
// has one pause; [[ASK]] stays a separate channel; Stop ends the wait.
describe('Custom engine owner approval', () => {
  const approveStep = (extra = {}) => ({ ref: 'r1', kind: 'round', input: 'none', owner: 'approve', models: ['A'], ...extra });

  test('auto: an approved step asks the owner after the answers, and "continue" goes on', async () => {
    const { send } = transport({ A: ['a1'], B: ['b1'] });
    const decide = jest.fn(async () => 'continue');
    const result = await Engine.run({ task: 'T', send, decide, steps: [approveStep(), { ref: 'r2', kind: 'round', input: 'previous', models: ['B'] }] });
    expect(decide).toHaveBeenCalledTimes(1);
    expect(decide.mock.calls[0][0]).toMatchObject({ choices: ['continue', 'stop'], accepted: ['A'], failed: [] });
    expect(result).toMatchObject({ stopReason: 'steps_done', answers: ['b1'] });
  });

  test('the last step with approve does not finish without the decision: absent or invalid is no_decision', async () => {
    const absent = await Engine.run({ task: 'T', send: transport({ A: ['a1'] }).send, steps: [approveStep()] });
    expect(absent).toMatchObject({ stopReason: 'no_decision', answers: ['a1'] });
    const invalid = await Engine.run({ task: 'T', send: transport({ A: ['a1'] }).send, decide: async () => 'retry-me', steps: [approveStep()] });
    expect(invalid.stopReason).toBe('no_decision');
    const ok = await Engine.run({ task: 'T', send: transport({ A: ['a1'] }).send, decide: async () => 'continue', steps: [approveStep()] });
    expect(ok.stopReason).toBe('steps_done');
  });

  test('approve with a threshold not met: the owner gets no "continue", and an invalid answer stops the run', async () => {
    const { send, calls } = transport({ A: ['a1'], B: [''] });
    const decide = jest.fn(async () => 'continue');
    const result = await Engine.run({ task: 'T', send, decide, steps: [
      { ref: 'r1', kind: 'round', input: 'none', owner: 'approve', require: 'all', models: ['A', 'B'] },
      { ref: 'r2', kind: 'round', input: 'previous', models: ['A'] }
    ] });
    expect(decide.mock.calls[0][0].choices).toEqual(['retry', 'skip', 'stop']);
    expect(result.stopReason).toBe('no_decision');
    expect(calls.map((call) => call.models)).toEqual([['A', 'B'], ['B']]); // the second step is never requested
  });

  test('manual: an approved step has one pause, not two; the last step with no failures does not pause again', async () => {
    const { send } = transport({ A: ['a1'], B: ['b1'] });
    const decide = jest.fn(async () => 'continue');
    await Engine.run({ task: 'T', semiAuto: true, send, decide, steps: [approveStep(), { ref: 'r2', kind: 'round', input: 'previous', models: ['B'] }] });
    expect(decide).toHaveBeenCalledTimes(1);
    expect(decide.mock.calls[0][0].step).toBe(0);
  });

  test('[[ASK]] goes to the owner in its own call; the approval and the answer are two decisions', async () => {
    const { send } = transport({ A: ['a1\n[[ASK: Срок? || неделя || месяц]]'] });
    const decide = jest.fn(async () => 'continue');
    const askOwner = jest.fn(async (asks) => asks.map((item) => ({ question: item.question, answer: 'неделя' })));
    const result = await Engine.run({ task: 'T', send, decide, askOwner,
      parseAsks: (value) => (/\[\[ASK: ([^|]+)/.exec(value) ? [{ question: /\[\[ASK: ([^|]+)/.exec(value)[1].trim() }] : []),
      steps: [approveStep()] });
    expect(decide).toHaveBeenCalledTimes(1);
    expect(askOwner).toHaveBeenCalledTimes(1);
    expect(result.ownerAnswers).toEqual([{ question: 'Срок?', answer: 'неделя' }]);
  });

  test('Stop while the owner is asked ends the run as cancelled with what was collected', async () => {
    const controller = new AbortController();
    const { send } = transport({ A: ['a1'] });
    const decide = () => { setTimeout(() => controller.abort(), 0); return new Promise(() => {}); };
    const result = await Engine.run({ task: 'T', signal: controller.signal, send, decide, steps: [approveStep()] });
    expect(result).toMatchObject({ stopReason: 'cancelled', answers: ['a1'] });
  });

  test('an owner value other than approve is refused before the first request', async () => {
    const { send, calls } = transport({ A: ['a1'] });
    await expect(Engine.run({ task: 'T', send, steps: [approveStep({ owner: 'sign' })] })).rejects.toMatchObject({ code: 'invalid_field' });
    expect(calls).toHaveLength(0);
  });
});

// Artifact registry (A02, pack P02 step 7; ТЗ 5.2–5.3, 7): an accepted answer is stored once (putText) and each declared
// artifact is a registry entry that names the answer and a pointer; a source with an artifact gives only that content.
describe('Custom engine artifacts', () => {
  const audit = (extra = {}) => ({ ref: 'r1', kind: 'round', input: 'none', models: ['A'], output: {
    format: 'json', requiredFields: ['/correctedMap', '/auditFindings'],
    artifacts: [{ id: 'map', name: 'Corrected Map', pointer: '/correctedMap' }, { id: 'findings', name: 'Audit Findings', pointer: '/auditFindings' }]
  }, ...extra });
  const reply = '{"correctedMap": {"nodes": ["M1"]}, "auditFindings": ["F1", "F2"]}';
  const fromArtifact = (id, version = 'latest', required = true) => ({ artifact: { step: 'r1', participant: 'A', id }, version, required });

  test('two artifacts of one answer reach two steps: each step gets only its own content, not the other one', async () => {
    const { send, calls } = transport({ A: [reply], B: ['b'], C: ['c'] });
    await Engine.run({ task: 'T', send, steps: [
      audit(),
      { ref: 'r2', kind: 'round', input: [fromArtifact('map')], models: ['B'] },
      { ref: 'r3', kind: 'round', input: [fromArtifact('findings')], models: ['C'] }
    ] });
    const toB = calls[1].prompts.B;
    const toC = calls[2].prompts.C;
    expect(toB).toContain('Артефакт «Corrected Map» (Раунд 1, участник A, визит 1):\n{"nodes":["M1"]}');
    expect(toB).not.toContain('F1');
    expect(toC).toContain('Артефакт «Audit Findings» (Раунд 1, участник A, визит 1):\n["F1","F2"]');
    expect(toC).not.toContain('M1');
  });

  test('the registry names the answer and the pointer; the body is stored once, in the answer', async () => {
    const { send } = transport({ A: [reply] });
    const result = await Engine.run({ task: 'T', send, steps: [audit()] });
    expect(result.artifacts).toEqual([
      expect.objectContaining({ id: 'map', name: 'Corrected Map', content: { answerRef: expect.any(String), pointer: '/correctedMap' }, valid: true }),
      expect.objectContaining({ id: 'findings', content: { answerRef: result.artifacts[0].content.answerRef, pointer: '/auditFindings' } })
    ]);
    expect(JSON.stringify(result.artifacts)).not.toContain('M1');
    expect(Object.values(result.texts)).toEqual([reply]);
  });

  test('a text answer with one artifact of an empty pointer is the whole answer', async () => {
    const { send, calls } = transport({ A: ['Полный документ.'], B: ['b'] });
    await Engine.run({ task: 'T', send, steps: [
      { ref: 'r1', kind: 'round', input: 'none', models: ['A'], output: { artifacts: [{ id: 'doc', name: 'Doc', pointer: '' }] } },
      { ref: 'r2', kind: 'round', input: [fromArtifact('doc')], models: ['B'] }
    ] });
    expect(calls[1].prompts.B).toContain('Артефакт «Doc» (Раунд 1, участник A, визит 1):\nПолный документ.');
  });

  test('a required artifact without a version stops the run before the request; an optional one gives no text', async () => {
    const result = await Engine.run({ task: 'T', send: transport({ A: [reply] }).send, steps: [
      audit(),
      { ref: 'r2', kind: 'round', input: [fromArtifact('map', { step: 'r1', participant: 'A', visit: 2 }, true)], models: ['B'] }
    ] });
    expect(result).toMatchObject({ stopReason: 'missing_input', stopDetail: expect.stringContaining('map') });
    const optional = transport({ A: [reply], B: ['b'] });
    const done = await Engine.run({ task: 'T', send: optional.send, steps: [
      audit(),
      { ref: 'r2', kind: 'round', input: [fromArtifact('map', { step: 'r1', participant: 'A', visit: 2 }, false)], models: ['B'] }
    ] });
    expect(done.stopReason).toBe('steps_done');
    expect(optional.calls[1].prompts.B).not.toContain('Артефакт');
  });

  test('two authors declare the same artifact id: two lines, each source gets its own author', async () => {
    const { send, calls } = transport({ A: [reply], B: ['{"correctedMap": {"nodes": ["B1"]}, "auditFindings": []}'], C: ['c'] });
    await Engine.run({ task: 'T', send, steps: [
      { ref: 'r1', kind: 'round', input: 'none', models: ['A', 'B'], output: { format: 'json', requiredFields: ['/correctedMap', '/auditFindings'], artifacts: [{ id: 'map', name: 'Map', pointer: '/correctedMap' }] } },
      { ref: 'r2', kind: 'round', input: [{ artifact: { step: 'r1', participant: 'B', id: 'map' }, version: 'latest', required: true }], models: ['C'] }
    ] });
    expect(calls[1].prompts.C).toContain('{"nodes":["B1"]}');
    expect(calls[1].prompts.C).not.toContain('M1');
  });

  test('a source names an artifact that the step does not declare: refused before the first request', async () => {
    const { send, calls } = transport({ A: [reply], B: ['b'] });
    await expect(Engine.run({ task: 'T', send, steps: [audit(), { ref: 'r2', kind: 'round', input: [fromArtifact('nothing')], models: ['B'] }] }))
      .rejects.toMatchObject({ code: 'invalid_input' });
    expect(calls).toHaveLength(0);
  });

  test('putText and getText are the callbacks of the record: the answer is put once, the content is read back', async () => {
    const store = {};
    const putText = jest.fn((value) => { const ref = `ref-${Object.keys(store).length + 1}`; store[ref] = value; return ref; });
    const getText = jest.fn((ref) => store[ref]);
    const { send, calls } = transport({ A: [reply], B: ['b'] });
    const result = await Engine.run({ task: 'T', send, putText, getText, steps: [audit(), { ref: 'r2', kind: 'round', input: [fromArtifact('map')], models: ['B'] }] });
    expect(putText).toHaveBeenCalledTimes(2); // the accepted answers of A and B, each once
    expect(putText).toHaveBeenCalledWith(reply);
    expect(getText).toHaveBeenCalledWith('ref-1');
    expect(calls[1].prompts.B).toContain('{"nodes":["M1"]}');
    expect(result.texts).toEqual({});
  });

  test('a missing text of an artifact is missing_content, never an empty document', async () => {
    const { send, calls } = transport({ A: [reply], B: ['b'] });
    await expect(Engine.run({ task: 'T', send, putText: () => 'ref-1', getText: () => undefined,
      steps: [audit(), { ref: 'r2', kind: 'round', input: [fromArtifact('map')], models: ['B'] }] }))
      .rejects.toMatchObject({ code: 'missing_content' });
    expect(calls).toHaveLength(1);
  });

  test('without artifacts the run has an empty registry and needs no callback', async () => {
    const result = await Engine.run({ task: 'T', send: transport({ A: ['a'] }).send, steps: [{ ref: 'r1', kind: 'round', input: 'none', models: ['A'] }] });
    expect(result.artifacts).toEqual([]);
  });

});

// Revision (A02, pack P02 step 8; ТЗ 5.2): an artifact that revises another one joins its line (the line of the source the
// author really got as input); the version keeps its own source; authors who do not revise stay in their own lines.
describe('Custom engine revisions of artifacts', () => {
  const declared = (id, extra = {}) => ({ id, name: id === 'map' ? 'Corrected Map' : id, pointer: '/map', ...extra });
  const mapOutput = (extra = {}) => ({ format: 'json', requiredFields: ['/map'], artifacts: [declared('map', extra)] });
  const from = (step, participant, id, version = 'latest', required = true) => ({ artifact: { step, participant, id }, version, required });

  test('a revision joins the line of the source it got as input; the version keeps its own author and visit', async () => {
    const { send, calls } = transport({ A: ['{"map": "v1"}'], B: ['{"map": "v2"}'], C: ['c'] });
    const result = await Engine.run({ task: 'T', send, steps: [
      { ref: 'r1', kind: 'round', input: 'none', models: ['A'], output: mapOutput() },
      { ref: 'r2', kind: 'round', input: [from('r1', 'A', 'map')], models: ['B'], output: mapOutput({ revisionOf: from('r1', 'A', 'map') }) },
      { ref: 'r3', kind: 'round', input: [from('r1', 'A', 'map')], models: ['C'] }
    ] });
    expect(result.artifacts.map((item) => [item.lineage.step, item.lineage.participant, item.source.step])).toEqual([['r1', 'A', 'r1'], ['r1', 'A', 'r2']]);
    expect(result.artifacts[1].source).toEqual({ step: 'r2', participant: 'B', visit: 1 });
    expect(calls[2].prompts.C).toContain('Артефакт «Corrected Map» (Раунд 2, участник B, визит 1):\nv2');
  });

  test('a revision of a source the author did not get is not attached: the step stops before the request (missing_input)', async () => {
    const { send, calls } = transport({ A: ['{"map": "v1"}'], B: ['{"map": "v2"}'] });
    const result = await Engine.run({ task: 'T', send, steps: [
      { ref: 'r1', kind: 'round', input: 'none', models: ['A'], output: mapOutput() },
      { ref: 'r2', kind: 'round', input: [from('r1', 'A', 'map', 'latest', false)], models: ['B'], output: mapOutput({ revisionOf: from('r1', 'A', 'map', { step: 'r1', participant: 'A', visit: 2 }, false) }) }
    ] });
    expect(result).toMatchObject({ stopReason: 'missing_input', stopDetail: expect.stringContaining('map') });
    expect(calls.map((call) => call.models)).toEqual([['A']]);
  });

  test('the revision must be in the input of its author: otherwise refused before the first request', async () => {
    const { send, calls } = transport({ A: ['{"map": "v1"}'], B: ['{"map": "v2"}'] });
    await expect(Engine.run({ task: 'T', send, steps: [
      { ref: 'r1', kind: 'round', input: 'none', models: ['A'], output: mapOutput() },
      { ref: 'r2', kind: 'round', input: 'none', models: ['B'], output: mapOutput({ revisionOf: from('r1', 'A', 'map') }) }
    ] })).rejects.toMatchObject({ code: 'invalid_input' });
    expect(calls).toHaveLength(0);
  });

  test('two authors stay two lines: a revision of A does not replace the map of B', async () => {
    const { send, calls } = transport({ A: ['{"map": "a1"}'], B: ['{"map": "b1"}'], C: ['{"map": "a2"}'], D: ['d'] });
    const result = await Engine.run({ task: 'T', send, steps: [
      { ref: 'r1', kind: 'round', input: 'none', models: ['A', 'B'], output: mapOutput() },
      { ref: 'r2', kind: 'round', input: [from('r1', 'A', 'map')], models: ['C'], output: mapOutput({ revisionOf: from('r1', 'A', 'map') }) },
      { ref: 'r3', kind: 'round', input: [from('r1', 'B', 'map')], models: ['D'] }
    ] });
    expect(calls[calls.length - 1].prompts.D).toContain('Артефакт «Corrected Map» (Раунд 1, участник B, визит 1):\nb1');
    expect(result.artifacts.filter((item) => item.lineage.participant === 'B')).toHaveLength(1);
  });

  test('a rejected revision makes no version; the accepted one is registered once', async () => {
    const { send } = transport({ A: ['{"map": "v1"}'], B: ['{"other": 1}', '{"map": "v2"}'] });
    const result = await Engine.run({ task: 'T', send, steps: [
      { ref: 'r1', kind: 'round', input: 'none', models: ['A'], output: mapOutput() },
      { ref: 'r2', kind: 'round', input: [from('r1', 'A', 'map')], models: ['B'], output: mapOutput({ revisionOf: from('r1', 'A', 'map') }) }
    ] });
    expect(result.artifacts.filter((item) => item.source.step === 'r2')).toHaveLength(1);
    expect(result.history.find((item) => item.model === 'B' && item.attempt === 1)).toMatchObject({ accepted: false, reason: 'missing_field' });
  });
});
