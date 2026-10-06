# Timings Settings — актуальная карта и полный перечень

Этот документ — единственный актуальный владелец числовых runtime-таймингов
проекта. Он обновляется вместе с кодом при любом изменении timeout, interval,
delay, retry, debounce, TTL, budget или retention window.

Актуальность: extension `2.81.507`; перечень обновлён `2026-09-30` для лимита журнала доставки.

Исторические значения фиксируются отдельными датированными snapshots только
тогда, когда это требуется конкретной задачей. Snapshot не является источником
текущих значений.

Scope: runtime-настройки времени из `config/`, `background/`,
`content-scripts/`, `content-utils/`, `shared/`, `disput/`, `pipeline/` и
`results.js`. Тестовые искусственные таймауты сюда не включены.

## Архитектурный индекс

### Владельцы таймеров

| Область | Канонический владелец | Что ему принадлежит |
|---|---|---|
| Общие значения загрузки, ready, heartbeat и attachments | `config/timing.js` | базовые timeout/interval, используемые несколькими слоями |
| Профили Standard/Long | `background/shared-state.js`, `background/job-orchestrator.js` | passive generation deadline и active focus window |
| Вкладки и их готовность | `background/tab-manager.js` | создание, attach/reuse, load/ready/reload и возврат фокуса |
| Dispatch и подтверждение отправки | `background/dispatch-coordinator.js`, `shared/model-policy.js` | очередь, retry/backoff, `PROMPT_SUBMITTED`, transport recovery |
| Раунды, collection и recovery | `background/job-orchestrator.js` | Round2/Round4, late collect, baseline guard и adaptive probes |
| Human presence и focus policy | `background/human-presence.js`, `shared/visit-policy.js` | dwell, visit quota и предел foreground-активности |
| Answer pipeline | `content-scripts/pipeline-config.js` | preparation, stream start, stability и pipeline hard maximum |
| Lifecycle detector | `content-utils/response-lifecycle-detector.js` | polling, stable window, completion readiness и lifecycle deadline signal |
| Провайдерские DOM-циклы | `content-scripts/content-*.js` | composer/send search, typing pauses и provider-specific confirmation |
| Disput | `disput/`, `results.js` | stage execution, batch guard, approval, UI debounce и session timers |
| Telemetry, storage и selectors | `background/telemetry-logs.js`, `background/selector-metrics.js`, `results.js` | flush, retention, export snapshot и UI refresh |

Архитектура вкладок и правила владения focus описаны в
[`model-tabs-architecture.md`](../Architecture/model-tabs-architecture.md). Инварианты
профильной лестницы проверяет `tests/timing-ladder.test.js`.

### Лестница зависимостей Standard / Long

Более внешний страховочный таймер не должен завершаться раньше внутреннего
владельца. Текущая последовательность:

| Граница | Standard | Long | Назначение |
|---|---:|---:|---|
| Active focus window | `60s` | `90s` | после этой границы автоматизация больше не активирует вкладку модели |
| Passive generation deadline | `450s` | `900s` | абсолютный срок автоматического сопровождения ответа |
| Deferred stream final maximum | `460s` | `910s` | отложенная финализация стабильного stream-кандидата |
| Script runtime hard stop | `480s` | `930s` | аварийная страховка, если основной deadline не был создан |
| Round4 pending wait maximum | `500s` | `950s` | ожидание незавершённых моделей перед collection gate |
| Baseline guard window | `510s` | `960s` | защита от старого ответа reused tab |
| Adaptive probe total window | `540s` | `990s` | последний горизонт автоматических extraction probes |

Главный управляющий предел — passive generation deadline. При его истечении
модель получает `PARTIAL`, если текст уже обнаружен, либо `STREAM_TIMEOUT`, если
текста нет. Автоматические visits, recovery и ping прекращаются, но Stop на
странице провайдера не нажимается. Полный поздний ответ можно забрать ручным
latest recovery — двойным кликом по status indicator.

### Причинная цепочка ожиданий

```text
tab create/attach
  → tab load/ready
  → global dispatch lock
  → composer resolution
  → prompt insertion
  → send-button/Enter confirmation
  → PROMPT_SUBMITTED
  → answer start
  → streaming/stability
  → lifecycle completion
  → collection/finalization
```

Задержка старта последней модели включает ожидание dispatch предыдущих моделей,
поскольку `withPromptDispatchLock(...)` сериализует отправку. Поэтому timeout
одной модели в composer/send фазе способен сдвинуть начало всех следующих.

### Как читать значения

- `timeout` и `budget` задают верхнюю границу ожидания.
- `interval` и `poll` задают частоту проверки, а не общий срок.
- `delay` — одиночная пауза перед действием.
- `backoff` — последовательность задержек между повторными попытками.
- `TTL`, `cooldown` и `debounce` ограничивают повторное использование события
  или операции.
- `sleep(...)` в provider scripts указывает номинал. При включённом
  `window.__PRAGMATIST_SPEED_MODE` общий helper может сократить паузу до
  `ms × 0.35`, но не ниже `25ms`.

При диагностике изменения идут от внешнего симптома к владельцу: сначала
определяется фаза цепочки, затем константа в таблицах ниже, после чего
проверяются соседние ступени лестницы и `tests/timing-ladder.test.js`.

### Исторические снимки

Исторические snapshots не входят в текущий комплект документации.

## Полный актуальный перечень

### 1. Shared TimingConfig

Файл: `config/timing.js`.

