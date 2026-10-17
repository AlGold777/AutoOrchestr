// Basic schema: the saved form of a pipeline on the Basic engine (disput/custom-engine.js).
// A schema holds only explicit overrides; every field it does not mention comes from DEFAULTS here.
// One place assembles the final configuration: resolveFields (a value of a card) and assemble
// (the engine's steps). The canvas, the request preview and the run all go through them, and
// validate() runs before the first request. Rules: docs/Pipeline scenarios/basic-developer.md,
// field reference and how to write a schema: docs/Pipeline scenarios/basic-schema-guide.md.
//
// Schema: { schemaVersion, origin: 'builtin' | 'user', basedOn?, defaults?, steps }
//   run: { policy?: 'auto' | 'manual', maxWords?, strictLength? } — the run policy, the shared answer limit and the strict length check
//   defaults (the ▶ card): { roundTask?, synthesisTask?, discipline?, modelNotes?, roundPrompts? }
//   step: { ref, kind: 'round' | 'synthesis', order?, input?, task?, models }
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
  const MAX_LOOPS = 5;
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
    if (step.kind === 'gate') {
      Object.assign(out, { criteria: clone(step.criteria), pass: step.pass ?? DEFAULTS.gate.pass, onFail: clone(step.onFail ?? DEFAULTS.gate.onFail) });
      if ('onPass' in step) out.onPass = clone(step.onPass);
    }
    if (step.kind === 'route') {
      out.select = clone(step.select);
      if (out.select.by === 'rule' && !('conflict' in out.select)) out.select.conflict = DEFAULTS.route.conflict;
    }
    out.models = (step.models || []).filter((model) => model.enabled !== false).map((model) => ({
      name: model.name,
      id: idOf(model),
      task: typeof model.task === 'string' ? model.task : (typeof step.task === 'string' ? step.task : ''),
      extra: roleText(model.role || '', step.ref) || '',
      ...('output' in model ? { output: clone(model.output) } : {})
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
          ...('output' in model ? { output: clone(model.output) } : {}),
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
    const { fail, errors, steps, positions, index, later = false, strictOff = false, switchedOff } = ctx;
    const mark = errors.length;
    const unknown = (value, allowed, at) => Object.keys(value).forEach((key) => { if (!allowed.includes(key)) fail(`${at}.${key}`, 'неизвестное поле'); });
    // The step a reference names: it exists and comes before the consumer; final is never an ordinary source.
    const stepAt = (ref, at) => {
      if (typeof ref !== 'string' || !positions.has(ref)) { fail(at, `неизвестный шаг «${ref}»`); return -1; }
      const position = positions.get(ref);
      if (!later && position >= index) fail(at, 'вход ссылается только на более ранний шаг');
      else if (!later && steps[position].ref === 'final') fail(at, 'результат финального синтеза нельзя указать во входе');
      // A transition (feedback) never names a switched-off step; an ordinary input may (it has no answers, 4.3).
      else if (strictOff && switchedOff(position)) fail(at, `обратная связь из выключенного шага «${ref}»`);
      else return position;
      return -1;
    };
    const participantAt = (position, participant, at) => {
      // The owner step has one participant, the synthetic id `owner`, and no model (3.3); a model with that id elsewhere is a model.
      if (steps[position].kind === 'owner') {
        if (participant === OWNER_PARTICIPANT) return true;
        fail(at, 'у владельца один участник «owner»');
        return false;
      }
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
    if (position >= 0 && 'participant' in source) participantAt(position, source.participant, `${path}.participant`);
    if (failed()) return null;
    return addressOf(source);
  }

  // The place of an intermediate synthesis (R11), one rule for validate and toCanvas: the nearest steps around it that are
  // not control steps (gate, route, owner) must be rounds. So `r1 → synth → gate → r2` and `r1 → gate → synth → r2` are
  // both valid, and control steps never need a round next to them. Two syntheses never meet.
  function synthesisPlaceErrors(steps) {
    const errors = [];
    const nearest = (index, step) => {
      for (let at = index + step; at >= 0 && at < steps.length; at += step) if (!CONTROL_KINDS.includes(steps[at]?.kind)) return steps[at];
      return null;
    };
    steps.forEach((step, index) => {
      if (!isObject(step) || step.kind !== 'synthesis' || step.ref === 'final') return;
      if (nearest(index, -1)?.kind !== 'round') errors.push({ path: `steps[${index}]`, message: 'промежуточный синтез стоит сразу после раунда' });
      if (nearest(index, 1)?.kind !== 'round') errors.push({ path: `steps[${index}]`, message: 'промежуточный синтез стоит между двумя раундами' });
    });
    return errors;
  }

  // The one check of executability (R09) for validate and toCanvas: a control step (gate, route, owner) runs by itself
  // (a gate's checkers are checked by their own rule); a round runs with an enabled model. A synthesis only works on
  // the answers of an earlier step, so it alone is not runnable. A pipeline without a round is valid; an empty one or
  // one with no runnable step is named at `steps`.
  function executabilityErrors(steps) {
    const runnable = steps.some((step) => isObject(step) && (CONTROL_KINDS.includes(step.kind)
      || (step.kind === 'round' && Array.isArray(step.models) && step.models.some((model) => isObject(model) && model.enabled !== false))));
    if (runnable) return [];
    return [{ path: 'steps', message: 'нет исполнимого шага: нужен раунд с включённой моделью или шаг проверки, маршрута или владельца' }];
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
        unknownKeys(schema.run, ['policy', 'maxWords', 'strictLength'], 'run');
        if ('policy' in schema.run) oneOf(schema.run.policy, POLICIES, 'run.policy', 'политика запуска');
        if ('maxWords' in schema.run && !(Number.isSafeInteger(schema.run.maxWords) && schema.run.maxWords > 0)) fail('run.maxWords', 'ожидается положительное целое число слов');
        if ('strictLength' in schema.run && typeof schema.run.strictLength !== 'boolean') fail('run.strictLength', 'ожидается true или false');
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
    // A round or a synthesis with no enabled model is switched off: assembly takes it out, so a transition may not name it.
    const switchedOff = (index) => {
      const step = schema.steps[index];
      return isObject(step) && (step.kind === 'round' || step.kind === 'synthesis') && !(Array.isArray(step.models) && step.models.some((model) => isObject(model) && model.enabled !== false));
    };
    const contextAt = (index, later = false, strictOff = false) => ({ fail, errors, steps: schema.steps, positions, index, later, strictOff, switchedOff });
    const checkInputList = (list, path, index, later = false, strictOff = false) => {
      if (!list.length) { fail(path, 'ожидается непустой список источников'); return; }
      const addresses = new Set();
      list.forEach((source, at) => {
        const address = checkSource(source, `${path}[${at}]`, contextAt(index, later, strictOff));
        if (!address) return;
        if (addresses.has(address)) fail(`${path}[${at}]`, 'источник повторяется');
        addresses.add(address);
      });
    };
    // The input of a step or of a participant: a value of the list of inputs, or a list of sources.
    const checkInput = (value, path, kind, index) => {
      if (Array.isArray(value)) { checkInputList(value, path, index); return; }
      // A route reads the previous answers or named sources; an owner takes any input a model step takes (none, previous, all, list).
      if (kind === 'route') { if (value !== 'previous') fail(path, 'вход: допустимо previous или список источников'); return; }
      oneOf(value, INPUTS, path, 'вход');
      if (kind === 'synthesis' && value !== 'previous') fail(path, 'синтез всегда получает ответы предыдущего шага');
    };
    // The output of a step (5.1, 5.2): the text form, or json with fields; artifacts are declared in it.
    // `authors` are the participants whose revisions the output declares: { id, input? } (the owner is its own author).
    const checkOutput = (output, path, step, index, authors) => {
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
        authors.forEach((model) => {
          const own = 'input' in model ? model.input : step.input;
          if (!(Array.isArray(own) && own.some((item) => addressOf(item) === key))) fail(`${at2}.revisionOf`, `ссылка на версию должна быть во входе участника «${idOf(model)}»`);
        });
      });
    };

    // A transition (6.3): exactly one of goto, stop, return. `origin` is the index of the step that writes it.
    // A transition to an early or the current step (and a return back) needs its limit maxLoops from 1 to 5.
    const checkAction = (action, path, origin, resumeTargets) => {
      if (!isObject(action)) { fail(path, 'переход: объект с одним полем goto, stop или return'); return; }
      const kinds = ACTION_KINDS.filter((key) => key in action);
      if (kinds.length !== 1) { fail(path, 'переход: ровно одно из goto, stop, return'); return; }
      const [kind] = kinds;
      const fields = { goto: ['goto', 'maxLoops', 'feedback', 'invalidate', 'resumeAt'], stop: ['stop'], return: ['return', 'maxLoops'] }[kind];
      unknownKeys(action, fields, path);
      if ('maxLoops' in action && !(Number.isSafeInteger(action.maxLoops) && action.maxLoops >= 1 && action.maxLoops <= MAX_LOOPS)) fail(`${path}.maxLoops`, 'лимит переходов: целое от 1 до 5');
      if (kind === 'stop' && (typeof action.stop !== 'string' || !action.stop.trim())) fail(`${path}.stop`, 'причина остановки: непустой текст');
      if (kind === 'return') {
        if (action.return !== true) fail(`${path}.return`, 'return: только true');
        if (!resumeTargets.length) fail(path, 'возврат без точки продолжения: ни один переход не задаёт resumeAt');
        else if (!('maxLoops' in action) && resumeTargets.some((target) => target <= origin)) fail(path, 'возврат назад без maxLoops: укажите лимит от 1 до 5');
      }
      if (kind === 'goto') {
        if (typeof action.goto !== 'string' || !action.goto) fail(`${path}.goto`, 'ref перехода: непустой текст');
        else if (!positions.has(action.goto)) fail(`${path}.goto`, `неизвестный шаг «${action.goto}»`);
        else if (switchedOff(positions.get(action.goto))) fail(`${path}.goto`, `переход на выключенный шаг «${action.goto}»`);
        else if (positions.get(action.goto) <= origin && !('maxLoops' in action)) fail(path, 'переход назад без maxLoops: укажите лимит от 1 до 5');
      }
      if ('feedback' in action) {
        if (!Array.isArray(action.feedback)) fail(`${path}.feedback`, 'ожидается список источников');
        else checkInputList(action.feedback, `${path}.feedback`, origin, true, true);
      }
      if ('invalidate' in action) {
        if (!Array.isArray(action.invalidate) || !action.invalidate.length) fail(`${path}.invalidate`, 'ожидается непустой список ref');
        else action.invalidate.forEach((ref, at) => {
          if (!positions.has(ref)) fail(`${path}.invalidate[${at}]`, `неизвестный шаг «${ref}»`);
          else if (switchedOff(positions.get(ref))) fail(`${path}.invalidate[${at}]`, `пересмотр выключенного шага «${ref}»`);
        });
      }
      if ('resumeAt' in action) {
        if (!positions.has(action.resumeAt)) fail(`${path}.resumeAt`, `неизвестный шаг «${action.resumeAt}»`);
        else if (switchedOff(positions.get(action.resumeAt))) fail(`${path}.resumeAt`, `точка продолжения на выключенный шаг «${action.resumeAt}»`);
      }
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
        // A gate is a check by its models (6.1): without an enabled checker it is an error, not a step that vanishes.
        if (!enabled.length) fail(`${path}.models`, 'проверка без включённых проверяющих: включите хотя бы одного');
        if (!Array.isArray(step.criteria) || !step.criteria.length) fail(`${path}.criteria`, 'критерии проверки: непустой список строк');
        else step.criteria.forEach((item, at) => { if (typeof item !== 'string' || !item.trim()) fail(`${path}.criteria[${at}]`, 'критерий: непустой текст'); });
        if ('pass' in step) oneOf(step.pass, GATE_PASS, `${path}.pass`, 'pass проверки');
        if ('onFail' in step && !isObject(step.onFail)) oneOf(step.onFail, GATE_ON_FAIL, `${path}.onFail`, 'onFail проверки');
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
      if ('otherwise' in select && !rule) fail(`${path}.select.otherwise`, 'вариант по умолчанию задаётся только для правила');
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
      });
    };

    // The points of continuation of the schema: a return goes back to one of them (6.3).
    const resumeTargets = [];
    schema.steps.forEach((step, at) => actionsOf(step, `steps[${at}]`).forEach(({ action }) => {
      if (isObject(action) && positions.has(action.resumeAt)) resumeTargets.push(positions.get(action.resumeAt));
    }));
    schema.steps.forEach((step, index) => {
      const path = `steps[${index}]`;
      if (!isObject(step)) { fail(path, 'ожидается объект'); return; }
      unknownKeys(step, STEP_KEYS[step.kind] || STEP_KEYS.round, path);
      if ('output' in step) {
        // A step's shared output is the answer of every author without its own; the owner is the author of its own.
        const inheriting = step.kind === 'owner' ? [{ id: 'owner' }] : (Array.isArray(step.models) ? step.models : []).filter((model) => isObject(model) && model.enabled !== false && !('output' in model));
        checkOutput(step.output, `${path}.output`, step, index, inheriting);
      }
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
        unknownKeys(model, ['name', 'id', 'enabled', 'onCanvas', 'role', 'request', 'maxWords', 'task', 'discipline', 'input', 'output'], modelPath);
        // A participant of a route chooses; it has no answer of its own (its route output has its own contract).
        if (step.kind === 'route' && 'output' in model) fail(`${modelPath}.output`, 'у участника маршрута выход не задаётся');
        else if ('output' in model) checkOutput(model.output, `${modelPath}.output`, step, index, [model]);
        if ('enabled' in model && typeof model.enabled !== 'boolean') fail(`${modelPath}.enabled`, 'ожидается true или false');
        if ('onCanvas' in model && typeof model.onCanvas !== 'boolean') fail(`${modelPath}.onCanvas`, 'ожидается true или false');
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
      actionsOf(step, path).forEach(({ path: at, action }) => checkAction(action, at, index, resumeTargets));
    });
    // A cycle that no limit stops is an error at the transition that closes it (6.4).
    // The cycle comes from an unlimited transition, which is already named at its path: no second error there.
    const { cycle } = graph(schema.steps);
    if (cycle && !errors.some((error) => error.path === cycle)) fail(cycle, 'цикл без ограниченного перехода: укажите maxLoops');
    errors.push(...synthesisPlaceErrors(schema.steps), ...executabilityErrors(schema.steps));
    return errors;
  }

  // The settings of the cards in the form the page edits them (the cards write only what the owner set):
  // customModelSettings[ref][participantId] = { promptTemplate, maxWords, task, discipline, input } — the key is the id of
  // the participant (its name when it has none); customRoundSettings[ref] = { order, input, task, require, owner, chat, output }
  // of a round; customStepSettings[ref] = the fields of a synthesis, a gate, a route or an owner; customDefaults = the ▶ card.
  const ROUND_FIELDS = ['order', 'input', 'task', 'require', 'owner', 'chat', 'output'];
  const STEP_FIELDS = ['input', 'task', 'require', 'owner', 'chat', 'output', 'criteria', 'pass', 'onFail', 'onPass', 'select'];
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
        const participant = {};
        if (typeof model.request === 'string') participant.promptTemplate = model.request;
        if ('maxWords' in model) participant.maxWords = model.maxWords;
        if (typeof model.task === 'string') participant.task = model.task;
        if (isObject(model.discipline)) participant.discipline = JSON.parse(JSON.stringify(model.discipline));
        if ('input' in model) participant.input = JSON.parse(JSON.stringify(model.input));
        if ('output' in model) participant.output = JSON.parse(JSON.stringify(model.output));
        // A switched-off participant is a declaration of its own (R12): its name and off state stay, with or without other settings.
        if (model.enabled === false) Object.assign(participant, { name: model.name, enabled: false });
        if (!Object.keys(participant).length) return;
        (customModelSettings[step.ref] || (customModelSettings[step.ref] = {}))[idOf(model)] = participant;
      });
    });
    return { customModelSettings, customRoundSettings, customStepSettings, customDefaults: schema.defaults ? JSON.parse(JSON.stringify(schema.defaults)) : {} };
  }

  // The canvas a schema stands for: the rounds, the participants of each round with their roles, the final synthesizer,
  // the intermediate syntheses and the control steps (gate, route, owner) in their order. `models` is the list of the models
  // the canvas knows, in its order; `isRole(id)` tells a known role. A schema the canvas cannot show gives errors (with the
  // place), never a changed schema. A round is one block per participant (two participants of one model are two blocks,
  // told apart by id); the rounds limit counts rounds only. An intermediate synthesis is right after a round and before
  // the next one; a control step may stand anywhere; a switched-off model is on the canvas only with onCanvas, a switched-off synthesis is not.
  function toCanvas(schema, { models = [], isRole = () => true, runWords = null } = {}) {
    const errors = [];
    const fail = (path, message) => errors.push({ path, message });
    const steps = schema.steps || [];
    const enabledOf = (step) => (step.models || []).filter((model) => model.enabled !== false);
    const rounds = [];
    const inserts = [];
    const controls = [];
    let finalStep = null;
    steps.forEach((step, index) => {
      const path = `steps[${index}]`;
      const enabled = enabledOf(step);
      enabled.forEach((model, at) => {
        if (!models.includes(model.name)) fail(`${path}.models[${at}].name`, `модель «${model.name}» недоступна`);
        if (model.role && !isRole(model.role)) fail(`${path}.models[${at}].role`, `роль «${model.role}» неизвестна`);
      });
      if (CONTROL_KINDS.includes(step.kind)) { controls.push({ ref: step.ref, kind: step.kind, index, afterRound: rounds.length }); return; }
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
      if (enabled.length) inserts.push({ afterRound: rounds.length, plannedStageId: id, participantIds: enabled.map(idOf) });
    });
    if (Array.isArray(runWords) && schema.run && 'maxWords' in schema.run && !runWords.includes(schema.run.maxWords)) fail('run.maxWords', `предел длины pipeline: допустимо ${runWords.join(', ')}`);
    synthesisPlaceErrors(steps).forEach((error) => fail(error.path, error.message));
    executabilityErrors(steps).forEach((error) => fail(error.path, error.message));
    if (rounds.length > 50) fail('steps', 'раундов не больше 50');
    if (errors.length) return { errors };
    // A model is on the canvas when a round sends it or when its onCanvas mark stands (a switched-off model on the canvas).
    const selectedModels = models.filter((name) => rounds.some((step) => enabledOf(step).some((model) => model.name === name)
      || (step.models || []).some((model) => model.name === name && model.onCanvas === true)));
    // Each round's stack: its enabled participants in the order of the schema, then the other selected models of the canvas.
    const stacks = Object.fromEntries(rounds.map((step, index) => {
      const own = enabledOf(step);
      const ownNames = new Set(own.map((model) => model.name));
      const items = [
        ...own.map((model) => ({ name: model.name, id: idOf(model), input: true, send: true, role: model.role || null })),
        ...selectedModels.filter((name) => !ownNames.has(name)).map((name) => ({ name, id: name, input: false, send: false, role: null }))
      ];
      return [`r${index + 1}-models`, { items }];
    }));
    return { errors, roundCounter: rounds.length, selectedModels, stacks, controls,
      rounds: rounds.map((step, index) => ({ ref: `r${index + 1}`, participantIds: enabledOf(step).map(idOf), roles: Object.fromEntries(enabledOf(step).map((model) => [idOf(model), model.role || null])) })),
      synthesizer: finalStep ? (enabledOf(finalStep)[0]?.name || '') : '', inserts };
  }

  // The run settings as the run takes them: the policy, the shared answer limit and the strict length check of the steps without their own.
  const resolveRun = (schema) => ({
    policy: typeof schema.run?.policy === 'string' ? schema.run.policy : DEFAULTS.run.policy,
    maxWords: Number.isSafeInteger(schema.run?.maxWords) ? schema.run.maxWords : DEFAULTS.run.maxWords,
    strictLength: typeof schema.run?.strictLength === 'boolean' ? schema.run.strictLength : DEFAULTS.run.strictLength
  });

  const describeErrors = (errors) => errors.map((error) => (error.path ? `${error.path}: ${error.message}` : error.message)).join('; ');

  // The transitions a step writes, with their paths: a gate's onPass and onFail (when an action), the cases and otherwise of a route.
  function actionsOf(step, path) {
    if (!isObject(step)) return [];
    if (step.kind === 'gate') {
      return [...('onPass' in step ? [{ path: `${path}.onPass`, action: step.onPass }] : []),
        ...(isObject(step.onFail) ? [{ path: `${path}.onFail`, action: step.onFail }] : [])];
    }
    if (step.kind === 'route' && isObject(step.select)) {
      const cases = Array.isArray(step.select.cases) ? step.select.cases : [];
      return [...cases.map((item, at) => (isObject(item) ? { path: `${path}.select.cases[${at}].action`, action: item.action } : null)).filter(Boolean),
        ...('otherwise' in step.select ? [{ path: `${path}.select.otherwise`, action: step.select.otherwise }] : [])];
    }
    return [];
  }

  // The graph of the steps (6.3–6.4): edges { from, to, limited, path } between step indexes. A step with no written
  // transition goes on to the next one (a route never does, a gate only when onPass or onFail 'ask' does not stand for it).
  // A return may go to any resumeAt of the schema. A limited edge carries maxLoops.
  function transitionsOf(steps) {
    const positions = new Map();
    steps.forEach((step, at) => { if (isObject(step) && typeof step.ref === 'string' && !positions.has(step.ref)) positions.set(step.ref, at); });
    const resumeTargets = [];
    steps.forEach((step, at) => actionsOf(step, `steps[${at}]`).forEach(({ action }) => {
      if (isObject(action) && positions.has(action.resumeAt)) resumeTargets.push(positions.get(action.resumeAt));
    }));
    const edges = [];
    steps.forEach((step, from) => {
      if (!isObject(step)) return;
      const linear = step.kind !== 'route' && (step.kind !== 'gate' || !('onPass' in step) || step.onFail === 'ask');
      if (linear && from + 1 < steps.length) edges.push({ from, to: from + 1, limited: false, path: `steps[${from}]` });
      actionsOf(step, `steps[${from}]`).forEach(({ path, action }) => {
        if (!isObject(action)) return;
        if (positions.has(action.goto)) edges.push({ from, to: positions.get(action.goto), limited: 'maxLoops' in action, path });
        if (action.return === true) [...new Set(resumeTargets)].forEach((to) => edges.push({ from, to, limited: 'maxLoops' in action, path }));
      });
    });
    return edges;
  }

  // The path of the edge that closes a cycle of unlimited edges, or null: the cycle has no limit to stop it.
  function cycleOf(edges, count) {
    const out = Array.from({ length: count }, () => []);
    edges.forEach((edge) => { if (!edge.limited) out[edge.from].push(edge); });
    const state = new Array(count).fill(0);
    let found = null;
    const visit = (node) => {
      state[node] = 1;
      for (const edge of out[node]) {
        if (found) return;
        if (state[edge.to] === 1) { found = edge; return; }
        if (state[edge.to] === 0) visit(edge.to);
      }
      state[node] = 2;
    };
    for (let node = 0; node < count && !found; node += 1) if (state[node] === 0) visit(node);
    return found ? found.path : null;
  }

  // The graph of a list of steps: its edges and the path of a cycle of unlimited edges (null when there is none).
  const graph = (steps) => {
    const edges = transitionsOf(steps);
    return { edges, cycle: cycleOf(edges, steps.length) };
  };

  const api = Object.freeze({ SCHEMA_VERSION, SUPPORTED_VERSIONS, ORIGINS, DEFAULTS, pick, resolveFields, assemble, resolveRun, toSettings, toCanvas, validate, describeErrors, graph });
  root.BasicSchema = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
