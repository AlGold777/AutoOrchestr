// Structural completeness inspection for the exact current assistant turn.
(function initAnswerStructure(root) {
  'use strict';

  const IGNORED_TAGS = new Set([
    'SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'BUTTON', 'INPUT', 'TEXTAREA',
    'SELECT', 'OPTION', 'FORM', 'NAV', 'ASIDE', 'HEADER', 'FOOTER'
  ]);
  const CONTENT_TAGS = new Set([
    'P', 'PRE', 'CODE', 'LI', 'TD', 'TH', 'BLOCKQUOTE', 'FIGCAPTION',
    'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'IMG', 'VIDEO', 'AUDIO', 'CANVAS', 'SVG', 'MATH'
  ]);

  function normalizeText(value = '') {
    return String(value || '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
  }

  function hashText(value = '') {
    const text = normalizeText(value);
    let hash = 2166136261;
    for (let index = 0; index < text.length; index += 1) {
      hash ^= text.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(16);
  }

  function hasHiddenSemantics(node) {
    if (!node || node.nodeType !== 1) return false;
    if (node.hidden === true
      || node.getAttribute?.('aria-hidden') === 'true'
      || node.getAttribute?.('inert') !== null
      || /(?:^|;)\s*(?:display\s*:\s*none|visibility\s*:\s*hidden)/i.test(node.getAttribute?.('style') || '')) return true;
    try {
      const style = root.getComputedStyle?.(node);
      return Boolean(style && (style.display === 'none'
        || style.visibility === 'hidden'
        || style.visibility === 'collapse'));
    } catch (_) {
      return false;
    }
  }

  function isIgnored(node) {
    if (!node || node.nodeType !== 1) return true;
    if (IGNORED_TAGS.has(String(node.tagName || '').toUpperCase()) || hasHiddenSemantics(node)) return true;
    const role = String(node.getAttribute?.('role') || '').toLowerCase();
    if (['button', 'toolbar', 'navigation', 'menu', 'menubar', 'status'].includes(role)) return true;
    const className = typeof node.className === 'string' ? node.className : (node.className?.baseVal || '');
    const structuralMarker = `${className} ${node.id || ''} ${node.getAttribute?.('data-testid') || ''}`.toLowerCase();
    if (/(?:^|[\s_-])(sr-only|visually-hidden|screen-reader|cdk-visually-hidden)(?:$|[\s_-])/.test(structuralMarker)) return true;
    if (/(?:^|[\s_-])(toolbar|actions?|controls?|feedback|copy-button|reaction)(?:$|[\s_-])/.test(structuralMarker)) return true;
    const semanticMarker = [
      node.getAttribute?.('data-testid'), node.getAttribute?.('data-type'),
      node.getAttribute?.('data-content-type'), node.getAttribute?.('data-message-part-type'),
      node.getAttribute?.('aria-label')
    ].filter(Boolean).join(' ').toLowerCase();
    if (/(thinking|thought|reasoning|analysis|scratch|trace|internal|reflection)/.test(semanticMarker)) return true;
    return /(?:^|[\s_-])(thinking|thought|reasoning|scratchpad|chain-of-thought)(?:$|[\s_-])/.test(structuralMarker);
  }

  // Providers with typed message parts explicitly separate public answers from
  // reasoning and turn metadata. Their answer parts are the content boundary.
  // null means an untyped layout; [] means no public answer has rendered yet.
  function getAnswerParts(element) {
    if (!element?.querySelectorAll) return null;
    if (element.matches?.('[data-message-part-type="answer"]')) return [element];
    const parts = Array.from(element.querySelectorAll('[data-message-part-type]'));
    return parts.length ? parts.filter(part => part.getAttribute('data-message-part-type') === 'answer') : null;
  }

  function linearizeText(element, options = {}) {
    if (!element || element.nodeType !== 1 || isIgnored(element)) return '';
    const chunks = [];
    const maxChars = Math.max(1, Number(options.maxChars || 200000));
    let length = 0;
    const visit = (node) => {
      if (!node || length >= maxChars) return;
      if (node.nodeType === 3) {
        const text = normalizeText(node.nodeValue || '');
        if (text) {
          chunks.push(text);
          length += text.length + 1;
        }
        return;
      }
      if (node.nodeType !== 1 || isIgnored(node)) return;
      Array.from(node.childNodes || []).forEach(visit);
      try {
        if (node.shadowRoot) Array.from(node.shadowRoot.childNodes || []).forEach(visit);
      } catch (_) {}
    };
    const parts = getAnswerParts(element);
    if (parts) parts.forEach(visit);
    else Array.from(element.childNodes || []).forEach(visit);
    try {
      if (element.shadowRoot) Array.from(element.shadowRoot.childNodes || []).forEach(visit);
    } catch (_) {}
    return normalizeText(chunks.join(' ').slice(0, maxChars));
  }

  function directText(node) {
    return normalizeText(Array.from(node?.childNodes || [])
      .filter((child) => child.nodeType === 3)
      .map((child) => child.nodeValue || '')
      .join(' '));
  }

  function hasNonTextContent(node) {
    const tag = String(node?.tagName || '').toUpperCase();
    if (tag === 'SVG') {
      return node.getAttribute?.('role') === 'img'
        || Boolean(node.getAttribute?.('aria-label'))
        || Boolean(node.querySelector?.('title, desc'));
    }
    return ['IMG', 'VIDEO', 'AUDIO', 'CANVAS', 'MATH'].includes(tag);
  }

  function describe(node) {
    const text = normalizeText(node?.textContent || '');
    return {
      tag: String(node?.tagName || '').toLowerCase(),
      role: node?.getAttribute?.('role') || null,
      length: text.length,
      hash: text ? hashText(text) : null,
      nonText: hasNonTextContent(node)
    };
  }

  function enumerateContentBlocks(container, options = {}) {
    const selected = options.selected || null;
    const blocks = [];
    const visit = (node) => {
      if (!node || node.nodeType !== 1 || isIgnored(node)) return;
      if (selected && (node === selected || selected.contains?.(node))) return;
      const children = Array.from(node.children || []).filter((child) => !isIgnored(child));
      const semantic = CONTENT_TAGS.has(String(node.tagName || '').toUpperCase());
      const ownText = directText(node);
      const media = hasNonTextContent(node);

      if (semantic && (ownText || media || children.length === 0)) {
        const descriptor = describe(node);
        if (descriptor.length > 0 || descriptor.nonText) blocks.push(descriptor);
        return;
      }

      if (ownText) blocks.push(describe(node));
      children.forEach(visit);
      try {
        if (node.shadowRoot) Array.from(node.shadowRoot.children || []).forEach(visit);
      } catch (_) {}
    };
    Array.from(container?.children || []).forEach(visit);
    try {
      if (container?.shadowRoot) Array.from(container.shadowRoot.children || []).forEach(visit);
    } catch (_) {}
    return blocks;
  }

  function inspect(messageRoot, selected) {
    const issues = [];
    if (!messageRoot) issues.push('message_root_missing');
    if (!selected) issues.push('selected_answer_missing');
    if (messageRoot && selected && messageRoot !== selected && !messageRoot.contains?.(selected)) {
      issues.push('selected_outside_message_root');
    }
    const parts = messageRoot ? getAnswerParts(messageRoot) : null;
    const omittedBlocks = issues.length === 0
      ? enumerateContentBlocks(parts ? { children: parts } : messageRoot, { selected })
      : [];
    if (omittedBlocks.length) issues.push('uncovered_message_blocks');
    return {
      complete: issues.length === 0,
      issues,
      omittedBlockCount: omittedBlocks.length,
      omittedBlocks
    };
  }

  const api = Object.freeze({ normalizeText, isIgnored, getAnswerParts, linearizeText, enumerateContentBlocks, inspect });
  root.AnswerStructure = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
