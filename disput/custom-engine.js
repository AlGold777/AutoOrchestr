// Custom engine: the shared pipeline workhorse. A run is one sequence of steps; the canvas shows
// them as round cards and synthesis inserts, the engine knows only steps. Meaning (answer, critique,
// improvement, check, synthesis) comes from the step's task; the engine executes and passes data.
//
// Step: { kind: 'round' | 'synthesis', order: 'parallel' | 'sequential', task, input, models }
//   models: [{ name, extra }] — card order is call order; extra is the model's optional addition.
//   input: 'none' | 'previous' | 'all'. The run's task is always sent.
//     previous — accepted answers of the last step that has any (a synthesis replaces the round
//                before it; a skipped step passes nothing on);
//     all      — every accepted answer of all earlier steps, rounds and syntheses alike.
//   sequential — each model also gets the accepted answers of the models before it in this step;
//   parallel   — every model gets the same input.
// Discipline: send(models, promptsByModel, meta) → { byModel: { model: { text, status, answered,
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

  function buildPrompt({ task, step, model, input = [], inputMode = 'none', earlier = [], ownerAnswers = [], askInstruction = '' }) {
    const parts = [`Задача:\n${text(task)}`];
    if (input.length) {
      parts.push(inputMode === 'all'
        ? `Принятые ответы всех предыдущих шагов:\n\n${labelled(input)}`
        : `Ответы предыдущего шага:\n\n${numbered(input)}`);
    }
    if (earlier.length) parts.push(`Ответы участников этого раунда до тебя:\n\n${numbered(earlier)}`);
    if (text(step.task)) parts.push(`Задание:\n${text(step.task)}`);
    if (text(model.extra)) parts.push(`Дополнительно для тебя:\n${text(model.extra)}`);
    if (ownerAnswers.length) parts.push(`Ответы владельца на вопросы:\n${ownerAnswers.map((item) => `- ${item.question}: ${item.answer}`).join('\n')}`);
    if (askInstruction) parts.push(askInstruction);
    return parts.join('\n\n');
  }

  const correctionPrompt = (reason) => `Твой предыдущий ответ ${REASON_TEXT[reason] || 'не принят'}. Дай ответ на задание полностью.`;

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
        models: (step.models || []).map((model) => (typeof model === 'string' ? { name: model, extra: '' } : { name: model.name, extra: text(model.extra) }))
          .filter((model) => model.name)
      };
    }).filter((step) => step.models.length);
  }

  async function run({
    task, steps = [], maxAttempts = DEFAULT_ATTEMPTS, semiAuto = false, maxPromptChars = Infinity,
    accept = defaultAccept, parseAsks = null, askOwner = null, askInstruction = '', decide = null,
    send, signal = null, onEvent = null
  }) {
    if (typeof send !== 'function') throw new Error('custom_send_required');
    const emit = (kind, fields) => { if (typeof onEvent === 'function') onEvent(kind, fields); };
    const aborted = () => Boolean(signal?.aborted);
    const plan = normalizeSteps(steps);
    const ownerAnswers = [];
    const history = []; // every request: step, model, attempt, prompt, outcome
    const results = []; // per step: { step, outcome: { model: verdict }, skipped }
    let stopReason = 'steps_done';

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

    const acceptedOf = (entry) => (entry?.skipped ? [] : entry.step.models.map((model) => entry.outcome[model.name])
      .filter((item) => item?.ok));
    function inputFor(step) {
      if (step.input === 'none') return [];
      if (step.input === 'all') {
        return results.flatMap((entry) => acceptedOf(entry).map((item, index) => ({ label: `${stepLabel(entry.step)}, ответ ${index + 1}`, text: item.text })));
      }
      for (let index = results.length - 1; index >= 0; index -= 1) {
        const accepted = acceptedOf(results[index]);
        if (accepted.length) return accepted.map((item) => ({ text: item.text }));
      }
      return [];
    }

    function promptFor(step, model, earlier) {
      const prompt = buildPrompt({ task, step, model, input: inputFor(step), inputMode: step.input, earlier,
        ownerAnswers, askInstruction: semiAuto ? askInstruction : '' });
      if (prompt.length > maxPromptChars) throw new StopRun('context_full');
      return prompt;
    }

    // Sends `models` with their prompts, then corrections; fills `outcome`.
    async function attempt(step, models, promptsByModel, outcome, firstAttempt = 1) {
      let pending = models.slice();
      let prompts = promptsByModel;
      for (let tryNo = firstAttempt; pending.length && tryNo < firstAttempt + maxAttempts; tryNo += 1) {
        if (aborted()) throw new StopRun('cancelled');
        let reply;
        try {
          reply = await send(pending, prompts, { step: step.index, kind: step.kind, label: stepLabel(step), attempt: tryNo });
        } catch (error) {
          if (error?.name === 'AbortError' || aborted()) throw new StopRun('cancelled');
          reply = { byModel: Object.fromEntries(pending.map((name) => [name, { text: '', status: String(error?.message || error) }])) };
        }
        const retry = [];
        pending.forEach((name) => {
          const result = reply?.byModel?.[name] || {};
          let verdict = judge(result, accept);
          if (!verdict.ok && reply?.closedByOwner && !text(result.text)) verdict = { ...verdict, reason: 'closed_by_owner' };
          outcome[name] = { ...verdict, status: result.status || '', attempt: tryNo, transportRequestId: result.transportRequestId || '' };
          history.push({ step: step.index, label: stepLabel(step), model: name, attempt: tryNo, prompt: prompts[name],
            accepted: verdict.ok, reason: verdict.reason || '', status: result.status || '', transportRequestId: result.transportRequestId || '' });
          emit('custom_answer', { step: step.index, label: stepLabel(step), model: name, attempt: tryNo, input: step.input,
            accepted: verdict.ok, reason: verdict.reason || null, status: result.status || null,
            transportRequestId: result.transportRequestId || null, promptChars: String(prompts[name] || '').length });
          if (!verdict.ok && !reply?.closedByOwner) retry.push(name);
        });
        if (reply?.closedByOwner) return { closedByOwner: true };
        pending = retry;
        prompts = Object.fromEntries(retry.map((name) => [name, correctionPrompt(outcome[name].reason)]));
      }
      return { closedByOwner: false };
    }

    async function execute(step, models, outcome, firstAttempt = 1) {
      if (step.order === 'sequential') {
        for (const model of models) {
          // Only the models before this one in card order, also on a retry.
          const position = step.models.findIndex((item) => item.name === model.name);
          const earlier = step.models.slice(0, position).map((item) => outcome[item.name])
            .filter((item) => item?.ok).map((item) => ({ text: item.text }));
          const reply = await attempt(step, [model.name], { [model.name]: promptFor(step, model, earlier) }, outcome, firstAttempt);
          if (reply.closedByOwner) {
            // The owner closed the step: the models after this one are not called.
            models.slice(models.indexOf(model) + 1).forEach((rest) => {
              outcome[rest.name] = { ok: false, reason: 'closed_by_owner', text: '', status: '', attempt: outcome[rest.name]?.attempt || 0, transportRequestId: '' };
            });
            break;
          }
        }
      } else {
        const prompts = Object.fromEntries(models.map((model) => [model.name, promptFor(step, model, [])]));
        await attempt(step, models.map((model) => model.name), prompts, outcome, firstAttempt);
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

  const api = Object.freeze({ DEFAULT_ATTEMPTS, SYNTHESIS_TASK, STOP_TEXT, REASON_TEXT, buildPrompt, correctionPrompt, normalizeSteps, run });
  root.CustomEngine = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
