# Basic: разработчику

Входные файлы любого участника (📎, поле `files`, доставка и продолжение): [описание](basic-input-files.md).

Для того, кто меняет код Basic, разбирает сбой или хочет знать, что не доделано. Что такое Basic и как идёт прогон — в `basic-start-here.md` (здесь не повторяется). Как написать схему — `basic-schema-guide.md`. Окна настроек — `basic-windows.md`.

Разделы: 1. Код; 2. Правила схемы и решения; 3. Сохранение, Export, Import и хранение; 4. Диагностика; 5. Открытые вопросы и известные падения тестов.

Формат 2 (`schemaVersion: 2`) вводит постоянные ID участников, подписи `label` и режим пустых персональных настроек `settingsMode: "explicit"`; формат 1 остаётся совместимым. Один provider name может встречаться несколько раз в раунде, но запросы идут последовательно по ID. URL конкретного чата хранится в записи прогона и восстанавливается только при совпадении с проверенной вкладкой; схема не хранит URL.

Перед запуском Basic схема с непустыми персональными `request` у моделей показывает собранные запросы и предупреждения в окне подтверждения. Ответы из ещё не выполненных шагов обозначены заглушками. «Продолжить запуск» отправляет прогон в обычный путь; «Отмена» закрывает окно без запуска. Схемы без персональных запросов запускаются без этого окна.

### Передача артефактов по истории чата

