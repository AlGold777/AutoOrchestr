# Basic: где что лежит в коде

**Для кого и зачем.** Для разработчика или модели, которой нужно найти место в коде Basic. Файл `results.js` — около 26 000 строк в одной большой замыкающей функции, поэтому ориентируйтесь по именам функций и констант, а не по номерам строк. Что делает Basic, см. в [basic-start-here.md](basic-start-here.md).

## Файлы Basic

| Файл | Символы | Что там |
| --- | --- | --- |
| `disput/custom-engine.js` | `CustomEngine`, `run`, `attempt`, `normalizeSteps`, `buildPrompt`, `previewPrompt`, `correctionPrompt`, `inputFor`, `judge`, `resolveSetting`, `STOP_TEXT`, `REASON_TEXT`, `DEFAULT_ATTEMPTS`, `SYNTHESIS_TASK` | Движок: шаги, запросы, приём, повторы, пауза |
| `disput/basic-schema.js` | `BasicSchema`, `DEFAULTS`, `validate`, `assemble`, `resolveFields`, `resolveRun`, `toSettings`, `toCanvas`, `describeErrors` | Формат схемы: умолчания, проверка, сборка шагов, показ на холсте |
| `disput/custom-run-record.js` | `CustomRunRecord`, `createRun`, `recordAttempt`, `finishRun`, `serialize`, `revive`, `exportRun`, `createStore` | Запись о прогоне |
| `results/stage-card.js` | `StageCard`, `buildModel`, `render` | Окно настроек раунда |
| `disput/pipeline-presets.js` | `BUILTIN_PIPELINE_DEFINITIONS`, `PIPELINE_PRESETS`, `makePreset` | Шаблон Basic и пресет `CUSTOM` |
| `disput/debate-draft-plan.js` | `createCanvasPlan`, `insertSynthesis`, `normalize` | План холста |
| `disput/debate-response-acceptance.js` | `evaluate` | Техническая приёмка ответа |
| `shared/message-delivery.js` | `batchEvent` | Журнал доставки |
| `shared/report-digest.js` | `customStageId`, `latestCustomRunId`, `customFlowReport` | Extract (Transport) для прогона Basic |
| `pipeline/pipeline-runtime.js` | `MODELS` | Список моделей холста |

## results.js: области и функции

Все функции и константы находятся в `results.js`.

| Область | Символы | Что делает |
| --- | --- | --- |
| Схема со страницы | `basicSchemaFromPage`, `buildBasicRun`, `legacyValue`, `legacyDiscipline`, `customRoleText`, `customStepsFromPlan` | Собирает схему из страницы и переводит старые настройки в поля схемы |
| Запись и хранилище | `recordFromSchema`, `installBasicSchema`, `persistBasicSettings`, `persistPipelineStore`, `readPipelineStore`, `normalizePipelineStore`, `migrateBasicTemplateName`, `basicWorkingFromConfig`, `adoptBasicWorking`, `persistActiveDraftPlan` | Запись из схемы, установка схемы на холст, сохранение и чтение хранилища |
| Save, Export, Import | `savePipeline`, `buildBasicExport`, `exportBasicSchema`, `importBasicSchemaFile`, `importBasicBundle`, `handlePipelineImportFile`, `describeSchemaErrors` | Сохранение записи, файл схемы, загрузка файла, сообщения об ошибках схемы |
| Явные значения и запуск | `basicRunForSave`, `markBasicRunExplicit`, `basicRunExplicit`, `basicSchemaLoadErrors` | Какие значения считаются явными и проверка перед запуском |
| Окна настроек | `renderCustomBlockInspector`, `openStageCard`, `setCustomRoundSetting`, `setCustomRoundPrompt`, `resolveCustomFields`, `customDisciplineDefaults` | Окно настроек модели, открытие окна раунда, значения раунда и модели |
| Сборка запроса | `composeCustomPrompts`, `prepareCustomPrompts`, `customLengthInstruction` | Дописывает особенность модели, инструкцию длины и требования к содержанию |
| Прогон | `runCustomFromPage`, `startDebateFromPage`, `askCustomDecision`, `askCustomOwner`, `customRunProgress`, `isCustomEnginePipeline` | Запуск Basic со страницы, окна паузы и вопросов, состояние холста |
| Транспорт и карточки ответа | `runModelBatch`, `pipelineWaiter`, `updateDebateModelCardOutput` | Отправка запросов моделям, ожидание ответов, карточки ответа и итога |
| Холст | `draftPlanForCanvas`, `applyPipelineConfig`, `syncPipelineRoundModelsFromSelectedLLMs`, `getActiveDraftPlan` | План холста и применение конфигурации к холсту |

