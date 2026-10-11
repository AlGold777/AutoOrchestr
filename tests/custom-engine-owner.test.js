const Engine = require('../disput/custom-engine');

// A scripted transport (as in custom-engine-chg.test.js): answers[model] is a list of replies, one per request to that model.
function transport(answers) {
  const calls = [];
  const used = {};
  const send = async (models, prompts, meta) => {
    calls.push({ models: models.slice(), prompts: { ...prompts }, meta });
    const byModel = {};
    models.forEach((model) => {
      const index = used[model] || 0;
      used[model] = index + 1;
      const reply = (answers[model] || [])[index];
      byModel[model] = { text: reply || '', status: reply ? 'SUCCESS' : 'TIMEOUT' };
    });
    return { byModel, closedByOwner: false };
  };
  return { send, calls };
}

// The owner's replies, one per call: a text, a file object, null (cancel) or '' (empty).
function owner(replies) {
  const calls = [];
  let index = 0;
  const provideOwnerResult = async (request) => {
    calls.push(request);
    const reply = replies[index];
    index += 1;
    return reply === undefined ? null : reply;
  };
  return { provideOwnerResult, calls };
}

const OWNER = (extra = {}) => ({ ref: 'owner:evidence', kind: 'owner', task: 'Предоставьте исследование', ...extra });
const ROUND_AFTER_OWNER = { ref: 'S2', kind: 'round', input: ['owner:evidence'], models: ['A'] };

describe('Custom engine owner step (8.1, T14): text', () => {
  test('the owner text goes to the next model as data; no model is asked for the owner step', async () => {
    const { send, calls } = transport({ A: ['ответ'] });
    const { provideOwnerResult, calls: asked } = owner(['Факты: 1']);
    const result = await Engine.run({ task: 'T', steps: [OWNER(), ROUND_AFTER_OWNER], send, provideOwnerResult });
    expect(result.stopReason).toBe('steps_done');
    expect(asked).toEqual([{ stepRef: 'owner:evidence', visit: 1, task: 'Предоставьте исследование', output: null }]);
    expect(calls.map((call) => call.models)).toEqual([['A']]);
    expect(calls[0].prompts.A).toContain('Факты: 1');
  });

  test('the owner text must pass the output check; a rejected text is asked again with its reason', async () => {
    const steps = [OWNER({ output: { sections: ['Карта'] } }), ROUND_AFTER_OWNER];
    const { send } = transport({ A: ['ок'] });
    const { provideOwnerResult, calls: asked } = owner(['без разделов', 'Карта: готово']);
    const result = await Engine.run({ task: 'T', steps, send, provideOwnerResult });
    expect(result.stopReason).toBe('steps_done');
    expect(asked.map((call) => call.reason || '')).toEqual(['', 'missing_section']);
    expect(asked[1].detail).toContain('Карта');
  });

  test('an empty owner result is not accepted: the owner is asked again', async () => {
    const { send, calls } = transport({ A: ['ок'] });
    const { provideOwnerResult, calls: asked } = owner(['', '   ', 'Текст']);
    const result = await Engine.run({ task: 'T', steps: [OWNER(), ROUND_AFTER_OWNER], send, provideOwnerResult });
    expect(result.stopReason).toBe('steps_done');
    expect(asked.length).toBe(3);
    expect(asked[1].reason).toBe('empty');
    expect(calls[0].prompts.A).toContain('Текст');
  });

  test('cancel of the owner dialog ends the run as stopped, before any model request', async () => {
    const { send, calls } = transport({ A: ['ок'] });
    const { provideOwnerResult } = owner([null]);
    const result = await Engine.run({ task: 'T', steps: [OWNER(), ROUND_AFTER_OWNER], send, provideOwnerResult });
    expect(result.stopReason).toBe('stopped');
    expect(calls).toEqual([]);
  });

  test('Stop while the owner is asked ends the run as cancelled', async () => {
    const controller = new AbortController();
    const { send, calls } = transport({ A: ['ок'] });
    const provideOwnerResult = () => new Promise(() => {}); // the dialog stays open until Stop
    const pending = Engine.run({ task: 'T', steps: [OWNER(), ROUND_AFTER_OWNER], send, provideOwnerResult, signal: controller.signal });
    setTimeout(() => controller.abort(), 5);
    const result = await pending;
    expect(result.stopReason).toBe('cancelled');
    expect(calls).toEqual([]);
  });

  test('an owner step with the page callback missing is refused before the first request', async () => {
    const { send, calls } = transport({ A: ['ок'] });
    await expect(Engine.run({ task: 'T', steps: [OWNER(), ROUND_AFTER_OWNER], send })).rejects.toThrow('provide_owner_required');
    expect(calls).toEqual([]);
  });

  test('an owner step without a task is refused before the first request', async () => {
    const { send, calls } = transport({ A: ['ок'] });
    const { provideOwnerResult } = owner(['x']);
    await expect(Engine.run({ task: 'T', steps: [OWNER({ task: ' ' }), ROUND_AFTER_OWNER], send, provideOwnerResult })).rejects.toThrow('invalid_field');
    expect(calls).toEqual([]);
  });
});

