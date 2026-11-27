# Model tabs architecture

> Нормативный документ для главной страницы результатов и вкладок выбранных
> моделей. Сводка текущей документации находится в `docs/project-overview.md`.

## Scope

Главная страница (`result_new.html`) запускает один пользовательский prompt на
выбранном наборе моделей. Этот документ описывает только выбор моделей,
владение вкладками, dispatch и связь UI → background → content script.

Debate topology, FSM, prompts и round plans описаны отдельно в актуальном
каталоге `docs/disput/` и protocol specs. Детали CSS-селекторов и ручного
record/override находятся в selector guides; не копировать их сюда.

## Ownership map

| Область | Владелец | Ответственность |
|---|---|---|
| Model buttons и selection UI | `result_new.html`, `results.js`, `content-scripts/model-selection-toolbar.js` | выбор/снятие модели, ограничители схемы, view-scoped persistence |
| Results page orchestration | `results.js`, `results/boot-utils.js`, `results/dom-utils.js` | запуск UI, карточки, prompt, lifecycle display |
| Target catalog | `background/llm-targets.js` | canonical model names, URLs, attach/reuse rules |
| Tab ownership | `background/tab-manager.js`, `background/shared-state.js` | создание, attach/reuse, binding `model → tabId`, session scope |
| Dispatch coordination | `background/dispatch-coordinator.js`, `background/dispatch-state-machine.js` | lock, queue, send boundary, retries and correlation IDs |
| Run orchestration | `background/job-orchestrator.js`, `background/message-router.js` | batch lifecycle, provider recovery, terminal outcome |
| Provider DOM adapter | `content-scripts/unified-answer-pipeline.js`, provider scripts, `content-utils/*` | composer/send/extraction/lifecycle signals |
| Selector configuration | `selectors/*.config.js`, `selectors/config-bundle.*`, `shared/selector-profile-lifecycle.js` | selector candidates, profiles, overrides and health |
| Diagnostics | `background/telemetry-logs.js`, `results-devtools.js`, `shared/telemetry-export.js` | run-scoped evidence, health and export |

`results.js` may render compatibility projections, but it must not invent a
second tab registry. Background owns tab identity and delivery; content scripts
own provider DOM operations.

При выборе ответа позиция DOM-узла сама по себе не является доказательством.
Общий resolver просматривает кандидатов текущего хода от новых к старым и
пропускает prompt echo, служебные подписи и технические сообщения. Provider
adapter может расширять набор структурных селекторов, но не отменять эту
общую проверку содержимого; пользовательские сообщения не входят в набор
assistant-кандидатов.

Внутренние сбои передаются отдельно от ответа: `answer` содержит только текст
модели, а `error.type` и `error.message` — техническую причину. Адаптеры и
оркестратор не помещают строки `Error: …` в `answer`; центральная финализация
дополнительно очищает сообщения старого формата по реестру. Поэтому длина
технической диагностики никогда не становится длиной ответа модели.

## Model selection contract

1. The active view owns its selected model set. Main-page selection must not be
   overwritten by a Debate pipeline restore.
2. Model names are canonical `LLM_TARGETS` names. UI aliases are normalized at
   the boundary; downstream state uses the canonical name.
3. Selection changes update header buttons, visible model panels, comparison
   controls, pipeline R1 defaults and the persisted view state through one
   selection-change path.
4. A run snapshots the selected model list into its `pipelineContext` before
   dispatch. Later UI clicks cannot mutate the active run's participant list.
5. A new run with the same model may reuse a tab only after the tab-manager
   readiness/reuse guard confirms URL, loading state, draft state and ownership.

An MV3 service-worker restart clears the in-memory Ready/ACK registry without
reloading provider pages. Before waiting on a missing handshake, background
sends `REQUEST_SCRIPT_READY`; the existing content bootstrap replays
`SCRIPT_READY` with the same document-scoped `tabSessionId`, and the normal ACK
correlation gate remains mandatory. A complete correlated pair already cached
in the current worker epoch is reused without this recovery message.

Debate uses its own protocol selection and session state. Main-page model
selection remains independent even when the same `results.js` composition root
is loaded by both entry points.

## Tab lifecycle

The background tab registry is the authority for `model → tabId` and its
session/run binding. A normal lifecycle is:

### Run tab acquisition invariant

Starting with version 2.81.115, model-tab acquisition is atomic with respect to Round 0. A model is considered opened only after one of these outcomes completes:

1. an existing eligible tab passes the surface-safety probe and is bound to the active run; or
2. every reusable candidate is rejected, the stale mapping is cleared, and a newly created tab is bound to the active run.

A rejected tab is never reused through the persisted mapping as a fallback. Existing user tabs are not closed when rejected. The orchestration layer must await this acquisition transaction before checking the Round 0 binding or proceeding to another model.

```text
select models
  -> snapshot run context
  -> attach/reuse or create provider tab
  -> validate URL and tab readiness
  -> bind tab to model + run
  -> dispatch GET_ANSWER
  -> receive PROMPT_SUBMITTED
  -> collect lifecycle/answer evidence
  -> finalize model outcome
  -> release or retain tab according to reuse policy
```

The results page never treats a visible provider tab as proof that the tab
belongs to the current run. Correlation must include, where available,
`pipelineRunId`, `pipelineRoundId`, `pipelineBatchId`, `dispatchId`, `sessionId`,
`model` and `tabId`.

For provider-tab lifecycle messages, `dispatchId` and `runSessionId` are not
optional compatibility hints. `PROMPT_SUBMITTED`, `LLM_RESPONSE_READY`,
`ANSWER_SNAPSHOT`, `LLM_RESPONSE` and `FINAL_LLM_RESPONSE` must match the exact
current dispatch and run session. An id from `recentDispatchIds`, missing
correlation, a sender without an active model binding or a different bound tab
is stale evidence and is quarantined. Submit waiters are scoped by
`model + dispatchId`; a late confirmation from attempt N cannot release attempt
N+1.

`LLM_RESPONSE_READY` follows an atomic completion contract: when the lifecycle
detector declares `COMPLETE`, it includes the exact text snapshot used for that
decision. Background validates that snapshot with the shared prompt-echo,
baseline and freshness guards and may finalize it directly. It must not require
a second DOM selection that can resolve to a different, shorter UI element.

