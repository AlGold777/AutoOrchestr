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
    expect(guide).toContain(`Версия формата схемы: **${Schema.SCHEMA_VERSION}**`);
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
    [Schema.DEFAULTS.roundTask, Schema.DEFAULTS.synthesisTask, Schema.DEFAULTS.discipline.limit, Schema.DEFAULTS.discipline.content,
      Schema.DEFAULTS.discipline.delivery, Schema.DEFAULTS.discipline.correction].forEach((text) => expect(section('4')).toContain(text));
    expect(section('4')).toContain(`\`${Schema.DEFAULTS.run.policy}\``);
    expect(section('4')).toContain(`\`${Schema.DEFAULTS.run.maxWords}\``);
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
    const round = (ref) => ({ ref, kind: 'round', models: [{ name: 'GPT' }] });
    const synth = (ref) => ({ ref, kind: 'synthesis', models: [{ name: 'GPT' }] });
    expect(bad([round('r1'), synth('synth:mid'), round('r2'), synth('final')])).toBe(0);
    expect(bad([round('r1'), synth('synth:проверка'), round('r2')])).toBeGreaterThan(0);
    expect(bad([round('r2')])).toBeGreaterThan(0);
  });
});
