# Аудит телеметрии перед чисткой (2026-10-22)

Версия на момент аудита: `manifest.json` 2.81.700. Код не менялся. Аудит сделан 8 агентами Haiku (только чтение), по срезам. Утверждения «нет вызова» получены статическим поиском (grep), динамические вызовы по строкам не проверялись. Перед правкой каждое место нужно перепроверить.

Отчёты по срезам (сжатые, с сохранением фактов и ссылок file:line):

- [01-docs-spec.md](01-docs-spec.md): документы и спецификации
- [02-proof-core.md](02-proof-core.md): ядро proof-telemetry в `shared/`
- [03-background.md](03-background.md): хранение и сбор в `background/`
- [04-export-reports.md](04-export-reports.md): экспорт, отчёты, дайджесты
- [05-tests-tooling.md](05-tests-tooling.md): тесты и инструменты
- [06-content-side.md](06-content-side.md): эмиттеры на стороне контента
- [07-disput.md](07-disput.md): Disput
- [08-orchestration.md](08-orchestration.md): связки с оркестратором

## Главное

Телеметрия не отделена от рабочей логики. Часть каналов называется «телеметрия», но управляет поведением. Чистить нужно в три этапа: развязать такие каналы, затем удалять то, что только пишет.

## 1. Каналы с именем телеметрии, которые управляют поведением

Нельзя удалять вместе с телеметрией. Сначала вынести в явные рабочие каналы.

- `PROMPT_INSERTION_OBSERVED`, `PROVIDER_DISPATCH_STAGE_OBSERVED`, `PROMPT_SUBMITTED`: пишут `promptInsertedAt`, `promptSubmittedAt`, стадию отправки; от них зависят повтор и продление удержания вкладки. Загрузка вложений использует такую стадию как keepalive (`attachment-handler.js:690`).
- `LLM_DIAGNOSTIC_EVENT` не-телеметрийных типов (LIFECYCLE, SEND и др.): через `markModelRuntimeActivity` продлевают hard-stop (`dispatch-coordinator.js:278-300`); `answer_complete_detected` ставит `lifecycleReadyAt`, вход финализации.
- `PIPELINE_EVENT` с `ANSWER_VERIFICATION_RESULT`: пишет `entry.answerVerification`, влияет на `accepted`. Есть второй путь через `LLM_RESPONSE.meta`; гонка не проверена.
- `emitWitness` (`unified-answer-watcher.js:242`): вход completion protocol.
- Окно post-terminal аудита: его закрытие освобождает трекер (`response-lifecycle-detector.js:666`).
- `ComprehensiveTelemetry.generateReport`: определяет `completionReason`, `confidence`, `traceId` в метаданных ответа.
- Блоки emit в `job-orchestrator` и `message-router`: внутри записи состояния (baseline до отправки, `promptInsertedAt`, `runSummaryEmitted`). Удалять только вызов emit.
- `buildFinalizationEvidence`, `stableEvidenceBlockers`: названы диагностикой, определяют `accepted`.
- `dispatchTelemetry` (`telemetry-logs.js:654-700`): попутно ведёт `stageTimeline` для UI и отбрасывает шум после завершения. Разделение TELEMETRY/PIPELINE и остальных типов в роутере (`message-router.js:5304-5333`) сохранить.

## 2. Не телеметрия, трогать только отдельным решением

`completion-evidence-ladder.js` (вето фиксации ответа), `answer-evidence.js`, `answer-proof-normalization.js`, `decision-ledger.js` (метод `get` мёртв), `secret-redaction.js`, `report-digest.js` (Extract), `debate-export.js`, `log-replay-harness.js` (грузится в service worker), `selector_health_profile_v1` (читает `selector-resolver-v2`), `message-delivery` prepare/receive, `SelectorCircuit`, решения `attachment-handler`, `buildFinalRunResult`.

## 3. Disput

Модули Disput не импортируют старую телеметрию. Но события по моделям трейс получает только через переводчик старых меток в `results.js:2915-3040`. Удаление старой диагностики оставит Disput почти без событий по моделям; сначала нужны нативные события.

Дефекты Disput: при переполнении 3000 событий вытесняются `RUN_STARTED`/`STAGE_STARTED` (пропадает время старта, ложный «degraded»); `BARRIER_*`, `SUBMIT_ATTEMPTED`, `STAGE_SKIPPED` нигде не эмитятся; `DebateProcessAudit` и `DebateStateDelta` вызываются только из тестов.