**Согласованное правило, автоматизация ещё не реализована.** Одну версию артефакта передают файлом или текстом один раз в каждый чат. Дальнейшие этапы ссылаются на название и версию; собственный документ автора уже есть в истории. Другой участник и `chat: "new"` требуют первой передачи заново; новая версия, в том числе правка User, считается отдельно. Правило для автора схемы — [basic-schema-guide.md, §5.7.1](basic-schema-guide.md#571-одна-версия-артефакта--одна-передача-в-каждый-чат).

Сейчас `artifactItems` извлекает текст, а `buildPrompt` снова вставляет его при каждой ссылке; память доставленных входных файлов в `disput/basic-file-delivery.js` этого не исправляет. `revisionOf` проверяется через наличие артефакта во входе, поэтому убрать эту ссылку из существующей исполняемой схемы пока нельзя. Холст показывает явные входные связи без учёта истории. До изменения кода автор схемы исключает повторы личным `input` и явным `none`, сохраняя обязательный вход `revisionOf`.

Необходимые изменения кода:

- **Сборка и отправка:** `disput/custom-engine.js` (`artifactItems`, `inputFor`, `buildPrompt`) и транспорт участников в `results.js`. Сохранять доступ к версии как зависимости, но физически передавать только отсутствующий в чате документ; для знакомой версии давать ссылку по названию и версии. Учитывать фактическую историю конкретного чата и собственные документы автора; новая роль не сбрасывает историю. Проверять также `previous`, `all` и ссылки на целые ответы, чтобы ими нельзя было повторно передать тот же документ.
- **Подтверждение и продолжение:** привязки чатов в `results.js`, снимок движка и `disput/custom-run-record.js`. Запоминать версию после подтверждённой передачи, независимо от приёмки ответа; ошибка отправки не подтверждает передачу. Сохранять это состояние при паузах, исправлениях и продолжении; новый чат не наследует его.
- **Версии и проверка схемы:** `disput/basic-schema.js`, `disput/custom-engine.js`, `disput/basic-artifacts.js`. Сохранить `required`, происхождение и связь `revisionOf` с точной полученной версией, не требуя повторной вставки содержимого. Существующие схемы должны оставаться исполняемыми; новые JSON-поля для ссылки на историю не нужны.
- **Линии холста:** `results/basic-input-canvas.js` и построение связей в `results.js`. Линия передачи ведёт к первому этапу, которому версия нужна в данном чате; дальнейшее использование остаётся ссылкой в задании. Разные участники одного раунда могут иметь разную историю: общий вход не означает необходимость повторной передачи каждому.

Проверки после реализации: повторное использование и собственный документ в том же чате; разные участники одного провайдера; `chat: "new"`; новая версия от модели и User; смешанная история участников раунда; `revisionOf`; неудачная и неизвестная доставка; исправление и продолжение прогона; отсутствие повторных линий. Открытая задача — **ART-1** в [едином реестре](../Agents/basic-issues-registry.md).

## 1. Код

Холст (2.81.953): `updatePipelineLayout` измеряет суммарную высоту карточек, задаёт всем `.model-stack` общую высоту и центрирует группы через CSS. Стрелки строятся по итоговым координатам карточек. `results/basic-input-canvas.js` размещает артефакты в общей нижней строке этапа (`.basic-input-canvas-layer`), сохраняя адреса артефактов и обработчики рамок документов. Удержание карточки 550 мс в `results.js` показывает кнопки участников «+»/«×»; обычный клик и hover их не показывают.

С 2.81.954 `syncDocumentFrames` при самостоятельном обновлении записи прогона сразу синхронизирует строку артефактов и SVG: удалённая кнопка документа не остаётся источником линии. Пунктир рисуется только от объявленных артефактов с учётом персонального `input` потребителя; ссылки на этапы/участников раскрываются в их выходные артефакты. Линии выходят из середины правого края артефакта и приходят в середину всего видимого общего пролёта входящего коннектора этапа. Точка `[data-artifact-junction]` вычисляется в `drawInputSplitConnector`/`drawMergeSplitConnector` по полной длине пролёта между слиянием/разветвлением или краем одиночной карточки; отдельные линии к моделям не рисуются. Встречные блоки артефактов обходятся сверху. Связи одного артефакта с одним этапом объединяются, даже если вход используют несколько его моделей. Удалённые элементы DOM не используются при перерисовке.

Интеграционная фикстура страницы подключает `results/basic-input-canvas.js` перед `results.js`, как настоящий `pipeline_panel.html`: без этого проверки восстановления рамок не охватывают слой артефактов и его SVG.

Карточка неполного ответа показывает `uncompleted` с оранжевым закруглённым контуром в существующей строке заголовка. Отдельная строка «Без метки доставки» не выводится; оранжевая линия слева и состояние подтверждения ответа сохраняются.

Проверка перед запуском на главной странице согласует кнопку с `GET_ACTIVE_RUN_STATE`: если её запрос ещё активен, восстанавливается «Стоп» и новый запуск не выполняется до остановки. Для старых сессий без `sourceView` фон определяет User по `pipelineRunId`: Pipeline при наличии идентификатора, иначе главная страница. Активный запрос другой страницы сохраняет блокировку запуска.

Готовность страницы перед отправкой проверяет `prepareReusableTabReceiver` в `background/dispatch-coordinator.js`. Завершённая проверка без ответа означает отсутствие обработчика модели: уже загруженная страница перезагружается один раз по текущему адресу, загружающаяся ждёт подключения. Неответившая проверка и ответ другой модели не запускают перезагрузку; ожидание ограничено 20 секундами и отменяется при остановке запроса.

GPT подготавливает запрос через `ContentUtils.ensurePromptPrepared`: после вставки заново находит живое поле и перед Send сверяет полный текст. Неполная вставка не подтверждает отправку. Реестр `CompletionAuthorityRegistry` получает идентификатор новой попытки в `dispatchPromptToTab` до взаимодействия со страницей; поздняя регистрация старой попытки не заменяет текущую. `reportDispatchBaseline` передаёт наблюдателю `generationEpoch` явно, а приём ответа проверяет номер поколения, если он указан обеими сторонами.

Подтверждение Send у GPT учитывает новый ответ с `data-markdown-text-style="assistant-message"`, когда атрибуты роли отсутствуют. Ожидание перед запасным способом отправки не объявляется окончательной ошибкой. Grok сравнивает тело опубликованного запроса без скрытого заголовка «Ты» и кнопок, дожидаясь полного текста в пределах бюджета проверки. Если подтверждение отправки потерялось, ответ с завершающей меткой текущего запроса может восстановить подтверждение: проверяются dispatch, сессия и поколение; старый ответ, эхо запроса и одна метка не подходят. Результат ручного сбора проходит общую проверку метки и сохраняет её подтверждение после очистки текста. Проверка карточки сравнивает одинаковую текстовую проекцию предназначенного для неё HTML и фактического содержимого, отдельно от отпечатка исходного ответа.

`PipelineFSM.compactJobStateForStorage` сохраняет полный сериализованный пакет вложений вместе с `base64`: метаданные без содержимого не пригодны для продолжения прогона после восстановления MV3. Перед запросом с вложениями `ensureAttachmentHandlerForDispatch` восстанавливает `AttachmentHandler` во вкладке; ошибка или тайм-аут блокируют команду. Адаптеры читают обработчик при прикреплении. GPT требует подтверждения всего пакета и не использует локальный paste/drop без наблюдения. Обработчик и MAIN bridge выбирают файловое поле, принимающее типы и количество всех файлов; пакет с невосстановленным файлом отклоняется целиком. Для пакета из нескольких файлов счётчик общих DOM-узлов не доказывает полноту: требуется наблюдение каждого имени. Журнал содержит `attachmentCount` при старте отправки и этап `attachment_upload_completed` с числом файлов.

Имена превью изображений читаются также из `img.alt`; один элемент с несколькими атрибутами не доказывает несколько файлов. Если после доставки появились имена, узлы вложений или индикатор загрузки, оставшийся бюджет расходуется только на наблюдение, без повторного прикрепления через запасной способ. Неподтверждённый принятый пакет запоминается во вкладке по модели, прогону и содержимому файлов: повторная отправка в том же прогоне продолжает наблюдение от исходного состояния. Неполный пакет не разрешает вставку текста; новый прогон или другой пакет начинает независимую загрузку.

### Файлы Basic

| Файл | Символы | Что там |
| --- | --- | --- |
| `disput/custom-engine.js` | `CustomEngine`, `run`, `attempt`, `normalizeSteps`, `buildPrompt`, `previewPrompt`, `requestDiagnostics`, `correctionPrompt`, `inputFor`, `judge`, `resolveSetting`, `STOP_TEXT`, `REASON_TEXT`, `DEFAULT_ATTEMPTS`, `EngineError`, `unexecutedOf`, `findStopMark`, `assertExecutable`, `sourceItems`, `sendParticipants`, `artifactItems`, `contentOf`, `revisionItem`, `documentFor` | Движок: шаги, запросы, приём, повторы, пауза; диагностика личного запроса; документ для User (`documentFor`), метки документа в запросе (`formatBlock`), версии и утверждение (`ownerAnswer`); `invalid_document`, если текста документа нет в записи прогона; причина `invalid_form` (`REASON_TEXT`) |
| `disput/basic-schema.js` | `BasicSchema`, `DEFAULTS`, `validate`, `assemble`, `resolveFields`, `resolveRun`, `toSettings`, `toCanvas`, `warnings`, `describeErrors`, `checkControl`, `checkOutput`, `assembleControl` | Формат схемы: умолчания, проверка (в том числе запросов модели: при возможном входе обязателен `{вход}`; первый шаг по умолчанию без входа; выключенные модели не считаются источниками), виды шага `round` и `owner`; шаги идут по порядку; `synthesis`, `gate` и `route` отклоняются, синтез — раунд из одной модели с ролью; поля `require` и `order` отклоняются с подсказкой: раунд ждёт ответов всех своих моделей, эстафета — раунды по одной модели подряд), сборка шагов, показ на холсте; замечания без блокировки (`warnings`: личное задание при общем, непрочитанный ответ User, заглушка), их окно показывается после установки схемы; `document` шага User и `output.document` раунда (`checkControl`, `checkOutput`, `assembleControl`) |
| `content-scripts/platform-mode-setter.js` | `PlatformModeSetter`, `ensure` | Режимы сайтов моделей перед отправкой участнику; вызов — `ensurePlatformModeForDispatch` в `background/dispatch-coordinator.js`, список режимов — `docs/Run Automation/model-modes.md` |
| `disput/basic-artifacts.js` | `BasicArtifacts`, `createRegistry`, `register`, `latest`, `version`, `lineKey`, `finalDocuments` | Реестр артефактов прогона: одна запись на версию, ссылка на ответ и указатель, без копии текста (чистые функции); последняя версия каждого документа для копии на диске |
| `disput/basic-output.js` | `BasicOutput`, `checkAnswer`, `readPointer`, `parseJsonAnswer`, `countWords`, `formProblem`, `extractDocument`, `stripDocumentMarks` | Документ между метками `[[DOC: id]]` (`extractDocument`); проверка ответа по выходу шага: длина, JSON и поля, опросник (`formProblem`), разделы, артефакты (чистые функции; вызывает движок) |
| `disput/local-rules.js` | `LocalRules`, `classify`, `classifyText` | Правила уровня 0 при наблюдении за вкладкой: по окнам и тексту после последней метки дают ситуацию без модели; `unknown` и `null` — правила молчат, решает модель. Порт `rules2.py`, Unicode-классы вместо `\b`/`\w`. Эталон — `tests/fixtures/local-rules-parity.json` (225 случаев). |
| `disput/local-model.js` | `LocalModel`, `FEATURES`, `pageFeatures`, `feature`, `applyPreset`, `presetOf`, `ownerHint`, `suggest`, `parseReply`, `reviewReply`, `buildPrompt`, `buildRequest`, `hintLine`, `allowOwnOrigin`, `observeTab`, `createStallWatch`, `checkObservation`, `buildObservationRequest`, `observationLine`, `SITUATIONS`, `ANSWER_LABELS`, `buildAnswerLabelRequest`, `checkAnswerLabel`, `labelAnswer`, `answerLabelLine`, `loadState`, `updateState`, `addLog`, `contextOf` | Подсказка локальной модели (Ollama) в окне «Ответ User»: можно принимать или вернуть на доработку, с дословной цитатой. На ход прогона не влияет. Инструкция, файлы, журнал и чат вкладки Local LLM лежат в `chrome.storage.local`, ключ `localModelState`. Правило `declarativeNetRequest` подставляет Origin только запросам этого расширения: Ollama отклоняет `chrome-extension://`. |
| `results/local-llm-tab.js` | `LocalLlmTab`, `mount` | Вкладка Local LLM окна телеметрии: системная инструкция, файлы, Log, чат. |
| `results/local-model-features.js` | `LocalModelFeatures`, `mount` | Кнопка выбранной локальной модели и окно её функций (режимы и чекбоксы) — на панели pipeline и на главной странице; окно показывает функции своей страницы (`data-page`). |
| `shared/secret-check.js` | `SecretCheck`, `find` | Проверка текста запроса главной перед отправкой: ключи API, токены, приватный ключ, номер карты (Луна). Возвращает только названия найденного, без значений; без модели. В `results.js` при находке — `window.confirm`. На панели pipeline не подключена. |
| `results/local-model-main.js` | `LocalModelMain`, `create` | Функции главной страницы `result_new.html`: наблюдение за вкладками моделей текущего запроса, строка разбора и метка ответа в карточке модели. Только читает вкладки и ответы. На панели pipeline не загружается. |
| `disput/basic-spec.js` | `BasicSpec`, `build`, `toMarkdown` | Описание pipeline «для человека» по схеме: три слоя (pipeline в целом, схема процесса, этапы), поля автора и автоматические поля, `missing` для незаполненного; чистые функции, без DOM (окно спецификации подключит их отдельно) |
| `disput/custom-run-record.js` | `CustomRunRecord`, `createRun`, `recordAttempt`, `attemptKey`, `finishRun`, `serialize`, `revive`, `textOf`, `setSnapshot`, `setArtifacts`, `canResume`, `exportRun`, `createStore` | Запись о прогоне (версия 2: реестр артефактов и снимок состояния; тексты документов лежат в ней же) |
| `disput/basic-run-chain.js` | `BasicRunChain`, `sha256Hex`, `sectionsOf`, `taskSections`, `chainLine`, `lastLine`, `append`, `verify`, `saveRun` | Цепочка прогонов: SHA-256 текста (`sha256Hex`), разделы задачи по строкам `=== НАЗВАНИЕ ===` (`sectionsOf`, `taskSections`), строка `chain.txt` из пяти полей (`chainLine`, `append`, `lastLine`), проверка цепочки (`verify`), запись прогона в папку документов и строка цепочки (`saveRun`); без DOM |
| `disput/basic-repeat.js` | `BasicRepeat`, `splitTask`, `fillCounters`, `taskForPass`, `carriedText`, `decide`, `REASON_TEXT` | Повтор схемы (T07): деление задачи по строке-маркеру, счётчики `{заход}`/`{заход+N}`/`{осталось запросов}`, документ следующего захода, решение о продолжении; без страницы |
| `disput/schema-text-reader.js` | `SchemaTextReader`, `read` | Терпимое чтение текста ответа модели для окна «Вставить схему»: ограда ```json, хвостовые запятые, комментарии, ключи без кавычек, типографские кавычки; первое JSON-значение; текст вне JSON — комментарий модели; оборванный ответ не применяется |
| `results/stage-card.js` | `StageCard`, `buildModel`, `render`, `renderOwnerWindow`, `renderAddControl`, `ownerWindowModel`, `ownerAfterEdit` | Окно настроек раунда, окно шага User (список «Документ для User»), выбор «Шаг после этого этапа» (только User) |
| `results/choice-dialog.js` | `ChoiceDialog`, `formAsks`, `formAnswer` | Окна решений; окно User с документом: параметры `document`, `answerFormat`, `textInput.required`; режимы документа `editable` (правка и утверждение), `readOnly` (просмотр из рамки); опросник |
| `results/owner-ask.js` | `answersOf`, `formAsks`, `formAnswer` | Окно ответа User: показ документа и опросника, ответ User (текст или JSON) |
| `results/documents-folder.js` | `DocumentsFolder`, `sanitizeName`, `stamp`, `runDirs`, `relativePath`, `create`, `instance`, `readAt`, `writeAt` | Копия документа на диске: выбор папки (File System Access), дескриптор в IndexedDB (база `AutoOrchestrDocumentsFolder`), очистка имени, путь `<папка>/<pipeline>/<прогон>/<имя>`, доступ и запись (`ensureAccess`, `write`, `folderName`, `pick`); чтение и запись файла по пути без «(2)» (`readAt` не создаёт папок, `writeAt` перезаписывает), папки прогона (`runDirs`) |
| `disput/pipeline-presets.js` | `BUILTIN_PIPELINE_DEFINITIONS`, `PIPELINE_PRESETS`, `makePreset` | Шаблон Basic и пресет `CUSTOM` |
| `disput/debate-draft-plan.js` | `createCanvasPlan`, `normalize` | План холста: только раунды; `normalize` читает и прежние планы со стадиями синтеза |
| `disput/debate-response-acceptance.js` | `evaluate` | Техническая приёмка ответа. Статусы `EXTRACT_FAILED`, `FAILED`, `UNCERTAIN`, `INTERRUPTED`, `TIMEOUT`, `NO_SEND` без `completion: complete` не принимаются (причина `unproven_status`, текст «не подтверждено окончание: статус …»); `PARTIAL` без подтверждения — `partial_unproven`; `reason: progress_only` из слоя доставки (метка после строки прогресса) — `progress_only`; `reason: capped_unproven` (предел ожидания без метки доставки) — `capped_unproven`; `SUCCESS` и подтверждённое окончание принимаются как раньше, кроме короткого текста (короче 150 символов): строка прогресса («Проверил и уточнил…») отклоняется `too_short` даже при `completion: complete`; без подтверждения окончания короткий текст без знака конца или вердикта тоже `too_short` (`isProgressLine`, `isMeaningfulShort` из `shared/answer-content-classifier.js`) |
| `shared/message-delivery.js` | `batchEvent` | Журнал доставки |
| `shared/basic-telemetry.js` | `buildReport`, `buildUsage` | JSON кнопки Basic: запись прогона, сводка шагов `rounds`, сводка расхода `usage` (запросы, попытки, участники, ожидание User, символы, по моделям; шаг User в запросы не входит), журнал и вердикт доставки, события моделей этого прогона |
| `styles/pipeline.css` | — | Рамка документа на холсте (`.pipeline-doc-frame`) |
| `manifest.json` | — | Разрешения расширения; для документов дополнительных разрешений нет (документы в записи прогона) |
| `pipeline/pipeline-runtime.js` | `MODELS` | Список моделей холста |

Страница перед запуском проверяет, что загружены `DebateResponseAcceptance` и `DebateStageMarkers` (приём ответа и разбор `[[ASK]]`): без них прогон не стартует, уведомление «Basic: не загружены модули приёма ответов…» (раньше приём молча считался успешным). Инструкция `discipline.ask` модели считается одной функцией (`askOf`) для запроса, показа частей и превью. `BasicSchema.validate` заранее отклоняет личный `request` без `{вход}`, если эффективный вход модели может получить ответы более раннего шага; учитываются `model.input`, вход шага, умолчание `none` у первого шага, выключенные модели и явные источники. `CustomEngine.requestDiagnostics` отдаёт предупреждения для UI: нет `{задача}` или личный запрос не использует явно заданные роль/задание. Перед отправкой движок повторяет проверку по фактическому непустому входу.

Реестр артефактов: `result.artifacts` (записи реестра), тексты: callbacks `putText(text) → ref` и `getText(ref) → text` (страница передаёт их записи прогона; без них движок хранит тексты в `result.texts`). Запись о прогоне (`CustomRunRecord`, версия 2) хранит реестр в `record.artifacts`.

Транспорт участников: `sendParticipants(requests, meta)` получает `requests` — `[{ participantId, modelName, prompt, chat, stepRef, visit, attempt }]`, `meta` — `{ step, kind, label, attempt, maxWordsByParticipant, correctionByParticipant }`, и возвращает `{ byParticipant: { [participantId]: ответ }, closedByOwner }`; ответ — `{ text, status, completion, answered, transportRequestId, sentPrompt, attribution }`. Без него движок вызывает `send(models, promptsByModel, meta)` и требует уникальные имена моделей в шаге. Страница передаёт `sendParticipants` (`results.js`, `runCustomFromPage`): запросы делятся на волны (k-й запрос модели идёт в волну k, волны идут одна за другой), поэтому два участника одной модели — две вкладки, используемые по очереди; внутри волны у модели один запрос. Фон ведёт чат каждого участника по паре run ID + `participantId`: `background/job-orchestrator.js`, `runParticipantThroughTabs` вызывает `openParticipantChat` (`background/tab-manager.js`), привязки хранятся в `llmParticipantTabMap` (`chrome.storage.local`, вид `{ [runId]: { [participantId]: { modelName, tabId, requestId, stageAttemptId } } }`). Привязка записывается до отправки; если её записать нельзя, запрос не отправляется (`participant_binding_failed`). `llmTabMap` остаётся по имени модели и указывает на вкладку участника активной волны. Поле `pipelineContext.participants` = `{ [modelName]: { participantId, newChat, binding? } }`, где `binding` (`{ tabId, requestId, stageAttemptId }`) — чат участника из снимка прогона, страница передаёт его при продолжении (R01); провайдер в `START_FULLPAGE_PROCESS` — по-прежнему имя модели. `chat: "new"` — новая вкладка при первой попытке захода, исправления идут в неё же. Продолжение (не `new`) идёт только в чат, привязанный к этому участнику в этом прогоне. Если привязанный чат закрыт, не готов или открыт не на сайте провайдера, запрос останавливается до отправки с кодом `participant_chat_lost` (в `meta`: `participantId`, `runId`, `tabId`, `reason`), модель получает статус `USER_ACTION_REQUIRED`; чужая вкладка и новый чат не выбираются. Первый запрос участника без привязки берёт чат провайдера, не привязанный ни к одному участнику, или открывает новый. Заход `new` открывает чат один раз; повтор того же захода (тот же `stageAttemptId`) идёт в тот же чат. Отмена прогона (`cancel_pipeline_run`) удаляет его привязки, при старте нового прогона удаляются привязки всех прежних прогонов, обновление расширения очищает `llmParticipantTabMap` (ключ в `EXTENSION_VOLATILE_LOCAL_KEYS`). Страница после каждой волны читает фактические привязки своего прогона (сообщение `PARTICIPANT_CHAT_BINDINGS` → `{ bindings: { [participantId]: { modelName, tabId, requestId, stageAttemptId } } }`) и пишет их в `state.chatBindings` снимка до следующей отправки. При продолжении прогона после отмены или обновления расширения фон берёт сохранённый чат из `binding`, только если у его прогона нет собственной привязки этого участника и заход не `new`; сохранённая вкладка проверяется как обычная привязка. Если её нет или она не подходит, запрос останавливается с `participant_chat_lost` до отправки, без подмены и без нового чата. Участники не идут через stateless API: если API-режим включён для модели (флаг API-транспорта, есть API-конфигурация и `useApiFallback`), запрос участника отклоняется до отправки кодом `participant_api_unsupported`, режим пользователя не меняется. Вложения подтверждаются по чату участника (R05), а не по `participantId` на весь прогон. Страница хранит в `state.chatBindings` `chatVisit` (заход, открывший чат) и `attachedChatVisit` (заход, чей чат подтвердил файлы: ответ пришёл со статусом `SUCCESS`). Новый чат (`new` на первой попытке захода) получает вложения всегда; повтор и исправление в том же чате, а также продолжение чата с подтверждёнными файлами их не повторяют. Ошибка доставки файлов не помечает их приложенными, поэтому следующий запрос в тот же чат отправит их снова. Волна, в которой одни участники получают файлы, а другие нет, делится на две под-волны (ключи `N f` и `N p` в `stageAttemptId`), поэтому чужие файлы никому не уходят. При продолжении прогона файлы берутся из `record.attachments` записи, а не из composer страницы; запись сохраняет вложения нового прогона (`setAttachments`, до 1,5 МБ); не поместившиеся помечаются `attachmentsStored: false`, и такой прогон не продолжается. Привязки чатов — `state.chatBindings` (`participantId → { modelName, stepRef, visit, transportRequestId, chatUrl, initialUrl }`); они входят в снимок и восстанавливаются по точному URL.

Локальный участник «Qwen 4B» (`disput/local-model.js`, `LocalModel`): это обычный выбор на холсте (кнопка в шапке `pipeline_panel.html`), движок и формат схемы те же. Развилка одна — `sendGroup` в `runCustomFromPage` (`results.js`): запросы группы к «Qwen 4B» идут в Ollama по HTTP (`http://127.0.0.1:11434/api/chat`, модель — выбранная в списке «Local model»), остальные — как раньше, `sendWave`, через вкладки; обе части идут одновременно. Заголовок `Origin` для Ollama задаёт правило `declarativeNetRequest` (`allowOwnOrigin`). Вызов: `think: false`, `temperature` 0.2, `keep_alive` 15m, `num_ctx` 16384 (фиксирован в коде), `num_predict` = слова шага × 4 + 256 (слова и токены — разные величины), `format` не задаётся (в схеме шага нет JSON-схемы выхода; только `requiredFields`). Ответ принимается по `done_reason` Ollama: `stop` — `SUCCESS`/`complete`; `length` и любое другое — `PARTIAL`/`partial` с причиной `length` (приёмка отправляет такой ответ на исправление, не принимает); пустой текст — `FAILED`. Метка доставки в запрос модели не попадает: `MessageDelivery.prepare` регистрирует её для журнала, а в хвост ответа её дописывает транспорт только после непустого завершённого (`stop`) ответа, затем `MessageDelivery.receive` её снимает. Тайминги Ollama (`load_duration`, `prompt_eval_count`, `eval_count`, `total_duration`) и `done_reason` пишутся в событие журнала `local_model_call`. История участника (`participantId`) хранится в странице на время прогона и целиком уходит в каждый вызов; `<think>`-блоки в историю и в ответ не попадают; `chat: "new"` её сбрасывает. Предел запроса: вход + история + `num_predict` при двух буквах на токен должны уместиться в `num_ctx`; иначе до отправки — уведомление и штатная остановка `context_full`, без обрезки. Доступность: если в схеме есть «Qwen 4B», перед стартом проверяется выбор в списке «Local model» (выбрано «without LLM» — прогон не начинается, уведомление просит выбрать модель), затем `LocalModel.ping` (он же прогрев) — Ollama не отвечает, прогон не начинается и уведомление об этом выводится; отказ посреди прогона — ответ `NO_SEND` (`not_sent`, причина «локальная модель недоступна»), дальше обычные повтор и окно решения User. Stop разрывает `fetch` (`AbortController`). Ограничения: после перезагрузки страницы история участника не восстанавливается — продолжение чата участника, который уже отвечал, отклоняется до отправки как `participant_chat_lost` (`USER_ACTION_REQUIRED`), новый чат (`chat: "new"`) работает; входные файлы «Qwen 4B» не получает (файлы шага или участника — прогон не начинается; общие вложения прогона ему не передаются); проверка живьём с реальной Ollama не проводилась. Список «Local model» в шапке один на всё: «without LLM» — локальной модели нет (ни участника, ни подсказок, Basic работает как раньше); 4B или 9B — эта модель работает и у участника, и в подсказках.

