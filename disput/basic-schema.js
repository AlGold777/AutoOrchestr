// Basic schema: the saved form of a pipeline on the Basic engine (disput/custom-engine.js).
// A schema holds only explicit overrides; every field it does not mention comes from DEFAULTS here.
// One place assembles the final configuration: resolveFields (a value of a card) and assemble
// (the engine's steps). The canvas, the request preview and the run all go through them, and
// validate() runs before the first request. Rules: docs/Pipeline scenarios/basic-engine-and-schemas.md,
// field reference: docs/Pipeline scenarios/basic-schema-reference.md.
//
// Schema: { schemaVersion, origin: 'builtin' | 'user', basedOn?, defaults?, steps }
//   defaults (the ▶ card): { roundTask?, synthesisTask?, discipline?, modelNotes?, roundPrompts? }
//   step: { ref, kind: 'round' | 'synthesis', order?, input?, task?, models }
//   model: { name, role?, request?, maxWords?, task?, discipline? }
//   discipline: { limit?, content?, delivery?, correction?, lines? }
// A missing field is inherited; a given value applies, an empty string included (an empty text is
// a value, not inheritance). Lists are replaced as a whole. A step with no models is switched off:
// it stays valid and keeps its place in the numbering, but assemble() gives the engine no step for it.
(function initBasicSchema(root) {
  'use strict';

  const Engine = root.CustomEngine || (typeof require === 'function' ? require('./custom-engine') : null);

  const SCHEMA_VERSION = 1;
  // Every released version stays supported; a newer one than this Basic is refused.
  const SUPPORTED_VERSIONS = Object.freeze([1]);
  const ORIGINS = Object.freeze(['builtin', 'user']);
  const KINDS = Object.freeze(['round', 'synthesis']);
  const ORDERS = Object.freeze(['parallel', 'sequential']);
  const INPUTS = Object.freeze(['none', 'previous', 'all']);

  const DEFAULTS = Object.freeze({
    roundTask: 'Учти ответы предыдущего шага и дай свой улучшенный ответ на задачу.',
    synthesisTask: Engine.SYNTHESIS_TASK,
    discipline: Object.freeze({
      limit: '[RESPONSE_LIMIT] Объём ответа: {от}-{слов} слов, не больше.',
      content: 'Сосредоточься на ясной концепции и ключевых идеях; убери повторы, длинные пересказы и второстепенные детали.',
      delivery: 'Последней строкой ответа напиши только метку {метка}',
      correction: Engine.CORRECTION_TEMPLATE
    })
  });

  const isObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

  // The first layer that has a string wins, an empty one included; no layer — the code default.
  function pick(layers, fallback = '') {
    for (const [source, value] of layers) if (typeof value === 'string') return { value, source };
    return { value: fallback, source: 'basic' };
  }

  // The value of one card: model → round (reserved for the round card) → ▶ → Basic.
  // `model` is { task?, discipline? }, `defaults` is the ▶ layer of the schema.
  function resolveFields(model = {}, kind = 'round', round = {}, defaults = {}) {
    const taskKey = kind === 'synthesis' ? 'synthesisTask' : 'roundTask';
    return {
      task: pick([['model', model?.task], ['round', round?.task], ['pipeline', defaults?.[taskKey]]], DEFAULTS[taskKey]),
      discipline: Object.fromEntries(Object.entries(DEFAULTS.discipline).map(([key, fallback]) => [key,
        pick([['model', model?.discipline?.[key]], ['round', round?.discipline?.[key]], ['pipeline', defaults?.discipline?.[key]]], fallback)]))
    };
  }

  // The first round has no input; a later round gets the previous step; a synthesis always the previous step.
  const defaultInput = (kind, roundIndex) => (kind === 'round' && roundIndex === 0 ? 'none' : 'previous');

  // Engine steps from a schema. `context.roleText(role, ref)` turns a model's role into its extra text.
  function assemble(schema, { roleText = () => '' } = {}) {
    const defaults = schema.defaults || {};
    const finalStep = schema.steps.find((step) => step.ref === 'final');
    let rounds = 0;
    return schema.steps.map((step) => {
      const roundIndex = step.kind === 'round' ? rounds++ : -1;
      const input = step.input || defaultInput(step.kind, roundIndex);
      const stepFields = resolveFields({ task: step.task }, step.kind, {}, defaults);
      const out = { kind: step.kind, ref: step.ref };
      if (step.kind === 'round') out.order = step.order || 'parallel';
      out.task = input === 'none' ? '' : stepFields.task.value;
      if (step.kind === 'round') out.input = input;
      out.models = (step.models || []).map((model) => {
        const resolved = resolveFields(model, step.kind, { task: step.task }, defaults);
        const lines = [...(defaults.discipline?.lines || []), ...(model.discipline?.lines || [])];
        // An intermediate synthesis without its own request runs the final synthesizer's request.
        const finalRequest = step.ref.startsWith('synth:') ? finalStep?.models?.find((item) => item.name === model.name)?.request : '';
        return {
          name: model.name,
          promptTemplate: model.request || finalRequest || null,
          maxWords: model.maxWords || null,
          extra: roleText(model.role || '', step.ref) || '',
          task: input === 'none' ? '' : resolved.task.value,
          discipline: {
            ...Object.fromEntries(Object.entries(resolved.discipline).map(([key, item]) => [key, item.value])),
            ...(lines.length ? { lines } : {})
          }
        };
      });
      return out;
    }).filter((step) => step.models.length);
  }

  // Errors before the first request: [{ path, message }]. A schema is never corrected silently.
  function validate(schema) {
    const errors = [];
    const fail = (path, message) => errors.push({ path, message });
    const unknownKeys = (value, allowed, path) => Object.keys(value).forEach((key) => { if (!allowed.includes(key)) fail(path ? `${path}.${key}` : key, 'неизвестное поле'); });
    const oneOf = (value, list, path, label) => { if (!list.includes(value)) fail(path, `${label}: допустимо ${list.join(', ')}`); };
    const text = (value, path) => { if (typeof value !== 'string') fail(path, 'ожидается текст'); };

    if (!isObject(schema)) return [{ path: '', message: 'схема должна быть объектом' }];
    if (!Number.isInteger(schema.schemaVersion)) fail('schemaVersion', 'версия формата не указана');
    else if (schema.schemaVersion > Math.max(...SUPPORTED_VERSIONS)) fail('schemaVersion', `схема создана более новой версией Basic (формат ${schema.schemaVersion}); обновите расширение`);
    else if (!SUPPORTED_VERSIONS.includes(schema.schemaVersion)) fail('schemaVersion', `версия формата ${schema.schemaVersion} не поддерживается`);
    oneOf(schema.origin, ORIGINS, 'origin', 'происхождение');
    if (schema.basedOn != null) text(schema.basedOn, 'basedOn');
    unknownKeys(schema, ['schemaVersion', 'origin', 'basedOn', 'defaults', 'steps'], '');

    const checkDiscipline = (value, path) => {
      if (!isObject(value)) { fail(path, 'ожидается объект'); return; }
      unknownKeys(value, ['limit', 'content', 'delivery', 'correction', 'lines'], path);
      ['limit', 'content', 'delivery', 'correction'].forEach((key) => { if (key in value) text(value[key], `${path}.${key}`); });
      if ('lines' in value) {
        if (!Array.isArray(value.lines)) fail(`${path}.lines`, 'ожидается список текстов');
        else value.lines.forEach((line, index) => text(line, `${path}.lines[${index}]`));
      }
    };

    if (schema.defaults != null) {
      const defaults = schema.defaults;
      if (!isObject(defaults)) fail('defaults', 'ожидается объект');
      else {
        unknownKeys(defaults, ['roundTask', 'synthesisTask', 'discipline', 'modelNotes', 'roundPrompts'], 'defaults');
        ['roundTask', 'synthesisTask'].forEach((key) => { if (key in defaults) text(defaults[key], `defaults.${key}`); });
        if ('discipline' in defaults) checkDiscipline(defaults.discipline, 'defaults.discipline');
        ['modelNotes', 'roundPrompts'].forEach((key) => {
          if (!(key in defaults)) return;
          if (!isObject(defaults[key])) fail(`defaults.${key}`, 'ожидается объект с текстами');
          else Object.entries(defaults[key]).forEach(([name, value]) => text(value, `defaults.${key}.${name}`));
        });
      }
    }

    if (!Array.isArray(schema.steps)) { fail('steps', 'ожидается список шагов'); return errors; }
    const refs = new Set();
    schema.steps.forEach((step, index) => {
      const path = `steps[${index}]`;
      if (!isObject(step)) { fail(path, 'ожидается объект'); return; }
      unknownKeys(step, ['ref', 'kind', 'order', 'input', 'task', 'models'], path);
      if (typeof step.ref !== 'string' || !step.ref) fail(`${path}.ref`, 'ref шага не указан');
      else if (refs.has(step.ref)) fail(`${path}.ref`, `ref «${step.ref}» повторяется`);
      else refs.add(step.ref);
      oneOf(step.kind, KINDS, `${path}.kind`, 'тип шага');
      if ('order' in step) {
        oneOf(step.order, ORDERS, `${path}.order`, 'порядок');
        if (step.kind === 'synthesis') fail(`${path}.order`, 'у синтеза порядка нет: он одна модель-синтезатор или параллельный');
      }
      if ('input' in step) {
        oneOf(step.input, INPUTS, `${path}.input`, 'вход');
        if (step.kind === 'synthesis' && step.input !== 'previous') fail(`${path}.input`, 'синтез всегда получает ответы предыдущего шага');
      }
      if ('task' in step) text(step.task, `${path}.task`);
      if (!Array.isArray(step.models)) { fail(`${path}.models`, 'ожидается список моделей'); return; }
      const names = new Set();
      step.models.forEach((model, at) => {
        const modelPath = `${path}.models[${at}]`;
        if (!isObject(model)) { fail(modelPath, 'ожидается объект'); return; }
        unknownKeys(model, ['name', 'role', 'request', 'maxWords', 'task', 'discipline'], modelPath);
        if (typeof model.name !== 'string' || !model.name.trim()) fail(`${modelPath}.name`, 'имя модели не указано');
        else if (names.has(model.name)) fail(`${modelPath}.name`, `модель «${model.name}» повторяется в шаге`);
        else names.add(model.name);
        ['role', 'request', 'task'].forEach((key) => { if (key in model) text(model[key], `${modelPath}.${key}`); });
        if ('maxWords' in model && !(Number.isSafeInteger(model.maxWords) && model.maxWords > 0)) fail(`${modelPath}.maxWords`, 'ожидается положительное целое число слов');
        if ('discipline' in model) checkDiscipline(model.discipline, `${modelPath}.discipline`);
      });
    });
    return errors;
  }

  const describeErrors = (errors) => errors.map((error) => (error.path ? `${error.path}: ${error.message}` : error.message)).join('; ');

  const api = Object.freeze({ SCHEMA_VERSION, SUPPORTED_VERSIONS, ORIGINS, DEFAULTS, pick, resolveFields, assemble, validate, describeErrors });
  root.BasicSchema = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
