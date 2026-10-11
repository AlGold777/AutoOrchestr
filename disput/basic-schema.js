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
  const KINDS = Object.freeze(['round', 'synthesis', 'gate', 'route', 'owner']);
  const CONTROL_KINDS = Object.freeze(['gate', 'route', 'owner']);
  // The fields a step of each kind may have (an unknown field is an error with its path).
  const STEP_KEYS = Object.freeze({
    round: Object.freeze(['ref', 'kind', 'order', 'input', 'task', 'models', 'output', 'require', 'owner', 'chat']),
    synthesis: Object.freeze(['ref', 'kind', 'order', 'input', 'task', 'models', 'output', 'require', 'owner', 'chat']),
    gate: Object.freeze(['ref', 'kind', 'input', 'task', 'models', 'output', 'require', 'chat', 'criteria', 'pass', 'onFail', 'onPass']),
    route: Object.freeze(['ref', 'kind', 'input', 'task', 'models', 'select']),
    owner: Object.freeze(['ref', 'kind', 'task', 'input', 'output', 'models'])
  });
  const CONTROL_REF = Object.freeze({
    gate: 'ref проверки: «gate:<id>», id — латинские буквы, цифры, «_» и «-»',
    route: 'ref маршрута: «route:<id>», id — латинские буквы, цифры, «_» и «-»',
    owner: 'ref владельца: «owner:<id>», id — латинские буквы, цифры, «_» и «-»'
  });
  const ROUTE_BY = Object.freeze(['rule', 'model', 'owner']);
  const ROUTE_CONFLICT = Object.freeze(['stop', 'first', 'owner']);
  const ACTION_KINDS = Object.freeze(['goto', 'stop', 'return']);
  const ROUTE_OPS = Object.freeze(['eq', 'in', 'exists']);
  const GATE_PASS = Object.freeze(['all', 'any']);
  const GATE_ON_FAIL = Object.freeze(['stop', 'ask']);
  const ORDERS = Object.freeze(['parallel', 'sequential']);
  const INPUTS = Object.freeze(['none', 'previous', 'all']);
  const POLICIES = Object.freeze(['auto', 'manual']);
  const OUTPUT_FORMATS = Object.freeze(['json']);
  const REQUIRE_WORDS = Object.freeze(['any', 'all']);
  const OWNER_STEPS = Object.freeze(['approve']);
  const CHAT_MODES = Object.freeze(['continue', 'new']);
  const POINTER_FORBIDDEN = Object.freeze(['__proto__', 'prototype', 'constructor']);

  // The problem of a JSON Pointer (RFC 6901, ~0 and ~1 only) or null. Forbidden segments are refused, nothing is read.
  function pointerError(pointer) {
    if (typeof pointer !== 'string' || (pointer !== '' && !pointer.startsWith('/'))) return 'указатель JSON Pointer начинается с «/»';
    for (const raw of pointer === '' ? [] : pointer.slice(1).split('/')) {
      if (/~(?![01])/.test(raw)) return 'в указателе «~» допустим только как ~0 или ~1';
      const segment = raw.replace(/~1/g, '/').replace(/~0/g, '~');
      if (POINTER_FORBIDDEN.includes(segment)) return `сегмент «${segment}» запрещён`;
    }
    return null;
  }

  const DEFAULTS = Object.freeze({
    run: Object.freeze({ policy: 'manual', maxWords: 300 }),
    gate: Object.freeze({ pass: 'all', onFail: 'stop' }),
    route: Object.freeze({ conflict: 'stop' }),
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

  const clone = (value) => JSON.parse(JSON.stringify(value));

  // A gate, a route or an owner: the fields as the schema has them, with the Basic defaults of the kind written in.
  // The task of their models is the owner's own text only: no inherited task reaches a checker or a chooser.
  function assembleControl(step, roleText) {
    const out = { kind: step.kind, ref: step.ref };
    if ('input' in step) out.input = clone(step.input);
    if ('output' in step) out.output = clone(step.output);
    ['require', 'chat'].forEach((key) => { if (key in step) out[key] = step[key]; });
    if (typeof step.task === 'string') out.task = step.task;
    if (step.kind === 'owner') return { ...out, models: [] };
    if (step.kind === 'gate') Object.assign(out, { criteria: clone(step.criteria), pass: step.pass ?? DEFAULTS.gate.pass, onFail: step.onFail ?? DEFAULTS.gate.onFail });
    if (step.kind === 'route') {
      out.select = clone(step.select);
      if (out.select.by === 'rule' && !('conflict' in out.select)) out.select.conflict = DEFAULTS.route.conflict;
    }
    out.models = (step.models || []).filter((model) => model.enabled !== false).map((model) => ({
      name: model.name,
      id: idOf(model),
      task: typeof model.task === 'string' ? model.task : (typeof step.task === 'string' ? step.task : ''),
      extra: roleText(model.role || '', step.ref) || ''
    }));
    return out;
  }

  // Engine steps from a schema. `context.roleText(role, ref)` turns a model's role into its extra text.
  function assemble(schema, { roleText = () => '' } = {}) {
    const defaults = schema.defaults || {};
    const finalStep = schema.steps.find((step) => step.ref === 'final');
    let rounds = 0;
    return schema.steps.map((step) => {
      if (CONTROL_KINDS.includes(step.kind)) return assembleControl(step, roleText);
      const roundIndex = step.kind === 'round' ? rounds++ : -1;
      const input = step.input || defaultInput(step.kind, roundIndex);
      const stepFields = resolveFields({ task: step.task }, step.kind, {}, defaults);
      const out = { kind: step.kind, ref: step.ref };
      // The number a step keeps even when the rounds before it are switched off.
      if (step.kind === 'round') out.round = roundIndex + 1;
      else out.afterRound = rounds;
      if (step.kind === 'round') out.order = step.order || 'parallel';
      if ('output' in step) out.output = JSON.parse(JSON.stringify(step.output));
      ['require', 'owner', 'chat'].forEach((key) => { if (key in step) out[key] = step[key]; });
      out.task = input === 'none' && !writtenTask(stepFields.task) ? '' : stepFields.task.value;
      // A list of sources goes to the engine as it is; a synthesis without a list keeps its old shape (no input field).
      if (step.kind === 'round' || Array.isArray(input)) out.input = Array.isArray(input) ? JSON.parse(JSON.stringify(input)) : input;
      out.models = (step.models || []).filter((model) => model.enabled !== false).map((model) => {
        const resolved = resolveFields(model, step.kind, { task: step.task }, defaults);
        const lines = [...(defaults.discipline?.lines || []), ...(model.discipline?.lines || [])];
        // An intermediate synthesis without its own request runs the final synthesizer's request.
        const finalRequest = step.ref.startsWith('synth:') ? finalStep?.models?.find((item) => idOf(item) === idOf(model))?.request : undefined;
        // The input of the participant (when it has its own) decides whether an inherited task is dropped, as the step input does.
        const own = 'input' in model ? model.input : input;
        return {
          name: model.name,
          id: idOf(model),
          ...('input' in model ? { input: Array.isArray(model.input) ? JSON.parse(JSON.stringify(model.input)) : model.input } : {}),
          // An own request, an empty one included, is a value; only a missing one takes the final synthesizer's.
          promptTemplate: typeof model.request === 'string' ? model.request : (typeof finalRequest === 'string' ? finalRequest : null),
          maxWords: 'maxWords' in model ? model.maxWords : null,
          extra: roleText(model.role || '', step.ref) || '',
          task: own === 'none' && !writtenTask(resolved.task) ? '' : resolved.task.value,
          discipline: {
            ...Object.fromEntries(Object.entries(resolved.discipline).map(([key, item]) => [key, item.value])),
            ...(lines.length ? { lines } : {})
          }
        };
      });
      return out;
    }).filter((step) => step.models.length || step.kind === 'owner' || step.kind === 'route');
  }

  // A participant's id: the explicit one, or its name.
  const idOf = (model) => model.id ?? model.name;

  // The address of a well-formed source: the duplicate check and the revision check compare these.
  function addressOf(source) {
    if (typeof source === 'string') return JSON.stringify(['step', source]);
    if (!isObject(source)) return JSON.stringify(['invalid']);
    if ('artifact' in source) {
      const address = isObject(source.artifact) ? source.artifact : {};
      const version = isObject(source.version) ? [source.version.step, source.version.participant, source.version.visit] : 'latest';
      return JSON.stringify(['artifact', address.step, address.participant, address.id, version]);
    }
    return JSON.stringify(['participant', source.step, source.participant]);
  }

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

    if (typeof source === 'string') return stepAt(source, path) < 0 ? null : addressOf(source);
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
      if (!('version' in source)) fail(`${path}.version`, 'версия не указана: latest или объект версии');
      else if (source.version === 'latest') { /* the last current version of the line */ }
      else if (isObject(source.version)) {
        const at = `${path}.version`;
        unknown(source.version, ['step', 'participant', 'visit'], at);
        const creator = stepAt(source.version.step, `${at}.step`);
        if (creator >= 0 && !('participant' in source.version)) fail(`${at}.participant`, 'участник не указан');
        else if (creator >= 0) participantAt(creator, source.version.participant, `${at}.participant`);
        if (!(Number.isSafeInteger(source.version.visit) && source.version.visit > 0)) fail(`${at}.visit`, 'ожидается целое число больше 0');
      } else fail(`${path}.version`, 'ожидается latest или объект версии');
      if (failed()) return null;
      return addressOf(source);
    }

    if (!('step' in source)) { fail(path, 'ожидается ссылка на шаг, участника или артефакт'); return null; }
    unknown(source, ['step', 'participant', 'required'], path);
    checkRequired(source, path);
    const position = stepAt(source.step, `${path}.step`);
    if (position >= 0 && !('participant' in source)) fail(`${path}.participant`, 'участник не указан');
    else if (position >= 0) participantAt(position, source.participant, `${path}.participant`);
    if (failed()) return null;
    return addressOf(source);
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
    const namesById = new Map();
    const contextAt = (index) => ({ fail, errors, steps: schema.steps, positions, index });
    const checkInputList = (list, path, index) => {
      if (!list.length) { fail(path, 'ожидается непустой список источников'); return; }
      const addresses = new Set();
      list.forEach((source, at) => {
        const address = checkSource(source, `${path}[${at}]`, contextAt(index));
        if (!address) return;
        if (addresses.has(address)) fail(`${path}[${at}]`, 'источник повторяется');
        addresses.add(address);
      });
    };
    // The input of a step or of a participant: a value of the list of inputs, or a list of sources.
    const checkInput = (value, path, kind, index) => {
      if (Array.isArray(value)) { checkInputList(value, path, index); return; }
      if (kind === 'route' || kind === 'owner') { if (value !== 'previous') fail(path, 'вход: допустимо previous или список источников'); return; }
      oneOf(value, INPUTS, path, 'вход');
      if (kind === 'synthesis' && value !== 'previous') fail(path, 'синтез всегда получает ответы предыдущего шага');
    };
    // The output of a step (5.1, 5.2): the text form, or json with fields; artifacts are declared in it.
    const checkOutput = (output, path, step, index) => {
      if (!isObject(output)) { fail(path, 'ожидается объект'); return; }
      unknownKeys(output, ['name', 'form', 'sections', 'strictLength', 'format', 'requiredFields', 'artifacts'], path);
      ['name', 'form'].forEach((key) => { if (key in output) text(output[key], `${path}.${key}`); });
      if ('strictLength' in output && typeof output.strictLength !== 'boolean') fail(`${path}.strictLength`, 'ожидается true или false');
      if ('format' in output) oneOf(output.format, OUTPUT_FORMATS, `${path}.format`, 'формат выхода');
      const json = output.format === 'json';
      if ('sections' in output) {
        if (json) fail(`${path}.sections`, 'в формате json заголовки не проверяются: укажите requiredFields');
        else if (!Array.isArray(output.sections) || !output.sections.length) fail(`${path}.sections`, 'ожидается непустой список заголовков');
        else output.sections.forEach((item, at) => { if (typeof item !== 'string' || !item.trim()) fail(`${path}.sections[${at}]`, 'ожидается непустой текст'); });
      }
      if ('requiredFields' in output) {
        if (!json) fail(`${path}.requiredFields`, 'список полей нужен только в формате json');
        else if (!Array.isArray(output.requiredFields) || !output.requiredFields.length) fail(`${path}.requiredFields`, 'ожидается непустой список указателей');
        else output.requiredFields.forEach((pointer, at) => {
          const problem = pointer === '' ? 'укажите поле ответа' : pointerError(pointer);
          if (problem) fail(`${path}.requiredFields[${at}]`, problem);
        });
      }
      if (!('artifacts' in output)) return;
      const list = output.artifacts;
      if (!Array.isArray(list) || !list.length) { fail(`${path}.artifacts`, 'ожидается непустой список артефактов'); return; }
      if (list.length > 1 && !json) fail(`${path}.artifacts`, 'несколько артефактов выделяются только в формате json');
      const ids = new Set();
      const pointers = new Set();
      list.forEach((artifact, at) => {
        const at2 = `${path}.artifacts[${at}]`;
        if (!isObject(artifact)) { fail(at2, 'ожидается объект'); return; }
        unknownKeys(artifact, ['id', 'name', 'pointer', 'revisionOf'], at2);
        if (typeof artifact.id !== 'string' || !artifact.id.trim()) fail(`${at2}.id`, 'ID артефакта: непустой текст');
        else if (ids.has(artifact.id)) fail(`${at2}.id`, `артефакт «${artifact.id}» повторяется`);
        else ids.add(artifact.id);
        if (typeof artifact.name !== 'string' || !artifact.name.trim()) fail(`${at2}.name`, 'название артефакта: непустой текст');
        if (typeof artifact.pointer !== 'string') fail(`${at2}.pointer`, 'ожидается указатель: строка');
        else if (artifact.pointer === '') {
          // An empty pointer is the whole answer: the only artifact of a text answer (several are named at the list).
          if (json) fail(`${at2}.pointer`, 'укажите поле ответа: JSON Pointer к полю');
        } else if (!json) fail(`${at2}.pointer`, 'в текстовом формате указатель пустой: артефакт — весь ответ');
        else {
          const problem = pointerError(artifact.pointer);
          if (problem) fail(`${at2}.pointer`, problem);
          else if (pointers.has(artifact.pointer)) fail(`${at2}.pointer`, 'указатель повторяется');
          else pointers.add(artifact.pointer);
        }
        if (!('revisionOf' in artifact)) return;
        // A revision: a reference to an artifact that the author has in its input (every enabled participant writes it).
        const revision = artifact.revisionOf;
        if (!(isObject(revision) && 'artifact' in revision)) { fail(`${at2}.revisionOf`, 'ожидается ссылка на артефакт: объект с полем artifact'); return; }
        const before = errors.length;
        checkSource(revision, `${at2}.revisionOf`, contextAt(index));
        if (errors.length > before) return;
        const key = addressOf(revision);
        const authors = (Array.isArray(step.models) ? step.models : []).filter((model) => isObject(model) && model.enabled !== false);
        authors.forEach((model) => {
          const own = 'input' in model ? model.input : step.input;
          if (!(Array.isArray(own) && own.some((item) => addressOf(item) === key))) fail(`${at2}.revisionOf`, `ссылка на версию должна быть во входе участника «${idOf(model)}»`);
        });
      });
    };

    // A transition (6.3): exactly one of goto, stop, return. The fields of the transition itself (maxLoops,
    // feedback, invalidate, resumeAt) are checked with the graph of the steps, not here.
    const checkAction = (action, path) => {
      if (!isObject(action)) { fail(path, 'переход: объект с одним полем goto, stop или return'); return; }
      const kinds = ACTION_KINDS.filter((key) => key in action);
      if (kinds.length !== 1) { fail(path, 'переход: ровно одно из goto, stop, return'); return; }
      unknownKeys(action, [kinds[0]], path);
      if (kinds[0] === 'goto' && (typeof action.goto !== 'string' || !action.goto)) fail(`${path}.goto`, 'ref перехода: непустой текст');
      if (kinds[0] === 'stop' && (typeof action.stop !== 'string' || !action.stop.trim())) fail(`${path}.stop`, 'причина остановки: непустой текст');
      if (kinds[0] === 'return' && action.return !== true) fail(`${path}.return`, 'return: только true');
    };

    // A rule condition (6.2): an atomic one { source, pointer, op, value? } or { all: [...] } / { any: [...] }.
    // `inputs` is the list of the route's sources, or null when the route has no list (its error is already named).
    const checkCondition = (cond, path, inputs) => {
      if (!isObject(cond)) { fail(path, 'условие: объект с полями source, pointer, op, value'); return; }
      const composite = ['all', 'any'].filter((key) => key in cond);
      if (composite.length) {
        if (composite.length > 1 || Object.keys(cond).length > 1) { fail(path, 'условие: либо all, либо any, без других полей'); return; }
        const [key] = composite;
        if (!Array.isArray(cond[key]) || !cond[key].length) { fail(`${path}.${key}`, 'условие: непустой список условий'); return; }
        cond[key].forEach((item, at) => checkCondition(item, `${path}.${key}[${at}]`, inputs));
        return;
      }
      unknownKeys(cond, ['source', 'pointer', 'op', 'value'], path);
      if (inputs) {
        if (!Number.isSafeInteger(cond.source) || cond.source < 0) fail(`${path}.source`, 'источник: номер входа маршрута, целое от 0');
        else if (cond.source >= inputs.length) fail(`${path}.source`, 'источник: номер вне списка input маршрута');
        else if (!isObject(inputs[cond.source])) fail(`${path}.source`, 'правило читает точный источник: участника или артефакт');
      }
      const problem = pointerError(cond.pointer);
      if (problem) fail(`${path}.pointer`, problem);
      oneOf(cond.op, ROUTE_OPS, `${path}.op`, 'оператор условия');
      if (cond.op === 'eq' && !('value' in cond)) fail(`${path}.value`, 'для eq укажите value');
      if (cond.op === 'in' && !(Array.isArray(cond.value) && cond.value.length)) fail(`${path}.value`, 'для in нужен непустой список значений');
      if (cond.op === 'exists' && 'value' in cond) fail(`${path}.value`, 'для exists значение не указывают');
    };

    // A gate, a route or an owner (3.1, 6.1, 6.2, 4.1). Their transitions are checked as shape here.
    const checkControl = (step, path) => {
      const enabled = (Array.isArray(step.models) ? step.models : []).filter((model) => isObject(model) && model.enabled !== false);
      if (step.kind === 'owner') {
        if (typeof step.task !== 'string' || !step.task.trim()) fail(`${path}.task`, 'задание владельца: непустой текст');
        if (Array.isArray(step.models) && step.models.length) fail(`${path}.models`, 'у владельца нет моделей');
        return;
      }
      if (step.kind === 'gate') {
        if (!Array.isArray(step.criteria) || !step.criteria.length) fail(`${path}.criteria`, 'критерии проверки: непустой список строк');
        else step.criteria.forEach((item, at) => { if (typeof item !== 'string' || !item.trim()) fail(`${path}.criteria[${at}]`, 'критерий: непустой текст'); });
        if ('pass' in step) oneOf(step.pass, GATE_PASS, `${path}.pass`, 'pass проверки');
        if ('onFail' in step) oneOf(step.onFail, GATE_ON_FAIL, `${path}.onFail`, 'onFail проверки');
        if ('onPass' in step) fail(`${path}.onPass`, 'переход по успеху пока не поддерживается');
        return;
      }
      const select = step.select;
      if (!isObject(select)) { fail(`${path}.select`, 'выбор маршрута: объект с полем by'); return; }
      unknownKeys(select, ['by', 'conflict', 'cases', 'otherwise'], `${path}.select`);
      oneOf(select.by, ROUTE_BY, `${path}.select.by`, 'выбор маршрута');
      const rule = select.by === 'rule';
      if (select.by === 'model') {
        if (enabled.length !== 1) fail(`${path}.models`, 'маршрут по модели: ровно один включённый участник');
        if (typeof step.task !== 'string' || !step.task.trim()) fail(`${path}.task`, 'задание маршрута по модели: непустой текст');
      } else if (Array.isArray(step.models) && step.models.length) fail(`${path}.models`, 'у маршрута по правилу и владельцу моделей нет');
      if ('conflict' in select) {
        if (!rule) fail(`${path}.select.conflict`, 'конфликт выбора задаётся только для правила');
        else oneOf(select.conflict, ROUTE_CONFLICT, `${path}.select.conflict`, 'конфликт выбора');
      }
      if ('otherwise' in select) {
        if (!rule) fail(`${path}.select.otherwise`, 'вариант по умолчанию задаётся только для правила');
        checkAction(select.otherwise, `${path}.select.otherwise`);
      }
      // A rule reads the exact sources of the route's input list; without the list the rule has nothing to read.
      const inputs = Array.isArray(step.input) ? step.input : null;
      if (rule && !inputs) fail(`${path}.input`, 'правило читает точные источники: укажите input списком');
      if (!Array.isArray(select.cases) || !select.cases.length) { fail(`${path}.select.cases`, 'ожидается непустой список вариантов'); return; }
      const caseIds = new Set();
      select.cases.forEach((item, at) => {
        const at2 = `${path}.select.cases[${at}]`;
        if (!isObject(item)) { fail(at2, 'ожидается объект варианта'); return; }
        unknownKeys(item, ['id', 'when', 'label', 'action'], at2);
        if (typeof item.id !== 'string' || !item.id.trim()) fail(`${at2}.id`, 'ID варианта: непустой текст');
        else if (caseIds.has(item.id)) fail(`${at2}.id`, `вариант «${item.id}» повторяется`);
        else caseIds.add(item.id);
        if (rule) {
          checkCondition(item.when, `${at2}.when`, inputs);
          if ('label' in item && typeof item.label !== 'string') fail(`${at2}.label`, 'название варианта: текст');
        } else {
          if ('when' in item) fail(`${at2}.when`, 'условие только для правила: варианты модели и владельца описываются label');
          if (typeof item.label !== 'string' || !item.label.trim()) fail(`${at2}.label`, 'название варианта: непустой текст');
        }
        checkAction(item.action, `${at2}.action`);
      });
    };

    schema.steps.forEach((step, index) => {
      const path = `steps[${index}]`;
      if (!isObject(step)) { fail(path, 'ожидается объект'); return; }
      unknownKeys(step, STEP_KEYS[step.kind] || STEP_KEYS.round, path);
      if ('output' in step) checkOutput(step.output, `${path}.output`, step, index);
      // A number of answers is checked against the enabled participants; a switched-off step keeps its number.
      if ('require' in step && !REQUIRE_WORDS.includes(step.require)) {
        const enabledCount = (Array.isArray(step.models) ? step.models : []).filter((model) => isObject(model) && model.enabled !== false).length;
        if (!(Number.isSafeInteger(step.require) && step.require > 0)) fail(`${path}.require`, 'require: допустимо any, all или целое число больше 0');
        else if (enabledCount && step.require > enabledCount) fail(`${path}.require`, `требуется больше ответов, чем включённых участников: ${enabledCount}`);
      }
      if ('owner' in step) oneOf(step.owner, OWNER_STEPS, `${path}.owner`, 'владелец шага');
      if ('chat' in step) oneOf(step.chat, CHAT_MODES, `${path}.chat`, 'чат шага');
      if (typeof step.ref !== 'string' || !step.ref) fail(`${path}.ref`, 'ref шага не указан');
      else if (refs.has(step.ref)) fail(`${path}.ref`, `ref «${step.ref}» повторяется`);
      else refs.add(step.ref);
      oneOf(step.kind, KINDS, `${path}.kind`, 'тип шага');
      if (CONTROL_KINDS.includes(step.kind) && typeof step.ref === 'string' && !new RegExp(`^${step.kind}:[A-Za-z0-9_-]+$`).test(step.ref)) fail(`${path}.ref`, CONTROL_REF[step.kind]);
      if ('order' in step) {
        oneOf(step.order, ORDERS, `${path}.order`, 'порядок');
        if (step.kind === 'synthesis') fail(`${path}.order`, 'у синтеза порядка нет: он одна модель-синтезатор или параллельный');
      }
      if ('input' in step) checkInput(step.input, `${path}.input`, step.kind, index);
      if ('task' in step) text(step.task, `${path}.task`);
      if (!Array.isArray(step.models)) { fail(`${path}.models`, 'ожидается список моделей'); return; }
      const ids = new Set();
      step.models.forEach((model, at) => {
        const modelPath = `${path}.models[${at}]`;
        if (!isObject(model)) { fail(modelPath, 'ожидается объект'); return; }
        unknownKeys(model, ['name', 'id', 'enabled', 'role', 'request', 'maxWords', 'task', 'discipline', 'input'], modelPath);
        if ('enabled' in model && typeof model.enabled !== 'boolean') fail(`${modelPath}.enabled`, 'ожидается true или false');
        if (typeof model.name !== 'string' || !model.name.trim()) fail(`${modelPath}.name`, 'имя модели не указано');
        // One participant is one id in a step; a repeated name is fine when the ids differ. One id keeps one name in all steps.
        const id = idOf(model);
        if ('id' in model && (typeof model.id !== 'string' || !model.id.trim())) fail(`${modelPath}.id`, 'ID участника: непустой текст');
        else if (typeof id === 'string') {
          if (ids.has(id)) fail(`${modelPath}.${'id' in model ? 'id' : 'name'}`, 'id' in model ? `участник «${id}» повторяется в шаге` : `модель «${model.name}» повторяется в шаге`);
          else {
            ids.add(id);
            const known = namesById.get(id);
            if (typeof model.name === 'string' && known !== undefined && known !== model.name) fail(`${modelPath}.name`, `ID участника «${id}» уже записан с именем «${known}»`);
            else if (typeof model.name === 'string') namesById.set(id, model.name);
          }
        }
        if ('input' in model) checkInput(model.input, `${modelPath}.input`, step.kind, index);
        ['role', 'request', 'task'].forEach((key) => { if (key in model) text(model[key], `${modelPath}.${key}`); });
        if ('maxWords' in model && !(Number.isSafeInteger(model.maxWords) && model.maxWords > 0)) fail(`${modelPath}.maxWords`, 'ожидается положительное целое число слов');
        if ('discipline' in model) checkDiscipline(model.discipline, `${modelPath}.discipline`);
      });
      if (CONTROL_KINDS.includes(step.kind)) checkControl(step, path);
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
      // Gate, route and owner are not on the canvas yet: the schema is named, not changed.
      if (CONTROL_KINDS.includes(step.kind)) { fail(path, 'холст пока не показывает проверку, маршрут и владельца'); return; }
      const enabled = enabledOf(step);
      const stepNames = new Set();
      enabled.forEach((model, at) => {
        if (!models.includes(model.name)) fail(`${path}.models[${at}].name`, `модель «${model.name}» недоступна`);
        if (model.role && !isRole(model.role)) fail(`${path}.models[${at}].role`, `роль «${model.role}» неизвестна`);
        // The canvas shows one block per model of a step; two participants of one model wait for the canvas that shows them.
        if (stepNames.has(model.name)) fail(`${path}.models[${at}].name`, 'холст пока не показывает два участника одной модели в шаге');
        stepNames.add(model.name);
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
