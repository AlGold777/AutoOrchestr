# Реестр: что остаётся от Debate при переходе на Basic

Версия кода: 2.81.771 (коммит `65eb3da`), составлен 14.10.2026, исправлен после повторной проверки того же дня (раздел 8). **Разделы 2–7 описывают состояние на 2.81.771; актуальное состояние на 2.81.783 — раздел 10.** Цель: решить, что можно убрать вместе со старым движком Debate. Удаление этим документом не выполняется.

**Метод.** Граф ссылок между модулями (скрипт по `manifest.json`, `importScripts`, `<script src>` и глобальным именам), затем разбор четырьмя областями (`disput/debate-*`, `shared`/`background`/`pipeline`, `results.js` и страницы) по чтению кода; ключевые утверждения (запуск через `debateApplication`, условие подписчика, запасной вариант пресета, места создания оркестратора) перепроверены вручную. Разбор — статический, в браузере не запускался.

**Путь Basic** — всё, что достижимо из `runCustomFromPage`/`resumeCustomFromPage`, холста Basic, кнопок Пуск/Пауза/Стоп и транспорта `runModelBatch`.

**Классы:** `BASIC` нужен только Basic; `SHARED` нужен Basic и другим компонентам; `DEBATE` нужен только Debate и его интерфейсу; `ORPHAN` не нужен никому.

## 1. Главные факты

1. **Basic запускается через обёртку Debate.** `window.runPipeline` → `debateApplication.startFromPage` (`disput/debate-application.js:272`) → `startDebateFromPage` (`results.js:7655`) → при `runner: 'custom'` → `runCustomFromPage`. Оркестратор, планировщик и исполнитель этапов Debate при этом **не создаются** (`createUniversalRun` вызывается только при старте Debate).
2. **Debate всё ещё достижим.** `getPipelinePreset` возвращает `UNIVERSAL_STANDARD` для любого неизвестного id (`disput/pipeline-presets.js:41`), пресет включён, а у него нет `runner`. Сохранённый pipeline с чужим `presetId` запустится как Debate.
3. **Транспорт прогона общий.** `runModelBatch` (`results.js:6218`) обслуживает и Basic, и Debate; внутри него события пишутся в `DebateRunStore`, и `results/debate-transport.js` сохраняет их в `chrome.storage.local` под `llmCodexDebateRun.v1` при каждом прогоне Basic.
4. **Подписчик на события (`results.js:2863`) при Basic не срабатывает**: он требует `aggregate.runId`, который ставит только `START_REQUESTED`, а Basic его не шлёт. Трасса, карта состояния, история правил и дела при Basic не наполняются.
5. **Диагностика Basic построена на модулях трассы Debate.** Отчёт Disput Flow для прогона Basic (`debateRunId`, `stageExecutions` с этапами `custom:…:s1`) собирает `DebateTraceProjections.buildReport` из событий, которые `appendDebateDiagnosticTrace` складывает в `DebateTraceStore` (`results.js:2932`, `22841`, обработчики экспорта `17650–17740`). Эти модули нельзя удалять вместе с Debate: на них держится основной инструмент отладки Basic.
6. **Размеры.** `disput/debate-*.js` — 8 229 строк (из них движок: оркестратор, планировщик, ревизии плана, исполнитель, политики — 3 166). В `results.js` блоки DEBATE — около 3 230 строк (≈12% из 27 064), ещё около 500 строк смешанных.

## 2. Нужно Basic: удалять нельзя, пока нет замены

