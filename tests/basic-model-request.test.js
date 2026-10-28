const fs = require('fs');
const path = require('path');
const Engine = require('../disput/custom-engine');
const Schema = require('../disput/basic-schema');

const doc = fs.readFileSync(path.join(__dirname, '..', 'docs', 'Pipeline scenarios', 'basic-model-request.md'), 'utf8');

// The request text is the block between the two lines of four backticks.
function requestText() {
  const match = doc.match(/^````\n([\s\S]*?)\n````$/m);
  expect(match).not.toBeNull();
  return match[1];
}

// The first ```json block of the request document is the example schema.
function exampleSchema() {
  const blocks = [...doc.matchAll(/```json\n([\s\S]*?)\n```/g)].map((match) => match[1]);
  expect(blocks.length).toBeGreaterThan(0);
  return JSON.parse(blocks[0]);
}

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

const QUESTIONNAIRE = JSON.stringify({
  items: [
    { id: 'scope', type: 'one', question: 'Что важнее', options: ['запись', 'оплата'], required: true },
    { id: 'notes', type: 'text', question: 'Что ещё' }
  ]
});
const ROUND2_CLAUDE = 'Claude предлагает функции: расписание занятий, напоминания клиентам, онлайн-оплата абонементов, отчёты для тренера, личный кабинет ученика, отмена и перенос записи без звонка администратору.';
const ROUND2_GPT = 'GPT предлагает функции: календарь групповых программ, автоматическая очередь ожидания при заполнении группы, история посещений, экспорт данных в таблицу, роли администратора и тренера, шаблоны уведомлений.';
const ROUND2_GEMINI = 'Gemini предлагает функции: карта зала с выбором места, возврат средств при отмене, интеграция с календарём телефона, гибкие правила отмены, опросы качества занятий, аналитика загрузки по дням недели.';
const DOC_MAP = '[[DOC: map]]\nКарта функций: уникальнаяКартаXYZ — запись на занятия.\n[[/DOC]]';
const DOC_FINAL = '[[DOC: map-final]]\nКарта функций итог: уникальнаяКартаXYZ — запись на занятия.\n[[/DOC]]';

describe('Basic model request: example schema', () => {
  test('the example schema from the request parses and passes the check', () => {
    const schema = exampleSchema();
    expect(Schema.validate(schema)).toEqual([]);
  });

  test('the example schema runs on a fake transport to the end', async () => {
    const schema = exampleSchema();
    // Claude answers r1, r2, r3 and r4 in that order; GPT and Gemini answer r2.
    const { send } = transport({
      Claude: [QUESTIONNAIRE, ROUND2_CLAUDE, DOC_MAP, DOC_FINAL],
      GPT: [ROUND2_GPT],
      Gemini: [ROUND2_GEMINI]
    });
    const { provideOwnerResult } = owner(['Что важнее — запись', 'утвердить']);
    const result = await Engine.run({ task: 'T', steps: Schema.assemble(schema, { roleText: () => 'ROLE' }), send, provideOwnerResult });

    expect(result.stopReason).toBe('steps_done');
  });

  test('the second round sends the first User answer to the models', async () => {
    const schema = exampleSchema();
    const { send, calls } = transport({
      Claude: [QUESTIONNAIRE, ROUND2_CLAUDE, DOC_MAP, DOC_FINAL],
      GPT: [ROUND2_GPT],
      Gemini: [ROUND2_GEMINI]
    });
    const { provideOwnerResult } = owner(['Что важнее — запись', 'утвердить']);
    await Engine.run({ task: 'T', steps: Schema.assemble(schema, { roleText: () => 'ROLE' }), send, provideOwnerResult });

    const roundTwo = calls.find((call) => call.models.includes('GPT'));
    expect(roundTwo).toBeDefined();
    expect(roundTwo.prompts.GPT).toContain('Что важнее — запись');
    expect(roundTwo.prompts.Gemini).toContain('Что важнее — запись');
  });

  test('the User window is opened twice: first as a form, then as a read document', async () => {
    const schema = exampleSchema();
    const { send } = transport({
      Claude: [QUESTIONNAIRE, ROUND2_CLAUDE, DOC_MAP, DOC_FINAL],
      GPT: [ROUND2_GPT],
      Gemini: [ROUND2_GEMINI]
    });
    const { provideOwnerResult, calls: asked } = owner(['Что важнее — запись', 'утвердить']);
    await Engine.run({ task: 'T', steps: Schema.assemble(schema, { roleText: () => 'ROLE' }), send, provideOwnerResult });

    expect(asked).toHaveLength(2);
    expect(asked[0].document.kind).toBe('form');
    expect(asked[1].document.kind).toBe('read');
  });

  test('the last round gets the map as the User sent it from the document window', async () => {
    const schema = exampleSchema();
    const { send, calls } = transport({
      Claude: [QUESTIONNAIRE, ROUND2_CLAUDE, DOC_MAP, DOC_FINAL],
      GPT: [ROUND2_GPT],
      Gemini: [ROUND2_GEMINI]
    });
    // The document window answers with the text of the document: the owner's edit and notes are in it.
    const { provideOwnerResult } = owner(['Что важнее — запись', 'Карта функций: уникальнаяКартаXYZ — запись на занятия. ДОБАВИТЬ: оплата']);
    await Engine.run({ task: 'T', steps: Schema.assemble(schema, { roleText: () => 'ROLE' }), send, provideOwnerResult });

    const claudeCalls = calls.filter((call) => call.models.includes('Claude'));
    const lastRound = claudeCalls[claudeCalls.length - 1];
    expect(lastRound.prompts.Claude).toContain('ДОБАВИТЬ: оплата');
  });

  test('the request text keeps its key formulations, forbids the removed steps and does not mention the stand', () => {
    const text = requestText();
    expect(text).toContain('Постоянный чат');
    expect(text).toContain('ничего не понимает и не решает');
    expect(text).toContain('Не больше двух шагов User');
    expect(text).toContain('личное заменяет');
    expect(text).toContain('Шагов `file`, `gate`');
    expect(text.toLowerCase()).not.toContain('стенд');
  });
});
