# 03. Хранение и сбор в `background/` (сжатый отчёт агента)

## Четыре приёмника каждого события

1. Proof-ledger в IndexedDB `proof-telemetry-v6`: все события, без сэмплирования.
2. Кольцо `__diagnostics_events__` в `chrome.storage.local`: до 2000 записей и 1,5 МБ, только сэмплированные сессии (5%), плюс pinned, error, force.
3. `jobState.llms[x].logs`: 120 записей на модель; каждая запись вызывает `saveJobState` (`telemetry-logs.js:293`).
4. Страница результатов: `LLM_DIAGNOSTIC_EVENT` с до 120 записями логов в каждом сообщении (`telemetry-logs.js:399-411`).

## Файлы

- `proof-telemetry-ledger.js` (1028): единственный писатель schema-6; очередь мутаций; `record` вызывают `telemetry-logs.js:660` и `message-router.js:4565`; `beginRun` из `job-orchestrator.js:5275`; `clear` из `message-router.js:2132` и `:4724`. Лимиты: `MAX_PENDING_EVENTS=200`, `MAX_QUARANTINE_EVENTS=200`, `MAX_LEGACY_DEBUG_RECORDS=200`. `MAX_EVENTS=10000` (строка 8) не применяется. `stagingLosses`, `signalStates`, `noopCounts`, `producerSequences`, `operationalIntervals` растут без лимита в пределах прогона и попадают в `runtime-state`.
- `proof-telemetry-store.js` (279): IndexedDB `proof-telemetry-v6`, stores `lifecycle`, `canonicalEvents`, `incidents`, `quarantine`, `attachments`, `meta`; указатель `__proof_telemetry_active_pointer_v6__` пишется при каждом `saveState`. Retention по возрасту и размеру нет, очистка только `clearActive`. Мёртвое: `recoverIndexes`, `putAttachment`, `getAttachment` (store `attachments` всегда пуст).
- `telemetry-logs.js` (816): таксономия `normalizeTelemetryTaxonomy` (171-236), сэмплирование `TELEMETRY_SAMPLE_RATE=0.05` (строка 17, решение по хэшу `runSessionId`), `PINNED_LABELS` (498-590), `POST_TERMINAL_NOISE_LABELS` (33-69), кольцо с дельта-сжатием меты. `DIAGNOSTICS_STORAGE_ENCODING_VERSION=4` не используется.
- `selector-metrics.js` (549): ключи `selectorResolutionMetrics`, `selector_health_failures`, `selector_health_meta`, `selector_health_checks`, `selector_health_profile_v1` (читает `content-utils/selector-resolver-v2.js:977`), `selector_override_audit` (80 записей), `selectors_version_status`, `selectors_remote_override` (общий с `selectors-config.js`). Мёртвое: `primeVersionStatusAudit` (alarm не создаётся), `REQUEST_SELECTOR_VERSION_STATUS` без вызова из UI.
- `health-monitor.js` (411): без storage; `HEARTBEAT_TIMEOUT` не используется.
- `cleanup-manager.js` (157): `DEBUG_CLEANUP_LOGS/TELEMETRY = false`, блок `CLEANUP_STATE` не выполняется; `SMART_CLEANUP_EVENT` отправляется всегда.
- `state-manager.js` (420): `emitStateMachineTelemetry` с `force: true` (в обход сэмпла): `STATE_DIVERGENCE_DETECTED`, `MODEL_RUN_TRANSITION`, `STATE_PROJECTION_COMMITTED`; `appendLogEntry` для `STATUS_IGNORED` и `Status: X` минует ledger и кольцо.
- `b1-skeleton-collector.js` (153): по запросу UI собирает DOM-скелеты, в хранилище не пишет.
- `shared/logger.js` (79): только консоль; `LLMLog.warn/error` не вызываются; ключ `__llm_debug_logging__` никто не записывает.
- `shared/storage-budgets.js` (53): TTL-ветка для `__diagnostics_events__` срабатывает только на несжатом массиве; кольцо сжимается (`__LZ__`), поэтому на практике не работает.
- `shared/budgets.js` (39): нигде не загружается.
- `shared/observer-health.js` (188): только контент, не background.

## Ключи хранилища

IndexedDB `proof-telemetry-v6`; `__proof_telemetry_active_pointer_v6__`; `__proof_telemetry_store_fallback_v6__` и `__proof_telemetry_ledger_v6__` (не используются в production); `__diagnostics_events__`; `jobState`; ключи `selector*` (см. выше); `state_*`, `cmd_ack_*`, `pending_command*`, `global_command` (чистятся `storage-budgets`); `__llm_extension_runtime_epoch_v1` (session). `EXTENSION_VOLATILE_LOCAL_KEYS` (`index.js:15-23`) сбрасывает `jobState` и `__diagnostics_events__` при обновлении, IndexedDB ledger не сбрасывает.

## Дублирование

- Два набора классификации одного события: `normalizeTelemetryTaxonomy` и `canonicalFactOf`/`classifyRuntimeEvent`.
- Два пути записи в `__diagnostics_events__`: очередь с дельта-сжатием и прямая запись `SMOKE_CHECK` (`message-router.js:4781-4784`).
- Ledger получает события двумя путями; для `DIAG_EVENT` (`message-router.js:4527`) сэмпл не применяется.
- `buildSelectorHealthProfiles` (`selector-metrics.js:200`) и `buildSelectorHealthSummary` (286) повторяют циклы.
- Единой политики retention нет.

## События без читателя

`PLATFORM_DEGRADED*`, `SCRIPT_REINJECT_START/RESULT`, `STATUS_IGNORED`, `storage_cleanup` (`lifecycle-runtime.js:79`), `OBSERVATION_HEARTBEAT`, `CLOCK_ORDER_ANOMALY_RECORDED`, `PENDING_EVIDENCE_DROPPED`, `RUN_*` ledger-события, `PERSISTENCE_FAILURE_DETECTED`, `TELEMETRY_BATCH` (`scroll-toolkit.js:242`, обработчика нет). Метрики попаданий селекторов роутер отбрасывает (`message-router.js:4030-4033`); уровни `semantic`, `exact`, `spatial`, `none` не попадают в профиль (`selector-metrics.js:6-11, 200-215`).

## Мёртвый код в ledger

`closeRun`, `stagePending`, `appendCanonical`, `recover()` (crash-recovery не выполняется), путь `chrome.storage` для ledger, `legacyDebugRing` (содержимое никто не читает).

## Прочее

- Каждая перезагрузка страницы результатов шлёт `CLEAR_DIAG_EVENTS` (`results.js:17502`, `results/boot-utils.js:88-99`); роутер вызывает `ProofTelemetryLedger.clear(null)` (`message-router.js:4720-4726`) и стирает весь proof-журнал. Документация описывает сброс только при запуске и установке.
- Старт нового прогона без продолжения pipeline стирает журнал (`message-router.js:2129-2134`).
- `cleanupStorageBudgets` и `cleanupExpiredSelectorCache` читают все ключи через `chrome.storage.local.get(null)`.

Не проверено: динамические вызовы по строкам.
