// shared/basic-telemetry.js
// Basic owns the execution record; transport observations are joined by explicit IDs only.
(function initBasicTelemetry(root) {
  'use strict';
  const list = (value) => Array.isArray(value) ? value : [];

  function classifyEntry(entry, runId, requestIds) {
    if (!entry || typeof entry !== 'object') {
      return { runSelection: 'invalid', selectionReason: 'invalid_entry', attemptCorrelation: 'unassigned', correlationReason: 'invalid_entry', entry };
    }

    const scopes = [entry, entry.meta, entry.correlation].filter(Boolean);
    const runKeys = ['pipelineRunId', 'debateRunId', 'runId'];
    const explicitRuns = Array.from(new Set(scopes.flatMap(s => runKeys.map(k => s[k]).filter(Boolean))));

    let runSelection;
    let selectionReason;

    // 1. Determine runSelection
    if (explicitRuns.length > 1) {
      runSelection = 'unassigned';
      selectionReason = 'conflicting_run_ids';
    } else if (explicitRuns.length === 1 && explicitRuns[0] !== runId) {
      runSelection = 'otherRun';
      selectionReason = 'other_run_identity';
    } else if (explicitRuns.length === 1 && explicitRuns[0] === runId) {
      runSelection = 'selected';
      selectionReason = 'explicit_run_id';
    } else if (scopes.some(s =>
      String(s.stageId || '').startsWith(`custom:${runId}:`)
      || String(s.batchId || s.pipelineBatchId || '').startsWith(`${runId}:`)
    )) {
      runSelection = 'selected';
      selectionReason = 'run_scoped_stage_or_batch';
    } else if (scopes.some(s =>
      [s.requestId, s.transportRequestId].some(id => id && requestIds.has(id))
    )) {
      runSelection = 'selected';
      selectionReason = 'known_attempt_request_id';
    } else {
      runSelection = 'unassigned';
      selectionReason = 'missing_run_identity';
    }

    // 2. Determine attemptCorrelation independently
    let attemptCorrelation = entry.attemptCorrelation || null;
    let correlationReason = entry.correlationReason || null;

    if (!attemptCorrelation) {
      const explicitReqId = scopes.map((s) => s.transportRequestId || s.requestId).find(Boolean) || null;
      if (explicitReqId && requestIds.has(explicitReqId)) {
        attemptCorrelation = 'linked';
      } else if (explicitReqId) {
        attemptCorrelation = 'unassigned';
        correlationReason = correlationReason || 'unknown_request_id';
      } else {
        attemptCorrelation = 'unassigned';
        correlationReason = correlationReason || 'missing_request_id';
      }
    } else if (attemptCorrelation === 'conflict' && !correlationReason) {
      correlationReason = 'attempt_conflict';
    }

    const enrichedEntry = {
      ...entry,
      runSelection,
      attemptCorrelation,
      ...(correlationReason ? { correlationReason } : {})
    };

    if (explicitRuns.length > 1) {
      enrichedEntry.runConflictEvidence = explicitRuns;
    }

    return {
      runSelection,
      selectionReason,
      attemptCorrelation,
      correlationReason,
      entry: enrichedEntry
    };
  }

  function processSource(rawList, runId, requestIds) {
    const selected = [];
    const unassigned = [];
    let otherRun = 0;
    let invalid = 0;

    rawList.forEach((item) => {
      const classified = classifyEntry(item, runId, requestIds);
      if (classified.runSelection === 'selected') {
        selected.push(classified.entry);
      } else if (classified.runSelection === 'unassigned') {
        unassigned.push(classified.entry ? { ...classified.entry, selectionReason: classified.selectionReason } : { selectionReason: classified.selectionReason });
      } else if (classified.runSelection === 'otherRun') {
        otherRun += 1;
      } else {
        invalid += 1;
      }
    });

    const totalScanned = rawList.length;
    const selection = {
      basis: 'explicit_run_or_request_identity',
      sourceRetained: totalScanned,
      totalScanned,
      selected: selected.length,
      unassigned: unassigned.length,
      otherRun,
      invalid,
      excluded: unassigned.length + otherRun + invalid
    };

    return { selected, unassigned, selection };
  }

  function buildReport({ customRun, delivery = null, events = [], executionActive = false, extensionVersion = null, exportedAt = new Date().toISOString() }) {
    if (!customRun?.runId) throw new Error('Basic run record required');
    const runId = customRun.runId;
    const requestIds = new Set(list(customRun.attempts).map(a => a.transportRequestId).filter(Boolean));

    const rawJournal = list(delivery?.journal);
    const rawEvents = list(events);

    // Initial pass to discover request IDs belonging to this run
    rawJournal.forEach((entry) => {
      if (!entry || typeof entry !== 'object') return;
      const scopes = [entry, entry.meta, entry.correlation].filter(Boolean);
      const runKeys = ['pipelineRunId', 'debateRunId', 'runId'];
      const explicitRuns = Array.from(new Set(scopes.flatMap(s => runKeys.map(k => s[k]).filter(Boolean))));
      if (explicitRuns.some(id => id !== runId)) return;
      const belongs = (explicitRuns.length === 1 && explicitRuns[0] === runId) || scopes.some(s =>
        String(s.stageId || '').startsWith(`custom:${runId}:`)
        || String(s.batchId || s.pipelineBatchId || '').startsWith(`${runId}:`)
        || [s.requestId, s.transportRequestId].some(id => id && requestIds.has(id))
      );
      if (belongs && entry.requestIds && typeof entry.requestIds === 'object') {
        Object.values(entry.requestIds).filter(Boolean).forEach((id) => requestIds.add(id));
      }
      if (belongs && entry.kind === 'prepared') {
        if (entry.requestId) requestIds.add(entry.requestId);
        if (entry.transportRequestId) requestIds.add(entry.transportRequestId);
      }
    });

    const deliveryProcessed = processSource(rawJournal, runId, requestIds);
    const telemetryProcessed = processSource(rawEvents, runId, requestIds);

    const rounds = buildRoundsSummary({
      customRun,
      events: telemetryProcessed.selected,
      journal: deliveryProcessed.selected,
      executionActive
    });
    const usage = buildUsage({ customRun, rounds });
    const diagnosis = buildDiagnosis(deliveryProcessed.selected, { extensionVersion, exportedAt });

    return {
      format: 'basic-telemetry/3',
      extensionVersion,
      exportedAt,
      runId,
      executionActive,
      customRun,
      rounds,
      usage,
      delivery: {
        journal: deliveryProcessed.selected,
        unassigned: deliveryProcessed.unassigned,
        selection: deliveryProcessed.selection,
        ...diagnosis,
        collection: delivery?.collection || null
      },
      telemetry: {
        events: telemetryProcessed.selected,
        unassigned: telemetryProcessed.unassigned,
        selection: telemetryProcessed.selection
      }
    };
  }

  // The delivery verdict of the run (MessageDeliveryDiagnosis, loaded on the pipeline panel) computed over the run's own
  // journal. Only joinable facts stay: texts (prompt, answer, html) are removed and a journal event is named by its path in
  // delivery.journal instead of being copied. Without the module the verdict is null: it is never guessed.
  const DIAGNOSIS_TEXT_KEYS = new Set(['prompt', 'sentPrompt', 'answer', 'answerHtml', 'answerArtifacts', 'promptArtifact', 'text', 'html']);
  const PROBLEM_FIELDS = ['code', 'severity', 'model', 'at', 'title', 'detail', 'hint', 'reason', 'count'];

  function buildDiagnosis(journal, { extensionVersion, exportedAt }) {
    const api = root.MessageDeliveryDiagnosis;
    if (!api || typeof api.diagnose !== 'function') return { diagnosis: null };
    try {
      const now = Date.parse(exportedAt);
      const result = api.diagnose(journal, { version: extensionVersion || null, ...(Number.isFinite(now) ? { now } : {}) });
      const paths = new Map(journal.map((entry, index) => [entry, `delivery.journal[${index}]`]));
      const compact = (value) => {
        if (Array.isArray(value)) return value.map(compact);
        if (!value || typeof value !== 'object') return value;
        const own = Object.fromEntries(Object.entries(value).filter(([key]) => !DIAGNOSIS_TEXT_KEYS.has(key)).map(([key, item]) => [key, compact(item)]));
        return paths.has(value) ? { journalPath: paths.get(value), ...own } : own;
      };
      return {
        diagnosis: {
          sends: list(result.sends).map(compact),
          problems: list(result.problems).map((problem) => ({
            ...Object.fromEntries(PROBLEM_FIELDS.filter((key) => problem[key] !== undefined).map((key) => [key, problem[key]])),
            ...(problem.batchId ? { batchId: problem.batchId } : {}),
            ...(problem.requestId ? { requestId: problem.requestId } : {})
          }))
        }
      };
    } catch (error) {
      return { diagnosis: null, diagnosisError: String(error?.message || error) };
    }
  }

  function computeNonOverlappingWaitDuration(waits) {
    const intervals = [];
    for (const w of waits) {
      const s = typeof w.startedAt === 'number' ? w.startedAt : (w.startedAt ? Date.parse(w.startedAt) : null);
      const e = typeof w.endedAt === 'number' ? w.endedAt : (w.endedAt ? Date.parse(w.endedAt) : null);
      if (typeof s === 'number' && !isNaN(s) && typeof e === 'number' && !isNaN(e) && e >= s) {
        intervals.push([s, e]);
      }
    }
    if (!intervals.length) return 0;
    intervals.sort((a, b) => a[0] - b[0]);
    let total = 0;
    let [currStart, currEnd] = intervals[0];
    for (let i = 1; i < intervals.length; i++) {
      const [start, end] = intervals[i];
      if (start <= currEnd) {
        currEnd = Math.max(currEnd, end);
      } else {
        total += (currEnd - currStart);
        currStart = start;
        currEnd = end;
      }
    }
    total += (currEnd - currStart);
    return total;
  }

  // The models a step expects, as { participant, model, idKnown }. The run record keeps only model names for a step; the
  // participant ids live in the schema of the snapshot (the run's own schema), so it is read from there when the counts agree.
  function expectedModelsOf(customRun, step) {
    const own = list(step.models);
    const asEntry = (m, idKnown) => ({ participant: typeof m === 'string' ? m : (m?.id ?? m?.name), model: typeof m === 'string' ? m : (m?.name ?? null), idKnown });
    if (own.length && own.every((m) => m && typeof m === 'object')) return own.map((m) => asEntry(m, true));
    const schema = customRun.snapshot?.schema;
    const schemaSteps = Array.isArray(schema) ? schema : list(schema?.steps);
    const schemaModels = list(schemaSteps.find((s) => s && step.ref && s.ref === step.ref)?.models).filter((m) => m && m.enabled !== false);
    if (schemaModels.length && schemaModels.length === own.length) return schemaModels.map((m) => asEntry(m, true));
    return own.map((m) => asEntry(m, false));
  }

  // The owner (User) step has no attempts: what happened is in the record of the run itself (the accepted answer is kept in
  // the snapshot), in the waits of the step and in the events of the owner window.
  function ownerParticipant({ customRun, stepRef, visit, visitWaits, visitEvents, ownerEvents, executionActive }) {
    const snapshot = customRun.snapshot || {};
    const isThis = (item) => item && item.stepRef === stepRef && (item.visit || 1) === visit && item.owner;
    const endEvt = visitEvents.find((e) => (e.kind || e.name) === 'custom_step_end');
    const ownerWaits = visitWaits.filter((w) => w.kind === 'owner');
    const lastWait = ownerWaits[ownerWaits.length - 1] || null;
    const rejection = ownerEvents[ownerEvents.length - 1];
    let outcome;
    let reason = null;
    if (list(snapshot.results).some(isThis) || isThis(snapshot.current) || endEvt?.accepted === 1) {
      outcome = 'accepted';
    } else if (executionActive && ownerWaits.some((w) => w.endedAt == null)) {
      outcome = 'in_flight';
    } else if (rejection && rejection.accepted === false) {
      outcome = 'rejected';
      reason = rejection.reason || null;
    } else if (lastWait) {
      outcome = 'no_answer';
      reason = lastWait.endedAt == null ? 'unclosed_wait' : (lastWait.outcome || null);
    } else {
      outcome = 'no_attempt';
    }
    return { participant: 'owner', model: null, outcome, reason, status: null, attempts: null, transportRequestId: null };
  }

  // One entry per participant of the visit: the expected ones in schema order, then any other that has attempts. The outcome
  // follows the latest attempt (an accepted answer stays accepted). Nothing is inferred: no record of a fact means no_attempt.
  function participantsOf({ expected, visitAttempts, executionActive }) {
    const groups = new Map();
    visitAttempts.forEach((a) => {
      const id = a.participant || a.model;
      if (!groups.has(id)) groups.set(id, []);
      groups.get(id).push(a);
    });
    const claimed = new Set();
    const slots = [];
    expected.forEach((e) => {
      let participant = e.participant;
      // A step known only by model names: its attempts are found by the model when no attempt carries the name as its id.
      if (!e.idKnown && !groups.has(participant)) {
        const alt = [...groups.keys()].find((id) => !claimed.has(id) && !expected.some((x) => x.participant === id) && groups.get(id)[0].model === e.model);
        if (alt !== undefined) participant = alt;
      }
      if (claimed.has(participant)) return;
      claimed.add(participant);
      slots.push({ participant, model: e.model });
    });
    groups.forEach((items, id) => { if (!claimed.has(id)) slots.push({ participant: id, model: items[0].model ?? null }); });

    return slots.map(({ participant, model }) => {
      // Latest first: by attempt number, then by the order of the record.
      const ordered = (groups.get(participant) || []).map((a, i) => ({ a, i }))
        .sort((x, y) => (Number(x.a.attempt) || 0) - (Number(y.a.attempt) || 0) || x.i - y.i).map((x) => x.a);
      if (!ordered.length) return { participant, model: model ?? null, outcome: 'no_attempt', reason: null, status: null, attempts: 0, transportRequestId: null };
      const accepted = ordered.filter((a) => a.accepted === true);
      const decisive = accepted.length ? accepted[accepted.length - 1] : ordered[ordered.length - 1];
      let outcome;
      if (accepted.length) outcome = 'accepted';
      else if (decisive.state === 'done') outcome = 'rejected';
      else if (decisive.state === 'not_sent') outcome = 'not_sent';
      else if (decisive.state === 'sent' && executionActive) outcome = 'in_flight';
      else outcome = 'no_answer'; // unknown, and a sent attempt of a run that is no longer executing
      return { participant, model: decisive.model ?? model ?? null, outcome, reason: decisive.reason || null, status: decisive.status || null,
        attempts: ordered.length, transportRequestId: decisive.transportRequestId || null };
    });
  }

  // An attempt counts as a sent request when the record confirms the dispatch (not_sent or cancelled before dispatch do not).
  function isConfirmedSent(a) {
    if (a.state === 'not_sent' || a.reason === 'cancelled_before_dispatch') return false;
    if (a.state === 'done' || a.state === 'sent') return true;
    if (a.state === 'unknown' && typeof a.sentAt === 'number') return true;
    return false;
  }

  // Totals of the run for the export: sums of the rounds and attempts, nothing judged. Missing text counts as zero.
  function buildUsage({ customRun, rounds = [] }) {
    const chars = (text) => typeof text === 'string' ? text.length : 0;
    const modelRounds = list(rounds).filter((r) => r.kind !== 'owner');
    const participants = modelRounds.flatMap((r) => list(r.participants));
    const attempts = list(customRun?.attempts);
    const participantsExpected = modelRounds.reduce((sum, r) => sum + list(r.expectedParticipants).length, 0);
    const participantsAccepted = participants.filter((p) => p.outcome === 'accepted').length;
    const byModel = {};
    attempts.forEach((a) => {
      const name = a.model || 'unknown';
      if (!byModel[name]) byModel[name] = { requestsSent: 0, accepted: 0 };
      if (isConfirmedSent(a)) byModel[name].requestsSent += 1;
      if (a.accepted === true) byModel[name].accepted += 1;
    });
    const { startedAt, finishedAt } = customRun || {};
    return {
      requestsSent: modelRounds.reduce((sum, r) => sum + (r.sentCount || 0), 0),
      attempts: modelRounds.reduce((sum, r) => sum + (r.attemptCount || 0), 0),
      participantsExpected,
      participantsAccepted,
      participantsWithoutAnswer: participantsExpected - participantsAccepted,
      ownerWaitMs: list(rounds).reduce((sum, r) => sum + (typeof r.userWaitDurationMs === 'number' ? r.userWaitDurationMs : 0), 0),
      ownerWaitUnknown: list(rounds).some((r) => r.userWaitDurationMs === null),
      durationMs: typeof startedAt === 'number' && typeof finishedAt === 'number' ? finishedAt - startedAt : null,
      promptChars: attempts.filter(isConfirmedSent).reduce((sum, a) => sum + chars(a.sentPrompt || a.prompt), 0),
      answerChars: attempts.filter((a) => a.accepted === true).reduce((sum, a) => sum + chars(a.answer), 0),
      byModel
    };
  }

  function buildRoundsSummary({ customRun, events = [], journal = [], executionActive = false }) {
    if (!customRun) return [];
    const steps = list(customRun.steps);
    const attempts = list(customRun.attempts);
    const waits = list(customRun.waits);
    const hasWaitRecords = Array.isArray(customRun.waits);
    const allEvents = [...list(events), ...list(journal)];
    const toMs = (v) => typeof v === 'number' ? v : (v ? Date.parse(v) : null);

    const rounds = [];
    steps.forEach((step, index) => {
      const stepRef = step.ref || `#${index}`;
      const stepAttempts = attempts.filter((a) => a.ref === stepRef || a.step === index);
      const stepWaits = waits.filter((w) => w.stepRef === stepRef || w.stepRef === index);
      const isStepEvt = (e) => {
        const k = String(e.kind || e.name || '');
        if (k.startsWith('custom_step')) return true;
        if ((k === 'round' || k === 'owner') && (e.startedAt != null || e.endedAt != null || e.outcome != null)) return true;
        return false;
      };
      const stepEvents = allEvents.filter((e) => (e.step === index || e.ref === stepRef) && isStepEvt(e));

      // Find all visits for this step
      const visitSet = new Set([1]);
      stepAttempts.forEach((a) => { if (a.visit) visitSet.add(a.visit); });
      stepWaits.forEach((w) => { if (w.visit) visitSet.add(w.visit); });
      stepEvents.forEach((e) => { if (e.visit) visitSet.add(e.visit); });

      const sortedVisits = Array.from(visitSet).sort((a, b) => a - b);
      sortedVisits.forEach((visit) => {
        const visitAttempts = stepAttempts.filter((a) => (a.visit || 1) === visit);
        const visitWaits = stepWaits.filter((w) => (w.visit || 1) === visit);
        const visitEvents = stepEvents.filter((e) => (e.visit || 1) === visit);

        const startEvt = visitEvents.find((e) => {
          const k = e.kind || e.name;
          return k === 'custom_step_start' || k === 'custom_step_resumed' || ((k === 'round' || k === 'owner') && e.startedAt != null && e.endedAt == null);
        });
        const endEvt = visitEvents.find((e) => {
          const k = e.kind || e.name;
          return k === 'custom_step_end' || ((k === 'round' || k === 'owner') && e.endedAt != null && e.outcome !== 'stopped' && e.outcome !== 'failed' && e.outcome !== 'cancelled');
        });
        const interruptedEvt = visitEvents.find((e) => {
          const k = e.kind || e.name;
          return k === 'custom_step_interrupted' || ((k === 'round' || k === 'owner') && ['stopped', 'failed', 'cancelled'].includes(e.outcome));
        });

        // The start is the engine's own boundary event; the time an attempt was prepared is not the start of the step.
        const startedAt = startEvt ? (typeof startEvt.startedAt === 'number' ? startEvt.startedAt : toMs(startEvt.at)) : null;
        const endedAt = endEvt ? (typeof endEvt.endedAt === 'number' ? endEvt.endedAt : toMs(endEvt.at)) : (interruptedEvt ? (typeof interruptedEvt.at === 'number' ? interruptedEvt.at : toMs(interruptedEvt.at)) : null);
        const outcome = endEvt ? (endEvt.outcome || 'completed') : (interruptedEvt ? (interruptedEvt.outcome || 'interrupted') : null);
        const durationMs = startedAt != null && endedAt != null && endedAt >= startedAt ? (endedAt - startedAt) : null;

        const sentCount = visitAttempts.filter(isConfirmedSent).length;

        const hasOpenWait = visitWaits.some((w) => w.endedAt == null);
        let userWaitDurationMs = null;
        let userWaitDurationReason = null;
        if (hasOpenWait) {
          userWaitDurationMs = null;
          userWaitDurationReason = 'unclosed_wait';
        } else if (visitWaits.length > 0) {
          userWaitDurationMs = computeNonOverlappingWaitDuration(visitWaits);
        } else if (!hasWaitRecords) {
          // An old record has no waits at all: the time spent on the User is not known, it is not zero.
          userWaitDurationMs = null;
          userWaitDurationReason = 'no_wait_records';
        } else {
          userWaitDurationMs = 0;
        }

        const isOwner = step.kind === 'owner';
        const expected = isOwner ? [{ participant: 'owner', model: null, idKnown: true }] : expectedModelsOf(customRun, step);
        const ownerEvents = isOwner
          ? allEvents.filter((e) => (e.step === index || e.ref === stepRef) && (e.kind || e.name) === 'custom_owner' && (e.visit || 1) === visit)
          : [];
        const participants = isOwner
          ? [ownerParticipant({ customRun, stepRef, visit, visitWaits, visitEvents, ownerEvents, executionActive })]
          : participantsOf({ expected, visitAttempts, executionActive });

        rounds.push({
          stepRef,
          index,
          kind: step.kind || 'round',
          label: isOwner ? `Шаг User (${stepRef})` : `Раунд ${index + 1}`,
          visit,
          expectedParticipants: expected.map((e) => e.participant),
          participants,
          attemptCount: visitAttempts.length,
          sentCount,
          startedAt,
          endedAt,
          outcome,
          durationMs,
          waitIds: visitWaits.map((w) => w.waitId).filter(Boolean),
          userWaitDurationMs,
          ...(userWaitDurationReason ? { userWaitDurationReason } : {})
        });
      });
    });

    return rounds;
  }

  root.BasicTelemetry = Object.freeze({ buildReport, buildUsage });
  if (typeof module !== 'undefined' && module.exports) module.exports = root.BasicTelemetry;
})(typeof window !== 'undefined' ? window : globalThis);
