// Custom engine: the shared pipeline workhorse. A run is one sequence of steps; the canvas shows
// them as round cards and synthesis inserts, the engine knows only steps. Meaning (answer, critique,
// improvement, check, synthesis) comes from the step's task; the engine executes and passes data.
//
// Step: { kind: 'round' | 'synthesis', order: 'parallel' | 'sequential', task, input, models }
//   models: [{ name, extra, promptTemplate, maxWords }] — card order is call order.
//   promptTemplate replaces automatic assembly; maxWords reaches the caller on every attempt.
//   input: 'none' | 'previous' | 'all'. The run's task is always sent.
//     previous — accepted answers of the last step that has any (a synthesis replaces the round
//                before it; a skipped step passes nothing on);
//     all      — every accepted answer of all earlier steps, rounds and syntheses alike.
//   sequential — each model also gets the accepted answers of the models before it in this step;
//   parallel   — every model gets the same input.
// Discipline: send(models, promptsByModel, meta) — meta marks correction requests (correctionByModel) → { byModel: { model: { text, status, answered,
//   completion, transportRequestId } }, closedByOwner }. accept() judges the technical outcome;
//   empty text (also a token-only answer) is never accepted. A rejected answer gets a correction
//   retry in the same chat, up to maxAttempts, unless the owner closed the step.
// Transition: decide(problem) → 'continue' | 'retry' | 'skip' | 'stop'. Asked after every step in
//   semi-automatic mode and, in Auto, only when a step has no accepted answer. 'continue' is never
//   offered without an accepted answer. A prompt over maxPromptChars stops the run before sending.
// Stop keeps what was collected. [[ASK: …]] lines of accepted answers go to askOwner; the answers
// reach the prompts of the following steps.
(function initCustomEngine(root) {
  'use strict';

  const DEFAULT_ATTEMPTS = 2;
  const SYNTHESIS_TASK = 'Сведи эти ответы в один итоговый ответ на задачу.';
  const REASON_TEXT = Object.freeze({
    empty: 'пустой',
    token_only: 'без текста',
    too_short: 'слишком короткий',
    truncation_marker: 'оборван',
    incomplete_ending: 'оборван на середине',
    error_output: 'ошибка вместо ответа',
    closed_by_owner: 'раунд закрыт владельцем'
  });
  const STOP_TEXT = Object.freeze({
    steps_done: 'все шаги пройдены',
    context_full: 'промпт не помещается в бюджет',
    stopped: 'остановлено владельцем',
    cancelled: 'остановлено пользователем',
    no_decision: 'нет принятых ответов, решение владельца не получено'
  });

  const text = (value) => String(value == null ? '' : value).trim();
  const stepLabel = (step) => (step.kind === 'synthesis' ? `Синтез после раунда ${step.afterRound}` : `Раунд ${step.round}`);
  const numbered = (items) => items.map((item, index) => `Ответ ${index + 1}:\n${item.text}`).join('\n\n');
  const labelled = (items) => items.map((item) => `${item.label}:\n${item.text}`).join('\n\n');

  // One inheritance rule; the round slot is reserved for a future round editor.
  function resolveSetting({ model, round, pipeline, fallback = '' } = {}) {
    for (const [source, value] of [['model', model], ['round', round], ['pipeline', pipeline]]) {
      if (typeof value === 'string' && value.trim()) return { value, source };
    }
    return { value: fallback, source: 'code' };
  }

  function buildPrompt({ task, step, model, input = [], inputMode = 'none', earlier = [], ownerAnswers = [], askInstruction = '' }) {
    if (askInstruction && typeof model.discipline?.ask === 'string') askInstruction = model.discipline.ask;
    if (typeof model.promptTemplate === 'string' && model.promptTemplate.trim()) {
      // One pass: placeholders occurring inside model answers remain data, never instructions.
      const values = { '{задача}': text(task), '{вход}': inputMode === 'all' ? labelled(input) : numbered(input), '{ответы до тебя}': numbered(earlier) };
      const parts = [model.promptTemplate.replace(/\{задача\}|\{вход\}|\{ответы до тебя\}/g, (key) => values[key])];
      if (ownerAnswers.length) parts.push(`Ответы владельца на вопросы:\n${ownerAnswers.map((item) => `- ${item.question}: ${item.answer}`).join('\n')}`);
      if (askInstruction) parts.push(askInstruction);
      return parts.join('\n\n');
    }
    const parts = [`Задача:\n${text(task)}`];
    if (input.length) {
      parts.push(inputMode === 'all'
        ? `Принятые ответы всех предыдущих шагов:\n\n${labelled(input)}`
        : `Ответы предыдущего шага:\n\n${numbered(input)}`);
    }
    if (earlier.length) parts.push(`Ответы участников этого раунда до тебя:\n\n${numbered(earlier)}`);
    const taskInstruction = model.task ?? step.task;
    if (text(taskInstruction)) parts.push(`Задание:\n${text(taskInstruction)}`);
    if (text(model.extra)) parts.push(`Дополнительно для тебя:\n${text(model.extra)}`);
    if (ownerAnswers.length) parts.push(`Ответы владельца на вопросы:\n${ownerAnswers.map((item) => `- ${item.question}: ${item.answer}`).join('\n')}`);
    if (askInstruction) parts.push(askInstruction);
    return parts.join('\n\n');
  }

  const CORRECTION_TEMPLATE = 'Твой предыдущий ответ {причина}. Дай ответ на задание полностью.';
  const correctionPrompt = (reason, template = CORRECTION_TEMPLATE) => (typeof template === 'string' ? template : CORRECTION_TEMPLATE).replace(/\{причина\}/g, REASON_TEXT[reason] || 'не принят');

  // Default technical check: non-empty text. The page passes the shared acceptance check.
  const defaultAccept = () => ({ ok: true, reason: '' });

  function judge(result, accept) {
    const value = text(result?.text);
    if (!value) return { ok: false, reason: result?.answered ? 'token_only' : 'empty', text: '' };
    const verdict = accept({ text: value, completion: result?.completion || '', status: result?.status || '' }) || {};
    return { ok: verdict.ok !== false, reason: verdict.ok === false ? (verdict.reason || 'rejected') : '', text: value };
  }

  // Numbers the steps for labels: rounds by their card, syntheses by the round before them.
  function normalizeSteps(steps = []) {
    let round = 0;
    return steps.map((step, index) => {
      const kind = step.kind === 'synthesis' ? 'synthesis' : 'round';
      if (kind === 'round') round += 1;
      return {
        index, kind, round: kind === 'round' ? round : null, afterRound: kind === 'synthesis' ? round : null,
        order: kind === 'round' && step.order === 'sequential' ? 'sequential' : 'parallel',
        task: kind === 'synthesis' && !text(step.task) ? SYNTHESIS_TASK : text(step.task),
        input: kind === 'synthesis' ? 'previous' : (['none', 'previous', 'all'].includes(step.input) ? step.input : 'previous'),
        models: (step.models || []).map((model) => (typeof model === 'string' ? { name: model, extra: '' } : {
          name: model.name, extra: text(model.extra), task: typeof model.task === 'string' ? model.task : null, promptTemplate: typeof model.promptTemplate === 'string' ? model.promptTemplate : null,
          discipline: model.discipline ? { ...model.discipline } : null,
          maxWords: Number.isSafeInteger(model.maxWords) && model.maxWords > 0 ? model.maxWords : null
        }))
          .filter((model) => model.name)
      };
    }).filter((step) => step.models.length);
  }

  async function run({
    task, steps = [], maxAttempts = DEFAULT_ATTEMPTS, semiAuto = false, maxPromptChars = Infinity,
    accept = defaultAccept, parseAsks = null, askOwner = null, askInstruction = '', decide = null,
    send, signal = null, onEvent = null, onRequest = null, onResponse = null
  }) {
    if (typeof send !== 'function') throw new Error('custom_send_required');
    const emit = (kind, fields) => { if (typeof onEvent === 'function') onEvent(kind, fields); };
    const aborted = () => Boolean(signal?.aborted);
    const plan = normalizeSteps(steps);
    const ownerAnswers = [];
    const history = []; // every request: step, model, attempt, prompt, outcome
    const results = []; // per step: { step, outcome: { model: verdict }, skipped }
    let stopReason = 'steps_done';
    // The plan as the run sees it: a report shows what was intended, not only what happened.
    emit('custom_start', { semiAuto: Boolean(semiAuto), maxAttempts, taskChars: text(task).length,
      steps: plan.map((step) => ({ step: step.index, label: stepLabel(step), order: step.order, input: step.input, models: step.models.map((model) => model.name) })) });

    class StopRun extends Error { constructor(reason) { super(reason); this.stopReason = reason; } }

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

    // Accepted answers of a step, each with its source (step, model, attempt) for the record.
    const acceptedOf = (entry) => (entry?.skipped ? [] : entry.step.models.map((model) => entry.outcome[model.name])
      .filter((item) => item?.ok)
      .map((item) => ({ ...item, source: { step: entry.step.index, label: stepLabel(entry.step), model: item.model, attempt: item.attempt } })));
    function inputFor(step) {
      if (step.input === 'none') return [];
      if (step.input === 'all') {
        return results.flatMap((entry) => acceptedOf(entry).map((item, index) => ({ label: `${stepLabel(entry.step)}, ответ ${index + 1}`, text: item.text, source: item.source })));
      }
      for (let index = results.length - 1; index >= 0; index -= 1) {
        const accepted = acceptedOf(results[index]);
        if (accepted.length) return accepted.map((item) => ({ text: item.text, source: item.source }));
      }
      return [];
    }

    // Instructions (owner-editable behaviour) and input (data from other models) are kept apart.
    function partsFor(step, model, input, earlier) {
      return {
        instructions: { task: text(task), stepTask: model.task ?? step.task, extra: model.extra || '', askInstruction: semiAuto ? (model.discipline?.ask ?? askInstruction) : '',
          ownerAnswers: ownerAnswers.slice() },
        input: { mode: step.input, items: input, earlier }
      };
    }

    function promptFor(step, model, earlier) {
      const input = inputFor(step);
      const prompt = buildPrompt({ task, step, model, input, inputMode: step.input, earlier,
        ownerAnswers, askInstruction: semiAuto ? askInstruction : '' });
      if (prompt.length > maxPromptChars) throw new StopRun('context_full');
      return { prompt, parts: partsFor(step, model, input, earlier) };
    }

    // Sends `models` with their prompts, then corrections; fills `outcome`. Every attempt is a
    // history entry of its own: a retry never rewrites the attempt it follows, it refers to it.
    async function attempt(step, models, requests, outcome, firstAttempt = 1) {
      let pending = models.slice();
      let current = requests; // model → { prompt, parts, retryOf }
      for (let tryNo = firstAttempt; pending.length && tryNo < firstAttempt + maxAttempts; tryNo += 1) {
        if (aborted()) throw new StopRun('cancelled');
        const entries = Object.fromEntries(pending.map((name) => {
          const entry = { step: step.index, kind: step.kind, label: stepLabel(step), model: name, attempt: tryNo,
            retryOf: current[name].retryOf || null, prompt: current[name].prompt, parts: current[name].parts,
            state: 'sent', sentAt: Date.now() };
          history.push(entry);
          if (typeof onRequest === 'function') onRequest(entry);
          return [name, entry];
        }));
        let reply;
        try {
          reply = await send(pending, Object.fromEntries(pending.map((name) => [name, current[name].prompt])),
            { step: step.index, kind: step.kind, label: stepLabel(step), attempt: tryNo,
              maxWordsByModel: Object.fromEntries(pending.map((name) => [name, step.models.find((model) => model.name === name)?.maxWords || null])),
              correctionByModel: Object.fromEntries(pending.map((name) => [name, Boolean(current[name].parts?.correction)])) });
        } catch (error) {
          if (error?.code === 'context_full') {
            Object.values(entries).forEach((entry) => {
              Object.assign(entry, { state: 'not_sent', reason: 'context_full', finishedAt: Date.now() });
              if (typeof onResponse === 'function') onResponse(entry);
            });
            throw new StopRun('context_full');
          }
          if (error?.name === 'AbortError' || aborted()) throw new StopRun('cancelled');
          reply = { byModel: Object.fromEntries(pending.map((name) => [name, { text: '', status: String(error?.message || error) }])) };
        }
        const retry = [];
        pending.forEach((name) => {
          const result = reply?.byModel?.[name] || {};
          let verdict = judge(result, accept);
          if (!verdict.ok && reply?.closedByOwner && !text(result.text)) verdict = { ...verdict, reason: 'closed_by_owner' };
          outcome[name] = { ...verdict, model: name, status: result.status || '', attempt: tryNo, transportRequestId: result.transportRequestId || '' };
          Object.assign(entries[name], {
            state: 'done', finishedAt: Date.now(), sentPrompt: typeof result.sentPrompt === 'string' ? result.sentPrompt : null,
            answer: text(result.text), attribution: result.attribution || '', accepted: verdict.ok, reason: verdict.reason || '',
            status: result.status || '', transportRequestId: result.transportRequestId || ''
          });
          if (typeof onResponse === 'function') onResponse(entries[name]);
          emit('custom_answer', { step: step.index, label: stepLabel(step), model: name, attempt: tryNo, input: step.input,
            accepted: verdict.ok, reason: verdict.reason || null, status: result.status || null,
            transportRequestId: result.transportRequestId || null, promptChars: String(current[name].prompt || '').length });
          if (!verdict.ok && !reply?.closedByOwner) retry.push(name);
        });
        if (reply?.closedByOwner) return { closedByOwner: true };
        pending = retry;
        current = Object.fromEntries(retry.map((name) => [name, {
          prompt: correctionPrompt(outcome[name].reason, step.models.find((model) => model.name === name)?.discipline?.correction),
          parts: { correction: { reason: outcome[name].reason, text: correctionPrompt(outcome[name].reason, step.models.find((model) => model.name === name)?.discipline?.correction) } },
          retryOf: tryNo
        }]));
      }
      return { closedByOwner: false };
    }

    async function execute(step, models, outcome, firstAttempt = 1) {
      if (step.order === 'sequential') {
        for (const model of models) {
          // Only the models before this one in card order, also on a retry.
          const position = step.models.findIndex((item) => item.name === model.name);
          const earlier = step.models.slice(0, position).map((item) => outcome[item.name])
            .filter((item) => item?.ok)
            .map((item) => ({ text: item.text, source: { step: step.index, label: stepLabel(step), model: item.model, attempt: item.attempt } }));
          const reply = await attempt(step, [model.name], { [model.name]: { ...promptFor(step, model, earlier), retryOf: outcome[model.name]?.attempt || null } }, outcome, firstAttempt);
          if (reply.closedByOwner) {
            // The owner closed the step: the models after this one are not called.
            models.slice(models.indexOf(model) + 1).forEach((rest) => {
              outcome[rest.name] = { ok: false, reason: 'closed_by_owner', text: '', status: '', attempt: outcome[rest.name]?.attempt || 0, transportRequestId: '' };
            });
            break;
          }
        }
      } else {
        const requests = Object.fromEntries(models.map((model) => [model.name, { ...promptFor(step, model, []), retryOf: outcome[model.name]?.attempt || null }]));
        await attempt(step, models.map((model) => model.name), requests, outcome, firstAttempt);
      }
    }

    // The step in progress: on Stop its accepted answers are kept like those of finished steps.
    let current = null;
    try {
      for (const step of plan) {
        const outcome = {};
        const entry = { step, outcome, skipped: false };
        current = entry;
        await execute(step, step.models, outcome);
        const last = step === plan[plan.length - 1];
        for (;;) {
          const accepted = step.models.filter((model) => outcome[model.name]?.ok).map((model) => model.name);
          const failed = step.models.filter((model) => !outcome[model.name]?.ok).map((model) => model.name);
          emit('custom_step', { step: step.index, label: stepLabel(step), accepted: accepted.length, failed: failed.length });
          if (accepted.length && !semiAuto) break;
          if (accepted.length && semiAuto && last && !failed.length) break;
          const choices = accepted.length ? ['continue', ...(failed.length ? ['retry'] : []), 'stop'] : ['retry', 'skip', 'stop'];
          const action = typeof decide === 'function'
            ? await ownerWait(() => decide({ step: step.index, label: stepLabel(step), accepted, failed, choices, last,
              reasons: Object.fromEntries(failed.map((name) => [name, outcome[name]?.reason || ''])) }))
            : null;
          if (!choices.includes(action)) { if (accepted.length) break; throw new StopRun('no_decision'); }
          emit('custom_decision', { step: step.index, action });
          if (action === 'continue') break;
          if (action === 'stop') throw new StopRun('stopped');
          if (action === 'skip') { entry.skipped = true; break; }
          const firstAttempt = Math.max(0, ...failed.map((name) => outcome[name]?.attempt || 0)) + 1;
          await execute(step, step.models.filter((model) => failed.includes(model.name)), outcome, firstAttempt);
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
      if (current && acceptedOf(current).length) results.push(current);
    }
    if (aborted() && stopReason === 'steps_done') stopReason = 'cancelled';
    emit('custom_end', { stopReason, steps: results.length });
    return {
      steps: results.map((entry) => ({ index: entry.step.index, kind: entry.step.kind, label: stepLabel(entry.step), skipped: entry.skipped, outcome: entry.outcome })),
      answers: inputFor({ input: 'previous' }).map((item) => item.text),
      history, ownerAnswers, stopReason
    };
  }

  // Before a run there is no exact prompt yet: the template shows what is known and marks the data
  // that will come from other models. Transport instructions are edited separately from the main request.
  const PLACEHOLDER = Object.freeze({
    previous: '‹ответы предыдущего шага появятся при запуске›',
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
    const model = step.models.find((item) => item.name === modelName) || { name: modelName, extra: '' };
    const input = step.input === 'none' || !plan.some((item) => item.index < step.index) ? []
      : [{ label: 'Вход', text: PLACEHOLDER[step.input] || PLACEHOLDER.previous }];
    const position = step.models.findIndex((item) => item.name === model.name);
    const earlier = step.order === 'sequential' && position > 0 ? [{ text: PLACEHOLDER.earlier }] : [];
    const prompt = buildPrompt({ task, step, model, input, inputMode: step.input, earlier, ownerAnswers: [],
      askInstruction: semiAuto ? askInstruction : '' });
    const template = typeof model.promptTemplate === 'string' && model.promptTemplate.trim() ? model.promptTemplate
      : buildPrompt({ task: '{задача}', step, model, input: input.length ? [{ label: 'Вход', text: '{вход}' }] : [],
        inputMode: step.input, earlier: earlier.length ? [{ text: '{ответы до тебя}' }] : [] });
    return { label: stepLabel(step), order: step.order, inputMode: step.input, prompt, template, transportLines: TRANSPORT_LINES.slice(),
      instructions: { task: text(task), stepTask: model.task ?? step.task, extra: model.extra || '', askInstruction: semiAuto ? askInstruction : '' } };
  }

  const api = Object.freeze({ DEFAULT_ATTEMPTS, CORRECTION_TEMPLATE, SYNTHESIS_TASK, STOP_TEXT, REASON_TEXT, resolveSetting, PLACEHOLDER, TRANSPORT_LINES, buildPrompt, correctionPrompt, normalizeSteps, previewPrompt, run });
  root.CustomEngine = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
