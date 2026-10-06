# Telemetry - tab/session diagnostics

## Insertion verdict from every adapter v2.81.216 - 2026-08-01

Each adapter now states the outcome of its composer transaction for the current
dispatch, success as well as failure: `PROMPT_INSERTION_OBSERVED` from the
content script, mapped in the background onto `PROMPT_INSERTION_CONFIRMED` or
`PROMPT_INSERTION_FAILED` and canonically onto `PROMPT_INSERTION_EVALUATED`
with `prompt_insertion/inserted` or `prompt_insertion/failed`. Both labels are
pinned, and the report carries `promptLength`, `composerLength`, `method` and
`reason` — never prompt text.

Until now only failure was reported, and only by some adapters, so the critical
`insertion_outcome` slot of the `prompt-not-inserted` report stayed
`unavailable` on every run and the question "was the prompt inserted at all?"
was unanswerable from the ledger. Absence of an insertion event was not, and is
not, evidence of a failed insertion. ChatGPT additionally never verified its
composer after typing; it now does, before Send is attempted.

## Pipeline generation proof routing v2.81.192 - 2026-07-30

Concrete `PIPELINE_STEP` values are now canonical proof events:
`streaming_start` becomes `GENERATION_START_EVALUATED`, `streaming_done` becomes
`GENERATION_SIGNAL_CHANGED`, and `finalization_done` becomes
`COMPLETION_HYPOTHESIS_EVALUATED`. Step and phase metadata survive compaction.
Already-canonical labels are also retained directly rather than falling through
to legacy debug storage.

## Complete dispatch identity and empty baselines v2.81.191 - 2026-07-30

- Telemetry normalized against the active dispatch now inherits its
  `generationEpoch` and `attemptId`, preventing operational, navigation, render
  and commit events from forming identity-less tail incidents.
- A pre-dispatch baseline fact is emitted for both existing and empty chats.
- One-frame observation intervals deduplicate their evidence reference.
- `outcome` survives proof metadata compaction, allowing render and commit facts
  to retain their canonical state.
- Runtime validation explicitly rejects duplicate evidence references.

## Runtime/offline invariant parity v2.81.190 - 2026-07-30

The runtime export audit now performs the same S03 exact evidence-scope and S04
canonical-layer checks as the offline validator. An artifact cannot claim valid
schema/replay internally and then fail those invariants after download.

## Common answer materialization boundary v2.81.189 - 2026-07-30

Every normalized non-empty answer entering the common response finalizer now
emits a deduplicated `ANSWER_SOURCE_MATERIALIZED` and
`ANSWER_EXTRACTION_COMPLETED` pair with the same dispatch, generation, attempt,
payload hash and source identity. This covers direct provider response paths,
not only the validated lifecycle message-router branch.

## Baseline acknowledgement barrier v2.81.188 - 2026-07-30

`reportDispatchBaseline()` now resolves after the background responds with
`dispatch_baseline_ack`, not immediately after `chrome.runtime.sendMessage()` is
queued. All provider adapters already await this function, so Send is now
ordered after durable background baseline handling. A 1.5 second fail-open
timeout prevents an unavailable service worker from blocking provider dispatch.

## Canonical fact and incident identity v2.81.187 - 2026-07-30

- Canonical event type now determines the typed fact before legacy metadata is
  considered. `MODEL_FINAL` cannot be reclassified as candidate identity merely
  because it also carries `answerIdentity`; finalization has an explicit
  accepted/rejected decision fact.
- Baseline, finalization and terminal events inherit `generationEpoch` and
  `attemptId` from the active dispatch when the immediate producer omits them.
- Delivery proof identifiers such as `attemptId` and `payloadEvidenceId` survive
  metadata compaction.
- Selector forensic omissions are audit-layer events and are only linked when
  the triggering event has an exact dispatch scope.

## Runtime evidence integrity v2.81.186 - 2026-07-30

Standalone false-success reports now retain the scoped runtime decision trace
even when the diagnostic verdict is `unknown`, including generation signals,
verification, response, commit, and post-terminal window events. This keeps
the missing evidence visible and makes the next incident export actionable.

Validated lifecycle answers now emit an explicit accepted
`ANSWER_EXTRACTION_COMPLETED` fact sharing run, dispatch, generation, attempt
and payload identity with source materialization and delivery acknowledgement.
All-presets exports inherit the policy ID from `RUN_CONFIG_RECORDED`, publish a
separate diagnostic-usability audit, and no longer serialize repeated shared
objects as `[CIRCULAR]`. The executable validator and schemas are kept in
`../telemetry-spec/`; incident-specific remediation belongs in
the changelog or the relevant test, not in a second telemetry contract.

## Dispatch proof identity and ordering v2.81.184 - 2026-07-30

Every web dispatch now creates one `generationEpoch` and `attemptId` and carries
them through dispatch start/send, page readiness, the content command, baseline
capture and submission confirmation. Provider adapters await the background
acknowledgement for `DISPATCH_BASELINE_CAPTURED` before they perform Send. A
fast content confirmation also suppresses the later asynchronous
`PROMPT_SUBMITTED_PENDING` transition, keeping submission state monotonic.

## Lossless export barrier v2.81.183 - 2026-07-30

Proof-ledger mutations that arrive while IndexedDB persistence is active are
now coalesced into bounded transactions instead of creating one transaction per
queued mutation. A normal JSON export waits for the queue-drained boundary and
refuses to download a stale committed fallback after the bounded barrier
expires. The UI reports a retryable "still saving" state, so a structurally
valid but evidentially incomplete snapshot can no longer look like a complete
diagnostic artifact.

## No delivery usability boundary v2.81.165 - 2026-07-29

A card hash mismatch alone no longer confirms No delivery. A non-empty usable
answer may be a Cutted case or an allowed representation difference, so the
verdict remains `unknown` until independent unusability or wrong-card evidence
exists. Empty, technical/provider/prompt-echo/placeholder/non-text content and
explicit wrong-card outcomes remain positive delivery-failure evidence.
Legitimate current-dispatch, stale-baseline, selector-failure and provider
finish-reason producers remain explicit canonical mappings; unknown labels
still stay outside proof evidence.

## No delivery cutover v2.81.164 - 2026-07-29

The Platform/Tasks telemetry UI and JSON export now expose `No delivery` in
place of `Empty`. Current All tasks exports contain seven reports and no
`empty` entry. Historical `empty` standalone artifacts from registries
5.6.0–6.0.0 are routed to the frozen legacy contract and are hash-validated
without reinterpretation by the current semantics.

## No delivery shadow contract v2.81.163 - 2026-07-29

`No delivery` is generated beside legacy `Empty` from the same immutable
ledger. Its occurrence verdict compares a directly proven current-attempt
source payload with the expected card at an explicit evaluation boundary;
missing identity, card binding or comparable normalization stays `unknown`.

Occurrence and cause are independent. A proven missing/unusable card remains
`confirmed` when the failing stage is unknown. The cause graph publishes the
last successful stage, first unsuccessful stage and separate failure-stage,
mechanism, observability and recovery axes. Shadow output records verdict
differences without duplicating canonical events.

## Answer commit and card render boundaries v2.81.162 - 2026-07-29

`ANSWER_COMMIT_EVALUATED` is emitted by the accepted-answer commit owner before
SUCCESS publication. The results page independently emits
`ANSWER_CARD_RENDER_EVALUATED` for the expected dispatch-bound card using the
same normalization contract; results from any other tab are rejected.

## Source and delivery boundaries v2.81.161 - 2026-07-29

Validated lifecycle snapshots emit separate source-materialization and
background-reception facts sharing the same attempt-scoped payload identity.
Post-terminal responses are exported as explicit delivery rejections. The
claim is provider-surface materialization, never internal model creation.

## Shared answer proof normalization v2.81.160 - 2026-07-29

Source, extraction, delivery, commit and card evidence use
`answer-proof-normalization@1.0.0`. Identity consists of normalization version,
normalized length/hash and an attempt-scoped `payloadEvidenceId`; differing
versions are incomparable rather than mismatched.

## Proof-event mapping sanitation v2.81.159 - 2026-07-29

Only explicitly registered runtime labels enter canonical diagnostic evidence.
Unknown, recovery-lifecycle, attachment and CDP-file records remain outside
proof slots. Answer reception rejections use delivery semantics instead of
submission/text semantics. Extraction attempt, outcome and fallback mode are
independent facts.

## Semantic review iteration 3 v2.81.157 - 2026-07-29

Registry 5.6.0, report 2.8.0 and generator 1.9.0 close W1-W12 from the third
independent preset review. Absence diagnoses now require a complete observation
window after the failed action for at least `generationStartTimeoutMs`; earlier,
short, degraded or gapped observations remain unknown. Prompt not inserted only
requires submit counter-evidence when submit was actually observed.

Late end binds stability, observations, the first still-active eligibility and
terminal to the accepted candidate. Deadlines explain terminal mode but never
replace eligibility time. Cutted compares extraction with the final valid
candidate boundary, not a historical maximum. Unknown typed facts fall back to
canonical payloads; known contradictions become localized invariants.

Embedded reports expose completeness per incident and select only scoped proof
closure events with an inclusion reason. `single_candidate` Cutted evidence and
an Old answer prior reference outside the export remain
`supported_but_incomplete`. Every Task declares whether refutation is a logical
complement or independent counter-evidence, and all seven Tasks have temporal
integrity coverage.

## Semantic review iteration 2 v2.81.156 - 2026-07-29

Registry 5.5.0, report 2.7.0 and generator 1.8.0 make a preset verdict depend
on the complete proof contract of that specific question. Missing required
slots now produce `supported_but_incomplete` and cannot become the primary
diagnosis. A bounded confidence limitation may still confirm a fact when every
required slot is present; examples include `single_candidate` measurement
comparability and an explicitly referenced prior incident outside the export.

Standalone compaction records the derived view from the full frozen incident
and proves equivalence of the selected Task's applicability, refutation and
slot projection. Unrelated axes and other Tasks no longer force the complete
incident into the report. Candidate/document/turn/navigation identity survives
ledger deduplication and is inherited by companion events.

Candidate continuity now gates extraction, structural verification and
post-terminal audit chains. Completeness decisions supersede earlier states;
proven growth survives later measurements of the same grown answer unless an
explicit rollback invalidates it. Impossible audit remains `unknown`, while a
completed measurement inside tolerance is explicit counter-evidence.

Prompt not sent and Prompt not inserted require a bounded reliable observation
window. Late end requires positive observation coverage and measures excess
wait from the event that made finalization eligible, not from an arbitrary
global stability delay. Old answer materializes actual prior-incident evidence
and compares privacy-safe hashes when both sides are available. Every Task has
an executable refutation, every sibling pair is classified as causal or
co-occurring, and invariant violations affect only their declared slots and
fields.

Acceptance: focused semantic gate 7 suites / 91 tests; complete project gate
187 suites / 1308 tests. All tasks and all seven positive standalone examples
pass schema, privacy, registry, slot, verdict and hash validation.

## Cross-review semantic corrections v2.81.155 - 2026-07-29

Registry 5.4.0, report 2.6.0 and generator 1.7.0 close all V1–V21 findings from
the independent preset cross-check. Standalone verdicts are frozen on the full
incident and proven equivalent after compaction; fact-level slots, temporal and
causal invariants, composite verdicts, candidate continuity, prior-incident
evidence, explicit refutations and field-specific provenance are executable and
offline-replayable. All tasks and seven standalone examples validate cleanly.
The focused gate passes 8 suites / 88 tests and the full project gate passes
186 suites / 1292 tests.

## Prompt insertion diagnosis v2.81.150 - 2026-07-29

Telemetry Tasks now includes `Prompt not inserted` for the specific failure in
which the requested prompt never reaches the live composer. The content
lifecycle preserves `prompt_injection_failed` as a typed, incident-scoped
`PROMPT_INSERTION_EVALUATED` proof event. Confirmed submission, generated text,
non-empty extraction or SUCCESS is explicit counter-evidence. If insertion
failure and failed submission are both proven, Prompt not inserted is the cause
and Prompt not sent is recorded as its consequence. Registry 5.1.0, report
2.3.0 and generator 1.4.0 define all seven Tasks. The complete regression gate
passes 186 suites / 1272 tests.

## Preset semantic hardening gate v2.81.149 - 2026-08-28

Registry 5.0.0, report 2.2.0 and generator 1.3.0 formalize the incident-scoped
contracts for all six Tasks. The regression matrix covers confirmed,
not-confirmed and unknown outcomes, cross-request isolation, independent
embedded sufficiency, causal diagnosis roles, accepted-extraction selection,
legacy limitations and proof-preserving compaction. Generated All tasks and six
standalone artifacts are independently replayed and validated.
Embedded projections reference the shared incident timeline and registry and
store only their status, compact evidence-slot results and event sequence refs.
The focused telemetry gate passes 13 suites / 99 tests and the complete project
gate passes 185 suites / 1269 tests.

## False success occurrence contract v2.81.166 - 2026-07-30

False success now treats a measured post-terminal growth as the occurrence
being diagnosed. Completion hypotheses and finalization policy explain why it
happened but no longer erase an already proven occurrence. The
`post_terminal_mutation` slot accepts measured generation/frame events only
after `MODEL_TERMINAL_RECORDED`; pre-terminal activity cannot satisfy it.
Explicit typed completion evidence no longer conflicts with a canonical
fallback value, while contradictions between two explicit facts remain an
integrity violation.