### Extension reload reset

An extension update/reload starts a new extension runtime and must not project
the previous runtime's telemetry or model statuses onto the main page.

- `background/index.js` registers the update lifecycle listener before the
  orchestration bundle loads. State hydration must await the resulting startup
  barrier, so `jobState`, `llmTabMap` and `__diagnostics_events__` are removed
  before `loadJobState()` and `TabMapManager.load()` can restore them.
- A normal MV3 service-worker wake is not a reset. The barrier times out into
  the normal hydration path, preserving an active run across worker suspension.
- `REGISTER_RESULTS_TAB` returns an authoritative global-state snapshot. The
  results page replaces its live status projection from that snapshot; an
  empty snapshot clears old main-page/pipeline indicators and the local
  diagnostics view.
- Historical debate-feed indicators are immutable run records and are not part
  of the live-indicator reset.
- Persisted user preferences, notes, saved pipelines and layout settings are
  outside this reset boundary.
- Manual extension reload detection uses a marker in `chrome.storage.session`,
  not only `runtime.onInstalled`. A missing marker denotes a new extension
  runtime and clears volatile local run state, diagnostics, cross-view live UI
  state and both main/pipeline model-selection keys before hydration. A normal
  MV3 worker wake retains the marker and does not clear state.
- When the marker is retained, hydration waits for a short lifecycle grace
  window. This lets a delayed `onInstalled(update)` from an unpacked-extension
  reload override the tentative worker-wake path, so a persisted
  `roundsInProgress` lock cannot cause `RUN_ALREADY_ACTIVE` after reload.
- Results-tab registration carries a short-lived `runtimeReset` signal so every
  already-open results view clears live model buttons, answer indicators,
  diagnostics rows and the in-page telemetry cache. Reloading the page is not
  required for this projection reset.

## Dispatch and focus policy

- Per-model dispatch locks prevent overlapping sends to one provider.
- A focus mutex protects only the critical activation → send phase.
- `allow_focus_steal_enabled` controls whether the user-facing window may be
  activated. The default path uses an isolated automation window and does not
  steal user focus.
- Human-presence/keepalive activity must yield while dispatch is active.
- `PROMPT_SUBMITTED` is evidence that the send action was initiated; a call to
  `GET_ANSWER` alone is not proof of delivery.
- Failed submission attempts are retried by the background supervisor with
  bounded backoff. A provider timeout must not block unrelated models.
- Истечение automation deadline является terminal-границей для расширения:
  модель исключается из human-presence, automation visits, автоматических
  collection ping и recovery. После этой границы background не имеет права
  активировать вкладку модели ради автоматического сбора.
- Automation deadline не останавливает генерацию на странице провайдера и не
  закрывает вкладку. Пользователь может позднее двойным кликом по status
  indicator запустить явный manual latest recovery; только этот
  пользовательский запрос вправе снова прочитать вкладку и повысить timeout
  outcome до полного `SUCCESS`.
- If the model binding changes after a command was prepared, that command is
  quarantined. It is never rerouted to the replacement tab with the old
  `tabSessionId` or dispatch identity; the supervisor creates a fresh dispatch.

The canonical dispatch boundary is `background/dispatch-coordinator.js`.
Changes to focus or retry timing belong in `docs/Transport/timings-settings.md` and the relevant
policy/config, not in this document.

## Pages Visit

This section is the normative description of foreground visits to provider
pages on the main results-page path. It consolidates the architectural rules
from this document, the current values from `docs/Transport/timings-settings.md`, the
diagnostic vocabulary from `docs/Telemetry/telemetry.md`, and the behavior currently
implemented by:

- `background/job-orchestrator.js` — round order, forced visits, recovery and
  collection;
- `background/human-presence.js` — the recurring human-presence loop, focus
  tracking, leases, quota and in-page activity;
- `background/dispatch-coordinator.js` — dispatch focus ownership and safe
  restoration of the previous tab;
- `background/tab-manager.js` — provider-tab activation;
- `background/shared-state.js` — Standard/Long active-focus limits;
- `shared/visit-policy.js` — useful/short visit classification and retry.

Debate/Disput stage scheduling is outside this contract. It is owned by the
current contracts in `docs/disput/` and the protocol specifications.

### Terms and boundaries

In this document a **page visit** is a bounded interval during which a provider
tab is intentionally brought to the foreground so the page can receive focus,
visibility, scroll and pointer activity. A visit is not proof that:

- the prompt was submitted;
- generation started or completed;
- answer extraction succeeded;
- the model made semantic progress.

Those facts require their own correlated dispatch, lifecycle and answer
evidence.

There are three related operations that must not be conflated:

1. **Dispatch focus** activates a page only for the critical
   activation → command-delivery phase.
2. **Foreground visit** holds the provider page for a bounded dwell interval
   and may run simulated activity.
3. **Background probe/nudge** sends a message or executes a script in a bound
   tab without making it the foreground page. Adaptive collection pings,
   deferred-answer DOM nudges and post-success scroll audits normally belong to
   this category.

### Actual scheduler model

There is currently no global priority queue that orders every requested visit.
Visit-producing subsystems schedule their own work. They are coordinated by:

- one active tab lease;
- a per-`model:tabId` automation overlap lock;
- the dispatch focus mutex;
- terminal, session and active-focus-window guards;
- per-model foreground quota/backoff;
- transport backoff;
- hard caps and focus restoration.

Therefore the actual winner between two simultaneously eligible automated
visits is determined by which request reaches the lease first.

The user has the highest effective focus authority. An unmarked user activation
preempts an automated visit but is recorded as a separate observation, not as
a new lease. Automated requests may reuse the same automated lease or preempt
an expired lease, but otherwise receive `LEASE_DENIED`.

### Canonical run order

The round orchestrator preserves the order of the run snapshot
`selectedLLMs`/`session.selectedModels`. UI selection changes made after that
snapshot do not reorder the active run.

