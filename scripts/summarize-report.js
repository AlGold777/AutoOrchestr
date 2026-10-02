#!/usr/bin/env node
// Compact, deterministic digest of an extension report — no model needed.
//
//   node scripts/summarize-report.js "<report>.json" [more.json ...]
//
// Understands both exports:
//   * message-delivery report   ({ report: 'message-delivery', diagnosis, journal })
//   * Disput Flow export        ({ metadata.debateRunId, stageExecutions, events, ... })
// It prints facts only (what happened, when, how long), never causes. Every number comes from a
// field of the file; where the file has no such field the line says so once.
'use strict';
const fs = require('fs');

const SEC = (ms) => (ms == null || !Number.isFinite(ms) ? '—' : `${(ms / 1000).toFixed(1)}s`);
const MIN = (ms) => (ms == null || !Number.isFinite(ms) ? '—' : ms >= 120000 ? `${(ms / 60000).toFixed(1)}min` : SEC(ms));
const iso = (t) => (Number.isFinite(t) ? new Date(t).toISOString().slice(11, 23) : '—');
const short = (id) => String(id || '').replace(/^stage-[0-9a-f-]{36}-/, 'stage-').replace(/^treq-/, '').slice(0, 14);
const median = (list) => {
  const sorted = list.filter(Number.isFinite).sort((a, b) => a - b);
  return sorted.length ? sorted[Math.floor(sorted.length / 2)] : null;
};
const count = (items, keyFn) => {
  const out = new Map();
  items.forEach((item) => { const key = keyFn(item); out.set(key, (out.get(key) || 0) + 1); });
  return [...out.entries()].sort((a, b) => b[1] - a[1]);
};
const table = (head, rows) => [`| ${head.join(' | ')} |`, `|${head.map(() => '---').join('|')}|`, ...rows.map((row) => `| ${row.join(' | ')} |`)].join('\n');

