// Check of a request text before it is sent: does it contain a secret (a key, a token, a card number).
// Code only, no model. Returns the names of what was found, never the values.
(function initSecretCheck(root) {
  'use strict';

  const PATTERNS = [
    ['ключ API', /sk-ant-(?=[A-Za-z0-9_-]*\d)[A-Za-z0-9_-]{10,}/],
    // A key has digits; a hyphenated name like sk-image-generation-model has none.
    ['ключ API', /(?<![A-Za-z0-9])sk-(?=[A-Za-z0-9_-]*\d)[A-Za-z0-9_-]{20,}/],
    ['токен GitHub', /gh[pousr]_[A-Za-z0-9]{30,}/],
    ['ключ AWS', /(?<![A-Z0-9])AKIA[0-9A-Z]{16}(?![A-Z0-9])/],
    ['ключ Google', /AIza[0-9A-Za-z_-]{35}/],
    ['токен Slack', /xox[baprs]-[A-Za-z0-9-]{10,}/],
    ['приватный ключ', /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
    ['токен JWT', /eyJ[A-Za-z0-9_-]{5,}\.eyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}/]
  ];

  const luhn = (digits) => {
    let sum = 0;
    for (let i = 0; i < digits.length; i += 1) {
      let n = digits.charCodeAt(digits.length - 1 - i) - 48;
      if (i % 2 === 1) { n *= 2; if (n > 9) n -= 9; }
      sum += n;
    }
    return sum % 10 === 0;
  };

  // Cards of the usual systems only: 16 digits (Visa, Mastercard, Mir, Discover) or 15 (Amex), as one block or in groups,
  // first digit 2–6, and the Luhn check. Other long numbers (codes, articles) are not taken.
  const hasCard = (text) => {
    const found = text.match(/(?<![\d-])[2-6]\d{3}(?:[ -]?\d{4}){3}(?![\d-])|(?<![\d-])3\d{3}[ -]?\d{6}[ -]?\d{5}(?![\d-])/g) || [];
    return found.some((item) => luhn(item.replace(/[ -]/g, '')));
  };

  const find = (text) => {
    const source = String(text == null ? '' : text);
    const out = [];
    PATTERNS.forEach(([name, pattern]) => { if (!out.includes(name) && pattern.test(source)) out.push(name); });
    if (hasCard(source)) out.push('номер карты');
    return out;
  };

  const api = Object.freeze({ find });
  root.SecretCheck = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
