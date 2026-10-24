const Engine = require('../disput/custom-engine');

// A scripted transport (as in custom-engine-document.test.js): answers[model] is a list of replies, one per request to that model.
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

// The owner's replies, one per call: a text, null (cancel) or '' (empty). Past the list the owner cancels.
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

// A text store as the record gives it: putText → ref, getText(ref) → text.
function textStore() {
  const data = {};
  let seq = 0;
  return { data, putText: (value) => { seq += 1; const ref = `t${seq}`; data[ref] = value; return ref; }, getText: (ref) => data[ref] };
}

// A checkpoint that keeps every state (as the page keeps the snapshot).
function keeper() {
  const saved = [];
  const checkpoint = async (state) => { saved.push(JSON.parse(JSON.stringify(state))); };
  return { checkpoint, saved, last: () => saved[saved.length - 1] };
}

const clone = (value) => JSON.parse(JSON.stringify(value));
const DOC_TEXT = 'Вот ТЗ:\n[[DOC: spec]]\nТЕКСТ-ТЗ\n[[/DOC]]\nУдачи';
const R1 = { ref: 'r1', kind: 'round', models: ['A'], input: 'none', output: { document: 'read', artifacts: [{ id: 'spec', name: 'ТЗ', pointer: '' }] } };
const OWNER_U = { ref: 'owner:u', kind: 'owner', task: 'Уточните', document: 'r1' };
const R2 = { ref: 'r2', kind: 'round', models: ['B'] };

