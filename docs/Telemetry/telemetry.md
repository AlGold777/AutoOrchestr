# Телеметрия

Версия документа: 2.81.836. История прежней схемы (proof-oriented ledger, пресеты, дайджесты, canonical evidence) удалена из дерева, её можно найти в git по тегу `pre-telemetry-rebuild` (файл `docs/Telemetry/telemetry.md` и каталог `telemetry-spec/`).

## Принцип

Телеметрия хранит факты, разбор делает модель по запросу под конкретную проблему (`queries.md`). Никаких производных отчётов, пресетов, схем и дайджестов в расширении нет: `Export` отдаёт сырые события.

## Откуда берутся события

Расширение пишет события через `emitTelemetry` (фон) и сообщения `LLM_DIAGNOSTIC_EVENT`, `PIPELINE_EVENT`, `TELEMETRY_EVENT`, `DIAG_EVENT` (контент и страницы). Всё сходится в `dispatchTelemetry` (`background/telemetry-logs.js`).

## Где хранятся

| Хранилище | Что | Предел |
|---|---|---|
| Кольцо `__diagnostics_events__` (`chrome.storage.local`, сжатое) | все события прогона, единственный сырой источник | 4000 событий / 3 МБ; закреплённые метки (`PINNED_LABELS`) вытесняются последними |
| `jobState.llms[x].logs` | последние записи по модели для живой панели | 120 на модель |
| Страница результатов (`LLM_DIAGNOSTIC_EVENT`) | живое окно Telemetry | текущий прогон |

Сэмплирование (`TELEMETRY_SAMPLE_RATE = 0.05`) относится только к двум последним: живой панели и логам модели. В кольцо попадают все события. Запись в кольцо пачками раз в 400 мс.

Кольцо очищается при старте нового прогона, при `Clear all` и при перезагрузке страницы результатов.

## Экспорт

- `Telemetry → ↓` (`results-devtools.js`) выгружает события текущего прогона (по выбранной модели) в JSON с версией расширения, `runSessionId` и памяткой читателю. Секреты маскируются `SecretRedaction`. Список слева от кнопки выбирает профиль:
  - **Raw (all)**, по умолчанию: все события как есть, формат `telemetry-raw/1`.
  - **Prompt not sent**, **End of generation**, **Which answer is last**, **Truncated answer**: формат `telemetry-view/1`. Остаются события по меткам задачи и все error/warning, поля сжаты (`t` — мс от начала, `p`, `l`, `v`, `d`, `m`), подряд идущие повторы схлопнуты (`n`), в `readerGuide` вписана задача для модели. Правила и списки меток: `shared/telemetry-views.js`; изменение правил не требует миграции данных.
- `Telemetry → MD` (All Logs): Markdown с событиями, раундами, сводкой прогона и логами моделей (`results.js`, `buildAllLogsMarkdown`).
- `Disput → JSON/MD/Extract`: отчёт трейса Disput; события по моделям Disput получает из того же потока через переводчик меток (`results.js`, `diagnosticTraceMapping`).
- `B1`: безопасные DOM-скелеты ответов (калибровка, не телеметрия прогона).

## Что нельзя удалять вместе с «телеметрией»

Ряд сообщений называется телеметрией, но несёт состояние для решений. Их нельзя убирать или троттлить без отдельной переделки:

- `PROMPT_INSERTION_OBSERVED`, `PROVIDER_DISPATCH_STAGE_OBSERVED`, `PROMPT_SUBMITTED` (включая `submitEvidence`): пишут `promptInsertedAt`, `promptSubmittedAt`, стадию отправки; от них зависят повтор отправки и продление удержания вкладки (`background/message-router.js`, `dispatch-coordinator.js`).
- Загрузка вложений (`content-scripts/attachment-handler.js`) шлёт стадию `attachment_upload_started` как keepalive.
- `LLM_DIAGNOSTIC_EVENT` не-телеметрийных типов (LIFECYCLE, SEND, DISPATCH, ERROR, INFO, COMPOSER_TRANSACTION): через `markModelRuntimeActivity` продлевают hard-stop; метка `answer_complete_detected` ставит `lifecycleReadyAt` (`dispatch-coordinator.js`).
- `PIPELINE_EVENT` с меткой `ANSWER_VERIFICATION_RESULT`: пишет `entry.answerVerification`, входит в решение о приёме ответа (`job-orchestrator.js`, `buildFinalizationEvidence`).
- `dispatchTelemetry` ведёт `stageTimeline` для UI и отбрасывает шум после завершения модели.
- `emitWitness` (`unified-answer-watcher.js`) подаёт сигналы в completion protocol; закрытие окна post-terminal аудита освобождает трекер (`response-lifecycle-detector.js`).
- `ComprehensiveTelemetry.generateReport` задаёт `completionReason`, `confidence`, `traceId` в метаданных ответа.
- Блоки `emit` в `job-orchestrator.js` и `message-router.js` могут содержать записи состояния (baseline до отправки, `promptInsertedAt`, `runSummaryEmitted`): удалять нужно вызов `emit`, не блок.

Полный разбор: `docs/Telemetry/cleanup-audit/`.

## Добавление события

Новое событие: `emitTelemetry(llmName, 'LABEL', { details, meta })`. Метка в верхнем регистре; стабильная, она станет ключом для запросов. Если событие нужно сохранить при вытеснении, добавить метку в `PINNED_LABELS`. Ничего регистрировать в схемах, реестрах или пресетах не нужно: их нет.

## Как читать отсутствие события

Кольцо хранит только то, что дошло до `dispatchTelemetry`. Отсутствие события не доказывает, что действия не было: адаптер мог не отправить сообщение, сообщение могло не дойти, фон мог отбросить его. Отказы, которые фон делает осознанно, оставляют следы с уровнем `warning`: `SENDER_TAB_MISMATCH_REJECTED`, `SENDER_WITHOUT_BINDING_REJECTED`, `LIFECYCLE_CORRELATION_REJECTED`, `PROMPT_INSERTION_REJECTED`. В сжатых профилях эти события и все `error`/`warning` сохраняются независимо от меток.

