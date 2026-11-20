"""Level 0 rules v2: situation from page facts, or None when silent.
Status phrases count only in windows (dialogs) or in the text AFTER the last delivery mark, never in the answer body."""
import re

MARK = re.compile(r'\[\[AO-[a-z0-9]+\]\]')
ASK = re.compile(r'напиши только метку\s*$', re.I)
STOP = re.compile(r'^\s*(стоп|stop|остановить|остановить генерацию|stop generating)\b|^\s*[\u25a0\u23f9\u25fc]\s*$', re.I)
SEND = re.compile(r'^\s*(отправить|send)\b', re.I)

LIMIT = re.compile(r'лимит|usage limit|rate limit|limit (reached|exceeded)|reached (your|the) .{0,30}limit|message cap|too many requests|слишком много запросов|запросы закончились|недоступны до|unavailable until|available again|доступно снова|resets? (at|in|on)|сброс в|try again (later|at|in) .{0,20}(hour|minute|час|мин|\d)|quota|exhaust|исчерпан', re.I)
LOGIN = re.compile(r'войдите|выполните вход|войти, чтобы|log ?in to|sign ?in (again )?to|please (log|sign) ?in|session (has )?expired|сессия (истекла|завершена)|your session expired|sign in again|login required|требуется вход|авторизуйтесь', re.I)
CAPTCHA = re.compile(r'вы человек|не робот|are you (a )?(human|bot|robot)|human|\bbot\b|робот|puzzle|капч|captcha|проверка безопасности|security check|checking your browser|verify (that )?you', re.I)
ACCOUNT = re.compile(r'услови|terms|privacy|политик|подписк|subscri|upgrade|оплат|payment|billing|тариф|your plan|ваш тариф|cookie|куки|ваш возраст|your age|age verification|ваш регион|your region|подтвердите (адрес|почт|аккаунт|номер|email)|verify your (email|account|phone)|confirm your (email|account|phone)|обновите аккаунт|update (your )?(account|payment)|согласи|consent|accept|принять', re.I)
ERROR = re.compile(r'oops|something went wrong|went wrong|network error|сетев\w+ ошибк|ошибк\w+ (сети|подключени|сервера)|server (error|is busy|overloaded)|сервер (перегружен|недоступен)|failed to (send|load|connect)|не удалось (отправить|загрузить|подключ)|issue connecting|connection (error|lost|failed)|страница не загрузилась|временная ошибка|произошла ошибка|an error occurred|try again|что-то пошло не так|сбой|внутренн\w+ ошибк|internal (server )?error|error (code )?5\d\d|код 5\d\d|временно недоступн', re.I)
CHOOSE = re.compile(r'какой ответ|which (response|answer|reply)|предпочита|prefer|выберите (ответ|вариант)|choose (this|the|one)|use this (response|answer|reply)|использовать этот ответ|оставить этот|keep this|pick (one|the better)|лучше\??$', re.I)
CHOOSE_BTN = re.compile(r'^\s*(предпочита|prefer|использовать этот|use this|choose this|выбрать этот|select this|оставить этот|keep this|этот (ответ )?лучше|this (one|response|answer) is better)', re.I)
INFO = re.compile(r'новые функции|what.?s new|new features|совет|\btip\b|нововведени|обновление функций|update available|доступна новая версия|announcement|новост|welcome|добро пожаловать|опрос|survey|feedback|отзыв', re.I)
SPINNER = re.compile(r'[\u280b\u2819\u2839\u2838\u283c\u2834\u2826\u2827\u2807\u280f\u2801-\u28ff]')
WORKING = re.compile(r'думаю|thinking|печатает|typing|поиск источников|searching|выполняется|in progress|анализирую|reasoning|working on it|generating', re.I)
EMPTY_HINT = re.compile(r'^(чем я могу помочь\??|how can i help( you)?( today)?\??|ask anything|спросите что угодно)$', re.I)


def classify_text(s):
    """Status classes by phrase, in priority order, for a short status text."""
    for name, pat in (('limit_reached', LIMIT), ('login_required', LOGIN), ('captcha', CAPTCHA), ('account_action', ACCOUNT), ('error_message', ERROR), ('choose_answer', CHOOSE), ('info_dialog', INFO)):
        if pat.search(s):
            return name
    return None


def rules(page):
    text = page.get('text') or ''
    buttons = page.get('buttons') or []
    dialogs = [d for d in (page.get('dialogs') or []) if d and d.strip()]
    joined = ' | '.join(dialogs)

    # 1. A window decides over everything under it.
    if joined:
        got = classify_text(joined)
        if got:
            return got
        return None  # unknown window: stay silent

    # 2. Stop button: still generating.
    if any(STOP.match(b) for b in buttons):
        return 'still_generating'

    # 3. Choose-answer buttons.
    if any(CHOOSE_BTN.search(b) for b in buttons if len(b) < 60):
        return 'choose_answer'

    marks = list(MARK.finditer(text))
    if marks:
        last = marks[-1]
        before = text[:last.start()]
        after = text[last.end():]
        asked = bool(ASK.search(before.rstrip()))
        # 4. Status text after the last mark.
        status = classify_text(after[:600]) if after.strip() else None
        if status in ('limit_reached', 'login_required', 'captcha', 'account_action', 'error_message', 'choose_answer'):
            return status
        body_after = re.sub(r'\s+', ' ', after).strip()
        if asked:
            if len(body_after) < 200:
                return 'prompt_unsent' if any(SEND.match(b) for b in buttons) else 'unknown'
            if SPINNER.search(after[-200:]) or WORKING.search(after[-300:]):
                return 'still_generating'
            return 'unknown'
        if SPINNER.search(after[-120:]):
            return 'still_generating'
        return 'answer_ready'

    # 5. No mark at all.
    stripped = text.strip()
    if len(re.sub(r'\W+', '', stripped)) < 12:
        return 'empty_page'
    lines = [ln.strip() for ln in stripped.splitlines() if ln.strip()]
    if len(stripped) < 800 and any(EMPTY_HINT.match(ln) for ln in lines[-8:]):
        return 'empty_page'
    if SPINNER.search(stripped[-120:]) or WORKING.search(stripped[-200:]):
        return 'still_generating'
    tail_lines = ' | '.join(ln for ln in lines[-2:] if len(ln) <= 160)
    status = classify_text(tail_lines) if tail_lines else None
    if status:
        return status
    return 'unknown'
