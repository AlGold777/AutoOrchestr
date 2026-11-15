// shared/usage-limit-detector.js
// Account usage/quota limit of a model ("Достигнут лимит использования. Сброс в 16:30.",
// "You've reached your usage limit"). It is a terminal condition, not an answer: the same
// request is not retried until the limit resets. One detector for all providers.
//
// A surface is either a banner (alert/toast/notice outside the answer) or the last answer
// turn. A banner with limit text is a limit. The answer turn counts only when it is short,
// no Stop is visible, its text is not growing and it offers Retry: a real answer that
// discusses limits is long, or still generating, or has no Retry button.

(function initUsageLimitDetector(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.UsageLimitDetector = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function buildUsageLimitDetector() {
  'use strict';

  const REASON = 'usage_limit';
  // Longer text is an answer or a page block, not a limit notice.
  const MAX_SURFACE_LENGTH = 400;
  const MAX_ANSWER_LENGTH = 400;

  // Explicit limit wording, RU and EN. Each pattern names a limit, not a topic.
  const LIMIT_PATTERNS = [
    /достигнут[а-яё]*\s+лимит[а-яё]*\s+(?:использовани[а-яё]*|сообщени[а-яё]*|запрос[а-яё]*|модел[а-яё]*)/i,
    /лимит[а-яё]*\s+(?:использовани[а-яё]*|сообщени[а-яё]*|запрос[а-яё]*)\s+(?:модел[а-яё]*\s+|аккаунт[а-яё]*\s+|в\s+этот\s+час\s+)?(?:исчерпан[а-яё]*|достигнут[а-яё]*|превышен[а-яё]*)/i,
    /квот[а-яё]*\s+(?:исчерпан[а-яё]*|превышен[а-яё]*|достигнут[а-яё]*)|исчерпан[а-яё]*\s+квот[а-яё]*/i,
    // Period limits (Qwen: «Вы достигли дневного лимита для Qwen4-Max-Preview. Обновите подписку…», 2026-11-15).
    /достиг(?:л|нут)[а-яё]*\s+(?:дневн|суточн|часов|недельн|месячн)[а-яё]*\s+лимит[а-яё]*/i,
    /(?:дневн|суточн|часов|недельн|месячн)[а-яё]*\s+лимит[а-яё]*\s+(?:исчерпан|достигнут|превышен)[а-яё]*/i,
    /\b(?:daily|hourly|weekly|monthly)\s+(?:usage\s+|message\s+)?limit\s+(?:has been\s+|was\s+|is\s+)?(?:reached|exceeded|hit)/i,
    /usage limit (?:has been |was |is )?(?:reached|exceeded|hit)/i,
    /you(?:'|’)?ve (?:reached|hit|exceeded) (?:your|the) [\w\s-]{0,30}limit/i,
    /reached (?:your|the) (?:usage|message|daily|rate|hourly) limit/i,
    /\bmessage limit\b/i,
    /\brate[ -]limit(?:ed| exceeded| reached)?\b/i,
    /\btoo many requests\b/i,
    /\bquota (?:exceeded|exhausted|reached)\b/i
  ];

  // Retry controls of a limit notice (the answer turn of a refused request offers them).
  const RETRY_RE = /^(?:повторить(?: ответ| запрос)?|retry(?: response)?|try again)$/i;
  // The reset time: "Сброс в 16:30", "resets at 16:30", "try again after 16:30".
  const RESET_RE = /(?:сброс[а-яё]*|reset[a-z]*|try again after|попробуйте\s+(?:после|снова\s+в)|повторите\s+(?:после|в)|исчерпан[а-яё]*\s+до)\D{0,30}?(\d{1,2}:\d{2})/i;

  const SURFACE_SELECTORS = [
    '[role="alert"]', '[role="status"]', '[role="dialog"]', '[aria-live]',
    '[class*="banner" i]', '[class*="toast" i]', '[class*="notice" i]', '[class*="notification" i]',
    '[class*="error" i]', '[class*="limit" i]', '[data-testid*="error" i]', '[data-testid*="limit" i]'
  ];

  function normalize(text) {
    return String(text || '').replace(/\s+/g, ' ').trim();
  }

  function matchesLimit(text) {
    return LIMIT_PATTERNS.some((re) => re.test(text));
  }

  function resetTimeOf(text) {
    const match = RESET_RE.exec(text);
    return match ? match[1] : null;
  }

  // The reason string the terminal result carries: "usage_limit" or "usage_limit:16:30".
  function reasonOf(resetAt) {
    return resetAt ? `${REASON}:${resetAt}` : REASON;
  }

  // Parses a reason string back: { reason: 'usage_limit', resetAt } or null for other reasons.
  function parseReason(value) {
    const match = /^usage_limit(?::(\d{1,2}:\d{2}))?$/.exec(String(value || ''));
    return match ? { reason: REASON, resetAt: match[1] || null } : null;
  }

  // Pure decision over a snapshot of surfaces. A surface: { kind: 'banner'|'answer', text }.
  function evaluate({ surfaces = [], stopVisible = false, textGrowing = false, retryVisible = false } = {}) {
    for (const surface of surfaces) {
      const text = normalize(surface?.text);
      if (!text) continue;
      const kind = surface.kind === 'answer' ? 'answer' : 'banner';
      const limit = kind === 'answer' ? MAX_ANSWER_LENGTH : MAX_SURFACE_LENGTH;
      if (text.length > limit) continue;
      if (!matchesLimit(text)) continue;
      if (kind === 'answer' && (stopVisible || textGrowing || !retryVisible)) continue;
      const resetAt = resetTimeOf(text);
      return { detected: true, reason: REASON, reasonCode: reasonOf(resetAt), resetAt, kind, text: text.slice(0, 300) };
    }
    return { detected: false, reason: null, reasonCode: null, resetAt: null, kind: null, text: '' };
  }

  function isVisible(node) {
    if (!node) return false;
    try {
      const rects = typeof node.getClientRects === 'function' ? node.getClientRects() : null;
      if (rects && rects.length > 0) return true;
    } catch (_) { /* fall through */ }
    return node.offsetParent !== null;
  }

  function textOf(node) {
    return normalize(node?.innerText || node?.textContent || '');
  }

  // Collects the surfaces of a page: visible banners outside the answer turn, and the answer turn itself.
  function collectSurfaces(root = document, answerEl = null) {
    const scope = root || document;
    const surfaces = [];
    const seen = new Set();
    for (const selector of SURFACE_SELECTORS) {
      let nodes = [];
      try { nodes = Array.from(scope.querySelectorAll(selector)); } catch (_) { nodes = []; }
      for (const node of nodes) {
        if (seen.has(node)) continue;
        seen.add(node);
        if (answerEl && (node === answerEl || answerEl.contains?.(node) || node.contains?.(answerEl))) continue;
        if (!isVisible(node)) continue;
        const text = textOf(node);
        if (text && text.length <= MAX_SURFACE_LENGTH) surfaces.push({ kind: 'banner', text, selector });
      }
    }
    if (answerEl) surfaces.push({ kind: 'answer', text: textOf(answerEl) });
    return surfaces;
  }

  function retryVisibleIn(scope = document, answerEl = null) {
    const roots = [answerEl?.parentElement, answerEl, scope].filter(Boolean);
    for (const container of roots) {
      let buttons = [];
      try { buttons = Array.from(container.querySelectorAll('button,[role="button"]')).slice(0, 200); } catch (_) { buttons = []; }
      if (buttons.some((button) => isVisible(button) && RETRY_RE.test(textOf(button)))) return true;
    }
    return false;
  }

  // Page check for the lifecycle poll and the finalization. The caller says whether Stop is visible and whether the text grows.
  function detect({ root = document, answerEl = null, stopVisible = false, textGrowing = false } = {}) {
    const scope = root || (typeof document !== 'undefined' ? document : null);
    if (!scope) return evaluate({});
    const surfaces = collectSurfaces(scope, answerEl);
    return evaluate({
      surfaces,
      stopVisible: stopVisible === true,
      textGrowing: textGrowing === true,
      retryVisible: retryVisibleIn(scope, answerEl)
    });
  }

  return Object.freeze({
    REASON,
    LIMIT_PATTERNS,
    evaluate,
    detect,
    reasonOf,
    parseReason,
    resetTimeOf,
    collectSurfaces
  });
});
