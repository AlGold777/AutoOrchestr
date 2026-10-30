(function () {
  const globalObject = typeof window !== 'undefined' ? window : self;
  globalObject.SelectorConfigRegistry = globalObject.SelectorConfigRegistry || {};
  if (globalObject.SelectorConfigRegistry.Claude) return;

  globalObject.SelectorConfigRegistry.Claude = {
    versions: [],
    emergencyFallbacks: {
      composer: [
        'textarea[data-testid="chat-input"]',
        'textarea',
        'div[role="textbox"]',
        '[contenteditable="true"]'
      ],
      sendButton: [
        'button[data-testid="send-button"]',
        'button[aria-label*="Send"]',
        'button[type="submit"]'
      ],
      //-- 1.1. Берём именно ПОСЛЕДНИЙ ответ ассистента Claude --//
      response: [
        'div[data-testid="conversation-turn"][data-author-role="assistant"] div.standard-markdown.grid-cols-1',
        'div[data-testid="conversation-turn"][data-role="assistant"] div.standard-markdown.grid-cols-1',
        'div[data-is-response="true"] div.font-claude-response.relative div.standard-markdown.grid-cols-1',
        'div[data-is-response="true"] div.standard-markdown.grid-cols-1',
        'div[data-testid="conversation-turn"][data-author-role="assistant"] [data-testid="message-text"]:not([data-testid*="thinking" i]):not([data-testid*="thought" i]):not([data-testid*="reason" i]):not([data-testid*="analysis" i]):not([data-testid*="scratch" i]):not([data-testid*="work" i]):not([data-testid*="step" i]):not([data-testid*="draft" i]):not([data-testid*="trace" i]):not([data-testid*="internal" i]):not([data-testid*="reflection" i])',
        'div[data-testid="conversation-turn"][data-role="assistant"] [data-testid="message-text"]:not([data-testid*="thinking" i]):not([data-testid*="thought" i]):not([data-testid*="reason" i]):not([data-testid*="analysis" i]):not([data-testid*="scratch" i]):not([data-testid*="work" i]):not([data-testid*="step" i]):not([data-testid*="draft" i]):not([data-testid*="trace" i]):not([data-testid*="internal" i]):not([data-testid*="reflection" i])',
        'div[data-is-response="true"] [data-testid="message-text"]:not([data-testid*="thinking" i]):not([data-testid*="thought" i]):not([data-testid*="reason" i]):not([data-testid*="analysis" i]):not([data-testid*="scratch" i]):not([data-testid*="work" i]):not([data-testid*="step" i]):not([data-testid*="draft" i]):not([data-testid*="trace" i]):not([data-testid*="internal" i]):not([data-testid*="reflection" i])',
        'div[data-testid="conversation-turn"][data-author-role="assistant"] article:not([data-testid*="thinking" i]):not([data-testid*="thought" i]):not([data-testid*="reason" i]):not([data-testid*="analysis" i]):not([data-testid*="scratch" i]):not([data-testid*="work" i]):not([data-testid*="step" i]):not([data-testid*="draft" i]):not([data-testid*="trace" i]):not([data-testid*="internal" i]):not([data-testid*="reflection" i])',
        'div[data-testid="conversation-turn"][data-role="assistant"] article:not([data-testid*="thinking" i]):not([data-testid*="thought" i]):not([data-testid*="reason" i]):not([data-testid*="analysis" i]):not([data-testid*="scratch" i]):not([data-testid*="work" i]):not([data-testid*="step" i]):not([data-testid*="draft" i]):not([data-testid*="trace" i]):not([data-testid*="internal" i]):not([data-testid*="reflection" i])',
        'div[data-is-response="true"] article:not([data-testid*="thinking" i]):not([data-testid*="thought" i]):not([data-testid*="reason" i]):not([data-testid*="analysis" i]):not([data-testid*="scratch" i]):not([data-testid*="work" i]):not([data-testid*="step" i]):not([data-testid*="draft" i]):not([data-testid*="trace" i]):not([data-testid*="internal" i]):not([data-testid*="reflection" i])',
        'div[data-testid="conversation-turn"][data-author-role="assistant"]:not([data-testid*="thinking" i]):not([data-testid*="thought" i]):not([data-testid*="reason" i]):not([data-testid*="analysis" i]):not([data-testid*="scratch" i]):not([data-testid*="work" i]):not([data-testid*="step" i]):not([data-testid*="draft" i]):not([data-testid*="trace" i]):not([data-testid*="internal" i]):not([data-testid*="reflection" i])',
        'div[data-testid="conversation-turn"][data-role="assistant"]:not([data-testid*="thinking" i]):not([data-testid*="thought" i]):not([data-testid*="reason" i]):not([data-testid*="analysis" i]):not([data-testid*="scratch" i]):not([data-testid*="work" i]):not([data-testid*="step" i]):not([data-testid*="draft" i]):not([data-testid*="trace" i]):not([data-testid*="internal" i]):not([data-testid*="reflection" i])',
        'div[data-is-response="true"]:not([data-testid*="thinking" i]):not([data-testid*="thought" i]):not([data-testid*="reason" i]):not([data-testid*="analysis" i]):not([data-testid*="scratch" i]):not([data-testid*="work" i]):not([data-testid*="step" i]):not([data-testid*="draft" i]):not([data-testid*="trace" i]):not([data-testid*="internal" i]):not([data-testid*="reflection" i])',
        'div[data-is-response="true"]:last-of-type div.font-claude-response.relative div.standard-markdown.grid-cols-1',
        'div[data-is-response="true"]:last-of-type div.standard-markdown.grid-cols-1',
        'div[data-testid="conversation-turn"][data-role="assistant"]:last-of-type div.standard-markdown.grid-cols-1',
        'div[data-testid="conversation-turn"][data-author-role="assistant"]:last-of-type div.standard-markdown.grid-cols-1',
        'div[data-is-response="true"]:last-of-type [data-testid="message-text"]:not([data-testid*="thinking" i]):not([data-testid*="thought" i]):not([data-testid*="reason" i]):not([data-testid*="analysis" i]):not([data-testid*="scratch" i]):not([data-testid*="work" i]):not([data-testid*="step" i]):not([data-testid*="draft" i]):not([data-testid*="trace" i]):not([data-testid*="internal" i]):not([data-testid*="reflection" i])',
        'div[data-is-response="true"]:last-of-type article:not([data-testid*="thinking" i]):not([data-testid*="thought" i]):not([data-testid*="reason" i]):not([data-testid*="analysis" i]):not([data-testid*="scratch" i]):not([data-testid*="work" i]):not([data-testid*="step" i]):not([data-testid*="draft" i]):not([data-testid*="trace" i]):not([data-testid*="internal" i]):not([data-testid*="reflection" i])',
        'div[data-is-response="true"]:last-of-type:not([data-testid*="thinking" i]):not([data-testid*="thought" i]):not([data-testid*="reason" i]):not([data-testid*="analysis" i]):not([data-testid*="scratch" i]):not([data-testid*="work" i]):not([data-testid*="step" i]):not([data-testid*="draft" i]):not([data-testid*="trace" i]):not([data-testid*="internal" i]):not([data-testid*="reflection" i])',
        'div[data-testid="conversation-turn"][data-role="assistant"]:last-of-type [data-testid="message-text"]:not([data-testid*="thinking" i]):not([data-testid*="thought" i]):not([data-testid*="reason" i]):not([data-testid*="analysis" i]):not([data-testid*="scratch" i]):not([data-testid*="work" i]):not([data-testid*="step" i]):not([data-testid*="draft" i]):not([data-testid*="trace" i]):not([data-testid*="internal" i]):not([data-testid*="reflection" i])',
        'div[data-testid="conversation-turn"][data-author-role="assistant"]:last-of-type [data-testid="message-text"]:not([data-testid*="thinking" i]):not([data-testid*="thought" i]):not([data-testid*="reason" i]):not([data-testid*="analysis" i]):not([data-testid*="scratch" i]):not([data-testid*="work" i]):not([data-testid*="step" i]):not([data-testid*="draft" i]):not([data-testid*="trace" i]):not([data-testid*="internal" i]):not([data-testid*="reflection" i])',
        'div[data-testid="conversation-turn"][data-role="assistant"]:last-of-type article:not([data-testid*="thinking" i]):not([data-testid*="thought" i]):not([data-testid*="reason" i]):not([data-testid*="analysis" i]):not([data-testid*="scratch" i]):not([data-testid*="work" i]):not([data-testid*="step" i]):not([data-testid*="draft" i]):not([data-testid*="trace" i]):not([data-testid*="internal" i]):not([data-testid*="reflection" i])',
        'div[data-testid="conversation-turn"][data-author-role="assistant"]:last-of-type:not([data-testid*="thinking" i]):not([data-testid*="thought" i]):not([data-testid*="reason" i]):not([data-testid*="analysis" i]):not([data-testid*="scratch" i]):not([data-testid*="work" i]):not([data-testid*="step" i]):not([data-testid*="draft" i]):not([data-testid*="trace" i]):not([data-testid*="internal" i]):not([data-testid*="reflection" i])',
        '[data-testid="chat-response"]:not([data-testid*="thinking" i]):not([data-testid*="thought" i]):not([data-testid*="reason" i]):not([data-testid*="analysis" i]):not([data-testid*="scratch" i]):not([data-testid*="work" i]):not([data-testid*="step" i]):not([data-testid*="draft" i]):not([data-testid*="trace" i]):not([data-testid*="internal" i]):not([data-testid*="reflection" i])'
      ]
    },
    observationDefaults: {
      rootSelector: 'main',
      targetSelectors: [
        'div[data-testid="conversation-turn"][data-author-role="assistant"] div.standard-markdown.grid-cols-1',
        'div[data-testid="conversation-turn"][data-role="assistant"] div.standard-markdown.grid-cols-1',
        'div[data-is-response="true"] div.font-claude-response.relative div.standard-markdown.grid-cols-1',
        'div[data-is-response="true"] div.standard-markdown.grid-cols-1',
        'div[data-is-response="true"]:last-of-type div.font-claude-response.relative div.standard-markdown.grid-cols-1',
        'div[data-is-response="true"]:last-of-type div.standard-markdown.grid-cols-1',
        'div[data-testid="conversation-turn"][data-role="assistant"]:last-of-type div.standard-markdown.grid-cols-1',
        'div[data-testid="conversation-turn"][data-author-role="assistant"]:last-of-type div.standard-markdown.grid-cols-1',
        'div[data-is-response="true"]:last-of-type [data-testid="message-text"]:not([data-testid*="thinking" i]):not([data-testid*="thought" i]):not([data-testid*="reason" i]):not([data-testid*="analysis" i]):not([data-testid*="scratch" i]):not([data-testid*="work" i]):not([data-testid*="step" i]):not([data-testid*="draft" i]):not([data-testid*="trace" i]):not([data-testid*="internal" i]):not([data-testid*="reflection" i])',
        'div[data-is-response="true"]:last-of-type article:not([data-testid*="thinking" i]):not([data-testid*="thought" i]):not([data-testid*="reason" i]):not([data-testid*="analysis" i]):not([data-testid*="scratch" i]):not([data-testid*="work" i]):not([data-testid*="step" i]):not([data-testid*="draft" i]):not([data-testid*="trace" i]):not([data-testid*="internal" i]):not([data-testid*="reflection" i])',
        'div[data-testid="conversation-turn"][data-role="assistant"]:last-of-type [data-testid="message-text"]:not([data-testid*="thinking" i]):not([data-testid*="thought" i]):not([data-testid*="reason" i]):not([data-testid*="analysis" i]):not([data-testid*="scratch" i]):not([data-testid*="work" i]):not([data-testid*="step" i]):not([data-testid*="draft" i]):not([data-testid*="trace" i]):not([data-testid*="internal" i]):not([data-testid*="reflection" i])',
        'div[data-testid="conversation-turn"][data-author-role="assistant"]:last-of-type [data-testid="message-text"]:not([data-testid*="thinking" i]):not([data-testid*="thought" i]):not([data-testid*="reason" i]):not([data-testid*="analysis" i]):not([data-testid*="scratch" i]):not([data-testid*="work" i]):not([data-testid*="step" i]):not([data-testid*="draft" i]):not([data-testid*="trace" i]):not([data-testid*="internal" i]):not([data-testid*="reflection" i])',
        'div[data-testid="conversation-turn"][data-role="assistant"]:last-of-type article:not([data-testid*="thinking" i]):not([data-testid*="thought" i]):not([data-testid*="reason" i]):not([data-testid*="analysis" i]):not([data-testid*="scratch" i]):not([data-testid*="work" i]):not([data-testid*="step" i]):not([data-testid*="draft" i]):not([data-testid*="trace" i]):not([data-testid*="internal" i]):not([data-testid*="reflection" i])',
        'div[data-testid="conversation-turn"][data-author-role="assistant"]:last-of-type:not([data-testid*="thinking" i]):not([data-testid*="thought" i]):not([data-testid*="reason" i]):not([data-testid*="analysis" i]):not([data-testid*="scratch" i]):not([data-testid*="work" i]):not([data-testid*="step" i]):not([data-testid*="draft" i]):not([data-testid*="trace" i]):not([data-testid*="internal" i]):not([data-testid*="reflection" i])',
        '[data-testid="chat-response"]:not([data-testid*="thinking" i]):not([data-testid*="thought" i]):not([data-testid*="reason" i]):not([data-testid*="analysis" i]):not([data-testid*="scratch" i]):not([data-testid*="work" i]):not([data-testid*="step" i]):not([data-testid*="draft" i]):not([data-testid*="trace" i]):not([data-testid*="internal" i]):not([data-testid*="reflection" i])'
      ],
      stabilizationDelayMs: 1800,
      endGenerationMarkers: []
    }
  };
})();
