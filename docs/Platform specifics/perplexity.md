# Perplexity (провайдер Perplexity)

Код: `content-scripts/content-perplexity.js`, селекторы `selectors/perplexity.config.js`, окна ожидания `docs/Transport/message-delivery.md` (абзац «Окно генерации Perplexity») и `GENERATION_WINDOW_MS` в `shared/transport-contract.js`. Заготовка от 2026-10-30.

## 1. Отправка

- Поле ввода ищется как «свой» композер с текстом промпта: `findOwnedPerplexityPromptComposer` (`content-perplexity.js:273`); видимый композер ждётся до 15 с (`waitForVisiblePerplexityComposer(15000)`, строка 328).
- Подтверждение отправки через `ProviderSubmitConfirmation` с базовым снимком до отправки (`content-perplexity.js:305–323`).
- Признак остановки генерации (Stop): `button[aria-label*="stop" i]:not([disabled])`, `button[data-testid*="stop" i]:not([disabled])` (`content-perplexity.js:292–293`).
- Композер в транзакции (`perplexity-composer-transaction.js`) — не разбирался в этой заготовке.

## 2. Начало и конец генерации

- Исследовательский режим отвечает долго и делает паузы, пока ищет источники. В документах: 8–10 мин, в прогоне 2.81.950 — 469–581 с (`docs/Transport/message-delivery.md`, абзац «Окно генерации Perplexity»).
- В экспорте 2.81.948 (`Basic 20261030_16-13.json`) интервалы от отправки до финализации попыток Perplexity: 1059 с и 935 с, то есть 15–18 мин. Интервал может включать повторы, поэтому вывод о времени генерации не подтверждён.
- Окна (только для Perplexity): тишина до фиксации текста без метки 240 с (вместо 30 с, `text_quiet`), предел отсрочки неопределённого финала 540 с (вместо 180 с), на стороне страницы `hardMax` и `veryLong.timeout` 540 с на хосте perplexity.ai (`PERPLEXITY_RESEARCH_OVERRIDES` в `content-scripts/pipeline-config.js`) — `docs/Transport/message-delivery.md`.
- Конец ответа: метка доставки `[[AO-…]]` в хвосте. Без метки ответ — PARTIAL `partial_unproven` или `capped_unproven` (реестр M-5, L-17).

## 3. Структура ответа

- Ответ: `[data-testid="answer-card"] .prose`, `[data-testid="answer"] .prose`, `[data-testid="chat-message"] .prose`, `[data-testid="conversation-turn"] .prose`, `[class*="answer-container" i] .prose`, затем общий `.prose` (`content-perplexity.js:473–480`).
- Вложенные `.prose` внутри одного ответа давали фрагменты: берётся самый внешний блок (`content-perplexity.js:515–522`; M-5, M-10).
- Иконки источников: `a svg` в чипах — декор, не признак неполной копии (реестр L-5, `skeleton complete=true`). Чипы `.citation` не относятся к UI (матрица, строка 25).
- Эхо запроса: `prompt_echo` — общие фолбэки `.prose` и `article` часто попадают на реплику пользователя; такие блоки пропускаются (`content-perplexity.js:521–522`).
- Очистка текста: `replaceTablesWithMarkdown`, строки `Perplexity` / `PPLX` / `Pro Search` удаляются из текста (`content-perplexity.js:698–729`).
- Markdown-копия ответа не приходит: `copySource: none`, `resultHasMarkdown: false` (реестр L-31, ОТКРЫТО, прогон 950).

## 4. Лимиты и сообщения сайта

- Текстов о лимите в скрипте нет (ветка `rate_limit`, `content-perplexity.js:584`). Общий детектор — `shared/usage-limit-detector.js`; на Perplexity не проверено.

## 5. Известные сбои и как они выглядят в экспорте

