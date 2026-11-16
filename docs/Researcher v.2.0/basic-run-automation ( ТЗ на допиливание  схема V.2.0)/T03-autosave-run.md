# T03 · Запись прогона на диск в конце каждого прогона

Ты — исполнитель кода расширения AutoOrchestr. Твоя задача — сделать так, чтобы в конце каждого прогона Basic его выгрузка сама записывалась в папку документов, а в цепочку добавлялась строка.

Сначала выполни «Общие правила» из `docs/Researcher v.2.0/basic-run-automation ( ТЗ на допиливание  схема V.2.0)/README.md`. Задания T01 и T02 должны быть сделаны: проверь, что есть `window.BasicTelemetry.buildUsage` и `window.BasicRunChain.saveRun`.

## Что есть сейчас

Всё в `results.js`.

- Выгрузку собирает обработчик кнопки `#disput-basic` (строки 17974–18014): берёт запись прогона, журнал доставки и события, вызывает `window.BasicTelemetry.buildReport` (строка 18004) и скачивает файл.
- Прогон ведёт `runCustomFromPage` (строка 7302). Запись прогона — переменная `record`; её окончательное сохранение — `await saveRecord(true)` на успешном пути (строка 7921) и на пути ошибки (строка 7951).
- Копию документа в папку пишет `saveDocumentCopy` (строка 7123) через `window.DocumentsFolder.instance`. Доступ к папке запрашивается только по клику User: `requestDocumentsAccess` (строка 7111).
- Строку в ленту прогона добавляет `appendBasicRunLine` (строка 7204).

## Что сделать

1. **Общая сборка выгрузки.** Вынеси из обработчика кнопки сборку отчёта в функцию `buildBasicReportNow({ record = null })` рядом с `readLatestCustomRun` (строка 17959), на том же уровне вложенности. Параметры: `{ record = null, executionActive = null }`. Она делает всё, что сейчас делает обработчик между проверкой кнопки и скачиванием: `basicCardHistory?.flush()`, выгрузка записи (`exportRun` от `record`, а без него — `latestBasicRunRecord` или `readLatestCustomRun`), снимок журнала доставки `MessageDelivery.snapshot()`, события `getTelemetryEventsForExport`, время и версия расширения, вызов `buildReport`. `executionActive`: если передано `null` — вычисляется как сейчас; иначе берётся переданное значение. Возвращает отчёт или `null`, если записи нет. Перед возвратом добавляет поле `taskSections`: `await window.BasicRunChain.taskSections(report.customRun.task)`. Обработчик кнопки вызывает её и скачивает результат. В скачанном файле появляется одно новое поле `taskSections`; остальное не меняется.
2. **Запись в конце прогона.** В `runCustomFromPage` добавь функцию `autosaveRun()`:
   - если `window.BasicRunChain` или `window.DocumentsFolder?.instance` нет — вернуть `{ ok: false, reason: 'none' }`;
   - собрать отчёт через `buildBasicReportNow({ record, executionActive: false })`: прогон к этому моменту закончен, хотя признаки «идёт прогон» на странице ещё не сняты;
   - вызвать `window.BasicRunChain.saveRun({ folder: window.DocumentsFolder.instance, dirs: window.DocumentsFolder.runDirs({ pipeline: customPipelineName(), startedAt: runContext.startedAt }), report, at: new Date().toISOString() })`;
   - успех — строка в ленту: `Запись прогона: <путь> · строка цепочки <номер>`;
   - неудача с причиной `denied` или `error` — одно уведомление: `Запись прогона не сохранена в папку: <причина>`. Причина `none` (папка не выбрана) — молча;
   - вернуть результат `saveRun`.
   Функция не бросает исключений.
3. **Вызовы.** Вызови `await autosaveRun()` сразу после `await saveRecord(true)` на успешном пути (после строки 7921, до `markStaleBasicCards`) и на пути ошибки (после строки 7951). Результат сохрани в переменную верхнего уровня `lastBasicAutosave` рядом с `latestBasicRunRecord` (строка 2770): он понадобится заданию T08.
4. Прогон, остановленный User, проходит по успешному пути и записывается так же: в цепочку идёт каждый прогон, а не только удачный.

## Чего не делать

- Не запрашивай доступ к папке без клика User: только `ensureAccess({ request: false })` внутри `saveRun`.
- Не меняй скачивание по кнопке; в файле только добавляется поле `taskSections`.
- С этого задания в выбранную папку документов пишется каждый прогон, а в её корень — `chain.txt`. Раньше туда попадали только документы. Скажи об этом в документах.
- Не записывай прогон чаще одного раза: только после окончательного сохранения записи.

## Проверка

- `tests/custom-run-resume-wiring.test.js` проверяет связи в `results.js` по тексту файла. Добавь по тому же образцу: `buildBasicReportNow` используется и кнопкой, и `autosaveRun`; `autosaveRun` вызывается после обоих `saveRecord(true)`; в `pipeline_panel.html` модуль `basic-run-chain.js` стоит раньше `results.js`.
- `tests/results-debate-favorites.test.js` (страница целиком): прогон с фейковой папкой документов оставляет файл `run_<runId>.json` и строку в `chain.txt`; четвёртое поле строки равно SHA-256 текста файла, посчитанному через `require('crypto')`; в файле `executionActive` равно `false`; прогон без папки завершается как раньше, без уведомления.

## Документы

- `docs/Pipeline scenarios/basic-developer.md`: в таблице «results.js: области и функции» — `buildBasicReportNow`, `autosaveRun`, `lastBasicAutosave`; в разделе 3 — новый подраздел «Запись прогона на диск и цепочка»: где лежит файл прогона, где `chain.txt`, формат строки, что происходит без доступа.
- `docs/Pipeline scenarios/basic-start-here.md`, раздел «Что видит пользователь в конце прогона»: строка ленты о записи прогона.
- `docs/Researcher v.2.0/operations/02-runbook.md`, §3: строку цепочки после прогона дописывает расширение, если папка документов — папка `journal` задачи; команды остаются для событий без выгрузки. `docs/Researcher v.2.0/process/04-endless-mode.md`, §5, пункт 8: «сделано».

## Готово, когда

Прогон с выбранной папкой документов оставляет файл и строку цепочки без действий User; прогон без выбранной папки проходит без записи и без уведомления.
