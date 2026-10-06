// Control markers in a model's answer. Two markers beyond the delivery token
// ([[AO-xxxxxx]], shared/message-delivery.js — "complete and mine"):
//   [[ASK: question || option 1 || option 2 [|| several]]]
//                                the model needs an answer only the owner can give; the owner
//                                picks from the options (2-5), never types them. Without options
//                                the owner gets only the standard "decide it yourself" choice.
//   [[VERDICT: pass|issues_found]]  a review stage: are there blocking remarks
// A marker is a line of its own (light decoration like "- " or "**" is allowed). Text inside
// code fences and quotes is data, not control: it never raises a marker.
(function initStageMarkers(root) {
  'use strict';

  const MAX_ASKS = 3;
  const MAX_ASK_CHARS = 400;
  const MAX_OPTIONS = 5;
  const MIN_OPTIONS = 2;
  const MAX_OPTION_CHARS = 120;
  const OPTION_SEPARATOR = '||';
  const MULTI_WORD = /^(?:несколько|several|multi)$/i;
  const VERDICTS = Object.freeze(['pass', 'issues_found']);
  const REVIEW_PURPOSES = Object.freeze(['critique', 'verification', 'evidence_review']);
  const LINE = /^[\s*_\-•]*\[\[\s*(ASK|VERDICT)\s*:\s*(.*?)\s*\]\][\s*_]*$/i;

  // Drops fenced code blocks and quoted lines; returns the lines that may carry markers.
  function controlLines(text) {
    const lines = String(text == null ? '' : text).split(/\r?\n/);
    const out = [];
    let fenced = false;
    for (const line of lines) {
      if (/^\s*(```|~~~)/.test(line)) { fenced = !fenced; continue; }
      if (fenced || /^\s*>/.test(line)) continue;
      out.push(line);
    }
    return out;
  }

  // "question || option 1 || option 2 || several" -> { question, options, multi }.
  // One option is not a choice: it is dropped, the question then has no options.
  function splitAsk(value) {
    const parts = String(value == null ? '' : value).split(OPTION_SEPARATOR).map((part) => part.trim());
    const question = (parts.shift() || '').slice(0, MAX_ASK_CHARS);
    let multi = false;
    if (parts.length && MULTI_WORD.test(parts[parts.length - 1])) { multi = true; parts.pop(); }
    const options = [];
    const seenOptions = new Set();
    parts.forEach((part) => {
      const option = part.slice(0, MAX_OPTION_CHARS);
      const key = option.toLowerCase();
      if (!option || seenOptions.has(key) || options.length >= MAX_OPTIONS) return;
      seenOptions.add(key);
      options.push(option);
    });
    return options.length >= MIN_OPTIONS ? { question, options, multi } : { question, options: [], multi: false };
  }

  function parse(text) {
    const asks = [];
    const askItems = [];
    const seen = new Set();
    let verdict = null;
    const invalid = [];
    for (const line of controlLines(text)) {
      const match = LINE.exec(line);
      if (!match) continue;
      const kind = match[1].toUpperCase();
      const value = match[2].trim();
      if (kind === 'VERDICT') {
        const normalized = value.toLowerCase().replace(/\s+/g, '_');
        if (VERDICTS.includes(normalized)) verdict = normalized;
        else invalid.push({ kind, value });
      } else if (value) {
        const item = splitAsk(value);
        const key = item.question.toLowerCase();
        if (item.question && !seen.has(key) && asks.length < MAX_ASKS) { seen.add(key); asks.push(item.question); askItems.push(item); }
      }
    }
    return { verdict, asks, askItems, invalid };
  }

  // The instruction block added to the prompt of a template stage.
  function instructions({ purpose = '' } = {}) {
    const lines = [
      'Если для продолжения нужен ответ владельца продукта, который нельзя придумать за него (цель, приоритет, ограничение, выбор между вариантами), добавь отдельной строкой [[ASK: вопрос || вариант 1 || вариант 2]] (не больше 3 строк). Владелец выбирает из твоих вариантов и ничего не пишет, поэтому дай от 2 до 5 вариантов, разделяя их двумя вертикальными чертами; варианты должны покрывать разумные ответы и не пересекаться. Если можно выбрать несколько вариантов, последним добавь слово «несколько». Не отвечай за владельца. Нет вопросов — строку не добавляй.'
    ];
    if (REVIEW_PURPOSES.includes(String(purpose))) {
      lines.push('В конце проверки отдельной строкой напиши [[VERDICT: pass]], если блокирующих замечаний нет, или [[VERDICT: issues_found]], если они есть.');
    }
    lines.push('Эти строки пиши до метки доставки, не оформляй их кодом или цитатой.');
    return lines.join('\n');
  }

  // Several participants of one stage: any "issues_found" wins, else any "pass".
  function combineVerdicts(verdicts = []) {
    const list = verdicts.filter((value) => VERDICTS.includes(value));
    if (list.includes('issues_found')) return 'issues_found';
    return list.includes('pass') ? 'pass' : null;
  }

  const api = Object.freeze({ VERDICTS, MAX_ASKS, MAX_OPTIONS, MIN_OPTIONS, splitAsk, parse, instructions, combineVerdicts });
  root.DebateStageMarkers = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
