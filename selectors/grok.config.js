// selectors/grok.config.js
(function () {
  const globalObject = typeof window !== 'undefined' ? window : self;
  globalObject.SelectorConfigRegistry = globalObject.SelectorConfigRegistry || {};

  globalObject.SelectorConfigRegistry.Grok = {
    versions: [
      {
        version: 'grok-2025-q1',
        uiRevision: '2025.1',
        expiresAt: '2025-05-31T00:00:00Z',
        qaNotes: 'Captured on production 2025-02-23 after Grok composer refresh.',
        dateCreated: '2025-02-24T00:00:00Z',
        description: 'Composer migrated into data-testid="grok-editor" shell with detached footer actions.',
        markers: [
          { selector: 'div[data-testid="grok-editor"]' }
        ],
        selectors: {
          composer: [
            'div[data-testid="grok-editor"] div[role="textbox"]',
            'div[data-testid="grok-editor"] [contenteditable="true"]',
            'div[data-testid="grok-editor"] textarea',
            'section[data-testid*="composer"] div[role="textbox"]',
            'section[data-testid*="composer"] [contenteditable="true"]',
            'section[data-testid*="composer"] textarea',
            'textarea[placeholder*="Ask Grok" i]',
            'div[role="textbox"][aria-label*="Ask Grok" i]'
          ],
          sendButton: [
            'div[data-testid="grok-editor"] button[data-testid="grok-send-button"]',
            'div[data-testid="grok-editor"] button[aria-label*="send" i]',
            'section[data-testid*="composer"] button[data-testid="grok-send-button"]',
            'section[data-testid*="composer"] button[aria-label*="send" i]',
            'form button[data-testid*="composer"]',
            'button[data-testid="chat-submit"]',
            'button[data-testid="grok-send-button"]',
            'button[aria-label*="Ask Grok" i]',
            'button[aria-label*="send" i]',
            'button[aria-label*="submit" i]',
            'button[aria-label*="post" i]',
            'button[data-testid*="send"]',
            'div[role="button"][aria-label*="send" i]',
            'div[role="button"][data-testid*="send"]',
            'button[type="submit"]'
          ],
          response: {
            primary: [
              'div.message-bubble div.response-content-markdown',
              'div.relative.response-content-markdown',
              'div[data-testid="grok-response"] .prose',
              'main [data-testid*="response"] .prose',
              'main [data-testid*="thread"] .prose',
              'section[data-testid*="response"] .prose'
            ],
            fallback: [
              'div[data-testid="grok-response"] article',
              'main [data-testid*="response"] article',
              'section[data-testid*="response"]',
              'div.flex.flex-col:nth-of-type(2) > div.relative.group > div.message-bubble.relative:nth-of-type(1)',
              'div.message-bubble.relative.rounded-3xl.text-primary.min-h-7.prose',
              '.prose',
              'article[data-testid="tweet"]',
              'main [class*="response"]'
            ],
            extraction: {
              method: 'innerText',
              cleanup: 'full'
            }
          }
        },
        constraints: {
          composer: {
            exclude: [
              'input[type="search"]',
              '[role="search"] [role="textbox"]',
              '[aria-label*="search" i]'
            ]
          },
          sendButton: {
            exclude: [
              'button[aria-label*="search" i]',
              '[role="search"] button'
            ]
          }
        },
        observation: {
          rootSelector: 'main[role="main"]',
          targetSelectors: [
            'div.message-bubble div.response-content-markdown',
            'div.relative.response-content-markdown',
            'div[data-testid="grok-response"]',
            'section[data-testid*="response"]',
            'div.message-bubble.relative.rounded-3xl.text-primary.min-h-7.prose',
            '.prose',
            'article[data-testid="tweet"]'
          ],
          stabilizationDelayMs: 1600,
          endGenerationMarkers: [
            {
              selector: '.animate-pulse, .typing-indicator, [data-testid="generation-in-progress"], [aria-busy="true"], .loading, .loader, .dots',
              type: 'disappear'
            }
          ]
        },
        anchors: {
          composer: [
            'Ask Grok',
            'Message Grok'
          ],
          sendButton: [
            'Send',
            'Ask',
            'Post'
          ],
          response: [
            'Grok',
            'Answer'
          ]
        }
      },
      {
        version: 'grok-2024-q4',
        uiRevision: '2024.4',
        expiresAt: '2025-02-15T00:00:00Z',
        qaNotes: 'Verified on staging 2024-12-05, production hotfix ready.',
        dateCreated: '2024-11-01T00:00:00Z',
        description: 'Primary composer moved into data-testid="grok-text-input"; dedicated send button data-testid was introduced.',
        markers: [
          { selector: 'div[data-testid="grok-text-input"]' },
          { selector: 'button[data-testid="grok-send-button"]' }
        ],
        selectors: {
          composer: [
            'div[data-testid="grok-text-input"] div[role="textbox"]',
            'div[data-testid="grok-text-input"] [contenteditable="true"]',
            'div[data-testid="grok-text-input"] textarea',
            'div[role="textbox"][data-testid*="grok"]',
            'div[role="textbox"][contenteditable="true"]'
          ],
          sendButton: [
            'button[data-testid="grok-send-button"]',
            'div[data-testid="grok-text-input"] button[aria-label*="send" i]',
            'div[data-testid="grok-text-input"] button[type="submit"]',
            'button[aria-label="Post"]',
            'button[aria-label*="send" i]',
            'button[aria-label*="submit" i]',
            'button[aria-label*="post" i]',
            'button[data-testid*="send"]',
            'div[role="button"][aria-label*="send" i]',
            'div[role="button"][data-testid*="send"]'
          ],
          response: {
            primary: [
              'div.message-bubble div.response-content-markdown',
              'div.relative.response-content-markdown',
              'div[data-testid="grok-response"] .prose',
              'div.group.relative .prose',
              '[data-testid="answer"] .prose',
              'main [class*="response"] .prose'
            ],
            fallback: [
              'div[data-testid="grok-response"] article',
              'div.message-bubble.relative.rounded-3xl.text-primary.min-h-7.prose',
              '.prose',
              'main [class*="response"]',
              'main [class*="prose"]',
              'article[data-testid="tweet"]'
            ],
            extraction: {
              method: 'innerText',
              cleanup: 'full'
            }
          }
        },
        constraints: {
          composer: {
            exclude: [
              'input[type="search"]',
              '[role="search"] [role="textbox"]',
              '[aria-label*="search" i]'
            ]
          },
          sendButton: {
            exclude: [
              'button[aria-label*="search" i]',
              '[role="search"] button'
            ]
          }
        },
        observation: {
          rootSelector: 'main[role="main"]',
          targetSelectors: [
            'div.message-bubble div.response-content-markdown',
            'div.relative.response-content-markdown',
            'div[data-testid="grok-response"]',
            'div.message-bubble.relative.rounded-3xl.text-primary.min-h-7.prose',
            '.prose',
            'article[data-testid="tweet"]'
          ],
          stabilizationDelayMs: 1800,
          endGenerationMarkers: [
            {
              selector: '.animate-pulse, .typing-indicator, [data-testid="generation-in-progress"], [aria-busy="true"], .loading, .loader, .dots',
              type: 'disappear'
            }
          ]
        },
        anchors: {
          composer: [
            'Ask Grok',
            'Message Grok'
          ],
          sendButton: [
            'Send',
            'Ask',
            'Post'
          ],
          response: [
            'Grok',
            'Answer'
          ]
        }
      },
      {
        version: 'grok-2024-q3',
        uiRevision: '2024.3',
        expiresAt: '2024-11-30T00:00:00Z',
        qaNotes: 'Legacy fallback kept for returning users; verify monthly.',
        dateCreated: '2024-08-15T00:00:00Z',
        description: 'Legacy layout using Tweet composer markup with inline send button.',
        markers: [
          { selector: 'div[data-testid="tweetTextarea_0"]' },
          { selector: 'div[data-testid="tweetButtonInline"]' }
        ],
        selectors: {
          composer: [
            'div[data-testid="tweetTextarea_0"] div[role="textbox"]',
            'div[data-testid="tweetTextarea_0"] textarea',
            'div[role="textbox"][contenteditable="true"]',
            'textarea[data-testid="tweetTextarea_0"]',
            'textarea[placeholder*="Ask"]'
          ],
          sendButton: [
            'div[data-testid="tweetButtonInline"]',
            'div[data-testid="tweetButtonInline"] button',
            'button[data-testid="tweetButton"]',
            'button[aria-label*="send" i]',
            'button[aria-label*="submit" i]',
            'button[aria-label*="post" i]',
            'button[data-testid*="send"]',
            'div[role="button"][aria-label*="send" i]',
            'div[role="button"][data-testid*="send"]',
            'button:has(svg)'
          ],
          response: {
            primary: [
              '.prose',
              '[data-testid="answer"] .prose',
              'main [class*="response"] .prose'
            ],
            fallback: [
              '[data-testid="answer"]',
              'article[data-testid="tweet"]',
              'main[role="main"] article',
              'main [class*="response"]'
            ],
            extraction: {
              method: 'innerText',
              cleanup: 'full'
            }
          }
        },
        constraints: {
          composer: {
            exclude: [
              'input[type="search"]',
              '[role="search"] [role="textbox"]',
              '[aria-label*="search" i]'
            ]
          },
          sendButton: {
            exclude: [
              'button[aria-label*="search" i]',
              '[role="search"] button'
            ]
          }
        },
        observation: {
          rootSelector: 'main[role="main"]',
          targetSelectors: [
            '.prose',
            'article[data-testid="tweet"]',
            '[data-testid="answer"]'
          ],
          stabilizationDelayMs: 2000,
          endGenerationMarkers: [
            {
              selector: '.animate-pulse, .typing-indicator, [aria-busy="true"], .loading, .loader, .dots',
              type: 'disappear'
            }
          ]
        },
        anchors: {
          composer: [
            'Ask Grok',
            'Ask me anything'
          ],
          sendButton: [
            'Send',
            'Tweet',
            'Ask'
          ],
          response: [
            'Grok',
            'Answer'
          ]
        }
      }
    ],
    emergencyFallbacks: {
      composer: [
        'div[role="textbox"]',
        'div[contenteditable="true"]',
        'textarea'
      ],
      sendButton: [
        'button[aria-label*="send" i]',
        'button[aria-label*="submit" i]',
        'button[aria-label*="post" i]',
        'button[data-testid*="send"]',
        'button[type="submit"]',
        'div[role="button"][aria-label*="send" i]',
        'div[role="button"][data-testid*="send"]',
        'button:has(svg)'
      ],
      response: [
        '[role="log"]',
        '[class*="response"]',
        'article',
        'main'
      ]
    }
  };
})();
