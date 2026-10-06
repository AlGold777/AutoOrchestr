(function initDebateResponseAcceptance(root) {
  'use strict';
  const ENDING = /[.?!)»"'\]]$/;
  const words = (value) => String(value || '').trim().match(/[\p{L}\p{N}]+(?:[-'][\p{L}\p{N}]+)*/gu) || [];
  const requiredSectionMisses = (value, sections = []) => (Array.isArray(sections) ? sections : [])
    .filter((section) => !new RegExp(`(?:^|\\n)#{1,6}\\s*${String(section).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*(?:\\n|$)`, 'i').test(value));
  function parseAuditVerdict(value) {
    const source = String(value || '').trim();
    try {
      const parsed = JSON.parse(source);
      const verdict = String(parsed?.verdict || '').toLowerCase();
      if (['pass', 'issues_found'].includes(verdict)) return { ok: true, verdict, issues: Array.isArray(parsed.issues) ? parsed.issues : [] };
    } catch (_) {}
    const marker = source.match(/(?:^|\n)\s*(?:##\s*)?Вердикт\s*[:\n]\s*(pass|issues_found)\b/i);
    return marker ? { ok: true, verdict: marker[1].toLowerCase(), issues: [] } : { ok: false, verdict: '', issues: [] };
  }
  function evaluate({ text, meta = {} } = {}) {
    const value = String(text == null ? '' : text).trim();
    if (!value) return { ok: false, reason: 'empty', details: {} };
    if (typeof meta.isErrorOutput === 'function' && meta.isErrorOutput(value)) return { ok: false, reason: 'error_output', details: {} };
    const taskClass = String(meta.taskClass || '').toLowerCase();
    const outputKind = String(meta.outputKind || '').toLowerCase();
    const allowShort = meta.allowShort === true || taskClass === 'direct_answer';
    const minChars = Number(meta.minChars == null ? (allowShort ? 1 : outputKind === 'json' ? 2 : 1) : meta.minChars);
    if (value.length < minChars) return { ok: false, reason: 'too_short', details: { minChars, actualChars: value.length } };
    const maxWords = Number(meta.maxWords || 0);
    const wordCount = words(value).length;
    if (Number.isFinite(maxWords) && maxWords > 0 && wordCount > maxWords) return { ok: false, reason: 'too_long', details: { maxWords, actualWords: wordCount } };
    if (outputKind === 'json') {
      try { JSON.parse(value); } catch (_) { return { ok: false, reason: 'invalid_json', details: {} }; }
    }
    if (meta.kind === 'synthesis_audit') {
      const audit = parseAuditVerdict(value);
      if (!audit.ok) return { ok: false, reason: 'invalid_audit_verdict', details: {} };
    }
    const missingSections = requiredSectionMisses(value, meta.requiredSections);
    if (missingSections.length) return { ok: false, reason: 'missing_sections', details: { missingSections } };
    const fences = (value.match(/```/g) || []).length;
    if (value.includes('[...truncated]') || fences % 2 === 1 || (/…$/.test(value) || /\.\.\.$/.test(value)) && !ENDING.test(value.replace(/[.…]+$/, ''))) return { ok: false, reason: 'truncation_marker', details: { fences } };
    const lastLine = value.split(/\r?\n/).filter(Boolean).at(-1) || '';
    if (!allowShort && outputKind !== 'json' && !ENDING.test(value) && !/^\s*(?:[-*]|\d+[.)]|#)/.test(lastLine) && lastLine.split(/\s+/).length > 3) return { ok: false, reason: 'incomplete_ending', details: { lastLine } };
    return { ok: true, reason: '', details: { chars: value.length, words: wordCount } };
  }
  const api = Object.freeze({ evaluate, parseAuditVerdict, countWords: (value) => words(value).length, requiredSectionMisses });
  root.DebateResponseAcceptance = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
