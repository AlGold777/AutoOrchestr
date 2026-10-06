# Codex phase change log

## 2.81.354 — Permanently remove browser debugging

- Removed the `debugger` permission from the manifest.
- Added a fail-closed guard in the background transport before any access to
  `chrome.debugger`, so browser-level debugging cannot be re-enabled by a
  future configuration change.
- Removed CDP attachment strategies; attachments now use page, input, drop or
  paste fallbacks only.
- Updated the architecture and permission documentation to state that A_Fable
  cannot produce Chrome's “started debugging this browser” notification.

## 2.81.282 — Recovery paths stop being provider-specific

- Run 1785853347152 lost three of four models to three different mechanisms with
  one shape: a recovery path existed but did not apply. The pre-insertion failure
  finalized the model before the repair round could see it, the repair round had
  a model allowlist, and the finalization policy blocked a complete answer with a
  reason that never reached the export.
- The deferral is budgeted at one attempt per model and refuses to swallow a
  last-resort terminal, so a model can no longer be lost silently, and cannot
  loop either.

## 2.81.269 — Send recovery release gate

- The background trusted-Send selector now uses the same exact full-prompt
  predicate as the content adapter; attachment labels or partial head/tail
  fingerprints cannot authorize a Send action.
- Generated provider bundles were rebuilt from the current sources.
- Legacy tests that required early or CDP-only submission confirmation now
  enforce the fail-closed contract. The full 1,663-test suite, telemetry parity
  suite and headed Chromium telemetry smoke-test pass.

## 2.81.268 — Perplexity insertion proof is exact and visible

- Perplexity accepts insertion only after reacquiring the visible current
  composer and matching its normalized value to the entire dispatched prompt.
- A framework transaction, cached node, hidden draft or partial fingerprint is
  no longer sufficient evidence; the dispatch fails closed before Send.
- Ordinary Send and send-only recovery share the same exact composer ownership
  predicate and require a direct current-page submission signal.

## 2.81.267 — Focus follows correlated composer progress

- Round 1 keeps its normal eight-second foreground cap for every model.
- A model receives one additional five-second window only when its exact
  dispatch published fresh composer or Send progress during the first window.
- Missing, stale and cross-dispatch stage signals cannot extend the queue; the
  extension and its cause are recorded in canonical focus-stage telemetry.

## 2.81.266 — Safe send-only recovery

- A provider-neutral watchdog revisits Grok and Perplexity only after an exact,
  correlated insertion stage and never reinserts the prompt.
- Recovery may press Send only when the current visible composer exactly equals
  the dispatched prompt; stale, hidden and changed drafts fail closed.
- A successful debugger command no longer counts as submission. Perplexity now
  requires a new user turn, fresh generation element or new response node.
- Grok no longer publishes an early unverified `PROMPT_SUBMITTED`; both ordinary
  and recovery sends require the posted user turn to match the whole prompt.

## 2.81.265 — Composer ownership ends at confirmed Send

- Provider ownership is split into short `composer` and long
  `answer_collection` phases for Grok, Perplexity and Le Chat.
- Retry and Round 2 repair are blocked only by the duplicate-sensitive composer
  transaction; waiting for an answer no longer suppresses delivery recovery.
- The legacy aggregate ownership fields remain compatible but now represent
  composer ownership only.

## 2.81.264 — Provider send stages are canonical evidence

- Grok and Perplexity now publish correlated composer, insertion and Send
  milestones through a provider-neutral content API.
- Focus-boundary outcomes and provider stages are retained as the canonical
  `DISPATCH_STAGE_OBSERVED` fact, including elapsed time and failure reason.
- Stage evidence is accepted only from the bound tab and exact run/dispatch.

## 2.81.263 — Human presence yields to a running dispatch

- The visit loop reschedules itself, so the `promptDispatchInProgress` guard was
  evaluated only once, at scheduling time. A loop restarted by a window focus
  change or by job-state rehydration kept foregrounding model tabs while Round 0
  was acquiring tabs and Round 1 was inserting the prompt.
- The loop now yields while rounds are in progress or a dispatch is in flight,
  re-checking on every cycle instead of only when scheduled.
- Rounds release `roundsInProgress` before starting the post-round visit loop,
  so the new guard cannot defer the loop the rounds themselves requested.

## 2.81.262 — The pre-send wait is attributable

- A residual slow dispatch can now be attributed from the export alone: the
  phase split in `DISPATCH_SEND` separates tab readiness from the ACK wait and
  from the no-focus probe.
- `READY_REANNOUNCE_REQUESTED`, `TAB_DISCARDED_RELOAD`, `TAB_READY_WAIT_END`
  and `HANDSHAKE_TIMEOUT` are mapped into the canonical ledger, so a Chrome tab
  discard and a lost worker handshake are no longer the same blank gap between
  `DISPATCH_START` and `DISPATCH_SEND`.

## 2.81.261 — Old pages replay readiness without the ACK timeout

- Dispatch detects when the current service-worker epoch has no correlated
  Ready/ACK pair for an already open provider tab and requests a fresh signal.
- The content bootstrap replays `SCRIPT_READY` with the existing tab-session
  identity, so background validates the same document instead of reloading it.
- A valid cached handshake remains the zero-message fast path; the recovery
  request is used only when worker memory is missing or uncorrelated.
- Field evidence from 2.81.260 showed 7.4–10.6 seconds from `DISPATCH_START` to
  `DISPATCH_SEND` for ACK-gated providers, versus 2.6 seconds for Perplexity,
  which bypasses that gate.

## 2.81.260 — Round 1 yields after composer insertion

- Round 1 foreground ownership now ends on correlated submit or insertion
  evidence, with an eight-second cap; it no longer consumes the model's full
  12–22 second submit timeout when submission is broken or unobservable.
- Prompt insertion outcomes have dispatch-scoped waiters and pass the same
  bound-tab and run/dispatch correlation gates as other lifecycle evidence.
- The longer submission timeout remains asynchronous and repair continues to
  defer while a provider explicitly owns its live transaction.

## 2.81.259 — Proof examples follow the executable registry

- The checked-in dependency-registry snapshot and every generated proof
  telemetry example were rebuilt from the current executable contracts.
- Full regression can now verify the new user-focus event against both the
  live registry and its documented snapshot.

## 2.81.258 — User-focus telemetry is registered

- The canonical `USER_FOCUS_OBSERVED` event now has explicit inventory,
  retention and consumer metadata and is classified as contextual observation.
- The inventory regression guard covers all 45 canonical event types.

## 2.81.257 — User focus is not an automation lease

- An unmarked user tab activation is recorded as a separate focus observation;
  it no longer creates `LEASE_GRANTED`, a fictitious 12-second TTL or a
  30-second `FOCUS_STUCK` warning.
- User activation still preempts and closes a live automated visit, while
  programmatic visits retain their bounded lease and hard-cap contract.
- Canonical proof telemetry preserves user-focus start/end events as
  `USER_FOCUS_OBSERVED`, distinct from observation-slot allocation.

## 2.81.256 — Debugger ownership is serialized per tab

- Every trusted input, Send, Enter and CDP attachment operation now passes
  through one tab-scoped debugger-session queue.
- The manager performs the only `chrome.debugger.attach`/`detach` pair in the
  router; cleanup and object release finish before ownership moves to the next
  queued operation on that tab.
