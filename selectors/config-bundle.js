// selectors/config-bundle.js
(function () {
  const globalObject = typeof window !== 'undefined' ? window : self;
  const bundle = {
  "GPT": {
    "versions": [],
    "emergencyFallbacks": {
      "composer": [
        "textarea[data-id=\"root\"]",
        "textarea[name=\"prompt\"]",
        "textarea",
        "div[role=\"textbox\"]",
        "[contenteditable=\"true\"]"
      ],
      "sendButton": [
        "button[data-testid=\"send-button\"]",
        "button[aria-label*=\"Send\"]",
        "button[type=\"submit\"]",
        "button"
      ],
      "response": [
        "[data-markdown-text-style=\"assistant-message\"]",
        "[data-testid=\"conversation-panel\"]",
        "[data-testid=\"conversation-container\"]",
        "[data-testid=\"chat-history\"]",
        "[data-testid=\"conversation-turn\"][data-message-author-role=\"assistant\"]",
        "[data-testid=\"conversation-turn\"][data-author-role=\"assistant\"]",
        "[data-testid=\"conversation-turn\"][data-role=\"assistant\"]",
        "[data-message-author-role=\"assistant\"]",
        "[data-author-role=\"assistant\"]",
        "[data-role=\"assistant\"]",
        "main",
        "section"
      ]
    },
    "observationDefaults": {
      "rootSelector": "main",
      "targetSelectors": [
        "[data-markdown-text-style=\"assistant-message\"]",
        "[data-testid=\"conversation-panel\"]",
        "[data-testid=\"chat-history\"]",
        ".markdown",
        ".prose"
      ],
      "stabilizationDelayMs": 1800,
      "endGenerationMarkers": [
        {
          "selector": "[data-testid=\"stop-button\"]",
          "type": "disappear"
        }
      ]
    }
  },
  "Claude": {
    "versions": [],
    "emergencyFallbacks": {
      "composer": [
        "textarea[data-testid=\"chat-input\"]",
        "textarea",
        "div[role=\"textbox\"]",
        "[contenteditable=\"true\"]"
      ],
      "sendButton": [
        "button[data-testid=\"send-button\"]",
        "button[aria-label*=\"Send\"]",
        "button[type=\"submit\"]"
      ],
      "response": [
        "div[data-testid=\"conversation-turn\"][data-author-role=\"assistant\"] div.standard-markdown.grid-cols-1",
        "div[data-testid=\"conversation-turn\"][data-role=\"assistant\"] div.standard-markdown.grid-cols-1",
        "div[data-is-response=\"true\"] div.font-claude-response.relative div.standard-markdown.grid-cols-1",
        "div[data-is-response=\"true\"] div.standard-markdown.grid-cols-1",
        "div[data-testid=\"conversation-turn\"][data-author-role=\"assistant\"] [data-testid=\"message-text\"]:not([data-testid*=\"thinking\" i]):not([data-testid*=\"thought\" i]):not([data-testid*=\"reason\" i]):not([data-testid*=\"analysis\" i]):not([data-testid*=\"scratch\" i]):not([data-testid*=\"work\" i]):not([data-testid*=\"step\" i]):not([data-testid*=\"draft\" i]):not([data-testid*=\"trace\" i]):not([data-testid*=\"internal\" i]):not([data-testid*=\"reflection\" i])",
        "div[data-testid=\"conversation-turn\"][data-role=\"assistant\"] [data-testid=\"message-text\"]:not([data-testid*=\"thinking\" i]):not([data-testid*=\"thought\" i]):not([data-testid*=\"reason\" i]):not([data-testid*=\"analysis\" i]):not([data-testid*=\"scratch\" i]):not([data-testid*=\"work\" i]):not([data-testid*=\"step\" i]):not([data-testid*=\"draft\" i]):not([data-testid*=\"trace\" i]):not([data-testid*=\"internal\" i]):not([data-testid*=\"reflection\" i])",
        "div[data-is-response=\"true\"] [data-testid=\"message-text\"]:not([data-testid*=\"thinking\" i]):not([data-testid*=\"thought\" i]):not([data-testid*=\"reason\" i]):not([data-testid*=\"analysis\" i]):not([data-testid*=\"scratch\" i]):not([data-testid*=\"work\" i]):not([data-testid*=\"step\" i]):not([data-testid*=\"draft\" i]):not([data-testid*=\"trace\" i]):not([data-testid*=\"internal\" i]):not([data-testid*=\"reflection\" i])",
        "div[data-testid=\"conversation-turn\"][data-author-role=\"assistant\"] article:not([data-testid*=\"thinking\" i]):not([data-testid*=\"thought\" i]):not([data-testid*=\"reason\" i]):not([data-testid*=\"analysis\" i]):not([data-testid*=\"scratch\" i]):not([data-testid*=\"work\" i]):not([data-testid*=\"step\" i]):not([data-testid*=\"draft\" i]):not([data-testid*=\"trace\" i]):not([data-testid*=\"internal\" i]):not([data-testid*=\"reflection\" i])",
        "div[data-testid=\"conversation-turn\"][data-role=\"assistant\"] article:not([data-testid*=\"thinking\" i]):not([data-testid*=\"thought\" i]):not([data-testid*=\"reason\" i]):not([data-testid*=\"analysis\" i]):not([data-testid*=\"scratch\" i]):not([data-testid*=\"work\" i]):not([data-testid*=\"step\" i]):not([data-testid*=\"draft\" i]):not([data-testid*=\"trace\" i]):not([data-testid*=\"internal\" i]):not([data-testid*=\"reflection\" i])",
        "div[data-is-response=\"true\"] article:not([data-testid*=\"thinking\" i]):not([data-testid*=\"thought\" i]):not([data-testid*=\"reason\" i]):not([data-testid*=\"analysis\" i]):not([data-testid*=\"scratch\" i]):not([data-testid*=\"work\" i]):not([data-testid*=\"step\" i]):not([data-testid*=\"draft\" i]):not([data-testid*=\"trace\" i]):not([data-testid*=\"internal\" i]):not([data-testid*=\"reflection\" i])",
        "div[data-testid=\"conversation-turn\"][data-author-role=\"assistant\"]:not([data-testid*=\"thinking\" i]):not([data-testid*=\"thought\" i]):not([data-testid*=\"reason\" i]):not([data-testid*=\"analysis\" i]):not([data-testid*=\"scratch\" i]):not([data-testid*=\"work\" i]):not([data-testid*=\"step\" i]):not([data-testid*=\"draft\" i]):not([data-testid*=\"trace\" i]):not([data-testid*=\"internal\" i]):not([data-testid*=\"reflection\" i])",
        "div[data-testid=\"conversation-turn\"][data-role=\"assistant\"]:not([data-testid*=\"thinking\" i]):not([data-testid*=\"thought\" i]):not([data-testid*=\"reason\" i]):not([data-testid*=\"analysis\" i]):not([data-testid*=\"scratch\" i]):not([data-testid*=\"work\" i]):not([data-testid*=\"step\" i]):not([data-testid*=\"draft\" i]):not([data-testid*=\"trace\" i]):not([data-testid*=\"internal\" i]):not([data-testid*=\"reflection\" i])",
        "div[data-is-response=\"true\"]:not([data-testid*=\"thinking\" i]):not([data-testid*=\"thought\" i]):not([data-testid*=\"reason\" i]):not([data-testid*=\"analysis\" i]):not([data-testid*=\"scratch\" i]):not([data-testid*=\"work\" i]):not([data-testid*=\"step\" i]):not([data-testid*=\"draft\" i]):not([data-testid*=\"trace\" i]):not([data-testid*=\"internal\" i]):not([data-testid*=\"reflection\" i])",
        "div[data-is-response=\"true\"]:last-of-type div.font-claude-response.relative div.standard-markdown.grid-cols-1",
        "div[data-is-response=\"true\"]:last-of-type div.standard-markdown.grid-cols-1",
        "div[data-testid=\"conversation-turn\"][data-role=\"assistant\"]:last-of-type div.standard-markdown.grid-cols-1",
        "div[data-testid=\"conversation-turn\"][data-author-role=\"assistant\"]:last-of-type div.standard-markdown.grid-cols-1",
        "div[data-is-response=\"true\"]:last-of-type [data-testid=\"message-text\"]:not([data-testid*=\"thinking\" i]):not([data-testid*=\"thought\" i]):not([data-testid*=\"reason\" i]):not([data-testid*=\"analysis\" i]):not([data-testid*=\"scratch\" i]):not([data-testid*=\"work\" i]):not([data-testid*=\"step\" i]):not([data-testid*=\"draft\" i]):not([data-testid*=\"trace\" i]):not([data-testid*=\"internal\" i]):not([data-testid*=\"reflection\" i])",
        "div[data-is-response=\"true\"]:last-of-type article:not([data-testid*=\"thinking\" i]):not([data-testid*=\"thought\" i]):not([data-testid*=\"reason\" i]):not([data-testid*=\"analysis\" i]):not([data-testid*=\"scratch\" i]):not([data-testid*=\"work\" i]):not([data-testid*=\"step\" i]):not([data-testid*=\"draft\" i]):not([data-testid*=\"trace\" i]):not([data-testid*=\"internal\" i]):not([data-testid*=\"reflection\" i])",
        "div[data-is-response=\"true\"]:last-of-type:not([data-testid*=\"thinking\" i]):not([data-testid*=\"thought\" i]):not([data-testid*=\"reason\" i]):not([data-testid*=\"analysis\" i]):not([data-testid*=\"scratch\" i]):not([data-testid*=\"work\" i]):not([data-testid*=\"step\" i]):not([data-testid*=\"draft\" i]):not([data-testid*=\"trace\" i]):not([data-testid*=\"internal\" i]):not([data-testid*=\"reflection\" i])",
        "div[data-testid=\"conversation-turn\"][data-role=\"assistant\"]:last-of-type [data-testid=\"message-text\"]:not([data-testid*=\"thinking\" i]):not([data-testid*=\"thought\" i]):not([data-testid*=\"reason\" i]):not([data-testid*=\"analysis\" i]):not([data-testid*=\"scratch\" i]):not([data-testid*=\"work\" i]):not([data-testid*=\"step\" i]):not([data-testid*=\"draft\" i]):not([data-testid*=\"trace\" i]):not([data-testid*=\"internal\" i]):not([data-testid*=\"reflection\" i])",
        "div[data-testid=\"conversation-turn\"][data-author-role=\"assistant\"]:last-of-type [data-testid=\"message-text\"]:not([data-testid*=\"thinking\" i]):not([data-testid*=\"thought\" i]):not([data-testid*=\"reason\" i]):not([data-testid*=\"analysis\" i]):not([data-testid*=\"scratch\" i]):not([data-testid*=\"work\" i]):not([data-testid*=\"step\" i]):not([data-testid*=\"draft\" i]):not([data-testid*=\"trace\" i]):not([data-testid*=\"internal\" i]):not([data-testid*=\"reflection\" i])",
        "div[data-testid=\"conversation-turn\"][data-role=\"assistant\"]:last-of-type article:not([data-testid*=\"thinking\" i]):not([data-testid*=\"thought\" i]):not([data-testid*=\"reason\" i]):not([data-testid*=\"analysis\" i]):not([data-testid*=\"scratch\" i]):not([data-testid*=\"work\" i]):not([data-testid*=\"step\" i]):not([data-testid*=\"draft\" i]):not([data-testid*=\"trace\" i]):not([data-testid*=\"internal\" i]):not([data-testid*=\"reflection\" i])",
        "div[data-testid=\"conversation-turn\"][data-author-role=\"assistant\"]:last-of-type:not([data-testid*=\"thinking\" i]):not([data-testid*=\"thought\" i]):not([data-testid*=\"reason\" i]):not([data-testid*=\"analysis\" i]):not([data-testid*=\"scratch\" i]):not([data-testid*=\"work\" i]):not([data-testid*=\"step\" i]):not([data-testid*=\"draft\" i]):not([data-testid*=\"trace\" i]):not([data-testid*=\"internal\" i]):not([data-testid*=\"reflection\" i])",
        "[data-testid=\"chat-response\"]:not([data-testid*=\"thinking\" i]):not([data-testid*=\"thought\" i]):not([data-testid*=\"reason\" i]):not([data-testid*=\"analysis\" i]):not([data-testid*=\"scratch\" i]):not([data-testid*=\"work\" i]):not([data-testid*=\"step\" i]):not([data-testid*=\"draft\" i]):not([data-testid*=\"trace\" i]):not([data-testid*=\"internal\" i]):not([data-testid*=\"reflection\" i])"
      ]
    },
    "observationDefaults": {
      "rootSelector": "main",
      "targetSelectors": [
        "div[data-testid=\"conversation-turn\"][data-author-role=\"assistant\"] div.standard-markdown.grid-cols-1",
        "div[data-testid=\"conversation-turn\"][data-role=\"assistant\"] div.standard-markdown.grid-cols-1",
        "div[data-is-response=\"true\"] div.font-claude-response.relative div.standard-markdown.grid-cols-1",
        "div[data-is-response=\"true\"] div.standard-markdown.grid-cols-1",
        "div[data-is-response=\"true\"]:last-of-type div.font-claude-response.relative div.standard-markdown.grid-cols-1",
        "div[data-is-response=\"true\"]:last-of-type div.standard-markdown.grid-cols-1",
        "div[data-testid=\"conversation-turn\"][data-role=\"assistant\"]:last-of-type div.standard-markdown.grid-cols-1",
        "div[data-testid=\"conversation-turn\"][data-author-role=\"assistant\"]:last-of-type div.standard-markdown.grid-cols-1",
        "div[data-is-response=\"true\"]:last-of-type [data-testid=\"message-text\"]:not([data-testid*=\"thinking\" i]):not([data-testid*=\"thought\" i]):not([data-testid*=\"reason\" i]):not([data-testid*=\"analysis\" i]):not([data-testid*=\"scratch\" i]):not([data-testid*=\"work\" i]):not([data-testid*=\"step\" i]):not([data-testid*=\"draft\" i]):not([data-testid*=\"trace\" i]):not([data-testid*=\"internal\" i]):not([data-testid*=\"reflection\" i])",
        "div[data-is-response=\"true\"]:last-of-type article:not([data-testid*=\"thinking\" i]):not([data-testid*=\"thought\" i]):not([data-testid*=\"reason\" i]):not([data-testid*=\"analysis\" i]):not([data-testid*=\"scratch\" i]):not([data-testid*=\"work\" i]):not([data-testid*=\"step\" i]):not([data-testid*=\"draft\" i]):not([data-testid*=\"trace\" i]):not([data-testid*=\"internal\" i]):not([data-testid*=\"reflection\" i])",
        "div[data-testid=\"conversation-turn\"][data-role=\"assistant\"]:last-of-type [data-testid=\"message-text\"]:not([data-testid*=\"thinking\" i]):not([data-testid*=\"thought\" i]):not([data-testid*=\"reason\" i]):not([data-testid*=\"analysis\" i]):not([data-testid*=\"scratch\" i]):not([data-testid*=\"work\" i]):not([data-testid*=\"step\" i]):not([data-testid*=\"draft\" i]):not([data-testid*=\"trace\" i]):not([data-testid*=\"internal\" i]):not([data-testid*=\"reflection\" i])",
        "div[data-testid=\"conversation-turn\"][data-author-role=\"assistant\"]:last-of-type [data-testid=\"message-text\"]:not([data-testid*=\"thinking\" i]):not([data-testid*=\"thought\" i]):not([data-testid*=\"reason\" i]):not([data-testid*=\"analysis\" i]):not([data-testid*=\"scratch\" i]):not([data-testid*=\"work\" i]):not([data-testid*=\"step\" i]):not([data-testid*=\"draft\" i]):not([data-testid*=\"trace\" i]):not([data-testid*=\"internal\" i]):not([data-testid*=\"reflection\" i])",
        "div[data-testid=\"conversation-turn\"][data-role=\"assistant\"]:last-of-type article:not([data-testid*=\"thinking\" i]):not([data-testid*=\"thought\" i]):not([data-testid*=\"reason\" i]):not([data-testid*=\"analysis\" i]):not([data-testid*=\"scratch\" i]):not([data-testid*=\"work\" i]):not([data-testid*=\"step\" i]):not([data-testid*=\"draft\" i]):not([data-testid*=\"trace\" i]):not([data-testid*=\"internal\" i]):not([data-testid*=\"reflection\" i])",
        "div[data-testid=\"conversation-turn\"][data-author-role=\"assistant\"]:last-of-type:not([data-testid*=\"thinking\" i]):not([data-testid*=\"thought\" i]):not([data-testid*=\"reason\" i]):not([data-testid*=\"analysis\" i]):not([data-testid*=\"scratch\" i]):not([data-testid*=\"work\" i]):not([data-testid*=\"step\" i]):not([data-testid*=\"draft\" i]):not([data-testid*=\"trace\" i]):not([data-testid*=\"internal\" i]):not([data-testid*=\"reflection\" i])",
        "[data-testid=\"chat-response\"]:not([data-testid*=\"thinking\" i]):not([data-testid*=\"thought\" i]):not([data-testid*=\"reason\" i]):not([data-testid*=\"analysis\" i]):not([data-testid*=\"scratch\" i]):not([data-testid*=\"work\" i]):not([data-testid*=\"step\" i]):not([data-testid*=\"draft\" i]):not([data-testid*=\"trace\" i]):not([data-testid*=\"internal\" i]):not([data-testid*=\"reflection\" i])"
      ],
      "stabilizationDelayMs": 1800,
      "endGenerationMarkers": [
        {
          "selector": "[data-testid=\"chat-loader\"]",
          "type": "disappear"
        }
      ]
    }
  },
  "Gemini": {
    "versions": [],
    "emergencyFallbacks": {
      "composer": [
        "textarea[aria-label*=\"Prompt\"]",
        "textarea",
        "div[role=\"textbox\"]",
        "[contenteditable=\"true\"]"
      ],
      "sendButton": [
        "button[aria-label*=\"Send\"]",
        "button[data-mdc-dialog-action=\"submit\"]",
        "button[type=\"submit\"]"
      ],
      "response": [
        "main [data-mdc-dialog-action]",
        "main section",
        "article",
        "main"
      ]
    },
    "observationDefaults": {
      "rootSelector": "main",
      "targetSelectors": [
        "main article",
        "main section",
        ".prose",
        ".markdown"
      ],
      "stabilizationDelayMs": 1800,
      "endGenerationMarkers": [
        {
          "selector": "[aria-live=\"polite\"] .progress",
          "type": "disappear"
        }
      ]
    }
  },
  "Grok": {
    "versions": [
      {
        "version": "grok-2025-q1",
        "uiRevision": "2025.1",
        "expiresAt": "2025-05-31T00:00:00Z",
        "qaNotes": "Captured on production 2025-02-23 after Grok composer refresh.",
        "dateCreated": "2025-02-24T00:00:00Z",
        "description": "Composer migrated into data-testid=\"grok-editor\" shell with detached footer actions.",
        "markers": [
          {
            "selector": "div[data-testid=\"grok-editor\"]"
          }
        ],
        "selectors": {
          "composer": [
            "div[data-testid=\"grok-editor\"] div[role=\"textbox\"]",
            "div[data-testid=\"grok-editor\"] [contenteditable=\"true\"]",
            "div[data-testid=\"grok-editor\"] textarea",
            "section[data-testid*=\"composer\"] div[role=\"textbox\"]",
            "section[data-testid*=\"composer\"] [contenteditable=\"true\"]",
            "section[data-testid*=\"composer\"] textarea",
            "textarea[placeholder*=\"Ask Grok\" i]",
            "div[role=\"textbox\"][aria-label*=\"Ask Grok\" i]"
          ],
          "sendButton": [
            "div[data-testid=\"grok-editor\"] button[data-testid=\"grok-send-button\"]",
            "div[data-testid=\"grok-editor\"] button[aria-label*=\"send\" i]",
            "section[data-testid*=\"composer\"] button[data-testid=\"grok-send-button\"]",
            "section[data-testid*=\"composer\"] button[aria-label*=\"send\" i]",
            "form button[data-testid*=\"composer\"]",
            "button[data-testid=\"grok-send-button\"]",
            "button[aria-label*=\"Ask Grok\" i]",
            "button[aria-label*=\"send\" i]",
            "button[aria-label*=\"submit\" i]",
            "button[aria-label*=\"post\" i]",
            "button[data-testid*=\"send\"]",
            "div[role=\"button\"][aria-label*=\"send\" i]",
            "div[role=\"button\"][data-testid*=\"send\"]",
            "button[type=\"submit\"]"
          ],
          "response": {
            "primary": [
              "div.message-bubble div.response-content-markdown",
              "div.relative.response-content-markdown",
              "div[data-testid=\"grok-response\"] .prose",
              "main [data-testid*=\"response\"] .prose",
              "main [data-testid*=\"thread\"] .prose",
              "section[data-testid*=\"response\"] .prose"
            ],
            "fallback": [
              "div[data-testid=\"grok-response\"] article",
              "main [data-testid*=\"response\"] article",
              "section[data-testid*=\"response\"]",
              "div.flex.flex-col:nth-of-type(2) > div.relative.group > div.message-bubble.relative:nth-of-type(1)",
              "div.message-bubble.relative.rounded-3xl.text-primary.min-h-7.prose",
              ".prose",
              "article[data-testid=\"tweet\"]",
              "main [class*=\"response\"]"
            ],
            "extraction": {
              "method": "innerText",
              "cleanup": "full"
            }
          }
        },
        "constraints": {
          "composer": {
            "exclude": [
              "input[type=\"search\"]",
              "[role=\"search\"] [role=\"textbox\"]",
              "[aria-label*=\"search\" i]"
            ]
          },
          "sendButton": {
            "exclude": [
              "button[aria-label*=\"search\" i]",
              "[role=\"search\"] button"
            ]
          }
        },
        "observation": {
          "rootSelector": "main[role=\"main\"]",
          "targetSelectors": [
            "div.message-bubble div.response-content-markdown",
            "div.relative.response-content-markdown",
            "div[data-testid=\"grok-response\"]",
            "section[data-testid*=\"response\"]",
            "div.message-bubble.relative.rounded-3xl.text-primary.min-h-7.prose",
            ".prose",
            "article[data-testid=\"tweet\"]"
          ],
          "stabilizationDelayMs": 1600,
          "endGenerationMarkers": [
            {
              "selector": ".animate-pulse, .typing-indicator, [data-testid=\"generation-in-progress\"], [aria-busy=\"true\"], .loading, .loader, .dots",
              "type": "disappear"
            }
          ]
        },
        "anchors": {
          "composer": [
            "Ask Grok",
            "Message Grok"
          ],
          "sendButton": [
            "Send",
            "Ask",
            "Post"
          ],
          "response": [
            "Grok",
            "Answer"
          ]
        }
      },
      {
        "version": "grok-2024-q4",
        "uiRevision": "2024.4",
        "expiresAt": "2025-02-15T00:00:00Z",
        "qaNotes": "Verified on staging 2024-12-05, production hotfix ready.",
        "dateCreated": "2024-11-01T00:00:00Z",
        "description": "Primary composer moved into data-testid=\"grok-text-input\"; dedicated send button data-testid was introduced.",
        "markers": [
          {
            "selector": "div[data-testid=\"grok-text-input\"]"
          },
          {
            "selector": "button[data-testid=\"grok-send-button\"]"
          }
        ],
        "selectors": {
          "composer": [
            "div[data-testid=\"grok-text-input\"] div[role=\"textbox\"]",
            "div[data-testid=\"grok-text-input\"] [contenteditable=\"true\"]",
            "div[data-testid=\"grok-text-input\"] textarea",
            "div[role=\"textbox\"][data-testid*=\"grok\"]",
            "div[role=\"textbox\"][contenteditable=\"true\"]"
          ],
          "sendButton": [
            "button[data-testid=\"grok-send-button\"]",
            "div[data-testid=\"grok-text-input\"] button[aria-label*=\"send\" i]",
            "div[data-testid=\"grok-text-input\"] button[type=\"submit\"]",
            "button[aria-label=\"Post\"]",
            "button[aria-label*=\"send\" i]",
            "button[aria-label*=\"submit\" i]",
            "button[aria-label*=\"post\" i]",
            "button[data-testid*=\"send\"]",
            "div[role=\"button\"][aria-label*=\"send\" i]",
            "div[role=\"button\"][data-testid*=\"send\"]"
          ],
          "response": {
            "primary": [
              "div.message-bubble div.response-content-markdown",
              "div.relative.response-content-markdown",
              "div[data-testid=\"grok-response\"] .prose",
              "div.group.relative .prose",
              "[data-testid=\"answer\"] .prose",
              "main [class*=\"response\"] .prose"
            ],
            "fallback": [
              "div[data-testid=\"grok-response\"] article",
              "div.message-bubble.relative.rounded-3xl.text-primary.min-h-7.prose",
              ".prose",
              "main [class*=\"response\"]",
              "main [class*=\"prose\"]",
              "article[data-testid=\"tweet\"]"
            ],
            "extraction": {
              "method": "innerText",
              "cleanup": "full"
            }
          }
        },
        "constraints": {
          "composer": {
            "exclude": [
              "input[type=\"search\"]",
              "[role=\"search\"] [role=\"textbox\"]",
              "[aria-label*=\"search\" i]"
            ]
          },
          "sendButton": {
            "exclude": [
              "button[aria-label*=\"search\" i]",
              "[role=\"search\"] button"
            ]
          }
        },
        "observation": {
          "rootSelector": "main[role=\"main\"]",
          "targetSelectors": [
            "div.message-bubble div.response-content-markdown",
            "div.relative.response-content-markdown",
            "div[data-testid=\"grok-response\"]",
            "div.message-bubble.relative.rounded-3xl.text-primary.min-h-7.prose",
            ".prose",
            "article[data-testid=\"tweet\"]"
          ],
          "stabilizationDelayMs": 1800,
          "endGenerationMarkers": [
            {
              "selector": ".animate-pulse, .typing-indicator, [data-testid=\"generation-in-progress\"], [aria-busy=\"true\"], .loading, .loader, .dots",
              "type": "disappear"
            }
          ]
        },
        "anchors": {
          "composer": [
            "Ask Grok",
            "Message Grok"
          ],
          "sendButton": [
            "Send",
            "Ask",
            "Post"
          ],
          "response": [
            "Grok",
            "Answer"
          ]
        }
      },
      {
        "version": "grok-2024-q3",
        "uiRevision": "2024.3",
        "expiresAt": "2024-11-30T00:00:00Z",
        "qaNotes": "Legacy fallback kept for returning users; verify monthly.",
        "dateCreated": "2024-08-15T00:00:00Z",
        "description": "Legacy layout using Tweet composer markup with inline send button.",
        "markers": [
          {
            "selector": "div[data-testid=\"tweetTextarea_0\"]"
          },
          {
            "selector": "div[data-testid=\"tweetButtonInline\"]"
          }
        ],
        "selectors": {
          "composer": [
            "div[data-testid=\"tweetTextarea_0\"] div[role=\"textbox\"]",
            "div[data-testid=\"tweetTextarea_0\"] textarea",
            "div[role=\"textbox\"][contenteditable=\"true\"]",
            "textarea[data-testid=\"tweetTextarea_0\"]",
            "textarea[placeholder*=\"Ask\"]"
          ],
          "sendButton": [
            "div[data-testid=\"tweetButtonInline\"]",
            "div[data-testid=\"tweetButtonInline\"] button",
            "button[data-testid=\"tweetButton\"]",
            "button[aria-label*=\"send\" i]",
            "button[aria-label*=\"submit\" i]",
            "button[aria-label*=\"post\" i]",
            "button[data-testid*=\"send\"]",
            "div[role=\"button\"][aria-label*=\"send\" i]",
            "div[role=\"button\"][data-testid*=\"send\"]",
            "button:has(svg)"
          ],
          "response": {
            "primary": [
              ".prose",
              "[data-testid=\"answer\"] .prose",
              "main [class*=\"response\"] .prose"
            ],
            "fallback": [
              "[data-testid=\"answer\"]",
              "article[data-testid=\"tweet\"]",
              "main[role=\"main\"] article",
              "main [class*=\"response\"]"
            ],
            "extraction": {
              "method": "innerText",
              "cleanup": "full"
            }
          }
        },
        "constraints": {
          "composer": {
            "exclude": [
              "input[type=\"search\"]",
              "[role=\"search\"] [role=\"textbox\"]",
              "[aria-label*=\"search\" i]"
            ]
          },
          "sendButton": {
            "exclude": [
              "button[aria-label*=\"search\" i]",
              "[role=\"search\"] button"
            ]
          }
        },
        "observation": {
          "rootSelector": "main[role=\"main\"]",
          "targetSelectors": [
            ".prose",
            "article[data-testid=\"tweet\"]",
            "[data-testid=\"answer\"]"
          ],
          "stabilizationDelayMs": 2000,
          "endGenerationMarkers": [
            {
              "selector": ".animate-pulse, .typing-indicator, [aria-busy=\"true\"], .loading, .loader, .dots",
              "type": "disappear"
            }
          ]
        },
        "anchors": {
          "composer": [
            "Ask Grok",
            "Ask me anything"
          ],
          "sendButton": [
            "Send",
            "Tweet",
            "Ask"
          ],
          "response": [
            "Grok",
            "Answer"
          ]
        }
      }
    ],
    "emergencyFallbacks": {
      "composer": [
        "div[role=\"textbox\"]",
        "div[contenteditable=\"true\"]",
        "textarea"
      ],
      "sendButton": [
        "button[aria-label*=\"send\" i]",
        "button[aria-label*=\"submit\" i]",
        "button[aria-label*=\"post\" i]",
        "button[data-testid*=\"send\"]",
        "button[type=\"submit\"]",
        "div[role=\"button\"][aria-label*=\"send\" i]",
        "div[role=\"button\"][data-testid*=\"send\"]",
        "button:has(svg)"
      ],
      "response": [
        "[role=\"log\"]",
        "[class*=\"response\"]",
        "article",
        "main"
      ]
    }
  },
  "DeepSeek": {
    "versions": [],
    "emergencyFallbacks": {
      "composer": [
        "textarea[aria-label*=\"prompt\"]",
        "textarea",
        "[contenteditable=\"true\"]",
        "div[role=\"textbox\"]"
      ],
      "sendButton": [
        "button[aria-label*=\"send\" i]",
        "button[aria-label*=\"send message\" i]",
        "button[aria-label*=\"submit\" i]",
        "button[aria-label*=\"post\" i]",
        "button[type=\"submit\"]",
        "button[data-testid*=\"send\"]",
        "div[role=\"button\"][aria-label*=\"send\" i]",
        "div[role=\"button\"][data-testid*=\"send\"]"
      ],
      "response": [
        "div.ds-message div.ds-markdown",
        "main div[class*=\"ds-message\"] div[class*=\"markdown\"]",
        ".response",
        ".prose",
        "main article",
        "main"
      ]
    },
    "observationDefaults": {
      "rootSelector": "main",
      "targetSelectors": [
        "div.ds-message div.ds-markdown",
        "main div[class*=\"ds-message\"] div[class*=\"markdown\"]",
        ".response",
        ".prose",
        "main article"
      ],
      "stabilizationDelayMs": 1800,
      "endGenerationMarkers": [
        {
          "selector": ".loading-spinner",
          "type": "disappear"
        }
      ]
    }
  },
  "Le Chat": {
    "versions": [],
    "emergencyFallbacks": {
      "composer": [
        "textarea[aria-label*=\"prompt\"]",
        "textarea[aria-label*=\"message\"]",
        "textarea[placeholder*=\"message\"]",
        "textarea[data-testid*=\"composer\"]",
        "div[data-testid*=\"composer\"] textarea",
        "div[data-testid*=\"composer\"] [contenteditable=\"true\"]",
        "div.ProseMirror",
        "div[class*=\"ProseMirror\"]",
        "div[contenteditable=\"true\"][data-placeholder]",
        "div[contenteditable=\"true\"][role=\"textbox\"]",
        "textarea",
        "[contenteditable=\"true\"]",
        "div[role=\"textbox\"]",
        "div[role=\"textbox\"][contenteditable=\"true\"]"
      ],
      "sendButton": [
        "button[aria-label*=\"send\" i]",
        "button[aria-label*=\"send message\" i]",
        "button[aria-label*=\"submit\" i]",
        "button[aria-label*=\"post\" i]",
        "button[type=\"submit\"]",
        "button:has(svg[data-icon=\"send\"])",
        "button[data-testid*=\"send\"]",
        "div[role=\"button\"][aria-label*=\"send\" i]",
        "div[role=\"button\"][data-testid*=\"send\"]",
        "button"
      ],
      "response": [
        "[data-message-author-role=\"assistant\"] [data-message-part-type=\"answer\"]",
        "main article",
        ".chat-response",
        ".prose",
        "[data-testid*=\"assistant\"] article",
        "main"
      ]
    },
    "observationDefaults": {
      "rootSelector": "main",
      "targetSelectors": [
        "[data-message-author-role=\"assistant\"] [data-message-part-type=\"answer\"]",
        ".chat-response",
        "main article",
        ".prose",
        "[data-testid*=\"assistant\"] article"
      ],
      "stabilizationDelayMs": 1800,
      "endGenerationMarkers": [
        {
          "selector": "[aria-busy=\"true\"]",
          "type": "disappear"
        }
      ]
    }
  },
  "Perplexity": {
    "versions": [],
    "emergencyFallbacks": {
      "composer": [
        "textarea[aria-label*=\"Ask\"]",
        "textarea",
        "div[role=\"textbox\"]",
        "[contenteditable=\"true\"]"
      ],
      "sendButton": [
        "button[aria-label*=\"Ask\"]",
        "button[type=\"submit\"]",
        "button"
      ],
      "response": [
        ".answer",
        ".prose",
        "article",
        "main"
      ]
    },
    "observationDefaults": {
      "rootSelector": "main",
      "targetSelectors": [
        ".answer",
        ".prose",
        "article"
      ],
      "stabilizationDelayMs": 1800,
      "endGenerationMarkers": [
        {
          "selector": ".loading-indicator",
          "type": "disappear"
        }
      ]
    }
  },
  "Z.ai": {
    "versions": [],
    "emergencyFallbacks": {
      "composer": [
        "#chat-input",
        "textarea[placeholder*=\"help you today\" i]",
        "textarea.input-scroll",
        "textarea"
      ],
      "sendButton": [
        "#send-message-button",
        "button.sendMessageButton",
        "form button[type=\"submit\"]",
        "button[aria-label*=\"send\" i]"
      ],
      "response": [
        "[id^=\"message-\"][id$=\"-start\"]:not(.chat-user):not([data-role=\"user\"]):not([data-message-author-role=\"user\"])",
        ".chat-assistant.markdown-prose",
        "[id^=\"message-\"] .chat-assistant.markdown-prose",
        "[data-message-author-role=\"assistant\"]",
        "[data-role=\"assistant\"]",
        "[class*=\"assistant-message\"]",
        "[class*=\"assistant\"] [class*=\"markdown\"]"
      ]
    },
    "observationDefaults": {
      "rootSelector": "body",
      "targetSelectors": [
        "#chat-messages",
        ".chat-assistant.markdown-prose",
        "[data-message-author-role=\"assistant\"]",
        "[data-role=\"assistant\"]",
        "[class*=\"assistant-message\"]"
      ],
      "stabilizationDelayMs": 1800,
      "endGenerationMarkers": [
        {
          "selector": "button[aria-label*=\"stop\" i], [data-generating=\"true\"], [data-streaming=\"true\"], [aria-busy=\"true\"], .animate-pulse",
          "type": "disappear"
        }
      ]
    }
  },
  "Qwen": {
    "versions": [],
    "emergencyFallbacks": {
      "composer": [
        "textarea[aria-label*=\"question\"]",
        "textarea",
        "div[role=\"textbox\"]",
        "[contenteditable=\"true\"]"
      ],
      "sendButton": [
        "button[aria-label*=\"Send\"]",
        "button[type=\"submit\"]",
        "button[data-testid*=\"send\"]"
      ],
      "response": [
        "div.qwen-chat-message.qwen-chat-message-assistant div.response-message-content div.custom-qwen-markdown > div.qwen-markdown.qwen-markdown-loose",
        "div.qwen-chat-message-assistant div.chat-response-message-right div.response-message-content div.custom-qwen-markdown .qwen-markdown.qwen-markdown-loose",
        "div.qwen-markdown.qwen-markdown-loose",
        "div.qwen-chat-message.qwen-chat-message-assistant div.qwen-markdown.qwen-markdown-loose",
        "div.qwen-chat-message-assistant div.custom-qwen-markdown .qwen-markdown",
        "[data-testid=\"chat-response\"]",
        "main article",
        ".prose",
        "main"
      ]
    },
    "observationDefaults": {
      "rootSelector": "main",
      "targetSelectors": [
        "div.qwen-chat-message.qwen-chat-message-assistant div.response-message-content div.custom-qwen-markdown > div.qwen-markdown.qwen-markdown-loose",
        "div.qwen-chat-message-assistant div.chat-response-message-right div.response-message-content div.custom-qwen-markdown .qwen-markdown.qwen-markdown-loose",
        "div.qwen-markdown.qwen-markdown-loose",
        "div.qwen-chat-message.qwen-chat-message-assistant div.qwen-markdown.qwen-markdown-loose",
        "div.qwen-chat-message-assistant div.custom-qwen-markdown .qwen-markdown",
        "[data-testid=\"chat-response\"]",
        "main article",
        ".prose"
      ],
      "stabilizationDelayMs": 1800,
      "endGenerationMarkers": [
        {
          "selector": "[data-testid=\"chat-loader\"]",
          "type": "disappear"
        }
      ]
    }
  },
  "Kimi": {
    "versions": [],
    "emergencyFallbacks": {
      "composer": [
        ".chat-input-editor",
        ".chat-editor [contenteditable=\"true\"]",
        "div[contenteditable=\"true\"]"
      ],
      "sendButton": [
        ".send-button-container:not(.disabled)",
        ".send-button-container",
        "button[class*=\"send\" i]"
      ],
      "response": [
        ".segment-assistant .markdown-container",
        ".segment-assistant",
        ".markdown-container",
        "[data-message-author-role=\"assistant\"]",
        "[data-role=\"assistant\"]",
        "[class*=\"assistant\" i] [class*=\"markdown\" i]"
      ]
    },
    "observationDefaults": {
      "rootSelector": "body",
      "targetSelectors": [
        ".chat-content-list",
        ".segment-assistant",
        ".markdown-container",
        "[data-message-author-role=\"assistant\"]",
        "[data-role=\"assistant\"]"
      ],
      "stabilizationDelayMs": 1800,
      "endGenerationMarkers": [
        {
          "selector": ".send-button-container.stop, [class*=\"stop\" i][class*=\"button\" i], [data-generating=\"true\"], [data-streaming=\"true\"], [aria-busy=\"true\"]",
          "type": "disappear"
        }
      ]
    }
  }
};
  const target = globalObject.SelectorConfigRegistry || {};
  Object.assign(target, bundle);
  globalObject.SelectorConfigRegistry = target;
  globalObject.__SELECTOR_CONFIG_BUNDLE_VERSION__ = '2025-12-11T11:55:39.238Z';
})();
