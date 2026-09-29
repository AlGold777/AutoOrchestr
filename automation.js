(() => {
  'use strict';

  const Core = globalThis.AutomationLayerCore;
  if (!Core) throw new Error('AutomationLayerCore is not loaded');

  const STORAGE_KEY = 'automationLayerWebRuntimeTest.v5';
  const PHASE = Object.freeze({
    IDLE: 'IDLE',
    ROUND1_DISPATCHING: 'ROUND 1 · DISPATCHING',
    ROUND1_RUNNING: 'ROUND 1 · RUNNING',
    ROUND1_COMPLETE: 'ROUND 1 · COMPLETE',
    ROUND2_DISPATCHING: 'ROUND 2 · DISPATCHING',
    ROUND2_RUNNING: 'ROUND 2 · RUNNING',
    COMPLETED: 'COMPLETED',
    ERROR: 'ERROR',
    CANCELLED: 'CANCELLED'
  });
  const ACTIVE_PHASES = new Set([
    PHASE.ROUND1_DISPATCHING,
    PHASE.ROUND1_RUNNING,
    PHASE.ROUND1_COMPLETE,
    PHASE.ROUND2_DISPATCHING,
    PHASE.ROUND2_RUNNING
  ]);

  const ui = {};
  let state = null;
  let transitionBusy = false;
  let reconcileBusy = false;
  let recoveryTimer = null;

  document.addEventListener('DOMContentLoaded', init);

  async function init() {
    bindUi();
    bindEvents();
    state = await loadState();
    render();
    chrome.storage.onChanged.addListener(onStorageChanged);
    chrome.runtime.onMessage.addListener(onRuntimeMessage);
    if (state && ACTIVE_PHASES.has(state.phase)) {
      await resumeRun();
    }
  }

  function bindUi() {
    ui.prompt = document.getElementById('prompt');
    ui.send = document.getElementById('send-button');
    ui.modelControls = Array.from(document.querySelectorAll('input[name="llm"]'));
    ui.cancel = document.getElementById('automation-cancel');
    ui.downloadResult = document.getElementById('automation-download-result');
    ui.downloadAudit = document.getElementById('automation-download-audit');
    ui.feed = resolveExistingFeed();
    ui.diagnostics = document.getElementById('automation-diagnostics-log');
    ui.resultsModal = document.getElementById('automation-results-modal');
    ui.resultsBody = document.getElementById('automation-results-body');
    ui.resultsClose = document.getElementById('automation-results-close');
    ui.modelAName = document.getElementById('automation-model-a-name');
    ui.modelBName = document.getElementById('automation-model-b-name');
    ui.modelAFeed = document.getElementById('automation-model-a-feed');
    ui.modelBFeed = document.getElementById('automation-model-b-feed');
    ui.modelARequest = document.getElementById('automation-model-a-request');
    ui.modelBRequest = document.getElementById('automation-model-b-request');

    const missing = ['prompt', 'send', 'cancel', 'downloadResult', 'downloadAudit', 'feed', 'diagnostics', 'resultsModal', 'resultsBody', 'resultsClose']
      .filter((name) => !ui[name]);
    if (missing.length) throw new Error(`automation_ui_missing: ${missing.join(', ')}`);
  }

  function resolveExistingFeed() {
    return document.querySelector(
      '[data-automation-feed], #automation-feed, .automation-feed, .messages-feed, .message-feed'
    );
  }

  function bindEvents() {
    ui.send.addEventListener('click', onSendClick);
    ui.modelControls.forEach((control) => control.addEventListener('change', () => {
      if (control.checked) {
        const checked = ui.modelControls.filter((item) => item.checked);
        if (checked.length > 2) {
          const replace = checked.find((item) => item !== control);
          if (replace) replace.checked = false;
        }
      }
      renderModelHeaders();
    }));
    ui.cancel.addEventListener('click', () => cancelRun().catch(reportFatal));
    ui.downloadResult.addEventListener('click', showResults);
    ui.downloadAudit.addEventListener('click', () => downloadAudit().catch(showError));
    ui.resultsClose.addEventListener('click', hideResults);
    ui.resultsModal.addEventListener('click', (event) => {
      if (event.target === ui.resultsModal) hideResults();
    });
  }

  async function onSendClick(event) {
    event.preventDefault();
    if (state && ACTIVE_PHASES.has(state.phase)) {
      showError('Automation run is already active.');
      return;
    }
    try {
      await startRun();
    } catch (error) {
      await reportFatal(error);
    }
  }

  async function startRun() {
    const originalPrompt = String(ui.prompt.value || '').trim();
    if (!originalPrompt) throw new Error('Enter a prompt.');

    const selected = Core.selectedModelsFromValues(
      ui.modelControls.filter((control) => control.checked).map((control) => control.value)
    );
    if (selected.length !== 2) throw new Error('Select exactly two models.');

    const active = await runtimeMessage({ type: 'GET_ACTIVE_RUN_STATE' }, 8000);
    if (active?.active) {
      throw new Error('Another MyOrchestrator run is active. Finish or stop it before starting Automation.');
    }

    const runId = createRunId();
    const originalPromptHash = await sha256(originalPrompt);
    const ideaRef = Core.makeIdeaRef(runId);
    const registry = Core.createRegistry([{
      id: ideaRef.id,
      type: ideaRef.type,
      version: ideaRef.version,
      content: originalPrompt,
      content_hash: originalPromptHash,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      source_refs: []
    }]);
    state = {
      schemaVersion: 5,
      productVersion: Core.PRODUCT_VERSION,
      controllerVersion: Core.VERSION,
      architecture: 'event-driven-controller-over-existing-myorchestrator-runtime',
      runId,
      phase: PHASE.ROUND1_DISPATCHING,
      startedAt: new Date().toISOString(),
      completedAt: null,
      originalPrompt,
      originalPromptHash,
      ideaRef,
      registry,
      acceptedMessageIds: [],
      models: selected,
      synthesisInstruction: Core.DEFAULT_SYNTHESIS_INSTRUCTION,
      rounds: {
        '1': { snapshotId: Core.inputSnapshotId(runId, 1), snapshotHash: null, contextAudit: [], promptHash: null, sessionId: null, dispatchedAt: null, recoveryCount: 0, recoveryRequestedAt: null, answers: {}, terminalKeys: [] },
        '2': { snapshotId: Core.inputSnapshotId(runId, 2), snapshotHash: null, contextAudit: [], promptHash: null, sessionId: null, dispatchedAt: null, recoveryCount: 0, recoveryRequestedAt: null, answers: {}, terminalKeys: [] }
      },
      feed: [],
      journal: [],
      exportState: { resultDownloadedAt: null, auditDownloadedAt: null }
    };

    addModeratorMessage(originalPrompt);
    addSystemMessage('Round 1 started', 1);
    addJournal('RUN_CREATED', {
      models: selected,
      ideaRef: state.ideaRef,
      originalPromptHash: state.originalPromptHash
    });
    ui.prompt.value = '';
    await persist();
    render();

    await dispatchRound(1, await prepareRoundPrompt(1));
  }

  async function prepareRoundPrompt(round) {
    if (!state) throw new Error('missing_automation_state');
    const roundState = state.rounds[String(round)];
    const inputRefs = Core.expectedInputRefs(round, state.models, state.ideaRef);
    const semanticSnapshot = Core.buildRoundSemanticSnapshot({
      round,
      originalPrompt: state.originalPrompt,
      models: state.models,
      ideaRef: state.ideaRef,
      registry: state.registry,
      answers: state.rounds['1'].answers
    });
    const snapshotHash = 'sha256:' + await sha256(Core.stableStringify(semanticSnapshot));
    roundState.snapshotHash = snapshotHash;

    const common = {
      originalPrompt: state.originalPrompt,
      inputRefs,
      snapshotId: roundState.snapshotId,
      snapshotHash,
      registry: state.registry,
      budgetPolicy: Core.CONTEXT_POLICY
    };
    const built = round === 1
      ? Core.buildRoundOnePackage(common)
      : Core.buildRoundTwoPackage({
          ...common,
          modelOrder: state.models,
          answers: state.rounds['1'].answers,
          instruction: state.synthesisInstruction
        });

    if (built.overflow) throw new Error('CONTEXT_BUDGET_EXCEEDED_PROTECTED');
    roundState.contextAudit = state.models.map((model) => Core.buildContextAssemblyAudit({
      runId: state.runId,
      round,
      model,
      snapshotId: roundState.snapshotId,
      snapshotHash,
      inputRefs,
      assembly: built,
      promptHash: null,
      truncations: built.truncations || []
    }));
    return built.prompt;
  }

  async function dispatchRound(round, prompt) {
    if (!state) return;
    await waitForBackgroundIdle(60000);

    const roundKey = String(round);
    const phaseDispatch = round === 1 ? PHASE.ROUND1_DISPATCHING : PHASE.ROUND2_DISPATCHING;
    const phaseRunning = round === 1 ? PHASE.ROUND1_RUNNING : PHASE.ROUND2_RUNNING;

    state.phase = phaseDispatch;
    state.rounds[roundKey].sentPrompt = prompt;
    state.rounds[roundKey].promptHash = await sha256(prompt);
    (state.rounds[roundKey].contextAudit || []).forEach((entry) => {
      entry.prompt_hash = state.rounds[roundKey].promptHash;
    });
    showTransientModelRequests(prompt);
    addJournal('ROUND_DISPATCH_INTENT', {
      round,
      promptHash: state.rounds[roundKey].promptHash,
      models: state.models.slice()
    });
    await persist();
    render();

    const response = await runtimeMessage({
      type: 'START_FULLPAGE_PROCESS',
      prompt,
      selectedLLMs: state.models,
      forceNewTabs: true,
      useApiFallback: false,
      sourceView: 'automation',
      pipelineContext: {
        sourceView: 'automation',
        pipelineRunId: Core.stageRunId(state.runId, round),
        automationRunId: state.runId,
        automationRound: round,
        automationSnapshotId: state.rounds[roundKey].snapshotId,
        automationSnapshotHash: state.rounds[roundKey].snapshotHash,
        automationControllerVersion: Core.VERSION,
        automationIdeaRef: state.ideaRef,
        automationModels: state.models.slice()
      }
    }, 60000);

    if (response?.success === false || (response?.status && response.status !== 'process_started')) {
      throw new Error(`Round ${round} dispatch failed: ${response?.errorCode || response?.error || response?.status || 'unknown'}`);
    }

    state.phase = phaseRunning;
    state.rounds[roundKey].dispatchedAt = Date.now();
    clearTransientModelRequestsSoon();
    addJournal('ROUND_DISPATCH_ACCEPTED', { round });
    await persist();
    render();
    scheduleFinalizationRecovery(round);

    await reconcileJobState(await readJobState());
  }

  async function onStorageChanged(changes, areaName) {
    if (areaName !== 'local' || !changes.jobState || !state || !ACTIVE_PHASES.has(state.phase)) return;
    await reconcileJobState(await readJobState());
  }

  function onRuntimeMessage(message) {
    if (!state || !ACTIVE_PHASES.has(state.phase)) return;
    if (message?.type !== 'GLOBAL_STATE_BROADCAST') return;
    void message;
  }

  async function reconcileJobState(jobState) {
    if (reconcileBusy || !state || !ACTIVE_PHASES.has(state.phase)) return;
    const round = activeRoundNumber();
    if (!round || !Core.matchingJobState(jobState, state.runId, round)) return;

    reconcileBusy = true;
    try {
      const roundState = state.rounds[String(round)];
      if (!roundState.sessionId && jobState?.session?.startTime) {
        roundState.sessionId = jobState.session.startTime;
        addJournal('ROUND_SESSION_BOUND', { round, sessionId: roundState.sessionId });
      }

      const events = Core.collectNewTerminalEvents({
        jobState,
        runId: state.runId,
        round,
        models: state.models,
        seenKeys: new Set(roundState.terminalKeys || [])
      });

      let terminalFailure = null;
      for (const event of events) {
        roundState.terminalKeys.push(event.key);
        if (event.success) {
          const normalized = Core.canonicalizeProviderText(event.answer);
          const rawAnswerHash = await sha256(event.answer);
          const normalizedAnswerHash = await sha256(normalized.text);
          const sourceMessageId = Core.deriveSourceMessageId({
            providerMessageId: event.sourceMessageId,
            pipelineRunId: Core.stageRunId(state.runId, round),
            model: event.model,
            dispatchId: event.dispatchId,
            payloadHash: normalizedAnswerHash
          });
          if ((state.acceptedMessageIds || []).includes(sourceMessageId)) {
            addJournal('MODEL_DUPLICATE_IGNORED', { round, model: event.model, sourceMessageId });
            continue;
          }

          const parsed = Core.validateStructuredAnswer(
            normalized.text,
            round === 1 ? 'ROUND_1' : 'ROUND_2',
            Core.expectedInputRefs(round, state.models, state.ideaRef),
            roundState.snapshotId,
            roundState.snapshotHash
          );
          if (!parsed.ok) {
            addFailureMessage({ ...event, status: 'STRUCTURE_INVALID', reason: parsed.reason });
            addJournal('MODEL_STRUCTURE_REJECTED', {
              round,
              model: event.model,
              reason: parsed.reason,
              answerHash: rawAnswerHash,
              normalizedAnswerHash,
              canonicalizationActions: normalized.actions
            });
            terminalFailure = { ...event, status: 'STRUCTURE_INVALID', reason: parsed.reason };
            continue;
          }

          const contextCopy = Core.compactStructuredForContext(parsed.structure, Core.CONTEXT_POLICY);
          const runtimeMeta = {
            run_id: state.runId,
            model: event.model,
            round,
            prompt_hash: roundState.promptHash,
            input_snapshot_id: roundState.snapshotId,
            input_snapshot_hash: roundState.snapshotHash,
            payload_hash: rawAnswerHash,
            normalized_payload_hash: normalizedAnswerHash,
            source_message_id: sourceMessageId
          };
          roundState.answers[event.model] = {
            text: parsed.content,
            raw: event.answer,
            raw_provider_response: event.answer,
            normalized_provider_response: normalized.text,
            canonicalization_actions: normalized.actions,
            structure: parsed.structure,
            canonical_structure: parsed.structure,
            context_structure: contextCopy.structure,
            truncations: contextCopy.truncations,
            sourceMessageId,
            runtime: runtimeMeta,
            structureSummary: parsed.summary,
            acceptedAt: new Date(event.finalizedAt).toISOString(),
            finalizedAt: event.finalizedAt,
            dispatchId: event.dispatchId,
            requestId: event.requestId,
            source: event.source
          };
          state.acceptedMessageIds.push(sourceMessageId);
          if (round === 1) {
            const resultRef = Core.priorOutputRef(event.model);
            Core.registryUpsert(state.registry, {
              id: resultRef.id,
              type: resultRef.type,
              version: resultRef.version,
              content: parsed.structure,
              content_hash: normalizedAnswerHash,
              created_at: new Date(event.finalizedAt).toISOString(),
              updated_at: new Date(event.finalizedAt).toISOString(),
              source_refs: Core.expectedInputRefs(round, state.models, state.ideaRef).map((ref) => ref.id)
            });
          }
          addModelMessage(event, parsed, runtimeMeta);
          addJournal('MODEL_ANSWER_ACCEPTED', {
            round,
            model: event.model,
            finalizedAt: event.finalizedAt,
            dispatchId: event.dispatchId,
            contract: parsed.summary.contract,
            annotations: parsed.summary.annotations,
            answerHash: rawAnswerHash
          });
        } else {
          addFailureMessage(event);
          addJournal('MODEL_TERMINAL_FAILURE', {
            round,
            model: event.model,
            finalizedAt: event.finalizedAt,
            status: event.status,
            reason: event.reason,
            dispatchId: event.dispatchId
          });
          terminalFailure = event;
        }
      }

      await persist();
      render();

      if (terminalFailure) {
        await failRun(
          `${terminalFailure.model} ended with ${terminalFailure.status}${terminalFailure.reason ? `: ${terminalFailure.reason}` : ''}`
        );
        return;
      }

      if (state.models.every((model) => Boolean(roundState.answers?.[model]?.structure))) {
        if (round === 1) {
          await completeRoundOne();
        } else {
          await completeRun();
        }
      }
    } finally {
      reconcileBusy = false;
    }
  }

  async function completeRoundOne() {
    if (transitionBusy || !state || state.phase === PHASE.ROUND1_COMPLETE || activeRoundNumber() !== 1) return;
    transitionBusy = true;
    try {
      state.phase = PHASE.ROUND1_COMPLETE;
      addSystemMessage('Round 1 completed', 1);
      addJournal('ROUND_COMPLETED', { round: 1, models: state.models.slice() });
      await persist();
      render();

      const roundTwoPrompt = await prepareRoundPrompt(2);

      addSystemMessage('Round 2 started', 2);
      await persist();
      render();
      await dispatchRound(2, roundTwoPrompt);
    } catch (error) {
      await reportFatal(error);
    } finally {
      transitionBusy = false;
    }
  }

  async function completeRun() {
    if (transitionBusy || !state || state.phase === PHASE.COMPLETED) return;
    transitionBusy = true;
    try {
      if (recoveryTimer) clearTimeout(recoveryTimer);
    state.phase = PHASE.COMPLETED;
      state.completedAt = new Date().toISOString();
      addSystemMessage('Run completed', 2);
      addJournal('RUN_COMPLETED', { completedAt: state.completedAt });
      await persist();
      render();
    } catch (error) {
      await failRun(`Export failed: ${error?.message || String(error)}`);
    } finally {
      transitionBusy = false;
    }
  }

  async function failRun(reason) {
    if (!state) return;
    if (recoveryTimer) clearTimeout(recoveryTimer);
    state.phase = PHASE.ERROR;
    state.completedAt = new Date().toISOString();
    addSystemMessage(`Run failed\n${reason}`, activeRoundNumber(), 'error');
    addJournal('RUN_FAILED', { reason });
    await persist();
    render();
  }

  async function cancelRun() {
    if (!state || !ACTIVE_PHASES.has(state.phase)) return;
    if (recoveryTimer) clearTimeout(recoveryTimer);
    await runtimeMessage({ type: 'STOP_ALL', platforms: state.models }, 10000).catch(() => null);
    state.phase = PHASE.CANCELLED;
    state.completedAt = new Date().toISOString();
    addSystemMessage('Run cancelled', activeRoundNumber());
    addJournal('RUN_CANCELLED', {});
    await persist();
    render();
  }

  async function resumeRun() {
    const jobState = await readJobState();
    const round = activeRoundNumber();

    if (round && Core.matchingJobState(jobState, state.runId, round)) {
      await reconcileJobState(jobState);
      return;
    }

    if (state.phase === PHASE.ROUND1_COMPLETE) {
      const roundTwoPrompt = await prepareRoundPrompt(2);
      addSystemMessage('Round 2 resumed after page reload', 2);
      await persist();
      await dispatchRound(2, roundTwoPrompt);
      return;
    }

    if (state.phase === PHASE.ROUND1_DISPATCHING || state.phase === PHASE.ROUND2_DISPATCHING) {
      await sleep(1800);
      const retryJobState = await readJobState();
      const retryRound = activeRoundNumber();
      if (retryRound && Core.matchingJobState(retryJobState, state.runId, retryRound)) {
        state.phase = retryRound === 1 ? PHASE.ROUND1_RUNNING : PHASE.ROUND2_RUNNING;
        await persist();
        render();
        await reconcileJobState(retryJobState);
        return;
      }

      const active = await runtimeMessage({ type: 'GET_ACTIVE_RUN_STATE' }, 8000).catch(() => null);
      const ctx = active?.pipelineContext || {};
      if (active?.active && String(ctx.automationRunId || '') === state.runId && Number(ctx.automationRound || 0) === retryRound) {
        state.phase = retryRound === 1 ? PHASE.ROUND1_RUNNING : PHASE.ROUND2_RUNNING;
        await persist();
        render();
        return;
      }

      if (!active?.active) {
        const prompt = await prepareRoundPrompt(retryRound);
        addJournal('DISPATCH_RECOVERY_RETRY', { round: retryRound });
        await persist();
        await dispatchRound(retryRound, prompt);
        return;
      }
    }

    if (state.phase === PHASE.ROUND1_RUNNING || state.phase === PHASE.ROUND2_RUNNING) {
      const active = await runtimeMessage({ type: 'GET_ACTIVE_RUN_STATE' }, 8000).catch(() => null);
      const ctx = active?.pipelineContext || {};
      const expectedRound = activeRoundNumber();
      if (active?.active && String(ctx.automationRunId || '') === state.runId && Number(ctx.automationRound || 0) === expectedRound) {
        return;
      }
      await failRun('Automation state could not be reconciled with the background runtime after reload.');
    }
  }

  function activeRoundNumber() {
    if (!state) return null;
    if ([PHASE.ROUND1_DISPATCHING, PHASE.ROUND1_RUNNING, PHASE.ROUND1_COMPLETE].includes(state.phase)) return 1;
    if ([PHASE.ROUND2_DISPATCHING, PHASE.ROUND2_RUNNING].includes(state.phase)) return 2;
    return null;
  }

  function addModeratorMessage(text) {
    state.feed.push({
      id: createEventId('moderator'),
      type: 'moderator',
      timestamp: Date.now(),
      model: 'Moderator',
      round: null,
      status: null,
      text: String(text || '')
    });
    sortFeed();
  }

  function showTransientModelRequests(prompt) {
    if (ui.modelARequest) ui.modelARequest.value = prompt;
    if (ui.modelBRequest) ui.modelBRequest.value = prompt;
  }

  function clearTransientModelRequestsSoon() {
    setTimeout(() => {
      if (ui.modelARequest) ui.modelARequest.value = '';
      if (ui.modelBRequest) ui.modelBRequest.value = '';
    }, 1800);
  }

  function addModelMessage(event, parsed, runtimeMeta) {
    state.feed.push({
      id: createEventId('answer'),
      type: 'model',
      timestamp: event.finalizedAt,
      model: event.model,
      round: event.round,
      status: 'ACCEPTED',
      text: parsed.content || (parsed.structure?.completion?.empty_by_design ? 'Empty by design' : ''),
      structure: parsed.structure,
      runtime: runtimeMeta,
      structureSummary: parsed.summary
    });
    sortFeed();
  }

  function addFailureMessage(event) {
    state.feed.push({
      id: createEventId('failure'),
      type: 'model',
      severity: 'error',
      timestamp: event.finalizedAt,
      model: event.model,
      round: event.round,
      status: event.status || 'ERROR',
      text: event.reason || 'Model run failed.'
    });
    sortFeed();
  }

  function addSystemMessage(text, round, severity) {
    state.feed.push({
      id: createEventId('system'),
      type: 'system',
      severity: severity || 'info',
      timestamp: Date.now(),
      model: 'SYSTEM',
      round: round || null,
      status: null,
      text: String(text || '')
    });
    sortFeed();
  }

  function sortFeed() {
    state.feed.sort((a, b) => {
      if (a.timestamp !== b.timestamp) return Number(a.timestamp) - Number(b.timestamp);
      return String(a.id).localeCompare(String(b.id));
    });
  }

  function addJournal(type, payload) {
    state.journal.push({
      seq: state.journal.length + 1,
      at: new Date().toISOString(),
      type,
      payload: payload || {}
    });
  }

  function scheduleFinalizationRecovery(round, delayMs = 60000) {
    if (recoveryTimer) clearTimeout(recoveryTimer);
    recoveryTimer = setTimeout(() => {
      runFinalizationRecovery(round).catch(reportFatal);
    }, delayMs);
  }

  async function runFinalizationRecovery(round) {
    if (!state) return;
    const expectedPhase = round === 1 ? PHASE.ROUND1_RUNNING : PHASE.ROUND2_RUNNING;
    if (state.phase !== expectedPhase) return;

    const roundState = state.rounds[String(round)];
    const pending = state.models.filter((model) => !roundState.answers?.[model]?.structure);
    if (!pending.length || Number(roundState.recoveryCount || 0) >= 1) return;

    roundState.recoveryCount = Number(roundState.recoveryCount || 0) + 1;
    roundState.recoveryRequestedAt = Date.now();
    addJournal('FINALIZATION_RECOVERY_REQUESTED', { round, models: pending.slice() });
    addSystemMessage(`Finalization recovery · ${pending.join(', ')}`, round);
    await persist();
    render();

    const result = await runtimeMessage({
      type: 'GET_IT_BATCH',
      llmNames: pending,
      failedOnly: true
    }, 150000).catch((error) => ({ status: 'get_it_failed', error: error?.message || String(error) }));

    addJournal('FINALIZATION_RECOVERY_RESULT', {
      round,
      status: result?.status || null,
      error: result?.error || null
    });
    await persist();

    setTimeout(async () => {
      if (!state || state.phase !== expectedPhase) return;
      const pendingAfter = state.models.filter((model) => !state.rounds[String(round)].answers?.[model]?.structure);
      if (pendingAfter.length) {
        await failRun(`Finalization stalled after recovery: ${pendingAfter.join(', ')}`);
      }
    }, 60000);
  }

  async function waitForBackgroundIdle(timeoutMs) {
    const deadline = Date.now() + Number(timeoutMs || 60000);
    while (Date.now() < deadline) {
      const active = await runtimeMessage({ type: 'GET_ACTIVE_RUN_STATE' }, 8000).catch(() => null);
      if (!active?.active) return;
      const ctx = active?.pipelineContext || {};
      if (
        state
        && String(ctx.automationRunId || '') === state.runId
        && Number(ctx.automationRound || 0) === 1
        && state.phase === PHASE.ROUND1_COMPLETE
      ) {
        await sleep(500);
        continue;
      }
      await sleep(700);
    }
    throw new Error('Background runtime did not become idle before the next automation stage.');
  }

  function hasResults() {
    if (!state?.rounds) return false;
    return ['1', '2'].some((round) => Object.keys(state.rounds?.[round]?.answers || {}).length > 0);
  }

  function showResults() {
    if (!state || !hasResults()) return;
    ui.resultsBody.textContent = Core.buildResultText(state);
    ui.resultsModal.hidden = false;
  }

  function hideResults() {
    ui.resultsModal.hidden = true;
  }

  async function downloadResult() {
    if (!state) return;
    const text = Core.buildResultText(state);
    await downloadBlob(
      `automation-${safeFilePart(state.runId)}-result.txt`,
      text,
      'text/plain;charset=utf-8'
    );
    state.exportState.resultDownloadedAt = new Date().toISOString();
    addJournal('RESULT_EXPORTED', { filename: `automation-${safeFilePart(state.runId)}-result.txt` });
  }

  async function downloadAudit() {
    if (!state) return;
    const audit = Core.buildAuditObject(state);
    await downloadBlob(
      `automation-${safeFilePart(state.runId)}-audit.json`,
      JSON.stringify(audit, null, 2),
      'application/json;charset=utf-8'
    );
    state.exportState.auditDownloadedAt = new Date().toISOString();
    addJournal('AUDIT_EXPORTED', { filename: `automation-${safeFilePart(state.runId)}-audit.json` });
  }

  async function downloadBlob(filename, text, mimeType) {
    const blob = new Blob([text], { type: mimeType });
    const url = URL.createObjectURL(blob);
    try {
      await new Promise((resolve, reject) => {
        chrome.downloads.download({ url, filename, saveAs: false }, (downloadId) => {
          if (chrome.runtime.lastError || !downloadId) {
            reject(new Error(chrome.runtime.lastError?.message || 'download_failed'));
            return;
          }
          resolve(downloadId);
        });
      });
    } finally {
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    }
  }

  async function readJobState() {
    if (globalThis.CompressedStorage?.get) {
      return await globalThis.CompressedStorage.get('jobState');
    }
    const raw = await chrome.storage.local.get('jobState');
    const value = raw?.jobState || null;
    if (typeof value === 'string' && value.startsWith('__LZ__')) {
      throw new Error('Compressed jobState cannot be decoded: CompressedStorage is unavailable.');
    }
    return value;
  }

  async function persist() {
    if (!state) return;
    await chrome.storage.local.set({ [STORAGE_KEY]: state });
  }

  async function loadState() {
    const data = await chrome.storage.local.get(STORAGE_KEY);
    return data?.[STORAGE_KEY] || null;
  }

  function render() {
    const active = Boolean(state && ACTIVE_PHASES.has(state.phase));
    ui.send.disabled = active;
    ui.cancel.disabled = !active;
    ui.downloadResult.disabled = !hasResults();
    ui.downloadAudit.disabled = !state;
    ui.modelControls.forEach((control) => { control.disabled = active; });

    renderModelHeaders();
    renderFeed();
    renderModelLanes();
    renderDiagnostics();
  }

  function selectedOrStateModels() {
    if (state?.models?.length === 2 && ACTIVE_PHASES.has(state.phase)) return state.models.slice();
    const selected = Core.selectedModelsFromValues(
      ui.modelControls.filter((control) => control.checked).map((control) => control.value)
    ).slice(0, 2);
    if (selected.length === 2) return selected;
    return state?.models?.length === 2 ? state.models.slice() : selected;
  }

  function renderModelHeaders() {
    ui.modelControls.forEach((control) => {
      const visual = control.closest('.model-nav-button');
      if (visual) visual.classList.toggle('is-active', control.checked);
    });
    const models = selectedOrStateModels();
    if (ui.modelAName) ui.modelAName.textContent = models[0] || 'Model A';
    if (ui.modelBName) ui.modelBName.textContent = models[1] || 'Model B';
  }

  function renderStructureCompact(container, answer) {
    if (!answer?.structure) return;
    const s = answer.structure;
    const box = document.createElement('div');
    box.className = 'automation-structure-compact';
    const rows = [
      ['Snapshot', s.passport?.input_snapshot_id || '—'],
      ['Snapshot hash', s.passport?.input_snapshot_hash || '—'],
      ['Inputs', (s.passport?.input_refs || []).map((r) => `${r.id} · ${r.type} · v${r.version}`).join(' · ') || '—'],
      ['Output', (s.outputs || []).map((o) => `${o.id} · ${o.type} · v${o.version}`).join(', ') || '—'],
      ['Annotations', (s.annotations || []).map((a) => a.type).join(', ') || '—'],
      ['Trace', (s.trace || []).flatMap((t) => t.source_ids || []).join(', ') || '—'],
      ['Input fate', (s.input_fate || []).map((f) => `${f.input_id} → ${f.disposition}`).join(' · ') || '—'],
      ['Changes', (s.changes || []).map((ch) => {
        const target = ch.temp_id || ch.target_id || ch.object_type || '';
        return [ch.op, ch.object_type, target].filter(Boolean).join(' · ');
      }).join(' · ') || '—'],
      ['Completion', `${s.completion?.status || '—'} · ${s.completion?.output_count ?? 0} output${Number(s.completion?.output_count || 0) === 1 ? '' : 's'}`]
    ];
    rows.forEach(([label, value]) => {
      const row = document.createElement('div');
      row.className = 'automation-structure-row';
      const k = document.createElement('span');
      k.textContent = label;
      const v = document.createElement('span');
      v.textContent = value;
      row.append(k, v);
      box.appendChild(row);
    });
    container.appendChild(box);
  }

  function appendLaneMessage(container, role, text, cssClass) {
    const item = document.createElement('div');
    item.className = `automation-lane-message ${cssClass || ''}`;
    const who = document.createElement('div');
    who.className = 'automation-lane-role';
    who.textContent = role;
    const body = document.createElement('div');
    body.className = 'automation-lane-body';
    body.textContent = text || '';
    item.append(who, body);
    container.appendChild(item);
    return item;
  }

  function renderModelLane(container, model) {
    if (!container) return;
    container.textContent = '';
    if (!state || !model) return;
    [1, 2].forEach((round) => {
      const roundState = state.rounds?.[String(round)];
      const answer = roundState?.answers?.[model];
      if (!roundState?.sentPrompt && !answer) return;

      const section = document.createElement('section');
      section.className = 'automation-round-section';
      const title = document.createElement('div');
      title.className = 'automation-round-title';
      title.textContent = `Round ${round}`;
      section.appendChild(title);

      if (roundState?.sentPrompt) {
        appendLaneMessage(section, 'Moderator', roundState.sentPrompt, 'moderator');
      }
      if (answer) {
        const message = appendLaneMessage(
          section,
          model,
          answer.text || (answer.structure?.completion?.empty_by_design ? 'Empty by design' : ''),
          'model'
        );
        renderStructureCompact(message, answer);
      }
      container.appendChild(section);
    });
    container.scrollTop = container.scrollHeight;
  }

  function renderModelLanes() {
    const models = selectedOrStateModels();
    renderModelLane(ui.modelAFeed, models[0]);
    renderModelLane(ui.modelBFeed, models[1]);
  }

  function renderFeed() {
    ui.feed.textContent = '';
    const feed = state?.feed || [];

    const moderator = feed.find((item) => item.type === 'moderator');
    if (moderator) appendLaneMessage(ui.feed, 'Moderator', moderator.text, 'moderator');

    [1, 2].forEach((round) => {
      const roundItems = feed.filter((item) => item.type === 'model' && Number(item.round) === round);
      if (!roundItems.length) return;
      const section = document.createElement('section');
      section.className = 'automation-round-section';
      const title = document.createElement('div');
      title.className = 'automation-round-title';
      title.textContent = `Round ${round}`;
      section.appendChild(title);

      roundItems.forEach((item) => {
        const message = appendLaneMessage(section, item.model, item.text, item.severity === 'error' ? 'error' : 'model');
        if (item.structure) {
          renderStructureCompact(message, { structure: item.structure });
        }
      });
      ui.feed.appendChild(section);
    });

    ui.feed.scrollTop = ui.feed.scrollHeight;
  }

  function renderDiagnostics() {
    if (!state) {
      ui.diagnostics.textContent = '';
      return;
    }
    ui.diagnostics.textContent = (state.journal || []).map((entry) =>
      `${String(entry.seq).padStart(3, '0')} ${entry.at} ${entry.type} ${JSON.stringify(entry.payload)}`
    ).join('\n');
    ui.diagnostics.scrollTop = ui.diagnostics.scrollHeight;
  }

  async function reportFatal(error) {
    console.error('[AutomationLayer]', error);
    if (state && ACTIVE_PHASES.has(state.phase)) {
      await failRun(error?.message || String(error));
    } else {
      showError(error?.message || String(error));
    }
  }

  function showError(message) {
    console.error('[AutomationLayer]', message);
    if (!state) return;
    addSystemMessage(String(message || 'Unknown error'), activeRoundNumber(), 'error');
    render();
  }

  function runtimeMessage(message, timeoutMs) {
    return new Promise((resolve, reject) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        reject(new Error(`Runtime message timeout: ${message.type}`));
      }, Number(timeoutMs || 10000));

      chrome.runtime.sendMessage(message, (response) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        resolve(response || {});
      });
    });
  }

  async function sha256(text) {
    const bytes = new TextEncoder().encode(String(text || ''));
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(digest))
      .map((byte) => byte.toString(16).padStart(2, '0'))
      .join('');
  }

  function createRunId() {
    const suffix = crypto.randomUUID
      ? crypto.randomUUID().replace(/-/g, '').slice(0, 12)
      : Math.random().toString(36).slice(2, 14);
    return `AUTO-${Date.now()}-${suffix.toUpperCase()}`;
  }

  function createEventId(prefix) {
    const suffix = crypto.randomUUID
      ? crypto.randomUUID().replace(/-/g, '').slice(0, 12)
      : Math.random().toString(36).slice(2, 14);
    return `${prefix}-${suffix}`;
  }

  function safeFilePart(value) {
    return String(value || 'run').replace(/[^a-z0-9._-]+/gi, '-').slice(0, 100);
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
})();
