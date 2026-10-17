// Focused background handlers for Debate/Pipeline control messages.
(function initPipelineMessageHandlers(root) {
  'use strict';

  async function persistControl({ jobState, nextControl, saveJobState, chromeApi, fsm }) {
    if (!nextControl) return;
    jobState.session = jobState.session || {};
    jobState.session.pipelineControl = nextControl;
    jobState.session.pipelineRunId = nextControl.pipelineRunId || jobState.session.pipelineRunId || null;
    jobState.session.pipelineState = nextControl.state || jobState.session.pipelineState || 'IDLE';
    jobState.session.pipelineStage = nextControl.stage || jobState.session.pipelineStage || null;
    jobState.session.pipelineRoundId = nextControl.round || jobState.session.pipelineRoundId || null;
    saveJobState(jobState);
    try {
      if (chromeApi?.storage?.session?.set && fsm?.STORAGE_KEY) {
        await chromeApi.storage.session.set({ [fsm.STORAGE_KEY]: nextControl });
      }
    } catch (_) {}
  }

  async function cancelPipelineRun(message, deps) {
    const { jobState, sendResponse, stopAllProcesses, saveJobState, chromeApi, fsm } = deps;
    const requestedRunId = message.pipelineRunId || null;
    const currentRunId = jobState?.session?.pipelineRunId || jobState?.session?.pipelineControl?.pipelineRunId || null;
    if (requestedRunId && currentRunId && requestedRunId !== currentRunId) {
      sendResponse({ success: true, ignored: true, reason: 'stale_pipeline_run', pipelineRunId: requestedRunId, currentRunId });
      return;
    }
    const pipelineRunId = requestedRunId || currentRunId || null;
    await chromeApi.storage.local.set({
      global_command: { action: 'STOP_ALL', timestamp: Date.now(), pipelineRunId, reason: 'cancel_pipeline_run' }
    });
    if (fsm?.cancelRun) {
      const control = jobState?.session?.pipelineControl
        || fsm.createState?.({ pipelineRunId, sessionId: jobState?.session?.startTime || null })
        || { pipelineRunId };
      const nextControl = fsm.cancelRun(control, { pipelineRunId, reason: 'cancel_pipeline_run', stage: 'cancelled' });
      await persistControl({ jobState, nextControl, saveJobState, chromeApi, fsm });
    }
    // A cancelled run keeps no chat bindings (R01); its chats stay open for the user.
    await self.clearParticipantRun?.(pipelineRunId);
    stopAllProcesses('cancel_pipeline_run', { closeTabs: false });
    sendResponse({ success: true, pipelineRunId });
  }

  async function pipelineFsmEvent(message, deps) {
    const { jobState, sendResponse, saveJobState, chromeApi, fsm } = deps;
    try {
      const event = message.event && typeof message.event === 'object' ? { ...message.event } : {};
      const currentControl = jobState?.session?.pipelineControl || fsm?.normalizeControlState?.({
        pipelineRunId: jobState?.session?.pipelineRunId || null,
        sessionId: jobState?.session?.startTime || null,
        state: jobState?.session?.pipelineState || 'IDLE',
        stage: jobState?.session?.pipelineStage || null,
        round: jobState?.session?.pipelineRoundId || null
      });
      const nextControl = fsm?.transition ? fsm.transition(currentControl, event) : currentControl;
      await persistControl({ jobState, nextControl, saveJobState, chromeApi, fsm });
      sendResponse({ success: true, state: nextControl?.state || null, pipelineRunId: nextControl?.pipelineRunId || null });
    } catch (err) {
      sendResponse({ success: false, error: err?.message || String(err) });
    }
  }

  // The chats of the participants of one run as they are bound now (R01): the page writes them into its snapshot.
  function participantBindings(message, { sendResponse }) {
    const bindings = self.participantChatBindingsOf?.(message.pipelineRunId || null) || {};
    sendResponse({ success: true, pipelineRunId: message.pipelineRunId || null, bindings });
  }

  // N04: the read-only check of a request whose sending is not confirmed. Never a send; a chat that cannot be read is not a success.
  async function checkParticipantAnswerMessage(message, { sendResponse }) {
    const result = await self.checkParticipantAnswer?.({
      llmName: message.modelName,
      runId: message.pipelineRunId || null,
      participantId: message.participantId,
      transportRequestId: message.transportRequestId || null,
      tabId: message.tabId ?? null,
      excludeText: typeof message.excludeText === 'string' ? message.excludeText : ''
    }).catch((err) => ({ ok: false, status: 'chat_unavailable', reason: String(err?.message || err) }))
      || { ok: false, status: 'chat_unavailable', reason: 'check_unavailable' };
    sendResponse({ success: true, ...result });
  }

  function handle(message, deps) {
    if (message?.type === 'CHECK_PARTICIPANT_ANSWER') {
      void checkParticipantAnswerMessage(message, deps);
      return true;
    }
    if (message?.type === 'PARTICIPANT_CHAT_BINDINGS') {
      participantBindings(message, deps);
      return true;
    }
    if (message?.type === 'CANCEL_PIPELINE_RUN') {
      void cancelPipelineRun(message, deps);
      return true;
    }
    if (message?.type === 'PIPELINE_FSM_EVENT') {
      void pipelineFsmEvent(message, deps);
      return true;
    }
    return false;
  }

  const api = Object.freeze({ handle, cancelPipelineRun, pipelineFsmEvent });
  root.PipelineMessageHandlers = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof self !== 'undefined' ? self : globalThis);