```text
Round 0: acquire selected model tabs
  with New pages on: create and bind tabs sequentially
  with New pages off: validate and bind independent existing tabs concurrently
  wait for model → tab binding
  validate and prewarm current-document Ready/ACK signals concurrently
  stagger only between newly created tabs

Round 1: for each selected model
  resolve and validate the bound tab
  focus when dispatch requires it
  deliver GET_ANSWER
  keep focus until correlated submit evidence or the bounded submit deadline
  continue without waiting for the full answer

Round 2: for each selected model
  skip terminal/API/already-confirmed cases as appropriate
  verify or repair prompt submission
  run a bounded verification visit when required
  nudge/probe and schedule later collection

Round 3: for each still-incomplete model
  run one bounded pre-collection visit
  run a background scroll nudge
  request response collection
  keep adaptive probes scheduled

Round 4:
  wait for all tracked models to become terminal
  do not visit provider pages merely to render Round 4
  focus the results page only when no pending model remains

After rounds:
  start supervisor
  start recurring human-presence only if eligible models remain
```

New-tab creation in Round 0 and all prompt dispatch in Round 1 are sequential.
Once all bindings exist, readiness prewarm is concurrent across model tabs.
Round 1 still applies its ordinary Ready/ACK gate, so a navigation or a changed
`tabSessionId` cannot reuse stale readiness; an unchanged prewarmed document
resolves that gate from `ReadySignalManager` without another serial wait.
Command acceptance and answer generation are separate lifetimes. Once the page
owns `GET_ANSWER`, Round 1 holds until the current dispatch reports either
composer insertion or submission, capped at eight seconds; the longer
submission watchdog stays asynchronous and does not block the remaining model
queue. Insertion evidence is accepted only from the bound tab with the exact
run and dispatch identity. An adapter publishes
`PROVIDER_DISPATCH_PIPELINE_STATE` while its asynchronous composer transaction
is alive. On confirmed Send it closes `composer` ownership and opens the
independent `answer_collection` phase. Retry supervisor and Round 2 repair defer
only for the former, so a long or stuck answer wait cannot hide a failed Send.
A bounded ownership TTL prevents a lost MV3 release message from blocking
recovery forever.

Every provider may publish the same dispatch-stage contract:
`composer_transaction_started`, `composer_ready`, `prompt_insertion_started`,
`prompt_inserted`, `send_action_requested`, and `send_action_completed` or a
stage-specific failure. These facts and the Round 1 focus boundary are retained
in canonical evidence with exact dispatch identity.

Browser-level debugging is intentionally unavailable. Provider input, Enter,
Send and attachment delivery use page-scoped DOM, bridge, input, drop or paste
paths and never attach Chrome Debugger. Operations on different tabs remain
concurrent.
When New pages is disabled, Round 0 acquires independent existing pages in
parallel so the bootstrap fits inside the MV3 service-worker lifetime. The
results-page start request remains open until this acquisition and Round 1
finish (bounded to 45 seconds). The page mode and current round are persisted;
an interrupted Round 0/1 is resumed after rehydration, while an already
attempted dispatch is left to the supervisor instead of being duplicated.
Round 2 and Round 3 iterate in the original model order. Timed recovery tasks
created by earlier rounds can later overlap the round timeline, but they remain
subject to lease, overlap, quota, session, terminal and focus-window guards.

### Visit producers

| Producer | Trigger and purpose | Foreground behavior |
|---|---|---|
| Initial/repair dispatch | Provider requires focus to accept the command | Uses the dispatch focus mutex; focus is held only through command delivery/confirmation policy |
| Round 2 verification | Prompt submission is unconfirmed and a verification visit is still useful | One or two visits within the calculated per-model and batch budget |
| Round 3 pre-collect | Model is still incomplete when collection begins | One visit, then nudge and collection ping |
| Post-Round-2 auto collect | Confirmed model remains incomplete after the post-R2 delay | One visit, then collection ping |
| Early gesture recovery | Repeated transport errors after the minimum elapsed time | One short visit, then collection ping |
| Provider retry | Currently the dedicated hard-timeout extraction retry path is used for Claude | One visit, then collection ping |
| Pre-terminal materialization | A supported model is about to end as `NO_SEND`, `EXTRACT_FAILED` or qualifying `ERROR` | One controlled visit; may use a bounded direct-focus fallback, then read-only recovery |
| Deferred hard-stop recovery | Recent runtime/transport evidence justifies one last bounded recovery | One short visit, then follow-up/final pings and snapshot fallback |
| Recurring human-presence | Rounds have finished and pending eligible models remain | Visits pending models cyclically in `session.selectedModels` order |
| Explicit user focus | User activates a bound provider tab | Recorded as a start/end observation; preempts automation but creates no lease or hard cap |

Adaptive collection itself is normally a background `getResponses` ping and
does not activate the tab. It can indirectly schedule early gesture recovery
after repeated transport failures. Likewise:

- `scheduleDeferredAnswerVisit()` executes an in-page scroll/click attempt but
  does not activate or focus the tab despite the historical “visit” name;
- post-success scroll audit executes background scroll attempts and does not
  reopen foreground ownership;
- manual latest recovery initiated by double-clicking a status indicator is an
  explicit user recovery path, not permission to restart the autonomous visit
  loop.

### Round 2 selection and budget

Round 2 walks `selectedLLMs` in order and applies these decisions for each
model:

1. Abort if the run session is stale.
2. Skip a terminal model and emit explicit start/end skip evidence.
3. Skip web-page verification for API dispatch.
4. Resolve the current bound tab and require dispatch readiness.
5. If a content-script `PROMPT_SUBMITTED` is already present, avoid a redundant
   foreground verification visit; nudge/probe the page and schedule post-R2 and
   adaptive collection instead.
6. If the original provider pipeline still owns the tab, defer rather than
   racing it with repair or collection.
7. For models in the repair set, attempt a correlated repair dispatch when
   submission is not confirmed. A delayed confirmation is continued
   asynchronously; a failed confirmation is not promoted to success.
8. Before a verification visit, divide the remaining batch budget across the
   current model and the remaining tail. Skip when the useful minimum cannot
   fit.
9. Use one or two visits according to the available per-model slice. Each
   visit is bounded to the remaining active-focus window.
10. Stop the batch at its calculated deadline. Remaining models receive
    explicit cutoff/skip evidence; confirmed prompts may still receive
    background collection scheduling.