| Setting | Значение | Что регулирует |
|---|---:|---|
| `tabLoadTimeoutMs` | `45000` | ожидание полной загрузки новой вкладки |
| `tabReadyTimeoutMs` | `15000` | warm-проверка готовности существующей вкладки |
| `promptSubmitTimeoutMs` | `15000` | fallback ожидания `PROMPT_SUBMITTED`, если нет model policy |
| `sendPromptDelayMs` | `3000` | ожидание живого content-script перед `GET_ANSWER` |
| `heartbeatIntervalMs` | `5000` | период health/heartbeat проверки вкладок |
| `heartbeatTimeoutMs` | `15000` | ожидание ответа на health ping |
| `selectorCleanupPeriodMs` | `600000` | период очистки selector state |
| `handshakeRetryMs` | `2000` | повтор `SCRIPT_READY` из content bootstrap |
| `handshakeLocationPollMs` | `1000` | polling смены URL в content bootstrap |
| `readyAckTimeoutMs` | `6000` | ожидание `ACK_READY` |
| `noFocusTimeoutMs` | `3000` | probe без фокуса перед более тяжёлым восстановлением |
| `focusRestoreDelayMs` | `1500` | задержка перед возвратом фокуса после dispatch |
| `focusRestoreMaxMs` | `5000` | максимальное окно возврата фокуса |
| `attachmentTimeoutMs` | `10000` | базовый timeout подтверждения upload |
| `attachmentPollMs` | `200` | polling подтверждения upload |

### 2. Generation Profiles

Файлы: `background/shared-state.js`, `background/job-orchestrator.js`, `background/dispatch-coordinator.js`, `content-scripts/pipeline-config.js`, `content-utils/response-lifecycle-detector.js`.

| Setting | Standard | Long | Что регулирует |
|---|---:|---:|---|
| `longGenerationMode` | `false` | `true` | persisted switch профиля |
| `GENERATION_BUDGET_*` | `450000` | `900000` | абсолютный passive deadline автоматизации модели |
| `ACTIVE_FOCUS_WINDOW_*` | `60000` | `90000` | максимум активных переключений фокуса после submit |
| `SCRIPT_RUNTIME_HARD_STOP_*` | `480000` | `930000` | аварийный hard stop transport/content runtime |
| `DEFER_STREAM_FINAL_MAX_*` | `460000` | `910000` | максимум отложенной финализации stream-кандидата |
| `ROUND4_PENDING_WAIT_MAX_*` | `500000` | `950000` | ожидание pending моделей перед round4 gate |
| `ADAPTIVE_PROBE_TOTAL_WINDOW_*` | `540000` | `990000` | общий горизонт adaptive probe/recovery |
| `BASELINE_GUARD_WINDOW_*` | `510000` | `960000` | защита от принятия старого ответа из reused tab |
| lifecycle `answerCompleteTimeoutMs` | `450000` | `900000` | effective timeout детектора, поднятый до pipeline `hardMax` |
| pipeline `hardMax` | `450000` | `900000` | максимум ожидания answer pipeline |

Важно: внутреннее имя `SHORT` в части background-кода сохранено как совместимость boolean-off ветки. Пользовательское имя этого профиля теперь `Standard`.

### 3. Background: Tabs, Ready, Dispatch

Файлы: `background/tab-manager.js`, `background/dispatch-coordinator.js`, `background/health-monitor.js`, `shared/model-policy.js`.

| Setting | Значение | Что регулирует |
|---|---:|---|
| `TAB_LOAD_TIMEOUT_MS` | `45000` | ожидание `tabs.onUpdated status=complete` после `tabs.create` |
| `TAB_READY_TIMEOUT_MS` | `15000` | ready check существующей вкладки |
| `TAB_READY_RELOAD_TIMEOUT_MS` | `25000` | ready check discarded/loading вкладки |
| `AUTO_PING_WINDOW_MS` | `45000` | окно автоматического ping чтения вкладки |
| `waitForTabComplete` poll | `250` | polling состояния вкладки |
| reusable-tab probe timer | `750` | быстрый probe reusable tab |
| `PREWARM_CHECK_INTERVAL` | `300000` | период smart tab prewarm check |
| `SEND_PROMPT_DELAY_MS` | `3000` | ожидание ready перед `GET_ANSWER` |
| `SEND_PROMPT_DELAY_OVERRIDES.Perplexity` | `1000` | более короткий ready delay для Perplexity |
| `SEND_PROMPT_DELAY_OVERRIDES.Claude` | `1500` | более короткий ready delay для Claude |
| `SEND_PROMPT_DELAY_OVERRIDES.GPT` | `1500` | более короткий ready delay для GPT |
| `SEND_PROMPT_DELAY_OVERRIDES.Le Chat` | `1000` | более короткий ready delay для Le Chat |
| `READY_ACK_TIMEOUT_MS` | `6000` | ожидание ack от content-script |
| `PROMPT_SUBMIT_TIMEOUT_MS` | `15000` | fallback ожидания `PROMPT_SUBMITTED` |
| `PROMPT_SUBMIT_TIMEOUT GPT` | `15000` | model policy ожидания отправки |
| `PROMPT_SUBMIT_TIMEOUT Gemini` | `20000` | model policy ожидания отправки |
| `PROMPT_SUBMIT_TIMEOUT Claude` | `20000` | model policy ожидания отправки |
| `PROMPT_SUBMIT_TIMEOUT Grok` | `20000` | model policy ожидания отправки |
| `PROMPT_SUBMIT_TIMEOUT Le Chat` | `20000` | model policy ожидания отправки |
| `PROMPT_SUBMIT_TIMEOUT Qwen` | `20000` | model policy ожидания отправки |
| `PROMPT_SUBMIT_TIMEOUT DeepSeek` | `22000` | model policy ожидания отправки |
| `PROMPT_SUBMIT_TIMEOUT Perplexity` | `12000` | model policy ожидания отправки |
| `PROMPT_SUBMIT_TIMEOUT Z.ai` | `20000` | model policy ожидания отправки |
| `stableTextMs GPT/default` | `1200` | стабильность текста перед terminal decision |
| `stableTextMs Gemini/Claude/Grok/Qwen/DeepSeek/Z.ai` | `1800` | model policy стабильности текста |
| `stableTextMs Le Chat/Perplexity` | `1600` | model policy стабильности текста |
| `DISPATCH_SUPERVISOR_TICK_MS` | `1200` | период supervisor retry loop |
| `DISPATCH_RETRY_BACKOFF_MS` | `[500,800,3000,8000]` | обычные задержки dispatch retry |
| `CONSERVATIVE_RETRY_BACKOFF_MS` | `[2000,2500,5000,9000]` | retry для Grok/Qwen/DeepSeek/Z.ai |
| `CONNECTION_RETRY_DELAYS` | `[500,1500,3000]` | retry transport connection |
| `CONSERVATIVE_CONNECTION_RETRY_DELAYS` | `[2000,4000,6000]` | conservative retry transport connection |
| `DISPATCH_MAX_ATTEMPTS` | `4` | максимум попыток dispatch |
| `DEFAULT_RETRY_DELAY_MS` | `2000` | fallback retry delay |
| `RECOVERY_DENY_BACKOFF_MS` | `15000` | backoff после отказа recovery intent |
| `NO_FOCUS_TIMEOUT_MS` | `3000` | no-focus probe timeout |
| `FOCUS_RESTORE_DELAY_MS` | `1500` | задержка восстановления предыдущей вкладки |
| `FOCUS_RESTORE_MAX_MS` | `5000` | максимум восстановления фокуса |
| `RETRY_FOCUS_HOLD_MS` | `3000` | удержание фокуса при retry |
| `CLAUDE_TYPING_TIMEOUT_PER_CHAR_MS` | `6` | расчёт timeout печати Claude |
| `CLAUDE_TYPING_TIMEOUT_MIN_MS` | `30000` | минимум timeout печати Claude |
| `CLAUDE_TYPING_TIMEOUT_MAX_MS` | `180000` | максимум timeout печати Claude |
| `SCRIPT_RUNTIME_HARD_STOP_ACTIVITY_WINDOW_MS` | `15000` | окно активности для grace hard stop |
| `SCRIPT_RUNTIME_HARD_STOP_GRACE_MS` | `12000` | одна grace extension hard stop |
| `SCRIPT_RUNTIME_HARD_STOP_MAX_GRACE_EXTENSIONS` | `2` | максимум grace extensions |
| `TRANSPORT_RECOVER_BACKOFF_MS` | `12000` | backoff transport recovery |