// ---------------------------------------------------------------- Disput Flow export
function summarizeDisputFlow(d) {
  const out = [];
  const events = Array.isArray(d.events) ? d.events : [];
  const stages = (d.stageExecutions || []).slice().sort((a, b) => (a.actual?.startedAt || 0) - (b.actual?.startedAt || 0));
  const t0 = stages[0]?.actual?.startedAt ?? d.runOutcome?.startedAt ?? events[0]?.sourceTimestamp ?? 0;
  const rel = (t) => (Number.isFinite(t) ? SEC(t - t0) : '—');
  const m = d.metadata || {};
  out.push('## Disput Flow export');
  out.push(`- version ${m.extensionVersion} · preset ${m.presetId} · topology ${m.topology} · completeness ${m.dataCompleteness} · exported ${m.exportedAt}`);
  out.push(`- run: ${d.runOutcome?.terminalOutcome} · started ${iso(d.runOutcome?.startedAt)} · duration ${MIN(d.runOutcome?.durationMs)} · plan ${d.plan ? 'present' : 'null'}`);
  out.push(`- health: ${d.health?.classification} / ${d.health?.severity} · diagnoses ${d.health?.diagnosisCount} · manualRecovery ${d.health?.manualRecoveryCount} · forcedCompletion ${d.health?.forcedCompletionCount} · stateDivergence ${d.health?.stateDivergenceCount}`);
  out.push(`- events ${events.length} · ${count(events, (e) => e.eventType).slice(0, 12).map(([k, n]) => `${k}×${n}`).join(', ')}`);

  const byStage = (stageId, type) => events.filter((e) => e.correlation?.stageId === stageId && e.eventType === type);
  const medianDur = median(stages.map((s) => s.durationMs));
  out.push('\n### Stages (times relative to the first stage start)');
  out.push(table(['#', 'stage', 'participants', 'start', 'end', 'duration', 'gap to next', 'status', 'flags'], stages.map((s, i) => {
    const next = stages[i + 1];
    const gap = next ? next.actual.startedAt - s.actual.completedAt : null;
    const flags = [];
    if (medianDur && s.durationMs > 3 * medianDur && s.durationMs > 120000) flags.push('LONG(>3×median)');
    if (gap != null && gap > 10000) flags.push(`gap ${SEC(gap)}`);
    if ((s.deviations || []).length) flags.push(`deviations:${s.deviations.join(',')}`);
    return [i + 1, short(s.stageId), (s.actual?.participants || []).join('+') || '—', rel(s.actual?.startedAt), rel(s.actual?.completedAt), MIN(s.durationMs), SEC(gap), s.status, flags.join(' ') || '—'];
  })));

  // One line per model: the digest must not follow only the longest stage.
  const models = [...new Set(events.map((e) => e.payload?.model).filter(Boolean))].sort();
  out.push('\n### Per model (whole run)');
  out.push(table(['model', 'stages', 'finals (stage:status/reason)', 'manual recoveries', 'stage failures', 'forced stable-text', 'dropped after'], models.map((model) => {
    const mine = events.filter((e) => e.payload?.model === model);
    const inStages = stages.map((st, i) => ({ st, i })).filter(({ st }) => mine.some((e) => e.correlation?.stageId === st.stageId));
    const finals = inStages.map(({ st, i }) => {
      const t = mine.filter((e) => e.correlation?.stageId === st.stageId && e.eventType === 'MODEL_TERMINAL_COMMITTED' && e.payload?.evidence?.finalStatus);
      const last = t[t.length - 1];
      return `${i + 1}:${last ? `${last.payload.evidence.finalStatus}/${last.payload.evidence.completionReason || '—'}` : 'none'}`;
    });
    const failures = mine.filter((e) => e.eventType === 'STAGE_FAILED');
    const lastStageWith = inStages.length ? inStages[inStages.length - 1].i + 1 : null;
    const dropped = lastStageWith && lastStageWith < stages.length ? `stage ${lastStageWith}` : '—';
    return [model, inStages.map(({ i }) => i + 1).join(','), finals.join(' '), mine.filter((e) => e.eventType === 'MANUAL_RECOVERY_REQUESTED' && e.payload?.details === 'UI button').length || '—', failures.length ? failures.map((e) => e.reasonCode).join(',') : '—', mine.filter((e) => e.eventType === 'STABLE_TEXT_FALLBACK_USED').length || '—', dropped];
  })));

  // Notable events of every model that had a failure or needed a manual recovery (noise removed,
  // repeats within 5 s collapsed), so the cause of a provider problem is visible without the raw file.
  const NOISE = new Set(['SELECTOR_STATS', 'ANSWER_CARD_RENDER_EVALUATED', 'TEXT_STABLE', 'BARRIER_WAITING', 'UI_PROJECTION_FAILED', 'LEGACY_TIMELINE_EVENT']);
  models.filter((model) => events.some((e) => e.payload?.model === model && ['STAGE_FAILED', 'MANUAL_RECOVERY_REQUESTED'].includes(e.eventType))).forEach((model) => {
    const lines = [];
    let lastKey = '';
    let lastAt = -1e9;
    events.filter((e) => e.payload?.model === model && !NOISE.has(e.eventType)).forEach((e) => {
      const label = e.payload?.originalLabel || e.eventType;
      const key = `${label}|${String(e.payload?.details || '').slice(0, 40)}`;
      if (key === lastKey && e.sourceTimestamp - lastAt < 5000) { lastAt = e.sourceTimestamp; return; }
      lastKey = key; lastAt = e.sourceTimestamp;
      lines.push(`${rel(e.sourceTimestamp).padStart(8)} ${short(e.correlation?.stageId)} ${label.slice(0, 44)} ${String(e.payload?.details || '').slice(0, 90)}`);
    });
    out.push(`\n### Notable events: ${model} (${lines.length} lines, first 60)\n${lines.slice(0, 60).map((l) => `    ${l}`).join('\n')}`);
  });

  out.push('\n### Per stage and participant (offset from the stage start)');
  const rows = [];
  stages.forEach((s, i) => {
    const start = s.actual?.startedAt;
    const models = new Set(events.filter((e) => e.correlation?.stageId === s.stageId).map((e) => e.payload?.model).filter(Boolean));
    models.forEach((model) => {
      const mine = (type) => byStage(s.stageId, type).filter((e) => e.payload?.model === model);
      const stable = mine('TEXT_STABLE');
      const complete = mine('COMPLETION_DETECTED');
      const terminal = mine('MODEL_TERMINAL_COMMITTED');
      const collected = byStage(s.stageId, 'ANSWER_COLLECTED').filter((e) => e.payload?.model === model || e.payload?.participant === model);
      const fallback = mine('STABLE_TEXT_FALLBACK_USED');
      const barrier = mine('BARRIER_WAITING');
      const manual = mine('MANUAL_RECOVERY_REQUESTED');
      const failed = mine('STAGE_FAILED');
      const off = (e) => (e ? SEC(e.sourceTimestamp - start) : '—');
      const lastTerminal = terminal[terminal.length - 1];
      const ev = lastTerminal?.payload?.evidence || {};
      rows.push([i + 1, model, off(stable[0]), off(complete[0]), `${terminal.length}${terminal.length ? ` (last ${off(lastTerminal)})` : ''}`,
        ev.finalStatus ? `${ev.finalStatus}/${ev.completionReason || '—'}/${lastTerminal.payload.answerLength ?? ev.answerLength ?? '—'}ch` : '—',
        fallback.length ? `${fallback.length} @${off(fallback[0])}` : '—', barrier.length || '—', manual.length || '—', failed.map((e) => e.reasonCode).join(',') || '—']);
    });
  });
  out.push(table(['stage', 'model', '1st stable text', '1st completion', 'terminals', 'final', 'forced stable-text', 'barrier waits', 'manual recoveries', 'stage failures'], rows));

  // Text that stood still long before the terminal: the stage waited for a completion that did not come.
  const standing = [];
  stages.forEach((s, i) => {
    new Set(events.filter((e) => e.correlation?.stageId === s.stageId && e.eventType === 'TEXT_STABLE').map((e) => e.payload?.model)).forEach((model) => {
      const stable = events.filter((e) => e.correlation?.stageId === s.stageId && e.eventType === 'TEXT_STABLE' && e.payload?.model === model);
      const terminals = events.filter((e) => e.correlation?.stageId === s.stageId && e.eventType === 'MODEL_TERMINAL_COMMITTED' && e.payload?.model === model);
      if (!stable.length || !terminals.length) return;
      const gap = terminals[terminals.length - 1].sourceTimestamp - stable[0].sourceTimestamp;
      if (gap > 120000) standing.push(`stage ${i + 1} ${model}: text stable from +${SEC(stable[0].sourceTimestamp - s.actual.startedAt)}, last terminal +${SEC(terminals[terminals.length - 1].sourceTimestamp - s.actual.startedAt)} (${MIN(gap)} later)`);
    });
  });
  out.push(`\n### Text stable long before the terminal (> 2 min)\n${standing.length ? standing.map((x) => `- ${x}`).join('\n') : '- none'}`);

  const manualEvents = events.filter((e) => e.eventType === 'MANUAL_RECOVERY_REQUESTED');
  out.push('\n### Manual recoveries (events MANUAL_RECOVERY_REQUESTED)');
  out.push(manualEvents.length ? manualEvents.map((e) => `- ${rel(e.sourceTimestamp)} ${e.payload?.model || '—'} · ${e.payload?.details || '—'} · ${short(e.correlation?.stageId)}`).join('\n') : '- none');

  out.push('\n### Diagnoses (grouped)');
  const diag = d.diagnoses || [];
  out.push(diag.length ? table(['code', 'severity', 'where', 'summary', '×', 'first at', 'resolved'], diag.map((x) => [x.code, x.severity, `${x.affectedParticipant || '—'}@${short(x.affectedStageId) || '—'}`, `${x.summary}/${x.reasonCode}`, x.occurrences, rel(x.firstObservedAt), x.resolvedAt ? 'yes' : 'no'])) : '- none');

  const dispatches = d.dispatchAttempts || [];
  out.push(`\n### Dispatch attempts: ${dispatches.length} (${count(dispatches, (x) => `${x.participantId}@${short(x.stageId)}`).map(([k, n]) => `${k}×${n}`).join(', ')}) · without dispatchId: ${dispatches.filter((x) => !x.dispatchId).length}`);
  const integrity = d.integrity || {};
  out.push(`\n### Integrity\n- events ${integrity.eventsTotal} · sequence gaps ${(integrity.sequenceGaps || []).length} · duplicate event ids ${(integrity.duplicateEventIds || []).length} · uncorrelated ${(integrity.uncorrelatedEvents || []).length} · missing terminal ${(integrity.missingTerminalEvents || []).length} · schema errors ${(integrity.schemaValidationErrors || []).length}`);
  const last = events[events.length - 1]?.sourceTimestamp;
  if (last && d.runOutcome?.completedAt && last > d.runOutcome.completedAt) out.push(`- last event is ${MIN(last - d.runOutcome.completedAt)} after runOutcome.completedAt`);
  return out.join('\n');
}