The batch budget is `max(ROUND2_BATCH_MAX_MS,
selected-model-count × ROUND2_MODEL_TIME_SLICE_MS)`. Exact current values and
all visit intervals are canonical only in `docs/Transport/timings-settings.md`.

### Recurring human-presence order

The recurring loop starts only when dispatch is not active, the feature is not
paused/manually stopped, the browser is focused, and at least one eligible
model remains.

For every cycle it:

1. Reads `session.selectedModels`; only if that snapshot is absent does it fall
   back to `Object.keys(jobState.llms)`.
2. Builds the pending list without re-sorting it.
3. Removes terminal models, models outside the active-focus window,
   `skipHumanLoop` models, models already owned by automation, and models under
   quota or transport backoff.
4. Visits the remaining models sequentially in that order.
5. Waits the loop pause and rebuilds eligibility from live state before the
   next cycle.

The visit counter is per model. When it reaches the alert threshold, the model
is marked stalled, removed from the loop and requires explicit user action to
resume. Pause stops the whole loop; Continue clears the manual stop and starts
it immediately if work remains; Stop prevents automatic restart. A per-model
toggle controls `skipHumanLoop` independently.

Human-presence visits require the browser window to be focused. Browser blur
ends the tracked visit, clears stuck-focus tracking, cancels the current human
visit and stops the loop. Browser focus can restart the loop if it was not
paused or manually stopped. Forced automation visits do not use this
human-presence browser-focus precondition: they may focus the provider window
themselves, subject to the other guards.

### Admission guards

A foreground visit is admitted only while all applicable conditions hold:

- the requested `tabId` is valid and still bound to the intended model;
- the captured run session is still current;
- the model is not terminal;
- the post-submit active-focus window is still open;
- autonomous activity for the model has not been disabled;
- no per-model automation visit is already active for the same tab;
- quota and transport backoff have expired;
- the active lease can be acquired;
- dispatch/human-presence ownership rules allow the operation.

Eligibility is checked before activation and again after focus changes. During
an active human or automated visit, terminal/session/focus-window state is
polled, so a model that completes mid-visit releases focus without waiting for
the full dwell.

The focus required to submit the original prompt is explicitly outside the
post-submit active-focus window. The window begins with the generation budget,
normally from `PROMPT_SUBMITTED`/generation start. It is:

- Standard: 60 seconds;
- Long: 90 seconds.

After it expires, the entry receives `skipHumanLoop` and
`ACTIVE_FOCUS_WINDOW_EXHAUSTED`. Autonomous foreground visits stop, while
passive generation observation continues until the separate generation
deadline. The complete timing ladder is maintained in
`docs/Transport/timings-settings.md`.

### Lease and overlap contract

`background/human-presence.js` owns the foreground visit lease:

- key: `model:tabId`;
- owner/source: for example `human_visit`, `automation_focus` or
  `verification_focus`;
- expiry: the current `TAB_LEASE_TTL_MS`;
- same tab/model: renew the lease;
- expired lease: finalize the previous visit, then grant the new one;
- other competing source: deny with `LEASE_DENIED`.

User focus is outside this lease. It may terminate a current automated visit,
but it is represented by `USER_FOCUS_OBSERVATION_STARTED` and
`USER_FOCUS_OBSERVATION_ENDED`, without TTL, quota, hard cap or stuck-focus
timer.

This is an in-memory runtime lease. It coordinates the current service-worker
runtime; it is not a durable cross-runtime queue. Separately,
`automationVisitLocks` prevents overlapping automated visits for the same
`model:tabId`. Dispatch also pauses the recurring human-presence loop and uses
its own focus mutex for activation → delivery.

### Quota, useful visits and retry

Every finalized tracked visit contributes its duration to the model's rolling
foreground history. The current implementation computes usage over the quota
window after a visit ends. If the accumulated duration exceeds the quota, it
sets `visitQuotaBackoffUntil`; subsequent human and automation visits skip the
model until cooldown ends.

This means quota is a post-visit rolling guard, not advance reservation of
future visit time. It does not globally reorder already scheduled visit
producers.

`shared/visit-policy.js` classifies a visit shorter than the minimum useful
duration as `shortVisit`. A forced visit may retry one such short visit by
default. Terminal/session/stop/tab-closed endings are non-retryable and must
not create a retry loop. Visit histories are bounded in model state rather than
growing without limit.

Exact quota window, quota amount, cooldown and minimum useful duration belong
to `docs/Transport/timings-settings.md`.

### Focus activation and restoration

Before programmatically activating a provider or previous tab, the background
records a short-lived programmatic-focus marker. `tabs.onActivated` consumes
that marker and emits `TAB_ACTIVATION_IGNORED_PROGRAMMATIC` instead of treating
the system's own action as a user visit. A real unmarked activation of a bound
model tab is recorded as `USER_FOCUS_CHANGE` plus a bounded-by-reality
user-focus observation. It is never emitted as `OBSERVATION_SLOT_GRANTED`.

Automated visits snapshot the previously active tab. On completion, dispatch
and visit code restore it, when restoration is enabled for that path, only if:

- it still exists and differs from the provider tab; and
- the provider tab is still the active tab.

Therefore restoration must not override a tab choice the user made during the
visit. Restoration itself is marked programmatic so it cannot consume visit
quota as a false user visit. Round 1 deliberately uses sprint dispatch with
focus restoration disabled between models; it advances through the selected
model order and leaves the last dispatch target active until a later owner
changes focus.

### In-page activity

An admitted human or automation visit may execute the shared activity routine:

- progressive scrolling;
- scrolling of nested and eligible shadow-root containers;
- a completion nudge that moves upward and returns to the bottom;
- hover/pointer activity around composer and actionable controls;
- optional `Humanoid.readPage`/movement when available;
- a continuous pressed-pointer scroll gesture for GPT, Gemini and Perplexity.

Activity is skipped after the page-level hard-stop flag. The activity routine
does not click Send and does not establish submission or completion evidence.
Its purpose is visibility/materialization and provider activity, after which
the normal lifecycle and extraction paths must still prove progress.

### Dwell, hard caps and stuck focus

Human and automation visits have independent local completion timers and also
participate in the shared visit tracker:

- normal completion occurs after the requested dwell/activity;
- a model becoming terminal or the session becoming stale ends the visit
  early;
