# ChatGPT (провайдер GPT)

Код: `content-scripts/content-chatgpt.js`, селекторы `selectors/chatgpt.config.js`, разбор ответа `content-scripts/turn-resolver.js`. Разметка блоков кода и таблиц: `docs/Architecture/answer-markdown-matrix.md` (строки 18, 39, 56, 73). Заготовка от 2026-10-30. Факты взяты из кода и выгрузок 2.81.935–2.81.948; живой DOM на сегодня не снимался.

## 1. Отправка

- Поле ввода: `textarea[data-id="root"]`, `textarea[name="prompt"]`, затем `div[role="textbox"]` и `[contenteditable="true"]` (`selectors/chatgpt.config.js`, `emergencyFallbacks.composer`; в коде также `div[contenteditable="true"][data-testid*="composer"]`, `content-chatgpt.js:964–971`).
- Редактор должен принять весь промпт: после вставки проверяется, что текст поля совпадает с промптом; иначе `composer_prompt_mismatch` (`content-chatgpt.js:1051–1063`).
- Кнопка отправки: `button[data-testid="send-button"]` и варианты `fruitjuice-`, `composer-`, `pegasus-send-button`, `*send-button*` (`content-chatgpt.js:1074–1079`). Если кнопка остаётся выключенной с промптом в поле, попытка завершается `send_not_taken` (`content-chatgpt.js:1103`).
- Запрос с вложением: код ждёт включённую кнопку отправки до 45 с (`attachmentSendDeadline`, около `content-chatgpt.js:1190`), потому что клавиатурная отправка во время загрузки файла оставляет оверлей добавления файла открытым (комментарий в том же месте).
- Ctrl+Enter — запасной путь: keydown/keyup Enter с `ctrlKey: true` (`content-chatgpt.js:1143–1146`, лог «Trying Ctrl+Enter send», строки 1207–1215). Простой Enter тоже описан (строки 1137–1138).
- Подтверждение отправки (`content-chatgpt.js:1159–1176`): появился Stop, вырос счётчик ходов пользователя или появился новый блок ответа. Пока промпт стоит в поле, ни один признак отправку не подтверждает.

## 2. Начало и конец генерации

- Ход рисуется цепочкой соседних блоков `[data-markdown-text-style="assistant-message"]` (`selectors/chatgpt.config.js`, `observationDefaults.targetSelectors`; `content-chatgpt.js:37`). Блоки: строки состояния, черновик, итоговый ответ. Комментарий в `turn-resolver.js:86–87`.
- Строка состояния (`turn-resolver.js:93–102`): блок внутри `span > span`; либо короче 200 симв. без метки и с глаголом процесса без вердикта (`shared/answer-content-classifier.js`, `PROGRESS_START_RE`, `isProgressLine`); либо короче 200 симв. без метки при более длинном блоке после него.
- Глаголы строк состояния в любом времени и форме («Проверил…», «Уточнил…», «Анализируя…», «Thinking…»), см. `docs/Transport/message-delivery.md`, раздел «Пустой и шумовой текст во время генерации». Из данных: «Проверил и уточнил технические риски», 36 симв. (экспорт `Remote_Viewfinder_v2_2026-10-30_13-48/exports/Basic 20261030_14-34.json`, GPT a2, SUCCESS); «Проверил измерения задержки Анализируя сетевые ограничения», 58 симв. (заметка `docs/Run/Test_run/Remote_Viewfinder_v2_2026-10-30_13-48/notes/run-report.md`).
- Stop виден весь ход: при видимом Stop блок без метки не становится ответом. `pickChatGptAnswerNode(entries, { stopVisible: true })` возвращает `null`, пока итоговый блок не отрисован (`turn-resolver.js:106–112`; тесты `tests/chatgpt-block-chain-final.test.js`). Признак Stop: `button[data-testid="stop-button"]` (`selectors/chatgpt.config.js`, `endGenerationMarkers`, тип `disappear`).
- Итог определяется по метке доставки `[[AO-xxxxxx]]` в хвосте блока (`turn-resolver.js:88`, `DELIVERY_TOKEN_RE`; правило хвоста в `docs/Transport/message-delivery.md`: метка и не более 40 симв. после неё). Без метки при отсутствии Stop берётся последний блок, не являющийся строкой состояния (`turn-resolver.js:106–112`).
- Короткий промежуточный блок с кнопками действий, который появляется, пока модель ещё пишет: в коде и документах не найден. Со слов владельца; не подтверждено.

## 3. Структура ответа

- Таблицы: pipe-таблицы через `replaceTablesWithMarkdown` при очистке (`content-chatgpt.js:560`). Разметка таблицы: `[class*=tableContainer]` > `[class*=tableWrapper]` > `table` (`docs/Architecture/answer-markdown-matrix.md`, строка 18).
- Код: `pre` > `#code-block-viewer.cm-editor` > `pre.cm-content` > `code` (там же). Подпись языка и кнопка копирования живут в блоке кода и удаляются при очистке (матрица, строка 73).
- Markdown-копия ответа не приходит: `copySource: none`, `resultHasMarkdown: false` (реестр L-31, статус ОТКРЫТО, прогон 950). Причина в извлечении копии (`content-chatgpt.js`, `getResponses`, строки 1393–1410, вызов `buildLatestAnswerCopy`). Не разобрана.
- Переводы строк в плоском тексте: в каждой GPT-попытке всех выгрузок 2.81.935–2.81.948 поле `answer` содержит 0 переводов строки (проверка по `customRun.attempts`; например, `docs/Run/Test_run/Mosquito_Trap_Function_Card_2026-10-30/exports/Basic 20261030_16-13.json`, GPT a1 SUCCESS, 5091 симв., 0 переводов). Исправление M-6 (коммит cd6b496b, ветка) экспорты не содержат. Не проверено на живом прогоне.
- Метка доставки срезается из текста ответа (`docs/Transport/message-delivery.md`, раздел «Принадлежность ответа»).

