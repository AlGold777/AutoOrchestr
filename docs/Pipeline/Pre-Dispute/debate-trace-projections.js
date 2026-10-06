// Pure report projections for the Disput UI and exports.
(function initDebateTraceProjections(root) {
  'use strict';

  const severityRank = Object.freeze({ debug: 0, info: 1, warning: 2, high: 3, critical: 4 });
  const terminalStageEvents = new Set(['STAGE_COMPLETED', 'STAGE_FAILED', 'STAGE_SKIPPED']);
  const recoveryTypes = new Set([
    'RECOVERY_REQUIRED', 'RECOVERY_ATTEMPT_STARTED', 'RECOVERY_ATTEMPT_FAILED',
    'RECOVERY_ATTEMPT_SUCCEEDED', 'MANUAL_RECOVERY_REQUESTED',
    'TERMINAL_FAILURE_UPGRADED', 'STABLE_TEXT_FALLBACK_USED'
  ]);

  const eventsOf = (trace) => Array.isArray(trace?.events) ? trace.events.slice().sort((a, b) => a.receivedSeq - b.receivedSeq) : [];
  const correlationValue = (event, key) => String(event?.correlation?.[key] || event?.payload?.[key] || '');
  const payloadModels = (event) => {
    const values = [event?.payload?.participant, event?.payload?.model]
      .concat(Array.isArray(event?.payload?.participants) ? event.payload.participants : [])
      .filter(Boolean).map(String);
    return Array.from(new Set(values));
  };
  const duration = (start, end) => start && end ? Math.max(0, Number(end.sourceTimestamp) - Number(start.sourceTimestamp)) : null;

  function projectStages(trace) {
    const events = eventsOf(trace);
    const plan = trace?.plan || events.find((event) => event.eventType === 'PLAN_COMPILED')?.payload?.plan || null;
    const planned = Array.isArray(plan?.stages) ? plan.stages : [];
    const stageIds = new Set(planned.map((stage) => String(stage.stageId)));
    events.forEach((event) => { const id = correlationValue(event, 'stageId'); if (id) stageIds.add(id); });
    return Array.from(stageIds).map((stageId) => {
      const expected = planned.find((stage) => String(stage.stageId) === stageId) || null;
      const related = events.filter((event) => correlationValue(event, 'stageId') === stageId);
      const started = related.find((event) => event.eventType === 'STAGE_STARTED') || null;
      const terminal = related.findLast ? related.findLast((event) => terminalStageEvents.has(event.eventType)) : related.slice().reverse().find((event) => terminalStageEvents.has(event.eventType));
      const completed = terminal?.eventType === 'STAGE_COMPLETED';
      const failed = terminal?.eventType === 'STAGE_FAILED';
      const skipped = terminal?.eventType === 'STAGE_SKIPPED';
      const actualParticipants = Array.from(new Set(related.filter((event) => event.eventType !== 'STAGE_SCHEDULED').flatMap(payloadModels)));
      const deviations = [];
      if (expected && !started) deviations.push('missing_stage_start');
      if (expected && !terminal) deviations.push('missing_stage_terminal');
      if (!expected) deviations.push('unplanned_stage');
      if (skipped) deviations.push(`skipped:${terminal.reasonCode || 'unknown'}`);
      if (failed) deviations.push(`failed:${terminal.reasonCode || 'unknown'}`);
      if (related.some((event) => event.eventType === 'STAGE_SKIPPED') && related.some((event) => event.eventType === 'STAGE_COMPLETED')) deviations.push('skip_complete_conflict');
      const expectedParticipants = Array.isArray(expected?.participants) ? expected.participants.map(String) : [];
      expectedParticipants.filter((model) => actualParticipants.length && !actualParticipants.includes(model))
        .forEach((model) => deviations.push(`participant_not_observed:${model}`));
      return {
        stageId,
        kind: String(expected?.kind || started?.payload?.kind || ''),
        round: Number(expected?.round || started?.payload?.round || 0) || null,
        expected: expected ? {
          participants: expectedParticipants,
          inputs: Array.isArray(expected.inputs) ? expected.inputs : [],
          outputs: Array.isArray(expected.outputs) ? expected.outputs : [],
          tabPolicy: expected.tabPolicy || '',
          completionPolicy: expected.completionPolicy || '',
          failurePolicy: expected.failurePolicy || ''
        } : null,
        actual: {
          participants: actualParticipants,
          startedAt: started?.sourceTimestamp || null,
          completedAt: terminal?.sourceTimestamp || null,
          terminalEventType: terminal?.eventType || '',
          reasonCode: terminal?.reasonCode || '',
          artifacts: related.filter((event) => event.eventType === 'STAGE_ARTIFACT_PRODUCED').map((event) => event.payload?.artifactId).filter(Boolean)
        },
        durationMs: duration(started, terminal),
        status: completed ? 'success' : failed ? 'failed' : skipped ? 'skipped' : started ? 'running' : 'pending',
        deviations,
        evidenceEventIds: related.map((event) => event.eventId)
      };
    });
  }

  function diagnosisFor(event) {
    const map = {
      STAGE_FAILED: ['STAGE_FAILURE', 'critical', 'runner'],
      BARRIER_TIMEOUT: ['BARRIER_TIMEOUT', 'high', 'runner'],
      SUBMIT_REJECTED: ['SUBMIT_REJECTED', 'high', 'background'],
      SUBMIT_TIMEOUT: ['SUBMIT_TIMEOUT', 'high', 'background'],
      ANSWER_REJECTED: ['ANSWER_REJECTED', 'warning', 'content'],
      MANUAL_RECOVERY_REQUESTED: ['MANUAL_RECOVERY_REQUIRED', 'high', 'recovery'],
      TERMINAL_FAILURE_UPGRADED: ['PREMATURE_TERMINAL_FAILURE', 'high', 'background'],
      STABLE_TEXT_FALLBACK_USED: ['FORCED_STABLE_TEXT_COMPLETION', 'warning', 'content'],
      STATE_DIVERGENCE: ['STATE_DIVERGENCE', 'high', 'run_store'],
      STALE_EVENT_REJECTED: ['STALE_EVENT_REJECTED', 'warning', 'background'],
      CORRELATION_REJECTED: ['CORRELATION_REJECTED', 'warning', 'background'],
      DUPLICATE_FINAL_REJECTED: ['DUPLICATE_FINAL_REJECTED', 'warning', 'background'],
      UNEXPECTED_STAGE_TRANSITION: ['UNEXPECTED_STAGE_TRANSITION', 'high', 'runner'],
      MISSING_REQUIRED_ARTIFACT: ['MISSING_REQUIRED_ARTIFACT', 'critical', 'runner'],
      UI_PROJECTION_FAILED: ['UI_PROJECTION_FAILED', 'warning', 'ui_projection'],
      TAB_OWNERSHIP_VIOLATION: ['TAB_OWNERSHIP_VIOLATION', 'high', 'background'],
      PLAN_ACTUAL_MISMATCH: ['PLAN_ACTUAL_MISMATCH', 'high', 'runner'],
      DROPOUT_CONTINUE_SELECTED: ['PARTICIPANT_DROPPED', 'high', 'runner']
    };
    const rule = map[event.eventType];
    if (!rule) return null;
    return {
      code: rule[0], severity: event.severity && event.severity !== 'info' ? event.severity : rule[1], confidence: event.provenance === 'legacy_adapter' ? 'medium' : 'high',
      affectedComponent: rule[2], affectedStageId: correlationValue(event, 'stageId') || null,
      affectedParticipant: payloadModels(event)[0] || null,
      summary: String(event.payload?.message || event.payload?.details || event.reasonCode || rule[0]),
      reasonCode: event.reasonCode || '', evidenceEventIds: [event.eventId],
      firstObservedAt: event.sourceTimestamp, resolvedAt: event.payload?.resolvedAt || null,
      resolution: event.payload?.resolution || '', userImpact: event.payload?.userImpact || ''
    };
  }

  function projectDiagnoses(trace, stages = projectStages(trace)) {
    const diagnoses = eventsOf(trace).map(diagnosisFor).filter(Boolean);
    stages.forEach((stage) => {
      if (!stage.deviations.length) return;
      if (stage.deviations.every((item) => item === 'missing_stage_start' || item === 'missing_stage_terminal') && stage.status === 'pending') return;
      diagnoses.push({
        code: 'PLAN_ACTUAL_MISMATCH', severity: stage.status === 'failed' ? 'critical' : 'warning', confidence: 'high',
        affectedComponent: 'runner', affectedStageId: stage.stageId, affectedParticipant: null,
        summary: stage.deviations.join(', '), reasonCode: 'STAGE_DEVIATION', evidenceEventIds: stage.evidenceEventIds,
        firstObservedAt: stage.actual.startedAt || null, resolvedAt: null, resolution: '', userImpact: 'execution differs from compiled plan'
      });
    });
    const grouped = new Map();
    diagnoses.forEach((item) => {
      const key = [item.code, item.affectedStageId || '', item.affectedParticipant || '', item.reasonCode || ''].join('|');
      const existing = grouped.get(key);
      if (!existing) { grouped.set(key, { ...item, occurrences: 1 }); return; }
      existing.occurrences += 1;
      existing.evidenceEventIds = Array.from(new Set(existing.evidenceEventIds.concat(item.evidenceEventIds)));
      existing.firstObservedAt = Math.min(Number(existing.firstObservedAt || Infinity), Number(item.firstObservedAt || Infinity));
      if ((severityRank[item.severity] || 0) > (severityRank[existing.severity] || 0)) existing.severity = item.severity;
    });
    return Array.from(grouped.values()).sort((a, b) => (severityRank[b.severity] || 0) - (severityRank[a.severity] || 0) || Number(a.firstObservedAt || 0) - Number(b.firstObservedAt || 0));
  }

  function projectParticipants(trace, stages) {
    const events = eventsOf(trace);
    const plan = trace?.plan || events.find((event) => event.eventType === 'PLAN_COMPILED')?.payload?.plan || {};
    const participants = Array.from(new Set([...(plan.participants || []), plan.synthesizer].filter(Boolean).map(String)));
    events.forEach((event) => payloadModels(event).forEach((model) => { if (!participants.includes(model)) participants.push(model); }));
    return participants.map((model) => {
      const related = events.filter((event) => payloadModels(event).includes(model));
      const expectedStages = stages.filter((stage) => stage.expected?.participants?.includes(model));
      const completedStages = expectedStages.filter((stage) => ['success', 'skipped'].includes(stage.status));
      const terminal = related.filter((event) => event.eventType === 'MODEL_TERMINAL_COMMITTED').slice(-1)[0] || null;
      return {
        participantId: model, expectedStages: expectedStages.length, completedStages: completedStages.length,
        submitStatus: related.some((event) => event.eventType === 'SUBMIT_CONFIRMED') ? 'confirmed' : related.some((event) => /SUBMIT_(?:REJECTED|TIMEOUT)/.test(event.eventType)) ? 'failed' : 'unknown',
        completionStatus: related.some((event) => event.eventType === 'COMPLETION_DETECTED') ? 'detected' : 'unknown',
        recoveries: related.filter((event) => recoveryTypes.has(event.eventType)).length,
        finalStatus: String(terminal?.payload?.status || terminal?.reasonCode || ''),
        durationMs: related.length > 1 ? Math.max(0, related.at(-1).sourceTimestamp - related[0].sourceTimestamp) : null,
        evidenceEventIds: related.map((event) => event.eventId)
      };
    });
  }

  function classifyHealth(trace, stages, diagnoses) {
    const events = eventsOf(trace);
    const terminal = events.filter((event) => /^RUN_(?:COMPLETED|FAILED|CANCELLED)$/.test(event.eventType)).slice(-1)[0] || null;
    if (terminal?.eventType === 'RUN_CANCELLED') return { terminalOutcome: 'cancelled', classification: 'cancelled', severity: 'warning', evidenceEventIds: [terminal.eventId] };
    if (stages.some((stage) => stage.status === 'failed')) return { terminalOutcome: terminal ? terminal.eventType.toLowerCase() : 'failed', classification: 'failed', severity: 'critical', evidenceEventIds: stages.filter((stage) => stage.status === 'failed').flatMap((stage) => stage.evidenceEventIds) };
    const missing = stages.filter((stage) => stage.expected && !['success', 'skipped'].includes(stage.status));
    if (terminal?.eventType !== 'RUN_COMPLETED' || missing.length) return { terminalOutcome: terminal ? terminal.eventType.toLowerCase() : 'running', classification: terminal ? 'incomplete' : 'running', severity: terminal ? 'high' : 'info', evidenceEventIds: missing.flatMap((stage) => stage.evidenceEventIds) };
    const partial = diagnoses.some((item) => item.code === 'PARTICIPANT_DROPPED');
    if (partial) return { terminalOutcome: 'completed', classification: 'partial_success', severity: 'high', evidenceEventIds: diagnoses.filter((item) => item.code === 'PARTICIPANT_DROPPED').flatMap((item) => item.evidenceEventIds) };
    const degradedCodes = new Set(['MANUAL_RECOVERY_REQUIRED', 'PREMATURE_TERMINAL_FAILURE', 'FORCED_STABLE_TEXT_COMPLETION', 'STATE_DIVERGENCE', 'UI_PROJECTION_FAILED', 'CORRELATION_REJECTED', 'STALE_EVENT_REJECTED', 'PLAN_ACTUAL_MISMATCH']);
    const degraded = diagnoses.filter((item) => degradedCodes.has(item.code) || severityRank[item.severity] >= severityRank.high);
    if (degraded.length) return { terminalOutcome: 'completed', classification: 'degraded_success', severity: 'warning', evidenceEventIds: degraded.flatMap((item) => item.evidenceEventIds) };
    return { terminalOutcome: 'completed', classification: 'success', severity: 'info', evidenceEventIds: terminal ? [terminal.eventId] : [] };
  }

  function projectBarriers(trace) {
    const events = eventsOf(trace).filter((event) => event.eventType.startsWith('BARRIER_'));
    const stageIds = Array.from(new Set(events.map((event) => correlationValue(event, 'stageId') || 'unscoped')));
    return stageIds.map((stageId) => {
      const related = events.filter((event) => (correlationValue(event, 'stageId') || 'unscoped') === stageId);
      const opened = related.find((event) => event.eventType === 'BARRIER_OPENED') || null;
      const released = related.filter((event) => ['BARRIER_RELEASED', 'BARRIER_TIMEOUT'].includes(event.eventType)).slice(-1)[0] || null;
      const expected = Array.isArray(opened?.payload?.participants) ? opened.payload.participants.map(String) : [];
      const readyEvents = related.filter((event) => event.eventType === 'BARRIER_PARTICIPANT_READY');
      const failedEvents = related.filter((event) => event.eventType === 'BARRIER_PARTICIPANT_FAILED');
      const ready = Array.from(new Set(readyEvents.flatMap(payloadModels)));
      const failed = Array.from(new Set(failedEvents.flatMap(payloadModels)));
      const critical = readyEvents.slice().sort((a, b) => b.sourceTimestamp - a.sourceTimestamp)[0];
      return {
        stageId, openedAt: opened?.sourceTimestamp || null, releasedAt: released?.sourceTimestamp || null,
        durationMs: duration(opened, released), expectedParticipants: expected, readyParticipants: ready,
        failedParticipants: failed, pendingParticipants: expected.filter((model) => !ready.includes(model) && !failed.includes(model)),
        criticalParticipant: payloadModels(critical)[0] || null,
        outcome: released?.eventType === 'BARRIER_TIMEOUT' ? 'timeout' : released ? 'released' : 'waiting',
        evidenceEventIds: related.map((event) => event.eventId)
      };
    });
  }

  function projectDispatchAttempts(trace) {
    const accepted = new Set(['DISPATCH_CREATED', 'SUBMIT_ATTEMPTED', 'SUBMIT_CONFIRMED', 'SUBMIT_REJECTED', 'SUBMIT_TIMEOUT', 'ANSWER_COLLECTED', 'MODEL_TERMINAL_COMMITTED']);
    const events = eventsOf(trace).filter((event) => accepted.has(event.eventType));
    const groups = new Map();
    events.forEach((event) => {
      const model = payloadModels(event)[0] || 'batch';
      const key = correlationValue(event, 'dispatchId') || correlationValue(event, 'stageAttemptId') || `${correlationValue(event, 'stageId')}:${model}`;
      if (!groups.has(key)) groups.set(key, { dispatchId: correlationValue(event, 'dispatchId') || null, stageAttemptId: correlationValue(event, 'stageAttemptId') || null, stageId: correlationValue(event, 'stageId') || null, participantId: model, events: [] });
      groups.get(key).events.push(event);
    });
    return Array.from(groups.values()).map((group) => ({
      dispatchId: group.dispatchId,
      stageAttemptId: group.stageAttemptId,
      stageId: group.stageId,
      participantId: group.participantId,
      submitStatus: group.events.some((event) => event.eventType === 'SUBMIT_CONFIRMED') ? 'confirmed' : group.events.some((event) => /SUBMIT_(?:REJECTED|TIMEOUT)/.test(event.eventType)) ? 'failed' : 'unknown',
      terminalStatus: group.events.filter((event) => event.eventType === 'MODEL_TERMINAL_COMMITTED').slice(-1)[0]?.payload?.status || '',
      evidenceEventIds: group.events.map((event) => event.eventId)
    }));
  }

  function summarizeEventReference(event) {
    return {
      eventId: event?.eventId || null,
      eventType: event?.eventType || '',
      severity: event?.severity || 'info',
      sourceTimestamp: event?.sourceTimestamp || null,
      reasonCode: event?.reasonCode || '',
      stageId: correlationValue(event, 'stageId') || null,
      participantIds: payloadModels(event)
    };
  }

  function summarizeArtifactEvent(event) {
    const payload = event?.payload || {};
    const artifact = payload.artifact && typeof payload.artifact === 'object' ? payload.artifact : payload;
    return {
      eventId: event?.eventId || null,
      stageId: correlationValue(event, 'stageId') || null,
      artifactId: String(payload.artifactId || artifact.id || ''),
      artifactType: String(payload.artifactType || artifact.type || ''),
      status: String(payload.status || artifact.status || ''),
      participantIds: payloadModels(event)
    };
  }

  function buildReport(trace, options = {}) {
    const events = eventsOf(trace);
    const stages = projectStages(trace);
    const diagnoses = projectDiagnoses(trace, stages);
    const participants = projectParticipants(trace, stages);
    const health = classifyHealth(trace, stages, diagnoses);
    const started = events.find((event) => event.eventType === 'RUN_STARTED') || events[0] || null;
    const ended = events.filter((event) => /^RUN_(?:COMPLETED|FAILED|CANCELLED)$/.test(event.eventType)).slice(-1)[0] || events.at(-1) || null;
    const recoveryAttempts = events.filter((event) => recoveryTypes.has(event.eventType)).map(summarizeEventReference);
    const barriers = projectBarriers(trace);
    const dispatchAttempts = projectDispatchAttempts(trace);
    const stateDivergences = events.filter((event) => event.eventType === 'STATE_DIVERGENCE').map(summarizeEventReference);
    const criticalStage = stages.filter((stage) => Number.isFinite(stage.durationMs)).sort((a, b) => b.durationMs - a.durationMs)[0] || null;
    const criticalBarrier = barriers.filter((barrier) => Number.isFinite(barrier.durationMs)).sort((a, b) => b.durationMs - a.durationMs)[0] || null;
    const expectedStageIds = new Set((trace?.plan?.stages || []).map((stage) => String(stage.stageId)));
    const observedTerminal = new Set(stages.filter((stage) => ['success', 'failed', 'skipped'].includes(stage.status)).map((stage) => stage.stageId));
    const seqs = events.map((event) => event.receivedSeq).filter(Number.isFinite);
    const sequenceGaps = [];
    for (let i = 1; i < seqs.length; i += 1) if (seqs[i] !== seqs[i - 1] + 1) sequenceGaps.push([seqs[i - 1], seqs[i]]);
    return {
      schemaVersion: 1,
      metadata: {
        debateRunId: trace?.debateRunId || null, planId: trace?.plan?.planId || null,
        topology: trace?.topology || trace?.plan?.topology || '', presetId: trace?.presetId || trace?.plan?.presetId || '',
        sessionId: trace?.sessionId || '', exportedAt: new Date().toISOString(), extensionVersion: options.extensionVersion || 'unknown',
        dataCompleteness: events.some((event) => event.correlation?.correlationQuality !== 'exact') ? 'incomplete' : 'complete'
      },
      plan: trace?.plan || null,
      runOutcome: { startedAt: started?.sourceTimestamp || null, completedAt: ended?.sourceTimestamp || null, durationMs: duration(started, ended), terminalOutcome: health.terminalOutcome },
      health: { ...health, diagnosisCount: diagnoses.length, manualRecoveryCount: events.filter((event) => event.eventType === 'MANUAL_RECOVERY_REQUESTED').length, forcedCompletionCount: events.filter((event) => event.eventType === 'STABLE_TEXT_FALLBACK_USED').length, stateDivergenceCount: stateDivergences.length },
      diagnoses,
      stageExecutions: stages,
      participantExecutions: participants,
      barriers,
      dispatchAttempts,
      recoveryAttempts,
      stateDivergences,
      artifacts: events.filter((event) => event.eventType === 'STAGE_ARTIFACT_PRODUCED').map(summarizeArtifactEvent),
      criticalPath: criticalStage ? { stageId: criticalStage.stageId, durationMs: criticalStage.durationMs, participantId: criticalBarrier?.stageId === criticalStage.stageId ? criticalBarrier.criticalParticipant : null } : null,
      events,
      integrity: {
        eventsTotal: events.length, firstSeq: seqs[0] || null, lastSeq: seqs.at(-1) || null, sequenceGaps,
        duplicateEventIds: options.duplicateEventIds || [],
        uncorrelatedEvents: events.filter((event) => !event.correlation?.debateRunId).map((event) => event.eventId),
        missingRequiredStageEvents: Array.from(expectedStageIds).filter((stageId) => !observedTerminal.has(stageId)),
        missingTerminalEvents: events.some((event) => /^RUN_(?:COMPLETED|FAILED|CANCELLED)$/.test(event.eventType)) ? [] : ['run_terminal'],
        clockSkewWarnings: [], redactedFieldsCount: events.reduce((sum, event) => sum + Number(event.redactedFieldsCount || 0), 0),
        schemaValidationErrors: events.flatMap((event) => (event.validationErrors || []).map((error) => ({ eventId: event.eventId, error })))
      }
    };
  }

  function filterProblems(report, options = {}) {
    if (!report || typeof report !== 'object') return report;
    const sharedFilter = options.problemContextFilter || null;
    const isProblem = (item) => sharedFilter?.isProblem
      ? sharedFilter.isProblem(item)
      : ['warning', 'high', 'critical'].includes(String(item?.severity || '').toLowerCase())
        || /(ERROR|FAILED|FAILURE|TIMEOUT|REJECTED|EXCEPTION|DIVERGENCE|MISMATCH)/i.test(String(item?.eventType || item?.status || ''));
    const contextKey = (item) => item?.correlation?.stageId || item?.stageId || '__unscoped__';
    const events = Array.isArray(report.events) ? report.events : [];
    const visibleEvents = sharedFilter?.filterWithContext
      ? sharedFilter.filterWithContext(events, { isProblem, getContextKey: contextKey })
      : events.filter(isProblem);
    const visibleEventIds = new Set(visibleEvents.map((event) => event.eventId).filter(Boolean));
    const diagnoses = Array.isArray(report.diagnoses) ? report.diagnoses.slice() : [];
    const diagnosedStages = new Set(diagnoses.map((item) => item.affectedStageId).filter(Boolean));
    const intersectsVisibleEvidence = (item) => (item?.evidenceEventIds || []).some((id) => visibleEventIds.has(id));
    return {
      ...report,
      events: visibleEvents,
      diagnoses,
      stageExecutions: (report.stageExecutions || []).filter((stage) => diagnosedStages.has(stage.stageId)
        || stage.deviations?.length || ['failed', 'skipped'].includes(stage.status)),
      participantExecutions: (report.participantExecutions || []).filter((item) => item.recoveries
        || ['failed', 'error'].includes(String(item.submitStatus || '').toLowerCase())
        || ['failed', 'error'].includes(String(item.completionStatus || '').toLowerCase())
        || ['failed', 'error'].includes(String(item.finalStatus || '').toLowerCase())
        || intersectsVisibleEvidence(item)),
      barriers: (report.barriers || []).filter((barrier) => ['waiting', 'timeout'].includes(barrier.outcome)
        || Number(barrier.durationMs) > 0 || intersectsVisibleEvidence(barrier)),
      dispatchAttempts: (report.dispatchAttempts || []).filter((attempt) => attempt.submitStatus === 'failed'
        || /(?:ERROR|FAIL|TIMEOUT|REJECT)/i.test(String(attempt.terminalStatus || ''))
        || intersectsVisibleEvidence(attempt)),
      recoveryAttempts: (report.recoveryAttempts || []).filter((item) => visibleEventIds.has(item.eventId)),
      stateDivergences: (report.stateDivergences || []).filter((item) => visibleEventIds.has(item.eventId)),
      artifacts: []
    };
  }

  const esc = (value) => String(value == null ? '' : value).replace(/\|/g, '\\|').replace(/[\r\n]+/g, ' ');
  const fmtDuration = (ms) => Number.isFinite(ms) ? `${(ms / 1000).toFixed(ms >= 10000 ? 0 : 1)}s` : '-';
  function toMarkdown(report) {
    const lines = [
      '# Disput Telemetry',
      `Version: ${report.metadata.extensionVersion}`,
      `Run: ${report.metadata.debateRunId || 'n/a'}`,
      `Topology/Preset: ${report.metadata.topology || 'n/a'} / ${report.metadata.presetId || 'n/a'}`,
      `Health: **${report.health.classification}**`,
      `Duration: ${fmtDuration(report.runOutcome.durationMs)}`,
      '', '## Problems / Recovery', '',
      'Severity | Code | Stage | Participant | Summary',
      '--- | --- | --- | --- | ---'
    ];
    if (!report.diagnoses.length) lines.push('info | none | - | - | No diagnosed problems.');
    report.diagnoses.forEach((item) => lines.push([item.severity, item.code, item.affectedStageId || '-', item.affectedParticipant || '-', item.summary || '-'].map(esc).join(' | ')));
    lines.push('', '## Plan vs Actual', '', 'Stage | Kind | Expected | Actual | Duration | Status | Deviations', '--- | --- | --- | --- | --- | --- | ---');
    report.stageExecutions.forEach((stage) => lines.push([
      stage.stageId, stage.kind || '-', (stage.expected?.participants || []).join(', ') || '-',
      (stage.actual?.participants || []).join(', ') || '-', fmtDuration(stage.durationMs), stage.status,
      stage.deviations.join(', ') || '-'
    ].map(esc).join(' | ')));
    lines.push('', '## Participants', '', 'Model | Stages | Submit | Completion | Recoveries | Final', '--- | --- | --- | --- | --- | ---');
    report.participantExecutions.forEach((item) => lines.push([item.participantId, `${item.completedStages}/${item.expectedStages}`, item.submitStatus, item.completionStatus, item.recoveries, item.finalStatus || '-'].map(esc).join(' | ')));
    lines.push('', '## Integrity', '', `- Events: ${report.integrity.eventsTotal}`, `- Missing stage terminals: ${report.integrity.missingRequiredStageEvents.join(', ') || 'none'}`, `- Uncorrelated: ${report.integrity.uncorrelatedEvents.length}`, `- Schema errors: ${report.integrity.schemaValidationErrors.length}`, `- Redacted fields: ${report.integrity.redactedFieldsCount}`, '', '## Raw Events', '', 'Seq | Time | Type | Source | Stage | Model | Reason', '--- | --- | --- | --- | --- | --- | ---');
    report.events.forEach((event) => lines.push([event.receivedSeq, new Date(event.sourceTimestamp).toISOString(), event.eventType, event.source, correlationValue(event, 'stageId') || '-', payloadModels(event).join(', ') || '-', event.reasonCode || '-'].map(esc).join(' | ')));
    return lines.join('\n');
  }

  const api = Object.freeze({
    projectStages, projectDiagnoses, projectParticipants, projectBarriers,
    projectDispatchAttempts, classifyHealth, buildReport, filterProblems, toMarkdown
  });
  root.DebateTraceProjections = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
