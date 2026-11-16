# T03 · Запись прогона на диск в конце каждого прогона

Ты — исполнитель кода расширения AutoOrchestr. Твоя задача — сделать так, чтобы в конце каждого прогона Basic его выгрузка сама записывалась в папку документов, а в цепочку добавлялась строка.

Сначала выполни «Общие правила» из `docs/Pipeline scenarios/basic-run-automation/README.md`. Задания T01 и T02 должны быть сделаны: проверь, что есть `window.BasicTelemetry.buildUsage` и `window.BasicRunChain.saveRun`.

## Что есть сейчас

Всё в `results.js`.

- Выгрузку собирает обработчик кнопки `#disput-basic` (строки 17886–17926): берёт запись прогона, журнал доставки и события, вызывает `window.BasicTelemetry.buildReport` (строка 17916) и скачивает файл.
- Прогон ведёт `runCustomFromPage` (строка 7214). Запись прогона — переменная `record`; её окончательное сохранение — `await saveRecord(true)` на успешном пути (строка 7833) и на пути ошибки (строка 7863).
- Копию документа в папку пишет `saveDocumentCopy` (строка 7035) через `window.DocumentsFolder.instance`. Доступ к папке запрашивается только по клику User: `requestDocumentsAccess` (строка 7023).
- Строку в ленту прогона добавляет `appendBasicRunLine` (строка 7116).

## Что сделать

1. **Общая сборка выгрузки.** Вынеси из обработчика кнопки сборку отчёта в функцию `buildBasicReportNow({ record = null })` рядом с `readLatestCustomRun` (строка 17871), на том же уровне вложенности. Она возвращает отчёт или `null`, если записи нет. Перед возвратом добавляет поле `taskSections`: `await window.BasicRunChain.taskSections(report.customRun.task)`. Обработчик кнопки вызывает её и скачивает результат; его поведение не меняется.
2. **Запись в конце прогона.** В `runCustomFromPage` добавь функцию `autosaveRun()`:
   - если `window.BasicRunChain` или `window.DocumentsFolder?.instance` нет — вернуть `{ ok: false, reason: 'none' }`;
   - собрать отчёт через `buildBasicReportNow({ record })`;
   - вызвать `window.BasicRunChain.saveRun({ folder: window.DocumentsFolder.instance, report, pipeline: customPipelineName(), startedAt: runContext.startedAt, at: new Date().toISOString() })`;
   - успех — строка в ленту: `Запись прогона: <путь> · строка цепочки <номер>`;
   - неудача с причиной `denied` или `error` — одно уведомление: `Запись прогона не сохранена в папку: <причина>`. Причина `none` (папка не выбрана) — молча;
   - вернуть результат `saveRun`.
   Функция не бросает исключений.
3. **Вызовы.** Вызови `await autosaveRun()` сразу после `await saveRecord(true)` на успешном пути (после строки 7833, до `markStaleBasicCards`) и на пути ошибки (после строки 7863). Результат сохрани в переменную верхнего уровня `lastBasicAutosave` рядом с `latestBasicRunRecord` (строка 2770): он понадобится заданию T08.
4. Прогон, остановленный User, проходит по успешному пути и записывается так же: в цепочку идёт каждый прогон, а не только удачный.

## Чего не делать

- Не запрашивай доступ к папке без клика User: только `ensureAccess({ request: false })` внутри `saveRun`.
- Не меняй скачивание по кнопке и формат файла.
- Не записывай прогон чаще одного раза: только после окончательного сохранения записи.

## Проверка

- `tests/custom-run-resume-wiring.test.js` проверяет связи в `results.js` по тексту файла. Добавь по тому же образцу: `buildBasicReportNow` используется и кнопкой, и `autosaveRun`; `autosaveRun` вызывается после обоих `saveRecord(true)`; в `pipeline_panel.html` модуль `basic-run-chain.js` стоит раньше `results.js`.
- `tests/results-debate-favorites.test.js` (страница целиком): прогон с фейковой папкой документов оставляет `run.json` и строку в `chain.txt`; прогон без папки завершается как раньше, без уведомления.

## Документы

- `docs/Pipeline scenarios/basic-developer.md`: в таблице «results.js: области и функции» — `buildBasicReportNow`, `autosaveRun`, `lastBasicAutosave`; в разделе 3 — новый подраздел «Запись прогона на диск и цепочка»: где лежит `run.json`, где `chain.txt`, формат строки, что происходит без доступа.
- `docs/Pipeline scenarios/basic-start-here.md`, раздел «Что видит пользователь в конце прогона»: строка ленты о записи прогона.
- `docs/Researcher v.2.0/operations/02-runbook.md`, §3: строку цепочки после прогона дописывает расширение, если папка документов — папка `journal` задачи; команды остаются для событий без выгрузки. `docs/Researcher v.2.0/process/04-endless-mode.md`, §5, пункт 8: «сделано».

## Готово, когда

Прогон с выбранной папкой документов оставляет файл и строку цепочки без действий User; `shasum -a 256` от записанного файла равен четвёртому полю строки; прогон без папки не изменился.
