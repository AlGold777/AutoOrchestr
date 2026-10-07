// The record of a Custom run: every attempt of every model, as it really went — instructions and
// input apart, input with its sources, the prompt as dispatched by the transport, the answer and the
// outcome. An attempt is never rewritten: a retry is a new attempt that refers to the one it follows.
// Every text is stored once under its fingerprint; attempts hold references (the input of one step
// is the answers of another). Storage is bounded by size: whole oldest runs are removed first.
// A record read back after a reload is history only: an attempt that was sent but never finished is
// marked "unknown" and is never re-sent from here.
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
      version: 1, runId: String(runId || ''), pipelineName: String(pipelineName || ''), startedAt, finishedAt: null,
      stopReason: '', taskRef: put(task), steps: steps.map((step, index) => ({ index, ref: step.ref || '', kind: step.kind, models: (step.models || []).map((model) => (typeof model === 'string' ? model : model.name)) })),
      attempts: [], texts, put
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

  // Called when an attempt is sent and again when it finished; the same attempt object is updated
  // in place until it is done, never after.
  function recordAttempt(record, entry) {
    const key = `${entry.step}|${entry.model}|${entry.attempt}`;
    let attempt = record.attempts.find((item) => item.key === key);
    if (attempt && attempt.state !== 'sent') return attempt;
    if (!attempt) {
      attempt = {
        key, step: entry.step, label: entry.label || '', kind: entry.kind || '', model: entry.model, attempt: entry.attempt,
        retryOf: entry.retryOf || null, promptRef: record.put(entry.prompt), parts: storedParts(record.put, entry.parts),
        state: 'sent', sentAt: entry.sentAt || Date.now()
      };
      record.attempts.push(attempt);
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

  // The stored form: only texts that are still referenced.
  function serialize(record) {
    const used = new Set([record.taskRef]);
    const mark = (ref) => { if (ref) used.add(ref); };
    record.attempts.forEach((attempt) => {
      [attempt.promptRef, attempt.sentPromptRef, attempt.answerRef].forEach(mark);
      const parts = attempt.parts || {};
      if (parts.correction) mark(parts.correction.textRef);
      Object.values(parts.instructions || {}).forEach((value) => { if (typeof value === 'string') mark(value); });
      [...(parts.input?.items || []), ...(parts.input?.earlier || [])].forEach((item) => mark(item.textRef));
    });
    const texts = Object.fromEntries(Object.entries(record.texts).filter(([ref]) => used.has(ref)));
    const { put, ...rest } = record;
    return { ...rest, texts };
  }

  // Back from storage: history only. An attempt that never finished has an unknown outcome.
  function revive(stored) {
    if (!stored || typeof stored !== 'object') return null;
    const record = { ...stored, texts: { ...(stored.texts || {}) }, attempts: (stored.attempts || []).map((item) => ({ ...item })) };
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

  // A self-contained JSON with all texts resolved, for export.
  function exportRun(record) {
    const resolve = (item) => ({ label: item.label, source: item.source, text: textOf(record, item.textRef) });
    return {
      runId: record.runId, pipelineName: record.pipelineName, startedAt: record.startedAt, finishedAt: record.finishedAt,
      stopReason: record.stopReason, task: textOf(record, record.taskRef), steps: record.steps,
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

  // chrome.storage.local as the storage interface of createStore.
  function chromeStorage(area) {
    return {
      get: (key) => new Promise((resolve) => area.get(key, (result) => resolve(result?.[key]))),
      set: (key, value) => new Promise((resolve) => area.set({ [key]: value }, () => resolve())),
      remove: (key) => new Promise((resolve) => area.remove(key, () => resolve()))
    };
  }

  const api = Object.freeze({ DEFAULT_MAX_BYTES, INDEX_KEY, RUN_KEY_PREFIX, fingerprint, createRun, recordAttempt, finishRun, serialize, revive, textOf, exportRun, createStore, chromeStorage });
  root.CustomRunRecord = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