## 4. Безопасно удалять (чистая запись или мёртвое)

- Ядро: `proof-telemetry-semantic-comparator.js`, `proof-telemetry-presentations.js` с теневыми показами, около 30 из 40 экспортов ядра, параллельный `buildLedger` в экспорте (расходится с фоновым ledger). В `background/`: `closeRun`, `stagePending`, `appendCanonical`, `recover`, `legacyDebugRing`.
- Экспорт: `shared/telemetry-export.js` (228 строк, не подключён), кнопки и обработчики refresh/reset/copy без элементов в HTML, `buildSerialDebateFlowMarkdown`, пустой `LEGACY_REPRODUCTION_ADAPTERS`, мёртвый API `run-result-contract` (`readUncertainText`, `acknowledgedReads`).
- Прочее: `shared/budgets.js`, alarm `primeVersionStatusAudit`, маршруты `GET_PROOF_TELEMETRY_INCIDENTS` и `REQUEST_SELECTOR_VERSION_STATUS`, блок `telemetry` в `pipeline-config.js`, флаг `verboseTelemetry`, `VISUAL_RESOLVE_REQUEST`, метрики попаданий селекторов (роутер их отбрасывает).
- Документы и данные: `КОНТЕКСТ ДЛЯ АНАЛИЗА/` (14 МБ, снимки 2.81.169), копии `answer-evidence.js` и ещё двух файлов в `docs/Pipeline scenarios/Pre-Dispute/`, `telemetry-event.schema.json` (v5), примеры пресетов (3 из 7 не проходят валидатор), исторические строки 1035-1706 `telemetry.md`, `docs/Telemetry/Reports`, `automation-telemetry-starter.diff`, `tmp-run-telemetry-check.js`, `logs.json`, `generate-proof-telemetry-examples.js`.

## 5. Что упрощается через «сырьё + запрос к модели»

Заменяемо: Canonical evidence и Full forensic (вместе с воркером, runtime и bootstrap), `telemetry-digest.js`, `build-proof-telemetry-report.js`. Не заменяется промптом: ядро `report-digest.js` (сырой Disput JSON около 1,2 МБ; модель плохо считает медианы и склеивает записи по `requestId`).

Хранение: сейчас четыре приёмника одного события (IndexedDB ledger без лимита, кольцо в storage с сэмплом 5%, `jobState.logs`, страница результатов).

## 6. Тесты

Около 44 тестов чисто телеметрийные, около 50 смешанных. Самые опасные: тесты, читающие исходный код и ищущие лейблы (`dispatch-baseline-stale-guard`, `prompts-by-model`, `dispatch-correlation-contract`, `lechat-submit-method-visibility`), и поведенческие с проверкой событий (`round4-gate`, `lifecycle-sender-gate`, `human-presence-lease`, `tab-manager-session-scope`, `universal-dispatch-recovery`, `materialize-recovery-finality`). Переписать на проверку поведения до правки продакшена. `ajv` не объявлена в `package.json`.

## 7. Баги, найденные попутно

- Каждая перезагрузка страницы результатов шлёт `CLEAR_DIAG_EVENTS`, `ledger.clear` стирает весь proof-журнал (`results/boot-utils.js:99`, `message-router.js:4720-4726`).
- `MAX_EVENTS = 10000` в ledger объявлен, но не применяется.
- Инструкция в каждом скачанном дайджесте про «чекбокс digest» устарела (`shared/telemetry-digest.js:337`).

## 8. Предлагаемый порядок

1. Переписать тесты, державшиеся на лейблах, на проверку поведения.
2. Вынести рабочие каналы из раздела 1 в явные.
3. Сделать Disput самостоятельным (нативные события вместо переводчика).
4. Удалить чистую запись и мёртвое, затем сократить экспорт и хранение до одного кольца.
5. Обновить документацию и версию.

## Не проверено

Гонка `ANSWER_VERIFICATION_RESULT` против `LLM_RESPONSE.meta`; тип `TELEMETRY` у части отправителей в контенте; условие вызова `CLEAR_DIAG_EVENTS` при перезагрузке; `CompletionRollout.compare`; реальный размер трейса Disput.
