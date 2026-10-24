// Custom engine: the shared pipeline workhorse. A run is one sequence of steps; the canvas shows
// them as round cards, the engine knows only steps. Meaning (answer, critique, improvement, check,
// synthesis) comes from the step's task and the models' roles; the engine executes and passes data.
// A synthesis is a round of one model with a role; the accepted answers of the last step are the result.
//
// Step: { kind: 'round' | 'owner', task, input, models, ref?, round? }
//   ref and round (the number of a round) come from the schema, so a switched-off round keeps its number
//   in labels, previews and the journal; without them the engine counts the steps it gets.
//   models: [{ id, name, extra, promptTemplate, maxWords, input? }] — card order is call order. A participant is its id
//   (the id is the name by default); two participants of one model are two entries with two ids.
//   promptTemplate replaces automatic assembly; maxWords reaches the caller on every attempt.
//   input: 'none' | 'previous' | 'all' | [sources]. The run's task is always sent. A participant's own input replaces
//          the shared one of the step.
//     previous — accepted answers of the last step that has any (a skipped step passes nothing on);
//     all      — every accepted answer of all earlier steps;
//     [sources] — a step ref (all its accepted answers), { step, participant, required? } (one answer);
//                a required source without an answer stops the run before the request (missing_input).
//   A round sends its request to all its models at once; they answer independently and the round waits for all of them.
//   A relay is rounds of one model in a row: the next round gets the answer of the previous one through its input.
// Transport: sendParticipants(requests, meta) → { byParticipant: { [participantId]: reply }, closedByOwner } when the
//   page gives it (requests: { participantId, modelName, prompt, chat, stepRef, visit, attempt }); otherwise the legacy
//   send(models, promptsByModel, meta) → { byModel: { [model]: reply }, closedByOwner }, which needs unique model names
//   in a step. A reply is { text, status, completion, answered, transportRequestId, sentPrompt, attribution }.
//   outcome is keyed by participant id. accept() judges the technical outcome; empty text (also a token-only
//   answer) is never accepted. A rejected answer gets a correction retry in the same chat, up to maxAttempts,
//   unless the owner closed the step. Only the participants that were not accepted are sent again.
// Output (basic-output.js): an answer is checked after the technical acceptance by the step's output (length, sections,
//   JSON fields, artifacts); a rejected participant is corrected with the reason and its detail. runStrictLength (run.strictLength)
//   gives the length check to every step whose output does not set output.strictLength itself.
// A step is complete when every participant has an accepted answer. Owner approval (owner: approve)
//   asks the owner after the step in every mode. Artifacts (basic-artifacts.js): an accepted answer is stored once
//   (putText) and its declared artifacts are registered; a source { artifact, version } gives only that content.
// Pointer: the run is at a position of the plan and only moves forward, step after step: there are no branches and no
//   transitions. A check is an ordinary round (its criteria are in the task); a decision is the owner's step (kind: owner).
// Transition: decide(problem) → 'continue' | 'retry' | 'skip' | 'stop'. Asked after every step in semi-automatic
//   mode, in Auto when a participant has no accepted answer, and after every step with approval. 'continue' is never
//   offered while a participant has no accepted answer. A prompt over maxPromptChars stops the run before sending.
// Owner (kind: owner, 8.1): the owner gives a text or a file through provideOwnerResult; no model is asked. A text goes through
// the step's output check and its declared artifacts; a binary file is kept as a reference and never given to a model as text.
// Stop keeps what was collected. [[ASK: …]] lines of accepted answers go to askOwner; the answers
// reach the prompts of the following steps.
(function initCustomEngine(root) {
  'use strict';

  const Output = root.BasicOutput || (typeof require === 'function' ? require('./basic-output') : null);
  const Artifacts = root.BasicArtifacts || (typeof require === 'function' ? require('./basic-artifacts') : null);
  const DEFAULT_ATTEMPTS = 2;
  const REASON_TEXT = Object.freeze({
    empty: 'пустой',
    token_only: 'без текста',
    too_short: 'слишком короткий',
    truncation_marker: 'оборван',
    incomplete_ending: 'оборван на середине',
    error_output: 'ошибка вместо ответа',
    closed_by_owner: 'раунд закрыт User',
    too_long: 'длиннее допустимого',
    missing_section: 'не содержит раздел',
    invalid_output: 'не в формате ответа',
    invalid_form: 'опросник не по формату',
    missing_field: 'без обязательного поля',
    missing_artifact: 'без объявленного артефакта'
  });
  const STOP_TEXT = Object.freeze({
    steps_done: 'все шаги пройдены',
    context_full: 'промпт не помещается в бюджет',
    stopped: 'остановлено User',
    cancelled: 'остановлено пользователем',
    no_decision: 'нет принятых ответов, решение User не получено',
    missing_input: 'обязательный вход не получен, запрос не отправлен',
    unsupported_input: 'двоичный файл не передаётся тексту модели; шаг не отправлен'
  });
  const text = (value) => String(value == null ? '' : value).trim();
  // The key of a step in the state of the run: its ref, or its position in the schema for a step without a ref.
  const refKey = (step) => step.ref ?? `#${step.index}`;
  const stepLabel = (step) => {
    if (step.kind === 'owner') return `User ${step.ref}`;
    return `Раунд ${step.round}`;
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
  const askOf = (model, askInstruction) => (askInstruction && typeof model.discipline?.ask === 'string' ? model.discipline.ask : askInstruction);

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
      if (output.document === 'form') lines.push('Это опросник для User: {"items":[{"id":"уникальный id","type":"one|many|text|yesno","question":"вопрос","options":["вариант"],"required":true}]}. options — только для one и many, обязателен непустой список; required необязателен.');
      if (Array.isArray(output.requiredFields) && output.requiredFields.length) lines.push(`Обязательные поля: ${output.requiredFields.join(', ')}.`);
    }
    if (Array.isArray(output.sections) && output.sections.length) lines.push(`Разделы ответа: ${output.sections.map((item) => `«${item}»`).join(', ')}.`);
    return lines.length ? `Формат ответа:\n${lines.join('\n')}` : '';
  }

  function buildPrompt({ task, step, model, input = [], inputMode = 'none', ownerAnswers = [], askInstruction = '', output = null }) {
    askInstruction = askOf(model, askInstruction);
    if (typeof model.promptTemplate === 'string' && model.promptTemplate.trim()) {
      // One pass: placeholders occurring inside model answers remain data, never instructions.
      const values = { '{задача}': text(task), '{вход}': inputMode === 'all' || inputMode === 'sources' ? labelled(input) : numbered(input) };
      const parts = [model.promptTemplate.replace(/\{задача\}|\{вход\}/g, (key) => values[key])];
      if (formatBlock(output)) parts.push(formatBlock(output));
      if (ownerAnswers.length) parts.push(`Ответы User на вопросы:\n${ownerAnswers.map((item) => `- ${item.question}: ${item.answer}`).join('\n')}`);
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
    const taskInstruction = model.task ?? step.task;
    if (text(taskInstruction)) parts.push(`Задание:\n${text(taskInstruction)}`);
    if (formatBlock(output)) parts.push(formatBlock(output));
    if (text(model.extra)) parts.push(`Дополнительно для тебя:\n${text(model.extra)}`);
    if (ownerAnswers.length) parts.push(`Ответы User на вопросы:\n${ownerAnswers.map((item) => `- ${item.question}: ${item.answer}`).join('\n')}`);
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
    return { ok: true, reason: '', text: value };
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

  // Numbers the rounds for labels by their card.
  function normalizeSteps(steps = []) {
    let round = 0;
    return steps.map((step, index) => {
      const kind = step.kind === 'owner' ? 'owner' : 'round';
      // A switched-off round keeps its number: the schema gives the number, the engine only counts without it.
      if (kind === 'round') round = Number.isSafeInteger(step.round) && step.round > 0 ? step.round : round + 1;
      return {
        index, ref: typeof step.ref === 'string' ? step.ref : null, kind, round: kind === 'round' ? round : null,
        task: text(step.task),
        // A list of sources stays a list here: the input is checked before the run (assertExecutable).
        input: Array.isArray(step.input) ? step.input.slice() : (step.input ?? (kind === 'owner' ? 'none' : 'previous')),
        output: step.output ?? null,
        document: kind === 'owner' && typeof step.document === 'string' && step.document ? step.document : null,
        // continue: the participant keeps its chat; new: a new chat on the first request of each visit (4.2).
        chat: step.chat === 'new' ? 'new' : 'continue',
        approve: step.owner === 'approve',
        models: (step.models || []).map((model) => (typeof model === 'string' ? { name: model, id: model, extra: '' } : {
          name: model.name, id: model.id ?? model.name, extra: text(model.extra), task: typeof model.task === 'string' ? model.task : null, promptTemplate: typeof model.promptTemplate === 'string' ? model.promptTemplate : null,
          discipline: model.discipline ? { ...model.discipline } : null,
          maxWords: Number.isSafeInteger(model.maxWords) && model.maxWords > 0 ? model.maxWords : null,
          ...(model.input !== undefined ? { input: Array.isArray(model.input) ? model.input.slice() : model.input } : {}),
          ...(model.output !== undefined ? { output: JSON.parse(JSON.stringify(model.output)) } : {})
        }))
          .filter((model) => model.name)
      };
    }).filter((step) => step.models.length || step.kind === 'owner');
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

  const EXECUTED_KINDS = Object.freeze(['round', 'owner']);
  // The participant that an owner step's answer and artifacts are registered under: the owner has no model (8.1).
  const OWNER_PARTICIPANT = 'owner';
  const INPUT_VALUES = Object.freeze(['none', 'previous', 'all']);
  // An input (of a step or of a participant) that the engine cannot execute, or null. `fail` builds the error with its address.
  function inputProblem(spec, fail, field) {
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
    if (!INPUT_VALUES.includes(spec)) return fail('invalid_input', field, 'вход: none, previous, all или список источников');
    return null;
  }
  // The output of a step or of a participant (5.8, 3.2): the fields the engine executes, or null. `field` names it in the error.
  function outputProblem(output, fail, field) {
    if (!output || typeof output !== 'object' || Array.isArray(output)) return fail('invalid_field', field, 'выход: объект');
    if (output.format !== undefined && output.format !== 'json') return fail('unsupported_field', `${field}.format`, 'формат выхода движок пока не исполняет');
    if (output.artifacts !== undefined && (!Array.isArray(output.artifacts) || !output.artifacts.length)) return fail('invalid_field', `${field}.artifacts`, 'ожидается непустой список артефактов');
    if (Array.isArray(output.artifacts)) {
      for (const [at, item] of output.artifacts.entries()) {
        if (!item || typeof item !== 'object' || !('revisionOf' in item)) continue;
        const where = `${field}.artifacts[${at}].revisionOf`;
        if (!isPlain(item.revisionOf) || !isPlain(item.revisionOf.artifact)) return fail('invalid_input', where, 'ревизия: ссылка на артефакт { artifact: { step, participant, id }, version }');
        const problem = inputProblem([item.revisionOf], fail, where);
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
      if (!text(step.task)) return fail('invalid_field', 'task', 'задание User: непустой текст');
      if (Array.isArray(step.models) && step.models.length) return fail('invalid_field', 'models', 'у User нет моделей');
    }
    if (step.input !== undefined) {
      const problem = inputProblem(step.input, fail, 'input');
      if (problem) return problem;
    }
    if (step.output !== undefined) {
      const problem = outputProblem(step.output, fail, 'output');
      if (problem) return problem;
    }
    if (step.owner !== undefined && step.owner !== 'approve') return fail('invalid_field', 'owner', 'owner: только approve');
    if (step.chat !== undefined && step.chat !== 'continue' && step.chat !== 'new') return fail('unsupported_field', 'chat', 'чат: continue или new');
    const ids = new Set();
    const names = new Set();
    for (const model of Array.isArray(step.models) ? step.models : []) {
      const name = typeof model === 'string' ? model : model?.name;
      const id = typeof model === 'string' ? model : (model?.id ?? name);
      if (model && typeof model === 'object' && model.input !== undefined) {
        const problem = inputProblem(model.input, fail, `модель «${name}» · input`);
        if (problem) return problem;
      }
      if (model && typeof model === 'object' && model.output !== undefined) {
        const problem = outputProblem(model.output, fail, `модель «${name}» · output`);
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
      // The owner is the author of its step's output (3.3): its input is its input.
      (step.kind === 'owner' ? [null] : (Array.isArray(step.models) ? step.models : [])).forEach((model) => {
        (outputOf(step, model)?.artifacts || []).forEach((declaration) => {
          if (!declaration || !isPlain(declaration.revisionOf)) return;
          const want = declaration.revisionOf.artifact;
          const spec = model && typeof model === 'object' && model.input !== undefined ? model.input : step.input;
          const given = Array.isArray(spec) && spec.some((source) => isPlain(source) && isPlain(source.artifact)
            && source.artifact.step === want.step && source.artifact.participant === want.participant && source.artifact.id === want.id);
          if (!given) {
            const name = model === null ? OWNER_PARTICIPANT : (typeof model === 'string' ? model : model?.name);
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

  async function run({
    task, steps = [], maxAttempts = DEFAULT_ATTEMPTS, semiAuto = false, maxPromptChars = Infinity,
    accept = defaultAccept, parseAsks = null, askOwner = null, askInstruction = '', decide = null,
    send = null, sendParticipants = null, runMaxWords = null, runStrictLength = false, putText: putCallback = null, getText: getCallback = null, provideOwnerResult = null,
    checkpoint = null, resolveUnknown = null, checkUnknown = null, resume = null,
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
    // The length check (run.strictLength, 5.8): the output.strictLength of the step or participant wins, true or false;
    // without it the run's flag applies. checkedOutput gives the output to check with that length (null when nothing is checked).
    const strictLengthOf = (output) => output?.strictLength ?? (runStrictLength === true);
    const checkedOutput = (output) => {
      const strictLength = strictLengthOf(output);
      if (!output) return strictLength ? { strictLength } : null;
      return output.strictLength === strictLength ? output : { ...output, strictLength };
    };
    // The check of an answer of one participant by the output of its step, or null when there is nothing to check.
    const checkFor = (step, model) => {
      const limit = model.maxWords ?? runLimit;
      const output = checkedOutput(outputOf(step, model));
      return output ? (value) => Output.checkAnswer(value, output, { limit }) : null;
    };
    if (!Output || !Artifacts) throw new Error('basic_modules_missing: загружены не все модули Basic (basic-output.js, basic-artifacts.js)');
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
    if (plan.some((step) => step.kind === 'owner') && typeof provideOwnerResult !== 'function') {
      throw new Error('provide_owner_required: шагу User нужен callback provideOwnerResult (вопрос User)');
    }
    const ownerAnswers = [];
    const history = []; // every request: step, model, participant, attempt, prompt, outcome
    const results = []; // per step: { step, outcome: { participantId: verdict }, skipped }
    let stopReason = 'steps_done';
    // The state of the run (ТЗ 7): plain data. The visit of a step is the number of its executions (the run only moves forward, so 1).
    const state = { visits: {}, decisions: {} };
    let activeVisit = 1;
    // Answers found by the read-only check of an unconfirmed request (N04): participant id → a reply. The next attempt of that
    // participant takes the reply instead of sending, and it goes through the same acceptance as any reply.
    let prefetched = null;
    let inFlight = []; // the participants whose request is being sent now: unknown after a reload until their answer is judged
    let chatBindings = {}; // participantId → { modelName, stepRef, visit, transportRequestId }: the chat of each participant (kept on resume)
    let openOwner = null; // the owner interaction that is open now (a decision, an owner step, an ASK): kept on a stop
    let stopDetail = '';
    // The plan as the run sees it: a report shows what was intended, not only what happened.
    emit('custom_start', { semiAuto: Boolean(semiAuto), maxAttempts, taskChars: text(task).length,
      steps: plan.map((step) => ({ step: step.index, ref: step.ref, label: stepLabel(step), input: modeOf(step.input), models: step.models.map((model) => model.name) })) });

    class StopRun extends Error { constructor(reason, detail = '') { super(reason); this.stopReason = reason; this.stopDetail = detail; } }

    // The live state for a checkpoint (8.2): plain data only. The pointer is the step in progress (or the next one between steps);
    // a pending owner interaction and the pending participants of a send are named, so a reload can show them.
    // The step in progress keeps its visit, phase, accepted answers, the participants in flight and the owner answer.
    const compactOutcome = (outcome) => Object.fromEntries(Object.entries(outcome || {}).map(([id, item]) => { const { text, ...rest } = item; return [id, rest]; }));
    const ownerOf = (owner) => ({ textRef: owner.textRef ?? null, binary: Boolean(owner.binary), file: owner.file ?? null });
    const savedEntry = (item) => ({ stepRef: item.step.ref, index: item.step.index, visit: item.visit, valid: item.valid !== false, skipped: Boolean(item.skipped),
      outcome: compactOutcome(item.outcome), ...(item.owner ? { owner: ownerOf(item.owner) } : {}) });
    function liveState(phase, extra = {}) {
      const step = plan[pos];
      const outcomeNow = current?.outcome || {};
      const finished = results.filter((item) => item !== current);
      return JSON.parse(JSON.stringify({
        pc: step ? step.ref : null, visits: state.visits, decisions: state.decisions,
        // `active` is true while a step is in progress; between steps the current position is the next step, not started.
        current: current && step ? { active: true, stepRef: step.ref, visit: activeVisit, phase, valid: current.valid !== false,
          accepted: Object.keys(outcomeNow).filter((id) => outcomeNow[id]?.ok), pending: extra.pending ?? inFlight,
          outcome: compactOutcome(outcomeNow),
          owner: current.owner ? ownerOf(current.owner) : null }
          : { active: false, stepRef: step ? step.ref : null, visit: step ? (state.visits[refKey(step)] || 0) : 0, phase, valid: true,
            accepted: [], pending: [], outcome: {}, owner: null },
        results: finished.map(savedEntry),
        ownerAnswers, artifacts: registry.entries, pendingOwner: openOwner, chatBindings
      }));
    }
    // The checkpoint (8.2) is awaited before the next external action. A failed save is not swallowed: the run stops with
    // checkpoint_failed, so no request follows it. Without a callback the run is autonomous and saves nothing.
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
    const acceptedOf = (entry) => {
      if (!entry || entry.skipped || entry.valid === false) return [];
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
      // The author is a model, or the owner of an owner step (V05): both may start from the last valid version of the line they revise.
      const base = (Boolean(model) || step.kind === 'owner') && revisesLine(step, model, Artifacts.lineKey(lineage));
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
          // A step is kept only with the answers of all its participants (a skipped one gives none), so a required source needs one (3.1).
          if (!answers.length) throw stopped('не дал принятого ответа');
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
    // Instructions (owner-editable behaviour) and input (data from other models) are kept apart.
    function partsFor(step, model, input, spec) {
      return {
        instructions: { task: text(task), stepTask: model.task ?? step.task, extra: model.extra || '', askInstruction: askOf(model, semiAuto ? askInstruction : ''),
          ownerAnswers: ownerAnswers.slice() },
        input: { mode: modeOf(spec), items: input }
      };
    }

    function promptFor(step, model) {
      const spec = specOf(step, model);
      const input = inputFor(step, spec, { model });
      const prompt = buildPrompt({ task, step, model, input, inputMode: modeOf(spec),
        ownerAnswers, askInstruction: semiAuto ? askInstruction : '', output: outputOf(step, model) });
      if (prompt.length > maxPromptChars) throw new StopRun('context_full');
      return { prompt, parts: partsFor(step, model, input, spec) };
    }

    // Sends the participants with their prompts, then corrections; fills `outcome` by participant id. Every attempt
    // is a history entry of its own: a retry never rewrites the attempt it follows, it refers to it.
    async function attempt(step, models, requests, outcome, firstAttempt = 1) {
      const phase = 'answer';
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
          const found = prefetched ? Object.fromEntries(pending.filter((model) => prefetched[model.id]).map((model) => [model.id, prefetched[model.id]])) : {};
          if (pending.length && pending.every((model) => found[model.id])) {
            byId = found;
            reply = {};
            pending.forEach((model) => { delete prefetched[model.id]; });
            if (!Object.keys(prefetched).length) prefetched = null;
          } else if (participants) {
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
                source: { step: step.ref, participant: model.id, visit: activeVisit }, answerRef, pointer: declaration.pointer, inputs, description: declaration.description });
            });
          }
          delete outcome[model.id].detail;
          if (verdict.detail) outcome[model.id].detail = verdict.detail;
          Object.assign(entries[model.id], {
            state: 'done', finishedAt: Date.now(), sentPrompt: typeof result.sentPrompt === 'string' ? result.sentPrompt : null,
            answer: text(result.text), attribution: result.attribution || '', accepted: verdict.ok, reason: verdict.reason || '', ...(verdict.detail ? { detail: verdict.detail } : {}),
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

    // The same request goes to all the participants at once; they answer independently.
    async function execute(step, models, outcome, firstAttempt = 1) {
      const requests = Object.fromEntries(models.map((model) => [model.id, { ...promptFor(step, model), retryOf: outcome[model.id]?.attempt || null }]));
      await attempt(step, models, requests, outcome, firstAttempt);
    }

    // The owner's answer to an owner step (8.1): a text, or a reference to a file that the page stored. An empty or rejected
    // text is asked again with its reason; null (the dialog cancelled) stops the run. Only an accepted text is stored once and
    // its declared artifacts are registered; a binary file is kept as a reference (no text, no output check).
    const fileOf = (file) => ({ name: file.name, mime: file.mime, size: file.size, ref: file.ref });
    function ownerVerdict(step, reply) {
      const at = `шаг «${step.ref}» · ответ User`;
      const file = isPlain(reply) && isPlain(reply.file) ? reply.file : null;
      if (!file && typeof reply !== 'string') throw new EngineError('invalid_owner_result', at, 'ответ User: текст или объект файла');
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
      const output = checkedOutput(step.output);
      const shape = output ? Output.checkAnswer(value, output, { limit: runLimit }) : null;
      if (shape && !shape.ok) return { ok: false, reason: shape.reason, detail: shape.detail || '' };
      return { ok: true, text: value, ...(file ? { file: fileOf(file) } : {}) };
    }
    // An input item as the owner window gets it (N07): its address, its label, and its text or the reference of its file.
    const ownerItemOf = (item) => ({ label: item.label, ...item.address, ...(item.binary ? { file: item.file } : { text: item.text }) });
    // The document of an owner step (document: a round before it): the accepted answer of its one model, and its kind.
    function documentFor(step) {
      if (!step.document) return null;
      const at = `шаг «${step.ref}» · document`;
      const source = plan.find((item) => item.ref === step.document);
      if (!source || source.kind !== 'round' || source.index >= step.index) throw new EngineError('invalid_document', at, 'документ: ссылка только на более ранний раунд');
      if (source.models.length !== 1) throw new EngineError('invalid_document', at, 'документ для User даёт одна модель');
      const items = sourceItems([{ step: source.ref, required: true }], step);
      const answer = items.find((item) => !item.binary);
      if (!answer) throw new EngineError('invalid_document', at, 'у раунда нет принятого ответа');
      const output = outputOf(source, source.models[0]);
      const kind = output?.document === 'form' ? 'form' : 'read';
      const form = kind === 'form' ? Output.parseJsonAnswer(answer.text) : null;
      if (kind === 'form' && !form) throw new EngineError('invalid_document', at, 'ответ раунда — не опросник');
      return { ref: source.ref, kind, text: answer.text, ...(form ? { form } : {}) };
    }
    async function ownerAnswer(step, entry) {
      let reason = '';
      let detail = '';
      // The input of the owner step is resolved before the window opens (N07): a missing required source stops the run here,
      // and so does a revision whose artifact the owner did not get (3.3).
      const items = answersFor(step, step.input ?? 'none');
      const input = items.map(ownerItemOf);
      (step.output?.artifacts || []).forEach((declaration) => {
        if (declaration.revisionOf && !revisionItem(declaration, items)) {
          throw new StopRun('missing_input', `ревизия «${declaration.id}»: User не получил версию, которую она дорабатывает; шаг «${step.ref}» не открыт`);
        }
      });
      const document = documentFor(step);
      for (;;) {
        await checkpointNow('decision', { pendingOwner: { kind: 'owner', stepRef: step.ref, visit: entry.visit } });
        const reply = await ownerWait(() => provideOwnerResult({ stepRef: step.ref, visit: entry.visit, task: step.task, output: step.output, ...(step.goal ? { goal: step.goal } : {}),
          ...(step.input !== 'none' ? { input } : {}), ...(document ? { document } : {}), ...(reason ? { reason, detail } : {}) }));
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
          // A revision joins the line of the artifact the owner got; any other artifact starts the owner's own line.
          const revision = declaration.revisionOf ? revisionItem(declaration, items) : null;
          Artifacts.register(registry, { id: declaration.id, name: declaration.name,
            lineage: revision ? { ...revision.artifact.lineage } : { step: step.ref, participant: OWNER_PARTICIPANT, id: declaration.id },
            source: { step: step.ref, participant: OWNER_PARTICIPANT, visit: entry.visit }, answerRef: textRef, pointer: declaration.pointer,
            inputs: items.filter((item) => item.artifact).map((item) => item.artifact), description: declaration.description });
        });
        entry.owner = { text: verdict.text, textRef, ...(verdict.file ? { file: verdict.file } : {}) };
        emit('custom_owner', { step: step.index, ref: step.ref, visit: entry.visit, accepted: true, reason: null });
        await checkpointNow('judge', { pendingOwner: null });
        return entry.owner;
      }
    }

    // The step in progress: on Stop its accepted answers are kept like those of finished steps.
    let current = null;
    let pos = 0; // the pointer (pc): the position of the step the run is at
    let resumePoint = null; // the step that the saved state was in: its visit, phase, outcome and owner

    // Resume (8.3): the saved state is taken back as it was. The steps are the ones the caller gives (the saved schema);
    // the finished steps are not sent again, the accepted answers of the interrupted visit stay, the validity is restored, not reset.
    // Texts come back through getText. A state saved by an older version may hold fields that no longer exist (the counters of
    // transitions, the stack, the feedback, the dependencies, the routes, a route or an applied transition): they are ignored.
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
      : { text: restoredText(saved.textRef, 'ответ User'), textRef: saved.textRef, ...(saved.file ? { file: saved.file } : {}) });
    function restoreRun(saved) {
      if (!isPlain(saved)) throw new EngineError('resume_invalid', 'resume', 'состояние для продолжения: объект снимка');
      // A complete checkpoint holds every field of the state (V07). A missing `pc` would read as "the run is over" and end the
      // run with no work done, so a partial snapshot is refused, not guessed.
      const lacking = [
        ...['visits', 'decisions'].filter((field) => !isPlain(saved[field])),
        ...['results'].filter((field) => !Array.isArray(saved[field])),
        ...('pc' in saved ? [] : ['pc'])
      ];
      if (lacking.length) throw new EngineError('resume_invalid', 'resume', `в снимке состояния нет полей: ${lacking.join(', ')}`);
      ['visits', 'decisions'].forEach((field) => { state[field] = isPlain(saved[field]) ? JSON.parse(JSON.stringify(saved[field])) : {}; });
      ownerAnswers.push(...(Array.isArray(saved.ownerAnswers) ? saved.ownerAnswers : []));
      // A list (an old snapshot) is no bindings: the chats are taken from the next reply of each participant.
      chatBindings = isPlain(saved.chatBindings) ? JSON.parse(JSON.stringify(saved.chatBindings)) : {};
      registry.entries.push(...(Array.isArray(saved.artifacts) ? saved.artifacts : []).map((entry) => ({ ...entry, lineage: { ...entry.lineage }, source: { ...entry.source }, content: { ...entry.content } })));
      (Array.isArray(saved.results) ? saved.results : []).forEach((item) => {
        const step = plan[pointAt(item.stepRef)];
        if (!step) throw new EngineError('resume_mismatch', `шаг «${item.stepRef}»`, 'шага сохранённого состояния нет в схеме продолжения');
        const entry = { step, visit: item.visit, outcome: restoredOutcome(item.outcome), skipped: Boolean(item.skipped), valid: item.valid !== false };
        if (item.owner) entry.owner = restoredOwner(item.owner);
        results.push(entry);
      });
      const at = saved.pc == null ? -1 : pointAt(saved.pc);
      if (saved.pc != null && at < 0) throw new EngineError('resume_mismatch', `шаг «${saved.pc}»`, 'шага сохранённого состояния нет в схеме продолжения');
      pos = at < 0 ? plan.length : at;
      const cur = saved.current;
      if (cur && cur.active && at >= 0 && cur.stepRef === saved.pc) {
        resumePoint = { index: at, visit: cur.visit, phase: cur.phase, pending: Array.isArray(cur.pending) ? cur.pending : [], outcome: restoredOutcome(cur.outcome),
          valid: cur.valid !== false,
          owner: cur.owner ? restoredOwner(cur.owner) : null };
      }
    }
    // A request that may have been sent before the reload has no known answer: the owner decides, and the request is never
    // sent again on its own. The accepted answers of the visit stay. Resend is a new attempt; skip is recorded for it only.
    async function settleUnknown(step, entry, pending = []) {
      let items = pending.filter((item) => !entry.outcome[item.participantId]?.ok);
      if (!items.length) return;
      // Until the owner decides, the requests stay in flight: a Stop keeps them unknown in the saved state.
      const markInFlight = () => {
        inFlight = items.map((item) => ({ participantId: item.participantId, attempt: item.attempt, phase: 'answer', stepRef: step.ref, visit: entry.visit }));
      };
      markInFlight();
      await checkpointNow('decision', { pendingOwner: { kind: 'unknown', stepRef: step.ref, visit: entry.visit } });
      // The answer a participant gave before: a read of its chat must not take it for the answer of the unknown request (V03).
      const previousAnswerOf = (participantId) => {
        for (let at = results.length - 1; at >= 0; at -= 1) {
          const outcome = results[at].outcome?.[participantId];
          if (outcome?.ok && outcome.text) return outcome.text;
        }
        return '';
      };
      for (;;) {
        const canCheck = typeof checkUnknown === 'function';
        const choices = canCheck ? ['check', 'resend', 'skip'] : ['resend', 'skip'];
        const choice = typeof resolveUnknown === 'function'
          ? await ownerWait(() => resolveUnknown({ stepRef: step.ref, visit: entry.visit, items: items.map((item) => ({ participantId: item.participantId, attempt: item.attempt })), choices }))
          : undefined;
        if (choice === null) throw new StopRun('stopped');
        if (!choices.includes(choice)) throw new StopRun('no_decision', `шаг «${step.ref}»: нет решения о неизвестном ответе (${canCheck ? 'проверить, ' : ''}отправить заново или пропустить)`);
        if (choice === 'check') {
          // A read only: nothing is sent. A found answer is judged like any reply; the others stay unknown and the owner decides again.
          const foundNow = {};
          for (const item of items) {
            const model = step.models.find((candidate) => candidate.id === item.participantId);
            if (!model) continue;
            const read = await ownerWait(() => checkUnknown({ participantId: model.id, modelName: model.name, transportRequestId: null, excludeText: previousAnswerOf(model.id) }));
            emit('custom_unknown_check', { step: step.index, label: stepLabel(step), participant: model.id, attempt: item.attempt, status: read?.status || 'chat_unavailable', reason: read?.reason || null });
            if (read?.ok && read.status === 'found' && text(read.text)) {
              foundNow[model.id] = { text: read.text, status: 'SUCCESS', attribution: 'checked', transportRequestId: '' };
            }
          }
          const foundModels = step.models.filter((model) => foundNow[model.id]);
          if (!foundModels.length) continue;
          inFlight = [];
          prefetched = { ...(prefetched || {}), ...foundNow };
          await execute(step, foundModels, entry.outcome, Math.max(...items.filter((item) => foundNow[item.participantId]).map((item) => item.attempt || 1)));
          prefetched = null;
          items = items.filter((item) => !entry.outcome[item.participantId]?.ok);
          if (!items.length) { await checkpointNow('decision', { pendingOwner: null }); return; }
          markInFlight();
          continue;
        }
        inFlight = [];
        await checkpointNow('decision', { pendingOwner: null });
        const models = step.models.filter((model) => items.some((item) => item.participantId === model.id));
        models.forEach((model) => {
          const item = items.find((candidate) => candidate.participantId === model.id);
          entry.outcome[model.id] = { ok: false, reason: choice === 'skip' ? 'skipped' : 'unknown', text: '', model: model.name, participant: model.id, attempt: item.attempt || 0, status: '', transportRequestId: '' };
        });
        if (choice === 'resend') await execute(step, models, entry.outcome, Math.max(...items.map((item) => item.attempt || 0)) + 1);
        return;
      }
    }

    try {
      if (resume) restoreRun(resume);
      while (pos < plan.length) {
        const step = plan[pos];
        const key = refKey(step);
        const resumed = resumePoint && resumePoint.index === pos ? resumePoint : null;
        resumePoint = null;
        if (resumed) {
          // The visit goes on: it is not a new execution, so its visit number is kept.
          activeVisit = resumed.visit;
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
          // A new execution of the step is a new visit; a technical retry is not.
          state.visits[key] = (state.visits[key] || 0) + 1;
          activeVisit = state.visits[key];
        }
        const decidedKey = `${key}@${activeVisit}`;
        const outcome = resumed ? resumed.outcome : {};
        const entry = { step, visit: activeVisit, outcome, skipped: false, valid: resumed ? resumed.valid : true };
        if (resumed?.owner) entry.owner = resumed.owner;
        current = entry;
        if (step.kind === 'owner') {
          // The owner's answer is asked until it is accepted; an accepted one (also one found after a reload) is not asked again.
          if (!entry.owner) await ownerAnswer(step, entry);
          results.push(entry);
          pos += 1;
          current = null;
          continue;
        }
        if (resumed) await settleUnknown(step, entry, resumed.pending);
        // The participants that were never sent (a reload in the middle of a step) are sent now; a sent one is not sent again.
        const never = step.models.filter((model) => !outcome[model.id]);
        if (never.length) await execute(step, never, outcome);
        const last = step === plan[plan.length - 1];
        // A visit whose decision is saved, or that has passed its decision (asks), is not asked again.
        const decided = Boolean(resumed) && (resumed.phase === 'asks' || state.decisions[decidedKey] !== undefined);
        if (decided) entry.skipped = state.decisions[decidedKey] === 'skip';
        if (!decided) {
          for (;;) {
            const accepted = step.models.filter((model) => outcome[model.id]?.ok).map((model) => model.id);
            const failed = step.models.filter((model) => !outcome[model.id]?.ok).map((model) => model.id);
            // The round waits for the answers of all its participants.
            const required = step.models.length;
            const enough = !failed.length;
            // An owner approval (owner: approve) is asked after the step in every mode, also on the last step.
            const approve = step.approve === true;
            emit('custom_step', { step: step.index, label: stepLabel(step), accepted: accepted.length, failed: failed.length, required, approve });
            if (enough && !semiAuto && !approve) break;
            if (enough && semiAuto && last && !failed.length && !approve) break;
            // Without every answer "continue" is not offered: the owner repeats, skips or stops the step.
            const choices = enough ? ['continue', ...(failed.length ? ['retry'] : []), 'stop'] : ['retry', 'skip', 'stop'];
            if (typeof decide === 'function') await checkpointNow('decision', { pendingOwner: { kind: 'decision', stepRef: step.ref, visit: entry.visit } });
            const action = typeof decide === 'function'
              ? await ownerWait(() => decide({ step: step.index, label: stepLabel(step), accepted, failed, choices, last, required, approve,
                reasons: Object.fromEntries(failed.map((id) => [id, outcome[id]?.reason || ''])) }))
              : null;
            // The fallback "the answers go on" holds only when every answer is accepted and no approval is asked.
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
        results.push(entry);
        if (typeof parseAsks === 'function' && typeof askOwner === 'function' && !entry.skipped) {
          const asks = acceptedOf(entry).flatMap((item) => parseAsks(item.text) || []);
          if (asks.length) {
            await checkpointNow('asks', { pendingOwner: { kind: 'asks', stepRef: step.ref, visit: entry.visit } });
            ownerAnswers.push(...((await ownerWait(() => askOwner(asks, { step: step.index, label: stepLabel(step) }))) || []));
            await checkpointNow('asks', { pendingOwner: null });
          }
        }
        pos += 1;
        current = null;
      }
    } catch (error) {
      if (!(error instanceof StopRun)) throw error;
      stopReason = error.stopReason;
      stopDetail = error.stopDetail || '';
      // The step in progress keeps its accepted answers (and its owner answer) when it was not kept yet.
      if (current && !results.includes(current) && (acceptedOf(current).length || current.owner)) results.push(current);
    }

    if (aborted() && stopReason === 'steps_done') stopReason = 'cancelled';
    await checkpointNow('done');
    emit('custom_end', { stopReason, stopDetail, steps: results.length });
    return {
      steps: results.map((entry) => ({ index: entry.step.index, ref: entry.step.ref, kind: entry.step.kind, label: stepLabel(entry.step), visit: entry.visit, valid: entry.valid, skipped: entry.skipped, outcome: entry.outcome, ...(entry.owner?.file ? { file: entry.owner.file } : {}) })),
      // The state of the run as plain data (ТЗ 7): the pointer, the visits and the decisions.
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
    all: '‹все принятые ответы предыдущих шагов появятся при запуске›'
  });
  const TRANSPORT_LINES = Object.freeze([
    'Предел длины ответа — по настройке модели или pipeline.',
    'Метка доставки создаётся транспортом; инструкцию можно изменить у модели.'
  ]);
  function previewPrompt({ task, steps = [], stepIndex = 0, modelName = '', semiAuto = false, askInstruction = '' }) {
    const plan = normalizeSteps(steps);
    const step = plan.find((item) => item.index === stepIndex) || plan[stepIndex];
    if (!step) return null;
    // A step the run would refuse, and an owner step (it sends nothing to a model), have no prompt to show.
    if (unexecutedOf(steps[stepIndex], stepIndex) || step.kind === 'owner') return null;
    const model = step.models.find((item) => item.name === modelName) || { name: modelName, extra: '' };
    const spec = specOf(step, model);
    const input = spec === 'none' || !plan.some((item) => item.index < step.index) ? []
      : [{ label: 'Вход', text: PLACEHOLDER[modeOf(spec)] || PLACEHOLDER.previous }];
    const prompt = buildPrompt({ task, step, model, input, inputMode: modeOf(spec), ownerAnswers: [],
      askInstruction: semiAuto ? askInstruction : '', output: outputOf(step, model) });
    const template = typeof model.promptTemplate === 'string' && model.promptTemplate.trim() ? model.promptTemplate
      : buildPrompt({ task: '{задача}', step, model, input: input.length ? [{ label: 'Вход', text: '{вход}' }] : [],
        inputMode: modeOf(spec), output: outputOf(step, model) });
    return { label: stepLabel(step), inputMode: modeOf(spec), prompt, template, transportLines: TRANSPORT_LINES.slice(),
      instructions: { task: text(task), stepTask: model.task ?? step.task, extra: model.extra || '', askInstruction: askOf(model, semiAuto ? askInstruction : '') } };
  }

  const api = Object.freeze({ EngineError, unexecutedOf, formatBlock, DEFAULT_ATTEMPTS, CORRECTION_TEMPLATE, STOP_TEXT, REASON_TEXT, resolveSetting, PLACEHOLDER, TRANSPORT_LINES, buildPrompt, correctionPrompt, normalizeSteps, previewPrompt, run });
  root.CustomEngine = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