- human/automation foreground sources are protected by the visit hard cap;
- automation additionally uses a local cap bounded by the requested dwell plus
  recovery margin;
- `FOCUS_STUCK` is a final safety signal when tracked focus survives beyond the
  stuck threshold.

Hard-cap or stuck-focus termination releases ownership, clears automation
state, returns to the results page when appropriate, and emits explicit
diagnostics. User focus is tracked but is not subject to the short automated
dwell timer; the stuck-focus safety remains the backstop.

### Terminal and deadline behavior

Terminal state is the universal stop condition for new visits. Active visit
polling releases a model that becomes terminal mid-visit. Success-like
finalization and the automation-deadline path additionally call the explicit
human-presence cleanup, which cancels the current visit and clears overlap
locks, post-success audit timers and per-model quota/transport backoff state.
Forced-visit loops recheck terminal state before each attempt and stop
immediately when it appears.

At the passive automation deadline:

- preserve a detected answer as `PARTIAL`, otherwise use the appropriate
  timeout outcome;
- stop human-presence, automation visits, automated collection pings and
  recovery for that model;
- do not press provider Stop;
- do not close the provider tab;
- allow only an explicit later manual latest recovery to read and possibly
  upgrade the outcome.

Round 4 is a waiting/finalization gate, not a reason to keep foreground focus
on model pages. It focuses the results page only after no pending model
remains; on its own maximum it deterministically finalizes the remaining
models.

### Telemetry and diagnosis

The minimum event chain for foreground ownership is:

```text
PROGRAMMATIC_FOCUS_START (for system activation)
  → TAB_ACTIVATION_IGNORED_PROGRAMMATIC
  → LEASE_GRANTED
  → HUMAN_VISIT_START
  → TAB_VISIT or TAB_VISIT_SHORT
  → HUMAN_VISIT_END
  → LEASE_RELEASED
```

Depending on the path, also inspect:

- `FORCED_VISIT`, `FORCED_VISIT_SHORT_RETRY`, `FORCED_VISIT_SKIPPED`;
- `AUTOMATION_VISIT_SKIPPED`, `AUTOMATION_VISIT_HARD_CAP`;
- `VISIT_QUOTA_BACKOFF`;
- `LEASE_DENIED`, `LEASE_EXPIRED`;
- `USER_FOCUS_CHANGE`;
- `ACTIVE_FOCUS_WINDOW_EXHAUSTED`;
- `FOCUS_STUCK`, `HUMAN_VISIT_HARD_CAP`,
  `HUMAN_VISIT_FOCUS_STUCK_TERMINATED`;
- `ROUND2_*`, `ROUND3_*`, `ROUND4_GATE_*`;
- producer-specific recovery start/end/error events.

A visit event without a correlated `PROMPT_SUBMITTED`, lifecycle transition or
accepted answer is only foreground evidence. When diagnosing unexpected focus,
identify the producer from the visit `source`/`reason`, then verify lease,
quota, active-focus deadline, terminal state and focus-restoration events in
that order.

### Documentation ownership

- This section owns the visit-ordering and focus-ownership contract.
- `docs/Transport/timings-settings.md` owns every current numeric timing value.
- `docs/Telemetry/telemetry.md` owns event schema/export and UI interpretation.
- `docs/CHANGELOG.md` records how the behavior evolved; it is not a substitute
  for this contract.
- Executable truth remains in the owner modules listed at the start of this
  section. A behavior change must update code, focused tests, this section and,
  when timing changes, `docs/Transport/timings-settings.md` in the same set.

## Content-script boundary

Content scripts may inspect and mutate provider DOM, detect composer/send state,
and emit lifecycle evidence. They must not own the global model-to-tab map,
background retry policy or results-page selection state.

The stable contract is:

- background → content: `HEALTH_CHECK_PING`, `GET_ANSWER`, `STOP_ALL` and
  model-specific command payloads;
- content → background: `PROMPT_SUBMITTED`, lifecycle events and answer payloads;
- every event carries model/run/tab metadata whenever the source knows it.

### Provider dispatch change safety

Provider dispatch is an integration boundary with the live page runtime, not
only a DOM algorithm. A visually changed `textarea` or `contenteditable` does
not prove that the provider framework accepted the value into its application
state. Conversely, jsdom/unit tests can prove ordering, ownership and
fail-closed rules, but cannot prove browser `isTrusted`, React/ProseMirror state
acceptance or the provider's real submit shortcut.

Changes at this boundary follow these rules:

1. Preserve the last live-confirmed transport as a named baseline. A fix for
   prompt comparison, attachment chips, selector ownership or confirmation
   evidence must not replace input and Send transports unless the transport is
   itself the demonstrated fault.
2. Change one transaction gate at a time: attachment evidence, input,
   prompt verification, Send, and Send confirmation are separate gates. A
   patch for one gate must include a regression assertion that the other
   live-confirmed gates retain their order and fallback.
3. Provider input requires two facts after its settle window: the current live
   composer contains the exact prompt evidence and the provider has not
   reverted/replaced that composer. If isolated-world synthetic input is
   visible but fails this gate, the adapter may perform one sender-gated native
   input recovery, then must reacquire and reverify the composer before Send.
4. Unit tests are necessary but insufficient for a transport change. Before a
   provider release is called verified, a real-page smoke must cover at least
   the no-attachment path `input → Send → PROMPT_SUBMITTED → generation`. An
   attachment change additionally requires a separate attachment/chip/modal
   smoke. Open live smoke work stays in `next-steps`; changelog wording must say
   that the transport is unverified until the smoke succeeds.
5. The smoke is evidence-based. For Perplexity the expected no-attachment
   sequence is exact prompt preparation (or one
   `PROVIDER_TRUSTED_INPUT_DISPATCHED` recovery),
   `PROVIDER_TRUSTED_ENTER_DISPATCHED` or scoped trusted Send,
   `PROMPT_SUBMITTED`, then a new user turn or new generation evidence.
   `prompt_not_present`, a remaining prompt with no new turn, or only a generic
   busy marker fails the smoke.
6. A later refactor may remove the live-confirmed baseline only after the new
   path passes the same real-page matrix. Passing source-order tests or a mocked
   rich-editor test is not sufficient evidence for that removal.

