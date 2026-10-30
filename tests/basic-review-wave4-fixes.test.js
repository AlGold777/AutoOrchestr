const fs = require('fs');
const path = require('path');
const Engine = require('../disput/custom-engine');
const Schema = require('../disput/basic-schema');
const Output = require('../disput/basic-output');
const Acceptance = require('../disput/debate-response-acceptance');

// Review wave 4 (A2–A13): one test block per item of the review.

// A scripted transport (as in custom-engine.test.js): answers[model] is a list of replies, one per request to that model.
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

const base = (steps, extra = {}) => ({ schemaVersion: 1, origin: 'user', description: 'Описание схемы', steps, ...extra });
const errorPaths = (schema) => Schema.validate(schema).map((error) => error.path);
const warningPaths = (schema) => Schema.warnings(schema).map((item) => item.path);

const requestDoc = fs.readFileSync(path.join(__dirname, '..', 'docs', 'Scheme create', 'basic-model-request.md'), 'utf8');
const requestText = requestDoc.match(/^````\n([\s\S]*?)\n````$/m)[1];

describe('A2, A3: the model request agrees with the validator and the engine', () => {
  test('the repeat rule has its exception for the input that revisionOf names', () => {
    expect(requestText).toContain('кроме входа, на который ссылается `revisionOf`');
  });

  test('auto asks the owner about an incomplete round; manual (also without run) pauses after every step', () => {
    expect(requestText).toContain('спрашивает User (повторить, пропустить участника или шаг, остановить)');
    expect(requestText).toContain('Без `run` и при "manual" приложение ставит паузу после каждого шага');
    expect(Schema.resolveRun({ schemaVersion: 1, steps: [] }).policy).toBe('manual');
  });

  test('a long document is not cut with strictLength false: the model only gets the request to fit', () => {
    expect(requestText).toContain('по умолчанию (`strictLength: false`) документ не сокращается');
    expect(Schema.resolveRun({ schemaVersion: 1, steps: [] }).strictLength).toBe(false);
  });

  test('an artifact has a short description in the example', () => {
    expect(requestText).toContain('"description": "Функции с пользой для каждой"');
  });
});

describe('A4: the validator checks what the request declares; remarks do not block', () => {
  test('run.maxWords outside 300, 500, 700, 1000 is an error of the validator, not only of the canvas', () => {
    expect(errorPaths(base([{ ref: 'r1', kind: 'round', models: [{ name: 'GPT' }], task: 'T' }], { run: { maxWords: 250 } }))).toEqual(['run.maxWords']);
    expect(errorPaths(base([{ ref: 'r1', kind: 'round', models: [{ name: 'GPT' }], task: 'T' }], { run: { maxWords: 500 } }))).toEqual([]);
  });

  test('the round order r1…rN is a remark (existing schemas with gaps stay valid for the validator)', () => {
    const gapped = base([{ ref: 'r1', kind: 'round', models: [{ name: 'GPT' }], task: 'T' }, { ref: 'r3', kind: 'round', models: [{ name: 'GPT' }], task: 'T' }]);
    expect(errorPaths(gapped)).toEqual([]);
    expect(warningPaths(gapped)).toEqual(['steps[1].ref']);
  });

  test('warnings: a round without task, an empty task of a participant, no description, more than two steps of User', () => {
    const noTask = base([{ ref: 'r1', kind: 'round', models: [{ name: 'GPT' }] }]);
    expect(warningPaths(noTask)).toEqual(['steps[0].task']);
    const emptyTask = base([{ ref: 'r1', kind: 'round', models: [{ name: 'GPT', task: '' }, { name: 'Claude' }], task: 'T' }]);
    expect(warningPaths(emptyTask)).toEqual(['steps[0].models[0].task']);
    const noDescription = { schemaVersion: 1, origin: 'user', steps: [{ ref: 'r1', kind: 'round', models: [{ name: 'GPT' }], task: 'T' }] };
    expect(warningPaths(noDescription)).toEqual(['description']);
    const owners = base([{ ref: 'r1', kind: 'round', models: [{ name: 'GPT' }], task: 'T' },
      { ref: 'owner:a', kind: 'owner', task: 'A', models: [] }, { ref: 'owner:b', kind: 'owner', task: 'B', models: [] }, { ref: 'owner:c', kind: 'owner', task: 'C', models: [] }]);
    expect(warningPaths(owners)).toContain('steps');
    expect(errorPaths(owners)).toEqual([]);
  });
});

