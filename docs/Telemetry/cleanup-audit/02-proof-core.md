# 02. Ядро proof-telemetry в `shared/` (сжатый отчёт агента)

Счётчики потребителей получены grep по именам; пункты «никто» означают «не найдено по grep». Всего в срезе 14 файлов, 5817 строк. Все файлы IIFE с `root.<Global>` и `module.exports`.

## Файлы

| Файл | Строк | Назначение |
|---|---|---|
| `proof-oriented-telemetry.js` | 2717 | ядро: классификация, `buildLedger`, `derive*`, `deriveModelView` (870-1198), `buildReports` (1564-1751), сборка пресетов |
| `proof-telemetry-contracts.js` | 483 | контракты отчётов, пороги, `adaptLegacyEvent`, `factOf` |
| `proof-telemetry-policy.js` | 337 | политика финализации, оси с provenance, `planCompanions`, `replay` |
| `proof-telemetry-inventory.js` | 274 | реестр типов событий, матрица возможностей |
| `proof-telemetry-presentations.js` | 125 | timeline, сравнение legacy/proof, shadow-bundle для UI |
| `proof-telemetry-semantic-comparator.js` | 276 | parity вложенного и standalone-отчёта |
| `proof-telemetry-audit.js` | 255 | post-terminal наблюдения, `planAfterEvent` |
| `proof-telemetry-clock.js` | 59 | сравнение часов по эпохам, `signalCoverage` |
| `proof-telemetry-incidents.js` | 496 | выбор инцидентов, слоты доказательств, temporal invariants |
| `answer-proof-normalization.js` | 72 | нормализация текста, FNV-1a хэш |
| `answer-evidence.js` | 257 | решение о раннем финализировании по доказательству ответа |
| `completion-evidence-ladder.js` | 279 | лестница P0-P4, `evaluate()` с вето |
| `decision-ledger.js` | 43 | журнал решений на сущность (лимит 80) |
| `secret-redaction.js` | 144 | маскирование секретов |

## Рабочие модули (не телеметрия)

- `completion-evidence-ladder.js`: `content-scripts/unified-answer-watcher.js:686-730`, вето на commit в строке 523; в `manifest.json:113`.
- `answer-evidence.js`: `job-orchestrator.js:2778-2833`, 3017; `message-router.js:2667`.
- `answer-proof-normalization.js`: `dispatch-coordinator`, `job-orchestrator`, `response-lifecycle-detector.js:703,1692`, `disput/debate-stage-executor.js`, `results.js`, `message-delivery.js`.
- `decision-ledger.js`: `append` в `dispatch-coordinator.js:1405`, `job-orchestrator.js:8496,9134,10632`; `get` без вызовов.
- `secret-redaction.js`: воркер экспорта, `results.js`, `disput/debate-trace-schema.js:62`, `dom-skeleton-capture.js`, `b1-skeleton-collector.js`.

## Потребители ядра

- Runtime: `background/proof-telemetry-ledger.js` (`classifyRuntimeEvent`, `layerFor`, `canonicalType`, `sanitizeValue`); `results-devtools.js` (`buildAllPresets`, `buildStandaloneReport`); `workers/telemetry-export-worker.js:33-34`.
- Только тесты/скрипты: `buildLedger`, `validateLedger`, `deriveModelView`, `deriveExportCompleteness`, `evaluatePredicate`, `eventFingerprint`, `dependencyRegistrySnapshot`, `SIBLING_RULES`.
- `proof-telemetry-semantic-comparator.js`: runtime-потребителей нет; `scripts/validate-proof-telemetry-field.js`, 3 теста, `npm run test:telemetry-parity`.
- `proof-telemetry-presentations.js`: `results.js:17318` и `results-devtools.js:816-823` (теневые показы); не грузится в background и контент.
- `proof-telemetry-inventory.js`: в runtime только `EVENT_REGISTRY` и `CAPABILITY_MATRIX` через ядро.

## Архитектура

1. Запись: `dispatchTelemetry` (`telemetry-logs.js:650-663`) → `ProofTelemetryLedger.record` (`ledger:893`) → `createEvent` (464) → `classifyRuntimeEvent` (`proof-oriented-telemetry.js:262`), `EVENT_MAP` (59-174), слой `layerFor` (392), `sanitizeValue` (411), `Contracts.factOf`/`adaptLegacyEvent`, `Policy.planCompanions`, `Audit.planAfterEvent`, `Clock.signalCoverage`; хранение `proof-telemetry-store.js` (IndexedDB).
2. Экспорт: `results-devtools.js:1282-1400` и воркер → `redactDeep` → `buildCanonicalEvidence`/`buildAllPresets` → `buildLedger` (если нет `canonicalLedger`) → `validateLedger` → `deriveModelView` → `buildReports` → `Policy.replay`.
3. Ключевое: два маршрута одного журнала. Фоновый ledger (schema 6) пишется всегда, экспорт пересобирает свой ledger из legacy-событий. Они могут расходиться.

## Дублирование

- Списки слоёв: `proof-oriented-telemetry.js:290-294` и `proof-telemetry-inventory.js:81-97`. Расхождение: Inventory относит `OWNERSHIP_*` к inference, `TERMINAL_DECISION` к decision; в ядре их нет в наборах (по `layerFor` это fact). В `ledger.js:588` приоритет у inventory.
- Деривация осей: `deriveAxes` (ядро 804-812, regex по legacy-меткам) и `deriveAxesWithProvenance` (policy 137-226).
- Маскирование: `isSensitiveKey`/`sanitizeValue` (ядро 405-423) и `secret-redaction.js` (24-51).
- Пороги: `automaticMinimumEvidenceTier = 3`, `maximumSignalSkewMs = 250` дублируются в contracts/policy/ledger. `CONTRACT_VERSION '1.0'` в clock и contracts. `SCHEMA_VERSION '5.0'` (ядро 18) против `EVENT_SCHEMA_VERSION 6`.
- `sourceType` ×3 (contracts:271, presentations:7, audit:17). Сравнение области ×4 (`sameScope` в policy:9 и audit:7, `exactScope`/`sameRunScope` в incidents, `sameIncidentScope` в contracts:398). `sortedUnique` ×2.
- `hashText`: `answer-proof-normalization` (с префиксом `fnv1a:`), fallback в `answer-evidence.js:18-27` (без префикса), своя нормализация в `message-router.js:2667`.

## Мёртвые экспорты (по grep)

Ядро: `DIAGNOSIS_PRIORITY`, `DIAGNOSIS_CAUSAL_RULES`, `buildConclusions`, `buildFieldProvenance`, `READER_GUIDANCE_VERSION`, `TRUSTED_READER_GUIDANCE`. Прочие: `evaluateFinalization` (внутр.), `SUPPORT`, `PRESENTATION_VERSION`, `thresholdAtLeast`, is*-хелперы `answer-evidence.js`, `DecisionLedger.get`, `isSecretKeyName`, `MASK`.

Копии `answer-evidence.js`, `answer-proof-normalization.js`, `decision-ledger.js` в `docs/Pipeline scenarios/Pre-Dispute/` побайтно совпадают с `shared/`.

## Essential и ceremonial

Essential: ядро и модули, на которые опирается ledger (contracts, policy, clock, incidents, audit), плюс рабочие модули выше. Ceremonial: comparator, presentations, большая часть экспортов, `buildAllPresets` как shadow-сравнение (`results-devtools.js:1392-1400`, только `console.info`).

34 теста ссылаются на ядро.