### 4. Background: Job Rounds And Recovery

Файл: `background/job-orchestrator.js`.

| Setting | Значение | Что регулирует |
|---|---:|---|
| `ROUND0_OPEN_STAGGER_MS` | `1000` | stagger открытия вкладок |
| `ROUND0_BIND_WAIT_TIMEOUT_MS` | `15000` | ожидание bind вкладки |
| `ROUND0_BIND_POLL_MS` | `250` | polling bind вкладки |
| `ROUND1_BEFORE_SEND_MS` | `500` | пауза перед send |
| `ROUND1_POST_SEND_MS` | `500` | пауза после send |
| `ROUND2_VISIT_MIN_MS` | `5000` | минимум verification visit |
| `ROUND2_VISIT_MAX_MS` | `8000` | максимум verification visit |
| `ROUND2_BATCH_MAX_MS` | `45000` | минимум batch budget round2 |
| `ROUND2_MODEL_TIME_SLICE_MS` | `8000` | добавка budget на модель: `max(45000, N*8000)` |
| `ROUND2_MODEL_VISIT_BUDGET_MS` | `7000` | per-model visit budget |
| `ROUND2_MODEL_MIN_REMAINING_MS` | `1800` | минимум остатка, чтобы визит был полезен |
| `ROUND2_MODEL_MIN_DWELL_MS` | `1400` | минимум dwell на вкладке |
| `ROUND2_REPAIR_CONFIRM_WAIT_MS` | `3500` | ожидание repair confirm |
| `ROUND2_REPAIR_CONFIRM_POLL_MS` | `250` | polling repair confirm |
| `PRECOLLECT_NUDGE_STABILIZE_MS` | `250` | settle после precollect nudge |
| `ROUND3_COLLECT_DELAY_MS` | `2000` | задержка перед collect |
| `ROUND3_START_DELAY_MS` | `2000` | задержка старта round3 |
| `ROUND3_PRECOLLECT_VISIT_MIN_MS` | `5000` | минимум precollect visit |
| `ROUND3_PRECOLLECT_VISIT_MAX_MS` | `8000` | максимум precollect visit |
| `ROUND4_FOCUS_DELAY_MS` | `500` | задержка фокуса round4 |
| `ROUND4_PENDING_POLL_MS` | `1500` | polling pending gate |
| `ROUND4_GATE_WAIT_TELEMETRY_MS` | `15000` | период telemetry пока gate ждёт |
| `NO_SEND_STALL_GRACE_MS` | `45000` | grace для NO_SEND stall |
| `POST_R2_AUTO_COLLECT_DELAY_MS` | `8000` | задержка auto collect после round2 |
| `POST_R2_AUTO_COLLECT_VISIT_MIN_MS` | `5000` | минимум post-r2 collect visit |
| `POST_R2_AUTO_COLLECT_VISIT_MAX_MS` | `8000` | максимум post-r2 collect visit |
| `CLAUDE_RETRY_VISIT_MIN_MS` | `5000` | минимум Claude retry visit |
| `CLAUDE_RETRY_VISIT_MAX_MS` | `8000` | максимум Claude retry visit |
| `CLAUDE_RETRY_DELAY_MS` | `4000` | задержка Claude retry |
| `CLAUDE_RETRY_FINALIZE_MS` | `20000` | ожидание финализации после Claude retry |
| `MANUAL_PING_WINDOW_MS` | `20000` | окно manual ping |
| `ADAPTIVE_PROBE_FAST_WINDOW_MS` | `20000` | быстрый сегмент adaptive probe |
| `ADAPTIVE_PROBE_MEDIUM_WINDOW_MS` | `60000` | средний сегмент adaptive probe |
| `ADAPTIVE_PROBE_FAST_INTERVAL_MS` | `2500` | interval fast probe |
| `ADAPTIVE_PROBE_MEDIUM_INTERVAL_MS` | `6000` | interval medium probe |
| `ADAPTIVE_PROBE_SLOW_INTERVAL_MS` | `12000` | interval slow probe |
| `EARLY_GESTURE_RECOVERY_MIN_ELAPSED_MS` | `45000` | earliest gesture recovery |
| `EARLY_GESTURE_RECOVERY_COOLDOWN_MS` | `30000` | cooldown gesture recovery |
| `EARLY_GESTURE_RECOVERY_VISIT_MIN_MS` | `2200` | минимум gesture recovery visit |
| `EARLY_GESTURE_RECOVERY_VISIT_MAX_MS` | `3200` | максимум gesture recovery visit |
| `HARD_STOP_DEFER_WINDOW_DEFAULT_MS` | `12000` | default defer hard stop |
| `HARD_STOP_DEFER Gemini` | `24000` | model-specific defer hard stop |
| `HARD_STOP_DEFER Claude/Le Chat/Perplexity/Grok` | `18000` | model-specific defer hard stop |
| `HARD_STOP_ACTIVITY_GRACE_MS` | `15000` | активность, разрешающая defer hard stop |
| `HARD_STOP_DEFER_RECOVERY_VISIT_MIN_MS` | `2000` | минимум recovery visit |
| `HARD_STOP_DEFER_RECOVERY_VISIT_MAX_MS` | `3200` | максимум recovery visit |
| `PRE_TERMINAL_MATERIALIZE_VISIT_MIN_MS` | `5200` | минимум pre-terminal materialize visit |
| `PRE_TERMINAL_MATERIALIZE_VISIT_MAX_MS` | `7600` | максимум pre-terminal materialize visit |
| `PRE_TERMINAL_MATERIALIZE_SCROLL_MAX_MS` | `5600` | максимум scroll при materialize |
| `PRE_TERMINAL_MATERIALIZE_SETTLE_MS` | `1100` | settle после materialize |
| `PRE_TERMINAL_MATERIALIZE_COOLDOWN_MS` | `45000` | cooldown materialize |
| `TERMINAL_EXTRACTION_RECOVERY_DELAYS_MS` | `[12000,35000,75000]` | delayed recovery extraction |
| `MATERIALIZE_LATEST_RETRY_WAIT_MS` | `1800` | retry pause latest materialization |
| `FAST_PING_RETRY_DELAYS_MS` | `[700,1500,2600]` | quick ping retry ladder |
| `HARD_STOP_PING_RETRY_DELAYS_MS` | `[350,900,1700,2800]` | ping retry after hard stop |
| `MODEL_FINAL_DEDUP_WINDOW_MS` | `20000` | final answer dedupe window |
| `RECOVERABLE_TERMINAL_MANUAL_PING_WINDOW_MS` | `180000` | окно ручного ping для recoverable terminal |
| `DOM_SNAPSHOT_RECOVERY_COOLDOWN_MS` | `5000` | cooldown DOM snapshot recovery |
| `LATE_COLLECT_TOTAL_BUDGET_MS` | `12000` | общий budget late collect |
| `LATE_COLLECT_PING_TIMEOUT_MS` | `900` | ping timeout late collect |
| `LATE_COLLECT_SLOW_PING_TIMEOUT_MS` | `1500` | slow ping timeout late collect |
| `LATE_COLLECT_EXECUTE_TIMEOUT_MS` | `3500` | executeScript timeout late collect |
| `LATE_COLLECT_POST_LIVE_WAIT_MS` | `700` | wait после live ping |
| `LATE_COLLECT_SINGLE_FLIGHT_COOLDOWN_MS` | `2500` | cooldown single-flight late collect |
| `LATE_COLLECT_SNAPSHOT_TTL_MS` | `3600000` | TTL late snapshot cache |
| `RECOVERY_BUDGET_DEFAULT.maxTotalMs` | `90000` | общий budget recovery |
| `RECOVERY_BUDGET_CONNECTION_FRAGILE.maxTotalMs` | `120000` | recovery budget для Gemini/Perplexity |
| `DEFER_STREAM_FINAL_RECHECK_MS` | `8000` | базовый recheck defer-final |
| `DEFER_STREAM_FINAL_RECHECK_MAX_MS` | `32000` | cap recheck defer-final |
| `DEFER_STREAM_FINAL_RECHECK_BACKOFF` | `1.6` | multiplier defer recheck |
| `DEFER_STREAM_STABLE_FORCE_MS` | `30000` | stable pending force-success window |
| `STABLE_PENDING_AUTO_FINALIZE_MS` | `30000` | auto-finalize stable pending |
| `EARLY_TERMINAL_GUARD_MAX_WAIT_MS` | `20000` | максимум ожидания early terminal guard |
| `EARLY_TERMINAL_GUARD_STABLE_MS` | `2500` | стабильность early terminal guard |
| `EARLY_TERMINAL_GUARD_REPING_MS` | `2200` | reping early terminal guard |
| `DISPATCH_BUDGET_MS` | `120000` | budget фазы dispatch |
| `COLLECT_BUDGET_MS` | `60000` | budget фазы collect |
| `MV3_SURVIVAL_ALARM_PERIOD_MIN` | `0.5` | период survival alarm |

