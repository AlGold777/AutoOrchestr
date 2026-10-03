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
const DIGEST_VERSION = '3.1.0';
const COMPRESSION = Object.freeze({
  allRequests: true, chronologyLimit: null, outsideWindowToleranceMs: 0,
  terminalPairWindowMs: 50, promptProbeCharacters: 50,
  grouping: 'request + dispatchId + status + reason + significant fields; changes split groups',
  stable: 'first and every change, including zero length, correlation and dispatch changes',
  background: 'counts and first/last paths; all member paths retained in the Markdown source registry',
  ignoredGroupingFields: ['elapsedMs', 'durationMs', 'foregroundMsUsed', 'focusSwitchesUsed', 'waitedMs', 'ms', 'at', 'logCollection', 'SELECTOR_STATS sampled hit/miss/rate counters']
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
        'ANSWER_REJECTED', 'ANSWER_ACCEPTANCE_DECIDED', 'OBSERVER_STOPPED', 'response_rejected', 'late_text', 'unproven_replaced', 'get_it_result', 'owner_answer'].includes(r.type)
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
        firstCompletionDetected: milestone((r) => r.type === 'COMPLETION_DETECTED'), deliveryFinal: timeFact(a.final, t0, st0, submitted) },
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
    const sample={path:r.path,t:offset(r.at,t0),value:v};
    const row=collectionSamples.get(key);
    if(row){ row.count++; if(v.appended<row.last.value.appended || v.evicted<row.last.value.evicted)row.resets++; row.last=sample; }
    else collectionSamples.set(key,{model:r.model,requestId:r.requestId,dispatchId:r.dispatchId,count:1,resets:0,first:sample,last:sample});
  });
  const noRound = recs.filter((r) => r.src === 'events' && !recordRound(r)).map((r) => r.path);
  return {
    schemaVersion: 3, report: 'extract_transport', DIGEST_VERSION, compression: { ...COMPRESSION }, sourceFile,
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
      observerStops: recs.filter(r => r.type === 'OBSERVER_STOPPED' || r.label === 'LIFECYCLE_TRACKING_STOPPED').map(r => r.path),
      displayProof: recs.filter(r => r.raw.payload?.evidence?.normalizedHash || r.raw.answerArtifact?.normalizedHash).map(r => r.path),
      acceptance: recs.filter(r => r.type === 'ANSWER_COLLECTED').map(r => ({ path: r.path, accepted: r.raw.payload?.accepted })),
      windowStart, windowEnd, totalSourceRecords: recs.length, unassignedPaths: unassigned.map(r => r.path) },
    delivery: { batches, problems: arr(diag.problems).map((x, i) => ({ path: `delivery.diagnosis.problems[${i}]`, ...x })) }
  };
}
function renderTransportMarkdown(x) {
  const out = [], registries = [], terminalRegistry = [], variants = [], membership = new Map();
  const cell = v => display(v).replace(/\|/g, '\\|').replace(/[\r\n]+/g, ' ');
  const rows = (head, list) => table(head, list.map(r => r.map(cell)));
  const labelAliases = {
    ANSWER_TEXT_STABLE: 'STABLE', TEXT_STABLE: 'STABLE', COMPLETION_DETECTED: 'COMPLETE',
    CORRELATION_REJECTED: 'CORR_REJECT', LIFECYCLE_CORRELATION_REJECTED: 'CORR_REJECT',
    SELECTOR_STATS: 'SELECTORS', PING_TRANSPORT_ERROR: 'PING_ERROR',
    'Ping transport error': 'PING_ERROR', 'Panel output update failed': 'NO_PANEL', PANEL_NOT_FOUND: 'NO_PANEL',
    SCRIPT_REINJECT_SKIPPED_ACTIVE_RUN: 'REINJECT_SKIP',
    'Finalization deferred (generation active)': 'DEFER_ACTIVE', FINALIZATION_DEFERRED_GENERATION_ACTIVE: 'DEFER_ACTIVE',
    'Response ignored (pipeline control)': 'DUPLICATE', duplicate_final: 'DUPLICATE',
    ANSWER_GENERATING: 'GENERATING', GENERATION_ACTIVE: 'GENERATING'
  };
  const usedAliases = new Set();
  const label = v => { if (labelAliases[v]) { usedAliases.add(v); return labelAliases[v]; } return v; };
  const counts = v => Object.entries(v || {}).map(([k,n]) => `${k}=${n}`).join(', ') || '0 records';
  const seconds = n => n == null ? 'no field' : Number(n).toFixed(3);
  const eventTime = r => `${seconds(r?.t)} ${r?.path || 'not recorded'}`;
  const pathList = paths => {
    const byPrefix = new Map(), other = [];
    unique(paths).forEach(path => {
      const m = /^(.+)\[(\d+)\]$/.exec(path);
      if (!m) { other.push(path); return; }
      if (!byPrefix.has(m[1])) byPrefix.set(m[1], []);
      byPrefix.get(m[1]).push(Number(m[2]));
    });
    return [...byPrefix.entries()].map(([prefix, values]) => {
      const ns = values.sort((a,b) => a-b), parts = [];
      for (let i=0;i<ns.length;i++) {
        const start=ns[i], step=ns[i+1]-start; let j=i;
        if (step>0) while(j+1<ns.length && ns[j+1]-ns[j]===step)j++;
        if (step===1 && j>i || j-i>=3) { parts.push(`${start}..${ns[j]}${step===1?'':`/${step}`}`);i=j; }
        else parts.push(String(start));
      }
      return `${prefix==='events'?'E':prefix==='delivery.journal'?'J':prefix}[${parts.join(',')}]`;
    }).concat(other).join('; ') || '0 records';
  };
  const reference = (paths, prefix='G') => {
    if (paths.length <= 1) return paths[0] || '0 records';
    const key = unique(paths).slice().sort().join('|');
    let row = registries.find(r => r.key===key);
    if (!row) { row={ key, id:`${prefix}${registries.length+1}`, paths:unique(paths) }; registries.push(row); }
    return row.id;
  };
  const dispatchRef = (id) => {
    if (!id) return 'no field';
    const owner = x.requests.find(a => a.identity.dispatchIds.includes(id));
    return owner ? `Q${owner.request}.D${owner.identity.dispatchIds.indexOf(id)+1}` : id;
  };
  const registered = m => Object.values(m.registered).every(f=>f.state==='missing') ? 'all no field' : Object.values(m.registered).map(display).join(' / ');
  x.requests.forEach(a => a.terminalGroups.forEach((g,i) => {
    const id=`Q${a.request}.T${i+1}`; g.members.forEach(m => membership.set(m.path,id));
    terminalRegistry.push({id,a,g});
  }));
  const time = r => r ? `${eventTime(r)}${r.stageSeconds == null?'':` +st=${seconds(r.stageSeconds)}`}${r.submitSeconds==null || r.submitSeconds===0?'':` +sub=${seconds(r.submitSeconds)}`}` : 'not recorded';
  out.push('# Transport extract', `DIGEST_VERSION=${x.DIGEST_VERSION} · sourceFile=${x.sourceFile || 'no field'} · debateRunId=${x.debateRunId}`,
    `Compression: all requests; no line cap; terminalPairWindowMs=${x.compression.terminalPairWindowMs}; promptProbeCharacters=${x.compression.promptProbeCharacters}; grouping=${x.compression.grouping}.`,
    `Grouping ignores sampled time counters, logCollection and SELECTOR_STATS hit/miss/rate counters. Collection counters have a separate summary; source paths retain access to individual samples in JSON.`,
    `t = seconds from ${x.base.path}=${display(x.base.value)}, precision 0.001. +st/+sub only in section 4.`,
    'Legend: E[N]=events[N]; J[N]=delivery.journal[N]; E[1..3,7] means E[1],E[2],E[3],E[7]; E[1..13/4] means E[1],E[5],E[9],E[13]. QN.DK is a dispatch alias; QN.TK is a terminal group. ~stage means a join by stage/model only; pre-dispatch marks observations preceding dispatch_started. G references resolve in the source registry. S[N]=delivery.diagnosis.sends[N]; B[N]=delivery.diagnosis.batches[N]; P[N]=delivery.diagnosis.problems[N]. AL=payload.answerLength; EL=payload.evidence.answerLen; EAL=payload.evidence.answerLength.',
    'Notes: no field / null / "" / [] / false / 0 are distinct. Registered fields are facts, not causal proof. Compare answer hashes only with matching representation and normalization version; token removal is a transformation. Equal lengths do not establish text identity. A stored prepared.prompt fragment does not prove submission or complete answer inclusion. Shortened text cannot prove absence. Focus intervals do not prove continuous printing; late observations do not prove continued generation. Refusal waitedMs is cumulative: do not sum it; start→accept is an observed interval, not proof of lock duration.',
    ...['metadata','runOutcome','health'].map(k => `${k}: ${Object.values(x[k]).map(pathValue).join(' · ')}`));
  out.push('\n### 1. Data availability and integrity',
    `Exported events=${x.counters.events}; correlationQuality: ${counts(x.quality.correlationQuality)}; provenance: ${counts(x.quality.provenance)}.`,
    `Non-exact=${x.quality.observedNonExact}; rule=${x.quality.completenessRule}.`,
    `plan=${display(x.availability.plan)}; delivery=${x.availability.delivery}; shortened prepared.prompt=${x.availability.shortenedPrompts.length}.`,
    `Missing pipelineRoundId=${x.quality.eventsWithoutRound.count}: ${reference(x.quality.eventsWithoutRound.paths)}. Round absence on run/stage records alone is not missing request identity.`,
    `Registered integrity: ${Object.values(x.integrity.registered).map(f=>f.state==='present'&&Array.isArray(f.value)?`${f.path}=${f.value.length} records`:pathValue(f)).join(' · ')}`,
    `Check coverage: ${pathValue(x.integrity.checks)}; computed from exported records: ${JSON.stringify(x.integrity.computed)}.`,
    `Completeness dimensions: ${x.sourceStatus.completeness.state}; ${x.sourceStatus.completeness.path}; mode history: ${pathValue(x.sourceStatus.modeHistory)}.`,
    `Collection coverage: ${pathValue(x.sourceStatus.collection)}; dynamic plan=${x.sourceStatus.planning.path}: ${x.sourceStatus.planning.state==='missing'?'no field':x.sourceStatus.planning.value?.revision ? 'revision and instance mapping captured' : 'unavailable'}.`,
    `Observer stop records=${x.sourceStatus.observerStops.length}: ${reference(x.sourceStatus.observerStops)}; display hash observations=${x.sourceStatus.displayProof.length}: ${reference(x.sourceStatus.displayProof)}. These observations do not establish complete coverage.`,
    `Delivery sections: ${Object.entries(x.availability.deliverySections).map(([k,v])=>`${v.path}=${v.state}${v.count==null?'':` (${v.count} records)`}`).join('; ')}.`,
    `Joins: ${counts(x.counters.joinMethods)}; unassigned=${x.availability.unassigned.length}: ${reference(x.sourceStatus.unassignedPaths)}.`);
  const legacy = [];
  if (x.integrity.checks.state === 'missing') legacy.push('integrity arrays have no registered check status');
  if (x.availability.plan.value == null) legacy.push('fixed execution plan not captured; legacy expectedStages=0 is not evidence of zero planned work');
  if (x.sourceStatus.acceptance.length && x.sourceStatus.acceptance.every(r=>r.accepted===false) && !x.requests.some(a=>a.acceptanceDecisions?.length)) legacy.push('all ANSWER_COLLECTED.accepted=false without acceptance decisions; constant producer field cannot establish engine rejection');
  if (legacy.length) out.push(`Legacy limitations: ${legacy.join('; ')}.`);
  out.push('\n### 2. Stages', rows(['stage / source','participants','start t','end t','durationMs','gap s','status','LONG','success + failure records'], x.stages.map(s=>[
    `${s.stage} ${s.path}`,s.participants,seconds(s.startT),seconds(s.endT),s.durationMs,seconds(s.gapSeconds),s.status,s.long,pathList(s.successWithFailureRecords)])),
    `calc: median(${x.calculations.sortedDurations.join(',')})=${x.calculations.medianDurationMs}; LONG=${x.calculations.long}.`);
  if (x.stages.every(s=>s.expected.value==null)) out.push('Expected stage definitions: all null/no field; plan conformance cannot be assessed.');
  x.stages.forEach(s=>out.push(`${s.stage}=${s.stageId}${s.expected.value==null?'':` · ${pathValue(s.expected)}`} · deviations=${display(s.deviations)}`));
  out.push('\n### 3. Identity map', rows(['request','stage/model','requestId','pipelineRoundId','token','stageAttemptId / wait','dispatch aliases / foreign','tabIds','batch_start'], x.requests.map(a=>[
    `Q${a.request}`,`${a.stage}/${a.model}`,a.requestId,a.identity.pipelineRoundIds,a.identity.token,`${a.identity.stageAttemptId || 'no field'} / ${a.identity.waitId || 'no field'}`,
    `${a.identity.dispatchIds.map((id,i)=>`Q${a.request}.D${i+1}=${id}`).join(', ') || 'no field'}; foreign=${a.identity.foreignDispatchIds.map(f=>`${dispatchRef(f.dispatchId)} owner=${f.ownerStage}/${f.ownerModel}`).join(', ') || '0 records'}`,a.identity.tabIds,a.identity.batchStartPath])));
  out.push('\n### 4. All requests', rows(['request','stage/model','dispatch t','submitted','first_text','first TEXT_STABLE','first COMPLETION_DETECTED','record counts','terminal groups','collected / decisions','stable→terminal ms'], x.requests.map(a=>[
    `Q${a.request}`,`${a.stage}/${a.model}`,time(a.times.dispatchStarted),time(a.times.submitted),time(a.times.firstText),time(a.times.firstStable),time(a.times.firstCompletionDetected),
    `duplicate=${a.counts.duplicateFinalRejected}; wrong_card=${a.counts.wrongCard}; displayed=${a.counts.displayed}; manual=${a.counts.manualRecords}; UI=${a.counts.uiButtonRecords}; rejected=${a.counts.correlationRejected}`,
    a.terminalGroups.map((g,i)=>`Q${a.request}.T${i+1}`),
    a.collected.map(r=>pathValue(r.accepted)).concat((a.acceptanceDecisions||[]).map(r=>`${pathValue(r.accepted)} reason=${r.reason || 'no field'}`)),
    a.terminalGroups.map((g,i)=> {
      if (!a.times.firstStable) return 'no TEXT_STABLE';
      const start=g.firstAt-a.times.firstStable.at, end=g.lastAt-a.times.firstStable.at;
      return `Q${a.request}.T${i+1} ${start===end?start:`${start}..${end}`}${end>120000?' >120000':end>15000?' >15000':start<0?' negative':''}`;
    })])), 'Count columns measure records: duplicate=DUPLICATE_FINAL_REJECTED; wrong_card=wrong-card evaluations; displayed=displayed journal observations; manual=MANUAL_RECOVERY_REQUESTED; UI=UI button records; rejected=CORRELATION_REJECTED.', 'calc: stable→terminal uses the first TEXT_STABLE timestamp and the first/last group member timestamps.');
  out.push('\n### 5. Shared stage timeline and request transitions');
  x.stageTimeline.forEach(s=> { if (s.rows.length) out.push(`\n#### ${s.stage}`,rows(['t','model','event','dispatch','source','details'],s.rows.map(r=>[
    seconds(r.t),r.model,r.type==='dispatch'?r.label:r.type,dispatchRef(r.dispatchId),r.path,r.type==='tab'?`tabId=${r.tabId}`:r.details.replace(/\bms=\d+ ?/g,'')]))); });
  const variant = value => {
    if (!value || !Object.keys(value).length) return '';
    // Repeated nested identities/artifacts are defined once, not copied into
    // every observation variant. No hash or identity field is discarded.
    const compact = Object.fromEntries(Object.entries(value).map(([k,v]) => [k,
      v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length ? { ref: variant(v) } : v]));
    const key = JSON.stringify(compact);
    let i = variants.findIndex(v => v.key === key);
    if (i < 0) { i = variants.length; variants.push({ key, value: compact }); }
    return `V${i + 1}`;
  };
  let defaults = {};
  const state = f => {
    const ev = {...f.evidence};
    x.compression.ignoredGroupingFields.forEach(k=>delete ev[k]);
    ['elapsedMs','durationMs','foregroundMsUsed','focusSwitchesUsed','waitedMs','ms','at'].forEach(k=>delete ev[k]);
    if (f.label==='SELECTOR_STATS') ['hitCount','missCount','totalCount','hitRate'].forEach(k=>delete ev[k]);
    if (f.groupingDetail && (f.label === 'SELECTOR_STATS' || /PING_TRANSPORT_ERROR|ANSWER_CARD_RENDER_EVALUATED|REINJECT/.test(f.label))) ev.observation=f.groupingDetail;
    ['textLength','answerLength','answerLen'].forEach(k=>{ if(ev[k]===f.textLength)delete ev[k]; });
    ['status','finalStatus','responsePhase'].forEach(k=>{ if(ev[k]===f.status)delete ev[k]; });
    if(ev.reason===f.reason)delete ev.reason;
    return [f.textLength==null?'':`len=${f.textLength}`, f.status==null?'':`${f.status}`,
      f.reason==null || label(f.reason)===label(f.label) || label(f.reason)===label(f.type)?'':`${label(f.reason)}`,
      f.dispatchId && f.dispatchId!==defaults.dispatch?dispatchRef(f.dispatchId):'',
      f.type && f.correlationQuality?.state==='present' && f.pipelineRoundId!==defaults.round?`round=${f.pipelineRoundId ?? 'no field'}`:'',
      f.correlationQuality?.state==='present' && display(f.correlationQuality)!==defaults.quality?`cq=${display(f.correlationQuality)==='inferred'?'I':display(f.correlationQuality)==='exact'?'E':display(f.correlationQuality)}`:'',
      variant(ev),f.flags?.length?`[${f.flags.map(v=>v.replace('joined by stageId','~stage').replace("before this attempt's dispatch_started",'pre-dispatch')).join('; ')}]`:''].filter(Boolean).join(' ');
  };
  x.requests.forEach(a=>{
    const all = [...a.transitions.filter(r=>!r.group),...a.background];
    const common = fn => Object.entries(all.reduce((o,r)=>{const v=fn(r.first);if(v!=null)o[v]=(o[v]||0)+r.count;return o;},{})).sort((a,b)=>b[1]-a[1])[0]?.[0];
    defaults={ dispatch:a.identity.dispatchIds.length===1?a.identity.dispatchIds[0]:null, round:common(f=>f.pipelineRoundId), quality:common(f=>f.correlationQuality?.state==='present'?display(f.correlationQuality):null) };
    const c=a.coverage;
    out.push(`\n#### Q${a.request}: ${a.stage}/${a.model}`,`Shown ${c.representedRecords} of ${c.totalRecords-c.sharedStageRecords} request records; ${c.sharedStageRecords} in shared timeline; omitted=${c.omittedRecords}. Defaults for event rows: dispatch=${dispatchRef(defaults.dispatch)}, round=${defaults.round || 'no field'}, cq=${defaults.quality || 'no field'}; overrides shown explicitly.`);
    a.transitions.forEach(r=> {
      const ref = reference(r.paths); r.paths.forEach(p=>{ if (!membership.has(p)) membership.set(p,ref); });
      if (r.group) { out.push(`- t=${seconds(r.first.t)} ${membership.get(r.paths[0])} (${ref})`); return; }
      out.push(`- t=${seconds(r.first.t)} ${label(r.first.type==='LEGACY_DIAGNOSTIC_EVENT'?r.first.label:r.first.type)} ×${r.count} ${ref} ${state(r.first)}${r.count>1?` · last t=${seconds(r.last.t)}`:''}${/MANUAL|RECOVERY|CORRELATION|STAGE_FAILED/.test(`${r.first.type} ${r.first.label}`)&&r.first.details?` · ${r.first.details}`:''}`);
    });
    if(a.background.length) {
      const states=new Map(), sequence=[];
      a.background.forEach(r=>{
        const value=state(r.first), key=JSON.stringify([r.label,value,r.first.groupingDetail]);
        let item=states.get(key);
        if(!item){item={id:`b${states.size+1}`,label:r.label,value,paths:[],count:0,first:r.first,last:r.last};states.set(key,item);}
        item.paths.push(...r.paths);item.count+=r.count;
        if(r.last.at>item.last.at)item.last=r.last;
        sequence.push(`${item.id}${r.count>1?`×${r.count}`:''}`);
      });
      out.push('Background states (first→last t); sequence below preserves returns to earlier states. Counts measure source records.');
      states.forEach(r=>{
        const ref=reference(r.paths);r.paths.forEach(p=>{if(!membership.has(p))membership.set(p,ref);});
        out.push(`- ${r.id} ${label(r.label)} ×${r.count} ${seconds(r.first.t)}→${seconds(r.last.t)} ${ref} ${r.value}`);
      });
      // Compress repeated cycles, not their constituent states. A→B→A never
      // becomes an unordered {A,B}; every group occurrence can be expanded.
      const tokens=[];
      for(let i=0;i<sequence.length;){
        let best={length:1,repeats:1,saved:0};
        for(let length=1;length<=Math.min(16,(sequence.length-i)/2);length++){
          let repeats=1;
          while(i+(repeats+1)*length<=sequence.length && sequence.slice(i,i+length).every((v,k)=>v===sequence[i+repeats*length+k]))repeats++;
          const saved=length*(repeats-1);
          if(saved>best.saved)best={length,repeats,saved};
        }
        const block=sequence.slice(i,i+best.length).join('→');
        tokens.push(best.repeats>1?`(${block})×${best.repeats}`:block);i+=best.length*best.repeats;
      }
      out.push(`Background sequence (${sequence.length} groups, group-start order): ${tokens.join('→')}`);
    }
  });
  out.push('\n### 6. Length observations',...x.lengthObservations.map(r=>`- Q${r.request} ${r.path} t=${seconds(r.t)} len=${r.length}${r.beforeSubmit?' before submit':''}${r.equalPreviousLength?` equals Q${r.previousRequest} length (identity unproven)`:''}`));
  out.push('\n### 7. Terminal registry and answer representations',rows(['terminal','status / reason','dispatch','interval ms','members: AL / EL / EAL','foregroundMsUsed / focusSwitchesUsed / doneReason / durationMs'],terminalRegistry.map(({id,g})=>[
    id,`${g.status}/${g.completionReason}`,dispatchRef(g.dispatchId),g.intervalMs,
    g.members.map(m=>`${m.path} ${m.label}: ${display(m.answerLength)} / ${display(m.evidenceAnswerLen)} / ${display(m.evidenceAnswerLength)}`).join('; '),
    g.members.map((m,i)=>`member ${i+1}: ${registered(m)}`).join('; ')])),
    rows(['request','delivery/journal chars','collected chars','other lengths'],x.lengths.map(r=>{
      const m=r.measurements;const same=m.delivery?.state==='present'&&m.journal?.state==='present'&&m.delivery.value===m.journal.value;
      return [`Q${r.request}`,same?`${display(m.delivery)} (${m.delivery.path}; ${m.journal.path})`:`${m.delivery?pathValue(m.delivery):'no send'}; ${m.journal?pathValue(m.journal):'not recorded'}`,
        m.collected.map(v=>pathValue(v.value)),
        [...m.revisions,...m.staleDropped].map(v=>pathValue(v.value))];
    })), 'Legacy lengths without a declared representation are shown separately; a difference between tagged delivery and cleaned engine text is not classified as text loss.');
  out.push('Prompt/answer artifacts, render targets and command lineage are defined once in the chronology evidence references (V). Raw source paths retain individual observations.');
  out.push('\n### 8. Manual actions',`MANUAL_RECOVERY_REQUESTED=${x.manual.records}; UI button records=${x.manual.uiButtonRecords}; on successful stages=${x.manual.onSuccessStages}.`,
    ...x.manual.rows.map(r=>`- ${eventTime(r)} ${r.recordedStageId || 'no stage'} ${r.model || 'no model'} ${r.details || 'no details'}`),
    ...x.manual.moderatorActions.map(r=>`- ${eventTime(r)} ${r.label} ${r.model || 'no model'} ${r.details || 'no details'}`));
  out.push('\n### 9. Start refusals');
  x.delivery.batches.forEach(b=>{
    const groups=[];
    b.refusalRows.forEach(r=>{
      const key=JSON.stringify(Object.fromEntries(Object.entries(r).filter(([k])=>!['path','at','t','attempt','waitedMs','elapsedFromBatchMs'].includes(k))));
      const previous=groups.at(-1);
      const reset=previous && (r.attempt<previous.last.attempt || r.waitedMs<previous.last.waitedMs);
      if(previous?.key===key && !reset) { previous.paths.push(r.path); previous.last=r; }
      else groups.push({key,first:r,last:r,paths:[r.path]});
    });
    groups.forEach(g=>out.push(`- ${reference(g.paths)} ×${g.paths.length} ${g.first.errorCode || g.first.reason || 'no field'} t=${seconds(g.first.t)}→${seconds(g.last.t)}; attempt=${display(g.first.attempt)}→${display(g.last.attempt)}; cumulative waitedMs=${display(g.first.waitedMs)}→${display(g.last.waitedMs)}; elapsedFromBatchMs=${display(g.first.elapsedFromBatchMs)}→${display(g.last.elapsedFromBatchMs)}; fields=${g.key}`));
    if(b.accepted)out.push(`- ${b.path}.accepted.waitedMs=${display(b.accepted.waitedMs)} (do not add cumulative refusal values)`);
  });
  out.push('\n### 10. Focus',`Recorded detailed switches=${x.focus.total}; sources: ${counts(x.focus.sources)}; models: ${counts(x.focus.models)}; first_text→delivery final interval=${x.focus.inTextInterval} (${counts(x.focus.inTextSources)}).`,
    `Automation visits / activate_tab sources: ${counts(Object.fromEntries(Object.entries(x.focus.sources).filter(([k])=>/automation_visit_|activate_tab_/.test(k))))}. Consult delivery.collection for omitted focus details.`);
  defaults={};
  out.push('\n### 11. Outside the run window',`Window startedAt=${display(x.sourceStatus.windowStart)} completedAt=${display(x.sourceStatus.windowEnd)}; time base remains stageExecutions[0].actual.startedAt.`,
    ...x.outsideRunWindow.map(r=>{
      const f=r.first, before=f.at<x.sourceStatus.windowStart;
      const references=unique(r.paths.map(p=>membership.get(p)).filter(Boolean));
      return `- ${before?'before':'after'} model=${f.model || 'no model'} request=${x.requests.find(a=>a.requestId===f.requestId)?.request || 'unassigned'} ${r.label} ×${r.count} first=${seconds(f.t)} last=${seconds(r.last.t)}${!before&&x.sourceStatus.windowEnd!=null?` +end=${seconds((f.at-x.sourceStatus.windowEnd)/1000)}..${seconds((r.last.at-x.sourceStatus.windowEnd)/1000)}`:''}; ${reference(r.paths)}; chronology=${references.join(',') || 'unassigned'}; ${state(f)}`;
    }));
  out.push('\n### 12. Stored prompt fragment checks');
  const emptyChecks=new Map();
  x.promptChecks.forEach(r=>{
    const found=r.laterPrompts.filter(p=>p.found);
    if(found.length) out.push(`- Q${r.request} ${r.answerPath}: fragment found in prepared.prompt ${found.map(p=>p.path).join(', ')}; lineage=${r.lineageStatus}; submissionProven=false; fullAnswerInclusionProven=false.`);
    else { const key=`${r.result}; lineage=${r.lineageStatus}`; if(!emptyChecks.has(key))emptyChecks.set(key,[]); emptyChecks.get(key).push(r); }
  });
  emptyChecks.forEach((rs,key)=>out.push(`- ${key}: ${rs.map(r=>`Q${r.request}`).join(', ')}; ${reference(rs.map(r=>r.answerPath))}; prepared candidates=${reference(rs.flatMap(r=>r.laterPrompts.map(p=>p.path)))}.`));
  out.push('\n### 13. Diagnoses grouped',rows(['group','code / reason','severity','participants','stages','records','occurrences','resolved null','paths'],x.diagnoses.groups.map((g,i)=>[
    `D${i+1}`,`${g.code}/${g.reasonCode}`,g.severities,g.participants,g.stages,g.records,`${g.occurrences}${g.missingOccurrences?` missing=${g.missingOccurrences}`:''}`,g.resolvedNull,pathList(g.paths)])));
  out.push('\n### 14. Same-name comparisons and count units',...x.comparisons.map(r=>`- ${r.name}: ${pathValue(r.left)} / ${pathValue(r.right)}`),
    `Forced: events=${x.counters.forced.events}; terminal records=${x.counters.forced.terminalRecords}; unique requests=${x.counters.forced.uniqueRequests}.`,
    `Terminals: records=${x.counters.terminal.records}; decision/status groups=${x.counters.terminal.groups}; unique requests=${x.counters.terminal.uniqueRequests}.`,
    `Dispatch projections: ${JSON.stringify(x.counters.dispatchAttempts)}.`);
  out.push('\n### 15. Delivery batches and problems',rows(['path / wait','stage attempt','mode','models','t','accepted waitedMs','refusals','outcome','durationMs','gap s','skipped','adopted'],x.delivery.batches.map(b=>[
    `${b.path} / ${b.waitId}`,b.stageAttemptId || b.batchId,field(b,'runMode',b.path),arr(b.models),seconds(b.t),b.accepted?.waitedMs,b.refusalRows.length,b.outcome,b.durationMs,seconds(b.gapSeconds),field(b,'skipped',b.path),field(b,'adopted',b.path)])),
    rows(['source','code','severity','model','count','reason / details'],x.delivery.problems.map(p=>[
      p.path,p.code,p.severity,p.model,p.count, /focus/.test(p.code)?'see section 10':/start_refus/.test(p.code)?'see section 9':p.reason])));
  const resolvedAllNull=x.diagnoses.appendix.length && x.diagnoses.appendix.every(d=>d.resolvedAt===null);
  out.push('\n### Appendix. Individual diagnoses', ...(resolvedAllNull?['All listed diagnoses have resolvedAt=null.']:[]),
    rows(['source','group','stage','participant','occurrences','first t',...(resolvedAllNull?[]:['resolvedAt'])],x.diagnoses.appendix.map(d=>[
      d.path,`D${x.diagnoses.groups.findIndex(g=>g.code===d.code&&g.reasonCode===d.reasonCode)+1}`,x.stages.find(s=>s.stageId===d.affectedStageId)?.stage || d.affectedStageId,
      d.affectedParticipant,field(d,'occurrences',d.path),seconds(offset(toMs(d.firstObservedAt),x.base.value)),...(resolvedAllNull?[]:[field(d,'resolvedAt',d.path)])])));
  if(x.collectionSamples?.length)out.push('\n### Collection counter samples', 'First/last per request/dispatch/scope; resets count decreases in appended/evicted. Intermediate samples and exact eviction times remain in JSON.',
    rows(['request / dispatch','samples / resets','first sample','last sample'],x.collectionSamples.map(r=>[
      `Q${x.requests.find(a=>a.requestId===r.requestId)?.request ?? '?'} / ${dispatchRef(r.dispatchId)}`,`${r.count} / ${r.resets}`,`${r.first.path} t=${seconds(r.first.t)}: ${JSON.stringify(r.first.value)}`,`${r.last.path} t=${seconds(r.last.t)}: ${JSON.stringify(r.last.value)}`])));
  out.push('\n### Event label aliases', 'cq=I means inferred; cq=E means exact.', ...[...usedAliases].map(v=>`${labelAliases[v]}=${v}`));
  const shapes=new Map();
  variants.forEach((v,i)=>{
    const keys=Object.keys(v.value).sort().join('|');
    if(!shapes.has(keys))shapes.set(keys,[]);
    shapes.get(keys).push({...v,id:`V${i+1}`});
  });
  const templates=[], encoded=new Map();
  shapes.forEach(group=>{
    const template={};
    Object.keys(group[0].value).forEach(key=>{
      const frequencies=new Map();
      group.forEach(v=>{const text=JSON.stringify(v.value[key]);frequencies.set(text,(frequencies.get(text)||0)+1);});
      template[key]=JSON.parse([...frequencies].sort((a,b)=>b[1]-a[1])[0][0]);
    });
    const id=`C${templates.length+1}`, base=JSON.stringify(template);
    const patches=group.map(v=>JSON.stringify(Object.fromEntries(Object.entries(v.value).filter(([k,value])=>JSON.stringify(value)!==JSON.stringify(template[k])))));
    if(base.length+id.length+group.length*(id.length+1)+patches.reduce((n,p)=>n+p.length,0)<group.reduce((n,v)=>n+v.key.length,0)){
      templates.push(`${id}=${base}`);group.forEach((v,i)=>encoded.set(v.id,`${id}+${patches[i]}`));
    }else group.forEach(v=>encoded.set(v.id,v.key));
  });
  out.push('\n### Grouping evidence dictionary', 'A {ref:Vn} resolves to that object. Cn are encoding templates, not observations. Vn=Cn+{...} copies the template and overrides listed fields. Missing keys remain missing; null and {} are explicit.',
    ...templates,...variants.map((_,i)=>`V${i+1}=${encoded.get(`V${i+1}`)}`));
  const addressed = new Set([...membership.keys(), ...registries.flatMap(r=>r.paths), ...x.stageTimeline.flatMap(s=>s.rows.map(r=>r.path))]);
  const unrepresented = x.sourceStatus.allPaths.filter(p=>!addressed.has(p));
  if(unrepresented.length) out.push(`Other run/stage/batch source records: ${reference(unrepresented)}.`);
  out.push('\n### Source registry',...registries.map(r=>`${r.id}: ${pathList(r.paths)}`));
  return out.join('\n').replace(/delivery\.journal\[(\d+)\]/g,'J[$1]').replace(/events\[(\d+)\]/g,'E[$1]').replace(/delivery\.diagnosis\.sends\[(\d+)\]/g,'S[$1]').replace(/delivery\.diagnosis\.batches\[(\d+)\]/g,'B[$1]').replace(/delivery\.diagnosis\.problems\[(\d+)\]/g,'P[$1]');
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