## Comparable terminal and recovery evidence v2.81.167 - 2026-07-30

`MODEL_FINAL` now carries the accepted answer's normalization version, length,
hash, attempt and payload evidence identifiers. Post-terminal audit compares
normalized source/recovery evidence only when both sides use the same
normalization version. Successful `LATE_COLLECT_DECISION_TRACE` evidence can
participate in the audit; a transport-only recovery visit cannot confirm or
refute answer growth.

## Lifecycle proof identity v2.81.168 - 2026-07-30

Response lifecycle telemetry now keeps the run, dispatch, generation epoch,
turn and navigation identity captured when tracking starts. A late event is no
longer rebound to whichever dispatch is current when background receives it.
Post-terminal audit refuses to compare events from a proven different document
or SPA navigation epoch and records the result as unknown.

## Bounded post-terminal observation v2.81.169 - 2026-07-30

After lifecycle completion the same identity-bound tracker samples the accepted
answer at 1, 3 and 8 seconds. Positive growth can confirm False success on any
sample. An unchanged answer refutes the diagnosis only when the complete window
closes; intermediate unchanged frames remain pending. Cancellation, SPA change
or an unavailable answer closes the window as unknown. Legacy row conversion
declares `native_post_terminal_audit_absent` instead of synthesizing companions.

## Unified evidence closure v2.81.148 - 2026-08-28

Embedded and standalone Tasks now use the same `REPORT_CONTRACTS` slots and
report sufficiency per incident. Conditional slots are promoted to required by
an executable `requiredIf` predicate. All tasks stores canonical events once;
standalone closure keeps proof boundaries, extrema, state changes and explicit
provenance while removing repeated events with the same proof role. Diagnosis
arbitration records one primary explanation plus causal consequence/related
roles without changing a factually true applicability result. Legacy adapters
publish their clock and identity limitations explicitly.

## Preset evidence semantics v2.81.147 - 2026-08-28

Preset applicability now follows positive and opposing evidence inside one
incident. Old answer respects explicit identity before normalized identifier
comparison; False success needs completed audited length growth; Cutted uses
pre-terminal extraction coverage without inferred extraction length. Empty
resolves the extraction accepted by terminal and reports either `empty_result`
or `wrong_node`. Prompt not sent is refuted by proof that the model received and
answered the request. Late end requires an explicit policy decision to wait and
an uninterrupted stable interval rather than an arbitrary millisecond target.

## Incident-scoped embedded applicability v2.81.146 - 2026-08-28

`All tasks` evaluates each diagnosis independently for every exact incident.
The incident key includes run identity, run generation, Platform, dispatch and
generation epoch. Per-Platform status is only an explicit aggregation of those
incident results, so events from a later request cannot prove growth,
truncation or another diagnosis for an earlier request.

## Incident-safe post-terminal audit v2.81.145 - 2026-08-28

Post-terminal observations can audit only a terminal from the exact same run
generation, Platform, dispatch and generation epoch. An observation from the
next request can no longer prove growth of the previous answer. Missing length
metadata stays unknown; if neither lengths nor hashes are comparable, the
audit records `auditPossible=false`, `conclusion=unknown` and the missing
evidence explicitly.

## Semantic preset applicability v2.81.144 - 2026-08-28

Every Task now reports two independent results:

- `completeness.level`: whether the report contains the required evidence
  slots;
- `applicability.status`: whether that evidence actually confirms the selected
  user problem (`confirmed`, `not_confirmed`, or `unknown`).

This prevents a normal SUCCESS, a current-dispatch candidate, a successful
extraction, or a confirmed submission from making a problem report appear
semantically complete. Ordinary comparisons no longer match missing/null
values, so absence of observation cannot trigger a sibling diagnosis.

| Task | Positive applicability proof |
|---|---|
| Cutted | terminal outcome is SUCCESS and incomplete capture is positively proven |
| False success | terminal outcome is SUCCESS and a post-terminal audit proves positive text-length growth |
| Old answer | the accepted answer evidence identifies a dispatch different from the current dispatch |
| Empty | generated text was observed and extraction explicitly failed or returned length zero |
| Prompt not sent | typed submission evidence explicitly concludes `failed`; missing evidence remains unknown |
| Late end | stability and terminal boundaries have comparable monotonic clocks and a positive measured delay |

`Late end` no longer subtracts wall timestamps or clamps reversed/unavailable
time to zero. It prefers a shared producer monotonic epoch, falls back to the
shared worker ingestion epoch, and otherwise records the delay as unknown.
`MODEL_FINAL` now retains privacy-safe accepted-answer identity fields needed to
prove Old answer without exporting answer text.

## User-question preset catalog v2.81.143 - 2026-08-28

Telemetry Tasks now contains six user-facing diagnostic questions:

- `Cutted`: SUCCESS recorded while the captured text is incomplete;
- `False success`: the system finalized while the answer continued growing;
- `Old answer`: extraction accepted a block belonging to an earlier request;
- `Empty`: generation was observed but extraction returned empty or selected the
  wrong node;
- `Prompt not sent`: the model did not receive the request;
- `Late end`: text was already stable but terminal recording happened later.

The former `true-completion`, `forced-success` and `forced-finalization` views
are one `False success` report because they are evidence facets of the same
user problem. `Truncation` becomes the narrower success-specific `Cutted`, and
the former broad extraction view is split into actionable `Old answer` and
`Empty` failures. `Late end` reports `stableToTerminalMs`, calculated from the
last confirmed stability boundary to the terminal event.

This changes report construction only. Runtime telemetry is still written once
to the canonical segmented ledger; All tasks and standalone Tasks are two
export projections of that same evidence.

## Semantic ingestion and operational aggregation v2.81.142 - 2026-08-28

Runtime ingestion no longer wraps the entire legacy operational stream in
Schema 6 envelopes. It uses three explicit routes:

1. Known proof facts become typed canonical events.
2. Repeating probe/ping/gate/detector/recovery signals become immutable
   `OBSERVER_HEALTH_INTERVAL_CLOSED` summaries with first/last monotonic times,
   count and distinct reasons.
3. Unknown legacy labels enter a bounded debug ring outside proof export.

Canonical metadata excludes repeated taxonomy, extension/schema versions,
legacy before/after objects and state projections. Optional unavailable clock
fields are absent instead of repeated as `null`. Embedded All-presets reports
use compact numeric `eventSeqs`; standalone reports keep resolvable event IDs.
If complete core evidence exceeds an operational size budget, the status is
`oversized_preserved_core` rather than a misleading ordinary success.

## Task export zero-evidence fix v2.81.141 - 2026-08-28

Selecting a Task always creates a report for the selected Platform's incident,
even when none of that task's expected event types exists. This case is not an
export error: it is an `insufficient` report containing an incident anchor and
explicit unavailable evidence slots with their impact. This is especially
important for `request-not-sent` and `generation-not-started`, where absence of
the expected transition is the diagnostic subject.

The Platform dropdown is built from the full supported catalog plus selected
and observed platforms. Schema 6 `modelId` is recognized alongside legacy
`platform` and `llmName`.

## Incident cutover v2.81.140 - 2026-08-28

The Telemetry toolbar has exactly two filters: Platform and Tasks. Its existing
status line shows the selected dispatch/generation, deterministic selection
reason and other-match count; there is no `Only problems` or incident filter.
If multiple incidents match one Platform + Task, export writes one isolated
standalone file for each incident.

Schema 6 segmented persistence and the direct incident builder are now the
proof JSON source of truth. The legacy schema 5 storage key and obsolete
standalone closure path have been removed. Optional shadow comparison is gated
by `chrome.storage.local.proofTelemetryShadowCompare`. Missing observation is
`unknown` and cannot satisfy automatic completion evidence.

The current regression gate is recorded in the project changelog; executable
schemas and validators remain in `../telemetry-spec/`.

## Segmented persistence v2.81.139 - 2026-08-28

Production proof telemetry is persisted in IndexedDB stores for lifecycle,
canonical events, incident indexes, quarantine and attachments. Only the active
pointer, compact manifest and feature status remain in `chrome.storage.local`.
The fallback used when IndexedDB is unavailable is explicitly marked
`fallback-test-only`.

Writes are strict transactions and append only events beyond the persisted
global ingestion boundary. Run and incident indexes support range reads without
deserializing the history of unrelated models/problems. Indexes can be rebuilt
from canonical events. A quota/transaction failure preserves the prior active
pointer and becomes explicit detected persistence loss on recovery.

## Strict validator and representation optimizer v2.81.138 - 2026-08-28

`npm run validate:telemetry -- <file>` validates all JSON Schemas, incident and
clock scope, S01–S20, evidence slots, inclusion/provenance references, registry,
sibling predicates, attachments, privacy, replay and semantic/artifact hashes.
Derived state is rebuilt from the standalone materialized closure.

Optimization is representation-only and happens after sufficiency. It may drop
rebuildable view detail or externalize optional attachments, but never removes
canonical core evidence. If an external transport limit still cannot be met,
the result is explicitly `oversized_preserved_core`; it is not made smaller by
weakening proof completeness.

## Incident standalone reports v2.81.137 - 2026-08-28

A selected Task now invokes a dedicated incident builder. It does not create a
large All-presets artifact as an intermediate representation. Every state axis,
summary and replay result is rebuilt from the materialized closure in the file;
field provenance lists its source event IDs and derivation version.

Completeness is evidence-slot based (`complete`, `bounded`, `insufficient`).
Missing slots state their impact, while safe and blocked conclusions remain
separate. Artifact and semantic hashes are recorded independently. File size is
reported as a category for operational visibility, never used to discard core
evidence. All-presets remains a deduplicated shared-ledger composition.

## Incident evidence graph v2.81.136 - 2026-08-28

Telemetry analysis is now indexed around one incident scope:
`runGeneration + runSessionId + modelId + dispatchId + generationEpoch`.
Candidate IDs and navigation lineage remain attached to that scope. Platform
and Task select one deterministic incident and expose the reason and other
matching incident count without adding another UI filter.

The report registry resolves critical, required and conditional evidence
slots. Materialization follows evidence, causal and correlation edges plus
SYSTEM, decision, terminal, contradiction and audit context. Every copied event
has one or more `includedFor` reasons; incompatible dispatch/generation edges
are rejected rather than silently merged.

## Typed transition emission v2.81.135 - 2026-08-28

Canonical records contain typed facts at ingestion. Polling deduplication is
maintained independently for each run/model/dispatch/generation/signal, so a
different signal between two equal samples does not cause the equal sample to
be stored again. Long unchanged periods use bounded heartbeats.

Navigation, worker restart and run closure produce immutable observation
interval summaries. Derived inference is recorded only when its state changes;
identity already present in the event envelope is removed from payload
metadata.

## Run lifecycle and clock runtime v2.81.134 - 2026-08-28

The background writer now persists schema 6 canonical events. Run order is
defined by a non-reused `runGeneration`; event order is defined only by global
`ingestSeq`. `wallTs` remains external-correlation metadata and cannot decide
admission, timeout or completion.

Every run has append-only open/close lifecycle events. Producer and worker
epochs make exact durations legal only within one monotonic clock; cross-epoch
comparisons are bounded or unavailable and threshold evaluation becomes
tri-state. Observation frames preserve per-signal check times, transport delay
and coverage. A worker restart closes an open interval with degraded coverage,
never with inferred absence.

Focused lifecycle/clock gate: 8 suites / 51 tests.

## Executable contracts and schema 6 v2.81.133 - 2026-08-28

At v2.81.133, all eight then-current Tasks were defined by one executable
registry of typed evidence slots. The same registry mechanism now defines the
six Tasks listed at the top of this document.
The runtime policy reads normalized typed facts; legacy `sourceEventType` text
is interpreted only at the migration adapter boundary. Incident joins require
the exact run, model, dispatch and generation identity, so an absent identity
cannot silently broaden a report.

The schema 6 event contract adds non-reused `runGeneration`, global
`ingestSeq`, a collision-resistant `eventId` and explicit producer/worker clock
epochs. These fields are the executable input contract for the lifecycle and
clock runtime introduced by the next migration stage.

## Safety containment v2.81.132 - 2026-08-28

- Новый run авторитетно открывается до первой model telemetry; событие с другим
  run ID больше не очищает active ledger и помещается в bounded quarantine.
- Добавлены bounded pending records и явные `PENDING_EVIDENCE_DROPPED` markers.
- Generic completion + structural verification больше не повышают evidence до
  T3; требуется strong UI transition и identity `current_dispatch`.
- Standalone export больше не выдаёт validation/replay полного скрытого ledger
  за собственную проверку: до incident closure статус честно provisional.
- Standalone JSON приведён к schema, SYSTEM context сохраняется при Platform,
  signal skew унифицирован на 250 ms, неизвестные observation values не
  подменяются оптимистичными defaults.

## Bounded standalone diagnostic reports v2.81.131 - 2026-07-28

В версии 2.81.131 `Tasks` выбирал не дополнительный срез большого All-presets
файла, а один из восьми самостоятельных proof-oriented отчётов для выбранной Platform:
`request-not-sent`, `generation-not-started`, `truncation`, `true-completion`,
`submission-proof`, `extraction-integrity`, `forced-success` или
`forced-finalization`. При выбранной задаче Platform обязательна; это не даёт
случайно экспортировать дорогой общий файл.

