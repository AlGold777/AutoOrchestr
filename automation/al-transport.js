// Automation Lab — dispatch bridge to the existing extension Web transport.
// The Automation Layer never touches provider DOM: it asks the background runtime to run a batch
// (START_FULLPAGE_PROCESS, API fallback disabled) and consumes the terminal transport results the
// background routes back to this tab (sourceView "automation"). Correlation is by model within one
// in-flight batch plus the random CALL/ATTEMPT tokens that the parser requires in the answer.
// Every observable transport fact is reported through `onEvent` so the diagnostics journal can
// explain afterwards what happened to each model (tab opened? prompt sent? text streamed?).
(function initAlTransport(root) {
  'use strict';

  const Canonical = root.AlCanonical || require('./al-canonical.js');
  const Parser = root.AlResponseParser || require('./al-response-parser.js');

  const RESPONSE_TYPES = new Set(['LLM_PARTIAL_RESPONSE', 'LLM_FINAL_RESPONSE', 'FINAL_LLM_RESPONSE']);
  const SUCCESS = new Set(['SUCCESS', 'DONE', 'FINAL', 'COPY_SUCCESS', 'PARTIAL', 'STREAM_TIMEOUT_HIDDEN']);
  const TERMINAL = new Set([...SUCCESS, 'STREAM_TIMEOUT', 'ERROR', 'NO_SEND', 'EXTRACT_FAILED', 'TIMEOUT', 'FAILED', 'CANCELLED', 'STOPPED']);
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  const answerText = (message) => {
    const answer = message.answer;
    if (answer && typeof answer === 'object') return String(answer.text || answer.answer || '');
    return String(answer || '');
  };

  function createChromeTransport({ runtime = root.chrome?.runtime, guardPollMs = 750, guardMaxMs = 45000, busyRetries = 20 } = {}) {
    if (!runtime?.sendMessage) throw new Error('CHROME_RUNTIME_UNAVAILABLE');
    const pending = new Map();
    const listeners = new Set();
    let active = null; // { runId, onEvent, models:Set, lastStatus:Map, lastTabs }

    const send = (payload) => new Promise((resolve) => {
      try {
        runtime.sendMessage(payload, (response) => {
          const error = root.chrome?.runtime?.lastError;
          resolve(error ? { success: false, error: error.message } : response);
        });
      } catch (error) {
        resolve({ success: false, error: error.message });
      }
    });

    const emit = (event) => {
      try { active?.onEvent?.({ at: new Date().toISOString(), ...event }); } catch (_) { /* journal errors never affect transport */ }
    };

    function settle(model, result) {
      const entry = pending.get(model);
      if (!entry) return;
      pending.delete(model);
      const settled = { ...result, durationMs: Date.now() - entry.started };
      try { entry.onResult?.(model, settled); } catch (_) { /* consumer errors never block settlement */ }
      entry.resolve(settled);
    }

    function observeGlobalState(message) {
      if (!active) return;
      const tabs = message.state?.tabs?.map || {};
      const llms = message.state?.llms || {};
      const view = {};
      active.models.forEach((model) => {
        view[model] = { tab: Number.isInteger(tabs[model]) ? tabs[model] : null, status: llms[model]?.status || null };
      });
      const key = JSON.stringify(view);
      if (key === active.lastTabs) return;
      active.lastTabs = key;
      emit({ kind: 'TABS', models: view });
    }

    function onMessage(message) {
      if (!message) return;
      // Messages of a Debate/Pipeline run are not ours.
      if (message.sourceView && message.sourceView !== 'automation') return;
      if (message.type === 'GLOBAL_STATE_BROADCAST') { observeGlobalState(message); return; }
      if (message.type === 'STATUS_UPDATE' && active?.models.has(message.llmName)) {
        const status = String(message.status || '').toUpperCase();
        if (status && active.lastStatus.get(message.llmName) !== status) {
          active.lastStatus.set(message.llmName, status);
          emit({ kind: 'MODEL_STATUS', model: message.llmName, status });
          listeners.forEach((listener) => listener({ model: message.llmName, status, terminal: false, chars: pending.get(message.llmName)?.latestText.length || 0 }));
        }
        return;
      }
      if (!RESPONSE_TYPES.has(message.type)) return;
      const entry = pending.get(message.llmName);
      if (!entry) return;
      const text = answerText(message);
      const metadata = message.metadata || message.meta || {};
      const status = String(message.status || metadata.status || metadata.finalStatus || '').toUpperCase();
      const terminal = message.type !== 'LLM_PARTIAL_RESPONSE' || metadata.isFinal === true || metadata.terminal === true || TERMINAL.has(status);
      // A frame carrying another call/attempt token is a stale answer from an earlier batch.
      const foreignFrame = /PAF_RESPONSE_BEGIN\s+\S+\s+\S+/.test(text) && !text.includes(entry.tokens.attemptToken);
      if (foreignFrame) {
        if (!entry.staleReported) { entry.staleReported = true; emit({ kind: 'STALE_FRAME_IGNORED', model: message.llmName, chars: text.length }); }
        return;
      }
      if (text && !entry.latestText) emit({ kind: 'MODEL_FIRST_TEXT', model: message.llmName, chars: text.length, afterMs: Date.now() - entry.started });
      if (text) entry.latestText = text;
      listeners.forEach((listener) => listener({ model: message.llmName, status, terminal, chars: text.length }));
      if (!terminal) return;
      const complete = Boolean(text) && Parser.hasCompleteFrame(text, entry.tokens);
      const ok = Boolean(text) && (SUCCESS.has(status) || status === '' || complete);
      const requestId = message.requestId || metadata.requestId || metadata.dispatchId || '';
      emit({ kind: 'MODEL_TERMINAL', model: message.llmName, status: status || 'FINAL', chars: text.length, frameComplete: complete, ok, reason: metadata.reason || metadata.failureClass || null });
      settle(message.llmName, ok
        ? { ok: true, text, status: status || 'FINAL', sourceMessageId: `${message.llmName}:${requestId}:${Canonical.sha256Hex(text).slice(0, 24)}` }
        : { ok: false, status: status || 'FAILED', error: status || 'TERMINAL_FAILURE', errorMessage: metadata.reason || metadata.failureClass || 'terminal failure without usable text', text });
    }
    runtime.onMessage.addListener(onMessage);

    async function waitForIdleBackground() {
      const started = Date.now();
      const deadline = started + guardMaxMs;
      let reported = false;
      while (Date.now() < deadline) {
        const state = await send({ type: 'GET_ACTIVE_RUN_STATE' });
        if (!state?.roundsInProgress) {
          if (reported) emit({ kind: 'BACKGROUND_IDLE', waitedMs: Date.now() - started });
          return true;
        }
        if (!reported) { reported = true; emit({ kind: 'BACKGROUND_BUSY', detail: 'another run is still in progress; waiting' }); }
        await sleep(guardPollMs);
      }
      emit({ kind: 'BACKGROUND_BUSY_TIMEOUT', waitedMs: Date.now() - started });
      return false;
    }

    async function dispatch({ calls, freshConversation, timeoutMs = 600000, context = {}, onResult, onEvent }) {
      const results = {};
      active = { runId: context.pipelineRunId || null, onEvent, models: new Set(calls.map((call) => call.model)), lastStatus: new Map(), lastTabs: null };
      const promises = calls.map((call) => new Promise((resolve) => {
        pending.set(call.model, { resolve, onResult, started: Date.now(), tokens: call.tokens, latestText: '' });
      }).then((result) => { results[call.model] = result; }));

      await waitForIdleBackground();
      let response = null;
      let busy = 0;
      emit({ kind: 'DISPATCH_SENT', models: calls.map((call) => call.model), freshConversation: Boolean(freshConversation), promptChars: Object.fromEntries(calls.map((call) => [call.model, call.prompt.length])) });
      for (let attempt = 0; attempt <= busyRetries; attempt += 1) {
        response = await send({
          type: 'START_FULLPAGE_PROCESS',
          prompt: calls[0].prompt,
          promptsByModel: Object.fromEntries(calls.map((call) => [call.model, call.prompt])),
          selectedLLMs: calls.map((call) => call.model),
          attachments: [],
          forceNewTabs: Boolean(freshConversation),
          useApiFallback: false,
          sourceView: 'automation',
          pipelineContext: { ...context, sourceView: 'automation' }
        });
        if (response?.errorCode !== 'RUN_ALREADY_ACTIVE') break;
        busy += 1;
        await sleep(1500);
      }
      if (!response || response.status !== 'process_started') {
        const code = response?.errorCode || response?.error || 'DISPATCH_REJECTED';
        emit({ kind: 'DISPATCH_REJECTED', code, busyRetries: busy });
        calls.forEach((call) => settle(call.model, { ok: false, status: 'NOT_STARTED', error: code, errorMessage: `background did not start the batch (${code})` }));
        await Promise.all(promises);
        return results;
      }
      emit({ kind: 'DISPATCH_STARTED', busyRetries: busy });

      const timer = setTimeout(() => {
        [...pending.entries()].forEach(([model, entry]) => {
          if (!calls.some((call) => call.model === model)) return;
          const complete = Boolean(entry.latestText) && Parser.hasCompleteFrame(entry.latestText, entry.tokens);
          emit({ kind: 'MODEL_TIMEOUT', model, chars: entry.latestText.length, frameComplete: complete, timeoutMs });
          settle(model, complete
            ? { ok: true, text: entry.latestText, status: 'TIMEOUT_FRAME_COMPLETE', sourceMessageId: `${model}:timeout:${Canonical.sha256Hex(entry.latestText).slice(0, 24)}` }
            : { ok: false, status: 'TIMEOUT', error: 'TIMEOUT', errorMessage: `no terminal response in ${Math.round(timeoutMs / 1000)}s`, text: entry.latestText });
        });
      }, timeoutMs);
      await Promise.all(promises);
      clearTimeout(timer);
      return results;
    }

    async function cancel() {
      if (active?.runId) await send({ type: 'CANCEL_PIPELINE_RUN', pipelineRunId: active.runId });
      if (pending.size) emit({ kind: 'CANCELLED', models: [...pending.keys()] });
      [...pending.keys()].forEach((model) => settle(model, { ok: false, cancelled: true, status: 'CANCELLED', error: 'CANCELLED' }));
    }

    return Object.freeze({
      kind: 'chrome',
      dispatch,
      cancel,
      onProgress: (listener) => { listeners.add(listener); return () => listeners.delete(listener); },
      dispose: () => runtime.onMessage.removeListener?.(onMessage)
    });
  }

  const api = Object.freeze({ createChromeTransport });
  root.AlTransport = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