Когда абсолютный budget `generation` или `collect` исчерпан, background фиксирует
terminal-результат и отправляет во вкладку модели `HUMANOID_FORCE_STOP` вместе с
`STOP_AND_CLEANUP`. Это завершает скроллинг, наблюдатели и прочую автоматизацию
расширения. Если во вкладке выполняется запрос расширения, `STOP_AND_CLEANUP`
также нажимает кнопку остановки генерации провайдера (`stopButton` из
`answer-pipeline-selectors.js`) и ждёт до 3 с исчезновения индикатора; без
подтверждения результат журналируется как `stop_unconfirmed`.

Смена профиля Long → Standard во вкладке откладывается, пока в ней выполняется
запрос расширения (не дольше Long `hardMax`); Standard → Long применяется сразу.

### 5. Human Presence And Focus

Файл: `background/human-presence.js`.

| Setting | Значение | Что регулирует |
|---|---:|---|
| `HUMAN_VISIT_INITIAL_DELAY_MS` | `7000` | задержка первого human visit |
| `HUMAN_VISIT_DWELL_MS` | `3000` | dwell визита |
| `HUMAN_VISIT_SCROLL_DURATION_MS` | `3600` | длительность scroll activity |
| `HUMAN_VISIT_LOOP_PAUSE_MS` | `1500` | пауза между visit loop |
| `HUMAN_VISIT_HARD_CAP_MS` | `12000` | hard cap одного визита |
| `VISIT_QUOTA_WINDOW_MS` | `60000` | окно подсчёта квоты визитов |
| `VISIT_QUOTA_MAX_MS` | `20000` | максимум foreground времени в окне |
| `VISIT_QUOTA_COOLDOWN_MS` | `15000` | cooldown после превышения квоты |
| `HUMAN_VISIT_MIN_USEFUL_MS` | `1500` | минимум полезного визита |
| `POST_SUCCESS_SCROLL_ATTEMPTS_MS` | `[0,1200,3600]` | post-success scroll audit attempts |
| `DEFERRED_VISIT_DELAYS_MS` | `[15000,45000,90000]` | отложенные visits |
| `TAB_LEASE_TTL_MS` | `12000` | TTL аренды вкладки |
| `PROGRAMMATIC_FOCUS_GRACE_MS` | `1500` | grace для programmatic focus marker |
| `FOCUS_STUCK_THRESHOLD_MS` | `30000` | порог stuck focus |