- Standalone JSON содержит только события отчёта, `RUN_CONFIG_RECORDED` и
  транзитивное замыкание `evidenceRefs`; событие материализуется ровно один раз.
- В отчёте есть независимые state axes, diagnostic summary, sibling conditions,
  correlation, run configuration, hashes, replay/schema results и релевантные
  attachments/omissions.
- Лимит standalone-файла — 60 KB; фактический размер и результат проверки
  записываются в `exportIntegrity.budget`.
- Offline validator автоматически различает `all-presets` и
  `diagnostic-report`, проверяя hash, ссылки, privacy, sequence и отсутствие
  повторяющихся `eventId`.
- Нормативная таблица event types для Tasks хранится один раз в
  `ProofOrientedTelemetry.REPORT_EVENT_TYPES` и используется UI напрямую.

Regression gate: 27 suites / 203 tests.

Начиная с версии `2.81.151`, конкретную Task можно экспортировать и при
`All platforms`: система детерминированно создаёт отдельный bounded standalone
JSON для каждого exact incident каждой доступной платформы. При выбранной
Platform экспорт ограничивается только её incident'ами. Скрытый выбор моделей
в заголовке страницы на proof JSON не влияет — область задают исключительно
два видимых фильтра Telemetry.

Версия `2.81.306` распространяет это правило на само окно и на остальные
экспорты. До неё контракт соблюдал только proof JSON: таймлайн, Summary и
MD-экспорт дополнительно пересекали результат со скрытыми кнопками LLM в
заголовке страницы. Из-за этого `All platforms` означало не «все», а «выбранные
в заголовке» — фильтр умел только сужаться внутри скрытого выбора и никогда не
расширялся, а при прогоне одной модели все допустимые значения давали
одинаковый результат. Теперь окно, MD и proof JSON сведены к одному предикату
`matchesTelemetryModel`; он понимает и канонический `modelId`, и legacy
`platform`/`llmName`, а канонический экспорт дополнительно сохраняет run-level
события `SYSTEM`, без которых отчёт остаётся без конфигурации запуска.

Список Platform строится только из моделей, реально присутствующих в леджере.
Захардкоженный каталог из десяти платформ убран: он предлагал выбрать модели,
событий по которым нет в принципе, и любой такой выбор давал пустой экран.
Пустой леджер оставляет в списке только `All platforms`.

Поведение зафиксировано `tests/telemetry-model-filter.test.js`: окно
загружается в jsdom и фильтр проверяется через собственный мост модуля, а не
сравнением строк исходника.

Версия `2.81.308` чинит покрытие дайджеста. Семь пресетов опираются на 34 типа
событий; дайджест имел правило для 20 из них, остальные либо не имели правила
вообще, либо лежали в `IGNORED` целиком. Практически это означало, что
`prompt-not-sent` был слеп на 8 типах из 11, а `prompt-not-inserted` — на 7 из
10, то есть режим, задуманный как «файл для разбора моделью», эти классы сбоя
разобрать не мог.

Недостающие типы читаются через `payload.typed = {kind, state}` — канонический
факт на каждом событии schema 6. Это один предикат вместо четырнадцати
разборщиков `metadata` с угадыванием имён полей, и он не может разойтись с
конкретным типом. Результат — секция `PROGRESS`: пер-модельная траектория смен
состояния, где повторы одного состояния свёрнуты в точный `×n`.

Контракт читателя расширен: состояния из `PROGRESS_TYPES` читаются полностью,
поэтому **их отсутствие в траектории является доказательством** — в отличие от
секций, где дайджест лоссовый. Длинные прогоны ограничены 60 шагами на модель
(голова и хвост, отказы приходятся на конец); чтобы обрезка не отменяла это
обещание, состояния, оставшиеся только в выброшенной середине, перечисляются
поимённо.

Измеренные размеры: экспорт на 20 событий 163KB → 2.3KB, прогон на 2180 событий
3.2MB → 44KB. Замок — `tests/telemetry-digest-coverage.test.js`, который
вычисляет требование пресетов из `REPORT_EVENT_TYPES`, а не хранит его копию.

Версия `2.81.307` возвращает модель в имя файла полного экспорта:
`telemetry-all-presets-<model>-<ts>.json` и
`telemetry-canonical-evidence-<model>-<ts>.json`. До неё слаг модели был только
у одиночных incident-отчётов, и выгрузки разных моделей на диске были
неотличимы. Модель берётся из фильтра Platform, а при `All platforms`
выводится из самих экспортируемых событий: одна модель — её имя, несколько —
`all-models`; run-level события `SYSTEM` в подсчёт не идут. Замок —
`tests/telemetry-export-filename.test.js`.

Версия `2.81.152` унифицирует границу incident во всех слоях: совпадать должны
run, `runGeneration`, model, dispatch и generation epoch. SYSTEM-доказательства
могут войти в closure только из того же run/runGeneration, неизвестный явный
`incidentId` завершается без fallback, а состояния identity приводятся к
единому словарю `current|previous|ambiguous|rejected|unknown`.

Версия `2.81.153` разделяет применимость вопроса и силу доказанного диагноза.
`applicability.status=confirmed` означает, что наблюдаемые признаки совпали;
`diagnosticVerdict=confirmed` возможен только при достаточных fact-level слотах
и без temporal/causal violations. Арбитраж использует только второй статус.
Audit после terminal обязан ссылаться на terminal и последующее наблюдение;
одно лишь совпадение eventType слот больше не удовлетворяет.

Версия `2.81.154` запрещает изменение диагноза из-за компактизации. Applicability
фиксируется на полном frozen incident; compacted report обязан воспроизводить
те же state axes и результаты всех Tasks. В export integrity записываются
`fullIncidentSemanticHash`, обе verdict-проекции и `equivalent`. Если bounded
closure не сохраняет смысл, материализуется полный incident с явной причиной
`semantic-verdict-preservation`.

Версия `2.81.155` усиливает смысл отдельных Tasks. Cutted сравнивает длины
только внутри одной candidate lineage; Old answer требует SUCCESS и найденный
`priorIncidentRef`, события которого входят в отдельную evidence lane; Prompt
not sent опровергается самим доказанным стартом генерации. Late end использует
policy boundary и единый tolerance, а False success остаётся вопросом именно о
росте, поэтому hash-only замена отмечается audit-контрадикцией, но не считается
ростом. Conclusions теперь ссылаются на slotId, provenance каждого флага —
только на участвовавшие eventId.

`Only problems` не возвращён: проблемность является вычисляемым результатом
диагностической задачи, а не независимой осью отбора. Для анализа выбираются
конкретный вопрос и при необходимости Platform; режим `All tasks` остаётся
осознанным полным экспортом.

## Native-only schema 5 cutover v2.81.130 - 2026-07-28

JSON export больше не зависит от legacy diagnostics, grouped platform payload,
run-summary projection или `shared/telemetry-export.js`. Единственный источник
JSON — frozen `GET_PROOF_TELEMETRY_SNAPSHOT`; пустой native ledger не подменяется
старыми событиями.

С v2.81.179 ledger сохраняет внутрипроцессный нормализованный state и
объединяет синхронный всплеск telemetry-событий в одну IndexedDB-транзакцию.
Перед `GET_PROOF_TELEMETRY_SNAPSHOT` ожидающий batch принудительно ставится в
очередь раньше snapshot. Поэтому экспорт сохраняет persistence barrier и все
принятые до клика события, но не ждёт отдельное полное чтение и запись для
каждого сигнала.

С v2.81.180 ожидание export barrier ограничено двумя секундами. Если durable
очередь не успела полностью опустеть, `GET_PROOF_TELEMETRY_SNAPSHOT` возвращает
последнюю целиком закоммиченную границу с
`snapshotConsistency:'committed_boundary'` и `barrierTimedOut:true`; очередь
продолжает сохраняться в фоне. При пустой очереди используется обычный
`snapshotConsistency:'queue_drained'`. IndexedDB-транзакции остаются
атомарными и упорядоченными, но используют `relaxed` durability без отдельного
физического fsync для каждого telemetry-сигнала.

С v2.81.181 `GET_PROOF_TELEMETRY_SNAPSHOT` является ранним route фонового
message listener. Он выполняется до общего `ensureInitialState()` и не зависит
от загрузки job state, tab map, resolution metrics, dispatch circuit и
lifecycle bootstrap. Это важно при cold start service worker: иначе таймер
export barrier начинал отсчёт только после потенциально долгой общей
инициализации.

С v2.81.182 лёгкий `results-telemetry-export-bootstrap.js` подключается перед
`results.js` на обеих страницах результатов. Если пользователь нажимает JSON
до готовности lazy `results-devtools.js`, bootstrap сохраняет намерение,
немедленно загружает exporter и автоматически продолжает тот же экспорт после
события `load`. Кнопка и строка статуса сразу показывают busy-фазу.

С v2.81.226 all-presets export независимо фиксирует два вида полноты:

- `snapshotCompleteness` показывает, вошла ли очередь записи в экспортную границу;
- `runCompleteness` показывает, завершили ли ожидаемые модели свой жизненный цикл.

`RUN_CONFIG_RECORDED` сохраняет список ожидаемых моделей. `exportAudit.completeness`
перечисляет expected, observed, terminal и pending models и отдельно отмечает
`exportedDuringActiveRun`. Поэтому чистый `queue_drained` snapshot активного запуска
больше не выглядит как завершённый run, а закрытый run с незавершённой моделью не
выглядит как повреждённая persistence boundary.

С v2.81.227 команда `npm run test:telemetry-parity` строит standalone-вариант
каждого embedded report для каждой модели и каждого incident frozen ledger.
Comparator приводит ссылки `seq` к `eventId` и сравнивает диагностическую
семантику, а не форму JSON. Отдельные мутационные проверки подтверждают, что
gate обнаруживает изменение verdict, evidence slot, limitation и causal relation.

С v2.81.228 рядом с плоским `stateAxes` публикуется `stateAxesProvenance` для
всех четырнадцати осей. Значение и его происхождение вычисляются одной ветвью
правила; provenance содержит `layer`, точные `basisEventIds`, `ruleId` и
`derivationVersion`. Валидатор отклоняет отсутствующие basis-события и ссылки
на другой incident. Basis-события входят в самостоятельный отчёт, а axes вместе
с provenance участвуют в semantic и artifact hashes.

С v2.81.229 диагностическая семантика инцидента вычисляется одним чистым ядром
`buildIncidentReportSemantics`. Embedded all-presets и standalone report только
преобразуют его канонический результат в разные формы хранения. Parity gate для
каждой задачи и каждого инцидента сравнивает embedded, standalone и core-проекции;
отдельного второго диагностического движка больше нет.

С v2.81.230 `buildCanonicalEvidence` создаёт отдельный формат
`canonical-evidence`. Он сохраняет полный ledger, runtime-конфигурацию, полный
dependency registry, состояние запуска, attachments/omissions и компактный
incident index со всеми `stateAxes`/`stateAxesProvenance`, но не содержит семь
предвычисленных `reports` и полный `derivedViews`. Версионированный
`readerGuidance` считается доверенным только после проверки allowlist и хешей.
Offline validator проверяет schema, границу snapshot, registry/generator,
incident projection, basis refs, privacy, размеры и artifact hash.

С v2.81.231 отчёты из сохранённого canonical evidence строятся офлайн:

```bash
npm run build:telemetry-report -- telemetry.json --list-incidents
npm run build:telemetry-report -- telemetry.json --task=cutted --incident=<id> --out=report.json
npm run build:telemetry-report -- telemetry.json --all --out=full-forensic.json
```

CLI сначала валидирует исходный файл и compatibility, не выбирает неоднозначный
incident молча, затем вызывает штатный shared builder и валидирует результат.
Исходный файл никогда не перезаписывается. Для неизвестной версии возможна
только явная маркированная `--reproduction=reinterpretation`; exact reproduction
по умолчанию завершается отказом. В выходе сохраняются source artifact hashes и
полный ключ воспроизводимого кэша.

С v2.81.232 в панели Telemetry обеих страниц результатов есть три явно
названных формата: `Digest`, `Canonical evidence` и `Full forensic`. По умолчанию
по-прежнему выбран Digest; сохранённое старое значение checkbox автоматически
переводится в Digest либо Full forensic. Оба JSON-формата строятся и
сериализуются вне UI-потока в export worker. При timeout остаётся recovery-файл,
содержащий все canonical events.

С v2.81.233 `ProofTelemetryPresentations` строит Timeline и Markdown напрямую
из canonical proof ledger. Текущий Timeline пока не заменяется: рядом в памяти
создаётся shadow-проекция и фиксируются legacy-only/proof-only event types,
расхождения model/dispatch identity, terminal count и временных границ. Результат
доступен как `window.__PROOF_TELEMETRY_TIMELINE_SHADOW__`, а статус/version — в
dataset Timeline. Экспорт All Logs MD сохраняет прежние секции и добавляет
canonical proof appendix с `seq`, `eventId`, scope, layer и typed fact из
зафиксированной proof snapshot. Его shadow-сравнение доступно как
`window.__PROOF_TELEMETRY_MARKDOWN_SHADOW__`. Оба пути read-only и ничего не
записывают в журнал, который наблюдают.

