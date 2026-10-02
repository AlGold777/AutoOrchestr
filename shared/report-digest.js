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
  .join(' ');

// One time-ordered list of events[] and delivery.journal[] entries with their identifiers.
function buildRecords(events, journal) {
  const recs = [];
  events.forEach((e, i) => {
    const p = e.payload || {};
    const c = e.correlation || {};
    recs.push({
      src: 'events', path: `events[${i}]`, at: toMs(e.sourceTimestamp), type: e.eventType, reasonCode: e.reasonCode || '',
      label: p.originalLabel || e.eventType, model: p.model || p.participant || null,
      stageId: c.stageId || p.stageId || null, dispatchId: c.dispatchId || p.dispatchId || null, requestId: p.transportRequestId || p.requestId || c.requestId || null,
      tabId: c.tabId == null ? null : String(c.tabId), details: String(p.details || p.note || ''), raw: e
    });
  });
  journal.forEach((j, i) => {
    recs.push({
      src: 'journal', path: `delivery.journal[${i}]`, at: toMs(j.at), type: j.kind, reasonCode: '',
      label: j.kind === 'dispatch' ? `dispatch:${j.phase}` : j.kind, model: j.model || null,
      stageId: j.stageId || null, dispatchId: j.dispatchId || null, requestId: j.requestId || null,
      tabId: j.tabId == null ? null : String(j.tabId), details: journalDetails(j), raw: j
    });
  });
  return recs.sort((a, b) => a.at - b.at);
}