| Что | Где | Зачем Basic |
| --- | --- | --- |
| `runModelBatch` | `results.js:6218–6577` | транспорт отправки; содержит вызовы `DebateTransport`, `DebateRunStore`, `DebateAnonymization` |
| `DebateContextBudget` | `disput/debate-context-budget.js` | лимит длины запроса (`results.js:7517, 7523`) |
| `DebateResponseAcceptance` | `disput/debate-response-acceptance.js` | приёмка ответа (`results.js:7526`) |
| `DebateStageMarkers` | `disput/stage-markers.js` | разбор `[[ASK]]` (`results.js:7527`); подключён только в `pipeline_panel.html` |
| `DebateDraftPlan` | `disput/debate-draft-plan.js` | холст: `draftPlanForCanvas`, `recordFromSchema` |
| `DebateRunStore` | `disput/debate-run-store.js` | события транспорта, `results.js:6388, 6556` |
| `DebateTransport` | `results/debate-transport.js` | `dispatchBatch` → `START_FULLPAGE_PROCESS`; запись `llmCodexDebateRun.v1` |
| `DebateEngine` (хранилище транскрипта) | `disput/debate-engine.js` | `appendBasicRunLine` пишет карточки в транскрипт |
| `debate-runtime.js` (`DebateFSM`) | `disput/debate-runtime.js` | `ensureDebateCardMessage`, `updateDebateModelCardOutput` |
| `DebatePromptCatalog` | `disput/debate-prompt-catalog.js` | `normalizeMaxWords`, `getDebateMaxWords` |
| `DebateAnonymization` | `disput/debate-anonymization.js` | внутри `runModelBatch` (для Basic выключена) |
| `DebateProfileSchema`, `debate-version-manifest.js` | `disput/` | профили при инициализации списка; манифест версий читает `DebateRunStore` |
| `CHECK_PARTICIPANT_ANSWER`, `PARTICIPANT_CHAT_BINDINGS` | `background/pipeline-message-handlers.js:82–92` | проверка и привязки чатов Basic |
| Карточки и лента | `results.js` 23766–23890 (`renderDebateModelCards`, `appendModeratorFeedEntry`), 24340–24468, 24524–24586 | вывод ответов Basic |
| `getDebateRunControls`, `getDebateRunPolicy`, `isDebateAutoPolicy`, `openOwnerAsk` | `results.js` 5713–5979 | кнопки Пуск/Стоп и политика Basic |
| Ключи Basic | `customRunRecord.*`, `customRunRecords.index` | записи прогонов |
| **Трасса и отчёт диагностики** | `disput/debate-trace-store.js`, `debate-trace-schema.js`, `debate-trace-projections.js`; `results/debate-telemetry-view.js`; `shared/report-digest.js`; `results.js` 2810–3082 (`appendDebateTraceEvent`, `appendDebateDiagnosticTrace`), 17650–17740 (кнопки Disput Flow JSON/MD, Extract), 22841–22934 (`buildDisputExportPayload`, строки таймлайна) | отчёт Disput Flow и Extract для любого прогона, в том числе Basic |
| **Сессии и лента** | `results/debate-sessions-store.js` (`debateTabsState`), `debateFeedState`, `ensureDebateSession` (`results.js:7197` в `appendBasicRunLine`), `results.js` 22171–22669 (вкладки сессий, транскрипт) | карточки и вкладки ленты Basic |
| **Управление запуском** | `results/debate-controller.js` (`deriveRunControls`), `results/debate-renderer.js` (`renderRunControls`) | вид кнопки Пуск/Пауза/Стоп (`results.js:5954, 5970`) |
| **Экспорт ленты** | `results/debate-export.js` (`buildFeedDocument`, `buildFeedText`, `fileStamp`) | выгрузка ленты в HTML и Markdown (`results.js:26953–27003`) |

Имена «Debate» в этих файлах — история именования, а не принадлежность: после удаления остального их стоит переименовать в нейтральные.

## 3. Общее с другими компонентами (нужно вынести, не удалять)

| Что | Кто ещё использует |
| --- | --- |
| `shared/message-delivery*.js`, `report-digest.js`, `telemetry-logs.js` | телеметрия, отчёт Disput Flow, журнал доставки |
| `utils/`, `workers/`, `content-scripts/` | ответы моделей, селекторы, главная страница |
| `pipeline/pipeline-runtime.js` | стеки моделей (кроме части про судью) |
| Главная страница: отправка, избранное, экспорт ответов, заметки, сессии (`results.js` 10300–22009 и 23193–23715) | вне Debate |

## 4. Нужно только Debate (удаляется вместе с Debate)

**Файлы `disput/`** (используют только `DebateApplication` и его запуск):
`debate-orchestrator`, `debate-orchestrator-persistence`, `debate-planner`, `debate-plan-revision`, `debate-stage-executor`, `debate-participant-registry`, `debate-policies`, `debate-problem-spec`, `debate-prompt-compiler`, `debate-prompt-pack`, `debate-artifact-pipeline`, `debate-capability-registry`, `debate-context-broker`, `debate-contracts`, `debate-case-schema`, `debate-case-store`, `debate-execution-context`, `debate-rule-history`, `debate-state-map`, `debate-projections`, `pipeline-profile-store`, `debate-application`. (Модули трассы `debate-trace-*` сюда НЕ входят: см. раздел 2.) Для `debate-application.js` сначала переключить запуск Basic напрямую (см. раздел 6).

