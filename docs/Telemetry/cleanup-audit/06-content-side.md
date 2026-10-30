# 06. Эмиттеры на стороне контента (сжатый отчёт агента)

Главный вывод: значительная часть content-side «телеметрии» влияет на решения background. Каналы названы emit/diagnostic/witness/observed, но пишут в состояние background. Оговорка: LIFECYCLE-события чисты по control flow content-скрипта, но не по эффекту в background (A4).

## A. Сообщения, которые background использует как вход решений

- **A1 `PROMPT_INSERTION_OBSERVED`**: отправка `content-utils.js:513-525`; приём `message-router.js:2471-2532` пишет `promptInsertedAt`; читатели `dispatch-coordinator.js:839, 780`, `job-orchestrator.js:8177, 8218`.
- **A2 `PROVIDER_DISPATCH_STAGE_OBSERVED`** (`reportDispatchStage`, `content-utils.js:527+`): приём `message-router.js:2534-2600` (`armPromptSubmittedWaiter`, `scheduleProviderSendOnlyRecovery`); читатели `dispatch-coordinator.js:121, 1291, 1360, 2111-2124`, `job-orchestrator.js:4398`. Вызывают content-gemini/chatgpt/perplexity/grok/claude/qwen.
- **A3 keepalive вложений**: `attachment-handler.js:690-700` шлёт стадию `attachment_upload_started`; `dispatch-coordinator.js:26, 2111-2124` продлевает hold вкладки.
- **A4 `LLM_DIAGNOSTIC_EVENT` типов, кроме TELEMETRY и PIPELINE** (`message-router.js:5304-5333`): `updateTypingStateFromDiagnostic` → `markModelRuntimeActivity` (`dispatch-coordinator.js:191-199`) обновляет `lastRuntimeActivityAt`, читаемый hard-stop (`278-300`). Затронуты все LIFECYCLE (`response-lifecycle-detector.js:571-630`), SEND/DISPATCH/ERROR/INFO (`content-claude.js:640-660`, `content-gemini.js:245`), COMPOSER_TRANSACTION (`content-perplexity.js:1362-1371`). Троттлинг `ANSWER_GENERATING` (15 с, `response-lifecycle-detector.js:1490-1500`) задаёт частоту refresh.
  - A4a: метка `answer_complete_detected` (`detector 1709-1723`) → `dispatch-coordinator.js:866-900` пишет `lifecycleReadyAt` и может вызвать `recoverTerminalFailureAfterLifecycle`.
- **A5 `PIPELINE_EVENT` `ANSWER_VERIFICATION_RESULT`**: `unified-answer-pipeline.js:1182, 1213` → `message-router.js:5343-5344` → `recordPipelineAnswerVerification` (`job-orchestrator.js:7497-7565`).
- **A6 `LLM_RESPONSE_READY`** (`detector 1730-1770`, `router 4086-4320`): функциональны `answerText`, `answerVerification`, `dispatchId`, `runSessionId`; `responsePhase`, `phaseEvidence`, `completionSignals` только в emitTelemetry; `meta.confidence` уходит в `answer-evidence.js:200` (влияние не прослежено).
- **A7 `LLM_COMPLETION_TERMINAL`**: `detector 1146-1157` внутри `emitCompletionTransition` вместе с телеметрией LIFECYCLE; приём `router 2315-2330`.
- **A8 `AUTOMATION_DEADLINE_SIGNAL`**: `detector 1814-1822` → `router 4340-4360` → `finalizeAutomationDeadline`.
- **A9 `PROMPT_SUBMITTED`**: множество отправителей (claude, gemini, chatgpt, deepseek, qwen, grok, perplexity, zai, kimi); приём `router 3431-3650`. `response-lifecycle-detector.js:2186-2215` патчит `chrome.runtime.sendMessage`: на `PROMPT_SUBMITTED` запускает tracking, на `LLM_RESPONSE` нормализует текст.
- **A10 `HUMANOID_EVENT`**: `utils/humanoid-lifecycle.js:100-125` → `router 3897-3935`.
- **A11 `SCROLL_HARD_STOP`**: `pipeline-modules.js:708-720` → `lifecycle-runtime.js:154`.
- **A12 `STORE_TAB_STATE`**: `unified-answer-pipeline.js:66-80` → `router 4371` (влияние не проверено).
- **A13**: CDP/attachment сообщения и `LLM_ACTIVITY_PONG` функциональные запросы и keepalive, не телеметрия.

## B. Телеметрические объекты, которые являются входом логики