С v2.81.234 JSON worker сообщает стадии `incident-index`, `derived-views`, каждый
тип отчёта, `hashes`, `attachments`, `finalizing`, `redacting` и `serializing`.
На клиенте дополнительно измеряются snapshot/persistence boundary, structured
clone, worker response и Blob/download. Последний завершённый замер доступен
только в памяти страницы как `window.__PROOF_TELEMETRY_LAST_EXPORT_METRICS__` и
никогда не добавляется в экспортируемый ledger. Новый запрос отменяет предыдущий;
на каждой стадии и на всей операции действуют deadlines, worker завершается при
любом исходе, object URL освобождается, а при ошибке выгружается полный canonical
recovery ledger.

Команда `npm run test:telemetry-stress` проверяет 500, 2 000, 5 000 и 10 000
событий, параллельные сборки, повреждённое событие, отсутствующий registry и
memory pressure. В эталонном прогоне 2026-08-02 сборка 10 000 событий заняла
322,4 мс для canonical evidence и 495,2 мс для full forensic; до индексирования
temporal slot matching тот же full forensic занимал около 32,4 с.

С v2.81.235 сохранённые реальные выгрузки проверяются командой
`npm run validate:telemetry-field -- <files...>`. Для JSON она выполняет текущую
валидацию, объясняет только известный versioned contract drift, сохраняет ledger
hash, перестраивает canonical/full и сравнивает embedded/standalone/core для всех
задач и инцидентов. Любое необъяснённое расхождение закрывает gate с ошибкой.
Для digest фиксируются только безопасные envelope-метаданные; он явно считается
triage-only и не выдаётся за материал для integrity validation либо replay.
Фактический прогон восьми выгрузок описан в
`docs/telemetry-field-validation-2026-08-02.md`.

С v2.81.252 полевой валидатор учитывает различие формы контейнеров: у
`canonical-evidence` реестр расположен в верхнем `dependencyRegistry`,
инциденты — в `incidentIndex.incidents`, а версия отчёта — в
`sharedConfig.reportVersion`. Эти поля участвуют в сводке и проверке режима
`exact-current-generator`; валидный canonical-файл больше не отображается как
нулевой набор инцидентов или историческая reinterpretation.

С v2.81.236 defense-in-depth redaction выполняется в export worker до вызова
builder. Поэтому ledger, section/artifact hashes и `measuredBytes` вычисляются
уже по безопасному представлению и не становятся недействительными, когда в
исходном событии действительно обнаружен token-shaped секрет.

С v2.81.237 offline CLI разрешает `exact-reproduction` только при одновременном
совпадении generator version, единой report version и полного registry hash.
Проверка выполняется одинаково для `canonical-evidence` и `all-presets`;
исторический контейнер требует явного `--reproduction=reinterpretation`.

С v2.81.238 policy загружается до proof export builder во всех browser/worker
контекстах. Поэтому UI task reports, background и export worker вычисляют
одинаковый точный `stateAxesProvenance`; fallback provenance больше не возникает
из-за порядка загрузки скриптов.

С v2.81.239 field validator больше не подавляет ошибки только по их коду и
возрасту файла. Historical migration считается объяснённой лишь при точном
совпадении message signature, отсутствующей старой структуры и ожидаемого
количества findings. Project version читается из manifest; exact identity также
проверяет report version и registry hash.

С v2.81.240 production UI использует `TelemetryExportRuntime`: ту же исполняемую
worker orchestration, которую запускают тесты. Gate создаёт fake workers и
фактически проверяет completion, single-flight cancel, stage/overall timeout,
crash, synchronous structured-clone failure, обязательный `terminate()`,
canonical recovery и отложенный `URL.revokeObjectURL`.

С v2.81.241 offline report CLI сохраняет неблокирующие S06/S15 как
`diagnosticLimitations` в source provenance результирующего артефакта и выводит
их в stderr. Эти ограничения больше не теряются при успешном коде завершения.

С v2.81.242 отсутствие evidence представляется аудиторским результатом, а не
инференсом без основания. Для слоёв `fact`, `inference` и `decision` валидатор
требует хотя бы один разрешимый basis event внутри incident scope.

С v2.81.243 инвариант export/persistence boundary закреплён исполняемым тестом:
после ожидания queued record построение артефакта не меняет ledger, число
persistence writes и `queuedMutationCount`.

С v2.81.244 CLI формально различает `exact-reproduction`, условный
`legacy-reproduction`, явную `reinterpretation` и итог `unsupported`.
Исторических адаптеров пока нет: запрос legacy завершается fail-closed с
`REPRODUCTION_UNSUPPORTED`, а не пересчитывается текущей policy.

С v2.81.245 field validator знает точную миграционную сигнатуру старых
zero-basis inference. Allowlist требует generator 2.6.0, derivation 1.0.0,
ожидаемый ruleId, пустой basis и точное структурно вычисленное число S22.

- Platform/Tasks фильтруют canonical envelopes по `modelId` и безопасному
  event payload. Исходные `seq` не перенумеровываются; filtered ledger остаётся
  immutable, а export boundary равен фактическому последнему включённому `seq`.
- Каждый runtime ledger начинается с `RUN_CONFIG_RECORDED`.
- `LIFECYCLE_SNAPSHOT_ACCEPTED` материализуется как atomic
  `OBSERVATION_FRAME_CAPTURED` с capture times, signal skew, tab/document/content
  script health, throttling, lease, candidate и mutation metadata.
- Candidate-set facts порождают отдельный `CANDIDATE_IDENTITY_INFERRED`.
- Legacy diagnostics остаются только источником текущего Timeline/MD UI и не
  участвуют в schema 5 JSON integrity/replay.

Расширенный regression gate: 27 suites / 173 tests.

## Offline validator v2.81.129 - 2026-07-28

Проверка экспортированного All-presets:

```bash
npm run validate:telemetry -- /path/to/telemetry.json
```

Validator проверяет container/schema 5, ledger sequence и evidenceRefs,
terminal/decision/override lineage, восемь embedded reports, отсутствие
materialized event copies, evaluated `requestIf`, cross-report boundary,
section/container SHA-256 hashes, deterministic decision replay, privacy keys и
фактический byte budget. Функция `reconstructAtSeq()` восстанавливает state axes
на любой границе `seq`.

Scenario tests охватывают normal completion, temporary pause, same-length hash
change, stale baseline, prompt echo, multiple candidates, background throttling,
selector failure, request-not-sent, generation-not-started, forced timeout,
post-terminal growth, SPA navigation, active-run export и replay mismatch.

## Post-terminal audit and forensic omissions v2.81.128 - 2026-07-28

`shared/proof-telemetry-audit.js` выполняет аудит наблюдений после terminal
decision.

- В terminal boundary создаётся `MISSING_EVIDENCE_RECORDED` со статусом
  `pending`: отсутствие последующего наблюдения не считается подтверждением.
- Первое и последующие релевантные answer/text/candidate observations сравнивают
  принятые и наблюдаемые length/hash и создают
  `POST_TERMINAL_AUDIT_COMPLETED` с `confirmed` либо `contradicted`.
- Рост более 0.5% или изменение hash фиксирует точные growth chars/percent и
  включает truncation/true-completion escalation.
- Selector, observer, contradiction и post-terminal anomalies создают forensic
  trigger. Raw DOM не сохраняется автоматически: при недоступном безопасном
  capture All-presets содержит content-addressable omission с reason и impact.
- Model timeline экспортирует audit status/conclusion и корректно считает рост
  относительно terminal accepted length, а не последнего позднего snapshot.

Начиная с v2.81.171 lifecycle-аудит снимает пять ограниченных кадров через
1/3/8/15/30 секунд. Это покрывает длинные паузы генерации; закрытие окна на
30-й секунде по-прежнему явно различает `changed`, `unchanged` и `unavailable`.

С v2.81.172 подтверждённое `answerVerification` монотонно: более поздний
неверифицированный retry сохраняется в `answerVerificationLast` для диагностики,
но не уничтожает ранее доказанное structural completion.

С v2.81.173 время доказательства разделено на producer `observedAt` и background
`recordedAt`. Возраст proof теперь вычисляется от фактического DOM-наблюдения,
а не от момента доставки сообщения.

С v2.81.174 lifecycle structural verification работает fail-closed: без
`AnswerPipelineConfig.finalization` доказательство не создаётся. Перед снимками
детектор ждёт загрузки активного timing profile, поэтому Long использует свои
пять проверок, а не ранние Standard-дефолты.

С v2.81.175 поздний непомеченный ответ не заменяет текст уже закрытой карточки.
UI сохраняет принятый ответ и добавляет сворачиваемую ревизию «Ответ обновлён
после завершения» с источником и дельтой длины. Явные `answerRevision`/`revisionOf`
остаются разрешённым каналом пересмотра.

С v2.81.176 generation proof стал трёхзначным. Видимый индикатор даёт `true`,
найденный, но неактивный узел даёт доказанное `false`, а полный промах всех
настроенных селекторов даёт `null`. Последний случай блокирует automatic SUCCESS
как `generation_inactive_unproven`.

С v2.81.177 видимая Stop блокирует успешные причины watcher и после soft
deadline. Если кнопка остаётся до hard deadline, результат — незавершённый
`hard_timeout`, а не `content_mutation_stable`.

С v2.81.178 adaptive timeout учитывает `expectedLength` до запуска внешнего
watchdog и watcher. По мере роста текста deadline может расширяться до
`hardMax`, но никогда не сокращается и не выходит за предел профиля.

## Evidence policy and replay v2.81.127 - 2026-07-28

`shared/proof-telemetry-policy.js` является чистым inference/policy engine для
schema 5 ledger.

- Submission и generation facts порождают отдельные `SUBMISSION_INFERRED` и
  `GENERATION_STATE_INFERRED`, не изменяя исходный FACT.
- Completion evidence классифицируется по T0–T4; timeout/stability/terminal
  status сами по себе не повышают proof до T3.
- Перед terminal action сохраняются `FINALIZATION_POLICY_EVALUATED` и
  `DECISION_RECORDED` со всеми rules, blockers и evidence tier.
- SUCCESS ниже automatic policy создаёт явный `POLICY_OVERRIDE_APPLIED` с
  waived rules и residual risk; completion state при этом не переписывается.
- `MODEL_TERMINAL_RECORDED` содержит `evidenceRefs` и `decisionId` принятого
  решения. Replay проверяет S06/S07 lineage.
- Export повторно вычисляет state axes и decision projections. SHA-256
  `recordedDecisionHash` и `recomputedDecisionHash` должны совпасть, иначе
  `exportAudit.replay.valid=false`.

## Native schema 5 ledger v2.81.126 - 2026-07-28

Background runtime ведёт отдельный append-only ledger в
`__proof_telemetry_ledger_v5__`. Запись выполняется до legacy sampling и до
подавления post-terminal noise, поэтому отсутствие строки в старом UI-журнале
не интерпретируется как отсутствие факта.

- Каждое событие получает immutable envelope schema 5, монотонный `seq`,
  уникальный `eventId`, `wallTs`, run-relative `monoMs`, correlation IDs,
  producer и явный layer.
- Записи сериализованы одной mutation chain; export snapshot ждёт завершения
  ранее поставленных append-операций и фиксирует единый boundary.
- При новом run ledger начинается заново; extension update и ручной Clear также
  очищают persistent ledger.
- Exact consecutive no-op events подавляются до persistence.
- Canonical payload проходит metadata-only sanitization до записи.
- JSON export запрашивает `GET_PROOF_TELEMETRY_SNAPSHOT` и строит All-presets
  непосредственно из нативных envelopes.

Для native export `exportAudit.sourceCompatibility.mode` равен
`native-runtime-ledger`, а `canonicalRuntimeEmissionPending=false`.

## Telemetry filters v2.81.125 - 2026-07-28

В toolbar вкладки Telemetry оставлены ровно два фильтра:

- `Platform` — ограничивает события одной платформой;
- `Tasks` — выбирает одну из шести текущих proof-oriented диагностических
  задач, перечисленных в разделе v2.81.143 выше.

Отдельные `Type`, `Presets` и `Only problems` удалены из UI и экспортного
контура. Начиная с v2.81.131 Tasks использует каноническую классификацию schema
5 и создаёт ограниченный самостоятельный отчёт вместо полнотекстового среза.

## Proof-oriented export v2.81.124 - 2026-07-28

JSON export на вкладке Telemetry теперь выдаёт канонический контейнер
`all-presets` schema `5.0`, а не набор независимых массивов по платформам.
Точка входа реализации — `shared/proof-oriented-telemetry.js`; UI вызывает её
из `results-devtools.js` после получения полного run-scoped snapshot.

Контейнер содержит:

- один упорядоченный append-only ledger с envelope schema `5`, уникальными
  `eventId`/`seq`, `wallTs` и производным `monoMs`;
- независимые оси submission, generation start, answer identity, наблюдаемой
  генерации, эволюции текста, полноты, extraction, verification, completion,
  observation reliability и finalization;
- на момент v2.81.124 восемь embedded reports: `request-not-sent`, `generation-not-started`,
  `truncation`, `true-completion`, `submission-proof`,
  `extraction-integrity`, `forced-success`, `forced-finalization`;
- вычисленные `requestIf` зависимости с результатом по каждой модели;
- compatibility boundary, section hashes, invariant validation, replay marker и
  measurement и явный `oversized_preserved_core` в `exportAudit`;
- только compact `eventSeqs` внутри embedded reports: события и UUID не
  дублируются;
- metadata-only privacy: произвольные details, prompt, answer, HTML, content,
  tokens и credentials не попадают в canonical payload; сохраняются безопасные
  hash/length/state/ID/evidence поля.

