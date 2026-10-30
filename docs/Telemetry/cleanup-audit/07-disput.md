# 07. Disput (сжатый отчёт агента)

Ответ на ключевой вопрос: модульно да, продуктово нет. Ни один файл `disput/` и `results/debate-*.js` не импортирует `shared/proof-*`, `background/proof-telemetry-*`, `background/telemetry-logs`, `telemetry-spec`. Но трейс не производит собственных событий о моделях: они получаются переводом меток старой диагностики на странице `results.js`:

- таблица соответствий `diagnosticTraceMapping`: `results.js:2915-2942`;
- приём `appendDebateDiagnosticTrace` (provenance `legacy_adapter`): `results.js:2987-3040`;
- приём логов: `results.js:18991-19019`, `ingestLogs` в `17381-17383`;
- экспорт перепроигрывает legacy-события: `results.js:22086-22095`; пустой трейс заменяется legacy-строками: `22108-22110`.

События, которые приходят только так: `SUBMIT_*`, `GENERATION_OBSERVED`, `TEXT_STABLE`, `COMPLETION_DETECTED`, `MODEL_TERMINAL_COMMITTED`, `RECOVERY_*`, `MANUAL_RECOVERY_REQUESTED`, `STABLE_TEXT_FALLBACK_USED`, `STATE_DIVERGENCE`, `STALE_EVENT_REJECTED`, `CORRELATION_REJECTED`, `DUPLICATE_FINAL_REJECTED`, `OBSERVER_STOPPED`, `UI_PROJECTION_FAILED`, `ANSWER_REJECTED`, `BARRIER_WAITING`.

Чтобы трейс стал автономным, нужно переписать переводчик на нативные события, а не просто удалить модули.

## Что записывается

Три слоя:

1. **Trace** (`disput/debate-trace-schema.js`, VERSION 6): событие с `eventType` (около 100 типов, schema:12-38), `source`, `severity`, `correlation`, `causality`, санитизированный `payload`, `provenance`, `semanticHash`. Санитизация: ключи text/content/prompt/answer/html/secret и т.п. → `[REDACTED]`, строки обрезаются до 240 символов. Отчёт `buildReport` (`debate-trace-projections.js:267-360`, schemaVersion 2): metadata, plan, collection, completeness, runOutcome, health (success/degraded_success/partial_success/failed/cancelled/incomplete/running), diagnoses, stageExecutions, participantExecutions, barriers, dispatchAttempts, recoveryAttempts, stateDivergences, criticalPath, events, integrity.
2. **Aggregate** (`debate-run-store.js`, VERSION 6): состояние прогона и журнал `events` до `MAX_EVENTS=500`; ограниченные списки (promptExecutions 200, stateDeltas 200, humanDecisions 100, ruleEvaluations 500, modelSignals 200).
3. **Custom-run record** (`custom-run-record.js`): конвейер Custom/Basic; тексты дедуплицируются по FNV; схема описана в `docs/Pipeline scenarios/basic-start-here.md:284-290`.

## Хранение

- Trace: только память, `MAX_RUNS=2`, `MAX_EVENTS_PER_RUN=3000` (`debate-trace-store.js:7-8`); перезагрузка страницы стирает. Store лишь удаляет старые legacy-ключи (`:59-62`).
- Aggregate: `chrome.storage.session` ключ `llmCodexDebateRun.v1` (`results/debate-transport.js:24-48`); незавершённый прогон при загрузке отбрасывается (`results.js:5237-5241`).
- Оркестратор: `localStorage` `disputOrchestratorV2:<runId>:*`; в production `persistRunData: false` (`results.js:7511-7512`), реально живёт только lease.
- Custom-run: `chrome.storage.local` `customRunRecords.index` и `customRunRecord.<runId>`, лимит 4 МиБ.

## Показ и экспорт

`results/debate-telemetry-view.js`: сетка здоровья (10 ячеек), таблица проблем, таблица сырых событий, флажок Only problems (только отображение). Экспорт: JSON (`results.js:17186-17209`), MD (`17138-17156`, `DebateTraceProjections.toMarkdown`), Extract. `filterProblems` в production не вызывается (тест `telemetry-export-actions.test.js:222` запрещает).

Размер: около 640 байт на событие (синтетика), `serialize()` 3000 событий около 1,98 МБ; реальные данные не мерили.

## Мягкие связи с legacy

- `debate-trace-schema.js:62` → `SecretRedaction.redactString` (общий модуль, есть свои regex).
- `debate-telemetry-view.js:7-8` → `shared/problem-context-filter.js` (с откатом на severity).
- `results/boot-utils.js:55-67` → `LLM_DIAGNOSTIC_EVENT` (`router 5304`); `:88-112` → `CLEAR_DIAG_EVENTS` (`router 4720`).
- Остальное через внедряемые хуки `deps.onTraceEvent` и т.п. (`debate-application.js:183-204`).

## Находки

1. Вытеснение при переполнении 3000 удаляет `RUN_STARTED`/`STAGE_STARTED` (не критичные по `schema:40-44`): `startedAt` и `durationMs` становятся null, деviation `missing_stage_start` → ложный `degraded_success` (`projections:46-47, 125, 170-180`); `evictedEvents` не отражается в health.
2. Не эмитятся в production: `SUBMIT_ATTEMPTED`, `STAGE_ARTIFACT_PRODUCED`, `STAGE_SKIPPED`, `BARRIER_OPENED/RELEASED/PARTICIPANT_READY/FAILED/TIMEOUT`.
3. `DebateProcessAudit.audit` вызывается только в тестах; `processAudit` в aggregate всегда null, хотя `debate-epistemic-outcome.js:8` его читает.
4. `DebateStateDelta` в production не вызывается.
5. «Durable» оркестратор: `persistRunData:false` (см. выше).
6. Похожие ключи: `llmCortexDebateEngineState.v1` (`debate-engine.js:7`) и `llmCodexDebateRun.v1`. Легко перепутать.
7. Дедупликация legacy-записей по ключу из `ts`, `llmName`, `label` (`results.js:3011`) может давать коллизии (не проверено).

Не читались: `summarize-report.js`, `MessageDeliveryView`, `telemetry-logs.js`, `proof-*`; расширение в браузере не запускалось.
