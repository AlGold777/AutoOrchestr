(function () {
  const globalObject = typeof window !== 'undefined' ? window : self;
  globalObject.SelectorConfigRegistry = globalObject.SelectorConfigRegistry || {};
  if (globalObject.SelectorConfigRegistry.Qwen) return;

  globalObject.SelectorConfigRegistry.Qwen = {
    versions: [],
    emergencyFallbacks: {
      composer: [
        'textarea[aria-label*="question"]',
        'textarea',
        'div[role="textbox"]',
        '[contenteditable="true"]'
      ],
      sendButton: [
        'button[aria-label*="send" i]',
        'button[aria-label*="send message" i]',
        'button[aria-label*="submit" i]',
        'button[aria-label*="post" i]',
        'button[type="submit"]',
        'button[data-testid*="send"]',
        'div[role="button"][aria-label*="send" i]',
        'div[role="button"][data-testid*="send"]'
      ],
      response: [
        'div.qwen-chat-message.qwen-chat-message-assistant div.response-message-content div.custom-qwen-markdown > div.qwen-markdown.qwen-markdown-loose',
        'div.qwen-chat-message-assistant div.chat-response-message-right div.response-message-content div.custom-qwen-markdown .qwen-markdown.qwen-markdown-loose',
        'div.qwen-chat-message-assistant div.response-message-content',
        'div.qwen-chat-message-assistant div.custom-qwen-markdown',
        'div.qwen-markdown.qwen-markdown-loose',
        'div.qwen-chat-message.qwen-chat-message-assistant div.qwen-markdown.qwen-markdown-loose',
        'div.qwen-chat-message-assistant div.custom-qwen-markdown .qwen-markdown',
        '[data-testid="chat-response"] .qwen-markdown, [data-testid="chat-response"] .custom-qwen-markdown, [data-testid="chat-response"] .response-message-content'
      ]
    },
    observationDefaults: {
      rootSelector: 'main',
      targetSelectors: [
        'div.qwen-chat-message.qwen-chat-message-assistant div.response-message-content div.custom-qwen-markdown > div.qwen-markdown.qwen-markdown-loose',
        'div.qwen-chat-message-assistant div.chat-response-message-right div.response-message-content div.custom-qwen-markdown .qwen-markdown.qwen-markdown-loose',
        'div.qwen-chat-message-assistant div.response-message-content',
        'div.qwen-chat-message-assistant div.custom-qwen-markdown',
        'div.qwen-markdown.qwen-markdown-loose',
        'div.qwen-chat-message.qwen-chat-message-assistant div.qwen-markdown.qwen-markdown-loose',
        'div.qwen-chat-message-assistant div.custom-qwen-markdown .qwen-markdown',
        '[data-testid="chat-response"] .qwen-markdown, [data-testid="chat-response"] .custom-qwen-markdown, [data-testid="chat-response"] .response-message-content'
      ],
      stabilizationDelayMs: 1800,
      endGenerationMarkers: []
    }
  };
})();
