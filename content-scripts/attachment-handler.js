// Shared attachment handler with per-platform selectors and manual fallback.
(function (global) {
  if (global.AttachmentHandler) return;

  const DEFAULT_MAX_FILES = Infinity;
  // `typeof X?.y` still evaluates X, so it throws ReferenceError on a global that
  // was never declared -- it does not fall back to the literal below. TimingConfig
  // comes from config/timing.js, a separate manifest entry: if that file ever
  // fails to load, the guard itself would take this whole handler down and no
  // attachment could be delivered at all. Only bare `typeof X` is safe here.
  const hasTimingConfig = typeof TimingConfig !== 'undefined'
    && typeof TimingConfig?.getTiming === 'function';
  const DEFAULT_TIMEOUT_MS = hasTimingConfig
    ? TimingConfig.getTiming('attachmentTimeoutMs', 10000)
    : 10000;
  const DEFAULT_POLL_MS = hasTimingConfig
    ? TimingConfig.getTiming('attachmentPollMs', 200)
    : 200;

  const MODEL_CONFIG = {
    GPT: {
      // ChatGPT delivery, in order of what actually lands an upload:
      //   1. drop  — a synthetic DragEvent carrying a real DataTransfer (built in
      //      the page context via the main-world bridge). This is the same vector
      //      that fixed Qwen, and unlike paste it isn't gated on `isTrusted`, so
      //      ChatGPT's drop handler reads dataTransfer.files and actually uploads.
      //   2. paste — synthetic ClipboardEvent. Manual Ctrl+V works for the user,
      //      but the programmatic paste appears to be ignored (ChatGPT likely gates
      //      clipboardData on a trusted event), so it only sometimes lands. Kept as
      //      a fallback rather than the primary path.
      //   3. input — programmatically setting input.files makes the chip appear but
      //      the upload never completes; last resort only.
      // Confirmation gates each step, so a stuck input chip can't falsely "confirm"
      // and skip the working drop/paste paths — and so the cascade STOPS at the first
      // vector that actually lands the file (no duplicate "file already added").
      //
      // We deliberately do NOT set confirmOptional here. confirmOptional treated a
      // successful *dispatch* as success, but attachViaBridge returns true merely for
      // firing the event (it can't know the file landed) — so the cascade stopped
      // after drop(bridge) even when that vector didn't deliver, and nothing fell
      // back → the file silently never attached (worse than a duplicate, since GPT
      // then answers without the file). Reliable attach > cosmetic duplicate.
      //
      // The remaining duplicate happens only when confirm false-negatives (the chip
      // doesn't match confirmSelectors below). confirmSelectors is broadened with
      // generic upload indicators to catch the real attachment and stop early; if it
      // still misses, the safe failure mode is "works, with a duplicate warning",
      // never "no file". A true fix needs the live ChatGPT attached-file selector.
      preferPaste: false,
      // Never paste a File into ChatGPT: text-like files are interpreted as
      // composer text, which can replace the actual prompt with file contents.
      strategies: ['drop', 'input'],
      finishDragLifecycle: true,
      dropSelectors: [
        '#prompt-textarea',
        'form div[contenteditable="true"]',
        'div[contenteditable="true"]',
        '[role="textbox"]',
        'main form'
      ],
      pasteSelectors: [
        '#prompt-textarea',
        'div[contenteditable="true"]',
        'textarea',
        '[role="textbox"]'
      ],
      attachSelectors: [
        'button[aria-label*="Attach"]',
        'button[data-testid*="attach"]',
        'button[data-testid*="upload"]',
        'button[aria-label*="Upload"]'
      ],
      inputSelectors: [
        'input[type="file"][accept*="image"]',
        'input[type="file"][accept*="pdf"]',
        'input[type="file"]'
      ],
      // Broadened with generic upload indicators (blob/data image preview, remove
      // control) so confirm can detect a real upload and break the cascade before it
      // re-attaches. waitForUploadConfirmation compares against a pre-attach baseline,
      // so pre-existing matches never false-confirm. These are best-effort guesses
      // until the live attached-file selector is captured.
      confirmSelectors: [
        '[data-testid*="attachment"]',
        '[data-testid*="file"]',
        'img[src^="blob:"]',
        'img[src^="data:image"]',
        'button[aria-label*="Remove" i]',
        'button[aria-label*="Удалить" i]',
        '[class*="attachment" i]'
      ]
    },
    Grok: {
      // Grok's bridge dispatch may never produce an observable chip even when
      // the content-side input vector succeeds. Do not let that unobservable
      // bridge hold prompt insertion for the full file-scaled cascade budget.
      bridgeConfirmTimeoutMs: 2500,
      attachSelectors: [
        'button[aria-label*="Attach"]',
        'button[data-testid*="attach"]',
        'button[data-testid*="upload"]',
        'button[aria-label*="Upload"]'
      ],
      inputSelectors: [
        'input[type="file"][accept*="image"]',
        'input[type="file"][accept*="pdf"]',
        'input[type="file"]'
      ],
      // Run 1782940321214: the file chip was visibly present in the Grok
      // composer while both input:bridge and input:content confirm timed out —
      // Grok's tailwind/tiptap chips carry no data-testid, so the two narrow
      // selectors false-negatived. Broadened with the same generic upload
      // evidence set as GPT; waitForUploadConfirmation compares against a
      // pre-attach baseline, so pre-existing matches never false-confirm.
      confirmSelectors: [
        '[data-testid*="attachment"]',
        '[data-testid*="file"]',
        'img[src^="blob:"]',
        'img[src^="data:image"]',
        'button[aria-label*="Remove" i]',
        'button[aria-label*="Удалить" i]',
        '[class*="attachment" i]',
        '[class*="file-chip" i]',
        '[class*="chip" i]'
      ]
    },
    Claude: {
      attachSelectors: [
        'button[aria-label*="Attach"]',
        'button[aria-label*="Upload"]',
        'button[aria-label*="Add file"]',
        'button[data-testid*="attach"]',
        'button[data-testid*="upload"]',
        '[data-testid="composer-upload"]'
      ],
      inputSelectors: [
        'input[type="file"][accept*="image"]',
        'input[type="file"][accept*="pdf"]',
        'input[type="file"][multiple]',
        'input[type="file"]'
      ],
      confirmSelectors: [
        '[data-upload-id]',
        '[data-testid*="upload"] [data-upload-id]',
        '[data-testid*="file"]',
        '[data-testid*="attachment"]'
      ],
      confirmGoneSelectors: [
        '[data-testid*="upload"] [role="progressbar"]',
        '[data-testid*="upload"] [aria-busy="true"]',
        '[data-upload-id][aria-busy="true"]'
      ]
    },
    Gemini: {
      // Arbitrary files cannot be represented faithfully with the Web Clipboard
      // API (Finder/Explorer uses native file-reference clipboard formats). Use
      // page-scoped drop, paste and input fallbacks; browser-level debugging is
      // intentionally unavailable.
      // 2.81.304: `paste` added and `input` moved last. Gemini had no paste
      // vector at all, though paste is what actually delivers on Kimi, and it
      // had `input` -- the one the GPT note above calls out as making the chip
      // appear while the upload never completes -- ahead of `drop`.
      strategies: ['drop', 'paste', 'input'],
      // Raised with the vector count and because confirmation is now real work
      // rather than a formality; 12 s could not even cover this provider's own
      // 15 s input-evidence settle.
      timeoutMs: 45000,
      scaleTimeoutByFileCount: false,
      confirmationMode: 'batch',
      inputFileCountIsEvidence: true,
      // dispatchIsEvidence removed in 2.81.304. It was here because Gemini can
      // clear the native input and render its chip in an Angular overlay the
      // isolated world cannot inspect, so a DOM selector alone false-timed-out.
      // But it also let a dispatch that delivered nothing pass as delivered, and
      // runs 1786111563648, 1786138588032 and 1786139514606 all ended with the
      // prompt sent and no file on it. Failing closed is the lesser harm: an
      // answer produced without the file is indistinguishable from a real one
      // and silently corrupts the comparison. Non-selector evidence remains --
      // input file count for the trusted CDP vector, and the filename search
      // across open shadow roots -- so the overlay case is not left uncovered.
      settleMs: 2500,
      inputEvidenceSettleMs: 15000,
      dropSelectors: [
        'div.ql-editor[contenteditable="true"]',
        'rich-textarea div[contenteditable="true"]',
        'div[contenteditable="true"][role="textbox"]',
        'div[contenteditable="true"]',
        '[role="textbox"]'
      ],
      pasteSelectors: [
        'div.ql-editor[contenteditable="true"]',
        'rich-textarea div[contenteditable="true"]',
        'div[contenteditable="true"][role="textbox"]',
        'div[contenteditable="true"]',
        '[role="textbox"]'
      ],
      attachSelectors: [
        'button[aria-label*="Attach"]',
        'button[aria-label*="Upload file"]',
        'button[aria-label*="Add file"]',
        'button[data-testid*="attach"]'
      ],
      inputSelectors: [
        'input[type="file"][accept*="image"]',
        'input[type="file"][accept*="pdf"]',
        'input[type="file"][multiple]',
        'input[type="file"]'
      ],
      confirmSelectors: [
        '[data-test-id*="file"]',
        '[data-testid*="file"]',
        '.file-preview',
        '.file-chip',
        'img[src^="blob:"]',
        'img[src^="data:image"]',
        'button[aria-label*="Remove" i]',
        '[class*="attachment" i]',
        '[class*="upload" i]',
        'mat-chip'
      ],
      confirmGoneSelectors: [
        '[class*="upload" i][aria-busy="true"]',
        '[class*="attachment" i][aria-busy="true"]',
        '[role="progressbar"]',
        'mat-progress-bar'
      ]
    },
    Perplexity: {
      // 2.81.116: fallback added, see the Gemini note above.
      strategies: ['input'],
      settleMs: 1200,
      // Perplexity's paid-plan modal can briefly render generic upload classes.
      // Those transient nodes are not attachment evidence: a file chip,
      // filename or populated input must still exist when confirmation settles.
      persistentEvidenceRequired: true,
      // A successful bridge dispatch can replace the composer and render a file
      // chip whose classes no longer match our selectors. Never dispatch the same
      // file a second time while confirmation is catching up.
      attachSelectors: [
        'button[aria-label*="Attach"]',
        'button[aria-label*="Upload file"]',
        'button[aria-label*="Add file"]',
        'button[data-testid*="attach"]'
      ],
      inputSelectors: [
        'input[type="file"][accept*="image"]',
        'input[type="file"][accept*="pdf"]',
        'input[type="file"][multiple]',
        'input[type="file"]'
      ],
      confirmSelectors: [
        '[data-testid*="attachment"]',
        '[class*="file-chip"]',
        '[class*="attachment"]',
        '[class*="upload"]'
      ],
      confirmGoneSelectors: [
        '[class*="upload"][aria-busy="true"]',
        '[class*="upload"] [role="progressbar"]'
      ]
    },
    Qwen: {
      // Current Qwen UI exposes one stable native contract:
      // <input id="filesUpload" multiple type="file">. Use that stable native
      // contract through the page's input strategy; browser-level debugging is
      // intentionally unavailable.
      //
      // 2.81.302: that left Qwen as the only provider with no synthetic-event
      // vector at all, so its whole cascade was CDP plus `input` -- and `input`
      // is documented in the GPT config above as the one that "makes the chip
      // appear but the upload never completes". One real path, and a fallback
      // known not to deliver. Runs 1786138588032 and 1786139514606 both ended
      // with Qwen attaching nothing and, because the attachment gate is hard,
      // inserting no prompt either.
      // The two vectors added here are the ones with delivery evidence behind
      // them: `paste` is what actually put the file into Kimi (twice, which is
      // how the duplicate surfaced), and `drop` is what DeepSeek and Le Chat
      // use and what the GPT note calls "the same vector that fixed Qwen".
      // `input` stays last precisely because it is the least trustworthy.
      strategies: ['drop', 'paste', 'input'],
      dropSelectors: [
        'textarea[placeholder*="Ask me anything" i]',
        'textarea.ant-input',
        'form textarea',
        'textarea',
        'div[contenteditable="true"]',
        '[role="textbox"]',
        'form'
      ],
      pasteSelectors: [
        'textarea[placeholder*="Ask me anything" i]',
        'textarea.ant-input',
        'form textarea',
        'textarea',
        'div[contenteditable="true"]',
        '[role="textbox"]'
      ],
      inputSelectors: [
        'input#filesUpload[type="file"]',
        'input[id="filesUpload"]',
        'input[type="file"][multiple]',
        'input[type="file"]'
      ],
      // Raised with the vector count: the per-vector floor has to clear Qwen's
      // own 10 s inputEvidenceSettleMs, so 45 s funded only the first few.
      timeoutMs: 70000,
      scaleTimeoutByFileCount: false,
      inputFileCountIsEvidence: true,
      settleMs: 3000,
      inputEvidenceSettleMs: 10000,
      confirmSelectors: [
        '[data-testid*="attachment"]',
        '[class*="attachment"]',
        '[class*="file"]',
        '[class*="file-card"]'
      ],
      confirmGoneSelectors: [
        '[class*="upload"][aria-busy="true"]',
        '[class*="upload"] [role="progressbar"]'
      ]
    },
    DeepSeek: {
      strategies: ['drop', 'input'],
      dropSelectors: [
        'textarea',
        'div[contenteditable="true"]',
        '[role="textbox"]',
        '[class*="chat-input"]',
        '[class*="composer"]',
        '[class*="input-area"]',
        'main',
        'form'
      ],
      attachSelectors: [
        'button[aria-label*="Attach"]',
        'button[aria-label*="Upload file"]',
        'button[aria-label*="Upload"]',
        'button[data-testid*="attach"]',
        'button[data-testid*="upload"]'
      ],
      inputSelectors: [
        'input[type="file"][accept*="image"]',
        'input[type="file"][accept*="pdf"]',
        'input[type="file"][multiple]',
        'input[type="file"]'
      ],
      confirmSelectors: [
        '[data-testid*="attachment"]',
        '[data-testid*="file"]',
        '[class*="attachment" i]',
        '[class*="file" i]',
        '[class*="upload" i]',
        'img[src^="blob:"]',
        'button[aria-label*="Remove" i]'
      ],
      confirmGoneSelectors: [
        '[class*="upload" i][aria-busy="true"]',
        '[class*="upload" i] [role="progressbar"]',
        '[role="progressbar"]'
      ]
    },
    'Le Chat': {
      strategies: ['drop', 'input'],
      dropSelectors: [
        'textarea',
        'div[contenteditable="true"]',
        '[role="textbox"]',
        '[class*="chat-input"]',
        '[class*="composer"]',
        '[class*="input-area"]',
        'main',
        'form'
      ],
      attachSelectors: [
        'button[aria-label*="Attach"]',
        'button[aria-label*="Upload file"]',
        'button[aria-label*="Upload"]',
        'button[data-testid*="attach"]',
        'button[data-testid*="upload"]'
      ],
      inputSelectors: [
        'input[type="file"][accept*="image"]',
        'input[type="file"][accept*="pdf"]',
        'input[type="file"][multiple]',
        'input[type="file"]'
      ],
      confirmSelectors: [
        '[data-testid*="attachment"]',
        '[data-testid*="file"]',
        '[class*="attachment" i]',
        '[class*="file" i]',
        '[class*="upload" i]',
        'img[src^="blob:"]',
        'button[aria-label*="Remove" i]'
      ],
      confirmGoneSelectors: [
        '[class*="upload" i][aria-busy="true"]',
        '[class*="upload" i] [role="progressbar"]',
        '[role="progressbar"]'
      ]
    },
    'Z.ai': {
      // Z.ai accepts files through the composer paste path (the same native
      // interaction the user verified with copy + Ctrl+V). Do not fall back to
      // unrelated upload controls: prompt dispatch stays blocked until a new
      // attachment chip, filename or preview is observable.
      // 2.81.116: fallback added, see the Gemini note above. Paste is listed first
      // among the fallbacks because it is the native interaction this config was
      // originally written around.
      // 2.81.304: `drop` added -- Z.ai had no drop vector, though drop is what
      // DeepSeek and Le Chat deliver with. dispatchIsEvidence removed for the
      // same reason as Gemini above: it turned a dispatch that delivered nothing
      // into a delivery, and Z.ai kept sending the prompt with no file. settleMs
      // is what the old dispatchEvidenceSettleMs was really buying -- a moment
      // for the chip to render -- so it moves here as a real settle.
      strategies: ['paste', 'drop', 'input'],
      timeoutMs: 40000,
      settleMs: 1200,
      pasteSelectors: [
        '#chat-input',
        'textarea.input-scroll',
        'textarea[placeholder*="help you today" i]',
        'form textarea:not([type="search"])',
        '[contenteditable="true"][role="textbox"]'
      ],
      dropSelectors: [
        '#chat-input',
        'textarea.input-scroll',
        'textarea[placeholder*="help you today" i]',
        'form textarea:not([type="search"])',
        '[contenteditable="true"][role="textbox"]',
        'form',
        'main'
      ],
      confirmSelectors: [
        '[data-testid*="attachment" i]',
        '[data-testid*="file" i]',
        '[class*="attachment" i]',
        '[class*="file-chip" i]',
        '[class*="upload" i]',
        'img[src^="blob:"]',
        'button[aria-label*="remove" i]'
      ],
      confirmGoneSelectors: [
        '[class*="upload" i][aria-busy="true"]',
        '[class*="upload" i] [role="progressbar"]',
        '[role="progressbar"]'
      ]
    },
    Kimi: {
      // Kimi's composer is a Lexical contenteditable, so paste is the native
      // attachment path; the "+" control next to the composer opens the file
      // input used by the `input` fallback.
      strategies: ['paste', 'input'],
      settleMs: 1200,
      pasteSelectors: [
        '.chat-input-editor[contenteditable="true"]',
        '.chat-input-editor',
        '.chat-editor [contenteditable="true"]',
        '[contenteditable="true"][role="textbox"]'
      ],
      inputSelectors: [
        'input[type="file"][multiple]',
        'input[type="file"]'
      ],
      confirmSelectors: [
        '[class*="attachment" i]',
        '[class*="file-chip" i]',
        '[class*="upload" i]',
        'img[src^="blob:"]',
        'button[aria-label*="remove" i]'
      ],
      confirmGoneSelectors: [
        '[class*="upload" i][aria-busy="true"]',
        '[class*="upload" i] [role="progressbar"]',
        '[role="progressbar"]'
      ]
    }
  };

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  // Smallest confirmation window worth handing a delivery vector. Below this a
  // vector cannot realistically observe an upload chip, so slicing the cascade
  // budget too thin would silently reduce a multi-vector cascade to its first
  // vector. Always capped by the budget actually left (see tryVia).
  const CASCADE_MIN_CONFIRM_SLICE_MS = 4000;

  const parseDataUrlToBytes = (dataUrl = '') => {
    try {
      const match = String(dataUrl || '').match(/^data:([^;]+);base64,(.*)$/);
      const base64Part = match ? match[2] : dataUrl;
      const binary = atob(base64Part || '');
      const len = binary.length;
      const bytes = new Uint8Array(len);
      for (let i = 0; i < len; i++) {
        bytes[i] = binary.charCodeAt(i);
      }
      return bytes;
    } catch (err) {
      console.warn('[AttachmentHandler] Failed to parse data URL', err);
      return null;
    }
  };

  const hydrateAttachments = (raw = []) => {
    return (raw || [])
      .map((item) => {
        if (!item || !item.name || !item.base64) return null;
        try {
          const bytes = parseDataUrlToBytes(item.base64);
          if (!bytes) return null;
          return new File([bytes], item.name, { type: item.type || 'application/octet-stream' });
        } catch (err) {
          console.warn('[AttachmentHandler] Failed to hydrate attachment', item?.name, err);
          return null;
        }
      })
      .filter(Boolean);
  };

  const resolveConfig = (model, overrides = {}) => {
    const base = MODEL_CONFIG[model] || {};
    return {
      attachSelectors: overrides.attachSelectors || base.attachSelectors || [],
      inputSelectors: overrides.inputSelectors || base.inputSelectors || [],
      dropSelectors: overrides.dropSelectors || base.dropSelectors || [],
      pasteSelectors: overrides.pasteSelectors || base.pasteSelectors || [],
      confirmSelectors: overrides.confirmSelectors || base.confirmSelectors || [],
      confirmGoneSelectors: overrides.confirmGoneSelectors || base.confirmGoneSelectors || [],
      preferPaste: overrides.preferPaste != null ? overrides.preferPaste : (base.preferPaste || false),
      confirmOptional: overrides.confirmOptional != null ? overrides.confirmOptional : (base.confirmOptional || false),
      singleDispatch: overrides.singleDispatch != null ? overrides.singleDispatch : (base.singleDispatch || false),
      confirmationMode: overrides.confirmationMode || base.confirmationMode || 'per-file',
      inputFileCountIsEvidence: overrides.inputFileCountIsEvidence != null
        ? overrides.inputFileCountIsEvidence
        : (base.inputFileCountIsEvidence || false),
      dispatchIsEvidence: overrides.dispatchIsEvidence != null
        ? overrides.dispatchIsEvidence
        : (base.dispatchIsEvidence || false),
      dispatchEvidenceSettleMs: Number.isFinite(overrides.dispatchEvidenceSettleMs)
        ? overrides.dispatchEvidenceSettleMs
        : (base.dispatchEvidenceSettleMs || 0),
      scaleTimeoutByFileCount: overrides.scaleTimeoutByFileCount != null
        ? overrides.scaleTimeoutByFileCount
        : (base.scaleTimeoutByFileCount !== false),
      settleMs: Number.isFinite(overrides.settleMs)
        ? overrides.settleMs
        : (Number.isFinite(base.settleMs) ? base.settleMs : 1000),
      inputEvidenceSettleMs: Number.isFinite(overrides.inputEvidenceSettleMs)
        ? overrides.inputEvidenceSettleMs
        : (Number.isFinite(base.inputEvidenceSettleMs) ? base.inputEvidenceSettleMs : 0),
      strategies: overrides.strategies || base.strategies || null,
      finishDragLifecycle: overrides.finishDragLifecycle != null
        ? overrides.finishDragLifecycle
        : (base.finishDragLifecycle || false),
      sequentialFiles: overrides.sequentialFiles != null
        ? overrides.sequentialFiles
        : (base.sequentialFiles || false),
      timeoutMs: Number.isFinite(overrides.timeoutMs)
        ? overrides.timeoutMs
        : (Number.isFinite(base.timeoutMs) ? base.timeoutMs : DEFAULT_TIMEOUT_MS),
      bridgeConfirmTimeoutMs: Number.isFinite(overrides.bridgeConfirmTimeoutMs)
        ? overrides.bridgeConfirmTimeoutMs
        : (Number.isFinite(base.bridgeConfirmTimeoutMs) ? base.bridgeConfirmTimeoutMs : null),
      pollMs: Number.isFinite(overrides.pollMs) ? overrides.pollMs : DEFAULT_POLL_MS,
      maxFiles: Number.isFinite(overrides.maxFiles) ? overrides.maxFiles : DEFAULT_MAX_FILES
    };
  };

  const waitForSelectorMatch = async (selectors = [], timeoutMs = DEFAULT_TIMEOUT_MS, pollMs = DEFAULT_POLL_MS) => {
    if (!selectors.length) return false;
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      for (const selector of selectors) {
        if (!selector) continue;
        if (document.querySelector(selector)) return true;
      }
      await sleep(pollMs);
    }
    return false;
  };

  const collectOpenRoots = () => {
    const roots = [document];
    const seen = new Set();
    for (let i = 0; i < roots.length; i++) {
      const root = roots[i];
      if (!root || seen.has(root)) continue;
      seen.add(root);
      try {
        root.querySelectorAll?.('*').forEach((el) => {
          if (el.shadowRoot && !seen.has(el.shadowRoot)) roots.push(el.shadowRoot);
        });
      } catch (_) {}
    }
    return roots;
  };

  const countSelectorMatches = (selectors = []) => {
    if (!selectors.length) return 0;
    const matches = new Set();
    collectOpenRoots().forEach((root) => {
      selectors.forEach((selector) => {
        if (!selector) return;
        try { root.querySelectorAll(selector).forEach((el) => matches.add(el)); } catch (_) {}
      });
    });
    return matches.size;
  };

  const normalizeFilename = (value = '') => String(value || '').normalize('NFC').replace(/\s+/g, ' ').trim().toLowerCase();

  // Provider markup changes frequently, but the file name is the stable piece of
  // evidence users actually see in an attachment chip. Search light-weight visible
  // text/attributes across open shadow roots and compare against the pre-dispatch
  // baseline so an old chip cannot confirm a new request.
  const filenameEvidenceCounts = (files = []) => {
    const names = [...new Set(files.map((file) => normalizeFilename(file?.name)).filter(Boolean))];
    if (!names.length) return {};
    const haystacks = [];
    collectOpenRoots().forEach((root) => {
      try { haystacks.push(normalizeFilename(root.body?.innerText || root.innerText || root.textContent || '')); } catch (_) {}
      try {
        root.querySelectorAll?.('[aria-label],[title],[data-testid],[data-test-id]').forEach((el) => {
          haystacks.push(normalizeFilename([
            el.getAttribute?.('aria-label'),
            el.getAttribute?.('title'),
            el.getAttribute?.('data-testid'),
            el.getAttribute?.('data-test-id')
          ].filter(Boolean).join(' ')));
        });
      } catch (_) {}
    });
    // Count occurrences instead of presence: an old mention and a new chip with
    // the same filename must be distinguishable. Take the maximum across text
    // and attribute views so one chip is not counted twice merely for its title.
    return Object.fromEntries(names.map(name => [name,
      haystacks.reduce((count, text) => Math.max(count, text.split(name).length - 1), 0)
    ]));
  };
  const countFilenameEvidence = (files = []) => Object.values(filenameEvidenceCounts(files)).reduce((sum, count) => sum + count, 0);

  const countAttachedInputFiles = () => {
    const roots = [document];
    const seen = new Set();
    let maxCount = 0;
    while (roots.length) {
      const root = roots.shift();
      if (!root || seen.has(root)) continue;
      seen.add(root);
      try {
        root.querySelectorAll?.('input[type="file"]').forEach((input) => {
          maxCount = Math.max(maxCount, Number(input?.files?.length || 0));
        });
        root.querySelectorAll?.('*').forEach((el) => {
          if (el.shadowRoot) roots.push(el.shadowRoot);
        });
      } catch (_) {}
    }
    return maxCount;
  };

  const emitAttachmentTelemetry = (model, label, details = '', level = 'info', meta = {}) => {
    try {
      chrome.runtime.sendMessage({
        type: 'LLM_DIAGNOSTIC_EVENT',
        llmName: model,
        event: {
          type: 'TELEMETRY',
          label,
          details,
          level,
          meta: { ...meta, event: label }
        }
      });
    } catch (_) {}
  };

  // The background holds tab focus for a few seconds after dispatch and drops it
  // unless the provider reports progress. An attachment cascade legitimately runs
  // far longer than a composer interaction, so it has to keep saying it is alive
  // or the hold dies mid-upload and the entire round is redone by a repair
  // dispatch. Run 1786140702935: Qwen's round 1 ended hold_elapsed at 8 s with
  // extendedMs 0 while the cascade was still working, and the prompt was only
  // inserted at 17 s, by the repair round, then sent at 19 s.
  const ATTACHMENT_PROGRESS_STAGE = 'attachment_upload_started';
  const ATTACHMENT_PROGRESS_MIN_INTERVAL_MS = 2000;
  let lastAttachmentProgressAt = 0;
  const reportAttachmentProgress = (model, force = false) => {
    const now = Date.now();
    if (!force && now - lastAttachmentProgressAt < ATTACHMENT_PROGRESS_MIN_INTERVAL_MS) return;
    lastAttachmentProgressAt = now;
    try {
      global.ContentUtils?.reportDispatchStage?.(model, {}, ATTACHMENT_PROGRESS_STAGE, {
        outcome: 'in_flight'
      });
    } catch (_) {}
  };

  const captureUploadBaseline = (config, files = []) => ({
    confirmCount: countSelectorMatches(config.confirmSelectors || []),
    progressCount: countSelectorMatches(config.confirmGoneSelectors || []),
    inputFileCount: countAttachedInputFiles(),
    filenameEvidenceCount: countFilenameEvidence(files)
  });

  const waitForUploadConfirmation = async (config, expectedCount = 1, baselineState = null, files = [], confirmTimeoutMs = null, allowInputFileCountEvidence = true, onPoll = null) => {
    const confirmSelectors = config.confirmSelectors || [];
    const confirmGoneSelectors = config.confirmGoneSelectors || [];
    if (!confirmSelectors.length && !confirmGoneSelectors.length) {
      return { confirmed: true, reason: 'NO_CONFIRMATION_SELECTORS', elapsedMs: 0 };
    }
    // An explicit budget comes from the cascade in attach(): the caller owns one
    // shared deadline for every delivery vector. Falling back to the per-provider
    // timeout keeps direct callers working.
    const totalTimeoutMs = Number.isFinite(confirmTimeoutMs)
      ? Math.max(0, confirmTimeoutMs)
      : (config.scaleTimeoutByFileCount === false
        ? (config.timeoutMs || DEFAULT_TIMEOUT_MS)
        : (config.timeoutMs || DEFAULT_TIMEOUT_MS) * Math.max(1, expectedCount));
    const pollMs = config.pollMs || DEFAULT_POLL_MS;
    const deadline = Date.now() + totalTimeoutMs;
    const baseline = Number.isFinite(baselineState?.confirmCount)
      ? baselineState.confirmCount
      : countSelectorMatches(confirmSelectors);
    const baselineProgress = Number.isFinite(baselineState?.progressCount)
      ? baselineState.progressCount
      : countSelectorMatches(confirmGoneSelectors);
    let lastCount = baseline;
    let lastInputFileCount = Number(baselineState?.inputFileCount || 0);
    let sawProgress = false;
    let evidenceAt = 0;
    let providerEvidenceSeen = false;
    const baselineFilenameEvidence = Number(baselineState?.filenameEvidenceCount || 0);
    const requiredNames = {};
    files.forEach(file => {
      const name = normalizeFilename(file?.name);
      if (name) requiredNames[name] = (requiredNames[name] || 0) + 1;
    });
    const requiredDelta = config.confirmationMode === 'batch' ? 1 : expectedCount;

    while (Date.now() < deadline) {
      const currentCount = countSelectorMatches(confirmSelectors);
      const inputFileCount = countAttachedInputFiles();
      const filenameCounts = filenameEvidenceCounts(files);
      const filenameEvidenceCount = Object.values(filenameCounts).reduce((sum, count) => sum + count, 0);
      const selectorEvidence = currentCount >= baseline + requiredDelta;
      // Only admissible when this vector did not assign input.files itself --
      // see the caller. Reading back our own write is not an observation.
      const inputEvidence = allowInputFileCountEvidence
        && config.inputFileCountIsEvidence === true
        && inputFileCount >= expectedCount;
      const filenameEvidence = baselineState?.filenameEvidenceByName
        ? Object.keys(requiredNames).length > 0 && Object.entries(requiredNames).every(([name, count]) =>
          (filenameCounts[name] || 0) >= (baselineState.filenameEvidenceByName[name] || 0) + count)
        : filenameEvidenceCount >= baselineFilenameEvidence + expectedCount;
      const evidenceNow = selectorEvidence || inputEvidence || filenameEvidence;
      if (selectorEvidence || filenameEvidence) providerEvidenceSeen = true;
      if (evidenceNow && !evidenceAt) evidenceAt = Date.now();
      const hasEvidence = evidenceNow
        || (config.persistentEvidenceRequired !== true && evidenceAt > 0);
      if (config.persistentEvidenceRequired === true && !evidenceNow) evidenceAt = 0;
      const requiredSettleMs = providerEvidenceSeen || !allowInputFileCountEvidence
        ? (config.settleMs || 0)
        : (config.inputEvidenceSettleMs || config.settleMs || 0);
      if (confirmGoneSelectors.length) {
        const progressCount = countSelectorMatches(confirmGoneSelectors);
        // Measured against the pre-dispatch baseline, exactly as confirmCount is.
        // The absolute count was used here while captureUploadBaseline recorded a
        // progress baseline that nothing ever read, so any progress node the page
        // keeps mounted permanently held both success branches shut forever --
        // confirmation became impossible no matter how much evidence appeared.
        // That is Gemini: an Angular Material app whose confirmGoneSelectors
        // include [role="progressbar"] and mat-progress-bar. It also explains the
        // note that originally justified dispatchIsEvidence here, "a false
        // timeout even while the file was visibly attached" -- the file was
        // attached; the gate simply never opened.
        const activeProgress = Math.max(0, progressCount - baselineProgress);
        if (activeProgress > 0) sawProgress = true;
        const settled = activeProgress === 0
          && hasEvidence
          && Date.now() - evidenceAt >= requiredSettleMs;
        if (settled || (sawProgress && activeProgress === 0 && hasEvidence)) {
          return {
            confirmed: true,
            baselineCount: baseline,
            currentCount,
            inputFileCount,
            filenameEvidenceCount,
            baselineProgress,
            progressCount,
            sawProgress,
            elapsedMs: totalTimeoutMs - Math.max(0, deadline - Date.now())
          };
        }
      } else if (hasEvidence && Date.now() - evidenceAt >= requiredSettleMs) {
        return {
          confirmed: true,
          baselineCount: baseline,
          currentCount,
          inputFileCount,
          filenameEvidenceCount,
          sawProgress,
          elapsedMs: totalTimeoutMs - Math.max(0, deadline - Date.now())
        };
      }
      lastCount = currentCount;
      lastInputFileCount = inputFileCount;
      // Waiting for evidence is still work in progress: keep the focus hold alive
      // rather than letting it expire in the middle of a live upload.
      try { onPoll?.(); } catch (_) {}
      await sleep(pollMs);
    }
    return {
      confirmed: false,
      baselineCount: baseline,
      currentCount: lastCount,
      inputFileCount: lastInputFileCount,
      filenameEvidenceCount: countFilenameEvidence(files),
      baselineProgress,
      progressCount: countSelectorMatches(confirmGoneSelectors),
      sawProgress,
      elapsedMs: totalTimeoutMs
    };
  };

  const findFirst = async (selectors = [], timeoutMs = 2000, pollMs = 150) => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      for (const selector of selectors) {
        if (!selector) continue;
        const el = document.querySelector(selector);
        if (el) return el;
      }
      await sleep(pollMs);
    }
    return null;
  };

  const attachViaInput = async (files, config) => {
    const attachButton = await findFirst(config.attachSelectors, 1200, 120);
    if (attachButton) {
      try {
        attachButton.click();
        await sleep(300);
      } catch (_) {}
    }
    const input = await findFirst(config.inputSelectors, 3000, 120) || document.querySelector('input[type="file"]');
    if (!input) return false;
    const dt = new DataTransfer();
    files.forEach((file) => {
      try { dt.items.add(file); } catch (_) {}
    });
    try {
      input.files = dt.files;
    } catch (err) {
      console.warn('[AttachmentHandler] Failed to set input files', err);
    }
    try {
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    } catch (_) {}
    try { input.focus?.({ preventScroll: true }); } catch (_) { try { input.focus?.(); } catch (_) {} }
    return true;
  };

  const attachViaPaste = async (files, config = {}) => {
    const selectors = (config.pasteSelectors || []).concat([
      '[contenteditable="true"]', 'textarea', '[role="textbox"]'
    ]);
    const target = await findFirst(selectors, 3000, 120);
    if (!target) return false;
    const dt = new DataTransfer();
    files.forEach((file) => { try { dt.items.add(file); } catch (_) {} });
    dt.effectAllowed = 'copy';
    const factory = () => {
      const ev = new ClipboardEvent('paste', { bubbles: true, cancelable: true });
      if (!ev.clipboardData) {
        try { Object.defineProperty(ev, 'clipboardData', { value: dt }); } catch (_) {}
      } else if (dt.items?.length) {
        dt.items.forEach((item) => { try { ev.clipboardData.items.add(item.getAsFile()); } catch (_) {} });
      }
      return ev;
    };
    try {
      try { target.focus?.({ preventScroll: true }); } catch (_) { try { target.focus?.(); } catch (_) {} }
      // Exactly one paste, for the same reason as the bridge path: a second
      // blind dispatch attaches the file twice wherever paste genuinely works.
      target.dispatchEvent(factory());
      return true;
    } catch (err) {
      console.warn('[AttachmentHandler] paste attach failed', err);
      return false;
    }
  };

  const attachGeminiViaCdpFileInput = (attachments) => new Promise((resolve) => {
    try {
      chrome.runtime.sendMessage({
        type: 'GEMINI_CDP_ATTACH_REQUEST',
        attachments
      }, (response) => {
        if (chrome.runtime.lastError) {
          resolve({ ok: false, reason: chrome.runtime.lastError.message || 'runtime_error' });
          return;
        }
        resolve(response || { ok: false, reason: 'empty_response' });
      });
    } catch (_) {
      resolve({ ok: false, reason: 'request_failed' });
    }
  });

  const attachQwenViaCdpFileInput = (attachments) => new Promise((resolve) => {
    try {
      chrome.runtime.sendMessage({
        type: 'QWEN_CDP_ATTACH_REQUEST',
        attachments
      }, (response) => {
        if (chrome.runtime.lastError) {
          resolve({ ok: false, reason: chrome.runtime.lastError.message || 'runtime_error' });
          return;
        }
        resolve(response || { ok: false, reason: 'empty_response' });
      });
    } catch (_) {
      resolve({ ok: false, reason: 'request_failed' });
    }
  });

  const attachProviderViaCdpFileInput = (model, attachments) => new Promise((resolve) => {
    try {
      chrome.runtime.sendMessage({
        type: 'PROVIDER_CDP_ATTACH_REQUEST',
        llmName: model,
        attachments
      }, (response) => {
        if (chrome.runtime.lastError) {
          resolve({ ok: false, reason: chrome.runtime.lastError.message || 'runtime_error' });
          return;
        }
        resolve(response || { ok: false, reason: 'empty_response' });
      });
    } catch (_) {
      resolve({ ok: false, reason: 'request_failed' });
    }
  });

  // Content-script drag&drop fallback (the main-world bridge drop is preferred —
  // it builds the DataTransfer in the page context — but this covers the case
  // where the bridge is unavailable). Used for Qwen, which only accepts drop.
  const attachViaDrop = async (files, config) => {
    const selectors = (config.dropSelectors && config.dropSelectors.length)
      ? config.dropSelectors
      : ['[contenteditable="true"]', 'textarea', '[role="textbox"]'];
    let target = null;
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el) { target = el; break; }
    }
    if (!target) return false;
    const dt = new DataTransfer();
    files.forEach((file) => { try { dt.items.add(file); } catch (_) {} });
    dt.effectAllowed = 'copy';
    const rect = target.getBoundingClientRect?.() || { left: 0, top: 0, width: 0, height: 0 };
    const coords = { clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2 };
    try {
      try { target.focus?.({ preventScroll: true }); } catch (_) { try { target.focus?.(); } catch (_) {} }
      for (const type of ['dragenter', 'dragover', 'drop']) {
        const ev = new DragEvent(type, Object.assign({ bubbles: true, cancelable: true, dataTransfer: dt }, coords));
        target.dispatchEvent(ev);
        await sleep(40);
      }
      if (config.finishDragLifecycle === true) {
        await sleep(40);
        for (const type of ['dragleave', 'dragend']) {
          target.dispatchEvent(new DragEvent(type, Object.assign({ bubbles: true, cancelable: true, dataTransfer: dt }, coords)));
        }
      }
      return true;
    } catch (err) {
      console.warn('[AttachmentHandler] drop attach failed', err);
      return false;
    }
  };

  const attachViaBridge = async (attachments, config, mode = 'auto') => {
    if (!attachments || !attachments.length) return false;
    const ensureBridge = global.ContentUtils?.ensureMainWorldBridge;
    if (typeof ensureBridge === 'function') {
      const loaded = await ensureBridge();
      if (!loaded) return false;
    }
    const bridgeToken = global.ContentUtils?.getMainBridgeToken?.();
    if (!bridgeToken) {
      console.warn('[AttachmentHandler] Main-world bridge token unavailable');
      return false;
    }
    try {
      window.dispatchEvent(new CustomEvent('EXT_ATTACH', {
        detail: {
          bridgeToken,
          bridgeSource: 'content-script',
          attachments,
          mode,
          attachSelectors: config.attachSelectors,
          inputSelectors: config.inputSelectors,
          dropSelectors: config.dropSelectors,
          pasteSelectors: config.pasteSelectors,
          finishDragLifecycle: config.finishDragLifecycle === true
        }
      }));
      await sleep(200);
      return true;
    } catch (err) {
      console.warn('[AttachmentHandler] Bridge attach failed', err);
      return false;
    }
  };

  const notifyManualAttachmentRequired = (modelName, attachments = [], reason = '') => {
    if (!attachments || !attachments.length) return;
    const label = modelName || 'LLM';
    const message = `${label}: failed to attach ${attachments.length} file(s) automatically. Please attach manually.`;
    try {
      chrome?.runtime?.sendMessage?.({ type: 'ATTACHMENT_MANUAL_REQUIRED', llmName: label, message });
    } catch (_) {}
    try {
      chrome?.runtime?.sendMessage?.({
        type: 'LLM_DIAGNOSTIC_EVENT',
        llmName: label,
        event: { type: 'ATTACH', label: 'Manual attachment required', details: message, level: 'warning', meta: { reason } }
      });
    } catch (_) {}
  };

  const attach = async (model, attachments = [], overrides = {}) => {
    const reportFailure = reason => {
      try {
        global.ContentUtils?.reportDispatchStage?.(model, {}, 'attachment_upload_failed', {
          outcome: 'failed', reason
        });
      } catch (_) {}
    };
    if (!attachments || !attachments.length) {
      return { success: true, delivered: true, uploadSettled: true, ready: true, evidence: 'not_required', uploadedCount: 0, failedFiles: [], reason: 'NO_ATTACHMENTS' };
    }
    const config = resolveConfig(model, overrides);
    const files = hydrateAttachments(attachments).slice(0, config.maxFiles);
    if (!files.length) {
      reportFailure('NO_FILES');
      return { success: false, delivered: false, uploadSettled: false, ready: false, evidence: null, uploadedCount: 0, failedFiles: attachments, reason: 'NO_FILES' };
    }
    if (config.sequentialFiles === true && files.length > 1) {
      const limitedAttachments = attachments.slice(0, files.length);
      let uploadedCount = 0;
      for (let index = 0; index < limitedAttachments.length; index += 1) {
        emitAttachmentTelemetry(model, 'ATTACHMENT_SEQUENCE_ITEM_START', `${index + 1}/${limitedAttachments.length}`, 'info', {
          itemIndex: index,
          itemCount: limitedAttachments.length,
          filename: limitedAttachments[index]?.name || null
        });
        const itemResult = await attach(model, [limitedAttachments[index]], {
          ...overrides,
          sequentialFiles: false,
          maxFiles: 1
        });
        if (!itemResult?.success) {
          return {
            success: false,
            uploadedCount,
            failedFiles: limitedAttachments.slice(index),
            reason: itemResult?.reason || 'SEQUENTIAL_ITEM_FAILED'
          };
        }
        uploadedCount += 1;
        emitAttachmentTelemetry(model, 'ATTACHMENT_SEQUENCE_ITEM_CONFIRMED', `${index + 1}/${limitedAttachments.length}`, 'success', {
          itemIndex: index,
          itemCount: limitedAttachments.length,
          filename: limitedAttachments[index]?.name || null
        });
      }
      return { success: true, delivered: true, uploadSettled: true, ready: true, evidence: 'sequential_confirmation', uploadedCount, failedFiles: [], reason: 'SEQUENTIAL_CONFIRMED' };
    }
    let attached = false;
    let attempted = false;
    const expectedCount = files.length;
    // The entire delivery attempt shares a baseline. A slow first vector may
    // render its chip during a fallback; recapturing would absorb that upload
    // into the old state and require yet another copy to appear.
    const baselineState = captureUploadBaseline(config);
    baselineState.filenameEvidenceByName = filenameEvidenceCounts(files);
    baselineState.filenameEvidenceCount = Object.values(baselineState.filenameEvidenceByName).reduce((sum, count) => sum + count, 0);

    // Per-model ordered strategy list. Each strategy first tries the main-world
    // bridge (authentic DataTransfer/events in page context), then a content-script
    // fallback, confirming upload after each. Default preserves the historical
    // behaviour (input, plus paste for preferPaste models).
    const strategies = (Array.isArray(config.strategies) && config.strategies.length)
      ? config.strategies
      : (config.preferPaste ? ['paste', 'input'] : ['input']);

    const confirmOptional = config.confirmOptional === true;

    // One budget for the whole cascade. Each strategy used to start its own full
    // confirmation timeout, so the per-provider timeoutMs was really a per-vector
    // cost: Qwen's 45 s became 135 s across qwen-cdp → input:bridge → input:content,
    // and the caller sat through a two-minute stall before a hard attachment
    // failure. Every vector now draws a slice of one budget, and time a
    // fast-failing vector leaves unused rolls forward to the vectors after it.
    // 'drop'/'paste'/'input' each expand to a bridge and a content vector.
    const cascadeVectorCount = strategies.reduce((count, name) => (
      count + (name === 'drop' || name === 'paste' || name === 'input' ? 2 : 1)
    ), 0);
    const cascadeBudgetMs = config.scaleTimeoutByFileCount === false
      ? (config.timeoutMs || DEFAULT_TIMEOUT_MS)
      : (config.timeoutMs || DEFAULT_TIMEOUT_MS) * Math.max(1, expectedCount);
    // The budget bounds how long we WAIT FOR EVIDENCE, not total elapsed time. A
    // wall-clock deadline taken at entry also charged the dispatch itself. Run
    // 1786138588032: Qwen inserted
    // neither the file nor the prompt, because dispatch had eaten enough of the
    // deadline that every remaining slice fell under Qwen's own 10 s
    // inputEvidenceSettleMs — confirmation was arithmetically impossible, all three
    // vectors failed, and the hard attachment gate then blocked prompt insertion.
    let confirmSpentMs = 0;
    let vectorsRemaining = cascadeVectorCount;
    // A slice shorter than the settle the provider demands can never confirm, so
    // the floor has to clear it. Otherwise the budget guarantees the failure it is
    // supposed to be bounding. The longer inputEvidenceSettleMs only applies where
    // input-file-count is admissible evidence, which is the trusted CDP vector
    // alone -- charging every vector for it starved cascades that never rely on
    // it (Gemini: a 15 s requirement against a 12 s budget).
    const minConfirmSliceFor = (admitsInputFileCount) => {
      const settleMs = admitsInputFileCount && config.inputFileCountIsEvidence === true
        ? Math.max(Number(config.settleMs || 0), Number(config.inputEvidenceSettleMs || 0))
        : Number(config.settleMs || 0);
      return Math.max(
        CASCADE_MIN_CONFIRM_SLICE_MS,
        settleMs + 2 * (config.pollMs || DEFAULT_POLL_MS)
      );
    };

    // Run one delivery vector. A successful dispatch is confirmed first (clean
    // success when confirmSelectors match). When confirmOptional, a dispatch that
    // didn't confirm still counts as delivered — this stops the cascade from
    // re-attaching the same file via every remaining vector (the duplicate-insert
    // / "file already added" bug on ChatGPT). Returns 'delivered' to break the
    // loop, or false to fall through to the next vector.
    const tryVia = async (strategy, dispatchFn) => {
      // Never mutate the composer when no observation budget remains. Otherwise
      // the final vector inserts a file and immediately declares it unconfirmed.
      if (confirmSpentMs >= cascadeBudgetMs) return false;
      // This vector is consumed the moment it runs, whatever its outcome, so the
      // slice arithmetic below always reflects vectors that have yet to start.
      const vectorsLeftAfterThis = Math.max(0, vectorsRemaining - 1);
      vectorsRemaining = vectorsLeftAfterThis;
      reportAttachmentProgress(model, true);
      const startedAt = Date.now();
      emitAttachmentTelemetry(model, 'ATTACHMENT_STRATEGY_START', strategy, 'info', {
        strategy,
        expectedCount,
        baselineState,
        cascadeBudgetMs,
        cascadeRemainingMs: Math.max(0, cascadeBudgetMs - confirmSpentMs),
        vectorsLeftAfterThis
      });
      // A strategy that throws must not abort the remaining strategies; letting
      // one vector fail would otherwise kill the whole attachment chain and with
      // it the prompt dispatch.
      let dispatchResult;
      try {
        dispatchResult = await dispatchFn();
      } catch (error) {
        emitAttachmentTelemetry(model, 'ATTACHMENT_DISPATCH_FAILED', strategy, 'warning', {
          strategy,
          expectedCount,
          reason: `dispatch_threw:${error?.message || 'unknown'}`,
          dispatchElapsedMs: Date.now() - startedAt
        });
        return false;
      }
      const ok = dispatchResult === true || dispatchResult?.ok === true;
      if (!ok) {
        emitAttachmentTelemetry(model, 'ATTACHMENT_DISPATCH_FAILED', strategy, 'warning', {
          strategy,
          expectedCount,
          reason: dispatchResult?.reason || 'dispatch_failed',
          dispatchElapsedMs: Date.now() - startedAt
        });
        return false;
      }
      attempted = true;
      emitAttachmentTelemetry(model, 'ATTACHMENT_DISPATCHED', strategy, 'info', {
        strategy,
        expectedCount,
        dispatchMethod: dispatchResult?.method || strategy,
        dispatchElapsedMs: Date.now() - startedAt
      });
      // dispatchIsEvidence used to return here, before any observation ran. That
      // made "the event was fired" indistinguishable from "the file arrived" —
      // and attachViaBridge returns true merely for firing, as its own comment
      // says. Field run 1786111563648: Gemini and Z.ai reported the attachment
      // confirmed in 1.2-2.5 s and then sent the prompt with no file at all,
      // while the progress-bar gate in confirmGoneSelectors never ran once
      // because this early return skipped it.
      // Observation now always happens first and gets the real cascade budget.
      // dispatchIsEvidence survives only as a last word after observation found
      // nothing, for the case it was written for: a chip rendered in a shadow or
      // Angular overlay the isolated content world cannot read.
      if (config.dispatchEvidenceSettleMs && config.dispatchIsEvidence === true) {
        await sleep(Math.max(0, Number(config.dispatchEvidenceSettleMs)));
      }
      // An `input` vector sets input.files from JS itself, so reading that count
      // back proves only that our own assignment executed -- it says nothing
      // about whether the provider accepted or uploaded anything. The GPT config
      // above records exactly this failure mode: setting input.files "makes the
      // chip appear but the upload never completes". Run 1786138588032: Qwen sent
      // the prompt with no file after input:content "confirmed" on that circular
      // evidence. A trusted CDP assignment is different -- DOM.setFileInputFiles
      // is a real browser-level operation that drives the page's upload path --
      // so input-file-count stays admissible there.
      const allowInputFileCountEvidence = [
        'cdp-file-input', 'qwen-cdp-file-input', 'provider-cdp-file-input'
      ].includes(strategy);
      // Share what is left of the budget with the vectors still to come. The floor
      // clears this vector's own settle requirement, so a slice is always long
      // enough for confirmation to be possible at all, and unused time from a
      // fast-failing vector rolls forward. Only confirmation waiting is charged.
      const minConfirmSliceMs = minConfirmSliceFor(allowInputFileCountEvidence);
      const cascadeRemainingMs = Math.max(0, cascadeBudgetMs - confirmSpentMs);
      const bridgeConfirmCapMs = strategy.endsWith(':bridge')
        && Number.isFinite(config.bridgeConfirmTimeoutMs)
        ? Math.max(0, Number(config.bridgeConfirmTimeoutMs))
        : null;
      const confirmBudgetMs = Math.min(
        cascadeRemainingMs,
        ...(bridgeConfirmCapMs !== null ? [bridgeConfirmCapMs] : []),
        vectorsLeftAfterThis > 0
          ? Math.max(minConfirmSliceMs, Math.floor(cascadeRemainingMs / (vectorsLeftAfterThis + 1)))
          : cascadeRemainingMs
      );
      const confirmStartedAt = Date.now();
      const confirmation = await waitForUploadConfirmation(
        config, expectedCount, baselineState, files, confirmBudgetMs, allowInputFileCountEvidence,
        () => reportAttachmentProgress(model)
      );
      confirmSpentMs += Date.now() - confirmStartedAt;
      if (confirmation?.confirmed) {
        emitAttachmentTelemetry(model, 'ATTACHMENT_CONFIRMED', strategy, 'success', {
          strategy,
          expectedCount,
          confirmBudgetMs,
          ...confirmation
        });
        return true;
      }
      emitAttachmentTelemetry(model, 'ATTACHMENT_CONFIRM_TIMEOUT', strategy, 'warning', {
        strategy,
        expectedCount,
        confirmBudgetMs,
        minConfirmSliceMs,
        cascadeRemainingMs: Math.max(0, cascadeBudgetMs - confirmSpentMs),
        ...confirmation
      });
      // Observation found nothing. Accept the dispatch only where the provider is
      // configured to allow it, and never silently: this is the state in which a
      // prompt can still go out without its file, so it must be visible in the
      // report rather than logged as a clean success.
      if (config.dispatchIsEvidence === true) {
        emitAttachmentTelemetry(model, 'ATTACHMENT_ACCEPTED_UNPROVEN', strategy, 'warning', {
          strategy,
          expectedCount,
          reason: 'TRUSTED_DISPATCH_WITHOUT_OBSERVED_EVIDENCE',
          residualRisk: 'attachment_delivery_not_proven',
          dispatchMethod: dispatchResult?.method || strategy,
          confirmBudgetMs,
          elapsedMs: Date.now() - startedAt,
          ...confirmation
        });
        return true;
      }
      return confirmOptional;
    };

    const runStrategy = async (name) => {
      // Bridge first (authentic events in page context). Crucially, if the bridge
      // dispatch already delivered we must NOT also run the content-script fallback
      // for the same vector — that would attach the file twice. The content path
      // runs only when the bridge dispatch itself didn't deliver.
      if (name === 'cdp-file-input') {
        return tryVia(name, () => attachGeminiViaCdpFileInput(attachments));
      }
      if (name === 'qwen-cdp-file-input') {
        return tryVia(name, () => attachQwenViaCdpFileInput(attachments));
      }
      if (name === 'provider-cdp-file-input') {
        return tryVia(name, () => attachProviderViaCdpFileInput(model, attachments));
      }
      if (name === 'drop') {
        if (await tryVia('drop:bridge', () => attachViaBridge(attachments, config, 'drop'))) return true;
        if (attempted && config.singleDispatch) return false;
        if (await tryVia('drop:content', () => attachViaDrop(files, config))) return true;
        return false;
      }
      if (name === 'paste') {
        if (await tryVia('paste:bridge', () => attachViaBridge(attachments, config, 'paste'))) return true;
        if (attempted && config.singleDispatch) return false;
        if (await tryVia('paste:content', () => attachViaPaste(files, config))) return true;
        return false;
      }
      // input
      if (await tryVia('input:bridge', () => attachViaBridge(attachments, config, 'input'))) return true;
      if (attempted && config.singleDispatch) return false;
      if (await tryVia('input:content', () => attachViaInput(files, config))) return true;
      return false;
    };

    for (const strat of strategies) {
      attached = await runStrategy(strat);
      if (attached || (attempted && config.singleDispatch)) break;
    }
    if (!attached) {
      reportFailure(attempted ? 'TIMEOUT' : 'MANUAL_REQUIRED');
      return {
        success: false,
        delivered: false,
        uploadSettled: false,
        ready: false,
        evidence: null,
        uploadedCount: 0,
        failedFiles: attachments,
        reason: attempted ? 'TIMEOUT' : 'MANUAL_REQUIRED'
      };
    }
    try {
      chrome?.runtime?.sendMessage?.({
        type: 'SMART_ATTACHMENT_CONFIRMED',
        llmName: model || null,
        uploadedCount: files.length,
        reason: 'OK',
        ts: Date.now()
      });
    } catch (_) {}
    return {
      success: true,
      delivered: true,
      uploadSettled: true,
      ready: true,
      evidence: 'provider_observation',
      uploadedCount: files.length,
      failedFiles: [],
      reason: 'OK'
    };
  };

  global.AttachmentHandler = {
    attach,
    notifyManualAttachmentRequired,
    hydrateAttachments
  };
})(typeof window !== 'undefined' ? window : self);
