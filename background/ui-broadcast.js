// background/ui-broadcast.js
// Results tab messaging and global state broadcast helpers.

'use strict';

function buildGlobalStateSnapshot(options = {}) {
  const includeAnswers = options?.includeAnswers === true;
  const llms = {};
  Object.entries(jobState?.llms || {}).forEach(([name, entry]) => {
    const mappedTabId = TabMapManager.get(name);
    const modelRunState = entry?.modelRunState || (self.ModelRunState?.deriveModelRunState
      ? self.ModelRunState.deriveModelRunState({ ...(entry || {}), llmName: name })
      : null);
    if (entry && modelRunState && !entry.modelRunState) {
      entry.modelRunState = modelRunState;
    }
    const statusContract = self.LLMStatusContract?.deriveStatusContract
      ? self.LLMStatusContract.deriveStatusContract(entry || {})
      : null;
    const finalStatus = modelRunState?.terminalStatus || statusContract?.finalStatus || (entry?.finalStatusRecorded && entry?.finalStatus ? entry.finalStatus : null);
    llms[name] = {
      status: modelRunState?.uiStatus || statusContract?.uiStatus || finalStatus || entry?.status || 'UNKNOWN',
      liveStatus: modelRunState?.liveStatus || statusContract?.liveStatus || entry?.status || 'UNKNOWN',
      finalStatus,
      finalStatusRecorded: !!entry?.finalStatusRecorded,
      executionState: modelRunState?.executionState || statusContract?.executionState || null,
      generationState: modelRunState?.generationState || null,
      extractionState: modelRunState?.extractionState || null,
      verificationState: modelRunState?.verificationState || entry?.answerVerification?.state || null,
      answerState: modelRunState?.answerState || statusContract?.answerState || null,
      attributionState: entry?.attributionState || entry?.unverifiedArtifact?.attributionState || null,
      terminalState: modelRunState?.terminalState || null,
      statusRank: statusContract?.rank || 0,
      statusData: entry?.statusData || null,
      modelRunState,
      answerVerification: entry?.answerVerification || null,
      stageTimeline: Array.isArray(entry?.stageTimeline) ? entry.stageTimeline.slice(-30) : [],
      answerRevisions: Array.isArray(entry?.answerRevisions) ? entry.answerRevisions.slice(-12) : [],
      hasAnswer: !!entry?.answer,
      // Recovery payload: STATUS_UPDATE and LLM_PARTIAL_RESPONSE are separate MV3
      // messages. If the latter is missed while the results page is reloading, the
      // next global-state broadcast must be able to hydrate the empty card instead
      // of restoring only a green status indicator.
      ...(includeAnswers ? {
        answer: String(entry?.answer || ''),
        answerHtml: String(entry?.answerHtml || ''),
        unverifiedArtifact: entry?.unverifiedArtifact ? {
          text: String(entry.unverifiedArtifact.text || ''),
          html: String(entry.unverifiedArtifact.html || ''),
          capturedAt: entry.unverifiedArtifact.capturedAt || null,
          source: entry.unverifiedArtifact.source || null,
          dispatchId: entry.unverifiedArtifact.dispatchId || null,
          completenessState: entry.unverifiedArtifact.completenessState || null,
          attributionState: entry.unverifiedArtifact.attributionState || 'unproven',
          reason: entry.unverifiedArtifact.reason || null
        } : null
      } : {}),
      tabId: entry?.tabId || mappedTabId || null,
      humanVisits: entry?.humanVisits || 0,
      messageSent: !!entry?.messageSent
    };
  });
  const tabsMap = {};
  TabMapManager.entries().forEach(([name, tabId]) => { tabsMap[name] = tabId; });
  return {
    llms,
    runMetrics: self.ModelRunState?.buildRunMetrics ? self.ModelRunState.buildRunMetrics(jobState || {}) : null,
    tabs: { map: tabsMap },
    ui: { resultsTabId },
    timestamp: Date.now()
  };
}

function broadcastGlobalState() {
  const state = buildGlobalStateSnapshot();
  TabMapManager.entries().forEach(([llmName, tabId]) => {
    if (!isValidTabId(tabId)) return;
    chrome.tabs.sendMessage(tabId, { type: 'GLOBAL_STATE_BROADCAST', state }).catch(() => {});
  });
  if (isValidTabId(resultsTabId)) {
    const resultsState = buildGlobalStateSnapshot({ includeAnswers: true });
    chrome.tabs.sendMessage(resultsTabId, { type: 'GLOBAL_STATE_BROADCAST', state: resultsState }).catch(() => {});
  }
}

function sendMessageToResultsTab(message) {
  const isNoReceiverError = (errorMessage = '') =>
    errorMessage.toLowerCase().includes('receiving end does not exist');

  const fallbackToRuntime = () => {
    chrome.runtime.sendMessage(message, () => {
      if (chrome.runtime.lastError) {
        const { message: errorMessage } = chrome.runtime.lastError;
        if (isNoReceiverError(errorMessage)) {
          console.warn('[BACKGROUND] Runtime broadcast skipped - no active results view:', message.type);
        } else {
          console.error('[BACKGROUND] Runtime broadcast to results failed:', errorMessage);
        }
      } else {
        globalThis.LLMLog?.debug?.('[BACKGROUND] Message broadcast via runtime:', message.type);
      }
    });
  };

  if (!resultsTabId) {
    console.warn('[BACKGROUND] Results tab ID not set, using runtime broadcast');
    fallbackToRuntime();
    return;
  }

  chrome.tabs.sendMessage(resultsTabId, message, () => {
    if (chrome.runtime.lastError) {
      console.warn('[BACKGROUND] tabs.sendMessage to results failed:', chrome.runtime.lastError.message);
      resultsTabId = null;
      fallbackToRuntime();
    } else {
      globalThis.LLMLog?.debug?.('[BACKGROUND] Message sent to results tab:', message.type);
    }
  });
}

function focusResultsTab() {
  if (!isValidTabId(resultsTabId)) return;
  chrome.tabs.get(resultsTabId, (tab) => {
    if (chrome.runtime.lastError || !tab) return;
    chrome.windows.update(tab.windowId, { focused: true }, () => {
      if (chrome.runtime.lastError) {
        console.warn('[BACKGROUND] Failed to focus results window:', chrome.runtime.lastError.message);
      }
      chrome.tabs.update(resultsTabId, { active: true });
    });
  });
}

self.buildGlobalStateSnapshot = buildGlobalStateSnapshot;
self.broadcastGlobalState = broadcastGlobalState;
self.sendMessageToResultsTab = sendMessageToResultsTab;
self.focusResultsTab = focusResultsTab;

globalThis.LLMLog?.debug?.('[UiBroadcast] Module loaded');