## 4. Лимиты и сообщения сайта

- Текстов о лимите использования в скрипте ChatGPT нет. Общий детектор — `shared/usage-limit-detector.js`; для GPT на живом сайте не проверено.
- Ветка `type: 'rate_limit'` в `content-chatgpt.js:511` (по коду, не проверено на сайте).
- Вложение может быть заблокировано сайтом: сообщение «Request blocked; manual Ctrl/Cmd+V required» (`content-chatgpt.js:1035–1039`, ошибка `attachment_failed`).

## 5. Известные сбои и как они выглядят в экспорте

| Сбой | Признак в экспорте | Источник |
|---|---|---|
| Преамбула принята за ответ | GPT a1 PARTIAL `partial_unproven`, 289 симв. | `Remote_Viewfinder_v2_2026-10-30_13-48/exports/Basic 20261030_14-34.json`; реестр L-3 |
| Строка состояния принята за ответ | GPT a2 SUCCESS, 36 симв., 65 с, `automatic_retry` | то же; реестр R-C2, L-13 |
| Преамбула как пустой финал | GPT EXTRACT_FAILED, 172 симв. | `Basic 20261030_13-04.json` (2.81.946); CHANGELOG 2.81.948 |
| Короткий текст как успех | GPT PARTIAL `partial_short`, 47 симв. | `docs/Run/Test_run/Remote_Viewfinder_2026-10-30/exports/Basic_2026-10-30_09-00_run-2.81.940.json` |
| Текст без переводов строк | `nl=0` во всех GPT-попытках 2.81.935–2.81.948 | см. раздел 3 |
| Нет markdown-копии | `copySource: none` | реестр L-31 (ОТКРЫТО) |

## 6. Не проверено

- Живой DOM цепочки блоков во время «Проверил…» / «Анализируя…» (задание GPT-расширению, `docs/Run/Test_run/Remote_Viewfinder_2026-10-30/notes/review.md`, раздел «Нужна проверка в браузере», пункт 1). Не подтверждено вживую.
- Короткий промежуточный блок с кнопками действий (см. раздел 2). Не подтверждено.
- Работа `pickChatGptAnswerNode` в живом прогоне (L-3 ЗАКРЫТО-Н, по тестам; «подтвердить живьём»).
- Mermaid в ответах GPT (L-5, «не проверено вживую» у 8 провайдеров).
- Лимиты и сообщения сайта для ChatGPT. Не подтверждено.

## 7. Наблюдения

| Дата | Версия | Источник | Наблюдение | Как проявляется (признаки) | Влияние на движок | Что сделано |
|---|---|---|---|---|---|---|
| 2026-10-30 | 2.81.950 (ветка) | `content-scripts/turn-resolver.js:88–112`; `tests/chatgpt-block-chain-final.test.js`; реестр L-3, L-13 | Ход ChatGPT — цепочка блоков: строки состояния, черновик, итог. Итог выбирается по метке `[[AO-…]]`; при видимом Stop блок без метки не финализируется. | Строка «Проверил…» 36–58 симв. или преамбула 289 симв. без метки | Без проверки метки строка состояния или преамбула становятся ответом | ЗАКРЫТО-Н (тесты); живьём не подтверждено |
| 2026-10-30 | 2.81.948 | экспорт `Basic 20261030_14-34.json`; реестр L-31 | Текст GPT без переводов строк; markdown-копия не приходит (`copySource: none`) | `nl=0` во всех GPT-попытках; таблицы — строки с `\|` | Пайплайн получает плоский текст, таблицы слипаются | ОТКРЫТО (L-31); M-6 — в ветке |
| 2026-10-30 | 2.81.948 | экспорт `Basic 20261030_16-13.json` | Отправка GPT прошла с первой попытки; ответ 5091 симв. при Stop-видимом ходе | SUCCESS, `dur_s=152` | — | Наблюдение |
| 2026-10-30 | 2.81.951 | живая страница прогона «Исследование инструкция v2» (23:5x); реестр M-16 | Новая разметка ответа ChatGPT: нет `[data-message-author-role]`; ответ в `div[data-markdown-text-style="assistant-message"].MarkdownRoot` внутри `.DilRenderer` (`data-dil-message-id`, `data-dil-source-message-id`, `data-chatgpt-copy-reference=1`, `data-markdown-copy=contents`); ход `div[data-talvt-turn-state="complete"]` в `div[data-turn-key]`; поле ввода `DIV` без id; на время размышления кнопка «Пропустить», после — «Ответ готов» | карточка берёт строку размышления (195 симв.) как ответ, `partial_unproven` | движок не читает ответ GPT | записано в реестр M-16 (причина не доказана: см. M-19, возможна не та вкладка) |