**`results.js`** (диапазоны ±3 строки): 2738–2809 (дела, `debateCaseStore`), 3755–3877 (порядок промптов судьи), 5468–5712 (контекст и шаги Debate), 5796–5871 и 5906–5927 (пауза/продолжение Debate), 5980–6199 (approve и состояние раундов), 6578–6796 (судья, тема диспута), 7655–7881 (`startDebateFromPage`, кроме ветки `custom`), 7905–8014 (`createApplication`), 22171–22479 только в части схемы и синтезатора Debate (`getDebateSchemeModelLimit`, `renderSynthesisStage`; вкладки сессий, состояние ленты и холст в этом диапазоне общие — разбирать по функциям), 23157–23192, 23716–23765, 23891–23950, 24053–24339, 24469–24523, 24587–24761, 25349–25590 (судья, Send судьи, Comparative Analysis).

**Сообщения `chrome.runtime`:** `PIPELINE_FSM_EVENT`, `CANCEL_PIPELINE_RUN` (проверить, не используется ли из Stop Basic), `START_EVALUATION_WITH_PROMPT`, `EVALUATOR_RESPONSE`. Файлы: `shared/judge-prompt-builder.js`, `background/evaluation-manager.js`.

**Ключи `chrome.storage`:** `llmCodexDebateTrace.v1`, `llmCortexDebateEngineState.v1`, `llmCodexDebateRuleHistory.v1`, `disputDebateCaseIndexV1`/`disputDebateCaseV1:*`, `llmCodexDebateFullAnswers.v1`, `llmCodexDebateSelectors.v1`, `llmDisputAutoMode.v1`. (`llmCodexDebateRun.v1` — общий, см. раздел 2.)

## 5. Не нужно никому (удаляется сразу)

`disput/debate-artifact-definitions.js`, `debate-convergence.js`, `debate-correlation-guard.js`, `debate-decision-request.js`, `debate-epistemic-outcome.js`, `debate-model-signal.js`, `debate-process-audit.js`, `debate-protocol-transition-service.js`, `debate-protocols.js`, `debate-rule-engine.js`, `debate-service-roles.js`, `debate-stage-types.js`, `debate-stagnation-warning.js`, `debate-state-delta.js`, `debate-storage-migrations.js`; `shared/debate-schema.js`; `results/debate-plan-view-model.js` (ссылок не найдено; `results/debate-ui.js` сюда НЕ входит: его глобал `ResultsDebateUi` вызывается из `results.js:3978, 22414`); обработчик `COLLECT_RESPONSES`; ключ `llmCortexDebateBackgroundExecutor.v1` (только удаляется); ключ `llmCodexDebateScheme.v1` (только читается); функции без вызовов в `results.js`: `getDebateParticipantRoleText`, `getActiveProtocolMission`, `pushSerialDebateTimeline`, `syncAggregateProtocolState`. Вне Debate: `shared/log-replay-harness.js` (только тесты), `shared/proof-telemetry-semantic-comparator.js` (только `package.json`).
Все 15 файлов `disput/` из этого раздела подключены тегами `<script>` в `pipeline_panel.html` и `result_new.html`; в `manifest.json` (`web_accessible_resources`) перечислены 13 из 15 (нет `debate-state-delta.js` и `debate-storage-migrations.js`); `shared/debate-schema.js` подключён только в страницах. Эти подключения удаляются вместе с файлами. Модули, читаемые `debate-version-manifest.js` (только `VERSION`), после удаления дают в записях версию по умолчанию.

## 6. Связность, мешающая удалению, и порядок

1. **Переключить запуск Basic напрямую.** `window.runPipeline` вызывает `runCustomFromPage` без `debateApplication`; `startDebateFromPage` остаётся без ветки Debate или удаляется.
2. **Убрать запасной вариант пресета.** `getPipelinePreset` не должен подставлять `UNIVERSAL_STANDARD`; пресет «Universal» отключить, сохранённые pipelines с неизвестным `presetId` отбрасывать (механизм `RETIRED_PIPELINE_PRESET_IDS` уже есть).
3. **Вынести общее из Debate-имён**: `DebateContextBudget`, `DebateResponseAcceptance`, `DebateStageMarkers`, `DebateDraftPlan`, `DebateRunStore`/`DebateTransport` (и ключ `llmCodexDebateRun.v1`), хранилище транскрипта и карточки. Переименовать в нейтральные имена и подключить `stage-markers.js`, `stage-card.js`, `choice-dialog.js` на всех живых страницах.
4. **Разделить `runModelBatch`**: убрать Debate-ветки (`dispatchDebateRunEvent`, анонимизацию, `debateApplication`).
5. **Удалить раздел 5** (безопасно уже сейчас) и затем раздел 4 по блокам: сначала `results.js` блоки, потом файлы `disput/`, сообщения и ключи, затем теги `<script>`, записи манифеста и тесты этих модулей.
6. **Страница `result_new.html`** — живая (главная), но не подключает `stage-card.js`, `choice-dialog.js`, `owner-ask.js`, `stage-markers.js`: Basic на ней не работает. Решить, нужна ли эта страница отдельно от `pipeline_panel.html`.