После истечения `ACTIVE_FOCUS_WINDOW_*` visits и programmatic activations больше не должны забирать фокус; пассивное ожидание ответа продолжается до `GENERATION_BUDGET_*`.

### 6. Answer Pipeline

Файл: `content-scripts/pipeline-config.js`.

| Setting | Standard | Long | Что регулирует |
|---|---:|---:|---|
| `preparation.tabActivationTimeout` | `3000` | `3000` | legacy потолок tab activation |
| `preparation.streamStartTimeout` | `60000` | `90000` | ожидание старта stream |
| `preparation.streamStartPollInterval` | `100` | `100` | polling старта stream |
| `adaptiveTimeout.short.timeout` | `50000` | `100000` | лимит короткого ответа |
| `adaptiveTimeout.medium.timeout` | `112000` | `225000` | лимит среднего ответа |
| `adaptiveTimeout.long.timeout` | `225000` | `450000` | лимит длинного ответа |
| `adaptiveTimeout.veryLong.timeout` | `450000` | `900000` | лимит очень длинного ответа |
| `adaptiveTimeout.softExtension` | `75000` | `150000` | мягкое продление при активности |
| `adaptiveTimeout.hardMax` | `450000` | `900000` | абсолютный максимум answer pipeline |
| `intelligentRetry.maxRetries` | `8` | `10` | retry selector/stream checks |
| `intelligentRetry.backoffSequence` | `[500,1000,2000,3000,4000,5000,5000,5000]` | `[500,1000,2000,3000,4000,5000,6000,7000,8000,8000]` | backoff retry |
| `intelligentRetry.noGrowthThreshold` | `4` | `5` | сколько no-growth циклов терпеть |
| `settlementWatcher.idleThreshold` | `3500` | `3500` | idle перед settlement |
| `settlementWatcher.maxDuration` | `120000` | `180000` | максимум settlement watcher |
| `completionCriteria.mutationIdle` | `4500` | `4500` | отсутствие DOM mutations |
| `completionCriteria.scrollStable` | `6000` | `6000` | стабильность scroll |
| `completionCriteria.contentStable` | `4500` | `4500` | стабильность текста |
| `completionCriteria.contentStableChecks` | `4` | `5` | число stable checks |
| `completionCriteria.stopButtonCacheMaxAgeMs` | `3000` | `3000` | свежесть stop-button evidence |
| `completionCriteria.checkInterval` | `1000` | `1000` | interval проверки completion |
| `continuousActivity.interval` | `5000` | `5000` | период synthetic activity |
| `continuousActivity.pauseBetweenMoves` | `3000` | `3000` | пауза между движениями |
| `maintenanceScroll.checkInterval` | `3000` | `3000` | период maintenance scroll |
| `maintenanceScroll.idleThreshold` | `5000` | `5000` | idle threshold scroll |
| `maintenanceScroll.maxDuration` | `60000` | `60000` | max maintenance scroll |
| `finalization.stabilityChecks` | `4` | `5` | число финальных stable checks |
| `finalization.stabilityInterval` | `2500` | `2500` | интервал финальных stable checks |
| `sanityCheck.recentGrowthWindow` | `2000` | `2000` | окно проверки recent growth |
| `platforms.deepseek.streamStartTimeout` | `45000` | `45000` | override старта stream DeepSeek |
| `platforms.perplexity.streamStartTimeout` | `20000` | `20000` | override старта stream Perplexity |
| `chatgpt.initialScrollKick.delay` | `1000` | `1000` | стартовый scroll kick ChatGPT |

### 7. Response Lifecycle Detector

Файл: `content-utils/response-lifecycle-detector.js`.

