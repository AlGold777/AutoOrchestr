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
// Transition: decide(problem) → 'continue' | 'retry' | 'skip' | 'stop'. Asked after every step in
//   semi-automatic mode and, in Auto, only when a step has no accepted answer. 'continue' is never
//   offered without an accepted answer. A prompt over maxPromptChars stops the run before sending.
// Stop keeps what was collected. [[ASK: …]] lines of accepted answers go to askOwner; the answers
// reach the prompts of the following steps.
(function initCustomEngine(root) {
  'use strict';

  const Output = root.BasicOutput || (typeof require === 'function' ? require('./basic-output') : null);
  const Artifacts = root.BasicArtifacts || (typeof require === 'function' ? require('./basic-artifacts') : null);
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
    missing_artifact: 'без объявленного артефакта'
  });
  const STOP_TEXT = Object.freeze({
    steps_done: 'все шаги пройдены',
    context_full: 'промпт не помещается в бюджет',
    stopped: 'остановлено владельцем',
    cancelled: 'остановлено пользователем',
    no_decision: 'нет принятых ответов, решение владельца не получено',
    missing_input: 'обязательный вход не получен, запрос не отправлен'
  });
  // The first visit of every step: the cycles that give later visits come with the pack P06.
  const VISIT = 1;

  const text = (value) => String(value == null ? '' : value).trim();
  const stepLabel = (step) => (step.kind === 'synthesis' ? `Синтез после раунда ${step.afterRound}` : `Раунд ${step.round}`);
  // The mode the prompt names: a list of sources is 'sources', the strings stay as they are.
  const modeOf = (spec) => (Array.isArray(spec) ? 'sources' : spec);
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

  function buildPrompt({ task, step, model, input = [], inputMode = 'none', earlier = [], ownerAnswers = [], askInstruction = '', output = null }) {
    if (askInstruction && typeof model.discipline?.ask === 'string') askInstruction = model.discipline.ask;
    if (typeof model.promptTemplate === 'string' && model.promptTemplate.trim()) {
      // One pass: placeholders occurring inside model answers remain data, never instructions.
      const values = { '{задача}': text(task), '{вход}': inputMode === 'all' || inputMode === 'sources' ? labelled(input) : numbered(input), '{ответы до тебя}': numbered(earlier) };
      const parts = [model.promptTemplate.replace(/\{задача\}|\{вход\}|\{ответы до тебя\}/g, (key) => values[key])];
      if (formatBlock(output)) parts.push(formatBlock(output));
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
    const taskInstruction = model.task ?? step.task;
    if (text(taskInstruction)) parts.push(`Задание:\n${text(taskInstruction)}`);
    if (formatBlock(output)) parts.push(formatBlock(output));
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

  // The content of an artifact: the whole answer for an empty pointer, else the value at the pointer (a text as it is,
  // an object or a list as JSON). A pointer that the stored answer does not give is missing_content.
  function contentOf(answer, pointer, address) {
    if (pointer === '') return answer;
    const value = Output.parseJsonAnswer(answer);
    const read = value ? Output.readPointer(value, pointer) : { found: false };
    if (!read.found) throw new EngineError('missing_content', address, `указатель ${pointer} не найден в сохранённом ответе`);
    return typeof read.value === 'string' ? read.value : JSON.stringify(read.value);
  }

  // Numbers the steps for labels: rounds by their card, syntheses by the round before them.
  function normalizeSteps(steps = []) {
    let round = 0;
    return steps.map((step, index) => {
      const kind = step.kind === 'synthesis' ? 'synthesis' : 'round';
      // A switched-off round keeps its number: the schema gives the number, the engine only counts without it.
      if (kind === 'round') round = Number.isSafeInteger(step.round) && step.round > 0 ? step.round : round + 1;
      return {
        index, ref: typeof step.ref === 'string' ? step.ref : null, kind, round: kind === 'round' ? round : null,
        afterRound: kind === 'synthesis' ? (Number.isSafeInteger(step.afterRound) && step.afterRound > 0 ? step.afterRound : round) : null,
        order: kind === 'round' && step.order === 'sequential' ? 'sequential' : 'parallel',
        task: kind === 'synthesis' && !text(step.task) ? SYNTHESIS_TASK : text(step.task),
        // A list of sources stays a list here: the input is checked before the run (assertExecutable).
        input: Array.isArray(step.input) ? step.input.slice() : (kind === 'synthesis' ? 'previous' : (step.input ?? 'previous')),
        output: step.output ?? null,
        require: step.require ?? 'any',
        approve: step.owner === 'approve',
        models: (step.models || []).map((model) => (typeof model === 'string' ? { name: model, id: model, extra: '' } : {
          name: model.name, id: model.id ?? model.name, extra: text(model.extra), task: typeof model.task === 'string' ? model.task : null, promptTemplate: typeof model.promptTemplate === 'string' ? model.promptTemplate : null,
          discipline: model.discipline ? { ...model.discipline } : null,
          maxWords: Number.isSafeInteger(model.maxWords) && model.maxWords > 0 ? model.maxWords : null,
          ...(model.input !== undefined ? { input: Array.isArray(model.input) ? model.input.slice() : model.input } : {})
        }))
          .filter((model) => model.name)
      };
    }).filter((step) => step.models.length);
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

  const EXECUTED_KINDS = Object.freeze(['round', 'synthesis']);
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
        return typeof source.step === 'string' && typeof source.participant === 'string';
      };
      const bad = spec.findIndex((source) => !shape(source));
      if (bad >= 0) return fail('invalid_input', `${field}[${bad}]`, 'источник: ref шага, { step, participant, required? } или { artifact: { step, participant, id }, version, required? }');
      return null;
    }
    if (!INPUT_VALUES.includes(spec) || (kind === 'synthesis' && spec !== 'previous')) return fail('invalid_input', field, 'вход: none, previous, all или список источников; синтез — только previous');
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
    if (step.input !== undefined) {
      const problem = inputProblem(step.input, step.kind, fail, 'input');
      if (problem) return problem;
    }
    if (step.output !== undefined) {
      const output = step.output;
      if (!output || typeof output !== 'object' || Array.isArray(output)) return fail('invalid_field', 'output', 'выход шага: объект');
      if (output.format !== undefined && output.format !== 'json') return fail('unsupported_field', 'output.format', 'формат выхода движок пока не исполняет');
      if (output.artifacts !== undefined && (!Array.isArray(output.artifacts) || !output.artifacts.length)) return fail('invalid_field', 'output.artifacts', 'ожидается непустой список артефактов');
      if (Array.isArray(output.artifacts)) {
        for (const [at, item] of output.artifacts.entries()) {
          if (!item || typeof item !== 'object' || !('revisionOf' in item)) continue;
          if (!isPlain(item.revisionOf) || !isPlain(item.revisionOf.artifact)) return fail('invalid_input', `output.artifacts[${at}].revisionOf`, 'ревизия: ссылка на артефакт { artifact: { step, participant, id }, version }');
          const problem = inputProblem([item.revisionOf], step.kind, fail, `output.artifacts[${at}].revisionOf`);
          if (problem) return problem;
        }
      }
    }
    if (step.require !== undefined && step.require !== 'any' && step.require !== 'all') {
      if (!Number.isSafeInteger(step.require) || step.require < 1) return fail('invalid_field', 'require', 'require: any, all или целое число больше 0');
      const count = Array.isArray(step.models) ? step.models.length : 0;
      if (step.require > count) return fail('invalid_field', 'require', `требуется больше ответов, чем участников: ${count}`);
    }
    if (step.owner !== undefined && step.owner !== 'approve') return fail('invalid_field', 'owner', 'owner: только approve');
    if (step.chat !== undefined && step.chat !== 'continue') return fail('unsupported_field', 'chat', 'чат «new» движок пока не исполняет');
    const ids = new Set();
    const names = new Set();
    for (const model of Array.isArray(step.models) ? step.models : []) {
      const name = typeof model === 'string' ? model : model?.name;
      const id = typeof model === 'string' ? model : (model?.id ?? name);
      if (model && typeof model === 'object' && model.input !== undefined) {
        const problem = inputProblem(model.input, step.kind, fail, `модель «${name}» · input`);
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
      // A revision names an artifact that the author really gets as input (5.2): the input of every author has it.
      (Array.isArray(step.output?.artifacts) ? step.output.artifacts : []).forEach((declaration) => {
        if (!declaration || !isPlain(declaration.revisionOf)) return;
        const want = declaration.revisionOf.artifact;
        (Array.isArray(step.models) ? step.models : []).forEach((model) => {
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
            const declared = (Array.isArray(steps[from].models) ? steps[from].models : []).map((model) => (typeof model === 'string' ? model : (model?.id ?? model?.name)));
            if (!declared.includes(participant)) throw new EngineError('invalid_input', address, `участник «${participant}» не объявлен в шаге «${ref}»`);
            if (artifactId !== null && !(steps[from].output?.artifacts || []).some((item) => item && item.id === artifactId)) {
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
    send = null, sendParticipants = null, runMaxWords = null, putText: putCallback = null, getText: getCallback = null,
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
    const checkFor = (step, model) => (step.output ? (value) => Output.checkAnswer(value, step.output, { limit: model.maxWords ?? runLimit }) : null);
    const participants = typeof sendParticipants === 'function';
    if (!participants && typeof send !== 'function') throw new Error('custom_send_required');
    assertExecutable(steps, { participants });
    const emit = (kind, fields) => { if (typeof onEvent === 'function') onEvent(kind, fields); };
    const aborted = () => Boolean(signal?.aborted);
    const plan = normalizeSteps(steps);
    const ownerAnswers = [];
    const history = []; // every request: step, model, participant, attempt, prompt, outcome
    const results = []; // per step: { step, outcome: { participantId: verdict }, skipped }
    let stopReason = 'steps_done';
    let stopDetail = '';
    // The plan as the run sees it: a report shows what was intended, not only what happened.
    emit('custom_start', { semiAuto: Boolean(semiAuto), maxAttempts, taskChars: text(task).length,
      steps: plan.map((step) => ({ step: step.index, ref: step.ref, label: stepLabel(step), order: step.order, input: modeOf(step.input), models: step.models.map((model) => model.name) })) });

    class StopRun extends Error { constructor(reason, detail = '') { super(reason); this.stopReason = reason; this.stopDetail = detail; } }

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
    const acceptedOf = (entry) => (!entry || entry.skipped ? [] : entry.step.models.map((model) => ({ model, verdict: entry.outcome[model.id] }))
      .filter((item) => item.verdict?.ok)
      .map(({ model, verdict }) => ({ ...verdict, participant: model.id, source: { step: entry.step.index, label: stepLabel(entry.step), model: verdict.model, attempt: verdict.attempt } })));
    // The content of an artifact version: the line, then its current version (latest) or the named one. Only that content.
    function artifactItems(source, step) {
      const required = Boolean(source.required);
      const address = source.artifact;
      const lineage = { step: address.step, participant: address.participant, id: address.id };
      const found = source.version === 'latest' ? Artifacts.latest(registry, lineage) : Artifacts.version(registry, lineage, source.version);
      if (!found || !found.valid) {
        if (!required) return [];
        throw new StopRun('missing_input', `артефакт «${address.id}» шага «${address.step}», участник «${address.participant}»: нет актуальной версии; шаг «${step.ref}» не отправлен`);
      }
      const answer = getText(found.content.answerRef);
      if (answer === undefined || answer === null) throw new EngineError('missing_content', `шаг «${step.ref}» · input`, `текст ответа «${found.content.answerRef}» не найден`);
      // The label names the author of this version (its source), not the author of the line.
      const author = results.find((item) => item.step.ref === found.source.step);
      const where = author ? stepLabel(author.step) : found.source.step;
      return [{
        label: `Артефакт «${found.name}» (${where}, участник ${found.source.participant}, визит ${found.source.visit})`,
        text: contentOf(answer, found.content.pointer, `шаг «${step.ref}» · input`),
        source: { step: author ? author.step.index : null, label: where, model: found.source.participant, attempt: null },
        artifact: { lineage: { ...found.lineage }, source: { ...found.source } }
      }];
    }
    // The items of one source list, in the order of the list. Each item names its step, participant and visit.
    function sourceItems(spec, step) {
      return spec.flatMap((source) => {
        if (source && typeof source === 'object' && 'artifact' in source) return artifactItems(source, step);
        const required = Boolean(source?.required);
        const ref = typeof source === 'string' ? source : source.step;
        const entry = results.find((item) => item.step.ref === ref);
        const answers = acceptedOf(entry).filter((item) => typeof source === 'string' || item.participant === source.participant);
        if (!answers.length && required) {
          const who = typeof source === 'string' ? '' : ` участник «${source.participant}»`;
          throw new StopRun('missing_input', `шаг «${ref}»${who} не дал принятого ответа; шаг «${step.ref}» не отправлен`);
        }
        return answers.map((item) => ({
          label: `${stepLabel(entry.step)}${entry.step.output?.name ? ` («${entry.step.output.name}»)` : ''}, участник ${item.participant}, визит ${VISIT}`, text: item.text, source: item.source
        }));
      });
    }
    function inputFor(step, spec = step.input) {
      if (spec === 'none') return [];
      if (Array.isArray(spec)) return sourceItems(spec, step);
      if (spec === 'all') {
        return results.flatMap((entry) => acceptedOf(entry).map((item, index) => ({ label: `${stepLabel(entry.step)}, ответ ${index + 1}`, text: item.text, source: item.source })));
      }
      for (let index = results.length - 1; index >= 0; index -= 1) {
        const accepted = acceptedOf(results[index]);
        if (accepted.length) return accepted.map((item) => ({ text: item.text, source: item.source }));
      }
      return [];
    }

    // Instructions (owner-editable behaviour) and input (data from other models) are kept apart.
    function partsFor(step, model, input, earlier, spec) {
      return {
        instructions: { task: text(task), stepTask: model.task ?? step.task, extra: model.extra || '', askInstruction: semiAuto ? (model.discipline?.ask ?? askInstruction) : '',
          ownerAnswers: ownerAnswers.slice() },
        input: { mode: modeOf(spec), items: input, earlier }
      };
    }

    function promptFor(step, model, earlier) {
      const spec = specOf(step, model);
      const input = inputFor(step, spec);
      const prompt = buildPrompt({ task, step, model, input, inputMode: modeOf(spec), earlier,
        ownerAnswers, askInstruction: semiAuto ? askInstruction : '', output: step.output });
      if (prompt.length > maxPromptChars) throw new StopRun('context_full');
      return { prompt, parts: partsFor(step, model, input, earlier, spec) };
    }

    // Sends the participants with their prompts, then corrections; fills `outcome` by participant id. Every attempt
    // is a history entry of its own: a retry never rewrites the attempt it follows, it refers to it.
    async function attempt(step, models, requests, outcome, firstAttempt = 1) {
      let pending = models.slice();
      let current = requests; // participant id → { prompt, parts, retryOf }
      for (let tryNo = firstAttempt; pending.length && tryNo < firstAttempt + maxAttempts; tryNo += 1) {
        if (aborted()) throw new StopRun('cancelled');
        // The budget is checked before every send, a correction request included.
        if (pending.some((model) => String(current[model.id].prompt || '').length > maxPromptChars)) throw new StopRun('context_full');
        const entries = Object.fromEntries(pending.map((model) => {
          const entry = { step: step.index, ref: step.ref, kind: step.kind, label: stepLabel(step), model: model.name, participant: model.id, attempt: tryNo,
            retryOf: current[model.id].retryOf || null, prompt: current[model.id].prompt, parts: current[model.id].parts,
            state: 'sent', sentAt: Date.now() };
          history.push(entry);
          if (typeof onRequest === 'function') onRequest(entry);
          return [model.id, entry];
        }));
        const meta = { step: step.index, kind: step.kind, label: stepLabel(step), attempt: tryNo };
        const maxWordsOf = Object.fromEntries(pending.map((model) => [model.id, model.maxWords || null]));
        const correctionOf = Object.fromEntries(pending.map((model) => [model.id, Boolean(current[model.id].parts?.correction)]));
        let reply;
        let byId; // participant id → the reply of the transport
        try {
          if (participants) {
            reply = await sendParticipants(pending.map((model) => ({ participantId: model.id, modelName: model.name, prompt: current[model.id].prompt,
              chat: 'continue', stepRef: step.ref, visit: VISIT, attempt: tryNo })),
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
            throw new StopRun('context_full');
          }
          if (error?.name === 'AbortError' || aborted()) throw new StopRun('cancelled');
          byId = Object.fromEntries(pending.map((model) => [model.id, { text: '', status: String(error?.message || error) }]));
        }
        const retry = [];
        pending.forEach((model) => {
          const result = byId[model.id] || {};
          let verdict = judge(result, accept, checkFor(step, model));
          if (!verdict.ok && reply?.closedByOwner && !text(result.text)) verdict = { ...verdict, reason: 'closed_by_owner' };
          outcome[model.id] = { ...verdict, model: model.name, participant: model.id, status: result.status || '', attempt: tryNo, transportRequestId: result.transportRequestId || '' };
          // An accepted answer is stored once, then each artifact it declares is registered (one line, one version).
          if (verdict.ok) {
            const answerRef = putText(verdict.text);
            outcome[model.id].textRef = answerRef;
            const items = current[model.id].parts?.input?.items || [];
            const inputs = items.filter((item) => item.artifact).map((item) => item.artifact);
            (step.output?.artifacts || []).forEach((declaration) => {
              // A revision joins the line of the source it got; any other artifact starts its own line.
              const revision = declaration.revisionOf ? revisionItem(declaration, items) : null;
              if (declaration.revisionOf && !revision) throw new EngineError('missing_input', `шаг «${step.ref}» · output.artifacts`, `ревизия «${declaration.id}» без полученной версии`);
              Artifacts.register(registry, { id: declaration.id, name: declaration.name,
                lineage: revision ? { ...revision.artifact.lineage } : { step: step.ref, participant: model.id, id: declaration.id },
                source: { step: step.ref, participant: model.id, visit: VISIT }, answerRef, pointer: declaration.pointer, inputs });
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

    // The step in progress: on Stop its accepted answers are kept like those of finished steps.
    let current = null;
    try {
      for (const step of plan) {
        // Every input of the step is resolved before its first request: a missing required one sends nothing, and
        // a revision whose source an author did not get stops the step (its line would be unknown).
        step.models.forEach((model) => {
          const items = inputFor(step, specOf(step, model));
          (step.output?.artifacts || []).forEach((declaration) => {
            if (declaration.revisionOf && !revisionItem(declaration, items)) {
              throw new StopRun('missing_input', `ревизия «${declaration.id}»: участник «${model.id}» не получил версию, которую она дорабатывает; шаг «${step.ref}» не отправлен`);
            }
          });
        });
        const outcome = {};
        const entry = { step, outcome, skipped: false };
        current = entry;
        await execute(step, step.models, outcome);
        const last = step === plan[plan.length - 1];
        for (;;) {
          const accepted = step.models.filter((model) => outcome[model.id]?.ok).map((model) => model.id);
          const failed = step.models.filter((model) => !outcome[model.id]?.ok).map((model) => model.id);
          const required = neededOf(step);
          const enough = accepted.length >= required;
          // An owner approval (owner: approve) is asked after the step in every mode, also on the last step.
          const approve = step.approve === true;
          emit('custom_step', { step: step.index, label: stepLabel(step), accepted: accepted.length, failed: failed.length, required, approve });
          if (enough && !semiAuto && !approve) break;
          if (enough && semiAuto && last && !failed.length && !approve) break;
          // Below the threshold "continue" is not offered: the owner repeats, skips or stops the step.
          const choices = enough ? ['continue', ...(failed.length ? ['retry'] : []), 'stop'] : ['retry', 'skip', 'stop'];
          const action = typeof decide === 'function'
            ? await ownerWait(() => decide({ step: step.index, label: stepLabel(step), accepted, failed, choices, last, required, approve,
              reasons: Object.fromEntries(failed.map((id) => [id, outcome[id]?.reason || ''])) }))
            : null;
          // The fallback "an accepted answer goes on" holds only when the threshold is met and no approval is asked.
          if (!choices.includes(action)) { if (enough && !approve) break; throw new StopRun('no_decision'); }
          emit('custom_decision', { step: step.index, action });
          if (action === 'continue') break;
          if (action === 'stop') throw new StopRun('stopped');
          if (action === 'skip') { entry.skipped = true; break; }
          const firstAttempt = Math.max(0, ...failed.map((id) => outcome[id]?.attempt || 0)) + 1;
          await execute(step, step.models.filter((model) => failed.includes(model.id)), outcome, firstAttempt);
        }
        results.push(entry);
        current = null;
        if (typeof parseAsks === 'function' && typeof askOwner === 'function' && !entry.skipped) {
          const asks = acceptedOf(entry).flatMap((item) => parseAsks(item.text) || []);
          if (asks.length) ownerAnswers.push(...((await ownerWait(() => askOwner(asks, { step: step.index, label: stepLabel(step) }))) || []));
        }
      }
    } catch (error) {
      if (!(error instanceof StopRun)) throw error;
      stopReason = error.stopReason;
      stopDetail = error.stopDetail || '';
      if (current && acceptedOf(current).length) results.push(current);
    }
    if (aborted() && stopReason === 'steps_done') stopReason = 'cancelled';
    emit('custom_end', { stopReason, stopDetail, steps: results.length });
    return {
      steps: results.map((entry) => ({ index: entry.step.index, kind: entry.step.kind, label: stepLabel(entry.step), skipped: entry.skipped, outcome: entry.outcome })),
      answers: inputFor({ input: 'previous' }).map((item) => item.text),
      history, ownerAnswers, stopReason, stopDetail,
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
    // A step the run would refuse has no prompt to show.
    if (unexecutedOf(steps[stepIndex], stepIndex)) return null;
    const model = step.models.find((item) => item.name === modelName) || { name: modelName, extra: '' };
    const spec = specOf(step, model);
    const input = spec === 'none' || !plan.some((item) => item.index < step.index) ? []
      : [{ label: 'Вход', text: PLACEHOLDER[modeOf(spec)] || PLACEHOLDER.previous }];
    const position = step.models.findIndex((item) => item.name === model.name);
    const earlier = step.order === 'sequential' && position > 0 ? [{ text: PLACEHOLDER.earlier }] : [];
    const prompt = buildPrompt({ task, step, model, input, inputMode: modeOf(spec), earlier, ownerAnswers: [],
      askInstruction: semiAuto ? askInstruction : '', output: step.output });
    const template = typeof model.promptTemplate === 'string' && model.promptTemplate.trim() ? model.promptTemplate
      : buildPrompt({ task: '{задача}', step, model, input: input.length ? [{ label: 'Вход', text: '{вход}' }] : [],
        inputMode: modeOf(spec), earlier: earlier.length ? [{ text: '{ответы до тебя}' }] : [], output: step.output });
    return { label: stepLabel(step), order: step.order, inputMode: modeOf(spec), prompt, template, transportLines: TRANSPORT_LINES.slice(),
      instructions: { task: text(task), stepTask: model.task ?? step.task, extra: model.extra || '', askInstruction: semiAuto ? askInstruction : '' } };
  }

  const api = Object.freeze({ EngineError, unexecutedOf, formatBlock, DEFAULT_ATTEMPTS, CORRECTION_TEMPLATE, SYNTHESIS_TASK, STOP_TEXT, REASON_TEXT, resolveSetting, PLACEHOLDER, TRANSPORT_LINES, buildPrompt, correctionPrompt, normalizeSteps, previewPrompt, run });
  root.CustomEngine = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
