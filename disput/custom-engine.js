// Custom engine: the shared pipeline workhorse. A run is one sequence of steps; the canvas shows
// them as round cards and synthesis inserts, the engine knows only steps. Meaning (answer, critique,
// improvement, check, synthesis) comes from the step's task; the engine executes and passes data.
//
// Step: { kind: 'round' | 'synthesis', order: 'parallel' | 'sequential', task, input, models, ref?, round?, afterRound? }
//   ref, round (the number of a round) and afterRound (a synthesis) come from the schema, so a switched-off
//   round keeps its number in labels, previews and the journal; without them the engine counts the steps it gets.
//   models: [{ id, name, extra, promptTemplate, maxWords, input? }] — card order is call order. A participant is its id
//   (the id is the name by default); two participants of one model are two entries with two ids.
//   promptTemplate replaces automatic assembly; maxWords reaches the caller on every attempt.
//   input: 'none' | 'previous' | 'all' | [sources]. The run's task is always sent. A participant's own input replaces
//          the shared one of the step; the answers before the participant in a sequential round stay a separate block.
//     previous — accepted answers of the last step that has any (a synthesis replaces the round
//                before it; a skipped step passes nothing on);
//     all      — every accepted answer of all earlier steps, rounds and syntheses alike;
//     [sources] — a step ref (all its accepted answers), { step, participant, required? } (one answer);
//                a required source without an answer stops the run before the request (missing_input).
//   sequential — each model also gets the accepted answers of the models before it in this step;
//   parallel   — every model gets the same input.
// Transport: sendParticipants(requests, meta) → { byParticipant: { [participantId]: reply }, closedByOwner } when the
//   page gives it (requests: { participantId, modelName, prompt, chat, stepRef, visit, attempt }); otherwise the legacy
//   send(models, promptsByModel, meta) → { byModel: { [model]: reply }, closedByOwner }, which needs unique model names
//   in a step. A reply is { text, status, completion, answered, transportRequestId, sentPrompt, attribution }.
//   outcome is keyed by participant id. accept() judges the technical outcome; empty text (also a token-only
//   answer) is never accepted. A rejected answer gets a correction retry in the same chat, up to maxAttempts,
//   unless the owner closed the step. Only the participants that were not accepted are sent again.
// Output (basic-output.js): an answer is checked after the technical acceptance by the step's output (length, sections,
//   JSON fields, artifacts); a rejected participant is corrected with the reason and its detail.
// Require: a step ends when the accepted answers reach its threshold (any, all or N). Owner approval (owner: approve)
//   asks the owner after the step in every mode. Artifacts (basic-artifacts.js): an accepted answer is stored once
//   (putText) and its declared artifacts are registered; a source { artifact, version } gives only that content.
// Gate (basic-control.js): checkers answer with a verdict; the gate passes by require (the answers) and pass (all | any).
//   A fail stops the run (gate_failed) or asks the owner (onFail: ask). Transitions after a gate come later.
// Pointer: the run is at a position of the plan. A gate's onPass/onFail may take goto (with maxLoops, feedback, resumeAt), stop
//   or return (to the saved resumeAt). Every new execution of a step is a new visit; a retry is not. Limits count per transition.
// Transition: decide(problem) → 'continue' | 'retry' | 'skip' | 'stop'. Asked after every step in semi-automatic
//   mode, in Auto when the threshold is not met, and after every step with approval. 'continue' is never offered
//   below the threshold. A prompt over maxPromptChars stops the run before sending.
// Owner (kind: owner, 8.1): the owner gives a text or a file through provideOwnerResult; no model is asked. A text goes through
// the step's output check and its declared artifacts; a binary file is kept as a reference and never given to a model as text.
// Stop keeps what was collected. [[ASK: …]] lines of accepted answers go to askOwner; the answers
// reach the prompts of the following steps.
(function initCustomEngine(root) {
  'use strict';

  const Output = root.BasicOutput || (typeof require === 'function' ? require('./basic-output') : null);
  const Artifacts = root.BasicArtifacts || (typeof require === 'function' ? require('./basic-artifacts') : null);
  const Control = root.BasicControl || (typeof require === 'function' ? require('./basic-control') : null);
  const DEFAULT_ATTEMPTS = 2;
  const SYNTHESIS_TASK = 'Сведи эти ответы в один итоговый ответ на задачу.';
  const REASON_TEXT = Object.freeze({
    empty: 'пустой',
    token_only: 'без текста',
    too_short: 'слишком короткий',
    truncation_marker: 'оборван',
    incomplete_ending: 'оборван на середине',
    error_output: 'ошибка вместо ответа',
    closed_by_owner: 'раунд закрыт владельцем',
    too_long: 'длиннее допустимого',
    missing_section: 'не содержит раздел',
    invalid_output: 'не в формате ответа',
    missing_field: 'без обязательного поля',
    missing_artifact: 'без объявленного артефакта',
    no_verdict: 'без вердикта',
    invalid_route: 'не назвал вариант маршрута'
  });
  const STOP_TEXT = Object.freeze({
    steps_done: 'все шаги пройдены',
    context_full: 'промпт не помещается в бюджет',
    stopped: 'остановлено владельцем',
    cancelled: 'остановлено пользователем',
    no_decision: 'нет принятых ответов, решение владельца не получено',
    missing_input: 'обязательный вход не получен, запрос не отправлен',
    gate_failed: 'проверка не пройдена',
    loop_limit: 'лимит переходов исчерпан',
    route_not_found: 'ни один вариант маршрута не подошёл, иначе не задан',
    route_ambiguous: 'подошло несколько вариантов маршрута',
    invalid_route_input: 'источник правила маршрута не читается как JSON',
    return_missing: 'возврат без сохранённой точки продолжения',
    unsupported_input: 'двоичный файл не передаётся тексту модели; шаг не отправлен'
  });
  const MAX_LOOPS = 5;
  // The fields of each transition (6.3); a field outside them is refused before the first request.
  const ACTION_FIELDS = Object.freeze({ goto: ['goto', 'maxLoops', 'feedback', 'invalidate', 'resumeAt'], stop: ['stop'], return: ['return', 'maxLoops'] });

  const text = (value) => String(value == null ? '' : value).trim();
  // The key of a step in the state of the run: its ref, or its position in the schema for a step without a ref.
  const refKey = (step) => step.ref ?? `#${step.index}`;
  const stepLabel = (step) => {
    if (step.kind === 'gate') return `Проверка ${step.ref}`;
    if (step.kind === 'owner') return `Владелец ${step.ref}`;
    return step.kind === 'synthesis' ? `Синтез после раунда ${step.afterRound}` : `Раунд ${step.round}`;
  };
  // The mode the prompt names: a list of sources is 'sources', the strings stay as they are.
  const modeOf = (spec) => (Array.isArray(spec) ? 'sources' : spec);
  // The output a participant answers with (3.2): its own declaration replaces the step's one as a whole, nothing is merged.
  // Works on the schema's steps and on the normalized ones: a participant's output sits on the participant.
  const outputOf = (step, model) => (model && typeof model === 'object' && model.output != null ? model.output : (step.output ?? null));
  // The input of a participant: its own when it has one, else the input of the step.
  const specOf = (step, model) => (model && model.input !== undefined ? model.input : step.input);
  const numbered = (items) => items.map((item, index) => `Ответ ${index + 1}:\n${item.text}`).join('\n\n');
  const labelled = (items) => items.map((item) => `${item.label}:\n${item.text}`).join('\n\n');

  // One inheritance rule; the round slot is reserved for a future round editor.
  function resolveSetting({ model, round, pipeline, fallback = '' } = {}) {
    for (const [source, value] of [['model', model], ['round', round], ['pipeline', pipeline]]) {
      if (typeof value === 'string' && value.trim()) return { value, source };
    }
    return { value: fallback, source: 'code' };
  }

  // The block «Формат ответа»: the form of the step, its sections, and the fields of a json answer.
  function formatBlock(output) {
    if (!output) return '';
    const lines = [];
    if (text(output.form)) lines.push(text(output.form));
    if (output.format === 'json') {
      lines.push('Ответ — один JSON-объект без текста вокруг.');
      if (Array.isArray(output.requiredFields) && output.requiredFields.length) lines.push(`Обязательные поля: ${output.requiredFields.join(', ')}.`);
    }
    if (Array.isArray(output.sections) && output.sections.length) lines.push(`Разделы ответа: ${output.sections.map((item) => `«${item}»`).join(', ')}.`);
    return lines.length ? `Формат ответа:\n${lines.join('\n')}` : '';
  }

  // The block of a gate: its criteria, and the verdict the answer ends with (6.1).
  const gateBlock = (step, output) => `Критерии проверки:\n${step.criteria.map((item) => `- ${item}`).join('\n')}\n${Control.verdictInstruction(output?.format === 'json')}`;
  // The feedback of a return: a block of its own, given to the visit that the return starts (never to the first visit).
  // The block of a model route: its cases with their labels, and the answer it names (6.2).
  const routeBlock = (step) => `Варианты маршрута:\n${step.select.cases.map((item) => `- ${item.id} — ${item.label}`).join('\n')}\nОтвет — один JSON-объект {"route": "<id варианта>"} без текста вокруг.`;
  const feedbackBlock = (items) => `Замечания, вызвавшие возврат:\n\n${labelled(items)}`;

  function buildPrompt({ task, step, model, input = [], inputMode = 'none', earlier = [], feedback = [], ownerAnswers = [], askInstruction = '', output = null }) {
    if (askInstruction && typeof model.discipline?.ask === 'string') askInstruction = model.discipline.ask;
    if (typeof model.promptTemplate === 'string' && model.promptTemplate.trim()) {
      // One pass: placeholders occurring inside model answers remain data, never instructions.
      const values = { '{задача}': text(task), '{вход}': inputMode === 'all' || inputMode === 'sources' ? labelled(input) : numbered(input), '{ответы до тебя}': numbered(earlier) };
      const parts = [model.promptTemplate.replace(/\{задача\}|\{вход\}|\{ответы до тебя\}/g, (key) => values[key])];
      if (formatBlock(output)) parts.push(formatBlock(output));
      if (step.kind === 'gate') parts.push(gateBlock(step, output));
      if (step.kind === 'route') parts.push(routeBlock(step));
      if (feedback.length) parts.push(feedbackBlock(feedback));
      if (ownerAnswers.length) parts.push(`Ответы владельца на вопросы:\n${ownerAnswers.map((item) => `- ${item.question}: ${item.answer}`).join('\n')}`);
      if (askInstruction) parts.push(askInstruction);
      return parts.join('\n\n');
    }
    const parts = [`Задача:\n${text(task)}`];
    if (input.length) {
      if (inputMode === 'sources') parts.push(`Ответы выбранных источников:\n\n${labelled(input)}`);
      else parts.push(inputMode === 'all'
        ? `Принятые ответы всех предыдущих шагов:\n\n${labelled(input)}`
        : `Ответы предыдущего шага:\n\n${numbered(input)}`);
    }
    if (earlier.length) parts.push(`Ответы участников этого раунда до тебя:\n\n${numbered(earlier)}`);
    if (feedback.length) parts.push(feedbackBlock(feedback));
    const taskInstruction = model.task ?? step.task;
    if (text(taskInstruction)) parts.push(`Задание:\n${text(taskInstruction)}`);
    if (formatBlock(output)) parts.push(formatBlock(output));
    if (step.kind === 'gate') parts.push(gateBlock(step, output));
    if (step.kind === 'route') parts.push(routeBlock(step));
    if (text(model.extra)) parts.push(`Дополнительно для тебя:\n${text(model.extra)}`);
    if (ownerAnswers.length) parts.push(`Ответы владельца на вопросы:\n${ownerAnswers.map((item) => `- ${item.question}: ${item.answer}`).join('\n')}`);
    if (askInstruction) parts.push(askInstruction);
    return parts.join('\n\n');
  }

  const CORRECTION_TEMPLATE = 'Твой предыдущий ответ {причина}. Дай ответ на задание полностью.';
  // The correction names the reason and its detail: the section, the pointer, the count of words.
  const correctionPrompt = (reason, template = CORRECTION_TEMPLATE, detail = '') => (typeof template === 'string' ? template : CORRECTION_TEMPLATE)
    .replace(/\{причина\}/g, `${REASON_TEXT[reason] || 'не принят'}${detail ? ` ${detail}` : ''}`);

  // Default technical check: non-empty text. The page passes the shared acceptance check.
  const defaultAccept = () => ({ ok: true, reason: '' });

  // The technical acceptance first, then the check of the output (`check`, when the step has an output).
  function judge(result, accept, check = null) {
    const value = text(result?.text);
    if (!value) return { ok: false, reason: result?.answered ? 'token_only' : 'empty', text: '' };
    const verdict = accept({ text: value, completion: result?.completion || '', status: result?.status || '' }) || {};
    if (verdict.ok === false) return { ok: false, reason: verdict.reason || 'rejected', text: value };
    const shape = check ? check(value) : null;
    if (shape && !shape.ok) return { ok: false, reason: shape.reason, detail: shape.detail || '', text: value };
    // The fields of a check (a gate's verdict, a route's choice) go with the answer.
    return { ok: true, reason: '', text: value, ...(shape?.fields ? { ...shape.fields } : {}) };
  }

  // The input item that a revision names (5.2): an artifact of the same line, and the same version when the revision names one.
  // Null when the author did not get it: the revision is never attached to another line.
  function revisionItem(declaration, items) {
    const revisionOf = declaration.revisionOf;
    if (!isPlain(revisionOf) || !isPlain(revisionOf.artifact)) return null;
    const want = revisionOf.artifact;
    const key = Artifacts.lineKey({ step: want.step, participant: want.participant, id: want.id });
    const version = revisionOf.version;
    return items.find((item) => item.artifact && Artifacts.lineKey(item.artifact.lineage) === key
      && (version === 'latest' || (item.artifact.source.step === version.step && item.artifact.source.participant === version.participant
        && item.artifact.source.visit === version.visit))) || null;
  }

  const isPlain = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
  // Whether the output of a participant declares a revision of the line (the key of its lineage): it is the author of that line's next version.
  const revisesLine = (step, model, key) => (Array.isArray(outputOf(step, model)?.artifacts) ? outputOf(step, model).artifacts : [])
    .some((item) => isPlain(item) && isPlain(item.revisionOf) && isPlain(item.revisionOf.artifact) && Artifacts.lineKey(item.revisionOf.artifact) === key);

  // The content of an artifact: the whole answer for an empty pointer, else the value at the pointer (a text as it is,
  // an object or a list as JSON). A pointer that the stored answer does not give is missing_content.
  function contentOf(answer, pointer, address) {
    if (pointer === '') return answer;
    const value = Output.parseJsonAnswer(answer);
    const read = value ? Output.readPointer(value, pointer) : { found: false };
    if (!read.found) throw new EngineError('missing_content', address, `указатель ${pointer} не найден в сохранённом ответе`);
    return typeof read.value === 'string' ? read.value : JSON.stringify(read.value);
  }

  // A route's select as the run keeps it: the cases with their conditions, labels and actions; a rule keeps its conflict and otherwise.
  function normalizeSelect(select) {
    const plain = isPlain(select) ? select : {};
    const cases = (Array.isArray(plain.cases) ? plain.cases : []).filter(isPlain).map((item) => ({
      id: item.id, ...(item.when !== undefined ? { when: JSON.parse(JSON.stringify(item.when)) } : {}),
      ...(item.label !== undefined ? { label: item.label } : {}), action: isPlain(item.action) ? { ...item.action } : item.action
    }));
    const out = { by: plain.by, cases };
    if (plain.by === 'rule') {
      out.conflict = plain.conflict === 'first' || plain.conflict === 'owner' ? plain.conflict : 'stop';
      if (plain.otherwise !== undefined) out.otherwise = isPlain(plain.otherwise) ? { ...plain.otherwise } : plain.otherwise;
    }
    return out;
  }

  // Numbers the steps for labels: rounds by their card, syntheses by the round before them.
  function normalizeSteps(steps = []) {
    let round = 0;
    return steps.map((step, index) => {
      const kind = ['synthesis', 'gate', 'route', 'owner'].includes(step.kind) ? step.kind : 'round';
      // A switched-off round keeps its number: the schema gives the number, the engine only counts without it.
      if (kind === 'round') round = Number.isSafeInteger(step.round) && step.round > 0 ? step.round : round + 1;
      return {
        index, ref: typeof step.ref === 'string' ? step.ref : null, kind, round: kind === 'round' ? round : null,
        afterRound: kind === 'synthesis' ? (Number.isSafeInteger(step.afterRound) && step.afterRound > 0 ? step.afterRound : round) : null,
        order: kind === 'round' && step.order === 'sequential' ? 'sequential' : 'parallel',
        task: kind === 'synthesis' && !text(step.task) ? SYNTHESIS_TASK : text(step.task),
        // A list of sources stays a list here: the input is checked before the run (assertExecutable).
        input: Array.isArray(step.input) ? step.input.slice() : (kind === 'synthesis' ? 'previous' : (step.input ?? (kind === 'owner' ? 'none' : 'previous'))),
        output: step.output ?? null,
        // continue: the participant keeps its chat; new: a new chat on the first request of each visit (4.2).
        chat: step.chat === 'new' ? 'new' : 'continue',
        require: step.require ?? 'any',
        approve: step.owner === 'approve',
        // A gate: its criteria, the rule of its checkers (all | any) and what a fail does (stop | ask).
        criteria: Array.isArray(step.criteria) ? step.criteria.slice() : null,
        pass: step.pass === 'any' ? 'any' : 'all',
        ...(kind === 'route' ? { select: normalizeSelect(step.select) } : {}),
        onFail: isPlain(step.onFail) ? { ...step.onFail } : (step.onFail === 'ask' ? 'ask' : 'stop'),
        ...(step.onPass !== undefined ? { onPass: isPlain(step.onPass) ? { ...step.onPass } : step.onPass } : {}),
        models: (step.models || []).map((model) => (typeof model === 'string' ? { name: model, id: model, extra: '' } : {
          name: model.name, id: model.id ?? model.name, extra: text(model.extra), task: typeof model.task === 'string' ? model.task : null, promptTemplate: typeof model.promptTemplate === 'string' ? model.promptTemplate : null,
          discipline: model.discipline ? { ...model.discipline } : null,
          maxWords: Number.isSafeInteger(model.maxWords) && model.maxWords > 0 ? model.maxWords : null,
          ...(model.input !== undefined ? { input: Array.isArray(model.input) ? model.input.slice() : model.input } : {}),
          ...(model.output !== undefined ? { output: JSON.parse(JSON.stringify(model.output)) } : {})
        }))
          .filter((model) => model.name)
      };
    }).filter((step) => step.models.length || step.kind === 'route' || step.kind === 'owner');
  }

  // A fault that stops a run before its first request. `address` names the step (its ref) and the field.
  class EngineError extends Error {
    constructor(code, address, message) {
      super(`${code}: ${address} — ${message}`);
      this.name = 'EngineError';
      this.code = code;
      this.address = address;
    }
  }

  const EXECUTED_KINDS = Object.freeze(['round', 'synthesis', 'gate', 'route', 'owner']);
  // The participant that an owner step's answer and artifacts are registered under: the owner has no model (8.1).
  const OWNER_PARTICIPANT = 'owner';
  const ROUTE_BY = Object.freeze(['rule', 'model', 'owner']);
  const CONDITION_FIELDS = Object.freeze(['source', 'pointer', 'op', 'value']);
  const INPUT_VALUES = Object.freeze(['none', 'previous', 'all']);
  // An input (of a step or of a participant) that the engine cannot execute, or null. `fail` builds the error with its address.
  function inputProblem(spec, kind, fail, field) {
    if (Array.isArray(spec)) {
      if (!spec.length) return fail('invalid_input', field, 'список источников пуст');
      const shape = (source) => {
        if (typeof source === 'string') return true;
        if (!isPlain(source)) return false;
        if ('artifact' in source) {
          const version = source.version;
          const versionOk = version === 'latest' || (isPlain(version) && typeof version.step === 'string' && typeof version.participant === 'string'
            && Number.isSafeInteger(version.visit) && version.visit > 0);
          return isPlain(source.artifact) && typeof source.artifact.step === 'string' && typeof source.artifact.participant === 'string'
            && typeof source.artifact.id === 'string' && versionOk;
        }
        // Without a participant the source is the whole accepted result of the step (3.1).
        if (!('participant' in source)) return typeof source.step === 'string';
        return typeof source.step === 'string' && typeof source.participant === 'string';
      };
      const bad = spec.findIndex((source) => !shape(source));
      if (bad >= 0) return fail('invalid_input', `${field}[${bad}]`, 'источник: ref шага, { step, participant, required? } или { artifact: { step, participant, id }, version, required? }');
      return null;
    }
    if (!INPUT_VALUES.includes(spec) || (kind === 'synthesis' && spec !== 'previous')) return fail('invalid_input', field, 'вход: none, previous, all или список источников; синтез — только previous');
    return null;
  }
  // A condition of a rule (6.2): its source is a number of the route's input list, and that input is one participant or artifact.
  function conditionProblem(cond, input, fail, field) {
    if (!isPlain(cond)) return fail('invalid_field', field, 'условие: объект с полями source, pointer, op, value');
    const composite = ['all', 'any'].filter((key) => key in cond);
    if (composite.length) {
      if (composite.length > 1 || Object.keys(cond).length > 1) return fail('invalid_field', field, 'условие: либо all, либо any, без других полей');
      const key = composite[0];
      if (!Array.isArray(cond[key]) || !cond[key].length) return fail('invalid_field', `${field}.${key}`, 'условие: непустой список условий');
      for (const [at, item] of cond[key].entries()) {
        const problem = conditionProblem(item, input, fail, `${field}.${key}[${at}]`);
        if (problem) return problem;
      }
      return null;
    }
    const extra = Object.keys(cond).find((key) => !CONDITION_FIELDS.includes(key));
    if (extra !== undefined) return fail('invalid_field', `${field}.${extra}`, `поле «${extra}» не входит в условие`);
    if (!Number.isSafeInteger(cond.source) || cond.source < 0 || cond.source >= input.length) return fail('invalid_field', `${field}.source`, 'источник: номер входа маршрута из input');
    if (!isPlain(input[cond.source])) return fail('invalid_field', `${field}.source`, 'правило читает точный источник: участника или артефакт');
    if (typeof cond.pointer !== 'string' || (cond.pointer !== '' && !cond.pointer.startsWith('/'))) return fail('invalid_field', `${field}.pointer`, 'указатель: пустой или начинается с «/»');
    if (!['eq', 'in', 'exists'].includes(cond.op)) return fail('invalid_field', `${field}.op`, 'оператор условия: eq, in или exists');
    if (cond.op === 'eq' && !('value' in cond)) return fail('invalid_field', `${field}.value`, 'для eq укажите value');
    if (cond.op === 'in' && !(Array.isArray(cond.value) && cond.value.length)) return fail('invalid_field', `${field}.value`, 'для in нужен непустой список значений');
    if (cond.op === 'exists' && 'value' in cond) return fail('invalid_field', `${field}.value`, 'для exists значение не указывают');
    return null;
  }
  // A route (6.2) as the engine runs it: its select, its cases, its conditions and its models, checked before the first request.
  function routeProblem(step, fail) {
    const select = step.select;
    if (!isPlain(select)) return fail('invalid_field', 'select', 'выбор маршрута: объект с полем by');
    if (!ROUTE_BY.includes(select.by)) return fail('invalid_field', 'select.by', 'выбор маршрута: rule, model или owner');
    const models = Array.isArray(step.models) ? step.models : [];
    if (select.by === 'model') {
      if (models.length !== 1) return fail('invalid_field', 'models', 'маршрут по модели: ровно один включённый участник');
      if (!text(step.task) && !text(models[0]?.task)) return fail('invalid_field', 'task', 'задание маршрута по модели: непустой текст');
    } else if (models.length) return fail('invalid_field', 'models', 'у маршрута по правилу и владельцу моделей нет');
    if (select.by === 'rule' && !Array.isArray(step.input)) return fail('invalid_input', 'input', 'правило читает точные источники: укажите input списком');
    if ('conflict' in select && (select.by !== 'rule' || !['stop', 'first', 'owner'].includes(select.conflict))) return fail('invalid_field', 'select.conflict', 'конфликт выбора: stop, first или owner, только для правила');
    if ('otherwise' in select && select.by !== 'rule') return fail('invalid_field', 'select.otherwise', 'вариант по умолчанию задаётся только для правила');
    if (!Array.isArray(select.cases) || !select.cases.length) return fail('invalid_field', 'select.cases', 'ожидается непустой список вариантов');
    const ids = new Set();
    for (const [at, item] of select.cases.entries()) {
      const field = `select.cases[${at}]`;
      if (!isPlain(item) || typeof item.id !== 'string' || !item.id.trim()) return fail('invalid_field', `${field}.id`, 'ID варианта: непустой текст');
      if (ids.has(item.id)) return fail('invalid_field', `${field}.id`, `вариант «${item.id}» повторяется`);
      ids.add(item.id);
      if (select.by === 'rule') {
        if (!('when' in item)) return fail('invalid_field', `${field}.when`, 'правило: условие when обязательно');
        const problem = conditionProblem(item.when, step.input, fail, `${field}.when`);
        if (problem) return problem;
      } else {
        if ('when' in item) return fail('invalid_field', `${field}.when`, 'условие задаётся только для правила');
        if (typeof item.label !== 'string' || !item.label.trim()) return fail('invalid_field', `${field}.label`, 'название варианта: непустой текст');
      }
    }
    return null;
  }

  // The output of a step or of a participant (5.8, 3.2): the fields the engine executes, or null. `field` names it in the error.
  function outputProblem(output, kind, fail, field) {
    if (!output || typeof output !== 'object' || Array.isArray(output)) return fail('invalid_field', field, 'выход: объект');
    if (output.format !== undefined && output.format !== 'json') return fail('unsupported_field', `${field}.format`, 'формат выхода движок пока не исполняет');
    if (output.artifacts !== undefined && (!Array.isArray(output.artifacts) || !output.artifacts.length)) return fail('invalid_field', `${field}.artifacts`, 'ожидается непустой список артефактов');
    if (Array.isArray(output.artifacts)) {
      for (const [at, item] of output.artifacts.entries()) {
        if (!item || typeof item !== 'object' || !('revisionOf' in item)) continue;
        const where = `${field}.artifacts[${at}].revisionOf`;
        if (!isPlain(item.revisionOf) || !isPlain(item.revisionOf.artifact)) return fail('invalid_input', where, 'ревизия: ссылка на артефакт { artifact: { step, participant, id }, version }');
        const problem = inputProblem([item.revisionOf], kind, fail, where);
        if (problem) return problem;
      }
    }
    return null;
  }

  // The first field of one raw step (as the schema gives it) that the engine does not execute yet, or null. Every
  // later step of the schema extends this list; a field that is not in it is refused, never replaced by a default.
  // options.participants: the page gives sendParticipants, so two participants of one model may stand in a step.
  function unexecutedOf(step, index, { participants = false } = {}) {
    const at = typeof step?.ref === 'string' && step.ref ? `шаг «${step.ref}»` : `шаг №${index + 1}`;
    const fail = (code, field, message) => new EngineError(code, `${at} · ${field}`, message);
    if (!step || typeof step !== 'object') return new EngineError('invalid_step', at, 'шаг должен быть объектом');
    if (step.kind !== undefined && !EXECUTED_KINDS.includes(step.kind)) return fail('unsupported_kind', 'kind', `вид «${step.kind}» движок пока не исполняет`);
    if (step.kind === 'owner') {
      // The owner (8.1) gives a text or a file; it has no models. Its input (N07) is checked below like a model's input.
      if (!text(step.task)) return fail('invalid_field', 'task', 'задание владельца: непустой текст');
      if (Array.isArray(step.models) && step.models.length) return fail('invalid_field', 'models', 'у владельца нет моделей');
    }
    if (step.kind === 'route') {
      const problem = routeProblem(step, fail);
      if (problem) return problem;
    }
    if (step.kind === 'gate') {
      if (!Array.isArray(step.criteria) || !step.criteria.length || step.criteria.some((item) => typeof item !== 'string' || !item.trim())) return fail('invalid_field', 'criteria', 'критерии: непустой список непустых строк');
      if (step.pass !== undefined && step.pass !== 'all' && step.pass !== 'any') return fail('invalid_field', 'pass', 'pass: all или any');
      if (step.onPass !== undefined && !isPlain(step.onPass)) return fail('invalid_field', 'onPass', 'onPass: переход (объект)');
      if (step.onFail !== undefined && !isPlain(step.onFail) && step.onFail !== 'stop' && step.onFail !== 'ask') return fail('invalid_field', 'onFail', 'onFail: stop, ask или переход (объект)');
    }
    if (step.input !== undefined) {
      const problem = inputProblem(step.input, step.kind, fail, 'input');
      if (problem) return problem;
    }
    if (step.output !== undefined) {
      const problem = outputProblem(step.output, step.kind, fail, 'output');
      if (problem) return problem;
    }
    if (step.require !== undefined && step.require !== 'any' && step.require !== 'all') {
      if (!Number.isSafeInteger(step.require) || step.require < 1) return fail('invalid_field', 'require', 'require: any, all или целое число больше 0');
      const count = Array.isArray(step.models) ? step.models.length : 0;
      if (step.require > count) return fail('invalid_field', 'require', `требуется больше ответов, чем участников: ${count}`);
    }
    if (step.owner !== undefined && step.owner !== 'approve') return fail('invalid_field', 'owner', 'owner: только approve');
    if (step.chat !== undefined && step.chat !== 'continue' && step.chat !== 'new') return fail('unsupported_field', 'chat', 'чат: continue или new');
    const ids = new Set();
    const names = new Set();
    for (const model of Array.isArray(step.models) ? step.models : []) {
      const name = typeof model === 'string' ? model : model?.name;
      const id = typeof model === 'string' ? model : (model?.id ?? name);
      if (model && typeof model === 'object' && model.input !== undefined) {
        const problem = inputProblem(model.input, step.kind, fail, `модель «${name}» · input`);
        if (problem) return problem;
      }
      if (model && typeof model === 'object' && model.output !== undefined) {
        if (step.kind === 'route') return fail('invalid_field', `модель «${name}» · output`, 'у участника маршрута выход не задаётся');
        const problem = outputProblem(model.output, step.kind, fail, `модель «${name}» · output`);
        if (problem) return problem;
      }
      if (names.has(name) && !participants) return new EngineError('participant_transport_required', `${at} · модель «${name}»`, 'два участника одной модели требуют транспорта по участникам (callback sendParticipants)');
      if (ids.has(id)) return new EngineError('participant_duplicate', `${at} · участник «${id}»`, 'id участника повторяется в шаге');
      ids.add(id);
      names.add(name);
    }
    return null;
  }

  // Refuses the whole schema before the first request: the first problem in the order of the steps.
  function assertExecutable(steps = [], options = {}) {
    steps.forEach((step, index) => {
      const problem = unexecutedOf(step, index, options);
      if (problem) throw problem;
      // A source names a step that is in the list before this one, and a participant of it. A step that is not in
      // the list is switched off: it gives no answers (see sourceItems), not an error.
      const inputs = [['input', step.input], ...(Array.isArray(step.models) ? step.models : [])
        .filter((model) => model && typeof model === 'object' && model.input !== undefined)
        .map((model) => [`модель «${model.name}» · input`, model.input])];
      // A revision names an artifact that its author really gets as input (5.2, 3.2): each author checks its own output and input.
      (Array.isArray(step.models) ? step.models : []).forEach((model) => {
        (outputOf(step, model)?.artifacts || []).forEach((declaration) => {
          if (!declaration || !isPlain(declaration.revisionOf)) return;
          const want = declaration.revisionOf.artifact;
          const spec = model && typeof model === 'object' && model.input !== undefined ? model.input : step.input;
          const given = Array.isArray(spec) && spec.some((source) => isPlain(source) && isPlain(source.artifact)
            && source.artifact.step === want.step && source.artifact.participant === want.participant && source.artifact.id === want.id);
          if (!given) {
            const name = typeof model === 'string' ? model : model?.name;
            throw new EngineError('invalid_input', `шаг «${step.ref}» · output.artifacts`, `ревизия «${declaration.id}» требует во входе участника «${name}» ссылку на «${want.id}»`);
          }
        });
      });
      inputs.forEach(([field, spec]) => {
        if (!Array.isArray(spec)) return;
        spec.forEach((source, at) => {
          const address = `шаг «${step.ref}» · ${field}[${at}]`;
          // The step a source names (its author, for an artifact) and the participant it names in that step.
          const check = (ref, participant, artifactId = null) => {
            const from = steps.findIndex((item) => item && item.ref === ref);
            if (from < 0) return; // a switched-off step: it gives no answers, see sourceItems
            if (from >= index) throw new EngineError('invalid_input', address, `шаг «${ref}» стоит не раньше этого шага`);
            if (participant === undefined) return;
            // The owner step has one participant, the owner (3.3); a model of a round keeps its own id.
            const declared = steps[from].kind === 'owner' ? [OWNER_PARTICIPANT]
              : (Array.isArray(steps[from].models) ? steps[from].models : []).map((model) => (typeof model === 'string' ? model : (model?.id ?? model?.name)));
            if (!declared.includes(participant)) throw new EngineError('invalid_input', address, `участник «${participant}» не объявлен в шаге «${ref}»`);
            // The artifact is declared in the output of that participant (3.2): its own, or the step's when it has none.
            const author = (Array.isArray(steps[from].models) ? steps[from].models : []).find((model) => model && typeof model === 'object' && (model.id ?? model.name) === participant);
            if (artifactId !== null && !(outputOf(steps[from], author)?.artifacts || []).some((item) => item && item.id === artifactId)) {
              throw new EngineError('invalid_input', address, `артефакт «${artifactId}» не объявлен в шаге «${ref}»`);
            }
          };
          if (typeof source === 'string') return check(source, undefined);
          if ('artifact' in source) {
            check(source.artifact.step, source.artifact.participant, source.artifact.id);
            if (isPlain(source.version)) check(source.version.step, source.version.participant);
            return;
          }
          check(source.step, source.participant);
        });
      });
    });
  }

  // The transitions of the plan (6.3, 6.4), checked before the first request: one shape per action, its fields, a known
  // target (goto, resumeAt), the feedback as sources, a limit on every transition to an early or the current step, and no
  // cycle without a limit (BasicSchema.graph). `invalidate` comes with the next pack: refused for now. Null when all is well.
  function transitionsProblem(plan) {
    const targetOf = (ref) => plan.findIndex((item) => item.ref === ref);
    const actions = [];
    plan.forEach((step, pos) => {
      if (step.kind === 'gate') {
        if (step.onPass !== undefined) actions.push({ step, pos, field: 'onPass', action: step.onPass });
        if (isPlain(step.onFail)) actions.push({ step, pos, field: 'onFail', action: step.onFail });
      } else if (step.kind === 'route') {
        step.select.cases.forEach((item, at) => actions.push({ step, pos, field: `select.cases[${at}]`, action: item.action }));
        if (step.select.otherwise !== undefined) actions.push({ step, pos, field: 'select.otherwise', action: step.select.otherwise });
      }
    });
    const resumePositions = actions.filter(({ action }) => isPlain(action) && typeof action.resumeAt === 'string')
      .map(({ action }) => targetOf(action.resumeAt)).filter((at) => at >= 0);
    for (const { step, pos, field, action } of actions) {
      const fail = (code, at, message) => new EngineError(code, `шаг «${step.ref}» · ${at}`, message);
      if (!isPlain(action)) return fail('invalid_field', field, 'переход: объект с одним полем goto, stop или return');
      const kinds = ['goto', 'stop', 'return'].filter((key) => key in action);
      if (kinds.length !== 1) return fail('invalid_field', field, 'переход: ровно одно из goto, stop, return');
      const [kind] = kinds;
      const extra = Object.keys(action).find((key) => !ACTION_FIELDS[kind].includes(key));
      if (extra !== undefined) return fail('invalid_field', `${field}.${extra}`, `поле «${extra}» не входит в переход «${kind}»`);
      if ('maxLoops' in action && !(Number.isSafeInteger(action.maxLoops) && action.maxLoops >= 1 && action.maxLoops <= MAX_LOOPS)) {
        return fail('invalid_field', `${field}.maxLoops`, 'лимит переходов: целое от 1 до 5');
      }
      if (kind === 'stop') {
        if (typeof action.stop !== 'string' || !action.stop.trim()) return fail('invalid_field', `${field}.stop`, 'причина остановки: непустой текст');
        continue;
      }
      if (kind === 'return' && action.return !== true) return fail('invalid_field', `${field}.return`, 'return: только true');
      if (kind === 'goto') {
        if (typeof action.goto !== 'string' || !action.goto) return fail('invalid_field', `${field}.goto`, 'ref перехода: непустой текст');
        if (targetOf(action.goto) < 0) return fail('unknown_target', `${field}.goto`, `шаг «${action.goto}» не исполняется в этом прогоне`);
        if ('invalidate' in action) {
          if (!Array.isArray(action.invalidate) || !action.invalidate.length) return fail('invalid_field', `${field}.invalidate`, 'ожидается непустой список ref');
          const unknown = action.invalidate.find((ref) => typeof ref !== 'string' || targetOf(ref) < 0);
          if (unknown !== undefined) return fail('unknown_target', `${field}.invalidate`, `шаг «${unknown}» не исполняется в этом прогоне`);
        }
        if ('feedback' in action) {
          if (!Array.isArray(action.feedback)) return fail('invalid_field', `${field}.feedback`, 'ожидается список источников');
          const problem = inputProblem(action.feedback, 'round', fail, `${field}.feedback`);
          if (problem) return problem;
        }
        if (targetOf(action.goto) <= pos && !('maxLoops' in action)) return fail('invalid_field', field, 'переход назад без maxLoops: укажите лимит от 1 до 5');
      }
      if ('resumeAt' in action && targetOf(action.resumeAt) < 0) return fail('unknown_target', `${field}.resumeAt`, `шаг «${action.resumeAt}» не исполняется в этом прогоне`);
      if (kind === 'return' && resumePositions.some((at) => at <= pos) && !('maxLoops' in action)) {
        return fail('invalid_field', field, 'возврат назад без maxLoops: укажите лимит от 1 до 5');
      }
    }
    const Schema = root.BasicSchema || (typeof require === 'function' ? require('./basic-schema') : null);
    const { cycle } = Schema.graph(plan);
    return cycle ? new EngineError('unbounded_cycle', cycle, 'цикл без ограниченного перехода: укажите maxLoops на переходе, который замыкает цикл') : null;
  }

  async function run({
    task, steps = [], maxAttempts = DEFAULT_ATTEMPTS, semiAuto = false, maxPromptChars = Infinity,
    accept = defaultAccept, parseAsks = null, askOwner = null, askInstruction = '', decide = null,
    send = null, sendParticipants = null, runMaxWords = null, putText: putCallback = null, getText: getCallback = null, chooseRoute = null, provideOwnerResult = null,
    checkpoint = null, resolveUnknown = null, resume = null,
    signal = null, onEvent = null, onRequest = null, onResponse = null
  }) {
    // The texts of the answers: the record gives the callbacks (putText → ref, getText(ref) → text); without them the run keeps
    // its own dictionary, which the result returns. An answer is put once, when it is accepted.
    const texts = new Map();
    let textSeq = 0;
    const putText = typeof putCallback === 'function' ? putCallback : (value) => { textSeq += 1; const ref = `text${textSeq}`; texts.set(ref, value); return ref; };
    const getText = typeof getCallback === 'function' ? getCallback : (ref) => texts.get(ref);
    // The registry of the artifacts of the run (basic-artifacts.js): entries name an answer and a pointer, never a copy.
    const registry = Artifacts.createRegistry();
    // The run's word limit: the page gives it; without it the default of Basic (BasicSchema.DEFAULTS.run) applies.
    const runLimit = Number.isSafeInteger(runMaxWords) ? runMaxWords : (root.BasicSchema || (typeof require === 'function' ? require('./basic-schema') : null))?.DEFAULTS?.run?.maxWords;
    // The check of an answer of one participant by the output of its step, or null when the step has no output.
    // A gate's checker is also checked for its verdict (6.1), after the output.
    const checkFor = (step, model) => {
      if (step.kind === 'route') return (value) => Control.routeOf(value, step.select.cases.map((item) => item.id));
      const output = outputOf(step, model);
      const shape = output ? (value) => Output.checkAnswer(value, output, { limit: model.maxWords ?? runLimit }) : null;
      if (step.kind !== 'gate') return shape;
      return (value) => {
        const base = shape ? shape(value) : { ok: true };
        if (!base.ok) return base;
        const verdict = Control.verdictOf(value, { json: output?.format === 'json' });
        return verdict.ok ? { ok: true, fields: { verdict: verdict.verdict, unmet: verdict.unmet } } : verdict;
      };
    };
    if (!Output || !Artifacts || !Control) throw new Error('basic_modules_missing: загружены не все модули Basic (basic-output.js, basic-artifacts.js, basic-control.js)');
    const participants = typeof sendParticipants === 'function';
    if (!participants && typeof send !== 'function') throw new Error('custom_send_required');
    assertExecutable(steps, { participants });
    // A new chat is a chat of a participant: only the transport by participants can keep chats apart.
    steps.forEach((step, index) => {
      if (!participants && step && step.chat === 'new') {
        throw new EngineError('unsupported_field', `${typeof step.ref === 'string' && step.ref ? `шаг «${step.ref}»` : `шаг №${index + 1}`} · chat`,
          'чат «new» нужен транспорту по участникам (callback sendParticipants)');
      }
    });
    const emit = (kind, fields) => { if (typeof onEvent === 'function') onEvent(kind, fields); };
    const aborted = () => Boolean(signal?.aborted);
    const plan = normalizeSteps(steps);
    const transitionProblem = transitionsProblem(plan);
    if (transitionProblem) throw transitionProblem;
    if (plan.some((step) => step.kind === 'owner') && typeof provideOwnerResult !== 'function') {
      throw new Error('provide_owner_required: шагу владельца нужен callback provideOwnerResult (вопрос владельцу)');
    }
    const ownerAnswers = [];
    const history = []; // every request: step, model, participant, attempt, prompt, outcome
    const results = []; // per step: { step, outcome: { participantId: verdict }, skipped }
    let stopReason = 'steps_done';
    // The state of the run (ТЗ 7): plain data. The visit of a step is the number of its executions; the feedback of a return
    // waits for the visit it starts; the stack keeps the points where a return goes back.
    // dependencies: the keys of the results and artifacts that each visit used (6.3); a stale key makes its consumer stale.
    const state = { visits: {}, loopCounters: {}, continuationStack: [], feedback: {}, dependencies: {}, decisions: {} };
    let activeVisit = 1;
    let activeFeedback = [];
    let activeFeedbackRefs = []; // the feedback of the visit in progress, as references (for a checkpoint)
    let inFlight = []; // the participants whose request is being sent now: unknown after a reload until their answer is judged
    let chatBindings = {}; // participantId → { modelName, stepRef, visit, transportRequestId }: the chat of each participant (kept on resume)
    let openOwner = null; // the owner interaction that is open now (a decision, a route, an owner step, an ASK): kept on a stop
    let stopDetail = '';
    // The plan as the run sees it: a report shows what was intended, not only what happened.
    emit('custom_start', { semiAuto: Boolean(semiAuto), maxAttempts, taskChars: text(task).length,
      steps: plan.map((step) => ({ step: step.index, ref: step.ref, label: stepLabel(step), order: step.order, input: modeOf(step.input), models: step.models.map((model) => model.name) })) });

    class StopRun extends Error { constructor(reason, detail = '') { super(reason); this.stopReason = reason; this.stopDetail = detail; } }

    // The live state for a checkpoint (8.2): plain data only. The pointer is the step in progress (or the next one between steps);
    // a pending owner interaction and the pending participants of a send are named, so a reload can show them.
    // The live state for a checkpoint (8.2): plain data only. The pointer is the step in progress (or the next one between steps).
    // The step in progress keeps its visit, phase, accepted answers, the participants in flight, its feedback, route and owner answer.
    const compactOutcome = (outcome) => Object.fromEntries(Object.entries(outcome || {}).map(([id, item]) => { const { text, ...rest } = item; return [id, rest]; }));
    const ownerOf = (owner) => ({ textRef: owner.textRef ?? null, binary: Boolean(owner.binary), file: owner.file ?? null });
    const savedEntry = (item) => ({ stepRef: item.step.ref, index: item.step.index, visit: item.visit, valid: item.valid !== false, skipped: Boolean(item.skipped),
      outcome: compactOutcome(item.outcome), ...(item.route ? { route: item.route } : {}), ...(item.owner ? { owner: ownerOf(item.owner) } : {}) });
    function liveState(phase, extra = {}) {
      const step = plan[pos];
      const outcomeNow = current?.outcome || {};
      const finished = results.filter((item) => item !== current);
      return JSON.parse(JSON.stringify({
        pc: step ? step.ref : null, visits: state.visits, loopCounters: state.loopCounters, continuationStack: state.continuationStack,
        feedback: state.feedback, dependencies: state.dependencies, decisions: state.decisions,
        // `active` is true while a step is in progress; between steps the current position is the next step, not started.
        current: current && step ? { active: true, stepRef: step.ref, visit: activeVisit, phase, valid: current.valid !== false,
          accepted: Object.keys(outcomeNow).filter((id) => outcomeNow[id]?.ok), pending: extra.pending ?? inFlight,
          outcome: compactOutcome(outcomeNow), feedback: activeFeedbackRefs, route: current.route ?? null,
          owner: current.owner ? ownerOf(current.owner) : null, ...(extra.applied ? { applied: extra.applied } : {}) }
          : { active: false, stepRef: step ? step.ref : null, visit: step ? (state.visits[refKey(step)] || 0) : 0, phase, valid: true,
            accepted: [], pending: [], outcome: {}, feedback: [], route: null, owner: null },
        results: finished.map(savedEntry),
        routes: finished.filter((item) => item.route).map((item) => ({ stepRef: item.step.ref, visit: item.visit, id: item.route.id, by: item.route.by, reason: item.route.reason })),
        ownerAnswers, artifacts: registry.entries, pendingOwner: openOwner, chatBindings
      }));
    }
    // The checkpoint (8.2) is awaited before the next external action. A failed save is not swallowed: the run stops with
    // checkpoint_failed, so no request and no transition follows it. Without a callback the run is autonomous and saves nothing.
    async function checkpointNow(phase, extra = {}) {
      if (typeof checkpoint !== 'function') return;
      if ('pendingOwner' in extra) openOwner = extra.pendingOwner;
      const step = plan[pos];
      try {
        await checkpoint(liveState(phase, extra));
      } catch (error) {
        throw new EngineError('checkpoint_failed', `${step ? `шаг «${step.ref}»` : 'конец прогона'} · ${phase}`, `состояние не сохранено: ${error?.message || error}`);
      }
    }

    // Waiting for the owner (a decision, an [[ASK]] answer) ends on Stop: the run is cancelled with
    // what was collected, also when the owner's dialog itself rejects with AbortError.
    async function ownerWait(start) {
      if (aborted()) throw new StopRun('cancelled');
      let onAbort = null;
      const stopped = new Promise((resolve, reject) => {
        onAbort = () => reject(new StopRun('cancelled'));
        signal?.addEventListener?.('abort', onAbort, { once: true });
      });
      try {
        return await Promise.race([Promise.resolve().then(start), stopped]);
      } catch (error) {
        if (error instanceof StopRun || error?.name === 'AbortError' || aborted()) throw new StopRun('cancelled');
        throw error;
      } finally {
        signal?.removeEventListener?.('abort', onAbort);
      }
    }

    // Accepted answers of a step, each with its participant and its source (step, model, attempt) for the record.
    // The answers the step needs (ТЗ 4.2): all → every enabled participant, a number → that number, any → one.
    const neededOf = (step) => (step.require === 'all' ? step.models.length : (Number.isSafeInteger(step.require) ? step.require : 1));
    // A gate passes when its accepted checkers reach the threshold (require) and their verdicts pass by the rule (pass).
    // A skipped gate has no verdict, so it does not pass.
    const verdictsOf = (step, outcome) => step.models.filter((model) => outcome[model.id]?.ok).map((model) => outcome[model.id].verdict);
    const gatePass = (step, outcome, skipped = false) => !skipped && verdictsOf(step, outcome).length >= neededOf(step)
      && Control.passed(verdictsOf(step, outcome), step.pass);
    const acceptedOf = (entry) => {
      if (!entry || entry.skipped || entry.valid === false || entry.step.kind === 'route') return [];
      if (entry.step.kind === 'owner') {
        // The owner's answer is data of its step, not an answer of a model: it is labelled as the owner's.
        return entry.owner ? [{ text: entry.owner.text, textRef: entry.owner.textRef, participant: OWNER_PARTICIPANT, ...(entry.owner.binary ? { binary: true, file: entry.owner.file } : {}),
          source: { step: entry.step.index, visit: entry.visit, label: stepLabel(entry.step), model: OWNER_PARTICIPANT, attempt: null } }] : [];
      }
      return entry.step.models.map((model) => ({ model, verdict: entry.outcome[model.id] }))
        .filter((item) => item.verdict?.ok)
        .map(({ model, verdict }) => ({ ...verdict, participant: model.id,
          source: { step: entry.step.index, visit: entry.visit, label: stepLabel(entry.step), model: verdict.model, attempt: verdict.attempt } }));
    };
    // The last visit of a step: the answer a source names. An older visit is never the current answer of its step.
    const currentOf = (ref) => {
      for (let at = results.length - 1; at >= 0; at -= 1) if (results[at].step.ref === ref) return results[at];
      return null;
    };
    // The entries that are current for a consumer at schema index `before`: the last visit of each step, in schema order.
    function currentEntries(before) {
      const last = new Map();
      results.forEach((entry) => last.set(refKey(entry.step), entry));
      return [...last.values()].filter((entry) => entry.step.index < before).sort((a, b) => a.step.index - b.step.index);
    }
    // The content of an artifact version: the line, then its current version (latest) or the named one. Only that content.
    function artifactItems(source, step, model = null) {
      const required = Boolean(source.required);
      const address = source.artifact;
      const lineage = { step: address.step, participant: address.participant, id: address.id };
      // An author that revises this line starts from the last valid version of it (its declared input, 3.4).
      const base = Boolean(model) && revisesLine(step, model, Artifacts.lineKey(lineage));
      const found = source.version === 'latest' ? Artifacts.latest(registry, lineage, { base }) : Artifacts.version(registry, lineage, source.version);
      if (!found || !found.valid) {
        if (!required) return [];
        throw new StopRun('missing_input', `артефакт «${address.id}» шага «${address.step}», участник «${address.participant}»: нет актуальной версии; шаг «${step.ref}» не отправлен`);
      }
      const answer = getText(found.content.answerRef);
      if (answer === undefined || answer === null) throw new EngineError('missing_content', `шаг «${step.ref}» · input`, `текст ответа «${found.content.answerRef}» не найден`);
      // The label names the author of this version (its source), not the author of the line.
      const author = results.find((item) => item.step.ref === found.source.step && item.visit === found.source.visit);
      const where = author ? stepLabel(author.step) : found.source.step;
      return [{
        label: `Артефакт «${found.name}» (${where}, участник ${found.source.participant}, визит ${found.source.visit})`,
        text: contentOf(answer, found.content.pointer, `шаг «${step.ref}» · input`),
        source: { step: author ? author.step.index : null, visit: found.source.visit, label: where, model: found.source.participant, attempt: null },
        artifact: { lineage: { ...found.lineage }, source: { ...found.source } },
        address: { step: found.source.step, participant: found.source.participant, visit: found.source.visit, artifact: found.lineage.id },
        textRef: found.content.answerRef, pointer: found.content.pointer
      }];
    }
    // A binary file of an owner step (8.1) is an item without text: it is passed on only as an attachment, never as text.
    const binaryOf = (item) => (item.binary ? { binary: true, file: item.file } : {});
    // The items of one source list, in the order of the list. Each item names its step, participant and visit.
    function sourceItems(spec, step, model = null) {
      return spec.flatMap((source) => {
        if (source && typeof source === 'object' && 'artifact' in source) return artifactItems(source, step, model);
        const required = Boolean(source?.required);
        const ref = typeof source === 'string' ? source : source.step;
        const entry = currentOf(ref);
        // A whole result (a string, or an object without a participant) is every accepted answer of the step (3.1).
        const whole = typeof source === 'string' || !('participant' in source);
        const answers = acceptedOf(entry).filter((item) => whole || item.participant === source.participant);
        if (required) {
          const who = whole ? '' : ` участник «${source.participant}»`;
          const stopped = (why) => new StopRun('missing_input', `шаг «${ref}»${who} ${why}; шаг «${step.ref}» не отправлен`);
          // A required source is complete: its answers reach the threshold and its gate passes (3.1).
          if (!answers.length) throw stopped('не дал принятого ответа');
          if (whole && answers.length < neededOf(entry.step)) throw stopped('не набрал порога принятых ответов');
          if (entry.step.kind === 'gate' && !gatePass(entry.step, entry.outcome, entry.skipped)) throw stopped('не прошёл проверку');
        }
        return answers.map((item) => ({
          label: `${stepLabel(entry.step)}${entry.step.output?.name ? ` («${entry.step.output.name}»)` : ''}, участник ${item.participant}, визит ${entry.visit}`,
          text: item.text, source: item.source, textRef: item.textRef, pointer: '', ...binaryOf(item),
          address: { step: entry.step.ref, participant: item.participant, visit: entry.visit }
        }));
      });
    }
    // The input of a step (strict): a binary file in it stops the run before the request (unsupported_input). Not strict: the text only.
    function inputFor(step, spec = step.input, { strict = true, model = null } = {}) {
      const items = answersFor(step, spec, model);
      if (!strict) return items.filter((item) => !item.binary);
      const binary = items.find((item) => item.binary);
      if (binary) throw new StopRun('unsupported_input', `файл «${binary.file.name}» (${binary.file.mime}) — двоичный, текстом моделям не передаётся; шаг «${step?.ref}» не отправлен`);
      return items;
    }
    // The current answers of a spec: 'all' and 'previous' take the entries before the step, the last visit of each.
    function answersFor(step, spec = step.input, model = null) {
      if (spec === 'none') return [];
      if (Array.isArray(spec)) return sourceItems(spec, step, model);
      const entries = currentEntries(Number.isSafeInteger(step?.index) ? step.index : Infinity);
      if (spec === 'all') {
        return entries.flatMap((entry) => acceptedOf(entry).map((item, index) => ({
          label: `${stepLabel(entry.step)}${entry.visit > 1 ? `, визит ${entry.visit}` : ''}, ответ ${index + 1}`, text: item.text, source: item.source, ...binaryOf(item),
          address: { step: entry.step.ref, participant: item.participant, visit: entry.visit }
        })));
      }
      for (let index = entries.length - 1; index >= 0; index -= 1) {
        // A stale step is not passed over: an older answer never replaces it (6.3, 5.3). A skipped step passes nothing on.
        if (entries[index].valid === false) return [];
        const accepted = acceptedOf(entries[index]);
        if (accepted.length) {
          return accepted.map((item) => ({ text: item.text, source: item.source, ...binaryOf(item),
            address: { step: entries[index].step.ref, participant: item.participant, visit: entries[index].visit } }));
        }
      }
      return [];
    }
    // The feedback of a transition: its sources are resolved now, before the transition, and kept as addresses and text refs.
    function feedbackOf(spec, target) {
      return sourceItems(spec, target).map((item) => {
        if (item.binary) throw new StopRun('unsupported_input', `файл «${item.file.name}» (${item.file.mime}) — двоичный; замечанием текстом не передаётся`);
        return { label: item.label, source: item.source, textRef: item.textRef, pointer: item.pointer ?? '' };
      });
    }
    // The feedback stored for a step goes to its next visit only: it is taken here, when that visit starts.
    function takeFeedback(key) {
      const stored = state.feedback[key] || [];
      delete state.feedback[key];
      activeFeedbackRefs = stored.map((item) => ({ label: item.label, textRef: item.textRef, pointer: item.pointer ?? '' }));
      return feedbackFrom(stored, key);
    }

    // Instructions (owner-editable behaviour) and input (data from other models) are kept apart.
    function partsFor(step, model, input, earlier, spec) {
      return {
        instructions: { task: text(task), stepTask: model.task ?? step.task, extra: model.extra || '', askInstruction: semiAuto ? (model.discipline?.ask ?? askInstruction) : '',
          ownerAnswers: ownerAnswers.slice() },
        input: { mode: modeOf(spec), items: input, earlier, feedback: activeFeedback }
      };
    }

    function promptFor(step, model, earlier) {
      const spec = specOf(step, model);
      const input = inputFor(step, spec, { model });
      const prompt = buildPrompt({ task, step, model, input, inputMode: modeOf(spec), earlier, feedback: activeFeedback,
        ownerAnswers, askInstruction: semiAuto ? askInstruction : '', output: outputOf(step, model) });
      if (prompt.length > maxPromptChars) throw new StopRun('context_full');
      return { prompt, parts: partsFor(step, model, input, earlier, spec) };
    }

    // Sends the participants with their prompts, then corrections; fills `outcome` by participant id. Every attempt
    // is a history entry of its own: a retry never rewrites the attempt it follows, it refers to it.
    async function attempt(step, models, requests, outcome, firstAttempt = 1) {
      const phase = step.kind === 'route' ? 'route' : 'answer';
      let pending = models.slice();
      let current = requests; // participant id → { prompt, parts, retryOf }
      for (let tryNo = firstAttempt; pending.length && tryNo < firstAttempt + maxAttempts; tryNo += 1) {
        if (aborted()) throw new StopRun('cancelled');
        // The budget is checked before every send, a correction request included.
        if (pending.some((model) => String(current[model.id].prompt || '').length > maxPromptChars)) throw new StopRun('context_full');
        const entries = Object.fromEntries(pending.map((model) => {
          const entry = { step: step.index, ref: step.ref, kind: step.kind, label: stepLabel(step), model: model.name, participant: model.id, attempt: tryNo,
            retryOf: current[model.id].retryOf || null, prompt: current[model.id].prompt, parts: current[model.id].parts,
            phase, visit: activeVisit, state: 'sent', sentAt: Date.now() };
          history.push(entry);
          if (typeof onRequest === 'function') onRequest(entry);
          return [model.id, entry];
        }));
        inFlight = pending.map((model) => ({ participantId: model.id, attempt: tryNo, phase, stepRef: step.ref, visit: activeVisit }));
        await checkpointNow('send');
        const meta = { step: step.index, kind: step.kind, label: stepLabel(step), attempt: tryNo, phase, stepRef: step.ref, visit: activeVisit };
        const maxWordsOf = Object.fromEntries(pending.map((model) => [model.id, model.maxWords || null]));
        const correctionOf = Object.fromEntries(pending.map((model) => [model.id, Boolean(current[model.id].parts?.correction)]));
        let reply;
        let byId; // participant id → the reply of the transport
        try {
          if (participants) {
            reply = await sendParticipants(pending.map((model) => ({ participantId: model.id, modelName: model.name, prompt: current[model.id].prompt,
              // A new chat starts on the first request of the visit only; a correction or a retry inside the visit goes to it.
              chat: step.chat === 'new' && tryNo === 1 ? 'new' : 'continue', stepRef: step.ref, visit: activeVisit, attempt: tryNo })),
            { ...meta, maxWordsByParticipant: maxWordsOf, correctionByParticipant: correctionOf });
            byId = reply?.byParticipant || {};
          } else {
            reply = await send(pending.map((model) => model.name), Object.fromEntries(pending.map((model) => [model.name, current[model.id].prompt])),
              { ...meta,
                maxWordsByModel: Object.fromEntries(pending.map((model) => [model.name, model.maxWords || null])),
                correctionByModel: Object.fromEntries(pending.map((model) => [model.name, correctionOf[model.id]])) });
            byId = Object.fromEntries(pending.map((model) => [model.id, reply?.byModel?.[model.name]]));
          }
        } catch (error) {
          if (error?.code === 'context_full') {
            Object.values(entries).forEach((entry) => {
              Object.assign(entry, { state: 'not_sent', reason: 'context_full', finishedAt: Date.now() });
              if (typeof onResponse === 'function') onResponse(entry);
            });
            inFlight = [];
            throw new StopRun('context_full');
          }
          if (error?.name === 'AbortError' || aborted()) throw new StopRun('cancelled');
          byId = Object.fromEntries(pending.map((model) => [model.id, { text: '', status: String(error?.message || error) }]));
        }
        const retry = [];
        pending.forEach((model) => {
          const result = byId[model.id] || {};
          if (result.transportRequestId) chatBindings[model.id] = { modelName: model.name, stepRef: step.ref, visit: activeVisit, transportRequestId: result.transportRequestId };
          let verdict = judge(result, accept, checkFor(step, model));
          if (!verdict.ok && reply?.closedByOwner && !text(result.text)) verdict = { ...verdict, reason: 'closed_by_owner' };
          outcome[model.id] = { ...verdict, model: model.name, participant: model.id, status: result.status || '', attempt: tryNo, transportRequestId: result.transportRequestId || '' };
          // An accepted answer is stored once, then each artifact it declares is registered (one line, one version).
          if (verdict.ok) {
            const answerRef = putText(verdict.text);
            outcome[model.id].textRef = answerRef;
            const items = current[model.id].parts?.input?.items || [];
            const inputs = items.filter((item) => item.artifact).map((item) => item.artifact);
            (outputOf(step, model)?.artifacts || []).forEach((declaration) => {
              // A revision joins the line of the source it got; any other artifact starts its own line.
              const revision = declaration.revisionOf ? revisionItem(declaration, items) : null;
              if (declaration.revisionOf && !revision) throw new EngineError('missing_input', `шаг «${step.ref}» · output.artifacts`, `ревизия «${declaration.id}» без полученной версии`);
              Artifacts.register(registry, { id: declaration.id, name: declaration.name,
                lineage: revision ? { ...revision.artifact.lineage } : { step: step.ref, participant: model.id, id: declaration.id },
                source: { step: step.ref, participant: model.id, visit: activeVisit }, answerRef, pointer: declaration.pointer, inputs });
            });
          }
          delete outcome[model.id].detail;
          if (verdict.detail) outcome[model.id].detail = verdict.detail;
          Object.assign(entries[model.id], {
            state: 'done', finishedAt: Date.now(), sentPrompt: typeof result.sentPrompt === 'string' ? result.sentPrompt : null,
            answer: text(result.text), attribution: result.attribution || '', accepted: verdict.ok, reason: verdict.reason || '', ...(verdict.detail ? { detail: verdict.detail } : {}),
            ...(verdict.verdict ? { verdict: verdict.verdict, unmet: verdict.unmet } : {}),
            status: result.status || '', transportRequestId: result.transportRequestId || ''
          });
          if (typeof onResponse === 'function') onResponse(entries[model.id]);
          emit('custom_answer', { step: step.index, label: stepLabel(step), model: model.name, participant: model.id, attempt: tryNo, input: modeOf(specOf(step, model)),
            accepted: verdict.ok, reason: verdict.reason || null, status: result.status || null,
            transportRequestId: result.transportRequestId || null, promptChars: String(current[model.id].prompt || '').length });
          if (!verdict.ok && !reply?.closedByOwner) retry.push(model);
        });
        inFlight = [];
        await checkpointNow('judge');
        if (reply?.closedByOwner) return { closedByOwner: true };
        pending = retry;
        // No text at all means no answer exists to correct (a refused or unconfirmed dispatch looks the same):
        // the same request goes out again. A correction is for an answer that came back and was not accepted.
        current = Object.fromEntries(retry.map((model) => (outcome[model.id].reason === 'empty' ? [model.id, { ...current[model.id], retryOf: tryNo }] : [model.id, (() => {
          const correction = correctionPrompt(outcome[model.id].reason, model.discipline?.correction, outcome[model.id].detail);
          // The correction keeps the input of the request it corrects: the answer is still made from that input.
          return { prompt: correction, parts: { correction: { reason: outcome[model.id].reason, text: correction }, input: current[model.id].parts?.input }, retryOf: tryNo };
        })()])));
      }
      return { closedByOwner: false };
    }

    async function execute(step, models, outcome, firstAttempt = 1) {
      if (step.order === 'sequential') {
        for (const model of models) {
          // Only the participants before this one in card order, also on a retry.
          const position = step.models.findIndex((item) => item.id === model.id);
          const earlier = step.models.slice(0, position).map((item) => outcome[item.id])
            .filter((item) => item?.ok)
            .map((item) => ({ text: item.text, source: { step: step.index, label: stepLabel(step), model: item.model, attempt: item.attempt } }));
          const reply = await attempt(step, [model], { [model.id]: { ...promptFor(step, model, earlier), retryOf: outcome[model.id]?.attempt || null } }, outcome, firstAttempt);
          if (reply.closedByOwner) {
            // The owner closed the step: the participants after this one are not called.
            models.slice(models.indexOf(model) + 1).forEach((rest) => {
              outcome[rest.id] = { ok: false, reason: 'closed_by_owner', text: '', status: '', model: rest.name, participant: rest.id, attempt: outcome[rest.id]?.attempt || 0, transportRequestId: '' };
            });
            break;
          }
        }
      } else {
        const requests = Object.fromEntries(models.map((model) => [model.id, { ...promptFor(step, model, []), retryOf: outcome[model.id]?.attempt || null }]));
        await attempt(step, models, requests, outcome, firstAttempt);
      }
    }

    // The keys of results (schema index and visit) and of artifact versions: what a visit used, and what becomes stale.
    const resultKey = (entry) => `${entry.step.index}@${entry.visit}`;
    const artifactKey = (entry) => `art:${Artifacts.lineKey(entry.lineage)}@${entry.source.step}|${entry.source.participant}|${entry.source.visit}`;
    const producerKey = (entry) => {
      const step = plan.find((item) => item.ref === entry.source.step);
      return step ? `${step.index}@${entry.source.visit}` : null;
    };
    const usedKeysOf = (items) => [...new Set(items.map((item) => {
      if (item.artifact) return artifactKey(item.artifact);
      return item.source ? `${item.source.step}@${item.source.visit}` : null;
    }).filter(Boolean))];
    // The results and artifacts that become stale (6.3): the seeds, and whatever used a stale key, by the recorded dependencies.
    // A stale result stays in the history; it is no answer any more, and a later failed or skipped visit does not bring it back.
    function invalidateFrom(seeds) {
      const stale = new Set(seeds);
      let grew = true;
      while (grew) {
        grew = false;
        Object.entries(state.dependencies).forEach(([consumer, used]) => {
          if (!stale.has(consumer) && used.some((key) => stale.has(key))) {
            stale.add(consumer);
            grew = true;
          }
        });
        registry.entries.forEach((entry) => {
          const key = artifactKey(entry);
          if (!stale.has(key) && stale.has(producerKey(entry))) {
            stale.add(key);
            grew = true;
          }
        });
      }
      results.forEach((entry) => { if (stale.has(resultKey(entry))) entry.valid = false; });
      Artifacts.markInvalid(registry, (entry) => stale.has(artifactKey(entry)));
    }

    // The value of a source of a rule route: its answer (or artifact) read as JSON at the pointer. No answer: found false.
    function readSourceOf(step, index, pointer) {
      const items = sourceItems([step.input[index]], step);
      if (!items.length) return { found: false };
      const json = Control.jsonValueOf(items[0].text);
      if (!json.ok) throw new StopRun('invalid_route_input', `шаг «${step.ref}», источник ${index}: ответ не читается как JSON`);
      return Output.readPointer(json.value, pointer);
    }
    const caseAction = (step, id) => (id === 'otherwise' ? step.select.otherwise : step.select.cases.find((item) => item.id === id).action);
    // The choice of a route (6.2). A rule decides by its conditions: none holds → otherwise (or route_not_found); several → conflict
    // (stop by default, first, or the owner among the matching cases). A model names a case; a failed answer goes to the owner.
    // The owner's null is a cancel (stopped); an absent or an invalid id is no_decision.
    // The owner's answer to an owner step (8.1): a text, or a reference to a file that the page stored. An empty or rejected
    // text is asked again with its reason; null (the dialog cancelled) stops the run. Only an accepted text is stored once and
    // its declared artifacts are registered; a binary file is kept as a reference (no text, no output check).
    const fileOf = (file) => ({ name: file.name, mime: file.mime, size: file.size, ref: file.ref });
    function ownerVerdict(step, reply) {
      const at = `шаг «${step.ref}» · ответ владельца`;
      const file = isPlain(reply) && isPlain(reply.file) ? reply.file : null;
      if (!file && typeof reply !== 'string') throw new EngineError('invalid_owner_result', at, 'ответ владельца: текст или объект файла');
      if (file) {
        if (!(text(file.name) && text(file.mime) && Number.isSafeInteger(file.size) && file.size >= 0 && text(file.ref))) {
          throw new EngineError('invalid_owner_result', at, 'файл: имя, MIME, размер и ссылка на сохранённое содержимое');
        }
        if (/^blob:/i.test(file.ref)) throw new EngineError('invalid_owner_result', at, 'blob: URL не хранит содержимое: сохраните файл и передайте его ссылку');
      }
      const binary = Boolean(file) && typeof file.text !== 'string';
      if (binary) {
        if (step.output) throw new EngineError('invalid_owner_result', at, 'двоичный файл не проверяется выходом шага: выход с разделами, полями или артефактами требует текст');
        return { ok: true, binary: true, file: fileOf(file) };
      }
      const value = text(file ? file.text : reply);
      if (!value) return { ok: false, reason: 'empty' };
      const shape = step.output ? Output.checkAnswer(value, step.output, { limit: runLimit }) : null;
      if (shape && !shape.ok) return { ok: false, reason: shape.reason, detail: shape.detail || '' };
      return { ok: true, text: value, ...(file ? { file: fileOf(file) } : {}) };
    }
    // An input item as the owner window gets it (N07): its address, its label, and its text or the reference of its file.
    const ownerItemOf = (item) => ({ label: item.label, ...item.address, ...(item.binary ? { file: item.file } : { text: item.text }) });
    async function ownerAnswer(step, entry) {
      let reason = '';
      let detail = '';
      // The input of the owner step is resolved before the window opens (N07): a missing required source stops the run here.
      const input = answersFor(step, step.input ?? 'none').map(ownerItemOf);
      for (;;) {
        await checkpointNow('decision', { pendingOwner: { kind: 'owner', stepRef: step.ref, visit: entry.visit } });
        const reply = await ownerWait(() => provideOwnerResult({ stepRef: step.ref, visit: entry.visit, task: step.task, output: step.output,
          ...(step.input !== 'none' ? { input } : {}), ...(reason ? { reason, detail } : {}) }));
        if (reply === null) throw new StopRun('stopped');
        const verdict = ownerVerdict(step, reply);
        if (!verdict.ok) {
          reason = verdict.reason;
          detail = verdict.detail || '';
          emit('custom_owner', { step: step.index, ref: step.ref, visit: entry.visit, accepted: false, reason });
          continue;
        }
        if (verdict.binary) {
          entry.owner = { binary: true, file: verdict.file, textRef: null, text: '' };
          await checkpointNow('judge', { pendingOwner: null });
          return entry.owner;
        }
        const textRef = putText(verdict.text);
        (step.output?.artifacts || []).forEach((declaration) => {
          Artifacts.register(registry, { id: declaration.id, name: declaration.name,
            lineage: { step: step.ref, participant: OWNER_PARTICIPANT, id: declaration.id },
            source: { step: step.ref, participant: OWNER_PARTICIPANT, visit: entry.visit }, answerRef: textRef, pointer: declaration.pointer, inputs: [] });
        });
        entry.owner = { text: verdict.text, textRef, ...(verdict.file ? { file: verdict.file } : {}) };
        emit('custom_owner', { step: step.index, ref: step.ref, visit: entry.visit, accepted: true, reason: null });
        await checkpointNow('judge', { pendingOwner: null });
        return entry.owner;
      }
    }

    async function routeChoice(step, entry) {
      const ownerChoice = async (choices, reason) => {
        const id = typeof chooseRoute === 'function'
          ? await (async () => {
            await checkpointNow('decision', { pendingOwner: { kind: 'route', stepRef: step.ref, visit: entry.visit } });
            const chosen = await ownerWait(() => chooseRoute({ stepRef: step.ref, visit: entry.visit, choices, reason }));
            await checkpointNow('decision', { pendingOwner: null });
            return chosen;
          })()
          : undefined;
        if (id === null) throw new StopRun('stopped');
        if (!choices.includes(id)) throw new StopRun('no_decision');
        return id;
      };
      if (step.select.by === 'owner') return { id: await ownerChoice(step.select.cases.map((item) => item.id), 'owner'), by: 'owner', reason: 'owner' };
      if (step.select.by === 'model') {
        if (!entry.outcome[step.models[0].id]) await execute(step, step.models, entry.outcome);
        const verdict = entry.outcome[step.models[0].id];
        if (verdict?.ok) return { id: verdict.route, by: 'model', reason: 'model' };
        return { id: await ownerChoice(step.select.cases.map((item) => item.id), 'invalid_route'), by: 'owner', reason: 'invalid_route' };
      }
      const matched = step.select.cases.filter((item) => Control.matches(item.when, (index, pointer) => readSourceOf(step, index, pointer)));
      if (!matched.length) {
        if (step.select.otherwise !== undefined) return { id: 'otherwise', by: 'rule', reason: 'otherwise' };
        throw new StopRun('route_not_found', step.ref);
      }
      if (matched.length === 1) return { id: matched[0].id, by: 'rule', reason: 'rule' };
      if (step.select.conflict === 'first') return { id: matched[0].id, by: 'rule', reason: 'conflict_first' };
      if (step.select.conflict === 'owner') return { id: await ownerChoice(matched.map((item) => item.id), 'conflict'), by: 'owner', reason: 'conflict_owner' };
      throw new StopRun('route_ambiguous', matched.map((item) => item.id).join(', '));
    }

    // The next position after a step: the next step, or the transition the step wrote (6.3, 6.4). A transition is taken only
    // while its limit allows it; a stop, a missing return point and a limit end the run with their reason.
    async function transit(pos, action, caseId, applied = null) {
      const step = plan[pos];
      if (!action) return pos + 1;
      // A transition that the reload found applied goes on to its saved target: its counter, feedback, validity and stack
      // are not applied a second time (8.3).
      if (applied) return plan.findIndex((item) => item.ref === applied.target);
      await checkpointNow('transition');
      const from = refKey(step);
      if ('stop' in action) {
        emit('custom_transition', { from: step.ref, case: caseId, action: 'stop', reason: action.stop });
        throw new StopRun(action.stop);
      }
      const frame = 'return' in action ? state.continuationStack[state.continuationStack.length - 1] : null;
      if ('return' in action && !frame) throw new StopRun('return_missing');
      const target = 'return' in action ? frame.resumeAt : action.goto;
      const to = plan.findIndex((item) => item.ref === target);
      const counter = `${from}:${caseId}`;
      let count = null;
      // A limit counts the transitions to an early or the current step; the check comes before the transition.
      if (to <= pos && 'maxLoops' in action) {
        const used = state.loopCounters[counter] || 0;
        if (used >= action.maxLoops) {
          emit('custom_transition', { from: step.ref, case: caseId, action: 'stop', reason: 'loop_limit', to: target, count: used, maxLoops: action.maxLoops });
          throw new StopRun('loop_limit', counter);
        }
        count = used + 1;
        state.loopCounters[counter] = count;
      }
      if ('return' in action) state.continuationStack.pop();
      else {
        // The feedback is resolved first, then the target and the steps the transition names are re-examined (6.3).
        if (action.feedback) state.feedback[target] = feedbackOf(action.feedback, plan[to]);
        const named = (action.invalidate || []).flatMap((ref) => results.filter((entry) => entry.step.ref === ref));
        invalidateFrom([...results.filter((entry) => entry.step.index === plan[to].index), ...named].map(resultKey));
        if (action.resumeAt) state.continuationStack.push({ resumeAt: action.resumeAt, from });
      }
      // The transition is applied: the state now says so, and a reload goes on from its target.
      await checkpointNow('transition', { applied: { target } });
      emit('custom_transition', { from: step.ref, case: caseId, action: 'return' in action ? 'return' : 'goto', to: target, count, maxLoops: action.maxLoops ?? null });
      return to;
    }

    // The step in progress: on Stop its accepted answers are kept like those of finished steps.
    let current = null;
    let pos = 0; // the pointer (pc): the position of the step the run is at
    let resumeAt = null; // the step that the saved state was in: its visit, phase, outcome, owner and route

    // Resume (8.3): the saved state is taken back as it was. The steps are the ones the caller gives (the saved schema);
    // the finished steps are not sent again, the accepted answers of the interrupted visit stay, the counters, the stack,
    // the feedback and the validity are restored, not reset. Texts come back through getText.
    const pointAt = (ref) => plan.findIndex((item) => item.ref === ref);
    const restoredText = (ref, where) => {
      const value = getText(ref);
      if (value === undefined || value === null) throw new EngineError('missing_content', where, `текст ответа «${ref}» не найден`);
      return value;
    };
    const restoredOutcome = (saved = {}) => Object.fromEntries(Object.entries(saved).map(([id, item]) => [id, {
      ...item, text: item.ok ? restoredText(item.textRef, `участник «${id}»`) : '' }]));
    const restoredOwner = (saved) => (saved.binary
      ? { binary: true, file: saved.file, textRef: null, text: '' }
      : { text: restoredText(saved.textRef, 'ответ владельца'), textRef: saved.textRef, ...(saved.file ? { file: saved.file } : {}) });
    // The texts of the feedback of an interrupted visit, as the visit took them.
    const feedbackFrom = (refs, key) => (refs || []).map((item) => ({
      label: item.label, text: contentOf(restoredText(item.textRef, `шаг «${key}» · feedback`), item.pointer ?? '', `шаг «${key}» · feedback`)
    }));
    function restoreRun(saved) {
      if (!isPlain(saved)) throw new EngineError('resume_invalid', 'resume', 'состояние для продолжения: объект снимка');
      ['visits', 'loopCounters', 'feedback', 'dependencies', 'decisions'].forEach((field) => { state[field] = isPlain(saved[field]) ? JSON.parse(JSON.stringify(saved[field])) : {}; });
      state.continuationStack = Array.isArray(saved.continuationStack) ? JSON.parse(JSON.stringify(saved.continuationStack)) : [];
      ownerAnswers.push(...(Array.isArray(saved.ownerAnswers) ? saved.ownerAnswers : []));
      // A list (an old snapshot) is no bindings: the chats are taken from the next reply of each participant.
      chatBindings = isPlain(saved.chatBindings) ? JSON.parse(JSON.stringify(saved.chatBindings)) : {};
      registry.entries.push(...(Array.isArray(saved.artifacts) ? saved.artifacts : []).map((entry) => ({ ...entry, lineage: { ...entry.lineage }, source: { ...entry.source }, content: { ...entry.content } })));
      (Array.isArray(saved.results) ? saved.results : []).forEach((item) => {
        const step = plan[pointAt(item.stepRef)];
        if (!step) throw new EngineError('resume_mismatch', `шаг «${item.stepRef}»`, 'шага сохранённого состояния нет в схеме продолжения');
        const entry = { step, visit: item.visit, outcome: restoredOutcome(item.outcome), skipped: Boolean(item.skipped), valid: item.valid !== false };
        if (item.route) entry.route = item.route;
        if (item.owner) entry.owner = restoredOwner(item.owner);
        results.push(entry);
      });
      const at = saved.pc == null ? -1 : pointAt(saved.pc);
      if (saved.pc != null && at < 0) throw new EngineError('resume_mismatch', `шаг «${saved.pc}»`, 'шага сохранённого состояния нет в схеме продолжения');
      pos = at < 0 ? plan.length : at;
      const cur = saved.current;
      if (cur && cur.active && at >= 0 && cur.stepRef === saved.pc) {
        resumeAt = { index: at, visit: cur.visit, phase: cur.phase, pending: Array.isArray(cur.pending) ? cur.pending : [], outcome: restoredOutcome(cur.outcome),
          feedback: Array.isArray(cur.feedback) ? cur.feedback : [], valid: cur.valid !== false,
          owner: cur.owner ? restoredOwner(cur.owner) : null, route: cur.route || null, applied: cur.applied || null };
      }
    }
    // A request that may have been sent before the reload has no known answer: the owner decides, and the request is never
    // sent again on its own. The accepted answers of the visit stay. Resend is a new attempt; skip is recorded for it only.
    async function settleUnknown(step, entry, pending = []) {
      const items = pending.filter((item) => !entry.outcome[item.participantId]?.ok);
      if (!items.length) return;
      // Until the owner decides, the requests stay in flight: a Stop keeps them unknown in the saved state.
      inFlight = items.map((item) => ({ participantId: item.participantId, attempt: item.attempt, phase: 'answer', stepRef: step.ref, visit: entry.visit }));
      await checkpointNow('decision', { pendingOwner: { kind: 'unknown', stepRef: step.ref, visit: entry.visit } });
      const choice = typeof resolveUnknown === 'function'
        ? await ownerWait(() => resolveUnknown({ stepRef: step.ref, visit: entry.visit, items: items.map((item) => ({ participantId: item.participantId, attempt: item.attempt })), choices: ['resend', 'skip'] }))
        : undefined;
      if (choice === null) throw new StopRun('stopped');
      if (!['resend', 'skip'].includes(choice)) throw new StopRun('no_decision', `шаг «${step.ref}»: нет решения о неизвестном ответе (отправить заново или пропустить)`);
      inFlight = [];
      await checkpointNow('decision', { pendingOwner: null });
      const models = step.models.filter((model) => items.some((item) => item.participantId === model.id));
      models.forEach((model) => {
        const item = items.find((candidate) => candidate.participantId === model.id);
        entry.outcome[model.id] = { ok: false, reason: choice === 'skip' ? 'skipped' : 'unknown', text: '', model: model.name, participant: model.id, attempt: item.attempt || 0, status: '', transportRequestId: '' };
      });
      if (choice === 'resend') await execute(step, models, entry.outcome, Math.max(...items.map((item) => item.attempt || 0)) + 1);
    }

    try {
      if (resume) restoreRun(resume);
      while (pos < plan.length) {
        const step = plan[pos];
        const key = refKey(step);
        const resumed = resumeAt && resumeAt.index === pos ? resumeAt : null;
        resumeAt = null;
        if (resumed) {
          // The visit goes on: it is not a new execution, so its visit number and its feedback are kept.
          activeVisit = resumed.visit;
          activeFeedback = feedbackFrom(resumed.feedback, key);
          activeFeedbackRefs = resumed.feedback.slice();
        } else {
          // Every input of the step is resolved before its first request: a missing required one sends nothing, and
          // a revision whose source an author did not get stops the step (its line would be unknown).
          step.models.forEach((model) => {
            const items = inputFor(step, specOf(step, model), { model });
            (outputOf(step, model)?.artifacts || []).forEach((declaration) => {
              if (declaration.revisionOf && !revisionItem(declaration, items)) {
                throw new StopRun('missing_input', `ревизия «${declaration.id}»: участник «${model.id}» не получил версию, которую она дорабатывает; шаг «${step.ref}» не отправлен`);
              }
            });
          });
          // A new execution of the step is a new visit; a technical retry is not. The feedback of a return is given to this visit.
          state.visits[key] = (state.visits[key] || 0) + 1;
          activeVisit = state.visits[key];
          activeFeedback = takeFeedback(key);
          // What this visit uses (the results and artifacts it took) is recorded: a later stale key makes the visit stale (6.3).
          // The owner's answer is built on its input too: a change of that input makes the answer stale (N07, 6.3).
          state.dependencies[`${step.index}@${activeVisit}`] = usedKeysOf(step.kind === 'owner' ? answersFor(step, step.input ?? 'none')
            : (step.models.length ? step.models.flatMap((model) => inputFor(step, specOf(step, model), { model })) : inputFor(step, step.input ?? 'none')));
        }
        const decidedKey = `${key}@${activeVisit}`;
        const outcome = resumed ? resumed.outcome : {};
        const entry = { step, visit: activeVisit, outcome, skipped: false, valid: resumed ? resumed.valid : true };
        if (resumed?.owner) entry.owner = resumed.owner;
        if (resumed?.route) entry.route = resumed.route;
        // A transition that the reload found applied goes on to its saved target: nothing is applied twice (8.3).
        const applied = resumed?.applied ?? null;
        current = entry;
        if (step.kind === 'route') {
          // A route sends nothing by itself: the rule decides, a model or the owner names the case. Its answer is not an answer of the step.
          if (resumed && !entry.route) await settleUnknown(step, entry, resumed.pending);
          if (!entry.route) {
            const choice = await routeChoice(step, entry);
            entry.route = { id: choice.id, by: choice.by, reason: choice.reason };
            emit('custom_route', { step: step.index, ref: step.ref, visit: entry.visit, case: choice.id, by: choice.by, reason: choice.reason });
          }
          results.push(entry);
          pos = await transit(pos, caseAction(step, entry.route.id), entry.route.id, applied);
          current = null;
          continue;
        }
        if (step.kind === 'owner') {
          // The owner's answer is asked until it is accepted; an accepted one (also one found after a reload) is not asked again.
          if (!entry.owner) await ownerAnswer(step, entry);
          results.push(entry);
          pos = await transit(pos, null, null, applied);
          current = null;
          continue;
        }
        if (resumed) await settleUnknown(step, entry, resumed.pending);
        // The participants that were never sent (a reload in the middle of a step) are sent now; a sent one is not sent again.
        const never = step.models.filter((model) => !outcome[model.id]);
        if (never.length) await execute(step, never, outcome);
        const last = step === plan[plan.length - 1];
        // A visit whose decision is saved, or that has passed its decision (asks, transition), is not asked again.
        const decided = Boolean(resumed) && (resumed.phase === 'asks' || resumed.phase === 'transition' || state.decisions[decidedKey] !== undefined);
        if (decided) entry.skipped = state.decisions[decidedKey] === 'skip';
        if (!decided) {
          for (;;) {
            const accepted = step.models.filter((model) => outcome[model.id]?.ok).map((model) => model.id);
            const failed = step.models.filter((model) => !outcome[model.id]?.ok).map((model) => model.id);
            const required = neededOf(step);
            const enough = accepted.length >= required;
            // An owner approval (owner: approve) is asked after the step in every mode, also on the last step.
            const approve = step.approve === true;
            emit('custom_step', { step: step.index, label: stepLabel(step), accepted: accepted.length, failed: failed.length, required, approve });
            // A failing gate with enough answers goes to its verdict below, not to the pause of a step.
            if (step.kind === 'gate' && enough && !gatePass(step, outcome)) break;
            if (enough && !semiAuto && !approve) break;
            if (enough && semiAuto && last && !failed.length && !approve) break;
            // Below the threshold "continue" is not offered: the owner repeats, skips or stops the step.
            const choices = enough ? ['continue', ...(failed.length ? ['retry'] : []), 'stop'] : ['retry', 'skip', 'stop'];
            if (typeof decide === 'function') await checkpointNow('decision', { pendingOwner: { kind: 'decision', stepRef: step.ref, visit: entry.visit } });
            const action = typeof decide === 'function'
              ? await ownerWait(() => decide({ step: step.index, label: stepLabel(step), accepted, failed, choices, last, required, approve,
                reasons: Object.fromEntries(failed.map((id) => [id, outcome[id]?.reason || ''])) }))
              : null;
            // The fallback "an accepted answer goes on" holds only when the threshold is met and no approval is asked.
            if (!choices.includes(action)) { if (enough && !approve) break; throw new StopRun('no_decision'); }
            // A decision that ends the step is saved before the checkpoint: a reload does not ask it again.
            if (action === 'continue' || action === 'skip') state.decisions[decidedKey] = action;
            if (typeof decide === 'function') await checkpointNow('decision', { pendingOwner: null });
            emit('custom_decision', { step: step.index, action });
            if (action === 'continue') break;
            if (action === 'stop') throw new StopRun('stopped');
            if (action === 'skip') { entry.skipped = true; break; }
            const firstAttempt = Math.max(0, ...failed.map((id) => outcome[id]?.attempt || 0)) + 1;
            await execute(step, step.models.filter((model) => failed.includes(model.id)), outcome, firstAttempt);
          }
        }
        // The verdict of a gate (6.1): a pass takes onPass; a fail takes onFail (a transition), or stops the run (stop), or the
        // owner decides (ask). A skipped gate fails. The step's transition is then taken by transit().
        let action = null;
        let caseId = null;
        if (step.kind === 'gate') {
          const pass = gatePass(step, outcome, entry.skipped);
          const unmet = [...new Set(step.models.filter((model) => outcome[model.id]?.verdict === 'fail').flatMap((model) => outcome[model.id].unmet || []))];
          emit('custom_gate', { step: step.index, ref: step.ref, pass, unmet, rule: step.pass });
          if (pass) {
            action = step.onPass ?? null;
            caseId = 'onPass';
          } else {
            caseId = 'onFail';
            if (isPlain(step.onFail)) action = step.onFail;
            else if (step.onFail !== 'ask') throw new StopRun('gate_failed', unmet.join('; ') || (entry.skipped ? 'шаг пропущен владельцем' : 'недостаточно ответов проверяющих'));
            else {
              // The decision of a failed gate is saved like the decision of a step: a reload does not ask it again.
              const gateKey = `${decidedKey}:gate`;
              let decision = state.decisions[gateKey];
              if (decision === undefined) {
                const accepted = step.models.filter((model) => outcome[model.id]?.ok).map((model) => model.id);
                const failed = step.models.filter((model) => !outcome[model.id]?.ok).map((model) => model.id);
                if (typeof decide === 'function') await checkpointNow('decision', { pendingOwner: { kind: 'decision', stepRef: step.ref, visit: entry.visit } });
                decision = typeof decide === 'function'
                  ? await ownerWait(() => decide({ step: step.index, label: stepLabel(step), accepted, failed, choices: ['continue', 'stop'], last: step === plan[plan.length - 1],
                    required: neededOf(step), approve: false, reasons: {}, unmet }))
                  : null;
                if (!['continue', 'stop'].includes(decision)) throw new StopRun('no_decision');
                state.decisions[gateKey] = decision;
                if (typeof decide === 'function') await checkpointNow('decision', { pendingOwner: null });
              }
              emit('custom_decision', { step: step.index, action: decision });
              if (decision === 'stop') throw new StopRun('stopped');
            }
          }
        }
        results.push(entry);
        if (typeof parseAsks === 'function' && typeof askOwner === 'function' && !entry.skipped) {
          const asks = acceptedOf(entry).flatMap((item) => parseAsks(item.text) || []);
          if (asks.length) {
            await checkpointNow('asks', { pendingOwner: { kind: 'asks', stepRef: step.ref, visit: entry.visit } });
            ownerAnswers.push(...((await ownerWait(() => askOwner(asks, { step: step.index, label: stepLabel(step) }))) || []));
            await checkpointNow('asks', { pendingOwner: null });
          }
        }
        pos = await transit(pos, action, caseId, applied);
        current = null;
      }
    } catch (error) {
      if (!(error instanceof StopRun)) throw error;
      stopReason = error.stopReason;
      stopDetail = error.stopDetail || '';
      // The step in progress keeps its accepted answers (and its route or owner answer) when it was not kept yet.
      if (current && !results.includes(current) && (acceptedOf(current).length || current.route || current.owner)) results.push(current);
    }

    if (aborted() && stopReason === 'steps_done') stopReason = 'cancelled';
    await checkpointNow('done');
    emit('custom_end', { stopReason, stopDetail, steps: results.length });
    return {
      steps: results.map((entry) => ({ index: entry.step.index, ref: entry.step.ref, kind: entry.step.kind, label: stepLabel(entry.step), visit: entry.visit, valid: entry.valid, skipped: entry.skipped, outcome: entry.outcome, ...(entry.route ? { route: entry.route } : {}), ...(entry.owner?.file ? { file: entry.owner.file } : {}) })),
      // The state of the run as plain data (ТЗ 7): the pointer, the visits, the counters, the stack and the feedback.
      state: liveState('done'),
      answers: inputFor({ input: 'previous' }, 'previous', { strict: false }).map((item) => item.text),
      history, ownerAnswers, stopReason, stopDetail, checkpointed: typeof checkpoint === 'function',
      artifacts: registry.entries.map((entry) => ({ ...entry, lineage: { ...entry.lineage }, source: { ...entry.source }, content: { ...entry.content } })),
      texts: Object.fromEntries(texts)
    };
  }

  // Before a run there is no exact prompt yet: the template shows what is known and marks the data
  // that will come from other models. Transport instructions are edited separately from the main request.
  const PLACEHOLDER = Object.freeze({
    previous: '‹ответы предыдущего шага появятся при запуске›',
    sources: '‹ответы выбранных этапов появятся при запуске›',
    all: '‹все принятые ответы предыдущих шагов появятся при запуске›',
    earlier: '‹ответы моделей, работающих до тебя в этом раунде, появятся при запуске›'
  });
  const TRANSPORT_LINES = Object.freeze([
    'Предел длины ответа — по настройке модели или pipeline.',
    'Метка доставки создаётся транспортом; инструкцию можно изменить у модели.'
  ]);
  function previewPrompt({ task, steps = [], stepIndex = 0, modelName = '', semiAuto = false, askInstruction = '' }) {
    const plan = normalizeSteps(steps);
    const step = plan.find((item) => item.index === stepIndex) || plan[stepIndex];
    if (!step) return null;
    // A step the run would refuse, and a route (it sends nothing by itself), have no prompt to show.
    if (unexecutedOf(steps[stepIndex], stepIndex) || step.kind === 'route' || step.kind === 'owner') return null;
    const model = step.models.find((item) => item.name === modelName) || { name: modelName, extra: '' };
    const spec = specOf(step, model);
    const input = spec === 'none' || !plan.some((item) => item.index < step.index) ? []
      : [{ label: 'Вход', text: PLACEHOLDER[modeOf(spec)] || PLACEHOLDER.previous }];
    const position = step.models.findIndex((item) => item.name === model.name);
    const earlier = step.order === 'sequential' && position > 0 ? [{ text: PLACEHOLDER.earlier }] : [];
    const prompt = buildPrompt({ task, step, model, input, inputMode: modeOf(spec), earlier, ownerAnswers: [],
      askInstruction: semiAuto ? askInstruction : '', output: outputOf(step, model) });
    const template = typeof model.promptTemplate === 'string' && model.promptTemplate.trim() ? model.promptTemplate
      : buildPrompt({ task: '{задача}', step, model, input: input.length ? [{ label: 'Вход', text: '{вход}' }] : [],
        inputMode: modeOf(spec), earlier: earlier.length ? [{ text: '{ответы до тебя}' }] : [], output: outputOf(step, model) });
    return { label: stepLabel(step), order: step.order, inputMode: modeOf(spec), prompt, template, transportLines: TRANSPORT_LINES.slice(),
      instructions: { task: text(task), stepTask: model.task ?? step.task, extra: model.extra || '', askInstruction: semiAuto ? askInstruction : '' } };
  }

  const api = Object.freeze({ EngineError, unexecutedOf, formatBlock, DEFAULT_ATTEMPTS, CORRECTION_TEMPLATE, SYNTHESIS_TASK, STOP_TEXT, REASON_TEXT, resolveSetting, PLACEHOLDER, TRANSPORT_LINES, buildPrompt, correctionPrompt, normalizeSteps, previewPrompt, run });
  root.CustomEngine = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
