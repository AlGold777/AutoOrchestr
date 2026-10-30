(function () {
  const globalObject = typeof window !== 'undefined' ? window : self;
  globalObject.SelectorConfigRegistry = globalObject.SelectorConfigRegistry || {};
  if (globalObject.SelectorConfigRegistry.GPT) return;

  globalObject.SelectorConfigRegistry.GPT = {
    versions: [],
    emergencyFallbacks: {
      composer: [
        'textarea[data-id="root"]',
        'textarea[name="prompt"]',
        'textarea',
        'div[role="textbox"]',
        '[contenteditable="true"]'
      ],
      sendButton: [
        'button[data-testid="send-button"]',
        'button[aria-label*="Send"]',
        'button[type="submit"]',
        'button'
      ],
      response: [
        '[data-markdown-text-style="assistant-message"]',
        '[data-testid="conversation-panel"]',
        '[data-testid="conversation-container"]',
        '[data-testid="chat-history"]',
        '[data-testid="conversation-turn"][data-message-author-role="assistant"]',
        '[data-testid="conversation-turn"][data-author-role="assistant"]',
        '[data-testid="conversation-turn"][data-role="assistant"]',
        '[data-message-author-role="assistant"]',
        '[data-author-role="assistant"]',
        '[data-role="assistant"]',
        'main',
        'section'
      ]
    },
    // New ChatGPT markup (M-16): no data-message-author-role. Background reads this entry (self.SelectorConfigRegistry.GPT);
    // content scripts read the same values from content-scripts/answer-pipeline-selectors.js (chatgpt.newMarkup).
    newMarkup: {
      turnSelector: 'div[data-turn-key]',
      turnStateSelector: '[data-talvt-turn-state]',
      completeState: 'complete',
      answerSelector: 'div[data-markdown-text-style="assistant-message"]'
    },
    observationDefaults: {
      rootSelector: 'main',
      targetSelectors: [
        '[data-markdown-text-style="assistant-message"]',
        '[data-testid="conversation-panel"]',
        '[data-testid="chat-history"]',
        '.markdown',
        '.prose'
      ],
      stabilizationDelayMs: 1800,
      endGenerationMarkers: [
        { selector: '[data-testid="stop-button"]', type: 'disappear' }
      ]
    }
  };
})();
