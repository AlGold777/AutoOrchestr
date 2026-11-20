// Level 0 rules: the situation from the facts of the page, or null when the rules are silent.
// Port of docs/Run Automation/Test_run/3D_Avatar_2026-11-09/tools/rules2.py (same order, same phrases).
// Status phrases count only in windows (dialogs) or in the text AFTER the last delivery mark, never in the answer body.
// Unicode: \b, \w, \W, \d are written out as \p{L}\p{N}_ classes, because JS \b and \w see ASCII only.
(function initLocalRules(root) {
  'use strict';

  const MARK = /\[\[AO-[a-z0-9]+\]\]/g;
  const ASK = /напиши только метку\s*$/iu;
  const STOP = /^\s*(стоп|stop|остановить|остановить генерацию|stop generating)(?![\p{L}\p{N}_])|^\s*[■⏹◼]\s*$/iu;
  const SEND = /^\s*(отправить|send)(?![\p{L}\p{N}_])/iu;

  const LIMIT = /лимит|usage limit|rate limit|limit (reached|exceeded)|reached (your|the) [^\n]{0,30}limit|message cap|too many requests|слишком много запросов|запросы закончились|недоступны до|unavailable until|available again|доступно снова|resets? (at|in|on)|сброс в|try again (later|at|in) [^\n]{0,20}(hour|minute|час|мин|\p{Nd})|quota|exhaust|исчерпан/iu;
  const LOGIN = /войдите|выполните вход|войти, чтобы|log ?in to|sign ?in (again )?to|please (log|sign) ?in|session (has )?expired|сессия (истекла|завершена)|your session expired|sign in again|login required|требуется вход|авторизуйтесь/iu;
  const CAPTCHA = /вы человек|не робот|are you (a )?(human|bot|robot)|human|(?<![\p{L}\p{N}_])bot(?![\p{L}\p{N}_])|робот|puzzle|капч|captcha|проверка безопасности|security check|checking your browser|verify (that )?you/iu;
  const ACCOUNT = /услови|terms|privacy|политик|подписк|subscri|upgrade|оплат|payment|billing|тариф|your plan|ваш тариф|cookie|куки|ваш возраст|your age|age verification|ваш регион|your region|подтвердите (адрес|почт|аккаунт|номер|email)|verify your (email|account|phone)|confirm your (email|account|phone)|обновите аккаунт|update (your )?(account|payment)|согласи|consent|accept|принять/iu;
  const ERROR = /oops|something went wrong|went wrong|network error|сетев[\p{L}\p{N}_]+ ошибк|ошибк[\p{L}\p{N}_]+ (сети|подключени|сервера)|server (error|is busy|overloaded)|сервер (перегружен|недоступен)|failed to (send|load|connect)|не удалось (отправить|загрузить|подключ)|issue connecting|connection (error|lost|failed)|страница не загрузилась|временная ошибка|произошла ошибка|an error occurred|try again|что-то пошло не так|сбой|внутренн[\p{L}\p{N}_]+ ошибк|internal (server )?error|error (code )?5\p{Nd}\p{Nd}|код 5\p{Nd}\p{Nd}|временно недоступн/iu;
  const CHOOSE = /какой ответ|which (response|answer|reply)|предпочита|prefer|выберите (ответ|вариант)|choose (this|the|one)|use this (response|answer|reply)|использовать этот ответ|оставить этот|keep this|pick (one|the better)|лучше\??(?=\n?$)/iu;
  const CHOOSE_BTN = /^\s*(предпочита|prefer|использовать этот|use this|choose this|выбрать этот|select this|оставить этот|keep this|этот (ответ )?лучше|this (one|response|answer) is better)/iu;
  const INFO = /новые функции|what[^\n]?s new|new features|совет|(?<![\p{L}\p{N}_])tip(?![\p{L}\p{N}_])|нововведени|обновление функций|update available|доступна новая версия|announcement|новост|welcome|добро пожаловать|опрос|survey|feedback|отзыв/iu;
  const SPINNER = /[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏⠁-⣿]/u;
  const WORKING = /думаю|thinking|печатает|typing|поиск источников|searching|выполняется|in progress|анализирую|reasoning|working on it|generating/iu;
  const EMPTY_HINT = /^(чем я могу помочь\??|how can i help( you)?( today)?\??|ask anything|спросите что угодно)$/iu;

  // Python counts and slices code points, JS counts UTF-16 units: these helpers keep the Python behaviour.
  const cps = (s) => Array.from(s);
  const plen = (s) => cps(s).length;
  const head = (s, n) => cps(s).slice(0, n).join('');
  const tail = (s, n) => { const a = cps(s); return a.slice(Math.max(0, a.length - n)).join(''); };
  // Python str.splitlines boundaries.
  const splitLines = (s) => s.split(/\r\n|[\n\v\f\r\x1c-\x1e\x85\u2028\u2029]/);

  const classifyText = (s) => {
    for (const [name, pattern] of [['limit_reached', LIMIT], ['login_required', LOGIN], ['captcha', CAPTCHA], ['account_action', ACCOUNT], ['error_message', ERROR], ['choose_answer', CHOOSE], ['info_dialog', INFO]]) {
      if (pattern.test(s)) return name;
    }
    return null;
  };

  // The rules over one page read by readPage: { text, buttons, dialogs }. Returns a situation class or null.
  const classify = (page) => {
    const text = page.text || '';
    const buttons = page.buttons || [];
    const dialogs = (page.dialogs || []).filter((d) => d && d.trim());
    const joined = dialogs.join(' | ');

    // 1. A window decides over everything under it.
    if (joined) return classifyText(joined);

    // 2. Stop button: still generating.
    if (buttons.some((b) => STOP.test(b))) return 'still_generating';

    // 3. Choose-answer buttons.
    if (buttons.some((b) => plen(b) < 60 && CHOOSE_BTN.test(b))) return 'choose_answer';

    const marks = [...text.matchAll(MARK)];
    if (marks.length) {
      const last = marks[marks.length - 1];
      const before = text.slice(0, last.index);
      const after = text.slice(last.index + last[0].length);
      const asked = ASK.test(before.trimEnd());
      // 4. Status text after the last mark.
      const status = after.trim() ? classifyText(head(after, 600)) : null;
      if (['limit_reached', 'login_required', 'captcha', 'account_action', 'error_message', 'choose_answer'].includes(status)) return status;
      const bodyAfter = after.replace(/\s+/g, ' ').trim();
      if (asked) {
        if (plen(bodyAfter) < 200) return buttons.some((b) => SEND.test(b)) ? 'prompt_unsent' : 'unknown';
        if (SPINNER.test(tail(after, 200)) || WORKING.test(tail(after, 300))) return 'still_generating';
        return 'unknown';
      }
      if (SPINNER.test(tail(after, 120))) return 'still_generating';
      return 'answer_ready';
    }

    // 5. No mark at all.
    const stripped = text.trim();
    if (plen(stripped.replace(/[^\p{L}\p{N}_]+/gu, '')) < 12) return 'empty_page';
    const lines = splitLines(stripped).map((ln) => ln.trim()).filter(Boolean);
    if (plen(stripped) < 800 && lines.slice(-8).some((ln) => EMPTY_HINT.test(ln))) return 'empty_page';
    if (SPINNER.test(tail(stripped, 120)) || WORKING.test(tail(stripped, 200))) return 'still_generating';
    const tailLines = lines.slice(-2).filter((ln) => plen(ln) <= 160).join(' | ');
    const status = tailLines ? classifyText(tailLines) : null;
    if (status) return status;
    return 'unknown';
  };

  const api = Object.freeze({ classify, classifyText });
  root.LocalRules = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