// ---------------------------------------------------------------- message-delivery report
function summarizeDelivery(d) {
  const out = [];
  const diag = d.diagnosis || {};
  const journal = d.journal || [];
  const t0 = Date.parse(journal[0]?.at || d.generated_at);
  const rel = (at) => SEC(Date.parse(at) - t0);
  out.push('## message-delivery report');
  out.push(`- version ${d.extension_version} · contract ${d.transport_contract_version} · generated ${d.generated_at} · journal ${journal.length} events (${journal[0]?.at?.slice(11, 23)} → ${journal[journal.length - 1]?.at?.slice(11, 23)})`);
  const batches = diag.batches || [];
  out.push('\n### Batches (times relative to the first journal event)');
  out.push(batches.length ? table(['wait', 'stage attempt', 'mode', 'template', 'models', 'start', 'accepted after', 'refusals', 'outcome', 'duration', 'gap before', 'skipped/adopted'], batches.map((b, i) => {
    const prev = batches[i - 1];
    const prevEnd = prev ? Date.parse(prev.at) + (prev.durationMs || 0) : null;
    return [b.waitId, short(b.stageAttemptId || b.batchId), b.runMode || '—', b.template || '—', (b.models || []).join('+'), rel(b.at), SEC(b.accepted?.waitedMs), (b.refusals || []).length || '—', b.outcome || 'open', SEC(b.durationMs), prevEnd ? SEC(Date.parse(b.at) - prevEnd) : '—', `${(b.skipped || []).join(',') || '—'}/${(b.adopted || []).join(',') || '—'}`];
  })) : '- none');
  const refusals = batches.flatMap((b) => (b.refusals || []).map((r) => `${b.waitId}#${r.attempt} ${r.errorCode}${r.reason ? `(${r.reason})` : ''} after ${SEC(r.waitedMs)}`));
  out.push(`\n### Start refusals: ${refusals.length ? refusals.join('; ') : 'none'}`);

  out.push('\n### Sends');
  out.push(table(['model', 'stage attempt', 'submitted', '1st text', 'result', 'terminal', 'chars', 'completion', 'focus', 'revisions', 'rejections'], (diag.sends || []).map((s) => [
    s.model, short(s.batchId), SEC(s.submittedMs), SEC(s.firstTextMs), s.result, s.terminal?.status || '—', s.terminal?.chars ?? '—', s.terminal?.completion || '—',
    `${s.focus?.count || 0}${s.focus?.sources ? ` ${Object.entries(s.focus.sources).map(([k, n]) => `${k}:${n}`).join(',')}` : ''}`, s.revisions || 0, (s.rejections || []).map((r) => r.reason).join(',') || '—'])));

  out.push('\n### Problems (grouped)');
  const problems = diag.problems || [];
  out.push(problems.length ? table(['code', 'severity', 'model', '×', 'reason'], problems.map((p) => [p.code, p.severity, p.model || '—', p.count || 1, String(p.reason || '').slice(0, 110) || '—'])) : '- none');

  const interesting = ['run_paused', 'moderator_pause', 'moderator_get_it', 'get_it_result', 'moderator_stage_close', 'moderator_close_refused', 'moderator_approve', 'owner_answer', 'stall_adopted', 'response_rejected', 'ui_phantom_state', 'displayed'];
  const events = journal.filter((e) => interesting.includes(e.kind));
  out.push('\n### Engine and moderator events');
  out.push(events.length ? events.map((e) => `- ${rel(e.at)} ${e.kind} ${JSON.stringify(Object.fromEntries(Object.entries(e).filter(([k]) => !['at', 'kind', 'prompt'].includes(k)))).slice(0, 160)}`).join('\n') : '- none');
  out.push(`\n### Identity rejections: ${count(journal.filter((e) => e.kind === 'identity_rejected'), (e) => `${e.model}:${e.reason}`).map(([k, n]) => `${k}×${n}`).join(', ') || 'none'}`);
  return out.join('\n');
}

function summarize(file) {
  const d = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (d.report === 'message-delivery') return summarizeDelivery(d);
  if (d.metadata?.debateRunId || Array.isArray(d.stageExecutions)) return summarizeDisputFlow(d);
  throw new Error(`${file}: unknown report type (top-level keys: ${Object.keys(d).slice(0, 8).join(', ')})`);
}

if (require.main === module) {
  const files = process.argv.slice(2);
  if (!files.length) {
    console.error('usage: node scripts/summarize-report.js <report.json> [more.json ...]');
    process.exit(1);
  }
  files.forEach((file) => {
    try {
      console.log(`# ${file.split('/').pop()}\n${summarize(file)}\n`);
    } catch (error) {
      console.error(String(error.message || error));
      process.exitCode = 1;
    }
  });
}

module.exports = { summarize, summarizeDisputFlow, summarizeDelivery };
