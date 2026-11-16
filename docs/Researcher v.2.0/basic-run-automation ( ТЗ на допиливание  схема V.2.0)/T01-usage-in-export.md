# T01 · Сводка расхода в выгрузке прогона

Ты — исполнитель кода расширения AutoOrchestr. Твоя задача — добавить в выгрузку прогона Basic итоговую сводку расхода, чтобы число запросов не приходилось считать руками.

Сначала выполни «Общие правила» из `docs/Pipeline scenarios/basic-run-automation/README.md`.

## Что есть сейчас

- Выгрузку (файл кнопки Basic) собирает `buildReport` в `shared/basic-telemetry.js` (строка 118). Она возвращает объект с полями `format`, `customRun`, `rounds`, `delivery`, `telemetry` (строки 158–177).
- `rounds` — одна запись на шаг и заход шага. Её строит `buildRoundsSummary` (строка 324). В каждой записи уже есть `attemptCount`, `sentCount`, `participants[].outcome`, `userWaitDurationMs`, `kind` (строки 413–427).
- Что считается отправленным запросом, решает `isConfirmedSent` внутри `buildRoundsSummary` (строка 377).
- `customRun` — выгрузка записи прогона: `startedAt`, `finishedAt`, `attempts[]`; у попытки есть `model`, `accepted`, `state`, тексты `prompt`, `sentPrompt`, `answer`.

Итогов по прогону в выгрузке нет: их нужно складывать из `rounds` вручную.

## Что сделать

Только файл `shared/basic-telemetry.js`.

1. Вынеси `isConfirmedSent` из `buildRoundsSummary` на уровень модуля, без изменения логики.
2. Добавь чистую функцию `buildUsage({ customRun, rounds })`. Она возвращает:

| Поле | Как считается |
| --- | --- |
| `requestsSent` | Сумма `sentCount` по записям `rounds`, где `kind` не `owner` |
| `attempts` | Сумма `attemptCount` по тем же записям |
| `participantsExpected` | Сумма длин `expectedParticipants` по тем же записям |
| `participantsAccepted` | Число участников с `outcome === 'accepted'` в тех же записях |
| `participantsWithoutAnswer` | `participantsExpected − participantsAccepted` |
| `ownerWaitMs` | Сумма числовых `userWaitDurationMs` по всем записям `rounds` |
| `ownerWaitUnknown` | `true`, если хотя бы у одной записи `userWaitDurationMs` равно `null` |
| `durationMs` | `finishedAt − startedAt`, если оба — числа; иначе `null` |
| `promptChars` | Сумма длин `sentPrompt` (если пусто — `prompt`) по попыткам, для которых `isConfirmedSent` верно |
| `answerChars` | Сумма длин `answer` по попыткам с `accepted === true` |
| `byModel` | Объект «имя модели → `{ requestsSent, accepted }`» по попыткам |

Отсутствующий текст считается нулём. Функция ничего не выводит и не оценивает: только складывает.

3. В `buildReport` после вычисления `rounds` (строка 150) посчитай `usage` и добавь поле `usage` в возвращаемый объект сразу после `rounds`. Значение `format` не меняй: поле добавляется, прежние поля остаются.
4. Добавь `buildUsage` в экспорт модуля (строка 434).

## Проверка

Файл `tests/basic-telemetry-rounds.test.js`, новый блок `describe('Basic telemetry: usage')`:

- два раунда и шаг User; у одного участника две попытки, принята вторая → `requestsSent`, `attempts`, `participantsAccepted` равны ожидаемым числам;
- попытка со `state: 'not_sent'` в `requestsSent` и `promptChars` не входит;
- шаг User в `requestsSent` не входит, его ожидание входит в `ownerWaitMs`;
- запись без `waits` даёт `ownerWaitUnknown: true`;
- незавершённый прогон (`finishedAt: null`) даёт `durationMs: null`;
- `buildReport` возвращает `usage`, а `format` остался `basic-telemetry/3`.

## Документы

- `docs/Pipeline scenarios/basic-developer.md`, таблица «Файлы Basic», строка `shared/basic-telemetry.js`: добавь символ `buildUsage` и слова «сводка расхода `usage`».
- `docs/Pipeline scenarios/basic-start-here.md`, раздел «События журнала и запись о прогоне»: одна строка о поле `usage`.
- `docs/Researcher v.2.0/operations/02-runbook.md`, §5, шаг 9: расход берётся из `usage.requestsSent` выгрузки.

## Готово, когда

Новые тесты и `tests/basic-docs-refs.test.js` проходят; в выгрузке любого прогона есть `usage`; ни одно прежнее поле выгрузки не изменилось.