## 7. Не проверено

- **CSS.** `styles/results-debate.css` (1 719 строк) и около 220 правил `debate-*` в `styles/modals-responsive.css` не разбирались; карточки ленты Basic носят классы `debate-model-card…`, поэтому большая часть общая.
- **Тесты.** Тестов, упоминающих модули Debate, около 52 файлов; поимённо не перечислены, их придётся удалить или изменить вместе с модулями.
- **Смешанные блоки `results.js`.** Диапазоны 2932–3082, 4540–4700, 6797–6842, 9922–10100, 22010–22136, 26323–26933 и блок 14794–16420 (≈1 600 строк) не разбирались по функциям. Диапазоны в разделе 4 — кандидаты, а не готовый список вырезания: перед каждым удалением нужен поиск вызовов по именам функций.
- Снаружи `disput/` и `results.js` глобалы Debate упоминаются только в `results/debate-*.js`, `results/disput-state-map-view.js`, `results/pipeline-profile-view.js` и `shared/debate-schema.js`; `package.json`, `scripts/`, фон и контент-скрипты (кроме режима оценщика) на Debate не ссылаются.
- `shared/budgets.js`, `shared/problem-context-filter.js`; использует ли Stop у Basic `cancelPipelineRun`; запись трассы и дел при восстановленном из хранилища прогоне Debate.
- Ничего не запускалось в браузере.

## 8. Исправления после повторной проверки

Первая версия реестра ошибочно относила к «только Debate» части, на которых держится Basic. Исправлено после независимой проверки (отчёт Disput Flow, ссылки на `window.Debate*` по результатам повторного поиска):
1. Модули трассы и отчёта (`debate-trace-*`, `debate-telemetry-view`, обработчики экспорта) — общие, не Debate: отчёт Basic строится из них.
2. Сессии и состояние ленты, управление запуском и экспорт ленты — общие.
3. Добавлен файл без ссылок `results/debate-plan-view-model.js`. Файл `results/debate-ui.js` сначала тоже попал в этот список, но при удалении выяснилось, что его глобал называется `ResultsDebateUi` и вызывается из `results.js:3978, 22414` (мой поиск искал имя `DebateUI`): он остаётся до разбора этих мест.
4. Блок `results.js` 22171–22934 раньше был целиком «Debate»; теперь смешанный.
Урок для плана удаления: классификацию по файлам и по названию проверять поиском вызовов функций и сверкой с реальным отчётом диагностики Basic, а не только по именам.

## 9. Выполнение

| Шаг | Что | Версия |
| --- | --- | --- |
| 1 | `window.runPipeline` запускает pipeline напрямую; пресет по умолчанию и запасной вариант — `CUSTOM`; пресеты «Universal» и «Red Team» удалены; Debate недостижим из интерфейса | 2.81.772 |
| 2 | Удалены 17 файлов раздела 5 (15 в `disput/`, `shared/debate-schema.js`, `results/debate-plan-view-model.js`) вместе с тегами `<script>`, записями манифеста и шестью тестами их модулей; в четырёх тестах, где они были частью, убраны только их проверки | 2.81.773 |
| 3 | Из `startDebateFromPage` убрана ветка Debate (остался запуск Basic); удалён `createApplication` и все обращения к `debateApplication`, `DebateApplication`, state-map view, `debateCaseStore`, `debateRuleHistoryStore`; удалены 19 модулей (`debate-application`, `-orchestrator`, `-orchestrator-persistence`, `-planner`, `-plan-revision`, `-stage-executor`, `-policies`, `-participant-registry`, `-problem-spec`, `-artifact-pipeline`, `-case-store`, `-case-schema`, `-state-map`, `-rule-history`, `-context-broker`, `-contracts`, `-prompt-compiler`, `-capability-registry`, `results/disput-state-map-view`), панель state-map в `result_new.html`, CSS панели, тесты этих модулей; из `debate-version-manifest.js` убраны штампы удалённых модулей | 2.81.781 |