- B1 `completionSignals` (`detector 1429-1438`, используются в 1535-1541): удалять можно только копирование.
- B3 `commitCompletionResult` (1164-1186): `tracker.state`, `scheduleTrackerRelease`; shadow-сравнение `CompletionRollout.compare` (чистота не проверена).
- B4 `closePostTerminalObservationWindow` (647-667): вызывает `scheduleTrackerRelease(tracker, 0)` в строке 666. Единственный путь освобождения трекера после SUCCESS_TERMINAL; окно аудита выглядит как телеметрия.
- B7 `lengthRegressionActive` (410-445) функционален, эмиссии копируют значения. B8 `runFinalStabilityChecks` (`unified-answer-pipeline.js:1120-1215`): `emitVerification` только включает эмиссию.
- B9 `buildFinalRunResult` (`unified-answer-pipeline.js:994-1020`) → `content-utils.js:45-47` → `answer-evidence.js:103-104` → `job-orchestrator.js:7810-7814`.
- B10 `ComprehensiveTelemetry.generateReport` (`pipeline-modules.js:1039-1048`) питает `result.metadata` (`traceId`, `completionReason`, `confidence`, `unified-answer-pipeline.js:392, 424-429`; `content-utils.js:14-22`). B11 `sessionId` fallback = `telemetry.traceId` (`:202`).
- B13 `attachment-handler.js:1150-1290`: решения dispatch/confirm/timeout/accept-unproven (`dispatchIsEvidence`) функциональны, ATTACHMENT_* эмиссии чистые.
- B16 `emitWitness` (`unified-answer-watcher.js:242-256`) → `observeWitness` (`detector 1188+`) → `completionSession.observe`: 11 вызовов, вход completion protocol.
- B17 `SelectorCircuit` (`selectors-circuit.js:31-60`) функционален.

## C. Мёртвый API

`shared/run-result-contract.js:252-270`: `readUncertainText` и `acknowledgedReads` нигде не вызываются; комментарий «carried in telemetry» не соответствует коду.

## D. `shared/message-delivery*.js` (панель, не контент)

Функционально: `prepare()` добавляет токен в промпт (`results.js:6068`); `receive()` удаляет теги и отбрасывает чужие ответы (`results.js:18509, 18952`); `expectedByRequest`, `latestByModel`. Чистая observability: `record`, `observeRuntime`, `closeBatch`, `message-delivery-diagnosis.js`, `message-delivery-view.js`.

## E. Чистое наблюдение (по control flow)

Остальные `emitLifecycleTelemetry` в detector (но см. A4); `content-grok` emitDiagnostic TELEMETRY/PIPELINE; `content-lechat` `reportSubmitMethod`; `emitPerplexityComposerTelemetry`; около 60 `logPhase`/`PIPELINE_STEP`/`STATE_CHANGE` в pipeline; `emitDetectorEvent`, `DETECT_DONE`, `COPY_COMPLETION_SIGNAL`, `SELECTOR_STATS` в watcher; `METRIC_EVENT`/`SELECTOR_METRIC` в resolver; `pipeline-modules.js:1033`.

## F. Мёртвая конфигурация

Блок `telemetry` в `pipeline-config.js:88-95` (читателей нет); флаг `verboseTelemetry` (`content-bootstrap.js:83`, `bootstrap-flags.js:18`); `Config.telemetry.*` окна watcher (`unified-answer-watcher.js:21-23, 210`) всегда дефолты; `telemetrySampleRate`, `runSummaryEmitted` в `pipeline-fsm.js:140-143` без читателей; `VISUAL_RESOLVE_REQUEST` (background отвечает disabled, `router 4053-4059`); `SCRIPT_LOADED` (zai, kimi, grok) читатель не найден.

## G. Пост-терминальный шум

`shared/model-run-state.js:397-403` и `telemetry-logs.js:310-325`: после SUCCESS-терминала часть событий отбрасывается и считается `postTerminalNoiseCount`; статус не меняется.

## Рекомендации агента

Не удалять каналы из раздела 4 без выделения явных функциональных каналов; сначала развязать `markModelRuntimeActivity` от diagnostic-событий; при удалении аудита сохранить `scheduleTrackerRelease` (строка 666); `ComprehensiveTelemetry`: оставить `generateReport` или вычислять `completionReason`, `confidence`, `traceId` явно.

Не прослежено: `shared/completion-protocol.js`, потребители `meta.confidence`, `MetricsCollector` в `content-claude.js`, читатель `timelineLog`, `dist/`.
