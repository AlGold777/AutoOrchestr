// One per-platform generation signal used by observation and final verification.
(function initGenerationSignal(root) {
  'use strict';

  function selectorList(value) {
    if (Array.isArray(value)) return value.filter((item) => typeof item === 'string' && item.trim());
    return typeof value === 'string' && value.trim() ? [value] : [];
  }

  function isAvailable(node) {
    if (!node || node.nodeType !== 1) return false;
    if (node.closest?.('[hidden], [aria-hidden="true"], [inert]')) return false;
    return node.hidden !== true
      && node.disabled !== true
      && node.getAttribute?.('disabled') === null
      && node.getAttribute?.('aria-disabled') !== 'true'
      && node.getAttribute?.('aria-hidden') !== 'true'
      && node.getAttribute?.('inert') === null;
  }

  function isVisible(node, view = root) {
    if (!isAvailable(node)) return false;
    try {
      const style = view.getComputedStyle?.(node);
      if (style && (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse')) return false;
      const rect = node.getBoundingClientRect?.();
      return Boolean(rect && rect.width > 0 && rect.height > 0);
    } catch (_) {
      return false;
    }
  }

  function inspect(options = {}) {
    const selectors = options.selectors || {};
    const descriptors = [
      ...selectorList(selectors.generatingIndicators).map((selector) => ({ selector, kind: 'generating' })),
      ...selectorList(selectors.streaming).map((selector) => ({ selector, kind: 'streaming' })),
      ...selectorList(selectors.stopButton).map((selector) => ({ selector, kind: 'stopButton' }))
    ];
    const queryAll = typeof options.queryAll === 'function'
      ? options.queryAll
      : (selector) => Array.from((options.document || root.document)?.querySelectorAll?.(selector) || []);
    const visible = typeof options.isVisible === 'function'
      ? (node) => isAvailable(node) && options.isVisible(node)
      : (node) => isVisible(node, options.view || root);

    const checks = [];
    let activeMatch = null;
    for (const descriptor of descriptors) {
      let nodes = [];
      try { nodes = Array.from(queryAll(descriptor.selector) || []); } catch (_) { nodes = []; }
      const availableCount = nodes.filter(isAvailable).length;
      const visibleNodes = nodes.filter(visible);
      checks.push({
        kind: descriptor.kind,
        selector: descriptor.selector,
        foundCount: nodes.length,
        availableCount,
        visibleCount: visibleNodes.length
      });
      if (!activeMatch && visibleNodes[0]) activeMatch = { descriptor, node: visibleNodes[0] };
    }
    if (activeMatch) {
      return {
        active: true,
        kind: activeMatch.descriptor.kind,
        selector: activeMatch.descriptor.selector,
        node: activeMatch.node,
        checks
      };
    }
    const totalFound = checks.reduce((sum, check) => sum + Number(check.foundCount || 0), 0);
    return {
      active: totalFound > 0 ? false : null,
      kind: null,
      selector: null,
      node: null,
      checks
    };
  }

  const api = Object.freeze({ selectorList, isAvailable, isVisible, inspect });
  root.GenerationSignal = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
