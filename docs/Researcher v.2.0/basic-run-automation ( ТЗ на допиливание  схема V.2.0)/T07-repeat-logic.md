# T07 · Модуль повтора: задача следующего захода и условия продолжения

Ты — исполнитель кода расширения AutoOrchestr. Твоя задача — написать модуль без обращения к странице, который решает три вопроса повтора: как собрать задачу следующего захода, какой текст в неё перенести и можно ли начинать следующий заход. Страницу не трогай: подключение — задание T08.

Сначала выполни «Общие правила» из `docs/Researcher v.2.0/basic-run-automation ( ТЗ на допиливание  схема V.2.0)/README.md`. Задание T06 должно быть сделано: `BasicSchema.resolveRun` отдаёт `repeat`.

## Что есть сейчас

- Поле `run.repeat` схемы: `carry { step, participant, artifact }`, `carryMarker`, `maxPasses`, `maxRequests`, `ownerEvery`, `carryMaxChars`.
- Выгрузка записи прогона (`exportRun` в `disput/custom-run-record.js`, строка 382) содержит `stopReason` и `artifacts`. У записи артефакта есть `id`, `lineage { step, participant, id }`, `valid` и `text` — весь ответ, из которого артефакт взят.
- Текст документа из ответа достаёт `extractDocument(answer, id)` в `disput/basic-output.js` (строка 90): возвращает текст между метками `[[DOC: id]]` и `[[/DOC]]` или `null`. `cleanAnswer` там же (строка 147) убирает служебные метки.

## Что сделать

Новый файл `disput/basic-repeat.js`, глобальное имя `BasicRepeat`. Все функции чистые и синхронные.

| Функция | Что делает |
| --- | --- |
| `splitTask(task, marker)` | Ищет первую строку, которая после обрезки пробелов равна `marker`. Возвращает `{ template, carried }`: `template` — текст до конца этой строки вместе с переводом строки; `carried` — всё после. Строки нет — `null` |
| `fillCounters(template, { pass, requestsLeft })` | Заменяет `{заход}` на номер захода, `{заход+N}` на номер захода плюс N, `{осталось запросов}` на число или слова «без предела», если `requestsLeft` равно `null`. Остальной текст не меняет |
| `taskForPass({ template, carried, pass, requestsLeft })` | `fillCounters(template, …) + carried` |
| `carriedText({ artifacts, carry, extractDocument, cleanAnswer })` | Берёт последнюю запись `artifacts`, у которой `lineage` совпадает с `carry` (`step`, `participant`, `id` равен `carry.artifact`) и `valid` не `false`. Текст: `extractDocument(entry.text, carry.artifact)`, а если он `null` — `cleanAnswer(entry.text)`. Нет записи или текст пуст — `null` |
| `decide({ repeat, pass, requestsUsed, stopReason, carried, saved })` | Возвращает `{ go, reason, ownerWindow }`; правила ниже |

Правила `decide`, по порядку; первое сработавшее даёт `go: false` и свою причину:

| Причина | Условие |
| --- | --- |
| `not_done` | `stopReason` не равен `steps_done` |
| `not_saved` | `saved` не `true` — запись захода не легла на диск |
| `no_carry` | `carried` равен `null` |
| `carry_too_long` | задан `carryMaxChars` и `carried` длиннее |
| `passes` | `pass >= repeat.maxPasses` |
| `requests` | задан `maxRequests` и `requestsUsed >= maxRequests` |

Иначе `go: true`, `reason: ''`. `ownerWindow` равен `true`, когда `go` истинно, задан `ownerEvery` и `pass` делится на него без остатка.

Экспортируй ещё `REASON_TEXT` — русский текст каждой причины для уведомления: «заход не дошёл до конца», «запись захода не сохранена», «нет документа для переноса», «документ для переноса длиннее предела», «достигнут предел заходов», «достигнут предел запросов».

Модуль не читает ответы моделей по смыслу: он сравнивает строки, считает и подставляет.

## Проверка

Новый файл `tests/basic-repeat.test.js`:

- `splitTask`: маркер в середине; маркер с пробелами по краям строки; маркера нет — `null`; маркер последней строкой — `carried` пуст;
- `fillCounters`: `{заход}`, `{заход+11}` при `pass: 2` даёт 13, `{осталось запросов}` числом и «без предела»; текст без меток не меняется;
- `taskForPass(splitTask(t, m))` при `pass: 1` и тех же счётчиках восстанавливает исходный текст без меток;
- `carriedText`: документ в метках `[[DOC: map]]`; ответ без меток; две версии — берётся последняя; последняя с `valid: false` — берётся предыдущая годная; нет записи — `null`;
- `decide`: по одному случаю на каждую причину; порядок причин при двух условиях сразу; `ownerWindow` при `ownerEvery: 5` на заходах 4, 5, 10.

## Документы

- `docs/Pipeline scenarios/basic-developer.md`: строка файла в таблице «Файлы Basic» с символами `BasicRepeat`, `splitTask`, `fillCounters`, `taskForPass`, `carriedText`, `decide`, `REASON_TEXT`; файл тестов в таблице «Тесты».
- Подключение модуля — правило 5 общих правил.

## Готово, когда

Тесты проходят; модуль подключён, но страница его ещё не вызывает.
