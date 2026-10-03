(function () {
  const globalObject = typeof window !== 'undefined' ? window : self;
  globalObject.SelectorConfigRegistry = globalObject.SelectorConfigRegistry || {};
  if (globalObject.SelectorConfigRegistry['Le Chat']) return;

  globalObject.SelectorConfigRegistry['Le Chat'] = {
    versions: [],
    emergencyFallbacks: {
      composer: [
        'textarea[aria-label*="prompt"]',
        'textarea[aria-label*="message"]',
        'textarea[placeholder*="message"]',
        'textarea[data-testid*="composer"]',
        'div[data-testid*="composer"] textarea',
        'div[data-testid*="composer"] [contenteditable="true"]',
        'div.ProseMirror',
        'div[class*="ProseMirror"]',
        'div[contenteditable="true"][data-placeholder]',
        'div[contenteditable="true"][role="textbox"]',
        'textarea',
        '[contenteditable="true"]',
        'div[role="textbox"]',
        'div[role="textbox"][contenteditable="true"]'
      ],
      sendButton: [
        'button[aria-label*="send" i]',
        'button[aria-label*="send message" i]',
        'button[aria-label*="submit" i]',
        'button[aria-label*="post" i]',
        'button[type="submit"]',
        'button:has(svg[data-icon="send"])',
        'button[data-testid*="send"]',
        'div[role="button"][aria-label*="send" i]',
        'div[role="button"][data-testid*="send"]',
        'button'
      ],
      response: [
        '[data-message-author-role="assistant"] [data-message-part-type="answer"]',
        'main article',
        '.chat-response',
        '.prose',
        '[data-testid*="assistant"] article',
        'main'
      ]
    },
    observationDefaults: {
      rootSelector: 'main',
      targetSelectors: [
        '[data-message-author-role="assistant"] [data-message-part-type="answer"]',
        '.chat-response',
        'main article',
        '.prose',
        '[data-testid*="assistant"] article'
      ],
      stabilizationDelayMs: 1800,
      endGenerationMarkers: [
        { selector: '[aria-busy="true"]', type: 'disappear' }
      ]
    }
  };
})();