### Текущая граница миграции

Runtime продолжает писать совместимые legacy diagnostics. Exporter замораживает
один snapshot и детерминированно преобразует его в canonical ledger. Поэтому
`exportAudit.sourceCompatibility.mode` равен `legacy-runtime-adapter`, а
`canonicalRuntimeEmissionPending=true`. Это намеренная первая стадия cutover:
новый формат, privacy и offline-анализ уже проверяемы, но нативная запись FACT /
INFERENCE / DECISION / ACTION / AUDIT непосредственно в runtime остаётся
следующим этапом. Адаптер не превращает terminal `SUCCESS` в доказательство
completion и не превращает forced finalization в `inferred_complete`.

Нормативный design package находится в
`../telemetry-spec/`; текущий исполняемый контракт этого
этапа задают код и `tests/proof-oriented-telemetry.test.js`.

## Update v2.81.74 - 2026-07-25

Purpose: keep Disput telemetry diagnostic rather than turning it into a second
copy of prompts, model answers and semantic state.

- Disput trace redacts full content fields at ingress, including generic `text`,
  camelCase prompt/answer/HTML names, nested answer evidence, StateMap/context
  snapshots and attachment bodies. Length/hash/IDs remain available.
- Restored trace storage is re-sanitized and immediately rewritten, covering
  events written by older extension versions and removing their raw persisted
  copies (`TraceSchema.VERSION=5`).
- Diagnostic Telemetry-to-Disput bridging uses a safe evidence whitelist and
  drops uninformative legacy info events.
- Derived JSON sections contain event references and compact artifact metadata,
  never embedded copies of canonical events.
- `Only problems` applies to `events`, dispatches, recoveries, divergences,
  participants and barriers through the same visible evidence IDs.
- JSON download has a final deep secret-redaction pass.

## Update v2.81.73 - 2026-07-25

Purpose: make partial generation, tab closure and reasoning/final-answer
confusion visible without exporting provider response content.

- `MODEL_OUTCOME.meta.observedState` distinguishes
  `generating_partial_answer`, `generating`,
  `answer_observed_without_terminal`, `tab_closed_during_generation` and
  terminal state. It also contains latest/max observed text length.
- `TAB_CLOSED.meta` includes `closureState`, terminal/generation flags, last
  answer length and `mappingSource`. `closeOrigin=user_or_external` reflects the
  Chrome API limitation: a removed tab alone does not prove a user click.
- Qwen lifecycle events include `responsePhase` and length/boolean-only
  `phaseEvidence`. `LIFECYCLE_COMPLETION_PHASE_SUSPECT` is a warning when a
  generic completion decision was made on a reasoning-only DOM snapshot.
- `MODEL_FINAL` and `STATE_PROJECTION_COMMITTED` redact full answer text/HTML
  and retain evidence length/hash/source only.
- `MODEL_OUTCOME.meta.consistencyIssues` reports contradictory terminal
  metadata such as `SUCCESS` paired with `doneReason=error`.
- A failed fallback selector is downgraded to informational when another
  selector for the same model/target succeeded in that aggregation window.

## 2026-02-16 12:26 (v2.72.77)
- `SCRIPT_RUNTIME_HARD_STOP_GRACE` added: hard-stop now supports bounded grace extensions when recent runtime activity is present, reducing false timeout terminalization near response completion.
- Runtime activity signals are tracked via diagnostics, prompt submit confirmation, and incoming responses (`lastRuntimeActivityAt/Source`), and used by hard-stop arbitration.
- Passive transport failures now surface as `PING_TRANSPORT_ERROR` (warning) instead of `COMMAND_SEND_ERROR` in ping paths.
- Duplicate terminal responses are ignored with `Response ignored (duplicate terminal)` to prevent repeated `MODEL_FINAL` records.

## Manual Test Procedure
Purpose: verify Telemetry Timeline and Telemetry Rounds without real model traffic.

The Telemetry toolbar orders export actions as JSON download, then MD. JSON uses
the same `ti-download` icon language as model-card export on the main page while
retaining the accessible label `Export telemetry as JSON`; MD remains a textual
button because it exports the combined human-readable All Logs report.
The Disput toolbar follows the same ordering and icon contract: JSON download
first with `ti-download`, followed by the textual MD export.

### Option A — Playwright (automated)
1) Install deps:
```
npm install
```
2) Create `tmp-run-telemetry-check.js` in repo root:
```js
const { chromium } = require('playwright');

(async () => {
  const extPath = '/Users/restart/Downloads/LLM_Codex';
  const userDataDir = '/tmp/pw-llm-codex-profile';
  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    args: [
      `--disable-extensions-except=${extPath}`,
      `--load-extension=${extPath}`,
      '--no-first-run',
      '--no-default-browser-check'
    ]
  });

  const getExtensionId = async () => {
    const workers = context.serviceWorkers();
    if (workers.length) {
      const url = workers[0].url();
      const match = url.match(/chrome-extension:\/\/(.*?)\//);
      return match ? match[1] : null;
    }
    const worker = await context.waitForEvent('serviceworker', { timeout: 15000 });
    const url = worker.url();
    const match = url.match(/chrome-extension:\/\/(.*?)\//);
    return match ? match[1] : null;
  };

  const extensionId = await getExtensionId();
  if (!extensionId) {
    console.error('Extension ID not found');
    await context.close();
    process.exit(1);
  }

  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/result_new.html`, { waitUntil: 'domcontentloaded' });

  await page.waitForSelector('#telemetry-tab', { timeout: 15000, state: 'attached' });
  await page.evaluate(() => {
    const tab = document.getElementById('telemetry-tab');
    tab && tab.click();
  });

  await page.waitForFunction(() => {
    const panel = document.getElementById('telemetry-tabpanel');
    return panel && !panel.hasAttribute('hidden');
  }, null, { timeout: 15000 });

  const runSessionId = Date.now();
  const dispatchId = `Grok:${runSessionId}:1`;
  const baseMeta = { runSessionId, dispatchId, llmName: 'Grok' };

  await page.evaluate(async ({ baseMeta }) => {
    const send = (event) => new Promise((resolve) => {
      chrome.runtime.sendMessage({ type: 'LLM_DIAGNOSTIC_EVENT', llmName: 'Grok', event }, () => resolve());
    });

    const now = Date.now();
    const events = [
      {
        ts: now,
        type: 'TELEMETRY',
        label: 'ROUND1_START',
        details: 'dispatching prompt',
        level: 'error',
        meta: { ...baseMeta, round: 1 }
      },
      {
        ts: now + 200,
        type: 'PIPELINE',
        label: 'PIPELINE_STEP',
        details: '',
        level: 'error',
        meta: { ...baseMeta, step: 'streaming_start' }
      },
      {
        ts: now + 400,
        type: 'TELEMETRY',
        label: 'ROUND1_END',
        details: 'dispatch complete',
        level: 'error',
        meta: { ...baseMeta, round: 1, durationMs: 400 }
      }
    ];

    for (const evt of events) {
      await send(evt);
    }

    if (typeof window.__telemetryRefreshHook === 'function') {
      window.__telemetryRefreshHook();
    }
  }, { baseMeta });

  await page.waitForTimeout(1500);

  const timelineText = await page.locator('#telemetry-timeline').innerText();
  const roundsText = await page.locator('#telemetry-rounds').innerText();

  console.log('--- Telemetry Timeline ---');
  console.log(timelineText.trim());
  console.log('--- Telemetry Rounds ---');
  console.log(roundsText.trim());

  await context.close();
})();
```
3) Run:
```
node tmp-run-telemetry-check.js
```
Expected:
- Timeline shows `ROUND1_START`, `PIPELINE_STEP`, `ROUND1_END`.
- Rounds shows `Grok` row with R1 done + duration.
Optional CI command:
```
HEADLESS=1 npm run test:telemetry
```
Note:
- The automated test includes Round2 markers (`ROUND2_START/END`) to confirm R2 shows up in Telemetry Rounds.
Optional focus-stuck check:
- Send a `FOCUS_STUCK` event and confirm the round cell turns yellow with a tooltip.

### Option B — manual (DevTools console)
1) Open results page:
```
chrome-extension://<ID>/result_new.html
```
2) Switch to **Telemetry** tab.
3) In DevTools Console:
```js
const runSessionId = Date.now();
const dispatchId = `Grok:${runSessionId}:1`;
const baseMeta = { runSessionId, dispatchId, llmName: 'Grok' };

const send = (event) => new Promise((resolve) => {
  chrome.runtime.sendMessage({ type: 'LLM_DIAGNOSTIC_EVENT', llmName: 'Grok', event }, () => resolve());
});

const now = Date.now();
Promise.resolve()
  .then(() => send({
    ts: now,
    type: 'TELEMETRY',
    label: 'ROUND1_START',
    details: 'dispatching prompt',
    level: 'error',
    meta: { ...baseMeta, round: 1 }
  }))
  .then(() => send({
    ts: now + 200,
    type: 'PIPELINE',
    label: 'PIPELINE_STEP',
    details: '',
    level: 'error',
    meta: { ...baseMeta, step: 'streaming_start' }
  }))
  .then(() => send({
    ts: now + 400,
    type: 'TELEMETRY',
    label: 'ROUND1_END',
    details: 'dispatch complete',
    level: 'error',
    meta: { ...baseMeta, round: 1, durationMs: 400 }
  }))
  .then(() => {
    if (window.__telemetryRefreshHook) window.__telemetryRefreshHook();
  });