Функции локальной модели (`LocalModel.FEATURES`): у каждой поля `id`, `page` (`pipeline` или `main`), `label`, `group`, `level`, `defaultOn`. На панели pipeline три: `stall_watch` (наблюдение за зависшими вкладками, `createStallWatch`), `failure_look` (разбор вкладки без ответа, `observeTab` в `decide`), `owner_hint` (подсказка владельцу, `ownerHint`); все включены по умолчанию, функция, которой нужна более сильная модель, выключена по умолчанию. `results.js` спрашивает `LocalModel.feature(id)`: `true`, только если выбрана модель и у неё включён чекбокс функции; неизвестный `id` и «without LLM» дают `false`. Проверка перед стартом участника «Qwen 4B» остаётся на `enabled()`. Главная страница: `main_stall_watch`, `main_failure_look` и `main_answer_label` (`results/local-model-main.js`). `main_answer_label`: на финальный ответ с текстом модель ставит метку (`ok`, `refusal`, `cut_off`, `off_topic`, `unclear`) с цитатой; приложение проверяет только то, что цитата дословно есть в тексте ответа, смысл не оценивает; решает владелец. Метка один раз на модель за запрос (`labelAnswer`, приоритет `owner_hint`), строка `.local-model-look`. Счётчик запросов растёт при `begin` и `stop`: поздний результат метки или разбора прошлого запроса не показывается. Модель общая для обеих страниц (ключ `localModelChoice`), чекбоксы у страниц свои; `applyPreset(level, model, page)` и `presetOf(model, page)` считают только функции этой страницы. Главная смотрит модели текущего запроса (`replaceCurrentMainRequestIds` → `LocalModelMain.begin`). Ошибка — терминальный статус из `LLMStatusContract.FAILURE_STATUSES` (ERROR, STREAM_TIMEOUT, NO_SEND, EXTRACT_FAILED, USER_ACTION_REQUIRED и др.; RECOVERABLE_ERROR не считается) или финальный ответ без текста. Вкладку (`tabId`) берём из `GLOBAL_STATE_BROADCAST` (`state.llms[имя].tabId`, `state.tabs.map`), нового сообщения в фоне нет. Вкладка смотрится один раз за запрос, строка стоит в `.llm-header` карточки и уходит при новом запросе или очистке карточки; успешный статус её не снимает. Чекбоксы хранятся отдельно для каждой модели в `chrome.storage.local`, ключ `localModelFeatures` = `{ [modelId]: { [featureId]: boolean } }`; нет записи — `defaultOn`. Уровни: `log` (Light), `hint` (Middle), `heavy` (High), `act` (Extra High). `applyPreset(level, model, page)` включает функции этого уровня и ниже, остальные выключает; режим не хранится, `presetOf(model, page)` вычисляет его по чекбоксам (`'custom'` — не совпало ни с одним). В окне видны только режимы, у которых есть функция своего уровня (сейчас Light и Middle). Кнопка с именем модели в шапке (`#local-model-button`) и окно `#local-model-modal` — `results/local-model-features.js`: кнопка скрыта при «without LLM», изменения в окне применяются сразу. Очередь: все запросы к Ollama идут через `post` по одному; первым участник раунда и `ping` (`participant`), затем подсказка владельцу (`owner_hint`), затем наблюдение (`observation`); внутри приоритета — по порядку прихода. Таймаут запроса отсчитывается с выхода из очереди; вызов с отменённым `signal` запроса не делает.

Все возможности локальной модели — что есть, что ждёт более сильных моделей и чего не делаем — `docs/Platform specifics/local-model.md`.

Проверка неизвестной попытки (N04, read-only): страница передаёт движку callback `checkUnknown({ participantId, modelName, transportRequestId, excludeText })` и возвращает `{ ok, status, text, reason, tabId }`. `status` — `found` (найден текст ответа, `ok: true`; его принятие проверяет движок), `no_answer` (в чате нет нового ответа), `ambiguous` (привязка чата не совпадает с сохранённой или чат перепривязан к другому запросу), `chat_unavailable` (вкладки нет, чат не сайт провайдера, чтение не удалось, сохранённой привязки нет). Фон: сообщение `CHECK_PARTICIPANT_ANSWER` (`pipelineRunId`, `modelName`, `participantId`, `transportRequestId`, `tabId`, `excludeText`) → `checkParticipantAnswer` (`background/tab-manager.js`). Проверка только читает одну вкладку (`chrome.scripting`, извлечение без изменения страницы); она не отправляет запрос, не привязывает и не выбирает чужую вкладку. Ошибка чтения — `chat_unavailable`, а не успех.

При восстановлении чата `chatBindings` содержит `chatUrl` и `initialUrl`: фоновый менеджер принимает только сохранённый URL переписки этого участника. Перенаправление, страница входа, новый чат или потерянная вкладка останавливают запрос до отправки. Это покрыто тестами `tab-manager-session-scope.test.js`; поведение конкретных сайтов нужно проверять отдельно в изолированном Chrome.

### results.js: области и функции

Все функции и константы находятся в `results.js`.

