(function initDebateContextBudget(root) {
  'use strict';
  const DEFAULT_LIMITS = Object.freeze({ promptChars: 60000, reservedOutputChars: 8000 });
  const estimate = (text) => String(text == null ? '' : text).length;
  const effectivePromptLimit = (limits = DEFAULT_LIMITS) => {
    const prompt = Math.max(0, Number(limits.promptChars ?? DEFAULT_LIMITS.promptChars));
    const reserve = Object.prototype.hasOwnProperty.call(limits, 'reservedOutputChars')
      ? Math.max(0, Number(limits.reservedOutputChars || 0))
      : (limits === DEFAULT_LIMITS ? DEFAULT_LIMITS.reservedOutputChars : 0);
    return Math.max(0, prompt - reserve);
  };
  function check({ parts = [], limits = DEFAULT_LIMITS } = {}) {
    const totalChars = (Array.isArray(parts) ? parts : []).reduce((sum, part) => sum + estimate(part?.text), 0);
    const limit = effectivePromptLimit(limits);
    const overflowChars = Math.max(0, totalChars - limit);
    return { ok: overflowChars === 0, totalChars, overflowChars };
  }
  function compactParts(parts = [], limits = DEFAULT_LIMITS) {
    const result = (Array.isArray(parts) ? parts : []).map((part) => ({ ...part }));
    const limit = effectivePromptLimit(limits);
    const old = result.filter((part) => part.priority === 'old' || part.priority === 'low'
      || (Number.isFinite(Number(part.wave)) && Number(part.wave) < Number(limits.currentWave || Infinity)));
    old.forEach((part) => { if (check({ parts: result, limits }).ok) return; part.text = `[волна ${part.wave || '?'}: см. filtered state]`; });
    while (!check({ parts: result, limits }).ok) {
      const removable = result.find((part) => ['old', 'low'].includes(part.priority) && !/^\[волна/.test(String(part.text || '')));
      if (!removable) break;
      removable.text = `[${removable.label || removable.id || 'старый контекст'}: см. filtered state]`;
    }
    let guard = 0;
    while (!check({ parts: result, limits }).ok && guard < 100) {
      guard += 1;
      const candidates = result.filter((part) => part.id !== 'last_wave');
      const target = (candidates.some((part) => part.priority !== 'high') ? candidates.filter((part) => part.priority !== 'high') : candidates)
        .sort((a, b) => estimate(b.text) - estimate(a.text))[0];
      if (!target || !target.text) break;
      const keep = Math.max(0, estimate(target.text) - check({ parts: result, limits }).overflowChars);
      const originalLength = estimate(target.text);
      const marker = ` [обрезано системой: было ${originalLength} символов]`;
      target.text = `${String(target.text).slice(0, Math.max(0, keep - marker.length))}${marker}`;
      if (estimate(target.text) >= originalLength) target.text = String(target.text).slice(0, Math.max(0, limit));
    }
    return result;
  }
  function compactPrompt(prompt = '', parts = [], limits = DEFAULT_LIMITS) {
    const original = String(prompt || '');
    const normalizedParts = (Array.isArray(parts) ? parts : []).map((part) => ({ ...part }));
    const partsChars = normalizedParts.reduce((sum, part) => sum + estimate(part.text), 0);
    const baseChars = Math.max(0, estimate(original) - partsChars);
    const max = effectivePromptLimit(limits);
    const compactedParts = compactParts(normalizedParts, { ...limits, promptChars: Math.max(0, max - baseChars), reservedOutputChars: 0 });
    let output = original;
    normalizedParts.forEach((part, index) => {
      const replacement = compactedParts[index]?.text;
      if (part.text && replacement != null && replacement !== part.text) output = output.split(String(part.text)).join(String(replacement));
    });
    if (estimate(output) > max) {
      const marker = `\n[обрезано системой: было ${estimate(output)} символов]`;
      output = marker.length >= max
        ? marker.slice(0, max)
        : `${output.slice(0, Math.max(0, max - marker.length))}${marker}`;
    }
    return { text: output, parts: compactedParts, originalChars: estimate(original), finalChars: estimate(output), compacted: output !== original };
  }
  const api = Object.freeze({ DEFAULT_LIMITS, estimate, effectivePromptLimit, check, compactParts, compactPrompt });
  root.DebateContextBudget = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
