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
const JOURNAL_DETAIL_SKIP = new Set(['at', 'kind', 'model', 'requestId', 'token', 'answer', 'prompt', 'dispatchId', 'tabId', 'phase', 'bg', 'promptArtifact', 'promptLineage', 'answerArtifact', 'answerArtifacts', 'promptIdentityProven', 'submittedPromptHash', 'submittedPromptNormalizationVersion', 'promptProofScope']);
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
      stageId: c.stageId || p.stageId || null, dispatchId: c.dispatchId || p.dispatchId || null, requestId: c.transportRequestId || c.requestId || p.transportRequestId || p.requestId || null,
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
      const related = buildRecords(events, []).filter(r=>r.stageId===s.stageId && r.model);
      const models = unique(arr(s.actual?.participants).concat(related.map(r=>r.model)));
      models.forEach(model=>{
        const rs=related.filter(r=>r.model===model), known=unique(rs.map(r=>r.requestId).filter(Boolean));
        const identities=known.length?known:[null];
        identities.forEach(requestId=>attempts.push({
          requestId, model, stageId:s.stageId, stageN:i+1, batchId:null,
          stageAttemptId:rs.find(r=>r.requestId===requestId)?.raw.correlation?.stageAttemptId || null, waitId:null,
          batchAt:s.actual?.startedAt, batchPath:null, token:null,
          dispatchIds:unique(rs.filter(r=>requestId?r.requestId===requestId:true).map(r=>r.dispatchId).filter(Boolean)), recs:[]
        }));
      });
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
  attempts.forEach(a=>a.dispatchIds.forEach(id=>{if(!byDispatch.has(id))byDispatch.set(id,a);}));
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
      else if (candidates.length > 1) { r.flags = ['ambiguous stage/model binding']; }
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
const DIGEST_VERSION = '3.7.0';
const COMPRESSION = Object.freeze({
  markdownMaxBytes: 70000,
  markdownAggregation: 'request tables → aggregated tables → bounded overview',
  markdownEvidence: 'request and decision tables; repeated observations counted globally; full evidence at source JSON paths',
  allRequests: true, chronologyLimit: null, outsideWindowToleranceMs: 0,
  terminalPairWindowMs: 50, promptProbeCharacters: 50,
  grouping: 'request + dispatchId + status + reason + significant fields; changes split groups',
  stable: 'first and every change, including zero length, correlation and dispatch changes',
  background: 'global counts and first/last paths; full members in source JSON',
  ignoredGroupingFields: ['elapsedMs', 'durationMs', 'foregroundMsUsed', 'focusSwitchesUsed', 'waitedMs', 'ms', 'at', 'logCollection', 'SELECTOR_STATS sampled hit/miss/rate counters']
});
const arr = (v) => Array.isArray(v) ? v : [];
const finite = (v) => Number.isFinite(v) ? v : null;
const unique = (v) => [...new Set(v)];
const isHighSeverity = f => f?.state === 'present' && /^(critical|high)$/i.test(f.value);
const isFailedStatus = status => /^(FAILED|FAILURE|ERROR|RECOVERABLE_ERROR|HARD_TIMEOUT|CANCELLED|NO_SEND|CONTEXT_LOST)$/i.test(status || '');
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
const RENDER_KEYS = ['pageId', 'viewId', 'cardTargetType', 'expectedCardId', 'observedCardId', 'outcome', 'final', 'usableResult'];
const JOURNAL_PROOF_KEYS = ['answerArtifact','answerArtifacts','answerProof','promptArtifact','promptLineage','promptIdentityProven','submittedPromptHash','submittedPromptNormalizationVersion','promptProofScope'];
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
const groupingDetail = r => r.label === 'SELECTOR_STATS' ? r.details.replace(/ hit=.*$/, '') : r.details.replace(/\b(elapsed|waited|duration|ms)=\d+(?:ms)?/g, '$1=<time>');
function recordFact(r, t0) {
  const p = r.raw.payload || {};
  return {
    path: r.path, at: finite(r.at), t: offset(r.at, t0), groupingDetail: groupingDetail(r), type: r.type, label: r.label,
    model: r.model, tabId: r.tabId, dispatchId: r.dispatchId, requestId: r.requestId,
    recordedStageId: r.stageId, pipelineRoundId: recordRound(r),
    status: stateOf(r), reason: reasonOf(r), textLength: textLengthOf(r),
    severity: field(r.raw, 'severity', r.path),
    details: r.src === 'events' ? r.details : journalDetails(r.raw),
    evidence: { ...(p.evidence || {}), ...Object.fromEntries(JOURNAL_PROOF_KEYS.filter(k=>has(r.src==='events'?p:r.raw,k)).map(k=>[k,(r.src==='events'?p:r.raw)[k]])),
      ...Object.fromEntries(['source','phase','errorCode','completion',...RENDER_KEYS].filter(k=>has(r.src==='events'?p:r.raw,k)).map(k=>[k,(r.src==='events'?p:r.raw)[k]])),
      ...((has(r.src==='events'?p:r.raw,'status') && [null,''].includes((r.src==='events'?p:r.raw).status))?{rawStatus:(r.src==='events'?p:r.raw).status}:{}) },
    correlationQuality: field(r.raw.correlation, 'correlationQuality', `${r.path}.correlation`),
    joinedBy: r.via || null, flags: r.flags || []
  };
}
// Time counters and sample durations vary on every poll and are not grouping keys.
// Their first/last registered values remain available, as do every member's source paths.
function signature(r) {
  const raw = r.src === 'events' ? r.raw.payload || {} : r.raw;
  const evidence = {...(raw.evidence || {}), ...Object.fromEntries([...JOURNAL_PROOF_KEYS,...RENDER_KEYS].filter(k=>has(raw,k)).map(k=>[k,raw[k]]))};
  const omit = new Set(COMPRESSION.ignoredGroupingFields);
  if (r.label === 'SELECTOR_STATS') ['hitCount', 'missCount', 'totalCount', 'hitRate'].forEach((k) => omit.add(k));
  const significant = Object.fromEntries(Object.entries(evidence).filter(([k]) => !omit.has(k)));
  const detail = groupingDetail(r);
  return JSON.stringify([r.model, r.requestId, r.type, r.label, r.dispatchId, stateOf(r), reasonOf(r), textLengthOf(r),
    raw.errorCode, raw.completion, raw.source, raw.phase, significant,
    has(r.raw, 'severity') ? { value: r.raw.severity } : { missing: true },
    r.stageId, recordRound(r), has(raw, 'status') ? { value: raw.status } : { missing: true }, r.raw.correlation?.correlationQuality, r.flags || [], detail]);
}
function compactRecords(list, t0) {
  const result = [], groups = new Map(), states = new Map();
  list.forEach((r) => {
    // Returning to an old length/status/dispatch is a new transition, not a repeat of an old group.
    const render = r.src === 'events' ? r.raw.payload?.evidence || {} : r.raw;
    // Main and pipeline cards, and distinct selectors, are independent observation streams.
    // Their interleaving is not a change of state of the same card/selector.
    const partition = JSON.stringify([r.model, r.requestId, r.stageId, r.label,
      render.pageId, render.viewId, render.cardTargetType,
      r.label === 'SELECTOR_STATS' ? groupingDetail(r) : null]);
    const previous = states.get(partition);
    const hardState = signature(r);
    const epoch = previous ? previous.epoch + (previous.key === hardState ? 0 : 1) : 0;
    states.set(partition, { key: hardState, epoch });
    const key = `${partition}|${epoch}|${hardState}`, row = groups.get(key);
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
      severity: field(r.raw, 'severity', r.path),
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
  // The primary base is the first stage start. When the collector evicted it (event cap), a labelled fallback
  // keeps the time axis instead of printing "—" everywhere: run start, first batch, first event, first journal record.
  const PRIMARY_BASE = 'stageExecutions[0].actual.startedAt';
  const baseChain = [[PRIMARY_BASE, stages[0]?.actual?.startedAt], ['runOutcome.startedAt', d.runOutcome?.startedAt],
    ['delivery.diagnosis.batches[0].at', arr(diag.batches)[0]?.at], ['events[0].sourceTimestamp', events[0]?.sourceTimestamp],
    ['delivery.journal[0].at', journal[0]?.at]];
  const baseHit = baseChain.find(([, v]) => Number.isFinite(toMs(v))) || [PRIMARY_BASE, null];
  const t0 = toMs(baseHit[1]);
  const primaryState = !has(stages[0]?.actual, 'startedAt') ? 'no field' : stages[0].actual.startedAt === null ? 'null' : 'present';
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
    const stageStart = toMs(stages[a.stageN - 1]?.actual?.startedAt), submitted = a.submitted;
    // An evicted stage start falls back to this request's batch_start.at (same stage attempt).
    const st0 = Number.isFinite(stageStart) ? stageStart : a.batchAt;
    const first = (fn) => a.recs.find(fn);
    const milestone = (fn) => timeFact(first(fn), t0, st0, submitted);
    const terminals = terminalGroups(a, t0), send = sendOf(a);
    const own = a.recs.filter((r) => !sharedPaths.has(r.path));
    const transitions = [], background = [];
    own.forEach((r) => {
      if (r.type === 'MODEL_TERMINAL_COMMITTED') return;
      const exceptional = ['TEXT_STABLE', 'COMPLETION_DETECTED', 'STAGE_FAILED', 'MANUAL_RECOVERY_REQUESTED', 'CORRELATION_REJECTED',
        'completion_terminal', 'first_text', 'verified', 'empty_answer', 'missing_token', 'stale_dropped', 'identity_rejected', 'revision', 'ANSWER_COLLECTED',
        'ANSWER_REJECTED', 'STATE_DIVERGENCE', 'ANSWER_ACCEPTANCE_DECIDED', 'OBSERVER_STOPPED', 'response_rejected', 'late_text', 'unproven_replaced', 'get_it_result', 'owner_answer'].includes(r.type)
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
      wrongCard: a.recs.filter((r) => (r.label === 'ANSWER_CARD_RENDER_EVALUATED' || r.type === 'displayed') && (r.raw.payload?.evidence?.outcome === 'wrong_card' || r.raw.outcome === 'wrong_card' || r.raw.payload?.details === 'wrong_card')).length,
      displayed: a.recs.filter((r) => r.type === 'displayed').length,
      manualRecords: a.manual.length, uiButtonRecords: a.manual.filter((r) => r.raw.payload?.details === 'UI button').length,
      correlationRejected: a.correlation.length, terminalRecords: a.terminals.length, terminalGroups: terminals.length
    };
    const length = (r) => ({ path: r.path, value: r.raw.payload
      ? field(r.raw.payload, 'answerLength', `${r.path}.payload`) : field(r.raw, 'chars', r.path) });
    const lr = { request: index + 1, stage: stageAlias(a.stageId), model: a.model,
      measurements: { delivery: send ? field(send.terminal, 'chars', `delivery.diagnosis.sends[${sends.indexOf(send)}].terminal`) : null,
        journal: a.final ? field(a.final.raw, 'chars', a.final.path) : null,
        acceptanceDecisions: a.recs.filter(r => r.type === 'ANSWER_ACCEPTANCE_DECIDED').map(r => ({ path: r.path, accepted: field(r.raw.payload, 'accepted', `${r.path}.payload`), reason: reasonOf(r), t: offset(r.at, t0) })),
      collected: a.recs.filter((r) => r.type === 'ANSWER_COLLECTED').map(length),
        terminal: terminals.flatMap((g) => g.members.map((m) => ({ answerLength: m.answerLength, evidenceAnswerLen: m.evidenceAnswerLen, evidenceAnswerLength: m.evidenceAnswerLength }))),
        revisions: a.recs.filter((r) => r.type === 'revision').map(length), staleDropped: a.recs.filter((r) => r.type === 'stale_dropped').map(length) } };
    lengthRows.push(lr);
    return {
      request: index + 1, requestId: a.requestId, stage: stageAlias(a.stageId), stageId: a.stageId, model: a.model,
      identity: { token: a.token, batchId: a.batchId, stageAttemptId: a.stageAttemptId, waitId: a.waitId, batchStartPath: a.batchPath,
        pipelineRoundIds: unique(a.recs.map(recordRound).filter((x) => x != null)),
        roundSources: a.recs.filter((r) => recordRound(r) != null).map((r) => r.path),
        tabIds: unique(a.recs.map((r) => r.tabId).filter((x) => x != null).map(String)), dispatchIds: a.dispatchIds,
        foreignDispatchIds: a.foreignDispatchIds.map((id) => ({ dispatchId: id, ownerRequestId: a.foreignOwners[id].requestId,
          ownerStage: stageAlias(a.foreignOwners[id].stageId), ownerModel: a.foreignOwners[id].model })) },
      times: { dispatchStarted: milestone((r) => r.label === 'dispatch:dispatch_started'),
        submitted: milestone((r) => r.label === 'dispatch:submitted') || milestone((r) => r.type === 'SUBMIT_CONFIRMED'),
        firstText: milestone((r) => r.type === 'first_text'), firstStable: milestone((r) => r.type === 'TEXT_STABLE'),
        firstCompletionDetected: milestone((r) => r.type === 'COMPLETION_DETECTED'),
        firstCompletionTerminal: milestone((r) => r.type === 'completion_terminal'), deliveryFinal: timeFact(a.final, t0, st0, submitted) },
      artifacts: a.recs.filter(r=>r.raw.promptArtifact || r.raw.answerArtifacts || r.raw.answerArtifact || r.raw.payload?.answerProof).map(r=>({
        path:r.path, type:r.type, target: Object.fromEntries(RENDER_KEYS.filter(k=>has(r.raw,k)).map(k=>[k,r.raw[k]])), prompt: r.raw.promptArtifact || null, answer:r.raw.answerArtifacts || r.raw.answerArtifact || r.raw.payload?.answerProof || null,
        lineage:r.raw.promptLineage || null, submitted:r.type==='dispatch'?{ proven:r.raw.promptIdentityProven, hash:r.raw.submittedPromptHash, normalizationVersion:r.raw.submittedPromptNormalizationVersion, scope:r.raw.promptProofScope }:null
      })),
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
    const origin = r.attempt;
    const planStage = arr(d.plan?.stages).find(s => s.stageId === origin?.stageId);
    const nextId = planStage?.nextStageId || stages[(origin?.stageN || 0)]?.stageId;
    const nextAttempts = attempts.filter(a => a.stageId === nextId);
    const later = prepared.filter(({ j }) => toMs(j.at) > r.at && (nextAttempts.some(a =>
      (j.requestId && j.requestId === a.requestId) || (j.batchId && j.batchId === a.batchId)) || (!j.requestId && !j.batchId)));
    const lineageStatus = planStage?.nextStageId ? 'captured_nextStageId' : 'next_observed_stage_candidate; dependency_not_proven';
    return { answerPath: r.path, lineageStatus, nextStageId: nextId || null, request: r.attempt ? attempts.indexOf(r.attempt) + 1 : null, probe,
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
  const windowStart = toMs(d.runOutcome?.startedAt), windowEnd = toMs(d.runOutcome?.completedAt);
  const outside = recs.filter((r) => Number.isFinite(r.at) && ((Number.isFinite(windowStart) && r.at < windowStart) ||
    (Number.isFinite(windowEnd) && r.at > windowEnd)));
  const batches = arr(diag.batches).map((b, i, bs) => ({ path: `delivery.diagnosis.batches[${i}]`, ...b,
    stage: stageAlias(stages.find((s) => String(b.stageAttemptId || b.batchId || '').startsWith(s.stageId))?.stageId),
    t: offset(toMs(b.at), t0), gapSeconds: i && Number.isFinite(bs[i - 1].durationMs)
      ? offset(toMs(b.at), toMs(bs[i - 1].at) + bs[i - 1].durationMs) : null,
    refusalRows: arr(b.refusals).map((r, j) => ({ path: `delivery.diagnosis.batches[${i}].refusals[${j}]`, ...r, t: offset(toMs(r.at), t0),
      elapsedFromBatchMs: Number.isFinite(toMs(r.at)) && Number.isFinite(toMs(b.at)) ? toMs(r.at) - toMs(b.at) : null })) }));
  const collectionSamples = new Map();
  recs.forEach(r=>{
    const v=r.raw.payload?.evidence?.logCollection;
    if(!v)return;
    const key=JSON.stringify([r.model,r.requestId,r.dispatchId,v.scope,v.limit]);
    const sample={path:r.path,at:finite(r.at),t:offset(r.at,t0),value:v};
    const row=collectionSamples.get(key);
    if(row){ row.count++; if(v.appended<row.last.value.appended || v.evicted<row.last.value.evicted)row.resets++; row.last=sample; if(sample.at!=null){if(!row.firstTimed||sample.at<row.firstTimed.at)row.firstTimed=sample;if(!row.lastTimed||sample.at>row.lastTimed.at)row.lastTimed=sample;} if(Number.isFinite(v.evicted)){row.evictedMin=row.evictedMin==null?v.evicted:Math.min(row.evictedMin,v.evicted);row.evictedMax=row.evictedMax==null?v.evicted:Math.max(row.evictedMax,v.evicted);} }
    else collectionSamples.set(key,{model:r.model,requestId:r.requestId,dispatchId:r.dispatchId,count:1,resets:0,evictedMin:finite(v.evicted),evictedMax:finite(v.evicted),firstTimed:sample.at==null?null:sample,lastTimed:sample.at==null?null:sample,first:sample,last:sample});
  });
  const noRound = recs.filter((r) => r.src === 'events' && !recordRound(r)).map((r) => r.path);
  return {
    schemaVersion: 3, report: 'extract_transport', DIGEST_VERSION, compression: { ...COMPRESSION }, sourceFile,
    debateRunId: d.metadata.debateRunId, base: { path: baseHit[0], value: finite(t0), unit: 'seconds', precision: 0.001, primary: { path: PRIMARY_BASE, state: primaryState }, fallback: baseHit[0] !== PRIMARY_BASE },
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
    collectionSamples: [...collectionSamples.values()], stages: stageRows, requests: requestRows, stageTimeline, lengthObservations, lengths: lengthRows, promptChecks,
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
    integrity: { registered: integrity, computed: computedIntegrity, checks: field(d.integrity, 'checks', 'integrity') },
    sourceStatus: { allPaths: recs.map(r=>r.path), completeness: field(d,'completeness','root'), modeHistory: field(d.metadata,'modeHistory','metadata'), collection: field(d, 'collection', 'root'), planning: field(d, 'planning', 'root'),
      unboundErrors: recs.filter(r=>!r.attempt&&!unassigned.includes(r)&&(isFailedStatus(stateOf(r))||isHighSeverity(field(r.raw,'severity',r.path))||/FAIL|ERROR|REJECT|BLOCK|NO_SEND|UNCERTAIN|TIMEOUT|RECOVERY|MATERIALIZE|STALE|DIVERGENCE|CANCEL|EXHAUSTED|UNCONFIRMED/i.test(`${r.type} ${r.label} ${r.reasonCode||''}`))).map(r=>recordFact(r,t0)),
      observerStops: recs.filter(r => r.type === 'OBSERVER_STOPPED' || r.label === 'LIFECYCLE_TRACKING_STOPPED').map(r => r.path),
      displayProof: recs.filter(r => r.raw.payload?.evidence?.normalizedHash || r.raw.answerArtifact?.normalizedHash).map(r => r.path),
      acceptance: recs.filter(r => r.type === 'ANSWER_COLLECTED').map(r => ({ path: r.path, accepted: r.raw.payload?.accepted })),
      windowStart: finite(windowStart), windowEnd: finite(windowEnd), totalSourceRecords: recs.length, unassignedPaths: unassigned.map(r => r.path) },
    delivery: { batches, problems: arr(diag.problems).map((x, i) => ({ path: `delivery.diagnosis.problems[${i}]`, ...x })) }
  };
}
function renderTransportMarkdown(x, compact = false) {
  const limit=COMPRESSION.markdownMaxBytes, out=[];
  const preview=(v,n=180)=>{const text=String(v);return text.length<=n?text:`${text.slice(0,n).replace(/[\uD800-\uDBFF]$/,'')}… [${text.length} chars; full value in source JSON]`;};
  const cell=v=>display(v).replace(/\|/g,'\\|').replace(/[\r\n]+/g,' ');
  const rows=(head,list)=>table(head,list.map(r=>r.map(cell)));
  const path=p=>String(p||'no field').replace(/delivery\.journal\[(\d+)\]/g,'J[$1]').replace(/events\[(\d+)\]/g,'E[$1]').replace(/delivery\.diagnosis\.sends\[(\d+)\]/g,'S[$1]').replace(/delivery\.diagnosis\.batches\[(\d+)\]/g,'B[$1]');
  const t=v=>v==null || !Number.isFinite(v)?'—':v.toFixed(3);
  const countText=o=>Object.entries(o||{}).map(([k,n])=>`${k}:${n}`).join(', ')||'0';
  const sample=r=>r?`${t(r.t)} ${path(r.path)}`:'not recorded';
  const milestone=r=>r?`${sample(r)}${r.stageSeconds==null||r.stageSeconds===r.t?'':` st:${t(r.stageSeconds)}`}${r.submitSeconds==null?'':` sub:${t(r.submitSeconds)}`}`:'not recorded';
  const endpoints=g=>`${sample(g.first)}${g.count>1?` → ${sample(g.last)}`:''}`;
  const dispatch=id=>{
    if(id==null)return 'no field';
    const a=x.requests.find(a=>a.identity.dispatchIds.includes(id));
    return a?`Q${a.request}.D${a.identity.dispatchIds.indexOf(id)+1}`:id;
  };
  const groups=(list,key)=>{
    const map=new Map();
    list.forEach(r=>{const k=key(r);let g=map.get(k);if(!g){g={first:r.first,last:r.last,count:0,rows:[]};map.set(k,g);}
      g.count+=r.count;g.rows.push(r);if(r.first.at<g.first.at)g.first=r.first;if(r.last.at>g.last.at)g.last=r.last;});
    return [...map.values()];
  };
  const value=f=>display(f);
  const lengthValues=(a)=>{
    const m=x.lengths.find(r=>r.request===a.request)?.measurements;
    if(!m)return 'no field';
    return [m.delivery?`${value(m.delivery)} ${path(m.delivery.path).replace(/\.terminal\.chars$/,'')}`:'no send',m.journal?`${value(m.journal)} ${path(m.journal.path)}`:'no journal final',a.deliveryResult?value(a.deliveryResult):'no result'].join(' / ');
  };
  out.push('# Transport extract',`DIGEST_VERSION=${x.DIGEST_VERSION} · sourceFile=${x.sourceFile||'no field'} · debateRunId=${x.debateRunId}`,
    `MD limit=${limit} UTF-8 bytes; mode=${compact?'aggregated':'request tables'}; facts come directly from the source JSON, not from an earlier extract.`,
    `t: seconds from ${x.base.path}=${value(x.base.value)}${x.base.fallback?` (fallback: ${x.base.primary.path} is ${x.base.primary.state}; the first stage start is missing from this export)`:''}, precision 0.001. st/sub: relative to stage/submission (request table only; st is omitted when equal to t; an unusable stage start falls back to the request's batch_start.at). — in time columns means no usable time field (never zero).`,
    'E[N]=events[N]; J[N]=delivery.journal[N]; S[N]=delivery.diagnosis.sends[N]; B[N]=delivery.diagnosis.batches[N]; QN.DK=dispatch alias below. AL/EL/EAL=answerLength/evidence.answerLen/evidence.answerLength. no field, null, "", [], false and 0 are distinct.',
    'This is a summary, not a journal copy. Repeated observations have counts and first/last source paths. Full chronology, intermediate render proofs, identity objects, artifacts, prompt lineage and individual diagnoses remain in the source JSON. Equal lengths do not prove equal text; focus observations do not prove continuous printing; stored prompt fragments do not prove submission. Refusal waitedMs is cumulative and must not be summed.',
    ...['metadata','runOutcome','health'].map(k=>`${k}: ${Object.values(x[k]).map(pathValue).join('; ')}`));
  out.push('\n### 1. Data and integrity',
    `Exported events=${x.counters.events}; correlationQuality=${countText(x.quality.correlationQuality)}; provenance=${countText(x.quality.provenance)}.`,
    `Non-exact=${x.quality.observedNonExact}; missing pipelineRoundId=${x.quality.eventsWithoutRound.count}; joins=${countText(x.counters.joinMethods)} (unassigned = records joined to no request; ${x.availability.unassigned.length} of them carry a model, requestId or dispatchId).`,
    `Completeness rule=${x.quality.completenessRule}; dimensions=${x.sourceStatus.completeness.state} (${x.sourceStatus.completeness.path}).`,
    `Registered integrity: ${Object.values(x.integrity.registered).map(f=>f.state==='present'&&Array.isArray(f.value)?`${f.path}=${f.value.length} records`:pathValue(f)).join('; ')}`,
    `Checks=${pathValue(x.integrity.checks)}; computed=${JSON.stringify(x.integrity.computed)}; shortened prepared.prompt=${x.availability.shortenedPrompts.length}.`,
    `Plan=${value(x.availability.plan)}; delivery=${x.availability.delivery}; observer stop records=${x.sourceStatus.observerStops.length}; display proof observations=${x.sourceStatus.displayProof.length}.`,
    `Collection: ${pathValue(x.sourceStatus.collection)}; mode history: ${pathValue(x.sourceStatus.modeHistory)}.`);
  out.push('\n### 2. Stages',rows(['stage / source','models','start→end t','durationMs / gap s','status / LONG','success+failure paths'],x.stages.map(s=>[
    `${s.stage} ${s.path}`,s.participants,`${t(s.startT)}→${t(s.endT)}`,`${value(s.durationMs)} / ${t(s.gapSeconds)}`,`${value(s.status)}/${Number.isFinite(s.durationMs.value)?s.long:'n/a (no durationMs)'}`,s.successWithFailureRecords.map(path).join(', ')||'0'])),
    `calc: median duration=${x.calculations.medianDurationMs}; LONG=${x.calculations.long}.`,
    ...x.stages.map(s=>`${s.stage}=${s.stageId}; deviations=${value(s.deviations)}`));
  out.push('\n### 3. Request identities',rows(['Q / stage / model / round','requestId','dispatches / foreign','tabs / batch source / token'],x.requests.map(a=>[
    `Q${a.request} ${a.stage}/${a.model}/${a.identity.pipelineRoundIds.join(',')||'no field'}`,a.requestId,
    a.identity.dispatchIds.map((d,i)=>`D${i+1}=${d}`).concat(a.identity.foreignDispatchIds.map(f=>`foreign:${dispatch(f.dispatchId)} owner=${f.ownerStage}/${f.ownerModel}`)).join('; ')||'no field',
    `${a.identity.tabIds.join(',')||'no field'} / ${path(a.identity.batchStartPath)} / ${a.identity.token||'no field'}`])));
  out.push('\n### 4. All requests',rows(['Q','dispatch / submitted / first text: t st sub source','first stable / completion: t st sub source','duplicate / wrong_card / displayed / manual / UI / correlationRejected','collected accepted / engine decisions','delivery chars S[n].terminal.chars / journal chars J[n].chars / result','Tn: first..last ms of terminal group n after the first TEXT_STABLE'],x.requests.map(a=>{
    const decisions=x.lengths.find(r=>r.request===a.request)?.measurements.acceptanceDecisions||[];
    return [`Q${a.request}`,[a.times.dispatchStarted,a.times.submitted,a.times.firstText].map(milestone).join('; '),
      [a.times.firstStable,a.times.firstCompletionDetected].map(milestone).join('; ')+(a.times.firstCompletionTerminal?`; ct:${value(a.transitions.find(r=>r.first.type==='completion_terminal')?.first.status)} ${milestone(a.times.firstCompletionTerminal)}`:''),
      [a.counts.duplicateFinalRejected,a.counts.wrongCard,a.counts.displayed,a.counts.manualRecords,a.counts.uiButtonRecords,a.counts.correlationRejected].join('/'),
      a.collected.map(r=>{const len=x.lengths.find(l=>l.request===a.request)?.measurements.collected.find(c=>c.path===r.path)?.value;return `${path(r.path)}=${value(r.accepted)},len=${value(len)}`;}).concat(decisions.map(r=>`${path(r.path)}=${value(r.accepted)} ${r.reason||'no field'}`)).join('; ')||'not recorded',
      lengthValues(a),!a.times.firstStable?'no TEXT_STABLE':a.terminalGroups.map((g,i)=>{const ms=g.lastAt-a.times.firstStable.at;return `T${i+1}:${g.firstAt-a.times.firstStable.at}..${ms}${ms>120000?' >120000':ms>15000?' >15000':''}`;}).join('; ')||'no terminal'];
  })));
  // Consecutive single-member terminal groups with the same dispatch/status/reason and no registered evidence
  // are one row (all paths and the length series stay); multi-member groups and groups with evidence stay full.
  // "No registered evidence" ignores doneReason, which every terminal carries; it must still be equal along a run.
  const plainGroup=g=>g.members.length===1&&['foregroundMsUsed','focusSwitchesUsed','durationMs'].every(k=>g.members[0].registered[k].state==='missing');
  const sameDone=(p,q)=>value(p.members[0].registered.doneReason)===value(q.members[0].registered.doneReason);
  out.push('\n### 5. Terminal decisions',rows(['Q.T / dispatch','status / reason / span ms','source label: AL / EL / EAL','registered foregroundMs / focusSwitches / doneReason / durationMs'],x.requests.flatMap(a=>{
    const gs=a.terminalGroups,list=[];
    const full=(g,i)=>[`Q${a.request}.T${i+1}/${dispatch(g.dispatchId)} t=${t(g.members[0].t)}`,`${value(g.status)}/${value(g.completionReason)}/${g.intervalMs}`,
      g.members.map(m=>`${path(m.path)} ${m.label}: ${value(m.answerLength)} / ${value(m.evidenceAnswerLen)} / ${value(m.evidenceAnswerLength)}`).join('; '),
      (()=>{const strings=g.members.map(m=>Object.values(m.registered).every(f=>f.state==='missing')?'all no field':Object.values(m.registered).map(value).join('/'));
        const bare=g.members.map(m=>['foregroundMsUsed','focusSwitchesUsed','durationMs'].every(k=>m.registered[k].state==='missing'));
        // Members that only repeat the shared doneReason add nothing next to a member with counters.
        return bare.some(b=>!b)&&new Set(g.members.map(m=>value(m.registered.doneReason))).size===1?strings.filter((_,k)=>!bare[k]).join('; '):strings.join('; ');})()];
    for(let i=0;i<gs.length;){
      let j=i;
      while(j+1<gs.length&&plainGroup(gs[i])&&plainGroup(gs[j+1])&&gs[j+1].dispatchId===gs[i].dispatchId
        &&gs[j+1].status===gs[i].status&&gs[j+1].completionReason===gs[i].completionReason&&sameDone(gs[i],gs[j+1]))j++;
      if(j>i){
        const run=gs.slice(i,j+1),series=fn=>{const v=run.map(g=>value(fn(g.members[0])));return v.every(item=>item===v[0])&&v[0]==='no field'?'no field':v.join('→');};
        list.push([`Q${a.request}.T${i+1}-T${j+1}/${dispatch(run[0].dispatchId)} t=${t(run[0].members[0].t)}→${t(run.at(-1).members[0].t)}`,`${value(run[0].status)}/${value(run[0].completionReason)}/×${run.length}`,
          `${run.map(g=>path(g.members[0].path)).join(',')} ${run[0].members[0].label}: AL ${series(m=>m.answerLength)} / EL ${series(m=>m.evidenceAnswerLen)} / EAL ${series(m=>m.evidenceAnswerLength)}`,Object.values(run[0].members[0].registered).map(value).join('/')]);
        i=j+1;
      }else{list.push(full(gs[i],i));i+=1;}
    }
    return list;
  })));
  // Only decision/error categories belong in the issue summary. Polls and renderer
  // bookkeeping are counted later, irrespective of the number of raw observations.
  const issue=/FAIL|ERROR|REJECT|BLOCK|NO_SEND|UNCERTAIN|TIMEOUT|RECOVERY|MATERIALIZE|STALE|DIVERGENCE|CANCEL|EXHAUSTED|UNCONFIRMED/i;
  const NOISE_LABEL=/^(PING_TRANSPORT_ERROR|status|Panel output update failed|SELECTOR_STATS|SCRIPT_REINJECT_SKIPPED_ACTIVE_RUN|Finalization deferred|Finalization defer bypassed|ANSWER_GENERATING|ANSWER_CARD_RENDER_EVALUATED|Response ignored \(pipeline control\))/;
  const ROUTINE_TYPES=new Set(['first_text','TEXT_STABLE','COMPLETION_DETECTED','verified','ANSWER_COLLECTED','ANSWER_ACCEPTANCE_DECIDED']);
  const isNoise=r=>r.label!=='terminal_group'&&(NOISE_LABEL.test(r.label)||r.first.type==='DUPLICATE_FINAL_REJECTED');
  const isIssue=r=>!r.group&&(isFailedStatus(r.first.status)||isHighSeverity(r.first.severity)||issue.test(`${r.label} ${r.first.type} ${r.first.reason||''}`));
  const anomalousStable=r=>r.first.type==='TEXT_STABLE'&&(r.first.textLength===0||r.first.flags.some(f=>!f.startsWith('joined by')));
  // A group appears in exactly one place: chronology (deviations), section 4/5 (routine, terminals) or Background counters.
  const ROUTINE_REASONS=new Set(['lifecycle_complete_snapshot','stable_pending_auto_finalization','generation_inactive']);
  const routineTerminal=r=>r.label==='terminal_group'&&value(r.group.status)==='SUCCESS'&&ROUTINE_REASONS.has(r.group.completionReason);
  const routineCompletion=r=>r.first.type==='completion_terminal'&&r.first.status==='SUCCESS_TERMINAL';
  const chronologyOf=a=>[...a.transitions,...a.background].filter(r=>r.label==='terminal_group'?!routineTerminal(r)
    :(!isNoise(r)&&!routineCompletion(r)&&(anomalousStable(r)||(!ROUTINE_TYPES.has(r.first.type)&&(a.transitions.includes(r)||isIssue(r))))))
    .sort((p,q)=>(p.first.at??Infinity)-(q.first.at??Infinity));
  const chronologyShown=new Set();
  x.requests.forEach(a=>{const rowsC=chronologyOf(a);if(rowsC.some(r=>r.label!=='terminal_group'))rowsC.forEach(r=>chronologyShown.add(r));});
  if(compact){
  const issueGroups=new Map();
  x.requests.forEach(a=>[...a.transitions,...a.background].filter(r=>!r.group&&(isFailedStatus(r.first.status)||isHighSeverity(r.first.severity)||issue.test(`${r.label} ${r.first.type} ${r.first.reason||''}`))).forEach(r=>{
    const key=JSON.stringify(compact?[r.label]:[r.label,r.first.status,r.first.reason,r.first.severity?.state,r.first.severity?.value]);
    let g=issueGroups.get(key);if(!g){g={label:r.label,status:r.first.status,reason:r.first.reason,count:0,requests:new Map(),states:new Map(),severities:new Set(),first:r.first,last:r.last};issueGroups.set(key,g);}
    g.severities.add(value(r.first.severity));
    const state=JSON.stringify([r.first.status,r.first.reason]);g.states.set(state,(g.states.get(state)||0)+r.count);g.count+=r.count;if(r.first.at<g.first.at)g.first=r.first;if(r.last.at>g.last.at)g.last=r.last;
    let q=g.requests.get(a.request);if(!q){q={count:0,path:r.first.path,dispatches:new Set()};g.requests.set(a.request,q);}q.count+=r.count;q.dispatches.add(dispatch(r.first.dispatchId));
  }));
  out.push('\n### 6. Decision/error observations', compact?'Grouped by label; status/reason combination counts are shown. Q:N counts observations; full combinations and time order are in source JSON.':'Grouped by label/status/reason; Q:N gives per-request observation counts. Complete details and time order remain in the source JSON.',
    rows(['label / status / reason','severity','N','requests:N / first source / dispatch','first→last t / source'],[...issueGroups.values()].map(g=>[
      `${g.label}/${compact?`${g.states.size} status/reason combinations (source JSON)`:value(g.status)}${compact||g.reason===g.label?'':`/${value(g.reason)}`}`,[...g.severities].join(','),g.count,
      [...g.requests].map(([q,v])=>`Q${q}:${v.count} ${path(v.path)} ${[...v.dispatches].filter(d=>d!==`Q${q}.D1`).join(',')}`).join('; '),
      `${sample(g.first)}${g.count>1?` → ${sample(g.last)}`:''}`])));
  }else{
    const segment=(a,r)=>{
      const f=r.first,n=r.count>1?` ×${r.count}`:'';
      if(r.label==='terminal_group'){const g=r.group;return `T${a.terminalGroups.indexOf(g)+1} ${value(g.status)}/${value(g.completionReason)}${n} ${path(f.path)}`;}
      const status=f.status==null?'':`/${value(f.status)}`,why=f.reason==null||f.reason===r.label?'':`/${value(f.reason)}`;
      const len=f.type==='TEXT_STABLE'&&Number.isFinite(f.textLength)?` len=${f.textLength}`:'';
      const dispatchTag=f.dispatchId&&dispatch(f.dispatchId)!==`Q${a.request}.D1`?` ${dispatch(f.dispatchId)}`:'';
      const severity=isHighSeverity(f.severity)?` [${value(f.severity)}]`:'';
      const flags=f.flags.filter(item=>!item.startsWith('joined by')).join('; ');
      return `${r.label}${status}${why}${len}${n} ${path(f.path)}${r.count>1?`→${path(r.last.path)}`:''}${dispatchTag}${severity}${flags?` [${flags}]`:''}`;
    };
    const lines=[],quiet=[];
    x.requests.forEach(a=>{
      const rowsC=chronologyOf(a);
      if(!rowsC.some(r=>r.label!=='terminal_group')){quiet.push(`Q${a.request}`);return;}
      // Records within 50 ms of the previous one share a line (labels, reasons and paths all stay).
      const bursts=[];
      rowsC.forEach(r=>{
        const prev=bursts.at(-1),last=prev?.at(-1);
        if(last&&last.label!=='terminal_group'&&r.label!=='terminal_group'&&Number.isFinite(r.first.at)&&Number.isFinite(last.first.at)&&r.first.at-last.first.at<=50)prev.push(r);
        else bursts.push([r]);
      });
      lines.push(`Q${a.request} ${a.stage}/${a.model}/${a.identity.pipelineRoundIds.join(',')||'no field'}:`,...bursts.map(burst=>`  ${t(burst[0].first.t)} · ${burst.map(r=>segment(a,r)).join(' · ')}`));
    });
    out.push('\n### 6. Request chronology (deviations)',
      'Ordered by time within each request (t = seconds from the base; section 4 has submit times). Records within 50 ms share a line. Not repeated here: routine observations and SUCCESS_TERMINAL completion proofs (section 4), terminal details (section 5; only non-routine terminals are marked Tn here), dispatch/focus/tab/navigation (section 10 and source), background labels (Background counters). Repeats are ×N with first→last source; any change of status, reason, length, dispatch or attribution is its own entry.',
      ...lines,quiet.length?`No deviation transitions: ${quiet.join(', ')}.`:'Every request has deviation transitions.');
  }
  const unassignedIssues=x.availability.unassigned.concat(x.sourceStatus.unboundErrors||[]).filter(r=>isFailedStatus(r.status)||isHighSeverity(r.severity)||issue.test(`${r.label} ${r.type} ${r.reason||''}`));
  const unassignedGroups=groups(unassignedIssues.map(r=>({first:r,last:r,count:1})),r=>JSON.stringify([r.label,r.first.status,r.first.reason,r.first.model,r.first.recordedStageId,r.first.dispatchId,r.first.severity?.state,r.first.severity?.value]));
  if(unassignedGroups.length)out.push('Unassigned errors (no request join):',rows(['label / status / reason','severity','N','model / recorded stage / dispatch','first→last t / source'],unassignedGroups.map(g=>[
    `${g.first.label}/${value(g.first.status)}/${value(g.first.reason)}`,value(g.first.severity),g.count,
    `${g.first.model||'no model'}/${g.first.recordedStageId||'no stage'}/${dispatch(g.first.dispatchId)}`,endpoints(g)])));
  out.push('\n### 7. Length and display observations',rows(['Q','stable samples / length min..max / groups / zero','pre-submit lengths / equals previous length'],x.requests.map(a=>{
    const stable=a.transitions.filter(r=>/TEXT_STABLE/.test(r.first.type+' '+r.label)),lengths=stable.map(r=>r.first.textLength).filter(Number.isFinite);
    const probes=x.lengthObservations.filter(r=>r.request===a.request);
    return [`Q${a.request}`,`${stable.reduce((n,r)=>n+r.count,0)} / ${lengths.length?`${Math.min(...lengths)}..${Math.max(...lengths)}`:'no field'} / ${stable.length} / ${stable.filter(r=>r.first.textLength===0).reduce((n,r)=>n+r.count,0)}`,
      `${probes.filter(r=>r.beforeSubmit).length}/${probes.filter(r=>r.equalPreviousLength).length}${probes.length?` ${path(probes[0].path)}→${path(probes.at(-1).path)}`:''}`];
  })));
  const renderAll=groups(x.requests.flatMap(a=>[...a.transitions,...a.background].filter(r=>!r.group&&(r.first.type==='displayed'||r.label==='ANSWER_CARD_RENDER_EVALUATED'))),r=>JSON.stringify([r.first.evidence.cardTargetType,r.first.evidence.outcome,r.first.evidence.comparisonReason]));
  out.push('Render outcomes over all requests (per-request counts are in the structured JSON; wrong_card per request is in section 4):',renderAll.length?rows(['page/outcome/reason:N','first→last t / source'],renderAll.map(g=>[
    `${g.first.evidence.cardTargetType||'unspecified'}/${value(g.first.evidence.outcome)}${g.first.evidence.comparisonReason==null?'':`/${g.first.evidence.comparisonReason}`}:${g.count}`,endpoints(g)])):'0 render observations.');
  const manualActions=[];
  x.manual.rows.forEach(r=>{
    const key=`${x.stages.find(st=>st.stageId===r.recordedStageId)?.stage||r.recordedStageId||'no stage'}/${r.model||'no model'}`,prev=manualActions.at(-1);
    if(prev&&prev.key===key&&Number.isFinite(r.at)&&Number.isFinite(prev.lastAt)&&r.at-prev.lastAt<=1000){prev.rows.push(r);prev.lastAt=r.at;}
    else manualActions.push({key,rows:[r],lastAt:r.at});
  });
  out.push('\n### 8. Manual actions',`MANUAL_RECOVERY_REQUESTED=${x.manual.records}; UI=${x.manual.uiButtonRecords}; on successful stages=${x.manual.onSuccessStages}; actions (records of one stage/model within 1 s grouped)=${manualActions.length}.`,
    rows(['t / source','stage / model','details'],manualActions.map(g=>[`${sample(g.rows[0])}${g.rows.length>1?` +${g.rows.slice(1).map(r=>path(r.path)).join(',')}`:''}`,g.key,
      g.rows.map(r=>compact?preview(r.details||'no details'):r.details||'no details').join(' | ')])),
    x.manual.moderatorActions.length?rows(['moderator t / source','label / model'],x.manual.moderatorActions.map(r=>[sample(r),`${r.label}/${r.model||'no model'}`]))
      :'Moderator, pause, get-it and owner actions: 0 records.');
  out.push('\n### 9. Start refusals');
  let refusalGroups=0;
  x.delivery.batches.forEach(b=>{
    const grouped=[];
    b.refusalRows.forEach(r=>{const key=JSON.stringify(Object.fromEntries(Object.entries(r).filter(([k])=>!['path','at','t','attempt','waitedMs','elapsedFromBatchMs'].includes(k))));const prev=grouped.at(-1);
      if(prev?.key===key&&!(r.attempt<prev.last.attempt||r.waitedMs<prev.last.waitedMs)){prev.count++;prev.last=r;}
      else grouped.push({key,first:r,last:r,count:1});});
    grouped.forEach(g=>{refusalGroups+=1;out.push(`- ${path(b.path)} ×${g.count} ${g.first.errorCode||g.first.reason||'no field'}; ${sample(g.first)}→${sample(g.last)}; attempt=${value(g.first.attempt)}→${value(g.last.attempt)}; cumulative waitedMs=${value(g.first.waitedMs)}→${value(g.last.waitedMs)}`);});
  });
  if(!refusalGroups)out.push(x.availability.delivery==='present'?'0 refusals in delivery.diagnosis.batches[].refusals.':'no field delivery.');
  out.push('\n### 10. Focus',`Detailed switches=${x.focus.total}; sources=${countText(x.focus.sources)}; models=${countText(x.focus.models)}; in first_text→final=${x.focus.inTextInterval} (${countText(x.focus.inTextSources)}).`,
    `Automation sources=${countText(Object.fromEntries(Object.entries(x.focus.sources).filter(([k])=>/automation_visit_|activate_tab_/.test(k))))}.`,
    'Exact shared chronology: delivery.journal[] (dispatch, submitted, focus, tab, navigation).');
  out.push('\n### 11. Run window',`runOutcome.startedAt=${value(x.sourceStatus.windowStart)}; completedAt=${value(x.sourceStatus.windowEnd)}.`,
    x.outsideRunWindow.length?rows(['label / model','N','first→last t / source'],groups(x.outsideRunWindow,r=>JSON.stringify([r.label,r.first.model,r.first.requestId,r.first.status,r.first.reason])).map(g=>[`${g.first.label}/${g.first.model}`,g.count,endpoints(g)])):'0 records outside the run window.');
  const lineageText=r=>r.lineageStatus==='next_observed_stage_candidate; dependency_not_proven'?'candidate, dependency not proven':r.lineageStatus;
  const matched=x.promptChecks.filter(r=>r.result==='stored_fragment_found'),unmatched=x.promptChecks.filter(r=>r.result!=='stored_fragment_found');
  const unmatchedByResult=new Map();unmatched.forEach(r=>{if(!unmatchedByResult.has(r.result))unmatchedByResult.set(r.result,[]);unmatchedByResult.get(r.result).push(r);});
  out.push('\n### 12. Prompt checks',
    !x.promptChecks.length?'0 delivered answers with at least 40 normalized characters.':matched.length?rows(['Q / answer source','result','prepared matches / lineage'],matched.map(r=>[
      `Q${r.request} ${path(r.answerPath)}`,r.result,`${r.laterPrompts.filter(p=>p.found).map(p=>path(p.path)).join(',')||'0'} / ${lineageText(r)}`])):'0 stored prompt fragment matches.',
    ...[...unmatchedByResult].map(([result,list])=>`${result} (${list.length}; lineage ${[...new Set(list.map(lineageText))].join(' / ')}): ${list.map(r=>`Q${r.request} ${path(r.answerPath)}`).join(', ')}.`),
    'A fragment found in prepared.prompt proves neither submission nor full answer inclusion.');
  out.push('\n### 13. Diagnoses',rows(['code / reason','severity / participants / stages','records / occurrences / resolved null','first / last source'],x.diagnoses.groups.map(g=>[
    `${g.code}/${g.reasonCode}`,`${g.severities.join(',')}/${g.participants.join(',')}/${g.stages.join(',')}`,`${g.records}/${g.occurrences}/${g.resolvedNull}`,`${g.paths[0]}→${g.paths.at(-1)}`])));
  out.push('\n### 14. Comparisons and counters',...x.comparisons.map(r=>`- ${r.name}: ${pathValue(r.left)} / ${pathValue(r.right)}`),
    `Forced: events=${x.counters.forced.events}; terminal records=${x.counters.forced.terminalRecords}; requests=${x.counters.forced.uniqueRequests}.`,
    `Terminals: records=${x.counters.terminal.records}; groups=${x.counters.terminal.groups}; requests=${x.counters.terminal.uniqueRequests}.`,
    `Dispatch attempts=${JSON.stringify(x.counters.dispatchAttempts)}.`);
  out.push('\n### 15. Delivery batches and problems',rows(['source / stage attempt','mode / models','t / durationMs / gap s','accepted waitedMs / refusals','outcome / skipped / adopted'],x.delivery.batches.map(b=>[
    `${path(b.path)}/${b.stageAttemptId||b.batchId}`,`${b.runMode||'no field'}/${arr(b.models).join(',')}`,`${t(b.t)}/${value(b.durationMs)}/${t(b.gapSeconds)}`,`${value(b.accepted?.waitedMs)}/${b.refusalRows.length}`,`${value(b.outcome)}/${value(b.skipped)}/${value(b.adopted)}`])),
    x.delivery.problems.some(p=>!/^focus_/.test(p.code))?rows(['source','code / severity / model','count','reason'],x.delivery.problems.filter(p=>!/^focus_/.test(p.code)).map(p=>[path(p.path),`${p.code}/${p.severity}/${p.model}`,p.count,p.reason==null?p.reason:preview(p.reason,200)])):'0 non-focus delivery problems.',
    (fp=>fp.length?`Focus problem rows folded (same facts as section 10): ${fp.length} (${countText(Object.fromEntries(count(fp,p=>p.code)))}); models ${[...new Set(fp.map(p=>p.model))].join(', ')}; sources ${fp.map(p=>path(p.path)).join(', ')}.`:'0 focus problem rows.')(x.delivery.problems.filter(p=>/^focus_/.test(p.code))));
  // Background is global, not hundreds of per-request bookkeeping rows.
  const background=groups(x.requests.flatMap(a=>a.background).filter(r=>compact?/PING_TRANSPORT_ERROR|status|PANEL_NOT_FOUND|Panel output|SCRIPT_REINJECT|FINALIZATION_DEFER|Finalization defer|DUPLICATE_FINAL|ANSWER_GENERATING|SELECTOR_STATS/.test(r.label):!chronologyShown.has(r)),r=>r.label);
  out.push('\n### Background counters',rows(['label','N','first→last t / source'],background.map(g=>[g.first.label,g.count,endpoints(g)])));
  if(x.collectionSamples?.length)out.push('\n### Collection coverage',rows(['scope / limit','samples / resets','evicted min..max','first / last source'],
    [...new Set(x.collectionSamples.map(r=>`${value(r.first.value.scope)}/${value(r.first.value.limit)}`))].map(key=>{
      const list=x.collectionSamples.filter(r=>`${value(r.first.value.scope)}/${value(r.first.value.limit)}`===key);
      const mins=list.map(r=>r.evictedMin).filter(Number.isFinite),maxs=list.map(r=>r.evictedMax).filter(Number.isFinite);
      const first=list.map(r=>r.firstTimed||r.first).filter(r=>Number.isFinite(r.at)).sort((a,b)=>a.at-b.at)[0];
      const last=list.map(r=>r.lastTimed||r.last).filter(r=>Number.isFinite(r.at)).sort((a,b)=>b.at-a.at)[0];
      return [key,`${list.reduce((n,r)=>n+r.count,0)}/${list.reduce((n,r)=>n+r.resets,0)}`,mins.length?`${Math.min(...mins)}..${Math.max(...maxs)}`:'no field',`${first?path(first.path):'no usable timestamp'}→${last?path(last.path):'no usable timestamp'}`];
    })));
  const md=out.join('\n');
  // Count UTF-8 bytes without Node dependencies; the extension uses this same code.
  let bytes=0;for(const char of md){const code=char.codePointAt(0);bytes+=code<128?1:code<2048?2:code<65536?3:4;}
  if(bytes>limit){
    if(!compact)return renderTransportMarkdown(x,true);
    return renderTransportOverview(x,limit);
  }
  return md;
}
// Last aggregation level is bounded independently of request/record cardinality.
// It reports complete totals and explicitly states which tables need the source JSON.
function renderTransportOverview(x,limit){
  const safe=v=>display(v).replace(/[\r\n|]/g,' ').slice(0,120).replace(/[\uD800-\uDBFF]$/,'');
  const identity=(v,source)=>{const text=display(v);return text.length>120?`[${text.length} chars; see ${source}]`:text.replace(/[\r\n|]/g,' ');};
  const frequencies=(items,key)=>{const m=new Map();items.forEach(r=>{const k=key(r);m.set(k,(m.get(k)||0)+1);});return [...m].sort((a,b)=>b[1]-a[1]);};
  const decisions=x.requests.flatMap(a=>x.lengths.find(r=>r.request===a.request)?.measurements.acceptanceDecisions||[]);
  const terminalRecords=x.requests.flatMap(a=>a.terminalGroups.flatMap(g=>g.members.map(m=>({first:{label:m.label,type:'MODEL_TERMINAL_COMMITTED',status:g.status,reason:g.completionReason,path:m.path,severity:m.severity},count:1}))));
  const allIssues=x.requests.flatMap(a=>[...a.transitions,...a.background].filter(r=>!r.group)).concat(x.availability.unassigned.concat(x.sourceStatus.unboundErrors||[]).map(r=>({first:r,count:1})),terminalRecords);
  const issue=/FAIL|ERROR|REJECT|BLOCK|NO_SEND|UNCERTAIN|TIMEOUT|RECOVERY|MATERIALIZE|STALE|DIVERGENCE|CANCEL|EXHAUSTED|UNCONFIRMED/i;
  const criticalCategory=r=>{
    const text=`${r.type} ${r.label} ${r.reason||''} ${r.status||''}`;
    if(/STAGE_FAILED|STAGE_FAILURE/i.test(text))return 'stage_failure';
    if(/CORRELATION_REJECTED|IDENTITY_REJECTED/i.test(text))return 'correlation_failure';
    if(/STATE_DIVERGENCE/i.test(text))return 'state_divergence';
    if(/ANSWER_DELIVERY_REJECTED|ANSWER_REJECTED|TEXT_LOST/i.test(text))return 'answer_delivery_failure';
    if(/NO_SEND|CONTEXT_LOST/i.test(text))return 'request_not_delivered';
    if(['MODEL_TERMINAL_COMMITTED','completion_terminal'].includes(r.type) && isFailedStatus(r.status))return 'terminal_failure';
    if(isHighSeverity(r.severity))return 'registered_high_severity';
    return null;
  };
  const critical=new Map(),codes=new Map();
  allIssues.forEach(r=>{
    const category=criticalCategory(r.first);
    if(!category&&!isFailedStatus(r.first.status)&&!issue.test(`${r.first.label} ${r.first.type} ${r.first.reason||''}`))return;
    if(category){let c=critical.get(category);if(!c){c={count:0,path:r.first.path};critical.set(category,c);}c.count+=r.count;}
    const label=r.first.label;let g=codes.get(label);if(!g){g={count:0,path:r.first.path,critical:false};codes.set(label,g);}
    g.count+=r.count;g.critical ||= Boolean(category);
  });
  const labels=[...codes].sort((a,b)=>Number(b[1].critical)-Number(a[1].critical)||b[1].count-a[1].count),shown=labels.slice(0,50);
  const terminals=x.requests.flatMap(a=>a.terminalGroups);
  const statuses=frequencies(terminals,g=>g.status);
  const o=['# Transport extract',`DIGEST_VERSION=${x.DIGEST_VERSION}; mode=overview; limit=${limit} UTF-8 bytes`,
    `sourceFile=${identity(x.sourceFile,'original JSON filename')}; debateRunId=${identity(x.debateRunId,'metadata.debateRunId')}`,
    'Request tables exceeded the byte budget after aggregation. This overview includes complete totals; individual requests, identities, terminal evidence, reasons and chronology are in stageExecutions[], events[] and delivery.journal[] of the source JSON. Long labels are previews of at most 120 characters.',
    `Requests=${x.requests.length}; source records=${x.sourceStatus.totalSourceRecords}; unassigned=${x.availability.unassigned.length}; unassigned errors=${x.availability.unassigned.concat(x.sourceStatus.unboundErrors||[]).filter(r=>isFailedStatus(r.status)||isHighSeverity(r.severity)||issue.test(`${r.label} ${r.type} ${r.reason||''}`)).length}.`,
    `Stages: total=${x.counters.stages.total}; success=${x.counters.stages.success}; withFailureRecords=${x.counters.stages.withFailureRecords}; LONG=${x.counters.stages.long}.`,
    `Terminal records=${x.counters.terminal.records}; groups=${x.counters.terminal.groups}; requests=${x.counters.terminal.uniqueRequests}.`,
    `Engine acceptance decisions=${decisions.length}; true=${decisions.filter(r=>r.accepted.state==='present'&&r.accepted.value===true).length}; false=${decisions.filter(r=>r.accepted.state==='present'&&r.accepted.value===false).length}; null=${decisions.filter(r=>r.accepted.state==='present'&&r.accepted.value===null).length}; missing=${decisions.filter(r=>r.accepted.state==='missing').length}.`,
    `Manual recovery=${x.manual.records}; UI records=${x.manual.uiButtonRecords}; focus switches=${x.focus.total}; start refusals=${x.counters.startRefusals}.`,
    `Diagnoses=${x.diagnoses.appendix.length}; shortened prompts=${x.availability.shortenedPrompts.length}; observer stop records=${x.sourceStatus.observerStops.length}.`,
    `Terminal status counts (groups, showing ${Math.min(20,statuses.length)}/${statuses.length}): ${statuses.slice(0,20).map(([k,n])=>`${safe(k)}:${n}`).join('; ')}.`,
    'Mandatory critical categories: every matching observation is counted here, irrespective of frequency or the label-table limit (includes failed terminal records).',
    table(['critical category','observations','example source'],[...critical].map(([k,g])=>[k,g.count,safe(g.path)])),
    `Observed error labels: showing ${shown.length}/${labels.length}; total error observations=${labels.reduce((n,[,g])=>n+g.count,0)}; remaining label groups=${labels.length-shown.length} (source JSON).`,
    table(['label preview','critical','observations','example source'],shown.map(([k,g])=>[safe(k),g.critical,g.count,safe(g.path)]))];
  return o.join('\n');
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