- Different tabs remain independent, while queue wait and session lifetime are
  visible in telemetry.

## 2.81.255 — Focus follows the provider submit transaction

- Round 1 keeps each focused provider foregrounded until correlated
  `PROMPT_SUBMITTED` evidence arrives or that provider's bounded submit window
  expires; the next model no longer hides a composer transaction immediately.
- Grok acknowledges command ownership immediately and reports explicit provider
  pipeline ownership while its asynchronous insert/send work continues.
- Retry supervisor and both Round 2 repair paths defer while the original
  provider transaction owns the dispatch, with a three-minute fail-safe TTL.

## 2.81.254 — Round 1 readiness is prewarmed in parallel

- After tab acquisition, Round 0 validates every bound tab and awaits its
  document-scoped Ready/ACK signal concurrently.
- Sequential Round 1 keeps its normal readiness gate as a fallback, but a
  successfully prewarmed tab now resolves it from the current-session cache
  instead of consuming another per-model timeout budget.
- Prewarm outcomes and elapsed time are recorded per model and for the batch.

## 2.81.253 — Completion survives temporary observation loss

- A recovered snapshot explicitly classified as unconfirmed completion remains
  a visible non-terminal candidate when finalization policy rejects it; it can
  no longer close a still-generating model as `PARTIAL`.
- An existing eligible tab whose content script and scripting probe are
  temporarily unavailable is classified as `UNAVAILABLE`, not `DEAD`.
- Read-only late collection is serialized across providers and schedules a
  bounded provider-neutral retry sequence without reloading model pages.

## 2.81.252 — Field validation understands canonical evidence identity

- The field validator reads the dependency registry and incident index from
  their canonical-evidence locations instead of reporting them as absent.
- Canonical `sharedConfig.reportVersion` now participates in exact reproduction
  identity, preventing valid current-generator evidence from being mislabeled
  as a historical reinterpretation.
- Regression coverage builds and audits a real canonical-evidence container.

## 2.81.251 — Existing model pages start without multi-minute dispatch stalls

- A new run clears per-model startup promises, submit waiters and dispatch
  locks left by the preceding run, so new work cannot queue behind stale work.
- With New pages disabled, independent existing-tab acquisition runs in
  parallel and the results-page request keeps the MV3 worker alive through the
  initial send phase.
- The active round and New pages mode are persisted. If MV3 still interrupts
  Round 0 or Round 1, rehydration resumes the bootstrap and does not resend a
  dispatch command that was already attempted.

## 2.81.222 — Telemetry export is an isolated, bounded pipeline

- Full schema construction and safe serialization moved to a dedicated worker,
  removing long synchronous work from both result surfaces.
- Worker progress distinguishes report construction from JSON serialization and
  reports elapsed time after download starts.
- The pipeline terminates a stalled worker after 20 seconds and downloads a
  canonical recovery ledger with all raw proof events and failure metadata.

## 2.81.221 — Full JSON export cannot be starved by live telemetry writes

- The persistence barrier is bounded at 750 ms instead of ten seconds.
- A busy ledger returns its latest durable snapshot as a successful export
  source, marked `committed_boundary` and diagnostically incomplete when writes
  are still queued.
- The results page no longer discards that coherent snapshot or asks the user
  to repeat an export that may encounter the same continuously active queue.

## 2.81.220 — Telemetry export avoids unnecessary full-container work

- The checked digest path now scans canonical events once and downloads without
  constructing or hashing all seven embedded preset reports.
- Unchecked full JSON preserves the complete schema while replacing repeated
  event scans and whole-container clones with indexed lookup and direct hashing.
- The UI yields before full report construction and reports the event count so
  the busy state is painted instead of appearing frozen.

## 2.81.219 — Truncated HTML cannot hide the committed answer tail

- Rich answer HTML is treated as a projection, while the committed text remains
  authoritative for completeness.
- A materially shorter HTML projection with the same answer beginning falls
  back to the full text rendering across live, debate, revision, and recovery
  surfaces.
- The regression reproduces the Gemini 6198-to-6046 render loss observed in run
  `1785611627407` and requires the final tail to remain visible.

## 2.81.218 — Results reload no longer discards persisted answers

- Results-page registration now reconciles the answer-bearing background
  snapshot even after a page reload.
- The old DOM is still cleared before hydration; only a confirmed extension
  runtime reset suppresses restoration.
- Regression coverage locks the distinction between page reload and runtime
  reset.

## 2.81.196 — Perplexity single-flight and live Send control

- Field result on 2.81.195: Le Chat submitted quickly; Perplexity inserted the
  prompt twice and did not submit.
- Perplexity had no per-tab in-flight guard. Because `GET_ANSWER` is acknowledged
  before asynchronous provider work completes, retry supervisor could start a
  second composer transaction before the first emitted `PROMPT_SUBMITTED`.
- Added a tested dispatch gate: the same active prompt is acknowledged as a
  suppressed duplicate, a different concurrent prompt is rejected as busy, and
  the gate reopens only when the owning transaction finishes.
- Read-only live DOM inspection confirmed the current page uses Lexical
  `#ask-input`, outside form/search ownership, and exposes a unique localized
  `aria-label="Отправить"` button only after React commits the draft.
- Native Send-control click is now primary; native Enter is fallback. The fixed
  two-second pre-send delay was removed. Le Chat code was not changed.

## 2.81.195 — Make the 2.81.75 Le Chat/Perplexity dispatch path executable

- 2.81.194 restored the donor RPC calls but not the donor's `debugger`
  permission. At runtime `chrome.debugger` was unavailable, so every trusted
  action failed before attach and the adapters fell back to their old slow
  synthetic paths. This is why the field behaviour did not change.
- The permission is restored, but a router allowlist enables only Le Chat and
  Perplexity trusted Send plus Perplexity trusted Enter. Grok trusted input,
  native input RPCs and all CDP attachment RPCs stay fail-closed, preserving the
  behaviour of unrelated providers.
- A completed native browser gesture is recorded as
  `trusted_browser_dispatch` evidence. Composer clearing, shrinking, disabled
  controls and pre-existing busy nodes remain insufficient, avoiding the false
  success regression fixed in 2.81.111/2.81.117.
- The slow page click/form/synthetic keyboard chains were removed from these two
  submission transactions. A trusted failure now fails promptly instead of
  consuming the useful session window.
- With New pages disabled, provider-specific reuse runs before the generic
  draft/modal probe and can recover the newest matching tab when session cleanup
  already cleared the persisted mapping.
- Added executable CDP dispatch tests and a runtime-style cleared-mapping reuse
  test in addition to source-contract coverage.

## 2.81.123 — Perplexity insertion no longer trusts execCommand

> Renumbered from a duplicate "2.81.122" heading: two independent sessions each
> bumped 2.81.121 to 2.81.122 for unrelated work (this fix, and the telemetry
> volume cut below) and committed without seeing each other's change. Neither
> file conflicted, so git accepted both commits with the same version string.
> No earlier release history was rewritten; this entry and all release metadata
> (`manifest.json`, `package.json`, `package-lock.json`, and the notes-backup
> `appVersion`) were moved forward to 2.81.123 to restore
> one-version-one-commit.

