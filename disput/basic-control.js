// Basic control steps (technical spec 6.1, 6.2): the verdict of a gate and the pass rule of its checkers.
// Pure functions: the engine (disput/custom-engine.js) calls them, the tests too.
// A text answer of a gate ends with the verdict line «ВЕРДИКТ: ПРОШЁЛ» or «ВЕРДИКТ: НЕ ПРОШЁЛ»; a fail names each unmet
// criterion in a «НЕ ВЫПОЛНЕНО: …» line right above the verdict. A json answer has verdict «pass» | «fail» and unmet (a list
// of strings, not empty on fail). Without a verdict the answer is refused as no_verdict and corrected in the same chat.
(function initBasicControl(root) {
  'use strict';

  const Output = root.BasicOutput || (typeof require === 'function' ? require('./basic-output') : null);
  const PASS_LINE = 'ВЕРДИКТ: ПРОШЁЛ';
  const FAIL_LINE = 'ВЕРДИКТ: НЕ ПРОШЁЛ';
  const UNMET = 'НЕ ВЫПОЛНЕНО:';

  const noVerdict = (detail) => ({ ok: false, reason: 'no_verdict', detail });

  // The verdict of one checker answer: { ok: true, verdict: 'pass' | 'fail', unmet: [...] } or { ok: false, reason, detail }.
  function verdictOf(raw, { json = false } = {}) {
    if (json) {
      const value = Output.parseJsonAnswer(raw);
      if (!value || (value.verdict !== 'pass' && value.verdict !== 'fail')) return noVerdict('поле verdict: "pass" или "fail"');
      if (value.verdict === 'pass') return { ok: true, verdict: 'pass', unmet: [] };
      const unmet = Array.isArray(value.unmet) ? value.unmet : [];
      if (!unmet.length || unmet.some((item) => typeof item !== 'string' || !item.trim())) return noVerdict('поле unmet: непустой список строк при "fail"');
      return { ok: true, verdict: 'fail', unmet: unmet.map((item) => item.trim()) };
    }
    const lines = String(raw == null ? '' : raw).split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    const last = lines[lines.length - 1];
    if (last === PASS_LINE) return { ok: true, verdict: 'pass', unmet: [] };
    if (last !== FAIL_LINE) return noVerdict(`последней строкой ${PASS_LINE} или ${FAIL_LINE}`);
    const unmet = [];
    for (let at = lines.length - 2; at >= 0 && lines[at].startsWith(UNMET); at -= 1) {
      const item = lines[at].slice(UNMET.length).trim();
      if (!item) return noVerdict(`строка «${UNMET} …» с текстом перед ${FAIL_LINE}`);
      unmet.unshift(item);
    }
    if (!unmet.length) return noVerdict(`строка «${UNMET} …» перед ${FAIL_LINE}`);
    return { ok: true, verdict: 'fail', unmet };
  }

  // The pass rule over the verdicts of the accepted checkers: all, or any. No verdict is never a pass.
  const passed = (verdicts, rule) => {
    if (!verdicts.length) return false;
    return rule === 'any' ? verdicts.some((item) => item === 'pass') : verdicts.every((item) => item === 'pass');
  };

  // The instruction of the verdict, added to the request of a gate (the criteria are listed before it).
  const verdictInstruction = (json) => (json
    ? 'Поле verdict — "pass" или "fail"; поле unmet — список невыполненных критериев (непустой при "fail").'
    : `Заверши ответ строкой «${PASS_LINE}» или «${FAIL_LINE}». При «НЕ ПРОШЁЛ» перед ней — строка «${UNMET} …» по каждому невыполненному критерию.`);

  const api = Object.freeze({ verdictOf, passed, verdictInstruction });
  root.BasicControl = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