| Область | Символы | Что делает |
| --- | --- | --- |
| Схема со страницы | `basicSchemaFromPage`, `buildBasicRun`, `basicKeptRunFields`, `legacyValue`, `legacyDiscipline`, `customRoleText`, `customStepsFromPlan` | Собирает схему из страницы и переводит старые настройки в поля схемы |
| Запись и хранилище | `recordFromSchema`, `installBasicSchema`, `persistBasicSettings`, `persistPipelineStore`, `readPipelineStore`, `normalizePipelineStore`, `migrateBasicTemplateName`, `basicWorkingFromConfig`, `adoptBasicWorking`, `persistActiveDraftPlan` | Запись из схемы, установка схемы на холст, сохранение и чтение хранилища |
| Save, Export, Import | `savePipeline`, `buildBasicExport`, `exportBasicSchema`, `importBasicSchemaFile`, `importBasicBundle`, `handlePipelineImportFile`, `describeSchemaErrors`, `showSchemaErrors` | Сохранение записи, файл схемы, загрузка файла, сообщения об ошибках схемы, окно со списком ошибок |
| Явные значения и запуск | `basicRunForSave`, `markBasicRunExplicit`, `basicRunExplicit`, `basicSchemaLoadErrors` | Какие значения считаются явными и проверка перед запуском |
| Окна настроек | `renderCustomBlockInspector`, `openStageCard`, `setCustomRoundSetting`, `setCustomRoundPrompt`, `resolveCustomFields`, `customDisciplineDefaults` | Окно настроек модели, открытие окна раунда, значения раунда и модели |
| Сборка запроса | `composeCustomPrompts`, `prepareCustomPrompts`, `customLengthInstruction` | Дописывает особенность модели, инструкцию длины и требования к содержанию |
| Повтор схемы | `runBasicRepeat`, `basicRepeatStop`, `lastBasicAutosave`, `ownerWindow` (внутри `runBasicRepeat`) | Повтор `run.repeat` (T08): заход = `runCustomFromPage` с `forceNewTabs`; счёт запросов по `usage.requestsUpperBound` записи, верхний предел без неё; задача следующего захода (`BasicRepeat`); окно User раз в `ownerEvery`; Stop ставит `basicRepeatStop`; до первого запроса захода `customAbortController` уже создан (`runAbort` в `runCustomFromPage`), блокировка страницы `basicRepeatActive` ставится синхронно в начале повтора; состояние только в памяти страницы |
| Прогон | `runCustomFromPage`, `resumeCustomFromPage`, `builtFromRecord`, `basicRunNotice`, `startDebateFromPage`, `askCustomDecision`, `askCustomOwner`, `customRunProgress`, `isCustomEnginePipeline` | Запуск Basic со страницы, окна паузы и вопросов, состояние холста |
| Транспорт и карточки ответа | `runModelBatch`, `pipelineWaiter`, `updateDebateModelCardOutput` | Отправка запросов моделям, ожидание ответов, карточки ответа. Карточка Basic строится из `answerHtml` ответа, как карточка главной страницы; запись только текста не заменяет форматирование того же ответа (`BasicCardVerdict.keepsStructure`) |
| Выгрузка и запись прогона | `buildBasicReportNow`, `autosaveRun`, `lastBasicAutosave` | Отчёт прогона для кнопки Basic и для записи в папку документов (`buildBasicReportNow`); запись прогона в папку и строка цепочки после последнего сохранения записи (`autosaveRun`); результат последней записи (`lastBasicAutosave`) |
| Холст | `draftPlanForCanvas`, `applyPipelineConfig`, `syncPipelineRoundModelsFromSelectedLLMs`, `getActiveDraftPlan`, `syncCanvasTooltips`, `syncStepErrorBadges`, `setCanvasTooltip`, `applyCanvasArrows`, `ARROWS_HIDDEN_KEY` | План холста и применение конфигурации к холсту; подсказки с названием и описанием на элементах холста (через `ResultsTooltips`); кнопка «Стрелки» (класс `arrows-hidden`, `localStorage`); значок ошибок на шаге |
| Документы окна User | `syncDocumentFrames`, `restoreDocumentFrames`, `openDocumentFrame`, `removeLastRound` | Рамки документов на холсте (строятся из записи прогона, обновляются при сохранении состояния), открытие документа для чтения, восстановление при переключении схем в рабочей сессии, удаление последнего раунда со сбросом источника документа |

### Тесты

| Файл | Что проверяет |
| --- | --- |
| `tests/local-llm-tab.test.js` | Вкладка Local LLM: контекст, журнал сбоев, чат, файлы, четыре блока |
| `tests/local-model-answer-label.test.js` | Метка ответа: запрос, проверка цитаты, строка, вызов через `post` |
| `tests/secret-check.test.js` | Проверка секретов: шаблоны, Луна, ложные срабатывания, подключение |
| `tests/local-model-main.test.js` | Функции главной страницы: реестр по страницам, режимы страниц, окно каждой страницы, разбор ошибки/таймаута/пустого ответа, строка в карточке, выключенные функции, разметка и подключение |
| `tests/local-model-features.test.js` | Функции локальной модели: реестр, режимы, чекбоксы по моделям, очередь запросов (приоритет, один за раз, таймаут вне очереди, отмена), кнопка и окно |
| `tests/local-model.test.js` | Подсказка локальной модели: проверка цитаты, запрос, отключённый сервис, показ в окне выбора |
| `tests/local-rules.test.js` | Правила уровня 0: совпадение с эталоном `rules2.py` и смысловые случаи |
| `tests/custom-engine.test.js` | Движок: шаги, запросы, приём, повторы, бюджет, пауза, вопросы |
| `tests/custom-engine-flow.test.js` | Линейный прогон раундов и шага User; `gate` и `route` отклоняются до первого запроса |
| `tests/custom-engine-document.test.js` | Документ для User: чтение по меткам раунда с одной моделью, опросник, ссылка на документ, `invalid_form`, `invalid_document` до окна, пропущенный раунд-документ — `missing_input` |
| `tests/custom-engine-document-versions.test.js` | Документ с версиями: метки и `missing_artifact`, утверждение и новая версия, вход `latest`, продолжение, документ в `json`, отсутствие текста в записи прогона (`invalid_document`) |
| `tests/custom-run-record.test.js` | Запись о прогоне, хранение через адаптер `chrome.storage` (отказы), экспорт со всеми ссылками, состояние `not_sent` |
| `tests/custom-extract.test.js` | Разбор прогона Basic в `shared/report-digest.js` (CLI `scripts/summarize-report.js`); на вкладке Disput только экспорт Basic |
| `tests/basic-telemetry-rounds.test.js` | Сводка `rounds`: исход каждого участника, шаг User, ожидания, `delivery.diagnosis` |
| `tests/custom-engine-checkpoint.test.js` | Checkpoint: точки записи состояния, живое состояние, `checkpoint_failed`, автономный запуск без callback |
| `tests/custom-run-resume-wiring.test.js` | Привязка страницы к записи: callbacks текстов, checkpoint, очередь записи, «Продолжить прогон» (контракт в `results.js`, без браузера) |
| `tests/basic-participant-transport.test.js` | Участники в транспорте: волны, ответы по participantId, `chat`, привязки в снимке, фон не подменяет вкладку другого участника (контракт в коде, без браузера) |
| `tests/basic-participants-acceptance.test.js` | Совместимость v1/v2, пустые настройки и preview, волны одного провайдера, артефакты и URL чата в снимке |
| `tests/basic-participants-page.test.js` | Карточки и подписи участников, создание и повторное использование ID, round-trip схемы и блокировка удаления зависимого участника |
| `tests/tab-manager-session-scope.test.js` (блоки «participants» и «bound per run») | Чаты участников на моках `chrome.tabs`: привязка по run ID и participant ID, потерянный чат останавливает запрос без отправки, повтор захода в том же чате, отказ записи привязки |
| `tests/transport-participant-api.test.js` | Участник и API-режим: отказ `participant_api_unsupported` до отправки, запрос без участника идёт прежним API-путём; потерянный чат завершает модель явным статусом (vm-песочница оркестратора) |
| `tests/custom-engine-resume.test.js` | Продолжение из снимка: неизвестный запрос, пропуск, решение User и окно после перезагрузки, снимок старой версии с лишними полями (в том числе маршруты и применённый переход), схема снимка |
| `tests/custom-engine-owner.test.js` | Шаг User: текст и его проверка, пустой ответ, отмена и Stop, файлы, `unsupported_input` |
| `tests/basic-artifacts.test.js` | Реестр артефактов: идемпотентность, последняя версия линии, авторы |
| `tests/basic-output.test.js` | Проверка выхода: слова, JSON Pointer, порядок причин отказа |
| `tests/basic-spec.test.js` | Описание pipeline: три слоя, поля автора и `missing`, связи `previous`/`all`/список, участие User, схема без переходов, фикстура S01–S30, пустые схемы, Markdown |
| `tests/basic-schema.test.js` | Формат схемы: наследование, сборка, проверка, `toCanvas`, `toSettings` |
| `tests/basic-architecture-fixture.test.js` | Архитектура S01–S30 (`tests/fixtures/basic-architecture-s01-s30.json`, таблица `…map.json`): проверка, холст, настройки, прогоны на fake transport, бюджет |
| `tests/basic-schema-guide.test.js` | Инструкция автора схем совпадает с кодом |
| `tests/basic-docs-refs.test.js` | Ссылки и имена в документах Basic совпадают с кодом |
| `tests/schema-text-reader.test.js` | Чтение вставленного текста схемы (`SchemaTextReader.read`) |
| `tests/documents-folder.test.js` | Копия документа на диске: очистка имени, штамп времени, путь, выбор папки, доступ и запись (`DocumentsFolder`) |
| `tests/basic-run-chain.test.js` | Цепочка прогонов: SHA-256, разделы задачи, строка и сумма предыдущей строки, проверка `verify`, `saveRun` на фейковой папке |
| `tests/basic-repeat.test.js` | Повтор схемы: деление задачи, счётчики, документ следующего захода, причины остановки и окно User |
| `tests/results-debate-favorites.test.js`, блок «T08: повтор схемы на странице» | Повтор на странице (T08): 17 проверок раздела 8 `endless-pipeline.md` на поддельном транспорте и папке документов; проверка 15 — без перезагрузки (в jsdom не воспроизводится) |
| `tests/custom-run-resume-wiring.test.js`, блок «T08» | Проводка повтора в `results.js`: запуск, Stop, `forceNewTabs`, `usage`, `finally` |
| `tests/stage-card-basic.test.js` | Окно настроек раунда |
| `tests/results-debate-favorites.test.js` | Страница целиком: окна настроек, прогон, Save, Import, Export, установка схемы |
| `tests/results-tooltips.test.js` | Разметка подсказки на элементах холста (название и описание через `ResultsTooltips`) |
| `tests/pipeline-arrows-toggle.test.js` | Разметка и стили кнопки «Стрелки» |
| `tests/pipeline-presets.test.js`, `tests/pipeline-none-mini-prompt.test.js` | Список шаблонов и их умолчания |

### Что менять при типичных изменениях

| Изменение | Что трогать | Что обновить в документах |
| --- | --- | --- |
| Добавить поле в схему | `disput/basic-schema.js`: `validate`, `assemble`, `toSettings`, `toCanvas` по смыслу; страница: `basicSchemaFromPage` | `basic-developer.md`, `basic-schema-guide.md` (таблица полей и примеры); тесты `tests/basic-schema.test.js`, `tests/basic-schema-guide.test.js` |
| Изменить значение по умолчанию | `BasicSchema.DEFAULTS` в `disput/basic-schema.js` (меняет все схемы, которые поле не задают) | `basic-developer.md`, раздел «Совместимость»; таблица умолчаний в `basic-schema-guide.md`, раздел 4 |
| Добавить событие журнала | `emit(` в `disput/custom-engine.js` (для событий страницы — `batchEvent` в `results.js`) | Таблица в `basic-start-here.md`, раздел «События журнала и запись о прогоне»; `basic-developer.md` |
| Изменить уведомление в конце прогона | `basicRunNotice`, `runCustomFromPage` в `results.js` | `basic-start-here.md`, раздел «Что видит пользователь в конце прогона» |
| Добавить окно настроек или поле в окно раунда | `results/stage-card.js`, `openStageCard`, `setCustomRoundSetting`, схема | `basic-developer.md`, `basic-schema-guide.md` |
| Изменить Save, Import или Export | `recordFromSchema`, `installBasicSchema`, `buildBasicExport`, `importBasicSchemaFile` | `basic-developer.md`, разделы «Save» и «Export и Import схемы»; `basic-developer.md`, раздел «Как схема хранится в записи pipeline» |
| Добавить модель или роль | `MODELS` в `pipeline/pipeline-runtime.js`; роли — `judgeSystemPrompts` в `prompts.json` | Списки 7.1 и 7.2 в `basic-schema-guide.md`, иначе упадёт `tests/basic-schema-guide.test.js` |

## 2. Правила схемы и решения

### Наложение схемы на Basic

| В схеме | Результат |
| --- | --- |
| Поля нет | Значение Basic |
| Задано значение, включая `false` и `0` | Значение схемы |
| Пустая строка `""` | Пустой текст: унаследованный текст убран |
| Список (шаги, модели) | Заменяет список Basic целиком, порядок сохраняется |

Наследование задаётся только отсутствием поля. Пустая строка — явное значение. Так работает схема
(`BasicSchema.resolveFields`); прежние сохранённые настройки очищаются от пустых строк на границе
(`basicSchemaFromPage`), потому что карточка никогда не сохраняла пустое как значение.

### Совместимость

1. **Движок не знает о конкретных схемах.** Если схеме нужна новая возможность, она
   добавляется в Basic как общее поле или вариант значения и доступна всем схемам.