## Attachment dispatch contract

Composer dispatch is a transaction with four ordered gates:

```text
attachment evidence (when files exist)
  -> reacquire live composer
  -> verify current prompt content
  -> confirm send evidence
  -> publish PROMPT_SUBMITTED
```

The provider pipeline owns this transaction from attachment start until either
confirmed Send or terminal failure. While the content adapter reports that
pipeline active, verification/recovery rounds must not clear `dispatchInFlight`,
reset its state machine or issue a repair resend. Recovery observes the original
transaction first; concurrent composer writers are forbidden.

Round telemetry distinguishes handler termination from protocol completion. If
R2 encounters an active provider-owned R1 transaction, R2 ends with semantic
outcome `deferred`, never `done`: prompt verification did not execute. While
deferred, R2 must not send collection probes into the busy content-script port;
the original pipeline resolves ownership through `PROMPT_SUBMITTED` or terminal
failure. Export and DevTools render this state explicitly as `deferred`.

Firing DOM events, observing any non-empty composer text, or exhausting a send
strategy is not success. `ContentUtils.ensurePromptPrepared` owns the shared
prompt-content gate. Its rich-editor comparison removes zero-width formatting
characters and accepts either the complete normalized prompt or independent
head-and-tail fingerprints from the same request; arbitrary non-empty text or a
single short prefix is insufficient. Provider adapters remain responsible for
reacquiring their live composer and for provider-specific send evidence.

- Prompt injection with files is gated on confirmed attachment delivery. If
  attachment confirmation fails, the provider script must stop with
  `attachment_failed` or an explicit manual-required signal; it must not
  continue as if the prompt were sent.
- Attachment confirmation is evidence-based, not click-based. Each delivery
  vector captures a baseline first; confirmation may come from provider
  selectors, upload-progress disappearance, file-input evidence where the
  provider exposes it, or stable filename evidence across open shadow roots. A
  pre-existing chip or stale file label must not confirm a new request.
- Provider adapters own their ordered attachment vectors, but once a vector is
  confirmed the same files must not be resent through the remaining vectors
  when the provider is marked `singleDispatch`.
- If an attachment rerender replaces the composer, the adapter must reacquire
  the live connected composer before prompt injection. A disconnected or stale
  cached composer is not valid for the send phase.
- Attachment adapters must preserve provider-specific transport choices
  without turning this document into a selector catalog. For example, Gemini
  routes attachments through background materialization and trusted file-input
  dispatch, while ChatGPT waits for the real enabled Send control and validates
  submission against the pre-send user-turn count.
- For Gemini, successful trusted `DOM.setFileInputFiles` assignment is delivery
  evidence. The native input may be cleared immediately and the visible file
  chip may live outside the isolated-world selector surface, so absence of a
  second DOM match must not turn an assigned file into `attachment_failed`.
  After attachment, the adapter must verify that the normalized prompt prefix
  is present in the reacquired live composer before any send gesture.
- Send-control discovery is fail-closed around adjacent composer controls.
  Provider selector results and fallback candidates must reject microphone,
  voice/recording, stop, attachment and upload controls before interaction.
  This guard applies to Qwen and ChatGPT even when a generic selector finder or
  `type="submit"` fallback supplies the candidate. Qwen may click only a control
  with explicit Send evidence (`type=submit`, send-labelled attributes/classes
  or a dedicated send icon). Generic SVG, arrow, primary styling, proximity to
  the composer and the substring `paper` are not Send evidence. Attachment,
  paperclip, add-file/upload, voice and stop identity is an unconditional veto,
  including identity exposed only by a descendant icon. The normal and
  emergency click paths must run the same safety predicate and stay scoped to
  the live composer; keyboard/form fallbacks remain non-click alternatives.
- Some providers rerender or replace the composer after upload; Grok, Qwen,
  Perplexity, DeepSeek and Le Chat must re-resolve the composer after upload
  completes before the prompt is injected. A negative control token such as
  `voice` normally rejects a send candidate. For Qwen, unsafe attachment/voice/
  stop identity always wins even when stale framework classes also contain
  `send`; this prevents an adjacent file control from being clicked repeatedly.
- Qwen attachment delivery uses the current native upload contract directly:
  hidden `input#filesUpload[type="file"][multiple]` receives materialized files
  through trusted `DOM.setFileInputFiles`. Synthetic drop, paste, plus-menu
  clicks and generic file-input discovery are not Qwen attachment transports.
  Native assignment is dispatch evidence only. The adapter waits for settled
  file-input/filename/chip evidence before it reacquires
  `textarea.message-input-textarea`, verifies the prompt and sends.
- An unconfirmed delivery vector cannot suppress later vectors. DeepSeek,
  Perplexity and Le Chat may proceed from unconfirmed drop to the next configured
  method; only confirmed evidence closes their attachment gate.
- Z.ai accepts a manual file copy plus Ctrl+V, but synthetic paste is not an
  equivalent delivery vector because the page may require a trusted event.
  Z.ai and Perplexity therefore use background materialization plus trusted
  `DOM.setFileInputFiles` on the provider's live native file input. The request
  message must preserve its attachment payload end-to-end. After assignment,
  the adapter reacquires the composer, passes the shared exact-prompt gate and
  confirms Send before publishing `PROMPT_SUBMITTED`; failure is closed rather
  than sending a prompt without its requested file.
- Le Chat may replace its ProseMirror root after attachment delivery. If the
  cached composer fails the exact-prompt check, the adapter may reacquire a
  connected provider composer that itself contains the exact normalized current
  prompt. Arbitrary non-empty text is never sufficient evidence.
