# T08 · Повтор на странице: заходы, счётчики, окно User

Ты — исполнитель кода расширения AutoOrchestr. Твоя задача — сделать так, чтобы схема с полем `run.repeat` проходилась заход за заходом: каждый заход — обычный прогон Basic со своей записью, а между заходами страница считает, проверяет условия и собирает задачу следующего захода.

Сначала выполни «Общие правила» из `docs/Researcher v.2.0/basic-run-automation ( ТЗ на допиливание  схема V.2.0)/README.md`. Должны быть сделаны T01 и T03–T07: проверь, что есть `window.BasicRepeat.decide`, `window.BasicRunChain.saveRun`, `window.BasicTelemetry.buildUsage`, переменная `lastBasicAutosave` и поля `stopMarks`, `onNoAnswer`, `repeat` в `BasicSchema.resolveRun`.

## Что есть сейчас

Всё в `results.js`.

- Запуск со страницы — `startDebateFromPage` (строка 8022). Для Basic он вызывает `runCustomFromPage({ task })` (строка 8043).
- `runCustomFromPage` (строка 7302) ведёт один прогон и возвращает `true` или `false`. Запись прогона остаётся в `latestBasicRunRecord` (строка 2770). В блоке `finally` (строки 7955–7965) он снимает состояние «идёт прогон»: `pipelineRunActive = false`, `setPipelineRunUi(false)`.
- Новые вкладки моделей задаёт `forceNewTabs` в `activePipelineRunContext` (строка 7360).
- Остановка — `cancelPipelineRun` (строка 8049): прерывает текущий прогон через `customAbortController`.
- Окно с документом для User открывает `askChoiceDialog`; образец с редактируемым документом — `provideOwnerResult` (строки 7806–7825). Отмена окна возвращает `null`.
- Строка в ленту — `appendBasicRunLine` (строка 7204). Доступ к папке документов — `window.DocumentsFolder.instance.ensureAccess`.

## Что сделать

### 1. Малые правки существующего

- `runCustomFromPage`: новый необязательный параметр `forceNewTabs`; если он `true`, в `activePipelineRunContext.forceNewTabs` (строка 7360) пишется `true` независимо от флажка страницы.
- `autosaveRun` (задание T03): в возвращаемый объект добавь `usage` — поле `usage` собранного отчёта (его даёт T01), чтобы число запросов захода не пересчитывать.
- Переменная верхнего уровня `basicRepeatStop = false` рядом с `latestBasicRunRecord`. В `cancelPipelineRun` первой строкой: `basicRepeatStop = true`.

### 2. Функция `runBasicRepeat({ task, repeat })`

Объяви рядом с `runCustomFromPage`. Порядок работы:

0. Политика запуска: `getDebateRunPolicy()` не `auto` — уведомление «Basic: повтор идёт только при политике auto» и `return false`.
1. Разделить задачу: `BasicRepeat.splitTask(task, repeat.carryMarker)`. `null` — уведомление «Basic: в задаче нет строки <маркер>, повтор не запущен» и `return false`.
2. Проверить папку документов: `ensureAccess({ request: true })` не `granted` — уведомление «Basic: повтор требует папку документов: запись каждого захода обязательна» и `return false`. Запуск идёт по клику User, поэтому запрос доступа здесь разрешён.
3. `basicRepeatStop = false`; `pass = 1`; `requestsUsed = 0`; `carried` — из шага 1.
4. Цикл:
   - задача захода: `BasicRepeat.taskForPass({ template, carried, pass, requestsLeft })`, где `requestsLeft` — `repeat.maxRequests − requestsUsed` или `null`;
   - `await runCustomFromPage({ task: задача, forceNewTabs: true })`;
   - взять выгрузку записи захода: `window.CustomRunRecord.exportRun(latestBasicRunRecord)` — её `stopReason` и `artifacts`;
   - `requestsUsed += lastBasicAutosave?.usage?.requestsSent ?? числоЗапросовСхемы`. Если запись захода не удалась и точного числа нет, прибавляется верхняя граница — число участников всех раундов схемы: неизвестный расход считается потраченным;
   - `carriedNext = BasicRepeat.carriedText({ artifacts, carry: repeat.carry, extractDocument: window.BasicOutput.extractDocument, cleanAnswer: window.BasicOutput.cleanAnswer })`;
   - строка в ленту: `Заход <pass> из <maxPasses> · запросов <requestsUsed>` и, если задан предел, ` из <maxRequests>`;
   - если `basicRepeatStop` — уведомление «Basic: повтор остановлен User» и выход;
   - `BasicRepeat.decide({ repeat, pass, requestsUsed, stopReason, carried: carriedNext, saved: lastBasicAutosave?.ok === true })`;
   - `go: false` — уведомление `Basic: повтор остановлен после захода <pass>: <BasicRepeat.REASON_TEXT[reason]>` и выход;
   - `ownerWindow: true` — окно User (пункт 3); отмена окна — выход; иначе `carriedNext` заменяется текстом из окна;
   - `carried = carriedNext`; `pass += 1`.
