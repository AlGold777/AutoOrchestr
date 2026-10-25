// Schema text reader: reads the text of a model reply that carries a Basic schema (JSON).
// The reply may hold the JSON inside a code fence, with sentences around it, as a "soft" JSON (comments,
// unquoted keys, trailing commas, typographic quotes), as several objects in a row, or cut off. A fault that has
// one unambiguous fix is fixed and reported in notes; anything else is an error with its place in errors.
// The text outside the JSON is the model's comment. The reader does not check the schema itself:
// window.BasicSchema.validate() does that after reading (disput/basic-schema.js).
// Result: read(text) → { ok, value, comment, notes, errors }.
//   ok: true  → value is the schema object, errors is [], notes lists the fixes and warnings.
//   ok: false → value is null, errors holds one message with the place of the fault.
//   comment is always a string ('' when the reply has no text outside the JSON).
(function initSchemaTextReader(root) {
  'use strict';

  const isObj = (value) => !!value && typeof value === 'object' && !Array.isArray(value);
  const own = (id) => typeof id === 'string' && id.trim() !== '';
  const cut = (text, length) => (text.length > length ? `${text.slice(0, length)}…` : text);

  const QUOTES = { '"': '"', '“': '”“', '”': '”“', '„': '“”', "'": "'", '‘': '’‘', '’': '’‘' };
  const KEY_START = /[A-Za-z_$Ѐ-ӿ]/;
  const KEY_CHAR = /[A-Za-z0-9_$Ѐ-ӿ]/;

  // Walks one JSON value from s[from] and rewrites it as strict JSON: quotes, comments, trailing commas,
  // unquoted keys, line breaks inside strings. The content of strings is kept (only escaped).
  // closed = false: the value does not end inside the text (the reply is cut off).
  function soften(s, from) {
    let out = '';
    let i = from;
    const stack = [];
    const fixes = new Set();
    const closes = [];
    const result = (closed) => ({ out, closed, end: i, fixes, closes });
    while (i < s.length) {
      const ch = s[i];
      if (QUOTES[ch]) {
        const ends = QUOTES[ch];
        if (ch !== '"') fixes.add(ch === "'" ? 'одинарные кавычки → двойные' : 'типографские кавычки → обычные');
        let j = i + 1;
        let body = '';
        while (j < s.length && !ends.includes(s[j])) {
          const c = s[j];
          if (c === '\\' && j + 1 < s.length) { body += ch !== '"' && s[j + 1] === "'" ? "'" : c + s[j + 1]; j += 2; continue; }
          if (c === '"' && ch !== '"') body += '\\"';
          else if (c === '\n') { body += '\\n'; fixes.add('перевод строки внутри строки → \\n'); }
          else if (c === '\t') { body += '\\t'; fixes.add('табуляция внутри строки → \\t'); }
          else if (c !== '\r') body += c;
          j++;
        }
        i = j;
        if (j >= s.length) return result(false);
        out += `"${body}"`;
        i = j + 1;
        continue;
      }
      if (ch === '/' && s[i + 1] === '/') { const nl = s.indexOf('\n', i); i = nl < 0 ? s.length : nl; fixes.add('комментарии удалены'); continue; }
      if (ch === '/' && s[i + 1] === '*') { const e = s.indexOf('*/', i + 2); i = e < 0 ? s.length : e + 2; fixes.add('комментарии удалены'); continue; }
      if (ch === '{' || ch === '[') { stack.push(ch === '{' ? '}' : ']'); out += ch; i++; continue; }
      if (ch === '}' || ch === ']') {
        const t = out.replace(/\s+$/, '');
        if (t.endsWith(',')) { out = t.slice(0, -1); fixes.add('хвостовые запятые удалены'); }
        stack.pop();
        out += ch;
        i++;
        closes.push({ at: out.length, ch, stack: stack.slice() });
        if (!stack.length) return result(true);
        continue;
      }
      if (KEY_START.test(ch)) {
        let j = i;
        while (j < s.length && KEY_CHAR.test(s[j])) j++;
        const word = s.slice(i, j);
        let k = j;
        while (k < s.length && /\s/.test(s[k])) k++;
        if (k >= s.length) { i = s.length; return result(false); }
        if (s[k] === ':') { out += JSON.stringify(word); fixes.add('ключи взяты в кавычки'); } else out += word;
        i = j;
        continue;
      }
      out += ch;
      i++;
    }
    return result(false);
  }

  const errorOf = (text) => { try { JSON.parse(text); return null; } catch (error) { return error; } };

  // The last fully read step of a cut-off reply: the ref of the last element of the root's steps list that closes before the cut.
  // Closing brackets are added after each step's «}» and the result is parsed.
  function lastFullStep(res) {
    for (let k = res.closes.length - 1; k >= 0; k--) {
      const c = res.closes[k];
      if (c.ch !== '}' || c.stack[c.stack.length - 1] !== ']' || c.stack.length > 3) continue;
      try {
        const v = JSON.parse(res.out.slice(0, c.at) + c.stack.slice().reverse().join(''));
        const steps = isObj(v) && Array.isArray(v.steps) ? v.steps : [];
        const last = steps[steps.length - 1];
        const id = last?.ref;
        if (own(id)) return id;
      } catch (error) { /* next closing point */ }
    }
    return '';
  }

  // Service lines of the copier extension: the [[AO-…]] mark and the notes [НЕ СКОПИРОВАНО: …] / [СКОПИРОВАНО: …].
  const SERVICE_LINE = /^\s*(?:\[\[AO-[^\]]*\]\]|\[(?:НЕ\s+)?СКОПИРОВАНО:.*\])\s*$/i;
  const commentOf = (text) => text.replace(/```\w*/g, '').trim();

  // Text → the first JSON value. Errors and notes go to ctx; ctx.comment gets the text outside the JSON.
  function readJson(text, ctx) {
    const lines = text.split('\n');
    const kept = lines.filter((line) => !SERVICE_LINE.test(line));
    if (kept.length < lines.length) ctx.notes.push(`Удалено служебных строк расширения: ${lines.length - kept.length}.`);
    const raw = kept.join('\n');
    if (!raw.trim()) { ctx.errors.push('Поле пустое: вставьте JSON-схему.'); return null; }
    const brace = raw.indexOf('{');
    if (brace < 0 && raw.indexOf('[') < 0) { ctx.errors.push('В тексте нет JSON-схемы (не найдена «{»).'); return null; }
    let start = brace;
    if (brace < 0) start = raw.indexOf('[');
    else {
      const sq = raw.lastIndexOf('[', brace);
      if (sq >= 0 && !raw.slice(sq + 1, brace).trim()) start = sq;
    }
    const before = commentOf(raw.slice(0, start));
    ctx.comment = before;
    const first = soften(raw, start);
    if (!first.closed) {
      const id = lastFullStep(first);
      ctx.errors.push(`Ответ оборван (текст заканчивается на «…${raw.trimEnd().slice(-60)}»)${id ? `; последний полностью прочитанный шаг — ${id}` : ''}. Попросите модель продолжить или сократить тексты.`);
      return null;
    }
    let value;
    const strict = errorOf(raw.slice(start, first.end));
    if (!strict) value = JSON.parse(raw.slice(start, first.end));
    else if (!errorOf(first.out)) {
      value = JSON.parse(first.out);
      ctx.notes.push(`JSON исправлен автоматически: ${[...first.fixes].join(', ') || 'мелкие ошибки записи'}.`);
    } else {
      const m = /position (\d+)/.exec(strict.message);
      const at = m ? start + Number(m[1]) : -1;
      ctx.errors.push(`Неверный JSON: ${strict.message}${at >= 0 ? ` — около «${cut(raw.slice(Math.max(start, at - 30), at + 30), 60)}»` : ''}.`);
      return null;
    }
    // The rest: more JSON objects (only the first is applied) and text (the comment).
    let rest = raw.slice(first.end);
    let count = 1;
    for (;;) {
      const t = rest.replace(/^(?:[\s,;]|```\w*)*/, '');
      if (!t.startsWith('{')) break;
      const next = soften(t, 0);
      if (!next.closed || errorOf(next.out)) break;
      count++;
      rest = t.slice(next.end);
    }
    if (count > 1) ctx.notes.push(`Найдено ${count} JSON-объектов, применён первый.`);
    ctx.comment = [before, commentOf(rest)].filter(Boolean).join('\n\n');
    if (ctx.comment) ctx.notes.push('Текст вне JSON сохранён как комментарий модели.');
    return value;
  }

  // The root must be an object. A list of objects gives its first object.
  function rootOf(value, ctx) {
    if (Array.isArray(value)) {
      if (!isObj(value[0])) { ctx.errors.push('Схема должна быть объектом, а получен список.'); return null; }
      ctx.notes.push(`Корень — список из ${value.length} объектов; применён первый.`);
      return value[0];
    }
    if (!isObj(value)) { ctx.errors.push('Схема должна быть объектом.'); return null; }
    return value;
  }

  function read(text) {
    const ctx = { comment: '', notes: [], errors: [] };
    const raw = readJson(String(text ?? ''), ctx);
    const value = ctx.errors.length ? null : rootOf(raw, ctx);
    const ok = ctx.errors.length === 0 && value !== null;
    return { ok, value: ok ? value : null, comment: ctx.comment, notes: ctx.notes, errors: ctx.errors };
  }

  const api = Object.freeze({ read });
  root.SchemaTextReader = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
