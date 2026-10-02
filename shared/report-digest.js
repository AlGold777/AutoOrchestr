// Deterministic report analysis shared by the extension and report tooling.
(function initReportDigest(root) {
'use strict';
const SEC = (ms, digits = 1) => (ms == null || !Number.isFinite(ms) ? '—' : `${(ms / 1000).toFixed(digits)}s`);
// Seconds with millisecond precision, without unit (Disput Flow tables state the unit in the header).
const T3 = (ms) => (ms == null || !Number.isFinite(ms) ? '—' : (ms / 1000).toFixed(3));
const toMs = (at) => (typeof at === 'number' ? at : typeof at === 'string' ? Date.parse(at) : NaN);
const short = (id) => String(id || '').replace(/^stage-[0-9a-f-]{36}-/, 'stage-').replace(/^treq-/, '').slice(0, 14);
const has = (obj, key) => obj != null && typeof obj === 'object' && Object.prototype.hasOwnProperty.call(obj, key);
// The true median: the mean of the two middle values for an even count.
const median = (list) => {
  const sorted = list.filter(Number.isFinite).sort((a, b) => a - b);
  const n = sorted.length;
  if (!n) return null;
  return n % 2 ? sorted[(n - 1) / 2] : (sorted[n / 2 - 1] + sorted[n / 2]) / 2;
};
const count = (items, keyFn) => {
  const out = new Map();
  items.forEach((item) => { const key = keyFn(item); out.set(key, (out.get(key) || 0) + 1); });
  return [...out.entries()].sort((a, b) => b[1] - a[1]);
};
const counted = (items, keyFn) => count(items, keyFn).map(([k, n]) => `${k}×${n}`).join(', ');
const table = (head, rows) => [`| ${head.join(' | ')} |`, `|${head.map(() => '---').join('|')}|`, ...rows.map((row) => `| ${row.join(' | ')} |`)].join('\n');
// "no field" / null / "" / [] / value — the distinctions the analysis depends on.
const fieldValue = (obj, key) => {
  if (!has(obj, key)) return 'no field';
  const value = obj[key];
  if (value === null) return 'null';
  if (value === '') return '""';
  if (Array.isArray(value)) return value.length ? `${value.length} records` : '[]';
  if (typeof value === 'object') return JSON.stringify(value).slice(0, 120);
  return String(value);
};
const records = (n) => `${n} record${n === 1 ? '' : 's'}`;
const clip = (text, n) => String(text || '').replace(/\s+/g, ' ').trim().slice(0, n);

// ---------------------------------------------------------------- Disput Flow export: records
const JOURNAL_DETAIL_SKIP = new Set(['at', 'kind', 'model', 'requestId', 'token', 'answer', 'prompt', 'dispatchId', 'tabId', 'phase', 'bg']);
const journalDetails = (j) => Object.entries(j)
  .filter(([k, v]) => !JOURNAL_DETAIL_SKIP.has(k) && v != null && v !== '')
  .map(([k, v]) => `${k}=${typeof v === 'object' ? JSON.stringify(v) : v}`)
  .join(' ')
  .slice(0, 160);

// One time-ordered list of events[] and delivery.journal[] entries with their identifiers.
function buildRecords(events, journal) {
  const recs = [];
  events.forEach((e, i) => {
    const p = e.payload || {};
    const c = e.correlation || {};
    recs.push({
      src: 'events', path: `events[${i}]`, at: e.sourceTimestamp, type: e.eventType, reasonCode: e.reasonCode || '',
      label: p.originalLabel || e.eventType, model: p.model || p.participant || null,
      stageId: c.stageId || p.stageId || null, dispatchId: c.dispatchId || null, requestId: p.transportRequestId || null,
      tabId: c.tabId ?? null, details: clip(p.details || p.note || '', 120), raw: e
    });
  });
  journal.forEach((j, i) => {
    recs.push({
      src: 'journal', path: `delivery.journal[${i}]`, at: toMs(j.at), type: j.kind, reasonCode: '',
      label: j.kind === 'dispatch' ? `dispatch:${j.phase}` : j.kind, model: j.model || null,
      stageId: j.stageId || null, dispatchId: j.dispatchId || null, requestId: j.requestId || null,
      tabId: j.tabId ?? null, details: journalDetails(j), raw: j
    });
  });
  return recs.sort((a, b) => a.at - b.at);
}

// Text length carried by a record, if any (answer length, text length, "len=N" in the details).
function textLengthOf(rec) {
  // prepared.chars is the prompt length, not answer text.
  if (rec.src === 'journal') return rec.type !== 'prepared' && Number.isFinite(rec.raw.chars) && rec.raw.chars > 0 ? rec.raw.chars : null;
  const p = rec.raw.payload || {};
  const ev = p.evidence && typeof p.evidence === 'object' ? p.evidence : {};
  for (const value of [p.answerLength, ev.answerLength, ev.answerLen, ev.textLength]) {
    if (Number.isFinite(value) && value > 0) return value;
  }
  const match = /\blen=(\d+)/.exec(String(p.details || ''));
  return match && Number(match[1]) > 0 ? Number(match[1]) : null;
}

// Attempt = one transport request (one model in one batch). Built from delivery.journal batch_start;
// without a delivery section, one attempt per stage × model seen in events[].
function buildAttempts(stages, events, journal) {
  const stageIndex = new Map(stages.map((s, i) => [s.stageId, i]));
  const stageOfBatch = (batchId, stageId) => {
    if (stageId && stageIndex.has(stageId)) return stageId;
    return stages.find((s) => String(batchId || '').startsWith(`${s.stageId}:`))?.stageId || stageId || null;
  };
  const prepared = journal.filter((j) => j.kind === 'prepared');
  const attempts = [];
  journal.forEach((j, i) => {
    if (j.kind !== 'batch_start') return;
    const stageId = stageOfBatch(j.batchId, j.stageId);
    (j.models || []).forEach((model) => {
      const prep = prepared.find((p) => p.batchId === j.batchId && p.model === model);
      const requestId = j.requestIds?.[model] || prep?.requestId || null;
      attempts.push({
        requestId, model, stageId, stageN: stageIndex.has(stageId) ? stageIndex.get(stageId) + 1 : null,
        batchId: j.batchId || null, stageAttemptId: j.stageAttemptId || j.batchId || null, waitId: j.waitId || null,
        batchAt: toMs(j.at), batchPath: `delivery.journal[${i}]`, token: prep?.token || null, dispatchIds: [], recs: []
      });
    });
  });
  if (!attempts.length) {
    stages.forEach((s, i) => {
      const models = [...new Set(events.filter((e) => e.correlation?.stageId === s.stageId).map((e) => e.payload?.model).filter(Boolean))];
      models.forEach((model) => attempts.push({
        requestId: null, model, stageId: s.stageId, stageN: i + 1, batchId: null, stageAttemptId: null, waitId: null,
        batchAt: s.actual?.startedAt, batchPath: null, token: null, dispatchIds: [], recs: []
      }));
    });
  }
  return attempts;
}

// Join every record to an attempt: requestId, then dispatchId, then (labelled) stageId + model.
// A dispatchId belongs to the attempt that started it (journal dispatch:dispatch_started under that
// requestId), else to the first request it was recorded under. The same dispatchId recorded under a
// later request is kept as that request's `foreignDispatchIds` and does not move events to it.
function assignRecords(attempts, recs) {
  const byRequest = new Map(attempts.filter((a) => a.requestId).map((a) => [a.requestId, a]));
  const byDispatch = new Map();
  const journalWithDispatch = recs.filter((r) => r.src === 'journal' && r.requestId && r.dispatchId && byRequest.has(r.requestId));
  journalWithDispatch.filter((r) => r.label === 'dispatch:dispatch_started').forEach((r) => {
    if (!byDispatch.has(r.dispatchId)) byDispatch.set(r.dispatchId, byRequest.get(r.requestId));
  });
  journalWithDispatch.forEach((r) => { if (!byDispatch.has(r.dispatchId)) byDispatch.set(r.dispatchId, byRequest.get(r.requestId)); });
  attempts.forEach((a) => { a.foreignDispatchIds = []; });
  journalWithDispatch.forEach((r) => {
    const a = byRequest.get(r.requestId);
    const owner = byDispatch.get(r.dispatchId);
    const list = owner === a ? a.dispatchIds : a.foreignDispatchIds;
    if (!list.includes(r.dispatchId)) list.push(r.dispatchId);
    if (owner !== a) (a.foreignOwners ||= {})[r.dispatchId] = owner;
  });
  const unassigned = [];
  recs.forEach((r) => {
    let a = null;
    let via = null;
    if (r.requestId && byRequest.has(r.requestId)) { a = byRequest.get(r.requestId); via = 'requestId'; }
    else if (r.dispatchId && byDispatch.has(r.dispatchId)) { a = byDispatch.get(r.dispatchId); via = 'dispatchId'; }
    else if (r.model && r.stageId) {
      const candidates = attempts.filter((x) => x.model === r.model && x.stageId === r.stageId);
      if (candidates.length === 1) { a = candidates[0]; via = 'stageId'; }
      else if (candidates.length > 1) { a = candidates.filter((x) => x.batchAt <= r.at).pop() || candidates[0]; via = 'stageId+time'; }
    }
    if (!a) {
      if (r.model || r.requestId || r.dispatchId) unassigned.push(r);
      return;
    }
    r.attempt = a;
    r.via = via;
    a.recs.push(r);
  });
  attempts.forEach((a) => {
    const j = (label) => a.recs.find((r) => r.src === 'journal' && r.label === label);
    a.dispatchStarted = j('dispatch:dispatch_started')?.at ?? null;
    a.submitted = j('dispatch:submitted')?.at ?? a.recs.find((r) => r.type === 'SUBMIT_CONFIRMED')?.at ?? null;
    a.firstText = j('first_text')?.at ?? null;
    a.final = a.recs.find((r) => r.src === 'journal' && ['verified', 'empty_answer', 'missing_token'].includes(r.type)) || null;
    a.completionTerminals = a.recs.filter((r) => r.type === 'completion_terminal');
    a.terminals = a.recs.filter((r) => r.type === 'MODEL_TERMINAL_COMMITTED');
    a.stable = a.recs.filter((r) => r.type === 'TEXT_STABLE');
    a.stageFailed = a.recs.filter((r) => r.type === 'STAGE_FAILED');
    a.manual = a.recs.filter((r) => r.type === 'MANUAL_RECOVERY_REQUESTED');
    a.correlation = a.recs.filter((r) => r.type === 'CORRELATION_REJECTED');
    // Labels of attribution weakness, kept per record.
    a.recs.forEach((r) => {
      r.flags = [];
      if (r.via && r.via.startsWith('stageId')) r.flags.push(`joined by ${r.via}`);
      if (r.via && r.via.startsWith('stageId') && a.dispatchStarted != null && r.at < a.dispatchStarted) r.flags.push('before this attempt\'s dispatch_started');
      if (r.stageId && a.stageId && r.stageId !== a.stageId) r.flags.push(`record stageId=${short(r.stageId)}`);
      const owner = r.dispatchId && a.foreignOwners?.[r.dispatchId];
      if (owner) r.flags.push(`dispatchId started by the stage-${owner.stageN ?? '?'} / ${owner.model} request`);
    });
  });
  return unassigned;
}

const terminalStatusOf = (r) => {
  const ev = r.raw.payload?.evidence || {};
  return ev.finalStatus || r.raw.payload?.status || '';
};
const terminalReasonOf = (r) => r.raw.payload?.evidence?.completionReason || '';
const describeTerminal = (r) => (r ? `${terminalStatusOf(r) || '""'}/${terminalReasonOf(r) || 'no completionReason'}/${r.raw.payload?.answerLength ?? 'no answerLength'}` : '—');

const NOISE_LABELS = new Set(['SELECTOR_STATS', 'text_progress']);

function isProblemAttempt(a, send) {
  if (a.stageFailed.length || a.manual.length || a.correlation.length) return true;
  if (a.recs.some((r) => ['stale_dropped', 'identity_rejected', 'revision', 'late_text'].includes(r.type) || /ANSWER_DELIVERY_REJECTED/.test(`${r.label} ${r.reasonCode}`))) return true;
  if (a.terminals.some((r) => terminalStatusOf(r) !== 'SUCCESS' || terminalReasonOf(r) !== 'lifecycle_complete_snapshot')) return true;
  if (a.completionTerminals.some((r) => r.raw.status !== 'SUCCESS_TERMINAL')) return true;
  if (a.final && a.final.type !== 'verified') return true;
  if (send && send.result && send.result !== 'delivered') return true;
  return a.recs.some((r) => r.flags.length && !r.flags.every((f) => f.startsWith('joined by')));
}

// ---------------------------------------------------------------- Disput Flow export
function summarizeDisputFlow(d) {
  const out = [];
  const events = Array.isArray(d.events) ? d.events : [];
  const delivery = d.delivery && typeof d.delivery === 'object' ? d.delivery : null;
  const journal = Array.isArray(delivery?.journal) ? delivery.journal : [];
  const diag = delivery?.diagnosis && typeof delivery.diagnosis === 'object' ? delivery.diagnosis : {};
  const sends = Array.isArray(diag.sends) ? diag.sends : [];
  const stages = (d.stageExecutions || []).slice().sort((a, b) => (a.actual?.startedAt || 0) - (b.actual?.startedAt || 0));
  const t0 = stages[0]?.actual?.startedAt ?? d.runOutcome?.startedAt ?? events[0]?.sourceTimestamp ?? 0;
  const t = (at) => (Number.isFinite(at) ? T3(at - t0) : '—');
  const stageLabel = (stageId) => {
    const i = stages.findIndex((s) => s.stageId === stageId);
    return i >= 0 ? `stage-${i + 1}` : short(stageId) || '—';
  };
  const m = d.metadata || {};
  const recs = buildRecords(events, journal);
  const attempts = buildAttempts(stages, events, journal);
  const unassigned = assignRecords(attempts, recs);
  const sendOf = (a) => sends.find((s) => (a.requestId && s.requestId === a.requestId) || (s.model === a.model && a.batchId && s.batchId === a.batchId)) || null;
  const attemptName = (a) => `${a.stageN ? `stage-${a.stageN}` : short(a.stageId)} / ${a.model}`;

  out.push('## Disput Flow export');
  out.push('Legend: `path` = value from the file; `calc:` = computed (formula given); "no field", null, "", [] and "0 records" are different answers. '
    + `t = seconds from stageExecutions[0].actual.startedAt = ${t0} (0.001 s). "+st" = from the stage start, "+sub" = from this attempt's submit.`);
  out.push(`- metadata: extensionVersion=${fieldValue(m, 'extensionVersion')} · presetId=${fieldValue(m, 'presetId')} · runMode=${fieldValue(m, 'runMode')} · topology=${fieldValue(m, 'topology')} · dataCompleteness=${fieldValue(m, 'dataCompleteness')} · exportedAt=${fieldValue(m, 'exportedAt')}`);
  const ro = d.runOutcome || {};
  out.push(`- runOutcome: startedAt=${fieldValue(ro, 'startedAt')} (t=${t(ro.startedAt)}) · completedAt=${fieldValue(ro, 'completedAt')} (t=${t(ro.completedAt)}) · durationMs=${fieldValue(ro, 'durationMs')} · terminalOutcome=${fieldValue(ro, 'terminalOutcome')}`);
  const h = d.health || {};
  out.push(`- health: classification=${fieldValue(h, 'classification')} · severity=${fieldValue(h, 'severity')} · diagnosisCount=${fieldValue(h, 'diagnosisCount')} · manualRecoveryCount=${fieldValue(h, 'manualRecoveryCount')} · forcedCompletionCount=${fieldValue(h, 'forcedCompletionCount')} · stateDivergenceCount=${fieldValue(h, 'stateDivergenceCount')}`);
  out.push(`- events[]: ${records(events.length)} · ${counted(events, (e) => e.eventType) || '—'}`);

  // ---- 1. What the file can and cannot prove
  out.push('\n### 1. Data sufficiency');
  const integrity = d.integrity || {};
  const seqs = events.map((e) => e.receivedSeq).filter(Number.isFinite).sort((a, b) => a - b);
  out.push(`- events[].length=${events.length} · integrity.eventsTotal=${fieldValue(integrity, 'eventsTotal')} · integrity.firstSeq..lastSeq=${fieldValue(integrity, 'firstSeq')}..${fieldValue(integrity, 'lastSeq')} · events[].receivedSeq range=${seqs.length ? `${seqs[0]}..${seqs[seqs.length - 1]}` : '—'}`);
  if (Number.isFinite(integrity.eventsTotal) && integrity.eventsTotal !== events.length) {
    const missing = seqs.length ? (seqs[seqs.length - 1] - seqs[0] + 1) - new Set(seqs).size : 0;
    out.push(`- events[].length ≠ integrity.eventsTotal (calc: ${integrity.eventsTotal} − ${events.length} = ${integrity.eventsTotal - events.length}); receivedSeq numbers absent inside the events[] range: ${missing}. integrity.* (sequenceGaps included) does not describe the events[] array of this file.`);
  }
  out.push(`- plan=${fieldValue(d, 'plan')} · stageExecutions[].expected: ${stages.map((s) => fieldValue(s, 'expected')).join(', ') || '—'} · deviations: ${counted(stages.flatMap((s) => s.deviations || []), (x) => x) || '[]'}`);
  out.push(`- delivery=${delivery ? 'present' : 'no field'}${delivery ? ` · delivery.diagnosis: ${['batches', 'sends', 'problems', 'rejections', 'moderator', 'matrix'].map((k) => `${k}=${fieldValue(diag, k)}`).join(' · ')} · delivery.journal=${fieldValue(delivery, 'journal')}` : ''}`);
  const preparedRecs = journal.map((j, i) => ({ j, i })).filter(({ j }) => j.kind === 'prepared');
  const truncated = preparedRecs.filter(({ j }) => Number.isFinite(j.chars) && String(j.prompt || '').length < j.chars);
  out.push(`- delivery.journal prepared.prompt: ${records(preparedRecs.length)}, stored shorter than prepared.chars: ${truncated.length}. A fragment found in a stored prompt confirms it was sent; a fragment not found in a shortened prompt proves nothing.`);
  out.push(`- dispatchAttempts=${fieldValue(d, 'dispatchAttempts')} · without dispatchId: ${(d.dispatchAttempts || []).filter((x) => !x.dispatchId).length}`);
  out.push(`- records joined to a request: by requestId ${recs.filter((r) => r.via === 'requestId').length} · by dispatchId ${recs.filter((r) => r.via === 'dispatchId').length} · by stageId+model only ${recs.filter((r) => r.via && r.via.startsWith('stageId')).length} · with a model but not joined ${unassigned.length}`);
  out.push('- Absent from this export format (cannot be checked from the file): the reason a lifecycle observer stopped, the version/hash of the answer shown in the feed and of the one passed on, the feed text itself.');

  // ---- 2. Stages
  out.push('\n### 2. Stages (stageExecutions[], t in seconds)');
  const medianDur = median(stages.map((s) => s.durationMs));
  const failedByStage = (stageId) => [
    ...recs.filter((r) => r.type === 'STAGE_FAILED' && r.stageId === stageId).map((r) => r.path),
    ...(d.diagnoses || []).map((x, i) => ({ x, i })).filter(({ x }) => x.code === 'STAGE_FAILURE' && x.affectedStageId === stageId).map(({ i }) => `diagnoses[${i}]`)
  ];
  out.push(table(['#', 'stage', 'participants', 'start t', 'end t', 'durationMs', 'gap to next, s', 'status', 'LONG', 'CONTRADICTION', 'deviations'], stages.map((s, i) => {
    const next = stages[i + 1];
    const gap = next ? next.actual.startedAt - s.actual.completedAt : null;
    const long = [];
    if (medianDur && s.durationMs > 3 * medianDur) long.push('LONG(>3×median)');
    if (s.durationMs > 120000) long.push('LONG(>120000ms)');
    const failed = failedByStage(s.stageId);
    const contradiction = s.status === 'success' && failed.length ? `success + STAGE_FAILED/STAGE_FAILURE: ${failed.join(', ')}` : '—';
    return [i + 1, `stage-${i + 1}`, (s.actual?.participants || []).join('+') || '[]', t(s.actual?.startedAt), t(s.actual?.completedAt), s.durationMs ?? '—', T3(gap), s.status, long.join(' ') || '—', contradiction, (s.deviations || []).join(',') || '[]'];
  })));
  const sortedDur = stages.map((s) => s.durationMs).filter(Number.isFinite).sort((a, b) => a - b);
  out.push(`- calc: median durationMs of sorted [${sortedDur.join(', ')}] = ${medianDur ?? '—'}; LONG = durationMs > 3 × median (${medianDur != null ? 3 * medianDur : '—'}) or > 120000.`);
  out.push(`- stageId map: ${stages.map((s, i) => `stage-${i + 1} = ${s.stageId}`).join(' · ') || '—'}`);

  // ---- 3. Identity map
  out.push('\n### 3. Identity map (attempt = one transport request)');
  out.push(table(['stage', 'model', 'requestId', 'token', 'stageAttemptId', 'waitId', 'dispatchIds', 'dispatchIds of other requests recorded here', 'tabIds', 'batch_start'], attempts.map((a) => [
    a.stageN ? `stage-${a.stageN}` : short(a.stageId), a.model, a.requestId || 'no field', a.token || '—', short(a.stageAttemptId) || '—', a.waitId || '—',
    a.dispatchIds.map((id, k) => `d${k + 1}=${id}`).join(' ') || '—',
    (a.foreignDispatchIds || []).map((id) => `${id} (stage-${a.foreignOwners[id].stageN ?? '?'} / ${a.foreignOwners[id].model})`).join(' ') || '—',
    [...new Set(a.recs.map((r) => r.tabId).filter((x) => x != null))].join(',') || '—', a.batchPath || '—'
  ])));
  const foreignDispatch = recs.filter((r) => r.dispatchId && !r.attempt);
  out.push(`- records with a dispatchId found in no attempt: ${foreignDispatch.length ? counted(foreignDispatch, (r) => `${r.dispatchId}(${r.label})`) : '0 records'}`);
  out.push(`- records with a model and no attempt: ${unassigned.length ? `${unassigned.length} — ${unassigned.slice(0, 8).map((r) => `${r.path} t=${t(r.at)} ${r.model || '—'} ${r.label}`).join('; ')}${unassigned.length > 8 ? '; …' : ''}` : '0 records'}`);

  // ---- 4. Attempts summary
  out.push('\n### 4. Attempts (t in seconds; delays in ms)');
  out.push(table(['stage', 'model', 'dispatch_started t', 'submitted t (+st)', 'first_text t', 'delivery final', 'completion_terminal', 'MODEL_TERMINAL_COMMITTED: n · first · last', 'STAGE_FAILED', 'manual (UI button)', 'CORRELATION_REJECTED', 'TEXT_STABLE→first/last terminal, ms'], attempts.map((a) => {
    const stage = stages[a.stageN - 1];
    const st0 = stage?.actual?.startedAt;
    const firstTerm = a.terminals[0];
    const lastTerm = a.terminals[a.terminals.length - 1];
    const stable = a.stable[0];
    const delay = (term) => (stable && term ? term.at - stable.at : null);
    const mark = (ms) => (ms == null ? '—' : `${ms}${ms < 0 ? ' (negative)' : ms > 120000 ? ' (>120000)' : ms > 15000 ? ' (>15000)' : ''}`);
    return [
      a.stageN ? `stage-${a.stageN}` : '—', a.model, t(a.dispatchStarted), a.submitted != null ? `${t(a.submitted)} (+${T3(a.submitted - st0)})` : '—', t(a.firstText),
      a.final ? `${a.final.type} ${a.final.raw.chars ?? '—'}ch ${a.final.raw.status || ''}/${a.final.raw.reason || ''} t=${t(a.final.at)}` : 'not recorded',
      a.completionTerminals.map((r) => `${r.raw.status}/${r.raw.reason} t=${t(r.at)}`).join('; ') || 'not recorded',
      a.terminals.length ? `${a.terminals.length} · ${describeTerminal(firstTerm)} t=${t(firstTerm.at)} · ${describeTerminal(lastTerm)} t=${t(lastTerm.at)}` : '0 events',
      a.stageFailed.map((r) => `t=${t(r.at)} ${r.reasonCode}${r.flags.length ? ` [${r.flags.join('; ')}]` : ''}`).join('; ') || '—',
      a.manual.length ? `${a.manual.length} (${a.manual.filter((r) => r.raw.payload?.details === 'UI button').length})` : '0',
      a.correlation.length ? counted(a.correlation, (r) => r.details || r.reasonCode) : '0',
      `${mark(delay(firstTerm))} / ${mark(delay(lastTerm))}`
    ];
  })));
  out.push('- calc: TEXT_STABLE→terminal = MODEL_TERMINAL_COMMITTED.sourceTimestamp − first TEXT_STABLE.sourceTimestamp of the same attempt; (negative) marks inconsistent data.');
  const forced = attempts.filter((a) => a.terminals.some((r) => terminalReasonOf(r) !== 'lifecycle_complete_snapshot'));
  out.push(`- attempts with completionReason ≠ lifecycle_complete_snapshot: ${forced.length ? forced.map((a) => `${attemptName(a)} (${[...new Set(a.terminals.map((r) => terminalReasonOf(r) || 'no completionReason'))].join(', ')})`).join('; ') : 'none'}`);
  out.push(`- attempts without COMPLETION_DETECTED: ${attempts.filter((a) => !a.recs.some((r) => r.type === 'COMPLETION_DETECTED')).map(attemptName).join('; ') || 'none'}`);
  out.push(`- MODEL_TERMINAL_COMMITTED: ${records(attempts.reduce((n, a) => n + a.terminals.length, 0))} over ${attempts.filter((a) => a.terminals.length).length} requests; not lifecycle_complete_snapshot: ${records(attempts.reduce((n, a) => n + a.terminals.filter((r) => terminalReasonOf(r) !== 'lifecycle_complete_snapshot').length, 0))}`);

  // ---- 5. Chronology of problem attempts
  out.push('\n### 5. Chronology of attempts with a failure, recovery, forced completion, rejection or attribution warning');
  const problemAttempts = attempts.filter((a) => isProblemAttempt(a, sendOf(a)));
  if (!problemAttempts.length) out.push('- none');
  problemAttempts.forEach((a) => {
    const st0 = stages[a.stageN - 1]?.actual?.startedAt;
    const lines = [];
    let lastKey = '';
    let lastAt = -1e15;
    let repeat = 0;
    const stableCount = a.stable.length;
    const flush = () => { if (repeat && lines.length) lines[lines.length - 1] += ` (×${repeat + 1} within 5 s)`; repeat = 0; };
    a.recs.forEach((r) => {
      if (NOISE_LABELS.has(r.label)) return;
      if (r.type === 'TEXT_STABLE' && r !== a.stable[0] && r !== a.stable[stableCount - 1]) return;
      const key = `${r.label}|${r.details.slice(0, 40)}`;
      if (key === lastKey && r.at - lastAt < 5000) { repeat += 1; lastAt = r.at; return; }
      flush();
      lastKey = key;
      lastAt = r.at;
      const len = textLengthOf(r);
      const ids = [r.dispatchId ? (a.dispatchIds.includes(r.dispatchId) ? `d${a.dispatchIds.indexOf(r.dispatchId) + 1}` : `dispatchId=${r.dispatchId}`) : null, len ? `len=${len}` : null].filter(Boolean).join(' ');
      const reason = r.reasonCode && r.reasonCode !== r.label ? ` ${r.reasonCode}` : '';
      lines.push(`t=${t(r.at)} +st ${T3(r.at - st0)} +sub ${a.submitted != null ? T3(r.at - a.submitted) : '—'} · ${r.path} · ${r.label}${reason}${r.details ? ` · ${r.details}` : ''}${ids ? ` · ${ids}` : ''}${r.flags.length ? ` [${r.flags.join('; ')}]` : ''}`);
    });
    flush();
    const CAP = 160;
    out.push(`\n#### ${attemptName(a)} · requestId=${a.requestId || 'no field'} · ${records(a.recs.length)} joined, ${lines.length} lines (SELECTOR_STATS/text_progress omitted; TEXT_STABLE: first and last of ${stableCount})`);
    out.push(lines.slice(0, CAP).map((l) => `    ${l}`).join('\n') + (lines.length > CAP ? `\n    … ${lines.length - CAP} more lines (cap ${CAP})` : ''));
    const missingSteps = [
      ['dispatch_started', a.dispatchStarted], ['submitted', a.submitted], ['first_text', a.firstText],
      ['completion_terminal', a.completionTerminals[0]?.at], ['MODEL_TERMINAL_COMMITTED', a.terminals[0]?.at], ['delivery final', a.final?.at]
    ].filter(([, at]) => at == null).map(([name]) => name);
    out.push(`    not recorded for this attempt: ${missingSteps.join(', ') || '—'}`);
  });

  // ---- 6. Text that may belong to an earlier request
  out.push('\n### 6. Text lengths recorded before submit, or equal to the previous attempt\'s answer');
  const staleLines = [];
  attempts.forEach((a) => {
    const prev = attempts.filter((x) => x.model === a.model && x.batchAt < a.batchAt).pop();
    const prevLengths = new Map();
    if (prev) {
      prev.recs.forEach((r) => {
        if (!(r.type === 'MODEL_TERMINAL_COMMITTED' || ['verified', 'empty_answer', 'missing_token'].includes(r.type))) return;
        const len = textLengthOf(r);
        if (len) prevLengths.set(len, r.path);
      });
      const send = sendOf(prev);
      if (send?.terminal?.chars) prevLengths.set(send.terminal.chars, `delivery.diagnosis.sends[${sends.indexOf(send)}].terminal.chars`);
    }
    // Repeats of the same label and length are one line: count, first and last record.
    const groups = new Map();
    a.recs.forEach((r) => {
      const len = textLengthOf(r);
      if (!len || NOISE_LABELS.has(r.label)) return;
      const beforeSubmit = a.submitted != null && r.at < a.submitted;
      const equalsPrev = prevLengths.has(len);
      if (!beforeSubmit && !equalsPrev) return;
      const key = `${r.label}|${len}|${beforeSubmit}`;
      const g = groups.get(key) || { first: r, last: r, n: 0, len, beforeSubmit, equalsPrev };
      g.last = r;
      g.n += 1;
      groups.set(key, g);
    });
    groups.forEach((g) => {
      const span = g.n > 1 ? ` ×${g.n}, first ${g.first.path} t=${t(g.first.at)}, last ${g.last.path} t=${t(g.last.at)}` : ` ${g.first.path} t=${t(g.first.at)}`;
      staleLines.push(`- ${attemptName(a)} · ${g.first.label} len=${g.len}${span}${g.beforeSubmit ? ` · before this attempt's submit (t=${t(a.submitted)})` : ''}${g.equalsPrev ? ` · equals ${attemptName(prev)} final length (${prevLengths.get(g.len)})` : ''}`);
    });
  });
  out.push(staleLines.length ? staleLines.join('\n') : '- none');

  // ---- 7. Lengths
  out.push('\n### 7. Answer lengths per attempt');
  out.push(table(['stage', 'model', 'delivery.sends terminal.chars', 'journal final chars', 'MODEL_TERMINAL_COMMITTED answerLength', 'ANSWER_COLLECTED answerLength', 'revision chars', 'stale_dropped chars'], attempts.map((a) => {
    const send = sendOf(a);
    const list = (type) => a.recs.filter((r) => r.type === type).map((r) => r.raw.payload?.answerLength ?? r.raw.chars ?? 'null');
    return [a.stageN ? `stage-${a.stageN}` : '—', a.model, send ? (send.terminal ? fieldValue(send.terminal, 'chars') : 'no field') : 'no send', a.final ? fieldValue(a.final.raw, 'chars') : 'not recorded',
      list('MODEL_TERMINAL_COMMITTED').join(', ') || '0 events', list('ANSWER_COLLECTED').join(', ') || '0 events', list('revision').join(', ') || '0 records', list('stale_dropped').join(', ') || '0 records'];
  })));
  out.push('- Each column is a different measurement point; whether a value was taken before or after transport cleaning is not stated in the file.');

  // ---- 8. Manual and moderator actions
  out.push('\n### 8. Manual and moderator actions');
  const manualRecs = recs.filter((r) => r.type === 'MANUAL_RECOVERY_REQUESTED');
  const uiButtons = manualRecs.filter((r) => r.raw.payload?.details === 'UI button');
  out.push(`- MANUAL_RECOVERY_REQUESTED: ${records(manualRecs.length)}; of them details="UI button": ${uiButtons.length}; other details: ${counted(manualRecs.filter((r) => r.raw.payload?.details !== 'UI button'), (r) => clip(r.raw.payload?.details, 60) || '""') || '—'}`);
  manualRecs.forEach((r) => out.push(`  - t=${t(r.at)} ${stageLabel(r.stageId)} ${r.model || '—'} · ${r.path} · ${clip(r.raw.payload?.details, 90) || '""'}`));
  const successStages = new Set(stages.filter((s) => s.status === 'success').map((s) => s.stageId));
  out.push(`- calc: MANUAL_RECOVERY_REQUESTED on stages with status=success: ${manualRecs.filter((r) => successStages.has(r.stageId)).length} records, "UI button": ${uiButtons.filter((r) => successStages.has(r.stageId)).length}`);
  if (delivery) {
    const kinds = ['run_paused', 'moderator_pause', 'moderator_get_it', 'get_it_result', 'moderator_stage_close', 'moderator_close_refused', 'moderator_approve', 'owner_answer', 'stall_adopted', 'response_rejected', 'text_lost', 'displayed', 'unproven_replaced', 'late_text'];
    const extraModerator = [...new Set(journal.map((j) => j.kind).filter((k) => /^moderator_/.test(k) && !kinds.includes(k)))];
    out.push(`- delivery.journal kinds: ${[...kinds, ...extraModerator].map((k) => `${k}=${journal.filter((j) => j.kind === k).length}`).join(' · ')} (0 = no records of that kind in an existing journal)`);
    journal.map((j, i) => ({ j, i })).filter(({ j }) => kinds.includes(j.kind) || /^moderator_/.test(j.kind)).slice(0, 30)
      .forEach(({ j, i }) => out.push(`  - t=${t(toMs(j.at))} delivery.journal[${i}] ${j.kind} ${j.model || ''} ${journalDetails(j)}`));
    out.push(`- delivery.diagnosis.moderator=${fieldValue(diag, 'moderator')} · delivery.diagnosis.rejections=${fieldValue(diag, 'rejections')}`);
  } else {
    out.push('- Get it / Pause / Next / Approve: no field delivery.journal');
  }

  // ---- 9. Start refusals
  out.push('\n### 9. Start refusals');
  const batches = Array.isArray(diag.batches) ? diag.batches : [];
  const refusalLines = [];
  batches.forEach((b, i) => {
    const refusals = Array.isArray(b.refusals) ? b.refusals : [];
    if (!refusals.length) return;
    const bAt = toMs(b.at);
    const accepted = journal.map((j, k) => ({ j, k })).find(({ j }) => j.kind === 'start_accepted' && j.waitId === b.waitId);
    const first = refusals[0];
    const last = refusals[refusals.length - 1];
    refusalLines.push(`- delivery.diagnosis.batches[${i}] ${b.waitId} (${stageLabel(stages.find((s) => String(b.batchId || '').startsWith(`${s.stageId}:`))?.stageId)}) · batch at t=${t(bAt)} · refusals ${refusals.length}: ${counted(refusals, (r) => r.errorCode || 'no errorCode')} · blockingModel: ${counted(refusals, (r) => fieldValue(r, 'blockingModel'))}`);
    refusalLines.push(`  first refusal t=${t(toMs(first.at))} (calc: at − batch.at = ${toMs(first.at) - bAt} ms) · last refusal t=${t(toMs(last.at))} (calc: ${toMs(last.at) - bAt} ms) · refusals[].waitedMs as recorded: ${refusals.map((r) => r.waitedMs).join(', ')}`);
    refusalLines.push(`  start accepted: ${accepted ? `t=${t(toMs(accepted.j.at))} delivery.journal[${accepted.k}] (calc: ${toMs(accepted.j.at) - bAt} ms after batch.at)` : 'not recorded'} · batches[${i}].accepted.waitedMs=${fieldValue(b.accepted, 'waitedMs')}`);
    refusalLines.push('  lock duration: not measured (the file has no lock begin/end records)');
  });
  out.push(delivery ? (refusalLines.length ? refusalLines.join('\n') : '- 0 refusals in delivery.diagnosis.batches[].refusals') : '- no field delivery');

  // ---- 10. Focus
  out.push('\n### 10. Focus switches (delivery.journal kind=focus)');
  const focus = recs.filter((r) => r.type === 'focus');
  if (!delivery) out.push('- no field delivery.journal');
  else {
    out.push(`- total ${focus.length} · by source: ${counted(focus, (r) => r.raw.source || 'no source') || '—'} · by model: ${counted(focus, (r) => r.model || '—') || '—'}`);
    const inWindow = [];
    attempts.forEach((a) => {
      const end = a.final?.at ?? a.completionTerminals[0]?.at ?? null;
      if (a.firstText == null || end == null) return;
      a.recs.filter((r) => r.type === 'focus' && r.at > a.firstText && r.at < end).forEach((r) => inWindow.push(r));
    });
    out.push(`- in the interval first_text → delivery final of the same request (the interval does not prove continuous printing): ${inWindow.length} · by source: ${counted(inWindow, (r) => r.raw.source || 'no source') || '—'}`);
    out.push(`- automation_visit_*: ${focus.filter((r) => /^automation_visit_/.test(r.raw.source || '')).length} (in interval ${inWindow.filter((r) => /^automation_visit_/.test(r.raw.source || '')).length}) · activate_tab_*: ${focus.filter((r) => /^activate_tab_/.test(r.raw.source || '')).length} (in interval ${inWindow.filter((r) => /^activate_tab_/.test(r.raw.source || '')).length})`);
  }

  // ---- 11. Outside the run window
  out.push('\n### 11. Records outside the run window');
  const runEnd = ro.completedAt ?? stages[stages.length - 1]?.actual?.completedAt ?? null;
  const outsideAll = recs.filter((r) => Number.isFinite(r.at) && (r.at < t0 - 1000 || (runEnd != null && r.at > runEnd + 1000)));
  const outside = outsideAll.filter((r) => !NOISE_LABELS.has(r.label));
  if (outsideAll.length !== outside.length) out.push(`- SELECTOR_STATS/text_progress outside the window: ${outsideAll.length - outside.length} records (not listed)`);
  out.push(outside.length
    ? `${outside.slice(0, 40).map((r) => `- t=${t(r.at)} ${r.at < t0 ? 'before the first stage' : `${T3(r.at - runEnd)} s after runOutcome.completedAt`} · ${r.path} · ${r.model || '—'} · ${r.label}${r.reasonCode && r.reasonCode !== r.label ? ` ${r.reasonCode}` : ''}${r.details ? ` · ${r.details}` : ''}`).join('\n')}${outside.length > 40 ? `\n- … ${outside.length - 40} more` : ''}\n- A late record shows that something was recorded; by itself it does not show that generation continued.`
    : '- none (tolerance 1 s)');

  // ---- 12. Was the answer in a later prompt
  out.push('\n### 12. Delivered answer found in a later stored prompt');
  const normalize = (s) => String(s || '').replace(/[*_#`>|]/g, '').replace(/\s+/g, ' ').trim();
  const answers = recs.filter((r) => r.type === 'verified' && normalize(r.raw.answer).length >= 40);
  if (!delivery) out.push('- no field delivery.journal');
  else if (!answers.length) out.push('- no delivery.journal verified record with stored answer text');
  else {
    answers.forEach((r) => {
      const probe = normalize(r.raw.answer).slice(0, 50);
      const later = preparedRecs.filter(({ j }) => toMs(j.at) > r.at);
      const found = later.filter(({ j }) => normalize(j.prompt).includes(probe));
      const shortened = later.filter(({ j }) => Number.isFinite(j.chars) && String(j.prompt || '').length < j.chars && !normalize(j.prompt).includes(probe));
      const owner = r.attempt ? attemptName(r.attempt) : r.model;
      const result = found.length
        ? `found in ${found.map(({ j, i }) => `delivery.journal[${i}] (${j.model}, ${short(j.batchId)})`).join(', ')}`
        : later.length ? `not found in ${later.length} later prompts; ${shortened.length} of them stored shortened → inconclusive` : 'no later prompt';
      out.push(`- ${owner} · ${r.path} ${r.raw.chars ?? '—'}ch · probe "${probe.slice(0, 40)}…" · ${result}`);
    });
  }

  // ---- 13. Diagnoses
  out.push('\n### 13. diagnoses[]');
  const diagnoses = d.diagnoses || [];
  const rank = { critical: 0, high: 1, warning: 2, info: 3 };
  if (!diagnoses.length) out.push(`- diagnoses=${fieldValue(d, 'diagnoses')}`);
  else {
    const groups = new Map();
    diagnoses.forEach((x) => {
      const key = `${x.code}|${x.reasonCode}`;
      const g = groups.get(key) || { code: x.code, reasonCode: x.reasonCode, severity: new Set(), who: new Set(), stagesSet: new Set(), occurrences: 0, unresolved: 0, n: 0 };
      g.severity.add(x.severity); g.who.add(x.affectedParticipant ?? 'null'); g.stagesSet.add(stageLabel(x.affectedStageId));
      g.occurrences += Number(x.occurrences || 0); g.unresolved += x.resolvedAt == null ? 1 : 0; g.n += 1;
      groups.set(key, g);
    });
    const groupRank = (g) => Math.min(...[...g.severity].map((s) => rank[s] ?? 9));
    out.push(table(['code', 'reasonCode', 'severity', 'participants', 'stages', 'records', 'Σ occurrences', 'resolvedAt=null'], [...groups.values()]
      .sort((a, b) => groupRank(a) - groupRank(b))
      .map((g) => [g.code, g.reasonCode, [...g.severity].join(','), [...g.who].join(','), [...g.stagesSet].join(','), g.n, g.occurrences, g.unresolved])));
    out.push('');
    out.push(table(['path', 'severity', 'code', 'reasonCode', 'stage', 'participant', 'occurrences', 'firstObservedAt t', 'resolvedAt'], diagnoses.map((x, i) => ({ x, i }))
      .sort((a, b) => (rank[a.x.severity] ?? 9) - (rank[b.x.severity] ?? 9) || (a.x.firstObservedAt || 0) - (b.x.firstObservedAt || 0))
      .map(({ x, i }) => [`diagnoses[${i}]`, x.severity, x.code, x.reasonCode, stageLabel(x.affectedStageId), x.affectedParticipant ?? 'null', x.occurrences, t(x.firstObservedAt), x.resolvedAt == null ? 'null' : x.resolvedAt])));
  }

  // ---- 14. Disagreements between fields
  out.push('\n### 14. Disagreements between fields (both sides shown; none is taken as correct)');
  const disagreements = [];
  stages.forEach((s, i) => {
    const failed = failedByStage(s.stageId);
    if (s.status === 'success' && failed.length) disagreements.push(`stageExecutions[${i}].status=success · STAGE_FAILED/STAGE_FAILURE for this stageId: ${failed.join(', ')}`);
  });
  recs.filter((r) => r.type === 'STAGE_FAILED' && r.attempt && r.stageId && r.attempt.stageId !== r.stageId)
    .forEach((r) => disagreements.push(`${r.path} STAGE_FAILED has stageId=${stageLabel(r.stageId)} but joins by ${r.via} to the ${attemptName(r.attempt)} request`));
  if (Number.isFinite(h.manualRecoveryCount) && h.manualRecoveryCount !== manualRecs.length) disagreements.push(`health.manualRecoveryCount=${h.manualRecoveryCount} · MANUAL_RECOVERY_REQUESTED events=${manualRecs.length}`);
  if (Number.isFinite(h.manualRecoveryCount) && uiButtons.length && h.manualRecoveryCount !== uiButtons.length) disagreements.push(`health.manualRecoveryCount=${h.manualRecoveryCount} · MANUAL_RECOVERY_REQUESTED with details="UI button"=${uiButtons.length}`);
  const forcedTerminals = recs.filter((r) => r.type === 'MODEL_TERMINAL_COMMITTED' && /^forced/.test(terminalReasonOf(r)));
  if (Number.isFinite(h.forcedCompletionCount) && h.forcedCompletionCount !== forcedTerminals.length) disagreements.push(`health.forcedCompletionCount=${h.forcedCompletionCount} · MODEL_TERMINAL_COMMITTED with completionReason forced_*=${forcedTerminals.length} (${forcedTerminals.map((r) => r.path).join(', ')})`);
  attempts.forEach((a) => {
    const send = sendOf(a);
    const last = a.terminals[a.terminals.length - 1];
    if (send?.terminal?.status && last && terminalStatusOf(last) && send.terminal.status !== terminalStatusOf(last)) disagreements.push(`${attemptName(a)}: delivery.diagnosis.sends[${sends.indexOf(send)}].terminal.status=${send.terminal.status} · last MODEL_TERMINAL_COMMITTED ${last.path} finalStatus=${terminalStatusOf(last)}`);
    if (send?.result === 'delivered' && a.stageFailed.length) disagreements.push(`${attemptName(a)}: delivery.diagnosis.sends[${sends.indexOf(send)}].result=delivered · STAGE_FAILED ${a.stageFailed.map((r) => r.path).join(', ')}`);
  });
  if (Number.isFinite(integrity.eventsTotal) && integrity.eventsTotal !== events.length) disagreements.push(`integrity.eventsTotal=${integrity.eventsTotal} · events[].length=${events.length}`);
  out.push(disagreements.length ? disagreements.map((x) => `- ${x}`).join('\n') : '- none');
  if (Number.isFinite(h.stateDivergenceCount)) out.push(`- (context) health.stateDivergenceCount=${h.stateDivergenceCount} counts STATE_DIVERGENCE events only.`);

  // ---- 15. Per model (whole run)
  const models = [...new Set(attempts.map((a) => a.model))];
  out.push('\n### 15. Per model (whole run)');
  out.push(table(['model', 'stages', 'last terminal per stage (status/reason)', 'manual (UI button)', 'STAGE_FAILED', 'last stage with this model'], models.map((model) => {
    const mine = attempts.filter((a) => a.model === model);
    const lastStage = Math.max(...mine.map((a) => a.stageN || 0));
    return [model, mine.map((a) => a.stageN).join(','), mine.map((a) => { const last = a.terminals[a.terminals.length - 1]; return `${a.stageN}:${last ? `${terminalStatusOf(last) || '""'}/${terminalReasonOf(last) || '—'}` : 'none'}`; }).join(' '),
      mine.reduce((n, a) => n + a.manual.filter((r) => r.raw.payload?.details === 'UI button').length, 0), mine.reduce((n, a) => n + a.stageFailed.length, 0),
      lastStage && lastStage < stages.length ? `stage-${lastStage} of ${stages.length}` : `stage-${lastStage}`];
  })));

  // ---- 16. Dispatch attempts and integrity
  const dispatches = d.dispatchAttempts || [];
  out.push('\n### 16. dispatchAttempts and integrity');
  out.push(`- dispatchAttempts: ${dispatches.length} · without dispatchId ${dispatches.filter((x) => !x.dispatchId).length} · submitStatus: ${counted(dispatches, (x) => fieldValue(x, 'submitStatus')) || '—'} · terminalStatus: ${counted(dispatches, (x) => fieldValue(x, 'terminalStatus')) || '—'}`);
  out.push(`- integrity: ${['eventsTotal', 'firstSeq', 'lastSeq', 'sequenceGaps', 'duplicateEventIds', 'uncorrelatedEvents', 'missingRequiredStageEvents', 'missingTerminalEvents', 'clockSkewWarnings', 'redactedFieldsCount', 'schemaValidationErrors'].map((k) => `${k}=${fieldValue(integrity, k)}`).join(' · ')}`);
  out.push('- No integrity error is not evidence that transport was correct.');

  // ---- 17. Delivery section (former Automation tab)
  if (delivery) {
    out.push('\n### 17. delivery ("start" is t, seconds from the first stage start; other time columns are durations)');
    out.push(summarizeDelivery(delivery, { t0, digits: 3, embedded: true }));
  }
  return out.join('\n');
}

// ---------------------------------------------------------------- message-delivery report
// Standalone file: times relative to the first journal event, 0.1 s. Embedded in a Disput Flow
// export: times relative to the first stage start (t0), 0.001 s, paths prefixed with "delivery.".
function summarizeDelivery(d, options = {}) {
  const out = [];
  const diag = d.diagnosis || {};
  const journal = d.journal || [];
  const digits = options.digits ?? 1;
  const t0 = options.t0 ?? Date.parse(journal[0]?.at || d.generated_at);
  const rel = (at) => SEC(Date.parse(at) - t0, digits);
  const dur = (ms) => SEC(ms, digits);
  const p = options.embedded ? 'delivery.' : '';
  const h = options.embedded ? '####' : '###';
  if (!options.embedded) out.push('## message-delivery report');
  out.push(`- version ${d.extension_version} · contract ${d.transport_contract_version} · generated ${d.generated_at} · journal ${journal.length} events (${journal[0]?.at?.slice(11, 23)} → ${journal[journal.length - 1]?.at?.slice(11, 23)})`);
  const batches = diag.batches || [];
  out.push(`\n${h} Batches (${options.embedded ? `${p}diagnosis.batches[]` : 'times relative to the first journal event'})`);
  out.push(batches.length ? table(['wait', 'stage attempt', 'mode', 'template', 'models', 'start', 'accepted after', 'refusals', 'outcome', 'duration', 'gap before', 'skipped/adopted'], batches.map((b, i) => {
    const prev = batches[i - 1];
    const prevEnd = prev ? Date.parse(prev.at) + (prev.durationMs || 0) : null;
    const listed = (key) => (options.embedded ? fieldValue(b, key) : (b[key] || []).join(',') || '—');
    return [b.waitId, short(b.stageAttemptId || b.batchId), b.runMode || '—', b.template || '—', (b.models || []).join('+'), rel(b.at), dur(b.accepted?.waitedMs), (b.refusals || []).length || '—', b.outcome || 'open', dur(b.durationMs), prevEnd ? dur(Date.parse(b.at) - prevEnd) : '—', `${listed('skipped')}/${listed('adopted')}`];
  })) : '- none');
  const refusals = batches.flatMap((b) => (b.refusals || []).map((r) => `${b.waitId}#${r.attempt} ${r.errorCode}${r.reason ? `(${r.reason})` : ''} after ${dur(r.waitedMs)}`));
  out.push(`\n${h} Start refusals: ${refusals.length ? refusals.join('; ') : 'none'}`);

  out.push(`\n${h} Sends${options.embedded ? ` (${p}diagnosis.sends[])` : ''}`);
  out.push(table(['model', 'stage attempt', 'submitted', '1st text', 'result', 'terminal', 'chars', 'completion', 'focus', 'revisions', 'rejections'], (diag.sends || []).map((s) => [
    s.model, short(s.batchId), dur(s.submittedMs), dur(s.firstTextMs), s.result, s.terminal?.status || '—', s.terminal?.chars ?? '—', s.terminal?.completion || '—',
    `${s.focus?.count || 0}${s.focus?.sources ? ` ${Object.entries(s.focus.sources).map(([k, n]) => `${k}:${n}`).join(',')}` : ''}`, s.revisions || 0, (s.rejections || []).map((r) => r.reason).join(',') || '—'])));

  out.push(`\n${h} Problems (grouped${options.embedded ? `, ${p}diagnosis.problems[]` : ''})`);
  const problems = diag.problems || [];
  out.push(problems.length ? table(['code', 'severity', 'model', '×', 'reason'], problems.map((x) => [x.code, x.severity, x.model || '—', x.count || 1, String(x.reason || '').slice(0, 110) || '—'])) : '- none');

  const interesting = ['run_paused', 'moderator_pause', 'moderator_get_it', 'get_it_result', 'moderator_stage_close', 'moderator_close_refused', 'moderator_approve', 'owner_answer', 'stall_adopted', 'response_rejected', 'ui_phantom_state', 'displayed'];
  const events = journal.filter((e) => interesting.includes(e.kind));
  out.push(`\n${h} Engine and moderator events${options.embedded ? ` (${p}journal[])` : ''}`);
  out.push(events.length ? events.map((e) => `- ${rel(e.at)} ${e.kind} ${JSON.stringify(Object.fromEntries(Object.entries(e).filter(([k]) => !['at', 'kind', 'prompt'].includes(k)))).slice(0, 160)}`).join('\n') : '- none');
  out.push(`\n${h} Identity rejections: ${count(journal.filter((e) => e.kind === 'identity_rejected'), (e) => `${e.model}:${e.reason}`).map(([k, n]) => `${k}×${n}`).join(', ') || 'none'}`);
  return out.join('\n');
}

function extractTransport(report, sourceFile) {
  if (!report?.metadata?.debateRunId || !Array.isArray(report.stageExecutions) || !Array.isArray(report.events)) {
    throw new Error('Transport extraction requires a Disput Flow report');
  }
  return {
    schemaVersion: 1,
    report: 'extract_transport',
    sourceFile,
    debateRunId: report.metadata.debateRunId,
    format: 'markdown',
    digest: summarizeDisputFlow(report)
  };
}
const api = Object.freeze({ summarizeDisputFlow, summarizeDelivery, median, extractTransport });
root.ReportDigest = api;
if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
