// shared/answer-content-classifier.js
// Classifies extracted answer text into a content class so terminal-eligibility is
// decided by *what the text is*, not a blunt `length >= 20` threshold (review P1.3).
// Pure + stateless: streaming-aware classes (partial_stream) are decided by the
// lifecycle layer, not here.

(function initAnswerContentClassifier(root) {
  'use strict';

  const CLASSES = Object.freeze({
    EMPTY: 'empty',
    PROMPT_ECHO: 'prompt_echo',
    UI_NOISE: 'ui_noise',
    TECHNICAL_MESSAGE: 'technical_message',
    PROVIDER_ERROR: 'provider_error',
    SHORT_VALID: 'short_valid',
    VALID: 'valid'
  });

  // Eligible-for-terminal classes. prompt_echo / ui_noise / technical_message /
  // provider_error / empty
  // are NOT eligible — they must not be finalized as a SUCCESS answer.
  const TERMINAL_ELIGIBLE = new Set([CLASSES.VALID, CLASSES.SHORT_VALID]);

  const DEFAULT_MIN_VALID = 20;

  // Short UI strings that are not answers (button/label/model-name noise).
  const UI_NOISE_PATTERNS = [
    /^(copy|copied|share|regenerate|retry|stop|edit|continue|good response|bad response)\b/i,
    /^(claude|gpt|gpt-?\d|chatgpt|gemini|grok|qwen|deepseek|perplexity|le ?chat|mistral|z\.?ai)(\s+(opus|sonnet|haiku|pro|max|mini|turbo|flash|nano|air|plus|preview|thinking|\d[\w.\-]*)){0,3}$/i,
    /^(thinking|generating|loading|searching|reasoning)\b[.…]*$/i,
    /^(send a message|ask anything|message .+)$/i,
    // Prompt scaffolding can be rendered in/near a provider composer and must never
    // become a short "answer" when broad DOM fallbacks scan the page.
    /^(?:ссылайся на следующее содержимое|(?:please\s+)?(?:refer|base (?:the )?answer) (?:to|on) the following (?:content|context))\s*[:：]?$/i
  ];

  // Internal adapter/runtime diagnostics. These strings describe delivery of a
  // prompt, not the provider's answer, and must never be committed as answer text.
  const TECHNICAL_MESSAGE_PATTERNS = [
    /^error:\s*.{0,64}\b(?:send|submission|prompt submission)\s+(?:was\s+)?not confirmed\b/i,
    /^error:\s*(?:empty answer received|extracted text is prompt\/ui scaffolding, not an answer|extracted answer matches original prompt)$/i,
    /^error:\s*(?:hard_timeout|automation_deadline|prompt_not_confirmed_before_round4)$/i,
    /^error:\s*(?:tab closed during generation|tab create failed\b|rate limit detected\b)/i,
    /^error:\s*perplexity file(?:-| )upload paywall\b/i,
    /^error:\s*(?:script_runtime_hard_stop(?:_|$)|.+_round4_gate_timeout(?:_|$))/i
  ];

  const INTERNAL_ERROR_PREFIX = /^(?:error|structural error):\s*/i;

  // Provider/runtime error surfaces that can be longer than the min length but are
  // not answers. Kept conservative to avoid misclassifying real answers that merely
  // discuss errors.
  const PROVIDER_ERROR_PATTERNS = [
    /\b(something went wrong|an error occurred|please try again|try again later)\b/i,
    /\b(rate ?limit|too many requests|you('|’)?ve reached your|usage limit|message limit)\b/i,
    /\b(network error|connection (error|lost)|failed to (fetch|generate|load))\b/i,
    /\b(service is (temporarily )?unavailable|we('|’)?re experiencing|capacity)\b/i,
    /\b(content (policy|violation)|unable to (continue|process)|i can('|’)?t help with that)\b/i,
    /\b(model|system|server|provider|service)\s+(is\s+)?(overloaded|busy|at capacity|unavailable|temporarily unavailable)\b/i,
    /\b(overloaded|temporarily unavailable|currently unavailable|high demand|heavy load|server is busy)\b/i,
    /\b(unable to (respond|answer|generate|complete)|can('|’)?t (respond|answer|generate|complete))\b/i,
    /\b(couldn('|’)?t (generate|complete)|failed to generate (a )?(response|answer))\b/i
  ];

  // Gemini shows the heading of its thinking and then its hidden page label; the answer starts
  // after the label. A short text that ends with the label holds only the thinking.
  const GEMINI_THINKING_ONLY = /^(?:.{0,120}\s)?(?:Ответ Gemini|Gemini said:?)$/i;

  function normalize(text) {
    return String(text || '').replace(/\s+/g, ' ').trim();
  }

  function isPromptEcho(normCandidate, normPrompt) {
    if (!normCandidate || !normPrompt) return false;
    const c = normCandidate.toLowerCase();
    const p = normPrompt.toLowerCase();
    if (c === p) return true;
    // Candidate is essentially the prompt with negligible extra text.
    if (c.includes(p) && c.length <= p.length * 1.15) return true;
    return false;
  }

  function isProviderErrorSurface(norm = '') {
    if (!PROVIDER_ERROR_PATTERNS.some((re) => re.test(norm))) return false;
    const startsLikeProviderSurface = /^(error[:\s-]*)?(the\s+)?(model|system|server|provider|service)\b/i.test(norm)
      || /^(something went wrong|an error occurred|please try again|try again later|we('|’)?re experiencing|server is busy|failed to generate)\b/i.test(norm)
      || /^model is currently at capacity\b/i.test(norm);
    if (startsLikeProviderSurface) return true;
    // Longer answers may legitimately discuss rate limits/capacity/try-again
    // behavior. Treat embedded provider-error phrases as fatal only while the
    // extracted text is still short enough to be a standalone provider surface.
    return norm.length < 220;
  }

  function classify(text, options = {}) {
    const minValid = Number(options.minValid || DEFAULT_MIN_VALID);
    const norm = normalize(text);
    const prompt = normalize(options.prompt || '');

    if (!norm) {
      return decide(CLASSES.EMPTY, norm, { reason: 'empty' });
    }
    if (isPromptEcho(norm, prompt)) {
      return decide(CLASSES.PROMPT_ECHO, norm, { reason: 'prompt_echo' });
    }
    if (options.internalError === true && INTERNAL_ERROR_PREFIX.test(norm)) {
      return decide(CLASSES.TECHNICAL_MESSAGE, norm, { reason: 'explicit_internal_error' });
    }
    if (TECHNICAL_MESSAGE_PATTERNS.some((re) => re.test(norm))) {
      return decide(CLASSES.TECHNICAL_MESSAGE, norm, { reason: 'adapter_transport_diagnostic' });
    }
    if (isProviderErrorSurface(norm)) {
      return decide(CLASSES.PROVIDER_ERROR, norm, { reason: 'provider_error' });
    }
    if (GEMINI_THINKING_ONLY.test(norm)) {
      return decide(CLASSES.UI_NOISE, norm, { reason: 'gemini_thinking_only' });
    }
    if (norm.length < minValid) {
      // Short: either UI noise or a genuinely short answer ("Yes.", "Готово.").
      if (UI_NOISE_PATTERNS.some((re) => re.test(norm))) {
        return decide(CLASSES.UI_NOISE, norm, { reason: 'ui_noise_short' });
      }
      return decide(CLASSES.SHORT_VALID, norm, { reason: 'short_but_meaningful' });
    }
    // Length is adequate; still reject pure UI-noise strings that happen to be long.
    if (UI_NOISE_PATTERNS.some((re) => re.test(norm)) && norm.length < minValid * 3) {
      return decide(CLASSES.UI_NOISE, norm, { reason: 'ui_noise' });
    }
    return decide(CLASSES.VALID, norm, { reason: 'valid' });
  }

  function decide(contentClass, norm, extra = {}) {
    return {
      contentClass,
      terminalEligible: TERMINAL_ELIGIBLE.has(contentClass),
      length: norm.length,
      ...extra
    };
  }

  function isTerminalEligible(text, options = {}) {
    return classify(text, options).terminalEligible;
  }

  const api = Object.freeze({ CLASSES, classify, isTerminalEligible, TERMINAL_ELIGIBLE });
  root.AnswerContentClassifier = api;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