```
Expected:
- Timeline shows the three events.
- Rounds shows `Grok` row with R1 done.

## Update v2.72.00 - 2026-01-31 22:04 UTC
Purpose: stabilize telemetry schema and add detector/selector signal tracing.
- Telemetry normalization now enforces `runSessionId`/`dispatchId` and stamps `schemaVersion=2`, so every event has consistent correlation keys. (File: `background/telemetry-logs.js`)
- Pipeline steps emit `PIPELINE_STEP` with `meta.step`, and `STATE_CHANGE` captures FSM transitions (INIT→DISPATCHING→GENERATING→FINALIZING→COLLECTING→DONE/ERROR). (File: `content-scripts/unified-answer-pipeline.js`)
- Completion detector now emits `DETECTOR_TICK` and `DETECT_DONE` with signals, stability, focus/hidden, and score metadata. (File: `content-scripts/unified-answer-watcher.js`)
- Selector diagnostics are aggregated into `SELECTOR_STATS` with hit/miss ratios and selector pack version. (File: `content-scripts/unified-answer-watcher.js`)
- Structured telemetry errors added for `PORT_CLOSED`, `HANDSHAKE_TIMEOUT`, and `RECOVERY_ACTION`. (File: `background/dispatch-coordinator.js`)
- `MODEL_MISSING` now carries an integrity snapshot for faster RCA. (File: `background/job-orchestrator.js`)
- Telemetry Summary groups by `dispatchId` and understands `PIPELINE_STEP`. (File: `results-devtools.js`)

## Update v2.72.01 - 2026-01-31 22:40 UTC
Purpose: harden canonical telemetry output and verify Round2 visibility.
- `PIPELINE_COMPLETE` is deduplicated per `runSessionId|dispatchId|llmName`. (File: `background/telemetry-logs.js`)
- `ROUND*_START/END` now always includes `dispatchId` in meta. (File: `background/job-orchestrator.js`)
- Telemetry DevTools test now includes Round2 markers in Timeline/Rounds checks. (File: `tests/telemetry-devtools-check.js`)

## Update v2.72.02 - 2026-01-31 22:53 UTC
Purpose: add visibility, tab-level, performance, and interaction telemetry.
- `DISPATCH_*` and `PIPELINE_*` include `visibilityState/hasFocus` metadata. (Files: `background/dispatch-coordinator.js`, `content-scripts/unified-answer-pipeline.js`)
- `TAB_READY_*`, `TAB_VISIT`, and `HANDSHAKE_TIMEOUT` include `discarded/windowId/lastAccessedAgeMs`. (Files: `background/tab-manager.js`, `background/human-presence.js`, `background/dispatch-coordinator.js`)
- `AUDIO_CONTEXT_OK/FAIL` logs keep-alive status for TabProtector. (Files: `content-scripts/pipeline-modules.js`, `content-scripts/unified-answer-pipeline.js`)
- `DETECTOR_TICK/DETECT_DONE` now include `responseTextLength`, `growthRate`, `timeToFirstToken`, `timeToStopVisible`, `timeToRegenerateVisible`. (File: `content-scripts/unified-answer-watcher.js`)
- User markers: `USER_FOCUS_CHANGE`, `HUMAN_VISIT_START/END`, `MANUAL_PING_SUCCESS/FAIL`. (Files: `background/human-presence.js`, `background/message-router.js`)
- `RUN_SUMMARY` emits session totals (duration, success %, stalled, avg round times, error distribution). (File: `background/job-orchestrator.js`)

## Update v2.72.03 - 2026-01-31 23:07 UTC
Purpose: highlight focus-stuck events in Telemetry Rounds.
- `FOCUS_STUCK` emitted when a model tab keeps focus for >30s without switching to results/other models. (File: `background/human-presence.js`)
- Telemetry Rounds highlights the round cell in yellow, shows time in the cell, and exposes a timeout tooltip. (File: `results-devtools.js`)

## Update v2.72.35 - 2026-02-12 22:25 CET
Purpose: close two telemetry gaps that hid real completion and long-lived same-tab focus states.
- Same-tab `source` transitions now rearm or clear hard-cap deterministically, so `human_visit/automation_focus` cannot silently bypass `HUMAN_VISIT_HARD_CAP` after ownership switch. (File: `background/human-presence.js`)
- Markdown export now maps `MODEL_FINAL/FINAL_STATUS` to `R4 END` (and `ROUND0_TAB_OPENED` to `R0 END`), aligning `All Logs` round matrix with actual terminal events. (File: `results.js`)
- Version pinned to `2.72.35` for this behavior set. (File: `manifest.json`)

## Update v2.72.64 - 2026-02-13 14:03 CET
Purpose: stop geometry regressions during tab focus and reduce false dispatch loops on GPT/Gemini.
- Tab activation no longer forces window state to `normal`; only window focus and tab activation are applied, preserving current browser geometry. (File: `background/tab-manager.js`)
- Round1 now emits explicit skip reasons (`tab_not_found`, `tab_not_ready`) and performs a retry tab-resolution path before skipping, so Gemini-like misses are visible and recoverable. (File: `background/job-orchestrator.js`)
- Pre-dispatch health ping no longer triggers eager reload in Round1/first attempts; reload is limited to retry-supervisor attempts, reducing channel churn (`message port/channel closed`). (File: `background/dispatch-coordinator.js`)
- Gemini now throws `send_failed` when send is not confirmed and does not emit `PROMPT_SUBMITTED` on unconfirmed send. (File: `content-scripts/content-gemini.js`)
- ChatGPT now reuses an already prepared composer prompt for duplicate dispatches within a short window instead of rewriting the text, reducing delete/reinsert loops on retries. (File: `content-scripts/content-chatgpt.js`)
- Version pinned to `2.72.64`. (File: `manifest.json`)

## Update v2.72.65 - 2026-02-13 14:14 CET
Purpose: prevent silent Round1 misses for Claude/Gemini and auto-recover from `ROUND2 not_confirmed`.
- Round0 now waits for per-model tab binding readiness after `deferDispatch` startup, instead of assuming tab creation is complete immediately. Timeout path emits `ROUND0_BIND_WAIT_TIMEOUT`. (File: `background/job-orchestrator.js`)
- Round1 integrity guard now runs before dispatch (`ensureRoundEntries(..., pre_round1)`), and missing model entries are repaired before per-model dispatch. (File: `background/job-orchestrator.js`)
- Round2 adds model-scoped repair dispatch for `Claude` and `Gemini`: when prompt confirmation is still missing after verify visits, dispatcher state is reset and a focused resend is attempted with telemetry (`ROUND2_REPAIR_DISPATCH_START/OK/FAIL/ERROR`). (File: `background/job-orchestrator.js`)
- Version pinned to `2.72.65`. (File: `manifest.json`)

## Update v2.72.66 - 2026-02-14 18:52 CET
Purpose: eliminate duplicate prompt insertion in Claude on retry cycles when send is not confirmed.
- Claude prompt-prepared dedupe is now keyed by prompt fingerprint (instead of session-scoped fingerprint), so retries in a new dispatch/session do not reinsert the same text. (File: `content-scripts/content-claude.js`)
- Claude now skips typing/paste whenever composer already contains the expected prompt head, then proceeds directly to send confirmation path. (File: `content-scripts/content-claude.js`)
- Version pinned to `2.72.66`. (File: `manifest.json`)

## Update v2.72.67 - 2026-02-14 19:07 CET
Purpose: stop aggressive Claude tab reload loops caused by passive `getResponses` recovery.
- Passive transport recovery (`reinject/reload`) is now disabled by default for background `getResponses` probes, so automatic collection ticks do not reload model tabs on every channel error. (File: `background/dispatch-coordinator.js`)
- Manual ping keeps explicit recovery enabled, preserving on-demand repair behavior when user triggers it intentionally. (File: `background/job-orchestrator.js`)
- Version pinned to `2.72.67`. (File: `manifest.json`)

## Update v2.72.68 - 2026-02-14 23:30 CET
Purpose: scope telemetry export/UI to the latest run and remove stale-round artifacts.
- `All Logs` markdown export now scopes telemetry to the current run session and trims to the latest run cycle (`latest ROUND0_START`), then applies the same scope to diagnostics logs. (File: `results.js`)
- Telemetry round aggregation now normalizes `ROUND*_COMPLETE` as round end and infers missing `R0..R3` end markers when `R4` is already complete, eliminating false `running` cells after finalization. (Files: `results.js`, `results-devtools.js`)
- DevTools Telemetry now renders timeline/rounds on the current run scope instead of the full cache, reducing stale mixed-session rows. (File: `results-devtools.js`)
- Manual ping transport errors for models already in terminal state are logged as warning (`Manual ping skipped (terminal)`) instead of hard error, reducing false red noise. (File: `background/job-orchestrator.js`)
- Version pinned to `2.72.68`. (File: `manifest.json`)

## Update v2.72.69 - 2026-02-14 23:55 CET
Purpose: hide pre-run telemetry noise and keep exports strictly scoped to active execution.
- `All Logs` now returns an empty telemetry/diagnostics section when no active run is detected (`no ROUND0_START` and no `runSessionId`), instead of exporting unscoped startup events like `SCRIPT_LOADED`. (File: `results.js`)
- Run scoping now falls back to the latest `ROUND0_START` cycle only when session ids are unavailable, and diagnostics are filtered by the same bounded time window. (File: `results.js`)
- DevTools telemetry bridge/export/copy now always uses scoped events only; it no longer falls back to full cache when scoped list is empty. (File: `results-devtools.js`)
- Version pinned to `2.72.69`. (File: `manifest.json`)

## Update v2.72.70 - 2026-02-15 00:14 CET
Purpose: fix false `cycle fallback` when a valid run id is present.
- Fixed run-scope resolver guard: `runSessionId = null` is no longer coerced to `0`, so current run id is correctly auto-detected from telemetry events. (File: `results.js`)
- Applied the same fix in DevTools run-scope filter to keep timeline/rounds/export aligned with the active run. (File: `results-devtools.js`)
- Version pinned to `2.72.70`. (File: `manifest.json`)

## Update v2.72.71 - 2026-02-15 09:06 CET
Purpose: prevent long Round2 stalls from blocking Round3/Round4 and reduce false model-missing alarms.
- Added a hard batch budget for Round2 verification (`ROUND2_BATCH_MAX_MS=45000`). When budget is exhausted, remaining models are force-marked with `ROUND2_SKIP batch_timeout`, and collection probes are scheduled for confirmed prompts so the run advances autonomously to later rounds. (File: `background/job-orchestrator.js`)
- Added `ROUND2_CUTOFF` telemetry to make forced cutover explicit in logs when Round2 exceeds batch budget. (File: `background/job-orchestrator.js`)
- Hardened post-round integrity check: it now verifies active session, restores missing entries via `ensureRoundEntries`, and only then evaluates `MODEL_MISSING`, reducing false positives after manual tab activity. (File: `background/job-orchestrator.js`)
- Version pinned to `2.72.71`. (File: `manifest.json`)

## Update v2.72.72 - 2026-02-15 09:16 CET
Purpose: enforce deterministic reveal scroll before response collection to reduce yellow-state lag.
- Added `runPreCollectScrollNudge` in orchestrator: focused tab performs `up-half -> down-bottom` scroll nudge before collection probes, with telemetry (`PRECOLLECT_NUDGE`, `PRECOLLECT_NUDGE_SKIP`, `PRECOLLECT_NUDGE_ERROR`). (File: `background/job-orchestrator.js`)
- Round2 now runs this pre-collect nudge before `round2_probe` in confirmed/auto-cutoff paths, so prompt-confirmed models get a reveal pass before `getResponses`. (File: `background/job-orchestrator.js`)
- Round3 now runs the same nudge before `round3_collect` ping for incomplete models. (File: `background/job-orchestrator.js`)
- Manual ping now runs the same nudge before `getResponses` for non-terminal models. (File: `background/job-orchestrator.js`)
- Version pinned to `2.72.72`. (File: `manifest.json`)

## Update v2.72.73 - 2026-02-15 10:20 CET
Purpose: eliminate yellow stalls for Claude/Grok when answer is already visible but collection ping does not finalize model status.
- `getResponses` ping meta now includes active run scope (`runSessionId/sessionId/dispatchId`) and `forceEmitOnUnchanged`, so ping extraction remains tied to current dispatch and can re-emit stable answers when needed. (File: `background/job-orchestrator.js`)
- Claude content script now implements `action: getResponses` with non-destructive DOM extraction (`withSmartScroll` + stability check + completion signal) and emits `LLM_RESPONSE`/`MANUAL_PING_RESULT` instead of dropping ping requests. (File: `content-scripts/content-claude.js`)
- Grok and Qwen ping extraction now re-emit non-empty answers on `unchanged` when background requests forced emission, preventing false yellow states where answer exists but was ignored as cache-equal. (Files: `content-scripts/content-grok.js`, `content-scripts/content-qwen.js`)
- Version pinned to `2.72.73`. (File: `manifest.json`)

## Update v2.72.74 - 2026-02-15 21:51 CET
Purpose: enforce a hard script-stop limit to prevent endless content-script activity and focus lock loops.
- Added a per-model hard-stop guard `SCRIPT_RUNTIME_HARD_STOP_MS = 180000` in dispatch coordinator. On timeout, background emits `SCRIPT_RUNTIME_HARD_STOP`, sends `HUMANOID_FORCE_STOP` + `STOP_AND_CLEANUP` to the model tab, and finalizes with `script_runtime_hard_stop`. (File: `background/dispatch-coordinator.js`)
- Guard lifecycle is now explicit: timer starts on first `GET_ANSWER` dispatch attempt, is cleared on final model response, and all active guards are cleared during global stop/reset. (Files: `background/dispatch-coordinator.js`, `background/job-orchestrator.js`)
- Version pinned to `2.72.74`. (File: `manifest.json`)

## Update v2.72.75 - 2026-02-15 23:31 CET
Purpose: stop false ERROR finalization after real success and reduce hard-stop/terminal ping telemetry noise.
- Hard-stop timer is now armed from confirmed submit state (`PROMPT_SUBMITTED` / confirmed dispatch), so `180000ms` is counted from real generation start, not from first speculative `GET_ANSWER` call. (Files: `background/dispatch-coordinator.js`, `background/message-router.js`)
- `SCRIPT_RUNTIME_HARD_STOP` logging is now single-source via telemetry emit (removed duplicate pipeline append path), reducing duplicate hard-stop rows in timeline/export. (File: `background/dispatch-coordinator.js`)
- Added terminal monotonic guard: once model is finalized with success terminal status, later failure payloads for the same dispatch are ignored (`Response ignored (terminal success locked)`), preventing `SUCCESS -> ERROR` downgrade races. (File: `background/job-orchestrator.js`)
- Manual ping now short-circuits terminal models before transport send, avoiding avoidable `COMMAND_SEND_ERROR` noise after completion. (File: `background/job-orchestrator.js`)
- Version pinned to `2.72.75`. (File: `manifest.json`)

## Update v2.72.76 - 2026-02-16 01:56 CET
Purpose: stabilize round orchestration by separating run state from tab cleanup events and gating Round4 by real model completion.
- `SPA_NAVIGATION` no longer performs hard cleanup of model runtime state; it now marks tab readiness stale, stores navigation metadata, and emits scoped telemetry. This prevents active run entries from being deleted on normal SPA URL transitions. (File: `background/message-router.js`)
- Cleanup manager now preserves active run model entries (`jobState.llms`) for selected session models; on tab cleanup it resets transient tab/dispatch fields instead of deleting model state. This removes the `ROUND_STATE_REPAIR` collapse pattern caused by mid-run entry deletion. (File: `background/cleanup-manager.js`)
- Added explicit Round4 completion gate: orchestrator now waits for non-terminal models before focusing results tab, force-finalizes stalled `no_send` models after grace period, and applies a bounded gate timeout with deterministic terminalization. (File: `background/job-orchestrator.js`)
- Added canonical model-entry factory (`buildInitialLlmEntry`) and reused it in start/repair flows to avoid partial recovery records that break later rounds and human-visit logic. (File: `background/job-orchestrator.js`)
- Human-presence scheduler now avoids focusing results while rounds are in progress and tracks pending state from session-selected models, reducing false returns to the extension page during active run orchestration. (File: `background/human-presence.js`)
- Version pinned to `2.72.76`. (File: `manifest.json`)

## Update v2.72.15 - 2026-02-02 10:03 UTC
Purpose: stabilize round visibility and stop focus loops on completed models.
- Round3 now emits skip markers for already-completed models, so the matrix shows completion instead of empty cells. (File: `background/job-orchestrator.js`)
- Missing model entries are restored before Round2 to keep R2/R4 markers from dropping for models that completed early. (File: `background/job-orchestrator.js`)
- Human visit loop ignores models with final status markers even if their status string is stale, preventing unnecessary focus bouncing. (File: `background/human-presence.js`)

## Update v2.72.18 - 2026-02-02 16:14 UTC
Purpose: reduce post-R2 stalls and prevent premature Claude hard-timeout finalization.
- After `ROUND2_END`, models without `MODEL_FINAL` schedule a short auto-collect visit + `getResponses` to capture late answers. (File: `background/job-orchestrator.js`)
- Round3 skip markers are emitted only when `MODEL_FINAL` is recorded, avoiding false skips on in-progress models. (File: `background/job-orchestrator.js`)
- Claude hard-timeout now triggers a retry extraction window and is marked as degraded before final ERROR. (File: `background/job-orchestrator.js`)
- Streaming hard-timeout budget is extended for Claude during generation. (File: `content-scripts/unified-answer-pipeline.js`)

## Update v2.72.19 - 2026-02-03 18:23 UTC
Purpose: keep focus scoped to the current run while allowing safe fallback.
- Current run tracks `boundTabIds` and uses them as the primary scope when resolving/attaching tabs. (Files: `background/job-orchestrator.js`, `background/tab-manager.js`)
- When run scope is empty, resolvers fall back to eligible tabs with a `RUN_SCOPE_FALLBACK` telemetry marker for auditability. (File: `background/tab-manager.js`)
- Attach telemetry records whether a tab came from the bound scope or from fallback. (File: `background/tab-manager.js`)

## Update v2.72.30 - 2026-02-04 20:21 UTC
Purpose: wipe cached telemetry on startup to keep timeline fresh.
- `CLEAR_DIAG_EVENTS` is invoked on `chrome.runtime.onStartup`/`onInstalled`, resetting `__diagnostics_events__` so Telemetry Timeline no longer replays old runs after an extension reload. (File: `background/message-router.js`)

## Update v2.72.34 - 2026-02-12 20:26 CET
Purpose: prevent focus hangs and preserve round/final visibility under heavy telemetry noise.
- Human visit flow now has a hard-cap timeout (`HUMAN_VISIT_HARD_CAP`) that force-ends stuck visits after 12s and releases focus ownership. (File: `background/human-presence.js`)
- Passive `getResponses` channel now attempts recovery (reinject/reload + ready-check) on `message port closed` / dead receiver before failing, with `PASSIVE_SEND_RECOVERY_ATTEMPT/RESULT` telemetry. (File: `background/dispatch-coordinator.js`)
- Telemetry DevTools cache trimming is now pin-aware: `ROUND*`, `MODEL_FINAL`, `FINAL_STATUS`, `FOCUS_STUCK`, and critical submit markers are retained when the 400-event UI cap is reached. (File: `results-devtools.js`)
- Telemetry Rounds treats `MODEL_FINAL/FINAL_STATUS` as `R4 END`, so results completion is shown even when explicit `ROUND4_END` was not emitted. (File: `results-devtools.js`)

## Update v2.72.33 - 2026-02-12 18:16 CET
Purpose: reduce yellow-state lag and stabilize Round2 visibility.
- Added per-model adaptive response probing started from `promptSubmittedAt` (not from global run start): fast -> medium -> slow intervals with an automatic stop window. (File: `background/job-orchestrator.js`)
- `PROMPT_SUBMITTED` now triggers adaptive probing immediately for the confirmed model, so delayed finalization can be captured without manual tab visits. (File: `background/message-router.js`)
- Round2 now always emits `ROUND2_START` and `ROUND2_END` for every selected model, including skip paths (`api_dispatch`, `already_confirmed`, `tab_not_found`, `not_confirmed`). (File: `background/job-orchestrator.js`)
- Adaptive probe timers are cleared on final model status and global stop to avoid stale background polling. (File: `background/job-orchestrator.js`)

## Update v2.72.31 - 2026-02-12 14:03 UTC
Purpose: reduce lag between visual answer completion and `MODEL_FINAL`.
- Round2 and Round3 now trigger immediate response probes (`getResponses`) right after forced visits, so finalized answers are collected without waiting for later rounds or manual actions. (File: `background/job-orchestrator.js`)
- Human visit simulation adds a completion nudge scroll pattern (up ~half-screen, then down to bottom) that mirrors effective manual behavior and helps completion signals settle faster. (File: `background/human-presence.js`)

## Update v2.72.16 - 2026-02-02 11:29 UTC
Purpose: mark R0 as complete when a tab is opened.
- `ROUND0_TAB_OPENED` now resolves as the R0 completion marker for the model row. (File: `results-devtools.js`)

## Update v2.72.17 - 2026-02-02 15:03 UTC
Purpose: remove the unstable paired All Logs export.
- Removed the "All ±" paired export button and its handler. (Files: `result_new.html`, `results.js`)

## Update v2.72.14 - 2026-02-02 09:19 UTC
Purpose: hide startup telemetry noise until a model is selected or a filter is applied.
- Telemetry Timeline stays empty unless a model is selected or filters are set, preventing early SCRIPT_LOADED entries. (File: `results-devtools.js`)

## Update v2.72.12 - 2026-02-02 08:44 UTC
Purpose: enforce short verification visits for autonomy and make pre-collect focus deterministic.
- Round2 now performs 1–2 forced automation visits (5–8s) with light scroll to confirm prompt submission without manual focus. (Files: `background/job-orchestrator.js`, `background/human-presence.js`)
- Round3 pre-collect now runs a short forced visit before collection, replacing the no-op when human-presence is inactive. (File: `background/job-orchestrator.js`)
- Automation visits accept custom dwell/scroll timing and emit a distinct visit reason for traceability. (File: `background/human-presence.js`)

## Update v2.72.11 - 2026-02-02 07:07 UTC
Purpose: prevent duplicated session summaries and repeated finalization counters.
- Model finalization now records a one-time final status marker and skips `responsesCollected`/`completed` increments on repeated responses, avoiding multiple `RUN_SUMMARY` emissions after manual pings. (File: `background/job-orchestrator.js`)

## Update v2.72.09 - 2026-02-01 21:37 UTC
Purpose: restore service worker startup after telemetry buffer changes.
- Fixed duplicate global identifiers in the background scripts by namespacing diagnostics buffer helpers, preventing `Identifier 'PINNED_LABELS' has already been declared` during worker boot. (File: `background/message-router.js`)

## Update v2.72.08 - 2026-02-01 12:13 UTC
Purpose: preserve Round markers in exports even after heavy manual intervention.
- All Logs export now prefers the unfiltered telemetry cache and merges it with runtime diagnostics, so R1/R2/R3 markers are not lost when UI filters are active. (File: `results.js`)
- Diagnostics storage trimming now preserves `ROUND*` and final-status markers by evicting unpinned entries first, and `GET_DIAG_EVENTS` uses the same pinned-aware trimming. (Files: `background/telemetry-logs.js`, `background/message-router.js`)

## Update v2.72.06 - 2026-02-01 09:19 UTC
Purpose: recover send attempts when the content channel is dead.
- Send now attempts a reinject/reload recovery on `message port closed` / `receiving end does not exist`, retries once, and emits `SEND_RECOVERY_ATTEMPT` / `SEND_RECOVERY_RESULT` plus `SEND_SKIPPED` on failure. (File: `background/dispatch-coordinator.js`)

## Update v2.72.07 - 2026-02-01 12:13 UTC
Purpose: add canonical final, budgets, foreground leasing, and detector diagnostics.
- `MODEL_FINAL` captures the canonical final status, done reason, duration, answer length, provider, focus switches, and foreground time. (File: `background/job-orchestrator.js`)
- Phase budgets emit `BUDGET_EXHAUSTED` for dispatch/generation/collect timeouts. (Files: `background/job-orchestrator.js`, `background/dispatch-coordinator.js`)
- Foreground leases emit `LEASE_GRANTED/LEASE_RELEASED` with duration and accumulated foreground time. (File: `background/human-presence.js`)
- `DETECT_DONE` now carries `stableChecksUsed` and `lastChangeMsAgo`. (File: `content-scripts/unified-answer-watcher.js`)

## Update v2.72.05 - 2026-02-01 09:20 UTC
Purpose: standardize command-send errors and preserve reasons.
- `COMMAND_SEND_ERROR` replaces the old label and stores `meta.reason` for reliable RCA. (Files: `background/dispatch-coordinator.js`, `background/job-orchestrator.js`)

## Update v2.72.04 - 2026-01-31 23:29 UTC
Purpose: export full telemetry with rounds table and surface All Logs in Telemetry.
- All Logs export now includes a Telemetry Rounds table in the Markdown output. (File: `results.js`)
- Telemetry toolbar includes a short All Logs button (no `.md`). (File: `result_new.html`)

## Update v2.71.99 - 2026-01-31 02:00 UTC
Purpose: trim noisy telemetry by deduplicating tab-visits, condensing Round0, and aggregating selector misses.
- `TAB_VISIT` is now carried only via diagnostics logs instead of both diagnostics and telemetry, eliminating the duplicate rows that previously appeared in the timeline. (File: `background/human-presence.js`)
- Round0 now emits only per-model `ROUND0_TAB_OPENED` markers plus a single `ROUND0_COMPLETE` summary, so the opening phase adds at most two rows per model instead of four. (File: `background/job-orchestrator.js`)
- Selector miss diagnostics are grouped every ~5 seconds and emitted as aggregated events (`SELECTOR_MISS` with `aggregated=true` and a count/duration), dramatically reducing the spam that used to appear when selectors missed while a tab ran in the background. (File: `content-scripts/unified-answer-watcher.js`)
- DevTools now keeps the Telemetry Timeline empty until you either select a model or apply a filter, preventing the initial `SCRIPT_LOADED` noise from showing up as a Grok event. (File: `results-devtools.js`)

## Update v2.71.77 - 2026-01-30 21:20 UTC
Purpose: backfill Telemetry Rounds from diagnostics when telemetry storage misses per-model round events.
- Telemetry refresh now injects `ROUND*`/`TAB_VISIT` entries from the in-page diagnostics cache via `window.__getDiagnosticLogs`, so the Rounds matrix can render per-model progress even if sampling drops the telemetry events. (Files: `results.js`, `results-devtools.js`)

## Update v2.71.69 - 2026-01-30 20:05 UTC
Purpose: make the diagnostics 🗑️ control actually drops persisted logs.
- The diagnostics clear button now empties the local `llmLogs` cache before posting `CLEAR_DIAG_EVENTS`, so clicking it removes both the UI rows and the storage-held `__diagnostics_events__`. (File: `results.js`)

## Update v2.71.68 - 2026-01-30 19:15 UTC
Purpose: ensure the telemetry toolbar buttons keep firing even when the DOM around them changes.
- Telemetry action clicks now walk up the event path and match the button selector before dispatching the refresh/reset/copy/export handlers, so emojis or rewrites inside the button still trigger the DevTools actions. (File: `results-devtools.js`)

## Update v2.71.76 - 2026-01-30 20:55 UTC
Purpose: keep Telemetry Rounds from losing diagnostics-derived round events on refresh.
- Telemetry refresh now merges new storage events into the live cache instead of replacing it, preserving round markers added from diagnostics streams. (File: `results-devtools.js`)

## Update v2.71.75 - 2026-01-30 20:40 UTC
Purpose: fill round cells even when only global ROUNDS events exist.
- Telemetry Rounds now merges global `ROUNDS` start/end events into per-model rows when per-model markers are missing. (File: `results-devtools.js`)

## Update v2.71.74 - 2026-01-30 20:20 UTC
Purpose: make Telemetry Rounds resilient to label formatting differences.
- Round detection now uses `meta.round` when available and normalizes labels before parsing, so round cells populate even if separators differ. (File: `results-devtools.js`)

## Update v2.71.73 - 2026-01-30 20:00 UTC
Purpose: prevent double execution of telemetry refresh/reset.
- Removed page-level delegated click handler; refresh/reset are now handled solely inside `results-devtools.js`. (Files: `results.js`, `results-devtools.js`)

## Update v2.71.72 - 2026-01-30 19:45 UTC
Purpose: surface refresh failures in UI and harden refresh/reset flow.
- Telemetry refresh now reports runtime errors/status in the toolbar; fallback hooks remain to guarantee handler execution. (File: `results-devtools.js`)

## Update v2.71.71 - 2026-01-30 19:25 UTC
Purpose: make telemetry refresh/reset callable even if UI handlers miss the click.
- Telemetry script now exposes global hooks (`__telemetryRefreshHook`, `__telemetryResetHook`), and the page-level capture handler invokes them with a retry. (Files: `results.js`, `results-devtools.js`)

## Update v2.71.70 - 2026-01-30 19:05 UTC
Purpose: ensure telemetry refresh/reset works even if button handlers were missed.
- Telemetry toolbar clicks now re-inject the telemetry script and dispatch explicit refresh/reset events as a fallback. (Files: `results.js`, `results-devtools.js`)

## Update v2.71.67 - 2026-01-30 18:35 UTC
Purpose: guarantee telemetry DevTools logic loads even if initial script injection fails.
- Results now re-injects `results-devtools.js` if telemetry boot flag is missing, and the telemetry script guards against double init. (Files: `results.js`, `results-devtools.js`)

## Update v2.71.66 - 2026-01-30 18:20 UTC
Purpose: ensure Telemetry toolbar actions fire even if the buttons are injected after script load.
- Telemetry action buttons now have a capture-phase delegated click handler, so refresh/reset/copy/export work reliably. (File: `results-devtools.js`)

## Update v2.71.65 - 2026-01-30 18:05 UTC
Purpose: ensure Telemetry Rounds updates even when filters return zero timeline events.
- Telemetry Rounds now renders from the full telemetry cache before timeline filtering, so it stays current even if the timeline is empty. (File: `results-devtools.js`)

## Update v2.71.64 - 2026-01-30 17:50 UTC
Purpose: keep Telemetry Rounds in sync with live diagnostic events instead of relying only on refresh polling.
- Live `LLM_DIAGNOSTIC_EVENT` messages now broadcast `telemetry-event` updates to the DevTools telemetry view, which merges and de-duplicates incoming events before rendering. (Files: `results.js`, `results-devtools.js`)

## Update v2.71.63 - 2026-01-30 17:30 UTC
Purpose: ensure Telemetry Rounds refreshes when the devtools tab is activated programmatically.
- Devtools tab changes now dispatch a `devtools-tab-change` event so Telemetry can start/stop auto-refresh reliably. (Files: `results.js`, `results-devtools.js`)

## Update v2.71.62 - 2026-01-30 17:20 UTC
Purpose: ensure Telemetry Rounds recognizes round events even when labels are stored in meta.
- Telemetry Rounds now resolves round labels from `label`, `meta.event`, or `event`, so entries still render when the label is stored only in metadata. (File: `results-devtools.js`)

## Update v2.71.61 - 2026-01-30 16:55 UTC
Purpose: ensure per-model round telemetry is never sampled out.
- Per-model `ROUND#_*` events are now forced through telemetry sampling so Telemetry Rounds always fills per model even when sampling is off. (File: `background/job-orchestrator.js`)

