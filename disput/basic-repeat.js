// Repeat of a Basic schema (T07): pure functions that split the task, fill its counters, take the carried document of a
// pass and decide whether the next pass starts. The module does not read answers by meaning: it compares strings, counts and fills.
// The page calls it (T08); nothing here touches the page.
(function initBasicRepeat(root) {
  'use strict';

  const REASON_TEXT = Object.freeze({
    not_done: 'заход не дошёл до конца',
    not_saved: 'запись захода не сохранена',
    no_carry: 'нет документа для переноса',
    carry_too_long: 'документ для переноса длиннее предела',
    passes: 'достигнут предел заходов',
    requests: 'достигнут предел запросов'
  });

  // The first line that equals the marker (spaces around the line ignored): the template runs to the end of that line
  // with its line break, the carried text is everything after. No such line gives null.
  function splitTask(task, marker) {
    const text = String(task == null ? '' : task);
    const wanted = String(marker).trim();
    let offset = 0;
    for (;;) {
      const end = text.indexOf('\n', offset);
      const lineEnd = end < 0 ? text.length : end;
      if (text.slice(offset, lineEnd).trim() === wanted) {
        const cut = end < 0 ? text.length : end + 1;
        return { template: text.slice(0, cut), carried: text.slice(cut) };
      }
      if (end < 0) return null;
      offset = end + 1;
    }
  }

  // {заход} is the number of the pass, {заход+N} the number plus N, {осталось запросов} the requests left or "без предела".
  function fillCounters(template, { pass, requestsLeft }) {
    const left = requestsLeft == null ? 'без предела' : String(requestsLeft);
    return String(template)
      .replace(/\{заход\+(\d+)\}/g, (_, n) => String(pass + Number(n)))
      .replace(/\{заход\}/g, () => String(pass))
      .replace(/\{осталось запросов\}/g, () => left);
  }

  function taskForPass({ template, carried, pass, requestsLeft }) {
    return fillCounters(template, { pass, requestsLeft }) + carried;
  }

  // The document the next pass takes: the last valid record of the carried artifact (its lineage is the address of carry).
  // The text is the document between the marks, or the clean answer when there are no marks; empty gives null.
  function carriedText({ artifacts, carry, extractDocument, cleanAnswer }) {
    const list = Array.isArray(artifacts) ? artifacts : [];
    const entry = [...list].reverse().find((item) => item && item.valid !== false && item.lineage
      && item.lineage.step === carry.step && item.lineage.participant === carry.participant && item.lineage.id === carry.artifact);
    if (!entry) return null;
    const text = extractDocument(entry.text, carry.artifact) ?? cleanAnswer(entry.text);
    return text ? text : null;
  }

  // Whether the next pass starts after the pass that has just finished. The first condition that holds stops the repeat.
  function decide({ repeat, pass, requestsUsed, stopReason, carried, saved }) {
    const stop = (reason) => ({ go: false, reason, ownerWindow: false });
    if (stopReason !== 'steps_done') return stop('not_done');
    if (saved !== true) return stop('not_saved');
    if (carried == null) return stop('no_carry');
    if (repeat.carryMaxChars != null && carried.length > repeat.carryMaxChars) return stop('carry_too_long');
    if (pass >= repeat.maxPasses) return stop('passes');
    if (repeat.maxRequests != null && requestsUsed >= repeat.maxRequests) return stop('requests');
    return { go: true, reason: '', ownerWindow: repeat.ownerEvery != null && pass % repeat.ownerEvery === 0 };
  }

  const api = Object.freeze({ REASON_TEXT, splitTask, fillCounters, taskForPass, carriedText, decide });
  root.BasicRepeat = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
