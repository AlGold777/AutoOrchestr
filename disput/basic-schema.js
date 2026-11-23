// Basic schema: the saved form of a pipeline on the Basic engine (disput/custom-engine.js).
// A schema holds only explicit overrides; every field it does not mention comes from DEFAULTS here.
// One place assembles the final configuration: resolveFields (a value of a card) and assemble
// (the engine's steps). The canvas, the request preview and the run all go through them, and
// validate() runs before the first request. Rules: docs/Pipeline scenarios/basic-developer.md,
// field reference and how to write a schema: docs/Pipeline scenarios/basic-schema-guide.md.
//
// Schema: { schemaVersion, origin: 'builtin' | 'user', basedOn?, description?, comment?, defaults?, steps, end? }
//   end: { from: [sources] } — what the End window shows at the end of a run (the form of a step input); none = the last round's answer. endSources() gives the list the run takes
//   description: the presentation of the pipeline for the person who runs it (a long text); shown in the ▶ card, never read by the engine
//   comment: the text the model wrote around the schema JSON (kept when the schema is pasted); shown under the description, never read by the engine
//   run: { policy?: 'auto' | 'manual', maxWords?, strictLength?, stopMarks?, onNoAnswer?, repeat? } — the run policy, the shared answer limit, the strict length check, the stop marks, the step without all answers ('ask' | 'skip') and the repeat of the schema
//   defaults (the ▶ card): { roundTask?, discipline?, modelNotes?, roundPrompts? }
//   spec: { purpose?, inputs?, result?, application?, readiness?, rules?, boundaries?, failure? } — the open pipeline's
//     specification, text for the document only: the engine and the requests to models never read it (see SPEC_KEYS)
//   step: { ref, kind: 'round' | 'owner', input?, task?, models, title?, goal?, rules?, quality? }
//   a round sends one request to all its enabled models; they answer independently and the round waits for all of them
//   a synthesis is not a kind of step but a role: a round of one model with a role (the last such round is the result)
//   step text for the specification (title, goal, rules, quality): documents only, like spec
//   model: { name, enabled?, onCanvas?, role?, request?, maxWords?, task?, discipline? }   (request: '' = no own request)
//   enabled: false keeps a switched-off model with its settings; assemble() gives the engine no call for it.
//   onCanvas: true keeps a model on the canvas although its Send is off in every round (toCanvas); assemble() ignores it.
//   discipline: { limit?, content?, delivery?, correction?, lines? }
// A missing field is inherited; a given value applies, an empty string included (an empty text is
// a value, not inheritance). Lists are replaced as a whole. A step with no models is switched off:
// it stays valid and keeps its place in the numbering, but assemble() gives the engine no step for it.
(function initBasicSchema(root) {
  'use strict';

  const Engine = root.CustomEngine || (typeof require === 'function' ? require('./custom-engine') : null);

  const SCHEMA_VERSION = 2;
  // Every released version stays supported; a newer one than this Basic is refused.
  const SUPPORTED_VERSIONS = Object.freeze([1, 2]);
  const ORIGINS = Object.freeze(['builtin', 'user']);
  const KINDS = Object.freeze(['round', 'owner']);
  // The step the owner (User) does itself; it has no models. There is no branch and no transition: steps run in their order.
  const CONTROL_KINDS = Object.freeze(['owner']);
  // The removed kinds (a check, a branch and a synthesis) are refused with the way to write them now.
  const CHECK_HINT = 'проверка — обычный раунд: критерии в task; решение принимает User шагом owner';
  const REMOVED_KIND_HINT = Object.freeze({ gate: CHECK_HINT, route: CHECK_HINT, synthesis: 'синтез — роль: раунд из одной модели с role' });
  // The specification text (documents only): the root `spec` and the text fields of a step. Engine and requests never read them.
  const SPEC_KEYS = Object.freeze(['purpose', 'inputs', 'result', 'application', 'readiness', 'rules', 'boundaries', 'failure']);
  const STEP_TEXT_KEYS = Object.freeze(['title', 'goal', 'rules', 'quality']);
  // The fields a step of each kind may have (an unknown field is an error with its path).
  const STEP_KEYS = Object.freeze({
    round: Object.freeze(['ref', 'kind', 'input', 'task', 'models', 'output', 'owner', 'chat', 'files', ...STEP_TEXT_KEYS]),
    owner: Object.freeze(['ref', 'kind', 'task', 'input', 'output', 'models', 'document', 'files', ...STEP_TEXT_KEYS])
  });
  const CONTROL_REF = Object.freeze({
    owner: 'ref User: «owner:<id>», id — латинские буквы, цифры, «_» и «-»'
  });
  // The removed step fields are refused with what the round does instead.
  const REMOVED_FIELD_HINT = Object.freeze({
    require: 'поле require не поддерживается: раунд ждёт ответов всех своих моделей',
    order: 'поле order не поддерживается: все модели раунда отвечают независимо; эстафета — раунды по одной модели подряд'
  });
  const INPUTS = Object.freeze(['none', 'previous', 'all']);
  const POLICIES = Object.freeze(['auto', 'manual']);
  const ON_NO_ANSWER = Object.freeze(['ask', 'skip']);
  // The shared answer limits the page offers (its length select); the request to models names the same list.
  const RUN_WORDS = Object.freeze([300, 500, 700, 1000]);
  const OUTPUT_FORMATS = Object.freeze(['json']);
  const OWNER_STEPS = Object.freeze(['approve']);
  const CHAT_MODES = Object.freeze(['continue', 'new']);
  const POINTER_FORBIDDEN = Object.freeze(['__proto__', 'prototype', 'constructor']);
  const OWNER_PARTICIPANT = 'owner';

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
    run: Object.freeze({ policy: 'manual', maxWords: 300, strictLength: false }),
    roundTask: 'Учти ответы предыдущего шага и дай свой улучшенный ответ на задачу.',
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
  // `model` is { task?, discipline? }, `defaults` is the ▶ layer of the schema. `kind` is the kind of the step: every
  // step with models is a round, so its task inherits roundTask.
  // The delivery mark and the correction request are never empty: the transport needs the mark, a correction needs a text.
  // An empty one is inheritance there (the page reads them the same way), every other empty text is a value.
  const NEVER_EMPTY = Object.freeze(['delivery', 'correction']);
  const valueOf = (key, value) => (NEVER_EMPTY.includes(key) && value === '' ? undefined : value);
  function resolveFields(model = {}, kind = 'round', round = {}, defaults = {}) {
    return {
      task: pick([['model', model?.task], ['round', round?.task], ['pipeline', defaults?.roundTask]], DEFAULTS.roundTask),
      discipline: Object.fromEntries(Object.entries(DEFAULTS.discipline).map(([key, fallback]) => [key,
        pick([['model', valueOf(key, model?.discipline?.[key])], ['round', valueOf(key, round?.discipline?.[key])], ['pipeline', valueOf(key, defaults?.discipline?.[key])]], fallback)]))
    };
  }

  // A step that runs: an owner step, or a round with an enabled model. A switched-off round gives nothing.
  const runnable = (step) => isObject(step) && (CONTROL_KINDS.includes(step.kind)
    || (step.kind === 'round' && Array.isArray(step.models) && step.models.some((model) => isObject(model) && model.enabled !== false)));
  // Only a step with no runnable step before it has nothing to take (the first step that runs, the steps switched off before it);
  // any later model step (after an owner step too) gets the previous step.
  const defaultInputOf = (steps, position) => ((Array.isArray(steps) ? steps : []).slice(0, position).some(runnable) ? 'previous' : 'none');

  // With input none only a task written by the owner (on the model or the step) goes to the model; ▶ and Basic values do not.
  const writtenTask = (field) => field.source === 'model' || field.source === 'round';

  const clone = (value) => JSON.parse(JSON.stringify(value));

  // An owner step: the fields as the schema has them; it has no models.
  function assembleControl(step) {
    const out = { kind: step.kind, ref: step.ref };
    if ('input' in step) out.input = clone(step.input);
    if ('output' in step) out.output = clone(step.output);
    if ('files' in step) out.files = clone(step.files);
    if (typeof step.task === 'string') out.task = step.task;
    if (typeof step.document === 'string') out.document = step.document;
    // The purpose of the step: the owner window shows it first («Назначение: …»); the requests to models never read it.
    if (typeof step.goal === 'string' && step.goal.trim()) out.goal = step.goal;
    return { ...out, models: [] };
  }

  // Engine steps from a schema. `context.roleText(role, ref)` turns a model's role into its extra text.
  function assemble(schema, { roleText = () => '' } = {}) {
    const defaults = schema.defaults || {};
    let rounds = 0;
    return schema.steps.map((step, position) => {
      if (CONTROL_KINDS.includes(step.kind)) return assembleControl(step);
      const roundIndex = rounds++;
      const input = step.input || defaultInputOf(schema.steps, position);
      const stepFields = resolveFields({ task: step.task }, step.kind, {}, defaults);
      // The number a round keeps even when the rounds before it are switched off.
      const out = { kind: step.kind, ref: step.ref, round: roundIndex + 1 };
      if ('output' in step) out.output = JSON.parse(JSON.stringify(step.output));
      if ('files' in step) out.files = clone(step.files);
      ['owner', 'chat'].forEach((key) => { if (key in step) out[key] = step[key]; });
      out.task = input === 'none' && !writtenTask(stepFields.task) ? '' : stepFields.task.value;
      // A list of sources goes to the engine as it is.
      out.input = Array.isArray(input) ? JSON.parse(JSON.stringify(input)) : input;
      out.models = (step.models || []).filter((model) => model.enabled !== false).map((model) => {
        const explicit = model.settingsMode === 'explicit';
        const resolved = explicit
          ? { task: { value: typeof model.task === 'string' ? model.task : '', source: 'model' }, discipline: Object.fromEntries(Object.keys(DEFAULTS.discipline).map((key) => [key, { value: typeof model.discipline?.[key] === 'string' ? model.discipline[key] : '', source: 'model' }])) }
          : resolveFields(model, step.kind, { task: step.task }, defaults);
        const lines = explicit ? [...(model.discipline?.lines || [])] : [...(defaults.discipline?.lines || []), ...(model.discipline?.lines || [])];
        // The input of the participant (when it has its own) decides whether an inherited task is dropped, as the step input does.
        const own = explicit ? ('input' in model ? model.input : 'none') : ('input' in model ? model.input : input);
        return {
          name: model.name,
          id: idOf(model),
          ...(typeof model.label === 'string' ? { label: model.label } : {}),
          ...('files' in model ? { files: clone(model.files) } : {}),
          ...(explicit ? { settingsMode: 'explicit' } : {}),
          ...(explicit || 'input' in model ? { input: Array.isArray(own) ? JSON.parse(JSON.stringify(own)) : own } : {}),
          ...('output' in model ? { output: clone(model.output) } : {}),
          // An own request, an empty one included, is a value; a missing one is the automatic request.
          promptTemplate: typeof model.request === 'string' ? model.request : null,
          // Format 1: an own request without {вход} runs as before (the input is not in it); format 2 stops it (invalid_request).
          ...(typeof model.request === 'string' && !(schema.schemaVersion >= 2) ? { requestInput: 'lenient' } : {}),
          maxWords: 'maxWords' in model ? model.maxWords : null,
          extra: explicit ? '' : (roleText(model.role || '', step.ref) || ''),
          task: own === 'none' && !writtenTask(resolved.task) ? '' : resolved.task.value,
          discipline: {
            ...Object.fromEntries(Object.entries(resolved.discipline).map(([key, item]) => [key, item.value])),
            ...(lines.length ? { lines } : {})
          }
        };
      });
      // A switched-off participant stays declared (R12): a source may name it, it gives no answer (5.5, 5.7).
      const off = (step.models || []).filter((model) => isObject(model) && model.enabled === false)
        .map((model) => ({ id: idOf(model), name: model.name, ...('output' in model ? { output: clone(model.output) } : {}) }));
      if (off.length) out.off = off;
      return out;
    }).filter((step) => step.models.length || CONTROL_KINDS.includes(step.kind));
  }

  // A participant's id: the explicit one, or its name.
  const idOf = (model) => model.id ?? model.name;

  // The output a participant answers with (3.2): its own declaration replaces the step's one as a whole, nothing is merged.
  function outputOf(step, participant) {
    const model = (Array.isArray(step.models) ? step.models : []).find((item) => isObject(item) && idOf(item) === participant);
    return model && 'output' in model ? model.output : step.output;
  }

  // The address of a well-formed source: the duplicate check and the revision check compare these.
  function addressOf(source) {
    if (typeof source === 'string') return JSON.stringify(['step', source]);
    if (!isObject(source)) return JSON.stringify(['invalid']);
    if ('artifact' in source) {
      const address = isObject(source.artifact) ? source.artifact : {};
      const version = isObject(source.version) ? [source.version.step, source.version.participant, source.version.visit] : 'latest';
      return JSON.stringify(['artifact', address.step, address.participant, address.id, version]);
    }
    // A whole step (no participant) has the address of the step itself: it is a duplicate of the plain ref.
    if (!('participant' in source)) return JSON.stringify(['step', source.step]);
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
    // The step a reference names: it exists and comes before the consumer.
    const stepAt = (ref, at) => {
      if (typeof ref !== 'string' || !positions.has(ref)) { fail(at, `неизвестный шаг «${ref}»`); return -1; }
      const position = positions.get(ref);
      if (position < index) return position;
      fail(at, 'вход ссылается только на более ранний шаг');
      return -1;
    };
    const participantAt = (position, participant, at) => {
      // The owner step has one participant, the synthetic id `owner`, and no model (3.3); a model with that id elsewhere is a model.
      if (steps[position].kind === 'owner') {
        if (participant === OWNER_PARTICIPANT) return true;
        fail(at, 'у User один участник «owner»');
        return false;
      }
      const models = Array.isArray(steps[position].models) ? steps[position].models.filter(isObject) : [];
      if (models.some((model) => idOf(model) === participant)) return true;
      fail(at, `участник «${participant}» не объявлен в шаге «${steps[position].ref}»`);
      return false;
    };
    // A required source needs an answer: a switched-off participant gives none, so the run would stop before its request (missing_input).
    const requiredOffAt = (position, participant, at, required) => {
      if (required !== true || steps[position].kind === 'owner') return;
      const off = (Array.isArray(steps[position].models) ? steps[position].models : []).some((model) => isObject(model) && idOf(model) === participant && model.enabled === false);
      if (off) fail(at, `участник «${participant}» выключен (enabled: false), а вход required: включите его или снимите required`);
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
      else if (position >= 0) {
        participantAt(position, address.participant, `${path}.artifact.participant`);
        requiredOffAt(position, address.participant, `${path}.artifact.participant`, source.required);
      }
      if (position >= 0 && !('id' in address)) fail(`${path}.artifact.id`, 'ID артефакта не указан');
      const output = position >= 0 ? outputOf(steps[position], address.participant) : null;
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
    // Without a participant the source is the whole accepted result of the step (3.1).
    if (position >= 0 && 'participant' in source) {
      participantAt(position, source.participant, `${path}.participant`);
      requiredOffAt(position, source.participant, `${path}.participant`, source.required);
    }
    if (failed()) return null;
    return addressOf(source);
  }

  // The one check of executability (R09) for validate and toCanvas: an owner step runs by itself; a round runs with an enabled model.
  // A pipeline without a round is valid; an empty one or one with no runnable step is named at `steps`.
  function executabilityErrors(steps) {
    if (steps.some(runnable)) return [];
    return [{ path: 'steps', message: 'нет исполнимого шага: нужен раунд с включённой моделью или шаг User' }];
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
    else if (schema.schemaVersion > Math.max(...SUPPORTED_VERSIONS)) {
      return [{ path: 'schemaVersion', message: `схема создана более новой версией Basic (формат ${schema.schemaVersion}); обновите расширение` }];
    }
    else if (!SUPPORTED_VERSIONS.includes(schema.schemaVersion)) fail('schemaVersion', `версия формата ${schema.schemaVersion} не поддерживается`);
    oneOf(schema.origin, ORIGINS, 'origin', 'происхождение');
    if (schema.basedOn != null) text(schema.basedOn, 'basedOn');
    unknownKeys(schema, ['schemaVersion', 'origin', 'basedOn', 'description', 'comment', 'run', 'defaults', 'spec', 'steps', 'end'], '');
    if ('description' in schema) text(schema.description, 'description');
    if ('comment' in schema) text(schema.comment, 'comment');
    if ('spec' in schema) {
      if (!isObject(schema.spec)) fail('spec', 'ожидается объект');
      else {
        unknownKeys(schema.spec, SPEC_KEYS, 'spec');
        SPEC_KEYS.forEach((key) => { if (key in schema.spec) text(schema.spec[key], `spec.${key}`); });
      }
    }
    if (schema.run != null) {
      if (!isObject(schema.run)) fail('run', 'ожидается объект');
      else {
        unknownKeys(schema.run, ['policy', 'maxWords', 'strictLength', 'stopMarks', 'onNoAnswer', 'repeat'], 'run');
        if ('onNoAnswer' in schema.run) oneOf(schema.run.onNoAnswer, ON_NO_ANSWER, 'run.onNoAnswer', 'участник без ответа');
        if ('policy' in schema.run) oneOf(schema.run.policy, POLICIES, 'run.policy', 'политика запуска');
        if ('maxWords' in schema.run && !(Number.isSafeInteger(schema.run.maxWords) && schema.run.maxWords > 0)) fail('run.maxWords', 'ожидается положительное целое число слов');
        else if ('maxWords' in schema.run && !RUN_WORDS.includes(schema.run.maxWords)) fail('run.maxWords', `предел длины pipeline: допустимо ${RUN_WORDS.join(', ')}`);
        if ('strictLength' in schema.run && typeof schema.run.strictLength !== 'boolean') fail('run.strictLength', 'ожидается true или false');
        if ('stopMarks' in schema.run) {
          const marks = schema.run.stopMarks;
          if (!Array.isArray(marks) || marks.length < 1 || marks.length > 10) fail('run.stopMarks', 'ожидается список от одной до десяти меток');
          else marks.forEach((mark, i) => { if (typeof mark !== 'string' || !mark.trim() || mark.length > 60 || /[\r\n]/.test(mark)) fail(`run.stopMarks[${i}]`, 'метка: непустая строка до 60 знаков, в одну строку'); });
        }
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

    const checkFiles = (value, path) => {
      if (!Array.isArray(value)) { fail(path, 'ожидается список файлов'); return; }
      const ids = new Set();
      value.forEach((file, index) => {
        const at = `${path}[${index}]`;
        if (!isObject(file)) { fail(at, 'ожидается описание файла'); return; }
        unknownKeys(file, ['id', 'name', 'type', 'size', 'content'], at);
        if (typeof file.id !== 'string' || !file.id.trim()) fail(`${at}.id`, 'ID файла: непустой текст');
        else if (ids.has(file.id)) fail(`${at}.id`, `ID файла «${file.id}» повторяется`);
        else ids.add(file.id);
        if (typeof file.name !== 'string' || !file.name.trim()) fail(`${at}.name`, 'имя файла: непустой текст');
        if ('type' in file && typeof file.type !== 'string') fail(`${at}.type`, 'ожидается текст');
        if ('size' in file && !(Number.isSafeInteger(file.size) && file.size >= 0)) fail(`${at}.size`, 'ожидается неотрицательное целое число');
        if ('content' in file && typeof file.content !== 'string') fail(`${at}.content`, 'ожидается текст');
      });
    };

    if (schema.defaults != null) {
      const defaults = schema.defaults;
      if (!isObject(defaults)) fail('defaults', 'ожидается объект');
      else {
        unknownKeys(defaults, ['roundTask', 'discipline', 'modelNotes', 'roundPrompts'], 'defaults');
        if ('roundTask' in defaults) text(defaults.roundTask, 'defaults.roundTask');
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
    const labelsById = new Map();
    const idsByProviderLabel = new Map();
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
    const checkInput = (value, path, index) => {
      if (Array.isArray(value)) { checkInputList(value, path, index); return; }
      // An owner takes any input a model step takes (none, previous, all, list).
      oneOf(value, INPUTS, path, 'вход');
    };
    // The output of a step (5.1, 5.2): the text form, or json with fields; artifacts are declared in it.
    // `authors` are the participants whose revisions the output declares: { id, input? } (the owner is its own author).
    const checkOutput = (output, path, step, index, authors) => {
      if (!isObject(output)) { fail(path, 'ожидается объект'); return; }
      unknownKeys(output, ['name', 'form', 'sections', 'strictLength', 'format', 'requiredFields', 'artifacts', 'document'], path);
      ['name', 'form'].forEach((key) => { if (key in output) text(output[key], `${path}.${key}`); });
      if ('strictLength' in output && typeof output.strictLength !== 'boolean') fail(`${path}.strictLength`, 'ожидается true или false');
      if ('format' in output) oneOf(output.format, OUTPUT_FORMATS, `${path}.format`, 'формат выхода');
      if ('document' in output) {
        oneOf(output.document, ['read', 'form'], `${path}.document`, 'вид документа');
        if (output.document === 'form' && output.format !== 'json') fail(`${path}.document`, 'опросник — формат json: укажите format: "json"');
        if (output.document === 'read' && !(Array.isArray(output.artifacts) && output.artifacts.length === 1)) fail(`${path}.document`, 'документ для чтения: объявите ровно один артефакт в output.artifacts (id, name, pointer)');
      }
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
        unknownKeys(artifact, ['id', 'name', 'pointer', 'revisionOf', 'description'], at2);
        if ('description' in artifact && typeof artifact.description !== 'string') fail(`${at2}.description`, 'описание артефакта: строка');
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
        authors.forEach((model) => {
          const own = 'input' in model ? model.input : step.input;
          if (!(Array.isArray(own) && own.some((item) => addressOf(item) === key))) fail(`${at2}.revisionOf`, `ссылка на версию должна быть во входе участника «${idOf(model)}»`);
        });
      });
    };

    // An owner step (4.1): its task, and no models. Its document is the ref of an earlier round with one model that declares it.
    const checkControl = (step, path, index) => {
      if (typeof step.task !== 'string' || !step.task.trim()) fail(`${path}.task`, 'задание User: непустой текст');
      if (Array.isArray(step.models) && step.models.length) fail(`${path}.models`, 'у User нет моделей');
      if (!('document' in step)) return;
      const at = `${path}.document`;
      if (typeof step.document !== 'string' || !step.document) { fail(at, 'ожидается ref раунда'); return; }
      const position = schema.steps.findIndex((s) => isObject(s) && s.ref === step.document);
      if (position === -1) { fail(at, `неизвестный шаг «${step.document}»`); return; }
      if (position >= index) { fail(at, 'документ: только более ранний раунд'); return; }
      const source = schema.steps[position];
      if (source.kind !== 'round') { fail(at, 'источник документа — раунд'); return; }
      const enabled = (Array.isArray(source.models) ? source.models : []).filter((model) => isObject(model) && model.enabled !== false);
      if (enabled.length !== 1) { fail(at, 'документ для User даёт одна модель'); return; }
      const output = isObject(enabled[0].output) ? enabled[0].output : source.output;
      if (!(isObject(output) && ['read', 'form'].includes(output.document))) fail(at, `в выходе раунда «${source.ref}» не объявлен вид документа: output.document — read или form`);
    };

    schema.steps.forEach((step, index) => {
      const path = `steps[${index}]`;
      if (!isObject(step)) { fail(path, 'ожидается объект'); return; }
      // A removed kind (gate, route, synthesis) is named once, with the way to write it now; its other fields are not checked.
      if (Object.hasOwn(REMOVED_KIND_HINT, step.kind)) { fail(`${path}.kind`, `тип шага: допустимо ${KINDS.join(', ')}; ${REMOVED_KIND_HINT[step.kind]}`); return; }
      // A removed field (require, order) is named with what the round does now; any other unknown field is reported as such.
      Object.keys(REMOVED_FIELD_HINT).forEach((key) => { if (key in step) fail(`${path}.${key}`, REMOVED_FIELD_HINT[key]); });
      unknownKeys(step, [...(Object.hasOwn(STEP_KEYS, step.kind) ? STEP_KEYS[step.kind] : STEP_KEYS.round), ...Object.keys(REMOVED_FIELD_HINT)], path);
      if ('output' in step) {
        // A step's shared output is the answer of every author without its own; the owner is the author of its own.
        const inheriting = step.kind === 'owner' ? [{ id: 'owner' }] : (Array.isArray(step.models) ? step.models : []).filter((model) => isObject(model) && model.enabled !== false && !('output' in model));
        checkOutput(step.output, `${path}.output`, step, index, inheriting);
      }
      if ('owner' in step) oneOf(step.owner, OWNER_STEPS, `${path}.owner`, 'User в шаге');
      if ('chat' in step) oneOf(step.chat, CHAT_MODES, `${path}.chat`, 'чат шага');
      if (typeof step.ref !== 'string' || !step.ref) fail(`${path}.ref`, 'ref шага не указан');
      else if (refs.has(step.ref)) fail(`${path}.ref`, `ref «${step.ref}» повторяется`);
      else refs.add(step.ref);
      oneOf(step.kind, KINDS, `${path}.kind`, 'тип шага');
      if (CONTROL_KINDS.includes(step.kind) && typeof step.ref === 'string' && !new RegExp(`^${step.kind}:[A-Za-z0-9_-]+$`).test(step.ref)) fail(`${path}.ref`, CONTROL_REF[step.kind]);
      if ('input' in step) checkInput(step.input, `${path}.input`, index);
      if ('files' in step) checkFiles(step.files, `${path}.files`);
      if ('task' in step) text(step.task, `${path}.task`);
      STEP_TEXT_KEYS.forEach((key) => { if (key in step) text(step[key], `${path}.${key}`); });
      if (!Array.isArray(step.models)) { fail(`${path}.models`, 'ожидается список моделей'); return; }
      const ids = new Set();
      step.models.forEach((model, at) => {
        const modelPath = `${path}.models[${at}]`;
        if (!isObject(model)) { fail(modelPath, 'ожидается объект'); return; }
        unknownKeys(model, schema.schemaVersion >= 2
          ? ['name', 'id', 'label', 'settingsMode', 'enabled', 'onCanvas', 'role', 'request', 'maxWords', 'task', 'discipline', 'input', 'output', 'files']
          : ['name', 'id', 'enabled', 'onCanvas', 'role', 'request', 'maxWords', 'task', 'discipline', 'input', 'output', 'files'], modelPath);
        if ('files' in model) checkFiles(model.files, `${modelPath}.files`);
        if ('output' in model) checkOutput(model.output, `${modelPath}.output`, step, index, [model]);
        if ('enabled' in model && typeof model.enabled !== 'boolean') fail(`${modelPath}.enabled`, 'ожидается true или false');
        if ('onCanvas' in model && typeof model.onCanvas !== 'boolean') fail(`${modelPath}.onCanvas`, 'ожидается true или false');
        if (typeof model.name !== 'string' || !model.name.trim()) fail(`${modelPath}.name`, 'имя модели не указано');
        const id = idOf(model);
        if (schema.schemaVersion >= 2) {
          if (typeof model.id !== 'string' || !model.id.trim()) fail(`${modelPath}.id`, 'в формате 2 требуется постоянный ID участника');
          if ('label' in model && (typeof model.label !== 'string' || !model.label.trim())) fail(`${modelPath}.label`, 'подпись участника: непустой текст');
          if ('settingsMode' in model && model.settingsMode !== 'explicit') fail(`${modelPath}.settingsMode`, 'допустимо explicit');
          if (typeof id === 'string' && typeof model.name === 'string') {
            const label = model.label ?? model.name;
            const labelKey = `${model.name}\u0000${label}`;
            const sameIdLabel = labelsById.get(id);
            if (sameIdLabel !== undefined && sameIdLabel !== label) fail(`${modelPath}.label`, `ID участника «${id}» уже использует подпись «${sameIdLabel}»`);
            else labelsById.set(id, label);
            const otherId = idsByProviderLabel.get(labelKey);
            if (otherId !== undefined && otherId !== id) fail(`${modelPath}.label`, `подпись «${label}» у модели «${model.name}» уже занята участником «${otherId}»`);
            else idsByProviderLabel.set(labelKey, id);
          }
        }
        // One participant is one id in a step; a repeated name is fine when the ids differ. One id keeps one name in all steps.
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
        if ('input' in model) checkInput(model.input, `${modelPath}.input`, index);
        ['role', 'request', 'task'].forEach((key) => { if (key in model) text(model[key], `${modelPath}.${key}`); });
        if ('maxWords' in model && !(Number.isSafeInteger(model.maxWords) && model.maxWords > 0)) fail(`${modelPath}.maxWords`, 'ожидается положительное целое число слов');
        if ('discipline' in model) checkDiscipline(model.discipline, `${modelPath}.discipline`);
      });
      if (CONTROL_KINDS.includes(step.kind)) checkControl(step, path, index);
    });
    // A personal request must carry declared incoming answers itself. The first round
    // defaults to `none`; disabled rounds cannot provide input, and participant input
    // overrides the round input. This is a possibility check against the schema, not
    // a guess based only on the participant's position in the list.
    const steps = Array.isArray(schema.steps) ? schema.steps : [];
    const couldProduceAnswer = (step, participant) => {
      if (step?.kind === 'owner') return true;
      if (step?.kind !== 'round' || !Array.isArray(step.models)) return false;
      return step.models.some((source) => isObject(source) && source.enabled !== false
        && (participant == null || idOf(source) === participant));
    };
    const couldProduceArtifact = (step, address, { participant = null, revision = false } = {}) => {
      if (step?.kind !== 'round' || !Array.isArray(step.models)) return false;
      return step.models.some((author) => {
        if (!isObject(author) || author.enabled === false) return false;
        if (participant != null && idOf(author) !== participant) return false;
        const output = Object.hasOwn(author, 'output') ? author.output : step.output;
        return Array.isArray(output?.artifacts) && output.artifacts.some((declaration) => (!revision && declaration?.id === address.id)
          || (declaration?.revisionOf?.artifact?.step === address.step
            && declaration.revisionOf.artifact.participant === address.participant
            && declaration.revisionOf.artifact.id === address.id));
      });
    };
    const hasPossibleInput = (spec, index) => {
      if (spec === 'none' || index <= 0) return false;
      const earlier = steps.slice(0, index);
      if (spec === 'previous' || spec === 'all') return earlier.some((step) => couldProduceAnswer(step));
      if (!Array.isArray(spec)) return false;
      return spec.some((source) => {
        if (typeof source === 'string') {
          const sourceIndex = earlier.findIndex((step) => isObject(step) && step.ref === source);
          return sourceIndex >= 0 && couldProduceAnswer(earlier[sourceIndex]);
        }
        if (!isObject(source)) return false;
        const address = source.artifact || source;
        const sourceIndex = earlier.findIndex((step) => isObject(step) && step.ref === address.step);
        if (sourceIndex < 0) return false;
        if (source.artifact) {
          const versionParticipant = isObject(source.version) ? source.version.participant : null;
          return earlier.slice(sourceIndex, index).some((candidate, offset) => couldProduceArtifact(candidate, address, {
            participant: offset === 0 ? address.participant : versionParticipant,
            revision: offset > 0
          }));
        }
        return couldProduceAnswer(earlier[sourceIndex], address.participant);
      });
    };
    // Format 1 keeps its meaning (a schema already saved must keep reading): an own request without {вход} is a warning of the
    // page there, not an error of the schema.
    if (schema.schemaVersion >= 2) steps.forEach((step, index) => {
      if (!isObject(step) || step.kind !== 'round' || !Array.isArray(step.models)) return;
      step.models.forEach((model, modelIndex) => {
        if (!isObject(model) || model.enabled === false || typeof model.request !== 'string' || !model.request.trim()) return;
        const spec = Object.hasOwn(model, 'input') ? model.input : (Object.hasOwn(step, 'input') ? step.input : defaultInputOf(steps, index));
        if (hasPossibleInput(spec, index) && !model.request.includes('{вход}')) {
          fail(`steps[${index}].models[${modelIndex}].request`, 'есть возможный вход из более раннего шага, но в запросе нет {вход}');
        }
      });
    });
    // run.repeat (T06): the artifact the next pass takes is named by its address; a repeat has no User step (one window, every ownerEvery passes).
    if (isObject(schema.run) && 'repeat' in schema.run) {
      const repeat = schema.run.repeat;
      const at = 'run.repeat';
      schema.steps.forEach((step, index) => { if (isObject(step) && step.kind === 'owner') fail(`steps[${index}]`, 'в схеме с повтором нет шагов User: окно одно, раз в ownerEvery заходов'); });
      if (!isObject(repeat)) fail(at, 'ожидается объект');
      else {
        unknownKeys(repeat, ['carry', 'carryMarker', 'maxPasses', 'maxRequests', 'ownerEvery', 'carryMaxChars'], at);
        if (!('carry' in repeat)) fail(`${at}.carry`, 'адрес артефакта для переноса не указан');
        else if (!isObject(repeat.carry)) fail(`${at}.carry`, 'ожидается объект: step, participant, artifact');
        else {
          const source = repeat.carry;
          unknownKeys(source, ['step', 'participant', 'artifact'], `${at}.carry`);
          const position = typeof source.step === 'string' && positions.has(source.step) ? positions.get(source.step) : -1;
          if (position < 0) fail(`${at}.carry.step`, `неизвестный шаг «${source.step}»`);
          else if (!isObject(schema.steps[position]) || schema.steps[position].kind !== 'round') fail(`${at}.carry.step`, 'шаг должен быть раундом, не User');
          else {
            const step = schema.steps[position];
            const model = (Array.isArray(step.models) ? step.models : []).find((item) => isObject(item) && idOf(item) === source.participant);
            if (!model) fail(`${at}.carry.participant`, `участник «${source.participant}» не объявлен в шаге «${step.ref}»`);
            else if (model.enabled === false) fail(`${at}.carry.participant`, `участник «${source.participant}» выключен`);
            else {
              const output = outputOf(step, source.participant);
              const declared = isObject(output) && Array.isArray(output.artifacts) && output.artifacts.some((item) => isObject(item) && item.id === source.artifact);
              if (!declared) fail(`${at}.carry.artifact`, `артефакт «${source.artifact}» не объявлен в output участника или шага «${step.ref}»`);
            }
          }
        }
        if (!('carryMarker' in repeat)) fail(`${at}.carryMarker`, 'строка-заголовок не указана');
        else if (typeof repeat.carryMarker !== 'string' || !repeat.carryMarker.trim() || repeat.carryMarker.length > 80 || /[\r\n]/.test(repeat.carryMarker)) fail(`${at}.carryMarker`, 'строка-заголовок: непустая строка в одну строку, до 80 знаков');
        const range = (key, min, max, required) => {
          if (!(key in repeat)) { if (required) fail(`${at}.${key}`, 'не указано'); return; }
          if (!(Number.isSafeInteger(repeat[key]) && repeat[key] >= min && repeat[key] <= max)) fail(`${at}.${key}`, `ожидается целое число от ${min} до ${max}`);
        };
        range('maxPasses', 1, 500, true);
        range('maxRequests', 1, 100000, false);
        range('ownerEvery', 1, 500, false);
        range('carryMaxChars', 100, 50000, false);
      }
    }
    // end (5.11): its sources have the form of a step input, read after every step (index = the number of steps).
    // A source is a round with an enabled model (and an enabled participant); a User step gives no end.
    if (schema.end !== undefined) {
      const end = schema.end;
      if (!isObject(end)) fail('end', 'ожидается объект');
      else {
        unknownKeys(end, ['from'], 'end');
        if (!Array.isArray(end.from) || !end.from.length) fail('end.from', 'ожидается непустой список источников');
        else {
          const addresses = new Set();
          end.from.forEach((source, at) => {
            const path = `end.from[${at}]`;
            if (isObject(source) && 'required' in source) fail(`${path}.required`, 'в итоге поле required не нужно');
            if (isObject(source) && isObject(source.artifact) && 'version' in source && source.version !== 'latest') fail(`${path}.version`, 'итог берёт последнюю версию документа: version: "latest"');
            const address = checkSource(source, path, contextAt(steps.length));
            if (!address) return;
            if (addresses.has(address)) fail(path, 'источник повторяется');
            addresses.add(address);
            const named = isObject(source) && isObject(source.artifact) ? source.artifact : source;
            const ref = typeof source === 'string' ? source : named.step;
            const participant = typeof source === 'string' ? undefined : named.participant;
            const step = steps[positions.get(ref)];
            const models = Array.isArray(step.models) ? step.models.filter(isObject) : [];
            if (step.kind !== 'round') fail(path, 'итог берётся из раунда: шаг User итога не даёт');
            else if (!models.some((model) => model.enabled !== false)) fail(path, `раунд «${ref}» выключен: в нём нет включённой модели`);
            else if (participant !== undefined && !models.some((model) => idOf(model) === participant && model.enabled !== false)) fail(`${path}.participant`, `участник «${participant}» выключен`);
          });
        }
      }
    }
    errors.push(...executabilityErrors(schema.steps));
    return errors;
  }

  // The settings of the cards in the form the page edits them (the cards write only what the owner set):
  // customModelSettings[ref][participantId] = { promptTemplate, maxWords, task, discipline, input } — the key is the id of
  // the participant (its name when it has none); customRoundSettings[ref] = { input, task, owner, chat, output }
  // of a round; customStepSettings[ref] = the fields of an owner step; customDefaults = the ▶ card.
  const ROUND_FIELDS = ['input', 'task', 'owner', 'chat', 'output', 'files'];
  const STEP_FIELDS = ['input', 'task', 'owner', 'chat', 'output', 'files'];
  function toSettings(schema) {
    const customModelSettings = {};
    const customRoundSettings = {};
    const customStepSettings = {};
    (schema.steps || []).forEach((step) => {
      const fields = step.kind === 'round' ? ROUND_FIELDS : STEP_FIELDS;
      const own = {};
      fields.forEach((key) => { if (key in step) own[key] = JSON.parse(JSON.stringify(step[key])); });
      if (Object.keys(own).length) (step.kind === 'round' ? customRoundSettings : customStepSettings)[step.ref] = own;
      (step.models || []).forEach((model) => {
        const participant = { name: model.name };
        if (typeof model.label === 'string') participant.label = model.label;
        if (typeof model.settingsMode === 'string') participant.settingsMode = model.settingsMode;
        if (typeof model.role === 'string') participant.role = model.role;
        if (typeof model.onCanvas === 'boolean') participant.onCanvas = model.onCanvas;
        if (typeof model.request === 'string') participant.promptTemplate = model.request;
        if ('maxWords' in model) participant.maxWords = model.maxWords;
        if (typeof model.task === 'string') participant.task = model.task;
        if (isObject(model.discipline)) participant.discipline = JSON.parse(JSON.stringify(model.discipline));
        if ('input' in model) participant.input = JSON.parse(JSON.stringify(model.input));
        if ('output' in model) participant.output = JSON.parse(JSON.stringify(model.output));
        if ('files' in model) participant.files = JSON.parse(JSON.stringify(model.files));
        // A switched-off participant is a declaration of its own (R12): its name and off state stay, with or without other settings.
        if (model.enabled === false) Object.assign(participant, { name: model.name, enabled: false });
        if (!Object.keys(participant).length) return;
        (customModelSettings[step.ref] || (customModelSettings[step.ref] = {}))[idOf(model)] = participant;
      });
    });
    return { customModelSettings, customRoundSettings, customStepSettings, customDefaults: schema.defaults ? JSON.parse(JSON.stringify(schema.defaults)) : {} };
  }

  // The canvas a schema stands for: the rounds, the participants of each round with their roles and the owner steps in
  // their order. `models` is the list of the models the canvas knows, in its order; `isRole(id)` tells a known role. A schema
  // the canvas cannot show gives errors (with the place), never a changed schema. A round is one block per participant (two
  // participants of one model are two blocks, told apart by id); a round of one model with a role (a synthesis) is an
  // ordinary round. The rounds limit counts rounds only; an owner step may stand anywhere; a switched-off model is on the
  // canvas only with onCanvas.
  function toCanvas(schema, { models = [], isRole = () => true, runWords = null, allowDraft = false } = {}) {
    const errors = [];
    const fail = (path, message) => errors.push({ path, message });
    const steps = schema.steps || [];
    const enabledOf = (step) => (step.models || []).filter((model) => model.enabled !== false);
    const rounds = [];
    const controls = [];
    steps.forEach((step, index) => {
      const path = `steps[${index}]`;
      const enabled = enabledOf(step);
      enabled.forEach((model, at) => {
        if (!models.includes(model.name)) fail(`${path}.models[${at}].name`, `модель «${model.name}» недоступна`);
        if (model.role && !isRole(model.role)) fail(`${path}.models[${at}].role`, `роль «${model.role}» неизвестна`);
      });
      if (CONTROL_KINDS.includes(step.kind)) { controls.push({ ref: step.ref, kind: step.kind, index, afterRound: rounds.length }); return; }
      rounds.push(step);
      if (step.ref !== `r${rounds.length}`) fail(`${path}.ref`, `ref раунда должен быть «r${rounds.length}»`);
    });
    if (Array.isArray(runWords) && schema.run && 'maxWords' in schema.run && !runWords.includes(schema.run.maxWords)) fail('run.maxWords', `предел длины pipeline: допустимо ${runWords.join(', ')}`);
    // A saved draft that cannot start yet (allowDraft) is still shown.
    if (!allowDraft) executabilityErrors(steps).forEach((error) => fail(error.path, error.message));
    if (rounds.length > 50) fail('steps', 'раундов не больше 50');
    if (errors.length) return { errors };
    // Each round's stack holds only the participants of that round: enabled ones, then its switched-off ones with onCanvas.
    // A participant of another round never stands in this stack, whatever its id or its mark in that round.
    const stacks = Object.fromEntries(rounds.map((step, index) => {
      const items = (step.models || []).filter((model) => model.enabled !== false || model.onCanvas === true).map((model) => {
        const on = model.enabled !== false;
        return { name: model.name, id: idOf(model), ...(model.label ? { label: model.label } : {}), input: on, send: on, role: (on && model.role) || null };
      });
      // The enabled ones first, then the switched-off ones, each group in the order of the schema.
      const ordered = [...items.filter((item) => item.send), ...items.filter((item) => !item.send)];
      return [`r${index + 1}-models`, { items: ordered }];
    }));
    // A model is selected when a stack of some round shows it.
    const shownNames = new Set(Object.values(stacks).flatMap((stack) => stack.items.map((item) => item.name)));
    const selectedModels = models.filter((name) => shownNames.has(name));
    return { errors, roundCounter: rounds.length, selectedModels, stacks, controls, end: { sources: endSources(schema) },
      rounds: rounds.map((step, index) => ({ ref: `r${index + 1}`, participantIds: enabledOf(step).map(idOf), roles: Object.fromEntries(enabledOf(step).map((model) => [idOf(model), model.role || null])) })) };
  }

  // The run settings as the run takes them: the policy, the shared answer limit and the strict length check of the steps without their own.
  const resolveRun = (schema) => ({
    policy: typeof schema.run?.policy === 'string' ? schema.run.policy : DEFAULTS.run.policy,
    maxWords: Number.isSafeInteger(schema.run?.maxWords) ? schema.run.maxWords : DEFAULTS.run.maxWords,
    strictLength: typeof schema.run?.strictLength === 'boolean' ? schema.run.strictLength : DEFAULTS.run.strictLength,
    stopMarks: Array.isArray(schema.run?.stopMarks) ? schema.run.stopMarks.slice() : [],
    onNoAnswer: schema.run?.onNoAnswer === 'skip' ? 'skip' : 'ask',
    repeat: isObject(schema.run?.repeat) ? clone(schema.run.repeat) : null
  });

  // The sources of the End window (5.11): { step } (a round), { step, participant } or { step, participant, artifact: id }.
  // No `end` (or no `from` list): the last round with an enabled model. `end.from: []` gives no source. Assumes a valid schema.
  function endSources(schema) {
    const steps = isObject(schema) && Array.isArray(schema.steps) ? schema.steps : [];
    if (!isObject(schema?.end) || !Array.isArray(schema.end.from)) {
      const last = steps.filter((step) => isObject(step) && step.kind === 'round' && runnable(step)).pop();
      return last ? [{ step: last.ref }] : [];
    }
    return schema.end.from.flatMap((source) => {
      if (typeof source === 'string') return [{ step: source }];
      if (!isObject(source)) return [];
      if (isObject(source.artifact)) return [{ step: source.artifact.step, participant: source.artifact.participant, artifact: source.artifact.id }];
      return [{ step: source.step, ...('participant' in source ? { participant: source.participant } : {}) }];
    });
  }

  // Remarks about a valid schema that do not block it (the author decides): [{ path, message }]. Three patterns that lose
  // the author's intent silently: a participant's own task replaces the step's task; an owner answer that no later step
  // reads (an owner step at the end may close the schema); a placeholder instead of a text.
  const PLACEHOLDER_TEXT = /^(?:\.{3}|…|todo|tbd|и\s*т\.\s*д\.?)$/i;
  const placeholder = (value) => typeof value === 'string' && (PLACEHOLDER_TEXT.test(value.trim()) || /(?:\.{3}|…)$/.test(value.trim()));
  function warnings(schema) {
    const out = [];
    const steps = isObject(schema) && Array.isArray(schema.steps) ? schema.steps : [];
    const warn = (path, message) => out.push({ path, message });
    const enabledOf = (step) => (Array.isArray(step.models) ? step.models : []).filter((model) => isObject(model) && model.enabled !== false);
    if (placeholder(schema?.description)) warn('description', 'похоже на заглушку вместо текста');
    if (isObject(schema) && !(typeof schema.description === 'string' && schema.description.trim())) warn('description', 'у схемы нет description: презентация для человека');
    // The request allows two steps of User at most; the canvas does not refuse more, so it is a remark.
    if (steps.filter((step) => isObject(step) && step.kind === 'owner').length > 2) warn('steps', 'шагов User больше двух: запрос разрешает не больше двух');
    // The rounds are numbered r1…rN in order. The canvas refuses another order; the validator names it as a remark.
    let roundNumber = 0;
    steps.forEach((step, index) => {
      if (!isObject(step)) return;
      const path = `steps[${index}]`;
      if (step.kind === 'round') {
        roundNumber += 1;
        if (step.ref !== `r${roundNumber}`) warn(`${path}.ref`, `ref раунда должен быть «r${roundNumber}»`);
      }
      ['task', 'goal'].forEach((key) => { if (placeholder(step[key])) warn(`${path}.${key}`, 'похоже на заглушку вместо текста'); });
      if (step.kind === 'round' && Array.isArray(step.models) && step.models.some((model) => isObject(model) && model.enabled !== false)
        && !(typeof step.task === 'string' && step.task.trim())) warn(`${path}.task`, 'у раунда нет task: общее задание шага не задано');
      // An empty personal task is a value: it replaces the shared task with nothing.
      (Array.isArray(step.models) ? step.models : []).forEach((model, at) => {
        if (isObject(model) && model.task === '') warn(`${path}.models[${at}].task`, `пустой task у участника «${idOf(model)}»: общее задание шага ему не отправляется`);
      });
      enabledOf(step).forEach((model, at) => {
        if (placeholder(model.task)) warn(`${path}.models[${at}].task`, 'похоже на заглушку вместо текста');
        if (step.kind === 'round' && typeof model.task === 'string' && model.task.trim() && typeof step.task === 'string' && step.task.trim()) {
          warn(`${path}.models[${at}].task`, `личное задание заменяет общее task шага целиком: участнику «${idOf(model)}» общее задание не отправляется`);
        }
      });
    });
    // The inputs of a step: its own and the ones of its enabled participants (an owner step has only its own).
    const specsOf = (step, position) => [step.kind === 'owner' ? (step.input ?? 'none') : (step.input ?? defaultInputOf(steps, position)),
      ...(step.kind === 'owner' ? [] : enabledOf(step).filter((model) => 'input' in model).map((model) => model.input))];
    steps.forEach((owner, index) => {
      if (!isObject(owner) || owner.kind !== 'owner' || index === steps.length - 1) return;
      const read = steps.slice(index + 1).some((step, offset) => isObject(step) && specsOf(step, index + 1 + offset).some((spec) => {
        if (spec === 'all') return true;
        // previous: the owner is the nearest earlier step that runs.
        if (spec === 'previous') return !steps.slice(index + 1, index + 1 + offset).some(runnable);
        if (!Array.isArray(spec)) return false;
        return spec.some((source) => {
          if (typeof source === 'string') return source === owner.ref;
          if (!isObject(source)) return false;
          // The owner's edit of a document is a new version of the document's line: a later reference to that line reads it.
          if (isObject(source.artifact)) return source.artifact.step === owner.ref || (owner.document && source.artifact.step === owner.document);
          return source.step === owner.ref;
        });
      }));
      if (!read) warn(`steps[${index}]`, `ответ User «${owner.ref}» не читает ни один шаг ниже`);
    });
    return out;
  }

  const describeErrors = (errors) => errors.map((error) => (error.path ? `${error.path}: ${error.message}` : error.message)).join('; ');

  const api = Object.freeze({ SCHEMA_VERSION, SUPPORTED_VERSIONS, ORIGINS, DEFAULTS, pick, resolveFields, defaultInputOf, assemble, resolveRun, endSources, toSettings, toCanvas, validate, warnings, describeErrors });
  root.BasicSchema = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
