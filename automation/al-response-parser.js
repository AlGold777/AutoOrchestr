// Automation Lab — deterministic response-frame + JSON extraction (structured-response-extraction v2.2.4).
//
// Input is the correlated assistant message text (raw text / textContent-equivalent). The frame is
// located by its random CALL/ATTEMPT tokens, not by punctuation, so markdown renderers that eat
// `<`, `>` or `@` around the marker words cannot break correlation. Inside the frame exactly one
// JSON object must be recoverable by one of three deterministic modes:
//   WHOLE_TEXT_JSON      trimmed interior is one JSON object
//   SINGLE_FENCED_JSON   exactly one ``` fenced block whose body is one JSON object
//   SINGLE_BALANCED_JSON exactly one balanced top-level {...} candidate parses (rendered code blocks
//                        leave labels such as "json" / "Copy code" around the object in DOM text)
// Zero or more than one candidate is an ambiguity failure. Wrapper prose stays in RAW only.
(function initAlResponseParser(root) {
  'use strict';

  const Canonical = root.AlCanonical || require('./al-canonical.js');

  const escapeRegExp = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  // Only raw control characters inside string literals are escaped. This is a lossless,
  // deterministic transport repair: Web UIs routinely turn "\n" escapes into literal newlines.
  function escapeControlCharsInStrings(text) {
    let out = '';
    let inString = false;
    let escaped = false;
    for (const ch of text) {
      if (inString) {
        if (escaped) { escaped = false; out += ch; continue; }
        if (ch === '\\') { escaped = true; out += ch; continue; }
        if (ch === '"') { inString = false; out += ch; continue; }
        const code = ch.charCodeAt(0);
        if (code < 0x20) {
          out += ch === '\n' ? '\\n' : ch === '\r' ? '\\r' : ch === '\t' ? '\\t' : `\\u${code.toString(16).padStart(4, '0')}`;
          continue;
        }
        out += ch;
      } else {
        if (ch === '"') inString = true;
        out += ch;
      }
    }
    return out;
  }

  function parseObject(text) {
    const trimmed = String(text || '').trim();
    if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) return { ok: false, reason: 'NOT_OBJECT' };
    for (const candidate of [trimmed, escapeControlCharsInStrings(trimmed)]) {
      try {
        const value = JSON.parse(candidate);
        if (value && typeof value === 'object' && !Array.isArray(value)) {
          return { ok: true, value, controlCharsEscaped: candidate !== trimmed };
        }
      } catch (_) { /* try next deterministic representation */ }
    }
    return { ok: false, reason: 'INVALID_JSON' };
  }

  // String-aware scan for balanced top-level {...} spans.
  function balancedObjectSpans(text) {
    const spans = [];
    let depth = 0;
    let start = -1;
    let inString = false;
    let escaped = false;
    for (let i = 0; i < text.length; i += 1) {
      const ch = text[i];
      if (inString) {
        if (escaped) escaped = false;
        else if (ch === '\\') escaped = true;
        else if (ch === '"') inString = false;
        continue;
      }
      if (ch === '"' && depth > 0) { inString = true; continue; }
      if (ch === '{') {
        if (depth === 0) start = i;
        depth += 1;
      } else if (ch === '}' && depth > 0) {
        depth -= 1;
        if (depth === 0) { spans.push(text.slice(start, i + 1)); start = -1; }
      }
    }
    return spans;
  }

  const FENCE = /(^|\n)[ \t]*(`{3,}|~{3,})[^\n]*\n([\s\S]*?)\n[ \t]*\2[ \t]*(?=\n|$)/g;

  function locateFrame(text, callToken, attemptToken) {
    const tokens = `${escapeRegExp(callToken)}\\s+${escapeRegExp(attemptToken)}`;
    const open = new RegExp(`(?<![A-Z_])PAF_RESPONSE_BEGIN\\s+${tokens}`, 'g');
    const close = new RegExp(`PAF_RESPONSE_END\\s+${tokens}`, 'g');
    const opens = [...text.matchAll(open)];
    const closes = [...text.matchAll(close)];
    const anyOpen = /PAF_RESPONSE_BEGIN\s+(\S+)\s+(\S+)/g;
    if (!opens.length) {
      const foreign = [...text.matchAll(anyOpen)];
      return { ok: false, code: foreign.length ? 'FRAME_TOKEN_MISMATCH' : 'FRAME_MISSING' };
    }
    if (opens.length > 1 || closes.length > 1) return { ok: false, code: 'FRAME_AMBIGUOUS' };
    if (!closes.length) return { ok: false, code: 'FRAME_INCOMPLETE' };
    const begin = opens[0].index + opens[0][0].length;
    const end = closes[0].index;
    if (end <= begin) return { ok: false, code: 'FRAME_INCOMPLETE' };
    return { ok: true, interior: text.slice(begin, end) };
  }

  function extract(rawText, { callToken, attemptToken } = {}) {
    const text = Canonical.canonicalizeTransportText(rawText);
    if (!callToken || !attemptToken) return { ok: false, code: 'FRAME_TOKENS_REQUIRED' };
    const frame = locateFrame(text, callToken, attemptToken);
    if (!frame.ok) return { ok: false, code: frame.code };
    const interior = frame.interior.replace(/^[^\S\n]*[>@\]):;.,!*_=-]*/, '').replace(/[<@[(*_=-]*[^\S\n]*$/, '').trim();

    const whole = parseObject(interior);
    if (whole.ok) return { ok: true, mode: 'WHOLE_TEXT_JSON', value: whole.value, controlCharsEscaped: whole.controlCharsEscaped };

    const fences = [...interior.matchAll(FENCE)];
    if (fences.length > 1) return { ok: false, code: 'STRUCTURE_AMBIGUOUS_JSON', detail: `${fences.length} fenced blocks` };
    if (fences.length === 1) {
      const fenced = parseObject(fences[0][3]);
      if (!fenced.ok) return { ok: false, code: 'STRUCTURE_INVALID_JSON', detail: 'fenced block is not one JSON object' };
      const outside = interior.replace(fences[0][0], '');
      if (balancedObjectSpans(outside).some((span) => parseObject(span).ok)) {
        return { ok: false, code: 'STRUCTURE_AMBIGUOUS_JSON', detail: 'JSON outside the fenced block' };
      }
      return { ok: true, mode: 'SINGLE_FENCED_JSON', value: fenced.value, controlCharsEscaped: fenced.controlCharsEscaped };
    }

    const spans = balancedObjectSpans(interior);
    const parsed = spans.map(parseObject).filter((item) => item.ok);
    if (parsed.length === 1) return { ok: true, mode: 'SINGLE_BALANCED_JSON', value: parsed[0].value, controlCharsEscaped: parsed[0].controlCharsEscaped };
    if (parsed.length > 1) return { ok: false, code: 'STRUCTURE_AMBIGUOUS_JSON', detail: `${parsed.length} JSON objects` };
    return { ok: false, code: spans.length ? 'STRUCTURE_INVALID_JSON' : 'STRUCTURE_NO_JSON' };
  }

  // True when the text already contains a complete, correctly tokenized frame. Used only as a
  // timeout fallback on the latest streamed text, never to preempt terminal-state detection.
  const hasCompleteFrame = (rawText, tokens) => locateFrame(Canonical.canonicalizeTransportText(rawText), tokens.callToken, tokens.attemptToken).ok;

  const api = Object.freeze({ extract, hasCompleteFrame, escapeControlCharsInStrings, balancedObjectSpans });
  root.AlResponseParser = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
