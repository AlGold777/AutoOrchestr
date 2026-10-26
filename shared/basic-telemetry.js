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
      journal: deliveryProcessed.selected
    });

    return {
      format: 'basic-telemetry/2',
      extensionVersion,
      exportedAt,
      runId,
      executionActive,
      customRun,
      rounds,
      delivery: {
        journal: deliveryProcessed.selected,
        unassigned: deliveryProcessed.unassigned,
        selection: deliveryProcessed.selection,
        collection: delivery?.collection || null
      },
      telemetry: {
        events: telemetryProcessed.selected,
        unassigned: telemetryProcessed.unassigned,
        selection: telemetryProcessed.selection
      }
    };
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

  function buildRoundsSummary({ customRun, events = [], journal = [] }) {
    if (!customRun) return [];
    const steps = list(customRun.steps);
    const attempts = list(customRun.attempts);
    const waits = list(customRun.waits);
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

        const startedAt = startEvt ? (typeof startEvt.startedAt === 'number' ? startEvt.startedAt : toMs(startEvt.at)) : (visitAttempts[0]?.sentAt ?? null);
        const endedAt = endEvt ? (typeof endEvt.endedAt === 'number' ? endEvt.endedAt : toMs(endEvt.at)) : (interruptedEvt ? (typeof interruptedEvt.at === 'number' ? interruptedEvt.at : toMs(interruptedEvt.at)) : null);
        const outcome = endEvt ? (endEvt.outcome || 'completed') : (interruptedEvt ? (interruptedEvt.outcome || 'interrupted') : null);
        const durationMs = startedAt != null && endedAt != null && endedAt >= startedAt ? (endedAt - startedAt) : null;

        const acceptedParticipants = Array.from(new Set(visitAttempts.filter((a) => a.accepted === true).map((a) => a.participant || a.model)));
        const failedParticipants = Array.from(new Set(visitAttempts.filter((a) => a.accepted === false && a.state === 'done').map((a) => a.participant || a.model))).filter((p) => !acceptedParticipants.includes(p));

        const isConfirmedSent = (a) => {
          if (a.state === 'not_sent' || a.reason === 'cancelled_before_dispatch') return false;
          if (a.state === 'done' || a.state === 'sent') return true;
          if (a.state === 'unknown' && typeof a.sentAt === 'number') return true;
          return false;
        };
        const sentCount = visitAttempts.filter(isConfirmedSent).length;

        const hasOpenWait = visitWaits.some((w) => w.endedAt == null);
        let userWaitDurationMs = null;
        let userWaitDurationReason = null;
        if (hasOpenWait) {
          userWaitDurationMs = null;
          userWaitDurationReason = 'unclosed_wait';
        } else if (visitWaits.length > 0) {
          userWaitDurationMs = computeNonOverlappingWaitDuration(visitWaits);
        } else {
          userWaitDurationMs = 0;
        }

        rounds.push({
          stepRef,
          index,
          kind: step.kind || 'round',
          label: step.kind === 'owner' ? `Шаг User (${stepRef})` : `Раунд ${index + 1}`,
          visit,
          expectedParticipants: step.models ? step.models.map((m) => (typeof m === 'string' ? m : (m.id || m.name))) : (step.kind === 'owner' ? ['owner'] : []),
          participantResults: {
            accepted: acceptedParticipants,
            failed: failedParticipants
          },
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

  root.BasicTelemetry = Object.freeze({ buildReport });
  if (typeof module !== 'undefined' && module.exports) module.exports = root.BasicTelemetry;
})(typeof window !== 'undefined' ? window : globalThis);