## Тесты

| Файл | Что проверяет |
| --- | --- |
| `tests/custom-engine.test.js` | Движок: шаги, запросы, приём, повторы, бюджет, пауза, вопросы |
| `tests/custom-run-record.test.js` | Запись о прогоне, хранение, экспорт, состояние `not_sent` |
| `tests/custom-extract.test.js` | Разбор прогона в Extract (Transport) |
| `tests/basic-schema.test.js` | Формат схемы: наследование, сборка, проверка, `toCanvas`, `toSettings` |
| `tests/basic-schema-guide.test.js` | Инструкция автора схем совпадает с кодом |
| `tests/basic-docs-refs.test.js` | Ссылки и имена в документах Basic совпадают с кодом |
| `tests/stage-card-basic.test.js` | Окно настроек раунда |
| `tests/results-debate-favorites.test.js` | Страница целиком: окна настроек, прогон, Save, Import, Export, установка схемы |
| `tests/pipeline-presets.test.js`, `tests/pipeline-none-mini-prompt.test.js` | Список шаблонов и их умолчания |

## Что менять при типичных изменениях

| Изменение | Что трогать | Что обновить в документах |
| --- | --- | --- |
| Добавить поле в схему | `disput/basic-schema.js`: `validate`, `assemble`, `toSettings`, `toCanvas` по смыслу; страница: `basicSchemaFromPage` | `basic-schema-reference.md`, `basic-schema-guide.md` (таблица полей и примеры); тесты `tests/basic-schema.test.js`, `tests/basic-schema-guide.test.js` |
| Изменить значение по умолчанию | `BasicSchema.DEFAULTS` в `disput/basic-schema.js` (меняет все схемы, которые поле не задают) | `basic-engine-and-schemas.md`, раздел «Совместимость»; таблица умолчаний в `basic-schema-guide.md`, раздел 4 |
| Добавить событие журнала | `emit(` в `disput/custom-engine.js` (для событий страницы — `batchEvent` в `results.js`) | Таблица в `basic-how-it-works.md`, раздел «События журнала и запись о прогоне»; `basic-diagnostics.md` |
| Изменить текст итога «Basic · итог» | `runCustomFromPage` в `results.js` | `basic-how-it-works.md`, раздел «Как формируется "Basic · итог"» |
| Добавить окно настроек или поле в окно раунда | `results/stage-card.js`, `openStageCard`, `setCustomRoundSetting`, схема | `basic-schema-reference.md`, `basic-schema-guide.md` |
| Изменить Save, Import или Export | `recordFromSchema`, `installBasicSchema`, `buildBasicExport`, `importBasicSchemaFile` | `basic-engine-and-schemas.md`, разделы «Save» и «Export и Import схемы»; `basic-schema-reference.md`, раздел «Как схема хранится в записи pipeline» |
| Добавить модель или роль | `MODELS` в `pipeline/pipeline-runtime.js`; роли — `judgeSystemPrompts` в `prompts.json` | Списки 7.1 и 7.2 в `basic-schema-guide.md`, иначе упадёт `tests/basic-schema-guide.test.js` |

## Где читать дальше

- [basic-start-here.md](basic-start-here.md) — что такое Basic, схема, запись и основные термины.
- [basic-how-it-works.md](basic-how-it-works.md) — как идёт прогон и что появляется на странице.
- [basic-diagnostics.md](basic-diagnostics.md) — как искать причину, если прогон пошёл не так.
