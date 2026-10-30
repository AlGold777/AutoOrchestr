// shared/page-blocker-policy.js
// Normalizes page readiness blockers and maps them to dispatch actions.

(function initPageBlockerPolicy(root) {
  'use strict';

  const ALIASES = Object.freeze({
    login_required: 'auth_required',
    required_login: 'auth_required',
    auth: 'auth_required',
    captcha_required: 'captcha',
    captcha_detected: 'captcha',
    rate_limit: 'rate_limited',
    rate_limit_detected: 'rate_limited',
    wrong_page: 'wrong_page',
    page_not_ready: 'page_not_ready',
    not_ready: 'page_not_ready',
    composer_missing: 'composer_missing',
    composer_not_ready: 'composer_not_ready',
    unsupported_page: 'unknown_layout',
    layout_unknown: 'unknown_layout',
    blocked: 'provider_error'
  });

  const POLICY = Object.freeze({
    auth_required: { action: 'terminal_user_action_required', terminal: true, retryable: false },
    captcha: { action: 'terminal_user_action_required', terminal: true, retryable: false },
    rate_limited: { action: 'retry_after_or_error', terminal: false, retryable: true },
    consent_modal: { action: 'soft_recoverable', terminal: false, retryable: true },
    provider_error: { action: 'recoverable_with_budget', terminal: false, retryable: true },
    network_offline: { action: 'recoverable_with_budget', terminal: false, retryable: true },
    model_unavailable: { action: 'retry_after_or_error', terminal: false, retryable: true },
    conversation_limit: { action: 'terminal_user_action_required', terminal: true, retryable: false },
    unsafe_prompt_modal: { action: 'terminal_user_action_required', terminal: true, retryable: false },
    unknown_layout: { action: 'selector_health_degraded', terminal: false, retryable: true },
    wrong_page: { action: 'terminal_user_action_required', terminal: true, retryable: false },
    page_not_ready: { action: 'wait_retry', terminal: false, retryable: true },
    composer_missing: { action: 'wait_retry', terminal: false, retryable: true },
    composer_not_ready: { action: 'wait_retry', terminal: false, retryable: true }
  });

  function normalize(blocker) {
    const value = String(blocker || '').trim().toLowerCase();
    return ALIASES[value] || value || null;
  }

  function classify(input = {}) {
    const candidates = [];
    if (input.status) candidates.push(input.status);
    if (input.reason) candidates.push(input.reason);
    if (Array.isArray(input.blockers)) candidates.push(...input.blockers);
    const normalized = candidates.map(normalize).filter(Boolean);
    const blocker = normalized.find((item) => POLICY[item]) || normalized[0] || null;
    const policy = blocker && POLICY[blocker] ? POLICY[blocker] : null;
    return {
      blocker,
      normalizedBlockers: normalized,
      action: policy?.action || 'unknown',
      terminal: !!policy?.terminal,
      retryable: policy ? !!policy.retryable : true
    };
  }

  // A page in the tab's address that is a check, not the provider's chat: Google's CAPTCHA ("/sorry/" on google.*).
  // Decided from the URL alone, because the provider's content script does not run on that page.
  function classifyUrl(url) {
    let parsed = null;
    try { parsed = new URL(String(url || '')); } catch (_) { return null; }
    if (/^(?:[a-z0-9-]+\.)*google\.(?:com?\.)?[a-z]{2,3}$/i.test(parsed.hostname) && parsed.pathname.startsWith('/sorry/')) return 'captcha_required';
    return null;
  }

  const api = Object.freeze({
    POLICY,
    normalize,
    classify,
    classifyUrl
  });

  root.PageBlockerPolicy = api;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