describe('Custom engine: document versions (stage 2)', () => {
  test('1. the model answer is extracted by the label; the owner gets the document with its version; onDocument gets the version', async () => {
    const { send } = transport({ A: [DOC_TEXT], B: ['ок'] });
    const { provideOwnerResult, calls: asked } = owner(['ТЕКСТ-ТЗ']);
    const docs = [];
    const result = await Engine.run({ task: 'T', steps: [R1, OWNER_U, R2], send, provideOwnerResult, onDocument: (event) => docs.push(event) });
    expect(result.stopReason).toBe('steps_done');
    expect(asked[0].document).toEqual({ ref: 'r1', kind: 'read', text: 'ТЕКСТ-ТЗ', id: 'spec', name: 'ТЗ', version: 1 });
    expect(docs[0]).toMatchObject({ kind: 'version', id: 'spec', name: 'ТЗ', version: 1, author: 'model', stepRef: 'r1', participant: 'A', visit: 1, text: 'ТЕКСТ-ТЗ' });
  });

  test('2. an answer without labels is refused with missing_artifact and the model is asked again; the document comes from the second answer only', async () => {
    const { send, calls } = transport({ A: ['Текст без меток, пояснение.', DOC_TEXT], B: ['ок'] });
    const { provideOwnerResult, calls: asked } = owner(['ТЕКСТ-ТЗ']);
    const docs = [];
    const result = await Engine.run({ task: 'T', steps: [R1, OWNER_U], send, provideOwnerResult, onDocument: (event) => docs.push(event) });
    expect(result.stopReason).toBe('steps_done');
    expect(calls.length).toBe(2);
    expect(calls[1].models).toEqual(['A']);
    expect(calls[1].prompts.A).toContain('без объявленного артефакта');
    expect(result.history.find((item) => item.attempt === 1).reason).toBe('missing_artifact');
    expect(docs.filter((event) => event.kind === 'version')).toHaveLength(1);
    expect(asked[0].document.text).toBe('ТЕКСТ-ТЗ');
  });

  test('3. an owner answer equal to the document makes no new version; the approval is one event with version 1, and the next step gets the approved text', async () => {
    const { send, calls } = transport({ A: [DOC_TEXT], B: ['ок'] });
    const { provideOwnerResult } = owner(['ТЕКСТ-ТЗ']);
    const docs = [];
    const result = await Engine.run({ task: 'T', steps: [R1, OWNER_U, R2], send, provideOwnerResult, onDocument: (event) => docs.push(event) });
    expect(result.stopReason).toBe('steps_done');
    expect(docs.filter((event) => event.stepRef === 'owner:u')).toEqual([
      { kind: 'approved', id: 'spec', name: 'ТЗ', version: 1, stepRef: 'owner:u', visit: 1 }
    ]);
    expect(calls[1].prompts.B).toContain('ТЕКСТ-ТЗ');
  });

  test('4. an edited document makes version 2 by the user; the next step gets version 2 and not version 1', async () => {
    const { send, calls } = transport({ A: [DOC_TEXT], B: ['ок'] });
    const { provideOwnerResult } = owner(['ПРАВЛЕННЫЙ']);
    const docs = [];
    const result = await Engine.run({ task: 'T', steps: [R1, OWNER_U, R2], send, provideOwnerResult, onDocument: (event) => docs.push(event) });
    expect(result.stopReason).toBe('steps_done');
    expect(docs.filter((event) => event.stepRef === 'owner:u')).toEqual([
      { kind: 'version', id: 'spec', name: 'ТЗ', version: 2, author: 'user', stepRef: 'owner:u', participant: 'owner', visit: 1, text: 'ПРАВЛЕННЫЙ' },
      { kind: 'approved', id: 'spec', name: 'ТЗ', version: 2, stepRef: 'owner:u', visit: 1 }
    ]);
    expect(calls[1].prompts.B).toContain('ПРАВЛЕННЫЙ');
    expect(calls[1].prompts.B).not.toContain('ТЕКСТ-ТЗ');
    const line = result.artifacts.filter((item) => item.id === 'spec');
    expect(line).toHaveLength(2);
    expect(line[line.length - 1].source.participant).toBe('owner');
    expect(result.texts[line[line.length - 1].content.answerRef]).toBe('ПРАВЛЕННЫЙ');
  });

  test('5. a round with an explicit artifact input gets the latest version (the owner edit)', async () => {
    const r2 = { ref: 'r2', kind: 'round', models: ['B'], input: [{ artifact: { step: 'r1', participant: 'A', id: 'spec' }, version: 'latest' }] };
    const { send, calls } = transport({ A: [DOC_TEXT], B: ['ок'] });
    const { provideOwnerResult } = owner(['ПРАВЛЕННЫЙ']);
    const result = await Engine.run({ task: 'T', steps: [R1, OWNER_U, r2], send, provideOwnerResult });
    expect(result.stopReason).toBe('steps_done');
    expect(calls[1].prompts.B).toContain('ПРАВЛЕННЫЙ');
    expect(calls[1].prompts.B).not.toContain('ТЕКСТ-ТЗ');
  });

  test('6. the request of the model names the labels of the document', async () => {
    const { send, calls } = transport({ A: [DOC_TEXT] });
    const { provideOwnerResult } = owner(['ТЕКСТ-ТЗ']);
    await Engine.run({ task: 'T', steps: [R1, OWNER_U], send, provideOwnerResult });
    expect(calls[0].prompts.A).toContain('[[DOC: spec]]');
    expect(calls[0].prompts.A).toContain('[[/DOC]]');
  });

  test('7. an unavailable version: the owner sees it as unavailable; getDocument supplies the text when the stored answer is gone', async () => {
    const { send } = transport({ A: [DOC_TEXT] });
    const { provideOwnerResult, calls: asked } = owner(['ИЗ-ХРАНИЛИЩА']);
    const getDocument = async (address) => { expect(address).toEqual({ id: 'spec', version: 1 }); return 'ИЗ-ХРАНИЛИЩА'; };
    const result = await Engine.run({ task: 'T', steps: [R1, OWNER_U], send, provideOwnerResult, getText: () => undefined, getDocument });
    expect(result.stopReason).toBe('steps_done');
    expect(asked[0].document).toEqual({ ref: 'r1', kind: 'read', text: 'ИЗ-ХРАНИЛИЩА', id: 'spec', name: 'ТЗ', version: 1 });
  });

  test('7b. no text in the store and no getDocument text: the owner gets the unavailable document; retry reopens it with the text when it is back', async () => {
    const { send } = transport({ A: [DOC_TEXT] });
    let available = false;
    const getDocument = async () => (available ? 'ИЗ-ХРАНИЛИЩА' : undefined);
    const asked = [];
    const provideOwnerResult = async (request) => {
      asked.push(request);
      if (asked.length === 1) { available = true; return 'retry'; }
      return 'ИЗ-ХРАНИЛИЩА';
    };
    const result = await Engine.run({ task: 'T', steps: [R1, OWNER_U], send, provideOwnerResult, getText: () => undefined, getDocument });
    expect(result.stopReason).toBe('steps_done');
    expect(asked[0].document).toEqual({ ref: 'r1', kind: 'read', unavailable: true, id: 'spec', name: 'ТЗ', version: 1 });
    expect(asked[0].document).not.toHaveProperty('text');
    expect(asked[1].document).toEqual({ ref: 'r1', kind: 'read', text: 'ИЗ-ХРАНИЛИЩА', id: 'spec', name: 'ТЗ', version: 1 });
  });

  test('7c. the owner cancels the unavailable document: the run stops with stopped', async () => {
    const { send } = transport({ A: [DOC_TEXT] });
    const { provideOwnerResult, calls: asked } = owner([null]);
    const result = await Engine.run({ task: 'T', steps: [R1, OWNER_U], send, provideOwnerResult, getText: () => undefined, getDocument: async () => undefined });
    expect(result.stopReason).toBe('stopped');
    expect(asked.length).toBe(1);
    expect(asked[0].document.unavailable).toBe(true);
  });

  test('8. resume in the owner window: the same document (version 1), the edit goes to the next step, the owner record keeps approved', async () => {
    const texts = textStore();
    const first = keeper();
    const run1 = await Engine.run({ task: 'T', steps: [R1, OWNER_U, R2], send: transport({ A: [DOC_TEXT], B: ['ок'] }).send,
      checkpoint: first.checkpoint, putText: texts.putText, getText: texts.getText, provideOwnerResult: owner([null]).provideOwnerResult });
    expect(run1.stopReason).toBe('stopped');
    const { send, calls } = transport({ B: ['ок'] });
    const asked = [];
    const second = keeper();
    const run2 = await Engine.run({ task: 'T', steps: [R1, OWNER_U, R2], send, checkpoint: second.checkpoint, putText: texts.putText, getText: texts.getText,
      resume: clone(first.last()),
      provideOwnerResult: async (request) => { asked.push(request); return 'ПРАВЛЕННЫЙ'; } });
    expect(run2.stopReason).toBe('steps_done');
    expect(asked[0].document).toEqual({ ref: 'r1', kind: 'read', text: 'ТЕКСТ-ТЗ', id: 'spec', name: 'ТЗ', version: 1 });
    expect(calls[0].prompts.B).toContain('ПРАВЛЕННЫЙ');
    const ownerEntry = second.last().results.find((item) => item.stepRef === 'owner:u');
    expect(ownerEntry.owner.approved).toEqual({ id: 'spec', version: 2 });
  });

  test('9. a document in a json answer: its text is the pointer value, version 1', async () => {
    const steps = [
      { ref: 'r1', kind: 'round', models: ['A'], input: 'none', output: { format: 'json', document: 'read', artifacts: [{ id: 'doc', name: 'Д', pointer: '/body' }] } },
      { ref: 'owner:u', kind: 'owner', task: 'Уточните', document: 'r1' }
    ];
    const { send } = transport({ A: ['{"body":"ТЕКСТ-JSON"}'] });
    const { provideOwnerResult, calls: asked } = owner(['ТЕКСТ-JSON']);
    const result = await Engine.run({ task: 'T', steps, send, provideOwnerResult });
    expect(result.stopReason).toBe('steps_done');
    expect(asked[0].document).toEqual({ ref: 'r1', kind: 'read', text: 'ТЕКСТ-JSON', id: 'doc', name: 'Д', version: 1 });
  });
});