2. **В пределах поддерживаемого `schemaVersion` не меняются:** смысл существующих полей,
   их допустимые значения, поведение при отсутствии поля, порядок исполнения и передачи данных.
3. **Новое поле по умолчанию сохраняет прежнее поведение.** Новое поведение схема включает явно.
4. **Обновление Basic сохраняет поддержку всех ранее выпущенных версий формата схем.**
   Повышение `schemaVersion` не является основанием отключать существующие схемы.
5. Умолчание `input` раунда (с 2.81.854): `none` только у самого первого шага схемы, у раунда после любого шага, в том числе шага User, — `previous`. Раньше шаг User перед первым раундом не считался, и раунд после него получал `none`. Меняет поведение только схем, где шаг User стоит перед первым раундом и `input` у раунда не задан; явный `input` не меняется. Умолчание считают `BasicSchema.assemble`, `BasicSpec.build`, окно раунда (`first` в `openStageCard`). С 2.81.906 `none` — у шага, до которого нет исполнимого шага (раунда с включённой моделью или шага User): выключенные раунды перед первым исполняемым не дают ему `previous`.
6. Отказ при неподдерживаемой версии — для схемы, созданной более новым Basic, чем установлен
   у пользователя (см. «Проверка перед запуском»). Механизм перехода между версиями формата
   определяется, когда формат действительно понадобится менять.
7. Поля `document` шага User и `output.document` раунда (с 2.81.855) необязательны: схема без них работает как раньше; шаг User без `document` показывает поле текста. Опросник (`output.document: form`) проверяется только в раундах, где он объявлен.
8. Документ для чтения (`output.document: "read"`, с 2.81.856) требует ровно один артефакт в `output.artifacts` и текст между метками `[[DOC: id]]` и `[[/DOC]]` в ответе модели. Схема 2.81.855 с `read` без артефакта теперь не проходит проверку; сама она не дополняется (схемы прежних форматов не мигрируются): артефакт дописывают в схему. Вид `form` не меняется.
9a. Текст ответа, который Basic передаёт дальше, берётся из markdown-копии (`answerMarkdown`), если она полная и совпадает с плоским текстом; иначе плоский текст (`shared/basic-reply-text.js`, `results.js` `sendWave`, событие телеметрии `basic_reply_text`). Порог длины: markdown не короче 25 % плоского текста по буквам и цифрам (было 70 %: плоский текст может нести лишнее — трассировку рассуждений, подпись иконки; проверено на фикстурах, DeepSeek 0,32, Gemini 0,35); обрыв ловит хвост (24 символа) и полнота отчёта. Слипшийся плоский текст (`flattened`) ждёт свою копию до 4 с (п. 9a, `replyCopyFor`). Ниже — прежний путь резервного текста Claude.
9. Текст ответа Claude берётся через `textContent`, поэтому таблицы сначала превращаются в markdown (`AnswerMarkdownProviders.replaceTablesWithMarkdown`, `shared/answer-markdown-providers.js`): строки и ячейки не склеиваются. Та же конвертация стоит в `cleanContent` ChatGPT и Perplexity перед `body.textContent` (резервный путь текста ответа из HTML). Метки `[[DOC: id]]` / `[[/DOC]]` срезаются и из текста документа владельцу (`BasicOutput.stripDocumentMarks`, ветка владельца в `custom-engine.js`).

9. **Сохранённая схема следует текущим умолчаниям Basic** (схема хранит только отличия). Поэтому умолчание меняется только отдельным решением, а тексты умолчаний закреплены тестом (`tests/basic-schema.test.js`); схема, которой нужен прежний текст, записывает его явно. Начатый прогон умолчаниям не следует: продолжение исполняет шаги, собранные при старте (`snapshot.steps`, с 2.81.908).
10. **Личный запрос без `{вход}`** при возможном входе: в формате 2 — ошибка схемы и остановка `invalid_request`; в формате 1 схема читается и запускается как раньше (вход в такой запрос не попадает), окно перед запуском предупреждает (с 2.81.909).
11. **Сообщение о непрочитанной сохранённой схеме** называет, что делать: схема новее Basic — обновить расширение; удалённый вид или поле — переписать по подсказке ошибки; другое — исправить по ошибкам. Миграции нет.
12. Поле `run.repeat` (с 2.81.1063) необязательно: схема без него проходит один раз, как раньше. Проверка, Save и Export сохраняют поле; запуск повтора добавляется отдельно.

### Решения и причины

| Решение | Почему |
| --- | --- |
| Pipeline — это схема, а не копия настроек | Движок можно развивать, не ломая созданные pipelines. |
| Значения по умолчанию — контракт: новое поле по умолчанию сохраняет прежнее поведение | Существующее умолчание молча не меняется: иначе меняются все схемы, которые это поле не задают. |
| Нет поля — наследование; `""` — значение; значение, набранное User, остаётся явным, даже если равно умолчанию | Иначе выбор User превращается в наследование и меняется вместе с умолчанием. |
| Запись pipeline выводится из схемы одной функцией (`recordFromSchema`) | Иначе схема и данные холста расходятся, и запуск, холст и сохранённое читаются по-разному. |
| Схема проверяется до первой отправки и никогда не исправляется молча | Подмена смысла (неизвестный тип шага, порядок) запустила бы процесс, которого не просили. |
| Поддерживаются все выпущенные версии формата; отказ — только схеме от более нового Basic | Повышение версии не должно отключать существующие схемы. |
| Ограничения холста проверяются при установке (имена моделей и ролей, порядок раундов `r1…rN`, список пределов длины) | Чтобы не было тихих подмен при показе схемы на холсте. |
| Номер раунда берётся из идентификатора стадии, а не из порядка стадий | Пустой раунд не сдвигает номера, и настройки не переезжают к другому раунду. |
| Export — одна схема файлом; Import — добавляет, ничего не заменяя | Схемой можно обмениваться и писать её моделью по самодостаточной инструкции, не рискуя уже установленными схемами. |
| Инструкция автора схем проверяется тестом против кода | Иначе она тихо устаревает, и модели получают ошибочные списки. |

### Переименование Custom → Basic

Версия хранилища pipelines — 8 (`migrateBasicTemplateName`, `results.js`):
- запись шаблона «Custom» удаляется; шаблон «Basic» собирается из кода заново;
- отметки активного и последнего сохранённого pipeline, стоявшие на «Custom», переходят на «Basic»;
- собственный pipeline пользователя с именем «Basic» (если был) сохраняется под первым свободным «Basic N» со всеми данными, вместе с отметками, которые на нём стояли;
- внутренние id и ключи (`CUSTOM`, `disput/custom-engine.js`, `customDefaults` в старых записях) не менялись; пункт «Custom» в списке ролей остался: это роль, а не движок.

## 3. Сохранение, Export, Import и хранение

### Save

- Сохраняет только явные переопределения. Явно заданное значение сохраняется, даже если оно
  совпадает со значением Basic. Возврат поля к наследованию удаляет переопределение.
- Открыть схему и нажать Save не превращает показанные значения Basic в явные. Политика запуска и предел длины записываются в `run` только если они различаются с Basic или были явными в загруженной схеме. Флаги `run.strictLength` и `run.stopMarks` окно ▶ не показывает: страница сохраняет их из загруженной схемы при Save и при запуске (`basicKeptRunFields`, которую читают `basicRunForSave`, ветка без `forSave` в `basicSchemaFromPage` и `buildBasicRun`), поэтому схема, где они стоят, их не теряет. Новое поле `run.*` добавляется в `basicKeptRunFields`.
- Save шаблона создаёт схему `user` с `basedOn` = имя шаблона; повторный Save и сохранение карточки сохраняют `basedOn`.
- Настройки выключенной модели и шага, которого нет на холсте, остаются в схеме с `enabled: false`.
- Ответы, статусы и другие данные прогона в схему не попадают.
- Текст спецификации (`spec` и `title`, `goal`, `rules`, `quality` шагов; см. guide, 5.10) холст не редактирует. Save, Run и Export берут его из исходной схемы (`basicSourceSchema`, та же схема, из которой читаются поля, которых холст не редактирует) по `ref` шага; `spec` берётся целиком. Поля не дописываются, если в исходной схеме их не было. Для шага, которого нет в исходной схеме, ничего не добавляется; у шага из `customControls` (шаг User) поля сохраняются вместе с самим шагом.
- В схеме записываются `schemaVersion` (с первого сохранения) и `origin`.
- Кнопка Save спрашивает имя. Имя шаблона занять нельзя; существующее имя спрашивает подтверждение замены.
- Схема собирается с холста (с `basedOn`, если это копия шаблона; повторный Save сохраняет прежний `basedOn`) и
  устанавливается тем же путём, что и импортированная. Поля `customModelSettings` и `customDefaults` не пишутся.
- Схема хранит все раунды `r1…rN` подряд, в том числе раунд, где никто не отправляет (`models` пустой или все
  `enabled: false`). При Save отбрасываются настройки удалённых раундов, а также карточки прежних синтезов
  (`final`, `synth:…`) и `defaults.synthesisTask` из записей до 2.81.849: синтез — раунд из одной модели с ролью.
- Сохранение карточек и правка структуры сохранённого pipeline (Send, роль, добавление и удаление раунда или участника) сразу пересобирают запись целиком из текущего холста (с 2.81.906 правка структуры пишется сама: `touchBasicStructure` → `persistBasicSettings`). Открытие pipeline запись не меняет: пишется только pipeline, структуру которого User тронул.
- Запуск собирает ту же схему, что Save (`buildBasicRun` → `basicSchemaFromPage` с `forSave`), с текущими значениями шапки в `run`.
- Формат схемы со страницы — формат исходной схемы; формат 2 — только когда страница пишет то, что он добавляет (подпись участника, отличная от имени модели, или явный профиль). В формате 2 у каждого участника есть `id` (его имя, если своего нет); в формате 1 подписей нет.
- Выключенный участник, объявленный в исходной схеме, остаётся в ней с `enabled: false` и без других полей. Схема из одних шагов User не получает пустых раундов от колонки, которую холст показывает всегда; раунд холста, которого нет в схеме, при установке выключен целиком.

### HTML-экспорт ответов и ленты

HTML-файл из кнопки экспорта ленты Pipeline Panel или отдельного ответа содержит встроенный аннотатор (`results/debate-export.js`). Откройте файл в браузере, выделите текст и выберите один из пяти цветов (жёлтый — чистый `#ffff00`), «B» жирный, «I» курсив либо «★ В избранное». Кнопка «Tx» слева убирает подсветку, жирный и курсив только с выделенного фрагмента; «✕» снимает подсветку целиком вместе с заметкой избранного. Выделение через несколько абзацев сохраняется одной заметкой с полным текстом. Карточка «Избранное» в начале отчёта содержит ссылки «▽» к исходным фрагментам. Кнопка скачивания справа от заголовка сохраняет карточку отдельным HTML с её оформлением. Удаление заметки оставляет подсветку; снятие подсветки с избранного фрагмента удаляет соответствующую заметку целиком.

Ctrl/Cmd+S сохраняет подсветки и избранное вместе со скриптом. В Chrome/Edge при доступном `showSaveFilePicker` выбирается файл, повторное сохранение пишет в него же. В остальных случаях скачивается копия `<имя>_annotated.html`. Внутри iframe (предпросмотр в приложении или почте) файл не пишется: открывается окно с полным HTML для копирования. После открытия сохранённого файла избранное восстанавливается из атрибутов `mark.hl` внутри `#report`, без localStorage и сетевых запросов аннотатора. Панель и уведомления в сохранённый файл не попадают. Экспорт TXT не меняется.

Браузерная проверка аннотаций (нужен установленный Chrome): `RUN_HTML_EXPORT_BROWSER_TESTS=1 npm test -- --runInBand tests/debate-export-annotations.test.js`. Без переменной окружения этот браузерный сценарий явно пропускается; проверки jsdom запускаются всегда.

### Export и Import схемы