// Text length carried by a record, if any (answer length, text length, "len=N" in the details).
function textLengthOf(rec) {
  // prepared.chars is the prompt length, not answer text.
  if (rec.src === 'journal') return rec.type !== 'prepared' && Number.isFinite(rec.raw.chars) && rec.raw.chars >= 0 ? rec.raw.chars : null;
  const p = rec.raw.payload || {};
  const ev = p.evidence && typeof p.evidence === 'object' ? p.evidence : {};
  for (const value of [p.answerLength, ev.answerLength, ev.answerLen, ev.textLength]) {
    if (Number.isFinite(value) && value >= 0) return value;
  }
  const match = /\blen=(\d+)/.exec(String(p.details || ''));
  return match && Number(match[1]) >= 0 ? Number(match[1]) : null;
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
      const models = [...new Set(arr(s.actual?.participants).concat(events.filter((e) => e.correlation?.stageId === s.stageId).map((e) => e.payload?.model || e.payload?.participant)).filter(Boolean))];
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
// Structured facts are the source of both JSON and Markdown. No Markdown is embedded in JSON.
const DIGEST_VERSION = '2.0.0';
const COMPRESSION = Object.freeze({
  allRequests: true, chronologyLimit: null, outsideWindowToleranceMs: 0,
  terminalPairWindowMs: 50, promptProbeCharacters: 50,
  grouping: 'request + dispatchId + status + reason + significant fields; changes split groups',
  stable: 'first and every change, including zero length, correlation and dispatch changes',
  background: 'counts and first/last paths; all member paths retained in JSON',
  ignoredGroupingFields: ['elapsedMs', 'durationMs', 'foregroundMsUsed', 'focusSwitchesUsed', 'waitedMs', 'ms', 'at', 'SELECTOR_STATS sampled hit/miss/rate counters']
});
const arr = (v) => Array.isArray(v) ? v : [];
const finite = (v) => Number.isFinite(v) ? v : null;
const unique = (v) => [...new Set(v)];
const field = (obj, key, prefix) => has(obj, key)
  ? { path: prefix === 'root' ? key : `${prefix}.${key}`, state: 'present', value: obj[key] }
  : { path: prefix === 'root' ? key : `${prefix}.${key}`, state: 'missing' };
const fields = (obj, names, prefix) => Object.fromEntries(names.map((k) => [k, field(obj, k, prefix)]));
const display = (f) => {
  if (f === null) return 'null';
  if (f === undefined) return 'no field';
  if (has(f, 'state')) return f.state === 'missing' ? 'no field' : display(f.value);
  if (Array.isArray(f)) return f.length ? f.map(display).join(', ') : '[]';
  if (typeof f === 'object') return JSON.stringify(f);
  if (f === '') return '""';
  return String(f);
};
const pathValue = (f) => `${f.path}=${display(f)}`;
const listCounts = (items, fn) => Object.fromEntries(count(items, fn));
const offset = (at, base) => Number.isFinite(at) && Number.isFinite(base) ? Number(((at - base) / 1000).toFixed(3)) : null;
const TABLE_EVENT_NAMES = new Set(['dispatch:dispatch_started', 'dispatch:submitted', 'focus', 'tab', 'navigation']);

function stateOf(r) {
  const p = r.raw.payload || {}, ev = p.evidence || {};
  return r.src === 'journal' ? r.raw.status ?? null : ev.finalStatus || p.status || ev.responsePhase || /\bstate=([^ ]+)/.exec(r.details)?.[1] || null;
}
function reasonOf(r) { return r.raw.reason || r.raw.errorCode || r.raw.payload?.evidence?.reason || r.reasonCode || null; }
function recordRound(r) { return r.raw.correlation?.pipelineRoundId ?? r.raw.payload?.pipelineRoundId ?? r.raw.pipelineRoundId ?? null; }
function timeFact(r, t0, st0, submitted) {
  return r ? { path: r.path, at: finite(r.at), t: offset(r.at, t0), stageSeconds: offset(r.at, st0), submitSeconds: offset(r.at, submitted) } : null;
}
function recordFact(r, t0) {
  const p = r.raw.payload || {};
  return {
    path: r.path, at: finite(r.at), t: offset(r.at, t0), type: r.type, label: r.label,
    model: r.model, tabId: r.tabId, dispatchId: r.dispatchId, requestId: r.requestId,
    recordedStageId: r.stageId, pipelineRoundId: recordRound(r),
    status: stateOf(r), reason: reasonOf(r), textLength: textLengthOf(r),
    details: r.src === 'events' ? r.details : journalDetails(r.raw),
    evidence: r.src === 'events' ? { ...(p.evidence || {}) } : {},
    correlationQuality: field(r.raw.correlation, 'correlationQuality', `${r.path}.correlation`),
    joinedBy: r.via || null, flags: r.flags || []
  };
}
// Time counters and sample durations vary on every poll and are not grouping keys.
// Their first/last registered values remain available, as do every member's source paths.
function signature(r) {
  const raw = r.src === 'events' ? r.raw.payload || {} : r.raw;
  const evidence = raw.evidence || {};
  const omit = new Set(['elapsedMs', 'durationMs', 'foregroundMsUsed', 'focusSwitchesUsed', 'waitedMs', 'ms', 'at']);
  if (r.label === 'SELECTOR_STATS') ['hitCount', 'missCount', 'totalCount', 'hitRate'].forEach((k) => omit.add(k));
  const significant = Object.fromEntries(Object.entries(evidence).filter(([k]) => !omit.has(k)));
  const detail = r.label === 'SELECTOR_STATS' ? r.details.replace(/ hit=.*$/, '')
    : r.details.replace(/\b(elapsed|waited|duration|ms)=\d+(?:ms)?/g, '$1=<time>');
  return JSON.stringify([r.type, r.label, r.dispatchId, stateOf(r), reasonOf(r), textLengthOf(r),
    raw.errorCode, raw.completion, raw.source, raw.phase, significant,
    r.stageId, recordRound(r), has(raw, 'status') ? { value: raw.status } : { missing: true }, r.raw.correlation?.correlationQuality, r.flags || [], detail]);
}
function compactRecords(list, t0) {
  const result = [], groups = new Map(), states = new Map();
  list.forEach((r) => {
    // Returning to an old length/status/dispatch is a new transition, not a repeat of an old group.
    const hardState = JSON.stringify([r.dispatchId, stateOf(r), textLengthOf(r)]);
    const previous = states.get(r.label);
    const epoch = previous ? previous.epoch + (previous.key === hardState ? 0 : 1) : 0;
    states.set(r.label, { key: hardState, epoch });
    const key = `${epoch}|${signature(r)}`, row = groups.get(key);
    if (row) {
      row.count += 1; row.paths.push(r.path); row.last = { path: r.path, at: finite(r.at), t: offset(r.at, t0) };
    } else {
      const next = { label: r.label, count: 1, paths: [r.path], first: recordFact(r, t0),
        last: { path: r.path, at: finite(r.at), t: offset(r.at, t0) } };
      result.push(next); groups.set(key, next);
    }
  });
  return result;
}
function terminalGroups(a, t0) {
  const result = [];
  a.terminals.forEach((r) => {
    const previous = result[result.length - 1], length = textLengthOf(r);
    const pair = previous && previous.members.length === 1 && r.at - previous.firstAt >= 0
      && r.at - previous.firstAt <= COMPRESSION.terminalPairWindowMs
      && previous.dispatchId === r.dispatchId && previous.status === terminalStatusOf(r)
      && previous.completionReason === terminalReasonOf(r)
      && (previous.canonicalLength == null || length == null || previous.canonicalLength === length)
      && new Set([previous.members[0].label, r.label]).size === 2
      && [previous.members[0].label, r.label].every((x) => ['MODEL_FINAL', 'FINALIZATION_DECISION'].includes(x));
    const ev = r.raw.payload?.evidence || {};
    const member = {
      path: r.path, label: r.label, t: offset(r.at, t0), at: finite(r.at),
      answerLength: field(r.raw.payload, 'answerLength', `${r.path}.payload`),
      evidenceAnswerLen: field(ev, 'answerLen', `${r.path}.payload.evidence`),
      evidenceAnswerLength: field(ev, 'answerLength', `${r.path}.payload.evidence`),
      registered: fields(ev, ['foregroundMsUsed', 'focusSwitchesUsed', 'doneReason', 'durationMs'], `${r.path}.payload.evidence`),
      flags: r.flags || []
    };
    if (pair) { previous.members.push(member); previous.lastAt = r.at; previous.intervalMs = r.at - previous.firstAt; }
    else result.push({ dispatchId: r.dispatchId, status: terminalStatusOf(r), completionReason: terminalReasonOf(r),
      canonicalLength: length, firstAt: finite(r.at), lastAt: finite(r.at), intervalMs: 0, members: [member] });
  });
  return result;
}
function buildTransportDigest(d, sourceFile = null) {
  if (!d?.metadata?.debateRunId || !Array.isArray(d.stageExecutions) || !Array.isArray(d.events)) {
    throw new Error('Transport extraction requires a Disput Flow report');
  }
  const events = d.events, journal = arr(d.delivery?.journal), diag = d.delivery?.diagnosis || {};
  const stages = d.stageExecutions, diagnoses = arr(d.diagnoses), sends = arr(diag.sends);
  // Source order is retained so stage aliases, paths and the requested time base stay exact.
  const t0 = toMs(stages[0]?.actual?.startedAt);
  const recs = buildRecords(events, journal), attempts = buildAttempts(stages, events, journal);
  const unassigned = assignRecords(attempts, recs);
  const stageAlias = (id) => { const i = stages.findIndex((s) => s.stageId === id); return i < 0 ? id : `stage-${i + 1}`; };
  const sendOf = (a) => sends.find((x) => a.requestId && x.requestId === a.requestId)
    || sends.find((x) => !x.requestId && x.model === a.model && a.batchId && x.batchId === a.batchId);
  const failurePaths = (id) => recs.filter((r) => r.type === 'STAGE_FAILED' && r.stageId === id).map((r) => r.path)
    .concat(diagnoses.flatMap((x, i) => x.code === 'STAGE_FAILURE' && x.affectedStageId === id ? [`diagnoses[${i}]`] : []));
  const durations = stages.map((s) => s.durationMs).filter(Number.isFinite), med = median(durations);
  const stageRows = stages.map((s, i) => ({
    path: `stageExecutions[${i}]`, stage: `stage-${i + 1}`, stageId: s.stageId,
    participants: field(s.actual, 'participants', `stageExecutions[${i}].actual`),
    start: field(s.actual, 'startedAt', `stageExecutions[${i}].actual`), end: field(s.actual, 'completedAt', `stageExecutions[${i}].actual`),
    startT: offset(toMs(s.actual?.startedAt), t0), endT: offset(toMs(s.actual?.completedAt), t0),
    durationMs: field(s, 'durationMs', `stageExecutions[${i}]`), status: field(s, 'status', `stageExecutions[${i}]`),
    gapSeconds: i + 1 < stages.length ? offset(toMs(stages[i + 1].actual?.startedAt), toMs(s.actual?.completedAt)) : null,
    long: Number.isFinite(s.durationMs) && ((med != null && s.durationMs > med * 3) || s.durationMs > 120000),
    successWithFailureRecords: s.status === 'success' ? failurePaths(s.stageId) : [],
    deviations: field(s, 'deviations', `stageExecutions[${i}]`), expected: field(s, 'expected', `stageExecutions[${i}]`)
  }));
  const lengthRows = [], stageTimeline = stages.map((s, i) => ({ stage: `stage-${i + 1}`, stageId: s.stageId, rows: [] }));
  const sharedPaths = new Set();
  recs.forEach((r) => {
    if (!TABLE_EVENT_NAMES.has(r.label) && r.type !== 'SUBMIT_CONFIRMED') return;
    const target = stageTimeline.find((x) => x.stageId === (r.attempt?.stageId || r.stageId));
    if (target) { target.rows.push(recordFact(r, t0)); sharedPaths.add(r.path); }
  });
  const requestRows = attempts.map((a, index) => {
    const st0 = toMs(stages[a.stageN - 1]?.actual?.startedAt), submitted = a.submitted;
    const first = (fn) => a.recs.find(fn);
    const milestone = (fn) => timeFact(first(fn), t0, st0, submitted);
    const terminals = terminalGroups(a, t0), send = sendOf(a);
    const own = a.recs.filter((r) => !sharedPaths.has(r.path));
    const transitions = [], background = [];
    own.forEach((r) => {
      if (r.type === 'MODEL_TERMINAL_COMMITTED') return;
      const exceptional = ['TEXT_STABLE', 'COMPLETION_DETECTED', 'STAGE_FAILED', 'MANUAL_RECOVERY_REQUESTED', 'CORRELATION_REJECTED',
        'completion_terminal', 'first_text', 'verified', 'empty_answer', 'missing_token', 'stale_dropped', 'identity_rejected', 'revision', 'ANSWER_COLLECTED',
        'ANSWER_REJECTED', 'response_rejected', 'late_text', 'unproven_replaced', 'get_it_result', 'owner_answer'].includes(r.type)
        || /ANSWER_DELIVERY_REJECTED|MATERIALIZE_RECOVERY_|RECOVERY_ATTEMPT|STABLE_TEXT_FALLBACK|TERMINAL_FAILURE_UPGRADED/.test(`${r.label} ${r.type}`);
      if (exceptional) transitions.push(r);
      else background.push(r);
    });
    const transitionGroups = compactRecords(transitions, t0), backgroundGroups = compactRecords(background, t0);
    // Terminal members preserve both paths and all registered fields, rather than discarding a duplicate.
    const terminalRows = terminals.map((group) => ({ label: 'terminal_group', count: group.members.length,
      paths: group.members.map((m) => m.path), first: { t: offset(group.firstAt, t0), at: group.firstAt, path: group.members[0].path }, group }));
    const transitionRows = transitionGroups.concat(terminalRows).sort((x, y) => (x.first.at ?? Infinity) - (y.first.at ?? Infinity));
    const counts = {
      duplicateFinalRejected: a.recs.filter((r) => r.type === 'DUPLICATE_FINAL_REJECTED').length,
      wrongCard: a.recs.filter((r) => r.label === 'ANSWER_CARD_RENDER_EVALUATED' && r.raw.payload?.details === 'wrong_card').length,
      displayed: a.recs.filter((r) => r.type === 'displayed').length,
      manualRecords: a.manual.length, uiButtonRecords: a.manual.filter((r) => r.raw.payload?.details === 'UI button').length,
      correlationRejected: a.correlation.length, terminalRecords: a.terminals.length, terminalGroups: terminals.length
    };
    const length = (r) => ({ path: r.path, value: r.raw.payload
      ? field(r.raw.payload, 'answerLength', `${r.path}.payload`) : field(r.raw, 'chars', r.path) });
    const lr = { request: index + 1, stage: stageAlias(a.stageId), model: a.model,
      measurements: { delivery: send ? field(send.terminal, 'chars', `delivery.diagnosis.sends[${sends.indexOf(send)}].terminal`) : null,
        journal: a.final ? field(a.final.raw, 'chars', a.final.path) : null,
        collected: a.recs.filter((r) => r.type === 'ANSWER_COLLECTED').map(length),
        terminal: terminals.flatMap((g) => g.members.map((m) => ({ answerLength: m.answerLength, evidenceAnswerLen: m.evidenceAnswerLen, evidenceAnswerLength: m.evidenceAnswerLength }))),
        revisions: a.recs.filter((r) => r.type === 'revision').map(length), staleDropped: a.recs.filter((r) => r.type === 'stale_dropped').map(length) } };
    lengthRows.push(lr);
    return {
      request: index + 1, requestId: a.requestId, stage: stageAlias(a.stageId), stageId: a.stageId, model: a.model,
      identity: { token: a.token, batchId: a.batchId, stageAttemptId: a.stageAttemptId, waitId: a.waitId, batchStartPath: a.batchPath,
        pipelineRoundIds: unique(a.recs.map(recordRound).filter((x) => x != null)),
        roundSources: a.recs.filter((r) => recordRound(r) != null).map((r) => r.path),
        tabIds: unique(a.recs.map((r) => r.tabId).filter((x) => x != null)), dispatchIds: a.dispatchIds,
        foreignDispatchIds: a.foreignDispatchIds.map((id) => ({ dispatchId: id, ownerRequestId: a.foreignOwners[id].requestId,
          ownerStage: stageAlias(a.foreignOwners[id].stageId), ownerModel: a.foreignOwners[id].model })) },
      times: { dispatchStarted: milestone((r) => r.label === 'dispatch:dispatch_started'),
        submitted: milestone((r) => r.label === 'dispatch:submitted') || milestone((r) => r.type === 'SUBMIT_CONFIRMED'),
        firstText: milestone((r) => r.type === 'first_text'), firstStable: milestone((r) => r.type === 'TEXT_STABLE'),
        firstCompletionDetected: milestone((r) => r.type === 'COMPLETION_DETECTED'), deliveryFinal: timeFact(a.final, t0, st0, submitted) },
      deliveryResult: send ? field(send, 'result', `delivery.diagnosis.sends[${sends.indexOf(send)}]`) : null,
      collected: a.recs.filter((r) => r.type === 'ANSWER_COLLECTED').map((r) => ({ path: r.path,
        accepted: field(r.raw.payload, 'accepted', `${r.path}.payload`), pipelineBatchId: field(r.raw.payload, 'pipelineBatchId', `${r.path}.payload`) })),
      counts, terminalGroups: terminals,
      stableToTerminalMs: a.stable.length ? a.terminals.map((r) => ({ path: r.path,
        stablePath: a.stable[0].path, value: finite(r.at - a.stable[0].at) })) : [],
      transitions: transitionRows, background: backgroundGroups,
      coverage: { totalRecords: a.recs.length, sharedStageRecords: a.recs.length - own.length,
        representedRecords: transitionRows.reduce((n, r) => n + r.count, 0) + backgroundGroups.reduce((n, r) => n + r.count, 0),
        transitionLines: transitionRows.length, backgroundLines: backgroundGroups.length, omittedRecords: 0 }
    };
  });
  // Text observations are comparisons of lengths only, never assertions of text identity.
  const lengthObservations = [];
  attempts.forEach((a, i) => {
    const prev = attempts.slice(0, i).filter((x) => x.model === a.model).pop();
    const prevLen = prev ? textLengthOf(prev.final || prev.terminals[prev.terminals.length - 1] || { src: 'journal', type: 'none', raw: {} }) : null;
    a.recs.forEach((r) => {
      if (r.type === 'prepared') return;
      const len = textLengthOf(r);
      if (len == null) return;
      const beforeSubmit = a.submitted != null && r.at < a.submitted, equalPrevious = prevLen != null && len === prevLen;
      if (beforeSubmit || equalPrevious) lengthObservations.push({ request: i + 1, path: r.path, t: offset(r.at, t0), length: len,
        beforeSubmit, equalPreviousLength: equalPrevious, previousRequest: prev ? attempts.indexOf(prev) + 1 : null });
    });
  });
  const prepared = journal.map((j, i) => ({ j, path: `delivery.journal[${i}]` })).filter(({ j }) => j.kind === 'prepared');
  const normalize = (v) => String(v || '').replace(/[*_#`>|]/g, '').replace(/\s+/g, ' ').trim();
  const promptChecks = recs.filter((r) => r.type === 'verified' && normalize(r.raw.answer).length >= 40).map((r) => {
    const probe = normalize(r.raw.answer).slice(0, COMPRESSION.promptProbeCharacters);
    const later = prepared.filter(({ j }) => toMs(j.at) > r.at);
    return { answerPath: r.path, request: r.attempt ? attempts.indexOf(r.attempt) + 1 : null, probe,
      laterPrompts: later.map(({ j, path }) => ({ path, model: j.model, batchId: j.batchId,
        found: normalize(j.prompt).includes(probe), shortened: Number.isFinite(j.chars) && String(j.prompt || '').length < j.chars })),
      result: later.some(({ j }) => normalize(j.prompt).includes(probe)) ? 'stored_fragment_found' : !later.length ? 'no_later_prompt'
        : later.some(({ j }) => Number.isFinite(j.chars) && String(j.prompt || '').length < j.chars) ? 'inconclusive_shortened' : 'not_found_in_stored_prompts',
      submissionProven: false, fullAnswerInclusionProven: false };
  });
  const diagnosisRows = diagnoses.map((x, i) => ({ path: `diagnoses[${i}]`,
    ...Object.fromEntries(['code', 'reasonCode', 'severity', 'affectedStageId', 'affectedParticipant', 'occurrences',
      'firstObservedAt', 'lastObservedAt', 'resolvedAt', 'summary', 'confidence'].filter((k) => has(x, k)).map((k) => [k, x[k]])) }));
  const groupedDiagnoses = [];
  diagnosisRows.forEach((x) => {
    let g = groupedDiagnoses.find((g) => g.code === x.code && g.reasonCode === x.reasonCode);
    if (!g) { g = { code: x.code, reasonCode: x.reasonCode, severities: [], participants: [], stages: [], records: 0,
      occurrences: 0, missingOccurrences: 0, resolvedNull: 0, paths: [] }; groupedDiagnoses.push(g); }
    g.records += 1; g.paths.push(x.path); g.severities = unique(g.severities.concat(x.severity));
    g.participants = unique(g.participants.concat(x.affectedParticipant == null ? [] : arr(x.affectedParticipant).length ? x.affectedParticipant : [x.affectedParticipant]));
    g.stages = unique(g.stages.concat(stageAlias(x.affectedStageId)));
    if (Number.isFinite(x.occurrences)) g.occurrences += x.occurrences; else g.missingOccurrences += 1;
    if (x.resolvedAt === null) g.resolvedNull += 1;
  });
  const sameNameComparisons = [];
  const compare = (name, left, right) => {
    if (left?.state === 'present' && right?.state === 'present' && left.value !== right.value) sameNameComparisons.push({ name, left, right });
  };
  lengthRows.forEach((r) => compare('chars', r.measurements.delivery, r.measurements.journal));
  const seqs = events.map((e) => e.receivedSeq).filter(Number.isFinite);
  const integrity = fields(d.integrity, ['eventsTotal', 'firstSeq', 'lastSeq', 'sequenceGaps', 'duplicateEventIds', 'uncorrelatedEvents',
    'missingRequiredStageEvents', 'missingTerminalEvents', 'clockSkewWarnings', 'redactedFieldsCount', 'schemaValidationErrors'], 'integrity');
  const computedIntegrity = { eventsTotal: events.length, firstSeq: seqs.length ? Math.min(...seqs) : null,
    lastSeq: seqs.length ? Math.max(...seqs) : null,
    missingSeqInsideExport: seqs.length ? Math.max(...seqs) - Math.min(...seqs) + 1 - new Set(seqs).size : 0 };
  ['eventsTotal', 'firstSeq', 'lastSeq'].forEach((k) => compare(k, integrity[k], { path: `calc(events[].${k})`, state: 'present', value: computedIntegrity[k] }));
  const forcedEvents = recs.filter((r) => r.type === 'STABLE_TEXT_FALLBACK_USED');
  const forcedRecords = recs.filter((r) => r.type === 'MODEL_TERMINAL_COMMITTED' && terminalReasonOf(r).startsWith('forced_'));
  const manual = recs.filter((r) => r.type === 'MANUAL_RECOVERY_REQUESTED');
  const comparableHealth = { diagnosisCount: diagnoses.length, manualRecoveryCount: manual.length,
    forcedCompletionCount: forcedEvents.length, stateDivergenceCount: recs.filter((r) => r.type === 'STATE_DIVERGENCE').length };
  Object.entries(comparableHealth).forEach(([k, v]) => compare(k, field(d.health, k, 'health'),
    { path: `calc(${k})`, state: 'present', value: v }));

  const focus = recs.filter((r) => r.type === 'focus');
  const inText = focus.filter((r) => r.attempt?.firstText != null && r.attempt?.final && r.at >= r.attempt.firstText && r.at <= r.attempt.final.at);
  const outside = recs.filter((r) => Number.isFinite(r.at) && ((Number.isFinite(t0) && r.at < t0) ||
    (Number.isFinite(toMs(d.runOutcome?.completedAt)) && r.at > toMs(d.runOutcome.completedAt))));
  const batches = arr(diag.batches).map((b, i, bs) => ({ path: `delivery.diagnosis.batches[${i}]`, ...b,
    stage: stageAlias(stages.find((s) => String(b.stageAttemptId || b.batchId || '').startsWith(s.stageId))?.stageId),
    t: offset(toMs(b.at), t0), gapSeconds: i && Number.isFinite(bs[i - 1].durationMs)
      ? offset(toMs(b.at), toMs(bs[i - 1].at) + bs[i - 1].durationMs) : null,
    refusalRows: arr(b.refusals).map((r, j) => ({ path: `delivery.diagnosis.batches[${i}].refusals[${j}]`, ...r, t: offset(toMs(r.at), t0),
      elapsedFromBatchMs: Number.isFinite(toMs(r.at)) && Number.isFinite(toMs(b.at)) ? toMs(r.at) - toMs(b.at) : null })) }));
  const noRound = recs.filter((r) => r.src === 'events' && !recordRound(r)).map((r) => r.path);
  return {
    schemaVersion: 2, report: 'extract_transport', DIGEST_VERSION, compression: { ...COMPRESSION }, sourceFile,
    debateRunId: d.metadata.debateRunId, base: { path: 'stageExecutions[0].actual.startedAt', value: finite(t0), unit: 'seconds', precision: 0.001 },
    metadata: fields(d.metadata, ['extensionVersion', 'presetId', 'runMode', 'topology', 'dataCompleteness', 'exportedAt'], 'metadata'),
    runOutcome: fields(d.runOutcome, ['startedAt', 'completedAt', 'durationMs', 'terminalOutcome'], 'runOutcome'),
    health: fields(d.health, ['classification', 'severity', 'diagnosisCount', 'manualRecoveryCount', 'forcedCompletionCount', 'stateDivergenceCount'], 'health'),
    quality: { correlationQuality: listCounts(events, (e) => fieldValue(e.correlation, 'correlationQuality')),
      provenance: listCounts(events, (e) => fieldValue(e, 'provenance')), eventsWithoutRound: { count: noRound.length, paths: noRound },
      completenessRule: 'events.some(event => event.correlation?.correlationQuality !== "exact"); provenance is counted separately',
      observedNonExact: events.filter((e) => e.correlation?.correlationQuality !== 'exact').length },
    availability: { plan: field(d, 'plan', 'root'), delivery: field(d, 'delivery', 'root').state,
      deliverySections: Object.fromEntries(['batches', 'sends', 'problems', 'moderator', 'rejections', 'matrix'].map((k) => [k,
        { path: `delivery.diagnosis.${k}`, state: has(diag, k) ? 'present' : 'missing', count: Array.isArray(diag[k]) ? diag[k].length : null }])),
      shortenedPrompts: prepared.filter(({ j }) => Number.isFinite(j.chars) && String(j.prompt || '').length < j.chars).map((r) => r.path),
      unassigned: unassigned.map((r) => recordFact(r, t0)) },
    calculations: { medianDurationMs: med, sortedDurations: durations.slice().sort((a, b) => a - b),
      long: 'durationMs > 3 * medianDurationMs OR durationMs > 120000',
      stableToTerminal: 'terminal.sourceTimestamp - first TEXT_STABLE.sourceTimestamp of the same request',
      stageGap: 'next.actual.startedAt - current.actual.completedAt',
      batchGap: 'next.at - (previous.at + previous.durationMs)' },
    stages: stageRows, requests: requestRows, stageTimeline, lengthObservations, lengths: lengthRows, promptChecks,
    manual: { rows: manual.map((r) => recordFact(r, t0)), records: manual.length,
      uiButtonRecords: manual.filter((r) => r.raw.payload?.details === 'UI button').length,
      onSuccessStages: manual.filter((r) => stages.some((s) => s.stageId === r.stageId && s.status === 'success')).length,
      journalKinds: listCounts(journal, (j) => j.kind),
      moderatorActions: recs.filter((r) => /^(moderator_|run_paused|get_it_result|owner_answer|stall_adopted|response_rejected|text_lost)/.test(r.label)
        || ['RUN_PAUSED', 'RUN_RESUMED', 'DECISION_REQUESTED', 'DECISION_RESOLVED'].includes(r.type)).map((r) => recordFact(r, t0)) },
    focus: { total: focus.length, sources: listCounts(focus, (r) => r.raw.source || 'no field'),
      models: listCounts(focus, (r) => r.model || 'no field'), inTextInterval: inText.length,
      inTextSources: listCounts(inText, (r) => r.raw.source || 'no field') },
    outsideRunWindow: compactRecords(outside, t0), diagnoses: { groups: groupedDiagnoses,
      appendix: diagnosisRows.sort((a, b) => ({ critical: 0, high: 1, warning: 2, info: 3 }[a.severity] ?? 4) - ({ critical: 0, high: 1, warning: 2, info: 3 }[b.severity] ?? 4)) },
    comparisons: sameNameComparisons,
    counters: { events: events.length, eventTypes: listCounts(events, (e) => e.eventType), requests: requestRows.length,
      forced: { events: forcedEvents.length, terminalRecords: forcedRecords.length,
        uniqueRequests: new Set(forcedRecords.filter((r) => r.attempt).map((r) => r.attempt)).size },
      terminal: { records: requestRows.reduce((n, a) => n + a.counts.terminalRecords, 0), groups: requestRows.reduce((n, a) => n + a.counts.terminalGroups, 0),
        uniqueRequests: requestRows.filter((a) => a.counts.terminalRecords).length },
      stages: { total: stages.length, success: stages.filter((s) => s.status === 'success').length,
        withFailureRecords: stageRows.filter((s) => s.successWithFailureRecords.length).length, long: stageRows.filter((s) => s.long).length },
      dispatchAttempts: { total: arr(d.dispatchAttempts).length, withoutDispatchId: arr(d.dispatchAttempts).filter((x) => !x.dispatchId).length,
        submitStatus: listCounts(arr(d.dispatchAttempts), (x) => fieldValue(x, 'submitStatus')),
        terminalStatus: listCounts(arr(d.dispatchAttempts), (x) => fieldValue(x, 'terminalStatus')) },
      startRefusals: batches.reduce((n, b) => n + b.refusalRows.length, 0),
      joinMethods: listCounts(recs, (r) => r.via || 'unassigned') },
    integrity: { registered: integrity, computed: computedIntegrity },
    delivery: { batches, problems: arr(diag.problems).map((x, i) => ({ path: `delivery.diagnosis.problems[${i}]`, ...x })) }
  };
}
function renderTransportMarkdown(x) {
  const out = ['# Transport extract', `DIGEST_VERSION=${x.DIGEST_VERSION} · sourceFile=${x.sourceFile || 'no field'} · debateRunId=${x.debateRunId}`,
    `Compression: all requests; no line cap; terminalPairWindowMs=${x.compression.terminalPairWindowMs}; promptProbeCharacters=${x.compression.promptProbeCharacters}; same request/dispatch/status/reason/significant fields only. Full parameters in JSON compression.`, `t = seconds from ${x.base.path}=${display(x.base.value)}, precision 0.001; +st/+sub appear only in the request table.`,
    'Notes: no field / null / "" / [] / 0 are distinct. Paths refer to the source JSON. Group counts include all member records; no line cap. Registered terminal evidence has no causal interpretation. Equal text lengths do not prove equal text. Stored prompt fragments do not prove submission or full-answer inclusion; shortened prompts cannot prove absence. Focus intervals do not prove continuous printing. Late records do not prove continued generation. Start-lock duration is not measured without begin/end records.',
    ...['metadata', 'runOutcome', 'health'].map((k) => `${k}: ${Object.values(x[k]).map(pathValue).join(' · ')}`)];
  const cell = (v) => display(v).replace(/\|/g, '\\|').replace(/\n/g, ' ');
  const rows = (head, rs) => table(head, rs.map((r) => r.map(cell)));
  const countsText = (v) => Object.entries(v).map(([k, n]) => `${k}=${n}`).join(', ');
  const time = (v) => v == null ? 'not recorded' : `${T3(v.t == null ? null : v.t * 1000)} ${v.path}`;
  const eventTime = (v) => `${T3(v.t == null ? null : v.t * 1000)} ${v.path}`;
  out.push('\n### 1. Data sufficiency',
    `events[].length=${x.counters.events} · integrity.eventsTotal=${display(x.integrity.registered.eventsTotal)} · correlationQuality: ${countsText(x.quality.correlationQuality)} · provenance: ${countsText(x.quality.provenance)}`,
    `incomplete rule: ${x.quality.completenessRule}; non-exact=${x.quality.observedNonExact}`,
    `plan=${display(x.availability.plan)} · delivery=${x.availability.delivery} · shortened prepared.prompt=${x.availability.shortenedPrompts.length}`,
    `events without pipelineRoundId=${x.quality.eventsWithoutRound.count}; complete path list is in JSON quality.eventsWithoutRound.paths.`,
    `join methods (all events+journal, including run-level records): ${countsText(x.counters.joinMethods)}; unmatched request/model records=${x.availability.unassigned.length} · dispatchAttempts=${JSON.stringify(x.counters.dispatchAttempts)}`,
    `integrity: ${Object.values(x.integrity.registered).map(pathValue).join(' · ')}`,
    `computed integrity: ${JSON.stringify(x.integrity.computed)}`,
    `Not recorded by this report: lifecycle observer stop reason, feed text and the version/hash of the displayed/passed answer.`);
  out.push('\n### 2. Stages', rows(['stage / path', 'participants', 'start t', 'end t', 'durationMs', 'gap s', 'status', 'LONG', 'success + failure records'],
    x.stages.map((s) => [`${s.stage} ${s.path}`, s.participants, s.startT == null ? null : s.startT.toFixed(3), s.endT == null ? null : s.endT.toFixed(3),
      s.durationMs, s.gapSeconds == null ? null : s.gapSeconds.toFixed(3), s.status, s.long, s.successWithFailureRecords])),
    `calc: median durationMs of sorted [${x.calculations.sortedDurations.join(', ')}] = ${x.calculations.medianDurationMs}; LONG: ${x.calculations.long}`,
    ...x.stages.map((s) => `${s.stage}=${s.stageId} · ${s.expected.path}=${display(s.expected)} · deviations=${display(s.deviations)}`));
  out.push('\n### 3. Identity map', rows(['request', 'stage/model', 'requestId', 'pipelineRoundId', 'token', 'stageAttemptId / wait', 'dispatchIds / foreign', 'tabIds', 'batch_start'],
    x.requests.map((a) => [a.request, `${a.stage}/${a.model}`, a.requestId, a.identity.pipelineRoundIds, a.identity.token,
      `${short(a.identity.stageAttemptId)} / ${a.identity.waitId}`, `${a.identity.dispatchIds.map((id, i) => `d${i + 1}=${id}`).join(', ')} / ${a.identity.foreignDispatchIds.map((f) => `${f.dispatchId} (${f.ownerStage}/${f.ownerModel})`).join(', ') || '—'}`,
      a.identity.tabIds, a.identity.batchStartPath])));
  out.push('\n### 4. All requests', rows(['request', 'stage/model', 'dispatch', 'submitted (+st/+sub)', 'first_text', 'first TEXT_STABLE', 'first COMPLETION_DETECTED', 'counts dup/wrong/display/manual(UI)', 'terminal groups', 'ANSWER_COLLECTED.accepted', 'stable→terminal ms'],
    x.requests.map((a) => [a.request, `${a.stage}/${a.model}`, time(a.times.dispatchStarted),
      a.times.submitted ? `${time(a.times.submitted)} (+st=${a.times.submitted.stageSeconds}, +sub=${a.times.submitted.submitSeconds})` : 'not recorded',
      time(a.times.firstText), time(a.times.firstStable), time(a.times.firstCompletionDetected),
      `${a.counts.duplicateFinalRejected}/${a.counts.wrongCard}/${a.counts.displayed}/${a.counts.manualRecords}(${a.counts.uiButtonRecords})`,
      a.terminalGroups.map((g) => `${g.members.map((m) => m.path).join('+')} (${g.intervalMs}ms)`),
      a.collected.map((r) => pathValue(r.accepted)), a.stableToTerminalMs.map((r) => `${r.value} ${r.path}${r.value > 120000 ? ' >120000' : r.value > 15000 ? ' >15000' : r.value < 0 ? ' negative' : ''}`)])),
    'calc: stable→terminal ms = terminal.sourceTimestamp − first TEXT_STABLE.sourceTimestamp for this request.');
  const groupText = (g) => `${g.status}/${g.completionReason} · dispatchId=${g.dispatchId} · interval=${g.intervalMs}ms · `
    + g.members.map((m) => `${m.path} ${m.label} answerLength=${display(m.answerLength)} evidence.answerLen=${display(m.evidenceAnswerLen)} evidence.answerLength=${display(m.evidenceAnswerLength)}` ).join('; ');
  out.push('\n### 5. Stage timeline and request transitions');
  const dispatchRef = (r) => {
    if (!r.dispatchId) return '—';
    const owner = x.requests.find((a) => a.identity.dispatchIds.includes(r.dispatchId));
    return owner ? `Q${owner.request}.d${owner.identity.dispatchIds.indexOf(r.dispatchId) + 1}` : r.dispatchId;
  };
  x.stageTimeline.forEach((s) => { out.push(`\n#### ${s.stage} — shared timeline`, rows(['t', 'model', 'event', 'dispatch', 'path', 'details'],
    s.rows.map((r) => [r.t == null ? null : r.t.toFixed(3), r.model, r.type === 'dispatch' ? r.label.replace('dispatch:', '') : r.type,
      dispatchRef(r), r.path, r.type === 'tab' ? `tabId=${r.tabId}` : r.details.replace(/\bms=\d+ ?/g, '')]))); });
  x.requests.forEach((a) => {
    const c = a.coverage;
    const dispatch = (id) => { const i = a.identity.dispatchIds.indexOf(id); return i < 0 ? id : `d${i + 1}`; };
    out.push(`\n#### Request ${a.request}: ${a.stage}/${a.model}`, `Shown ${c.representedRecords} of ${c.totalRecords - c.sharedStageRecords} request records, ${c.sharedStageRecords} in shared timeline; ${c.transitionLines} transitions + ${c.backgroundLines} background groups; omitted=${c.omittedRecords}.`);
    a.transitions.forEach((r) => {
      if (r.group) {
        out.push(`- t=${T3(r.first.t == null ? null : r.first.t * 1000)} terminal_group · ${groupText({ ...r.group, dispatchId: dispatch(r.group.dispatchId) })}`);
        r.group.members.forEach((m) => { const registered = Object.entries(m.registered).filter(([, f]) => f.state === 'present');
          if (registered.length) out.push(`  registered ${m.path}.payload.evidence: ${registered.map(([k, f]) => `${k}=${display(f)}`).join(', ')}`); });
      } else {
        const f = r.first;
        out.push(`- t=${T3(f.t == null ? null : f.t * 1000)} ${f.path} ${f.type}${f.textLength == null ? '' : ` len=${f.textLength}`}${f.status ? ` status=${f.status}` : ''}${f.reason ? ` reason=${f.reason}` : ''}${f.dispatchId ? ` ${dispatch(f.dispatchId)}` : ''}${/MANUAL|RECOVERY|CORRELATION|STAGE_FAILED/.test(`${f.type} ${f.label}`) && f.details ? ` · ${f.details}` : ''}${f.flags.length ? ` [${f.flags.join('; ')}]` : ''}${r.count > 1 ? ` ×${r.count} · last ${eventTime(r.last)}` : ''}`);
      }
    });
    const backgroundLabel = (r) => {
      if (/FINALIZATION_DEFER|TERMINAL_SUCCESS_DEFER/.test(r.first.reason || '')) return r.first.reason;
      if (r.first.type === 'UI_PROJECTION_FAILED') return r.first.reason || r.label;
      if (r.first.type === 'DUPLICATE_FINAL_REJECTED') return 'DUPLICATE_FINAL';
      return r.label;
    };
    out.push('Background:', rows(['label', '×N', 'first t / path', 'last t / path', 'state'], a.background.map((r) => [
      backgroundLabel(r), r.count, eventTime(r.first), r.count === 1 ? '=' : eventTime(r.last),
      [r.first.dispatchId ? dispatch(r.first.dispatchId) : '', r.first.textLength == null ? '' : `len=${r.first.textLength}`,
        r.first.status || '', r.first.reason && r.first.reason !== r.first.label && r.first.reason !== backgroundLabel(r) ? r.first.reason : ''].filter(Boolean).join(' ')
    ])));

  });
  out.push('\n### 6. Length observations', ...x.lengthObservations.map((r) => `- request ${r.request} ${r.path} t=${T3(r.t == null ? null : r.t * 1000)} len=${r.length}${r.beforeSubmit ? ' before submit' : ''}${r.equalPreviousLength ? ` equals previous request ${r.previousRequest} length` : ''}`));
  const columns = ['delivery/journal chars', 'terminal lengths', 'collected'];
  if (x.lengths.some((r) => r.measurements.revisions.length)) columns.push('revisions');
  if (x.lengths.some((r) => r.measurements.staleDropped.length)) columns.push('staleDropped');
  out.push('\n### 7. Answer lengths', rows(['request', ...columns], x.lengths.map((r) => {
    const m = r.measurements, same = m.delivery?.state === 'present' && m.journal?.state === 'present' && m.delivery.value === m.journal.value;
    const vals = [r.request, same ? `${display(m.delivery)} (${m.delivery.path}; ${m.journal.path})` : `${m.delivery ? pathValue(m.delivery) : 'no send'} / ${m.journal ? pathValue(m.journal) : 'not recorded'}`,
      m.terminal.map((v) => `${v.answerLength.path.replace('.payload.answerLength', '')}: ${display(v.answerLength)}/${display(v.evidenceAnswerLen)}`), m.collected.map((v) => pathValue(v.value))];
    if (columns.includes('revisions')) vals.push(m.revisions.map((v) => pathValue(v.value)));
    if (columns.includes('staleDropped')) vals.push(m.staleDropped.map((v) => pathValue(v.value)));
    return vals;
  })));
  out.push('\n### 8. Manual / moderator counters', `MANUAL_RECOVERY_REQUESTED records=${x.manual.records}; UI button records=${x.manual.uiButtonRecords}; records on success stages=${x.manual.onSuccessStages}`,
    `delivery.journal kinds: ${countsText(x.manual.journalKinds)}`, ...x.manual.moderatorActions.map((r) => `- ${eventTime(r)} ${r.label} ${r.details}`));
  out.push('\n### 9. Start refusals', ...x.delivery.batches.flatMap((b) => b.refusalRows.map((r) => `- ${r.path} t=${T3(r.t == null ? null : r.t * 1000)} ${r.errorCode || r.reason || 'no field'} attempt=${display(r.attempt)} waitedMs=${display(r.waitedMs)} calc elapsedFromBatchMs=${r.elapsedFromBatchMs}`)));
  out.push('\n### 10. Focus', `total=${x.focus.total} · sources: ${countsText(x.focus.sources)} · models: ${countsText(x.focus.models)} · first_text→delivery final interval=${x.focus.inTextInterval} (${countsText(x.focus.inTextSources)})`);
  out.push('\n### 11. Outside the run window', ...x.outsideRunWindow.map((r) => `- ${r.label} ×${r.count} first ${eventTime(r.first)}, last ${eventTime(r.last)}`));
  out.push('\n### 12. Stored prompt fragment check', ...x.promptChecks.map((r) => {
    const found = r.laterPrompts.filter((p) => p.found);
    return `- request ${r.request} ${r.answerPath} · probe=${JSON.stringify(r.probe)} · ${found.length ? `fragment found in prepared.prompt: ${found.map((p) => p.path).join(', ')}` : r.laterPrompts.length ? `not found; shortened=${r.laterPrompts.filter((p) => p.shortened).length}/${r.laterPrompts.length}; ${r.result}` : 'no later prompt'}`;
  }));
  out.push('\n### 13. Diagnoses grouped', rows(['group', 'code / reason', 'severity', 'participants', 'stages', 'records', 'occurrences', 'resolved null', 'paths'],
    x.diagnoses.groups.map((g, i) => [`D${i + 1}`, `${g.code}/${g.reasonCode}`, g.severities, g.participants, g.stages, g.records,
      `${g.occurrences}${g.missingOccurrences ? ` (missing=${g.missingOccurrences})` : ''}`, g.resolvedNull, g.paths])));
  out.push('\n### 14. Same-name comparisons and count units', ...x.comparisons.map((r) => `- ${r.name}: ${pathValue(r.left)} / ${pathValue(r.right)}`),
    `Forced counters: events=${x.counters.forced.events}; terminal records=${x.counters.forced.terminalRecords}; unique requests=${x.counters.forced.uniqueRequests}`,
    `Terminal counters: records=${x.counters.terminal.records}; groups=${x.counters.terminal.groups}; unique requests=${x.counters.terminal.uniqueRequests}`);
  out.push('\n### 17. Delivery batches and problems', rows(['path / wait', 'stageAttemptId', 'models', 't', 'accepted waitedMs', 'refusals', 'outcome', 'durationMs', 'gap s'],
    x.delivery.batches.map((b) => [`${b.path} / ${b.waitId}`, short(b.stageAttemptId || b.batchId), arr(b.models), b.t == null ? null : b.t.toFixed(3),
      b.accepted?.waitedMs, b.refusalRows.length, b.outcome, b.durationMs, b.gapSeconds == null ? null : b.gapSeconds.toFixed(3)])),
    rows(['path', 'code', 'severity', 'model', 'count', 'reason'], x.delivery.problems.map((p) => [p.path, p.code, p.severity, p.model, p.count, p.reason])));
  out.push('\n### Appendix. Individual diagnoses', rows(['path', 'severity', 'group (section 13)', 'stage', 'participant', 'occurrences', 'first t', 'resolvedAt'],
    x.diagnoses.appendix.map((d) => [d.path, d.severity, `D${x.diagnoses.groups.findIndex((g) => g.code === d.code && g.reasonCode === d.reasonCode) + 1}`, x.stages.find((s) => s.stageId === d.affectedStageId)?.stage || d.affectedStageId, d.affectedParticipant,
      d.occurrences, offset(toMs(d.firstObservedAt), x.base.value), field(d, 'resolvedAt', d.path)])));
  out.splice(4, 0, 'Path prefixes: E[N] = events[N]; J[N] = delivery.journal[N]. QN.dK refers to request N dispatch K in the identity map.');
  return out.join('\n').replace(/delivery\.journal\[(\d+)\]/g, 'J[$1]').replace(/events\[(\d+)\]/g, 'E[$1]');
}
function summarizeDisputFlow(d) { return renderTransportMarkdown(buildTransportDigest(d)); }

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

function extractTransport(report, sourceFile) { return buildTransportDigest(report, sourceFile); }
const api = Object.freeze({ DIGEST_VERSION, COMPRESSION, summarizeDisputFlow, summarizeDelivery, median,
  extractTransport, buildTransportDigest, renderTransportMarkdown });
root.ReportDigest = api;
if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
