(function initDebateConvergence(root) {
  'use strict';
  function assess({ wave = 0, roundLimit = 0, triggers = [], roundDeltas = [] } = {}) {
    const ids = triggers.map((item) => String(item.triggerId || item).toUpperCase());
    const warning = wave <= 2 && roundLimit >= 3 && ids.some((id) => ['FALSE_CONSENSUS', 'PREMATURE_VERDICT'].includes(id));
    const recent = roundDeltas.slice(-2);
    const stagnating = recent.length === 2 && recent.every((entry) => {
      const delta = entry?.delta || entry || {};
      const noNewContent = Number(delta?.stagnation?.newContentRatio || 0) === 0;
      const repeatedByHalf = Number(delta?.stagnation?.repeatedPointCount || 0) >= Math.ceil(Number(delta.participantCount || 1) / 2);
      return noNewContent || repeatedByHalf;
    });
    return { warning, stagnating, kind: warning ? 'premature_convergence' : stagnating ? 'stagnation' : '' };
  }
  const STEELMAN_INSTRUCTION = 'Согласие достигнуто слишком быстро. Каждый участник обязан привести один сильный довод ПРОТИВ текущего консенсуса (steelman противоположной позиции).';
  const api = Object.freeze({ assess, STEELMAN_INSTRUCTION }); root.DebateConvergence = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