## Update v2.71.60 - 2026-01-30 16:40 UTC
Purpose: make the Telemetry Timeline entirely neutral.
- The timeline no longer adds `is-flagged` decorations for ROUND2_VERIFY/TAB_VISIT; entries rely only on their level for coloring. (File: `results-devtools.js`)
- The `telemetry-row.is-flagged` style was removed because the DOM no longer emits that class. (File: `styles.css`)

## Update v2.71.59 - 2026-01-30 16:10 UTC
Purpose: bring Telemetry Rounds to the top and shorten the column headers to R0‑R4.
- Telemetry Rounds is now the first card so the matrix is immediately visible, with the Timeline and Summary stacked beneath it. (Files: `result_new.html`, `results-devtools.js`)
- Column labels were shortened from “Round0…Round4” to “R0…R4” while keeping the rounded metadata intact. (File: `results-devtools.js`)

## Update v2.71.58 - 2026-01-30 15:55 UTC
Purpose: present Telemetry Rounds as a per-model matrix with colored round statuses.
- Each row now represents a model; columns cover Round0–Round4 with time stamps, durations, and visit notes sourced from the new per-model telemetry events. (Files: `results-devtools.js`, `styles.css`)
- Per-model `ROUND#_*` events and forced `TAB_VISIT` telemetry are emitted by the background so the matrix always has fresh data even when sampling would normally drop it. (Files: `background/job-orchestrator.js`, `background/human-presence.js`)

