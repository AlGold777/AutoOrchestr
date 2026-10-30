// Text of a Basic reply (the answer a model gives to the next round and to the artifact).
// The plain answer (`answer`, flat text) stays the source for acceptance and confirmation. The DOM->Markdown copy
// (answerMarkdown) is used when it is complete and matches the plain text; otherwise the plain text stays (the answer is never lost).
// Decision rule and its reasons are reported to telemetry as text_source / reason.
(function initBasicReplyText(root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.BasicReplyText = api;
})(typeof self !== 'undefined' ? self : (typeof globalThis !== 'undefined' ? globalThis : this), function factory() {
  'use strict';

  // Markdown shorter than this share of the plain text (letters and digits) is not a full copy. Set to 0.25 (was 0.7):
  // the plain text can carry text the copy rightly leaves out (a reasoning trace, a copy-button icon label): fixtures
  // give 0.32 (DeepSeek, trace + answer) and 0.35 (Gemini). Truncation is still caught by the tail check and the report.
  const MIN_RATIO = 0.25;
  const TAIL_CHARS = 24; // the end of the plain answer must be found in the markdown
  const DELIVERY_MARK = /\[\[AO-[^\]]*\]\]/i;
  const PLACEHOLDER = /^\[НЕ СКОПИРОВАНО/;

  // Letters and digits only, lower-cased: whitespace, pipes, fences, emphasis marks do not count.
  const core = (s) => String(s == null ? '' : s).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
  // A long text without any line break: the paragraphs were joined on extraction (textContent), the structure is lost.
  const FLAT_MIN_CHARS = 1500;
  const flattened = (s) => {
    const t = String(s == null ? '' : s);
    return t.length > FLAT_MIN_CHARS && !/\n/.test(t);
  };

  function choose({ plain, markdown, report } = {}) {
    const p = String(plain == null ? '' : plain);
    const m = String(markdown == null ? '' : markdown);
    const keep = (reason) => ({ text: p, text_source: 'plain', reason, plainChars: p.length, markdownChars: m.length });
    if (!p.trim()) return keep('empty_plain');
    if (!m.trim()) return keep('no_markdown');
    if (PLACEHOLDER.test(m.trim())) return keep('placeholder');
    if (!report || report.complete !== true) return keep('incomplete_copy');
    const pc = core(p);
    const mc = core(String(m).replace(/^(\s*(?:```|~~~)+)[^\n`]*$/gm, '$1'));
    if (mc.length < MIN_RATIO * pc.length) return keep('short_markdown');
    if (DELIVERY_MARK.test(p) && !DELIVERY_MARK.test(m)) return keep('marker_missing');
    const tail = pc.slice(-TAIL_CHARS);
    if (tail && !mc.includes(tail)) return keep('tail_missing');
    return { text: m, text_source: 'markdown', reason: 'complete', plainChars: p.length, markdownChars: m.length };
  }

  // L-32: a reply longer than COPY_WAIT_LONG_CHARS waits for its copy (up to COPY_WAIT_MS, polled every COPY_WAIT_POLL_MS)
  // even when its lines are kept, unless the copy is known to be impossible (the answer came from a source without DOM->Markdown).
  const COPY_WAIT_LONG_CHARS = 1500;
  const COPY_WAIT_MS = 4000;
  const COPY_WAIT_POLL_MS = 250;
  const COPY_IMPOSSIBLE_REASON = 'источник без DOM→Markdown';
  const copyImpossible = (report) => Array.isArray(report?.placeholders)
    && report.placeholders.some((item) => String(item?.reason || '').startsWith(COPY_IMPOSSIBLE_REASON));
  function copyWaitNeeded(text, report) {
    const t = String(text == null ? '' : text);
    if (!t.trim()) return false;
    if (flattened(t)) return true;
    return t.length > COPY_WAIT_LONG_CHARS && !copyImpossible(report);
  }

  // Where a reply lost its copy (telemetry, L-31). null when the reply takes a copy (complete or not, see choose's reason).
  function copyDropReason({ ownMarkdown = '', ownReport = null, pickedMarkdown = '', pickedReport = null, requestId = '', stashHit = false } = {}) {
    if (pickedMarkdown && PLACEHOLDER.test(String(pickedMarkdown).trim())) return 'whole_answer_stub';
    if (pickedMarkdown) return pickedReport && pickedReport.complete === true ? null : 'incomplete_copy';
    if (copyImpossible(ownReport)) return 'source_without_dom_copy';
    if (!ownMarkdown && !ownReport) return 'result_without_copy';
    if (requestId && !stashHit) return 'stash_miss';
    if (!ownMarkdown && !requestId) return 'result_empty_copy';
    return 'copy_not_arrived';
  }

  return {
    MIN_RATIO, TAIL_CHARS, FLAT_MIN_CHARS, choose, core, flattened,
    COPY_WAIT_LONG_CHARS, COPY_WAIT_MS, COPY_WAIT_POLL_MS, copyImpossible, copyWaitNeeded, copyDropReason
  };
});
