# Completion Protocol V2

Completion V2 использует существующий per-dispatch tracker `ResponseLifecycleDetector` как единственного владельца terminal decision. `UnifiedAnswerCompletionWatcher`, provider controls, mutation observer и `GenerationSignal` поставляют только `WitnessEvent` в append-only Evidence Ledger.

Success определяется буквально:

```text
GENERATION_OBSERVED
&& PRODUCER_TERMINAL
&& CONTENT_TERMINAL
&& OWNERSHIP_CONFIRMED
&& !ACTIVE_VETO
```

Copy, Regenerate, completion marker, исчезновение Stop и transport marker переводят producer только в `CANDIDATE`. После configurable confirmation window substantive content/structure progress или active generation отзывают candidate. Score сохраняется лишь как `diagnosticConfidence`.

`CONTENT_TERMINAL` требует stable structural verification, восстановленной length regression и неизменности generic Materialization/Hydration pass. Проверенные text, HTML, hashes и response identity фиксируются одной immutable `ExtractionSnapshot`; Unified pipeline не выполняет повторный answer lookup.

Non-success состояния типизированы: `CONTINUE_REQUIRED`, `PROVIDER_ERROR`, `INTERRUPTED`, `STALLED`, `AMBIGUOUS`, `CONTEXT_LOST`. Progress, producer-stuck и hard-attempt timeout независимы и никогда не дают success. Recovery перед resume проходит `RecoveryReconciler`.

Production default — `enforced`: сохранённые ранее `enabled:false`, `legacy` или `shadow` не могут отключить Completion authority. Режимы `legacy`/`shadow` доступны только при явном аварийном флаге `allowLegacyCompletionRollout:true`. Background принимает ответ только от зарегистрированного correlated attempt. `SUCCESS_TERMINAL` является сильным terminal proof; явно failed terminal блокирует доставку. Отсутствующий или `UNCERTAIN` terminal не уничтожает связанный ответ на transport boundary, а передаёт его обычным answer-verification/finalization gates. Weighted score остаётся только диагностикой.

`SCRIPT_READY` считается действительным только при точном совпадении build-, detector- и protocol-version и наличии `CompletionSession`. Stale или неполный content runtime автоматически получает protocol, selector resolver, lifecycle detector и bootstrap заново, после чего повторяет handshake. Обычная, ручная и recovery-финализация проходят один background authority gate, поэтому прямой вызов `handleLLMResponse` не может обойти terminal decision.

Readiness изолирован по модели: Round 0 не ждёт общий барьер всех вкладок, а обновление расширения не перезагружает provider pages. Page/runtime recovery выполняется перед dispatch конкретной модели.

Перед provider command background напрямую проверяет и при необходимости восстанавливает Completion runtime, затем получает быстрый provider health PONG. Старый `SCRIPT_READY` replay остаётся только fallback для runtime без direct probe и не добавляет фиксированные шесть секунд каждой вкладке. MV3 survival reconcile не имеет права читать persisted state поверх активного in-memory Round 1.

Composer transaction имеет обязательный порядок:

```text
COMMAND_ACCEPTED → ATTEMPT_PREPARED → BASELINE_ACKED
→ ATTACHMENT_SETTLED → PROMPT_COMMITTED → SUBMITTING → SUBMITTED
```

`ATTEMPT_PREPARED` резервирует authority в background и сохраняет её в run state, но не запускает answer clocks. Observer и baseline устанавливаются до Send, чтобы не потерять быстрый ответ; `CompletionSession` и timeout clocks активируются только после `PROMPT_SUBMITTED`. Preflight выполняется до attachment/composer side effects, но отказ telemetry/runtime-регистрации больше не блокирует физическую отправку: adapter публикует `completion_preflight_degraded` и продолжает composer transaction. Это сохраняет базовую доставку prompt при временно недоступном Completion runtime; background recovery и обычные verification gates продолжают контролировать сбор результата. Focus lease принадлежит transaction до `SUBMITTED` или terminal failure; `PROMPT_COMMITTED` — только progress. После неподтверждённого Send готового draft разрешён только bounded send-only retry с точным совпадением prompt, без повторной загрузки файла и повторной вставки.

Background подтверждает `ATTEMPT_PREPARED` синхронно после correlated acceptance; полная persistence `jobState` не входит в ACK critical path. Submit-confirmation waiter регистрируется до content command, чтобы не потерять быстрый сигнал, но его timeout вооружается только событием `send_action_requested` (с bounded аварийным fallback). Поэтому медленная загрузка файла не создаёт ложный `PROMPT_SUBMITTED_TIMEOUT`. В telemetry доставка команды и физический Send разделены на `DISPATCH_COMMAND_ACCEPTED` и `DISPATCH_SEND`.

Переходы capability health для `generationSignal`, `producerControls`, `answerResolution` и `continueDetection` публикуются в canonical ledger как `OBSERVER_HEALTH_OBSERVED`; неизменившиеся состояния дедуплицируются. Shadow delta сохраняется отдельным canonical audit-событием `COMPLETION_SHADOW_DECISION`. Локальный `PRODUCER_TERMINAL` остаётся producer-state fact и не подменяет provider finish reason уровня Tier 4; полный V2 `SUCCESS_TERMINAL` даёт составное доказательство Tier 3.

Сценарная regression matrix находится в `tests/completion-protocol-e2e.test.js` и фиксирует normal/long streaming, stalled partial, early controls, temporary Stop disappearance, delayed hydration/structure, length regression, node replacement, Continue, provider error, SPA navigation, cosmetic churn и immutable extraction race. Отдельные integration-регрессии проверяют stale runtime repair, обязательный enforced rollout, состав двухфайловой production-сборки и запрет recovery bypass.