describe('Custom engine owner step (8.1, T14): artifacts and files', () => {
  test('the declared artifacts of an accepted owner text are registered; the text is stored once', async () => {
    const steps = [OWNER({ output: { format: 'json', requiredFields: ['/facts'], artifacts: [{ id: 'facts', name: 'Факты', pointer: '/facts' }] } })];
    const { provideOwnerResult } = owner(['{"facts":"Тезис"}']);
    const stored = {};
    const putText = (value) => { const ref = `t${Object.keys(stored).length + 1}`; stored[ref] = value; return ref; };
    const getText = (ref) => stored[ref];
    const result = await Engine.run({ task: 'T', steps, send: transport({}).send, provideOwnerResult, putText, getText });
    expect(result.stopReason).toBe('steps_done');
    expect(result.artifacts).toEqual([expect.objectContaining({
      id: 'facts', name: 'Факты', lineage: { step: 'owner:evidence', participant: 'owner', id: 'facts' },
      source: { step: 'owner:evidence', participant: 'owner', visit: 1 }, valid: true,
      content: { answerRef: 't1', pointer: '/facts' }
    })]);
    expect(Object.keys(stored)).toEqual(['t1']);
    expect(stored.t1).toBe('{"facts":"Тезис"}');
  });

  test('a text file keeps its text as the owner answer; a binary file is not given to a model as text', async () => {
    const text = owner([{ file: { name: 'notes.txt', mime: 'text/plain', size: 7, ref: 'file-1', text: 'Заметки' } }]);
    const first = transport({ A: ['ок'] });
    await Engine.run({ task: 'T', steps: [OWNER(), ROUND_AFTER_OWNER], send: first.send, provideOwnerResult: text.provideOwnerResult });
    expect(first.calls[0].prompts.A).toContain('Заметки');

    const binary = owner([{ file: { name: 'a.pdf', mime: 'application/pdf', size: 10, ref: 'file-2' } }]);
    const second = transport({ A: ['ок'] });
    const result = await Engine.run({ task: 'T', steps: [OWNER(), ROUND_AFTER_OWNER], send: second.send, provideOwnerResult: binary.provideOwnerResult });
    expect(result.stopReason).toBe('unsupported_input');
    expect(result.stopDetail).toContain('a.pdf');
    expect(second.calls).toEqual([]);
  });

  test('a file reference without a name, a type or a stored ref is refused, and a blob: URL is never the content', async () => {
    const { send } = transport({ A: ['ок'] });
    const blob = owner([{ file: { name: 'a.txt', mime: 'text/plain', size: 3, ref: 'blob:https://example.test/1' } }]);
    await expect(Engine.run({ task: 'T', steps: [OWNER()], send, provideOwnerResult: blob.provideOwnerResult })).rejects.toThrow('invalid_owner_result');
    const bare = owner([{ file: { name: '', mime: 'text/plain', size: 3, ref: 'file-3' } }]);
    await expect(Engine.run({ task: 'T', steps: [OWNER()], send, provideOwnerResult: bare.provideOwnerResult })).rejects.toThrow('invalid_owner_result');
  });
});