5. Вернуть `true`, если прошёл хотя бы один заход до конца.

Между заходами страница не должна выглядеть свободной: сразу после возврата `runCustomFromPage` и до следующего вызова выставляй `pipelineRunActive = true` и `setPipelineRunUi(true)`, а при выходе из цикла — `false`. Тогда кнопка Stop остаётся доступной и второй запуск невозможен. Весь цикл оберни в `try/finally`: в `finally` — `pipelineRunActive = false`, `setPipelineRunUi(false)`, `updateDebateButtonsUi()`, иначе исключение оставит страницу занятой.

Stop между заходами попадает во вторую ветку `cancelPipelineRun` (без `customAbortController`): она снимает состояние страницы, а флаг `basicRepeatStop` не даёт начать следующий заход.

Строка «Продолжить прогон» (`offerResumeLine`) после незавершённого захода остаётся как есть: она продолжает один этот заход. Повтор после неё не возобновляется.

### 3. Окно User раз в N заходов

`askChoiceDialog` по образцу `provideOwnerResult`: заголовок `Повтор: заход <pass> из <maxPasses>`, сообщение со счётчиком запросов, документ `{ kind: 'read', editable: true, name: 'Документ для следующего захода', text: carriedNext }`, одна кнопка «Продолжить», текст отмены «Остановить повтор». Строковый ответ — новый текст документа.

### 4. Запуск

В `startDebateFromPage` (строка 8043): собери настройки `buildBasicRun(draftPlanForCanvas(getActiveDraftPlan())).run`; если `repeat` задан — `return runBasicRepeat({ task, repeat })`, иначе прежний вызов.

## Чего не делать

- Не продолжай повтор после перезагрузки страницы: состояние повтора нигде не сохраняется намеренно. Каждый заход — обычная запись прогона, её видно в ленте.
- Не меняй задачу захода ничем, кроме счётчиков и перенесённого документа.
- Не начинай следующий заход, если запись предыдущего не сохранена.

- Не запускай повтор молча на большие числа: перед первым заходом покажи строку в ленте `Повтор: до <maxPasses> заходов` и, если задан предел, `до <maxRequests> запросов`; если предел запросов не задан — `предел запросов не задан`.

## Проверка

- `tests/custom-run-resume-wiring.test.js`, по тексту `results.js`: `startDebateFromPage` вызывает `runBasicRepeat` только при `repeat`; `cancelPipelineRun` выставляет `basicRepeatStop`; `runBasicRepeat` вызывает `runCustomFromPage` с `forceNewTabs: true`.
- `tests/results-debate-favorites.test.js` (страница целиком, поддельный транспорт и поддельная папка документов):
  - схема с `maxPasses: 3` проходит три захода; в задаче второго захода после маркера стоит документ первого захода; счётчик `{заход}` равен 2; в папке три файла прогонов и три строки цепочки;
  - остановка по метке во втором заходе — третий не начат, уведомление называет причину;
  - `maxRequests` достигнут после первого захода — второй не начат;
  - папка документов недоступна — ни одного запроса не отправлено;
  - политика `manual` — ни одного запроса не отправлено;
  - исключение внутри захода — страница снова свободна;
  - Stop между заходами — следующий не начат;
  - `ownerEvery: 2` — окно после второго захода (в тесте подмени `window.ChoiceDialog.ask`); правка текста в окне попадает в задачу третьего; отмена окна останавливает повтор;
  - схема без `run.repeat` идёт одним прогоном, как раньше.

## Документы

- `docs/Pipeline scenarios/basic-start-here.md`: новый подраздел «Повтор схемы» в разделе «Как идёт прогон»: заходы, перенос документа, счётчики в задаче, причины остановки, окно User, что видно в ленте.
- `docs/Pipeline scenarios/basic-schema-guide.md`: убери оговорку из T06 «прогон идёт один раз»; опиши метки `{заход}`, `{заход+N}`, `{осталось запросов}`.
- `docs/Pipeline scenarios/basic-developer.md`: `runBasicRepeat`, `basicRepeatStop` в таблице «results.js: области и функции».
- `docs/Researcher v.2.0/process/04-endless-mode.md`, §5: пункты 1–6 — «сделано»; `docs/Researcher v.2.0/00-overview.md`, раздел 10 — состояние режима.

## Готово, когда

Схема с `run.repeat` проходит заданное число заходов без действий User, останавливается по каждой из причин и по Stop, а каждый заход оставляет запись и строку цепочки; схемы без поля работают как раньше.
