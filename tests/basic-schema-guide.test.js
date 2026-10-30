const fs = require('fs');
const path = require('path');
const Engine = require('../disput/custom-engine');
const Schema = require('../disput/basic-schema');

const root = path.join(__dirname, '..');
const guide = fs.readFileSync(path.join(root, 'docs', 'Pipeline scenarios', 'basic-schema-guide.md'), 'utf8');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

// The facts the guide lists, taken from the code the page uses.
const runtimeModels = [...read('pipeline/pipeline-runtime.js').matchAll(/\{ name: '([^']+)', defaultActive/g)].map((match) => match[1]);
const prompts = JSON.parse(read('prompts.json')).judgeSystemPrompts;
const roleIds = [...prompts.map((prompt) => prompt.id), 'custom'];
const lengthBlock = read('pipeline_panel.html').match(/id="debate-length-select"[\s\S]*?<\/select>/)[0];
const lengthOptions = [...lengthBlock.matchAll(/<option value="(\d+)"/g)].map((match) => Number(match[1]));

const section = (title) => {
  const start = guide.indexOf(`\n### ${title}`) >= 0 ? guide.indexOf(`\n### ${title}`) : guide.indexOf(`\n## ${title}`);
  const next = guide.slice(start + 3).search(/\n#{2,3} /);
  return guide.slice(start, next < 0 ? undefined : start + 3 + next);
};
const tableFirstColumn = (text) => text.split('\n').filter((line) => /^\| `/.test(line)).map((line) => line.split('|')[1].trim().replace(/^`|`$/g, ''));

describe('Basic schema guide stays true to the code', () => {
  test('it names the format version of the code', () => {
    expect(guide).toContain(`Поддерживаются форматы схемы **1** и **${Schema.SCHEMA_VERSION}**`);
  });

  test('every JSON example passes the check, shows on the canvas and assembles', () => {
    const examples = [...guide.matchAll(/```json\n([\s\S]*?)\n```/g)].map((match) => JSON.parse(match[1]));
    expect(examples.length).toBeGreaterThanOrEqual(5);
    examples.forEach((schema) => {
      expect(Schema.validate(schema)).toEqual([]);
      const canvas = Schema.toCanvas(schema, { models: runtimeModels, isRole: (id) => roleIds.includes(id), runWords: lengthOptions });
      expect(canvas.errors).toEqual([]);
      expect(Schema.assemble(schema, { roleText: () => 'ROLE' }).length).toBeGreaterThan(0);
    });
  });

  test('the models of the guide are the models of the canvas, in the same spelling', () => {
    expect(tableFirstColumn(section('7.1')).sort()).toEqual(runtimeModels.slice().sort());
  });

  test('the roles of the guide are the roles of the page: ids, names and Custom', () => {
    const rows = section('7.2').split('\n').filter((line) => /^\| `/.test(line)).map((line) => line.split('|').slice(1, 3).map((cell) => cell.trim().replace(/^`|`$/g, '')));
    expect(rows.map(([id]) => id).sort()).toEqual(roleIds.slice().sort());
    prompts.forEach((prompt) => expect(rows).toContainEqual([prompt.id, prompt.label]));
  });

  test('the defaults of the guide are the defaults of Basic', () => {
    [Schema.DEFAULTS.roundTask, Schema.DEFAULTS.discipline.limit, Schema.DEFAULTS.discipline.content,
      Schema.DEFAULTS.discipline.delivery, Schema.DEFAULTS.discipline.correction].forEach((text) => expect(section('4')).toContain(text));
    expect(section('4')).toContain(`\`${Schema.DEFAULTS.run.policy}\``);
    expect(section('4')).toContain(`\`${Schema.DEFAULTS.run.maxWords}\``);
    expect(section('4')).toContain(`\`${Schema.DEFAULTS.run.strictLength}\``);
  });

  test('the allowed shared limits are the ones of the length select', () => {
    expect(section('5.2')).toContain(`${lengthOptions.slice(0, -1).join(', ')} или ${lengthOptions[lengthOptions.length - 1]}`);
    expect(section('8')).toContain(`${lengthOptions.slice(0, -1).join(', ')} или ${lengthOptions[lengthOptions.length - 1]}`);
  });

  test('every error message of the guide is a message the code can give', () => {
    const source = `${read('disput/basic-schema.js')}\n${read('results.js')}`;
    const messages = tableFirstColumn(section('10'));
    expect(messages.length).toBeGreaterThanOrEqual(20);
    // A message built from a label and a list ("тип шага: допустимо …") is checked by its two parts.
    messages.forEach((message) => message.split(': допустимо').forEach((part, index) => expect(source).toContain(index ? ': допустимо' : part)));
  });

  test('the example of the assembled request is what the code assembles', () => {
    const schema = { schemaVersion: 1, origin: 'user', defaults: { discipline: { lines: ['Отвечай по-русски.'] } },
      steps: [{ ref: 'r1', kind: 'round', models: [{ name: 'GPT' }, { name: 'Claude' }] }, { ref: 'r2', kind: 'round', models: [{ name: 'GPT', role: 'interaction_critical_audit' }] }] };
    const step = Engine.normalizeSteps(Schema.assemble(schema, { roleText: (role) => (role ? '<ТЕКСТ РОЛИ Critique>' : '') }))[1];
    const model = step.models[0];
    const base = Engine.buildPrompt({ task: 'Придумай название для кофейни.', step, model,
      input: [{ text: 'Ответ первой модели.' }, { text: 'Ответ второй модели.' }], inputMode: 'previous' });
    const limit = model.discipline.limit.replace(/\{от\}|\{слов\}/g, (key) => (key === '{от}' ? '250' : '300'));
    expect(guide).toContain([base, limit, model.discipline.content, ...model.discipline.lines].join('\n\n'));
  });

  test('the step names the guide teaches are the ones the code checks', () => {
    const bad = (steps) => Schema.toCanvas({ schemaVersion: 1, origin: 'user', steps }, { models: runtimeModels }).errors.length;
    const round = (ref, models = [{ name: 'GPT' }]) => ({ ref, kind: 'round', models });
    // A synthesis is a round of one model with a role: its ref is the number of the round, as any round.
    expect(bad([round('r1'), round('r2', [{ name: 'Claude', role: 'interaction_meta_synthesis' }])])).toBe(0);
    expect(bad([round('r1'), round('final', [{ name: 'Claude', role: 'interaction_meta_synthesis' }])])).toBeGreaterThan(0);
    expect(bad([round('r2')])).toBeGreaterThan(0);
    expect(Schema.validate({ schemaVersion: 1, origin: 'user', steps: [round('r1'), { ref: 'final', kind: 'synthesis', models: [{ name: 'GPT' }] }] }))
      .toEqual([{ path: 'steps[1].kind', message: 'тип шага: допустимо round, owner; синтез — роль: раунд из одной модели с role' }]);
  });
});

