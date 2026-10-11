// Basic schema: the saved form of a pipeline on the Basic engine (disput/custom-engine.js).
// A schema holds only explicit overrides; every field it does not mention comes from DEFAULTS here.
// One place assembles the final configuration: resolveFields (a value of a card) and assemble
// (the engine's steps). The canvas, the request preview and the run all go through them, and
// validate() runs before the first request. Rules: docs/Pipeline scenarios/basic-developer.md,
// field reference and how to write a schema: docs/Pipeline scenarios/basic-schema-guide.md.
//
// Schema: { schemaVersion, origin: 'builtin' | 'user', basedOn?, defaults?, steps }
//   run: { policy?: 'auto' | 'manual', maxWords? } — the run policy and the shared answer limit
//   defaults (the ▶ card): { roundTask?, synthesisTask?, discipline?, modelNotes?, roundPrompts? }
//   step: { ref, kind: 'round' | 'synthesis', order?, input?, task?, models }
//   model: { name, enabled?, role?, request?, maxWords?, task?, discipline? }   (request: '' = no own request)
//   enabled: false keeps a switched-off model with its settings; assemble() gives the engine no call for it.
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
  const POLICIES = Object.freeze(['auto', 'manual']);

  const DEFAULTS = Object.freeze({
    run: Object.freeze({ policy: 'manual', maxWords: 300 }),
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

  // With input none only a task written by the owner (on the model or the step) goes to the model; ▶ and Basic values do not.
  const writtenTask = (field) => field.source === 'model' || field.source === 'round';

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
      // The number a step keeps even when the rounds before it are switched off.
      if (step.kind === 'round') out.round = roundIndex + 1;
      else out.afterRound = rounds;
      if (step.kind === 'round') out.order = step.order || 'parallel';
      out.task = input === 'none' && !writtenTask(stepFields.task) ? '' : stepFields.task.value;
      // A list of sources goes to the engine as it is; a synthesis without a list keeps its old shape (no input field).
      if (step.kind === 'round' || Array.isArray(input)) out.input = Array.isArray(input) ? JSON.parse(JSON.stringify(input)) : input;
      out.models = (step.models || []).filter((model) => model.enabled !== false).map((model) => {
        const resolved = resolveFields(model, step.kind, { task: step.task }, defaults);
        const lines = [...(defaults.discipline?.lines || []), ...(model.discipline?.lines || [])];
        // An intermediate synthesis without its own request runs the final synthesizer's request.
        const finalRequest = step.ref.startsWith('synth:') ? finalStep?.models?.find((item) => item.name === model.name)?.request : undefined;
        return {
          name: model.name,
          // An own request, an empty one included, is a value; only a missing one takes the final synthesizer's.
          promptTemplate: typeof model.request === 'string' ? model.request : (typeof finalRequest === 'string' ? finalRequest : null),
          maxWords: 'maxWords' in model ? model.maxWords : null,
          extra: roleText(model.role || '', step.ref) || '',
          task: input === 'none' && !writtenTask(resolved.task) ? '' : resolved.task.value,
          discipline: {
            ...Object.fromEntries(Object.entries(resolved.discipline).map(([key, item]) => [key, item.value])),
            ...(lines.length ? { lines } : {})
          }
        };
      });
      return out;
    }).filter((step) => step.models.length);
  }

  // A participant's id: the explicit one, or its name.
  const idOf = (model) => model.id ?? model.name;

  // One input source (4.3): a step ref, a participant of a step `{ step, participant, required? }` or an artifact
  // `{ artifact: { step, participant, id }, version, required? }`. A version is `latest` or `{ step, participant, visit }`.
  // Returns the address of the source (for the duplicate check), or null when it has an error.
  // ctx: { fail, errors, steps, positions (ref → index), index (of the consumer step) }.
  function checkSource(source, path, ctx) {
    const { fail, errors, steps, positions, index } = ctx;
    const mark = errors.length;
    const unknown = (value, allowed, at) => Object.keys(value).forEach((key) => { if (!allowed.includes(key)) fail(`${at}.${key}`, 'неизвестное поле'); });
    // The step a reference names: it exists and comes before the consumer; final is never an ordinary source.
    const stepAt = (ref, at) => {
      if (typeof ref !== 'string' || !positions.has(ref)) { fail(at, `неизвестный шаг «${ref}»`); return -1; }
      const position = positions.get(ref);
      if (position >= index) fail(at, 'вход ссылается только на более ранний шаг');
      else if (steps[position].ref === 'final') fail(at, 'результат финального синтеза нельзя указать во входе');
      else return position;
      return -1;
    };
    const participantAt = (position, participant, at) => {
      const models = Array.isArray(steps[position].models) ? steps[position].models.filter(isObject) : [];
      if (models.some((model) => idOf(model) === participant)) return true;
      fail(at, `участник «${participant}» не объявлен в шаге «${steps[position].ref}»`);
      return false;
    };
    const checkRequired = (value, at) => { if ('required' in value && typeof value.required !== 'boolean') fail(`${at}.required`, 'ожидается true или false'); };
    const failed = () => errors.length > mark;

    if (typeof source === 'string') return stepAt(source, path) < 0 ? null : JSON.stringify(['step', source]);
    if (!isObject(source)) { fail(path, 'ожидается ссылка на шаг, участника или артефакт'); return null; }

    if ('artifact' in source) {
      unknown(source, ['artifact', 'version', 'required'], path);
      checkRequired(source, path);
      if (!isObject(source.artifact)) { fail(`${path}.artifact`, 'ожидается объект: step, participant, id'); return null; }
      const address = source.artifact;
      unknown(address, ['step', 'participant', 'id'], `${path}.artifact`);
      const position = stepAt(address.step, `${path}.artifact.step`);
      if (position >= 0 && !('participant' in address)) fail(`${path}.artifact.participant`, 'участник не указан');
      else if (position >= 0) participantAt(position, address.participant, `${path}.artifact.participant`);
      if (position >= 0 && !('id' in address)) fail(`${path}.artifact.id`, 'ID артефакта не указан');
      const output = position >= 0 ? steps[position].output : null;
      const declared = isObject(output) && Array.isArray(output.artifacts) && output.artifacts.some((item) => isObject(item) && item.id === address.id);
      if (position >= 0 && 'id' in address && !declared) fail(`${path}.artifact.id`, `артефакт «${address.id}» не объявлен в шаге «${steps[position].ref}»`);
      let version = 'latest';
      if (!('version' in source)) fail(`${path}.version`, 'версия не указана: latest или объект версии');
      else if (source.version === 'latest') version = 'latest';
      else if (isObject(source.version)) {
        const at = `${path}.version`;
        unknown(source.version, ['step', 'participant', 'visit'], at);
        const creator = stepAt(source.version.step, `${at}.step`);
        if (creator >= 0 && !('participant' in source.version)) fail(`${at}.participant`, 'участник не указан');
        else if (creator >= 0) participantAt(creator, source.version.participant, `${at}.participant`);
        if (!(Number.isSafeInteger(source.version.visit) && source.version.visit > 0)) fail(`${at}.visit`, 'ожидается целое число больше 0');
        version = JSON.stringify([source.version.step, source.version.participant, source.version.visit]);
      } else fail(`${path}.version`, 'ожидается latest или объект версии');
      if (failed()) return null;
      return JSON.stringify(['artifact', address.step, address.participant, address.id, version]);
    }

    if (!('step' in source)) { fail(path, 'ожидается ссылка на шаг, участника или артефакт'); return null; }
    unknown(source, ['step', 'participant', 'required'], path);
    checkRequired(source, path);
    const position = stepAt(source.step, `${path}.step`);
    if (position >= 0 && !('participant' in source)) fail(`${path}.participant`, 'участник не указан');
    else if (position >= 0) participantAt(position, source.participant, `${path}.participant`);
    if (failed()) return null;
    return JSON.stringify(['participant', source.step, source.participant]);
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
    unknownKeys(schema, ['schemaVersion', 'origin', 'basedOn', 'run', 'defaults', 'steps'], '');
    if (schema.run != null) {
      if (!isObject(schema.run)) fail('run', 'ожидается объект');
      else {
        unknownKeys(schema.run, ['policy', 'maxWords'], 'run');
        if ('policy' in schema.run) oneOf(schema.run.policy, POLICIES, 'run.policy', 'политика запуска');
        if ('maxWords' in schema.run && !(Number.isSafeInteger(schema.run.maxWords) && schema.run.maxWords > 0)) fail('run.maxWords', 'ожидается положительное целое число слов');
      }
    }

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
    // References are checked against the whole list of steps, switched-off ones included (the first step of a ref wins).
    const positions = new Map();
    schema.steps.forEach((step, at) => { if (isObject(step) && typeof step.ref === 'string' && !positions.has(step.ref)) positions.set(step.ref, at); });
    const checkInputList = (list, path, index) => {
      if (!list.length) { fail(path, 'ожидается непустой список источников'); return; }
      const addresses = new Set();
      list.forEach((source, at) => {
        const address = checkSource(source, `${path}[${at}]`, { fail, errors, steps: schema.steps, positions, index });
        if (!address) return;
        if (addresses.has(address)) fail(`${path}[${at}]`, 'источник повторяется');
        addresses.add(address);
      });
    };
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
        if (Array.isArray(step.input)) checkInputList(step.input, `${path}.input`, index);
        else {
          oneOf(step.input, INPUTS, `${path}.input`, 'вход');
          if (step.kind === 'synthesis' && step.input !== 'previous') fail(`${path}.input`, 'синтез всегда получает ответы предыдущего шага');
        }
      }
      if ('task' in step) text(step.task, `${path}.task`);
      if (!Array.isArray(step.models)) { fail(`${path}.models`, 'ожидается список моделей'); return; }
      const names = new Set();
      step.models.forEach((model, at) => {
        const modelPath = `${path}.models[${at}]`;
        if (!isObject(model)) { fail(modelPath, 'ожидается объект'); return; }
        unknownKeys(model, ['name', 'enabled', 'role', 'request', 'maxWords', 'task', 'discipline'], modelPath);
        if ('enabled' in model && typeof model.enabled !== 'boolean') fail(`${modelPath}.enabled`, 'ожидается true или false');
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

  // The settings of the cards in the form the page edits them (the cards write only what the owner set):
  // customModelSettings[ref][model] = { promptTemplate, maxWords, task, discipline }, customRoundSettings[ref] = { order, input, task }
  // of a round (the round card), customDefaults = the ▶ card.
  function toSettings(schema) {
    const customModelSettings = {};
    const customRoundSettings = {};
    (schema.steps || []).forEach((step) => {
      const round = {};
      if (step.kind === 'round') ['order', 'input', 'task'].forEach((key) => { if (key in step) round[key] = step[key]; });
      if (Object.keys(round).length) customRoundSettings[step.ref] = round;
      (step.models || []).forEach((model) => {
        const own = {};
        if (typeof model.request === 'string') own.promptTemplate = model.request;
        if ('maxWords' in model) own.maxWords = model.maxWords;
        if (typeof model.task === 'string') own.task = model.task;
        if (isObject(model.discipline)) own.discipline = JSON.parse(JSON.stringify(model.discipline));
        if (!Object.keys(own).length) return;
        (customModelSettings[step.ref] || (customModelSettings[step.ref] = {}))[model.name] = own;
      });
    });
    return { customModelSettings, customRoundSettings, customDefaults: schema.defaults ? JSON.parse(JSON.stringify(schema.defaults)) : {} };
  }

  // The canvas a schema stands for: the rounds, the models of each round with their roles, the final synthesizer
  // and the intermediate syntheses. `models` is the list of the models the canvas knows, in its order; `isRole(id)`
  // tells a known role. A schema the canvas cannot show gives errors (with the place), never a changed schema.
  // The canvas shows rounds r1, r2, … in order, one intermediate synthesis between two rounds, the final
  // synthesis last, one model in a synthesis. A switched-off model or synthesis is not on the canvas.
  function toCanvas(schema, { models = [], isRole = () => true, runWords = null } = {}) {
    const errors = [];
    const fail = (path, message) => errors.push({ path, message });
    const steps = schema.steps || [];
    const enabledOf = (step) => (step.models || []).filter((model) => model.enabled !== false);
    const rounds = [];
    const inserts = [];
    let finalStep = null;
    steps.forEach((step, index) => {
      const path = `steps[${index}]`;
      const enabled = enabledOf(step);
      enabled.forEach((model, at) => {
        if (!models.includes(model.name)) fail(`${path}.models[${at}].name`, `модель «${model.name}» недоступна`);
        if (model.role && !isRole(model.role)) fail(`${path}.models[${at}].role`, `роль «${model.role}» неизвестна`);
      });
      if (step.kind === 'round') {
        rounds.push(step);
        if (step.ref !== `r${rounds.length}`) fail(`${path}.ref`, `ref раунда должен быть «r${rounds.length}»`);
        return;
      }
      if (enabled.length > 1) fail(`${path}.models`, 'в синтезе одна модель');
      if (step.ref === 'final') {
        finalStep = step;
        if (index !== steps.length - 1) fail(`${path}.ref`, 'финальный синтез стоит последним');
        return;
      }
      const id = step.ref.startsWith('synth:') ? step.ref.slice('synth:'.length) : '';
      // The canvas keeps only A-Z a-z 0-9 _ - of an id; another character would make the settings follow another ref.
      if (!/^[A-Za-z0-9_-]+$/.test(id)) fail(`${path}.ref`, 'ref промежуточного синтеза: «synth:<id>», id — латинские буквы, цифры, «_» и «-»');
      if (steps[index - 1]?.kind !== 'round') fail(path, 'промежуточный синтез стоит сразу после раунда');
      if (steps[index + 1]?.kind !== 'round') fail(path, 'промежуточный синтез стоит между двумя раундами');
      if (enabled.length) inserts.push({ afterRound: rounds.length, plannedStageId: id, participantIds: enabled.map((model) => model.name) });
    });
    if (Array.isArray(runWords) && schema.run && 'maxWords' in schema.run && !runWords.includes(schema.run.maxWords)) fail('run.maxWords', `предел длины pipeline: допустимо ${runWords.join(', ')}`);
    if (!rounds.length) fail('steps', 'нужен хотя бы один раунд');
    if (rounds.length > 50) fail('steps', 'раундов не больше 50');
    if (errors.length) return { errors };
    const selectedModels = models.filter((name) => rounds.some((step) => enabledOf(step).some((model) => model.name === name)));
    // Each round's stack: its enabled models in the order of the schema, then the other selected models of the canvas.
    const stacks = Object.fromEntries(rounds.map((step, index) => {
      const own = enabledOf(step);
      const names = [...own.map((model) => model.name), ...selectedModels.filter((name) => !own.some((model) => model.name === name))];
      return [`r${index + 1}-models`, { items: names.map((name) => {
        const model = own.find((item) => item.name === name);
        return { name, input: Boolean(model), send: Boolean(model), role: model?.role || null };
      }) }];
    }));
    return { errors, roundCounter: rounds.length, selectedModels, stacks,
      rounds: rounds.map((step, index) => ({ ref: `r${index + 1}`, participantIds: enabledOf(step).map((model) => model.name), roles: Object.fromEntries(enabledOf(step).map((model) => [model.name, model.role || null])) })),
      synthesizer: finalStep ? (enabledOf(finalStep)[0]?.name || '') : '', inserts };
  }

  // The run settings as the run takes them: the policy and the shared answer limit.
  const resolveRun = (schema) => ({
    policy: typeof schema.run?.policy === 'string' ? schema.run.policy : DEFAULTS.run.policy,
    maxWords: Number.isSafeInteger(schema.run?.maxWords) ? schema.run.maxWords : DEFAULTS.run.maxWords
  });

  const describeErrors = (errors) => errors.map((error) => (error.path ? `${error.path}: ${error.message}` : error.message)).join('; ');

  const api = Object.freeze({ SCHEMA_VERSION, SUPPORTED_VERSIONS, ORIGINS, DEFAULTS, pick, resolveFields, assemble, resolveRun, toSettings, toCanvas, validate, describeErrors });
  root.BasicSchema = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