| Setting | Значение | Что регулирует |
|---|---:|---|
| `BODY_MUTATION_THROTTLE_MS` | `500` | throttle body mutation observer |
| `ANSWER_GENERATING_TELEMETRY_THROTTLE_MS` | `15000` | throttle telemetry `ANSWER_GENERATING` |
| `STUCK_BUSY_OVERRIDE_MIN_MS` | `6000` | минимум стабильности для stuck busy override |
| `LIFECYCLE_READINESS_RESOLVER_TIMEOUT_MS` | `800` | readiness resolver timeout |
| `answerStartTimeoutMs` | `30000` | ожидание появления ответа |
| `answerCompleteTimeoutMs` | `450000`, effective `450000/900000` | ожидание завершения ответа |
| `stableMs` | `1500` | окно стабильности текста |
| `pollIntervalMs` | `600` | polling lifecycle |
| `waitForAnswerStart.pollIntervalMs` | `500` | default polling старта |
| stuck busy threshold | `max(4*stableMs,6000)` | порог декоративного loading override |

### 8. Content Bootstrap, Base Adapter, Selector Watcher

| Setting | Значение | Что регулирует |
|---|---:|---|
| `MAX_READY_ATTEMPTS` | `5` | максимум initial ready attempts |
| `READY_RETRY_MS` | `2000` | повтор `SCRIPT_READY` |
| `LOCATION_POLL_MS` | `1000` | polling SPA URL |
| `BaseLLMAdapter.NAVIGATION_POLL_MS` | `250` | polling navigation |
| `BaseLLMAdapter.DEFAULT_WAIT_STEP_MS` | `75` | шаг ожидания DOM элемента |
| `BaseLLMAdapter.DEFAULT_WAIT_TIMEOUT_MS` | `10000` | default DOM wait |
| `ContentUtils.FOCUS_REQUEST_THROTTLE_MS` | `3000` | throttle focus requests |
| `ContentUtils.sleep speed coefficient` | `0.35` | ускорение sleeps в speed mode |
| `ContentUtils.sleep speed min` | `25` | минимум sleep в speed mode |
| `SELECTOR_MISS_WINDOW_MS` | `5000` | агрегирование selector miss |
| `SELECTOR_STATS_WINDOW_MS` | `5000` | окно selector stats |
| `SELECTOR_STATS_DEDUP_WINDOW_MS` | `30000` | dedupe selector stats |
| `detectorTickWindowMs` | `5000` | окно detector tick telemetry |

### 9. Provider Content Scripts

Общие attachment waits во многих адаптерах: attach button `1200/120`, file input `3000/120`, click settle `300`, upload settle `1800`, некоторые DnD waits `40`, `100`, `1200`, `1400`.

| Provider | Setting | Значение | Что регулирует |
|---|---|---:|---|
| GPT | start composer sleep | `450` | пауза перед поиском composer |
| GPT | `findAndCacheElement(inputField)` | `10000` или default `30000` | поиск input |
| GPT | post-attachment sleep | `400` | settle attachments |
| GPT | prompt set sleeps | `120`, `2000` | settle после вставки |
| GPT | send enable loop | `2500` + poll `120` | ожидание enabled send |
| GPT | send confirm loop | `1600` + poll `120` | подтверждение отправки |
| GPT | prepared dedupe | `30000` | dedupe prepared prompt |
| GPT | metrics report | `300000` | период provider metrics |
| Claude | initial inject sleep | `250` | стартовая пауза |
| Claude | `findAndCacheElement` | `30000` | поиск input/send |
| Claude | typing sleeps | `150`, `100`, `200` | human typing fallback |
| Claude | send enabled waits | `1500`, `2000`; poll `50` | ожидание кнопки |
| Claude | send confirm poll | `120` | проверка confirmation |
| Claude | autoExtractResponse | `120000` | selector extraction wait |
| Claude | ping response wait | `45000`, poll `900` | manual/adaptive ping |
| Claude | prepared dedupe | `30000` | dedupe prepared prompt |
| Claude | metrics report | `300000` | период provider metrics |
| Gemini | selector finder response | `60000` | fallback extraction |
| Gemini | fresh answer wait | `90000`, poll `500` | ожидание свежего ответа |
| Gemini | composer search sleep | `1000` | стартовая пауза |
| Gemini | after `EXT_SET_TEXT` | `150` | settle input |
| Gemini | human read | `600` | human-like read before fallback |
| Gemini | send activation sleep | `2000` | ожидание активации send |
| Gemini | confirm send | `3500`, poll `120` | подтверждение отправки |
| Gemini | submit dedupe | `600000` | dedupe submit baseline |
| DeepSeek | composer sleep | `250` speed / `1200` normal | стартовая пауза |
| DeepSeek | selector finder composer | `20000` | поиск composer |
| DeepSeek | selector finder send | `15000` | поиск send |
| DeepSeek | confirm send | `2200`, `2000`, `3000`; poll `120` | подтверждение отправки |
| DeepSeek | pre-confirm sleep | `2000` | settle перед confirm |
| DeepSeek | reply wait | `150000`; ping `120000` | ожидание ответа |
| DeepSeek | DOM wait interval | `600` | polling DOM reply |
| Perplexity | blocker marker TTL | `120000` | TTL transient blocker |
| Perplexity | blocker message retries | `[0,250,750]` | retry blocker message |
| Perplexity | handoff retries | `[500,1500,3000,5000]` | retry handoff |
| Perplexity | visible composer wait | `15000` | ожидание composer |
| Perplexity | selector finder response | `90000` | fallback extraction |
| Perplexity | initial inject sleep | `120` | стартовая пауза |
| Perplexity | find input/send default | `30000` | поиск DOM |
| Perplexity | input settle | `80`, `150`, `100`, `250` | вставка и валидация текста |
| Perplexity | trusted input fallback wait | `2000` | settle перед send |
| Perplexity | send confirm | `6000`, poll `120` | подтверждение отправки |
| Qwen | short fallback timeout | `12000` | fallback extraction |
| Qwen | composer sleep | `1000` | стартовая пауза |
| Qwen | find DOM default | `30000` | поиск composer/send |
| Qwen | composer value retries | `6*220`, calls `7*250` | подтверждение вставки |
| Qwen | send selector timeout | `12000` | поиск send |
| Qwen | confirm send | `2000`, poll `120` | подтверждение отправки |
| Qwen | late send signals | `7000` | позднее подтверждение отправки |
| Qwen | reply wait | `150000`; ping `120000`; fallback `18000` | ожидание ответа |
| Qwen | DOM wait interval | `700` | polling DOM reply |
| Le Chat | composer search sleep | `1200` | стартовая пауза |
| Le Chat | selector finder composer | `25000` | поиск composer |
| Le Chat | fallback DOM find | `30000` | поиск DOM |
| Le Chat | wait send enabled | `2500`, poll `150` | ожидание enabled |
| Le Chat | confirm send | `3000/3500/4000/900`, poll `120` | подтверждение отправки |
| Le Chat | reply wait | `150000`; ping `120000` | ожидание ответа |
| Le Chat | metrics report | `300000` | период provider metrics |
| Grok | submitted prompt wait | `10000`, poll `200` | проверка submit |
| Grok | fallback send button | `8000`, poll `200` | поиск send |
| Grok | composer stabilization | `5*200`, calls `6*240`, `8*180` | стабильность composer |
| Grok | composer commit | `5000`, poll `250` | подтверждение вставки |
| Grok | response activity | `9000`, `8000`, `6500` | подтверждение старта ответа |
| Grok | composer clear | `3500`, `1500`, `1800`, `2200` | подтверждение очистки composer |
| Grok | non-echo wait | `12000/15000` | поиск не-echo ответа |
| Grok | DOM answer wait | `45000`, interval `900` | DOM fallback extraction |
| Grok | DOM evaluate interval | `400` | polling DOM |
| Grok | metrics report | `300000` | период provider metrics |
| Z.ai | waitForFirst | `20000`, poll `120` | поиск первого DOM элемента |
| Z.ai | prompt settle | `150`, `250`, `120` | вставка и send settle |
| Z.ai | stable response | `180000`, poll `500` | ожидание стабильного ответа |

