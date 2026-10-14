# Реестр: что остаётся от Debate при переходе на Basic

Версия кода: 2.81.771 (коммит `65eb3da`), составлен 14.10.2026. Цель: решить, что можно убрать вместе со старым движком Debate. Удаление этим документом не выполняется.

**Метод.** Граф ссылок между модулями (скрипт по `manifest.json`, `importScripts`, `<script src>` и глобальным именам), затем разбор четырьмя областями (`disput/debate-*`, `shared`/`background`/`pipeline`, `results.js` и страницы) по чтению кода; ключевые утверждения (запуск через `debateApplication`, условие подписчика, запасной вариант пресета, места создания оркестратора) перепроверены вручную. Разбор — статический, в браузере не запускался.

**Путь Basic** — всё, что достижимо из `runCustomFromPage`/`resumeCustomFromPage`, холста Basic, кнопок Пуск/Пауза/Стоп и транспорта `runModelBatch`.

**Классы:** `BASIC` нужен только Basic; `SHARED` нужен Basic и другим компонентам; `DEBATE` нужен только Debate и его интерфейсу; `ORPHAN` не нужен никому.

## 1. Главные факты

1. **Basic запускается через обёртку Debate.** `window.runPipeline` → `debateApplication.startFromPage` (`disput/debate-application.js:272`) → `startDebateFromPage` (`results.js:7655`) → при `runner: 'custom'` → `runCustomFromPage`. Оркестратор, планировщик и исполнитель этапов Debate при этом **не создаются** (`createUniversalRun` вызывается только при старте Debate).
2. **Debate всё ещё достижим.** `getPipelinePreset` возвращает `UNIVERSAL_STANDARD` для любого неизвестного id (`disput/pipeline-presets.js:41`), пресет включён, а у него нет `runner`. Сохранённый pipeline с чужим `presetId` запустится как Debate.
3. **Транспорт прогона общий.** `runModelBatch` (`results.js:6218`) обслуживает и Basic, и Debate; внутри него события пишутся в `DebateRunStore`, и `results/debate-transport.js` сохраняет их в `chrome.storage.local` под `llmCodexDebateRun.v1` при каждом прогоне Basic.
4. **Подписчик на события (`results.js:2863`) при Basic не срабатывает**: он требует `aggregate.runId`, который ставит только `START_REQUESTED`, а Basic его не шлёт. Трасса, карта состояния, история правил и дела при Basic не наполняются.
5. **Размеры.** `disput/debate-*.js` — 8 229 строк (из них движок: оркестратор, планировщик, ревизии плана, исполнитель, политики — 3 166). В `results.js` блоки DEBATE — около 3 230 строк (≈12% из 27 064), ещё около 500 строк смешанных.

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
`debate-orchestrator`, `debate-orchestrator-persistence`, `debate-planner`, `debate-plan-revision`, `debate-stage-executor`, `debate-participant-registry`, `debate-policies`, `debate-problem-spec`, `debate-prompt-compiler`, `debate-prompt-pack`, `debate-artifact-pipeline`, `debate-capability-registry`, `debate-context-broker`, `debate-contracts`, `debate-case-schema`, `debate-case-store`, `debate-execution-context`, `debate-rule-history`, `debate-state-map`, `debate-trace-projections`, `debate-trace-schema`, `debate-trace-store`, `debate-projections`, `pipeline-profile-store`, `debate-application`. Для `debate-application.js` сначала переключить запуск Basic напрямую (см. раздел 6).

**`results.js`** (диапазоны ±3 строки): 2738–2931 (дела, трасса), 3755–3877 (порядок промптов судьи), 5468–5712 (контекст и шаги Debate), 5796–5871 и 5906–5927 (пауза/продолжение Debate), 5980–6199 (approve и состояние раундов), 6578–6796 (судья, тема диспута), 7655–7881 (`startDebateFromPage`, кроме ветки `custom`), 7905–8014 (`createApplication`), 22171–22934 (схема, транскрипт и сессии дебатов, timeline, Markdown потока), 23157–23192, 23716–23765, 23891–23950, 24053–24339, 24469–24523, 24587–24761, 25349–25590 (судья, Send судьи, Comparative Analysis), 26934–26991.

**Сообщения `chrome.runtime`:** `PIPELINE_FSM_EVENT`, `CANCEL_PIPELINE_RUN` (проверить, не используется ли из Stop Basic), `START_EVALUATION_WITH_PROMPT`, `EVALUATOR_RESPONSE`. Файлы: `shared/judge-prompt-builder.js`, `background/evaluation-manager.js`.