- **Export schema** выгружает одну схему pipeline, который сейчас на холсте, файлом `<имя pipeline>.json`
  (недопустимые для имени файла символы заменяются на `_`). Файл — голая схема, как в
  [basic-schema-guide.md](basic-schema-guide.md): `schemaVersion`, `origin: "user"`, `basedOn` (для копии шаблона),
  `run` (только явные значения), `defaults`, `spec` (если была в схеме), `steps` (текстовые поля шагов `title`, `goal`, `rules`, `quality` — тоже, если были). Перед выгрузкой схема проверяется так же, как при Save и Import;
  если её нельзя показать на холсте, выгрузки нет, причина — в уведомлении.
- **Export all schemas** (`#pipeline-export-all-btn`, рядом с Export schema) выгружает один файл `Каталог Basic.json`
  со всеми сохранёнными схемами списка pipelines: `{"basicCatalog":1,"schemas":[{"name":"<имя pipeline>","schema":{…}}]}`.
  В файл не входят шаблоны, записи без схемы (прежнего формата) и записи, не прошедшие проверку (`recordFromSchema`);
  они перечисляются в уведомлении с причинами. Берётся сохранённая схема, несохранённые правки холста не входят.
  Если выгружать нечего, выдаётся «Экспорт не выполнен. В списке нет схем Basic для выгрузки.». Код: `buildBasicCatalogExport`,
  `exportBasicCatalog`; общее скачивание — `downloadSchemaText` (`results.js`).
- **Import schema** принимает:
  - файл каталога (есть `basicCatalog`): версия не 1 — «Версия каталога N не поддерживается.»; нет массива `schemas` —
    «Файл каталога повреждён: нет списка schemas.». Каждая запись проверяется через `recordFromSchema` (`BasicSchema.validate`):
    валидные добавляются по порядку, невалидные пропускаются. Свободное имя берётся как есть; занятое имя (или имя шаблона)
    спрашивает новое имя с предложением «<имя> (2)»; совпадение с существующим именем спрашивает подтверждение замены;
    отказ, пустое имя или имя шаблона — схема не добавляется. Ничего не затирается молча. Итог одним уведомлением:
    «Добавлено схем: N, не добавлено: M.» и строки ошибок вида «имя»: `schemas[i].schema.<путь>: <сообщение>`.
    Последняя добавленная схема выбирается. Код: `importBasicCatalog` (ветка в `readPipelineImportFile`);
  - файл с одной схемой (есть `schemaVersion` и `steps`, нет `pipelines`): имя pipeline предлагается из имени файла
    без `.json`, его можно изменить; имя шаблона занять нельзя; существующее имя спрашивает подтверждение замены;
    ошибки называют место (например, `steps[0].models[0].name`); после установки pipeline выбран;
  - файл прежнего общего экспорта (есть поле `pipelines`): **добавляет** записи, у которых есть `schema`, под их
    именами. При совпадении с существующим именем или с именем шаблона к имени добавляется « (2)», « (3)» и т. д.;
    запись, чьё имя совпадает с именем шаблона, пропускается. Остальные записи пропускаются, ничего не заменяется.
    Итог — в уведомлении: «Добавлено схем: N, пропущено: M»;
  - файл читается так же, как вставленный ответ модели (`SchemaTextReader.read`: ограда, текст вокруг, комментарии, хвостовые запятые) и проверяется до вопроса об имени; то, что не читается, — «Файл не прочитан как схема Basic: <причина>»; объект без полей схемы — ошибки проверки с путём (например, `schemaVersion: версия формата не указана`); файл больше 5 МБ не читается (с 2.81.910).
- **Вставка текста** (кнопка «Вставить схему», `#pipeline-profile-btn`): окно принимает ответ модели целиком. `SchemaTextReader.read` снимает ограду ```json, хвостовые запятые, комментарии, ключи без кавычек и типографские кавычки, берёт первое JSON-значение; текст вне JSON — комментарий модели, он сохраняется в поле схемы `comment` (если в схеме его нет) и показывается в окне ▶ под описанием (с 2.81.918). Объект с `basicCatalog` идёт по пути каталога, иначе схема проверяется `recordFromSchema`; ошибки списком в окне, успех — путь Import (спрашивается имя). Оборванный ответ не применяется. Алиасы полей не применяются.
- При неудачной установке схемы, кроме уведомления, открывается окно со всеми ошибками схемы.
- Режима «заменить все pipelines» нет.
- Загрузка pipeline из списка не изменилась: страница читает запись и показывает холст. Запись всегда согласована
  со схемой, потому что строится только из неё.
- Хранение не менялось: одна запись `llmComparatorPipelines` в `chrome.storage.local`. Шаблоны не хранятся,
  они собираются из кода.

### Что считается явным значением

Текст, введённый User в карточке, записывается в схему как есть, в том числе когда он совпал с унаследованным;
`""` не записывается, пустое поле возвращает наследование. Введённая инструкция длины, совпавшая с показанной (с числами),
записывается шаблоном (`{от}`, `{слов}`) и продолжает следовать пределу. Запрос карточки, совпавший с автоматическим, остаётся
унаследованным. Политика запуска и предел, выбранные в шапке, записываются в `run` даже при равенстве Basic; сама загрузка
схемы явными их не делает. Записи, сохранённые до схемы, читаются так: копия текущей инструкции длины по умолчанию — не
личное значение (как раньше), в схеме такое значение явное.

### Где схема хранится физически

Схемы не лежат отдельными файлами. Все pipelines пользователя — одна запись в хранилище расширения
(`chrome.storage.local`, ключ `llmComparatorPipelines`; через `CompressedStorage`, если он есть, тогда запись сжата;
записывает `persistPipelineStore` в `results.js`). Состав записи:

| Поле | Что это |
| --- | --- |
| `pipelines` | словарь «имя → запись pipeline»; схема Basic-pipeline — поле `schema` внутри своей записи; данные холста (`protocol`, `roundCounter`, `modelStacks`, `draftPlan`) выводятся из `schema` |
| `order`, `active`, `lastSaved` | порядок в списке, выбранный и последний сохранённый pipeline |
| `draftPlans` | отдельный сохранённый план холста по имени (раунды) |
| `overrides` | переопределения по именам (предел раундов, профиль); прежнее `overrides.synthesizers` при чтении отбрасывается |
| `version` | версия записи (`PIPELINE_STORE_VERSION`) |
| `writer` | метка страницы, записавшей список; по ней страница отличает свою запись от записи другой вкладки |

Защита записи (с 2.81.904):

- Значение ключа, которое есть, но не читается (сжатая запись не распаковалась), не перезаписывается: запись списка с этой страницы отключается до перезагрузки, User видит «Список pipelines в хранилище не прочитан…»; вставка и импорт схемы отказывают до вопроса об имени (с 2.81.912). Пустая копия страницы не стирает pipelines.
- Изменение списка другой вкладкой (`chrome.storage.onChanged`, чужая метка `writer`) принимается в память страницы до её следующей записи; открытый pipeline остаётся открытым. Для одного и того же pipeline побеждает последняя запись.
- Отказ записи (например, квота) показывается уведомлением «Pipelines не сохранены в хранилище: …»; `persistPipelineStore` возвращает `false` и не бросает исключение. Установка схемы (`installBasicSchema`) при отказе откатывает память страницы и возвращает ошибку `хранилище`.
- Переименование переносит все рабочие копии pipeline, в том числе шаги User (`customControls`). Во время прогона переключение, переименование pipeline и «Вставить схему» заблокированы.
- Export schema для сохранённой схемы, которую страница не прочитала, выгружает её как есть и называет ошибки.

Не в этой записи: шаблон Default — он собирается из кода
(`disput/pipeline-presets.js`) при каждой загрузке и схемой в хранилище не является; записи прогонов — отдельные
ключи по одному на прогон (`disput/custom-run-record.js`). Документы окна User отдельно не хранятся: тексты версий лежат в записи прогона (реестр артефактов и тексты по отпечатку), записи вытесняются общим правилом; см. «Документ в прогоне» в `basic-start-here.md`. Запись и чтение идут через `CustomRunRecord.chromeStorage(chrome.storage.local)`: ошибка `chrome.runtime.lastError` и синхронное исключение отклоняют промис, а не дают вид успешной записи. Ошибка записи в точке сохранения состояния (checkpoint) останавливает прогон с `checkpoint_failed` до следующего запроса.

Файлом схема становится только при обмене: **Export schema** выгружает одну схему pipeline, который сейчас на холсте,
файлом `<имя pipeline>.json`; **Import schema** принимает файл с одной схемой (имя предлагается из имени файла) либо
файл прежнего общего экспорта, из которого добавляются его записи со схемой (см. «Как схема встаёт на холст»).

### Как схема хранится в записи pipeline

Запись Basic-pipeline держит схему в поле `schema` и не пишет `customModelSettings` и `customDefaults`.
Запись строится только из схемы: `recordFromSchema` выводит из неё данные холста (число раундов, модели раундов и
их роли, `protocol`), и отдельно с холста они не снимаются. Единственная
точка записи — `installBasicSchema`; через неё идут Save, Import, сохранение карточек, ▶, карточек раунда и правка
структуры сохранённого pipeline. Поэтому запись всегда согласована со схемой.

Схема читается при загрузке: настройки карточек и ▶ берутся из неё, политика запуска и предел — из `run`
(а если их нет — из Basic). Схема, которую нельзя прочитать (в том числе созданная более новой версией Basic),
не запускается. Загрузка pipeline из списка не изменилась: страница читает запись и показывает холст.

### Копия документа на диске

- Дескриптор папки хранится в IndexedDB расширения (база `AutoOrchestrDocumentsFolder`, хранилище `handles`, ключ `documents`), не в `chrome.storage`. В схему не входит.
- При OK/Send `saveDocumentCopy` (`results.js`) пишет утверждённый текст через `DocumentsFolder` (`results/documents-folder.js`). В конце прогона `runCustomFromPage` перезаписывает файл каждого документа `read` его последней действительной версией (`BasicArtifacts.finalDocuments(steps, result.artifacts)`, с 2.81.917). Копия для человека; главное хранилище — запись прогона.
- Доступ запрашивается на ▶ и на «Продолжить прогон» (`requestDocumentsAccess`). Ошибка записи не останавливает прогон.

**Встроенные схемы (`user_doc`).** `BUILTIN_SCHEMAS` в `disput/pipeline-presets.js` ставятся в список при первом старте (`seedBuiltinSchemas` в `results.js`). Схема из три шага: `r1` (DeepSeek составляет опросник, `output.document: form`), `owner:fill` (User заполняет и нажимает «Отправить»), `r2` (DeepSeek, `input: previous`, пересказывает ответы User по пунктам). Тот же текст лежит в `docs/Pipeline scenarios/questionnaire-deepseek.json`; тест сверяет их. Имя записывается в `pipelineStore.seeded` (сохраняется), поэтому удалённая пользователем схема не возвращается. Если pipeline с таким именем уже есть, он не перезаписывается. Ревизия встроенной схемы задаётся в `BUILTIN_SCHEMA_REVISIONS` (сейчас `user_doc: 2`, поле `pipelineStore.seededRev`). При повышении ревизии встроенная схема заменяет сохранённую копию (правки User в ней теряются), удалённая не возвращается.

### Запись прогона на диск и цепочка

- В конце каждого прогона — успешного, остановленного и с ошибкой — `autosaveRun` (`results.js`) собирает отчёт через `buildBasicReportNow` с `executionActive: false` и вызывает `BasicRunChain.saveRun` (`disput/basic-run-chain.js`).
- Файл прогона: `run_<runId>.json` в папке `<имя схемы>/<дата и время старта>` внутри папки документов. Строка цепочки: `chain.txt` в корне папки, пять полей через пробел: номер, время UTC, путь файла (пробелы заменены на `%20`), SHA-256 файла, SHA-256 предыдущей строки (`-` у первой). Строка собирается функцией `chainLine`.
- Без выбранной папки запись молча пропускается. Без доступа (`ensureAccess({ request: false })`) или при ошибке записи — одно уведомление «Запись прогона не сохранена в папку: …», прогон продолжается. Доступ запрашивает ▶, как для документов.
- Отчёт содержит поле `taskSections`: заголовок, длина и SHA-256 каждого раздела задачи. Кнопка Basic выгружает то же поле.
- В корень папки документов теперь попадают `chain.txt` и файлы прогонов, а не только документы.

### Прежние настройки страницы

Запись, сохранённая до схем (с членами `customModelSettings` и `customDefaults`), читается как раньше, а при
первом Save или сохранении карточки, ▶ или раунда становится записью со схемой. Пока она не переписана, страница
читает её в схему на одной границе (`basicSchemaFromPage`): пустой сохранённый текст там не считался значением и отбрасывается,
снятое поле `ask` игнорируется, карточки прежних синтезов (`final`, `synth:…`), `synthesisTask` ▶ и `protocol.synthesizer`
читаются без ошибки и отбрасываются. Любое другое значение, в том
числе неверное (`0`, `false`, текст вместо числа), идёт в проверку как есть и останавливает запуск.

## 4. Диагностика

### Что у нас есть для разбора

| Источник | Где взять | Что в нём |
| --- | --- | --- |
| Уведомления страницы | Всплывающие сообщения внизу страницы | Причина остановки и ошибки схемы: «Basic: …», «Схема не установлена. …», «Pipeline: error (…)». |
| Журнал доставки (`delivery`) | Поле `delivery.journal` в JSON кнопки Basic | События прогона Basic: `custom_start`, `custom_answer`, `custom_step`, `custom_decision`, `custom_step_end`, `custom_end` (движок) и `owner_answer` (ответ User на вопрос `[[ASK]]`). |
| Запись о прогоне (`customRun`) | Поле `customRun` в JSON кнопки **Basic** на вкладке Disput панели диагностики (`#disput-basic`) | Полные тексты прогона: задача, запросы по попыткам, входы, ответы, исходы, `state` каждой попытки (`sent`, `done`, `not_sent`, `unknown`). Экспорт самодостаточен: все ссылки на тексты (поля `*Ref` и `file.ref`; `stepRef` — адрес шага) разрешаются через поле `texts`; `snapshot` и `attempts` сохраняют ссылки, попытки несут `ref`, `participant`, `visit`, `attempt`, `phase`. `resumable: true` только у записи версии 2 с полным состоянием (схема, позиция, все тексты); у записи версии 1 `resumable: false`. Импорта записи прогона в интерфейсе нет. |
| Сводка шагов (`rounds`) и вердикт доставки (`delivery.diagnosis`) | Тот же JSON кнопки Basic | По каждому шагу и визиту исход каждого участника: `accepted`, `rejected`, `no_answer`, `not_sent`, `in_flight`, `no_attempt` с причиной; по каждой отправке — результат доставки. Состав — [телеметрия](../Telemetry/telemetry.md), раздел «Basic: JSON прогона». |
| Холст | Шаги на холсте pipeline | Статусы шагов: серый `pending`, синий или оранжевый `running`, `completed`. Итоговое состояние прогона: `COMPLETED` (все шаги пройдены), `CANCELLED` (остановлено или ограничено бюджетом), `FAILED` (ошибка). |
| Export schema | Кнопка «Export schema» в шапке pipeline | Схема того, что сейчас на холсте, одним JSON-файлом. |