- Eight of nine providers now insert and submit; five deliver their answer before `Get It`. Perplexity remained the sole dispatch failure, reusing its existing tab while the others opened fresh ones.
- `document.execCommand('insertText')` reports success even when the tab holds no focus and nothing was inserted. The guard around the range fallback read that return value (`if (!inserted && ...)`), so on a lie the fallback never ran and the composer stayed empty.
- Field evidence: every attempt in the rejection history carried `insertMethod: "beforeinput_exec_command"` together with `inserted: false`. The focus timeline explains the lie — Perplexity's visit ended after 845 ms against `minUsefulMs: 1500`, its lease was released, and Z.ai took the focus one second later while the three insertion attempts were still running.
- Insertion now verifies the composer content instead of the return value, and the reported method names the path that actually delivered the text. That distinction is what made the defect diagnosable, so it is preserved deliberately.
- Regression added: `execCommand` stubbed to return `true` while changing nothing must still leave the prompt in the composer via the range path.
- Not addressed here: the underlying lease is still released before the operation it protects completes. That is a scheduler change affecting all nine providers and is kept separate.

## 2.81.122 — Cut telemetry export volume across encoding, payload, serialization

- 2.81.119 stopped one model's event storm but the same run still exported 551KB. The remaining volume sat in three independent layers.
- Encoding: the delta compared each event against the previous event of the same model, but meta shape follows the event label, not the model — 407 of 466 consecutive same-model pairs were different event types, so the diff compared unrelated structures and spent its savings on removed-key lists (present in 322 of 474 events, 7 after the fix). The baseline is now keyed by (platform, label), written as format marker 3; formats 1 and 2 still expand, dispatched per event marker.
- Payload: `MODEL_RUN_TRANSITION` carried four projections of one state, and `legacyAfter` equalled `legacyBefore` in 47 of 47 transitions. Identical twins are no longer emitted; a missing twin reads as unchanged. Nothing in the UI, background or tests reads those fields.
- Serialization: exports were pretty-printed, which cost 183KB (33.2%) on a 551KB file. Telemetry and Disput JSON are now written compact — they are read by analysis tooling, and any viewer re-formats on demand.
- Measured on the same run: 551059 → 335320 bytes, round-trip verified lossless on every section of the real export.

## 2.81.121 — Deliver blocked answers as labelled candidates

- Light field test: every answer arrived complete and carried its end marker, yet nothing appeared in the cards until `Get It`, and Claude and Z.ai needed a double-click on top of that.
- Telemetry showed the answers were already collected and stored: GPT ended at `FINALIZATION_DECISION SUCCESS:blocked` → `TERMINAL_SUCCESS_BLOCKED_BY_ANSWER_EVIDENCE answer_not_verified`, DeepSeek at `FINALIZE_BLOCKED_SUBMIT_PENDING deferred_finalization len=2304`. Submission confirmation never landed (`PROMPT_SUBMITTED_PENDING skip_submit_wait`), so `confirmedDispatchId` stayed unset and the strict gate from 2.81.109 could never verify.
- Both paths stored the text in `pendingFinalAnswer`, set the card to `RECEIVING` and scheduled a retry — but never sent the text to the results page. The card went orange and empty while a complete answer sat in background state.
- This is the strictness/availability tension the architecture review recorded: absence of proof was being treated as a statement about the content. Principle 5 already says otherwise, and 2.81.113 had implemented the correct shape for one recovery path only.
- Blocked terminal success now delivers the answer as a non-terminal candidate labelled `Verification pending`. The deferred submit-unconfirmed path does the same under `Submission unconfirmed`, but only for text that is provably **not** the pre-dispatch baseline — submission was never confirmed there, so stale page content is a real possibility and `isStaleBaselineCandidate` gates the delivery.
- Neither path can produce a terminal or green result. The gate is unchanged; only the visibility of an unproven candidate is.

## 2.81.120 — Perplexity Send control scope and background-tab draft read

- Perplexity still failed with `PERPLEXITY_DRAFT_REJECTED prompt_not_present` → `prompt_injection_failed` while the prompt was visibly present in the composer.
- Field evidence from the decision metadata: all three attempts reported `insertMethod: beforeinput_exec_command` (the insert command itself succeeded) together with `hasSendControl: false` and `sendControlReady: false`, and the single resolved candidate carried `inForm: false`, `inSearch: false`.
- First cause: `resolveSendControl` derived its scope from `composer.closest('form,[role="search"],[data-testid*="composer"]')` and collapsed to `composer.parentElement` when that returned null — which is exactly the live Perplexity shape. The Send control sits further up the tree, so it was never found, and `prepare()` requires a visible Send control before accepting a draft. A correctly inserted prompt could not be accepted. The scope now walks a bounded six ancestors, nearest first, so the closest Send still wins and an unrelated control further away is not reachable.
- Second cause: `read()` preferred `innerText`, which depends on layout and can return empty or stale text in a background tab — the tab state during dispatch. For a contenteditable both projections are equivalent after normalization, so the longer of `innerText`/`textContent` is used.
- Added regressions: Send control found when it lives outside the composer parent, no reach to an unrelated Send control seven levels away, and a draft that matches through `textContent` when `innerText` is unavailable. The scope test was verified to fail when the ancestor walk is reduced to one level.

## 2.81.117 — Submission proof for Gemini and Claude

- After 2.81.116 restored insertion, five of nine providers worked. Gemini, Claude and Perplexity inserted the prompt but the turn was never committed, while the run still reported `PROMPT_SUBMITTED_ACCEPTED`.
- Field evidence for Gemini: `Gemini send strategy ctrl_enter` carried `composerLength=190`, `Gemini send confirmed` carried `composerLength=0`, and the next event was `TURN_RESOLUTION unresolved:answer_node_unresolved`. The prompt went in, the composer cleared, no turn appeared, and the clearing alone was accepted as proof.
- Gemini and Claude each carried a private submit oracle whose every branch is satisfied by "nothing happened": an empty composer, a *disabled* Send button (disabled precisely because the composer is empty) and any page-wide spinner or Stop button left over from an earlier turn. Le Chat and Perplexity had already been moved onto the strict shared oracle in 2.81.111; these two were never migrated.
- Both now use `ProviderSubmitConfirmation`, which confirms only on evidence that is new relative to a pre-send baseline: a new user turn, a new response node, or a generation element that did not exist before the attempt. Composer clearing and shrinking remain recorded but never confirm. Each keeps a fail-closed local fallback that also requires new current-turn evidence.
- `shared/provider-submit-confirmation.js` moved into the shared content-script block. It was previously loaded only on Perplexity and Le Chat, so Grok referenced the oracle in code while it was undefined at runtime and silently fell back to its local logic.
- Added `tests/provider-submit-proof-contract.test.js`: the oracle must reject composer clearing, must ignore a pre-existing generation element, every provider page must load it, and no adapter may treat an empty composer or a disabled Send button as proof. Verified to fail when the empty-composer shortcut is reintroduced.

## 2.81.116 — Attachment strategy fallback restores prompt dispatch

