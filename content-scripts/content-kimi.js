(function initKimiContentScript() {
  'use strict';

  if (window.kimiContentScriptLoaded) return;
  window.kimiContentScriptLoaded = true;

  const MODEL = 'Kimi';
  const PLATFORM = 'kimi';
  const KIMI_STABLE_TEXT_MS = 6000;
  // kimi.ai runs a Vue app with a Lexical contenteditable composer; the send
  // control is a <div class="send-button-container"> that carries `disabled`
  // while the composer is empty, not a real <button>.
  const COMPOSER_SELECTORS = [
    '.chat-input-editor[contenteditable="true"]',
    '.chat-input-editor',
    '.chat-editor [contenteditable="true"]',
    '.chat-box [contenteditable="true"]',
    'div[contenteditable="true"][data-lexical-editor="true"]'
  ];
  const SEND_SELECTORS = [
    '.send-button-container:not(.disabled)',
    '.chat-box .send-button-container',
    '.send-button-container',
    'button[class*="send" i]:not([disabled])',
    '[aria-label*="send" i]:not([disabled])'
  ];
  const RESPONSE_SELECTORS = [
    '.segment-assistant .markdown-container',
    '.segment-assistant',
    '.chat-content-item-assistant .markdown-container',
    '[class*="segment-assistant" i]',
    '[data-message-author-role="assistant"]',
    '[data-role="assistant"]',
    '[class*="assistant-message" i]',
    '[class*="assistant" i] [class*="markdown" i]'
  ];
  const GENERATING_SELECTOR = '.send-button-container.stop, [class*="stop" i][class*="button" i], [data-generating="true"], [data-streaming="true"], [aria-busy="true"]';
  const USER_TURN_SELECTOR = '.segment-user, [class*="segment-user" i], [data-message-author-role="user"], [data-role="user"]';
  // Kimi streams a reasoning trace inside the assistant turn, ahead of the
  // answer. It renders first and keeps changing longest, so any "latest visible
  // assistant text" rule picks the trace unless it is removed explicitly. The
  // token set mirrors AnswerStructure.isIgnored, which the unified pipeline
  // already applies — this is the same contract for the DOM fallback path.
  const REASONING_SELECTOR = [
    '[class*="think" i]', '[class*="thought" i]', '[class*="reason" i]',
    '[data-testid*="think" i]', '[data-testid*="reason" i]',
    '[data-type*="think" i]', '[data-type*="reason" i]'
  ].join(',');

  const baseAdapter = window.BaseLLMAdapter ? new window.BaseLLMAdapter({
    model: MODEL,
    isValidUrl: (url) => {
      try {
        const host = new URL(url).hostname.toLowerCase();
        return host === 'kimi.ai' || host.endsWith('.kimi.ai');
      } catch (_) { return false; }
    }
  }) : null;
  const sleep = window.ContentUtils?.sleep || ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const attachmentHandler = window.AttachmentHandler || null;
  let stopped = false;
  let lastResponse = { text: '', html: '' };

  const isVisible = (element) => {
    if (!element?.isConnected) return false;
    const style = window.getComputedStyle?.(element);
    if (style?.display === 'none' || style?.visibility === 'hidden') return false;
    return element.getClientRects?.().length > 0;
  };

  const findFirst = (selectors) => {
    for (const selector of selectors) {
      try {
        const element = document.querySelector(selector);
        if (element && isVisible(element)) return element;
      } catch (_) {}
    }
    return null;
  };

  const waitForFirst = async (selectors, timeoutMs = 20000) => {
    const deadline = Date.now() + timeoutMs;
    while (!stopped && Date.now() < deadline) {
      const element = findFirst(selectors);
      if (element) return element;
      await sleep(120);
    }
    throw new Error(`Kimi element not found: ${selectors.join(' | ')}`);
  };

  const readComposerText = (composer) => String(composer?.innerText ?? composer?.value ?? composer?.textContent ?? '').trim();

  const isGenerating = () => {
    try { return !!document.querySelector(GENERATING_SELECTOR); } catch (_) { return false; }
  };

  const isRejectedResponseText = (text) => {
    const normalized = String(text || '').replace(/\s+/g, ' ').trim();
    if (!normalized) return true;
    if (/^(Terms of Service|Privacy Policy|Sign in|Войти|Новый чат|New chat)$/i.test(normalized)) return true;
    const classifier = window.AnswerContentClassifier;
    if (classifier?.classify) {
      const classification = classifier.classify(normalized, { minValid: 20 });
      if ([
        classifier.CLASSES?.EMPTY,
        classifier.CLASSES?.PROMPT_ECHO,
        classifier.CLASSES?.UI_NOISE,
        classifier.CLASSES?.TECHNICAL_MESSAGE
      ].includes(classification.contentClass)) return true;
    }
    return false;
  };

  const compareDocumentOrder = (a, b) => {
    if (a === b) return 0;
    try {
      const NodeCtor = a?.ownerDocument?.defaultView?.Node || Node;
      const pos = a.compareDocumentPosition(b);
      if (pos & NodeCtor.DOCUMENT_POSITION_FOLLOWING) return -1;
      if (pos & NodeCtor.DOCUMENT_POSITION_PRECEDING) return 1;
    } catch (_) {}
    return 0;
  };

  const isAssistantNode = (node) => {
    const role = String(node.getAttribute?.('data-role') || node.getAttribute?.('data-message-author-role') || '').toLowerCase();
    const identity = `${node.id || ''} ${node.className || ''}`.toLowerCase();
    if (role === 'user') return false;
    if (/(^|[\s_-])user([\s_-]|$)/.test(identity)) return false;
    try { return !node.closest?.(USER_TURN_SELECTOR); } catch (_) { return true; }
  };

  const isReasoningNode = (node) => {
    if (!node?.nodeType) return false;
    try { return !!(node.matches?.(REASONING_SELECTOR) || node.closest?.(REASONING_SELECTOR)); } catch (_) { return false; }
  };

  // A candidate may be the whole assistant turn, which carries the trace as a
  // child. Read it through a detached clone with the reasoning subtrees removed
  // so the answer survives and the trace never reaches the card.
  const withoutReasoning = (node) => {
    if (!node) return null;
    let clone = null;
    try { clone = node.cloneNode(true); } catch (_) { return node; }
    try { clone.querySelectorAll?.(REASONING_SELECTOR).forEach((child) => child.remove()); } catch (_) {}
    return clone;
  };

  const readAnswerParts = (node) => {
    const clone = withoutReasoning(node);
    if (!clone) return { text: '', html: '' };
    const linearized = window.AnswerStructure?.linearizeText?.(clone);
    const text = String(linearized || clone.innerText || clone.textContent || '').replace(/\s+/g, ' ').trim();
    const html = window.ContentUtils?.buildInlineHtml
      ? String(window.ContentUtils.buildInlineHtml(clone, { includeRoot: true }) || '')
      : String(clone.outerHTML || '');
    return { text, html };
  };

  const responseCandidates = () => {
    const seen = new Set();
    const candidates = [];
    for (const selector of RESPONSE_SELECTORS) {
      try {
        document.querySelectorAll(selector).forEach((node) => {
          if (seen.has(node) || isReasoningNode(node)) return;
          const { text } = readAnswerParts(node);
          if (isVisible(node) && isAssistantNode(node) && !isRejectedResponseText(text)) {
            seen.add(node);
            candidates.push(node);
          }
        });
      } catch (_) {}
    }
    return candidates.sort(compareDocumentOrder);
  };

  const readLatestResponse = () => {
    const nodes = responseCandidates();
    const node = nodes[nodes.length - 1] || null;
    const { text, html } = readAnswerParts(node);
    return { text, html, node };
  };

  const requestTrustedInput = (text) => new Promise((resolve) => {
    const isMac = /mac/i.test(navigator.platform || navigator.userAgent || '');
    try {
      chrome.runtime.sendMessage({ type: 'KIMI_TRUSTED_INPUT_REQUEST', llmName: MODEL, text, isMac }, (response) => {
        if (chrome.runtime.lastError) resolve({ ok: false, reason: chrome.runtime.lastError.message });
        else resolve(response || { ok: false, reason: 'empty_response' });
      });
    } catch (err) {
      resolve({ ok: false, reason: err?.message || String(err) });
    }
  });

  // Confirmed against the live page: once Lexical already holds committed
  // content, execCommand('selectAll')+('delete') is not reliable — it can
  // silently no-op, leaving the next insertText to append rather than
  // replace, which is how a retry duplicates the draft instead of fixing it.
  // A CDP-dispatched Cmd/Ctrl+A + Input.insertText is a genuinely trusted
  // select-and-replace (the same operation a real keystroke performs) and
  // reliably clears whatever is there first, so it also cleans up any
  // duplication pasteTextFirst's own attempts may have left behind.
  const insertPrompt = async (composer, prompt) => {
    composer.focus?.();
    // ensurePromptPrepared already ran the paste transaction for this attempt.
    await requestTrustedInput(prompt);
  };

  const waitForSendConfirmation = async (composer, beforeUserTurns, timeoutMs) => {
    const deadline = Date.now() + timeoutMs;
    while (!stopped && Date.now() < deadline) {
      const value = readComposerText(composer);
      const userTurns = document.querySelectorAll(USER_TURN_SELECTOR).length;
      if (!value || userTurns > beforeUserTurns || isGenerating()) return true;
      await sleep(120);
    }
    return false;
  };

  const requestTrustedSend = () => new Promise((resolve) => {
    try {
      chrome.runtime.sendMessage({ type: 'KIMI_TRUSTED_SEND_REQUEST', llmName: MODEL }, (response) => {
        if (chrome.runtime.lastError) resolve({ ok: false, reason: chrome.runtime.lastError.message });
        else resolve(response || { ok: false, reason: 'empty_response' });
      });
    } catch (err) {
      resolve({ ok: false, reason: err?.message || String(err) });
    }
  });

  const sendPrompt = async (composer) => {
    // Confirmed against the live page: neither Enter nor Ctrl+Enter submits
    // this composer, trusted keystrokes included — Send only reacts to a
    // click. A synthetic in-page click reaches the Vue handler in some
    // states but not reliably once logged in, so try it first (cheap, no
    // debugger banner) and fall through to a real CDP-dispatched click.
    const beforeUserTurns = document.querySelectorAll(USER_TURN_SELECTOR).length;
    let button = findFirst(SEND_SELECTORS);
    if (button?.classList?.contains('disabled') || button?.disabled) {
      await sleep(250);
      button = findFirst(SEND_SELECTORS);
    }
    if (button && !button.disabled && !button.classList?.contains('disabled')) {
      button.click();
    }
    if (await waitForSendConfirmation(composer, beforeUserTurns, 1500)) return true;

    const trusted = await requestTrustedSend();
    if (trusted?.ok && await waitForSendConfirmation(composer, beforeUserTurns, 4000)) return true;
    return false;
  };

  const waitForStableResponse = async (baseline, timeoutMs = 180000) => {
    const deadline = Date.now() + timeoutMs;
    let previous = '';
    let stableSince = 0;
    const isBaseline = (text) => window.ContentUtils?.isBaselineEquivalent
      ? window.ContentUtils.isBaselineEquivalent(text, baseline)
      : String(text || '').replace(/\s+/g, ' ').trim() === String(baseline || '').replace(/\s+/g, ' ').trim();
    while (!stopped && Date.now() < deadline) {
      const latest = readLatestResponse();
      if (latest.text && !isBaseline(latest.text)) {
        if (latest.text === previous) {
          stableSince ||= Date.now();
          if (!isGenerating() && Date.now() - stableSince >= KIMI_STABLE_TEXT_MS) return latest;
        } else {
          previous = latest.text;
          stableSince = Date.now();
        }
      }
      await sleep(500);
    }
    const latest = readLatestResponse();
    if (latest.text && !isBaseline(latest.text)) return latest;
    throw new Error('Timed out waiting for a Kimi response');
  };

  const runPipeline = async (baseline) => {
    if (!window.UnifiedAnswerPipeline) return null;
    try {
      const pipeline = new window.UnifiedAnswerPipeline(PLATFORM, {
        llmName: MODEL,
        baselineText: baseline,
        stableTextMs: KIMI_STABLE_TEXT_MS
      });
      const result = await pipeline.execute();
      if (result?.success && result.answer) {
        return {
          text: String(result.answer),
          html: String(result.answerHtml || ''),
          meta: window.ContentUtils?.buildResponseMeta?.(result.metadata, { source: 'pipeline' }) || null
        };
      }
    } catch (err) {
      console.warn('[Kimi] Unified pipeline fallback:', err?.message || err);
    }
    return null;
  };

  const injectAndGetResponse = async (prompt, options = {}) => {
    if (!prompt?.trim()) throw new Error('Prompt is empty');
    const meta = window.ContentUtils?.ensureDispatchMeta
      ? window.ContentUtils.ensureDispatchMeta(options.meta || null, MODEL)
      : (options.meta || null);
    const baseline = readLatestResponse().text;
    const completionAttemptReady = await window.ContentUtils?.reportDispatchBaseline?.(MODEL, meta, baseline);
    if (completionAttemptReady !== true) {
      window.ContentUtils?.reportDispatchStage?.(MODEL, meta, 'completion_preflight_degraded', {
        outcome: 'degraded', reason: 'completion_runtime_unavailable'
      });
    }
    let composer = await waitForFirst(COMPOSER_SELECTORS);
    if (options.attachments?.length) {
      if (!attachmentHandler?.attach) {
        throw { type: 'attachment_failed', message: 'Kimi confirmed attachment handler unavailable' };
      }
      const attachmentResult = await attachmentHandler.attach(MODEL, options.attachments);
      if (!attachmentResult?.success) {
        attachmentHandler.notifyManualAttachmentRequired?.(MODEL, options.attachments, attachmentResult?.reason);
        throw { type: 'attachment_failed', message: 'Kimi attachment upload not confirmed' };
      }
      composer = await waitForFirst(COMPOSER_SELECTORS);
    }
    const prepared = window.ContentUtils?.ensurePromptPrepared
      ? await window.ContentUtils.ensurePromptPrepared(composer, prompt, {
          fallback: (input, text) => insertPrompt(input, text),
          resolveComposer: () => findFirst(COMPOSER_SELECTORS),
          attempts: 2,
          settleMs: 150
        })
      : { ok: false, reason: 'composer_transaction_unavailable' };
    window.ContentUtils?.reportPromptInsertion?.(MODEL, meta, {
      state: prepared.ok ? 'inserted' : 'failed',
      method: prepared.method || null,
      reason: prepared.reason || null,
      promptLength: String(prompt || '').length,
      composerLength: String(prepared.value || '').length,
      attempt: prepared.attempt ?? null
    });
    if (!prepared.ok) {
      throw { type: 'prompt_injection_failed', message: `Kimi prompt preparation failed: ${prepared.reason}` };
    }
    composer = prepared.composer || composer;
    window.ContentUtils?.reportDispatchStage?.(MODEL, meta, 'send_action_requested');
    const sendConfirmed = await sendPrompt(composer);
    if (!sendConfirmed) throw { type: 'send_failed', message: 'Kimi send not confirmed' };
    try { chrome.runtime.sendMessage({ type: 'PROMPT_SUBMITTED', llmName: MODEL, ts: Date.now(), meta }); } catch (_) {}
    const pipelineResult = await runPipeline(baseline);
    if (pipelineResult) {
      lastResponse = pipelineResult;
    } else {
      const fallback = await waitForStableResponse(baseline);
      lastResponse = {
        text: fallback.text,
        html: fallback.html || '',
        meta: window.ContentUtils?.buildResponseMeta?.(null, { source: 'dom_fallback' }) || null
      };
    }
    return lastResponse;
  };

  const emitAnswer = (type, payload, meta) => {
    chrome.runtime.sendMessage({
      type,
      llmName: MODEL,
      answer: payload.text,
      answerHtml: payload.html || '',
      error: payload.error || null,
      meta: payload.meta
        ? Object.assign({}, meta || {}, { responseMeta: payload.meta })
        : (meta || null)
    });
  };

  const cleanup = (reason = 'cleanup') => {
    stopped = true;
    try { baseAdapter?._cleanup?.(reason); } catch (_) {}
    window.kimiContentScriptLoaded = false;
  };
  window.__cleanup_kimi = cleanup;

  const onMessage = (message, _sender, sendResponse) => {
    if (!message) return false;
    if (message.type === 'CHECK_READINESS') {
      const composer = findFirst(COMPOSER_SELECTORS);
      sendResponse?.({ ready: !!composer, status: composer ? 'ready' : 'not_ready', llmName: MODEL });
      return false;
    }
    if (message.type === 'HEALTH_CHECK_PING') {
      sendResponse?.({ type: 'HEALTH_CHECK_PONG', pingId: message.pingId, llmName: MODEL });
      return false;
    }
    if (message.type === 'ANTI_SLEEP_PING') {
      sendResponse?.({ status: 'awake', llmName: MODEL });
      return false;
    }
    if (message.type === 'STOP_AND_CLEANUP' || message.type === 'HUMANOID_FORCE_STOP') {
      cleanup(message.reason || message.type);
      sendResponse?.({ status: 'stopped', llmName: MODEL });
      return false;
    }
    if (message.type === 'GET_ANSWER_NO_FOCUS') {
      const ready = !!findFirst(COMPOSER_SELECTORS);
      sendResponse?.({ status: ready ? 'ready_no_focus' : 'requires_focus', requiresFocus: !ready });
      return false;
    }
    if (message.type === 'GET_ANSWER' || message.type === 'GET_FINAL_ANSWER') {
      const responseType = message.type === 'GET_FINAL_ANSWER' ? 'FINAL_LLM_RESPONSE' : 'LLM_RESPONSE';
      if (!String(message.prompt || '').trim()) {
        sendResponse?.({ ok: false, accepted: false, status: 'rejected', reason: 'empty_prompt' });
        return false;
      }
      sendResponse?.({
        ok: true,
        accepted: true,
        status: 'accepted',
        dispatchId: message.meta?.dispatchId || null,
        attemptId: message.meta?.attemptId || null,
        tabSessionId: message.meta?.tabSessionId || null
      });
      const releaseActive = () => window.ContentUtils?.stopActiveRequest?.();
      window.ContentUtils?.startActiveRequest?.();
      window.ContentUtils?.reportProviderPipelineState?.(MODEL, message.meta || null, 'composer', true);
      window.ContentUtils?.reportDispatchStage?.(MODEL, message.meta || null, 'command_accepted');
      injectAndGetResponse(message.prompt, { attachments: message.attachments || [], meta: message.meta || null })
        .then((payload) => {
          if (!message.isFireAndForget) emitAnswer(responseType, payload, message.meta);
        })
        .catch((err) => {
          const errorMessage = err?.message || String(err);
          emitAnswer(responseType, {
            text: '',
            html: '',
            error: { type: err?.type || 'generic_error', message: errorMessage }
          }, message.meta);
        })
        .finally(() => {
          window.ContentUtils?.reportProviderPipelineState?.(MODEL, message.meta || null, 'composer', false);
          window.ContentUtils?.reportProviderPipelineState?.(MODEL, message.meta || null, 'answer_collection', false);
          releaseActive();
        });
      return false;
    }
    if (message.action === 'getResponses') {
      const latest = readLatestResponse();
      if (latest.text) {
        lastResponse = latest;
        emitAnswer('LLM_RESPONSE', latest, message.meta);
        sendResponse?.({ status: 'success' });
      } else {
        sendResponse?.({ status: 'error', message: 'No Kimi response found' });
      }
      return false;
    }
    if (message.action === 'injectPrompt' || message.action === 'sendPrompt' || message.action === 'REQUEST_LLM_RESPONSE') {
      injectAndGetResponse(message.prompt, { attachments: message.attachments || [], meta: message.meta || null }).then((payload) => emitAnswer('LLM_RESPONSE', payload, message.meta)).catch(() => {});
      return false;
    }
    return baseAdapter?.handleMessage?.(message, _sender, sendResponse) || false;
  };

  chrome.runtime.onMessage.addListener(onMessage);
  window.__kimiAdapter = {
    readLatestResponse,
    responseCandidates,
    isRejectedResponseText
  };
  try {
    if (window.LLMExtension?.sendScriptReady) window.LLMExtension.sendScriptReady(MODEL);
    else chrome.runtime.sendMessage({ type: 'SCRIPT_READY', llmName: MODEL });
    chrome.runtime.sendMessage({ type: 'SCRIPT_LOADED', llmName: MODEL, platform: PLATFORM });
  } catch (err) {
    console.warn('[Kimi] Ready signal failed:', err?.message || err);
  }
})();
