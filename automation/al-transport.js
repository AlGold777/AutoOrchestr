// Automation Lab — dispatch bridge to the existing extension Web transport.
// The Automation Layer never touches provider DOM: it asks the background runtime to run a batch
// (START_FULLPAGE_PROCESS, API fallback disabled) and consumes the terminal transport results the
// background already broadcasts to the dispatching page. Correlation is by model within one
// in-flight batch plus the random CALL/ATTEMPT tokens that the parser requires in the answer.
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
    let activeRunId = null;
    const listeners = new Set();

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

    function settle(model, result) {
      const entry = pending.get(model);
      if (!entry) return;
      pending.delete(model);
      const settled = { ...result, durationMs: Date.now() - entry.started };
      try { entry.onResult?.(model, settled); } catch (_) { /* consumer errors never block settlement */ }
      entry.resolve(settled);
    }

    function onMessage(message) {
      if (!message || !RESPONSE_TYPES.has(message.type)) return;
      const entry = pending.get(message.llmName);
      if (!entry) return;
      const text = answerText(message);
      const metadata = message.metadata || message.meta || {};
      const status = String(message.status || metadata.status || metadata.finalStatus || '').toUpperCase();
      const terminal = message.type !== 'LLM_PARTIAL_RESPONSE' || metadata.isFinal === true || metadata.terminal === true || TERMINAL.has(status);
      // A frame carrying another call/attempt token is a stale answer from an earlier batch.
      const foreignFrame = /PAF_RESPONSE_BEGIN\s+\S+\s+\S+/.test(text) && !text.includes(entry.tokens.attemptToken);
      if (foreignFrame) return;
      if (text) entry.latestText = text;
      listeners.forEach((listener) => listener({ model: message.llmName, status, terminal, chars: text.length }));
      if (!terminal) {
        entry.lastProgressAt = Date.now();
        return;
      }
      const complete = text && Parser.hasCompleteFrame(text, entry.tokens);
      const ok = Boolean(text) && (SUCCESS.has(status) || status === '' || complete);
      const requestId = message.requestId || metadata.requestId || metadata.dispatchId || '';
      settle(message.llmName, ok
        ? { ok: true, text, status: status || 'FINAL', sourceMessageId: `${message.llmName}:${requestId}:${Canonical.sha256Hex(text).slice(0, 24)}` }
        : { ok: false, status: status || 'FAILED', error: status || 'TERMINAL_FAILURE', errorMessage: metadata.reason || metadata.failureClass || 'terminal failure without usable text', text });
    }
    runtime.onMessage.addListener(onMessage);

    async function waitForIdleBackground() {
      const deadline = Date.now() + guardMaxMs;
      while (Date.now() < deadline) {
        const state = await send({ type: 'GET_ACTIVE_RUN_STATE' });
        if (!state?.roundsInProgress) return true;
        await sleep(guardPollMs);
      }
      return false;
    }

    async function dispatch({ calls, freshConversation, timeoutMs = 600000, context = {}, onResult }) {
      const results = {};
      const promises = calls.map((call) => new Promise((resolve) => {
        pending.set(call.model, { resolve, onResult, started: Date.now(), tokens: call.tokens, latestText: '', lastProgressAt: Date.now() });
      }).then((result) => { results[call.model] = result; }));

      await waitForIdleBackground();
      let response = null;
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
        await sleep(1500);
      }
      activeRunId = context.pipelineRunId || null;
      if (!response || response.status !== 'process_started') {
        const code = response?.errorCode || response?.error || 'DISPATCH_REJECTED';
        calls.forEach((call) => settle(call.model, { ok: false, status: 'NOT_STARTED', error: code, errorMessage: `background did not start the batch (${code})` }));
        await Promise.all(promises);
        return results;
      }

      const timer = setTimeout(() => {
        [...pending.entries()].forEach(([model, entry]) => {
          if (!calls.some((call) => call.model === model)) return;
          const complete = entry.latestText && Parser.hasCompleteFrame(entry.latestText, entry.tokens);
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
      if (activeRunId) await send({ type: 'CANCEL_PIPELINE_RUN', pipelineRunId: activeRunId });
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