## Update v2.71.57 - 2026-01-30 15:35 UTC
Purpose: improve Telemetry Rounds and Summary readability.
- Telemetry Rounds now shows the model name as the first column. (Files: `results-devtools.js`, `styles.css`)
- Telemetry Summary columns are reordered to show model before time. (Files: `results-devtools.js`, `styles.css`)

## Update v2.71.56 - 2026-01-30 15:20 UTC
Purpose: guarantee round/visit telemetry is always recorded and visible.
- Round start/end events are now forced through telemetry sampling so `ROUND*_START/END` never vanish from Telemetry Rounds. (File: `background/job-orchestrator.js`)
- `TAB_VISIT` telemetry is forced through sampling for full alignment with Diagnostics. (File: `background/human-presence.js`)
- Telemetry Rounds uses the full telemetry cache (not filtered by selected model), and JSON exports always include round/visit events. (File: `results-devtools.js`)

## Update v2.71.55 - 2026-01-30 15:00 UTC
Purpose: ensure Telemetry Summary/Rounds populate even when no LLM is manually selected.
- Telemetry filtering now defaults to showing all events instead of showing nothing when no LLM is selected. (File: `results-devtools.js`)
- Platform/type filters now populate from actual telemetry events when no selection is active, so the summary/rounds list can render immediately. (File: `results-devtools.js`)

## Update v2.71.54 - 2026-01-30 14:45 UTC
Purpose: let the expanded Telemetry Summary and Telemetry Rounds blocks open reliably from the DevTools panel.
- headers under `Telemetry Summary` and `Telemetry Rounds` now respond to a single click or keyboard activation (Enter/Space) in addition to double-click, so these cards open/close immediately without getting stuck collapsed. (File: `results-devtools.js`)
- the cards’ toggle controls now keep their expanded/collapsed aria state in sync with the header tooltip text. (File: `results-devtools.js`)

## Update v2.71.53 - 2026-01-30 14:30 UTC
Purpose: restore Perplexity’s early readiness signal so ACK_READY resolves before prompt dispatch.
- `SCRIPT_READY_EARLY` from the Perplexity content script now triggers in telemetry, showing the earliest moment the platform’s composer is ready and preventing the background from giving up on message channels that are still booting.
- `PERPLEXITY_ACK_BYPASS` remains documented under v2.71.52; the new signal complements it by confirming the tab really reached the composer before we skip the full ACK wait.

## Update v2.71.52 - 2026-01-30 13:45 UTC
Purpose: allow Perplexity dispatch to proceed even when ACK_READY is not emitted.
- `PERPLEXITY_ACK_BYPASS` records when ACK_READY wait is skipped so GET_ANSWER can proceed.

## Update v2.71.50 - 2026-01-30 13:00 UTC
Purpose: surface Round2 verification and tab visit timing in telemetry.
- `ROUND2_VERIFY` events now appear in telemetry with `prompt not confirmed` details, matching diagnostics’ round2 warnings.
- Every `TAB_VISIT` written to diagnostics also emits telemetry for the source/duration, so round monitoring sees the same “human visit” footprint.
- The DevTools telemetry timeline highlights these `ROUND2_VERIFY`/`TAB_VISIT` rows for quick review, and the Markdown export includes a “Note: Round2 verification events...” reminder at the top.
- Previous entries remain documented under v2.71.49/v2.71.48 for continuity.

## Update v2.71.49 - 2026-01-30 08:00 UTC
Purpose: align diagnostics + telemetry with the final response status and accelerate Perplexity recovery.
- `FINAL_STATUS` diagnostic entry (type: `FINAL_STATUS`) is emitted together with the `RESPONSE` telemetry so both tabs share the same success/failure signal.  
- `PERPLEXITY_ACK_RETRY` marks when ACK_READY recovery triggers an immediate retry for Perplexity so we can spot aggressive fallbacks.
- `ACK_READY_RECOVERY_OK` and `ROUND2_RETRY_OK` remain documented under v2.71.48 for continuity.
Purpose: surface ROUND telemetry in DevTools and make the exported logs Markdown-friendly.
- The DevTools Telemetry tab now renders three cards: summary, a dedicated **Telemetry Rounds** list (shows `ROUND#_*` start/end markers sorted newest-first), and the timeline. Rounds are enumerated by the background helper `emitRoundEvent()` so their timestamps/labels are always consistent with the orchestration flow.
- “All Logs” exports switched from HTML to Markdown with telemetry first (table with Time/Platform/Event/Level/Details) followed by diagnostics sections. The markdown includes version/export metadata and ensures the first rows remain the freshest telemétrie entries for easy comparison.

## Update v2.54.24 - 2025-12-22 23:14 UTC
Purpose: unify pipeline telemetry routing and reduce volume with 5% session sampling.
- `PIPELINE_EVENT` is now a first-class IPC channel routed into diagnostics storage.
- Background applies per-session telemetry sampling (`TELEMETRY_SAMPLE_RATE=0.05`), with errors bypassing sampling.
- `STOP_DISAPPEARED` is emitted when the stop button vanishes during streaming.
- Verbose criteria logs: `LLMExtension.flags.verboseAnswerWatcher = true` or `localStorage.__verbose_answer_watcher = 'true'`.

## Update v2.54.8 - 2025-12-21 06:59 UTC
Purpose: surface telemetry meta in diagnostics UI and add content-pipeline events for full traceability.
- Diagnostics UI now renders `meta` JSON for each entry so timing/snapshot data is visible.
- UnifiedAnswerPipeline emits `PIPELINE_*` events (start/prep/stream/finalize/complete/error).
- Dispatch adds `PROMPT_SUBMITTED_TIMEOUT` to capture no-confirmation cases.
- Background emits `RUN_END` per model on first response to capture final status.
- Per-model overrides provide `llmName` to pipeline so events attach to correct model logs.

## Update v2.54.7 - 2025-12-21 06:40 UTC
Purpose: define the telemetry schema needed to analyze tab lifecycle and dispatch flow.

## Base schema (v2.72.00)
Purpose: standard fields for correlating events across tabs, queue, and responses.
- `ts` - event timestamp (ms).
- `extVersion` - extension version.
- `runSessionId` - run/session id (jobState.session.startTime).
- `dispatchId` - dispatch id per model (llmName:session:attempt).
- `llmName` - model name.
- `tabId` - tab id.
- `event` / `label` - telemetry event name.
- `details`/`level` - human-readable details and severity.
- `meta` - extra fields (snapshot, timing, reason, selectorPackVersion, detector snapshot).

## Event catalog (v2.72.00)
Purpose: complete trace from dispatch to completion detection.
- `PIPELINE_STEP` with `meta.step` (`pipeline_start`, `preparation_start/done`, `streaming_start/done`, `finalization_start/done`).
- `STATE_CHANGE` with `meta.from`/`meta.to` transitions.
- `DETECTOR_TICK` / `DETECT_DONE` for completion detector signals.
- `SELECTOR_STATS` with aggregated hit/miss ratios.
- `PORT_CLOSED`, `HANDSHAKE_TIMEOUT`, `RECOVERY_ACTION` structured errors.

## Base schema (v2.54.7)
Purpose: standard fields for correlating events across tabs, queue, and responses.
- `ts` - event timestamp (ms).
- `extVersion` - extension version.
- `sessionId` - run/session id (jobState.session.startTime).
- `requestId` - LLM request id.
- `llmName` - model name.
- `tabId` - tab id.
- `event` - telemetry event name.
- `details`/`level` - human-readable details and severity.
- `meta` - extra fields (snapshot, timing, reason, dispatchId).

## Event catalog (v2.54.7)
Purpose: complete trace from tab open to prompt confirmation.
- `RUN_START` - session start per model.
- `RUN_END` - first response received per model (success/error).
- `TAB_CREATED` - new tab created.
- `TAB_REUSE_CANDIDATE` / `TAB_REUSE_REJECTED` - reuse attempt and rejection.
- `ATTACH_CANDIDATE` / `TAB_ATTACHED` / `ATTACH_REJECTED` - attach flow and rejection.
- `TAB_READY_CHECK` / `TAB_READY_WAIT_END` / `TAB_READY_FAIL` - tab readiness (load/reload).
- `TAB_DISCARDED_RELOAD` - discarded tab recovery.
- `DISPATCH_LOCK_ACQUIRE` / `DISPATCH_START` / `DISPATCH_COMMAND_ACCEPTED` / `DISPATCH_SEND` - queue and send phase. `DISPATCH_COMMAND_ACCEPTED` proves that the content script owns the correlated transaction. `DISPATCH_SEND` is emitted only when the provider adapter reports `send_action_requested`; it carries the earlier readiness split (`readyWaitMs`, `tabReadyMs`, `ackWaitMs`, `noFocusProbeMs`) without misclassifying command delivery as a physical Send action.
- `READY_REANNOUNCE_REQUESTED` - background asked an open page to replay `SCRIPT_READY` because worker memory held no correlated handshake.
- `PRE_INSERTION_FAILURE_DEFERRED` - a dispatch failed before the prompt reached the composer; the terminal is deferred once so the Round 2 repair can re-dispatch. Meta: `reason`, `failureClass`, `deferredFinalStatus`, `attempt`.
- `FINALIZATION_DECISION` - meta carries `decisionReasons` (why a finalization was blocked), `liftedDecisionReasons` and `acceptedOnStableEvidence` (strict-verification blocker lifted on stable, identity-matched evidence).
- `PROMPT_SUBMITTED_ACCEPTED` / `PROMPT_SUBMITTED_REJECTED` / `PROMPT_SUBMITTED_STALE` - submit confirmation handling.
- `PROMPT_SUBMITTED_TIMEOUT` - submit confirmation timeout (no signal received); its budget starts at provider `send_action_requested`, never during attachment upload or composer preparation.
- `send_action_requested/completed/failed` публикуются всеми production adapters. Отсутствующий `DISPATCH_SEND` после `DISPATCH_COMMAND_ACCEPTED` означает, что transaction не достигла физического Send action, а не пробел telemetry.
- `PIPELINE_START` / `PREPARATION_*` / `STREAMING_*` / `FINALIZATION_*` / `PIPELINE_COMPLETE` / `PIPELINE_ERROR` - content pipeline phases.
- `STOP_DISAPPEARED` - stop button vanished (completion heuristic).
- `SCRIPT_HEALTH_FAIL` - health check failure.
- `SCRIPT_REINJECT_START` / `SCRIPT_REINJECT_RESULT` - content script reinject.
- `TAB_CLOSED` - tab closed (removeInfo).

## Snapshot schema (v2.54.7)
Purpose: quick tab context at event time.
- `url`, `status`, `discarded`, `active`, `lastAccessed`, `windowId`, `pinned`, `audible`, `title`.