// A template is a working scenario, not only a valid JSON: each one runs on a fake transport to the end. The transport answers
// in the form the output of the step asks for (a document between its marks, a questionnaire, JSON fields); the owner sends
// the document back with an edit, so a later step that takes the latest version must get the owner's edit.
describe('Basic schema guide: every template runs to the end', () => {
  const FORM = JSON.stringify({ items: [{ id: 'q', type: 'one', question: 'Что важнее', options: ['а', 'б'] }] });
  const answerFor = (step, model) => {
    const output = model.output ?? step.output;
    if (output?.document === 'form') return FORM;
    if (output?.format === 'json') {
      const value = {};
      [...(output.requiredFields || []), ...(output.artifacts || []).map((item) => item.pointer)].forEach((pointer) => {
        const keys = pointer.split('/').slice(1);
        let at = value;
        keys.slice(0, -1).forEach((key) => { at = at[key] = at[key] || {}; });
        at[keys[keys.length - 1]] = `ПОЛЕ-${step.ref}-${keys.join('.')}`;
      });
      return JSON.stringify(value);
    }
    if (output?.document === 'read') return `Пояснение.\n[[DOC: ${output.artifacts[0].id}]]\nДОК-${step.ref}-${output.artifacts[0].id}\n[[/DOC]]`;
    return `ОТВЕТ-${step.ref}-${model.id}`;
  };
  const examples = [...guide.matchAll(/```json\n([\s\S]*?)\n```/g)].map((match) => JSON.parse(match[1]));

  test.each(examples.map((schema, index) => [index + 1, schema]))('example %i', async (number, schema) => {
    const steps = Schema.assemble(schema, { roleText: () => 'ROLE' });
    const prompts = {};
    const send = async (models, promptsByModel, meta) => {
      const step = steps.find((item) => item.ref === meta.stepRef);
      prompts[meta.stepRef] = { ...(prompts[meta.stepRef] || {}), ...promptsByModel };
      return { byModel: Object.fromEntries(models.map((name) => [name, { text: answerFor(step, step.models.find((model) => model.name === name)), status: 'SUCCESS' }])), closedByOwner: false };
    };
    const provideOwnerResult = async ({ document }) => {
      if (document?.kind === 'read') return `${document.text}\nПРАВКА-USER`;
      return document?.kind === 'form' ? 'Что важнее — а' : 'ОТВЕТ-USER';
    };
    const result = await Engine.run({ task: 'T', steps, send, provideOwnerResult, runMaxWords: schema.run?.maxWords, runStrictLength: schema.run?.strictLength === true });
    expect(result.stopReason).toBe('steps_done');
    expect(result.answers.length).toBeGreaterThan(0);
    // Template G: the judge revises the owner's version of the table; the recommendation reads the revised one.
    if (schema.steps.some((step) => step.ref === 'owner:choice')) {
      expect(prompts.r6.GPT).toContain('ПРАВКА-USER');
      expect(prompts.r7.Claude).toContain('ДОК-r6-table');
      expect(result.artifacts.filter((entry) => entry.id === 'table').map((entry) => entry.source.step)).toEqual(['r4', 'owner:table', 'r6']);
    }
  });
});