### Симптом → где смотреть

| Симптом | Где смотреть | Что это значит и что делать |
| --- | --- | --- |
| «Basic: схема не запущена. <место: причина>» | Уведомление | Схема не прошла проверку перед запуском; запросов не было. Место ошибки указано в тексте (например, `steps[1].models[0].name`). Исправить поле; таблица ошибок — в [basic-schema-guide.md](basic-schema-guide.md), раздел 10. |
| «Basic: выберите модели хотя бы в одном раунде.» | Уведомление | Ни в одном раунде не включена модель. Включить модель в раунде и запустить снова. |
| Шаг долго остаётся «выполняется» | `custom_answer` в журнале (поля `status`, `reason`); окно паузы | Модель ещё не ответила или ответ не принят. Если открыто окно паузы («Продолжить / Повторить без ответа / Stop» или «Пропустить шаг / Повторить / Stop»), решение ждёт User. Stop завершает прогон. |
| Видимый Stop, текст модели не растёт больше 120 с | Журнал прогона: `STOP_STALLED` (`status: UNCERTAIN`, `silentMs`, `textLength`); `MODEL_FINAL` с `stopStalled` и `timers` | Генерация провайдера зависла. Ответ не закрывается успехом: ждать общего предела, итог UNCERTAIN с причиной. Транспорт — [message-delivery.md](../Transport/message-delivery.md). |
| Ответ модели не принят | `custom_answer` с `accepted=false` и `reason`; в `customRun` у попытки поля `accepted` и `reason` | Причина — текст из `REASON_TEXT` в `disput/custom-engine.js`. В прогоне Basic встречаются «пустой», «без текста», «оборван», «оборван на середине» и «раунд закрыт User»; «слишком короткий» и «ошибка вместо ответа» в этом пути не возникают (подробно — в [basic-start-here.md](basic-start-here.md)). Движок повторяет запрос исправления в том же чате, до 2 попыток. |
| Уведомление «… Принятых ответов нет.» | `custom_step` (`accepted`, `failed`) и `custom_decision` | Ни один шаг не принял ответ. Смотреть, на каком шаге и по какой причине ответы не приняты; если решение User не получено, уведомление содержит «Basic: нет принятых ответов, решение User не получено. Принятых ответов нет.». |
| Остановка «промпт не помещается в бюджет» (`context_full`) | В `customRun` у попытки `state: not_sent`; `custom_end` с `stopReason: context_full` | Запрос не отправлен, потому что превышен предел длины. Сократить вход, задание или длину ответа. |
| Нужно знать, что именно ушло модели | `customRun`: у попытки `prompt` (запрос движка) и `sentPrompt` (как отправил транспорт, с меткой доставки) | Сравнить эти два поля, если транспорт дописал что-то к запросу. |
| В карточке ответа лишний служебный текст, потеряны абзацы или ответ пустой | Сравнить `answer` у попытки в `customRun` с карточкой; связать запись с журналом доставки (`delivery`) по `transportRequestId` | Если текст в `answer` уже искажён, проблема в транспорте или контент-скриптах, а не в схеме. |
| Служебный текст в ответе: подпись «Ответ N:», метка доставки `[[AO-…]]`, заголовки со страницы модели | Подпись «Ответ N:» страница больше не ставит (её ставила карточка итога, которой больше нет); метку доставки ставит транспорт и снимает при приёме; служебный текст в `answer` — сбой сбора, а не поведение Basic | Сравнить `answer` у попытки в `customRun` с карточкой ответа: если служебный текст уже в `answer`, он пришёл от транспорта или со страницы модели, а не из схемы. |
| Схема не устанавливается через Import: «Схема не установлена. <место: причина>» | Уведомление | Схема не прошла проверку при установке; ничего не записано. Исправить место, указанное в тексте. |
| Import: «Файл не прочитан как схема Basic: …» | Уведомление | В файле нет читаемой схемы: причина названа после двоеточия (оборванный текст, неверный JSON, список вместо объекта). |
| Import: «Схема не установлена. <путь>: …» | Уведомление и окно ошибок | Файл прочитан, но схема не проходит проверку (нет `schemaVersion`, `steps`, неизвестное поле…): исправить по пути ошибки. |
| Нужно перенести схему на другой компьютер или отправить другому | Кнопки Export schema и Import schema | Export schema выгружает схему файлом `<имя pipeline>.json`, Import schema добавляет её как новый pipeline; правила — в [basic-developer.md](basic-developer.md), раздел «Export и Import схемы». |
| Настройки пропали после перезагрузки | Была ли нажата Save в шапке pipeline или сохранялась карточка | Настройки записываются в запись pipeline при Save и при изменении карточек уже сохранённого под именем pipeline. Несохранённые изменения шаблона живут до перезагрузки страницы. Резерв — Export schema. |
| Stop не закрыл окно паузы | Окно паузы | Stop закрывает открытое окно паузы: это делает блок `finally` в `runCustomFromPage`. Если окно осталось открытым после Stop, это ошибка: приложить JSON кнопки Basic. |

### Как собрать материалы для передачи другой модели

1. Export schema: схема того, что на холсте.
2. JSON кнопки Basic сразу после прогона: в нём `customRun`, `rounds` и `delivery`. Запрос для модели — [queries.md](../Telemetry/queries.md), раздел «Прогон Basic».
3. Текст задачи, которую вводили в поле модератора, и что ожидалось.

Скриншоты вместо JSON не нужны: в JSON есть всё, что нужно для разбора.

## 5. Открытые вопросы и известные падения тестов

Если вы решили или исправили пункт: удалите его отсюда в том же коммите и обновите описание нового поведения в `basic-start-here.md` или здесь.

### Сводка

| Код | Тема | Статус |
| --- | --- | --- |
| REVIEW-3 | Ревью пользовательских схем 27.10 (2.81.903): запуск исполнял не сохранённую схему, потери данных, продолжение, совместимость, инструкция | исправлено в 2.81.904–2.81.910 по [плану исправлений](basic-user-schemas-fix-plan.md) |
| OI-5 | Записи прежнего формата без схемы не импортируются из старого общего экспорта | принято как граница, зафиксировано |
| REVIEW-1 | Дефекты независимой проверки 12.10 (V01–V08, N04, R07) | исправлены в 2.81.757–764; остаётся файл User на странице (N03) |
| TRANSPORT-1 | Участники: `chat: "new"`, привязки чатов в снимке и восстановление после отмены исполняются (тесты на моках); реальные страницы провайдеров не проверены | открыт: см. «Что не проверено вживую» |
| TEST-1 | Тесты, падавшие не из-за Basic (9 в 4 файлах) | исправлено: устаревшие ожидания приведены к коду, код не менялся |
| TEST-2 | Нестабильный тест `false success: watcher completion guards` | известно |
| TEST-3 | 46 тестов страницы падают после работы по участникам формата 2 (коммит 4b32f482) | открыт: см. раздел ниже |
| PLAN-1 | Документы для User — [план](basic-user-documents-plan.md) | этапы 1–2 сделаны (2.81.855–2.81.857); этап 3 частично: запись копии сделана (2.81.872), перечитывание файла отложено (2.3b); этап 4 не сделан |
| PLAN-2 | Перенос в Basic с одобренного User (подсказки, Send, Arrows, значок ошибок, каталог целиком, колонка In и чипы артефактов, файл на диске) — [план](basic-port-plan.md) | составлен 25.10.2026; сделаны пакеты 1.1 (подсказки), 1.2 (Send), 1.3 (Arrows), 1.4 (ошибки), 2.1 (каталог), 2.2 (вставка JSON схемы), 2.3a (запись копии на диск); слиты в 2.81.873; 2.3b (перечитывание файла) отложено; пакет 1.5 (колонка In, чипы и стрелки артефактов) не сделан; запрос для моделей по формату Basic — [basic-model-request.md](<../Scheme create/basic-model-request.md>) |

### Открытые вопросы

#### REVIEW-1. Дефекты независимой проверки 12.10

Полное описание, код и порядок исправления — в [basic_fixes_review_oct12.md](basic_fixes_review_oct12.md); здесь только состояние. Проверено 14.10.2026 на версии 2.81.755 запуском скриптов воспроизведения из `basic-fixes-review-oct12/` и `basic-review-oct12/` (команды — в конце отчёта проверки).

