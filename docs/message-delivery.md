# Доставка сообщений (Pipeline)

## Принадлежность ответа

- Каждый запрос модели получает от панели `transportRequestId` (`shared/transport-contract.js`) до отправки. Фон хранит его в записи модели и прикладывает ко всем сообщениям с ответом, а также к снимку общего состояния.
- Панель принимает ответ только по `transportRequestId`, никогда только по имени модели. Ожидание регистрируется до отправки, поэтому быстрый ответ не теряется; пакеты независимы; у каждого ожидания ровно один исход — результат, таймаут или отмена.
- Терминальный ответ неизменяем: позднее «улучшение» после терминала приходит с `metadata.revision: true` и не заменяет принятый ответ.
- Результат пакета для каждой модели: `results[model] = { transportRequestId, dispatchId, status, completion, reason, text }`, где `completion` — `complete`, `partial`, `failed` или `cancelled`. Текст при `STREAM_TIMEOUT` остаётся доступен, но помечен как `partial`.
- Восстановление из снимка общего состояния проходит тот же фильтр меток и ту же проверку `transportRequestId`, что и живой ответ, и закрывает также записанные терминальные ошибки.

## Метка доставки

- Каждый промпт уходит модели с меткой `[[AO-xxxxxx]]`: модель повторяет её последней строкой. Метка — дополнительное доказательство принадлежности; основное — `transportRequestId`.
- Метки хранятся по `transportRequestId`: подготовка нового запроса не отменяет метку запроса, который ещё выполняется.
- Ответ со своей меткой — доставлен. Ответ с чужой меткой (устаревший) не показывается. Ответ без метки показывается с пометкой «Без метки доставки».
- Из текста вырезаются только служебные элементы: метки `[[AO-…]]`, строка инструкции и разделители судьи `<<<RESPONSE … START|END>>>`. Остальное содержимое вида `<<<…>>>` (код, шаблоны) сохраняется.
- **Judge** (слева от Moderator): после ответов моделей выбранная модель получает их все и даёт итог; её карточка помечена «Judge». Ответы для судьи и карточек отбираются по статусу результата, а не по тексту, начинающемуся с «Error:».

## Окно телеметрии → Automation

Журнал (`chrome.storage.session`, до 3000 событий, живёт до перезагрузки страницы) собирает факты трёх источников:

| Источник | События |
| --- | --- |
| Панель | `batch_start` (модели, `transportRequestId`, срок, этап, профиль), `start_refused` (код, причина, модель, которая ещё генерирует), `start_accepted` / `start_unconfirmed`, `batch_end` (`settled` / `timeout` / `cancelled` / `rejected`, длительность, без ответа, завершённость по моделям), `prepared`, `identity_rejected` (ответ не принят: `no_request_id`, `unknown_request`, `model_mismatch`, `batch_settled`, `duplicate_terminal`, `revision_after_terminal`), `cancelled`, `no_answer` |
| Фон (`TRANSPORT_DISPATCH_PHASE`) | `dispatch` с фазой: `dispatch_started`, `command_accepted`, `submitted`, `submit_unconfirmed`, `command_not_delivered`, `blocked` (`circuit_open`, `tab_not_ready`, `ack_timeout`, `page_not_ready`, `focus_unavailable`, …) — с `dispatchId`, вкладкой и временем от подготовки |
| Ответы и вкладка | `first_text`, `verified` / `missing_token` / `empty_answer` (статус, `completion`, `dispatchId`, источник `live` или `GLOBAL_STATE_ANSWER_RECOVERY`), `revision`, `stale_dropped`, `status`, `tab`, `provider_stop` (результат нажатия «Стоп» у провайдера) |

Вкладка показывает:

- **Delivery Health Summary** — по моделям: отправлено, доставлено, неполные, без метки, пустые, нет ответа, не отправлено, нет вкладки, ошибки, отменено, отклонено по принадлежности, устаревшие; медианы времени до отправки и до ответа.
- **Batches** — каждый пакет: этап, модели, отказы старта с причиной, время до старта, исход, длительность и срок, модели без ответа, завершённость по моделям.
- **Problems & Recovery** — проблемы с пояснением и что делать: `not_submitted` и `no_tab` с причиной блокировки, `partial`, `identity`, `stop_unconfirmed`, `start_refused` / `start_rejected`, `batch_timeout` и прежние коды.
- **Message Timeline** — каждое сообщение: `transportRequestId` и номера отправок, путь (вкладка → фазы отправки → статусы → первый текст → остановка), итог (время, размер, статус, завершённость, источник, ревизии, отклонённые ответы).
- **Raw Delivery Events** и JSON-отчёт (с версией транспортного контракта).

Код: `shared/transport-contract.js`, `shared/message-delivery.js`, `shared/message-delivery-diagnosis.js`, `shared/message-delivery-view.js`, точки подключения в `results.js` (`pipelineWaiter`, `runModelBatch`, обработчик сообщений, `syncStatusFromGlobalState`), `background/job-orchestrator.js` (`transportIdentityFor`), `background/dispatch-coordinator.js`, `content-scripts/content-utils.js`.

## Будущий функционал

- Нет ответа за отведённое время — повторная отправка той же модели.
- Повтор не помог — передача сообщения другой выбранной модели.