Начиная с 2.81.246 исходные счётчики ходов, ответов и элементов генерации для
Claude снимаются один раз до первой попытки Send. Все повторные проверки в рамках
этой отправки сравниваются с той же исходной точкой; техническая ошибка
`send not confirmed` не является текстом ответа.

С 2.81.247 отсутствие прямого подтверждения не останавливает Claude-экстрактор:
он продолжает ожидание в пределах обычного pipeline/DOM timeout. Новый ответ после
предотправочного assistant-якоря подтверждает отправку; старый baseline-ответ — нет.

С 2.81.248 это правило действует на общем уровне для любой модели. При кандидате
`NO_SEND` из-за неподтверждённого Send оркестратор проверяет свежий ответ в точках
`0`, `10`, `30`, `65`, `110` и `165` секунд. Проверки прекращаются сразу после
доказанного нового ответа; прежний DOM-ответ и ошибки загрузки вложений не принимаются.

### 10. Attachments

Файл: `content-scripts/attachment-handler.js`.

| Setting | Значение | Что регулирует |
|---|---:|---|
| `DEFAULT_TIMEOUT_MS` | `10000` | базовое ожидание upload evidence |
| `DEFAULT_POLL_MS` | `200` | polling upload evidence |
| scaled timeout | `timeoutMs * fileCount` | если `scaleTimeoutByFileCount !== false` |

### 11. Telemetry, Selector, Storage, API

| Setting | Значение | Что регулирует |
|---|---:|---|
| `DISPATCH_ID_TTL_MS` | `900000` | TTL idempotency ledger dispatch id |
| `DISPATCH_CIRCUIT_DEBOUNCE_MS` | `2000` | debounce persist circuit |
| `DISPATCH_ID_DEBOUNCE_MS` | `1500` | debounce persist dispatch id |
| retry strategy `baseDelayMs` | `1000` | base retry delay |
| retry strategy `maxDelayMs` | `30000` | max retry delay |
| `PLATFORM_DEGRADED_COOLDOWN_MS` | `900000` | cooldown degraded platform |
| `PLATFORM_DEGRADED_HOURLY_COOLDOWN_MS` | `3600000` | hourly degraded cooldown |
| telemetry sample TTL | `600000` | TTL sample cache |
| `shared/message-delivery.js JOURNAL_LIMIT` | `3000` событий | максимальный размер журнала доставки за сессию страницы; не временной интервал |
| pipeline complete TTL | `600000` | TTL completed pipeline cache |
| `SELECTOR_METRICS_FLUSH_MS` | `5000` | flush selector metrics |
| `VERSION_STATUS_REFRESH_MINUTES` | `1440` | selector version audit alarm |
| `REMOTE_SELECTORS_REFRESH_MS` | `21600000` | refresh remote selectors |
| `REMOTE_SELECTORS_FETCH_TIMEOUT_MS` | `15000` | fetch abort timeout |
| `SELECTOR_CACHE_TTL_MS` | `2592000000` | TTL selector cache |
| `API_CONNECTION_TIMEOUT_MS` | `2000` | API fallback connect timeout |
| `API_RESPONSE_TIMEOUT_MS` | `5000` | API fallback response timeout |
| `HEALTH_CHECK_TIMEOUT_MS` | `15000` | health ping timeout |
| `HEALTH_CHECK_ERROR_COOLDOWN_MS` | `30000` | cooldown unresponsive report |
| `HEARTBEAT_INTERVAL` | `5000` | health loop period |
| `HEARTBEAT_TIMEOUT` | `15000` | heartbeat timeout |
| `READY_WAIT_TIMEOUT_MS` | `6000` | ready wait fallback |

