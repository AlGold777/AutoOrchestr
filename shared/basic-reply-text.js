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

  const MIN_RATIO = 0.7; // markdown shorter than this share of the plain text (letters and digits) is not a full copy
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
    const mc = core(m);
    if (mc.length < MIN_RATIO * pc.length) return keep('short_markdown');
    if (DELIVERY_MARK.test(p) && !DELIVERY_MARK.test(m)) return keep('marker_missing');
    const tail = pc.slice(-TAIL_CHARS);
    if (tail && !mc.includes(tail)) return keep('tail_missing');
    return { text: m, text_source: 'markdown', reason: 'complete', plainChars: p.length, markdownChars: m.length };
  }

  return { MIN_RATIO, TAIL_CHARS, FLAT_MIN_CHARS, choose, core, flattened };
});