describe('A5: an incomplete round keeps its accepted answers when the owner skips the participants', () => {
  test('skip_participant goes on with the accepted answers of the round', async () => {
    const { send, calls } = transport({ A: ['a1'], B: [] });
    const decide = jest.fn(async () => 'skip_participant');
    const result = await Engine.run({
      task: 'T', steps: [{ task: 'x', input: 'none', models: ['A', 'B'] }, { task: 'y', input: 'previous', models: ['A'] }], send, decide
    });
    expect(decide.mock.calls[0][0].choices).toEqual(['retry', 'skip_participant', 'skip', 'stop']);
    expect(result.steps[0].skipped).toBe(false);
    expect(calls[calls.length - 1].prompts.A).toContain('a1');
    expect(result.stopReason).toBe('steps_done');
  });

  test('skip (the whole step) passes nothing on, as before', async () => {
    const { send, calls } = transport({ A: ['a1'], B: [] });
    const decide = jest.fn(async () => 'skip');
    const result = await Engine.run({
      task: 'T', steps: [{ task: 'x', input: 'none', models: ['A', 'B'] }, { task: 'y', input: 'previous', models: ['A'] }], send, decide
    });
    expect(result.steps[0].skipped).toBe(true);
    expect(calls[calls.length - 1].prompts.A || '').not.toContain('a1');
  });

  test('skip_participant with no accepted answer is the whole step', async () => {
    const { send } = transport({ A: [], B: ['b1'] });
    const decide = jest.fn(async () => 'skip_participant');
    const result = await Engine.run({
      task: 'T', steps: [{ task: 'x', input: 'none', models: ['A'] }, { task: 'y', input: 'previous', models: ['B'] }], send, decide
    });
    expect(result.steps[0].skipped).toBe(true);
  });

  test('the page offers the whole-step skip as a separate button, not the main one', () => {
    const html = fs.readFileSync(path.join(__dirname, '..', 'result_new.html'), 'utf8');
    expect(html).toContain('id="skip-step-confirm"');
    const results = fs.readFileSync(path.join(__dirname, '..', 'results.js'), 'utf8');
    expect(results).toContain("confirmText: canContinue ? 'Продолжить' : 'Пропустить участника'");
    expect(results).toContain("skipStepText: !canContinue && choices.includes('skip') ? 'Пропустить шаг целиком' : ''");
  });
});

describe('A7: the acceptance refuses a PARTIAL answer without proof and an echo of the request', () => {
  const prompt = 'Задача: спроектировать процесс под реальную задачу и записать его как схему Basic в строгом формате JSON. Ответь кратко.';

  test('a PARTIAL answer without proof of its end is refused at any length', () => {
    const long = Array.from({ length: 80 }, (_, i) => `слово${i}`).join(' ') + '.';
    expect(Acceptance.evaluate({ text: long, meta: { completion: 'partial', status: 'PARTIAL' } }).reason).toBe('partial_unproven');
  });

  test('an answer that repeats the start of its request is refused as prompt_echo', () => {
    const echo = `${prompt.slice(0, 60)} и далее текст, который модель повторила вместо ответа.`;
    expect(Acceptance.evaluate({ text: echo, meta: { completion: 'complete', prompt } })).toMatchObject({ ok: false, reason: 'prompt_echo' });
  });

  test('a normal answer, proven complete, is accepted as before', () => {
    const answer = 'Процесс делится на этапы: сбор материалов, черновик, проверка и решение User.';
    expect(Acceptance.evaluate({ text: answer, meta: { completion: 'complete', status: 'SUCCESS', prompt } }).ok).toBe(true);
    expect(Acceptance.evaluate({ text: 'Да.', meta: { completion: 'complete', status: 'SUCCESS' } }).ok).toBe(true);
  });

  test('the reason has its text in the engine', () => {
    expect(Engine.REASON_TEXT.partial_unproven).toBeTruthy();
    expect(Engine.REASON_TEXT.prompt_echo).toBeTruthy();
  });
});

describe('A12: the owner dialogs show the start of the wait', () => {
  test('the waiting dialogs take the start from the engine event, as HH:MM', () => {
    const results = fs.readFileSync(path.join(__dirname, '..', 'results.js'), 'utf8');
    expect(results).toContain("if (kind === 'custom_wait_start') customWaitSince = Number(fields.startedAt) || 0;");
    expect(results).toContain('`Ожидает с ${new Date(customWaitSince).toLocaleTimeString');
    expect((results.match(/waitSinceText\(\)/g) || []).length).toBe(2);
  });
});

describe('A13: the delivery mark and the document marks do not reach the next step', () => {
  test('cleanAnswer strips the mark at the end and the document marks, the content stays', () => {
    expect(Output.cleanAnswer('Итог.\n[[DOC: map]]\nКарта\n[[/DOC]]\n[[AO-1a2b3c]]')).toBe('Итог.\n\nКарта');
    expect(Output.cleanAnswer('без меток')).toBe('без меток');
  });

  test('the next step gets the answer without the marks', async () => {
    const { send, calls } = transport({ A: ['Ответ по существу.\n[[AO-1a2b3c]]'], B: ['ok.'] });
    await Engine.run({ task: 'T', steps: [{ task: 'x', input: 'none', models: ['A'] }, { task: 'y', input: 'previous', models: ['B'] }], send });
    const next = calls[calls.length - 1].prompts.B;
    expect(next).toContain('Ответ по существу.');
    expect(next).not.toContain('[[AO-');
  });
});
