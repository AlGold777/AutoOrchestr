const Engine = require('../disput/custom-engine');

// A scripted transport (as in custom-engine-owner.test.js): answers[model] is a list of replies, one per request to that model.
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

const ROUND = (extra = {}) => ({ ref: 'r1', kind: 'round', models: ['A'], ...extra });
const OWNER_DOC = (extra = {}) => ({ ref: 'owner:u', kind: 'owner', task: 'Уточните', document: 'r1', ...extra });
const FORM_TEXT = '{"items":[{"id":"b","type":"text","question":"Q"}]}';

describe('Custom engine: document for the owner step', () => {
  test('1. read document: the owner gets the accepted answer of the one-model round as document', async () => {
    const { send } = transport({ A: ['ТЕКСТ-ДОКУМЕНТА'] });
    const { provideOwnerResult, calls: asked } = owner(['ок']);
    const result = await Engine.run({ task: 'T', steps: [ROUND({ output: { document: 'read' } }), OWNER_DOC()], send, provideOwnerResult });
    expect(result.stopReason).toBe('steps_done');
    expect(asked.length).toBe(1);
    expect(asked[0].document).toEqual({ ref: 'r1', kind: 'read', text: 'ТЕКСТ-ДОКУМЕНТА' });
  });

  test('2. form document: the owner gets the parsed questionnaire and the original text', async () => {
    const { send } = transport({ A: [FORM_TEXT] });
    const { provideOwnerResult, calls: asked } = owner(['ок']);
    const result = await Engine.run({ task: 'T', steps: [ROUND({ output: { format: 'json', document: 'form' } }), OWNER_DOC()], send, provideOwnerResult });
    expect(result.stopReason).toBe('steps_done');
    expect(asked[0].document.kind).toBe('form');
    expect(asked[0].document.form.items[0].id).toBe('b');
    expect(asked[0].document.text).toBe(FORM_TEXT);
    expect(asked[0].document.ref).toBe('r1');
  });

  test('3. an owner step without document: the request has no document key', async () => {
    const { send } = transport({ A: ['ТЕКСТ'] });
    const { provideOwnerResult, calls: asked } = owner(['ок']);
    const steps = [ROUND({ output: { document: 'read' } }), { ref: 'owner:u', kind: 'owner', task: 'Уточните' }];
    const result = await Engine.run({ task: 'T', steps, send, provideOwnerResult });
    expect(result.stopReason).toBe('steps_done');
    expect(asked[0]).not.toHaveProperty('document');
  });

  test('4. an invalid document reference stops before provideOwnerResult with invalid_document', async () => {
    const cases = [
      // unknown ref
      [[ROUND({ output: { document: 'read' } }), OWNER_DOC({ document: 'r9' })], {}, 'invalid_document'],
      // the document names the owner step itself (not a round before it)
      [[ROUND({ output: { document: 'read' } }), OWNER_DOC({ document: 'owner:u' })], {}, 'invalid_document'],
      // a round with two models: no single answer to give
      [[ROUND({ models: ['A', 'B'], output: { document: 'read' } }), OWNER_DOC()], { B: ['ок'] }, 'invalid_document'],
    ];
    for (const [steps, extraAnswers, code] of cases) {
      const { send, calls } = transport({ A: ['ТЕКСТ'], ...extraAnswers });
      const { provideOwnerResult, calls: asked } = owner(['ок']);
      await expect(Engine.run({ task: 'T', steps, send, provideOwnerResult })).rejects.toThrow(code);
      expect(asked).toEqual([]);
      expect(calls.length).toBeLessThanOrEqual(1);
    }
  });

  test('5. a form round: the first answer {"items":[]} is refused with invalid_form and the model is asked again', async () => {
    const { send, calls } = transport({ A: ['{"items":[]}', FORM_TEXT] });
    const { provideOwnerResult, calls: asked } = owner(['ок']);
    const result = await Engine.run({ task: 'T', steps: [ROUND({ output: { format: 'json', document: 'form' } }), OWNER_DOC()], send, provideOwnerResult });
    expect(result.stopReason).toBe('steps_done');
    expect(calls.length).toBe(2);
    expect(calls[1].models).toEqual(['A']);
    expect(asked[0].document.form.items[0].id).toBe('b');
  });
});

describe('Custom engine: format block describes the questionnaire', () => {
  test('формат ответа: опросник описан в запросе', () => {
    const form = Engine.formatBlock({ format: 'json', document: 'form' });
    for (const part of ['"items"', 'one', 'many', 'text', 'yesno', 'options', 'required']) {
      expect(form).toContain(part);
    }
    expect(Engine.formatBlock({ format: 'json' })).not.toContain('"items"');
    expect(Engine.formatBlock({ document: 'read' })).toBe('');
  });
});
