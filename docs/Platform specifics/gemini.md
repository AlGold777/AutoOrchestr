# Gemini (провайдер Gemini)

Код: `content-scripts/content-gemini.js`, селекторы `selectors/gemini.config.js`, привязка хода `content-scripts/turn-resolver.js`, снимок узлов `content-utils/response-lifecycle-detector.js`. Разметка: `docs/Architecture/answer-markdown-matrix.md` (строка 23). Заготовка от 2026-10-30.

## 1. Отправка

- Первая стратегия отправки — Ctrl+Enter: `runSendStrategy('ctrl_enter', dispatchGeminiKeyboard(..., { ctrlKey: true }), null, 2800)` (`content-gemini.js:1449–1455`). Кнопка отправки пробуется после него.
- Gemini может игнорировать все синтетические события клавиатуры и клики в фоновой вкладке (комментарий `content-gemini.js:1457–1458`).
- Перед отправкой снимается набор узлов ответа (`preDispatchNodes`, `content-scripts/unified-answer-pipeline.js:1413–1415`, `content-utils.js:795`). Набор нужен для привязки ответа (раздел 2).

## 2. Начало и конец генерации

- Узлы ответа: `model-response` (`content-gemini.js:36`), `.model-response-text`, `div[class*="model-response"]`, `[data-test-id="model-response-text"]` (`content-gemini.js:36–39`); при разборе `document.querySelectorAll('model-response')` (`:101`).
- Признаки генерации: `button[aria-label*="Stop" i]`, `button[aria-label*="Остановить генерацию" i]`, `[class*="streaming" i]` (`content-gemini.js:1376`).
- Привязка ответа к ходу (M-12): анкор «число узлов до отправки» не растёт, если Gemini добавил узел, а кандидатов не прибавилось; пул после анкора пуст, `answerNode` null, владение `UNKNOWN` навсегда. Причина установлена по телеметрии 2.81.950: `turnAnchor` 3 и `candidateCount` 3 во всех 208 проверках (`docs/Transport/message-delivery.md`, абзац «Привязка ответа Gemini»). Исправление: узел `model-response` с непустым текстом, которого не было в снимке (`turn-resolver.js:243–249`, причина `gemini_fresh_turn_node`, строка 303). Не проверено на живом Gemini.
- Причина `answer_node_unresolved` в экспорте выглядит как бесконечный `OWNERSHIP_UNKNOWN` и `LIFECYCLE_STRUCTURAL_VERIFICATION_PENDING` (реестр M-3).

## 3. Структура ответа

- Корень: `structured-content-container.model-response-text`; служебные узлы: `copy-button`, `message-actions`, `regenerate-button`, `thumb-*-button`, `mat-icon`, `gem-*`, `thinking-overlay`, `h*.sc…` (матрица, строка 23). Код и таблицы у Gemini не сняты; код — эвристика `<code-block>` / `pre`.
- Текст иконки кнопки копирования попадает в плоский текст (реестр L-25, P2, после живых данных).
- Служебный заголовок `h6.screen-reader-model-response-label` удаляется при очистке (`content-gemini.js:53`); метка узла ищется там же (`:117`).
- Переводы строк: в экспорте 2.81.948 попытка 1 на 41020 симв. имеет 0 переводов строки (`Basic 20261030_16-13.json`, Gemini a1 PARTIAL `partial_unproven`, 196 с). Заметка прогона: «0 строк на 40 тыс. символов» (`docs/Run/Test_run/Mosquito_Trap_Function_Card_2026-10-30/notes/run-report.md`, замечание 4).
- Отдельная попытка с `prompt_echo`: 26241 симв., 39 переводов строки (тот же экспорт, Gemini a1, 1059 с). Эхо запроса принято за ответ; проверка эха на уровне приёмки (`docs/Run/Test_run/.../run-report.md`).

## 4. Лимиты и сообщения сайта

- Текстов о лимите в скрипте нет; ветка `rate_limit` (`content-gemini.js:385`). Общий детектор — `shared/usage-limit-detector.js`; на Gemini не проверено.

## 5. Известные сбои и как они выглядят в экспорте

| Сбой | Признак в экспорте | Источник |
|---|---|---|
| Ответ не привязан к ходу | `answer_node_unresolved`, `OWNERSHIP_UNKNOWN` без конца | реестр M-3, M-12 |
| Пустой ответ при заблокированном экране | Попытки 3–4: FAILED `empty`, `stream_start_timeout` | реестр M-13; `docs/Platform specifics/environment.md`, раздел 1 |
| Частичный длинный ответ | a1 PARTIAL `partial_unproven`, 41020 симв., затем a2 SUCCESS 25241 симв. (автоматический повтор) | `Basic 20261030_16-13.json` |
| Эхо запроса | PARTIAL `prompt_echo`, 26241 симв. | `Basic 20261030_16-13.json` |
| Пустые попытки | FAILED `empty` (121 с и 935 с), затем `interrupted_in_flight` | `Basic 20261030_16-13.json` |

## 6. Не проверено

- Путь владения ответом end-to-end на живом Gemini (M-12, реестр: «Не проверено»).
- Признак «Остановить генерацию» на русском интерфейсе во время генерации — проверен в коде (`content-gemini.js:1376`), в живом DOM не снимался. Не подтверждено.
- Mermaid у Gemini (L-5). Не подтверждено.
- Причина пустых попыток 3–4 в прогоне 2.81.950 (экспорт `Basic-run3-v2.81.950.json`) — файл в репозитории отсутствует; опирается только на реестр M-3.

## 7. Наблюдения

| Дата | Версия | Источник | Наблюдение | Как проявляется (признаки) | Влияние на движок | Что сделано |
|---|---|---|---|---|---|---|
| 2026-10-30 | 2.81.950 (ветка) | `turn-resolver.js:243–303`; `docs/Transport/message-delivery.md`; реестр M-12 | Ответ Gemini, появившийся после отправки, не привязывался к ходу (анкор 3, кандидатов 3) | `answer_node_unresolved`, `OWNERSHIP_UNKNOWN` навсегда | Ответ не фиксируется, попытка уходит в FAILED | ИСПРАВЛЕНО в коде (`gemini_fresh_turn_node`), живьём не проверено |
| 2026-10-30 | 2.81.948 | `Basic 20261030_16-13.json` | Ответ 41 тыс. симв. без переводов строки, помечен PARTIAL; повтор дал 25 тыс. | `partial_unproven`, `nl=0` | Лишний повтор, потеря структуры | Наблюдение |
| 2026-10-30 | 2.81.948 | `Basic 20261030_16-13.json`; `run-report.md` (замечание 3–4) | Эхо запроса дало ответ 26 тыс. симв. с 39 переводами строки, помечен PARTIAL | `prompt_echo` | Приёмка отклонила; источник эха у Gemini не разобран | Не подтверждено, что эхо устранено |
| 2026-10-30 | 2.81.950 | реестр M-13; `environment.md` | Пустые попытки Gemini и DeepSeek были вызваны заблокированным экраном Mac, а не сайтом | `document.hidden=true`, `stream_start_timeout` | Ложный FAILED | Процесс: проверять экран перед прогоном |
| 2026-10-30 | 2.81.951 | прямое чтение вкладок (ведущий, 22:17, прогон «Исследование») | Страница Google «sorry» с проверкой на робота заменяет страницу Gemini | URL `https://www.google.com/sorry/index?continue=https://gemini.google.com/&q=…`, заголовок вкладки — URL | Запрос не отправляется; раунд ждёт без ответа; CAPTCHA решает только владелец | Реестр M-14 |