- Field report: six of nine providers were unusable. Gemini, Perplexity, Qwen and Z.ai did not insert the prompt at all; Le Chat and Claude inserted but did not submit.
- Root cause for the four that did not insert: 2.81.112 removed the `debugger` permission, but those four still declared a CDP-only attachment strategy list. `chrome.debugger` was undefined, so the CDP request failed with `Cannot read properties of undefined (reading 'attach')`, and with no other strategy the dispatch ended as `USER_ACTION_REQUIRED:attachment_failed` **before the prompt was ever inserted**. The 2.81.112 note claiming these strategies "fall through to their existing page bridge, input, drop or paste alternatives" was not true — the lists contained a single entry.
- The symmetry confirms the diagnosis: the three providers that kept working (ChatGPT, DeepSeek, Grok) are exactly those whose strategy list was already `['drop', 'input']`, with no CDP entry.
- Fallbacks added, CDP kept first so it remains correct if the permission ever returns: Gemini `['cdp-file-input', 'input', 'drop']`, Perplexity `['provider-cdp-file-input', 'input']`, Qwen `['qwen-cdp-file-input', 'input']`, Z.ai `['provider-cdp-file-input', 'paste', 'input']`. Qwen had no selectors at all, so its stable native contract `input#filesUpload` was added explicitly.
- `tryVia` now wraps the strategy dispatch in try/catch. A missing browser API surfaces as a thrown `TypeError`, and letting it propagate aborted the whole attachment chain; it is now recorded as `dispatch_threw:<message>` and the next strategy runs.
- Added `tests/attachment-strategy-fallback.test.js`: no provider may declare CDP-only, every CDP entry must be followed by a non-CDP fallback, and the dispatch call must stay guarded. Verified to fail when a CDP-only list is reintroduced.
- Three existing tests asserted the CDP-only configuration as literal source text and therefore passed while the product was broken. They now assert the correct invariant (CDP first, fallback mandatory) instead of the exact string.

## 2.81.115 — Atomic run tab acquisition

- Made model tab acquisition an awaited transaction. Round 0 cannot advance on a stale persisted binding while global reuse probing or fresh-tab creation is still running.
- Removed the unsafe second chance that returned to the persisted mapped tab after the same global surface had been rejected for an existing draft, active generation, modal, or unavailable probe.
- When no safe reusable tab exists, the old binding is cleared and a fresh tab is created with `forceCreate`; the user's rejected tab remains open and untouched.
- Fresh-tab creation now resolves only after the new tab is bound to the active run. Global reuse checks every eligible matching tab instead of silently stopping after the newest three.
- Added regressions for a safe fourth candidate, delayed tab creation/binding, and the orchestrator's awaited isolation fallback.

## 2.81.114 — Transactional Perplexity composer ownership

- Replaced Perplexity's first-match composer lookup with a ranked ownership resolver. It prefers the visible editor bound to the search form and its local Send control, while excluding extension-owned editors and stale or hidden candidates.
- Ordinary text dispatch now looks for a usable composer before touching any promotion UI. A promotion may be dismissed only when a compact, semantically-owned container has its own close control, does not contain a composer, is not the page root, and does not cover most of the viewport. This removes the field-observed false guard whose diagnostic text contained the entire Perplexity page.
- Added a framework-facing editor transaction: a temporary target identity is passed to the authenticated main-world bridge, rich editors receive Selection plus `beforeinput`/`execCommand` semantics, and the isolated-world editor-specific transaction remains a fallback. No debugger permission or trusted-input RPC is used.
- Draft preparation is accepted only after reacquiring the live composer, proving the current prompt appears exactly once across its head and tail, and finding an available Send control owned by the same form/composer scope. A replaced editor is followed explicitly instead of continuing with a stale DOM reference.
- Added bounded composer-transaction telemetry with candidate ownership, insertion method, node replacement and Send readiness, plus behavioral regressions for extension-editor exclusion, page-sized false promotions, compact real promotions, editor replacement, missing application acknowledgement and rich-editor insertion.

## 2.81.113 — Preserved unverified content and monotonic completion

- A complete recovery artifact whose current-request attribution cannot be proven is no longer converted into `NO_SEND` and discarded. It is persisted and delivered as a non-terminal `RECEIVING` candidate with explicit `attribution_unproven` metadata; both the main panel and debate card show an “Attribution unverified” marker and remain orange.
- The results-state snapshot now carries this artifact, so reloading the results page restores the text and its warning instead of restoring only the status.
- Text-length regression is now a sticky finalization veto in both structural-stability implementations. Stability on a smaller post-regression plateau cannot finalize; the veto clears only after the selected text returns to the previous maximum, after which the required consecutive stability series starts again.
- Verification telemetry and the decision-time snapshot retain the active-regression flag and recovery floor. Automatic success also rejects a proof that still carries an active regression.
- Added production-path regressions for preservation/delivery of complete attribution-unproven content, both stability chains, recovery to the prior maximum, and visible warning projection.

## 2.81.112 — Browser operation without debugger attachment

- Removed the `debugger` permission from the packaged extension. After reloading this version, A_Fable cannot attach Chrome DevTools Protocol and therefore cannot produce Chrome's “started debugging this browser” banner.
- Le Chat now sends through its scoped page Send button, the composer's `requestSubmit()`, Enter and Ctrl+Enter, in that order. Perplexity uses its scoped page Send button, form submission and Enter. Every attempt remains subject to the direct current-turn proof introduced in 2.81.111.
- Removed all debugger RPC calls from the Le Chat and Perplexity adapters, including the native-input synchronization added in 2.81.110.
- Grok's ordinary prompt insertion also no longer invokes its debugger input channel; it uses two clean page-event transactions and still requires an exact full-prompt match before Send.
- Attachment strategies that previously preferred debugger-based file assignment now fall through to their existing page bridge, input, drop or paste alternatives because the permission is unavailable.
- Added package-level regression assertions that `debugger` is absent from the manifest and that the three ordinary provider adapters contain no debugger RPC request.

## 2.81.111 — Direct submission proof for Le Chat and Perplexity

- Independent review correctly identified that composer clearing and a drop below ten percent of its previous length were correlations, not proof that a request was submitted. Both signals are now diagnostic-only and can never confirm submission by themselves.
- Added the shared `ProviderSubmitConfirmation` evaluator. It confirms only a new user-turn node, a generation element absent from the pre-Send baseline, or a new response node. A pre-existing busy element is explicitly rejected.
- Le Chat and Perplexity both use this evaluator after every trusted Enter/click attempt. If the module is unavailable, their local fallback is also fail-closed and accepts only the same three direct signals.
- Added behavioral regressions in `tests/provider-submit-confirmation.test.js` for composer clearing without submission, sub-ten-percent shrink, stale busy elements, and each of the three accepted direct signals. Source wiring and fallback reachability remain covered in `tests/attachment-handler-bridge-auth.test.js`.

## 2.81.110 — Reliable Le Chat and Perplexity submission

- Le Chat's declared button and keyboard fallbacks were unreachable: failure of the first trusted Send-control lookup rethrew immediately. A failed trusted click now continues through a browser-level Ctrl+Enter shortcut, the scoped button path, and legacy keyboard fallbacks, with confirmation after every attempt.
- Both Le Chat and Perplexity now repeat the prepared prompt through a sender- and origin-gated native browser input transaction before attempting Send. This synchronizes the provider framework state in the observed case where the text was visible in the composer but React still treated it as empty and kept submission inactive.
- The trusted Send-control lookup is now bound to the exact Le Chat prompt instead of accepting any non-empty active editor.
- Le Chat submission confirmation now requires a new user turn, new generation element, composer clearing, or a new response node. A busy/streaming element that already existed before the attempt and a merely disabled Send button no longer create false `PROMPT_SUBMITTED` evidence.
- Added source-contract regressions for native input synchronization, sender/origin authorization, reachable Le Chat fallbacks, and fresh-only submission evidence.

