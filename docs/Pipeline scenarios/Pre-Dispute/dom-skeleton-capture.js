// Privacy-preserving assistant-turn DOM skeleton capture for structural fixtures.
(function initDomSkeletonCapture(root) {
  'use strict';

  const SAFE_ATTRIBUTES = new Set([
    'id', 'class', 'role', 'data-testid', 'data-test-id', 'data-role',
    'data-message-author-role', 'data-author-role', 'data-message-type',
    'data-is-response', 'data-is-streaming', 'data-streaming', 'data-generating',
    'data-is-loading', 'data-loading', 'aria-busy', 'aria-disabled', 'aria-hidden',
    'disabled', 'hidden', 'inert'
  ]);
  const GENERATED_ATTRIBUTES = new Set(['data-shadow-root']);
  const SAFE_CONTROL_LABEL = /\b(stop|send|regenerate|continue|останов|отправ|detener|arrêter)\b/i;
  const TEXT_PLACEHOLDER = /^⟦TEXT:\d+⟧$/;
  const SAFE_DEEPSEEK_STRUCTURAL_IDENTIFIER = /^ds-(?:answer|assistant|avatar|button|chat|icon|loading|markdown|message|response|scroll|thinking)(?:$|[-_])/i;

  function placeholder(value) {
    return `⟦TEXT:${String(value || '').length}⟧`;
  }

  function redact(value) {
    const editor = root.SecretRedaction;
    if (!editor?.redactString) throw new Error('secret_redaction_unavailable');
    return editor.redactString(String(value || ''));
  }

  function sanitizeIdentifier(value) {
    return String(value || '').split(/(\s+)/).map((part) => (
      SAFE_DEEPSEEK_STRUCTURAL_IDENTIFIER.test(part) ? part : redact(part)
    )).join('')
      .replace(/[0-9a-f]{8}-[0-9a-f-]{12,}/gi, 'placeholder-id')
      .replace(/\d{5,}/g, '00000');
  }

  function sanitizeAttribute(name, value) {
    const lower = String(name || '').toLowerCase();
    if (lower === 'aria-label') {
      const cleaned = redact(value);
      return SAFE_CONTROL_LABEL.test(cleaned) ? cleaned : placeholder(cleaned);
    }
    if (!SAFE_ATTRIBUTES.has(lower)) return null;
    if (lower === 'id' || lower === 'class' || lower === 'data-testid' || lower === 'data-test-id') {
      return sanitizeIdentifier(value);
    }
    return redact(value);
  }

  function cloneSkeleton(node, targetDocument) {
    if (!node) return null;
    if (node.nodeType === 3) {
      const value = String(node.nodeValue || '');
      return value.trim() ? targetDocument.createTextNode(placeholder(value.trim())) : null;
    }
    if (node.nodeType !== 1) return null;
    const tag = String(node.tagName || 'div').toLowerCase();
    if (['script', 'style', 'noscript', 'template'].includes(tag)) return null;
    const clone = targetDocument.createElement(tag);
    Array.from(node.attributes || []).forEach((attribute) => {
      const value = sanitizeAttribute(attribute.name, attribute.value);
      if (value !== null) clone.setAttribute(attribute.name, value);
    });
    Array.from(node.childNodes || []).forEach((child) => {
      const childClone = cloneSkeleton(child, targetDocument);
      if (childClone) clone.appendChild(childClone);
    });
    try {
      if (node.shadowRoot) {
        const marker = targetDocument.createElement('template');
        marker.setAttribute('data-shadow-root', 'open');
        Array.from(node.shadowRoot.childNodes || []).forEach((child) => {
          const childClone = cloneSkeleton(child, targetDocument);
          if (childClone) marker.content.appendChild(childClone);
        });
        clone.appendChild(marker);
      }
    } catch (_) {}
    return clone;
  }

  function validateSkeleton(skeleton) {
    if (!skeleton || skeleton.nodeType !== 1) return { ok: false, error: 'sanitized_root_missing' };
    const visit = (node) => {
      if (!node) return null;
      if (node.nodeType === 3) {
        const value = String(node.nodeValue || '').trim();
        return !value || TEXT_PLACEHOLDER.test(value) ? null : 'raw_text_node_detected';
      }
      if (node.nodeType !== 1) return 'unsupported_node_type';
      for (const attribute of Array.from(node.attributes || [])) {
        const lower = String(attribute.name || '').toLowerCase();
        if (lower !== 'aria-label' && !SAFE_ATTRIBUTES.has(lower) && !GENERATED_ATTRIBUTES.has(lower)) {
          return `unsupported_attribute:${lower}`;
        }
        if (/https?:\/\/|bearer\s+|api[_-]?key|access[_-]?token|refresh[_-]?token/i.test(String(attribute.value || ''))) {
          return `sensitive_attribute:${lower}`;
        }
      }
      for (const child of Array.from(node.childNodes || [])) {
        const error = visit(child);
        if (error) return error;
      }
      return null;
    };
    const error = visit(skeleton);
    return error ? { ok: false, error } : { ok: true };
  }

  function captureNode(node, options = {}) {
    if (!node || node.nodeType !== 1) return { ok: false, error: 'capture_root_missing' };
    if (!root.SecretRedaction?.redactString) return { ok: false, error: 'secret_redaction_unavailable' };
    const doc = options.document || root.document;
    const skeleton = cloneSkeleton(node, doc);
    const privacy = validateSkeleton(skeleton);
    if (!privacy.ok) return { ok: false, error: `privacy_validation_failed:${privacy.error}` };
    return {
      ok: true,
      schemaVersion: 1,
      capturedAt: new Date().toISOString(),
      platform: options.platform || 'generic',
      resolution: options.resolution || 'unknown',
      textPolicy: 'length_placeholders_only',
      attributePolicy: 'structural_allowlist_and_secret_redaction',
      privacyValidated: true,
      html: skeleton?.outerHTML || ''
    };
  }

  function normalizedLength(value) {
    const normalize = root.AnswerStructure?.normalizeText;
    return typeof normalize === 'function'
      ? normalize(value).length
      : String(value || '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim().length;
  }

  function diagnosticRootFor(turn, selectors, doc) {
    if (turn?.answerNode) {
      let node = turn.answerNode;
      for (let depth = 0; depth < 3; depth += 1) {
        const parent = node?.parentElement;
        if (!parent || parent === doc?.body || parent === doc?.documentElement) break;
        node = parent;
      }
      return node;
    }
    const candidates = [selectors?.answerContainer, 'main', '[role="main"]', 'body'].filter(Boolean);
    for (const selector of candidates) {
      try {
        const container = doc?.querySelector?.(selector);
        if (container) return container.lastElementChild || container;
      } catch (_) {}
    }
    return null;
  }

  function captureCurrentTurn(options = {}) {
    const platform = options.platform || root.AnswerPipelineSelectors?.detectPlatform?.() || 'generic';
    const selectors = options.selectors || root.AnswerPipelineSelectors?.PLATFORM_SELECTORS?.[platform] || {};
    const turn = root.TurnResolver?.resolveTurn?.({
      platform,
      selectors,
      document: options.document || root.document,
      minimumTextLength: 5
    });
    const diagnosticContext = !turn?.messageRoot;
    const captureRoot = turn?.messageRoot || diagnosticRootFor(turn, selectors, options.document || root.document);
    if (!captureRoot) return {
      ok: false,
      error: 'diagnostic_capture_root_missing',
      platform,
      resolution: turn?.resolution || 'unresolved',
      reason: turn?.reason || 'message_root_unresolved'
    };
    const capture = captureNode(captureRoot, {
      document: options.document || root.document,
      platform,
      resolution: turn.resolution
    });
    if (!capture.ok) return capture;
    const rawTextLength = normalizedLength(captureRoot.textContent || '');
    const linearizedTextLength = normalizedLength(
      root.AnswerStructure?.linearizeText?.(captureRoot) || ''
    );
    const selectedAnswerLength = normalizedLength(
      root.AnswerStructure?.linearizeText?.(turn.answerNode) || ''
    );
    const ignoredTextDelta = Math.max(0, rawTextLength - linearizedTextLength);
    const ignoredTextRatio = rawTextLength > 0
      ? Number((ignoredTextDelta / rawTextLength).toFixed(4))
      : 0;
    const structure = !diagnosticContext
      ? (root.AnswerStructure?.inspect?.(turn.messageRoot, turn.answerNode) || null)
      : null;
    const generationSignal = root.GenerationSignal?.inspect?.({
      selectors,
      document: options.document || root.document
    }) || { active: null, kind: 'detector_unavailable', selector: null };
    const structuralIssues = diagnosticContext
      ? ['message_root_missing']
      : (Array.isArray(structure?.issues) ? structure.issues.slice(0, 20) : ['structure_inspector_unavailable']);
    if (selectedAnswerLength < 5 && !structuralIssues.includes('selected_answer_text_empty')) {
      structuralIssues.push('selected_answer_text_empty');
    }
    return {
      ...capture,
      reason: turn.reason || null,
      messageRootSelector: turn.messageRootSelector || null,
      selectorUsed: turn.selectorUsed || null,
      selectorTier: turn.selectorTier || null,
      diagnosticContext,
      structuralComplete: !diagnosticContext && structure?.complete === true && selectedAnswerLength >= 5,
      structuralIssues,
      generationActive: typeof generationSignal.active === 'boolean' ? generationSignal.active : null,
      generationSignalKind: generationSignal.kind || null,
      generationSignalSelector: generationSignal.selector || null,
      rawTextLength,
      linearizedTextLength,
      selectedAnswerLength,
      ignoredTextDelta,
      ignoredTextRatio,
      ignoredContentRisk: ignoredTextDelta >= 50 && ignoredTextRatio >= 0.15
    };
  }

  const api = Object.freeze({ placeholder, sanitizeAttribute, validateSkeleton, captureNode, captureCurrentTurn });
  root.DOMSkeletonCapture = api;
  if (root.chrome?.runtime?.onMessage && !root.__DOM_SKELETON_CAPTURE_LISTENER__) {
    root.__DOM_SKELETON_CAPTURE_LISTENER__ = true;
    root.chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      if (message?.type !== 'CAPTURE_SANITIZED_ANSWER_SKELETON') return false;
      try {
        sendResponse(root.DOMSkeletonCapture.captureCurrentTurn());
      } catch (error) {
        sendResponse({ ok: false, error: error?.message || 'skeleton_capture_failed' });
      }
      return false;
    });
  }
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