**Ключи `chrome.storage`:** `llmCodexDebateTrace.v1`, `llmCortexDebateEngineState.v1`, `llmCodexDebateRuleHistory.v1`, `disputDebateCaseIndexV1`/`disputDebateCaseV1:*`, `llmCodexDebateFullAnswers.v1`, `llmCodexDebateSelectors.v1`, `llmDisputAutoMode.v1`. (`llmCodexDebateRun.v1` — общий, см. раздел 2.)

## 5. Не нужно никому (удаляется сразу)

`disput/debate-artifact-definitions.js`, `debate-convergence.js`, `debate-correlation-guard.js`, `debate-decision-request.js`, `debate-epistemic-outcome.js`, `debate-model-signal.js`, `debate-process-audit.js`, `debate-protocol-transition-service.js`, `debate-protocols.js`, `debate-rule-engine.js`, `debate-service-roles.js`, `debate-stage-types.js`, `debate-stagnation-warning.js`, `debate-state-delta.js`, `debate-storage-migrations.js`; `shared/debate-schema.js`; обработчик `COLLECT_RESPONSES`; ключ `llmCortexDebateBackgroundExecutor.v1` (только удаляется); ключ `llmCodexDebateScheme.v1` (только читается); функции без вызовов в `results.js`: `getDebateParticipantRoleText`, `getActiveProtocolMission`, `pushSerialDebateTimeline`, `syncAggregateProtocolState`. Вне Debate: `shared/log-replay-harness.js` (только тесты), `shared/proof-telemetry-semantic-comparator.js` (только `package.json`).
Все 15 файлов `disput/` из этого раздела подключены тегами `<script>` в `pipeline_panel.html` и `result_new.html`; в `manifest.json` (`web_accessible_resources`) перечислены 13 из 15 (нет `debate-state-delta.js` и `debate-storage-migrations.js`); `shared/debate-schema.js` подключён только в страницах. Эти подключения удаляются вместе с файлами. Модули, читаемые `debate-version-manifest.js` (только `VERSION`), после удаления дают в записях версию по умолчанию.

## 6. Связность, мешающая удалению, и порядок

1. **Переключить запуск Basic напрямую.** `window.runPipeline` вызывает `runCustomFromPage` без `debateApplication`; `startDebateFromPage` остаётся без ветки Debate или удаляется.
2. **Убрать запасной вариант пресета.** `getPipelinePreset` не должен подставлять `UNIVERSAL_STANDARD`; пресет «Universal» отключить, сохранённые pipelines с неизвестным `presetId` отбрасывать (механизм `RETIRED_PIPELINE_PRESET_IDS` уже есть).
3. **Вынести общее из Debate-имён**: `DebateContextBudget`, `DebateResponseAcceptance`, `DebateStageMarkers`, `DebateDraftPlan`, `DebateRunStore`/`DebateTransport` (и ключ `llmCodexDebateRun.v1`), хранилище транскрипта и карточки. Переименовать в нейтральные имена и подключить `stage-markers.js`, `stage-card.js`, `choice-dialog.js` на всех живых страницах.
4. **Разделить `runModelBatch`**: убрать Debate-ветки (`dispatchDebateRunEvent`, анонимизацию, `debateApplication`).
5. **Удалить раздел 5** (безопасно уже сейчас) и затем раздел 4 по блокам: сначала `results.js` блоки, потом файлы `disput/`, сообщения и ключи, затем теги `<script>`, записи манифеста и тесты этих модулей.
6. **Страница `result_new.html`** — живая (главная), но не подключает `stage-card.js`, `choice-dialog.js`, `owner-ask.js`, `stage-markers.js`: Basic на ней не работает. Решить, нужна ли эта страница отдельно от `pipeline_panel.html`.

## 7. Не проверено

- Каталог `results/` (кроме `debate-transport.js`): файлы `debate-controller.js`, `debate-export.js`, `debate-plan-view-model.js`, `debate-renderer.js`, `debate-sessions-store.js`, `debate-telemetry-view.js`, `debate-ui.js` не разбирались; по именам это интерфейс Debate, но подтверждения нет.
- `shared/budgets.js`, `shared/problem-context-filter.js`, блок `results.js` 14794–16420 (≈1 600 строк), смешанные блоки (≈500 строк).
- Использует ли Stop у Basic `cancelPipelineRun` и сообщение `CANCEL_PIPELINE_RUN`.
- Запись трассы и дел при восстановленном из хранилища прогоне Debate.
- Ничего не запускалось в браузере; тесты, которые придётся удалить или изменить вместе с модулями, не перечислены.
