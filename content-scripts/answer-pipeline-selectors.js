(function initAnswerPipelineSelectors() {
  if (window.AnswerPipelineSelectors) return;

  const detectPlatform = () => {
    const h = (location.hostname || '').toLowerCase();
    if (h.includes('chatgpt') || h.includes('openai')) return 'chatgpt';
    if (h.includes('claude.ai')) return 'claude';
    if (h.includes('gemini.google') || h.includes('bard.google')) return 'gemini';
    if (h.includes('grok.com') || h.includes('grok.x.ai') || h.includes('x.ai') || h === 'x.com') return 'grok';
    if (h.includes('perplexity.ai')) return 'perplexity';
    if (h.includes('deepseek')) return 'deepseek';
    if (h.includes('qwen')) return 'qwen';
    if (h.includes('mistral')) return 'lechat';
    if (h === 'chat.z.ai') return 'zai';
    if (h === 'kimi.ai' || h.endsWith('.kimi.ai')) return 'kimi';
    return 'generic';
  };

  const COPY_BUTTON_SELECTORS = [
    'button[aria-label*="Copy" i]',
    'button[title*="Copy" i]',
    'button[data-testid*="copy" i]',
    '[role="button"][aria-label*="Copy" i]',
    '[role="button"][title*="Copy" i]',
    '[data-testid*="copy" i]',
    '[aria-label*="Copy response" i]',
    '[aria-label*="Copy answer" i]',
    '[aria-label*="Копировать" i]',
    'button[class*="copy" i]'
  ];

  const PLATFORM_SELECTORS = {
    chatgpt: {
      messageRoot: '[data-markdown-text-style="assistant-message"], [data-testid="conversation-turn"][data-message-author-role="assistant"], [data-testid="conversation-turn"][data-author-role="assistant"], [data-testid="conversation-turn"][data-role="assistant"], [data-message-author-role="assistant"], [data-author-role="assistant"], [data-role="assistant"]',
      answerContainer: '[data-testid=\"conversation-panel\"], [data-testid=\"conversation-container\"], main, [data-testid=\"conversation-turn\"]',
      lastMessage: [
        '[data-markdown-text-style="assistant-message"]',
        '[data-testid=\"conversation-turn\"][data-message-author-role=\"assistant\"]',
        '[data-testid=\"conversation-turn\"][data-author-role=\"assistant\"]',
        '[data-testid=\"conversation-turn\"][data-role=\"assistant\"]',
        '[data-message-author-role=\"assistant\"]',
        '[data-author-role=\"assistant\"]',
        '[data-role=\"assistant\"]'
      ].join(', '),
      streamStart: [
        '[data-markdown-text-style="assistant-message"]',
        '[data-testid=\"conversation-turn\"][data-message-author-role=\"assistant\"]',
        '[data-testid=\"conversation-turn\"][data-author-role=\"assistant\"]',
        '[data-testid=\"conversation-turn\"][data-role=\"assistant\"]',
        '[data-message-author-role=\"assistant\"]',
        '[data-author-role=\"assistant\"]',
        '[data-role=\"assistant\"]',
        '.agent-turn'
      ],
      generatingIndicators: [
        'button[aria-label*=\"Stop\" i]:not([disabled]):not([aria-disabled=\"true\"]):not([aria-hidden=\"true\"])',
        'button[data-testid=\"stop-button\"]:not([disabled]):not([aria-disabled=\"true\"])',
        'button[data-testid*=\"stop\"]:not([disabled]):not([aria-disabled=\"true\"])'
      ],
      completionIndicators: [
        'button[data-testid=\"regenerate-button\"]',
        'button[aria-label*=\"Regenerate\" i]',
        'button[aria-label*=\"Continue\" i]',
        'button[data-testid*=\"continue\"]',
        'button[data-testid*=\"regenerate\"]',
        'button[data-testid*=\"composer-send-button\"]:not([disabled]):not([aria-disabled=\"true\"])',
        'button[data-testid*=\"send-button\"]:not([disabled]):not([aria-disabled=\"true\"])',
        'button[aria-label*=\"Send\" i]:not([disabled]):not([aria-disabled=\"true\"])'
      ],
      stopButton: 'button[aria-label*=\"Stop\" i], button[data-testid=\"stop-button\"], button[data-testid*=\"stop\"]',
      copyButton: COPY_BUTTON_SELECTORS
    },
    claude: {
      messageRoot: 'div[data-is-streaming], div[data-testid="conversation-turn"][data-author-role="assistant"], div[data-testid="conversation-turn"][data-role="assistant"], div[data-is-response="true"], [data-testid="assistant-message"], [data-testid="assistant-response"]',
      answerContainer: '[data-testid=\"conversation-content\"], [data-testid*=\"conversation\"], [class*=\"conversation\" i], main, [role=\"main\"]',
      lastMessage: [
        'div[data-is-streaming] div.font-claude-response.relative div.standard-markdown.grid-cols-1',
        'div[data-is-streaming] div.standard-markdown.grid-cols-1',
        'div.font-claude-response.relative div.standard-markdown.grid-cols-1',
        'div[data-testid=\"conversation-turn\"][data-author-role=\"assistant\"] div.standard-markdown.grid-cols-1',
        'div[data-testid=\"conversation-turn\"][data-role=\"assistant\"] div.standard-markdown.grid-cols-1',
        'div[data-is-response=\"true\"] div.font-claude-response.relative div.standard-markdown.grid-cols-1',
        'div[data-is-response=\"true\"] div.standard-markdown.grid-cols-1',
        'div[data-testid=\"conversation-turn\"][data-author-role=\"assistant\"] [data-testid=\"message-text\"]:not([data-testid*=\"thinking\" i]):not([data-testid*=\"thought\" i]):not([data-testid*=\"reason\" i]):not([data-testid*=\"analysis\" i]):not([data-testid*=\"scratch\" i]):not([data-testid*=\"work\" i]):not([data-testid*=\"step\" i]):not([data-testid*=\"draft\" i]):not([data-testid*=\"trace\" i]):not([data-testid*=\"internal\" i]):not([data-testid*=\"reflection\" i])',
        'div[data-testid=\"conversation-turn\"][data-role=\"assistant\"] [data-testid=\"message-text\"]:not([data-testid*=\"thinking\" i]):not([data-testid*=\"thought\" i]):not([data-testid*=\"reason\" i]):not([data-testid*=\"analysis\" i]):not([data-testid*=\"scratch\" i]):not([data-testid*=\"work\" i]):not([data-testid*=\"step\" i]):not([data-testid*=\"draft\" i]):not([data-testid*=\"trace\" i]):not([data-testid*=\"internal\" i]):not([data-testid*=\"reflection\" i])',
        'div[data-is-response=\"true\"] [data-testid=\"message-text\"]:not([data-testid*=\"thinking\" i]):not([data-testid*=\"thought\" i]):not([data-testid*=\"reason\" i]):not([data-testid*=\"analysis\" i]):not([data-testid*=\"scratch\" i]):not([data-testid*=\"work\" i]):not([data-testid*=\"step\" i]):not([data-testid*=\"draft\" i]):not([data-testid*=\"trace\" i]):not([data-testid*=\"internal\" i]):not([data-testid*=\"reflection\" i])',
        'div[data-testid=\"conversation-turn\"][data-author-role=\"assistant\"] article:not([data-testid*=\"thinking\" i]):not([data-testid*=\"thought\" i]):not([data-testid*=\"reason\" i]):not([data-testid*=\"analysis\" i]):not([data-testid*=\"scratch\" i]):not([data-testid*=\"work\" i]):not([data-testid*=\"step\" i]):not([data-testid*=\"draft\" i]):not([data-testid*=\"trace\" i]):not([data-testid*=\"internal\" i]):not([data-testid*=\"reflection\" i])',
        'div[data-testid=\"conversation-turn\"][data-role=\"assistant\"] article:not([data-testid*=\"thinking\" i]):not([data-testid*=\"thought\" i]):not([data-testid*=\"reason\" i]):not([data-testid*=\"analysis\" i]):not([data-testid*=\"scratch\" i]):not([data-testid*=\"work\" i]):not([data-testid*=\"step\" i]):not([data-testid*=\"draft\" i]):not([data-testid*=\"trace\" i]):not([data-testid*=\"internal\" i]):not([data-testid*=\"reflection\" i])',
        'div[data-is-response=\"true\"] article:not([data-testid*=\"thinking\" i]):not([data-testid*=\"thought\" i]):not([data-testid*=\"reason\" i]):not([data-testid*=\"analysis\" i]):not([data-testid*=\"scratch\" i]):not([data-testid*=\"work\" i]):not([data-testid*=\"step\" i]):not([data-testid*=\"draft\" i]):not([data-testid*=\"trace\" i]):not([data-testid*=\"internal\" i]):not([data-testid*=\"reflection\" i])',
        'div[data-testid=\"conversation-turn\"][data-author-role=\"assistant\"]:not([data-testid*=\"thinking\" i]):not([data-testid*=\"thought\" i]):not([data-testid*=\"reason\" i]):not([data-testid*=\"analysis\" i]):not([data-testid*=\"scratch\" i]):not([data-testid*=\"work\" i]):not([data-testid*=\"step\" i]):not([data-testid*=\"draft\" i]):not([data-testid*=\"trace\" i]):not([data-testid*=\"internal\" i]):not([data-testid*=\"reflection\" i])',
        'div[data-testid=\"conversation-turn\"][data-role=\"assistant\"]:not([data-testid*=\"thinking\" i]):not([data-testid*=\"thought\" i]):not([data-testid*=\"reason\" i]):not([data-testid*=\"analysis\" i]):not([data-testid*=\"scratch\" i]):not([data-testid*=\"work\" i]):not([data-testid*=\"step\" i]):not([data-testid*=\"draft\" i]):not([data-testid*=\"trace\" i]):not([data-testid*=\"internal\" i]):not([data-testid*=\"reflection\" i])',
        'div[data-is-response=\"true\"]:not([data-testid*=\"thinking\" i]):not([data-testid*=\"thought\" i]):not([data-testid*=\"reason\" i]):not([data-testid*=\"analysis\" i]):not([data-testid*=\"scratch\" i]):not([data-testid*=\"work\" i]):not([data-testid*=\"step\" i]):not([data-testid*=\"draft\" i]):not([data-testid*=\"trace\" i]):not([data-testid*=\"internal\" i]):not([data-testid*=\"reflection\" i])',
        'div[data-is-response=\"true\"]:last-of-type div.font-claude-response.relative div.standard-markdown.grid-cols-1',
        'div[data-is-response=\"true\"]:last-of-type div.standard-markdown.grid-cols-1',
        'div[data-testid=\"conversation-turn\"][data-author-role=\"assistant\"]:last-of-type div.standard-markdown.grid-cols-1',
        'div[data-testid=\"conversation-turn\"][data-role=\"assistant\"]:last-of-type div.standard-markdown.grid-cols-1',
        'div[data-testid=\"conversation-turn\"][data-author-role=\"assistant\"]:last-of-type [data-testid=\"message-text\"]:not([data-testid*=\"thinking\" i]):not([data-testid*=\"thought\" i]):not([data-testid*=\"reason\" i]):not([data-testid*=\"analysis\" i]):not([data-testid*=\"scratch\" i]):not([data-testid*=\"work\" i]):not([data-testid*=\"step\" i]):not([data-testid*=\"draft\" i]):not([data-testid*=\"trace\" i]):not([data-testid*=\"internal\" i]):not([data-testid*=\"reflection\" i])',
        'div[data-testid=\"conversation-turn\"][data-role=\"assistant\"]:last-of-type [data-testid=\"message-text\"]:not([data-testid*=\"thinking\" i]):not([data-testid*=\"thought\" i]):not([data-testid*=\"reason\" i]):not([data-testid*=\"analysis\" i]):not([data-testid*=\"scratch\" i]):not([data-testid*=\"work\" i]):not([data-testid*=\"step\" i]):not([data-testid*=\"draft\" i]):not([data-testid*=\"trace\" i]):not([data-testid*=\"internal\" i]):not([data-testid*=\"reflection\" i])',
        'div[data-is-response=\"true\"]:last-of-type [data-testid=\"message-text\"]:not([data-testid*=\"thinking\" i]):not([data-testid*=\"thought\" i]):not([data-testid*=\"reason\" i]):not([data-testid*=\"analysis\" i]):not([data-testid*=\"scratch\" i]):not([data-testid*=\"work\" i]):not([data-testid*=\"step\" i]):not([data-testid*=\"draft\" i]):not([data-testid*=\"trace\" i]):not([data-testid*=\"internal\" i]):not([data-testid*=\"reflection\" i])',
        'div[data-testid=\"conversation-turn\"][data-author-role=\"assistant\"]:last-of-type article:not([data-testid*=\"thinking\" i]):not([data-testid*=\"thought\" i]):not([data-testid*=\"reason\" i]):not([data-testid*=\"analysis\" i]):not([data-testid*=\"scratch\" i]):not([data-testid*=\"work\" i]):not([data-testid*=\"step\" i]):not([data-testid*=\"draft\" i]):not([data-testid*=\"trace\" i]):not([data-testid*=\"internal\" i]):not([data-testid*=\"reflection\" i])',
        'div[data-testid=\"conversation-turn\"][data-role=\"assistant\"]:last-of-type article:not([data-testid*=\"thinking\" i]):not([data-testid*=\"thought\" i]):not([data-testid*=\"reason\" i]):not([data-testid*=\"analysis\" i]):not([data-testid*=\"scratch\" i]):not([data-testid*=\"work\" i]):not([data-testid*=\"step\" i]):not([data-testid*=\"draft\" i]):not([data-testid*=\"trace\" i]):not([data-testid*=\"internal\" i]):not([data-testid*=\"reflection\" i])',
        'div[data-is-response=\"true\"]:last-of-type article:not([data-testid*=\"thinking\" i]):not([data-testid*=\"thought\" i]):not([data-testid*=\"reason\" i]):not([data-testid*=\"analysis\" i]):not([data-testid*=\"scratch\" i]):not([data-testid*=\"work\" i]):not([data-testid*=\"step\" i]):not([data-testid*=\"draft\" i]):not([data-testid*=\"trace\" i]):not([data-testid*=\"internal\" i]):not([data-testid*=\"reflection\" i])',
        '[data-testid=\"assistant-message\"]:not([data-testid*=\"thinking\" i]):not([data-testid*=\"thought\" i]):not([data-testid*=\"reason\" i]):not([data-testid*=\"analysis\" i]):not([data-testid*=\"scratch\" i]):not([data-testid*=\"work\" i]):not([data-testid*=\"step\" i]):not([data-testid*=\"draft\" i]):not([data-testid*=\"trace\" i]):not([data-testid*=\"internal\" i]):not([data-testid*=\"reflection\" i])',
        '[data-testid=\"assistant-response\"]:not([data-testid*=\"thinking\" i]):not([data-testid*=\"thought\" i]):not([data-testid*=\"reason\" i]):not([data-testid*=\"analysis\" i]):not([data-testid*=\"scratch\" i]):not([data-testid*=\"work\" i]):not([data-testid*=\"step\" i]):not([data-testid*=\"draft\" i]):not([data-testid*=\"trace\" i]):not([data-testid*=\"internal\" i]):not([data-testid*=\"reflection\" i])',
        '[data-testid=\"chat-response\"]:not([data-testid*=\"thinking\" i]):not([data-testid*=\"thought\" i]):not([data-testid*=\"reason\" i]):not([data-testid*=\"analysis\" i]):not([data-testid*=\"scratch\" i]):not([data-testid*=\"work\" i]):not([data-testid*=\"step\" i]):not([data-testid*=\"draft\" i]):not([data-testid*=\"trace\" i]):not([data-testid*=\"internal\" i]):not([data-testid*=\"reflection\" i])'
      ].join(', '),
      streamStart: [
        '[data-testid=\"assistant-message\"]',
        'div[data-testid=\"conversation-turn\"][data-author-role=\"assistant\"]',
        'div[data-testid=\"conversation-turn\"][data-role=\"assistant\"]',
        'div[data-is-response=\"true\"]',
        '.font-claude-message',
        '[class*=\"font-claude\" i]'
      ],
      generatingIndicators: [
        'button[aria-label*=\"Stop\" i]',
        'button[data-testid*=\"stop\"]',
        '[data-testid=\"chat-loader\"]',
        '[data-testid=\"chat-spinner\"]',
        '[data-testid=\"typing\"]',
        '[data-is-streaming=\"true\"]',
        '[class*=\"streaming\" i]',
        '.typing-indicator',
        '.animate-pulse'
      ],
      completionIndicators: [
        'button[aria-label*=\"Regenerate\" i]',
        'button[aria-label*=\"Retry\" i]',
        'button[aria-label*=\"Continue\" i]',
        'button[data-testid*=\"regenerate\"]',
        'button[data-testid*=\"retry\"]',
        'button[data-testid*=\"continue\"]'
      ],
      stopButton: 'button[aria-label*=\"Stop\" i], button[data-testid*=\"stop\"]',
      copyButton: COPY_BUTTON_SELECTORS
    },
    gemini: {
      messageRoot: '[data-test-id*="model-response"], [data-testid*="model-response"], model-response, .model-response, [data-message-author-role="assistant"], [data-role="assistant"]',
      answerContainer: 'main, [role=\"main\"], [class*=\"conversation\" i]',
      lastMessage: [
        '[data-test-id*=\"model-response\"]',
        '[data-testid*=\"model-response\"]',
        '.model-response',
        'model-response',
        'message-content',
        '[data-message-author-role=\"assistant\"]',
        '[data-role=\"assistant\"]'
      ].join(', '),
      streamStart: ['[data-test-id*=\"model-response\"]', '[data-testid*=\"model-response\"]', '.model-response', 'model-response', 'message-content', '[data-message-author-role=\"assistant\"]', '[data-role=\"assistant\"]'],
      generatingIndicators: ['.loading', '[aria-busy=\"true\"]', '[data-is-loading=\"true\"]', '[data-loading=\"true\"]', '[data-streaming=\"true\"]'],
      completionIndicators: ['rich-textarea', 'textarea[aria-label*=\"Prompt\" i]', 'textarea[aria-label*=\"Message\" i]', 'textarea[aria-label*=\"Ask\" i]'],
      stopButton: 'button[aria-label*=\"Stop\" i]',
      copyButton: COPY_BUTTON_SELECTORS
    },
    grok: {
      messageRoot: 'div.message-bubble, [data-testid="grok-response"], [data-testid*="response"], [data-message-author-role="assistant"], [data-role="assistant"], article[data-role="assistant"]',
      answerContainer: 'main[role=\"main\"], [data-testid=\"conversation-container\"], [data-testid*=\"conversation\"], [role=\"log\"], main',
      lastMessage: [
        'div.message-bubble div.response-content-markdown',
        'div.relative.response-content-markdown',
        'div[data-testid=\"grok-response\"] .prose',
        'main [data-testid*=\"response\"] .prose',
        'main [data-testid*=\"thread\"] .prose',
        'section[data-testid*=\"response\"] .prose',
        'div[data-testid=\"grok-response\"] article',
        'main [data-testid*=\"response\"] article',
        'section[data-testid*=\"response\"]',
        '[data-message-author-role=\"assistant\"]',
        '[data-role=\"assistant\"]',
        'article[data-role=\"assistant\"]'
      ].join(', '),
      streamStart: ['div.message-bubble div.response-content-markdown', 'div.relative.response-content-markdown', '[data-testid=\"grok-response\"]', '[data-testid*=\"response\"]', '[data-message-author-role=\"assistant\"]', '[data-role=\"assistant\"]', 'article[data-role=\"assistant\"]'],
      generatingIndicators: ['.animate-pulse', '[aria-busy=\"true\"]', '[data-streaming=\"true\"]', '[data-generating=\"true\"]', '[class*=\"typing\" i]', '[class*=\"streaming\" i]', '.typing-indicator', 'button[aria-label*=\"Stop\" i]', '[data-testid*=\"loading\"]'],
      completionIndicators: ['[data-testid=\"grok-send-button\"]', 'button[data-testid=\"grok-send-button\"]:not([disabled])', 'button[aria-label*=\"Send\" i]:not([disabled])', 'textarea[role=\"textbox\"]'],
      stopButton: 'button[aria-label*=\"Stop\" i], button[data-testid=\"grok-stop-button\"]',
      copyButton: COPY_BUTTON_SELECTORS
    },
    perplexity: {
      messageRoot: '[id^="markdown-content-"], [data-testid="answer-card"], [data-testid="answer"], [data-testid*="response"], [data-testid="chat-message"], [data-testid="conversation-turn"], [class*="answer-container" i], article',
      answerContainer: 'main, [role=\"main\"], [data-testid=\"conversation-container\"], [data-testid=\"layout-wrapper\"], [class*=\"answer-container\" i], [data-testid*=\"answer\"], [data-testid*=\"response\"], article',
      lastMessage: [
        '[data-testid=\"answer-card\"]',
        '[data-testid=\"answer\"]',
        '[data-testid*=\"answer\"]',
        '[data-testid*=\"response\"]',
        '[class*=\"answer-container\" i] > :last-child',
        '[class*=\"answer-container\" i] .prose',
        '[data-testid=\"chat-message\"] .prose',
        '[data-testid=\"conversation-turn\"]',
        '.answer',
        '.prose',
        'article'
      ].join(', '),
      streamStart: [
        '[data-testid=\"answer-card\"]',
        '[data-testid=\"answer\"]',
        '[data-testid*=\"answer\"]',
        '[data-testid*=\"response\"]',
        '[class*=\"answer-container\" i]',
        '[data-testid=\"chat-message\"]',
        '[data-testid=\"conversation-turn\"]',
        '.answer',
        '.prose',
        'article'
      ],
      generatingIndicators: ['.loading-indicator', '[data-testid=\"loading-indicator\"]', '[aria-busy=\"true\"]', '[data-generating=\"true\"]', '[class*=\"streaming\" i]', 'button[aria-label*=\"Stop\" i]', '[data-testid=\"stop-button\"]'],
      completionIndicators: ['textarea[aria-label*=\"Ask\" i]', 'textarea[aria-label*=\"Search\" i]', 'textarea[aria-label*=\"Message\" i]', 'button[aria-label*=\"Ask\" i]', 'button[data-testid=\"send-button\"]:not([disabled])', 'button[type=\"submit\"]:not([disabled])'],
      stopButton: 'button[aria-label*=\"Stop\" i], button[data-testid=\"stop-button\"]',
      copyButton: COPY_BUTTON_SELECTORS
    },
    qwen: {
      messageRoot: 'div.qwen-chat-message.qwen-chat-message-assistant, div.qwen-chat-message-assistant, [data-testid="chat-response"], [data-message-type="assistant"], [data-role*="assistant"]',
      answerContainer: 'main, article',
      response: [
        'div.qwen-chat-message.qwen-chat-message-assistant div.response-message-content div.custom-qwen-markdown > div.qwen-markdown.qwen-markdown-loose',
        'div.qwen-chat-message-assistant div.chat-response-message-right div.response-message-content div.custom-qwen-markdown .qwen-markdown.qwen-markdown-loose',
        'div.response-message-content',
        'div.custom-qwen-markdown',
        'div.qwen-markdown.qwen-markdown-loose',
        'div.qwen-chat-message.qwen-chat-message-assistant div.qwen-markdown.qwen-markdown-loose',
        'div.qwen-chat-message-assistant div.custom-qwen-markdown .qwen-markdown',
        '[data-testid=\"chat-response\"] .qwen-markdown',
        '[data-testid=\"chat-response\"] .custom-qwen-markdown',
        '[data-testid=\"chat-response\"] .response-message-content'
      ].join(', '),
      lastMessage: [
        'div.qwen-chat-message.qwen-chat-message-assistant div.response-message-content div.custom-qwen-markdown > div.qwen-markdown.qwen-markdown-loose',
        'div.qwen-chat-message-assistant div.chat-response-message-right div.response-message-content div.custom-qwen-markdown .qwen-markdown.qwen-markdown-loose',
        'div.response-message-content',
        'div.custom-qwen-markdown',
        'div.qwen-markdown.qwen-markdown-loose',
        'div.qwen-chat-message.qwen-chat-message-assistant div.qwen-markdown.qwen-markdown-loose',
        'div.qwen-chat-message-assistant div.custom-qwen-markdown .qwen-markdown',
        '[data-testid=\"chat-response\"] .qwen-markdown',
        '[data-testid=\"chat-response\"] .custom-qwen-markdown',
        '[data-testid=\"chat-response\"] .response-message-content'
      ].join(', '),
      streamStart: [
        'div.qwen-chat-message.qwen-chat-message-assistant',
        '.qwen-chat-message-assistant',
        '[class*=\"qwen-chat-message-assistant\" i]',
        '[data-testid=\"chat-response\"]',
        '[data-testid*=\"message\"]',
        '[data-message-type=\"assistant\"]',
        '[data-role*=\"assistant\"]',
        '[data-testid*=\"assistant\"]',
        'article[data-role*=\"assistant\"]',
        'section[data-role*=\"assistant\"]',
        'main [role=\"article\"]',
        'main article',
        'main [class*=\"message\" i]',
        'div[class*=\"assistant-message\"]',
        'div.chat-response-message-right',
        '[class*=\"response\"]',
        '[class*=\"reply\"]',
        '.prose',
        'div[class*=\"markdown\"]',
        '[class*=\"markdown-body\"]'
      ],
      generatingIndicators: ['[data-testid=\"chat-loader\"]', '[aria-busy=\"true\"]', '.loading', '.spinner', '[data-streaming=\"true\"]', '[class*=\"streaming\" i]', '.typing-indicator', 'button[aria-label*=\"Stop\" i]'],
      completionIndicators: ['button[data-testid*=\"send\"]:not([disabled])', 'textarea[role=\"textbox\"]:not([disabled])'],
      stopButton: 'button[aria-label*=\"Stop\" i]',
      copyButton: COPY_BUTTON_SELECTORS
    },
    deepseek: {
      messageRoot: '.ds-markdown, .message-item[data-role="assistant"], [data-role="assistant"], [data-testid*="assistant"], [data-testid*="chat-response"], .assistant-message, [class*="message" i][class*="assistant" i]',
      answerContainer: 'main, [role=\"main\"], .chat-content, [class*=\"conversation\" i], [class*=\"chat\" i], article',
      lastMessage: [
        '.ds-markdown',
        '.message-item[data-role=\"assistant\"]',
        'div[class*=\"assistant\" i]',
        '[data-role=\"assistant\"]',
        '[data-testid*=\"assistant\"]',
        '[data-testid*=\"chat-response\"]',
        '[data-testid*=\"message\"]',
        '.assistant-message',
        '.message-content',
        '.markdown-body',
        '[class*=\"message\" i][class*=\"assistant\" i]',
        '[class*=\"response\" i]',
        'div[role=\"article\"]',
        'article',
        '.prose'
      ].join(', '),
      streamStart: ['.ds-markdown', '.message-item[data-role=\"assistant\"]', 'div[class*=\"assistant\" i]', '[data-role=\"assistant\"]', '[data-testid*=\"assistant\"]', '[data-testid*=\"chat-response\"]', '[data-testid*=\"message\"]', '.assistant-message', '.message-content', '.markdown-body', '[class*=\"message\" i][class*=\"assistant\" i]', '[class*=\"response\" i]', 'div[role=\"article\"]', 'article', '.prose'],
      generatingIndicators: ['[aria-busy=\"true\"]', '.loading', '[data-generating=\"true\"]', '[data-streaming=\"true\"]', '.typing-indicator', '.spinner', '.loader', '.animate-pulse', '[class*=\"streaming\" i]', '[data-testid*=\"loading\"]', 'button[aria-label*=\"Stop\" i]'],
      completionIndicators: ['textarea:not([disabled])', 'textarea[role=\"textbox\"]:not([disabled])', 'button[type=\"submit\"]:not([disabled])', 'button[aria-label*=\"Send\" i]:not([disabled])', 'button[data-testid*=\"send\"]:not([disabled])'],
      stopButton: 'button[aria-label*=\"Stop\" i]',
      copyButton: COPY_BUTTON_SELECTORS
    },
    lechat: {
      messageRoot: [
        'div[data-testid="lechat-response"]',
        '[data-testid="answer"]',
        '[data-testid*="assistant" i]',
        '[data-role="assistant"]',
        '[data-message-author-role="assistant"]',
        '.chat-response',
        '[class*="message" i][class*="assistant" i]',
        '[role="article"], article'
      ],
      answerContainer: 'main, article',
      lastMessage: [
        '[data-message-author-role="assistant"] [data-message-part-type="answer"]',
        '[data-role="assistant"] [data-message-part-type="answer"]',
        'div[data-testid=\"lechat-response\"] .prose',
        '[data-testid=\"answer\"] .prose',
        '[data-testid*=\"message-content\"]',
        'div[class*=\"message-content\"]',
        '[role=\"article\"] .prose',
        '[data-role=\"assistant\"]',
        '[data-message-author-role=\"assistant\"]',
        'article',
        '.prose'
      ].join(', '),
      streamStart: ['[data-message-author-role="assistant"] [data-message-part-type="answer"]', 'div[data-testid=\"lechat-response\"]', '[data-testid=\"answer\"]', '[data-testid*=\"message-content\"]', 'div[class*=\"message-content\"]', '[data-role=\"assistant\"]', '[data-message-author-role=\"assistant\"]', 'article', '.prose'],
      generatingIndicators: ['[aria-busy=\"true\"]', '.loading', '.animate-pulse', '.typing-indicator', '[class*=\"streaming\" i]', '[data-testid=\"generation\"]', '[data-testid*=\"loading\"]'],
      completionIndicators: ['button[type=\"submit\"]:not([disabled])', '[data-testid*=\"send\"]:not([disabled])', '[aria-label*=\"Send\" i]:not([disabled])', 'textarea[role=\"textbox\"]:not([disabled])'],
      stopButton: 'button[aria-label*=\"Stop\" i], button[aria-label*=\"Stop generation\" i], button[data-testid*=\"stop\" i], button[class*=\"stop\" i]',
      regenerateButton: 'button[aria-label*=\"Regenerate\" i], button[aria-label*=\"Try again\" i], button[data-testid*=\"regenerate\" i], button[class*=\"regenerate\" i], button:has-text(\"Regenerate\"), button:has-text(\"Try again\")',
      copyButton: COPY_BUTTON_SELECTORS
    },
    zai: {
      messageRoot: [
        '[id^="message-"]',
        '[data-message-author-role="assistant"]',
        '[data-role="assistant"]',
        '[data-testid*="assistant" i]',
        '[class*="assistant-message" i]',
        '[class*="message" i][class*="assistant" i]'
      ],
      answerContainer: '#chat-messages, [role="log"], body',
      lastMessage: [
        '[id^="message-"][id$="-start"].chat-assistant.markdown-prose',
        '[id^="message-"][id$="-start"]:not(.chat-user):not([data-role="user"]):not([data-message-author-role="user"])',
        '[id^="message-"].chat-assistant.markdown-prose',
        '[id^="message-"] .chat-assistant.markdown-prose',
        '.chat-assistant.markdown-prose',
        '[data-message-author-role="assistant"]', '[data-role="assistant"]',
        '[data-testid*="assistant"]', '[class*="assistant-message"]',
        '[class*="assistant"] [class*="markdown"]'
      ].join(', '),
      streamStart: ['.chat-assistant.markdown-prose', '[id^="message-"] .chat-assistant.markdown-prose', '[data-message-author-role="assistant"]', '[data-role="assistant"]', '[data-testid*="assistant"]', '[class*="assistant-message"]', '[class*="assistant"] [class*="markdown"]'],
      generatingIndicators: ['button[aria-label*="Stop" i]', '[data-generating="true"]', '[data-streaming="true"]', '[aria-busy="true"]', '.animate-pulse'],
      completionIndicators: ['#send-message-button:not([disabled])', 'textarea#chat-input:not([disabled])'],
      stopButton: 'button[aria-label*="Stop" i], button[class*="stop" i]',
      copyButton: COPY_BUTTON_SELECTORS
    },
    // Kimi renders the reasoning trace as its own block inside the assistant
    // turn, before the answer. Every answer selector here excludes thinking /
    // reasoning containers, otherwise the resolver settles on the trace — it is
    // the first thing that renders and the last thing that stops changing.
    kimi: {
      messageRoot: [
        '.segment-assistant',
        '[class*="segment-assistant" i]',
        '[data-message-author-role="assistant"]',
        '[data-role="assistant"]',
        '[class*="assistant-message" i]'
      ],
      answerContainer: '.chat-content-list, [role="log"], body',
      lastMessage: [
        `.segment-assistant .markdown-container:not([class*="think" i]):not([class*="thought" i]):not([class*="reason" i])`,
        `.chat-content-item-assistant .markdown-container:not([class*="think" i]):not([class*="thought" i]):not([class*="reason" i])`,
        `.segment-assistant [class*="markdown" i]:not([class*="think" i]):not([class*="thought" i]):not([class*="reason" i])`,
        '.segment-assistant',
        '[class*="segment-assistant" i]',
        '[data-message-author-role="assistant"]',
        '[data-role="assistant"]',
        `[class*="assistant" i] [class*="markdown" i]:not([class*="think" i]):not([class*="thought" i]):not([class*="reason" i])`
      ].join(', '),
      streamStart: [`.segment-assistant .markdown-container:not([class*="think" i]):not([class*="thought" i]):not([class*="reason" i])`, '.segment-assistant', `.markdown-container:not([class*="think" i]):not([class*="thought" i]):not([class*="reason" i])`, '[data-message-author-role="assistant"]', '[data-role="assistant"]'],
      generatingIndicators: ['.send-button-container.stop', '[data-generating="true"]', '[data-streaming="true"]', '[aria-busy="true"]', '.animate-pulse'],
      completionIndicators: ['.send-button-container:not(.stop)', '.chat-input-editor[contenteditable="true"]'],
      stopButton: '.send-button-container.stop, button[aria-label*="Stop" i], button[class*="stop" i]',
      copyButton: COPY_BUTTON_SELECTORS
    },
    generic: {
      messageRoot: '[data-message-author-role="assistant"], [data-role="assistant"], [role="article"], article',
      answerContainer: 'main, [role=\"main\"], article',
      lastMessage: '.prose, article',
      streamStart: ['.prose', 'article', '[role=\"log\"]'],
      generatingIndicators: ['.loading', '.spinner', '[aria-busy=\"true\"]'],
      completionIndicators: ['textarea:not([disabled])', 'button[type=\"submit\"]:not([disabled])'],
      stopButton: 'button[aria-label*=\"Stop\" i]',
      copyButton: COPY_BUTTON_SELECTORS
    }
  };

  window.AnswerPipelineSelectors = { PLATFORM_SELECTORS, detectPlatform };
})();