- Perplexity submission is one prompt-owned transaction, not a cascade of
  synthetic keyboard and generic click attempts. Preparation, dispatch and
  confirmation use the same normalized prompt predicate: a continuous prompt
  is accepted, and a rich editor may interleave an attachment/chip node only
  when both independent prompt-end fingerprints remain present. If the shared
  preparation attempt is visually inserted but rejected/reverted by
  Perplexity's React state, the adapter performs one sender-gated native
  replacement on the focused visible composer (`SelectAll` plus
  `Input.insertText`), waits for React to settle, reacquires the live composer
  and reruns the same exact-prompt predicate. It cannot proceed to Send solely
  because text was briefly visible. Background then focuses that matching live
  composer and dispatches one page-scoped native Enter attempt.
  If no submission evidence appears while the same prompt remains, the only
  fallback is a sender-gated trusted click on an enabled Send/Submit/Ask control
  discovered in the matching composer's nearest ownership scopes. Candidate
  controls reject microphone, voice, attachment, upload, stop, cancel, model
  and tool identities; cached or global generic buttons are not eligible.
  Confirmation requires at least one current transaction signal: the prompt
  left the composer, a new user turn appeared, or a
  stop/streaming/generating control became newly visible relative to the
  pre-submit baseline. A pre-existing generation control or stale generic
  busy/loading marker is not evidence. `PROMPT_SUBMITTED` is published only
  after this gate.
- Perplexity native file assignment is not success by itself. The attachment
  transport first probes for a provider-owned live file input, then performs at
  most one trusted click on «Add files or tools» and probes again because the
  input may be created lazily with the menu. If that probe succeeds,
  `DOM.setFileInputFiles` targets the input directly; the transport must not
  continue clicking the concrete paid-plan upload item merely because no
  `Page.fileChooserOpened` event fired. A chooser backend node remains an
  accepted alternative. Every click is followed by input/chooser and current
  URL reconciliation; reaching `/pro/payment` suspends the attempt immediately
  instead of issuing another click. Native assignment must still produce
  observable chip/filename evidence before prompt submission can continue.
- Internal attachment materialization is infrastructure, not a user download.
  While temporary local files are created through `chrome.downloads`, the
  browser download UI is suppressed with reference-counted ownership and always
  restored in `finally`; this requires the explicit `downloads.ui` permission.
  Suppression failure is fail-closed (`download_ui_suppression_unavailable`): no
  internal download may start and Chrome's download bubble must not open.
- Trusted attachment delivery never uses the background `chrome.debugger` API.
  It stays within the provider page and uses the available DOM, bridge, input,
  drop or paste strategies. The extension has no `debugger` permission, so it
  cannot produce Chrome's browser-level debugging notification.
- Before Perplexity composer discovery, the adapter may dismiss a page-owned
  modal only when the dialog text explicitly identifies an upgrade/plan/package
  promotion and it exposes an explicit Close/Dismiss/Not now control. File menus,
  generic dialogs and browser UI are outside this cleanup contract. The guard
  remains active throughout native attachment assignment and confirmation,
  because Perplexity may render the promotion over the unchanged chat URL only
  after `DOM.setFileInputFiles`. An icon-only SVG × is eligible only when it is
  a small top-right control geometrically owned by that promotion-gated dialog.
  Current same-page markup may omit dialog/modal semantics entirely; in that
  case the adapter first resolves the observed control contract
  `button.reset.interactable.select-none.outline-none`, walks only to its nearest
  promotion-text ancestor, verifies top-right ownership, and clicks that exact
  button. Closing such a modal is cleanup, not attachment evidence.
- If that same-page promotion caused the native attachment attempt to finish
  without persistent evidence, the adapter re-arms the correlated blocker and
  retries the complete attachment transaction once after the modal is closed.
  Prompt preparation and Send remain behind this retry; a second failed attempt
  is terminal for the attachment and cannot create duplicate file delivery.
- Perplexity confirmation requires evidence that is still present at the settle
  gate: a new attachment chip, filename, populated provider input or configured
  upload completion evidence. A transient generic `upload` node that appears
  while the paid-plan modal is opening and then disappears cannot be retained
  as proof of delivery. With no persistent evidence, attachment fails closed
  and prompt submission does not continue without the requested file.
- A first navigation to `/pro/payment?…origin=fileUpload` is a transient
  Perplexity blocker, not proof that upload capability is unavailable. Before
  the trusted upload control can navigate, the content adapter stores a
  same-origin marker containing a unique token plus `runSessionId` and
  `dispatchId`, then waits for background acknowledgement of
  `PROVIDER_TRANSIENT_BLOCKER_STARTED` in the `ARMED` phase. A normal upload
  completion cancels that state; therefore only the navigation initiated by
  this exact dispatch owns the handoff.
- On the payment document, the adapter correlates the same marker, advances the
  blocker to `ACTIVE`, and waits for background acknowledgement before clicking
  the explicit page-owned Close/× control (with `history.back()` only as the
  page-navigation fallback). It does not close a manually opened or stale
  payment page lacking a valid marker.
- After the chat document is restored, the adapter first registers its
  `runtime.onMessage` listener and waits for a visible, enabled composer. It
  then publishes `PROVIDER_TRANSIENT_BLOCKER_CLEARED`; background probes that
  exact `documentId` and accepts the clear only when the document returns the
  same token, dispatch identity and positive composer evidence. The marker is
  removed only after this acknowledgement. Lost callbacks use bounded,
  identity-preserving retries against the marker's fixed 120-second expiry;
  retries do not extend ownership indefinitely. Background atomically changes
  `ACTIVE` to `PROBING` before the document probe, so concurrent clear signals
  cannot create parallel resume dispatches.
- `GET_ANSWER` is a command-delivery channel: Perplexity acknowledges it
  immediately with `{ accepted, dispatchId, tabSessionId }`; later submission
  and answer lifecycle travel through `PROMPT_SUBMITTED` and `LLM_RESPONSE`.
  Provider navigation therefore cannot turn an already accepted command into
  a false `connection_failed`. A matching navigation-time transport close is
  deferred, while a callback from an obsolete run/dispatch/tab is quarantined.
- Resume cancels the old in-progress dispatch through the valid state path
  `SUBMITTING → ERROR → IDLE`, invalidates any stale pre-terminal recovery, and
  creates a new dispatch with the original prompt and attachments. Telemetry
  may publish `PROVIDER_TRANSIENT_BLOCKER_RESUME` and increment the resume count
  only after the restored document has immediately accepted that new command;
  provider focus ownership is retained through this acceptance. Old transport,
  provider-pipeline and answer lifecycle signals owned by the cancelled
  dispatch are quarantined rather than allowed to finalize the resumed run.
  A duplicate clear for the same token is a no-op; only a second complete
  `STARTED → CLEARED` cycle after an accepted resume becomes terminal
  `attachment_unavailable`. The prompt is never sent without its file.
