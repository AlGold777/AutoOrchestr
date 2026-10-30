// Regressions from the real attachment smoke run 1782940321214
// (All Logs 20260701_23-16.md, v2.80.132):
//  - DeepSeek and Le Chat dispatch crashed with "attachmentHandler is not
//    defined" (missing declaration) and finalized UNCERTAIN before the prompt
//    was ever inserted;
//  - Grok aborted on attachment confirm timeout BEFORE inserting the prompt,
//    leaving a file-only composer that the user could not send manually, while
//    the visible file chip false-negatived the two narrow confirm selectors;
//  - GPT finalized PARTIAL streaming_incomplete although the same decision
//    logged "Finalization forced (stable answer evidence)" (stable 3895-char
//    answer, Stop not visible, stuck busy indicator).
const fs = require('fs');
const path = require('path');

const read = (...p) => fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8');

describe('attachment smoke run 1782940321214 regressions', () => {
  test('every content script that uses attachmentHandler declares it', () => {
    const scripts = [
      'content-chatgpt.js',
      'content-claude.js',
      'content-gemini.js',
      'content-grok.js',
      'content-lechat.js',
      'content-qwen.js',
      'content-deepseek.js',
      'content-perplexity.js',
      'content-zai.js'
    ];
    scripts.forEach((name) => {
      const src = read('content-scripts', name);
      if (!src.includes('attachmentHandler')) return;
      // Declared either directly or through the lazy getter every adapter now uses
      // (`getAttachmentHandler`), which reads window.AttachmentHandler at call time.
      const declared = src.includes('attachmentHandler = window.AttachmentHandler || null')
        || (src.includes('getAttachmentHandler = () => window.AttachmentHandler || null')
          && src.includes('attachmentHandler = getAttachmentHandler()'));
      expect({ name, declared }).toEqual({ name, declared: true });
    });
  });

  test('DeepSeek and Le Chat explicitly declare the attachment handler', () => {
    ['content-deepseek.js', 'content-lechat.js'].forEach((name) => {
      const src = read('content-scripts', name);
      expect(src).toContain('const getAttachmentHandler = () => window.AttachmentHandler || null;');
      expect(src).toContain('const attachmentHandler = getAttachmentHandler();');
    });
  });

  test('Grok preserves the prompt in the composer when attachment confirm fails', () => {
    const src = read('content-scripts', 'content-grok.js');
    const failureBranch = src.slice(
      src.indexOf("label: 'Manual attachment required'"),
      src.indexOf("throw { type: 'attachment_failed', message: 'Grok attachment upload not confirmed' };")
    );
    expect(failureBranch).toContain('grokClipboardPaste(composer, prompt)');
    expect(failureBranch).toContain('grokInsertText(composer, prompt)');
    expect(failureBranch).toContain('Prompt preserved in composer for manual send');
  });

  test('Grok attachment confirm selectors include generic upload evidence', () => {
    const src = read('content-scripts', 'attachment-handler.js');
    const grokBlock = src.slice(src.indexOf('Grok: {'), src.indexOf('Claude: {'));
    expect(grokBlock).toContain("'img[src^=\"blob:\"]'");
    expect(grokBlock).toContain('button[aria-label*="Remove" i]');
    expect(grokBlock).toContain('[class*="attachment" i]');
    expect(grokBlock).toContain('[class*="chip" i]');
  });

  test('stable-answer force final is not downgraded to streaming_incomplete when stability was observed', () => {
    const src = read('background', 'job-orchestrator.js');
    expect(src).toContain('const observedStableAcrossChecks = Number(liveEntry.pendingFinalAnswerStableCount || 0) >= 2;');
    expect(src).toContain('&& !(stableAnswerForceFinal && observedStableAcrossChecks);');
    expect(src).toContain("completionReason: streamingIncompleteFinal ? 'streaming_incomplete'");
    expect(src).toContain('partial: streamingIncompleteFinal || pendingAnswerEvidence?.partialAllowed || undefined');
    expect(src).toContain('entry.pendingFinalAnswerStableCount = Number(entry.pendingFinalAnswerStableCount || 0) + 1;');
  });

  test('recovered final upgrade is gated on dispatch confirmation', () => {
    const src = read('background', 'job-orchestrator.js');
    expect(src).toContain('const recoveredUpgradeBlockedUnconfirmed = Boolean(');
    expect(src).toContain('RECOVERED_FINAL_UPGRADE_BLOCKED_UNCONFIRMED_SEND');
    expect(src).toContain('const allowRecoveredFinalOverride = recoveredFinalRequested && !recoveredUpgradeBlockedUnconfirmed;');
  });
});
