# 08. Связки с оркестратором (сжатый отчёт агента)

## Главные выводы

1. Около 160 вызовов `emitTelemetry`/`emitModelRoundTelemetry` в `job-orchestrator.js` (около 1370 строк, 13% файла из 10769; 190 строк со словом telemetry), около 100 в `message-router`, 40 в `dispatch-coordinator`, 27 в `tab-manager`, 21 в `human-presence`: результат не используется, чистая запись.
2. Телеметрический канал переносит состояние решений: `ANSWER_VERIFICATION_RESULT` (`PIPELINE_EVENT`) пишет `entry.answerVerification`; `LLM_DIAGNOSTIC_EVENT` не-TELEMETRY/PIPELINE ставит `lifecycleReadyAt`; `dispatchTelemetry` пишет `stageTimeline` и отбрасывает события.
3. Внутри «телеметрических» веток пишется состояние (baseline до отправки, `promptInsertedAt`, `promptSubmittedAt`, `runSummaryEmitted`); блок целиком удалять нельзя.
4. В `buildFinalizationEvidence` поля с диагностическими именами (`stableEvidenceBlockers`, блок lift) определяют `accepted`.
5. `ProofTelemetryLedger` в решения ничего не возвращает; влияет только на экспорт и тайминг (`await`).

## (a) Чистая запись

- `job-orchestrator.js`: 138 `emitTelemetry` и 21 `emitModelRoundTelemetry` (диапазоны строк в оригинальном отчёте: 680-10639).
- Dedupe-ключи, читаемые только гейтом emit: `lastAnswerCommitTelemetryKey` (7365-7367), `lastAnswerMaterializationTelemetryKey` (9305-9306), `lastFinalizationDecisionDedupeKey`/`isRepeatBlockedFinalization` (9352-9362), `lastFinalEmitKey`/`lastFinalEmittedAt` (9612-9642; `LLM_PARTIAL_RESPONSE` на 9683 вне гейта), `lastGateWaitTelemetryAt` (4487-4500), `lastRecoveryDeniedSignature` (`dispatch-coordinator.js:1400-1415`).
- `message-router.js`: ветки 2276-4242, кроме `4565` (`ledger.record`).
- `selector-manager.js`: `sendMetric` (273-282); `pipeline-run-state.js`: поля `telemetrySampled`, `telemetrySampleRate`.
- `DecisionLedger.append` (`job-orchestrator.js:9129-9135`, `dispatch-coordinator.js:1405-1411`): чтений в tracked-коде не найдено.
- Файлы без упоминаний: `pipeline-message-handlers`, `lifecycle-runtime`, `evaluation-manager`, `finalization-controller`, `status-contract`, `run-guard`.

## (b) Несущие места (удаление меняет поведение)

- **B1 `buildFinalizationEvidence`** (`job-orchestrator.js:7629-7904`): входы `lifecycleReadyAt` (7645), `staleBaseline` (7669, 167-188), `evidencePolicy` (7664), `freshness` (7670), `verification` (7685), `verificationIdentity` (7698-7701), `automaticSubmissionConfirmed` (7725-7731), `contradictions` (7780-7817), **lift** (7827-7846), результат `accepted` (7900-7901).
- **B2** `submitAnswerCandidate`/`evaluateAnswerCandidate` (7420-7496): переходы ANSWER_CANDIDATE_ACCEPTED/REJECTED.
- **B3** `handleLLMResponse` (8296-9968): 9340 `recordModelRunState`; 9342 `entry.finalizationEvidence` (читается в 1403 `isTerminalExtractionRecoveryEligible`); ветки блокировки 9383-9440, 9455-9520; `commitAcceptedAnswer` (7336-7377); `FinalizationController.tryFinalize` (9113-9140).
- **B4** верификация через `PIPELINE_EVENT`: `message-router.js:5334-5349` → `recordPipelineAnswerVerification` (`job-orchestrator.js:7497-7618`); отправитель `unified-answer-pipeline.js:1182, 1213`; второй носитель `LLM_RESPONSE.meta.answerVerification` (`:961, 971`); гонка не проверена.
- **B5** лайфцикл через `LLM_DIAGNOSTIC_EVENT` (`message-router.js:5304-5332`, `dispatch-coordinator.js:855-935`, читатель `job-orchestrator.js:7645`). Метки отправителей с `type: 'TELEMETRY'` (`unified-answer-watcher.js:783`, `attachment-handler.js:670`, `content-grok.js:926, 2167`) не проверены.
- **B6** побочные эффекты `dispatchTelemetry` (`telemetry-logs.js:654-700`): `ledger.record`, `AnswerVerification.appendTimeline` (`stageTimeline` для UI, `GET_RUN_OUTCOME_SUMMARY`), фильтр post-terminal (`POST_TERMINAL_NOISE`, `postTerminalNoiseCount`), дедупликация `PIPELINE_COMPLETE`, сэмплирование 0.05.
- **B7** записи состояния в ветках роутера: `PROMPT_INSERTION_OBSERVED` (2470-2512; читают `job-orchestrator.js:8177, 8218`), `DISPATCH_BASELINE_CAPTURED` (2636-2690; читают 175, 7669, 7647-7650, 7698, 933, 1030), `PROMPT_SUBMITTED` (3465-3650; `promptSubmittedAt` читается в 7725), `ANSWER_DELIVERY_REJECTED`/`POST_TERMINAL_NOISE` (4113-4145).
- **B8** `runSummaryEmitted` (9921, 9963) и `runMetrics` (9936-9938, `ui-broadcast.js:72`); `roundStarts`/`roundDurations` пишет `emitModelRoundTelemetry` (4343-4357), читают 9940-9958 (`avgRoundTimes`).
- **B9** гейты и восстановление: `waitForRound4Gate` (4480-4579), раунд 2 (6405-6715), `consumeRecoveryBudget` (1567-1612), материализация (1654-1902, 2091-2263), `acceptLateCollectResult` (1114-1394).
- **B10** ledger: `beginRun` (`job-orchestrator.js:5274-5277`, `await`), очистка при новом прогоне (`message-router.js:2115-2135`), фильтр `currentRunSessionId` (4681).