## 2.81.109 — Dispatch-bound finalization and decision-signal telemetry

- Automatic finalization is now fail-closed until the current dispatch has a real submission timestamp and its `confirmedDispatchId` exactly matches the candidate dispatch. A confirmation from an older turn and answer-inferred submission evidence cannot unlock green. Manual `Get it` recovery remains an explicit exception.
- Structural stability now identifies the selected DOM node, not only its text. Replacing the node with an identical string resets the consecutive-stability series. Any selected-text length decrease also resets the series, emits a dedicated warning, and records the maximum length, decrease count/delta, and bounded recent-length history.
- Decision-time proof now carries the Send-command and submission-confirmation times, baseline equivalence, candidate index and ordinal after the turn anchor, first candidate/mutation times, node identity, and the retained length-regression history.
- The platform generation probe now records every configured selector checked and, for each, the numbers found, available, and visible. This makes the next B2 run suitable for choosing per-platform completion evidence from measurements instead of assuming that a Copy or action button appears only after streaming.
- The B2 tail marker remains a calibration-only oracle. It is exported at decision time but is not a production finalization condition.
- Added regressions for missing and stale dispatch confirmation, same-text node replacement, text shrink/recovery, and generation-selector diagnostics.

## 2.81.108 — Non-terminal color truth and stale-lifecycle resend recovery

- B2-S2 produced a complete 722 KB post-`Get it` telemetry export, proving the 2.81.106/107 export repair works. The background summary and user observations showed that several “green” indicators were actually non-terminal `READY`/`RECEIVING` projections: both states still used green CSS even though success-without-answer had already been deferred.
- `READY` now maps to the waiting-for-send class and `RECEIVING` pulses orange. Green is reserved for an applied terminal success. Empty active debate cards are subject to the same applied-answer check; only a card that actually contains its answer can show terminal green.
- Qwen exposed a resend deadlock: an old stable answer produced lifecycle activity under the new dispatch, and `RecoveryIntent` treated matching lifecycle timestamps alone as terminal-eligible answer evidence. Six retry-supervisor resends were therefore denied even though the new prompt was never submitted. Lifecycle evidence can now block a resend only when its answer verification is exact, structurally complete, generation-inactive, verified, and dispatch-matched. Confirmed non-baseline text and explicit fresh-turn evidence remain valid alternatives.
- Durable `runOutcomeSummary` now includes submit source/confirmation, finalization acceptance and contradictions, decision-time snapshot, calibration marker result, and bounded answer-freshness metadata. Z.ai-like terminal evidence remains available even if its individual event stream is absent from the page export.
- The summary also exports `generationEpoch` and the dispatch-bound turn anchor, so the next run can explain `anchored_turn_unresolved` without reconstructing identity from missing page events.
- A successful `Get it` acknowledgement now carries the answer already persisted by the background worker. The results page applies that payload as a recovery channel instead of assuming the earlier, separate response message was delivered; this closes the observed DeepSeek state where 7682 characters existed in background state while its card stayed empty.
- Added regressions for non-terminal color semantics, per-card answer presence, unverified-lifecycle resend authorization, and durable decision-snapshot export.

## 2.81.107 — Decision-time completion proof and B2 tail oracle

- The delayed B1 capture from B2-S1 was recorded 17 minutes after dispatch and therefore could not prove what the resolver and generation detector saw when an earlier answer was accepted. B1 remains a selector/structure fixture gate, not a time-of-finalization oracle.
- Every finalization decision now carries a copied decision-time snapshot: answer and selected lengths, message-root length, exact/fallback resolution, structural result and issues, generation active state, the exact generation-signal kind and selector, stability count, and both observation and decision timestamps. No answer text or HTML is included.
- Generation-signal kind/selector and root length now survive the snapshot-pair verifier and background verification recorder instead of being dropped between the content and finalization layers.
- B2 prompts whose final non-empty lines contain a `B2-...-END-...` marker are detected automatically. Finalization telemetry records whether that exact marker was present in the accepted candidate. This is a calibration diagnostic, not a production success gate: provider instruction-following must not redefine normal completion semantics.
- Added behavioral regressions for preservation of generation diagnostics, immutable decision snapshots, telemetry emission, and detection of a missing B2 tail marker.

## 2.81.106 — Honest applied-answer status and complete JSON telemetry

- The B2-S1 field run exposed two independent projection defects: four cards could turn green while their verified answers were still pending manual application, and the JSON export reduced the whole run to four GPT round events while reporting every model as `no_terminal_outcome`.
- A terminal-success status is now deferred while the live result card is empty. Painting arbitrary non-empty text no longer synthesizes `SUCCESS`; the pending terminal success is applied only after that same answer reaches the live card. An answer without confirmed completion therefore remains orange, as required by the strict gate.
- Content-tab diagnostic events that omit run identity inherit the current run and dispatch only when the sender tab exactly matches the currently mapped tab for that model. Foreign and stale tabs remain unscoped instead of being silently attributed to the active run.
- JSON telemetry export now reads the full persisted 2000-event snapshot at click time, merges page-side round events, scopes it with the background run identifier, and embeds the durable background run-outcome summary. It no longer relies on the 400-event page cache as its source of truth.
- Added regression contracts for green-empty-card prevention, removal of the text-implies-success shortcut, mapped-tab run attribution, and authoritative JSON export.

## 2.81.105 — Shared open-Shadow-DOM turn discovery

- The eight-provider 2.81.104 field run left Perplexity structurally unresolved even though `Get it` recovered 654 characters. Telemetry proved that the independent inline collector selected `.prose` and that its distinguishing capability was recursive traversal of open shadow roots.
- The authoritative `TurnResolver` now owns a cached deep-query adapter that searches the document and every reachable open shadow root. Lifecycle capture and B1 use it by default; the unified pipeline and watcher explicitly use the same adapter instead of document-only queries.
- Shadow traversal only discovers candidates. A generic `.prose` node does not become exact without a configured message root, so the strict green gate remains fail-closed. The next sanitized B1 capture can now expose the real Perplexity wrapper for a narrow selector repair.
- Added a regression proving that an answer inside nested open shadow roots is discoverable and exact only when its configured root is present.

## 2.81.104 — Results-page telemetry backpressure

- Two consecutive live attempts returned to a results tab showing only its background. The live Chrome process list showed the extension renderer consuming roughly 7.8 GB and sustained CPU, so this was renderer exhaustion rather than a missing CSS repaint.
- Every incoming lifecycle diagnostic rebuilt both the per-model log DOM and the complete hidden DevTools diagnostics/telemetry DOM. The stricter completion tracker made that old UI behaviour an event-amplification loop during nine-provider background runs.
- Diagnostic events are now retained immediately but DOM updates are coalesced. While the results tab is hidden, no diagnostic projection is rebuilt; one bounded flush runs when the tab becomes visible.
- The DevTools diagnostics and telemetry surfaces render only while their modal and telemetry tab are actually visible. Closing or backgrounding DevTools stops its polling timer; opening it projects the latest cached data.
- Added a regression contract for hidden-tab backpressure and visible-tab flushing. Strict answer verification and the 2.81.103 hard turn boundary are unchanged.

