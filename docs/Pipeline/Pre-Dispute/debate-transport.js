// Chrome-extension transport port for Debate orchestration.
(function initDebateTransport(root) {
  'use strict';

  const createChromeSender = (runtime) => (payload) => new Promise((resolve, reject) => {
    if (!runtime?.sendMessage) {
      reject(new Error('chrome_runtime_unavailable'));
      return;
    }
    runtime.sendMessage(payload, (response) => {
      const lastError = typeof chrome !== 'undefined' ? chrome.runtime?.lastError : null;
      if (lastError) reject(new Error(lastError.message));
      else resolve(response);
    });
  });

  function create({ runtime = root.chrome?.runtime, storage = root.chrome?.storage?.local, runStore = null, transportPolicy = root.TransportPolicy } = {}) {
    const send = createChromeSender(runtime);
    const storageKey = root.DebateRunStore?.STORAGE_KEY || 'llmCodexDebateRun.v1';
    let persistChain = Promise.resolve();
    let pendingState = null;
    let drainScheduled = false;

    const persist = (state = runStore?.getState?.()) => {
      if (!storage?.set || !state || !root.DebateRunStore?.serialize) return Promise.resolve(false);
      pendingState = state;
      if (drainScheduled) return persistChain;
      drainScheduled = true;
      persistChain = persistChain.catch(() => {}).then(async () => {
        let persisted = false;
        while (pendingState) {
          const latest = pendingState;
          pendingState = null;
          const serialized = root.DebateRunStore.serialize(latest);
          try {
            await storage.set({ [storageKey]: serialized });
            persisted = true;
          } catch (_) {
            persisted = false;
          }
        }
        drainScheduled = false;
        return persisted;
      });
      return persistChain;
    };

    const unsubscribe = runStore?.subscribe?.((state) => { void persist(state); }) || (() => {});

    return Object.freeze({
      dispatchBatch({ prompt, promptsByModel = null, models = [], attachments = [], forceNewTabs = true, useApiFallback = true, sourceView = 'pipeline', pipelineContext = null } = {}) {
        const sanitized = transportPolicy?.sanitizePromptsByModel
          ? transportPolicy.sanitizePromptsByModel(promptsByModel)
          : promptsByModel;
        return send({
          type: 'START_FULLPAGE_PROCESS',
          prompt,
          promptsByModel: sanitized,
          selectedLLMs: models,
          attachments,
          forceNewTabs,
          useApiFallback,
          sourceView,
          pipelineContext
        });
      },
      cancelRun(pipelineRunId) {
        return send({ type: 'CANCEL_PIPELINE_RUN', pipelineRunId });
      },
      notifyControl(event) {
        return send({ type: 'PIPELINE_FSM_EVENT', event });
      },
      readExecutionState() {
        return send({ type: 'GET_ACTIVE_RUN_STATE' });
      },
      async recoverRun() {
        if (!storage?.get || !root.DebateRunStore?.hydrate) return null;
        try {
          const data = await storage.get(storageKey);
          const raw = data?.[storageKey];
          return raw ? root.DebateRunStore.hydrate(raw) : null;
        } catch (_) {
          return null;
        }
      },
      clearRecovery() {
        return storage?.remove ? storage.remove(storageKey) : Promise.resolve();
      },
      persist,
      dispose: unsubscribe
    });
  }

  const api = Object.freeze({ create });
  root.DebateTransport = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