### 12. Disput Runtime And UI

Файлы: `results.js`, `disput/*.js`.

| Setting | Значение | Что регулирует |
|---|---:|---|
| `DEFAULT_RETRY.delayMs` | `0` | retry delay Disput policy |
| `DEFAULT_BUDGETS.maxElapsedTimeMs` | `null` | elapsed budget disabled by default |
| `autoApprovalDelayMs` | `0`, clamp `0..60000` | auto approval delay |
| Debate orchestrator `leaseTtlMs` | `30000` | lease TTL run owner |
| Debate orchestrator `leaseHeartbeatMs` | `leaseTtl/3` | lease heartbeat |
| Debate run store `MAX_EVENTS` | `500` | bounded event history |
| Debate trace `flushDelayMs` | `500`, min `50` | debounce trace flush |
| `DEBATE_AUTO_TURN_RETRY_DELAY_MS` | `1200` | retry delay auto turn |
| `DEFAULT_PIPELINE_WAIT_TIMEOUT_MS` | `240000` | запрошенное ожидание batch pipeline; фактический срок не короче нижней границы `TransportContract` |
| `TransportContract.resolvePanelWaitTimeoutMs` | Standard `615000`, Long `1110000` | `hardMax` вкладки + `streamStartTimeout` + `PANEL_WAIT_MARGIN_MS` (`120000`): панель не прекращает ждать раньше, чем вкладка может закончить генерацию |
| `SLOW_MODEL_PIPELINE_WAIT_TIMEOUT_MS` | `600000` | ожидание pipeline при Qwen (перекрывается нижней границей контракта) |
| `PIPELINE_BATCH_GUARD_RETRY_MS` | `500` | интервал повтора старта, отклонённого как `RUN_ALREADY_ACTIVE` |
| `UNCERTAIN_TERMINAL_QUIET_MS` (фон) | `30000` | неопределённый финал протокола (`AMBIGUOUS`, `CONTEXT_LOST`) после подтверждённой отправки откладывается, пока текст ответа растёт; фиксируется, когда текст не менялся столько времени |
| `UNCERTAIN_TERMINAL_MAX_DEFER_MS` (фон) | `180000` | жёсткий предел отсрочки независимо от активности вкладки |
| `UNCERTAIN_TERMINAL_POLL_MS` (фон) | `5000` | период проверки роста текста при отсрочке |
| `STATIC_WATCH_TICK_MS` / `STATIC_WATCH_TOKEN_QUIET_MS` / `STATIC_WATCH_NUDGE_AFTER_MS` / `STATIC_WATCH_COMMIT_AFTER_MS` / `STATIC_WATCH_NUDGE_SETTLE_MS` (фон) | `3000` / `5000` / `15000` / `30000` / `10000` | наблюдатель за неизменным текстом: период проверки, тишина при метке доставки, срок до Get it, срок до фиксации неполного ответа, окно ожидания после Get it |
| `PIPELINE_START_BUSY_WAIT_MS` | `120000` | сколько панель повторяет старт, пока фон занят раундами или вкладка ещё генерирует |
| `NOTE_DBLCLICK_DELAY` | `320` | распознавание double-click заметки |
| `SESSION_DBLCLICK_DELAY` | `320` | распознавание double-click session |
| `modifiersToggleClickDelayMs` | `220` | single/double click modifiers |
| `DEBATE_SESSION_CLICK_DELAY_MS` | `180` | single/double click debate session |
| `EXPORT_SNAPSHOT_DEADLINE_MS` | `300` | deadline snapshot export |
| `crossViewNavigationIntentTtlMs` | `15000` | TTL навигационного intent |
| `sidebarSessionViewIntentTtlMs` | `15000` | TTL sidebar session intent |
| boot UI recover | `1500`, `10000`, every `30000` | recovery hidden UI watchdog |
| modal force unlock on blur | `200` | unlock modal after blur |
| devtools telemetry load | `0`, `1000` | deferred devtools loader |

### 13. Misc Runtime Timers

Эти значения не управляют временем ответа модели напрямую, но являются runtime-таймерами системы.

| Setting | Значение | Что регулирует |
|---|---:|---|
| initial storage maintenance defer | `1000` | отложенный запуск migrate/prune storage |
| pre-dispatch health ping fallback | `1000` | fallback ответа health ping перед dispatch |
| reload settle after pre-dispatch reload | `1200` | ожидание после reload перед продолжением dispatch |
| prewarm inter-model pause | `3000` | пауза между prewarm обработкой моделей |
| notes selector record timeout | `15000` | максимум режима записи selector click target |
| Pragmatist runner connect deadline | `2500` | поиск response container при boot |
| Pragmatist runner connect poll | `250` | polling response container |
| Pragmatist core DOM wait | `5000` | ожидание DOM container |
| Pragmatist core DOM wait poll | `200` | polling DOM container |
| Pragmatist navigation poll fallback | `1000` | polling SPA navigation |
| status indicator smoke test defer | `600` | debug-only auto smoke test delay |
| object URL revoke after downloads | `0` или `1000` | освобождение blob URL после export/download |

### Composer interaction

Health PING перед dispatch ограничен `READY_ACK_TIMEOUT_MS` (`6000ms`),
обычная проверка здоровья — `15000ms`. Recovery reload ограничен `30000ms`
включая подготовительную паузу `500ms` и ожидание Chrome API; отсчёт начинается
до запроса reload, а не после разрешения его Promise.

Перед вставкой и кликом Humanoid прокручивает только невидимую цель через native
instant scroll. Ожидание settlement страницы (до `5000ms` на каждый lookAt)
в этом пути удалено. Вставка вызывает один click/moveTo/lookAt вместо двух lookAt.
Неудачная целиковая вставка сразу передаёт ошибку provider fallback, без
посимвольного ожидания, пропорционального длине запроса.