## 2.81.103 — B2 hard new-turn boundary

- The 2.81.102 field run exposed the root stale-turn defect in the shared resolver: when `candidateCount === turnAnchor`, the candidate pool incorrectly fell back to every previous answer instead of remaining empty. Old stable text could therefore pass structural checks before the new response appeared.
- A positive turn anchor is now an absolute slice boundary. Until the candidate count grows beyond it, resolution is `unresolved`; previous answers cannot be reintroduced as a fallback.
- Pipelines created after Send now reuse the immutable anchor captured by the common pre-dispatch baseline hook. They no longer recount a partially inserted new response and produce the observed +1/+2 identity mismatches on Grok, Z.ai and Le Chat.
- Lifecycle tracking is no longer cancelled on `pagehide`. The field telemetry proved that a normal Gemini page lifecycle transition emitted `pagehide` and permanently removed its tracker; real document destruction already disposes the script, while preserved pages must retain observation.
- Added regressions for the exact-equality boundary and for a pipeline instantiated after the new answer node has already appeared.

## 2.81.102 — B2 event-driven lifecycle wakeups

- The 2.81.101 field run confirmed fresh, exact, complete and inactive current answers on eight providers, but every card remained open. Lifecycle events stopped roughly 20–30 seconds into the run while the later B1 capture showed finished DOM state.
- After the first answer candidate, lifecycle observation had moved from the page body to the answer element. External generation controls could disappear without waking the tracker, while Chrome heavily throttled its polling timer in background tabs.
- Lifecycle trackers now keep their mutation observer on the page body and immediately wake pending completion checks when answer content or external generation controls change. Mutation accounting remains throttled, but liveness signals are never discarded by that throttle.
- Returning a tab to the foreground and background `LATE_COLLECT_PING` probes also wake pending lifecycle checks. Tracker cancellation now emits its explicit stop reason for field diagnosis.
- Added a production-structure regression with a 60-second poll interval: answer growth and external Stop-button removal wake the tracker and produce verified `COMPLETE` in about 100 milliseconds.

## 2.81.101 — B2 persistent lifecycle verification

- The unique-marker control run proved fresh, exact, complete and inactive answers on seven providers. Claude also proved the complete automatic green path: all four identity fields matched, structural verification succeeded, finalization was accepted, and the card reached `SUCCESS` without manual recovery.
- GPT, Gemini and Le Chat exposed a separate lifecycle defect: a stable previous answer could trigger provisional `COMPLETE`; background correctly rejected it as `stale_baseline_answer`, but the page tracker had already stopped and therefore missed the later current answer. DeepSeek similarly stopped after its first structurally valid but still-changing snapshot series.
- When the production structural proof modules are present, lifecycle completion now requires a verified snapshot before emitting `LLM_RESPONSE_READY` or stopping. Unresolved anchored turns, baseline-equivalent text, changing candidate sets and other candidate states remain non-terminal and are retried after a bounded delay.
- Structural verification explicitly compares the selected linearized text with the pre-dispatch baseline. A DOM reorder or virtualized candidate pool cannot make an old answer complete merely by moving it beyond the positional anchor.
- Reasoning-only Qwen snapshots now remain non-terminal when no exact answer root is structurally provable.

## 2.81.100 — B2 canonical turn-anchor identity

- The S1R3 field run again passed the nine-provider structural gate and proved that pre-dispatch lifecycle tracking now reaches real completion: Claude emitted `ANSWER_COMPLETE_DETECTED`, supplied an accepted answer snapshot, and reached a terminal-success decision.
- Strict finalization correctly blocked that success because lifecycle verification and the stored card identity counted the pre-dispatch turn anchor with different selector pools. Gemini exposed the same defect explicitly as `identity_mismatch:turnAnchor`.
- The dispatch baseline and lifecycle tracker now obtain their positional anchor from the same shared `TurnResolver` result before Send. Legacy pipeline and broad snapshot counts remain fallback-only when the canonical resolver is unavailable.
- Verification recording now emits a pinned diagnostic with both identities, the exact mismatch reasons, structural state, generation state, and snapshot count. Future identity failures are directly observable instead of inferred from the finalization block.
- Null anchors remain null across the content/background boundary instead of being coerced to zero.

## 2.81.99 — B2 pre-dispatch lifecycle baseline

- The S1R2 live capture passed the structural field gate on all nine providers: every platform resolved exactly, was structurally complete, contained a non-empty answer, and reported generation inactive. The run itself nevertheless exported with no terminal outcomes and no lifecycle observations.
- Lifecycle tracking is now primed by the existing dispatch-baseline hook used by all nine adapters, before the provider Send interaction. This removes reliance on intercepting `PROMPT_SUBMITTED` after the click and prevents a fast provider's newly inserted assistant node from being counted as part of the previous conversation.
- The lifecycle start path captures the positional turn anchor synchronously before its first storage wait and reuses an already active tracker for the same run identity. A later submit confirmation can no longer reset the correct pre-dispatch baseline.
- Added a production-path regression that inserts the new answer before lifecycle startup finishes and proves the strict structural verification still retains `turnAnchor: 1` for the old turn.

## 2.81.98 — B2 unified lifecycle generation signal and non-empty turn resolution

- The S1R field run again produced eight exact, structurally complete answers, but lifecycle completion remained blocked on several providers while the shared B1 view already saw inactive generation.
- Response lifecycle tracking now consumes each platform's configured generation, streaming, and stop selectors through the common visibility and availability rules. Persistent generic page elements such as unrelated `.loading` nodes no longer keep platforms active unless that platform explicitly configures them.
- Turn resolution now measures candidate text with the authoritative answer linearizer. A trailing status, thinking, or service-only node cannot resolve exact merely because its raw `textContent` is non-empty; when no candidate retains the minimum answer length, resolution fails closed.
- B1 captures now include the tri-state shared generation result and its signal kind and selector, allowing subsequent calibration files to compare structure and generation without conversation text.

## 2.81.97 — B2 lifecycle structural proof and real streaming watchdog

- The first Standard B2 field run resolved all nine live pages as exact and structurally complete, while seven cards remained non-terminal because lifecycle completion delivered answer text before the unified pipeline produced a strict structural verification.
- Lifecycle completion now snapshots the same production turn resolver, structural inspector, generation detector, and four-part run identity. It applies the active profile's consecutive stability checks and bounded retry budget before attaching proof; missing modules, structure, generation state, or identity remain fail-closed.
- Background records lifecycle structural proof before evaluating the exact atomic lifecycle answer and passes the same proof into finalization. A stable lifecycle answer can therefore become verified without waiting for a slower, independent pipeline timeout.
- Removed the platform speed multiplier that silently shortened or lengthened configured timeout profiles. The streaming watchdog is now a real participant in both coordination waits and rejects at the configured hard deadline instead of merely setting a flag while promises continue indefinitely.

## 2.81.96 — B1 live DeepSeek root and merged fixture gate