| Сбой | Признак в экспорте | Источник |
|---|---|---|
| Эхо запроса принято за ответ | PARTIAL `prompt_echo`, 13430 симв. (2.81.945), 14384 симв. (2.81.947) | `Basic_2026-10-30_11-08_run-2.81.945_final.json`; `Basic 20261030_13-41.json` |
| Обрубки ответа | PARTIAL `partial_unproven`: 92, 2937, 175 симв. (2.81.948), 971/2173/2959/305 симв. (реестр M-5) | `Basic 20261030_16-13.json`; реестр M-5, M-10 |
| Пустая попытка | UNCERTAIN `empty` 259 с, затем SUCCESS 7845 симв. (`user_resend`) | `Basic 20261030_13-04.json` (2.81.946) |
| Отказ отправки | NO_SEND `not_sent` 192 с | `Basic 20261030_13-41.json` (2.81.947) |
| Копия неполная | «копия неполная» в прогоне комаров | `docs/Run Automation/Test_run/Mosquito_Trap_Function_Card_2026-10-30/notes/run1-claude-limit.md`; L-5 (порог 25 % — ЗАКРЫТО-Н) |
| Таблицы слипаются | Разделители `\|` в итоговом документе, один символ на файл | `docs/Run Automation/Test_run/Remote_Viewfinder_v2_2026-10-30_10-31/notes/run-report.md` |

## 6. Не проверено

- Живой DOM ответа в исследовательском режиме. Задание GPT-расширению: элемент со словом «Выполняется» и его отсутствие в финале (`docs/Run Automation/Test_run/Remote_Viewfinder_2026-10-30/notes/review.md`, задания, пункт 3). Не подтверждено.
- Узел, который отдаёт обрубок 305 симв. после пропадания «Стоп» (M-10: «по DOM не установлен»).
- Длительность исследовательского режима: 469–581 с (документы) против 935–1059 с (экспорт 2.81.948). Расхождение не разобрано.
- Mermaid у Perplexity (L-5). Не подтверждено.
- Повтор при `partial_unproven` без перечитывания страницы (M-5: «не сделано»).

## 7. Наблюдения

| Дата | Версия | Источник | Наблюдение | Как проявляется (признаки) | Влияние на движок | Что сделано |
|---|---|---|---|---|---|---|
| 2026-10-30 | 2.81.950 (ветка) | `docs/Transport/message-delivery.md` (абзац «Окно генерации Perplexity»); реестр M-5 | Исследовательский режим идёт 469–581 с (документы), в экспорте 935–1059 с; общие пороги 30 с и 180 с закрывали ответ посреди генерации | `text_quiet`, `capped_unproven`, PARTIAL на полуслове | Обрубки PARTIAL, повтор отправки | ЗАКРЫТО-Н (окна 240/540 с); живьём не проверено |
| 2026-10-30 | 2.81.948 | `Basic 20261030_16-13.json`; CHANGELOG 2.81.948 | Эхо запроса принято за ответ | `prompt_echo`, 13–26 тыс. симв. | Мусор в ответе | ЗАКРЫТО-Н (2.81.948), в прогоне 948 — SUCCESS 7265 симв. |
| 2026-10-30 | 2.81.948 | реестр L-31 | Markdown-копия не приходит, таблицы в тексте — строки с `\|` | `copySource: none` | Таблицы без markdown | ОТКРЫТО |
| 2026-10-30 | 2.81.947 | `Basic 20261030_13-41.json` | Отказ отправки: кнопка не включилась | NO_SEND `not_sent` | Ожидание и повтор | Исправлено общим гейтом (2.81.949) |
| 2026-11-01 | — | ручной прогон Padel_Smash_Prototype_2026-11-01, версия расширения не участвовала | Кнопка «Копировать» через JS click не записывает буфер (остался прежний текст), ответ забран из DOM; innerText таблиц содержит мусор цитат (nature, +1, домен ссылки) | clipboard без изменений | Нужен DOM-разбор вместо Copy | Ответ 8 234 симв., около 50 с; модель «Kimi K3 Рассуждение» выбрана по умолчанию |
