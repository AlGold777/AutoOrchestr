const fs = require('fs');
const path = require('path');
const Engine = require('../disput/custom-engine');
const Schema = require('../disput/basic-schema');

const guide = fs.readFileSync(path.join(__dirname, '..', 'docs', 'Pipeline scenarios', 'basic-schema-guide.md'), 'utf8');

// The template «Шаблон F. Карта функций» is the ```json block of the guide whose text names the artifact map-final.
function templateSchema() {
  const text = [...guide.matchAll(/```json\n([\s\S]*?)\n```/g)].map((match) => match[1]).find((item) => /"id":\s*"map-final"/.test(item));
  expect(text).toBeDefined();
  return JSON.parse(text);
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

describe('Basic guide: template F (feature map)', () => {
  test('the feature map template passes the check, shows on the canvas and assembles', () => {
    const schema = templateSchema();
    expect(Schema.validate(schema)).toEqual([]);
    expect(Schema.toCanvas(schema, { models: ['Claude', 'GPT', 'Gemini'], isRole: (id) => id === 'interaction_meta_synthesis', runWords: [300, 500, 700, 1000] }).errors).toEqual([]);
    expect(Schema.assemble(schema, { roleText: () => 'ROLE' }).length).toBeGreaterThan(0);
  });

  test('the feature map template runs on a fake transport to the end', async () => {
    const schema = templateSchema();
    const DOC_MAP = '[[DOC: map]]\n# Карта\n- Функция A — польза\n[[/DOC]]';
    const DOC_FINAL = '[[DOC: map-final]]\n# Карта\n- Функция A\n- Функция B\n[[/DOC]]';
    // Claude answers r1, r2 and r4; GPT answers r1; Gemini answers r1, r3 and r5.
    const { send, calls } = transport({
      Claude: ['ответ Claude', DOC_MAP, DOC_FINAL],
      GPT: ['ответ GPT'],
      Gemini: ['ответ Gemini', 'прошло', 'прошло']
    });
    const { provideOwnerResult, calls: asked } = owner(['доработать: добавь функцию B', 'утверждаю']);
    const result = await Engine.run({ task: 'T', steps: Schema.assemble(schema, { roleText: () => 'ROLE' }), send, provideOwnerResult });

    expect(result.stopReason).toBe('steps_done');

    expect(asked).toHaveLength(2);
    asked.forEach((request) => expect(request.document.kind).toBe('read'));
    expect(asked[0].document.name).toBe('Карта функций');

    const claudeCalls = calls.filter((call) => call.models.includes('Claude'));
    expect(claudeCalls[2].prompts.Claude).toContain('доработать: добавь функцию B');
    const occurrences = (claudeCalls[2].prompts.Claude.match(/- Функция A — польза/g) || []).length;
    expect(occurrences).toBeLessThanOrEqual(1);

    const ids = result.artifacts.map((item) => item.id);
    expect(ids).toContain('map');
    expect(ids).toContain('map-final');
  });
});