- The 12:15 privacy-safe live capture confirmed DeepSeek resolves exactly and is structurally complete with a 13,205-character answer, but fixture replay exposed that the stable \`.ds-markdown\` root was not named explicitly in the platform configuration.
- DeepSeek now uses \`.ds-markdown\` as its first primary answer, message-root, and stream-start selector. The exact gate remains unchanged; the selector is backed by the sanitized live structure and survives mandatory identifier redaction.
- The B1 importer accepts multiple exports, independently privacy-validates and replays every candidate through the production resolver and structural inspector, and selects the strongest replayable exact fixture per platform before writing anything.
- Added a resolver regression derived from the sanitized DeepSeek root. Canonical fixtures are accepted only when all nine providers replay as exact and complete.

## 2.81.95 — Independent DeepSeek background privacy validation

- The first 2.81.94 export confirmed DeepSeek exact resolution in the page but was correctly rejected by the independent background gate because that gate reapplied generic redaction to the complete serialized HTML.
- Background validation now neutralizes only the same explicit DeepSeek structural namespaces accepted by the page sanitizer before probing the HTML with `SecretRedaction`. Arbitrary key-shaped `ds-*` values still change under the probe and reject the capture.
- Capture metadata is deep-redacted and compared independently from HTML, while HTML retains the placeholder-only, size, URL/token-shape, and secret-string gates.
- Added positive coverage for `ds-message-assistant`/`ds-markdown` and negative coverage for an arbitrary long `ds-*` value.

## 2.81.94 — Reproducible DeepSeek B1 skeletons

- The fourth live package passed the runtime B1 gate on all nine providers: every capture was exact, structurally complete, non-empty, privacy-validated, and below the ignored-content risk threshold.
- Replaying those sanitized skeletons exposed one remaining fixture-only defect: the generic secret redactor masked legitimate long DeepSeek `ds-*` structural class names, so the exported HTML no longer reproduced the live exact resolution.
- Identifier sanitization now preserves only explicit DeepSeek structural namespaces such as `ds-message`, `ds-assistant`, `ds-markdown`, and `ds-response`; arbitrary key-shaped `ds-*` values remain redacted.
- Added a strict B1 importer that refuses any package lacking nine private, exact, non-diagnostic, structurally complete, non-empty captures, plus a real-skeleton replay suite for the production resolver and structural inspector.
- The rejected 2.81.93 generated fixture set is not canonical. A fresh 2.81.94 export is required so the retained DeepSeek structural marker comes from the real page rather than being reconstructed or invented.

## 2.81.93 — B1 live roots for Claude and Perplexity

- The second privacy-safe live package confirmed ChatGPT's exact root after the adjacent-placeholder fix and Gemini's structural completeness after accessibility-label filtering.
- Added Claude's current live assistant-turn wrapper `div[data-is-streaming]` as a message root and its live `.font-claude-response … .standard-markdown` shapes as primary answer selectors. A finished `data-is-streaming="false"` turn now resolves exact, while `true` remains the configured active-generation signal.
- Added Perplexity's current live `[id^="markdown-content-"]` answer wrapper as the outer message root. Its nested `.prose` answer now resolves exact without promoting a generic article or page container.
- When no configured answer container exists, B1 diagnostics may sanitize only the last body child. This remains `unresolved`, diagnostic-only, and structurally incomplete; it exists solely to expose DeepSeek's current shell in the next live package.
- Added resolver fixtures derived from the captured Claude and Perplexity structures and a fail-closed body diagnostic test.

## 2.81.92 — B1 live-capture diagnostic corrections

- The first real nine-tab B1 export confirmed five exact roots (Gemini, Grok, Qwen, Le Chat, and Z.ai), exposed missing roots for Claude and Perplexity, and an unresolved DeepSeek answer node. No conversation text or session identifiers escaped either privacy gate.
- Fixed the background privacy validator to accept multiple adjacent length placeholders. The page-level gate had correctly sanitized ChatGPT, but serialized adjacent text nodes were falsely rejected as raw text by the second gate.
- Missing exact roots now produce a bounded sanitized diagnostic ancestor (or the last bounded answer-container child) while retaining `fallback`/`unresolved`, `diagnosticContext: true`, `structuralComplete: false`, and `message_root_missing`. This enables selector repair from real structure without weakening the green gate.
- An exact root with fewer than five linearized answer characters is now explicitly marked structurally incomplete in B1 evidence. This exposes the live Qwen case where only a completed thinking-status label remained and the final answer container was empty.
- Accessibility-only service labels using `sr-only`, `visually-hidden`, `screen-reader`, or `cdk-visually-hidden` classes are ignored by the common structural inspector. This removes the false Gemini `uncovered_message_blocks` result caused by its hidden model-response heading.
- Added regression tests for adjacent sanitized placeholders, bounded fallback diagnostics, exact-but-empty answers, and provider accessibility-only labels.

## 2.81.91 — B1 capture in the installed Chrome extension

- Added an explicit B1 action to both extension result panels. It collects one sanitized current-answer DOM skeleton from each of the nine already open, authorized provider tabs in the Chrome instance where the extension is installed.
- The collector never exports tab URLs, titles, tab identifiers, conversation text, or session identifiers. Every non-empty text node must be a length-only placeholder, retained attributes are structurally allowlisted and secret-redacted, and background validation rejects the whole candidate if either privacy gate fails.
- Added numeric comparison of normalized raw `textContent` against the common `linearizeText` result, including ignored length, ratio, and a conservative ignored-content risk flag. The measurements expose possible over-filtering without exporting either representation.
- The collector ranks multiple open tabs per provider by `exact` resolution, structural completeness, and answer length, while the export retains only privacy-safe error/resolution summaries for rejected attempts.
- Added background sender authorization so only the two extension result pages can start a cross-tab B1 capture.
- Added behavioral privacy, nine-provider collection, UI wiring, and ignored-content measurement tests.
- Expected calibration change: reasoning-model answers can be shorter than historical pre-2.81.87 captures because explicit thinking/reasoning containers are now intentionally excluded by the common linearizer; historical and B1/B2 answer lengths are therefore not directly comparable.

## 2.81.90 — A4 code gate: Z.ai and Le Chat message roots

- Replaced the combined nearest-match root selectors for Z.ai and Le Chat with ordered root tiers so a nested `article` or `.prose` cannot hide outer answer siblings.
- Added confirmed Z.ai message-id, assistant-role, and wrapper forms from its adapter and selector pack.
- Added confirmed Le Chat response, assistant-testid, chat-response, role, and article fallback forms from its adapter and selector pack.
- Added resolver cases for direct and wrapped Z.ai answers and three Le Chat wrapper shapes, asserting `exact` resolution and the expected outer root.
- The empirical A4 gate still requires the sanitized live skeletons in phase B1; these tests intentionally cover only structures already present in the canonical adapter code.

## 2.81.89 — A3: bounded final-stability retry budget

- Added two Standard and three Long-profile retry snapshots without reducing the required number of consecutive verified comparisons.
- A single divergent snapshot can restart the stability series and consume the bounded retry budget; persistent divergence still fails closed at the exact maximum.
- Verification telemetry records required snapshots, retry budget, actual snapshots compared, and retries used.
- Added production-method tests for mid-series divergence followed by convergence and for continuous divergence exhausting the budget.

## 2.81.88 — A2: verification provenance cleanup

- Removed the post-success audit's fabricated `verified: true` evidence object.
- A repeated late observation now identifies itself as an unverified `candidate` with an explicit structural-proof-missing reason while preserving its run identity for diagnostics.
- Added a production-tree guard that fails if any background, content-script, or shared module assigns a literal `verified: true`; verification must be derived from a snapshot or explicit manual policy.

## 2.81.87 — A1: authoritative answer text linearization

- Added one text linearizer to `AnswerStructure` and made both the completion watcher and final extractor consume it.
- The shared path removes hidden/service controls and explicit thinking, reasoning, analysis, scratch, trace, internal, and reflection containers while preserving answer text and code.
- Snapshot hashes, lengths, copy-button evidence, baseline comparison, stability streaks, and final extraction now describe the same filtered text.
- Perplexity stabilization still controls waiting but no longer supplies a separate text representation after settling.
- Added a production watcher test where a stable thinking tail cannot settle completion while the filtered final answer continues growing, plus an exact watcher/extractor equality test.

## 2.81.86 — Timing-profile race removal and effective-config evidence

- Added an explicit timing-profile readiness promise resolved only after the asynchronous storage profile has been applied.
- Pipeline execution now waits for readiness and re-locks all timing-dependent managers from the loaded profile, so construction before the storage callback cannot freeze Standard values into a Long run.
- Each pipeline records a frozen effective timing snapshot with the actual stability, mutation-idle, content-stable, and streaming hard-limit values used by that run.
- Emitted `PIPELINE_EFFECTIVE_CONFIG` telemetry distinguishes the requested/profile key from the values actually consumed and records whether storage loading completed before the lock.
- Final answer verification stores the same frozen snapshot instead of reading a possibly changed global profile later.
- Added a behavioral race test that constructs the pipeline before the delayed Long-profile callback and verifies that execution locks Long values.

## 2.81.85 — Phase 5: strict green-status projection

- `accepted` and `verified` answer states project to `complete` only when the verification state is exactly `verified`; `candidate`, `legacy_unverified`, `unknown`, `none`, and missing proof remain `verifying` or partial.
- Legacy success records without a model-run state now fail closed as `verifying` instead of inheriting a green result.
- Result indicators remove the green class for every non-success result phase; merely rendering answer text can no longer turn an unverified partial card green.
- Snapshot and automatic-upgrade proof now require explicit `resolution: exact`, `structuralComplete: true`, and `generationActive: false`; unknown generation state fails closed.
- Canonical source type alone no longer creates automatic verified evidence. Manual recovery remains an explicit, separately recorded override.
- Added contract and production UI tests for verified and every unverified projection state.

## 2.81.84 — Pre-calibration false-orange corrections

- Synchronized the optional common bundle with the structural, generation-signal, redaction, and DOM-skeleton modules used by the manifest runtime.
- Added a bundle-contract regression test so shared answer-gate dependencies cannot silently disappear from the optional two-script build.
- Structural completeness now recognizes elements hidden by computed CSS, not only inline styles and semantic attributes.
- Decorative inline SVG is ignored; SVG is treated as answer content only when it has explicit image semantics through `role`, `aria-label`, `title`, or `desc`.
- SVG animated class names are normalized before service-control marker matching.

## 2.81.83 — Phase 6 instrumentation: sanitized DOM skeletons

- Added an on-page assistant-turn skeleton capture API for live calibration without persisting conversation content.
- Every text node is replaced by a length-only placeholder; only a narrow structural attribute allowlist is retained.
- Retained attributes pass through `SecretRedaction`; URLs, values, arbitrary data attributes, scripts, styles, and long message identifiers are removed or normalized.
- Open shadow-root structure is represented explicitly while its text remains sanitized.
- Capture fails closed when secret redaction is unavailable. Tests assert that conversation text and provider-shaped secrets cannot reach the output.
- Real provider skeleton files are intentionally not invented in code: they remain a phase 7 deliverable captured from the nine authorized live tabs.

## 2.81.82 — Phase 3: authoritative generation signal

- Added one generation-signal detector shared by the completion watcher, stream-start observation, and final structural snapshots.
- Active generation is now derived from each platform's configured `generatingIndicators`, `streaming`, and `stopButton` selectors rather than a hard-coded global selector.
- A matching node counts only when it is visible and available; hidden, zero-size, disabled, `aria-disabled`, `aria-hidden`, and inert nodes are rejected.
- The final snapshot records the matched signal kind and selector for diagnostics and fails closed if the detector is unavailable.
- Added per-platform tests for all nine providers, negative tests for present-but-inactive DOM indicators, and production-path snapshot tests.

## 2.81.81 — Phase 2: recursive structural completeness

- Replaced the immediate-sibling coverage heuristic with recursive enumeration of content blocks inside the resolved assistant message root.
- Removed the `0.82` coverage threshold and the conditional conjunction that allowed small omitted blocks to pass as complete.
- Any uncovered text, code, list, table, or non-text media block now fails structural completeness; hidden UI and action controls are ignored explicitly.
- Structural inspection fails closed when the message root or selected answer is missing or detached.
- Added regression cases and a production-path snapshot test proving that artificially truncated answers never report `complete`, including tiny omissions that previously passed the ratio threshold.

## 2.81.80 — Phase 4 gate correction after independent review

- The production `acceptLateCollectResult` path now passes `turnAnchor` on both sides of automatic late-upgrade comparison.
- Incoming `runSessionId`, `dispatchId`, `generationEpoch`, and `turnAnchor` are read only from the incoming event or its verification evidence; none are synthesized from the current model entry.
- The post-success alarm captures the complete identity when scheduled and returns it with independently repeated answer evidence.
- Added production-path regression tests that inspect the exact arguments passed by `acceptLateCollectResult`: missing incoming identity remains missing, while explicitly supplied identity is forwarded unchanged.
- Aligned watcher and extractor minimum answer length at five characters, removing the remaining resolver-pool asymmetry noted in phase 1 review.

## 2.81.79 — Phase 1: authoritative turn resolver

- Added one shared `TurnResolver.resolveTurn()` path for the completion watcher, final extractor, and structural verifier.
- Added explicit `messageRoot` selectors for ChatGPT, Claude, Gemini, Grok, Perplexity, Qwen, DeepSeek, Le Chat, and Z.ai.
- Resolution is explicit: `exact`, `fallback`, or `unresolved`. Only a primary platform answer inside a matched platform message root is `exact`.
- Configured secondary candidates and container recovery remain observable fallbacks and cannot produce verified success.
- Added pinned `TURN_RESOLUTION` telemetry with selector tier, root selector, reason, and candidate count.
- Added resolver tests for all nine platform structures plus fallback and unresolved cases.

## 2.81.78 — Phase 4: strict request identity

- Automatic snapshot verification and late answer upgrades now require `runSessionId`, `dispatchId`, `generationEpoch`, and `turnAnchor` on both sides, with exact equality.
- Manual comparison retains an explicitly requested soft identity mode.
- Automatic late upgrades require both previous and incoming answer text; length-only fallback was removed.
- Dispatch generation epoch now reaches content scripts and the answer pipeline through dispatch metadata.
- Previously stored successful answers without verification proof are projected as `legacy_unverified`, not silently inherited as verified green results.