- Synthetic drag cleanup is provider-specific. ChatGPT follows
  `dragenter → dragover → drop` with `dragleave → dragend` so its DRAG&DROP
  overlay cannot remain during generation. This cleanup is not a shared Qwen
  behavior because Qwen no longer uses synthetic drag for attachments.

## Readiness and reuse contract

`ensureTabReadyForDispatch` succeeds only for an existing, eligible,
non-discarded provider tab whose navigation status is `complete` and whose URL
is not a placeholder. URL eligibility alone is not readiness. Content-script
health and page/composer readiness remain separate later gates.

Global reuse (`New pages` disabled) is fail-closed. Before taking over an
unbound user tab, the background probe must positively establish all of the
following:

- no draft exists in any composer candidate;
- no visible generation/stop control exists;
- no visible modal/dialog blocks the page;
- the probe itself returned a trustworthy result.

An unavailable or failed probe rejects that candidate and falls back to another
eligible tab or a newly created tab. A tab created for an obsolete run session
is closed instead of being left as an unowned orphan.

## Fresh answer and completion contract

A pre-existing assistant node is baseline evidence, not answer-start evidence.
The current response may enter `ANSWER_STARTED` only when at least one of these
signals belongs to the current dispatch:

- a new assistant node appears after submit;
- the baseline assistant node changes after `promptSubmittedAt`;
- a trusted stop/loading/streaming/progress signal appears.

Text length by itself never proves answer start. `LLM_RESPONSE_READY` carries
the current `dispatchId` and `runSessionId`, and background applies the same
exact-correlation gate as for the final response.

Completion needs fresh-turn evidence plus corroboration: stable answer text,
trusted absence of stop/loading/progress indicators and the configured
completion confidence. Old regenerate/copy/completion controls cannot complete
a new dispatch. The unified pipeline's final stability checks are a mandatory
gate; unstable text returns `answer_not_stable` and remains recoverable rather
than being published as terminal success.

Generating-indicator evidence учитывает полную видимость элемента: нулевой
размер, `display:none`, `visibility:hidden` и `opacity:0` не являются активной
генерацией. Единственное исключение для видимого generic loading-class —
stuck-busy guard: после длительной стабильности текста и тишины мутаций он
может быть признан декоративным только при подтверждённом отсутствии Stop и
progressbar. Видимые Stop и progressbar не обходятся.

Зарегистрированный DOM-кандидат принадлежит конкретному `traceId`. При старте
нового dispatch кандидат с другим trace удаляется до захвата baseline, поэтому
элемент прошлого ответа не может закрепить новый lifecycle на stale DOM node.

“Latest answer” means the last eligible assistant turn in DOM order after the
turn anchor. Automatic extraction does not use answer length as a recency
signal and does not reuse a cached answer element as proof of latestness.
Baseline signature, positional anchor, prompt-echo classification and provider
error classification remain independent safeguards; none substitutes for
dispatch identity or fresh-turn evidence.

Recovery follows the same rule. `preserved_pending`, `preserved_answer` and
snapshot text are candidates, not current-run evidence. A recovery candidate
is fresh only when it differs from the dispatch baseline and is backed by one
of: content-confirmed submit for the same dispatch, correlated lifecycle
completion, or a new DOM answer node after the positional anchor. Text length,
`forceTerminalSuccess` and submit inferred from that same text cannot establish
freshness.

Consequently, baseline-only text does not block repair resend, does not confirm
Round 2 and cannot produce `PROMPT_SUBMITTED_INFERRED`. Materialize recovery
rejects a baseline-equivalent candidate before finalization. Without completion
evidence, a fresh salvaged candidate is at most `PARTIAL`; without freshness it
remains `NO_SEND`/recoverable and can never become `SUCCESS`.

`materialize_recovered_unconfirmed_complete` describes a visible answer
candidate, not a terminal state. If the finalization policy rejects that
candidate, it remains non-terminal even when its provisional status is
`PARTIAL`. Explicit automation deadlines and exhausted streaming limits retain
their separate hard-stop contract and may deliberately finish as `PARTIAL`.

Late collection distinguishes a dead page from a temporarily unavailable
observer. If the tab still exists, matches the provider and is not discarded,
a failed content-script ping plus a timed-out scripting probe produces
`UNAVAILABLE`, never `DEAD`. Read-only probes are serialized across providers
and retried with bounded backoff. This recovery does not reload the page, resend
the prompt or apply provider-specific completion exceptions.

Provider-specific selector details belong in `selectors/*.config.js` and the
selector tooling guides. If a selector breaks, first use the health/override
path; only then change the canonical selector config.

## Diagnostics

For “model tab did not receive the prompt”, inspect the run in this order:

1. target resolution and selected model snapshot;
2. tab attach/reuse decision and URL/status readiness;
3. `DISPATCH_*` events and lock/retry metadata;
4. `HEALTH_CHECK_*` response from the content script;
5. `PROMPT_SUBMITTED` evidence;
6. lifecycle/answer terminal evidence.

For “old answer accepted as new”, additionally verify that
`ANSWER_START_DETECTED`, `ANSWER_COMPLETE_DETECTED`, `LLM_RESPONSE_READY` and
the accepted response all carry the same current dispatch identity, and inspect
the captured baseline/anchor plus the selected DOM candidate order.

A green UI card without matching terminal evidence is not a successful run.
Stale-tab signals must be rejected rather than repaired by changing the UI.

## Change checklist

When changing model tabs or main-page selection:

1. Update the owner module from the ownership table.
2. Preserve run correlation and tab ownership guards.
3. Add/adjust focused tests for selection, tab scope, dispatch or lifecycle.
4. Update this document only when the contract or ownership changes.
5. Add one concise entry to `docs/CHANGELOG.md`.
6. Put unresolved work in an issue or focused test; do not create a second
   architecture contract here.

Related operational documents:

- `docs/project-overview.md` — product behavior and module map;
- `docs/Transport/completion-protocol-v2.md` — completion authority;
- `docs/Telemetry/telemetry.md` — evidence and export vocabulary;
- `docs/Transport/timings-settings.md` — timing ownership and current values.
