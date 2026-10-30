// background/llm-targets.js
// LLM target configuration and URL match patterns.

'use strict';

const LLM_TARGETS = {
  'GPT': {
    url: 'https://chat.openai.com/',
    delay: 3000,
    queryPatterns: ['https://chat.openai.com/*', 'https://chatgpt.com/*']
  },
  'Gemini': {
    url: 'https://gemini.google.com/',
    delay: 3000,
    queryPatterns: ['https://gemini.google.com/*', 'https://bard.google.com/*']
  },
  'Claude': {
    url: 'https://claude.ai/chat/new',
    delay: 3000,
    queryPatterns: ['https://claude.ai/*']
  },
  'Grok': {
    url: 'https://grok.com/',
    delay: 3000,
    queryPatterns: ['https://grok.com/*', 'https://grok.x.ai/*', 'https://x.com/*', 'https://x.ai/*'],
    attachUrlAllowPrefixes: [
      'https://grok.com/',
      'https://grok.x.ai/',
      'https://x.com/i/grok',
      'https://x.com/i/grok/',
      'https://x.ai/'
    ]
  },
  'Le Chat': {
    url: 'https://chat.mistral.ai/chat/',
    delay: 3000,
    queryPatterns: ['https://chat.mistral.ai/*']
  },
  'Qwen': {
    url: 'https://chat.qwen.ai/',
    delay: 3000,
    queryPatterns: ['https://chat.qwen.ai/*']
  },
  'DeepSeek': {
    url: 'https://chat.deepseek.com/',
    delay: 3000,
    queryPatterns: ['https://chat.deepseek.com/*']
  },
  'Perplexity': {
    url: 'https://www.perplexity.ai/',
    delay: 3000,
    queryPatterns: ['https://www.perplexity.ai/*', 'https://perplexity.ai/*']
  },
  'Z.ai': {
    url: 'https://chat.z.ai/',
    delay: 3000,
    queryPatterns: ['https://chat.z.ai/*']
  },
  'Kimi': {
    url: 'https://www.kimi.ai/',
    delay: 3000,
    queryPatterns: ['https://kimi.ai/*', 'https://www.kimi.ai/*'],
    // Chat pages only: root ("/") or /chat/... . Other kimi.ai products (/make3d, ...) are not chat.
    chatPathPrefixes: ['/chat']
  }
};

// Keep patterns in sync with LLM_TARGETS.queryPatterns.
const LLM_URL_PATTERNS = (() => {
  const fallback = [
    '*://chat.openai.com/*',
    '*://chatgpt.com/*',
    '*://gemini.google.com/*',
    '*://claude.ai/*',
    '*://grok.com/*',
    '*://x.com/*',
    '*://chat.qwen.ai/*',
    '*://chat.deepseek.com/*',
    '*://www.perplexity.ai/*',
    '*://chat.mistral.ai/*',
    '*://chat.z.ai/*',
    '*://kimi.ai/*',
    '*://www.kimi.ai/*'
  ];
  try {
    const patterns = Object.values(LLM_TARGETS || {})
      .flatMap((entry) => {
        if (!entry?.queryPatterns) return [];
        return Array.isArray(entry.queryPatterns) ? entry.queryPatterns : [entry.queryPatterns];
      })
      .filter(Boolean)
      // Normalize https/http -> *:// for chrome.tabs.query match patterns.
      .map((pattern) => pattern.replace(/^https?:\/\//, '*://'));
    const unique = Array.from(new Set(patterns));
    return unique.length ? unique : fallback;
  } catch (err) {
    console.warn('[BACKGROUND] Failed to build LLM_URL_PATTERNS from LLM_TARGETS', err);
    return fallback;
  }
})();

self.LLM_TARGETS = LLM_TARGETS;
self.LLM_URL_PATTERNS = LLM_URL_PATTERNS;
