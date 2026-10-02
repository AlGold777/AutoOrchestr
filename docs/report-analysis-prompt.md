# Выжимка из отчётов расширения

## Основной путь: скрипт (модель не нужна)

```bash
node scripts/summarize-report.js "/путь/к/отчёту.json" ["/путь/к/другому.json" ...]
```

Вывод — готовая компактная выжимка в markdown; её можно сразу прислать разработчику. Скрипт сам
определяет тип файла и считает то, что модель считала бы «на глаз»: простои между этапами, время
до первого текста и до финала, текст, который стоял задолго до финала, ручные восстановления.
Он не делает выводов о причинах, только факты (скрипт: `scripts/summarize-report.js`).

Понимает два экспорта:

| Файл | Признак | Что в выжимке |
|---|---|---|
| `message-delivery-report*.json` | `report: "message-delivery"` | пакеты (режим, шаблон, модели, исход, длительность, **пауза перед пакетом**, отказы старта), отправки, проблемы по группам, события движка и модератора, отклонения по принадлежности |
| `Disput Flow *.json` | `metadata.debateRunId` | этапы (старт/конец/длительность/**пауза до следующего**, метка `LONG`), по каждому этапу и модели: время первого стабильного текста, первого завершения, терминалов, принудительного завершения по стабильному тексту, ожиданий барьера, ручных восстановлений; **текст, стоявший > 2 мин до финала**; диагнозы; целостность |

## Запасной путь: запрос для модели

Нужен, только если скрипт запустить нельзя. Вставьте блок ниже, приложите файл и верните ответ целиком.

```text
Ты — аналитик логов. Тебе дают JSON-отчёт расширения браузера, которое отправляет один промпт в
несколько LLM и ведёт их по этапам. Не чини, не советуй, не объясняй причины: собери проверяемые
факты. Каждое число и время бери из поля файла и указывай путь поля.

ШАГ 0. Определи тип по ключам верхнего уровня.
  A) message-delivery: есть "report":"message-delivery", "diagnosis", "journal".
  B) Disput Flow: есть "metadata.debateRunId", "stageExecutions", "events".
  Если тип другой — напиши это одной строкой и остановись.

ЕСЛИ A (message-delivery):
  1. Шапка: extension_version, generated_at, первое и последнее journal[].at.
  2. diagnosis.batches[]: waitId, stageAttemptId, runMode, template, models, at, accepted.waitedMs,
     refusals[] (attempt, errorCode, waitedMs), outcome, durationMs, skipped, adopted. Для каждого
     пакета, кроме первого: пауза = (его at) − (at + durationMs предыдущего).
  3. diagnosis.sends[]: model, batchId, submittedMs, firstTextMs, result, terminal.status,
     terminal.chars, terminal.completion, focus.count и focus.sources, число revisions и rejections.
  4. diagnosis.problems[]: сгруппируй по code, число и reason.
  5. journal[] kind из списка: run_paused, moderator_pause, moderator_get_it, get_it_result,
     moderator_stage_close, moderator_approve, owner_answer, stall_adopted, response_rejected,
     ui_phantom_state — время и поля. Пусто — «нет».
  6. journal[] kind=identity_rejected: счёт по model и reason.

ЕСЛИ B (Disput Flow). Время — миллисекунды epoch; считай секунды от начала первого этапа.
  1. Шапка: metadata (extensionVersion, presetId, dataCompleteness), runOutcome, health.
  2. stageExecutions[] по времени actual.startedAt: этап, actual.participants, старт/конец (в секундах
     от начала), durationMs, status. Для каждого: пауза до следующего этапа (его startedAt − этого
     completedAt). Пометь этапы, которые дольше 3 медиан и дольше 2 минут: «LONG».
  3. Для каждого этапа и модели из events[] (correlation.stageId, payload.model), смещение от начала
     этапа: первое TEXT_STABLE; первое COMPLETION_DETECTED; все MODEL_TERMINAL_COMMITTED
     (payload.evidence.finalStatus, .completionReason, payload.answerLength); STABLE_TEXT_FALLBACK_USED;
     число BARRIER_WAITING; число MANUAL_RECOVERY_REQUESTED; STAGE_FAILED (reasonCode).
  4. Отдельно: где первое TEXT_STABLE произошло более чем за 2 минуты до последнего
     MODEL_TERMINAL_COMMITTED той же модели на том же этапе — этап, модель, оба смещения.
  5. Все MANUAL_RECOVERY_REQUESTED: время от начала, модель, payload.details, этап.
  6. diagnoses[]: code, severity, affectedParticipant, affectedStageId, reasonCode, occurrences,
     firstObservedAt, resolvedAt.
  7. integrity: числа во всех списках; dispatchAttempts: сколько записей и сколько без dispatchId.

ОБЩИЕ ПРАВИЛА
  - Только факты из файла. Нет поля — напиши «нет поля <путь>» один раз и иди дальше.
  - Не пересказывай тексты ответов (длина и первые 80 символов достаточно).
  - Слов «вероятно», «похоже», «видимо» и рекомендаций быть не должно.
  - Таблицы в markdown; не больше 120 строк на файл.
```

## История

- Первая версия запроса (2.81.529) была написана под формат отчёта доставки, поэтому на экспорте
  Disput Flow почти везде отвечала «нет данных». Теперь выжимку считает скрипт, а запрос различает
  оба типа файлов.