Вывод по вариантам: убрать emit — поведение не меняется; убрать `dispatchTelemetry` целиком — меняются `stageTimeline`, счётчик noise и маршрутизация; убрать `PIPELINE_EVENT` — пропадёт fallback `answerVerification`; убрать `LLM_DIAGNOSTIC_EVENT` — ломаются `lifecycleReadyAt`, typing, `hasAnswerEvidence`; убрать ledger — меняется только экспорт и тайминг; убрать `entry.finalizationEvidence` — ломается fallback в 1403.

## (c) Сообщения `chrome.runtime`

| Тип | Обработчик (`message-router.js`) | Отправители |
|---|---|---|
| `GET_PROOF_TELEMETRY_SNAPSHOT` | 2057 (1947-1999) | `results.js:16609`, `results-devtools.js:821, 1109` |
| `GET_PROOF_TELEMETRY_INCIDENTS` | 4705-4716 | не найдены |
| `GET_RUN_OUTCOME_SUMMARY` | 4596-4653 | `results.js:16583` |
| `GET_DIAG_EVENTS` | 4655-4703 | `results.js:16747`, `results-devtools.js:999` |
| `CLEAR_DIAG_EVENTS` | 4720-4731 | `results.js:17479`, `results-devtools.js:1048`, `boot-utils.js:99` |
| `LLM_DIAGNOSTIC_EVENT` | 5304-5332 | множество content-файлов (см. оригинал: attachment-handler, content-*, unified-answer-watcher, response-lifecycle-detector, selector-manager) |
| `PIPELINE_EVENT` | 5334-5349 | `unified-answer-pipeline.js:108` |
| `TELEMETRY_EVENT` | 5351-5364 | `pipeline-modules.js:1033`, `content-lechat.js:927` |
| `REQUEST_SELECTOR_TELEMETRY` | 4870-4872 | `results.js:14747` |
| `SELECTOR_METRIC`/`METRIC_EVENT` | 4016/4036 | `selector-manager.js:276/150` |

## (d) Конфигурация

`TELEMETRY_SAMPLE_RATE=0.05` (`telemetry-logs.js:17`, 450-460; обход: force, error, pinned); `DIAGNOSTICS_EVENTS_MAX_ITEMS=2000`, `MAX_BYTES=1500000`; `MAX_LOG_ENTRIES=120`; `TELEMETRY_SCHEMA_VERSION=2`; `ROUND4_GATE_WAIT_TELEMETRY_MS=15000` (`job-orchestrator.js:49`); `state-manager.js:5, 19` `stateTelemetry: true`; `verboseTelemetry: false`; `DEBUG_CLEANUP_TELEMETRY=false`.

## Размер `job-orchestrator.js`

10769 строк; чисто телеметрийных функций около 105 строк: `emitModelRoundTelemetry` (4340-4367), `recordPipelineAnswerVerification` (7497-7618, гибрид), `summarizeFinalizationEvidenceForTelemetry` (7905-7930), `emitFinalizationDecision` (8079-8129). С inline-блоками около 1475 строк.

Не проверено: чтения `lastAnswerCandidate`, `finalizationControllerDecision`, `decisionSnapshot` вне среза; гонка верификации; метки `type: 'TELEMETRY'`; использование trace из `selector-manager`; условие вызова `CLEAR_DIAG_EVENTS`; тесты. Копии в `dist/` и `КОНТЕКСТ ДЛЯ АНАЛИЗА/` нужно пересобрать или исключить при удалении.
