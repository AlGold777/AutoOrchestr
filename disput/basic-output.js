// Basic output: the checks of an answer by the output of its step (docs: basic-schema-guide.md, 5.8; the rules: the
// technical spec, 5.1). Pure functions: the engine (disput/custom-engine.js) calls them, the tests too.
// Order of checkAnswer: length (strictLength) → JSON and its fields, or the sections → the declared artifacts.
// A document for reading (document: read, text format, one artifact) is taken from the marks: [[DOC: id]] … [[/DOC]]
// (extractDocument); the answer without them is missing_artifact, the whole answer is never taken instead.
// The reasons: too_long, invalid_output, missing_field, invalid_form (a questionnaire, document: form), missing_section,
// missing_artifact. Each carries a detail
// (the section, the pointer, the count of words) that the correction request names.
(function initBasicOutput(root) {
  'use strict';

  const POINTER_FORBIDDEN = Object.freeze(['__proto__', 'prototype', 'constructor']);
  const JSON_FENCE = /^```json[ \t]*\r?\n([\s\S]*?)\r?\n```$/;

  // The words of an answer: the non-empty parts after a split on white space. One helper for the engine and the tests.
  const countWords = (value) => String(value == null ? '' : value).split(/\s+/).filter(Boolean).length;

  // A JSON Pointer (RFC 6901, ~0 and ~1). Reads only: nothing is changed, a forbidden segment is never followed.
  // Returns { found, value } where found is false for an absent value (null is a value).
  function readPointer(value, pointer) {
    if (pointer === '') return { found: true, value };
    let current = value;
    for (const raw of pointer.slice(1).split('/')) {
      const segment = raw.replace(/~1/g, '/').replace(/~0/g, '~');
      if (POINTER_FORBIDDEN.includes(segment)) return { found: false };
      if (current === null || typeof current !== 'object') return { found: false };
      if (Array.isArray(current)) {
        if (!/^(0|[1-9]\d*)$/.test(segment) || Number(segment) >= current.length) return { found: false };
        current = current[Number(segment)];
      } else {
        if (!Object.prototype.hasOwnProperty.call(current, segment)) return { found: false };
        current = current[segment];
      }
    }
    return { found: true, value: current };
  }

  // The whole answer is one JSON object, or one fence of json with nothing around it. Anything else is null.
  function parseJsonAnswer(raw) {
    const body = String(raw == null ? '' : raw).trim();
    const fenced = JSON_FENCE.exec(body);
    const text = fenced ? fenced[1] : body;
    let value;
    try {
      value = JSON.parse(text);
    } catch (_) {
      // A chat page that shows JSON as ordinary text sets typographic quotes (Claude: “items”); they are read as plain ones.
      try {
        value = JSON.parse(text.replace(/[\u201C\u201D\u201E\u201F]/g, '"'));
      } catch (__) {
        return null;
      }
    }
    return value !== null && typeof value === 'object' && !Array.isArray(value) ? value : null;
  }

  const FORM_TYPES = Object.freeze(['one', 'many', 'text', 'yesno']);
  const isNonEmptyString = (value) => typeof value === 'string' && value.trim() !== '';

  // The first defect of a questionnaire (the output of a document: form), or null. The text names the place: items[2].options: …
  function formProblem(value) {
    const items = value.items;
    if (!Array.isArray(items) || !items.length) return 'items: ожидается непустой список пунктов';
    const ids = new Set();
    for (let at = 0; at < items.length; at += 1) {
      const item = items[at];
      const where = `items[${at}]`;
      if (item === null || typeof item !== 'object' || Array.isArray(item)) return `${where}: ожидается объект`;
      if (!isNonEmptyString(item.id)) return `${where}.id: ожидается непустая строка`;
      if (ids.has(item.id)) return `${where}.id: id «${item.id}» повторяется`;
      ids.add(item.id);
      if (!FORM_TYPES.includes(item.type)) return `${where}.type: допустимо ${FORM_TYPES.join(', ')}`;
      if (!isNonEmptyString(item.question)) return `${where}.question: ожидается непустая строка`;
      if (item.type === 'one' || item.type === 'many') {
        if (!Array.isArray(item.options) || !item.options.length) return `${where}.options: ожидается непустой список вариантов`;
        const blank = item.options.findIndex((option) => !isNonEmptyString(option));
        if (blank !== -1) return `${where}.options[${blank}]: ожидается непустая строка`;
        const repeated = item.options.find((option, pos) => item.options.indexOf(option) !== pos);
        if (repeated !== undefined) return `${where}.options: вариант «${repeated}» повторяется`;
      } else if ('options' in item) {
        return `${where}.options: в типе ${item.type} вариантов нет`;
      }
      if ('required' in item && typeof item.required !== 'boolean') return `${where}.required: ожидается true или false`;
    }
    return null;
  }

  // The document of an id between the marks [[DOC: id]] … [[/DOC]]: the first such block, its edges trimmed; null when
  // there is no block, no closing mark, or the text is empty. The id is compared exactly (the case matters).
  function extractDocument(answer, id) {
    const escaped = String(id).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const block = new RegExp(`\\[\\[DOC:\\s*${escaped}\\s*\\]\\]([\\s\\S]*?)\\[\\[\\/DOC\\]\\]`).exec(String(answer == null ? '' : answer));
    if (!block) return null;
    const text = stripDocumentMarks(block[1]).trim();
    return text === '' ? null : text;
  }

  // The acceptance of the output of a step: { ok: true, value?, documents? } or { ok: false, reason, detail }.
  // documents: the text of a document for reading by its artifact id (only for document: read in the text format).
  // `limit` is the effective word limit (the model's maxWords, else the run's); the caller gives it.
  function checkAnswer(raw, output, { limit = null } = {}) {
    if (!output) return { ok: true };
    const answer = String(raw == null ? '' : raw);
    if (output.strictLength === true && Number.isSafeInteger(limit)) {
      // The marks [[DOC: id]] … [[/DOC]] are not words of the answer.
      const count = countWords(stripDocumentMarks(answer));
      if (count > limit) return { ok: false, reason: 'too_long', detail: `(${count} из ${limit} слов)` };
    }
    let value;
    if (output.format === 'json') {
      value = parseJsonAnswer(answer);
      if (!value) return { ok: false, reason: 'invalid_output' };
      const absent = (output.requiredFields || []).find((pointer) => !readPointer(value, pointer).found);
      if (absent !== undefined) return { ok: false, reason: 'missing_field', detail: absent };
      if (output.document === 'form') {
        const problem = formProblem(value);
        if (problem) return { ok: false, reason: 'invalid_form', detail: problem };
      }
    } else {
      const lines = answer.split(/\r?\n/).map((line) => line.toLowerCase());
      const missing = (output.sections || []).find((section) => !lines.some((line) => line.includes(String(section).toLowerCase())));
      if (missing !== undefined) return { ok: false, reason: 'missing_section', detail: `«${missing}»` };
    }
    const documents = {};
    if (output.document === 'read' && output.format !== 'json' && Array.isArray(output.artifacts) && output.artifacts.length === 1) {
      const id = output.artifacts[0].id;
      const extracted = extractDocument(answer, id);
      if (extracted === null) return { ok: false, reason: 'missing_artifact', detail: `«${id}» ([[DOC: ${id}]] … [[/DOC]])` };
      documents[id] = extracted;
    }
    for (const artifact of output.artifacts || []) {
      // An empty pointer is the whole answer, always present; a pointer into a text answer does not resolve.
      if (artifact.pointer === '') continue;
      const found = value !== undefined && readPointer(value, artifact.pointer).found;
      if (!found) return { ok: false, reason: 'missing_artifact', detail: `«${artifact.id}» (${artifact.pointer})` };
    }
    const result = value === undefined ? { ok: true } : { ok: true, value };
    if (Object.keys(documents).length) result.documents = documents;
    return result;
  }

  // The text an answer hands on (to the next step, to the record): the delivery mark at its end ([[AO-…]]) and the document
  // marks ([[DOC: id]], [[/DOC]]) are service text. Document extraction reads the raw answer, so it runs before this.
  const DELIVERY_MARK = /\s*\[\[AO-[^\]]*\]\]\s*$/;
  const DOCUMENT_MARK = /\[\[\/?DOC(?::[^\]]*)?\]\]/g;
  // A document (the text to show, record and write to a file) has no document marks, whatever the raw answer held.
  function stripDocumentMarks(raw) { return String(raw == null ? '' : raw).replace(DOCUMENT_MARK, ''); }
  const cleanAnswer = (raw) => String(raw == null ? '' : raw).replace(DELIVERY_MARK, '').replace(DOCUMENT_MARK, '').trim();

  const api = Object.freeze({ countWords, readPointer, parseJsonAnswer, formProblem, extractDocument, checkAnswer, cleanAnswer, stripDocumentMarks });
  root.BasicOutput = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
