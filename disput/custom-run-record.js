// The record of a Custom run: every attempt of every model, as it really went — instructions and
// input apart, input with its sources, the prompt as dispatched by the transport, the answer and the
// outcome. An attempt is never rewritten: a retry is a new attempt that refers to the one it follows.
// Every text is stored once under its fingerprint; attempts hold references (the input of one step
// is the answers of another). Storage is bounded by size: whole oldest runs are removed first.
// A record read back after a reload is history only: an attempt that was sent but never finished is
// marked "unknown" and is never re-sent from here. Version 2 adds the registry (artifacts) and the snapshot of the
// state of the run (ТЗ 8.2); a version 1 record has neither and cannot be resumed.
(function initCustomRunRecord(root) {
  'use strict';

  const INDEX_KEY = 'customRunRecords.index';
  const RUN_KEY_PREFIX = 'customRunRecord.';
  // chrome.storage.local holds ~10 MB without unlimitedStorage and is shared with the rest of the
  // extension: the records take at most this much.
  const DEFAULT_MAX_BYTES = 4 * 1024 * 1024;

  // FNV-1a over UTF-16 code units, with the length: enough to deduplicate texts inside the store.
  function fingerprint(value) {
    const str = String(value);
    let hash = 0x811c9dc5;
    for (let index = 0; index < str.length; index += 1) {
      hash ^= str.charCodeAt(index);
      hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    return `t${str.length.toString(36)}-${hash.toString(36)}`;
  }

  function createRun({ runId, pipelineName = '', task = '', steps = [], startedAt = Date.now() } = {}) {
    const texts = {};
    const put = (value) => {
      if (value == null || value === '') return null;
      const ref = fingerprint(value);
      texts[ref] = String(value);
      return ref;
    };
    return {
      version: 2, runId: String(runId || ''), pipelineName: String(pipelineName || ''), startedAt, finishedAt: null,
      stopReason: '', taskRef: put(task), steps: steps.map((step, index) => ({ index, ref: step.ref || '', kind: step.kind, models: (step.models || []).map((model) => (typeof model === 'string' ? model : model.name)) })),
      attempts: [], artifacts: [], snapshot: null, texts, put
    };
  }

  const itemOf = (put) => (item) => ({ label: item.label || '', source: item.source || null, textRef: put(item.text) });

  function storedParts(put, parts = {}) {
    if (parts.correction) return { correction: { reason: parts.correction.reason || '', textRef: put(parts.correction.text) } };
    const instructions = parts.instructions || {};
    const input = parts.input || {};
    return {
      instructions: {
        taskRef: put(instructions.task), stepTaskRef: put(instructions.stepTask), extraRef: put(instructions.extra),
        askInstructionRef: put(instructions.askInstruction),
        ownerAnswers: (instructions.ownerAnswers || []).map((item) => ({ question: item.question || '', answer: item.answer || '' }))
      },
      input: { mode: input.mode || 'none', items: (input.items || []).map(itemOf(put)), earlier: (input.earlier || []).map(itemOf(put)) }
    };
  }

  // The key of an attempt (8.2): its step, participant, visit, attempt number and phase. Two visits of one step, or a route
  // and an answer of one visit, are different attempts. An entry without these fields (a plain step) keys by its index and model.
  const attemptKey = (entry) => JSON.stringify([entry.ref ?? `#${entry.step}`, entry.participant ?? entry.model, entry.visit ?? 1, entry.attempt, entry.phase ?? 'answer']);

  // Called when an attempt is sent and again when it finished; the same attempt object is updated
  // in place until it is done, never after.
  function recordAttempt(record, entry) {
    const key = attemptKey(entry);
    let attempt = record.attempts.find((item) => item.key === key);
    if (attempt && attempt.state !== 'sent') return attempt;
    if (!attempt) {
      attempt = {
        key, step: entry.step, ref: entry.ref ?? null, participant: entry.participant ?? entry.model, visit: entry.visit ?? 1, phase: entry.phase ?? 'answer',
        label: entry.label || '', kind: entry.kind || '', model: entry.model, attempt: entry.attempt,
        retryOf: entry.retryOf || null, promptRef: record.put(entry.prompt), parts: storedParts(record.put, entry.parts),
        state: 'sent', sentAt: entry.sentAt || Date.now()
      };
      record.attempts.push(attempt);
    }
    if (entry.state === 'not_sent') {
      // The transport refused before sending (the budget): nothing left the extension, the reason is kept.
      Object.assign(attempt, { state: 'not_sent', finishedAt: entry.finishedAt || Date.now(), reason: entry.reason || '' });
    }
    if (entry.state === 'done') {
      Object.assign(attempt, {
        state: 'done', finishedAt: entry.finishedAt || Date.now(), sentPromptRef: record.put(entry.sentPrompt),
        answerRef: record.put(entry.answer), attribution: entry.attribution || '', accepted: Boolean(entry.accepted),
        reason: entry.reason || '', status: entry.status || '', transportRequestId: entry.transportRequestId || ''
      });
    }
    return attempt;
  }

  function finishRun(record, { stopReason = '', finishedAt = Date.now() } = {}) {
    record.stopReason = stopReason;
    record.finishedAt = finishedAt;
    return record;
  }

  // Every reference to a text is a field whose name ends with "Ref" (taskRef, answerRef, textRef, promptRef, ...). They are
  // all marked, so that the cleanup of texts never removes what the registry, the snapshot or the attempts still name.
  function collectRefs(value, used) {
    if (Array.isArray(value)) { value.forEach((item) => collectRefs(item, used)); return used; }
    if (!value || typeof value !== 'object') return used;
    Object.entries(value).forEach(([key, item]) => {
      if (/Ref$/.test(key) && typeof item === 'string' && item) used.add(item);
      else collectRefs(item, used);
    });
    return used;
  }

  // The stored form: only texts that are still referenced.
  function serialize(record) {
    const { put, texts: allTexts, ...rest } = record;
    const used = collectRefs(rest, new Set());
    const texts = Object.fromEntries(Object.entries(allTexts).filter(([ref]) => used.has(ref)));
    return { ...rest, texts };
  }

  // Back from storage: history only. An attempt that never finished has an unknown outcome.
  function revive(stored) {
    if (!stored || typeof stored !== 'object') return null;
    const record = { ...stored, version: stored.version || 1, texts: { ...(stored.texts || {}) }, attempts: (stored.attempts || []).map((item) => ({ ...item })),
      artifacts: (stored.artifacts || []).map((item) => ({ ...item })) };
    record.put = (value) => {
      if (value == null || value === '') return null;
      const ref = fingerprint(value);
      record.texts[ref] = String(value);
      return ref;
    };
    record.attempts.forEach((attempt) => { if (attempt.state === 'sent') attempt.state = 'unknown'; });
    return record;
  }

  const textOf = (record, ref) => (ref ? record.texts?.[ref] ?? '' : '');

  // A snapshot of the state of the run (8.2) as plain data: the schema as the run was started with, the pointer, the visits,
  // the position of the current step, the finished results (their accepted answers by text reference), the decisions taken,
  // the routes, the counters, the stack, the feedback (text references), the dependencies and the owner's answers. The registry is record.artifacts (5.3), not a second copy here. chatBindings stays empty until chats are supported.
  const copyOf = (value) => (value === undefined ? null : JSON.parse(JSON.stringify(value)));
  // The chats of the participants are an object by participantId; a list (an old snapshot) and no value are an empty object.
  const plainOf = (value) => (value && typeof value === 'object' && !Array.isArray(value) ? copyOf(value) : {});
  function setSnapshot(record, { schema = [], runSettings = {}, state = {}, current = null, routes = [], ownerAnswers = [], pendingOwner = null } = {}) {
    const visits = state.visits || {};
    record.snapshot = copyOf({
      schema, taskRef: record.taskRef, runSettings, pc: state.pc ?? null, visits,
      current: current || state.current || { stepRef: state.pc ?? null, visit: visits[state.pc] || 0, phase: 'done', accepted: [], pending: [] },
      results: state.results || [], decisions: state.decisions || {},
      routes, loopCounters: state.loopCounters || {}, continuationStack: state.continuationStack || [], feedback: state.feedback || {},
      dependencies: state.dependencies || {}, ownerAnswers, pendingOwner, chatBindings: plainOf(state.chatBindings)
    });
    return record.snapshot;
  }
  // The registry of the run: the entries of the engine's result, each with its answer reference (plain data).
  function setArtifacts(record, entries = []) {
    record.artifacts = copyOf(entries) || [];
    return record.artifacts;
  }
  // A run can be resumed only from its own snapshot: version 1 records and runs without a checkpoint cannot.
  const canResume = (record) => (record.version || 1) >= 2 && Boolean(record.snapshot);

  // A self-contained JSON with all texts resolved, for export.
  function exportRun(record) {
    const resolve = (item) => ({ label: item.label, source: item.source, text: textOf(record, item.textRef) });
    const snapshot = record.snapshot ? { ...record.snapshot, feedback: Object.fromEntries(Object.entries(record.snapshot.feedback || {})
      .map(([key, items]) => [key, items.map((item) => ({ label: item.label, source: item.source, pointer: item.pointer ?? '', text: textOf(record, item.textRef) }))])) } : null;
    return {
      version: record.version || 1, resumable: canResume(record),
      runId: record.runId, pipelineName: record.pipelineName, startedAt: record.startedAt, finishedAt: record.finishedAt,
      stopReason: record.stopReason, task: textOf(record, record.taskRef), steps: record.steps,
      artifacts: (record.artifacts || []).map((entry) => ({ id: entry.id, name: entry.name, lineage: entry.lineage, source: entry.source, valid: entry.valid,
        inputs: entry.inputs, pointer: entry.content?.pointer ?? '', text: textOf(record, entry.content?.answerRef) })),
      snapshot,
      attempts: record.attempts.map((attempt) => {
        const parts = attempt.parts || {};
        return {
          step: attempt.step, label: attempt.label, model: attempt.model, attempt: attempt.attempt, retryOf: attempt.retryOf,
          state: attempt.state, accepted: attempt.accepted, reason: attempt.reason, status: attempt.status,
          attribution: attempt.attribution, transportRequestId: attempt.transportRequestId, sentAt: attempt.sentAt, finishedAt: attempt.finishedAt,
          instructions: parts.correction ? { correction: textOf(record, parts.correction.textRef) } : {
            task: textOf(record, parts.instructions?.taskRef), stepTask: textOf(record, parts.instructions?.stepTaskRef),
            extra: textOf(record, parts.instructions?.extraRef), askInstruction: textOf(record, parts.instructions?.askInstructionRef),
            ownerAnswers: parts.instructions?.ownerAnswers || []
          },
          input: parts.input ? { mode: parts.input.mode, items: parts.input.items.map(resolve), earlier: parts.input.earlier.map(resolve) } : null,
          prompt: textOf(record, attempt.promptRef), sentPrompt: textOf(record, attempt.sentPromptRef), answer: textOf(record, attempt.answerRef)
        };
      })
    };
  }

  const bytesOf = (value) => {
    const json = JSON.stringify(value);
    return typeof TextEncoder === 'function' ? new TextEncoder().encode(json).length : json.length * 2;
  };

  // storage: { get(key) → Promise<value>, set(key, value) → Promise, remove(key) → Promise }.
  function createStore({ storage, maxBytes = DEFAULT_MAX_BYTES } = {}) {
    if (!storage) throw new Error('custom_run_record_storage_required');
    const readIndex = async () => {
      const index = await storage.get(INDEX_KEY);
      return Array.isArray(index) ? index : [];
    };
    // Saves a run; then removes whole oldest runs until the records fit. The run being saved is
    // never removed, even when it alone is over the limit.
    async function save(record) {
      const stored = serialize(record);
      const bytes = bytesOf(stored);
      await storage.set(`${RUN_KEY_PREFIX}${record.runId}`, stored);
      const index = (await readIndex()).filter((item) => item.runId !== record.runId);
      index.push({ runId: record.runId, pipelineName: record.pipelineName, startedAt: record.startedAt, bytes });
      index.sort((a, b) => a.startedAt - b.startedAt);
      let total = index.reduce((sum, item) => sum + item.bytes, 0);
      const removed = [];
      while (total > maxBytes && index.length > 1 && index[0].runId !== record.runId) {
        const oldest = index.shift();
        total -= oldest.bytes;
        removed.push(oldest.runId);
        await storage.remove(`${RUN_KEY_PREFIX}${oldest.runId}`);
      }
      await storage.set(INDEX_KEY, index);
      return { bytes, total, removed };
    }
    async function load(runId) {
      return revive(await storage.get(`${RUN_KEY_PREFIX}${runId}`));
    }
    async function latest(pipelineName) {
      const index = await readIndex();
      const match = index.filter((item) => item.pipelineName === pipelineName).sort((a, b) => b.startedAt - a.startedAt)[0];
      return match ? load(match.runId) : null;
    }
    return { save, load, latest, list: readIndex };
  }

  // chrome.storage.local as the storage interface of createStore. A callback reports a failure through
  // chrome.runtime.lastError: the promise is rejected with it (a synchronous throw of the area rejects too), so a failed
  // write never looks saved.
  function chromeStorage(area) {
    const call = (method, args) => new Promise((resolve, reject) => {
      area[method](...args, (result) => {
        const error = root.chrome?.runtime?.lastError;
        if (error) reject(new Error(error.message || String(error)));
        else resolve(result);
      });
    });
    return {
      get: (key) => call('get', [key]).then((result) => result?.[key]),
      set: (key, value) => call('set', [{ [key]: value }]).then(() => undefined),
      remove: (key) => call('remove', [key]).then(() => undefined)
    };
  }

  const api = Object.freeze({ DEFAULT_MAX_BYTES, INDEX_KEY, RUN_KEY_PREFIX, fingerprint, createRun, recordAttempt, attemptKey, finishRun, serialize, revive, textOf, setSnapshot, setArtifacts, canResume, exportRun, createStore, chromeStorage });
  root.CustomRunRecord = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