| Код | Суть | Состояние на 2.81.755 |
| --- | --- | --- |
| V01 (P1) | Continue теряет чат до первого ответа: resume уходит в посторонню вкладку | исправлено в 2.81.761: привязка пишется в запись, пока батч в полёте; участник без привязки, уже отправлявший, получает отказ `participant_chat_lost` (`binding_missing`) |
| V02 (P1) | Feedback не входит в зависимости визита: инвалидация источника не делает ответ устаревшим | снято в 2.81.846: возвратов назад, обратной связи и пересмотра результатов в Basic больше нет |
| V03 (P1) | Проверка неизвестной попытки может признать старый ответ новым (пока движок её не вызывает) | исправлено в 2.81.764: ответ при проверке «найден» только с меткой доставки этого запроса, иначе `no_answer` (`no_delivery_proof`) |
| V04 (P2) | Проверка endpoint недоступна в реальном service worker | исправлено: `self.extractLatestAssistantSnapshotInPage`, тест `tests/background-global-scope.test.js` |
| V05 (P2) | Повтор ревизии User теряет исходный документ (`missing_input`) | исправлено в 2.81.764: User, дорабатывающий свою линию, начинает с последней действительной версии |
| V06 (P2) | User: `input: none` и `all` отвергаются схемой, хотя движок их исполняет | воспроизводится |
| V07 (P2) | Запись без `pc` и состояния объявляется возобновляемой, resume завершается без работы | исправлено в 2.81.762: `canResume` и экспорт требуют все поля состояния, движок отказывает `resume_invalid` |
| V08 (P2) | Resume читает `record.attachments`, а запись их не сохраняет | исправлено в 2.81.763: файлы нового прогона сохраняются в записи до 1,5 МБ; больше — запись помечается `attachmentsStored: false`, продолжение отказывает с названием файлов |
| N04 | Проверка неизвестной попытки не подключена к движку (`checkUnknown` не вызывается) | исправлено в 2.81.764: в окне неизвестного запроса есть «Проверить ответ» (`checkUnknown`); найденный ответ проходит обычную приёмку |
| R07 | Остановка прогона оставляет открытое окно выбора | исправлено в 2.81.762: окна прогона получают его signal (`ChoiceDialog.ask({ signal })`) |

Если вы исправили пункт, обновите строку и добавьте тест; не переписывайте описание из отчёта проверки.

#### OI-5. Записи прежнего формата без схемы не импортируются

**Что происходит.** Import принимает голую схему или файл прежнего общего экспорта (в нём есть поле `pipelines`). Из общего экспорта добавляются только записи, у которых есть поле `schema`; остальные пропускаются, в уведомлении видно «пропущено: N». Записи Basic, сохранённые до появления схем, остаются в хранилище, загружаются как раньше и становятся схемами при первом Save или сохранении карточки; но через общий экспорт их не перенести.

**Почему.** Для них нет преобразования «запись прежнего формата → схема» вне страницы; прежний формат читается только при загрузке записи на страницу.

**Что делать.** Если понадобится перенос таких записей: загрузить запись на страницу, сохранить (Save) и выгрузить Export schema. Целиком переносить список теперь можно каталогом (Export all schemas), но только записи со схемой.

**Где в коде:** `importBasicBundle` и `basicWorkingFromConfig` в `results.js`.

### Тесты

#### REVIEW-2. Тесты `tests/review-*.test.js`

Воспроизведения дефектов из `reviews/basic-stand-review-2026-10-24.md` помечены `test.failing`: проходят, пока дефект не исправлен. Исправивший дефект снимает `.failing` с его теста в том же коммите (иначе тест упадёт) и удаляет строку из отчёта или отмечает её исправленной.

#### TEST-1. Тесты, падавшие не из-за Basic

Состояние на 2.81.788: падали 9 тестов в 4 файлах. Причина была не в коде страницы, а в ожиданиях тестов, которые отстали от намеренных изменений:

- `tests/release-log-regressions.test.js` (4 ожидания): строки и CSS, изменённые в 101fe3f3, 7cfab03d, b606e1ef, d7204309; тест «state map actions» проверял state map, удалённый в 63e4dad и 1c330316, и удалён.
- `tests/pipeline-semi-auto.test.js` (2): защита фокуса переехала с `.msg-header` на `.moderator-input` (101fe3f3, кнопка внутри обоих); окно поиска в `runCustomFromPage` стало меньше тела функции.
- `tests/telemetry-export-actions.test.js` (1): у evidence добавлен `registeredRunId` (9b6de79b).
- `tests/results-ui-recovery-triggers.test.js` (1): условие fallback расширено для Gemini (d7204309).

Все четыре файла проходят полностью. Если в них снова падает тест — это регрессия, а не старый долг.

#### TEST-2. Нестабильный тест

Устранено в 2.81.920: `tests/false-success-watcher-guard.test.js`, тест `content growth extends a short deadline without exceeding hardMax`, использует фиксированные тестовые часы. Ранее время между вычислением deadline и проверкой могло уменьшить остаток на миллисекунду и давало случайное падение. Точные assertions сохранены; этот тест больше не является допустимым исключением из полного зелёного прогона.


### Состав колонки раунда на холсте

`BasicSchema.toCanvas` строит стек `rN-models` только из участников раунда N: включённые (в порядке схемы) и выключенные с `onCanvas: true` этого же раунда. Участник другого раунда в стек не попадает, даже если у него тот же `id` или он включён в другом раунде. `selectedModels` (выбранные в шапке модели) — модели, показанные хотя бы в одном стеке. При Save страница ставит `onCanvas: true` только выключенным участникам, чей блок стоит в колонке этого раунда (`basicSchemaFromPage`, `forSave`), поэтому round-trip схемы не добавляет участников в чужие раунды.

### Восстановление записей до схемы

С 2.81.922 Basic восстанавливает явно сохранённые `modelStacks.items` даже на пустом холсте. Источник участников старой записи — её собственные стеки, а не текущие кнопки провайдеров или оставшиеся карточки другого pipeline. Идентификаторы, подписи, порядок, выключенные участники и роли сохраняются при последующем переходе к схеме. Состав участников при отсутствии явных стеков не выдумывается. Роли берутся из текущих карточек, поэтому снятая роль (None) не восстанавливается из исходной записи.

### Загрузка большой схемы

С 2.81.921 `applyPipelineConfig` добавляет и убирает колонки раундов без промежуточных полных пересчётов холста. Когда все раунды и настройки восстановлены, выполняется общая синхронизация. Ручное добавление и удаление раунда по-прежнему обновляет холст сразу. Проверка S01–S30 сохраняет исходный deadline 240 с и проверяет точное равенство схемы после двух сохранений.

#### TEST-3. Падения после работы по участникам формата 2

Незакоммиченная работа другой сессии (участники одного провайдера, формат схемы 2, проверка личных запросов; записи CHANGELOG 2.81.898–2.81.900) сохранена коммитом 4b32f482 как была загружена в расширение. До неё полный набор давал 3 падения, после — 78 (`tests/results-debate-favorites.test.js` 77, `tests/release-log-regressions.test.js` 1). Исправления по [плану ревью](basic-user-schemas-fix-plan.md) сняли 32 из них (главное — схема без ID участников в формате 2 не запускалась). Исторический отчёт для 2.81.911 называл 46 падений; поимённая проверка 2.81.915–2.81.919 воспроизвела 47 (46 в `tests/results-debate-favorites.test.js` и одно в `tests/release-log-regressions.test.js`). Это не допустимый фон для дальнейшей разработки. В 2.81.920–2.81.926 исправлены детерминированность часов, загрузка большого холста, восстановление старых записей Basic, повторная загрузка роли Custom, очистка нового пустого pipeline и предусловия/ожидания тестов. Подробности и приёмка — [план восстановления набора](reviews/zero-test-failures-plan-2026-10-28.md). Итоговая приёмка 2.81.926: полный `npm test` — 3923 passed, 0 failed; файл страницы — 207/207. Новых пропусков нет; 27 browser-only проверок остаются вне стандартного npm-прогона, как и до исправлений.

### Метка в карточке и остановка транспорта

Метка доставки текущего запроса, полученная в конце непустого ответа и подтверждённая при отрисовке карточки, исключает эту модель из дальнейших автоматических посещений. Подтверждение связано с `transportRequestId` и dispatch текущего запроса; следующий этап создаёт новую запись модели и новое ожидание. Завершение всех карточек главной страницы останавливает её запрос, но не отменяет многоэтапный Basic-прогон. Кнопка «Стоп» на главной странице вызывает полную остановку транспорта и возвращает «Пуск» для нового запроса независимо от полноты ответов. При потере ответа или после 2,5 секунд ожидания страница проверяет `GET_ACTIVE_RUN_STATE` с таким же пределом: только подтверждённое отсутствие сессии возвращает «Пуск», иначе кнопка снова доступна для повторной остановки. Эти ограничения относятся только к управляющим сообщениям остановки, а не к отправке запроса.

Отмена проверяется повторно после асинхронной подготовки запуска и непосредственно перед доставкой команды во вкладку. Прокрутка проверяет счётчик остановок также внутри ожидания стабильности DOM, поэтому снятие флага остановки следующим запросом не возобновляет старый скрипт. Фоновый snapshot передаёт состояние сессии и `cardAnswerComplete`; фиксация зелёного статуса главной карточки относится к текущему запросу модели. Метка проверяется также при обновлении панели и восстановлении карточки из фонового состояния; повторная обработка очищенного ответа и повторное событие создания того же запроса не снимают фиксацию. Подтверждение «Стоп» отправляется после отмены запроса без ожидания записи команды в хранилище; ожидающие отправки завершаются отменой. Остановка очищает настоящие alarms и callbacks ограничений частоты в `background/rate-limit.js`; отдельной карты `rateLimitTimers` в service worker нет. Скрипт страницы принимает остановку до завершения своей асинхронной инициализации, и следующий запуск не возобновляет прерванную инициализацию. Флаг остановки сбрасывается новым запуском `GET_ANSWER` (другой `runSessionId` или `dispatchId`); в решении протокола пишется `hardStopSetBy` — кто его поставил (`background_stop`, `session_expired`, `hard_stop_restore`). Остановка с текстом на странице не закрывает ответ `INTERRUPTED`, пока владение не подтверждено (см. `docs/Transport/message-delivery.md`).

### Что не проверено вживую

Всё ниже проверено только моками и jsdom. Ручной сценарий передан A03; до его выполнения эти пункты не считаются подтверждёнными.

1. **Два участника одной модели в настоящих вкладках провайдера.** Схема и холст проверены тестами, транспорт — заглушками; без разрешённого запуска нельзя подтвердить поведение сайтов провайдеров в настоящих вкладках.
2. **`chat: "new"`.** Новый чат открывается на первом запросе шага; исправление идёт в тот же чат. Проверить в провайдере, что открыт новый чат, а не продолжен старый.
3. **Закрытая вкладка участника во время захода.** Прогон останавливается с `participant_chat_lost` до отправки; чужая вкладка той же модели не отправляется. На реальных вкладках провайдеров не проверено: сценарий закрыть вкладку участника и продолжить прогон.
3a. **Продолжение после отмены и обновления расширения (R01).** Отменить прогон, обновить расширение, продолжить прогон: участник должен уйти в свой чат (`binding` из снимка), а не в чужой. Не проверено в браузере.
3b. **Вложения (R05).** Второй заход того же участника в новый чат получает файлы; продолжение в тот же чат их не повторяет; две модели в одной волне получают файлы каждая в свой чат. Не проверено в провайдерах.
4. **Повтор в той же вкладке.** Исправление уходит в ту же вкладку и тот же чат; вложения не отправляются повторно.
3c. **Проверка неизвестной попытки (N04).** Прервать отправку (потеря связи или перезагрузка), открыть «проверить»: найденный ответ виден, повторной отправки нет; вкладка закрыта — `chat_unavailable`, не успех. Не проверено в провайдерах.
5. **Страница в браузере.** Установить `tests/fixtures/basic-architecture-s01-s30.json` (в fixture S18 — Claude и GPT, не два Claude), открыть холст, сохранить, загрузить, сохранить снова; проверить окно owner.
6. **CHG S19 и S25 сняты.** Возвратов назад в Basic нет (2.81.846), проверок и развилок тоже (2.81.848): в фикстуре `tests/fixtures/basic-architecture-s01-s30.json` проверки G1–G4 — раунды из одной модели с критериями в `task`, выборы User (CHG13, CHG17, CHG18, CHG25, исход S29) — шаги `owner`, синтетические условия возвратов убраны. Если нужен повтор, его записывают обычным шагом ниже по списку.