## 10. Состояние на 2.81.783

Сверено 15.10.2026 по коду (граф ссылок пересобран, ссылки в `results.js` проверены по функциям). В `disput/` осталось 16 файлов `debate-*` (из 49 в начале), в `results/` — 8 файлов `debate-*`. Запуск идёт только на Basic.

| Что осталось | Кто использует | Класс | Что дальше |
| --- | --- | --- | --- |
| `debate-context-budget`, `debate-response-acceptance`, `stage-markers` | запуск Basic (`runCustomFromPage`) | BASIC | оставить; переименовать в нейтральные имена (шаг 3 плана, ниже) |
| `debate-draft-plan` | холст Basic (`draftPlanForCanvas`, `recordFromSchema`) | BASIC | оставить; переименовать |
| `debate-run-store`, `debate-version-manifest`, `results/debate-transport` | события транспорта и запись `llmCodexDebateRun.v1` при каждом прогоне | SHARED | оставить; переименовать, ключ хранилища сменить с миграцией |
| `debate-runtime` (`DebateFSM`), `debate-engine` | карточки и транскрипт ленты Basic (`ensureDebateCardMessage`, `upsertDebateTranscriptTurn`) | SHARED | оставить; переименовать |
| `debate-trace-store`, `debate-trace-schema`, `debate-trace-projections`, `results/debate-telemetry-view` | отчёт Disput Flow и Extract (в том числе для Basic) | SHARED | оставить; переименовать позже, диагностика на них держится |
| `results/debate-sessions-store`, `-controller`, `-renderer`, `-export` | вкладки сессий ленты, кнопка Пуск/Стоп, выгрузка ленты | SHARED | оставить; переименовать |
| `results/debate-ui` (`ResultsDebateUi`) | `results.js`: `formatPipelineProtocolSummary`, `syncDebateSchemeUi` | MIXED | убрать вызовы с запасными ветками, затем файл |
| `debate-prompt-catalog` | `getDebateMaxWords` (нужно), `buildPipelineInfoRoundsHtml` | SHARED | перенести `normalizeMaxWords` в нейтральный модуль |
| `debate-prompt-pack` | только `debate-engine`, `debate-prompt-catalog`, манифест версий | SHARED (косвенно) | убрать вместе с зависимостью каталога |
| `debate-profile-schema`, `pipeline-presets` | профили для пресета `CUSTOM`, `buildDefaultPipelinePresets` | SHARED | оставить; решить судьбу профилей (ниже) |
| `debate-anonymization` | только `runModelBatch` (для Basic выключена) | DEBATE | убрать вместе с ветками в `runModelBatch` |
| `debate-execution-context` | `ensureDebateExecutionContext`, ожидание подтверждений (approve) | DEBATE | убрать вместе с approve-карточками и `waitForDebateApproval` |
| `debate-projections` | только `collectDebateArtifact` (отладка, `window.__pipelineLifecycleDebug`) | DEBATE | удалить с функцией и тестами |
| `pipeline-profile-store`, `results/pipeline-profile-view`, диалог «Pipeline profiles» | редактор JSON профилей | УДАЛЕНО (2.81.784) | кнопка `#pipeline-profile-btn` оставлена неактивной заглушкой по решению владельца |

**Решения владельца:** (1) кнопка «Pipeline profiles» остаётся визуальной заглушкой, весь связанный код удалён (сделано в 2.81.784); (2) хранилища `llmCodex`/`llmCortex` (`llmCodexDebateRun.v1` и др.): переименованы с миграцией (сделано в 2.81.785, `shared/storage-key-migration.js`).

**Что ещё сделать (порядок):**
1. Убрать из `runModelBatch` анонимизацию и вызовы, нужные только Debate; убрать `debate-anonymization`, `debate-execution-context`, `debate-projections` вместе с approve-карточками, `waitForDebateApproval`, `collectDebateArtifact`, судьёй/оценщиком и их тестами.
2. Убрать вызовы `ResultsDebateUi` и сам файл.
3. Переименовать общее из `Debate*` в нейтральные имена (`RunStore`, `Transcript`, `Trace`, …) и сменить ключи хранилища с миграцией (одним коммитом на модуль, с тестами).
4. Проверить CSS (`styles/results-debate.css`, классы `debate-*` нужны карточкам ленты) и тесты, привязанные к удалённому.

Не проверено в браузере; блоки `results.js` по функциям (раздел 7) остаются кандидатами.
