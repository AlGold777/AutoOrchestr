# CHANGELOG — Project

### 2026-10-03 — Default to Disput, version 2.81.573

- Both pages mark Disput as the initial tab. Opening the telemetry window selects Disput by default.

### 2026-10-03 — Centered Disput Extract controls, version 2.81.572

- Extract and its selector sit in the center of the toolbar, with a blue primary button in a shared rounded group. On narrow panels they occupy a centered first row. Closed the preceding unfinished CSS rule so the Extract styles apply independently.

### 2026-10-03 — In-extension transport extraction, version 2.81.571

- Disput: Only problems is off by default. Extract and its adjacent transport selector download the full Disput Flow JSON and extract_transport JSON with the same timestamp.
- Extraction runs inside the extension using the existing deterministic digest logic, now in shared/report-digest.js. The extract JSON contains sourceFile, debateRunId, format and the Markdown digest. Both files use the same redacted snapshot; no external process is needed.

### 2026-10-03 — Remove Disput run selector, version 2.81.570

- Removed the saved-run selector and its UI handlers from both pages. Disput renders the active trace; telemetry storage, collection and exports retain their existing behavior.

### 2026-10-03 — Disput tab: complete exports, one display toggle, legacy cards removed, version 2.81.569

- **Exports are always complete.** «Only problems» (on by default) used to filter the Disput JSON and MD exports: the 2.81.567 report exported 465 of 705 events while `integrity` described all 705, and request chronologies lost their terminals. The toggle now filters the tab view only; `applyDisputOnlyProblemsFilter` is removed. Telemetry collection is unchanged.
- **Drill-down filters removed** (stage, model, event type, severity). They filtered the view only; stage filtering keyed on `correlation.stageId`, which is the attribution shown to be wrong for late records of the previous request. Request-level drill-down is done on the complete export by `scripts/summarize-report.js`.
- **Legacy cards removed:** Plan vs Actual (no compiled plan in the universal engine: `plan` null, `expected` null on every stage), Participant Matrix (`expectedStages` 0 → `0/0`; whole-run aggregate hides a lost stage answer), Critical Path & Barriers (barriers come only from the old round-4 gate; 0 in current reports; stage durations are in the delivery batches).
- Run selector placeholder reads «Current run» on both pages.
- Tests: `debate-telemetry-view`, `automation-telemetry`, `release-log-regressions`, `telemetry-export-actions` updated (not run in this change).

### 2026-10-03 — Report digest script: request-level chronology and field paths, version 2.81.568

- `scripts/summarize-report.js` now carries the requirements of the transport investigation, so the model no longer computes them. For a Disput Flow export it prints field paths (`events[N]`, `delivery.journal[N]`, `diagnoses[N]`), marks computed values `calc:`, and keeps "no field", null, `""`, `[]` and 0 records apart.
- Each transport request (model × batch, `requestId`) is an attempt. Events join it by `requestId`, then by `dispatchId`; a join by `stageId` + model only is labelled. A `dispatchId` recorded under a later request is shown as foreign: in the 2.81.567 report the stage-4 DeepSeek `CONTEXT_LOST` carries the stage-3 dispatch.
- New sections: data sufficiency (`events[]` filtered against `integrity.eventsTotal`, plan, truncated prompts), identity map, attempts with all terminals and first/last delays, full chronology of problem attempts including `LEGACY_DIAGNOSTIC_EVENT`, text lengths before submit or equal to the previous answer, answer lengths per measurement point, manual/moderator counts, start refusals (no invented lock duration), focus within first text → final, records outside the run window, the answer found in a later stored prompt, field disagreements, and the embedded `delivery` section.
- Median is the true median (mean of the two middle values); `LONG` is > 3 × median or > 120000 ms.
- `docs/report-analysis-prompt.md`: JSON → script → a short prompt that only checks the script output, labelling each statement as fact / calculation / hypothesis / insufficient data.
- Tests: `tests/summarize-report.test.js` updated for the new Disput Flow output and a delivery-section case (not run in this change).

### 2026-10-02 — Preserve round identity across recovered and deferred answers, version 2.81.567

- The field report from 2.81.564 ends with two copies of Gemini's stage-three answer. Round/run identity is now stored on each background model entry and carried by live deliveries, manual recovery and global-state snapshots, so the badge also survives a panel reload without its in-memory waiter registry.
- Global-state hydration applies the persisted answer status and round. An already displayed or approved recovery card without a round can receive its badge later through the same request identity; the existing card and paragraphs are retained instead of creating a duplicate.
- Deferred manual-mode answers retain their delivery metadata when Get it displays them, so an earlier round's answer cannot be attached to the latest completed round.
- Tests: recovered Gemini R3 followed by repeated manual/final delivery and paragraph growth, late round identity on an approved card, deferred cross-round replay, producing-entry identity and storage compaction.

### 2026-10-02 — Keep round badges on incomplete recovered answers, version 2.81.566

- Manual answer recovery now carries the model entry's transport identity through to the feed, so an incomplete recovered answer displays its actual round badge (for example, `DeepSeek R3 uncompleted`). Unverified global-state recovery also preserves that identity.
- The incomplete label is `uncompleted` and sits immediately after the round badge. A terminal status updates this label even when it repeats text already shown or approved; a complete response removes the label and retains the round.
- Tests: runtime manual recovery for DeepSeek R3, repeated terminal delivery, adopted incomplete answers, marker removal after completion, and recovery card preservation.

### 2026-10-02 — Increase pipeline round badge text size, version 2.81.565

- The circular `R1` badge text increases to 11px at weight 600; the badge grows from 22px to 24px to keep the label centered.

### 2026-10-02 — Round badges and one answer card per model per round, version 2.81.564

- The pipeline feed shows a compact circular `R1`, `R2`, … badge immediately after the model name, including approved and restored cards.
- Each round is one request. Its transport identity remains associated with the round after the answer waiter closes; partial, final and recovery deliveries reuse the same model/round card. Identical answers in different rounds stay separate, and a late continuation of R1 cannot update R2.
- Post-completion growth appends the new content as another paragraph in the original card, preserving its earlier paragraphs and rich formatting. Repeated and shorter copies add nothing; corrections continue to use the existing update popover.
- Tests: `results-debate-favorites` (runtime deliveries, multiple continuations, round/run isolation, adopted answers, duplicate cleanup, restore), `pipeline-feed-layout`, `debate-engine`, `debate-export`, pipeline waiters.

### 2026-10-02 — Telemetry: the Automation tab is merged into Disput, version 2.81.563

- **One tab, one report.** The delivery cards (Delivery Health, Delivery Batches, Delivery Problems, Message Timeline, Raw Delivery Events) moved from the Automation tab into the Disput tab; the Automation tab is removed. The Disput model filter, «Only problems» and Clear drive them too (Clear also empties the delivery journal). A remembered Automation tab opens Disput.
- **Export.** The Disput Flow JSON gets a `delivery` section — the former message-delivery report (`diagnosis.batches/sends/problems/matrix`, `journal`, versions); the MD export gets a «Delivery» section (Batches, Sends, Problems tables). The export also works when there is only delivery data.
- Code: `shared/message-delivery-view.js` (renders into `#disput-tabpanel`, exposes `MessageDeliveryView.buildReport/buildMarkdown/render`), `results.js` (Disput export handlers, tab memory), `results-devtools.js`, `styles/devtools-selectors.css`, `pipeline_panel.html`. Docs: `docs/message-delivery.md`.
- Tests: `automation-telemetry` (cards in the Disput tab, export section, MD), `release-log-regressions`.

### 2026-10-02 — The top bar of the pipeline panel matches the main page again, version 2.81.562

- **Cause.** Version 2.81.545 widened `.main-inner` on the pipeline page, and the top bar lives in it: the bar was 1248px wide at x=96 instead of 948px at x=246, so it jumped when switching pages.
- **Fix.** `.main-inner` is no longer touched. Only the composer (and the feed in it) is wider: `.pipeline-page .app-main` is an inline-size container and the composer is `min(1280px, 100cqw - 32px)` wide, centered on the page column (open sidebars cannot be overlapped; the overlay of the expanded feed is excluded).
- **Verified in the browser** (1440px): bar `[246, 12, 948, 77]` on both pages, same left/middle/right blocks; composer 1280px at x=80, no horizontal scroll; at 1100px and with the left sidebar open the composer stays inside the column. The collapsed state is unchanged.
- Tests: `pipeline-feed-layout`.

### 2026-10-02 — Perplexity: a stale transaction no longer blocks the next stage; digest per model, version 2.81.560

- Field report (Disput Flow 2.81.555, DeepSeek + Perplexity): I had looked at the longest stage (DeepSeek, 36 min) and treated Perplexity as "a known delivery failure". Its events show a precise mechanism: after the first prompt the page moves to a new thread URL, the content script's context is lost (`CONTEXT_LOST`, "message port closed"), the answer (1648 characters) is found by the inline DOM scan at 19 s but its success waits for a lifecycle that cannot come — accepted only when the person pressed manual recovery (21.7 s). Worse: the dispatch gate of the Perplexity script (`createDispatchGate`) kept stage 1's transaction forever, so stage 2's prompt was refused (`PERPLEXITY_CONCURRENT_DISPATCH_REJECTED: different request while provider transaction active`) — it was never sent, `PIPELINE_ERROR`, `terminal_quarantine`, and Perplexity dropped out of the run; the person pressed manual recovery again.
- `createDispatchGate.begin`: a dispatch of a **later run start** (dispatch ids are `<model>:<run start ms>:<n>`) replaces the active transaction of an earlier one (`supersededDispatchId` is returned; the old request finishing late cannot close the new transaction). A parallel request inside the same run, a duplicate prompt and an older dispatch are refused as before.
- Not fixed (open): the first step — after the navigation the success of an answer found by the inline scan is deferred "awaiting lifecycle"; without a person it would be closed by the deferral rules (~30 s of quiet text) instead of at once.
- `scripts/summarize-report.js`: the digest is now per model — a table with one line per model (stages, finals per stage, manual recoveries, stage failures, forced stable-text completions, the stage after which the model dropped out) and the notable events of every model that failed or needed a manual recovery (noise removed, repeats collapsed). Before it followed the longest stage and hid the model that dropped out.
- Tests: `perplexity-composer-transaction`, `summarize-report`.

### 2026-10-02 — Report digest script for both report formats, version 2.81.559

- The analysis prompt written for a weaker model (2.81.529) fitted only the message-delivery report; on a Disput Flow export it answered "нет данных" almost everywhere. New `scripts/summarize-report.js` (`node scripts/summarize-report.js "<report>.json"`) builds the digest deterministically for both formats: stages with start/end/duration/**gap to the next**, per stage and model the offsets of the first stable text, completion, terminals, forced stable-text completion, barrier waits and manual recoveries, **text that stood still > 2 min before the terminal**, diagnoses, integrity; for delivery reports batches with the gap before each and start refusals, sends, grouped problems, engine and moderator events. Facts only, no causes.
- Applied to the 2.81.555 Disput Flow export it shows that DeepSeek's text in stage 3 was stable from +16 s while the stage took 36.7 min (the case behind the 3-minute stall rule of 2.81.558).
- `docs/report-analysis-prompt.md` now leads with the script; the model prompt is kept as a fallback and distinguishes the two formats with the real field paths.
- Tests: `summarize-report`.

### 2026-10-02 — Merge of the feed card work, version 2.81.558

- Integrates the parallel feed changes (an adopted still-printing answer keeps growing in its own card) with the stall rule; no behavior changes beyond that.

### 2026-10-02 — An auto stage no longer hangs on a model whose text has stopped, version 2.81.558

- Field report (Disput Flow export, 2.81.555, DeepSeek + Perplexity, 4 stages): stage 3 took **36 minutes** with DeepSeek alone. The background's own "stable text" completion (`FORCED_STABLE_TEXT_COMPLETION`, 2696 characters, `busy=true` — the stuck-indicator glitch) fired at minute 19, yet the stage waited another 17 minutes (hard stop, `PARTIAL`, forced success) and a person pressed manual recovery eight times.
- The stage wait now closes itself in **Auto** flows: when every model that has not answered shows text that has **not changed for 3 minutes** (`pipelineWaiter.adoptStalled`, checked every 15 s), the wait is closed with that text (incomplete, unproven — like the moderator's Pause). A model with no text yet (still thinking) is never cut, a model whose text still grows keeps its clock, and in the semi-automatic mode the human decides. Journal `stall_adopted`; batch outcome `stalled_with_text`; a notification names the models.
- Not changed: why DeepSeek's completion is not recognised while its spinner is stuck (the background rules); Perplexity's `PIPELINE_ERROR` / `CONTEXT_LOST` in stage 2; `UI_PROJECTION_FAILED panel not found` (the pipeline page has no per-model panels — harmless).
- Tests: `pipeline-semi-auto` (waiter stall rule).
### 2026-10-02 — An adopted, still-printing answer keeps growing in its own card, version 2.81.555

- **Cause.** Next/Pause adopt the text shown in the feed: the card becomes `approved` while the model is still printing (`turnClosed=false`). The live path skips approved cards, the post-completion path needed a closed card — so every further chunk of the same answer opened a new card.
- **Fix** (`appendPostTerminalAnswerRevision`): an approved or starred card counts as settled like a closed one. A newer text of the same request replaces the provisional text of an adopted, still-printing card in place (streaming markdown is not a strict prefix); the final closes it (printing chip off, `turnClosed=true`). A closed card keeps the earlier rules (same/shorter → ignored, continuation → grows, changed text → Δ badge).
- Tests: `results-debate-favorites` («adopted while still printing»; fails on 2.81.554 with two cards).

\n### 2026-10-02 — A repeat of a model answer no longer makes a new card or a Δ badge, version 2.81.553

- **Cause.** The «is this answer already shown» check compared the *raw* incoming text with the card's *rendered* text (markdown markers, list numbering), so an identical answer looked different (Δ -26, Δ -274 …). In addition a repeat under another request id (recovery, late partial, re-send) was not matched to the closed card and opened a second «printing» card.
- **Fix** (`appendPostTerminalAnswerRevision`): the incoming text is rendered through the same renderer as the card body and compared as the reader sees it. The same text, or an older/shorter copy of it → ignored; a continuation → the same card grows; only a text that changes what is shown → the Δ badge (Δ is now computed on the rendered texts). A repeat under another request id is attached to the closed card it repeats.
- Left as is: a *different* text under another request id still opens a card (second request to a model inside a round is for later).
- Tests: `results-debate-favorites` (markdown repeat, other request ids, shorter copy, growth).

# 2026-10-02 — The models see "User" instead of "Moderator" in prompts, version 2.81.552

- Text sent to the models: the author header of the moderator message (`User\n…`, was `Moderator\n…`), the action lines (`User action: …`), the judge prompt header («Вопрос пользователя»), and the texts of the pipeline action chips `[USER CHALLENGE]`, `[USER EVIDENCE REQUEST]`, `[ПОЛЬЗОВАТЕЛЬ — КОРРЕКЦИЯ]` (`disput/pipeline-actions.json`; their chip group is «User» and the correction chip «Пользователь — коррекция»; ids unchanged).
- Not changed: internal ids and event kinds (`Moderator`, `moderator_*`), the judge role wording «Ты судья», and the gate descriptions of the Architecture template (they are for the owner, the model is not started on a gate).

### 2026-10-02 — "~ Lead ~" on the main page too, version 2.81.551

- The R2 stage label of the main page (`result_new.html`) reads "~ Lead ~" instead of "Judge". The stage detection in `results.js` (`isJudge`) now also matches "lead", so clicking the label keeps working. «Moderator» does not occur on the main page.

### 2026-10-02 — "Moderator" is shown as "User", version 2.81.550

- Display name only: the author name on moderator cards (turn cards and the live moderator entry in `results.js`) and the "Moderator" sender option. Internal values (`Moderator` as `llmName`, route sender, transcript events, `kind: 'moderator'`) and the text sent to the models (`Moderator\n…`, `Moderator action: …`) are unchanged.

### 2026-10-02 — The "Judge" model is shown as "~ Lead ~", version 2.81.549

- Display name only: the selector option and its aria-label (`pipeline_panel.html`), the placeholder option, the card role label and the role of the verdict card (`results.js`). Identifiers (`#judge-select`, `judge*` functions, `source: 'judge'`, stored selector state) and the text of the judge prompts are unchanged. The main page (`result_new.html`, stage label R2) is not touched: its label is also read by stage detection.

### 2026-10-02 — One message per model per round: growth extends the card, version 2.81.548

- Every Run press is a new round; inside a round a model has **one card**. When a later text of the model **continues the shown answer** (the new text starts with it, whitespace-normalized), the same card is extended in place: longer body, updated time, the stored message is patched. No second card, no badge.
- A text that **changes** what is shown (not a continuation) still goes to the update badge; the badge icon is now `Δ N` (was `↻ N`).
- The transport result stays immutable (the batch keeps the accepted answer); only the feed card shows the extended text. A second request to the same model inside one round is left for later (after the automation work).
- Tests: `results-debate-favorites` (extension in place, badge for replaced text).

### 2026-10-02 — Post-completion updates collected into one badge, version 2.81.547

- The technical «Updated · Source · Δ N» lines no longer sit in the card header one by one. A card with updates after completion gets **one badge** `↻ N`, placed right of the message time (it follows the time when the card is approved and the time moves next to the name). A click opens a popover with **one tab per update** (`1 · Recovery · Δ -274`, source cut to 20 chars + `...`, full wording in the tooltip and as the first line of the tab); the newest update is shown first. Click outside or Esc closes it.
- Dedupe of repeated updates is unchanged (`.post-terminal-answer-revision[data-revision-hash]`, now `div` entries inside the popover).
- Tests: `results-debate-favorites` (badge, tabs, close), `pipeline-feed-layout` (styles).

### 2026-10-02 — No dead time between auto stages; no false alarms for delivered answers, version 2.81.554

- Field report (10) (Auto, Test, Gemini + Grok): the flow worked — two stages, the run completed by itself, no pause needed. But stage 2 waited **19 s** to start: the background refused it four times with `RUN_ALREADY_ACTIVE` (its own rounds were still "in progress") although the panel had every final of stage 1. Cause: the background's automatic Get-it pass (`allModels`) visited and re-read **every** model after the rounds — about 10 s per model — even those that had answered successfully; the re-read answers then came back as `identity_rejected: unknown_request` (late repeats of stage 1). Over a 26-stage template that is minutes of waiting.
- In a pipeline stage the automatic pass now visits only models that need recovery (not SUCCESS, or no answer). The main page keeps its all-model automatic pass (deliberate earlier decision, tested) and a manual Get it still re-reads everyone.
- Report: a repeat of an already delivered answer (`unknown_request`, `batch_settled`, `duplicate_terminal`, `revision_after_terminal`) is the info `late_duplicate`, not the warning `identity`; many tab switches on a delivered answer are the info `focus_moves`, not `focus_churn` ("the answer was never accepted" was shown for answers that were delivered). Real rejections and undelivered answers still warn.
- Not changed: the ~6 s the engine itself spends between two stages (planning, artifact extraction).
- Tests: `get-it-bottom`, `message-delivery-semi-auto`.

### 2026-10-02 — Merge of the pipeline page width work, version 2.81.546

- Integrates the parallel layout changes (2.81.544–2.81.545: feed back inside the composer, wider working column) with the Run-button flow work; no behavior changes beyond that.

### 2026-10-02 — The Run button follows the rounds of an auto flow, and the flow can end, version 2.81.546

- Checked the button along a whole flow on the real engine (`pause-resume`): Run → **pause** during every round and between rounds (pressing it works also between rounds) → **Run** (resume) while paused, also when pressed before the paused round has ended → after the last round **Run** again.
- Found and fixed: in semi-automatic runs (Auto off) after the last round the engine stayed `RUNNING` doing nothing while the button showed "continue" and then "next"; a new run was refused ("Pipeline уже выполняется"). The engine now reports `idle` (RUNNING, no loop, no active stage, no question for a human) and emits `RUN_IDLE` so the page refreshes: an idle engine is not a live run for the button — it shows Run, and a new run closes the idle one (`requestCancel`, reason `new_run`) and starts. Auto already ended as `completed` (finalization after the required goals).
- Pause between rounds (no round open) says so instead of "models have shown nothing".
- Tests: `pause-resume` (button states along an auto flow; idle engine in a semi-automatic flow; page wiring).
### 2026-10-02 — Pipeline page: wider working column, version 2.81.545

- `.prompt-container.prompt-sandwich` (and the feed in it) is wider on the pipeline page: `--pipeline-main-max-width: 1280px` (was the global 980px). The width of the composer is set by its parent `.main-inner`, so the cap is raised there and on the composer itself; the column still shrinks with the sidebars. The top bar shares the column, so it is wider as well. The feed no longer uses a viewport-width trick.
- Tests: `pipeline-feed-layout`.

### 2026-10-02 — Pipeline feed back inside the composer, version 2.81.544

- Removed the full-viewport widening of `.pipeline-page .debate-model-cards` (`width: 100vw` + `margin-left: calc(50% - 50vw)`, added in `0cdf930`): the feed content stuck out of `.prompt-container.prompt-sandwich`. The feed again takes the width of its container.
- Tests: `pipeline-feed-layout`.

### 2026-10-02 — Pause takes the answers shown in the feed, version 2.81.543

- Field report: pressing Pause while the feed already showed answers said "Модели ещё ничего не показали: пауза после раунда". Pause (and "next") looked only at the round's wait, which gets text that is still arriving only through partial messages that carry the transport request id; the text in the feed never reached it.
- Before closing the round, Pause and "next" now take the text of each silent model's **live feed card** (same session, not closed, not approved — the card the feed itself updates in place; closed cards of earlier rounds are never used) into the wait (`harvestFeedAnswersForOpenRound`, `pipelineWaiter.supplyPartial`). Such text is adopted as incomplete and unproven, like other partial text; a real final that arrives first still wins. The journal event `moderator_pause` lists `fromFeed`.
- Tests: `results-debate-favorites` (real page harness: a feed answer reaches the wait, the round closes with it, a closed card is not taken), `pause-resume`.

### 2026-10-02 — Pause closes the round; Run after it starts the next round, version 2.81.542

- **The manual hand-over to the next round did not work.** Agreed mechanism: while a round is active the Run button is "pause"; the moderator who finds the answers in the feed good enough presses it, the round stops, the button is "Run" again and pressing it starts the next round. Two defects: (1) Pause only asked the engine to pause *after* the running stage and did not stop the round's wait, so the round went on waiting for every model; (2) in the engine a pause requested while a stage ran left the run `QUIESCING` forever (`quiescePromise` was never assigned): after the round ended nothing completed the pause, the button showed Run, and "Continue" answered `NOT_PAUSED` — nothing started.
- Engine: a requested pause now ends (`PAUSED`, `RUN_PAUSED`) when the running stage is done (`finishRequestedPause` / `completePauseIfQuiesced` in the run loop). `DebateApplication.resume()` pressed while the stage is still finishing waits for the pause and then continues.
- Page: Pause closes the running round with the answers the models have shown so far (finals; text still arriving is taken as incomplete and unproven; models with nothing yet are skipped for this round only), journals `moderator_pause`, then pauses. With Auto off the "next" button already closed the round and the engine paused after the stage. Run after the pause continues with the next round (in Auto the remaining rounds then go on by themselves until the next stop).
- Tests: `pause-resume` (real engine; fails on the old orchestrator).

### 2026-10-02 — The moderator input is emptied after the message is sent, version 2.81.541

- Starting a run with Run took the input text as the run's task (it shows up in the feed) but left it in the input. The input is now emptied when the run starts (the manual moderator dispatch already did this). If the run cannot start (rejected start or an error other than a cancel) the text is put back, only into an empty input — never over text typed since.
- Tests: `pipeline-semi-auto`.

### 2026-10-02 — No model is selected by default, version 2.81.540

- Claude and GPT were pre-selected on the pipeline page from two places: the pipeline runtime (`defaultActive` of the first two models) and the built-in templates (`defaultModelCount` 2–3 selected the first models in the header when a template was applied). Both are gone: no model is active by default and the built-in templates store no models.
- Applying a template whose stored model list is empty no longer touches the moderator's own selection (before, applying a template replaced it); a saved pipeline with stored models still restores them.
- Tests: `pipeline-semi-auto`, `results-debate-favorites` ("no model is selected by default").

### 2026-10-02 — Run button no longer shows pause/resume/approve without a real run, version 2.81.539

- Field report: right after opening the pipeline page (no models chosen) the Run button was already in the pause state and stayed so. The state of the run aggregate (`pause`, `awaiting_approval`, an approval waiter) was read as a live run although nothing had run on this page — a phantom state. In the page test harness the same phantom appeared as "approve" after other tests had left the aggregate in `awaiting_approval`.
- `getDebateRunControls` now derives the controls from an idle aggregate whenever no run exists on the page (none started here and no engine): Run stays "Run debate", the click starts a run. The first phantom state is logged (`console.warn`, journal event `ui_phantom_state` with the status and run id) so its source can be found; the guard does not hide real runs (a started run or an engine, including an engine paused by itself, is shown as before).
- Not found yet: which code path puts the aggregate into that state at load. Suspects: an answer restored from the background's global state at load opening an approval request. `ui_phantom_state` in the report names the status.
- Tests: `pipeline-semi-auto`; the "fresh page" Run test in `results-debate-favorites` now passes in the full file.

### 2026-10-02 — Run button works on the first click; New pages is switched off when the run starts, version 2.81.538

- **First click on Run was lost.** When the feed overflows, the moderator input shrinks to one line as soon as it loses the focus (`#modTa:not(:focus)`, compact input). Pressing Run takes the focus out of the input, the input shrinks, the buttons below it move up from under the pointer and the click never happens; the second click worked because the input was already compact. Pressing a button in the composer header now keeps the focus in the input (`mousedown` default prevented for buttons; the click is unaffected).
- **New pages** is switched off at the moment the run starts (the first dispatch uses its value from the run context; later stages continue in the pages that were opened). Before, it was switched off only after the background acknowledged the first dispatch with `process_started`; if that did not happen the box stayed checked.
- Tests: `pipeline-semi-auto`.

### 2026-10-02 — The Run button no longer shows "pause" after a reload, version 2.81.537

- At page load a Debate run that was left unfinished (a run stuck by the earlier dropout defect, a run paused by the engine, a closed page) was adopted as a **technical pause**: the Run button showed "pause" right after the reload, before any model was chosen, and kept it when models were selected; its "Continue" only restarted the run. The unfinished run is now dropped at load (`clearRecovery`, console info `Unfinished Debate run dropped at page load`) and the button stays "Run". Since the engine now pauses by itself (after stages, gates, questions), such runs are common.
- Tests: `pipeline-semi-auto`.

### 2026-10-02 — Merge of the pipeline panel layout work, version 2.81.536

- Integrates the parallel layout change (2.81.535: collapsed top bar spacing, duplicate pause button removed) with the dropout/DeepSeek fixes; no behavior changes beyond that.

### 2026-10-02 — A dropped participant no longer freezes the run; DeepSeek send confirmation; text_lost, version 2.81.536

- Field report (9) (Auto, Universal, Grok + DeepSeek): stage 1 ended with Grok delivered and DeepSeek `NO_SEND`; then the run stood still — no pause, no message, no stage 2 (the run button stayed in "pause", Start did nothing). Cause: the planner treats a participant that dropped out of the run (terminal transport failure) as unavailable and answered every later stage that named it with `WAIT: PLANNED_STAGE_PARTICIPANT_UNAVAILABLE`, which the run loop swallowed.
- Planner: a dropped participant is **removed from the stage** and the stage goes on with the participants that are left (`PARTICIPANT_DROPPED:<id>` in the decision notes). If nobody is left for the stage, the engine pauses visibly: `RUN_PAUSED` with `reason: participants_unavailable` (notification, journal `run_paused`, problem `participants_unavailable`); Continue retries.
- DeepSeek: after the first message of a new chat the page moves to `/a/chat/s/<id>` and replaces the composer, so the old input is detached and never "empty" — the send was reported "not confirmed" although the page navigated and the answer came (2995 characters at 55 s, then `NO_SEND` at 204 s). A new chat address or a detached composer now counts as a confirmed send.
- Delivery report: new problem `text_lost` (critical) — an empty terminal although text had been received (size, time, terminal status).
- Not fixed (open): the background still can close a request as `NO_SEND` with empty text after text was seen; `text_lost` makes it visible, Get it recovers the answer.
- Tests: `automation-markers` (dropout on the real engine, with a mutation check), `message-delivery-semi-auto` (`text_lost`, DeepSeek).
### 2026-10-02 — Pipeline panel: spacing of the collapsed top bar, no duplicate pause button, version 2.81.535

- **Removed `#debate-auto-pause-btn`** from `.debate-session-actions`: a leftover of the old Disput. The main Run button (`#debate-run-toggle-btn`) already pauses and resumes through the same `setDebatePausedState` (`DebateController.deriveRunControls`: running + auto → `pause`, paused → `resume`). The JS handlers stay null-safe.
- **Collapsed top bar:** 14px between model icons; the session actions keep a 14px margin before the sidebar toggle icons; the bar sits 7px closer to the screen edge (`top: 5px`, `margin-top: -7px`) and 7px closer to the input section (`margin-bottom: -11px`). The gain given to the feed box now counts the bar margins too.
- **Compact input:** `.msg-header` loses 4px of vertical padding (6/4 → 2/0).
- Tests: `pipeline-feed-layout`.

### 2026-10-02 — "None" in the mini prompt list of a round's model block, version 2.81.533

- The list of preset mini prompts in a model block of a round has a first item **None**: nothing is attached to that block's round. The choice is stored with the pipeline (a prompt id, or no role for None), restored when the pipeline is applied and kept when the blocks are rebuilt (changing the selected models no longer resets a block's choice — an empty choice used to be lost).
- None is the default of every **new block and new round** (version 2.81.534). **Universal** and **Test** also start with None in every round (flag `noMiniPrompts` in `BUILTIN_PIPELINE_DEFINITIONS`); Research and Red Team keep their stored prompts; the Architecture template always uses None because each stage carries its own brief. Built-in pipelines are canonical (re-created on load); to keep changed choices, save the pipeline under its own name.
- Tests: `pipeline-none-mini-prompt`.

### 2026-10-02 — Merge of the pipeline feed layout work, version 2.81.532

- Integrates the parallel layout changes (2.81.530–2.81.531: taller feed, short post-terminal revision label) with the answer-tail fix; no behavior changes beyond that.

### 2026-10-02 — Answers with provider chrome after the token are no longer rejected as "cut off", version 2.81.532

- Field report (8) (Auto, template Test, Le Chat + Perplexity): the run did **not** go to round 7 — there were two stages; the 7 was the number of batches. Le Chat's answers were rejected by `DebateResponseAcceptance` as `incomplete_ending` (the repair prompt says so): Le Chat appends the time after the delivery token (`[[AO-…]] 8:55pm`), the token was stripped and the answer ended in `8:55pm`. Each stage cost Le Chat 3 calls (answer, repair, retry) and still failed; with Perplexity's real delivery failure the stage failed and the new `stage_failed` pause fired correctly.
- `MessageDelivery.clean` drops a short tail (≤ 40 characters) after the token on its line. The ending heuristic is skipped for a transport-complete answer (`completion: 'complete'` — the token proves the answer ended); other rules (empty, too long, truncation markers, sections) still apply.
- Every rejected attempt is journaled as `response_rejected` (model, stage, attempt, reason, chars) and grouped in the report as the problem `response_rejected` with the count — the delivery report did not say why an answer was rejected. `docs/report-analysis-prompt.md` asks for these.
- Tests: `response-tail-acceptance`.
### 2026-10-02 — Short post-terminal revision label in the card header, version 2.81.531

- The «Ответ обновлён после завершения · SOURCE · Δ N» line overflowed the card header. Now the header shows `Updated · <source> · Δ N`: the source is humanized (`GLOBAL_STATE_ANSWER_RECOVERY` → `Recovery`) and cut to 20 characters plus `...`; the summary is one line with an ellipsis. The full original wording is the tooltip and the first line of the expanded revision body.
- Tests: `results-debate-favorites` (revision label), `pipeline-feed-layout` (shortening, CSS).

### 2026-10-02 — Pipeline panel: a taller feed (no session tabs, compact input, collapsing top bar), version 2.81.530

- **Session tabs removed** from the panel. `.debate-session-bar` now holds only `.debate-session-actions` (pause, copy, export, clear — each acts on the current session). The tab/add/delete nodes stay in the DOM, hidden, as the session state holder: `results.js` reads the active session id from `.debate-session-tab.active`. Session switching will live in the left sidebar.
- **Step 1 — input.** When the feed content is taller than its box, the moderator input drops to one line (it still grows while focused). Hysteresis: the one-line state is kept until the content fits the default box with a margin.
- **Step 2 — top bar.** If it still overflows and the feed is scrolled down, `top-control-bar` collapses: `.logo-badge` and model labels hide, icons tighten, `.debate-session-actions` moves into the right button group; the feed box grows by the measured height (`--pipeline-top-gain`). Back at the top of the feed the bar and the actions return. Controller: `debateFeedLayout` in `results.js`; it only toggles classes and a CSS variable (no scrolling, focusing or page visits), so it adds no liveness/progress signal.
- **Live signal in the card header.** The `[Model] printing` line no longer sits under the answer text: it is a short `printing` chip in `.debate-model-card-header` (one line, ellipsis; full text in the tooltip).
- Tests: `pipeline-feed-layout` (markup, styles, controller with mocked layout).

### 2026-10-01 — Automation: stops between stages, failed-stage stop, control markers, owner questions, version 2.81.529

- **Correction.** The universal engine never paused between stages: `runLoop` ran every planned stage in one go and the Auto toggle only chose the finalization mode (probe: 3 stages, Auto off → 3 stages in one run). The earlier statements "with Auto off the engine waits for approval between stages" (2.81.521, 2.81.524, `project-overview`) were wrong; the semi-automatic buttons (Get it, "next") only worked inside one running stage. A second defect: a stage nobody answered was re-queued by the planner until the step budget ended (60 model calls for 3 stages × 2 models).
- **Stage pause policy** `policies.stagePause = never | every_stage | gates` (default `never`, existing runs unchanged). After the stages of a planner step the orchestrator pauses itself (`PAUSED`, event `RUN_PAUSED` with `reason` = `stage_done` | `gate` | `ask` | `stage_failed`); **Continue** is the existing `requestContinue`. The page derives the policy from the run mode: Auto off → `every_stage`, Auto on → `gates` (the stage before a template gate carries `meta.gateAfter`: stages 12, 16, 21, 29 → G1–G4). `RUN_PAUSED` by the engine sets the aggregate to `paused` (the existing Continue control) and calls `onEnginePause`.
- **Failed stage**: no accepted answer → pause `stage_failed` (no blind re-queue); Continue repeats the stage once. Bounded: one attempt = one batch plus one retry per model.
- **Markers** (`disput/stage-markers.js`): besides the delivery token `[[AO-xxxxxx]]` two markers, as lines of their own (code fences and quotes ignored): `[[ASK: question]]` (≤ 3, deduplicated) and `[[VERDICT: pass|issues_found]]` (review stages). The executor parses accepted answers; the stage keeps `asks`, `verdict`, `failedParticipants`. Template stage prompts get the instruction for the markers.
- **Question for the owner**: an answer with `[[ASK:]]` pauses the run (`ask`) and opens the dialog «Вопрос владельцу» (answer / continue without answer / later); the answers go into the next stages' prompts as the current human instruction.
- Telemetry: journal events `run_paused`, `owner_answer`; problem `stage_failed`; `diagnosis.moderator` lists them. Plan and acceptance: `docs/automation-plan.md`.
- Tests: `automation-markers` (real engine: pause modes, failed-stage bound, ASK, application hook; markers; owner dialog helpers).

### 2026-10-01 — Template «Разработка архитектуры» on the canvas and stage cards, version 2.81.528

- New built-in pipeline **Architecture** (semi-automatic by default): the 30-stage Product→Architecture Framework (`docs/Automation GPT комплект Документов`) as 30 canvas rounds; the round number is the framework stage number. The catalogue `disput/architecture-framework.js` is generated by `node scripts/build-architecture-framework.js` from `process/stages.json` (a test fails when it is stale). Who works at a stage follows the framework: independent stages — all selected models; Producer / Synthesizer / Decision Closer — the first selected model; Reviewer / Verifier — the next one (never the author when there are two or more); the four gates G1–G4 (stages 13, 17, 22, 30) have no models and are moderator checkpoints (with Auto on the engine does not stop at them; the default is manual). The number of stages is fixed by the template (the round stepper says so).
- The stage brief travels with the plan: `DraftPlan` keeps `instruction`/`meta`, the planner and orchestrator hand it to the stage instance, the panel compiles it as the action instruction of the prompt (the opening prompt now has a «Задание этапа» block). A real-engine test runs a template plan: gates skipped, assignment respected, every stage prompt carries its own brief.
- **Stage card**: a click (or double click) on a round badge opens the card — stage title and phase, purpose, who works / does not take part, inputs, what to do, what is forbidden, rules, the brief the model receives (copy button) and the run status of that stage. Plain rounds show their participants. New `results/stage-card.js` (pure model + textContent rendering).
- Tests: `architecture-template`, `pipeline-semi-auto`, `pipeline-presets`.

### 2026-10-01 — "Next" adopts shown text; no automatic visits in moderator-driven runs, version 2.81.527

- Moderator-driven runs (semi-automatic with a template, manual dispatch) no longer get the system's own automatic page visits: the panel sends `runMode` with the batch and `runForcedAutomationVisits` skips them (`FORCED_VISIT_SKIPPED: moderator_driven_run`); Get it / double click stay the way to pull an answer.
- "Next" now also closes a stage with text that is shown but has no final (answers recovered from the background state): such answers are adopted as incomplete and unproven (`MODERATOR_ACCEPTED`), after a confirmation that names them; a real final before the close still wins. This is the case from field report (5) — Perplexity's answer was on the page and in the feed but never reached the stage wait.
- Merge of the pipeline layout polish (2.81.522–2.81.524) is in 2.81.526.
- Tests: `pipeline-semi-auto`. Spec status: `docs/telemetry-semi-auto-spec.md` (T6 done).

### 2026-10-01 — Merge of the pipeline layout polish into the semi-automatic work, version 2.81.526

- Integrates the cosmetic pipeline spacing/feed-height changes (2.81.522–2.81.524, made in parallel) with the semi-automatic series 2.81.521–2.81.525; no behavior changes beyond that.

### 2026-10-01 — Delivery report for the semi-automatic pipeline, version 2.81.525

- The report no longer trusts only the delivery journal. An answer written into a card from the background global state (`hydrateAnswerFromGlobalState`) is journaled as `displayed` (source, length, whether it was final, whether the open stage wait accepted it and why not). A request that is shown but not accepted by the wait is the new problem `display_desync` (it replaces the bare "Ответ ещё не получен" for that request). Field report (5): Perplexity answered long before the report, the card showed it, the wait never received it.
- `batch_start` carries `runMode` (`auto` / `semi_auto` / `manual_dispatch`) and the template name; a manual moderator dispatch is `manual:aN` instead of `unscoped:aN`.
- Moderator actions are journaled and returned in `diagnosis.moderator`: `moderator_get_it` (+ `get_it_result` per model), `moderator_stage_close`, `moderator_close_refused`, `moderator_approve`. The batch outcome `moderator_closed` is shown as such with the skipped models, not as a timeout.
- Problems carry `ageMs`; a plain "waiting" names the last observed fact (status, text length and time, what was shown).
- Not done yet from `docs/telemetry-semi-auto-spec.md`: T2 (screen snapshot at report time; the report is built in the telemetry window, which cannot read the results page DOM), T6 (switching automatic visits off in semi-automatic mode), `displayed` for live, Get it and session-restore paths.
- Tests: `message-delivery-semi-auto`, `pipeline-semi-auto`.

### 2026-10-01 — Templates run semi-automatically when Auto is off, version 2.81.524

- Choosing a saved pipeline applied its default run policy (`auto` for every built-in template) and erased the moderator's explicit Auto choice, so a template could not be run stage by stage. The explicit choice now outranks the template default: with Auto off a template (e.g. Test, two stages) pauses for approval between stages; Get it and "next" work inside such a run.
- Auto off with no template selected is still a single dispatch without stages; the first time it now says so and points to choosing a template.
- Test: `pipeline-semi-auto` (template keeps the explicit Auto choice).

### 2026-10-01 — Re-emitted answers are no longer shown as "updated after completion", version 2.81.523

- `Ответ обновлён после завершения · GLOBAL_STATE_ANSWER_RECOVERY · Δ -9` was a false revision: the recovery from the background global state re-emits the already shown answer as raw text (delivery token and trailing blanks included), while the card holds the cleaned text, and `appendPostTerminalAnswerRevision` compared them without cleaning. It now cleans both sides like the live path (`MessageDelivery.clean`) and treats a whitespace-equal copy as no revision. A genuinely different text is still marked as a revision.
- Test: `results-debate-favorites` (re-emitted answer with token vs. a real revision). Telemetry follow-up: `docs/telemetry-semi-auto-spec.md` (T7).

### 2026-10-01 — Semi-automatic pipeline: Get it on the pipeline page and early stage close, version 2.81.521

- The pipeline page has its own **Get it** button. It reuses the main page's collection route (`GET_IT_BATCH`, extracted into `bindGetItButton`) for the running stage's models; double click collects only models without an answer.
- With Auto off, the run button during a running stage (**next**) closes the stage with the answers already collected instead of answering "Текущий раунд ещё выполняется". The silent models are skipped for that stage only: the stage executor neither retries them nor marks them as a terminal dropout (`PARTICIPANT_SKIPPED`), and the delivery journal records `moderator_closed` instead of `timeout`.
- Tests: `pipeline-semi-auto` (waiter close, executor skip vs. retry, page binding); `get-it-bottom` now loads the shared binder.

### 2026-10-01 — Background scope fix; the delivery token marks a finished answer, version 2.81.520

- Field report 7 (Grok, Le Chat, Perplexity, 2.81.519): `bottom_nudge_skipped: no_nudge_function`. Cause: `job-orchestrator.js` runs inside `if (…) { (function initJobOrchestrator() { 'use strict'; … })(); }`, so its declarations are visible to other background files only when exported on `self`. The Get-it trigger (`runAutomaticGetItForModel`, `resolveBoundTabIdForOrchestrator`) was never reachable from the router and the visits, and the retry supervisor's per-model prompt (2.81.504) referenced `resolvePromptForDispatch`, a ReferenceError that stopped the supervisor. They are now exported and called through `self`; the supervisor uses `TransportPolicy.resolvePromptForModel`. New test `background-global-scope` loads the real service worker and fails on any bare reference to a name hidden in the orchestrator (it finds all 9 on 2.81.519).
- The delivery token is the model's own end-of-answer marker. Text that contains this request's token is complete: a forced commit of such text is a success, not "неполный"; the uncertain-terminal deferral commits after 5 s of quiet instead of 30 s (`delivery_token_seen`); the visits commit unchanged text with the token at once instead of visiting further.
- While a batch is open, an answer kept without the token (possibly cut off, e.g. Grok's 143 characters) is replaced by the same request's answer that carries it (Grok's 470 characters arrived as a revision and were rejected before); journaled as `unproven_replaced` and counted as delivered.

### 2026-10-01 — Automatic recovery runs the full Get it (scroll and re-read), version 2.81.519

- The system-started "pull the page down" (2.81.517–518) reused only the scroll half of the status-indicator double click. The double click also asks the page adapter to re-read and emit the latest answer (manual latest recovery). The automatic recovery (deferred terminal, visits with unchanged text, visits that give up) now runs the same path for one model (`runAutomaticGetItForModel` → `handleManualResponsePing` with `getIt` and `manualLatestRecovery`) and returns to the results page afterwards; it never overlaps the first send pass, a running Get-it batch or a finished model.
- Finding from report 6: the project already had an automatic Get-it pass, but it runs once per session after rounds 1–3 (~45 s after the start) — that is what finished Perplexity at 51 s although its full text had been on the page since 17 s. The new triggers start the same thing as soon as the text stops changing.

### 2026-10-01 — Forced commit of incomplete answers that really lands; reports name the background build, version 2.81.518

- Field report 6 (Le Chat, Perplexity, 2.81.517): Perplexity's full answer was on the page after 17 s, but the final came only at 51 s — three seconds after the last automatic "focus + scroll" poke; Le Chat's deferral ended (`answer_quiet`) without any final, and no `bottom_nudge` was journaled.
- The incomplete-answer commit (deferred terminal, visits that gave up) now uses the shape the automation deadline uses for a pending answer (`lastResortTerminal`, `lateCollectFinal`, `forceTerminalSuccess`) so the answer-verification gates cannot turn it back into an open request; its outcome is journaled (`incomplete_answer_committed` or `commit_not_final` with the model status).
- Visits that find the text unchanged now pull the page to the bottom once per send (what the double click does) instead of another ordinary visit; the nudge that cannot run says why (`bottom_nudge_skipped`).
- Every dispatch phase carries the background build; a background on another build than the panel is reported as `stale_background` (reload the extension).

### 2026-10-01 — Automatic recovery pulls the page to the bottom like the double click, version 2.81.517

- The status-indicator double click works well because it does more than visit the page: it scrolls the conversation to the bottom (getIt), which lets the provider's page scripts finish the generation. The automatic recovery now does the same: the deferral of an uncertain terminal pulls the page down early (10 s) and once more before the text is committed, then gives the answer a short settle window; the visits that give up on static text pull the page down first, and if the answer grows or a final arrives nothing is committed (visits resume on growth).
- Each nudge is journaled as a `bottom_nudge` phase (with the tab and the reason) next to the `focus` event it causes.

### 2026-10-01 — Merge of the telemetry-window tab memory, version 2.81.516

- Integrates the "telemetry window remembers the active tab" change (entry 2.81.513 below, made in parallel) with the transport series 2.81.509–2.81.515; no behavior changes beyond that. The parallel change and the transport work both used 2.81.513, so the merged build is numbered 2.81.516.

### 2026-10-01 — Visits give up on answer content; static text kept as incomplete, version 2.81.515

- The periodic tab visits (human presence) already stopped after 6 visits; now they also track whether the answer text changed between visits (the visits' own activity does not count). When they give up and the model produced text that stopped changing, the text is committed as an incomplete answer ("неполный") instead of leaving the request open, and journaled as `static_answer_committed`.
- The user can still ask the model again: double-click the model's status indicator (also in the Pipeline panel) — the manual latest-answer recovery; an answer recovered after a committed terminal arrives as a revision.

### 2026-10-01 — Transport: deferred terminal can no longer hang; focus moves in the journal, version 2.81.514

- Field report 3 (Le Chat, Perplexity): the models had long answered, but the system kept moving between tabs. Cause: the deferral of an uncertain (`CONTEXT_LOST`/`AMBIGUOUS`) terminal counted any tab activity as "not quiet"; the tab visits made to find the answer were themselves that activity, so the deferral never ended. Now "quiet" means the answer text stopped growing for 30 s, a hard cap of 180 s applies whatever the activity, and the end is journaled (`terminal_deferral_ended`: `answer_quiet` / `max_defer_reached`); the produced text is committed as a partial answer.
- Every programmatic tab activation (dispatch, human visit, recovery visit) is journaled as `focus` with its source; the exact count per request is kept.
- Diagnosis: new problems `stuck_waiting` (text arrived, no final for 2 minutes; names a pending deferral) and `focus_churn` (6 or more focus moves); timeline shows focus count with sources and the last sampled text length (`text_progress`); a "Focus moves" column in the summary; `diagnose` can judge a report at its own time.

### 2026-09-30 — Transport: deferred uncertain terminal keeps the produced text, version 2.81.513

- Field report (Le Chat, Perplexity, 2.81.511): the premature `UNCERTAIN` final is gone — the `CONTEXT_LOST` decision after the new-chat navigation is journaled and deferred, and the answer text arrives.
- When a deferred `AMBIGUOUS`/`CONTEXT_LOST` terminal expires without a final answer, the text the model already produced is committed as a `PARTIAL` answer (marked "неполный") instead of an empty failure; with no text the failure is unchanged.

### 2026-10-01 — Окно телеметрии: запоминание активной вкладки, version 2.81.513

- Окно телеметрии восстанавливает последнюю выбранную вкладку среди Telemetry, Disput, Automation, Selectors и API после повторного открытия страницы.

### 2026-09-30 — Pipeline panel: запоминание Judge model, version 2.81.512

- `judge-select` сохраняет выбранную модель вместе с отправителем и получателем debate-сообщений и восстанавливает её после перезагрузки панели; выбор также переживает пересоздание списка моделей.

### 2026-09-30 — Answer cards: "incomplete" mark, approval as verification, version 2.81.511

- An answer whose generation did not finish cleanly (`PARTIAL`, `STREAM_TIMEOUT`, …) shows a small gray "неполный" mark to the right of the model name; it only informs. Approving such an answer with the checkbox stays allowed (semi-automatic flow).
- The approval checkbox is also the verification of an answer without a delivery token: its tooltip reads "Verify and approve this answer", and approving replaces the "Без метки доставки" banner with the user's decision (`attributionState: user_verified`).

### 2026-09-30 — Automation tab: GitHub UI changes integrated, prompt and answer in the journal, version 2.81.510

- Integrate the two commits that existed only on GitHub (`e03d858`, `7b6b84e`, version 2.81.502): the Automation tab cards now share the Disput tab styling (`styles/devtools-selectors.css`: collapsible cards, toolbar, grid).
- The journal keeps the prompt (1500 characters), the final answer (1200) and a dropped stale answer (500); the Message Timeline shows them as tooltips on the model and finish cells; the raw event view is capped at 300 characters per event.
- The remote version of the journal code was not merged (it predates the request-id journal); its history is recorded as merged.

### 2026-09-30 — Transport: no premature uncertain final; telemetry names the cause, version 2.81.509

- Field report (Le Chat, Perplexity): the tab's completion protocol reported `CONTEXT_LOST`/`AMBIGUOUS` 1.5 s after Send, the background committed an empty `UNCERTAIN` final and closed the batch, while the models kept answering; the real answer was then dropped as a duplicate final. After a confirmed send such a terminal is now deferred until the tab has been quiet for 45 s; a real answer (or any other terminal) arriving earlier wins.
- The first background message of a run is no longer delivered to the panel twice (a results page that does not answer counted as a failed delivery and was re-sent via runtime).
- The final message carries the concrete failure cause (`errorType`, `errorMessage`).
- Automation journal: `completion_terminal` (protocol decision and reason), `navigation` (SPA path change in the tab), `late_text` (text after an empty final), `terminal_deferred` phase; identical phase reports are journaled once.
- Diagnosis: new critical problem `premature_terminal` with its cause (protocol decision, navigation, late text) and a "Premature final" column; messages are linked to their batch even when prepared without a batch id.

### 2026-09-30 — Automation tab: full delivery diagnosis, version 2.81.508

- Diagnose every message from the full journal: dispatch phases (sent, accepted, submitted, blocked with reason), request and dispatch ids, completion, recovery source, revisions and answers rejected by identity.
- New results: `partial` (text without completed generation — no longer shown as delivered), `not_submitted` (dispatch started but the send was never confirmed, with the block reason), `cancelled`; an error status with text stays an error.
- New problems: identity rejections, unconfirmed provider stop, refused or rejected batch start, batch timeout.
- New **Batches** card: stage, models, start refusals and reasons, time to start, outcome, duration and deadline, models without an answer, completion per model.
- Delivery Health adds Partial, Not submitted, Error, Cancelled, Rejected and median time to submit; the timeline shows request/dispatch ids, the dispatch path and the provider stop result; the JSON report carries the transport contract version.

### 2026-09-30 — Pipeline transport journal, version 2.81.507

- The Automation journal now records batch start/refusal/end, background dispatch phases, provider stop results, and rejected or revised terminal answers with their request and dispatch identifiers.
- Cancelled batches and models without a final answer are distinguished, with reasons preserved for diagnosis.
- The page-session delivery journal retains up to 3,000 events.

### 2026-09-30 — Transport: acknowledged commands, status over text, stable deadlines, version 2.81.506

- A command to a provider tab counts as delivered only on the adapter's acknowledgement carrying its dispatchId (all ten adapters send it); opting out is explicit.
- Moderator and Judge flows take the answer status from the batch result instead of guessing an error from text starting with "Error:".
- A provider tab no longer shortens its generation deadlines while a request is in flight (Long → Standard waits until the tab is idle, bounded by the Long hard maximum); switching to Long applies at once.

### 2026-09-30 — Transport: durable cancellation and provider tabs, version 2.81.505

- A stop/cancel invalidates every job-state snapshot queued before it; a write still in flight is undone, and MV3 recovery never resumes a cancelled or stopped run.
- Cancelling a run clicks the provider's stop control in tabs with a request in flight and waits for the generation indicator to disappear.
- A ChatGPT tab runs one injection at a time: a repeated command for the same prompt joins the injection for as long as it runs (not for a fixed 15 s), a different prompt is refused as `concurrent_request`; the evaluator flag is captured per command.
- Answers are no longer cut at 50 000 characters (limit raised to 200 000 in all adapters and the late-answer cache).
- Run state is no longer mirrored into the provider site's localStorage; leftover `llm_ext_*` keys are removed.
- A health PONG without the model name no longer proves that the model's receiver is ready.

### 2026-09-30 — Transport: dispatch hardening and run guard, version 2.81.504

- Take a synchronous start reservation before the first await: two START commands can no longer both pass the run guard and replace the shared job state.
- Refuse a run that reuses tabs while a submitted prompt has no recorded final (the tab still generates); the panel waits for such a refusal within a 120 s budget instead of polling a busy flag after every batch.
- Later batches of the same pipeline run keep diagnostics and the proof ledger; they are cleared only when a new run starts.
- The retry supervisor resends the exact per-model prompt instead of the shared prompt.
- The focus queue returns failures to the caller (it used to resolve them as success) and keeps running.
- The pre-dispatch reload re-checks the dispatch state right before reloading, so a tab that received the prompt during the health ping is not reloaded.
- An open circuit on the first attempt records a retryable state instead of returning silently (the model used to hang until the panel deadline).
- The command intent must be durably saved before the provider page is touched; job-state saves report success or failure to their callers.
- A command that was not delivered or not accepted settles the submit waiter immediately; the dispatch transaction no longer holds the model's dispatch lock forever.

### 2026-09-30 — Transport: request identity, one outcome per wait, version 2.81.503

- Add `shared/transport-contract.js`: panel-issued `transportRequestId` per model request, one terminal status classification (`complete` / `partial` / `failed` / `cancelled`) and the panel wait deadline derived from the tab generation limit.
- The background stores the request id on the model entry, sends it with every answer message to the panel and in the global state snapshot; the final answer is explicitly terminal and a post-terminal improvement is marked as a revision.
- Rewrite the Pipeline waiter: answers are matched only by request id (never by model name alone), the wait is registered before dispatch, concurrent batches are independent, reset/cancel settle every wait, a terminal answer is immutable, and each result keeps its status next to the text.
- Snapshot recovery goes through the same delivery filter and identity check as a live answer and also settles recorded terminal failures.
- The panel no longer gives up before the tab can finish (Long: up to 900 s generation); an explicit dispatch refusal fails the batch immediately; a cancelled request is not dispatched.
- Delivery tokens are kept per request (preparing a new request no longer invalidates one in flight), the journal records `prepared` instead of `sent`, and only judge-prompt response delimiters are stripped (user `<<<...>>>` content is preserved).
- State compaction keeps `session.promptsByModel`, `session.pipelineContext` and the request id, so a retry after an MV3 restart resends the exact per-model prompt.
- Stage executor passes the transport completion to response acceptance and traces `PARTICIPANT_RESPONSE_INCOMPLETE`.

### 2026-09-30 — Simplify the Pipeline state map panel, version 2.81.502

- Keep the Pipeline panel's state map to its title and import/export/delete actions, with the open or closed state remembered between visits.

### 2026-09-30 — Full Automation tab in the telemetry window, version 2.81.496

- Record tabs, model statuses, first text, empty answers and batches that never answered in the delivery journal.
- Rebuild the Automation tab in the style of the Disput tab: delivery health per model, problems with a next step, per-message timeline, raw events, model filter, "only problems", clear and JSON export.

### 2026-09-30 — Pipeline message delivery and Judge, version 2.81.495

- Remove the separate Automation Lab page and the architecture runtime; keep the Pipeline page as the only surface.
- Tag every outgoing prompt with a per-model delivery token; drop stale answers carrying another token, mark answers without a token, and strip tokens and `<<< >>>` markers from the feed.
- Add a Judge selector left of Moderator: the chosen model receives all answers to the moderator's message and replies as a "Judge" card.
- Show the delivery journal in the telemetry window (Automation tab) with a JSON report.

### 2026-09-30 — Automation: prototype page, in-memory session, version 2.81.494

- Rebuild the Automation page strictly on `automation_prototype_v2.2.3.html`: model bar (first selected = moderator), two model columns, center feed with inline owner questions, Results / Save / Cancel.
- Keep session state in memory only; a reload starts clean and cancels a running batch. The telemetry window's Automation tab reads a live mirror in `chrome.storage.session`.

### 2026-09-30 — Automation Lab: prototype layout, clean answers, diagnostics, result routing, version 2.81.493

- Route Automation Lab results only to the tab that started the run and stamp them `sourceView: automation`. The Pipeline/Results feed ignores them: raw framed answers could previously land in an open Pipeline page while the lab waited until timeout.
- Rebuild the lab page on the `automation_prototype_v2.2.3.html` layout: a model bar with icons (the first selected model is the primary one), per-model columns with the sent prompt and the cleaned answer plus structure summary (no transport frames), and a center Automation feed. The feed shows the expected number of tabs per stage, dispatches, commits, inline owner questions and diagnoses.
- Add a persistent diagnostics journal of every transport and orchestration event, plain-language diagnoses (tab never opened, no answer, background busy, frame/JSON/schema failures) and a one-click "Report for Claude" JSON.
- Add an Automation tab to the telemetry window on the Pipeline and Results pages.

### 2026-09-29 — Automation Lab: executable Product→Architecture stages 1–5, version 2.81.492

- Add `automation_lab.html`, a separate page (linked from the Pipeline top bar) that runs framework stages 1–5 through the existing Web transport without API fallback. Its outputs are an owner-approved Decision Policy, independent multi-model expansion, decision synthesis with owner questions, a product concept and an independent adversarial review.
- Every answer goes through token-located frame extraction, AL-STRUCT-1 validation, snapshot-hash acknowledgement, reference/authority/disposition checks and an atomic IndexedDB commit; representation errors get one same-conversation repair, semantic errors a fresh conversation, and single-model stages fail over to the next selected model.
- Answers are persisted per model as they arrive, so a page reload never re-calls accepted models. A built-in simulator runs the whole pilot offline.
- Consolidate the Automation Layer bundle to v2.2.4: remove the DPL/PCON activation dead ends, the non-existent PRP DEFERRED rule, the repair-budget and hash-method contradictions and drifting duplicate files; the monolith is now generated from the split files (`npm run spec:sync`).

### 2026-09-29 — Preserve unlimited attachment batches in distributions, version 2.81.491

- Rebuild tracked provider adapters and content bundles from the current sources so generated outputs no longer carry the stale five-file cap.
- Add a provider-boundary regression check proving that all eight files in a batch reach the bridge and are confirmed.

### 2026-09-29 — Bound attachment and provider send delays, version 2.81.490

- Cap Grok's unobservable bridge confirmation window at 2.5 seconds so a failed bridge does not delay prompt insertion for the full file-scaled timeout.
- Bound Qwen and Z.ai send confirmation and record elapsed send-action telemetry.

### 2026-09-23 — Remove the five-file attachment cap, version 2.81.489

- Accept and pass through all selected, dropped, or pasted attachments instead of truncating each request to five files.

### 2026-09-22 — Preserve submitted prompt for card export filenames, version 2.81.488

- Use the last submitted prompt as a fallback when the visible prompt field is empty during model or Favourite export.

### 2026-09-21 — Read prompt from the active composer for card filenames, version 2.81.480

- Use the first non-empty value from the main and moderator prompt fields when naming individual model and Favourite exports.

### 2026-09-20 — Use prompt-based names for card exports, version 2.81.478

- Name individual model and Favourite HTML/TXT exports as `Subject - first 50 prompt characters - date`.

### 2026-09-20 — Position find-and-replace above selected text and increase horizontal response cards, version 2.81.477

- Position the response find-and-replace panel above the selected text and the formatting toolbar instead of at the top of the response card.
- Increase horizontal response card and output minimum heights from `300px` to `360px`.

### 2026-09-20 — Immutable Current session snapshot, version 2.81.474

- `Current session` фиксируется один раз при открытии левого Sidebar и не изменяется при навигации.
- `Save` создаёт постоянную session-копию из этого snapshot; при закрытии Sidebar временный snapshot сбрасывается.

### 2026-09-20 — Stabilize standalone HTML export navigation, version 2.81.472

- Remove the top gap above the sticky model navigation and hide the export until its navigation height is measured, preventing first-load layout shift and text from showing through above the navigation.

### 2026-09-20 — Raise textarea with selected models, version 2.81.470

- Keep the textarea top edge raised consistently after saved-session import and when at least one model is selected.

### 2026-09-20 — Match HTML model-page navigation spacing, version 2.81.469

- Keep sticky model navigation 12px below the page top and include that top gap in model anchor scrolling so Home and model pages use the same navigation spacing.

### 2026-09-20 — Align HTML model anchors and clean stray text, version 2.81.468

- Match model-page anchor spacing to the navigation height and remove the stray `Конфигурации (docker-compose.yml, .env.example, Makefile).` line from standalone HTML exports.

### 2026-09-20 — Reduce HTML export navigation spacing, version 2.81.467

- Reduce the gap between model navigation and Prompt to 8px and the page top padding to 12px.

### 2026-09-20 — Remove all HTML export divider lines, version 2.81.466

- Remove every horizontal divider line from standalone HTML exports.

### 2026-09-20 — Tighten HTML export Prompt spacing, version 2.81.465

- Remove the divider after `prompt-section` and reduce the gap below model navigation from 24px to 12px.

### 2026-09-20 — Remove HTML export title element, version 2.81.464

- Remove the `LLMs answers` title element from generated HTML exports completely while keeping the Home anchor on the document body.

### 2026-09-20 — Add chat links to Current session, version 2.81.463

- При сохранении `Current session` ссылки на открытые страницы чатов добавляются сверху textarea.
- Повторное сохранение не дублирует уже добавленные ссылки.

### 2026-09-20 — Refine HTML export header and model navigation, version 2.81.462

- Move the export date into the Prompt row, hide the duplicate top title, use 17px vertical navigation padding, and set inactive model labels to `#8c98a3` while preserving the active label color.

### 2026-09-20 — Save cards into Current session, version 2.81.461

- Кнопка `Save` теперь обновляет `Current session`, не создавая новую сессию.
- Имя текущей сессии формируется из первых 50 символов textarea и даты (`sep20`); при пустом textarea используется `Session sep20`.
- Карточки ответов, избранное и выбранные модели сохраняются в snapshot текущей сессии.

### 2026-09-20 — Preserve focus after adding favorites, version 2.81.460

- Stop scrolling the page to the Favourite card when adding a selected fragment or response card, so users can continue selecting text without losing their current position.

### 2026-09-20 — Update fully expanded card background, version 2.81.458

- Change the background of fully expanded model cards to `#f7f8ff`.

### 2026-09-20 — Update fully expanded card background, version 2.81.457

- Change the background of fully expanded model cards to `#fbf9f9`.

### 2026-09-20 — Highlight the selected HTML export model, version 2.81.456

- Give the selected model icon the exact `#27251eeb` color in the standalone HTML export.

### 2026-09-20 — Enlarge HTML export icons, version 2.81.447

- Increase the model and Home icon dimensions in the HTML export from 26px to 34px, approximately 30% larger.

### 2026-09-20 — Mark model response boundaries in exports, version 2.81.446

- Add a blank line before each model response and a `<model> END` line after it in TXT and HTML exports.

### 2026-09-17 — Move executable telemetry assets out of docs, version 2.81.445

- Moved proof telemetry schemas, registry and fixtures to the root
  `telemetry-spec/` directory because runtime validators and tests read them.
- Updated generators, validators and tests to use the new path.

### 2026-09-17 — Automatic bottom-and-collect pass, version 2.81.444

- After Round 3 and before the final completion gate, run the existing Get it bottom-scroll route once for all selected models, including SUCCESS. Keep the two-second post-scroll dwell and collect without blocking subsequent visits on extraction. Return to results after the last visit.
- Reuse the Get it single-flight guard; an automatic pass waits for an existing manual batch. Session and dispatch checks prevent visiting stale targets, and cancellation no longer steals focus back. Missing tabs do not stop the route. Manual Get it remains available for a later repeat.
- This intentionally applies the same recovery semantics as Get it automatically; a successful recovery is not independent proof of provider completion. The saved session marker prevents repeated automatic passes. An interrupted pass is not automatically resumed after a worker restart; manual Get it remains the recovery path.

### 2026-09-16 — Update HTML model title bar color, version 2.81.443

- Change the exported model title bar background from `#C2E7FF` to `#e9eef2`.

### 2026-09-16 — Remove redundant HTML response separators, version 2.81.442

- Remove the equals-sign separator from HTML exports now that model title color bands provide the visual separation.

### 2026-09-16 — Align Home and sticky Prompt controls in HTML export, version 2.81.441

- Match the Home icon to the model icon size, center its label, and make the Prompt heading with its collapse control sticky below model navigation.

### 2026-09-16 — Make exported Prompt collapse interactive, version 2.81.440

- Keep the full Prompt in the standalone HTML export, show it collapsed to three lines initially, and provide Show more/Show less controls; enlarge the Home icon by 50% and add its label.

### 2026-09-16 — Fix standalone HTML Prompt height limit, version 2.81.439

- Use browser-compatible CSS for limiting long exported Prompts to three visible lines.

### 2026-09-16 — Keep long Prompt exports within three lines, version 2.81.438

- Limit the visible Prompt block in HTML exports to three rendered lines and darken model navigation labels to `#27251eeb`.

### 2026-09-16 — Place and collapse Prompt in HTML export, version 2.81.437

- Place Prompt below the model navigation and limit prompts longer than three lines to a three-line visible height.

### 2026-09-16 — Set HTML export answer text color, version 2.81.436

- Set the exported response text color to `#27251eeb`.

### 2026-09-16 — Embed model icons in standalone HTML exports, version 2.81.435

- Embed the model SVG icons as data URIs so exported HTML files no longer depend on files from the extension directory.

### 2026-09-16 — Match HTML model title color and button styling, version 2.81.434

- Set the full-width model title background to `#C2E7FF` and align exported model navigation icon styling with `models-row-header`.

### 2026-09-16 — Match exported model navigation to the main page, version 2.81.433

- Use the same stacked model icon-and-name layout in HTML export navigation, with full-width model title highlights and no separator background.

### 2026-09-16 — Focus the first session after import, version 2.81.432

- After either full backup import or add-only session import, select and open the first imported session.

### 2026-09-16 — Tune response viewer typography and position, version 2.81.431

- Increase viewer text to 15px, set equal 48px horizontal padding, and move the popup 15px higher.

### 2026-09-16 — Refine HTML export navigation and model highlights, version 2.81.430

- Add a home link before the model navigation, remove the separator background, and highlight model title lines with `#fff204`.

### 2026-09-16 — Clear stale sessions after page or extension reload, version 2.81.429

- Clear saved session manifests and their in-memory sidebar state when a page reload or extension runtime reset starts, including the race where asynchronous sidebar loading finishes after the reset.

### 2026-09-16 — Remove viewer chrome and repair response transfer, version 2.81.428

- Make the response card fill the popup without an extra header, border, radius, or shadow, and retrieve the selected card payload through the service worker when direct delivery is unavailable.

### 2026-09-16 — Refine all-model TXT and HTML exports, version 2.81.427

- Place the export date beside the `LLMs answers` heading, remove the duplicate `LLM Responses` label, and add sticky model navigation links to the HTML export.

### 2026-09-16 — Apply exact 6% popup height increase, version 2.81.426

- Apply the requested six-percent increase directly to the previous popup height calculation.

### 2026-09-16 — Refine response popup sizing and content, version 2.81.425

- Increase popup height, set 40px side margins, remove a duplicated model heading, and reliably hydrate the viewer with the selected card content.

### 2026-09-16 — Add highlighted separators to all-model HTML exports, version 2.81.424

- Add the same three-line response separator to all-model HTML exports, with a yellow background behind it.

### 2026-09-16 — Connect popup viewer to regular model cards, version 2.81.423

- Regular model response cards now open the popup viewer on header double-click, matching debate response cards.

### 2026-09-16 — Popup viewer for debate response cards, version 2.81.422

- Double-clicking a debate response card header opens a reusable popup viewer sized to 105% of the card width and the available screen height minus 30px top and bottom margins. The viewer closes with its close button, `Esc`, or a click on its empty background.

### 2026-09-16 — Readable separators in all-model TXT exports, version 2.81.421

- Separate consecutive model responses in the all-model TXT export with three lines of equals signs and blank lines around them.

### 2026-09-15 — Qwen Cmd+Enter in send-only recovery, version 2.81.420

- The shared prepared-draft recovery now uses Cmd+Enter for Qwen on macOS, matching its primary adapter. Previously it always sent Ctrl+Enter. Other provider/platform shortcuts remain unchanged.
- Raw run 1789493770142 records Qwen insertion at seq52, send request at seq53 and departure 5087ms later (seq55). Round2 repair starts at seq201. Thus neither absent insertion nor absent repair scheduling explains the run; the actual shortcut outcome is not recorded.
- This closes an identified recovery-path inconsistency without claiming it proves the cause of the initial send failure. 18 targeted tests passed, including Qwen Mac/Windows and unchanged Claude recovery.

### 2026-09-15 — Do not cancel Grok on prompt verification failure, version 2.81.419

- Removed automatic Stop clicks when the posted prompt is missing, collapsed or differs from the expected text. Verification still reports failure and does not falsely confirm the payload, but leaves the provider generation running.
- Recheck a cached Send node immediately before a synchronous click: reject Stop/Cancel identities, disabled/disconnected controls and empty drafts. Remove the immediate keyboard submission after clicking. This prevents a cached Send control that has become Stop from being clicked by the button fallback.
- 50 targeted tests passed, including mismatch/unobserved verification without cancellation, Send-to-Stop mutation, ordinary Send and attachment/dispatch contracts. Live reproduction of the user interruption message remains unverified.

### 2026-09-14 — Prefer Cmd+Enter for Qwen on macOS, version 2.81.418

- Focus the composer and dispatch Cmd+Enter before resolving/clicking Send on macOS, following the user’s successful manual shortcut test. Confirm submission by a new matching user turn.
- If the shortcut consumes/changes/detaches the draft, wait for late confirmation without clicking Send again. Button fallback is permitted after two seconds only when the complete draft and user-turn count remain unchanged. Other platforms retain their existing path.
- 14 targeted tests pass. The extension uses DOM keyboard events, which are not trusted physical keystrokes; actual Qwen acceptance requires a browser run.

### 2026-09-14 — Restore Qwen sending to 2.81.408, version 2.81.417

- Removed the experimental unchanged-draft retry from 2.81.415 at the user’s request. Send selection and submission functions match commit 66e827d (2.81.408) exactly. Collection fixes remain separate.
- Historical report for run 1789277976208 records Qwen submission, generation and delivered answer on 2.81.408. Available raw runs on 2.81.413/414/416 show failed or unconfirmed submission. The send path was already identical between 408 and 414, so this evidence does not identify a breaking commit or prove that restoring the sender fixes the attachment scenario.
- Withdraw the prior implication that the first-click branch caused this regression: it was present in the successful 408 run. Nine targeted tests pass; live attachment sending remains to be verified.

### 2026-09-14 — Preserve displayed manual recovery during snapshot hydration, version 2.81.416

- Global-state unverified artifacts now hydrate empty cards only, matching accepted-answer hydration. A repeated snapshot can no longer overwrite the answer already displayed by manual recovery.
- MANUAL_PING_RESULT uses one rendering entry point: updateLLMPanelOutput updates both views. The redundant debate update could close the card before the panel update and divert the latter into a post-terminal revision.
- Regression tests cover repeated old artifacts after manual recovery, recovery after clearing a card and single rendering dispatch. These reproduce concrete UI overwrite paths; they do not establish that every Grok disappearance had the same cause.

### 2026-09-14 — Recover an ignored Qwen Send click, version 2.81.415

- After an unconfirmed first click, retry once using the current composer and current enabled Send control, only if the complete original draft remains, no new user turn exists and generation is inactive. Empty/edited/detached drafts and busy controls do not permit retry. The initial attempt remains immediate.
- The terminal first-click branch dates to 1dd570a; versions 410–414 did not change Qwen sending. This fixes a reproducible recovery gap, not proof of the exact browser event behind the reported failure.
- 16 targeted tests passed, covering refreshed controls and duplicate-send guards. Live Qwen was inspected read-only; its composer was already empty and an answer present, so the failed state could not be reproduced there.

### 2026-09-14 — Export Get it batch entry point, version 2.81.414

- Export collectGetItBatch from the orchestrator closure so the message router can start both single-click collection and double-click failed-page recovery. Previously both routes threw ReferenceError before collection started.
- Regression tests load the complete orchestrator module and invoke the actual GET_IT_BATCH route; both reproduced the reported error before the fix.

### 2026-09-14 — Preserve empty dispatch baselines and verify Qwen fallback, version 2.81.413

- An explicit empty baselineText now means no previous answer. It no longer triggers a post-submission DOM read that can mistake a fast current answer for the previous baseline. Omitting baselineText retains the existing discovery behavior; positional dispatch anchors remain required by verification.
- Qwen DOM and last-chance fallback paths now carry verification from their original pipeline, with exact text matching. Last-chance extraction still requires confirmed submission.
- Regression tests reproduce the explicit-empty baseline bug. This is a plausible contributor to missed fast answers, not a proven explanation for every early UNCERTAIN result in the field.

### 2026-09-14 — Verify provider DOM fallback results, version 2.81.412

- Claude, Gemini and Perplexity retain the original pipeline instance when falling back to DOM extraction. Before returning the fallback, they run its existing structural/stability verifier and attach answerVerification to response metadata. Previously these branches always sent null verification.
- Verification retains the original dispatch anchor and baseline, and must match the exact returned text hash and length. A shortened fallback, old baseline, active/unknown generation, missing identity or incomplete structure remains unverified. No forced-success or new automatic scrolling is introduced.
- This repairs the fallback proof handoff; it does not establish that all field observation/selector failures are resolved.

### 2026-09-14 — Make Get it available on restored results pages, version 2.81.411

- Get it is enabled when the results page opens and is not disabled by Start. Previously it was disabled on initialization and only enabled in the Start handler finally block, preventing native double-click events after restoring/reloading the results page.
- Failed-page recovery includes unsuccessful models from the current background run even if no model buttons are selected on the reopened page. Successful models with answers remain excluded.
- An active initial send pass, missing run, empty recovery list, active UI collection or messaging error now has an explicit user-facing explanation instead of a silent no-op. Initial dispatch retains its focus ownership.

### 2026-09-14 — Sequential failed-page Get it experiment, version 2.81.410

- Double-click Get it to visit selected models without SUCCESS or without answer text, in selection order. Each bound page is scrolled to the bottom and held for two seconds; answer collection continues without blocking subsequent visits. Return to the originating extension tab after the final visit. Missing pages do not stop the route; session/dispatch changes prevent collecting for the wrong request.
- Single click retains ordinary Get it; it waits 600 ms to distinguish a double-click. Both routes share the same in-flight guard.
- Status-indicator double-click now counts scroll/render preparation within its 2.5-second dwell and removes the extra 250 ms stabilization. It also returns when bottom preparation is unsuccessful. Chrome activation and return API latency remains outside the dwell; this is not a hard wall-clock guarantee.

### 2026-09-13 — Decouple reload acknowledgement from receiver readiness, version 2.81.409

- Reused-tab recovery requests one same-tab reload and then observes receiver readiness within the existing 20-second budget. A silent or delayed reload callback no longer produces reload_failed at 1500 ms. Actual Chrome API errors remain failures and are included in recovery diagnostics.
- Raw run 1789277976208 (export 1789278385135) deferred Grok, DeepSeek, Le Chat and Perplexity with reload_failed before GET_ANSWER. Version 2.81.408 conflated callback timeout with API failure; the export cannot prove which branch fired. Regression coverage reproduces the false rejection and now covers slow/silent reload acknowledgement, an actual API error, no receiver, delayed PONG, cancellation and ordered dispatch: 34 tests pass.
- This corrects another premature failure in receiver preparation; field recovery and automatic answer completeness remain unverified.

### 2026-09-13 — Preserve delayed receiver acknowledgements, version 2.81.408

- Receiver preparation now accepts a delayed PONG within the existing 20-second overall deadline. Previously each probe expired after 750 ms and permanently discarded its later reply, so a consistently slow renderer could never pass preparation. Only health probes change; GET_ANSWER remains single-delivery. Cancellation releases the pending probe within 100 ms.
- Regression tests cover a 1600 ms PONG, silence, a reply after the deadline, cancellation, receiver reload and ordered dispatch (30 tests pass).
- Raw run 1789253099910, export 1789275362909, confirms receiver_timeout before command delivery for Gemini, Grok, DeepSeek and Perplexity. Qwen submitted successfully. Kimi is absent; the supplied summary includes incompatible events and must not be treated as the event ledger. Probe timing is not preserved in that ledger, so the reproduced timing defect is not claimed as the proven sole cause of this field run.

### 2026-09-13 — Qwen send readiness and failure ownership, version 2.81.407

- Send discovery re-reads live enabled controls for up to 1.5 seconds after paste/upload instead of awaiting the generic 12-second selector finder. Disabled and aria-disabled controls are rejected. A DOM regression confirms a button enabled after 300 ms is clicked within the foreground slot.
- Last-chance answer extraction is allowed only after this dispatch has confirmed submission. Existing assistant text and unrelated generation signals cannot confirm a late Send. This prevents the false fallback observed in run 1789248077227 after Qwen inserted 143 characters without confirmed submission.
- The exact reason the field click failed remains unproven. A read-only inspection of the original Qwen tab later found an empty composer and existing answers, not the original failed draft; no live send was performed.

### 2026-09-12 — Distinguish slow tab lookup from an invalid tab, version 2.81.406

- Receiver recovery retains a slow tabs.get request within its existing 20-second budget instead of treating the one-second timeout as tab_ineligible. Closed tabs, ineligible URLs and lookup timeouts now have separate outcomes. A late result cannot reload after cancellation or deadline.
- Run 1789248077227 skipped Perplexity before GET_ANSWER with tab_ineligible. The export cannot distinguish a lookup timeout from an invalid URL in that version; the false-invalid branch is reproduced by regression tests, not established as the exact field cause.

### 2026-09-12 — Return focus after status recovery, version 2.81.405

- After a status-indicator double-click successfully prepares the bottom of a model page, keep it focused for 2.5 seconds, then activate the originating extension tab and its window. The dwell and return share the preparation focus lock.
- Validate the source tab again before returning; a closed or navigated-away source does not prevent answer collection. Get it batch routing is unchanged.

### 2026-09-12 — Recover old-page receivers in their focused send slots, version 2.81.404

- Round 0 now only acquires eligible existing tabs and persists their bindings. It does not wait for page load, probe draft/busy surfaces, invoke donor readiness or prepare/reload content-script receivers for every provider before dispatch starts.
- Round 1 activates each selected tab, then prepares its receiver while the usual two-second settling period runs. Recovery retains its 20-second bound and same-URL reload rules. A stale receiverPreparation failure is rechecked in the active page rather than permanently skipping it.
- Run 1789211262685 (export 1789211438461) contains no submit attempts through roughly 176 seconds, only page/receiver events before dispatch. This establishes a pre-dispatch failure; the canonical export does not identify the exact hung await. The change removes the shared receiver-readiness barrier rather than claiming that a specific Chrome operation was proven to hang.

### 2026-09-12 — Prefer the bound conversation on repeat dispatch, version 2.81.403

- Reusable-tab discovery prioritizes the run binding, then the persisted model mapping, before recency. A still-eligible bound tab is not lost because of an additional query-pattern filter.
- A mapped conversation is selected before probing unrelated tabs for a cleaner surface. Drafts or active generation are handled by dispatch readiness instead of sending the follow-up into a different conversation. Unmapped discovery retains its existing ordering and run-scope checks.
- Regression coverage verifies that an older mapped conversation with a busy/draft surface wins over a newer unrelated clean tab. The specific field misidentification still needs a live reproduction if it persists.

### 2026-09-12 — Forced status recovery uses bottom preparation, version 2.81.402

- A status-indicator double-click requests the same bottom preparation and fresh inline collection as Get it for the individual model, independently of the shared batch/button state.
- Manual collection validates the run-bound tab before acting, prefers it over the cached mapping and reports a missing/ineligible binding instead of silently reading another conversation. A discarded but valid tab remains eligible for activation.
- The reported post-idle failure of Get it has not been reproduced; this adds an independent explicit recovery path, not a claim that the idle root cause is resolved.

### 2026-09-12 — Run the Get it queue in the background, version 2.81.401

- The results page now sends one GET_IT_BATCH message with the selected model order. The background owns sequential collection and advances as soon as the preceding manual collection returns, without waiting for a hidden results page to resume and send the next command.
- Duplicate batch requests share the active operation; repeated model names are deduplicated. Per-model errors continue to the next model. Session changes cancel the remaining queue; changed dispatches are skipped. There is no added dwell between models.
- After successful Get it preparation, inline collection validates the tab and extracts directly instead of waiting for a content-script health ping and a redundant scripting probe. Automatic collection keeps its existing health checks.
- Runtime tests cover a UI-independent sequence, duplicate clicks, per-model failure, session changes and bypass of the manual health round-trip while retaining tab eligibility checks. Live timing still needs confirmation on provider pages.

### 2026-09-12 — Extend Get it bottom recovery to all selected models, version 2.81.400

- Get it now requests fresh inline recovery for every selected provider, including those already marked terminal. All providers use the existing mandatory manual bottom preparation: activate the page, try a labelled bottom control, follow rendered growth and verify the position before collecting. An unsuccessful visit reports failure rather than returning cached text as a fresh result.
- Collection remains sequential; automatic answer handling receives no new prerequisite. The same-answer reread, previous-dispatch exclusion and first-pass focus protection remain in place.
- Parameterized tests exercise manual preparation of all ten provider names after terminal status and automatic focus expiry; the button test verifies fresh recovery for providers beyond GPT/Qwen. These are simulated DOM checks, not live validation of every provider's controls.

### 2026-09-11 — Move GPT/Qwen bottom preparation to Get it, version 2.81.399

- Remove the automatic acceptance prerequisite from 2.81.398. GPT/Qwen automatic response handling no longer depends on a bottom-visit proof. The unfinished empty-UNCERTAIN recovery experiment was removed before release.
- Get it requests fresh inline recovery for GPT/Qwen, bypassing the cached-terminal shortcut. Before collection, activate the page, try its labelled bottom button and verify the scroll position. Explicit manual recovery also works for finalized entries and expired automatic focus budgets. Failure to reach the bottom stops this manual collection and is reported to the user.
- Get it processes models sequentially and awaits collection; repeated clicks cannot start a competing sequence. Previously pending card text is flushed before fresh retrieval, so it cannot overwrite the newly retrieved answer. Other manual controls and automatic collection retain their previous optional preparation behavior.
- Run 1789159635727 finalized Qwen empty about 6.5 seconds after send confirmation and GPT empty about 8.5 seconds after confirmation. The field log does not prove which browser action caused the initial uncertainty or whether a bottom visit ran. GPT later had 1897 extracted characters and 1907 rendered characters; `incomparable` is a normalization/comparison failure, not an explicit delivery rejection. No Qwen generation-start event is not proof that generation never started.

### 2026-09-11 — GPT/Qwen mandatory bottom experiment, version 2.81.398

- GPT and Qwen defer successful response handling until a bottom visit succeeds for the current dispatch. The initiating payload is discarded; the next collection explicitly requests a response even if text is unchanged. Evidence expires after 30 seconds and cannot authorize another dispatch or run.
- Try visible, explicitly labelled scroll-to-bottom/latest controls, then direct instant scrolling and stable bottom measurements. Failed, hidden or unmeasurable pages do not grant the acceptance prerequisite. The operation remains bounded and cannot interrupt the initial ordered send pass.
- This is a necessary preparation step, not proof of generation completion. Existing identity and completion gates still apply. Other providers retain optional pre-collection scrolling. The experiment lives on `codex/gpt-qwen-required-bottom`; baseline tag: `before-gpt-qwen-required-bottom`.

### 2026-09-11 — Follow the rendered conversation bottom before collection, version 2.81.397

- Pre-collection scrolling now discovers visible vertical scroll containers even with generated class names. It prefers the large main conversation viewport and its scrolling ancestors, excluding navigation and code panes, instead of taking the first five selector matches.
- Use instant scrolling, re-discover containers after rendering and follow changed heights until consecutive stable bottom observations, bounded to eight 150 ms samples. A replaced virtualized container is re-acquired. This prepares rendered content; it does not prove generation completion or waive answer identity checks.
- Hold the dispatch focus mutex throughout scrolling and settling, with session, terminal, first-pass and focus-budget checks after acquiring it. Previously the lock covered activation only and a queued cancellation could still allow scrolling.
- Run 1789126502755 plus the user's manual-scroll observation motivated this repair. The raw ledger independently confirms late delivery rejections for Grok/Le Chat and post-terminal text changes; it does not record sufficient DOM evidence to attribute all incomplete answers to scrolling. Real-browser completeness and remaining authority rejections still require verification.

### 2026-09-10 — Keep nested answer fragments within their message, version 2.81.396

- The shared turn resolver collapses nested primary content matches when both belong to the same explicit message root. It does not promote to the message wrapper itself, which can also contain private reasoning. A trailing prose fragment cannot replace its enclosing full markdown answer or inflate the pre-send turn count. Separate message roots remain separate; the existing ChatGPT nested-role rule is preserved.
- Runtime tests use the shipped Grok selectors to reproduce full markdown plus a nested prose match, verify an unchanged old turn is not selected, and verify a new complete turn wins. Another test preserves distinct nested message roots.
- Live inspection of the 2.81.395 Grok page found a 3185-character answer versus the ledger's 26-character extraction. The nested-fragment defect is reproduced in code; the exact DOM candidate used at the original extraction has not been captured, so this is not proof that the field truncation is fully repaired.

### 2026-09-09 — Admit late answers after observer timeout, version 2.81.395

- `STALLED` no longer permanently rejects a nonempty response at the completion-authority transport gate. The protocol uses this status for observer deadlines; it does not prove provider failure. Late responses for the same registered dispatch now reach normal answer verification with their terminal metadata unchanged.
- Explicit failure, cancellation and interruption still reject delivery. This change neither generates a success terminal nor bypasses identity, completeness or finalization checks.
- Router tests cover delivery with persisted STALLED authority and preservation of its evidence, plus rejection of FAILED_TERMINAL/INTERRUPTED/CANCELLED. Run 1788978982452 reports `completion_terminal_failed` for Claude/Gemini but omits the underlying terminal status, so the field failures cannot yet be attributed specifically to STALLED.

### 2026-09-09 — Preserve attachment baseline across fallbacks, version 2.81.394

- Capture the upload baseline once before the whole attachment cascade. A file from a slow vector that appears between attempts no longer becomes part of the next vector's baseline.
- Filename evidence now compares occurrence deltas per requested name. An old mention plus a new copy can confirm; an old mention alone cannot. Extra copies of one filename cannot satisfy another requested filename. Text and attribute views are not added together, avoiding double counting a chip simply because it also has a title.
- Runtime regressions cover repeated filenames, unchanged old evidence, missing second file and an upload appearing at the first vector's deadline. Real provider DOM/upload readiness remains a separate acceptance check; this change does not resolve GPT/Claude answer finalization.

### 2026-09-09 — Separate upload evidence by delivery method, version 2.81.393

- Synthetic drop/paste vectors no longer admit `input.files` as proof of upload. Only the explicit CDP vectors may use that evidence; provider strategy lists still do not enable CDP. The old negative `!startsWith('input')` check incorrectly included every drop/paste vector.
- Filename evidence rendered by the provider uses the normal settle interval, just like a file chip. The longer input-only settle no longer applies to an observed filename or consumes Gemini's synthetic-vector confirmation slices (15400 ms in run 1788977126384).
- Runtime tests cover filename readiness after 800 ms, rejection of input-only evidence for synthetic delivery, preservation of trusted-input settling, and the complete Gemini cascade with a pre-populated input but no uploaded file evidence. This is not live confirmation of successful uploads on all provider pages.

### 2026-09-09 — Release failed attachment visits, version 2.81.392

- The shared attachment handler reports `attachment_upload_failed` after exhausting its strategies or finding no usable files. Round 1 can now release a failed upload after its five-second slot instead of waiting for the 60-second ceiling. Run 1788974336967 exposed this with DeepSeek: the cascade ended long before the visit did.
- Stop dispatching further attachment vectors when the confirmation budget is exhausted. Previously a final vector could insert a file with zero time to observe its upload, then immediately report failure.
- Runtime regressions cover budget exhaustion, the failure notification and ordered advance after a failed upload. This does not establish successful attachment delivery on the affected provider pages or repair outstanding answer acceptance failures.

### 2026-09-09 — Keep attachments in the initial ordered dispatch, version 2.81.391

- Remove the blanket `attachments_require_round2` deferral. Each selected model receives one command with its original attachments during Round 1. Previously all initial attempts were skipped, leaving the globally limited repair round to perform first delivery; later models could miss delivery while collection revisited earlier ones.
- Keep the provider's attachment verification before Send. Attachment visits wait for send evidence, an explicit failure, or a 60-second upload deadline, followed by the five-second slot. Text-only timing remains unchanged. A timed-out upload is unconfirmed, never treated as success or resent in this pass.
- Runtime regression tests cover all nine models in order with slow attachment preparation, a stalled upload without starvation, and Stop during upload. Live browser confirmation remains outstanding. Answer acceptance failures from run 1788973662069 remain separate work.

### 2026-09-09 — Count nested ChatGPT assistant roles as one turn, version 2.81.390

- The authoritative resolver now collapses nested primary ChatGPT assistant matches before applying the pre-send turn anchor. A nested fragment cannot replace its enclosing complete answer or increase the apparent number of conversation turns.
- Regression fixture covers an old nested turn, no new response, and a new response with a short trailing nested fragment. This reproduces a code defect; the 20-character field extraction still needs comparison with the actual provider page.

### 2026-09-09 — Prepare reused page runtimes before dispatch, version 2.81.389

- Replace the 2.81.388 partial script injection with concurrent Round 0 preparation. Explicitly missing receivers on settled reused pages trigger one reload at the existing conversation URL, then polling for a provider PONG (20-second preparation budget). Healthy pages are untouched; loading pages wait for natural registration.
- First-pass timing no longer doubles as a deadline for installing the extension. Preparation failures are recorded before prompt delivery; Stop, changed tab bindings and resumed commands prevent stale reloads. No prompt is sent by the preparation path.
- Tests cover slow registration beyond 1.8 seconds, one reload, healthy/loading/silent pages, bounded lookup, cancellation, parallel preparation and preservation of previously issued commands on resume. The 2.81.388 field run still failed first-pass transport for six providers; answer acceptance is a separate unresolved issue.

### 2026-09-09 — Restore missing receivers on existing pages, version 2.81.388

- During the first-pass two-second preparation slot, probe the page transport. An explicit missing-receiver error installs the shared dependencies and provider adapter in manifest order, including the MAIN-world bridge, without reloading the conversation. A healthy or merely slow receiver is not reinstalled.
- Bound preparation to 1.8 seconds. If installation fails or stalls, defer that model and continue the ordered pass; late installation cannot issue a prompt or advance to more injection stages. Keep one GET_ANSWER command and the five-second foreground slot after delivery.
- Runtime tests cover missing receivers, ordered dependency installation, stalled installation, slow health callbacks and existing first-pass timing/cancellation behavior. Live provider acceptance after extension reload still requires browser verification.

### 2026-09-09 — Align completion runtime protocol versions, version 2.81.387

- Fix the background readiness contract still expecting protocol 2.3.0 after 2.81.382 shipped protocol 2.3.1. Healthy content runtimes were rejected with `COMPLETION_RUNTIME_UNAVAILABLE` even after reinjection.
- A regression test compares the background predicate against the actual shipped protocol and detector versions, retaining rejection of stale builds and unavailable sessions. This resolves the version mismatch seen in run 1788933128744; truncated answers and provider-specific collection failures are not yet proven resolved.

### 2026-09-09 — Preserve extracted answer content, version 2.81.386

- Qwen, Grok and Le Chat no longer remove URLs, model names, UI-like words, times or entities from extracted answer text. Preserve code indentation and literal HTML examples; HTML parsing requires an explicit `format: 'html'` option.
- DOM answer selection remains responsible for excluding interface controls. Existing explicit maximum-length limits remain. Regression tests cover prose, source URLs and code examples across all three cleaners.

### 2026-09-09 — Repair Le Chat fallback observation lifetime, version 2.81.385

- Release the actual reply-wait mutation subscription on success and timeout; ignore callbacks after settlement.
- Require 1.8 seconds of unchanged text without generation indicators instead of three callbacks, which could occur in a single mutation burst. Active generation resets this interval.
- Report the extracted payload's text length rather than reading `.length` from the payload object. Tests cover bursts, generation resumption and timeout cleanup. This fallback still supplies unverified evidence to background acceptance; time stability alone does not prove current-turn identity or completeness.

### 2026-09-09 — Recognize Claude model labels, version 2.81.384

- Fix escaped regex tokens so labels such as `Sonnet 4.5` and `Claude Opus 4` are rejected by the answer filter. Sentences mentioning those models remain eligible.

### 2026-09-09 — Block GPT and Claude sending unverified drafts, version 2.81.383

- GPT and Claude now stop before Send when final composer verification fails. Their final checks require the full normalized prompt in a connected editor, rather than a matching prefix.
- GPT no longer treats an empty composer alone as submission confirmation. Existing user-turn and Stop evidence remain; this is not yet exact submitted-message verification.
- Regression tests exercise empty, truncated, contaminated and detached drafts, plus successful full-text verification. Normalization retains existing provider behavior; byte-exact code/whitespace transport and live browser acceptance remain outside this change.

### 2026-09-08 — Preserve completion proof with immutable answers, version 2.81.382

- Carry structural verification from lifecycle completion into the immutable extraction snapshot and forward it to background finalization.
- Copy and freeze proof metadata; missing proof remains missing and cannot reuse an earlier answer.

### 2026-09-08 — Make Qwen and Perplexity submission evidence follow the live page, version 2.81.381

- Qwen searches the current DOM for a ready Send control before the slow selector fallback and confirms a new user turn after navigation replaces the home composer.
- Perplexity recognizes the live `group/user-bubble` container when confirming that a submitted prompt created a new turn.
- Regression tests cover immediate Qwen sending, detached composer scopes, stalled selector discovery and the current Perplexity user-message DOM.

### 2026-09-08 — Do not skip first-pass delivery on a missing focus ACK, version 2.81.379

- First-pass activation distinguishes an explicit tab error from a missing callback at the 1.5-second deadline. A missing callback permits one direct command to the addressed tab, after the normal preparation pause. An explicit error still defers delivery. Other activation callers retain strict boolean behavior.
- No activation retry or late window-focus callback is introduced; the fixed post-command slot and durable command intent remain. Foreground activation is not guaranteed when its acknowledgement is missing, and providers that require focus may still need recovery.
- Regression tests cover strict callers, first-pass timeout, late callbacks, explicit failure, ordered delivery and no repeated command. The 2.81.378 field run contained four focus deferrals and no storage deferrals; provider submission and completion defects remain separate.

### 2026-09-08 — Click Perplexity Send before legacy transports, version 2.81.378

- Initial submission and send-only recovery now click the composer-associated Send control after verifying the current visible draft matches the requested prompt. This gives a normal DOM send path before the legacy debugger transport, which is disabled in this build.
- Page evidence is still required to confirm submission. Once the button was clicked, the adapter does not fall through to another keyboard/debugger attempt when confirmation is delayed. Missing controls retain the existing fallback/error path.
- Tests cover one click on the current prompt and rejection of mismatched, disabled and detached drafts. This does not prove that every live Perplexity layout accepts synthetic clicks; browser acceptance remains outstanding.

### 2026-09-08 — Overlap durable intent with foreground preparation, version 2.81.377

- Start the small command-intent write concurrently with tab activation and the two-second editor preparation. Storage acknowledgement is still required before command delivery, but is no longer a separate serial pause.
- Replace the two-second write cutoff with a ten-second deadline. A 2.5-second acknowledgement now sends the command instead of skipping the model. This is a bounded mitigation for slow Chrome storage, not a claim that storage can never delay or defer a visit. Reads retain their existing deadline and recovery guards.
- Regression tests cover slow acknowledgement, genuine write failure, stalled writes and late completion without an old command being sent. Provider send and answer-completion issues are not resolved by this change.

### 2026-09-08 — Activate tabs without waiting for window focus, version 2.81.376

- Dispatch activates the destination tab directly instead of waiting for sequential tab lookup and window-focus callbacks. A silent or failed window-focus callback no longer skips a successfully activated model. The activation deadline and late-callback guard remain.
- Regression tests cover silent window focus, window-focus errors, failed activation and late activation callbacks. This removes one possible source of the observed `focus_unavailable` deferrals; live verification and the separate storage/send/completion defects remain outstanding.

### 2026-09-08 — Keep first-pass dispatch independent of full-state writes, version 2.81.375

- Replaced the per-model wait for the compressed job snapshot with a small command-intent record in session storage. A slow/full-state write queue no longer causes a ready model to be skipped at the two-second checkpoint deadline. The fixed 2-second preparation and 5-second foreground slot remain unchanged; actual journal-write failure still defers the command explicitly.
- Before resuming a worker, merge matching command intents into the saved run. Uncertain first-pass commands are skipped on resume, preserving their dispatch/generation identity; untouched models still run. Confirmed, terminal, newer-attempt and other-session state is preserved. A failed journal read cannot publish/resume an older snapshot.
- Canonical exports now retain first-pass results, reasons for pre-command deferral, command time and planned departure time. Round END no longer claims a command was sent when preparation deferred it.
- Regression tests exercise stalled full-state writes, failed/hung journal writes, late callbacks, fresh-worker resume, identity preservation and native canonical export. This corrects a reproducible dispatch failure path; the earlier canonical export did not contain deferral outcomes, so it cannot prove this caused every missing command in that run. Live multi-provider acceptance remains outstanding.

### 2026-09-08 — Fixed-duration ordered first pass, version 2.81.374

- Round 1 follows the configured model order, without prioritizing Qwen or moving Kimi/Z.ai to the tail. Each visit activates its tab, waits 2 seconds, issues one prompt command to the existing provider adapter, then keeps focus for exactly one 5-second slot measured from that command. Missing or late Send/acceptance telemetry cannot extend this slot. The extra ten-second observation wait in the uncommitted 2.81.373 experiment is removed.
- The first pass bypasses background readiness probes, reload/reinjection and command retry cascades. Missing tabs and failed activation are deferred; file uploads are deferred to the normal Round 2 path so no incomplete text-only request is sent. Browser activation and checkpoint preparation have separate bounded waits; the 2+5-second slot begins after activation.
- The page captures the previous-answer baseline and installs its tracker synchronously before editing. In the simple first pass, authority/baseline acknowledgements continue asynchronously, without blocking typing. These acknowledgements still gate answer acceptance; normal Round 2 preflight keeps its awaited checks.
- State persistence before command delivery remains required and has a 2-second wait limit in this path. Timeouts are recorded as deferred attempts, not successful submissions. Late provider work remains correlated to its dispatch, and Round 2 retains existing duplicate-send guards.
- Runtime tests execute the orchestrator, dispatch coordinator and real model/focus mutexes across ten models: silent or late ACKs and ongoing composer progress do not extend visits. They also cover stalled storage, preservation of an already-streaming state, Stop, attachments and asynchronous preflight acknowledgements. Live Chrome acceptance is still required.

### 2026-09-07 — Remove return visits and serialize automatic focus ownership, version 2.81.372

- Removed automatic restoration to the previously active tab from dispatch, send-only recovery, verification and collection visits. A completed model is no longer an implicit return destination; the next scheduled operation chooses the next tab. Removed the associated active-tab queries and delayed restoration timers.
- Human and automation visits hold the same focus queue as dispatch for their full lifetime. A 12-second operation deadline covers browser preparation as well as dwell; expiration revokes the visit before releasing the queue, so late callbacks cannot reactivate its tab.
- Verification rechecks model/session ownership inside the queue and keeps ownership through its bounded dwell. Awaited dispatch delays and request timeouts survive session-timer cleanup so Stop cannot strand a lock across the next run.
- Regression tests reproduce a GPT recovery returning to successful DeepSeek, simultaneous automatic visits, and a stalled browser callback stealing focus after the next visit. They fail before the corresponding fixes. A separate test covers Stop during a focus-owned delay.
- Live acceptance remains outstanding: automated fixtures establish these mechanisms, not an end-to-end Chrome run of this version.

### 2026-09-07 — Release saved dispatch checkpoints during continuous updates, version 2.81.371

- Each `saveJobState` caller now waits only for the snapshot batch containing its change. Later generation updates no longer extend an already persisted command-intent wait and hold the foreground dispatch queue indefinitely.
- The regression test fails on 2.81.370: a persisted checkpoint remained pending while the next generation snapshot was writing. It now resolves before that newer write, while the existing test still requires unsaved command intent to wait.

### 2026-09-07 — Shorten composer preflight and accept intact Kimi envelopes, version 2.81.370

- Baseline capture and Completion authority registration now wait for their independent ACKs concurrently. Both must succeed. Settings load during page initialization instead of beginning only after focus reaches the composer.
- Kimi's complete prompt remains valid when its editor removes whitespace immediately inside the extension's `<Prompt>` envelope. The entire enclosed body must match; altered, truncated and duplicated wrapped prompts are rejected.
- Grok checks exact composer text across 150 ms with a final read, replacing the unconditional five-second pause. GPT begins finding the composer immediately rather than sleeping first.
- Tests exercise the Kimi adapter through GET_ANSWER, real shared preparation, a simulated editor that removes envelope newlines, Send and PROMPT_SUBMITTED. Additional runtime tests verify concurrent ACKs and late composer text changes.

### 2026-09-07 — Keep verification behind the real first dispatch pass, version 2.81.369

- Dispatch now awaits the actual model mutex operation. Its previous 30-second caller timeout could start Round 2 while uncancelled Round 1 operations continued waiting for focus.
- Send-only recovery defers during the first pass and rechecks ownership/submission after acquiring focus. Visibility notifications and already submitted providers no longer request repeat activation; remaining focus requests use the same queue and revalidate before activation.
- Collection gestures, forced automation visits and verification focus respect the same initial-pass boundary.
- Browser focus callbacks have a 1.5-second deadline; late callbacks cannot trigger another activation.
- Regression uses the real SafeMutex with a transaction exceeding 30 seconds, plus queued focus requests and silent browser callbacks.

### 2026-09-06 — Independent provider preparation, version 2.81.368

- Round 1 prepares provider tabs independently while the existing focus mutex still serializes foreground insertion/Send. An unavailable renderer or failed preparation no longer prevents ready providers from receiving their commands.
- Bind cancellation to the session/entry before asynchronous readiness work and recheck it inside the focus queue and before command delivery. Start the insertion acknowledgement window at delivery, so waiting for focus cannot exhaust it.
- Reuse a healthy Completion runtime for up to 30 seconds, invalidating it on navigation/loading. MAIN-world bridge injection now uses `injectImmediately` and a six-second deadline for each browser call.
- Runtime regressions cover a stalled first model, independent provider failure, exclusive focus, session replacement, cache expiry/navigation and silent bridge injection.

### 2026-09-06 — Preserve the submitted conversation across SPA creation, version 2.81.367

- Lifecycle, provider cleanup and base adapter now share the navigation decision. A known new-chat route may become a conversation route after a correlated Send without cancelling observation or invalidating completion authority.
- The exception requires an empty answer baseline, the same origin, a matching active dispatch and a recent Send. Back navigation, another conversation, stale dispatches and unrelated origins still stop collection. Query/hash changes within the same known conversation keep its identity.
- Kimi and Z.ai publish Send intent before interacting, matching the other eight providers.
- Regression coverage includes all ten provider route patterns, cleanup ordering and automatic delivery of a first short answer after navigation. Field evidence: version 2.81.366 export `1788676577675`, where SPA changes coincided with lost observation and DeepSeek deliveries were refused as `completion_terminal_failed`.

### 2026-09-05 — Restore complete run content and model plan, version 2.81.363

- Session compaction applies the six-round tail limit only to round histories, preserving all selected models and tab bindings.
- Default persistence no longer truncates prompts at 4,000 characters or answer text/HTML at 12,000. Explicit preview caps remain available; diagnostic histories remain bounded.
- Persist generation epoch and the complete pre-dispatch baseline binding to retain stale-answer guards after restart.

### 2026-09-05 — Bound remaining dispatch health waits, version 2.81.362

- Health callbacks now have a deadline; silent dispatch probes use the ready ACK budget.
- Reload recovery arms its listener and deadline before requesting reload, handling both hung API promises and immediate completion events. Late callbacks cannot settle a timed-out operation twice.

### 2026-09-05 — Persist completion authority across worker restart, version 2.81.361

- Storage compaction now retains the accepted completion attempt, run identity and pending answer dispatch binding. A restarted worker can validate an already registered answer without dropping its text as `completion_attempt_unregistered`.
- Regression replays Gemini attempt 4 through the production compactor and a fresh authority registry; mismatched and never-registered deliveries remain rejected.

### 2026-09-05 — Resume interrupted prompt dispatch, version 2.81.360

- Bound completion runtime probes and repairs, inject immediately instead of waiting for document_idle, and bound the SCRIPT_READY announcement.
- Resume interrupted Round 0/1 for both new-tab and reuse modes, preserving existing conversation bindings.
- Persist preparation versus command-delivery intent. Resume preparation-only attempts and untouched models; retain duplicate-send protection for confirmed and uncertain deliveries.
- Regression coverage: loading/hung renderers, lost readiness acknowledgement, restart after the first three providers, both tab modes, and the remaining dispatch tail.
- Investigation and browser verification: `docs/dispatch-recovery-2026-09-05.md`.

### 2026-09-05 — Latest answer and completion scope, version 2.81.359

- Keep full primary answers when secondary selectors match nested fragments; exclude user/hidden descendants in the shared resolver.
- Resolve short nonempty answers consistently in watcher, pipeline and lifecycle verification.
- Ignore completion/regenerate controls belonging to earlier answers and hidden ancestor stop controls.
- Added runtime regressions for multi-turn completion, extraction consistency and short latest answers.

### 2026-09-05 — Prompt interaction latency, version 2.81.358

- Removed repeated whole-page scroll settlement from composer insertion/click.
- Controlled text inputs use the native value setter; rejected instant insertion returns to provider recovery without slow character typing.
- Regression tests cover suspended animation frames, controlled input notification and rejected insertion.

### 2026-08-19 — Compact response find bar, version 2.81.357

- Удалена дублирующая иконка `Replace actions` из верхней строки.
- Уменьшены расстояния между элементами и минимальная ширина поля Find зафиксирована, чтобы оно не сжималось до полосы.

### 2026-08-19 — Inline find/replace bar in response cards, version 2.81.356

- Окно поиска/замены перенесено из native dialog непосредственно внутрь активной карточки ответа.
- Поиск теперь остаётся видимым при вводе текста; поле Replace раскрывается стрелкой во вторую строку.
- Светлая компактная панель сохраняет доступность и в свёрнутой, и в развёрнутой карточке.

### 2026-08-19 — Восстановлено владение отправкой и расписанием, version 2.81.355

- Фокус provider-вкладки освобождается сразу после наблюдаемого Send action; composer transaction больше не может продлевать обычную отправку до attachment-ceiling.
- Долгое продление фокуса разрешено только пока текущая стадия действительно является загрузкой вложения.
- Retry supervisor больше не создаёт первые отправки вместо Round 1, запускает только явно запланированные retries и выполняет их последовательно.
- При сбое последовательности Round 1 сама возобновляет нетронутый хвост моделей; право первой отправки не передаётся retry supervisor.
- Наблюдаемый Send action защищает текущий dispatch identity от замены повторной отправкой до явного `send_action_failed`.
- Исправление основано на canonical telemetry run `1787145972166`: Qwen удерживал фокус 54 секунды после Send, после чего четыре волны retries вызвали массовые `dispatch_mismatch`.
- Версии `manifest.json`, `package.json` и `package-lock.json` подняты до `2.81.355`.

### 2026-08-19 — Устранено удержание фокуса после отправки Qwen, version 2.81.354

- Обычное окно фокуса Round 1 для Qwen сокращено с 8 секунд до 1,5 секунды, чтобы следующий provider не ждал устаревшего submit-waiter.
- Длинное удержание теперь остаётся только для реально продолжающейся attachment-загрузки и продлевается коррелированными progress-событиями.
- Синхронизирована версия `manifest.json` с `package.json` и `package-lock.json`.

### 2026-08-19 — Восстановлена базовая отправка во все модели, version 2.81.353

- Completion preflight остаётся первым этапом транзакции, но временная недоступность lifecycle/telemetry больше не запрещает вставку prompt и физический Send во всех десяти provider adapters.
- При деградации публикуется стадия `completion_preflight_degraded`, после чего adapter продолжает безопасную composer transaction и сохраняет штатные подтверждения Send.
- MAIN-world bridge снова имеет последний резервный путь инъекции для вкладок, переживших reload расширения; основной путь через `chrome.scripting` и declarative MAIN content script сохранён.
- Manifest-контракты тестируются по назначению content-script блока, а не по его позиции в массиве; восстановлен полностью зелёный release gate.
- Версии `manifest.json`, `package.json` и `package-lock.json` подняты до `2.81.353`.

### 2026-08-18 — Find and replace in response cards, version 2.81.352

- В карточках ответов доступен поиск по `Ctrl+F` (`Cmd+F` на macOS) с переходом по совпадениям.
- Добавлена замена текущего совпадения и всех совпадений с опцией учёта регистра.
- Функция работает для обычных ответов моделей и Debate-карточек; изменения Debate-карточек синхронизируются с сохранённым состоянием.
- Версии `manifest.json`, `package.json` и `package-lock.json` подняты до `2.81.352`.

### 2026-08-18 — Устранено CSP-блокирование main-world bridge, version 2.81.351

- `content-bridge.js` теперь загружается как MV3 content script в `MAIN` world на `document_start`, поэтому строгий CSP ChatGPT не блокирует bridge.
- Удалён inline fallback через `script.textContent`, который вызывал `Executing inline script violates ... CSP`.
- Общие зависимости provider content scripts больше не загружаются повторно, поэтому исчезает лишнее `SelectorConfig Duplicate load prevented`.

### 2026-08-18 — Устранена многоминутная задержка Round 1, version 2.81.350

- MV3 survival alarm больше не загружает сохранённый `jobState` поверх активного Round 1 и не снимает `roundsInProgress`; это исключает параллельный `retry_supervisor`, замену dispatch identity и повторные попытки до первой отправки.
- Dispatch не ждёт шестисекундный replay `SCRIPT_READY` на каждой уже рабочей вкладке: Completion runtime проверяется/восстанавливается напрямую, provider adapter подтверждается быстрым health PONG, а exact ownership — `COMMAND_ACCEPTED`.
- Observation/human-presence lease удалён из критического focus section provider Send: его 12-секундный hard cap больше не переключает вкладку на Results посреди composer transaction.
- GPT и Gemini не имеют искусственной двухсекундной паузы после подтверждённой вставки prompt.
- GPT, Claude, DeepSeek, Gemini, Le Chat и Qwen публикуют `send_action_requested/completed/failed`; submit timeout и canonical `DISPATCH_SEND` теперь работают для всех рассматриваемых providers.
- Kimi и Z.ai перенесены в конец Round 1 и не задерживают отправку в остальные модели.

### 2026-08-18 — Исправлена causal boundary отправки, version 2.81.349

- Completion authority ACK возвращается сразу после correlated in-memory acceptance и больше не блокируется полной записью `jobState`; durability выполняется асинхронно.
- Submit-confirmation timeout регистрируется заранее, но запускается только на фактическом provider stage `send_action_requested`; загрузка attachment и подготовка composer больше не расходуют его бюджет.
- `DISPATCH_COMMAND_ACCEPTED` теперь отдельно фиксирует доставку команды content script, а canonical `DISPATCH_SEND` означает реальный provider Send action, а не намерение background.
- Perplexity один раз пересоздаёт сериализованную debugger session, если SPA navigation инвалидировала её непосредственно перед trusted Send.
- Добавлены runtime-регрессии для blocked persistence ACK, delayed waiter arm, provider Send boundary и Perplexity debugger-session reacquire. Полный набор: 247 suites, 1902 tests.

### 2026-08-18 — Восстановлена атомарная Completion/attachment transaction, version 2.81.348

- Completion preflight теперь получает correlated background ACK до любых изменений composer; baseline ACK имеет bounded retry вместо ложного 1.5-секундного отказа.
- Регистрация attempt отделена от наблюдения: baseline и observer вооружаются до Send, но generation clocks запускаются только после `PROMPT_SUBMITTED`.
- Все десять provider adapters сразу подтверждают принятие команды, а Round 1 требует этот ACK и удерживает focus lease до подтверждённого Send либо terminal transaction failure. Вставка prompt больше не освобождает focus.
- Completion authority сохраняется в run state и восстанавливается после перезапуска MV3 worker. Неопределённый observer terminal больше не уничтожает связанный полный ответ: его проверяет обычная answer-finalization policy; явно failed terminal остаётся запретом.
- Attachment confirmation больше не считает сам факт dispatch доказательством доставки Kimi, ждёт стабильное upload evidence и возвращает раздельные `delivered`, `uploadSettled` и `ready`.
- Если готовый draft не подтвердил Send, общий bounded send-only recovery проверяет точное совпадение prompt и не повторяет attachment или insertion.
- Добавлены исполняемые тесты delayed ACK, two-phase lifecycle, worker restart, send-only recovery, focus boundary и command acceptance для десяти providers.

### 2026-08-17 — Kimi переехал на kimi.ai, version 2.81.347

- Kimi target URL, host permissions, content-script matches, host detection и
  trusted debugger routes обновлены с `kimi.com` на `kimi.ai`.
- Синхронизированы Kimi selector/runtime bundles, manual-auth target и документация.

### 2026-08-16 — Устранён критический startup/reload storm, version 2.81.346

- Обновление расширения больше не перезагружает одновременно все открытые LLM-вкладки и не стирает диагностическую историю.
- Round 0 только привязывает вкладки и не ждёт общий all-model readiness barrier. Проверка page/runtime readiness выполняется непосредственно перед отправкой каждой модели, поэтому медленный tail-provider не блокирует приоритетный Qwen.
- Correlated content-script PONG завершает ожидание страницы для всех провайдеров, даже если необязательные сетевые ресурсы удерживают `tab.status=loading`.
- Восстановление stale content runtime выполняется лениво на границе dispatch одной модели, а не параллельно для десяти вкладок.
- Pre-send baseline теперь дожидается создания CompletionSession; все адаптеры запрещают Send, если Completion attempt не зарегистрирован.

### 2026-08-16 — Дополнительно уменьшен зазор между кнопками, version 2.81.345

- Зазор уменьшен ещё на 7%: с `5px` до `4.65px`.

### 2026-08-16 — Уменьшен зазор между кнопками моделей, version 2.81.344

- Между полноразмерными кнопками моделей в Header установлен компактный зазор `5px`.

### 2026-08-16 — Completion runtime включён в реальную сборку, version 2.81.343

- Двухфайловая production-сборка теперь содержит `CompletionProtocol`, selector resolver, lifecycle detector, content bootstrap и общие content utilities; `CompletionSession` создаётся в фактически доставляемом runtime.
- `SCRIPT_READY` подтверждается только после проверки build/detector/protocol contract. Stale вкладка автоматически получает недостающий runtime и повторяет handshake.
- `enforced` стал обязательным production-режимом. Старые сохранённые настройки не могут выключить authority, а `legacy`/`shadow` требуют двух явных аварийных разрешений.
- Все background-пути успеха, включая manual ping и recovery, проходят единый terminal authority gate; предыдущий terminal result не переносится на новый dispatch.
- Телеметрия фиксирует readiness, repair и bootstrap failure Completion runtime как canonical observer-health evidence.

### 2026-08-16 — Не сжимать кнопки моделей в Header, version 2.81.342

- Кнопки моделей сохраняют базовый размер `58px` и исходный зазор `10px`.
- При узком Header элементы остаются полноразмерными и прокручиваются по горизонтали.

### 2026-08-15 — Увеличен prompt-префикс имён экспорта, version 2.81.330

- В названиях экспортируемых файлов теперь используется до 30 символов prompt.

### 2026-08-15 — Имена файлов экспорта по prompt и модели, version 2.81.329

- Экспорт всех ответов теперь использует имя `Name - LLMs <stamp>`.
- Экспорт отдельной модели использует имя `Name - Model <stamp>` для HTML и TXT.
- В карточки моделей добавлены кнопки TXT-экспорта.

### 2026-08-14 — Остановка content runtime по абсолютному дедлайну, version 2.81.328

- После исчерпания budget `generation` или `collect` background отправляет во вкладку
  `HUMANOID_FORCE_STOP` и `STOP_AND_CLEANUP`, чтобы остановить скроллинг, наблюдатели
  и другие процессы расширения.
- Terminal telemetry теперь явно различает остановленный runtime расширения и
  возможную продолжающуюся генерацию на стороне провайдера.

### 2026-08-09 — Kimi выбирает финальный ответ вместо reasoning, version 2.81.327

- Общий резолвер ответов теперь отбрасывает reasoning-блоки Kimi, даже если
  широкий assistant/markdown-селектор добавил их в последний DOM-кандидат.
- Добавлен регрессионный тест на выбор финального текста при наличии позднего
  блока размышлений.

### 2026-08-09 — длинный Gemini prompt вставляется атомарно, version 2.81.326

- «Простой» пользовательский запрос после оркестрации имел 11 853 символа.
  После неудачного paste Gemini передавал весь текст в `Humanoid.typeText`, и
  посимвольная вставка заняла около пяти минут. При background throttling она
  визуально продолжалась только после возврата пользователя в браузер.
- Для payload длиннее 2000 символов fallback использует native setter и один
  `input` transaction. Короткие prompt сохраняют humanoid-поведение.

### 2026-08-09 — Gemini не дублирует проснувшийся dispatch, version 2.81.325

- Run `1786287946831` показал две конкурентные команды одного prompt. Dispatch
  `:1` получил `LEASE_DENIED active_lease`, замёрз в background-вкладке почти
  на пять минут и вставил prompt после возврата фокуса. Background уже потерял
  открытый message-port и запустил `:2`, который очистил и вставил draft снова.
- Gemini теперь синхронно отвечает `accepted` и публикует composer ownership до
  первого `await`. Background не считает живой adapter зависшим; ownership TTL
  равен runtime hard-stop профиля (8/15 минут), а не прежним трём минутам.
- Повторный dispatch не мутирует composer, если там уже ровно один экземпляр
  текущего prompt. Исправлено также освобождение `geminiSharedInjection`:
  прежний `finally` сравнивал wrapper с исходным promise и никогда его не снимал.

### 2026-08-09 — верхняя панель управления закреплена при прокрутке, version 2.81.324

- `.top-control-bar` теперь остаётся закреплённой у верхнего края окна при прокрутке
  содержимого, сохраняя доступ к переключателям и управлению страницей.

### 2026-08-09 — recovery не перезагружает подтверждённый активный run, version 2.81.323

- Retry-supervisor проверял `flags.isSent` слишком поздно: сначала выполнял
  health ping и на второй попытке мог перезагрузить вкладку, а уже после reload
  обнаруживал подтверждённый submit и прекращал resend. На Gemini это уничтожало
  живую генерацию при кратком разрыве message-port во время SPA navigation.
- Проверка `isSent/isInProgress` перенесена перед health/reload. Дополнительный
  fail-closed guard в `reinjectScript()` запрещает `FORCE_CLEANUP` и reload для
  любого подтверждённого, ещё не терминального provider-run.
- Вместо разрушительного recovery пишутся `PRE_DISPATCH_RECOVERY_SKIPPED` и
  `SCRIPT_REINJECT_SKIPPED_ACTIVE_RUN`.

### 2026-08-09 — Gemini требует квитанцию нового user-turn, version 2.81.321

- На свежей странице Gemini hydration может добавить новый response-shell или
  busy-элемент без отправки prompt. Общий submit-oracle считал каждый такой
  новый узел прямым сигналом, поэтому адаптер мог остановиться на ложном
  `confirmed` ещё до browser-level Send.
- Для Gemini подтверждением теперь служит обязательный `new_user_turn` —
  provider-owned отображение отправленного запроса. Trusted Send выполняется
  до синтетического DOM-click, пока prompt заведомо остаётся в composer.


### 2026-08-09 — Gemini сохраняет отрицательный результат проверки Send, version 2.81.320

- Gemini продолжал мониторить pipeline после того, как ни `Ctrl+Enter`, ни
  кнопка, ни fallback-жесты не дали прямого доказательства нового хода. Это
  допустимо для позднего наблюдения, но затем адаптер отправлял обычный
  `PROMPT_SUBMITTED` без `confirmed:false`; background считал отсутствие флага
  подтверждением и писал ложный `PROMPT_SUBMITTED_ACCEPTED`.
- Теперь Gemini передаёт фактические `confirmed`, `submitMethod` и
  `submitEvidence`. Неподтверждённый жест попадает в
  `PROMPT_SUBMITTED_UNCONFIRMED` и не открывает submit-gate, при этом позднее
  прямое DOM-доказательство всё ещё может быть собрано pipeline.
- Если синтетические `Ctrl+Enter` и DOM-click проигнорированы, но исходный
  prompt всё ещё находится в composer, Gemini вызывает общий browser-level
  trusted Send. Background разрешает его только для sender-вкладки на
  `gemini.google.com`; жест по-прежнему считается подтверждённым лишь после
  появления прямого DOM-доказательства нового хода.
- Контракт закреплён в `tests/provider-submit-proof-contract.test.js`.

### 2026-08-08 — отказ контракта стал гейтом, version 2.81.319

- **Отказ `AnswerEvidence` ни на что не влиял.** `isPartial` читал
  `partialAllowed` только при `policy.ok`, а недоказанный run — ровно тот
  случай, который policy отклоняет; входящий success становился `SUCCESS`.
  Теперь недоказанный тип результата и понижает статус, и попадает в
  `contradictions` как `unproven_run_result_*`.
- `tests/run-result-background-gate.test.js` гоняет настоящий
  `handleLLMResponse`: `UNKNOWN` и `OBSERVER_LOST` не становятся `SUCCESS`,
  `COMMITTED` становится, а run без типизированного результата ведёт себя
  как прежде.
- **P0 больше не доказывает терминальность при одной лишь временной
  корреляции.** Причинный порядок не отличает поток хода от служебного запроса
  на том же endpoint и слеп к потоку, закончившемуся до подписки наблюдателя.
  Без выданной провайдером идентичности терминальный факт остаётся
  `suspected` (`terminal_fact_not_attributed_to_this_run`). Транспорт
  продолжает давать veto и гарантию `DEGRADED`.
- `runProof` несёт `dispatchId`: доказательство, которое не может назвать свой
  run, не является доказательством этого run.
- Документ и код приведены к одной семантике отказа: недоказанный run не
  финализируется с этого пути, а не «понижается до PARTIAL».

### 2026-08-08 — три дыры в контракте, найденные разбором, version 2.81.318

- **Контракт не доходил до фона.** `buildResponseMeta` не переносил `runResult`,
  и background-гейт, который его уже читает, не видел ни одного: `UNKNOWN`
  приходил как обычный ответ. Теперь переносит, и поле закреплено в
  `adapter-response-meta-contract.test.js` — тесте, который и должен был поймать
  пропуск.
- `COMMITTED` стал самостоятельным терминальным свидетельством: раньше
  сильнейшее доказательство в системе проваливалось сквозь эвристики источника
  в `text_without_terminal_signal`. Недоказанный run отклоняется поимённо, а не
  тихо понижается.
- **Транспортное свидетельство было привязано к run только временем.**
  `dispatchId` доходит до watcher; главное — два generation-потока в окне run
  делают корреляцию неоднозначной, и свидетельство **отбрасывается**, а не
  приписывается более вероятному потоку. Иначе маркер параллельного запроса
  доказал бы полноту не того текста.
- **`reconcileType` игнорировал integrity**: payload, который собственная ось
  считает повреждённым, оставался читаемым `COMMITTED`. Опровергнутая integrity
  теперь запрещает текст; `unproven` на integrity и semantic по-прежнему не
  запрещает, и причина записана рядом с проверкой.
- `dist/` — отслеживаемые артефакты — разошлись с исходниками: content-lib и
  девять адаптеров несли доконтрактную реализацию. Пересобраны; заодно впервые
  появились бандлы Kimi, которых не было с 2.81.284.
- 240 наборов / 1804 теста.

### 2026-08-08 — proven commit instead of an end detector, version 2.81.311–2.81.317

- Результат run перестал быть `{success, confidence}` и стал типом:
  `COMMITTED / COMMITTED_TRUNCATED / SUSPECTED_COMPLETE / UNKNOWN /
  OBSERVER_LOST / FAILED / CANCELLED`. Identity, terminality, integrity,
  semantic completeness и observer health — пять независимых осей: run с
  `finish_reason=length` терминален и содержательно неполон одновременно.
- Ниже `COMMITTED` обращение к `.text` бросает исключение; текст доступен через
  `readUncertainText(acknowledgement)`, и факт чтения записывается. Заявка на
  commit, не подкреплённая осями, понижается внутри контракта, а не на стороне
  вызывающего.
- Сигналы завершения ранжированы P0–P4 и **не складываются**: пять согласных
  DOM-признаков остаются утверждением о проекции. Один противоречащий факт —
  открытый поток, видимый Stop, сократившийся текст, ослепший наблюдатель —
  ветирует commit при любом объёме согласия.
- Потолок гарантии задаёт witness set, а не число голосов: transport `STRICT`,
  application `DEGRADED`, DOM `HEURISTIC`. Потеря сильного наблюдателя опускает
  потолок, а не убирает голос.
- **Найденный дефект:** main-world мост `fetch-monitor-bridge.js` читал init из
  `window.__HFM_INIT__`, куда content script пишет в изолированном мире. Хук
  выходил на первой строке на всех платформах всё время — «перехват fetch уже
  работает» из `answers-detection-alternativa.md` не соответствовало коду. Init
  передаётся на внедряемом элементе, и мост сообщает жизненный цикл потока
  генерации, читая тело через `response.clone()`; наружу идут счётчики и
  маркеры, не текст.
- На боевом пути: открытый поток или текст короче собственного максимума
  блокируют DOM-завершение; терминальный маркер провайдера завершает run сам,
  дождавшись, пока renderer догонит producer; DOM-завершение типизируется как
  `SUSPECTED_COMPLETE` под `HEURISTIC`.
- Граница зелёного намеренно не сдвинута: `PARTIAL` получают только `UNKNOWN /
  OBSERVER_LOST / FAILED / CANCELLED`. `oneToOne` не выставлен ни одному
  провайдеру до измерения. Подробности и план проверки —
  `docs/run-result-contract.md`.
- `resultType`, `resultGuarantee`, `evidenceClass` внесены в allowlist
  `compactProofMetadata` — иначе их постигла бы судьба `submitMethod`.
- 44 новых теста; полный набор — 239 наборов / 1791 тест.

### 2026-08-08 — the digest can diagnose again, version 2.81.308

- Дайджест знал 20 из 34 типов событий, на которых стоят семь пресетов: восемь
  не имели правила вообще, одиннадцать были в `IGNORED` целиком. `prompt-not-sent`
  был слеп на 8 типах из 11, `prompt-not-inserted` — на 7 из 10. На реальном
  прогоне из 20 событий дайджест выдавал одну строку `no terminal at all` и
  требовал полный отчёт на 163KB.
- Недостающие типы читаются через `payload.typed = {kind, state}` — канонический
  факт на каждом событии schema 6, один предикат вместо четырнадцати
  разборщиков metadata, которые пришлось бы угадывать по именам полей.
- Новая секция `PROGRESS`: пер-модельная траектория смен состояния. Повторы
  одного состояния сворачиваются в точный `×n`. Тот же прогон из 20 событий
  теперь показывает реальную причину: загрузка вложения через `cdp_file_input`
  отклонена (`debugger_route_disabled`), откат на `drop_bridge` остался
  неподтверждённым.
- Длинные прогоны ограничены 60 шагами на модель (голова и хвост). Обрезка не
  ломает контракт «чего нет в траектории — не происходило»: состояния,
  оставшиеся только в выброшенной середине, перечисляются поимённо.
- Размеры: 163KB → 2.3KB, 3.2MB → 44KB.
- `tests/telemetry-digest-coverage.test.js` вычисляет требование пресетов из
  `REPORT_EVENT_TYPES`, поэтому новый тип события в пресете уронит тест, а не
  расширит слепую зону. 7 из 8 проверок падают на прежней реализации.

### 2026-08-08 — the model is back in the telemetry filename, version 2.81.307

- Слаг модели получали только одиночные incident-отчёты; полный экспорт при
  `Tasks = All` всегда назывался `telemetry-all-presets-<ts>.json`, и выгрузки
  разных моделей были неотличимы. Теперь имя несёт модель:
  `telemetry-all-presets-<model>-<ts>.json` и
  `telemetry-canonical-evidence-<model>-<ts>.json`.
- Модель берётся из фильтра, а при `All platforms` выводится из самих событий:
  одна модель в леджере — её имя, несколько — `all-models`. Run-level события
  `SYSTEM` в подсчёт не идут, иначе однопользовательский прогон назывался бы
  `all-models`.
- `tests/telemetry-export-filename.test.js` кликает по настоящей кнопке
  экспорта в jsdom и перехватывает имя на точке скачивания; 5 из 6 проверок
  падают на прежней реализации.

### 2026-08-08 — the telemetry model filter actually filters, version 2.81.306

- Выпадающий список моделей в окне Telemetry пересекался (AND) со скрытыми
  кнопками LLM в заголовке страницы. `All platforms` означало не «все», а
  «выбранные в заголовке»: фильтр умел только сужаться внутри скрытого выбора и
  никогда не расширялся. При прогоне одной модели любое допустимое значение
  давало один и тот же список, а остальные — пустой таймлайн.
- Список опций собирался из захардкоженного каталога десяти платформ, поэтому
  предлагал модели, событий по которым нет в принципе; теперь он строится
  только из моделей, реально присутствующих в леджере.
- Окно, MD-экспорт и proof JSON сведены к одному предикату
  `matchesTelemetryModel` вместо трёх расходившихся реализаций. Канонический
  экспорт по-прежнему сохраняет run-level события `SYSTEM`.
- Убрана ветка, из-за которой пустой выбор LLM в заголовке при `All platforms`
  показывал «No telemetry events» поверх полного леджера.
- `tests/telemetry-model-filter.test.js` грузит окно в jsdom и проверяет фильтр
  поведением; 5 из 7 его проверок падают на прежней реализации.

### 2026-08-05 — Kimi answer, not the reasoning trace, version 2.81.291

- Kimi renders its reasoning trace inside the assistant turn, ahead of the
  answer: it appears first and keeps changing longest, so every "latest visible
  assistant text" rule settled on it and the card received the thinking instead
  of the reply.
- Both extraction paths are closed. The unified pipeline's Kimi selectors
  (`answer-pipeline-selectors.js`, `selectors/kimi.config.js`, the late-snapshot
  and legacy maps) now exclude think/thought/reason containers, and the adapter's
  own DOM fallback reads through a clone with those subtrees removed — so the
  answer survives even when the only match is the whole assistant turn.
- While only the trace has rendered, the adapter reports no answer at all rather
  than finalizing the trace as a short reply.
- `tests/kimi-extraction.test.js` covers all four cases.

### 2026-08-05 — Grok and Perplexity try Ctrl+Enter first, version 2.81.289

Ported Le Chat's Ctrl+Enter-first contract to the other two providers that did
not already have it — ChatGPT and Gemini already tried Ctrl+Enter before their
other strategies and needed no change.

- Grok: reordered from button → Ctrl+Enter → Enter to Ctrl+Enter → button →
  Enter, on both the main dispatch path and the send-only recovery path. The
  downstream posted-turn verification (`waitForGrokSubmittedPrompt`) is
  unchanged and still runs regardless of which method dispatched.
- Perplexity: added a bounded (900ms) synthetic Ctrl+Enter attempt ahead of
  the debugger-backed trusted Send. The 2026-07-30 field regression found
  Perplexity's Lexical editor usually ignores synthetic keyboard events
  entirely — that is why the trusted CDP path exists — so this is not
  expected to succeed on every build, but costs under a second when it does
  not, and skips a debugger attach entirely on builds where Lexical does
  honor it. The existing fail-closed confirmation oracle means a no-op
  keypress cannot be mistaken for a send.
- Fixed a bug hit during that Perplexity change: `trustedSend` becomes `null`
  when Ctrl+Enter already confirmed, and `null?.ok` is falsy, so a naive
  `confirmed = trustedSend?.ok && ...` would have silently discarded a real
  Ctrl+Enter confirmation. `confirmed` now starts from
  `confirmedViaCtrlEnter` explicitly.

### 2026-08-05 — submitMethod dropped by the ledger's own key-suffix allowlist, version 2.81.287

Three straight exports carried `submitEvidence` but never `submitMethod` on
`PROVIDER_SUBMIT_METHOD_OBSERVED`, even after the adapter side was verified,
patched twice, and re-verified. The field was never lost by the adapter —
`background/proof-telemetry-ledger.js`'s `compactProofMetadata` strips any
metadata key whose name does not end in one of a fixed set of suffixes
(`hash`, `count`, `mode`, `evidence`, `source`, ... — deliberately restrictive,
since this is the metadata-only privacy boundary). `submitEvidence` passed
only because it happens to end in "evidence"; `submitMethod` ends in "Method",
which was not on the list, so it was dropped before ever reaching a digest or
export, regardless of what the content script sent.

- Added `submitMethod` to the ledger's `proofIdentityKeys` allowlist.
- Added a ledger-level regression test recording the same event shape and
  asserting both fields survive — this is a chokepoint every metadata field
  passes through, so the previous adapter-level tests could not catch it.

### 2026-08-05 — Le Chat: Ctrl+Enter first, and provable submit, version 2.81.286

Run 1785914453420: the prompt was inserted and visibly sent, yet the run ended
`UNCERTAIN` with submission stuck at `evidence_partial`, and the export could
not say which control had sent it.

- Ctrl+Enter is now the first submit strategy, ahead of the debugger-backed
  trusted Send. For a pasted prompt Le Chat accepts it regardless of the send
  button's disabled state, and it needs no debugger attach. The 2.81.195
  contract - no long tail of click/form/Enter fallbacks - still holds: the
  chain is exactly these two attempts.
- Submission is now confirmed from the rendered prompt itself, its exact text
  appearing outside every editable surface. The previous check relied on
  ChatGPT/Claude-shaped `data-role` user-turn attributes and an English-only
  `aria-label*="Stop"`, none of which `chat.mistral.ai` emits here, so nothing
  could ever confirm and `sendComposer` threw before `PROMPT_SUBMITTED` fired.
- Generation evidence also matches structurally (`data-testid*="stop"`,
  `animate-spin`) and in Russian, instead of English labels only.
- Once the composer has been consumed, the remaining strategy is skipped rather
  than firing a possible duplicate submission. Such a send is reported with
  `confirmed: false`, producing `PROMPT_SUBMITTED_UNCONFIRMED` instead of an
  unproven success.
- `sendComposer` returns the control that worked. It is published as
  `PROVIDER_SUBMIT_METHOD_OBSERVED` (also on total failure, with the
  per-strategy attempt log) and carried on `PROMPT_SUBMITTED_ACCEPTED` /
  `PROMPT_SUBMITTED_UNCONFIRMED` as `submitMethod` / `submitEvidence`. Both new
  labels are pinned so they survive telemetry buffer trimming.
- The method reaches every export format. Canonical evidence and Full forensic
  embed the raw event; Digest reads the source label explicitly, since its
  canonical type `SUBMISSION_EVIDENCE_CHANGED` is an ignored type there and the
  method would otherwise be dropped. It renders as a `WHAT SUBMITTED THE PROMPT`
  section with the per-strategy attempt chain.

### 2026-08-05 — Fit ten providers in the header row, version 2.81.285

- The model row in the results header is `flex-wrap: nowrap`, so the tenth
  provider (Kimi) overflowed the bar instead of wrapping. Gap dropped 10px → 5px
  and the per-button slot 58px → 46px (3px / 40px under 1160px), which is where
  the room for a tenth model comes from.
- Kimi icon redrawn to the product mark: black square, white K, blue dot.

### 2026-08-04 — Kimi added as a tenth provider, version 2.81.284

- Kimi (`kimi.com`) is registered end to end: manifest host permissions and
  content-script entry, `selectors/kimi.config.js`, `content-scripts/content-kimi.js`,
  background targets/health/telemetry/skeleton-collector maps, the shared model
  policy and platform resolvers, and the popup / results / pipeline UI.
- Composer and send control were audited live on the page: the composer is a
  Lexical `contenteditable` (`.chat-input-editor`), and Send is a `<div
  class="send-button-container">` that carries `disabled` while the composer is
  empty — not a `<button>`, so the adapter checks the class as well as the
  property.
- The answer-side selectors are **not** verified: kimi.com refuses a chat without
  an account, so the config leads with Kimi-specific class names and falls back to
  the generic assistant/markdown heuristics. `tests/fixtures/live-answer-skeletons/index.json`
  declares `pendingCapturePlatforms: ["kimi"]` so the fixture matrix records the
  gap instead of silently skipping the provider — no fabricated real-page capture.
- Kimi joins the conservative-dispatch and false-success guard model sets
  (early-terminal guard, deferred stream finalization, DOM-snapshot and
  late-collect recovery), the default posture for an unproven provider.

### 2026-08-04 — Bound the deferral, report why acceptance never fires, version 2.81.283

- Run 1785870408469 showed the deferral trading a definite outcome for none:
  Grok and Perplexity were deferred and then stayed pending with no terminal at
  all. The deferral is now bounded — if the repair window passes with no
  submission, no insertion and no answer, the withheld status is recorded and
  `PRE_INSERTION_DEFERRAL_EXPIRED` says so.
- Acceptance on stable evidence did not fire once across four models and twelve
  decisions. `FINALIZATION_DECISION` now carries `stableEvidenceBlockedReasons`,
  naming the precondition that failed instead of leaving the next attempt to
  guesswork.
- `ROUND2_REPAIR_DISPATCH_START` / `_SKIPPED` reach canonical exports, so a
  deferral can actually be traced to the repair it was supposed to enable.

### 2026-08-04 — Universal recovery for dispatch and finalization, version 2.81.282

- A dispatch that fails before the prompt reaches the composer no longer becomes
  a terminal status within seconds. The model stays open once, so the Round 2
  repair dispatch that exists for exactly this case can run. Blockers that need a
  human (login, captcha, conversation limit) still terminate immediately, and the
  automation deadline and Round 4 force-final are never deferred.
- Round 2 repair lost its model allowlist. It excluded Perplexity and DeepSeek —
  the providers whose send evidence is hardest to observe — and the mechanism
  itself is provider-independent.
- A submission inferred from fresh answer evidence now counts as automatic
  confirmation, so providers whose Send click leaves no observable evidence can
  reach SUCCESS instead of waiting out the automation deadline. Stale-baseline
  and prompt-echo candidates stay disqualified.
- A complete answer blocked only by the strict verifier's own signal is accepted
  when generation is observed inactive, identity matches and the evidence policy
  is satisfied. Identity, echo and stale-baseline blockers are never lifted.
- `FINALIZATION_DECISION` now carries `decisionReasons` / `liftedDecisionReasons`
  and `PRE_INSERTION_FAILURE_DEFERRED` reaches canonical exports, so a blocked
  finalization states its reason instead of being diagnosed by guessing.

### 2026-08-04 — A failed file window says so, version 2.81.281

- Если `showOpenFilePicker` падает не отменой пользователя, нажатие больше не
  остаётся молчаливым: статус показывает `File window did not open` с именем
  ошибки, и только после этого идёт резервный `<input type="file">`. Раньше при
  такой ошибке резервный диалог тоже не открывался (активация клика уже
  потрачена), и кнопка выглядела мёртвой.
- Проверено в реальном Chrome for Testing 143 с загруженным расширением, через
  сырой CDP без автоматизации Playwright: `showOpenFilePicker` на странице
  `chrome-extension://<id>/result_new.html` не отклоняется — промис остаётся
  `pending`, то есть системное окно действительно открыто. Под перехватом
  Playwright тот же вызов даёт `AbortError: Intercepted by
  Page.setInterceptFileChooserDialog()` — Chrome доходит до показа окна.
- Какую папку показывает окно, локально проверить нельзя: у процесса нет прав на
  запись экрана и на Accessibility.

### 2026-08-04 — Import opens the standard file window in Saved sessions, version 2.81.280

- Нажатие `↓` или `+` теперь открывает обычное системное окно выбора файла,
  открытое в `Downloads/Saved sessions`. Внутриприложенческий список файлов
  (`#session-file-modal`), чтение через `fetch('file://...')`, directory input и
  требование галочки «Разрешить доступ к файлам по URL» удалены — пользователь
  просил стандартное окно, а не собственный список.
- Проверено фактом, а не рассуждением: расширение загружено в реальный Chromium
  (Playwright, `--load-extension`), на `chrome-extension://<id>/result_new.html`
  выполнено `typeof window.showOpenFilePicker` → `"function"` (то же для
  `showDirectoryPicker`/`showSaveFilePicker`). То есть посылка 2.81.277 «Chrome
  не выставляет File System Access на extension-страницах» была неверной, и
  весь путь через `chrome.downloads` + `file://` строился на ней.
- `pickSavedSessionsFile()` вызывает `showOpenFilePicker` с `id:
  SAVED_SESSIONS_PICKER_ID` и `startIn: 'downloads'`. Первое нажатие открывает
  `Downloads`, где папка `Saved sessions` лежит на виду; после первого выбора
  браузер запоминает каталог для этого `id`, и по спецификации запомненный
  каталог имеет приоритет над `startIn` — все следующие нажатия открываются
  сразу внутри `Saved sessions`. Отдельного нажатия «привязать папку» больше нет.
- Отмена диалога (`AbortError`) — это отмена, а не ошибка; любая другая ошибка
  падает на обычный `<input type="file">`, чтобы нажатие не осталось без
  результата.
- Из `manifest.json` убран host permission `file:///*` — он был нужен только
  прежнему пути чтения.
- Регрессии: `tests/release-log-regressions.test.js` фиксирует вызов
  `showOpenFilePicker` с `id`+`startIn`, порядок вызова до `await`, отсутствие
  `chooseSavedSessionsFile`/`listSavedSessionsDownloads`/`readLocalFileText`/
  `webkitdirectory`/`isAllowedFileSchemeAccess`, отсутствие `file:///*` в
  манифесте и удаление модалки из обеих страниц.

### 2026-08-04 — Import press no longer does nothing, version 2.81.279

- После 2.81.278 нажатие импорта не открывало вообще ничего. Причина: `<input
  type="file">` открывает диалог только пока жива transient activation клика, а
  её съедали `await chrome.downloads.search(...)` и упавший `fetch('file://')`.
  Резервный путь доходил до `input.click()`, но браузер уже молча его
  игнорировал.
- Доступ к `file://` теперь проверяется один раз при старте через
  `chrome.extension.isAllowedFileSchemeAccess`, а не на клике. Нажатие
  синхронно выбирает путь: есть доступ — читаем папку напрямую без диалога;
  нет — диалог выбора папки открывается до единого `await`, с живой активацией.
- Все тупиковые ветки теперь сообщают о себе в статусе (`No backups found…`,
  `Cannot read the backup file`), вместо молчаливого бездействия.
- Тесты порядка кнопок в `.sidebar-hint` ослаблены до проверки наличия: ряд
  переставляется вручную, и страницы намеренно расходятся по порядку.
- Регрессии: `tests/release-log-regressions.test.js` фиксирует пробу доступа на
  старте, отсутствие `await` до открытия диалога и сообщения тупиковых веток.

### 2026-08-04 — Import opens Saved sessions with no dialog at all, version 2.81.278

- Нажатие `↓` или `+` теперь сразу открывает содержимое
  `Downloads/Saved sessions` — системный диалог не показывается вообще.
- Пути берутся из `chrome.downloads`: файлы туда записало само расширение, так
  что их абсолютные пути известны и искать их диалогом не нужно. Содержимое
  читается через `fetch('file://...')`, для чего в манифест добавлено
  host permission `file:///*`.
- Один файл в папке открывается сразу; несколько — показываются списком внутри
  приложения, новее сверху, с датой.
- Требуется одна разовая галочка «Разрешить доступ к файлам по URL» в
  `chrome://extensions` для этого расширения. Если она выключена, чтение падает,
  статус прямо говорит, что включить, и остаётся прежний резервный путь — выбор
  папки через directory input.
- Оба импорта используют один `readSavedSessionsBackupText()`, который отдаёт
  текст, а не `File`.
- Регрессии: `tests/release-log-regressions.test.js` фиксирует источник путей
  (`chrome.downloads.search`), `file:///*` в манифесте, чтение через
  `readLocalFileText`, резервный путь и запрет на возврат File System Access API.

### 2026-08-04 — Import reads the folder through a directory input, version 2.81.277

- Найдена настоящая причина, по которой импорт всё время открывался в
  `Downloads`. Страница результатов открывается как
  `chrome.runtime.getURL('result_new.html')`, то есть это `chrome-extension://`
  страница, а на таких страницах Chrome не выставляет `showOpenFilePicker` и
  `showDirectoryPicker`. Значит `supportsFileSystemAccess()` всегда возвращал
  `false`, и **первая же строка** `pickSavedSessionsFile` уходила в
  `return pickBackupFile()` — обычный `<input type="file">`, открывающийся в
  последней папке Chrome. Весь код ниже (handle папки, `startIn`, разрешение
  подпапки, снятый `id`, диагностика 2.81.276) никогда не исполнялся: правки
  2.81.274 и 2.81.275 меняли мёртвый код.
- Весь путь File System Access удалён вместе с IndexedDB-хранилищем handle
  (`llm_sidebar_fs_handles_v1`) и `fsDiag`.
- Импорт переведён на directory input (`webkitdirectory`), который на
  extension-странице работает: пользователь выбирает папку `Saved sessions`,
  браузер отдаёт её файлы, приложение само показывает список `.json` — новее
  сверху, с датой. Один файл открывается сразу, без списка. Берутся только файлы
  самой папки, вложенные каталоги игнорируются.
- Добавлена модалка выбора файла (`#session-file-modal`) на обе страницы и стили
  списка.
- Регрессии: `tests/release-log-regressions.test.js` запрещает возврат
  `showOpenFilePicker`/`showDirectoryPicker`/`supportsFileSystemAccess` в этот
  путь и фиксирует directory input, фильтр по уровню вложенности, сортировку и
  наличие модалки в обеих страницах.

### 2026-08-04 — Diagnostic trace for the import folder default, version 2.81.276

- Импорт из sidebar по-прежнему открывается в `Downloads` вместо
  `Downloads/Saved sessions` после двух предыдущих правок (2.81.274, 2.81.275) —
  обе были сделаны по документации File System Access API без проверки в
  реальном браузере с загруженным расширением и не решили проблему.
- Вместо третьей правки вслепую в каждую точку принятия решения
  (`readSavedSessionsDirectoryState`, `linkSavedSessionsDirectory`,
  `pickSavedSessionsFile`) добавлено логирование через единый префикс
  `fsDiag` → `console.warn('[results][fs-diag]', ...)`. След показывает: что
  хранится в IndexedDB, результат `queryPermission`, что вернул выбор папки,
  и что получилось после разрешения подпапки — то есть на каком именно шаге
  расходится ожидание с действительностью.
- Регрессия: `tests/release-log-regressions.test.js` фиксирует, что все точки
  ветвления логируются через `fsDiag`, чтобы диагностика не потерялась при
  следующей правке этого участка.

### 2026-08-04 — Sidebar backup icons swapped and export points up, version 2.81.275

- Иконки кнопок `#notes-hint-backup-export` и `#notes-hint-backup-import`
  поменяны местами: экспорт (данные уходят со страницы) теперь стрелка `↑`,
  импорт (данные приходят) — иконка `ti-download`.
- Регрессия: `tests/release-log-regressions.test.js` фиксирует, какая иконка на
  какой кнопке.

### 2026-08-04 — Import pickers open the folder, not Downloads, version 2.81.274

- Импорт по-прежнему открывался в `Downloads`, и причин было две.
- Первая: `showOpenFilePicker` получал тот же `id`, что и диалог выбора папки. По
  спецификации, если для `id` запомнен каталог, браузер открывает его и
  игнорирует `startIn`. Диалог выбора папки запомнил `Downloads`, и файловый
  picker послушно возвращался туда. `id` у файлового picker убран — теперь
  решает `startIn` с handle папки.
- Вторая: при привязке сохранялся любой выбранный каталог. Диалог открывается в
  `Downloads`, поэтому выбрать сам `Downloads` вместо вложенной папки —
  естественная ошибка, и дальше всё открывалось в нём. Теперь выбранный каталог
  разрешается до `Saved sessions`: если это родитель, берётся подпапка. Уже
  сохранённый неверный handle чинится сам при первом чтении.
- Регрессии: `tests/release-log-regressions.test.js` фиксирует отсутствие `id` у
  файлового picker, разрешение подпапки и переписывание сохранённого handle.

### 2026-08-04 — Imports really open in Saved sessions, version 2.81.273

- Из блока сессии в TXT убран заголовок `=== LLM Responses ===`: имя сессии уже
  открывает блок, а заголовки моделей ниже сами читаются как список ответов.
- Починен импорт «по умолчанию из `Downloads/Saved sessions`». Диалог выбора
  файла и диалог выбора папки расходуют transient user activation клика, поэтому
  два таких вызова в одном нажатии невозможны: второй бросал исключение, и код
  тихо сваливался в обычный `<input type="file">`, открывавшийся в системной
  папке по умолчанию. Теперь привязка папки занимает отдельное нажатие (первый
  импорт и первый импорт после перезапуска браузера), а все последующие импорты
  одним вызовом открываются прямо внутри папки. Статус явно говорит, что папка
  привязана и кнопку надо нажать ещё раз.
- В импорте с перезаписью выбор файла перенесён перед подтверждающим диалогом:
  модальное окно, показанное раньше, съедало ту самую активацию, которая нужна
  picker'у. Подтверждение перезаписи по-прежнему спрашивается до применения.
- Оба импорта — с перезаписью (`↓`) и с добавлением (`+`) — идут одним путём.
- Регрессии: `tests/release-log-regressions.test.js` фиксирует `startIn` по
  сохранённому handle папки, запрет на цепочку из двух picker'ов в одном нажатии
  и порядок «файл раньше подтверждения»; `tests/results-debate-favorites.test.js`
  — отсутствие заголовка `LLM Responses` в блоке сессии.

### 2026-08-04 — TXT export of all saved sessions from the sidebar, version 2.81.272

- В `.sidebar-hint` справа от `+` добавлена кнопка `txt`
  (`#notes-hint-sessions-export-txt`): выгружает ответы всех сохранённых сессий
  одним файлом `Saved sessions <stamp>.txt` в `Downloads/Saved sessions`.
- Формат блока сессии: строка `Session Name.`, дальше всё содержимое с отступом
  в 4 пробела — `=== Prompt ===`, `=== Favourite ===`, `=== LLM Responses ===` и
  `=== Модель ===` с текстом. Пустые строки остаются пустыми, хвостовых пробелов
  нет.
- Данные берутся из снимков сессий (`pageSnapshot.responseCards`), а не из DOM:
  у сохранённой сессии карточек на странице нет. `Current session` не входит в
  файл — для открытой работы есть кнопка txt на главной. Строки метаданных
  (время + URL) у сессионных ответов нет: они описывают текущий прогон и в
  снимок не пишутся.
- `buildFavoriteGroups`/`buildFavoriteExportText` принимают список записей
  параметром, чтобы Favourite собирался из снимка сессии, а не из открытой
  панели; поведение существующих вызовов не изменилось.
- Экспорт использует общий `downloadBlobToSavedSessions`, тот же, что и json-
  бэкап; при отказе downloads API остаётся anchor-скачивание.
- Регрессии: формат блока и пропуск пустых/ошибочных сессий — в
  `tests/results-debate-favorites.test.js`, разметка и привязка кнопки — в
  `tests/release-log-regressions.test.js`.

### 2026-08-04 — Sidebar sessions live in Downloads/Saved sessions, version 2.81.271

- Экспорт сессий и заметок из левого sidebar теперь сохраняется в
  `Downloads/Saved sessions` через `chrome.downloads` (`saveAs: false`,
  `conflictAction: 'uniquify'`), а не в корень Downloads через `<a download>`.
  Папка создаётся сама; при отказе downloads API остаётся прежний anchor-путь.
- Оба импорта — `↓` (перезапись текущего набора) и `+` (добавление к текущему
  набору) — открывают диалог сразу в этой папке. Handle папки берётся один раз
  через `showDirectoryPicker({ startIn: 'downloads' })`, хранится в IndexedDB
  `llm_sidebar_fs_handles_v1` и переиспользуется как `startIn` для
  `showOpenFilePicker`. Где File System Access API нет, работает прежний
  `<input type="file">`.
- Подписи кнопок в sidebar теперь называют папку и явно различают импорт с
  перезаписью и импорт с добавлением.
- Регрессии: `tests/release-log-regressions.test.js` фиксирует путь загрузки в
  подпапку, единый picker для обоих импортов, fallback-ветки и подписи кнопок.

### 2026-08-04 — Selection toolbar survives the favourite press, version 2.81.270

- Нажатие звёздочки в тулбаре выделения больше не закрывает тулбар: и на главной
  странице (`response-sel-toolbar`), и на странице модели
  (`codex-model-selection-toolbar`) выделение и тулбар остаются на месте, поэтому
  заполненная/пустая звезда видна как подтверждение того, что фрагмент добавлен
  или удалён из избранного. Повторное нажатие по-прежнему переключает состояние.
- Тулбар закрывается по клику мимо него — как и раньше по клику вне карточки, а
  теперь ещё и когда клик внутри той же карточки снимает выделение: раньше
  `showResponseSelectionToolbar` просто выходил при схлопнутом выделении и
  оставлял тулбар висеть в устаревшей позиции.
- Регрессии: `tests/results-debate-favorites.test.js` и
  `tests/model-selection-toolbar.test.js` фиксируют, что тулбар остаётся открытым
  после звезды, что вторая звезда снимает фрагмент, и что клик мимо скрывает его.

### 2026-08-03 — Attribute the pre-send wait, version 2.81.262

- `DISPATCH_SEND` now reports the phase split of the pre-send wait
  (`tabReadyMs`, `ackWaitMs`, `noFocusProbeMs`) next to the total `readyWaitMs`.
- The handshake-recovery request emits `READY_REANNOUNCE_REQUESTED`, so the
  replay path is visible in evidence instead of being silent.
- Tab and handshake diagnostics reach canonical exports: `TAB_DISCARDED_RELOAD`,
  `TAB_READY_WAIT_END`, `READY_REANNOUNCE_REQUESTED` and `HANDSHAKE_TIMEOUT`
  were previously dropped as debug events, which made a discarded-tab reload
  indistinguishable from a lost handshake.

### 2026-08-03 — Immediate repeat dispatch on old pages, version 2.81.261

- Already-open provider pages can replay their document-scoped `SCRIPT_READY`
  handshake when an MV3 service-worker restart has cleared background memory.
- Repeat requests no longer consume the six-second ACK timeout and subsequent
  recovery work before dispatch begins.
- The replay preserves `tabSessionId`; cached correlated handshakes are reused
  without an extra message.

### 2026-08-02 — Full telemetry export moved off the UI thread, version 2.81.222

- All-presets construction, hashing, redaction, and JSON serialization now run
  in a dedicated extension worker instead of the results-page event loop.
- The toolbar remains responsive and displays the current build/serialization
  stage while the immutable snapshot is processed.
- A 20-second hard boundary guarantees an artifact: if derived report building
  fails, a recovery JSON containing every canonical event is downloaded.

### 2026-08-02 — JSON export no longer waits for a quiet ledger, version 2.81.221

- Full telemetry export waits at most 750 ms for the live persistence queue.
- If observation continues, export proceeds from the latest durable committed
  boundary instead of waiting ten seconds and requiring another click.
- The exported audit records the committed-boundary consistency and outstanding
  queue counts, so diagnostic limitations remain explicit rather than hidden.

### 2026-08-01 — Telemetry export no longer builds unused reports, version 2.81.220

- The default digest export is now generated directly from the canonical event
  ledger instead of waiting for the complete all-presets JSON container first.
- Full JSON remains lossless and is built only when selected or when digest
  generation fails.
- Full-container generation uses indexed event lookup, skips redundant deep
  copies, and stops byte-budget serialization as soon as the value stabilizes.

### 2026-08-01 — Complete text wins over truncated rich HTML, version 2.81.219

- Results rendering now checks the visible-text projection of rich HTML against
  the committed answer text. When the HTML shares the answer beginning but loses
  a material tail, the card is rendered from the complete text payload.
- The guard covers live panels, debate cards, post-terminal revisions, and
  global-state recovery after a missed delivery message or page reload.
- Regression coverage reproduces a long Gemini answer whose HTML projection is
  missing its tail and verifies that both result surfaces retain the ending.

Field evidence: run `1785611627407` committed 6198 normalized Gemini characters,
while `panel-gemini` rendered 6046; the post-terminal audit marked that boundary
as contradicted.

### 2026-08-01 — Results reload preserves delivered answers, version 2.81.218

- Reloading the results page still clears its old live DOM, but it now hydrates
  the authoritative background snapshot instead of replacing that snapshot
  with an empty object.
- A genuine extension-runtime reset remains the only condition that invalidates
  the returned snapshot, so stale runtime state is not restored.
- Added regression coverage for both reload hydration and runtime-reset clearing.

### 2026-08-01 — A strong transition and a resolved identity survive to the decision, version 2.81.217

Two more facts were being stated by the runtime and lost before the decision
read them, which is why run 1785603157691 recorded `evidenceTier: 0` for every
model:

- `PIPELINE_STEP: streaming_done` is emitted with `strong: true` — the flag
  `evidenceTier` requires for tier 3 — and the ledger replaced the whole typed
  fact with the canonical one, which states kind and state but no qualifiers.
  The canonical mapping still decides kind and state; qualifiers on the same
  fact are now kept.
- Candidate identity was inferred only when a candidate was *rejected* as stale
  or ambiguous. `ANSWER_SOURCE_MATERIALIZED` carries the identity the extractor
  resolved the answer to, so the positive resolution is now inferred from it.

Replaying that run with 2.81.215-217 applied: `submission_confirmed` and
`answer_identity_current_dispatch` pass for GPT and Z.ai, where before every
rule failed for every model.

Two producer gaps remain and still block automatic acceptance, both of them
missing evidence rather than lost evidence: no coherent observation frame is
emitted on the normal answer path (`observationReliability` stays `unknown`,
and the frames that do exist carry `maximumSignalSkewMs: null`, which counts as
degraded), and the deferred-finalization path records no structural
verification at all. Neither is fixed here.

### 2026-08-01 — Every adapter states whether the prompt reached the composer, version 2.81.216

In run 1785603157691 the prompt-not-inserted report answered `not_confirmed`
for GPT, Claude and Z.ai and `unknown` for DeepSeek, Le Chat and Perplexity —
exactly the models whose prompts the user saw fail to appear. Its critical
`insertion_outcome` slot was `unavailable` for all nine models: only insertion
*failure* was ever reported, and only from some adapters, so a run in which
insertion silently did nothing looked identical to a run in which it worked.

Every adapter now reports its own verdict once per dispatch through
`ContentUtils.reportPromptInsertion` — `PROMPT_INSERTION_OBSERVED` in the
content script, `PROMPT_INSERTION_CONFIRMED` / `PROMPT_INSERTION_FAILED` in the
background, `PROMPT_INSERTION_EVALUATED` in the ledger. The verdict is placed
after each adapter's own recovery path, not inside the shared composer gate,
which does not know whether the adapter still intends to repair a replaced
composer. It is fire-and-forget: dispatch never waits on a proof message.

ChatGPT never checked its composer after typing at all — an empty ChatGPT
composer produced no evidence in either direction. It is now checked before
Send is attempted.

### 2026-08-01 — An accepted submit is recorded as confirmed, version 2.81.215

All-presets run 1785603157691 (nine models) failed the same six decision rules
for every model that reached a decision, `submission_confirmed` first among
them, and every incident carried the invariant `TYPED_CANONICAL_CONFLICT` with
`typed=evidence_partial` against `canonical=confirmed` on its own payload.

The ledger built the typed fact from `canonicalFactOf({ eventType, payload: {
metadata } })` — without `sourceEventType`. That is the only field the canonical
mapping for `SUBMISSION_EVIDENCE_CHANGED` reads, so every
`PROMPT_SUBMITTED_ACCEPTED` was stored as `evidence_partial`, the submission
axis could never reach `confirmed`, and no answer could be accepted
automatically. Replaying that run's ledger through the corrected mapping turns
the axis to `confirmed` for GPT, Claude and Z.ai and takes the conflict count
from 6 to 0; DeepSeek correctly stays `evidence_partial` — it never submitted.

Two labels whose runtime fact the canonical mapping still contradicted are now
mapped as their producer states them: `SEND_DEGRADED_AFTER_SUBMIT` (emitted only
after a confirmed submit) is `confirmed`, `SEND_DEFERRED_TRANSIENT_BLOCKER` is
`deferred`. Registry version 6.7.0.

This does not by itself make acceptance reachable: `observation_reliable`,
`answer_identity_current_dispatch`, `structural_verification` and
`minimum_evidence_tier` still fail in that run for reasons of their own.

### 2026-08-01 — A later extraction no longer overwrites a longer one, version 2.81.214

Isolated single-model Grok run, reported as "the answer appeared and then was
immediately replaced by the original prompt". The full report shows exactly that:

    66.7s  ANSWER_SOURCE_MATERIALIZED  len=2546  deferred_finalization
    68.8s  OBSERVATION_FRAME_CAPTURED  len=88    inline_executeScript
    68.9s  ANSWER_SOURCE_MATERIALIZED  len=88    manual_ping
    68.9s  ANSWER_COMMIT_EVALUATED     len=88
    69.0s  MODEL_TERMINAL_RECORDED     len=88    forced_success_with_text

The correct answer was extracted and then discarded two seconds later for one
29x shorter. Both extractions carry `answerIdentity: current_dispatch`, so
identity cannot separate them; the run's own
`extraction_identity_ambiguous — multiple pre-terminal extractions exist without
a unique accepted-answer identity` says as much.

A later extraction may no longer displace an answer already held for the same
dispatch when it is less than half its length. Growth is unaffected — the
condition is one-sided — and a held answer below the recovery floor blocks
nothing. Rejections are recorded as `SHORTER_EXTRACTION_REJECTED` with both
lengths, so this can never silently discard a genuine correction.

### 2026-08-01 — The digest now carries what the last two fixes needed, version 2.81.213

Both 2.81.211 and 2.81.212 were diagnosed from the full JSON, not the digest.
Worse, one of them was only diagnosable by measuring `detailsLength` (30 vs 33)
to tell `dispatch_mismatch` from `run_session_mismatch` — the reason text itself
is never exported under metadata-only privacy.

- `correlationReason` is now emitted as a metadata field on both lifecycle
  rejections, so the reason survives export instead of being inferred from a
  string length. It also distinguishes *missing* identity from *wrong* identity,
  which are different defects.
- The digest reports that reason together with the expected and incoming ids.
- The extraction chain is now visible: `OBSERVATION_FRAME_CAPTURED` carries its
  text length, and `ANSWER_SOURCE_MATERIALIZED` / `EXTRACTION_COMPLETED` are
  carried at all. The wrong-node signature — a 131-character frame yielding a
  47-character answer while the real one is 1797 — reads directly off the digest.
- The five types previously marked `[UNRECOGNISED]` are read now:
  `STRUCTURAL_VERIFICATION_EVALUATED`, `CANDIDATE_SET_CHANGED`,
  `CANDIDATE_IDENTITY_INFERRED`, `GENERATION_SIGNAL_CHANGED`,
  `GENERATION_STATE_INFERRED`.

Newly visible in the same data, not yet investigated: deliveries also get
rejected by the *sender* gate — `SENDER_TAB_MISMATCH_REJECTED` for Grok and GPT,
`SENDER_WITHOUT_BINDING_REJECTED` for Qwen. That is a different check from
lifecycle correlation and has no `correlationReason` yet.

### 2026-08-01 — A failed extraction now retries the way that works, version 2.81.212

Isolated single-model run (Grok), three exports around one answer:

| moment | result |
|---|---|
| before Get It | no terminal, generation started |
| after Get It | `EXTRACT_FAILED / answer_prompt_echo`, 47 chars |
| after double-click | `SUCCESS / manual_latest_recovery`, **1797 chars** |

The answer was on the page the whole time. Automatic extraction saw a
131-character frame and pulled 47 characters of the user's own prompt out of it,
classified that correctly as a prompt echo, and stopped. `runTerminalExtractionRecovery`
then ran as designed — and re-read the same wrong node, returning the same 131
characters. The manual double-click asks for the *latest* answer node instead
and had the full text within seconds.

- The recovery now requests the latest answer node rather than repeating the
  default target. Every reason that makes it eligible — empty answer, prompt
  echo, UI noise, extract failed — means the default target was wrong, so
  repeating it cannot help.
- Collection and acceptance now share one meta object. They were built
  separately, which is exactly how a recovered answer can still be rejected on
  correlation — the defect fixed in 2.81.211 for two other paths.

### 2026-08-01 — Generated answers were discarded on delivery, version 2.81.211

Full telemetry report of run 1785580394378. All nine models received the prompt
and wrote answers; two of those answers never reached the user because the
background's lifecycle correlation rejected them — for two different reasons.

| model | rejection | cause |
|---|---|---|
| Grok | `LLM_RESPONSE:dispatch_mismatch` | delivered with a null dispatchId |
| DeepSeek | `LLM_RESPONSE:run_session_mismatch` | delivered under a leftover session |

- **Grok**: the main delivery path called `sendResult(payload, true)` while
  `dispatchMeta` was already in scope a few lines above, and every other Grok
  delivery path passed it. The answer arrived with no identity and was dropped.
- **DeepSeek**: `sendResult` forwarded the caller's meta unchanged, and the
  manual-ping path forwards `msg?.meta` — a manual ping carries no dispatch
  identity. Identity is now normalised inside `sendResult`, so every delivery
  path is covered at once. `ensureDispatchMeta` only fills gaps, so an explicit
  meta from a caller still wins.
- Neither answer was missing or short: the same run shows Claude recovering 2997
  characters and Gemini 2726 through manual collection, after the automatic run
  had recorded `send_failed` and `extract_failed` for them.

Not addressed here: why the automatic collection misses answers that manual
collection retrieves, and why most successes are still forced rather than
proven. Those are the same evidence-layer problem, and they are separate.

### 2026-07-31 — The digest states its own limits to its reader, version 2.81.210

A digest is lossy by construction, and a model reading one cannot otherwise
tell the difference between "this run had no such event" and "this document
does not carry that kind of event". The file now opens with a block addressed
to whatever model reads it:

- what it carries, with the count of events carried against the run total;
- **the exact event types it does not carry, with their counts in this run** —
  derived from the run itself, not a static list, so it is always accurate;
- types the digest has no rule for at all are marked `[UNRECOGNISED]`, which is
  the case where the digest may be misleading rather than merely incomplete;
- the rule: do not infer absence from this document, and if the question
  depends on an omitted event type or the failure is not explained here, ask
  the user for the full report before concluding;
- how to produce it: uncheck the `digest` checkbox next to Export.

The previous trailing "unrecognised types" note is folded into this block, so
the warning appears before the data rather than after it. The digest grew from
~9.1KB to ~10.7KB on the reference run — 1.6% of the 640KB report.

### 2026-07-31 — Export delivers digest or full report, by checkbox, version 2.81.209

- A `digest` checkbox sits next to the telemetry Export button on both extension
  pages, checked by default and remembered in `chrome.storage.local`.
  - **Checked** — the export delivers the digest, `…-digest.txt` (~9KB).
  - **Unchecked** — the export delivers the complete report, `…json` (~640KB).
- The report itself is still built in full in both cases. `buildAllPresets` runs
  either way and the digest is derived from its output, so the two documents
  always describe the same run; the toggle only decides which one is handed over.
- The export can never come back empty-handed: if the digest is requested but
  cannot be produced, the full JSON is written instead and the status line says
  `Digest unavailable — full JSON exported`. An absent checkbox or an unset
  preference behaves as checked.
- 2.81.207 wrote both files on every export. That was a misreading of the
  request; the choice is between the two documents, not an extra companion file.
- One existing test sliced a fixed 800 characters from the telemetry toolbar to
  assert button order; the new control pushed a later button past that window.
  The slice now runs to the end of the container, so adding a control cannot
  break the assertion again.

### 2026-07-31 — The digest carries exceptions instead of counting them, version 2.81.208

The 2.81.206 digest read 19% of events and dropped 81%, including
`ANSWER_DELIVERY_REJECTED`, `MISSING_EVIDENCE_RECORDED`,
`POST_TERMINAL_AUDIT_COMPLETED`, `SELECTOR_FORENSIC_SNAPSHOT_CAPTURED`,
`POLICY_OVERRIDE_APPLIED` and the reasons inside `OBSERVATION_FRAME_CAPTURED`.

The first proposal was a coverage line listing what had been dropped. That was
wrong: knowing that six forensic snapshots were discarded does not say whether
the explanation was in them, so it buys a round trip to the JSON rather than
protection. The fix is to stop dropping what matters.

- Exception events are now carried in full. They are rare *because* they mark
  exceptions — 36 of 295 in the run this was built against, against 70
  `OBSERVER_HEALTH_INTERVAL_CLOSED`. The digest went from ~1.7KB to ~9KB, still
  1.4% of the 640KB export.
- The coverage line survives with a narrower and honest job: it reports only
  event types the digest has no rule for at all — types added after it was
  written. That is the one case where the full JSON is genuinely required, and
  it says so.
- On the 2026-07-31 export the expansion immediately surfaced facts that several
  hand-written queries had missed: Gemini accepted a 1090-character answer while
  4316 characters were observed afterwards (growth 3226), Grok accepted 47
  against 1830, and Claude and Le Chat — the two models with no terminal at all —
  both show `dead_tab_no_snapshot / state=DEAD`. That last one is direct
  evidence for the deferred item 4.

### 2026-07-31 — Export writes the digest automatically, version 2.81.207

- The Export button now saves a small companion file next to the JSON:
  `telemetry-all-presets-<ts>-digest.txt`. The JSON stays the archive; the
  digest is the part meant to be read — ~1.7KB against ~640KB.
- The digest logic moved from `scripts/` to `shared/telemetry-digest.js` and the
  CLI is now a thin wrapper over it. One implementation, so a digest produced by
  the button and one produced from the saved file cannot drift apart. The CLI
  invocation is unchanged.
- Both extension pages load the shared module; `web_accessible_resources` needs
  no entry, since they are extension pages loading a same-origin script.
- A digest failure never costs the export: the JSON is written first, and the
  digest is wrapped so any error only skips the companion file. The status line
  says `JSON exported + digest` only when the digest was actually written.
- Tests pin the ordering (archive before digest), the failure isolation, the
  filename pairing, the script tags on both pages, and that the CLI holds no
  second copy of the logic.

### 2026-07-31 — Telemetry digest tool, version 2.81.206

A full "all presets" export of one run measures ~640KB — about 163k tokens read
whole. Its composition:

| section | share |
|---|---|
| `ledger` | 48.8% |
| `reports` (preset definitions) | 45.6% |
| `derivedViews` | 9.0% |
| everything else | <3% |

Nearly half the file is preset report definitions, which carry no run data, and
every diagnosis so far has come from about a dozen fields inside
`ledger.events`.

`scripts/telemetry-digest.js` prints those fields and nothing else: build and
run-session scope (flagging a mixed-session export outright), per-model terminal
status and reason, delivered answers whose length matches the text already on
the page, focus leases that fell below `minUsefulMs`, failed decision rules
grouped by rule, and tab-reuse overrides and fallback creations.

On the 2026-07-31 export that is 1714 bytes instead of 653020 — a 380× cut —
and it surfaced in one line what had taken several separate queries to
assemble: `submission_confirmed` failed for all eight dispatched models.

    node scripts/telemetry-digest.js <export.json>        # human-readable
    node scripts/telemetry-digest.js <export.json> --json # machine-readable

Tests pin what the digest must never drop, including a model that never reached
a terminal and the mixed-session warning.

### 2026-07-31 — No resend after a successful send; debugger stops grabbing focus, version 2.81.205

**Duplicate insert and send after an already successful send (reported for Claude).**
The Round 2 repair path re-dispatches whenever the content script has not
confirmed the submit, and the only bar to that resend was
`RecoveryIntent.authorize` refusing a page-mutating intent once *answer*
evidence existed. While the provider was still generating there was none, so a
prompt that had gone through perfectly was inserted and sent a second time.
A submission already on the page is now proof in its own right, independent of
any answer: `authorize` refuses `resend_prompt` / `composer_repair` when the
submission is confirmed for this dispatch, when generation is active, or when
generation has started. Deliberately unchanged: an `inferred_answer_evidence`
submit does **not** count (it was guessed from page text, not observed, and
treating it as proof would block a real repair), observe-only intents are
untouched, and an explicit user override still wins.

**The debugger transport interrupts work.**
Two separate things were happening. The attach banner is inherent to CDP and
cannot be removed while the donor transport is in use — see the note below. The
other half was `Page.bringToFront`, fired once per trusted action, which yanks
the Chrome window in front of whatever application the user is working in. CDP
input targets the tab's renderer directly and the composer is focused through
`Runtime.evaluate`, so the OS window does not need to be frontmost. All seven
dispatcher call sites now route through a guard that raises the window only
while Chrome already holds focus — the same rule the visit loop got in
2.81.204 — and skips it on an unknown focus state rather than guessing.
The executable dispatcher tests now compile the real guard into their sandbox
instead of stubbing it, so the guard is exercised rather than assumed.

Still open, and a genuine trade-off rather than an oversight: the attach banner
itself. It appears per trusted action, and the trusted path currently runs
*first* for Le Chat because that is what made its send fast. Making it a
fallback behind the in-page strategies would cut the banner to the rare failure
case, at the cost of Le Chat's speed. That choice has not been made here.

### 2026-07-31 — Blank main page, focus theft, duplicate tabs, version 2.81.204

Three reported defects, three separate causes.

**1. The main page periodically loses everything, then returns intact.**
The signature — an empty tab with no address, restored complete by clicking the
extension button — is Chrome's memory saver discarding the tab: the document is
torn down while the tab keeps its slot, and re-activation reloads it and
rehydrates from storage, which is why nothing is actually lost. A long run
leaves the page backgrounded for minutes, exactly when discard happens.
`result_new.html` and `pipeline_panel.html` are now marked
`autoDiscardable: false`, re-asserted on every load and at startup because the
flag is per-tab and survives neither a reload nor a browser restart.

**2. The extension holds focus for 10–15 minutes and takes it from other apps.**
The human/automation visit loop runs while any model is non-terminal, and every
visit called `chrome.windows.update({ focused: true })`, which raises the Chrome
window over whatever application the user is in. A visit needs its tab
foregrounded *inside Chrome*; it does not need Chrome pulled in front of another
app. Both visit paths now check `chrome.windows.getLastFocused()` first and skip
the window raise when no Chrome window holds focus — and skip it on an unknown
state too, rather than stealing focus on a guess. Yielding is recorded as
`WINDOW_FOCUS_YIELDED_TO_USER`.
This bounds the *focus* damage, not the run length; runs stay long while models
fail to reach terminal, which is the deferred item 4.

**3. A repeat request opens a new tab with New pages off.**
`probeReusableTabSurface` rejects any tab whose composer holds text. A draft left
behind by a failed insertion therefore made the tab "unsafe" on the next request,
`tryAttachExistingTab` returned false, and `runModelThroughTabs` fell through to
`createNewLlmTab`. One failed insertion guaranteed a duplicate tab next time —
self-reinforcing, and matching the telemetry, where GPT alone had an empty
dispatch baseline and `anchorAnswerCount: 1`.
With New pages off, reuse is now mandatory: recoverable residue
(`composer_has_draft`, `modal_visible`, a failed probe) is overridden rather than
answered with a duplicate tab, recorded as `SOFT_REUSE_BLOCKER_OVERRIDDEN`.
`generation_active` is deliberately **not** overridable — taking over a tab
mid-generation would destroy a running answer. `TAB_ISOLATION_FALLBACK_CREATE` is
now pinned in telemetry, so a duplicate tab can never again be created without a
retained trace.

### 2026-07-31 — A near-identical prior answer no longer passes as new, version 2.81.203

Diagnosed from the telemetry export of 2026-07-31 (extensionVersion 2.81.201).

- Reported symptom: a repeat request was inserted into no existing page; only a
  new GPT tab opened, and only there was the prompt submitted. The report is
  correct, and the run was worse than "nothing worked" — it reported **SUCCESS**
  for two providers that had received nothing.

  | model | prior text on page | delivered | reported |
  |---|---|---|---|
  | DeepSeek | 5055 chars | 5005 chars | SUCCESS |
  | Qwen | 646 chars | 648 chars | SUCCESS |
  | GPT | 0 (new tab) | 7444 chars | SUCCESS — the only real one |

- Every one of those was `mode: forced`, `evidenceTier: 0`, with
  `submission_confirmed` failing as `evidence_partial` and
  `answer_identity_current_dispatch` observed as `candidate`. The answers were
  never proven to belong to the dispatch; the policy forced them through anyway.
- `isBaselineEquivalent` — the guard whose job is exactly this — compared for
  strict equality. A re-render, a trimmed trailing token or a re-streamed tail
  moves a few characters, and 5055 vs 5005 is not equal, so the previous answer
  was accepted as new.
- The guard now also rejects a candidate that matches the baseline to within a
  small edge difference: a shared prefix and suffix covering ≥97% of the shorter
  text, applied only to answers of at least 120 characters. A genuinely new
  answer diverges early and does not reach that threshold; short texts are left
  alone, where incidental similarity is likely.
- All nine adapters call this one function, so the fix is shared. Tests pin both
  directions, including a new answer that opens with the same sentence as the old.
- Not addressed here: why the prompt reached only one provider, and why a new GPT
  tab opened with New pages off. This change does not fix delivery — it stops a
  failed delivery from being reported as success, so the next run's data is
  truthful.

### 2026-07-31 — Donor trusted transport is the baseline again, version 2.81.202

- Reverts `67cc6d5 "fix: remove browser debugger transport"` by explicit
  decision: the donor 2.81.75 implementation is the baseline we measure the next
  run against, not its removal.
- Restored: the `debugger` permission, `ENABLED_DEBUGGER_RPC_TYPES` with
  `PROVIDER_TRUSTED_SEND_REQUEST`, `PERPLEXITY_TRUSTED_ENTER_REQUEST` and
  `PERPLEXITY_TRUSTED_INPUT_REQUEST`, Le Chat's trusted Send as its first submit
  strategy, and Perplexity's native input transaction as the fallback behind
  in-page preparation. Every route stays sender-gated on the provider origin.
- The telemetry run-session scoping from 2.81.201 is kept on top; the revert
  touched only the transport.
- Status of the two open questions is unchanged and deliberately not claimed as
  fixed: Le Chat submitted quickly on this transport in the field, Perplexity's
  `prompt_injection_failed` has not yet been observed against the restored
  native input path.

### 2026-07-31 — Telemetry is scoped to one run session, version 2.81.201

- Symptom: reloading the results page pulled in telemetry and other data from
  the previous session, so an export could describe two runs at once.
- Two independent stores leaked, for the same reason: neither was scoped to a
  run, and both were only ever cleared when a *new run started* — not when a
  page reloaded.
  - **Proof ledger.** The export requests its snapshot with `runSessionId: null`
    (the page does not track the active session), and the ledger read null as
    "every run ever recorded". `beginRun` resets `state.events` but deliberately
    keeps `state.lifecycle`, so the lifecycle stream carried earlier sessions
    into the file — while the file was labelled with the *current*
    `runSessionId`. An absent scope now resolves to the ledger's own active run;
    `allRunSessions: true` is the explicit opt-in for the full history, and the
    snapshot reports which of the two it is via `runSessionScope`.
  - **Diagnostics buffer.** `GET_DIAG_EVENTS` returned the whole persisted
    buffer. After a reload with no new run, the page re-hydrated the previous
    session, and its own "current run" resolver — which reads the newest event
    it was handed — then presented that stale run as active. The handler now
    scopes to the ledger's active run. Entries with no run identity
    (setup/system lines) are kept, so nothing legitimate disappears.
- Added `ProofTelemetryLedger.currentRunSessionId()` for callers that must scope
  a different store to the same run without awaiting a snapshot. It is covered
  by a test on purpose: the diagnostics filter reads it through optional
  chaining, so had it stayed absent the filter would have silently become a
  no-op and looked like a fix while changing nothing.
- One existing ledger test asserted the old whole-history default; it is about
  generation burning across two runs, so it now asks for `allRunSessions: true`
  explicitly and additionally pins the new scoped default.

### 2026-07-31 — Perplexity regains the donor's native input transaction, version 2.81.199

Two earlier attempts at this defect were wrong and are reverted; this entry
records what the field data actually ruled out.

- **Refuted — the Lexical commit race (2.81.197).** Real, but not the cause.
- **Refuted — the focus lease (2.81.198).** The hypothesis was that Perplexity's
  automation focus lease (684 ms against `minUsefulMs` 1500) ended before the
  in-page insert could run. The hold was raised to 8000 ms and the lease
  duly grew to **8656 ms** — and the run still ended `prompt_injection_failed`.
  Focus was not the cause. The change also starved Le Chat downstream (denied
  `active_lease` at its round-3 precollect) and broke a working provider, so it
  is reverted in full.
- **What was actually missing.** Donor 2.81.75 gives Perplexity *two* trusted
  paths, input and send. Only the send half was ported; the insertion half was
  left out on the assumption that insertion worked. The observed failure is
  `prompt_injection_failed` — insertion — and 2.81.195's allowlist additionally
  had `PERPLEXITY_TRUSTED_INPUT_REQUEST` returning `debugger_route_disabled`.
- Restored: the route is enabled, and when `prepare()` fails the adapter
  re-enters through `dispatchProviderTrustedInput` — focus the composer, native
  SelectAll, native `Input.insertText`, then reacquire the live editor because
  React may swap the node. **That SelectAll is also the clear** that the
  execCommand-based `clear()` cannot perform when the editor ignores it, which
  is why leftover text in a reused tab was never replaced.
- In-page insertion remains the primary path; the native transaction is the
  fallback behind it. Le Chat is untouched.

### 2026-07-30 — Eager telemetry export click bootstrap, version 2.81.182

- A small bootstrap is loaded before the heavy results runtime on both result
  pages. It captures the first JSON-export click even when the lazy DevTools
  module is not ready yet, loads that module immediately, and resumes the same
  export automatically.
- The export button now exposes busy state and phase text while the exporter is
  loading and while the snapshot is being prepared.
- Added a jsdom interaction test covering an icon click before DevTools load.

### 2026-07-30 — Cold-start telemetry export route, version 2.81.181

- `GET_PROOF_TELEMETRY_SNAPSHOT` is now handled before the shared background
  initialization gate. A JSON export no longer waits for job-state, tab-map,
  resolution-metrics, dispatch-circuit, or lifecycle bootstrap on a cold
  service-worker start.
- The two-second ledger barrier now measures the complete background portion
  of the export request instead of starting only after unrelated initialization.
- Added a regression guard that locks the early route before
  `isInitialStateReady()` / `ensureInitialState()`.

### 2026-07-30 — Bounded telemetry export barrier, version 2.81.180

- JSON export waits at most two seconds for the proof-ledger mutation queue.
  If the queue is still backlogged, export uses the latest fully committed
  boundary instead of appearing several minutes later.
- The UI reports whether the exported boundary was queue-drained or committed
  while background persistence continues.
- IndexedDB proof writes use relaxed durability: transactions remain ordered
  and atomic, while Chrome may coalesce physical disk flushes instead of
  forcing one fsync per telemetry signal.

### 2026-07-30 — Immediate telemetry JSON snapshot, version 2.81.179

- Proof telemetry keeps one normalized state cache during a service-worker
  epoch instead of rereading the full IndexedDB ledger before every event.
- Events emitted in the same synchronous burst are persisted in one ordered
  transaction. Export snapshot flushes that batch first, so speed no longer
  trades away events or the immutable snapshot boundary.
- Added a regression test proving that 50 concurrent records require one
  persistence write and all 50 remain present in the exported snapshot.

### 2026-07-30 — Expected-length adaptive deadlines, version 2.81.178

- Pipeline and watcher deadlines now use the requested answer-size bucket
  instead of only the text already present when observation starts.
- Continued answer growth can extend a short initial deadline up to the active
  profile's hard maximum, without moving beyond that bound.

### 2026-07-30 — Stop-button hard guard, version 2.81.177

- A visible provider Stop control blocks every successful watcher completion,
  including after the soft deadline.
- Reaching the hard deadline with Stop still visible now returns an explicit
  incomplete `hard_timeout` instead of a false stable-content success.

### 2026-07-30 — Tri-state generation proof, version 2.81.176

- Generation selectors now distinguish a proven inactive provider control from
  a complete selector miss.
- A selector miss produces `active: null`, activating the existing
  `generation_inactive_unproven` finalization guard instead of false SUCCESS.

### 2026-07-30 — Post-terminal answer revision UI, version 2.81.175

- Late unmarked answer payloads no longer replace the accepted text of a
  terminal debate card or its live result panel.
- The UI appends a collapsible, source-labelled revision with the length delta;
  explicitly marked answer revisions retain their existing update path.

### 2026-07-30 — Fail-closed lifecycle configuration, version 2.81.174

- Structural lifecycle verification no longer substitutes two 25 ms snapshots
  when the pipeline finalization configuration is unavailable.
- Verification waits for timing-profile readiness, so Long runs use their five
  configured stability snapshots.

### 2026-07-30 — Verification observation age, version 2.81.173

- Background preserves the producer's `observedAt` timestamp for answer proof
  and records message receipt separately as `recordedAt`.
- Telemetry now exposes both timestamps, enabling a truthful proof TTL.

### 2026-07-30 — Monotonic answer verification, version 2.81.172

- A later unverified pipeline retry no longer overwrites an already verified
  structural answer proof.
- The most recent attempt remains available as `answerVerificationLast`, so
  diagnostics retain failed retry evidence without changing the accepted proof.

### 2026-07-30 — Extended post-terminal observation, version 2.81.171

- The bounded lifecycle audit now samples at 1/3/8/15/30 seconds, covering
  generation resumptions that occur after the previous eight-second window.
- A regression test proves that text growth beginning at 12 seconds is observed
  and closes the window as changed at 30 seconds.

### 2026-07-30 — Adapter response proof metadata, version 2.81.170

- All nine provider adapters now attach pipeline completion reason, sanity
  warnings/confidence and answer verification to the response payload consumed
  by background finalization.
- DOM, selector and last-chance fallbacks are explicitly marked as unverified
  instead of silently looking like verified pipeline output.
- A shared response-metadata builder keeps the provider contract consistent.

### 2026-07-30 — Bounded post-terminal observation, version 2.81.169

- The lifecycle tracker samples at 1/3/8 seconds after completion and emits an
  explicit changed, unchanged or unavailable window closure.
- Intermediate zero-growth frames remain pending; only a complete unchanged
  window refutes False success.
- Normalization versions survive proof-ledger metadata compaction.
- The executable matrix covers normal completion, real growth, throttling,
  recovery, repeated dispatch, attachments, SPA navigation and tab closure.
- Registry 6.6.0, report 3.6.0 and generator 2.6.0 describe the closed window.

### 2026-07-30 — Lifecycle proof identity, version 2.81.168

- Lifecycle events carry immutable run, dispatch, generation, turn and
  navigation identity captured at tracker creation.
- Starting a new generation epoch no longer reuses an older active tracker.
- A proven document or SPA navigation mismatch makes post-terminal evidence
  incomparable instead of manufacturing growth.
- Registry 6.5.0, report 3.5.0 and generator 2.5.0 capture the identity rules.

### 2026-07-30 — Comparable terminal/recovery evidence, version 2.81.167

- `MODEL_FINAL` now publishes accepted normalized length, hash, version and
  attempt identity already computed by the answer commit.
- Post-terminal audit compares normalized evidence only under a matching
  normalization version and records mismatches as unknown.
- Successful late-collect evidence participates in the audit; a recovery visit
  without answer evidence remains transport-only.
- Registry 6.4.0, report 3.4.0 and generator 2.4.0 describe the evidence path.

### 2026-07-30 — False success occurrence contract, version 2.81.166

- A proven post-terminal growth confirms the False success occurrence even
  when the reason for the premature completion is not yet known.
- Post-terminal mutation evidence must be measured and occur after the terminal
  boundary; pre-terminal generation cannot close that slot.
- Typed completion facts no longer conflict with an absent canonical detail.
- Registry 6.3.0, report 3.3.0 and generator 2.3.0 encode the new contract.

### 2026-07-29 — No delivery usability boundary, version 2.81.165

- A bare normalized-hash mismatch with a usable answer no longer confirms No
  delivery, preventing semantic overlap with Cutted.
- Card render evidence now records usability independently from content class
  and source/card comparison.
- The explicit producer inventory includes current-dispatch resolution, stale
  baseline rejection, selector failure and provider finish-reason labels; they
  are covered as literals without restoring heuristic regex promotion.
- Registry 6.2.0, report 3.2.0 and generator 2.2.0 encode the tightened
  applicability semantics.

### 2026-07-29 — No delivery product cutover, version 2.81.164

- Replaced `Empty` with `No delivery` in both Telemetry Task filters and the
  current standalone/All tasks export registry.
- Removed `Empty` from current arbitration, dependency and sibling rules after
  the commit/render shadow gate.
- Historical Empty reports from registries 5.6.0–6.0.0 use a frozen contract;
  known registry hashes are checked and their meaning is not recomputed under
  current No delivery semantics.
- Registry 6.1.0, report 3.1.0 and generator 2.1.0 describe the cutover.

### 2026-07-29 — No delivery shadow contract, version 2.81.163

- Added a shadow `No delivery` report that proves provider-surface answer
  materialization and expected-card outcome for the same attempt and payload.
- Occurrence, cause, evaluation boundary and resolution state are independent;
  unknown identity or normalization produces `unknown`, not a guessed failure.
- The attempt graph exposes six initially provable mechanisms and separate
  observability/recovery findings.
- `Empty` and `No delivery` are built from one canonical ledger and their
  per-incident verdict differences are recorded for migration review.
- Registry 6.0.0, report 3.0.0 and generator 2.0.0 define the shadow contract.

### 2026-07-29 — Answer commit and card render boundaries, version 2.81.162

- Accepted answers pass through one commit-evidence owner before SUCCESS is
  published; overwrite records preserve the previous normalized identity.
- Final response messages carry dispatch, attempt, payload and expected-card
  identity to the results page.
- The results page evaluates the actual expected card as matched, empty,
  mismatched, incomparable or wrong-card and returns privacy-safe evidence to
  background; only the registered results tab is accepted.
- Registry 5.9.0, report 2.11.0 and generator 1.12.0 recognize commit/render
  proof boundaries.

### 2026-07-29 — Source and delivery boundaries, version 2.81.161

- Provider completion snapshots now carry attempt-scoped normalized evidence.
- A validated current-dispatch snapshot emits `ANSWER_SOURCE_MATERIALIZED` and
  `ANSWER_DELIVERY_ACKNOWLEDGED` with one shared payload identity.
- A response arriving after terminal emits `ANSWER_DELIVERY_REJECTED` with
  `post_terminal_noise`; sender and correlation failures retain their existing
  labels but carry delivery identity and canonical delivery semantics.
- Registry 5.8.0, report 2.10.0 and generator 1.11.0 recognize the new proof
  boundaries without treating them as submission or text-growth evidence.

### 2026-07-29 — Shared answer proof normalization, version 2.81.160

- Added one versioned normalization and hashing implementation shared by
  provider scripts, background and result pages.
- Evidence comparisons are explicitly incomparable when normalization versions
  differ or hashes are missing.
- Payload evidence identity includes the dispatch and attempt, so two identical
  payload transmissions remain distinct without exporting answer text.

### 2026-07-29 — Proof-event mapping sanitation, version 2.81.159

- Replaced heuristic runtime-label promotion with an explicit proof-event
  whitelist; unknown, recovery-planning, attachment and CDP-file labels stay
  outside diagnostic evidence slots.
- Answer sender/correlation rejections now become delivery rejections instead
  of submission or text-evolution evidence.
- Extraction attempts are distinct from extraction outcomes; fallback is a
  mode and no longer an outcome.
- Registry 5.7.0, report 2.9.0 and generator 1.10.0 add regression coverage for
  false `Cutted`, `Late end` and `Empty` evidence.

### 2026-07-29 — One-click selection favorites, version 2.81.158

- The star in selection toolbars now commits the favorite on `pointerdown`,
  before a model page can clear the browser selection or consume the later
  `click` event.
- The following synthetic `click` is suppressed, so one physical press creates
  exactly one favorite on the main page, model pages and debate fragment cards.
- Model-page storage now performs one read-modify-write transaction per toggle,
  avoiding a second asynchronous storage read during insertion.
- Regression tests cover selection loss between `pointerdown` and `click` and
  verify that a full pointer gesture creates only one fragment card.

### 2026-07-29 — Preset semantic review iteration 3, version 2.81.157

- Absence windows now start at the failed insertion/submission action and must
  prove at least `generationStartTimeoutMs` of complete post-failure coverage.
- Late end is candidate-bound and measured from the first active eligibility;
  deadlines and repeated acceptance cannot hide the real wait.
- Unknown typed facts use canonical fallback; typed/canonical contradictions
  are explicit localized invariants.
- Embedded completeness is incident-local, and every embedded event sequence
  has a scoped proof-closure inclusion reason.
- Prompt not inserted requires submit counter-evidence only after submit was
  observed. Cutted uses the final valid candidate boundary instead of the
  historical maximum.
- Refutation semantics are declared as complement or independent. Temporal
  ordering now covers all seven Tasks.
- `single_candidate` measurements and unresolved Old answer prior references
  cannot produce strong confirmation.
- Registry 5.6.0, report 2.8.0 and generator 1.9.0 add the W1-W12 adversarial
  regression matrix and regenerate All tasks plus seven standalone reports.

### 2026-07-29 — Preset semantic review iteration 2, version 2.81.156

- Standalone compaction now preserves only the selected Task's frozen
  applicability/refutation/slot projection. A 320-event Cutted incident is
  reduced below 40 events without full-incident fallback.
- Added `supported_but_incomplete`: positive applicability with missing
  required evidence cannot win primary-diagnosis arbitration.
- Added graded measurement comparability and candidate continuity across
  coverage, extraction, structural verification and post-terminal growth.
- Added active evidence supersession. The latest completeness decision wins;
  proven growth persists until an explicit rollback invalidates it.
- Absence diagnoses require a complete reliable observation window. Degraded
  or incomplete observation is `unknown` with an explicit missing slot.
- Late end requires positive interval coverage and measures from the evidenced
  policy-eligibility event. Same-length observations no longer count as growth.
- Ledger deduplication includes candidate/document/turn/navigation identity,
  and companion events inherit that identity. Ambiguous accepted extraction is
  emitted as `MISSING_EVIDENCE_RECORDED`.
- Old answer slots contain actual prior-incident events and compare
  privacy-safe hashes when available; an external referenced prior is a
  bounded limitation rather than invented negative proof.
- Every Task has explicit refutation predicates; every sibling pair is causal
  or explicitly co-occurring. Invariant violations are localized to affected
  reports, slots and fields, while missing legacy lineage is a limitation.
- Registry 5.5.0, report 2.7.0 and generator 1.8.0 regenerate All tasks and all
  seven standalone reports with task-local replay/hash validation. Focused gate
  passes 7 suites / 91 tests; the full project gate passes 187 suites / 1308
  tests.

### 2026-07-29 — Cross-incident and measurement semantics, version 2.81.155

- Candidate continuity is required before comparing observed and extracted
  lengths; cross-candidate coverage is unknown rather than a truncation proof.
- Explicit refutation predicates are executable registry data. Generation start
  refutes Prompt not sent without requiring a text-length measurement, and Old
  answer requires an accepted SUCCESS boundary.
- Late end uses the configured policy tolerance plus rejected decision,
  deadline or blocking policy evidence; a 1 ms delay is not a diagnosis.
- Old answer now requires `priorIncidentRef`; runtime resolves it against the
  actual ledger and standalone closure materializes a separate prior evidence
  lane. A missing prior incident makes the strong verdict unknown.
- The post-terminal growth tolerance has one source of truth. Hash-only changes
  remain audit contradictions but do not satisfy the growth-specific False
  success question.
- Coverage excludes inactive conditional slots, completeness states are
  enumerated, conclusions cite slot IDs, and each diagnostic field has narrow
  event provenance. Focused gate passes 8 suites / 88 tests; the complete gate
  passes 186 suites / 1292 tests.

### 2026-07-29 — Verdict-preserving compaction, version 2.81.154

- Standalone applicability is frozen from the complete exact incident instead
  of being recomputed only from the compacted subset.
- Registry 5.3.0 declares counter-evidence event types for every Task; rejected
  fact matches and refuting observations receive explicit inclusion reasons.
- Each report commits to the full-incident semantic hash and to full/materialized
  verdict projection hashes. Offline validation requires exact equivalence.
- If bounded selection changes any state axis or Task applicability, the
  builder automatically materializes the complete incident as a safe fallback.
- Regression coverage proves that a refuted Prompt not sent diagnosis remains
  refuted after standalone compaction; 4 suites / 50 tests pass.

### 2026-07-29 — Fact-level evidence and composite verdict, version 2.81.153

- Added executable fact and temporal matching rules to registry 5.2.0; presence
  of an event type alone no longer satisfies protected evidence slots.
- SUCCESS slots reject FAILURE terminal facts. Post-terminal audit evidence must
  occur after terminal and cite terminal plus a later observation.
- Added `diagnosticVerdict`: confirmed applicability becomes unknown when proof
  is insufficient or temporal/causal invariants are violated.
- Diagnosis arbitration now uses the composite verdict, and embedded
  completeness ignores unrelated not-confirmed incidents and inactive
  conditional slots.
- Offline validation independently replays slots, invariants and verdicts.
- Focused semantic/validator gate passes 5 suites / 55 tests.

### 2026-07-29 — Strict incident identity boundaries, version 2.81.152

- Unified policy, audit and evidence-closure scope comparison, including
  `runGeneration`, dispatch and generation epoch.
- SYSTEM evidence is now admitted only from the same run and run generation;
  cross-run references produce an explicit scope violation.
- Unknown explicit incident IDs return `explicit_incident_not_found` instead of
  silently selecting another incident.
- Added one normalized identity vocabulary shared by Old answer and Empty.
- Focused scope/contract gate passes 5 suites / 38 tests.

### 2026-07-29 — Task JSON export across platforms, version 2.81.151

- Fixed JSON export for every concrete Telemetry Task: `All platforms` now
  expands the selected Task to all indexed model incidents instead of refusing
  to export until one Platform is selected.
- A concrete Platform still narrows export to that model, with one bounded
  standalone proof report per exact incident in deterministic evidence order.
- Removed the hidden header-model restriction from proof JSON export, so its
  scope is controlled only by the two visible Telemetry filters.
- Added regression coverage for all-platform and single-platform Task target
  selection; the focused telemetry gate passes 9 suites / 75 tests and the
  complete gate passes 186 suites / 1273 tests.

### 2026-07-29 — Prompt insertion diagnosis, version 2.81.150

- Added the separate `Prompt not inserted` Task for failures before the prompt
  reaches the live composer.
- Preserved lifecycle error type, source and privacy-safe prompt length and
  emitted an incident-scoped typed insertion outcome into the proof ledger.
- Added semantic counter-evidence: confirmed submission, generated text,
  non-empty extraction or SUCCESS refutes an insertion-failure diagnosis.
- Added causal arbitration so `Prompt not inserted` is the cause and `Prompt
  not sent` is its consequence when both are independently proven.
- Updated both Telemetry views, executable registry, examples, tests and
  documentation; all 186 suites / 1272 tests pass and project version is
  2.81.150.

### 2026-08-28 — Preset semantic hardening gate, version 2.81.149

- Completed positive, negative and unknown semantic coverage for all six Tasks,
  including cross-incident isolation, embedded sufficiency, causal arbitration,
  standalone negative conclusions and proof-preserving compaction.
- Dependency registry 5.0.0 is now the exact executable snapshot shared by All
  tasks, standalone reports, generated documentation and offline validation.
- Report format 2.2.0 and generator 1.3.0 expose incident applicability,
  `requiredIf`, diagnosis roles and explicit legacy limitations.
- Embedded projections reference the single incident timeline and registry;
  they no longer repeat complete derived views, state axes or slot contracts.
- Regenerated and independently validated All tasks and all six standalone
  examples against the updated schemas and registry.
- Full regression gate passed 185 suites / 1269 tests; focused telemetry gate
  passed 13 suites / 99 tests.

### 2026-08-28 — Unified evidence closure, version 2.81.148

- Embedded and standalone reports now resolve the same executable evidence-slot
  contracts and expose per-incident sufficiency independently from applicability.
- Removed the duplicate report event catalog; event selection is derived only
  from `REPORT_CONTRACTS`.
- Conditional slots implement executable `requiredIf` and become required only
  in the matching terminal/observation state.
- Related diagnoses keep their truthful applicability while one primary cause
  and explicit consequence/related roles guide analysis.
- Standalone closure retains boundaries, extrema, state changes and explicit
  provenance while removing repeated evidence with the same proof role.
- Legacy exports state clock and identity limitations explicitly and never infer
  current-answer identity from dispatch presence alone.

### 2026-08-28 — Preset evidence semantics, version 2.81.147

- Old answer now gives explicit current-dispatch identity precedence and
  compares normalized dispatch identifiers only when both are known.
- False success distinguishes completed, pending, impossible and absent audit;
  only audited positive length growth confirms the diagnosis.
- Cutted measures extraction coverage only before terminal and never substitutes
  terminal length for missing extraction evidence.
- Prompt not sent is refuted by confirmed submission, observed generation,
  non-empty accepted extraction or SUCCESS in the same incident.
- Empty resolves the extraction actually accepted by terminal and distinguishes
  empty-result from wrong-node evidence.
- Late end requires an explicit policy decision to wait, comparable clocks and
  no later text mutation or active-generation evidence.

### 2026-08-28 — Incident-scoped embedded applicability, version 2.81.146

- All tasks now derives every semantic view from one exact incident scope
  `(run, run generation, Platform, dispatch, generation epoch)`.
- Embedded applicability is recorded and aggregated from explicit incident
  results; a later request can no longer change the diagnosis of an earlier
  request on the same Platform.
- Added an incident timeline while retaining the latest per-Platform timeline
  as a compatibility projection.

### 2026-08-28 — Incident-safe post-terminal audit, version 2.81.145

- Post-terminal audit now requires the exact run generation, model, dispatch
  and generation epoch even when the policy module is unavailable.
- Missing answer lengths are preserved as unknown instead of being converted
  to zero; hash evidence remains independently comparable.
- When neither length nor hash can be compared, audit records an explicit
  `unknown` conclusion and missing-evidence impact rather than a false growth
  confirmation or refutation.

### 2026-08-28 — Semantic preset applicability, version 2.81.144

- Separated evidence-slot completeness from proof that the selected problem
  occurred; every Task now reports tri-state semantic applicability.
- Cutted requires SUCCESS plus positive incomplete-capture evidence, and False
  success requires audited growth after the SUCCESS terminal boundary.
- Old answer requires accepted-answer dispatch mismatch; Empty requires
  observed generated text plus failed/zero extraction; Prompt not sent requires
  explicit failed submission evidence.
- Late end uses comparable producer/worker monotonic clocks and preserves
  unavailable time as unknown instead of subtracting wall timestamps.
- Sibling diagnoses now require positive anomaly facts; missing/null values do
  not satisfy ordinary comparison predicates.
- MODEL_FINAL retains privacy-safe answer-evidence identity/length fields, and
  the offline validator independently replays applicability.

### 2026-08-28 — User-question telemetry presets, version 2.81.143

- Replaced eight overlapping technical Tasks with six user-facing diagnoses:
  `Cutted`, `False success`, `Old answer`, `Empty`, `Prompt not sent`, and
  `Late end`.
- Merged true-completion, forced-success and forced-finalization evidence into
  `False success`; split extraction failures into wrong-turn and empty/wrong-node
  reports.
- Added `stableToTerminalMs` so `Late end` reports the actual wait between the
  last confirmed stable boundary and terminal recording.
- Kept one canonical segmented event ledger; All tasks and standalone Tasks
  remain projections rather than parallel telemetry recordings.
- Updated both Telemetry surfaces, executable contracts, validator, examples,
  dependency registry and documentation.

### 2026-08-28 — Semantic ingestion and operational aggregation, version 2.81.142

- Removed the catch-all runtime conversion of unknown legacy labels into
  `OBSERVER_HEALTH_OBSERVED`: proof facts, operational signals and unknown
  debug events now have separate routes.
- Adaptive probes, manual pings, gate waits, detector/recovery/focus polling
  persist as bounded `OBSERVER_HEALTH_INTERVAL_CLOSED` summaries rather than
  one canonical event per iteration.
- Unknown legacy labels are aggregated in a bounded debug ring outside proof
  exports. Known provider-specific submission/candidate/extraction failures
  retain explicit typed mappings.
- Canonical metadata now keeps proof-bearing scalar/metric fields and removes
  repeated taxonomy/version/state projections. Optional null clock fields are
  omitted.
- All-presets internal indexes use numeric `eventSeqs`; repeated UUID arrays
  are retained only in standalone/external proof boundaries.
- Oversized All-presets artifacts explicitly report
  `oversized_preserved_core`; evidence is not silently discarded.
- A stress regression reduces 635 polling/debug inputs to fewer than 20 proof
  events and a sub-100 KB snapshot while retaining typed failure summaries.
- Full regression gate passed 184 suites / 1249 tests.

### 2026-08-28 — Task export zero-evidence fix, version 2.81.141

- A selected Task no longer requires an event from its own evidence-slot list
  before export. Zero-match incidents now produce an explicit `insufficient`
  standalone report, which is essential for absence-oriented diagnostics.
- Such reports retain one incident anchor with `includedFor`, enumerate every
  unavailable critical/required slot and pass independent validation.
- Platform options are the union of the supported catalog, selected models and
  observed `modelId/platform/llmName`; the dropdown is no longer truncated to
  currently active models.
- Focused regression gate passed 4 suites / 31 tests.

### 2026-08-28 — Incident telemetry cutover, version 2.81.140

- Telemetry keeps exactly two filters, Platform and Tasks, while the existing
  status area shows selected dispatch/generation, selection reason and the
  number of other matching incidents.
- A task matching multiple incidents exports one isolated standalone artifact
  per incident instead of merging their evidence.
- Added a `proofTelemetryShadowCompare` feature flag for comparison with the
  shared-ledger builder without changing exported evidence.
- Removed the legacy schema 5 proof storage key and obsolete standalone closure
  path; schema 6 incident persistence/builder is the runtime source of truth.
- Missing observation is now `unknown`, not reliable, and cannot promote a
  strong UI transition to T3.
- Final regression gate passed 184 suites / 1244 tests; every numbered plan and
  acceptance metric is complete.

### 2026-08-28 — Segmented proof persistence, version 2.81.139

- Canonical events, lifecycle, incident indexes, quarantine and attachments now
  use separate IndexedDB stores; `chrome.storage.local` keeps only a compact
  active pointer/manifest and feature state.
- Strict transactions append only records beyond the persisted ingestion
  boundary and update the projection atomically.
- Indexed run/incident reads avoid loading unrelated historical telemetry.
- Added index rebuilding, crash continuation and quota failure behavior; a
  failed activation transaction cannot make a run active.
- Added restart/durability, incident-range and compact-pointer regressions.

### 2026-08-28 — Strict proof validator and optimizer, version 2.81.138

- Offline validation now executes container, report and schema 6 event JSON
  Schemas, incident/lifecycle/clock rules and S01–S20 semantic invariants.
- Evidence slots, inclusion reasons, field provenance, registry identity,
  siblings, attachments, privacy and canonical ingestion order are rebuilt and
  verified rather than trusted.
- Replay and semantic hashes are recomputed from materialized closure; wall
  timestamps cannot change semantic identity.
- Representation optimization runs only after evidence sufficiency and never
  removes core events. Unavoidable overflow is explicit, not a failed proof.
- Added tampering, wall-time independence and preserved-core overflow tests.

### 2026-08-28 — Incident standalone report builder, version 2.81.137

- Standalone reports no longer build an All-presets container first; each task
  uses its selected incident and evidence closure directly.
- State axes, summaries and replay are derived only from materialized events,
  with per-field event provenance and derivation versions.
- Slot sufficiency produces explicit missing evidence, safe conclusions and
  blocked conclusions; sibling requests carry anti-loop metadata.
- Reports include semantic and artifact hashes plus measurement-only size
  categories. Evidence is never removed to hit a numeric target.
- All eight task artifacts pass closure replay and event-deduplication tests.

### 2026-08-28 — Incident evidence graph, version 2.81.136

- Added an incident index keyed by run generation, model, dispatch and
  generation epoch, with candidate and navigation lineage.
- Platform + Task deterministically select one incident and retain the reason
  plus identifiers of other matching incidents.
- Report contracts resolve critical/required/conditional slots and classify
  evidence as complete, bounded or insufficient.
- Evidence closure includes causal, correlation, decision, terminal, audit and
  SYSTEM context; every materialized event records `includedFor` provenance.
- Cross-dispatch and cross-generation edges are rejected as scope violations.

### 2026-08-28 — Typed transition telemetry, version 2.81.135

- Canonical events persist typed facts; legacy label interpretation remains in
  one migration adapter.
- No-op suppression is keyed by incident and signal, so interleaved polling no
  longer defeats deduplication; rare heartbeats summarize long quiet periods.
- Observation intervals close immutably on navigation, restart and run close,
  with explicit degraded coverage where continuity is unknown.
- Inference companions are emitted only on state transitions and payload
  metadata no longer repeats canonical envelope identity fields.

### 2026-08-28 — Proof lifecycle and clock runtime, version 2.81.134

- Runtime events now use schema 6 with non-reused run generations, globally
  monotonic ingestion order and collision-resistant identity.
- Run intent/open/supersession/close transitions are an append-only lifecycle
  journal; pending evidence promotes deterministically and late evidence stays
  quarantined.
- Added producer and service-worker clock epochs, exact/bounded/unavailable
  comparisons and tri-state duration thresholds.
- Atomic observations record per-signal checks, delivery delay and independent
  coverage; worker restart closes open intervals as degraded.
- Producer reordering becomes an explicit audit anomaly rather than a silent
  timestamp reorder.

### 2026-08-28 — Executable proof contracts and schema 6, version 2.81.133

- Added one runtime report registry for all eight diagnostic tasks, with typed
  evidence slots and criticality.
- Added the schema 6 canonical-event contract, including producer and ingest
  clock epochs, global ingest ordering and run generation.
- Evidence policy now consumes typed facts; all legacy label interpretation is
  isolated in one migration adapter.
- Incident compatibility is strict across run, model, dispatch and generation;
  missing dispatch identity is never treated as a wildcard.
- Added registry, JSON Schema and strict-scope conformance regressions.

### 2026-08-28 — Proof telemetry safety containment, version 2.81.132

- Late/mismatched run evidence quarantines instead of replacing the active
  ledger; new runs are admitted before model telemetry.
- Added bounded pending/quarantine staging and explicit detected-loss markers.
- Removed false T3 promotion and false standalone validation/replay attestation.
- Restored standalone JSON Schema validity and SYSTEM context under Platform.
- Unified signal skew at 250 ms and replaced optimistic observation defaults.

### 2026-07-28 — Bounded standalone telemetry reports, version 2.81.131

- `Tasks` заменён восемью proof-oriented диагностическими вопросами и при
  экспорте создаёт самостоятельный отчёт для явно выбранной Platform.
- Standalone-файл материализует минимальное evidence closure без повторяющихся
  `eventId`, сохраняет state/replay/hash контекст и ограничен 60 KB.
- Offline validator поддерживает оба file kinds и проверяет standalone refs,
  hash, privacy, sequence, budget и отсутствие дублей.
- Каноническая таблица event types переиспользуется UI; явная Platform больше
  не конфликтует с состоянием кнопок выбора моделей.
- `Only problems` не добавлен: конкретная диагностическая задача является
  более точным и дешёвым входом в анализ.
- Regression gate прошёл 27 suites / 203 tests.

### 2026-07-28 — Native-only proof telemetry cutover, version 2.81.130

- Удалена runtime-зависимость JSON export от legacy grouped telemetry и
  `shared/telemetry-export.js`; fallback на legacy snapshot запрещён.
- Platform/Tasks применяются непосредственно к canonical envelopes с
  сохранением исходных seq и корректного filtered export boundary.
- Ledger начинается с `RUN_CONFIG_RECORDED`; lifecycle snapshot получает полный
  atomic observation frame contract, candidate facts — identity inference.
- Legacy diagnostics сохранены только для Timeline/Markdown совместимости.
- Расширенный telemetry/lifecycle/finalization regression gate прошёл 27 suites,
  173 tests.

### 2026-07-28 — Offline proof telemetry validator, version 2.81.129

- Добавлен CLI `npm run validate:telemetry -- <all-presets.json>`.
- Validator проверяет ledger/report refs, hashes, atomic boundary, compatibility,
  requestIf evaluations, privacy, budget и deterministic decision replay.
- Поддержано восстановление независимых axes на произвольном `seq`.
- Temporal replay теперь различает pause, same-length hash mutation, stale/prompt
  echo/ambiguous candidates, throttling и selector degradation.
- Добавлена сценарная матрица нормативных normal/anomaly/forced/active/replay
  случаев спецификации.

### 2026-07-28 — Post-terminal audit and forensic triggers, version 2.81.128

- Terminal boundary теперь явно отмечает pending post-terminal evidence.
- Поздние answer/text/candidate observations сравниваются с terminal length/hash
  и создают confirmed/contradicted audit с точным ростом.
- Post-terminal growth, selector/observer failures и contradictions создают
  anomaly-triggered forensic records.
- Metadata-only privacy не допускает скрытого raw DOM persistence: недоступный
  capture становится явным attachment omission с reason/impact/eventRef.
- Исправлен derived growth baseline: сравнение идёт с принятым terminal length.

### 2026-07-28 — Evidence policy and decision replay, version 2.81.127

- Добавлен pure policy/replay engine с независимыми axes и evidence tiers T0–T4.
- Runtime создаёт inference companions для submission/generation/completeness и
  отдельные policy/decision/override события.
- Forced SUCCESS больше не маскируется под inferred completion: waived rules и
  residual risk сохраняются явно.
- Terminal action связывается evidenceRefs с принятым decision; replay проверяет
  S06/S07 и сравнивает recorded/recomputed SHA-256 decision hashes.
- Добавлены сценарии timeout below T3, provider T4, missing lineage и forced
  override с успешным deterministic replay.

### 2026-07-28 — Native proof telemetry ledger, version 2.81.126

- Добавлен persistent append-only schema 5 ledger в background service worker.
- Canonical события записываются до legacy sampling/post-terminal suppression,
  получают seq/eventId/monoMs/correlation envelope и проходят privacy sanitizer.
- Storage append и export snapshot используют одну mutation chain; новый run,
  Clear и extension update очищают ledger по явной границе.
- All-presets export читает native ledger через
  `GET_PROOF_TELEMETRY_SNAPSHOT`; legacy runtime adapter оставлен только как
  fallback для миграционной совместимости.
- Добавлены тесты persistence, monotonic sequence, no-op suppression, privacy,
  run rotation и native export source-of-truth.

### 2026-07-28 — Two-filter Telemetry toolbar, version 2.81.125

- В окне Telemetry оставлены ровно два фильтра: `Platform` и `Tasks`.
- `Tasks` заменяет прежний Presets dropdown и сохраняет его диагностические
  категории; отдельный динамический `Type` удалён.
- Фильтр `Only problems` удалён из UI и export bridge, поэтому больше не
  образует скрытый третий критерий фильтрации.
- Reset/clear и JSON/MD export синхронизированы с новой двухфильтровой моделью.

### 2026-07-28 — Proof-oriented telemetry export foundation, version 2.81.124

- JSON export Telemetry переведён на контейнер `all-presets` schema `5.0`:
  canonical ledger хранится один раз, а восемь diagnostic reports содержат
  только derived summaries и `eventRefs`.
- Добавлен `shared/proof-oriented-telemetry.js`: legacy runtime snapshot
  детерминированно преобразуется в envelope schema 5, независимые state axes,
  model timeline, evaluated sibling rules и cross-report compatibility.
- Export audit фиксирует boundary, SHA-256 hashes секций, нарушения инвариантов,
  replay result и соблюдение лимита 1 MB. Переходный источник честно помечен
  `legacy-runtime-adapter`; нативная runtime-запись schema 5 остаётся следующим
  этапом миграции.
- Privacy boundary удаляет произвольные details, prompt/answer/HTML/content,
  tokens и credentials до canonical persistence в export; сохраняются
  безопасные hash/length/state/ID/evidence поля.
- Добавлены тесты на форму контейнера, восемь reports, уникальность ledger,
  независимость forced/completion/completeness, predicate evaluation и запрет
  экспорта чувствительного текста.

### 2026-07-28 — Telemetry export volume, three-layer fix, version 2.81.122

После 2.81.119 storm одной модели был устранён (Z.ai: 539 событий → 95), но
экспорт того же прогона всё ещё занимал 551 КБ. Разбор показал, что оставшийся
объём распределён по трём независимым слоям, и каждый требовал своей правки.

- **Слой кодирования — база сравнения дельты.** Дельта сравнивала событие с
  предыдущим событием *той же модели*, но форма `meta` определяется меткой
  события, а не моделью: на реальном прогоне 407 из 466 соседних пар оказались
  событиями разных типов (средняя разница структуры — 8.8 ключей). В результате
  дельта сравнивала несопоставимое и тратила экономию на списки удалённых
  ключей — они присутствовали в 322 событиях из 474. База сравнения переведена
  на пару (модель, метка); списки удалённых ключей исчезли (322 → 7).
  Формат дельты помечается как `__telemetryMetaDelta: 3`; форматы 1 и 2
  по-прежнему читаются, разбор идёт по маркеру каждого события.
- **Слой полезной нагрузки — выводимые дубли.** `MODEL_RUN_TRANSITION` нёс
  четыре проекции одного состояния; `legacyAfter` совпадал с `legacyBefore` во
  всех 47 случаях из 47. Идентичный близнец больше не пишется (отсутствие поля
  читается как «не изменилось относительно парного»). Ни один потребитель в UI,
  фоне и тестах эти поля не читает — проверено.
- **Слой сериализации — форматирование.** Экспорт печатался с отступом в два
  пробела. На файле 551 КБ это стоило 183 КБ (33,2%). Экспорты телеметрии и
  Диспута пишутся без отступов: их читают инструменты анализа, а не глазами, и
  любой JSON-просмотрщик форматирует их по требованию.
- Замер на том же прогоне: 551 059 → 335 320 байт (−39,1%). Round-trip проверен
  на всех секциях реального файла — данные восстанавливаются идентично.
  Относительно исходной жалобы: 1 498 368 → 335 320 байт (в 4,5 раза меньше).

### 2026-07-27 — Telemetry loop amplification and nested meta delta, version 2.81.119

Правка 2.81.118 устранила только второстепенную причину. Разбор реального
экспорта на 1,5 МБ (run 1785185340505) показал две настоящие причины, которые
перемножались.

- **Цикл повторной финализации.** Одна модель (Z.ai) породила 539 событий из
  689 в файле: 298 `MODEL_RUN_TRANSITION`, 150 `STATE_PROJECTION_COMMITTED` и
  74 `FINALIZATION_DECISION`, почти идентичных друг другу. Финализация
  повторно блокировалась по `answer_not_verified` каждые ~1,7 с в течение
  ~200 с, и каждый проход писал полные снимки состояния.
  - `commitModelRunTransition` больше не пишет `MODEL_RUN_TRANSITION` для
    `STATUS_UPDATE`, если снимок состояния не изменился (волатильный
    `lastTransitionAt` из сравнения исключён).
  - `emitStateProjectionCommitted` пропускает повтор при `legacyChanged: false`
    и неизменной сводке `modelRunState`.
  - `FINALIZATION_DECISION` для повторно заблокированного и неизменившегося
    кандидата пишется один раз; принятые и терминальные исходы пишутся всегда.
  - Подавление `POST_TERMINAL_NOISE` сохранено без изменений.
- **Плоская дельта `meta`.** Диff считался только по верхним ключам, поэтому
  изменение одного поля внутри `previousState` тащило весь объект: экономия
  составляла ~22% на событие. `shared/telemetry-meta-delta.js` теперь считает
  дельту рекурсивно по вложенным объектам (`previousState`, `nextState`,
  `payload`, `decisionSnapshot`, `telemetryTaxonomy`, ...); массивы заменяются
  целиком.
- Формат дельты версионирован: маркер `__telemetryMetaDelta: 2` означает
  вложенный merge, старое значение `true` — замену ключа целиком. Без этого
  разворачивание уже сохранённых в `DIAG_KEY` данных прошлого билда давало
  неверный результат (поймано проверкой round-trip на реальном файле).
- Замер на том же экспорте: 1 275 053 → 314 165 байт (**в 4,1 раза меньше**),
  события 689 → 404. Round-trip проверен на всех секциях реального файла:
  данные восстанавливаются идентично (отличается только порядок ключей).

### 2026-07-27 — Telemetry JSON export size fix, version 2.81.118

- Причина раздутых экспортов `telemetry-*.json`: не ответы моделей, а объект
  `event.meta` (~15-20 полей: extVersion, runSessionId, llmName, tabId,
  pipeline id'ы и т.д.), который пересобирался целиком на каждое
  диагностическое событие и повторялся почти без изменений на
  десятках-сотнях событий одного прогона.
- Добавлен `shared/telemetry-meta-delta.js` — обратимое delta-кодирование
  `meta`: при записи в `DIAG_KEY` и в JSON-экспорте вкладки «Телеметрия»
  событие хранит только изменившиеся относительно предыдущего события той же
  модели поля; чтение (`readDiagnosticsEvents`) прозрачно разворачивает их
  обратно, поэтому весь остальной код продолжает видеть полный `meta`.
  Старые (некомпактные) записи разворачиваются как no-op — миграция не нужна.
- Экспортируемый файл содержит поле `metaEncodingNote`, объясняющее маркер
  `__telemetryMetaDelta` тем, кто читает JSON напрямую.
- Добавлены regression-тесты `tests/telemetry-meta-delta.test.js` на
  round-trip компакции (совпадающие события, изменение и удаление полей,
  чередование платформ, вложенные объекты).

### 2026-07-27 — Atomic run tab acquisition, version 2.81.115

- Открытие или повторное использование вкладки модели стало ожидаемой транзакцией: Round 0 продолжает работу только после привязки безопасной существующей либо новой вкладки к текущему запуску.
- Если все существующие вкладки содержат черновик, активную генерацию, модальное окно либо не проходят проверку, сохранённая привязка очищается и создаётся новая вкладка; отвергнутая пользовательская вкладка не закрывается и повторно не используется обходным путём.
- Проверка повторного использования теперь рассматривает все подходящие вкладки, а не только три наиболее новые.

### 2026-07-25 — Verified answer finalization, version 2.81.77

- Стадии постановки команды, отправки, генерации, извлечения, проверки и применения ответа разделены в состоянии каждой модели; для них сохраняются временная шкала и безопасный журнал ревизий без полного текста ответа.
- Финализация веб-ответа стала двухфазной: стабильность проверяется одновременно по выбранному тексту, набору узлов, корню сообщения, структурному покрытию и отсутствию активного индикатора генерации. Непроверенный кандидат отображается оранжевым, а не зелёным.
- Все проверки привязаны к идентификатору запуска, отправки и поколению генерации. Автоматическое позднее обновление разрешено только для проверенного продолжения того же ответа; ручное восстановление сохраняет отдельные объяснимые исходы.
- Проверки после успешного ответа продублированы сохраняемыми будильниками Manifest V3, экспорт предупреждает о незавершённом запуске и перечисляет текущие стадии моделей.
- Добавлены структурные фикстуры, модульные тесты и команда `npm run test:answer-matrix`; сценарии реальных провайдеров описаны в `docs/answer-completeness-validation.md`.

### 2026-07-25 — Canonical timing settings document, version 2.81.75

- `docs/timings-settings.md` стал единственным актуальным timing-документом:
  в нём объединены архитектурный индекс владельцев, профильная лестница
  Standard/Long, причинная цепочка ожиданий и полный перечень runtime timing
  settings.
- Датированный Jul25-документ преобразован в канонический evergreen-файл;
  Jul24 оставлен как исторический snapshot.
- Устаревший и частично противоречивый `docs/timing-map.md` удалён. Актуальные
  ссылки в README и архитектуре вкладок переведены на
  `docs/timings-settings.md`.
- При последующих изменениях timeout/interval/delay/retry/debounce/TTL/budget
  обновляется только канонический документ; новые snapshots создаются лишь по
  требованию конкретной задачи.

### 2026-07-25 — Disput telemetry content minimization, version 2.81.74

- Disput trace ingress теперь удаляет полные prompt/answer/HTML/text, включая
  camelCase-поля (`answerText`, `responseHtml`, `compiledPrompt`), вложенный
  `answerEvidence`, semantic artifact text, StateMap/context snapshots и
  attachment payloads. Числовые длины, hash/fingerprint и структурные IDs
  сохраняются.
- Свободные диагностические `details/message/note` ограничены 240 символами.
  Старые сохранённые trace events повторно санитизируются при восстановлении,
  после чего очищенный snapshot сразу перезаписывает `chrome.storage.local`;
  TraceSchema поднята до версии `5`.
- План в trace хранится как структурная схема стадий без task/prompt content;
  `PLAN_COMPILED` больше не дублирует весь plan внутри event payload.
- Импорт обычной Telemetry в Disput использует whitelist безопасных scalar
  evidence и не копирует полный `meta`. Информационные legacy-события без
  специального диагностического значения не добавляются в Disput trace.
- Производные секции `dispatchAttempts`, `recoveryAttempts`,
  `stateDivergences` и `artifacts` содержат только ссылки/структурные summaries,
  а не повторные полные event objects.
- `Only problems` фильтрует все event-derived секции по единому набору
  evidence IDs; semantic artifacts из проблемного экспорта исключаются.
- Перед скачиванием JSON дополнительно применяется общий deep secret redactor.

### 2026-07-25 — Generation-state telemetry and payload compaction, version 2.81.73

- Run Summary теперь отличает активную генерацию с уже видимым частичным
  ответом (`generating_partial_answer`) от простого отсутствия terminal outcome
  и сохраняет последнюю/максимальную наблюдавшуюся длину ответа.
- `TAB_CLOSED` восстанавливает имя модели через `jobState`, если mapping вкладки
  уже потерян, и записывает состояние закрытия: во время генерации, до terminal,
  после terminal либо вместе с окном. Источник закрытия честно маркируется
  `user_or_external`, поскольку Chrome API не различает эти причины.
- Lifecycle Qwen добавляет безопасные признаки reasoning/final-answer DOM phase.
  Если generic completion сработал на reasoning-only снимке, в Only problems
  появляется `LIFECYCLE_COMPLETION_PHASE_SUSPECT`; решение runtime этим
  изменением не блокируется.
- Run Summary выявляет противоречие `SUCCESS` с `doneReason=error`.
- `MODEL_FINAL` и `STATE_PROJECTION_COMMITTED` больше не экспортируют полный
  текст/HTML ответа: остаются длина, hash, источник и флаги evidence.
- Нулевой результат отдельного резервного selector больше не считается
  проблемой, если другой selector того же target успешно сработал в том же
  окне агрегации. Это уменьшает шум и размер экспорта Only problems.

### 2026-07-25 — Shared Only problems context filter, version 2.81.72

- В toolbar обычной вкладки Telemetry восстановлен включённый по умолчанию
  checkbox `Only problems`.
  Ранее JS-фильтр и поддержка JSON/MD существовали, но checkbox отсутствовал в
  HTML, поэтому условие никогда не включалось и экспорт оставался полным.
- Экранная лента, JSON и MD обычной Telemetry теперь используют один режим:
  проблемная запись плюс до 10 предшествующих событий с тем же
  `dispatchId`/run/model-tab context. MD в этом режиме аналогично сокращает
  секции диагностических логов.
- Disput raw trace теперь показывает тот же причинный контекст, а не только
  строки `warning/high/critical`. Fallback-массив `rows` фильтруется по
  собственным индексам и stage context, а не по несовместимым индексам
  канонического массива `events`.
- Классификация проблем и выбор предшествующего контекста вынесены в общий
  `shared/problem-context-filter.js`, используемый обеими вкладками и
  экспортами.

### 2026-07-25 — Standard/Long timing split and atomic lifecycle answer, version 2.81.71

- Бывший профиль Long стал профилем **Standard**: пассивное ожидание генерации
  `450s`, автоматические переключения фокуса разрешены только первые `60s`.
- Новый профиль **Long** ждёт генерацию пассивно до `900s`, но прекращает новые
  автоматические переключения вкладок через `90s`. Пассивные extraction-ping
  продолжаются без захвата фокуса.
- Content pipeline, background generation deadline, runtime hard stop, Round 4,
  adaptive probes и baseline guard приведены к единой лестнице `450s/900s`.
- Lifecycle-детектор передаёт в `LLM_RESPONSE_READY` тот же текстовый снимок,
  на котором вынесено решение `COMPLETE`. Background проверяет его существующими
  prompt-echo/baseline/freshness guards и при валидности финализирует без
  повторного DOM-поиска. Это устраняет расхождение, при котором Qwen lifecycle
  видел полный ответ, а повторный extractor возвращал короткий UI-фрагмент.
- Восстановление прежней вкладки теперь помечается как программный фокус и не
  расходует пользовательскую visit-квоту.

### 2026-07-25 — Automation deadline owns timeout finalization, version 2.81.70

- `generation` и `collect` budgets больше не являются только телеметрией:
  истечение deadline переводит модель в terminal `PARTIAL`, если текст уже
  получен, или в `STREAM_TIMEOUT`, если текста нет.
- Deadline останавливает human-presence, automation visits, adaptive collection,
  автоматические ping/recovery и runtime hard stop, но не посылает Stop на
  страницу провайдера. Генерация модели может продолжиться без переключения
  пользовательского фокуса.
- Двойной клик по status indicator сохраняет существующий manual latest recovery
  и может заменить timeout-результат полным `SUCCESS`.
- Lifecycle timeout теперь отправляет коррелированный
  `AUTOMATION_DEADLINE_SIGNAL` в background вместо локального необработанного
  возврата. MV3 rehydration восстанавливает deadline по абсолютному timestamp,
  не доверяя сохранённому id таймера.
- Generation deadline не перезапускается повторным dispatch/retry и остаётся
  абсолютной границей автоматического сопровождения модели.
- Generation deadline учитывает short/long профиль (`180s/450s`); локальный
  lifecycle timeout не может преждевременно завершить long-generation run.

### 2026-07-25 — Purge legacy built-in preset overrides, version 2.81.69

- При загрузке pipeline удаляются ранее сохранённые DraftPlan и overrides для
  встроенных preset; они больше не остаются даже как неиспользуемое состояние.

### 2026-07-25 — Synthesis selector unlock after model selection, version 2.81.68

- После изменения header model selection Disput повторно синхронизирует
  synthesis stage; select разблокируется сразу после выбора первой модели.

### 2026-07-25 — Empty synthesis reset and non-persistent built-in pipelines, version 2.81.67

- Новый пустой pipeline очищает DraftPlan и pending synthesizer до None;
  после выбора модели select синтезатора разблокируется.
- Изменения встроенных preset pipeline больше не записываются в overrides или
  persisted DraftPlan; при повторном выборе применяются канонические значения.

### 2026-07-25 — Pipeline header display limit, version 2.81.66

- Ограничение заголовка pipeline приведено к 18 символам во всех слоях:
  CSS-ширина `18ch` и JS-обрезка с учётом символа ellipsis.
- Полное имя сохраняется в `data-full-name` и tooltip, поэтому ограничение
  влияет только на отображение.

### 2026-07-25 — Empty pipeline uses default round count, version 2.81.65

- Новый пустой pipeline больше не наследует round limit последнего активного
  pipeline.
- При создании применяется тот же дефолт `3`, что и при загрузке страницы;
  selector и canvas синхронно переходят к R1–R3.

### 2026-07-25 — Empty pipeline round synchronization, version 2.81.64

- Новый пустой pipeline после очистки canvas повторно синхронизирует round
  blocks с текущим значением настройки количества раундов.
- При настройке `3` canvas сразу показывает R1, R2 и R3 с неактивными
  placeholder-блоками.

### 2026-07-25 — Remove Output stage from pipeline canvas, version 2.81.63

- Блок Output и его connector удалены из canvas на главной странице и в
  Disput.
- Удалены output-stack runtime, checkbox-состояние в preset/config, terminal
  auto-actions и связанные стили; экспорт ленты остаётся доступен через
  существующие явные кнопки экспорта.
- Старое поле `outputStack` в сохранённых pipeline безопасно игнорируется и
  исчезает при следующем сохранении конфигурации.
- Проверка доступности final synthesizer вне pipeline-controller использует
  общий `getSelectedLLMs()`, без обращения к локальному helper другого scope.

### 2026-07-25 — Synthesis activation and connector lifecycle, version 2.81.62

- Активность pipeline определяется через общий header model selection, поэтому
  final synthesizer снова доступен после выбора модели.
- Для synthesis-stack добавлен отдельный connector mode: стрелки до и после
  синтезатора активны только при выбранной модели и назначенном synthesizer.
- Неактивный terminal path больше не получает частичный `flow-anim`.

### 2026-07-25 — Intermediate synthesis state and inactive terminal selector, version 2.81.61

- Активный `.pipeline-stage-insert.has-intermediate-synthesis` теперь визуально
  совпадает с hover/focus-состоянием кнопки.
- При отсутствии активных моделей select финального синтезатора заблокирован;
  программное назначение также отклоняется.

### 2026-07-25 — Inactive terminal blocks and fixed pipeline title width, version 2.81.60

- После reload Synthesis и Output получают inactive-состояние при отсутствии
  активных model blocks.
- Заголовок pipeline ограничен 18 символами с ellipsis; ширина title-group
  больше не двигает `.panel-header-actions`.

### 2026-07-25 — Unified pipeline list, version 2.81.59

- Пользовательские pipeline теперь рендерятся внутри `#pipelineItems` сразу
  после preset-ов.
- Удалён отдельный `#customerPipelineItems` и divider между списками.

### 2026-07-25 — Empty pipeline action without builder modal, version 2.81.58

- `pipeline-add-btn` теперь сразу вызывает состояние `Unsaved Pipeline` с
  неактивными placeholder-блоками.
- Удалены builder modal, его обработчик и CSS; сохранение выполняется через
  существующий `pipeline-save-btn`.

### 2026-07-25 — Pipeline actions moved to panel header, version 2.81.57

- `.pipeline-list-header-actions` перенесён в `.pipeline-panel .panel-header`;
  кнопки остаются выровненными справа.

### 2026-07-25 — Remove forced Disput Auto reset, version 2.81.56

- Удалён безусловный startup-сброс `autoCheckbox.checked = false`.
- Auto восстанавливается первым независимым шагом загрузки, поэтому сбой
  prompt/modifier hydration больше не оставляет checkbox выключенным.

### 2026-07-25 — Disput Auto restore lifecycle fix, version 2.81.55

- Восстановление Auto теперь проходит через штатный `change`-lifecycle policy,
  а видимый checkbox сохраняется напрямую; это устраняет сброс состояния после
  загрузки Disput.

### 2026-07-25 — Disput Auto mode persistence, version 2.81.54

- Состояние чекбокса Auto в Disput сохраняется в local storage и
  восстанавливается после перезагрузки страницы.

### 2026-07-25 — Visible inactive pipeline placeholders after reload, version 2.81.53

- При отсутствии выбранных моделей после reload pipeline сохраняет видимые
  неактивные placeholder-блоки каждого раунда.
- Версии `manifest.json`, `package.json` и `package-lock.json` синхронизированы
  на `2.81.53`.

### 2026-07-24 — Disput runtime/UI corrections documented, version 2.81.52

- Лента Disput стала append-only по model request: ответы следующих раундов
  создают новые карточки и не заменяют закрытые ответы той же модели.
- Prompt Pack обновлён до 3.1: participant и synthesis получают конечный лимит
  слов и указание держать фокус на ясной концепции и ключевых идеях. Лимит
  продублирован на transport boundary и проверяется response acceptance;
  вариант `∞` удалён.
- Double-click по заголовку карточки снова открывает viewport overlay; иконка
  Branch удалена; terminal response гарантированно убирает `[Model] printing`.
- Исправлено выравнивание `.top-control-bar`: `.top-bar-right` остаётся в одной
  строке с кнопками моделей на главной и Disput; на узком экране прокручивается
  только полоса моделей.
- `New Pages` создаёт страницы моделей только на первом pipeline-раунде;
  следующие раунды переиспользуют те же страницы.
- Intermediate synthesis включается двойным кликом по `.pipeline-stage-insert`;
  меню, Canvas-блок выбора и индивидуальный participant удалены, используется
  финальный synthesizer.
- Approval checkbox действует только в Manual; Auto блокирует и скрывает control.
- Preset по умолчанию не активируется; ручной moderator dispatch работает для
  All models или одной модели.
- При reload очищаются model selection, session snapshots, transcript и UI
  selectors в основном и Disput-контуре.
- В закрытом moderator composer добавлена корзина справа от `Pro`: она очищает
  textarea и связанные prompt-состояния. При browser reload дополнительно
  очищается persisted/runtime telemetry и локальное окно диагностики.
- Если после reload модели не выбраны, pipeline теперь сохраняет видимые
  неактивные placeholder-блоки для каждого раунда, а не показывает только
  синтезатор. Эти блоки не участвуют в dispatch.
- Добавлены debounce/rAF и устранён Canvas DOM churn; lease heartbeat защищён
  от ложной остановки между раундами.
- Нормативный контракт: `docs/disput/TZ-runtime-ui-corrections-v1.0.md`.
- Полный Jest: **153 suites, 915 tests — зелёные**.

### 2026-07-24 — Runtime perf: закрытая StateMap больше не строит скрытый DOM, version 2.81.52

- `DisputStateMapView` сохраняет только последнее входное состояние, пока карта
  закрыта. Проекция, HTML почти на мегабайт и тысячи DOM-узлов создаются только
  при фактическом открытии карты.
- Главная/Pipeline-страница больше не загружает последнее сохранённое DebateCase
  автоматически при каждом старте. Сохранённые дела остаются доступны в
  селекторе карты.
- Синтетический regression benchmark (1500 artifacts): закрытая карта до фикса —
  10 568 DOM-узлов, ~70,7 МБ heap, 315 мс; после — 30 узлов, ~1 МБ, 8 мс.
- `results.js` дополнительно коалесцирует `applyDebateSessionFilter` в один
  проход за animation frame.
- Ранние попытки менять `base-adapter.js` и `content-utils.js` откачены: эти
  content-scripts идентичны быстрой LLM_Sol и не объясняют регрессию.
- Полный Jest: 153 suites, 908 tests — зелёные.

### 2026-07-24 — Semantic stabilization completion, version 2.81.51

- `startRun`/recovery теперь проецируют canonical case до первого Planner tick.
- Удалён независимый `stateMapVersion`; stale fencing использует
  `{sourceCaseVersion, projectorVersion}`.
- Добавлен canonical `ADD_CONSTRAINT`, prospective batch validation,
  единственный активный `synthesis_conclusion` и явные supersede/merge rules.
- Legacy artifact arrays мигрируют в map и переживают повторный reload.
- Phase 0 расширена до E-01…E-09.
- OrchestratorPersistence v2 хранит event/snapshot/lease в localStorage и
  использует Web Locks + `leaseRevision` для cross-context fencing.
- Browser E2E: `pause → reload → continue`, одинаковые artifacts/StateMap,
  `dispatchCount = 1`; второй активный владелец отклонён с `LEASE_HELD`.
- Полный Jest: 150 suites, 879 tests, 0 snapshots — зелёные.
- Оставшиеся вне комплекса работы перечислены в `OPEN-ITEMS-v3.0.md`.

### 2026-07-24 — Semantic follow-up audit, version 2.81.50

Повторно подтверждено закрытие SEM-A01/A02/A03/A04/A06 и actionable-части
SEM-A07. В OPEN-ITEMS добавлены два новых остатка: SEM-A12 — `ADD_CONSTRAINT`
не попадает в canonical case, SEM-A13 — существующий case не проецируется до
первого Planner tick. Production-код в этом change set не менялся.

### 2026-07-24 — Canonical semantic-path corrections, version 2.81.49

- Исправлена начальная `caseVersion`: canonical run стартует с persisted cursor
  `0`, первая delta больше не отклоняется как stale.
- UI и Orchestrator используют один `DebateCaseStore`; human-action bridge не
  обращается к удалённой переменной и сохраняет closure/evidence semantics.
- Multi-artifact delta получает уникальные correlation receipts, выполняется
  одним batch без partial fallback и синхронно пересобирает StateMap.
- StateMap повышен до v4; `recorded` contradiction/dissent признаны actionable,
  Planner выводит `resolve_contradiction` и `examine_dissent`.
- Добавлен production-shaped regression suite
  `tests/semantic-layer-canonical-integration.test.js`.
- Полный Jest: 150 suites, 865 tests, 0 snapshots — зелёные.
- Открытыми остаются durable cross-context persistence, удаление независимого
  `stateMapVersion`, final-synthesis lifecycle, legacy array migration и полный
  browser recovery E2E; статусы зафиксированы в OPEN-ITEMS.

### 2026-07-24 — Semantic implementation audit findings, version 2.81.48

Повторный аудит выявил, что новый canonical production path не покрыт зелёным
общим Jest и отклоняет первую delta из-за рассинхронизации caseVersion. В
OPEN-ITEMS добавлены SEM-A01…SEM-A11: wiring единого store, atomic batch,
projection, durable persistence, human actions, StateMap v4, recovery,
lifecycle/migration и недостающая Phase 0 evidence suite. Production-код в этом
change set не исправлялся.

### 2026-07-24 — Explicit remaining-work register, version 2.81.47

В README, PLAN и OPEN-ITEMS добавлен нормативный перечень незавершённых работ:
cross-context lease fencing, durable recovery, publication cursor, browser E2E
и migration matrix. Эти пункты явно остаются open/partial и не могут быть
приняты за закрытые без отдельного evidence change set.

### 2026-07-24 — Semantic layer implementation pass, version 2.81.46

Реализованы базовые фазы модернизации карты состояния: DebateCase schema v3 с
`caseVersion`, batch/lifecycle operations, correlation receipts и forward-version
guard; canonical CaseStore commit; отдельный OrchestratorPersistence adapter;
map-aware projection с actionable collections, author index, context pressure и
finalArtifactIds; UI human actions маршрутизируются через Orchestrator. Добавлены
Phase 0 characterization/contract tests. Полный Jest: 148 suites, 861 tests,
0 snapshots; browser-level cross-context durability proof остаётся открытым.

### 2026-07-24 — Semantic layer plan v1.1: code-review corrections, version 2.81.45

Ревизия комплекта после код-ревью GPT (читал фактический код, не документы).
Все замечания проверены построчно и подтверждены. Направление (D1–D5, порядок
фаз) не менялось; устранены несоответствия документов и кода.

- ADR-002 D6 (10 решений): `caseVersion === changes.length` (нач. 0, активация
  ревизии не инкрементирует); concurrency через существующий Orchestrator lease
  + fencing-токен `leaseRevision`, не CAS в chrome.storage; проектор map←→array
  и все competing writers перенесены в Phase 1; `artifactAuthors` →
  `{artifactId: participantId}`; `rejectedCounts` → TraceStore (нарушал D4);
  durable `OrchestratorPersistence` — отдельный adapter; ADR-002 supersede
  разделов `stateMapVersion` Orchestrator Contract; `artifact_revision_stale`
  как новый код (не `REVISION_STALE`); `revision: 0` согласован; правило
  `finalArtifactIds` принято сейчас.
- Новые findings: S-17 (`onLinkRemove` второй writer), S-18 (нет CAS в CaseStore),
  S-19 (нет `caseVersion` в схеме), S-20 (проектор array-only), S-21
  (`artifactAuthors` форма), S-22 (нет forward-version guard в `load`).
- Phase 0 переформатирована в characterization-тесты (зелёные на baseline,
  переворот ожидания в фазе-фиксе) — устранено внутреннее противоречие v1.0;
  E-08 без двойного назначения фазы; тесты через публичный путь, не приватные
  символы; добавлен E-09.
- Baseline-версия исправлена: `a33b37f` = 2.81.41 (было 2.81.42).
- Зафиксировано: рабочее дерево содержит незакоммиченные `results.js`/HTML/CSS
  от предыдущих задач — документационный change set физически не изолирован.
- Код не изменялся: change set документационный.

### 2026-07-24 — Semantic layer plan: cross-review integration, version 2.81.44

- Сведены ответы GPT/Z.ai/Qwen по плану семантического слоя. Взято проверенное
  по коду, отвергнута ошибочная верификация V3/V4 Z.ai (объекция резолвится
  через `isOpen`; Planner не читает `questions`) — оба опровергнуты построчно:
  `deriveGoals:72` сверяет литерал `'unresolved'`, `:77` читает `map.questions`.
- Добавлены findings S-14 (late-response discard без delta,
  `orchestrator:528-536`), S-15 (storage-версия отдельна от schema-версии),
  S-16 (`findLast` демотирует первый финал без `supersededBy`).
- Расширен inventory внутренним операционным состоянием Orchestrator
  (`openGoals`/`stages`/`events`/persistence/snapshot) с целевыми ролями.
- Пересмотрен D5: владелец словаря статусов — `DebateCaseSchema` (не pipeline);
  Planner потребляет actionable-коллекции проекции (не литеральные предикаты).
- Phase 4: явно обосновано, что производные `RunStore`/`TraceStore` закрывают
  окно W4 без transactional outbox; late-discard подчинён той же rebase-политике.
- Phase 0: добавлен E-09 (late-response discard).
- Код не изменялся: change set документационный.

### 2026-07-24 — Semantic layer modernization plan, version 2.81.43

- Добавлен [ADR-002](disput/ADR-002-semantic-layer-ownership.md): канонический
  владелец артефактов (`DebateCaseStore`), in-place update с revision fencing,
  реестр как производный индекс, карта на чтении, владелец словаря статусов.
  Отклонены: event-sourced артефакты, transactional outbox, граф `relations[]`.
- Добавлен [PLAN-semantic-layer-v1.0](disput/PLAN-semantic-layer-v1.0.md):
  инвентарь держателей состояния, граница транзакции с failure windows,
  findings S-01…S-13, карта фаз, матрица версий (два бампа схем), политика
  миграции.
- Добавлены ТЗ фаз 0, 1–2, 3–4, 5–6, 7–8 с acceptance criteria и rollback
  boundary в каждом.
- Исправлена недостоверная запись evidence matrix: «Atomic same-version
  parallel delta commit | implemented | `debate-case.js`» — файла не существует,
  атомарного commit нет; статус изменён на `planned`.
- Зафиксирован новый P0-R10 в OPEN-ITEMS; P0-R7 связан с findings плана.
- Код не изменялся: change set документационный.

### 2026-07-23 — Clean pipeline canvas round labels and insert icons, version 2.81.41

- `R2 Disput` убран из canvas и runtime генераторов; round labels теперь
  показывают только `R1 Models`, `R2`, `R3` и т. д.
- `pipeline-stage-insert` переведён на более явную круглую иконку с рисуемым
  `+`, а label-row выровнен по вертикали.
- Добавлена регрессия на новый canvas label/insert-geometry contract.

### 2026-07-23 — Align release-log regression with DraftPlan restore chain, version 2.81.40

- Обновлена проверка `release-log-regressions.test.js`: после синхронизации
  раундов учитывается восстановление legacy synthesizer в DraftPlan перед
  вызовом `syncDebateSchemeUi`.

### 2026-07-23 — Materialize Canvas DraftPlan and synthesis graph, version 2.81.39

- Canvas R1/R2/… теперь сохраняются как generic `DraftPlan` и становятся
  initial immutable `PlanRevision`; Planner/Orchestrator исполняют именно этот
  граф, включая participant prompt bindings.
- `+` создаёт explicit intermediate synthesis с атомарным dependency rewiring;
  рабочий synthesis имеет отдельный artifact type и не может стать final
  StateMap synthesis.
- В pause Canvas insert/remove/change participant проходит только через
  revision-команды с optimistic concurrency и future-stage validation.
- Удалён скрытый `panel-header` selector Synthesizer. Canvas final stage —
  единственный authoring state; legacy selector overrides читаются только при
  миграции старых настроек.
- Добавлены DraftPlan, binding propagation, graph cycle и working-synthesis
  regressions; актуализированы contracts, evidence matrix и карта Disput docs.

### 2026-07-23 — Execute planned stages and honor explicit synthesizer, version 2.81.38

- `activePlanRevision.plannedStages` подключён к Planner/Orchestrator:
  готовая planned stage создаёт реальный `StageInstance` с сохраняемым
  `plannedStageId` и семантическими stage-полями.
- Явно выбранный Synthesizer мигрирует в initial final synthesis stage и
  исполняется именно выбранной моделью; недоступная назначенная модель
  блокирует stage без молчаливого fallback.
- Goal-derived synthesis подавляется при наличии explicit synthesis stage;
  terminal synthesis ждёт завершения обычных целей.
- Synthesis-only модель поддерживается как `serviceOnly` participant и не
  попадает в обычные discussion stages.
- Planning decision учитывает число исполненных stages, а stage history
  предотвращает повторный dispatch после semantic no-op.
- Добавлены unit/integration regression tests и обновлены normative contracts,
  release plan, evidence matrix и open-items register.

### 2026-07-23 — Preserve explicit Synthesizer stage after reload, version 2.81.37

- Восстановленный явно выбранный Synthesizer больше не скрывается при
  `roundLimit: infinite` или промежуточном startup-состоянии после reload.
- Видимость synthesis column и connector теперь следует сохранённому выбору
  Synthesizer; добавлен regression test для reload-состояния.
- После восстановления моделей canvas выполняет обязательный повторный
  layout-pass на следующем кадре: Synthesizer и Output выравниваются по центру
  последнего видимого model stack, а connector’ы перерисовываются по финальной
  геометрии.

### 2026-07-23 — Universal arbitrary model selection and stable canvas geometry, version 2.81.36

- Universal больше не ограничивает выбор участников двумя моделями: можно выбрать
  любое количество доступных моделей.
- Скрытые пустые слоты pipeline больше не участвуют в измерении высоты и
  вертикальном центрировании synthesis/output после reload.
- Добавлен regression test на выбор четырёх моделей и отсутствие скрытого
  третьего слота в R1.

### 2026-07-23 — Universal two-model default and canvas recovery, version 2.81.35

- Universal runtime default теперь активирует ровно Claude и GPT; Gemini остаётся
  доступной моделью, но не является скрытым третьим default slot.
- После reload pipeline canvas больше не рассчитывает synthesis/output по
  невидимой третьей модели.
- Добавлен regression test на `DEFAULT_MODEL_INDICES`.

### 2026-07-23 — Move message controls and remove moderator role dropdown, version 2.81.34

- Удалён `mod-role-select` из `panel-header` и очищены его state/prompt/event
  связи; роли pipeline-stage остаются отдельным механизмом.
- `msg-head-center` перенесён в `msg-header`: sender, direction и receiver
  относятся к сообщениям и центрируются по строке и вертикали.
- Обновлены HTML/CSS regression assertions.

### 2026-07-23 — Complete Disput release register, version 2.81.33

- Реестр расширен архитектурными обязательствами P0-R6 (event-log/replay
  integrity) и P0-R7 (semantic commit/no-op/version integrity).
- P0-R4 теперь охватывает полный lease lifecycle и cross-context invalidation;
  P1-C1 — все persisted-data migrations, а не только custom configs.
- В реестр добавлены Status, Owner, Reviewer, Gate, Evidence ID и Target test.
- ADR-001 явно фиксирует big-bang cutover risk, previous-artifact rollback,
  storage compatibility и data rollback policy. Product-owner sign-off остаётся
  pending и не считается доказанным существованием ADR.

### 2026-07-23 — Fix universal panel-header round counter, version 2.81.32

- Счётчик раундов в `panel-header` больше не скрывается из-за проверки
  `duration === open_ended`: он доступен для всех включённых Universal профилей.
- Изменение лимита раундов сохраняется и применяется к pipeline-конфигурации
  независимо от режима завершения `goal_driven`.

### 2026-07-23 — Disput documentation-map filename, version 2.81.31

- Актуальная карта документации переименована из `README.md` в
  `docs/disput/README-disput.md`, чтобы её нельзя было спутать с общим README.

### 2026-07-23 — Disput open-obligations register, version 2.81.30

- Добавлен нормативный реестр незавершённых P0/P1/P2 обязательств с реальными
  критериями закрытия. До закрытия P0 Disput явно не считается release-ready.

### 2026-07-23 — Disput persisted human decisions, version 2.81.29

- Blocking human decision включён в snapshot и planner input, поэтому reload не
  может молча продолжить run без ответа человека.
- Resolution проверяет request ID, ожидаемую версию case и plan revision;
  неверный, устаревший или повторный ответ не меняет active plan.
- Проверка: orchestrator human-decision recovery suite — 25 тестов.

### 2026-07-23 — Disput persisted participant collections, version 2.81.28

- Orchestrator snapshot v2 хранит канонические `configuredParticipants`,
  `activeParticipants` и `droppedParticipants`; planner и UI получают одну
  согласованную проекцию доступности.
- Recovery мигрирует snapshot v1 без этих полей из ранее сохранённого
  `participantStatus`, поэтому terminal dropout не возвращает участника в
  маршрутизацию после reload.
- Проверка: orchestrator suite — 24 теста.

### 2026-07-23 — Disput lease fencing, version 2.81.27

- Lease теперь имеет монотонный `leaseRevision` (с сохранением совместимого
  поля `version`), compare-and-set hook, явный release при pause/cancel/complete
  и notification hook для межконтекстной синхронизации.
- После каждого долгого исполнения Orchestrator повторно проверяет fencing
  lease. Поздний ответ прежнего владельца становится stale и не может создать
  `StateDelta` commit.
- Ошибка исполнения стадии больше не теряется в `step()`: loop прекращается
  при ownership failure.
- Проверка: ownership, trace и revision suites — 45 тестов.

### 2026-07-23 — Disput idempotency and documentation governance, version 2.81.26

- Актуальная нормативная документация Disput консолидирована в `docs/disput/`;
  `docs/disput-old/` отделён как архив и не является источником требований.
- Добавлены ADR о universal-only cutover и evidence matrix, которая отделяет
  реализованные гарантии от P0/P1 release work.
- Trace schema повышена до v4: у каждого события есть детерминированный
  semantic hash. Повтор того же `eventId` с другим содержанием отклоняется и
  фиксируется как конфликт; collector sequence при этом не расходуется.
- Plan Revision Store ведёт и сохраняет command-idempotency ledger. Идентичная
  команда повторно возвращает прежний результат, а повторный `commandId` с
  иной семантикой отклоняется.
- Проверка: `debate-trace` и `debate-plan-revision` — 22 теста.

### 2026-07-23 — Universal pipeline architecture

- Disput now has one production execution path: Application → Planner → Orchestrator → StageExecutor → Artifact/StateDelta → StateMap.
- Participant count and sequential/parallel dispatch are stage and policy data; no fixed conversation shape is selected in UI or runtime.
- Added native parallel batches, all-settled participant accounting, atomic same-version delta commits, linked artifact import and synthesis audit/correction bound to artifact IDs.
- Removed alternate executors, executor-selection switches, obsolete source-contract tests and obsolete protocol documentation.
- Built-in profiles are Universal, Research and Red Team. Custom pipelines select participants and policies without selecting an execution shape.
- Verification: full Jest regression plus repository architecture gates.

### 2026-07-21 — Honest Disput execution controls, version 2.81.25

- Synthesizer стал действительно необязательным для Duel, Triad, Multi и
  FreeTalk: при `None` runtime не подставляет первую модель и завершает run без
  искусственного synthesis. Старое поле Extractor также больше не может скрыто
  назначить synthesizer.
- Добавлен отдельный явный выбор Auditor (`None` по умолчанию). Auditor не
  выводится из участников, не совпадает с synthesizer и не запускается без
  созданного synthesis; легаси-значение `auto` нормализуется в `None`.
- Auto сохранён как единственный переключатель темпа: включён — раунды идут
  без межраундовых пауз и кнопка становится Pause; выключен — после раунда
  требуется кнопка Run/«Запустить следующий раунд».
- Удалён временный startup-скрипт, принудительно менявший Auto. Adaptive stop
  заменён предупреждением о стагнации, которое не завершает run само.
- Маршрутизация FreeTalk больше не имитирует оценку качества, цены или
  надёжности моделей: учитываются только явные требования инструмента и
  проверяемая независимость. Research блокируется до отправки, если ни одна
  выбранная модель не поддерживает `web_research`.
- Кнопка `Specialized profile` теперь открывает выбор и применяет конкретный
  профиль; extension contract проверяется до запуска. Действие `Final
  Synthesis` переименовано в `Summarize Current State`, чтобы не обещать
  обязательный финальный вердикт.
- Обновлены runtime, UI, plan compiler/validator, документация Disput и
  regression tests. Проверка: 153 suites / 883 tests.

### 2026-07-21 — Explicit Synthesizer selection only, version 2.81.24

- Из списка Synthesizer удалён вариант `Auto`; пустое значение теперь явно
  отображается как `Synthesizer: None`.
- Удалена скрытая подстановка первой выбранной модели в UI launcher,
  DebatePlanCompiler и Duel/Triad/Multi/FreeTalk runners. Литерал `auto` из
  старых сохранённых данных нормализуется в `None`.
- Текущие pipeline с обязательным synthesis требуют конкретную модель до
  запуска и при `None` останавливаются до открытия вкладок с понятным
  уведомлением.
- Концепция будущего движка упрощена: StateDelta предлагаются участниками и
  объединяются CheckpointService без автоматического выбора отдельной модели.
- Обновлены нормативная документация, справочник реализации и тестовые fixtures.

### 2026-07-21 — Universal Topic Discussion engine concept, version 2.81.23

- Создан [D20](disput-docs/reports/D20_universal-topic-discussion-engine.md)
  с концепцией нового универсального движка: раунд как наблюдаемая граница,
  обязательная карта после каждого раунда, динамические временные роли и
  необязательный версионируемый synthesis.
- Зафиксировано разделение обязательного state processing и необязательного
  synthesis; `Synthesizer: None` предложен как безопасный default, а запуск
  синтеза — только отдельной кнопкой. Автоматический выбор модели позднее
  удалён в версии 2.81.24.
- Проведён критический разбор рисков: бесконечный расход, самовоспроизводящиеся
  роли, ошибочная карта, checkpoint cost, UI overload, преждевременный synthesis
  и влияние Auto.
- Добавлен восьмиэтапный план внедрения за отдельным feature flag без изменения
  текущих FreeTalk, Research и Specialized profile.
- Исправлено устаревшее правило D19: выполненная работа фиксируется в общем
  changelog, а не в несуществовавшем отчёте D20.

### 2026-07-21 — FreeTalk Actions budget documentation, version 2.81.22

- В нормативном описании FreeTalk ясно разделены раунды и Actions: заранее
  заданный цикл протокола и динамическая целевая операция.
- Задокументированы значения UI `5/10/20/∞`, default `10`, action cost,
  списание только завершённых действий, резерв `1` на финализацию и переход в
  synthesis с outcome `budget_limited`.
- Уточнено, что Actions — верхний предел, а не обязательное число запросов;
  `Auto` задаёт run policy, а `ActionContract.mode` и profile policy управляют
  подтверждением конкретного действия, не заменяя бюджет.
- В справочнике реализации зафиксированы реальные поля `resourceBudget`,
  условие допуска действия и скрытие round control для FreeTalk.

### 2026-07-20 — Pipeline items block layout correction, version 2.81.16

- Заголовок `pipeline-items` отделён от сетки карточек профилей и теперь стоит
  над ними, как самостоятельный блок страницы.

### 2026-07-20 — Minimal Disput page prototype, version 2.81.15

- Прототип упрощён до пяти блоков: header с выбором моделей,
  `moderator-input`, `pipeline-canvas`, `pipeline-items` и свёрнутый State Map.
- Убраны из макета лента, drawer, очередь действий, progress и дополнительные
  панели, чтобы сначала обсуждать базовую композицию страницы.
- В pipeline canvas явно показано, что количество моделей является параметром,
  а Duel/Triad/Multi не являются отдельными архитектурами.

### 2026-07-20 — Revised Disput page composition, version 2.81.14

- Статический прототип переработан вокруг единой страницы Disput, а не вокруг
  старого msg-header с sender/receiver и round controls.
- `moderator-input` теперь визуально отвечает только за новую задачу.
- Под ним вынесена отдельная строка Execution controls: Auto actions, Human
  gates, New pages, Answer length, Action budget и Synthesizer.
- Боковой блок переименован в Session profile, чтобы не создавать впечатление
  нескольких архитектурных pipeline.

### 2026-07-20 — Static FreeTalk page prototype, version 2.81.13

- Добавлен автономный HTML-прототип [F0_freetalk-prototype.html](disput-docs/F0_freetalk-prototype.html) без runtime и обработчиков.
- На одной странице показаны задача, произвольные участники, профиль, очередь adaptive actions, лента, progress window, State Map и human drawer.

### 2026-07-20 — Уточнение расположения общего changelog, version 2.81.12

- В структуре проекта явно зафиксировано, что `docs/CHANGELOG.md` находится в
  корне `docs/` и относится ко всем частям проекта, а не только к Disput.

### 2026-07-20 — FreeTalk as the primary Disput pipeline and documentation correction, version 2.81.11

- `docs/CHANGELOG.md` подтверждён как общий журнал изменений всего проекта.
- В нормативную документацию Disput добавлен отдельный [F0 FreeTalk](disput-docs/F0_freetalk.md): смысл pipeline, роли моделей, единый синтезатор, триггеры, очередь действий, prompts, карта состояния, завершение и границы текущей реализации.
- D16 и остальные планы/отчёты остаются в `docs/disput-docs/reports/` и не выдаются за нормативные документы.
- Карта документации обновлена: FreeTalk теперь виден отдельным главным документом.

### 2026-07-20 — Финальная очистка имени журнала, version 2.81.09

- Убрано даже историческое упоминание прежнего имени файла changelog, чтобы
  поиск по проекту однозначно находил только `CHANGELOG.md`.

### 2026-07-20 — Исправление ссылок после разделения отчётов, version 2.81.08

- Обновлены оставшиеся ссылки на D12–D19 после переноса в `reports/`.
- Проверено, что старое имя журнала больше нигде не используется.
- Все относительные ссылки внутри `docs/disput-docs/` разрешаются.

### 2026-07-20 — Разделение документации и отчётов, version 2.81.07

- D12–D19 перенесены в `reports/`: это планы, аудиты, эксперименты,
  исполнительские отчёты и список открытых задач, а не нормативная документация.
- Нормативный комплект ограничен D0–D11 и D21.
- Этот файл является единственным changelog Disput. Все последующие изменения
  фиксируются здесь; отчёты не заменяют запись в changelog.
- Обновлены карта документации, README, ссылки проекта и структура каталогов.

### 2026-07-20 — Consolidated Disput documentation and implementation reference, version 2.81.06

- Вся документация Disput перенесена в `docs/disput-docs/`, включая нормативные
  D0–D11 и архив D90–D99; отчёты тогда ещё не были отделены.
- Добавлен D21 — единый справочник фактических модулей, хранилищ, UI-команд,
  полного дела, карты, Case/Import/Export, синтезатора и FreeTalk.
- Обновлены README, карта документации, структура проекта и внешние ссылки;
  проверены все относительные ссылки внутри комплекта Disput.
- Проверка: каталог содержит 22 действующих документа и архив; относительные
  ссылки разрешаются; версия манифеста и package metadata — `2.81.06`.

### 2026-07-19 — Unified synthesizer service role, included in version 2.81.01

- Отдельный UI и конфигурационная роль `extractor` удалены: в верхней панели
  теперь один список `Synthesizer`.
- Одна выбранная модель выполняет финальный синтез, round filters и registry
  checkpoints. `DebateServiceRoles` больше не маршрутизирует второй model
  identity для extraction.
- Старые `triadSynthesizer`, `multiSynthesizer` и
  `serviceRoles.extractor` читаются только как compatibility migration и
  сводятся к новому `protocol.synthesizer`.
- Независимый `auditor` сохранён только для явно требуемого SynthesisAudit,
  поскольку его назначение — независимая проверка финального ответа.
- Обновлены Duel/Triad/Multi/FreeTalk, UI канваса, prompt-pack, профили,
  тесты и нормативные документы. Проверка: syntax checks и полная Jest
  regression — **153 suites / 874 tests**, все зелёные.

### 2026-07-19 — Rule intelligence, typed decisions and documentation system, version 2.81.01

- Причина: FreeTalk использовал жёсткий список triggers и бинарное
  подтверждение, fixed topologies не давали данных о пригодности правил, а
  документация Disput смешивала текущие контракты, планы реализации и
  дублированные исторические ТЗ.
- Добавлены `DecisionRequest` с контекстными вариантами и effects, режимы
  auto/assisted/manual, события request/resolution и сохранение решения в
  RunStore, trace и DebateCase.
- Правила стали параметризованными экземплярами профиля с priority, cost,
  parameters, cooldown и maxExecutions. FreeTalk использует control mode;
  Duel/Triad/Multi оценивают те же правила в shadow mode после общего
  checkpoint.
- Добавлены profile-driven progress window, явная развилка при стагнации,
  один human-authorized дополнительный шаг и резерв финализации.
- Добавлены межзапусковая rule history, страница карты «История» и
  диагностический `ModelSignal`, который удаляется из ответа и никогда не
  меняет case, readiness, progress или flow.
- Версии контрактов: protocol 5, profile schema 3, RunStore schema 4, trace
  schema 3, state-map schema 3; FreeTalk profile `0.2.0`.
- Документация Disput перенумерована D0–D20, создан D6, topology specs очищены
  от старых implementation plans, исторические требования сведены в D90–D99,
  семь точных дубликатов удалены, ссылки обновлены.
- Проверка: syntax/JSON checks, новые unit tests decisions/rules/history/signal,
  полная Jest regression — 153 suites / 872 tests (после обновления двух
  ожиданий версии профиля).

### 2026-07-19 — Only problems telemetry export, version 2.81.1

- На вкладке Telemetry добавлен включённый по умолчанию чекбокс `Only problems`.
  JSON и MD экспортируют ошибки/предупреждения и до 10 предыдущих событий того
  же запуска или модели; при выключении сохраняется полный текущий экспорт.
- На вкладке Disput чекбокс `Only problems` теперь включён по умолчанию,
  корректно учитывает ошибки завершения и восстановления и применяется также к
  JSON/MD-экспорту с контекстом.
- Профильная проверка: **4 suites / 44 tests**.

### 2026-07-19 — Disput prompt runtime 3.0 and state evolution, version 2.81.0

- Причина: короткие task-first тексты pack 2.0 устранили перегрузку, но задача,
  этап, динамическое действие, контекст и смысловое изменение карты ещё не
  образовывали один проверяемый end-to-end контракт. Модель могла получить
  нерелевантный контекст, служебный ответ — непропорциональный бюджет, а карта
  не имела общего anchored delta boundary для всех topology.
- Изменение: введены версионированные `TaskContract`, `StageContract` и
  `ActionContract`; единый `PromptCompiler` с pack `3.0.0` и воспроизводимым
  fingerprint; relevance/provenance/trust-aware `ContextBroker`; task-aware
  acceptance, строгий audit JSON и ограниченный repair. Duel, Triad, Multi и
  FreeTalk подключены к общему compiler при сохранении compatibility fallback.
- Изменение: `StateDelta` теперь валидирует source event, точную цитату,
  confidence, sequence и revision до обновления `DebateCase`. Case/map/profile/
  run/trace schemas расширены жизненным циклом assumption, contradiction,
  open question, criterion, merge/supersede/reopen, решениями человека и
  prompt/delta trace. Structure/Graf показывают новые типы, confidence,
  revision и provenance.
- Изменение: FreeTalk применяет profile trigger allowlist, semantic repetition
  guard и capability-/tool-/independence-aware routing. Недоступная независимая
  семья или инструмент не маскируются: действие получает degraded reason.
- Версии: manifest/package `2.81.0`; protocol `4`, plan `3`, case/profile/map
  `2`, run-store `3`, trace `2`, prompt pack `3.0.0`; contracts/compiler/
  context broker/StateDelta/capability registry — schema `1`.
- Файлы: новые `disput/debate-contracts.js`,
  `disput/debate-context-broker.js`, `disput/debate-prompt-compiler.js`,
  `disput/debate-state-delta.js`, `disput/debate-capability-registry.js`;
  обновлены prompt/profile/case/map/run/trace schemas, topology runners,
  FreeTalk, `results.js`, UI карты, HTML entrypoints, tests и нормативная
  документация.
- Проверка: полный Jest — **152/152 suites, 864/864 tests**. Живые Z3–Z5 и
  сравнение single/Triad/FreeTalk не объявлены выполненными и остаются в
  `reports/D19_disput-next-steps.md`.

### 2026-07-19 — Disput prompt pack 2.0

- Причина: participant prompts смешивали задачу человека, имя pipeline,
  ProblemSpec, роль и протокол; UI-лимит длины не доходил до builders.
- Изменение: введён task-first контракт; темой нового запуска стало
  сообщение модератора; Duel/Triad/Multi/FreeTalk, filters, checkpoints,
  final words, synthesis и audit получают лимит в словах из
  `debate-length-select`. FreeTalk допускает от одной модели без верхнего
  предела. Prompt pack поднят до `2.0.0`, а `DebateVersionManifest.protocol`
  повышен с `2` до `3`; в манифест добавлено точное поле `promptPackVersion`.
- Файлы: `results.js`, `disput/debate-prompt-catalog.js`,
  `disput/disput-massage.js`, `disput/triad-massage.js`, topology runners,
  `disput/debate-run-services.js`, prompt/profile schemas, tests и
  `docs/disput-docs/D5_disput-prompt-system.md`.
- Проверка: полный Jest — **151/151 suites, 856/856 tests**; дополнительно
  проверена реальная строка Triad opening с темой `2+2=` и лимитом
  `500` слов; `Triad Long` и `ProblemSpec` в неё не попадают.

### 2026-07-19 — Pipeline profiles, state map and FreeTalk MVP, version 2.80.230

- В Disput под сохранёнными pipelines добавлена сворачиваемая живая карта
  состояния с Structure/Graf, run/snapshot selection, полным A–B comparison,
  поиском, фильтрами, provenance drawer, human actions, import/export и
  сохранением доступности на terminal paths.
- Введены versioned PipelineProfile и DebateCase: типизированные артефакты,
  ссылочная целостность, append-only изменения, deterministic snapshots,
  duplicate/stale guards, migration, recovery и локальное хранение.
- Реализован FreeTalk MVP без фиксированных раундов и верхнего предела моделей:
  blind positions, deterministic triggers, приоритетная bounded queue,
  параллельные независимые действия, selective context, ручные gates,
  зарезервированный synthesis и отдельный EpistemicOutcome.
- Duel/Triad/Multi зарегистрированы как built-in profiles, но продолжают
  исполняться topology runners. Общий StageExecutor и живое сравнение при
  равном бюджете оставлены открытыми и не выданы за завершённую миграцию.
- Добавлены независимые rollback flags и content-free flag audit. Нормативные
  владельцы architecture, boundaries, telemetry, onboarding и документационная
  карта синхронизированы; создана спецификация профилей/FreeTalk и журнал
  экспериментов.
- Проверка: полный Jest — **151/151 suites, 852/852 tests**; localhost UI smoke —
  карта раскрывается, Structure/Graf переключаются, страница прокручивается,
  compare/profile controls присутствуют. Localhost ожидаемо не предоставляет
  `chrome.storage`, `chrome.runtime` и extension messaging.

### 2026-07-19 — FreeTalk default selection and map action icons

- FreeTalk при выборе pipeline теперь предлагает одну доступную модель;
  неограниченное число моделей сохраняется как возможность ручного добавления.
- В Structure/Graf действия Import и Delete заменены на стандартные иконки
  загрузки и корзины; их собственные рамки убраны, сохранены tooltip и
  доступные aria-label.
- Проверка: preset/flag suites — **2 suites / 12 tests**, дополнительно
  выполнена syntax-проверка `results.js` и `pipeline-presets.js`.

### 2026-07-18 — Clear stale main-page answers on page reload, version 2.80.230

- При обычной перезагрузке главной страницы старые содержимое карточек ответов,
  статусы индикаторов и состояния раскрытия теперь очищаются независимо от
  того, вернул ли background старый непустой snapshot.
- Snapshot при `reload` больше не гидратируется обратно в live-карточки;
  восстановление актуального ответа остаётся доступно для обычной регистрации
  страницы без reload.
- Версии `manifest.json`, `package.json` и `package-lock.json` подняты с
  `2.80.229` до `2.80.230`.

### 2026-07-18 — Model-card HTML export naming, version 2.80.229

- Главная страница экспортирует отдельную карточку модели в формате
  `GPT jul26 21-14.html`.
- Отдельная карточка модели в активной Debate-ленте экспортируется в формате
  `Debate name - GPT jul26 21-14.html`; имя берётся из полного
  пользовательского названия активной session tab.
- В имени экспортируемой approved-карточки время `HH-MM` берётся из
  `.debate-model-card.is-approved .debate-model-card-title-main
  .debate-inline-time`, то есть из времени получения ответа в ленте, а не из
  времени нажатия кнопки экспорта.
- Изменены `results.js` и `results/debate-export.js`; общий экспорт всей ленты
  сохранил прежний контракт имени файла.
- Версии `manifest.json`, `package.json` и `package-lock.json` подняты с
  `2.80.228` до `2.80.229`.
- Проверка: профильные Debate/export тесты — **2 suites / 45 tests**.

### 2026-07-18 — Reuse the latest Grok page, version 2.80.228

- При выключенном `New pages` последняя открытая страница Grok теперь проходит
  проверку по реальному полю ввода Grok, а не по всем служебным
  `contenteditable`-элементам страницы.
- Скрытые диалоги и кнопки остановки больше не считаются активными и не
  провоцируют создание новой вкладки.
- Список переиспользуемых адресов Grok синхронизирован с адресами, на которых
  уже работает Grok content script (`grok.com`, `grok.x.ai`, Grok в X и `x.ai`).
- Профильная проверка: **3 suites / 42 tests**.

### 2026-07-18 — Wide whole-debate feed, version 2.80.227

- Double-click по свободному полю `.debate-session-bar` открывает весь
  `.prompt-container.prompt-sandwich.debate-composer` в широком центрированном
  режиме, аналогичном раскрытию карточки ответа на главной странице.
- Повторный double-click закрывает ленту; клик снаружи также возвращает её в
  обычный режим. Кнопки и tabs в session bar сохраняют собственные действия.
- В широком режиме вся Debate-лента получает доступную высоту окна и внутренний
  скролл. Открытие отдельной карточки и всей ленты взаимно исключаются.
- Профильная проверка: **1 suite / 42 tests**.

### 2026-07-17 — Remove all-answers JSON export, version 2.80.226

- С главной страницы удалены кнопка и обработчик JSON-экспорта всех ответов.
  Экспорты HTML и TXT сохранены без изменений.

### 2026-07-17 — Debate presentation, export naming, duplicate-prompt guard, version 2.80.225

- Double-click по всему неинтерактивному полю `.debate-model-card-header`
  открывает Debate-карточку в широком центрированном режиме главной страницы;
  повторный double-click или клик снаружи закрывает её.
- Текстовые ответы, moderator/verdict и восстановленные Debate turns теперь
  проходят тот же Markdown→HTML formatter, что и главные карточки. Сохранённый
  HTML используется в карточке, transcript и HTML-export без потери структуры.
- `Export feed as HTML` использует полное пользовательское имя активного debate
  и формат `Name jul26 17:45.html`; в документ добавлена метка сохранения вида
  `2026-07-17_18-30`.
- TXT всех ответов называется `LLMs answers jul26 17:45` и содержит метку
  сохранения второй текстовой строкой. Та же метка добавлена в response,
  session backup и debate HTML.
- Общая composer-транзакция больше не наслаивает execCommand, synthetic paste
  и повторный execCommand. Каждый fallback начинает с пустого composer, а
  `prompt + prompt` не проходит pre-send validation.
- Проверка: **145/145 Jest suites, 827/827 tests**.

### 2026-07-17 — Late completed-answer auto recovery, version 2.80.224

- По прогону `1784306613833` исправлена ранняя фиксация `EXTRACT_FAILED` для
  GPT, Z.ai и DeepSeek: завершённые ответы существовали на страницах, но
  автоматическое извлечение прочитало prompt/UI/пустой DOM до конца генерации.
- `ANSWER_COMPLETE_DETECTED`, пришедший после красного terminal-статуса, теперь
  сохраняется как lifecycle evidence и автоматически запускает безопасное
  повторное чтение текущего хода вместо классификации как post-terminal noise.
- Для `empty_answer`, `answer_prompt_echo`, `answer_ui_noise` и
  `extract_failed` добавлена ограниченная фоновая лестница повторов на случай,
  если провайдер (как GPT в этом прогоне) не прислал lifecycle COMPLETE.
  Восстановление привязано к текущему dispatch и сохраняет stale-baseline guard.
- Добавлены регрессии на поздний COMPLETE и отсечение COMPLETE от старого
  dispatch. Проверка: **145/145 Jest suites, 824/824 tests**.

### 2026-07-17 — Qwen fail-closed Send control, version 2.80.223

- По реальному прогону устранены повторные клики Qwen по иконке вложений:
  общий SVG, близость к composer, primary/arrow и `paper` больше не считаются
  доказательством Send; `paperclip`, add-file/upload, voice и stop безусловно
  запрещают клик, включая признаки на вложенной иконке.
- Обычная и аварийная попытки используют один строгий фильтр и остаются
  привязаны к исходному composer. Настоящие `send-button`, `type=submit` и
  локализованное «Отправить» сохранены; клавиатурные/form fallback не удалены.
- Удалены не относящиеся к инциденту промежуточные изменения UI-статусов и
  Qwen extraction. Файлы: `content-scripts/content-qwen.js`, профильные тесты,
  `manifest.json`, `package.json`, `package-lock.json`.
- Проверка: 5 профильных Jest suites, 56 tests; полный Jest — **144/144
  suites, 822/822 tests**. Дополнительно live DOM Qwen проверен без отправки —
  Send имеет `send-button`/«Отправить». Авторизованный extension smoke остаётся
  внешней приёмкой в `reports/D19_disput-next-steps.md`.

### 2026-07-17 — Disput I–III audit remediation, version 2.80.222

- Исправлены причины реального Triad Red Team failure: compiler/runtime
  синхронизированы по `stageRoles`, `auditor:auto` разрешается в модель,
  `independent_retest` определён, Multi планирует всех повторяющихся критиков.
- Введена строгая collected/accepted граница: caller `stageAttemptId` проходит
  сквозь batch, missing/mismatch correlation отклоняется, durable ledger не
  принимает другую попытку после reload; retry не коммитит partial batch.
- Acceptance, synthesis/final-word repair, risk-based audit, selective context,
  budget compaction, extractor routing, checkpoint-local RoundDelta,
  convergence/adaptive stopping, anonymization и ProcessAudit доведены во всех
  трёх topology. Red Team terminal outputs явно включают residual risks.
- Исправлено ложное `retest_not_independent`: validator сравнивает participant
  waves, а не service filter model. Version manifest: implementation 2.80.222,
  protocol/plan/run-store `2/2/2`.
- Нормативные владельцы architecture, telemetry, round plans и topology specs,
  отчёты I–III, prompt-audit и единая live-матрица синхронизированы.
- Проверка: **144/144 Jest suites, 820/820 tests**; после финальной validator-
  правки отдельно пройдены 2 suites / 16 tests.

### 2026-07-16 — Triad Red Team independent retest artifact, version 2.80.221

- Добавлено нормативное определение `independent_retest` в реестр артефактов;
  Triad Red Team теперь проходит plan validator без `artifact_undefined`.
- Добавлен тест полноты артефактов всех встроенных roundPlan.
- Версии `manifest.json`, `package.json` и `package-lock.json` синхронизированы
  на `2.80.221`.
- Полный Jest: 142 suites / 810 tests.

### 2026-07-16 — Triad execution-plan participant fallback, version 2.80.220

- Исправлен `Invalid Debate execution plan` после первого Triad-раунда:
  compiler теперь восстанавливает участников из текущего выбора, явного
  `participants/models`, `protocol.selectedModels` и `r1-models` stack.
- В UI запуск передаёт модели первого pipeline-раунда, если header selection
  временно пуст; `r*:wave` и `final:words` больше не получают пустой participants.
- Добавлен регрессионный тест compiler fallback; профильная проверка — 49 тестов.
- Версии `manifest.json`, `package.json` и `package-lock.json` синхронизированы
  на `2.80.220`.

### 2026-07-16 — Disput T10 safety controls, version 2.80.219

- Закрыт последний partial-пункт этапа I: dropout UI получил ручной retry
  после исчерпания auto-retry; Duel, Triad и Multi перезапускают текущую
  неудачную стадию без автоматического зацикливания.
- Pause/resume/cancel/recover теперь отражают `safetyPolicy`; добавлены
  T10-матрица и mock-тесты runner'ов/UI.
- Версии `manifest.json`, `package.json` и `package-lock.json` синхронизированы
  на `2.80.219`.
- Проверка: T10 — 5 suites / 56 tests; полный Jest — 142 suites / 808 tests.
- Ручной Multi pause/resume e2e не выдаётся за выполненный: он требует
  залогиненной вкладки провайдера и записан в `docs/disput-docs/reports/D19_disput-next-steps.md`.

### 2026-07-16 — Disput sections II–III hardening, version 2.80.218

- Для чего: довести проверяемые контракты второй и третьей очереди до runtime.
  Изменение: добавлены selective context policies и budget wrapper, persisted
  dispatch/accepted ledgers, version manifest, conformance scenarios,
  epistemic/process audit fields, synthesis audit stage с одним correction pass,
  final-position delta и Triad Red Team stage-role retest. Файлы: `disput/*`,
  `background/dispatch-retry.js`, `results.js`, `results/debate-plan-view-model.js`.
- Документация-владельцы: `docs/disput-docs/reports/D17_section-two-report.md`,
  `docs/disput-docs/reports/D18_section-three-report.md`, `docs/disput-docs/D3_disput-architecture-boundaries.md`;
  открытые live/UI остатки записаны только в `docs/disput-docs/reports/D19_disput-next-steps.md`.
- Версии `manifest.json`, `package.json` и `package-lock.json` синхронизированы
  на `2.80.218`.
- Проверка: полный Jest — 141 suites, 803 tests; live V1/provider ingress
  остаётся непроверенным без залогиненных вкладок и не выдается за выполненный.
- Дополнительно: extractor получил опциональный UI-селектор, Multi/Triad Red
  Team получили stage-role маршрутизацию, а SynthesisAudit подключён к трём
  topology runner'ам с максимум одним correction pass.
- Добавлена обязательная процедура V1 registry gate в
  `benchmarks/registry-reliability.md`; live-таблица заполняется только после
  реальных девяти запусков.

### 2026-07-16 — Disput prompt audit baseline, version 2.80.217

- Зафиксированы неизменяемые задачи и матрица Z2 в `docs/disput-docs/reports/D15_prompt-audit-tasks.md`.
- Выполнен кабинетный Z1-аудит prompt builders, roundPlan, миссий, fallback,
  шаблонов и Triad checkpoint; находки и калибровка T1/T2/T5/T8/T9/V1/T12
  записаны в отчёт `docs/disput-docs/reports/D14_prompt-audit-report.md`.
- Живые Z3-прогоны не выполнены: в среде нет залогиненных вкладок LLM.
- Версии `manifest.json` и `package.json` синхронизированы на `2.80.217`.
- Проверка: версии совпадают; ссылки отчёта на `tasks.md` относительные и
  разрешаются внутри владельца prompt-аудита.

### 2026-07-16 — Disput Must Have implementation pass, version 2.80.217

- Реализованы T1–T6 и T12: artifact definitions, phase-specific prompts, blind
  invariant, plan contract validation, response acceptance, local persistence и
  benchmark collector.
- Добавлены stageAttemptId и защита duplicate terminal; T7/T9/T10/T11 имеют
  остаточные пункты, перечисленные в `docs/disput-docs/reports/D16_must-have-report.md` и `docs/disput-docs/reports/D19_disput-next-steps.md`.
- Проверка: Node-load всех новых модулей, компиляция 9 presets, benchmark demo;
  Jest не запускается из-за отсутствия `jest-environment-jsdom`.

### 2026-07-13 — Baseline-safe recovery finalization, version 2.80.216

- Реальный Z.ai overload-run показал ложный `SUCCESS`: новый prompt не был
  отправлен, но `materialize_recovery` принял старый `preserved_pending`, равный
  pre-dispatch baseline. Baseline hash теперь сохраняется вместе с signature и
  anchor и участвует во всех recovery-решениях.
- `RecoveryIntent` блокирует resend только по доказанно свежему evidence.
  Baseline-only и неподтверждённый pending-текст больше не подтверждают Round 2,
  не запрещают repair resend и не создают Qwen `PROMPT_SUBMITTED_INFERRED`.
- Materialize recovery применяет общий freshness gate: кандидат должен
  отличаться от baseline и иметь content-confirmed submit, correlated lifecycle
  либо новый DOM-узел после anchor. Recovery без completion evidence может дать
  только `PARTIAL`, а без freshness не может завершиться как `SUCCESS`.
- Добавлены регрессии подтверждённого Z.ai-инцидента и соседних Qwen/DeepSeek
  сценариев. Версии manifest/package синхронизированы на `2.80.216`.
- Проверка: профильные freshness/recovery/finalization suites — 8/8 suites,
  95/95 tests; полный suite — 139/139 suites и 786/786 tests.

### 2026-07-13 — Corrected completion status of Disput telemetry 2.80.215

- Уточнён статус записи ниже: `2.80.215` реализовала schema/store, базовую
  correlation, observational adapters, projections, Disput UI и canonical
  report MVP, но не весь end-to-end контракт `docs/disput-docs/D7_disput-telemetry.md`.
- Полная нативная instrumentation, строгая межконтекстная correlation,
  event-specific payload validation, единый MV3 collector, второй export
  redaction pass, полный integrity/live UI, удаление legacy export sources и
  реальные replay/E2E acceptance остаются открытой работой.
- Подробный недублирующий список с критериями завершения добавлен в
  `docs/disput-docs/reports/D19_disput-next-steps.md`; нормативный целевой контракт не изменён. Это
  документационная корректировка без изменения runtime и версии manifest.

### 2026-07-13 — Implemented machine-first Disput telemetry, version 2.80.215

- Введён единый append-only Debate trace с `envelope + typed payload`, корневым
  `debateRunId`, plan/stage/attempt/background correlation, collector sequence,
  batching MV3 persistence, deduplication и обязательной ingress redaction.
- `DebateRunStore`, runners и существующие background diagnostics подключены к
  trace в observational режиме. Добавлены stage, barrier, participant,
  artifact, dropout и retry/recovery evidence; background diagnostics получают
  непрозрачные Debate/plan/stage IDs без изменения dispatch-семантики.
- Реализованы чистые machine projections: deterministic health, diagnoses,
  Plan vs Actual, Participant Matrix, grouped barriers/dispatch attempts,
  critical path и integrity audit. JSON является каноническим отчётом, Markdown
  строится из того же report; статическая Duel theory удалена из Triad/Multi
  пути.
- Вкладка Disput теперь показывает Health, Problems/Recovery, Plan vs Actual,
  participants, critical path/barriers и raw trace; поддерживает выбор run,
  фильтры stage/model/type/severity, Only problems, очистку и MD/JSON export.
- Добавлены нормативный `docs/disput-docs/D7_disput-telemetry.md`, schema/store/projection/UI и
  acceptance tests для паттерна Qwen manual recovery, DeepSeek premature
  terminal/state divergence, Le Chat stable-text fallback, stale event и UI
  projection failure. Версии manifest/package согласованы на `2.80.215`.

### 2026-07-13 — Perplexity native input recovery and 2.80.214 regression analysis

- `telemetry-1783937875439.json` показал первый отказ: вкладка оставалась в
  Chrome-состоянии `loading`, поэтому dispatch трижды завершался
  `tab_load_timeout`, не достигнув вставки. Perplexity теперь может пройти
  readiness только по реальному `HEALTH_CHECK_PONG` content script; один URL
  или визуально открытая вкладка не считаются готовностью.
- `telemetry-1783938336991.json` показал второй отказ: prompt был визуально
  вставлен, но Perplexity откатил synthetic input из React-state; общий gate
  получил `prompt_not_present`, поэтому native Enter/Send не запускались.
  Добавлен sender-gated recovery рабочего browser-input контракта: focused live
  composer получает `SelectAll` + CDP `Input.insertText`, после settle заново
  связывается и проверяется, затем выполняются native Enter и scoped trusted
  Send fallback. Пользователь подтвердил успешную реальную отправку без файла;
  4 focused suites / 48 tests также проходят.
- Регрессия возникла между `2.80.211` и `2.80.214`: узкое исправление сравнения
  prompt с attachment-chip заменило весь ранее восстановленный provider-local
  submit path. Source-order и jsdom rich-editor tests проверили структуру, но не
  могли доказать принятие synthetic input живым React-приложением. При этом
  обязательный real-page smoke оставался открытым в `next-steps`, а запись
  `2.80.214` преждевременно называла путь проверенным по одному Jest.
- В нормативный tab contract добавлен release guard: сохранять последний
  live-confirmed transport, менять только один transaction gate за раз, не
  приравнивать DOM-видимость к provider-state acceptance и не объявлять
  transport проверенным без no-attachment real-page smoke. Attachment/modal
  smoke остаётся отдельной открытой проверкой.
- Изменены `background/tab-manager.js`, `background/message-router.js`,
  `content-scripts/content-perplexity.js`,
  `tests/tab-manager-session-scope.test.js`,
  `tests/composer-transaction-contract.test.js` и нормативная документация.

### 2026-07-13 — Prompt-owned Perplexity submit transaction, version 2.80.214

- Устранено расхождение, при котором prompt с attachment-chip проходил общий
  preparation gate, но строгая equality отправки не находила тот же composer.
  Perplexity теперь использует единый prompt evidence contract, один native
  Enter и один composer-scoped trusted Send fallback; synthetic Enter и
  generic page clicks удалены.
- Submit подтверждается только исчезновением prompt, новым user turn или новым
  относительно baseline generation control. Добавлен исполняемый rich-editor
  regression test; полный Jest — 137 suites / 769 tests, manifest/package
  версии согласованы на `2.80.214`.
- Реальный no-attachment прогон позднее выявил регрессию input gate; запись
  сохранена как история, а причина и исправление зафиксированы выше.

### 2026-07-13 — Isolated main-page Send from Debate startup, version 2.80.213

- Полностью удалён неуместный канал main-page Send → Debate: обработчик Send
  больше не может открыть `pipeline_panel.html`, сохранить Debate auto-run
  intent или вызвать pipeline runtime.
- Удалены producer, consumer и startup hook сохранённого intent, поэтому старое
  состояние также не может запустить Debate при загрузке. Запуск Debate теперь
  принадлежит только явным элементам управления Debate/Pipeline.
- Regression guard проверяет непосредственно production-обработчик Send и
  отсутствие навигации/автозапуска. Версии manifest/package согласованы на
  `2.80.213`.

### 2026-07-13 — Attempted stale-scheme handoff guard, version 2.80.212 (superseded)

- Main-page Send no longer uses the globally persisted Debate scheme to decide
  whether to open `pipeline_panel.html`. That value may belong to a previous
  Debate run and could redirect an ordinary main-page request and start a second
  flow unexpectedly.
- The active pipeline configuration now publishes its scheme on the pipeline
  panel; only an explicitly active Triad/Multi configuration hands off. Duel
  and ordinary comparison sends remain on the main page, while the Debate page
  keeps its local scheme behavior. Added a pure resolver regression test and
  synchronized manifest/package versions to `2.80.212`.
- Исправление оказалось недостаточным: оно меняло источник scheme, но сохраняло
  ошибочное право главной кнопки запускать Debate. Полностью заменено границей
  ответственности версии `2.80.213`.

### 2026-07-13 — Documented debugger-notification boundary (documentation only)

- В нормативный tab contract добавлено объяснение уведомления Chrome о
  подключённой отладке: `chrome.debugger` используется только для trusted
  attachment-команд в привязанной вкладке и не означает наблюдение за экраном,
  действиями пользователя или другими вкладками. Уточнены detach/`finally` и
  область собираемых данных; версия манифеста не изменялась.

### 2026-07-13 — Normalized open Perplexity smoke reference (documentation only)

- Открытая attachment-проверка в `docs/disput-docs/reports/D19_disput-next-steps.md` обновлена с устаревшей
  версии `2.80.206` до текущего provider-local submit baseline `2.80.211`.
  Дублирующаяся история исправлений не добавлялась.

### 2026-07-13 — Conversation-wide documentation audit (no version bump)

- Сверены решения из всей рабочей беседы: staged Debate extraction, capability
  `deps` boundary, `window.runPipeline` compatibility shim, per-stage tests,
  preset handoff, mandatory synthesis/filter stages, dropout reduction,
  completion/recovery guards и Perplexity local-first submit.
- Недостающие migration guardrails добавлены в
  `docs/disput-docs/D2_disput-architecture.md`; реальный smoke-run Perplexity после `2.80.211`
  оставлен открытой задачей в `docs/disput-docs/reports/D19_disput-next-steps.md`.
- Нормативные документы не дублируют исторический changelog; ссылки проверены.

### 2026-07-13 — Restored provider-local Perplexity submit path, version 2.80.211

- Perplexity снова сначала отправляет через собственный composer: Ctrl+Enter,
  затем семантически проверенная кнопка Submit/Ask и page-local click.
- CDP trusted click/Enter остаются только fallback. Старый cached generic button
  не может быть выбран как Send, а `aria-busy` или декоративный loading больше не
  считаются доказательством отправки.
- Добавлен regression contract для local-first порядка; версии manifest/package
  согласованы на `2.80.211`. Изменены `content-scripts/content-perplexity.js`,
  `background/message-router.js`, `tests/composer-transaction-contract.test.js`
  и нормативный `docs/model-tabs-architecture.md`.

### 2026-07-13 — Reliable Perplexity send and explicit Debate dropout policy, version 2.80.210

- Perplexity получил guarded native Enter fallback после неподтверждённого
  trusted Send click; fallback разрешён только пока точный prompt остаётся в
  composer, а `PROMPT_SUBMITTED` по-прежнему публикуется только после подтверждения.
- Duel, Triad и Multi теперь предлагают продолжить без выбывшей модели либо
  остановить процесс; продолжение сокращает active participant set и меняет
  недоступного синтезатора, остановка канонически завершает aggregate run как
  `cancelled`.
- Обновлены topology/runtime tests и нормативные architecture/protocol/tab
  contracts; полный прогон — 137 suites / 769 tests. Изменены `results.js`,
  `disput/duel-runner.js`, `disput/triad-runner.js`, `disput/multi-runner.js`,
  `disput/debate-runtime.js`, `disput/triad-runtime.js`,
  `disput/debate-run-store.js` и соответствующие topology/runtime tests. Версии
  manifest/package согласованы на `2.80.210`.

### 2026-07-13 — Aligned Debate canvas, prompts, roles and completion guard, version 2.80.209

- Canvas теперь показывает обязательный Duel Final Synthesis и round filter
  stages; saved config сохраняет `roundPlan`, а инспектор показывает реально
  применяемую читаемую роль вместо текста несвязанного judge-template.
- Verdict/Red Team/Long получили исполняемые миссии участников во всех topology;
  Debate и judge prompts сокращены и синхронизированы между runtime sources.
- Lifecycle detector игнорирует скрытые busy-индикаторы, удаляет stale candidate
  другого trace и безопасно обходит только застрявший декоративный loading после
  6 секунд стабильности; Stop/progressbar остаются hard blockers.
- Добавлены focused regression tests; полный прогон — 137 suites / 762 tests,
  версии manifest/package согласованы на `2.80.209`.

### 2026-07-13 — Fixed preset flow and main-page Debate handoff, version 2.80.208

- Fixed Red Team presets переведены в Auto, а их runtime round/wave/turn limits
  теперь выводятся из канонического `roundPlan`, а не из скрытого UI-селектора.
- Main-page Send для Triad/Multi сохраняет краткоживущий intent с темой,
  моделями и схемой, открывает Debate и автоматически запускает полный flow;
  Duel сохраняет обычный comparison path.
- Добавлены resolver/handoff guards и сквозной Triad Red Team тест: четыре
  model waves и один Final Synthesis. Полная проверка: 136 suites / 756 tests;
  версии manifest/package согласованы на `2.80.208`.

### 2026-07-12 — Perplexity resume attachment transaction after modal, version 2.80.207

- После закрытия same-page promotion окно больше не оставляет исходный flow в
  `prompt_injection_failed`: attachment guard выполняет финальный close-pass и
  одну повторную correlated attachment transaction.
- Prompt и Send остаются заблокированы до persistent file evidence; второй
  неуспех завершается без дублирования файла. Обновлены tab contract, regression
  tests и версии manifest/package; полный набор — 134 suites / 750 tests green.

### 2026-07-12 — Perplexity exact promotion close control, version 2.80.206

- Уточнён живой DOM: крестик —
  `button.reset.interactable.select-none.[-webkit-user-drag:none].outline-none…`,
  а его overlay не обязан иметь `role=dialog` или modal-класс.
- Guard теперь сначала находит стабильную комбинацию классов кнопки, связывает
  её с ближайшим promotion-text ancestor и проверяет top-right ownership перед
  кликом. Добавлен исполняемый DOM regression test; обновлены tab contract и
  версии manifest/package; полный набор — 134 suites / 750 tests green.

### 2026-07-12 — Perplexity same-page promotion guard, version 2.80.205

- `telemetry-1783888787261.json` показал, что paywall не навигировал вкладку:
  после native assignment тарифный modal остался на `perplexity.ai`, transient
  upload-разметка дала ложный `ATTACHMENT_CONFIRMED` при нулевых file evidence,
  blocker отменился и prompt завершился `prompt_injection_failed`.
- Promotion guard теперь работает во время attachment confirmation, безопасно
  распознаёт icon-only × внутри тарифного диалога, а Perplexity требует
  сохраняющееся file evidence. Обновлены tab contract, regression tests и
  версии manifest/package; полный набор — 134 suites / 749 tests green.

### 2026-07-12 — Perplexity lazy native input before paywall, version 2.80.204

- `telemetry-1783888200239.json` показал реальный второй paywall после принятого
  resume: каждый dispatch трижды нажимал upload controls, потому что между
  кликами транспорт ждал только chooser-событие и не проверял появившийся
  нативный file input.
- Perplexity теперь ищет provider-owned input до и после открытия меню, сразу
  назначает файл найденному input, ограничивает click cascade и прекращает его
  при `/pro/payment`. Обновлены нормативный tab contract, regression test и
  версии manifest/package; полный набор — 134 suites / 748 tests green.

### 2026-07-12 — Подтверждаемое возобновление Perplexity, version 2.80.203

- `telemetry-1783884149644.json` доказал, что исходный `connection_failed`
  опережал старый resume-сигнал на 95 мс, а второго dispatch не возникало.
  Perplexity теперь немедленно подтверждает `GET_ANSWER`, регистрирует и
  коррелирует paywall-переход до навигации, проверяет восстановленный composer,
  корректно сбрасывает FSM и пишет resume только после принятия новой команды.
- Устаревшие transport callback и pre-terminal recovery изолируются, identity
  blocker сохраняется при MV3 compaction. Обновлены adapter, dispatch/router,
  очистка состояния, нормативный tab contract, focused regression tests и
  версии manifest/package; проходят 50 целевых тестов.

### 2026-07-12 — Disput export action order, version 2.80.202

- В toolbar вкладки Disput применён тот же контракт, что в Telemetry: JSON
  расположен первым и показан иконкой `ti-download`, MD расположен вторым и
  остаётся текстовой кнопкой.
- ID, aria-label и обработчики сохранены; нормативный telemetry UI contract,
  regression test и версии manifest/package обновлены до `2.80.202`.

### 2026-07-12 — Telemetry export action order, version 2.80.201

- В toolbar вкладки Telemetry кнопки JSON и MD поменяны местами: JSON теперь
  расположен первым и отображается иконкой `ti-download`, визуально совпадающей
  с экспортом карточки модели на главной странице; MD остаётся текстовой.
- ID, aria-label и существующие обработчики экспорта сохранены; нормативный
  telemetry UI contract и версии manifest/package обновлены до `2.80.201`.

### 2026-07-12 — Perplexity resume listener ordering, version 2.80.200

- Лог `All Logs 20260712_21-03.md` показал, что transient resume публиковался,
  но на `DOMContentLoaded` до регистрации runtime listener; background сразу
  отправлял команду и получал `Could not establish connection`.
- Blocker-cleared event теперь отправляется только после `onMessage.addListener`
  и `SCRIPT_READY`, поэтому восстановленный chat document уже способен принять
  повторный dispatch. Таймеры и дополнительные fallback не добавлялись.
- Обновлены нормативный контракт и regression test; версии согласованы на
  `2.80.200`.

### 2026-07-12 — Perplexity paywall resumable handoff, version 2.80.199

- Лог `All Logs 20260712_20-44 (1).md` показал ошибку `2.80.198`: первое
  закрытое paywall окно за 1–2 секунды ошибочно терминализировало модель как
  `attachment_unavailable`, вместо продолжения исходной работы.
- Первый paywall теперь transient blocker. После возврата в чат новый content
  script отправляет `PROVIDER_TRANSIENT_BLOCKER_CLEARED`, а background один раз
  возобновляет исходные prompt+attachments. Только повторный paywall после resume
  становится terminal capability failure.
- Обновлены нормативный контракт и regression tests; версии согласованы на
  `2.80.199`.

### 2026-07-12 — Perplexity paywall terminal handoff, version 2.80.198

- Лог `All Logs 20260712_20-26.md` показал, что paywall закрывался, но навигация
  уничтожала исходный content-script port; background не получал capability
  failure и продолжал Round2/3/4, focus и materialize почти минуту.
- Новый content script payment page отправляет sender-gated
  `PROVIDER_CAPABILITY_BLOCKED`; background снимает pipeline ownership и сразу
  терминализирует модель как `USER_ACTION_REQUIRED/attachment_unavailable` без
  recovery. Запрос без файла не отправляется.
- Обновлены нормативный контракт и regression tests; версии согласованы на
  `2.80.198`.

### 2026-07-12 — Perplexity file-upload paywall capability gate, version 2.80.197

- Уточнено наблюдение пользователя: Perplexity переводит вкладку на
  `/pro/payment?plan=yearly&origin=fileUpload`, где page-owned окно закрывается
  обычным Close/×; это не системное окно Chrome.
- Content adapter закрывает это окно, запоминает недоступность file upload для
  сессии и прекращает повторные Upload/focus/recovery попытки с типом
  `attachment_unavailable`. Prompt без требуемого файла не отправляется.
- Обновлены нормативный контракт и regression tests; версии согласованы на
  `2.80.197`.

### 2026-07-12 — Download UI permission and fail-closed materialization, version 2.80.196

- Повторный тест доказал, что bubble не был устранён: `setUiOptions()` требует
  отдельного Chrome permission `downloads.ui`, которого не было в manifest, а
  ошибка подавления UI ошибочно игнорировалась.
- Добавлен `downloads.ui`; suppression теперь проверяется до materialize. При
  отсутствии permission/API операция завершается
  `download_ui_suppression_unavailable` до `chrome.downloads.download`, поэтому
  browser download UI физически не может открыться этим путём.
- Обновлены нормативный контракт и regression tests; версии согласованы на
  `2.80.196`.

### 2026-07-12 — Perplexity promotion guard and hidden materialization UI, version 2.80.195

- Устранён источник самопроизвольного открытия Chrome downloads bubble:
  внутреннее materialize через `chrome.downloads` теперь выполняется с временно
  отключённым download UI и reference-counted восстановлением в `finally`.
- Perplexity перед composer transaction закрывает только явно распознанный
  page-owned upgrade/plan/package dialog через его Close/Dismiss/Not now control;
  file menus, произвольные dialogs и browser chrome не затрагиваются.
- Обновлены нормативный контракт и regression tests; версии согласованы на
  `2.80.195`.

### 2026-07-12 — Honest R2 deferred telemetry, version 2.80.194

- Аудит строки Le Chat `R2 done • awaiting original provider pipeline` выявил
  семантический дефект: R2 не выполнял VERIFY, но безусловный `ROUND2_END`
  отображался как успешный `done`.
- Active provider ownership теперь даёт outcome `deferred`; Markdown export и
  DevTools показывают `deferred`, а не `done`. Collection/adaptive probes в
  занятую вкладку удалены, поэтому R2 больше не создаёт ложные message-port
  failures во время исходной транзакции.
- Le Chat provider adapter не изменялся; контракт и regression tests обновлены,
  версии согласованы на `2.80.194`.

### 2026-07-12 — Perplexity native chooser and live composer correction, version 2.80.193

- Лог `All Logs 20260712_19-38.md` исключил upgrade modal как подтверждённую
  причину и выявил ложный attachment success: первый клик открыл «Добавить файлы
  или инструменты», после чего retained files случайного input считались доставкой.
- Perplexity теперь проходит до конкретного upload menu item и требует реальный
  intercepted file chooser; `input.files` больше не evidence. Live composer
  discovery расширен для актуальных contenteditable и локализованных textarea.
- Le Chat не изменялся и подтверждён как рабочий; версии согласованы на
  `2.80.193`, tests и нормативный контракт обновлены.

### 2026-07-12 — Rich-editor prompt evidence correction, version 2.80.192

- Лог `All Logs 20260712_19-21.md` подтвердил: attachment и single-owner
  transaction работали, но общий prompt gate ложно отвергал видимый prompt в
  Le Chat и Perplexity до достижения Send.
- Reader теперь учитывает rendered `innerText`, удаляет zero-width Unicode и
  проверяет полный prompt либо независимые head/tail fingerprints; оба адаптера
  повторно связываются с live composer по тем же двум доказательствам.
- Send/attachment transports не изменялись; контракт и tests обновлены, версии
  согласованы на `2.80.192`.

### 2026-07-12 — Provider-owned trusted Send control, version 2.80.191

- После подтверждения attachment и prompt для Le Chat/Perplexity изолирована
  последняя граница: прежние synthetic keyboard/DOM-click методы заменены одним
  sender-gated trusted кликом по enabled Send активного composer.
- Поиск Send исключает microphone, voice, attachment, upload, stop, model и
  tool controls; `PROMPT_SUBMITTED` по-прежнему требует evidence очистки
  composer или начала генерации.
- Обновлены нормативный контракт и regression tests; версии согласованы на
  `2.80.191`.

### 2026-07-12 — Single-owner provider dispatch transaction, version 2.80.190

- Лог `All Logs 20260712_16-20.md` доказал гонку: Round 2 запускал repair resend,
  пока исходный Le Chat/Perplexity pipeline ещё обрабатывал attachment, и две
  операции одновременно изменяли composer.
- Content adapter теперь явно владеет активной provider-транзакцией; Round 2 не
  может сбрасывать или повторять её. Perplexity получает upload node через
  trusted Attach click и перехваченный native file chooser.
- Обновлены нормативный контракт и regression tests; версии согласованы на
  `2.80.190`.

### 2026-07-12 — Le Chat trusted submit and Perplexity attachment evidence, version 2.80.189

- Подтверждённый пользователем ручной Ctrl+Enter для Le Chat реализован как
  sender-gated trusted browser gesture; synthetic keyboard events оставлены
  только резервными методами с обязательным send evidence.
- Perplexity больше не считает сам CDP assignment успешной загрузкой: выбирается
  релевантный composer file input, отправляются native `input`/`change`, затем
  требуется фактическое file evidence.
- Z.ai не изменялся и зафиксирован как рабочий; версии согласованы на
  `2.80.189`, regression tests обновлены.

### 2026-07-12 — Z.ai/Perplexity native attachment and Le Chat composer recovery, version 2.80.188

- Исправлена потеря `message.attachments` в Z.ai; Z.ai и Perplexity переведены
  с неподтверждённых synthetic vectors на sender-gated trusted native file
  assignment.
- Le Chat после attachment rerender повторно находит именно тот live composer,
  который содержит текущий точный prompt, и отправляет через него.
- Изменения подтверждены логом `All Logs 20260712_15-00.md`; обновлены контракт
  и regression tests, версии согласованы на `2.80.188`.

### 2026-07-12 — Z.ai clipboard attachment transaction, version 2.80.187

- Z.ai переведён на отдельный paste-only путь вложений, соответствующий
  подтверждённому ручному copy + Ctrl+V; отправка события без появления нового
  file evidence не считается успехом.
- После подтверждения файла адаптер заново получает composer, проверяет точный
  prompt и публикует `PROMPT_SUBMITTED` только после подтверждённой отправки.
- Обновлены нормативный контракт и regression test; версии manifest/package
  согласованы на `2.80.187`.

### 2026-07-12 — Qwen/Perplexity/Le Chat transaction enforcement, version 2.80.186

- Qwen больше не считает trusted file assignment готовой загрузкой: после CDP
  назначения ожидается устойчивое input/filename/chip evidence, и только затем
  разрешается prompt/send.
- Perplexity и Le Chat переведены на общий exact-prompt gate; legacy attachment
  fallbacks удалены. Неподтверждённый drop больше не блокирует следующий vector.
- Perplexity публикует `PROMPT_SUBMITTED` только после подтверждённого send;
  раньше событие уходило даже после провала всех send strategies.
- Z.ai не изменялся. Контракт и tests обновлены; версии согласованы на
  `2.80.186`.

### 2026-07-12 — DeepSeek composer transaction, version 2.80.185

- Выделен общий gate `ContentUtils.ensurePromptPrepared`: Send разрешён только
  если live composer содержит именно текущий prompt, а не произвольный текст.
- DeepSeek после attachment заново получает composer, проходит общий prompt
  gate и публикует `PROMPT_SUBMITTED` только после доказанного send. Раньше
  `sendComposer()` не возвращал результат, поэтому submit объявлялся даже после
  неудачных клавиатурных стратегий.
- Для DeepSeek удалён преждевременный `singleDispatch`: неподтверждённый drop
  больше не запрещает перейти к следующему delivery vector.
- Добавлен composer-transaction regression suite; версии согласованы на
  `2.80.185`.

### 2026-07-12 — Deterministic manual-reload UI reset, version 2.80.184

- Ручная перезагрузка расширения теперь определяется по runtime epoch в
  `chrome.storage.session`, а не только через ненадёжный для этого сценария
  `runtime.onInstalled`.
- До hydration очищаются старые `jobState`, tab map, diagnostics, cross-view
  live state и выбор моделей для main/pipeline; обычное пробуждение MV3 worker
  состояние не сбрасывает.
- Уже открытые results views получают `runtimeReset` и немедленно очищают
  кнопки моделей, статусы ответа, Logs и локальный telemetry cache.
- Контракт и regression tests обновлены; версии согласованы на `2.80.184`.

### 2026-07-12 — Qwen native file-input transport rebuilt, version 2.80.183

- Реализация Qwen attachments пересобрана с нуля по актуальному live DOM:
  `textarea.message-input-textarea` и скрытый
  `input#filesUpload[multiple][type="file"]`.
- Старый каскад synthetic drop/input/menu исключён из Qwen. Background
  материализует файлы и выполняет trusted `DOM.setFileInputFiles` на точном
  input; RPC разрешён только sender-вкладке `https://chat.qwen.ai/`.
- После назначения файлов Qwen заново находит composer, проверяет prompt и лишь
  затем ищет Send. Контракт и regression tests обновлены; версии согласованы на
  `2.80.183`.

### 2026-07-12 — Provider-scoped drag cleanup for Qwen, version 2.80.182

- Лог `All Logs 20260712_00-47.md` подтвердил однофайловый Qwen failure во всех
  drop/input vectors после глобального drag cleanup из `2.80.181`.
- `dragleave/dragend` теперь включаются только для ChatGPT; Qwen снова получает
  незавершённый до `drop` lifecycle, необходимый его асинхронному обработчику.
- Контракт и тесты уточнены; версии manifest/package согласованы на `2.80.182`.

### 2026-07-12 — ChatGPT drag-overlay cleanup, version 2.80.181

- Исправлена незавершённая synthetic drag-сессия ChatGPT: после доставки файла
  main-world bridge, общий attachment handler и локальный fallback отправляют
  `dragleave` и `dragend`, поэтому окно DRAG&DROP не остаётся поверх генерации.
- Нормативный attachment contract и GPT regression test обновлены; версии
  `manifest.json`, `package.json` и `package-lock.json` согласованы на
  `2.80.181`.

### 2026-07-12 — Qwen sequential multi-file attachment, version 2.80.180

- Лог `All Logs 20260712_00-33.md` показал первопричину `NO_SEND`: Qwen
  игнорировал двухфайловый `DataTransfer`, затем четыре attachment-стратегии
  ждали таймауты, поэтому prompt по fail-closed контракту не вставлялся.
- Для Qwen каждый файл теперь прикрепляется и подтверждается отдельно; prompt
  вставляется только после подтверждения всей последовательности.
- Нормативный attachment contract и регрессионные тесты обновлены; версии
  `manifest.json`, `package.json` и `package-lock.json` согласованы на
  `2.80.180`.

### 2026-07-11 — Gemini prompt guard hotfix and Qwen composer recovery, version 2.80.179

- Исправлен runtime error Gemini `normalizeForComparison is not defined`:
  проверка вставленного prompt использует локальный нормализатор адаптера.
- Qwen после attachment rerender заново находит live composer перед вставкой
  prompt; защита от microphone/voice больше не отклоняет настоящий Send, если
  его метаданные одновременно содержат явную send identity.
- Версии `manifest.json`, `package.json` и `package-lock.json` согласованы на
  `2.80.179`.

### 2026-07-11 — Plan-driven Debate execution foundation, version 2.80.178

- Введён единый immutable `DebateExecutionPlan`: новый compiler строит точную
  последовательность public/system stages для Duel/Triad/Multi до первого
  browser effect, а validator отклоняет неполный граф, отсутствующих участников,
  неизвестные tab policies, artifact gaps и недостижимый Final Synthesis.
- Canonical `DebateRunStore` сохраняет plan и stage cursor. Model/filter/final
  dispatch получают `pipelineStageId`; filters больше не требуют новую вкладку.
- Auto/Manual теперь замораживается из preset или явного пользовательского
  override. Duel runner не читает живой UI между ходами.
- Добавлена UI-проекция текущего и следующего stage, включая видимый system
  round analysis. Целевая архитектура и оставшиеся этапы миграции записаны в
  `docs/disput-docs/D2_disput-architecture.md` и `docs/disput-docs/reports/D19_disput-next-steps.md` без дублирования specs.
- Проверка: plan/store/application/services/Duel/Triad/Multi suites и 40
  composed Debate page tests зелёные. Manifest/package metadata согласованы на
  `2.80.178`.

### 2026-07-11 — Gemini attachment continuation and safe send controls, version 2.80.177

- По логам запусков `All Logs 20260711_17-39.md` и
  `All Logs 20260711_17-53.md` устранён false negative Gemini: успешный
  trusted CDP file assignment теперь является подтверждением доставки, после
  чего prompt обязательно проверяется в заново найденном live composer до send.
- Qwen применяет запрет microphone/voice/stop/attachment ко всем путям поиска
  Send, включая общий `SelectorFinder`; ChatGPT исключает file/voice controls
  даже из generic submit-кандидатов.
- Нормативный attachment/send contract уточнён в
  `docs/model-tabs-architecture.md`; регрессионные тесты расширены.
- `manifest.json`, `package.json` и `package-lock.json` обновлены до
  `2.80.177`.

### 2026-07-11 — Debate transport alignment after 2.80.175 restore, version 2.80.176

- `docs/disput-docs/D2_disput-architecture.md` уточнён по фактическому коду после возврата к
  `2.80.175`: owner-документ теперь явно фиксирует strict tab reuse после
  init/opening wave, dispatch-time resolution `promptsByModel`, участие
  `GLOBAL_STATE_ANSWER_RECOVERY` в том же waiter path, что и live finals, и
  требование полного run/tab identity для recovery/collection replay.
- Проверка: сверены `disput/duel-runner.js`, `disput/triad-runner.js`,
  `disput/multi-runner.js`, `background/job-orchestrator.js` и `results.js`;
  версии `manifest.json`, `package.json` и `package-lock.json` подняты и
  согласованы на `2.80.176`.

### 2026-07-10 — Debate application orchestration extraction, version 2.80.175

- Вся Duel/Triad/Multi orchestration вынесена из `results.js` в
  `disput/debate-application.js`, topology runners и общие run services;
  `results.js` теперь формирует page dependencies и делегирует запуск через
  application API.
- `DebateRunStore` стал единственным владельцем protocol state;
  `window.__*State` переведены в read-only проекции, а abort/approval/locks
  принадлежат `DebateExecutionContext`.
- Round filters, registry checkpoints и exactly-once terminal outputs вынесены
  в `disput/debate-run-services.js`; source-based тесты перенаправлены на
  фактических владельцев.
- Новые модули подключены в обе HTML-точки входа и manifest; версия
  `manifest.json`, `package.json` и `package-lock.json` синхронизирована на
  `2.80.175`.
- Проверка: профильные runner/application/UI suites зелёные; полный suite —
  129/129 suites и 703/703 tests.

### 2026-07-10 — Extension reload state reset, version 2.80.174

- Исправлена гонка запуска: восстановление `jobState`/карты вкладок теперь
  ждёт ранней очистки состояния при обновлении расширения.
- Повторная регистрация главной страницы получает нормативный снимок состояния
  и очищает старые живые индикаторы и локальный вид диагностики при пустом
  запуске; исторические карточки диспута не затрагиваются.
- Контракт описан в `docs/model-tabs-architecture.md`; добавлен регрессионный
  тест `tests/extension-reload-reset.test.js`.
- `manifest.json`, `package.json` и `package-lock.json` обновлены до
  `2.80.174`.

### 2026-07-10 — Attachment dispatch contract and version metadata 2.80.173

- Исходный широкий сбой вложений зафиксирован в `All Logs 20260710_12-34.md`;
  его provider-specific симптомы сведены в единый attachment dispatch contract.
- `manifest.json`, `package.json` and `package-lock.json` updated to
  `2.80.173`.
- `docs/model-tabs-architecture.md` now records the attachment dispatch
  contract for main-page model tabs: baseline-backed attachment confirmation,
  single-dispatch stop rules, composer reacquire after rerender, Gemini
  background file materialization, and ChatGPT send gating on the enabled
  control plus pre-send user count.
- Проверка: сверены текущий код и документационная карта; ссылки и
  дублирование в docs не добавлялись.

### 2026-07-10 — Strict model-tab answer ownership and finality (no version bump)

- **Для чего:** исключить ложный terminal success, когда переиспользованная
  вкладка, позднее подтверждение старой попытки или broad DOM selector выдавали
  старый/неполный ответ за результат текущего prompt.
- **Dispatch identity:** submit waiters теперь адресуются по
  `model + dispatchId`; provider lifecycle/answer events обязаны совпадать с
  текущими `dispatchId`, `runSessionId` и bound tab. Late attempt, missing
  identity, sender без binding и stale-tab command помещаются в quarantine.
  Файлы: `background/dispatch-coordinator.js`, `background/message-router.js`,
  `shared/run-identity.js`.
- **Answer lifecycle:** старый assistant node больше не считается стартом по
  одной длине текста; completion требует fresh-turn evidence, а
  `LLM_RESPONSE_READY` переносит run/dispatch identity. Старые completion/copy/
  regenerate controls не закрывают новый turn; final stability стала
  обязательным gate. Файлы: `content-utils/response-lifecycle-detector.js`,
  `content-scripts/unified-answer-pipeline.js`,
  `content-scripts/unified-answer-watcher.js`.
- **Latest extraction:** automatic resolver и snapshot recovery выбирают
  последний eligible DOM-turn вместо самого длинного текста; answer cache не
  используется как доказательство latestness. Файлы:
  `content-utils/selector-resolver-v2.js`, `content-scripts/content-utils.js`,
  `background/job-orchestrator.js`.
- **Tab safety:** readiness требует завершённой navigation; global reuse и
  surface probe переведены в fail-closed, modal/draft/active generation
  запрещают attach, obsolete newly-created tab закрывается. Файл:
  `background/tab-manager.js`.
- **Документация:** нормативный контракт обновлён в
  `docs/model-tabs-architecture.md`; оставшаяся real-page приёмка записана в
  `docs/disput-docs/reports/D19_disput-next-steps.md`. Числовые timing budgets не менялись, поэтому
  `docs/timing-map.md` не дублирует это поведенческое изменение.
- **Проверка:** добавлены/обновлены regression tests для exact dispatch,
  sender binding, pre-existing answer, latest DOM turn, fail-closed reuse и tab
  session scope; полный suite — 121 suites / 682 tests green.

### 2026-07-10 — Version metadata synchronization 2.80.172

- `manifest.json`, `package.json` и корневой пакет `package-lock.json` теперь
  синхронизированы на `2.80.172`.
- Это исправляет рассинхронизацию, при которой manifest уже отражал релиз
  Debate round plans, а npm metadata оставалась на `2.80.171`.
- Проверка: JSON parsing всех трёх файлов и полный тестовый suite.

### 2026-07-10 — Debate documentation completion audit (no version bump)

- **Для чего:** занести оставшиеся изменения этой беседы без создания новых
  дублирующих разделов.
- **Изменение:** `docs/disput-docs/D2_disput-architecture.md` получил явную production module
  map с точными путями FSM, aggregate/projections, prompts/registry, UI,
  transport/export и background boundary.
- **Проверка:** сверены module paths с текущим кодом, документационные ссылки
  валидны; `release-log-regressions` — 31/31, полный suite — 120 suites / 676
  tests green.

### 2026-07-10 — Debate review follow-up and documentation consolidation (no version bump)

- **Для чего:** закрыть подтверждённые находки ревью Debate и сделать документацию
  однозначной для следующих исполнителей.
- **Архитектура:** добавлены/закреплены `DebateRunStore` с
  `PROTOCOL_STATE_SYNCED` и `protocolRevision`, единый protocol facade для
  Duel/Triad/Multi, отдельные transport/background handlers, projections,
  controller/renderer/sessions/export modules и `MultiFSM`.
- **Runtime:** Role/Action chips отделены от moderator prompt; Notes/JSON/HTML
  Output подключены к единому terminal flow всех topology; после `STARTING`
  ранние ошибки закрывают aggregate и background через `FAILED`/`CANCELLED`;
  успешные прогоны отправляют `COMPLETED`.
- **Безопасность и UI:** fallback `escapeHtml` теперь экранирует и сообщает о
  пропавшем shared helper; удалены inline CSP handler, глобальный `growTA`,
  дублирующие approval paths, устаревшие DOM references, Duel `routedTurnIds`;
  исправлен цвет Blue highlight.
- **Документация:** введён [D0_documentation-map.md](disput-docs/D0_documentation-map.md),
  создан корневой `README.md`, `docs/README.md` переименован в
  `docs/project-overview.md`, protocol specs и round-plan документ получили
  единый naming; старые release-срезы и Registry-приложение удалены из specs,
  устаревший `docs/stabilization/disput-consolidation-plan.md` удалён.
- **Проверка:** полный `npm test -- --runInBand --silent` — 120 suites / 676
  tests green; синтаксические и ссылочные проверки пройдены.

### 2026-07-10 — Main-page model tabs documentation consolidation (no version bump)

- **Для чего:** дать главной странице и model tabs такой же однозначный
  documentation owner, как у Debate.
- **Изменение:** `docs/tabs-and-selectors.md` переименован в
  `docs/model-tabs-architecture.md` и переписан как текущий контракт выбора
  моделей, `model → tabId` ownership, dispatch/focus locks, content-script
  boundary, correlation IDs и диагностики.
- **Документы:** `D0_documentation-map.md` и корневой `README.md` теперь ведут к
  новому owner-документу; `project-overview.md` оставляет только общий обзор и
  ссылки на selector guides.
- **Проверка:** проверены ссылки и старые имена документов; полный тестовый
  suite сохраняет 120 suites / 676 tests green.
- `docs/tab-run.md` удалён как устаревший дубль lifecycle/timing; числовые
  budgets принадлежат `docs/timing-map.md`, порядок работы вкладок —
  `docs/model-tabs-architecture.md`.

### 2026-07-10 — Debate round plans 2.80.172

- Built-in Debate presets now store an explicit `protocol.roundPlan` with the
  filter-artifacts for every wave.
- Duel Verdict and Triad Verdict use three rounds; Multi Verdict and every Red
  Team preset use four. Multi prompts receive the current wave's filter
  artifacts so the next wave works from the filtered result.
- **Final Synthesis** is a separate required terminal stage after the final
  Duel, Triad, or Multi round; missing synthesis is an error, not completion.
- R1 now has one meaning across topologies: Duel openings, Triad init and Multi
  initial parallel positions. Duel public-turn and Triad critique-wave limits
  count only R2–Rn.
- Multi Manual waits for continuation between stages and Final Synthesis uses
  every usable wave rather than only the last one.
- Added `docs/disput-docs/D11_debate-round-plans.md` as the canonical matrix and decision record.
- Version: `manifest.json` updated to `2.80.172`.

### 2026-07-09 — Verdict preset budget normalization 2.80.171

- Built-in presets now carry explicit `reasoningBudget` metadata:
  `class`, `critiqueDepth`, `synthesisPasses`, `checkpointPasses`,
  `finalVerdictPasses`, and `comparableSuffix`.
- `Duel Verdict`, `Triad Verdict`, and `Multi Verdict` are normalized to the
  same `standard` budget class. `Triad Verdict` no longer gets a hidden deeper
  default wave budget than the other Verdict topologies.
- Pipeline summaries and inspector modals show the reasoning budget, so topology
  (`duel` / `triad` / `multi`) is not silently conflated with deliberation
  depth.
- Tests: `tests/pipeline-presets.test.js` asserts Verdict budget parity.
- Version: `manifest.json`, `package.json`, `package-lock.json`,
  `docs/project-overview.md` updated to `2.80.171`.

### 2026-07-09 — Debate state ownership and Triad derived registry 2.80.170

- Duel runtime: `DebateFSM` now has immutable participant slots, separate
  opening/public turn accounting, an append-only event log, and an A0/B0 guard
  that prevents the public phase from starting until both openings exist.
- Duel orchestration: serial debate no longer seeds public turns from A0/B0.
  Public turn limit logic uses `turns.publicTurnsDispatched`, and Duel can carry
  an optional registry/checkpoint path without making C mandatory.
- Registry: the Triad registry is now a neutral debate registry core with
  `mode: 'duel' | 'triad'`, second-layer `derived` logs, route history, focus
  history, instruction burden, action-target diagnostics, logical-pattern logs,
  recurring weakness detection, and one-shot lazy context requests.
- Prompts: Duel public turns can receive compact registry context; Triad wave
  prompts can receive compact operational signals; checkpoint prompts now accept
  `recommendedFocus` and `contextRequests` in strict JSON.
- Debugging: runtime exports are available as `__exportDebateEventLog()`,
  `__exportDebateRegistry()`, and `__exportDebateDerivedLogs()`.
- Tests: focused Duel FSM, registry, Triad prompt, and Duel prompt tests pass.
- Version: `manifest.json`, `package.json`, `package-lock.json`,
  `docs/project-overview.md` updated to `2.80.170`.

### 2026-07-09 — Multi fixed flow pruning and stale UI cleanup 2.80.169

- Multi defaults: canonical `Multi Verdict` and `Multi Red Team` configs now
  build exactly one visible `R1 Models` pipeline with one empty unselected model
  slot. They no longer create hidden/leftover R2/R3 stacks in fixed Multi mode.
- Round controls: fixed Multi presets keep `debate-round-limit-select` hidden.
  Round selection remains limited to `Duel Long` and `Triad Long`; future Multi
  round selection belongs to the disabled `Multi Long — later` path.
- Pipeline layout: round pruning now removes only dynamic debate rounds and
  preserves the static `Final Synthesis` / `Output` connectors. This restores
  arrows and prevents invisible removed stages from affecting vertical
  centering.
- Geometry: connector SVG height is computed from visible stack children and
  rejects implausible hidden/jsdom measurements, so `Final Synthesis` and
  `Output` center against the real visible model blocks.
- Stale UI cleanup: selecting built-in Multi or changing header models clears
  old debate feed content after initialization and resets pipeline model status
  indicators.
- Tests: focused Debate preset/layout coverage and SVG sanitizer coverage pass.
- Version: `manifest.json`, `package.json`, `package-lock.json`, `docs/project-overview.md` updated
  to `2.80.169`.

### 2026-07-09 — Long round selector visibility fix 2.80.168

- Bugfix: `Duel Long` and `Triad Long` now show the round selector reliably.
  Preset detection no longer rejects the active pipeline item because the
  current scheme is temporarily stale during UI sync.
- UI sync: both the wrapper `.debate-select-wrap` and the
  `debate-round-limit-select` element are updated together, so the real visible
  control cannot remain hidden while tests only see the select state.
- Tests: Debate DOM fixture now includes the round selector wrapper and asserts
  wrapper visibility for `Duel Long` / `Triad Long`.
- Version: `manifest.json`, `package.json`, `package-lock.json` updated to
  `2.80.168`.

### 2026-07-09 — Canonical built-in presets and Long round flags 2.80.167

- Built-in preset storage: `Duel` / `Triad` / `Multi` built-ins are now resolved
  from canonical defaults plus explicit overrides. Old stored built-in config
  payloads no longer decide participant lists.
- Multi defaults: selecting built-in `Multi Verdict` or `Multi Red Team` always
  applies an empty participant list. Stale `protocol.selectedModels` values left
  in storage are ignored.
- Long rounds: `Duel Long` and `Triad Long` default to `infinite` after reload,
  so `.pipeline-flow` shows only `R1 Models`. A user-selected finite round count
  is stored as `pipelineStore.overrides.longRoundLimits[name]`, expands the flow,
  and restores on the next selection/reload. Choosing `∞` stores that flag and
  collapses the flow back to `R1 Models`.
- Compatibility: built-in Triad/Multi synthesizer choices are stored in the same
  override layer instead of mutating canonical built-in configs.
- Tests: updated coverage for stale Multi storage, visible Long round selector,
  default `∞`, finite round persistence, and `∞` collapse.
- Version: `manifest.json`, `package.json`, `package-lock.json` updated to
  `2.80.167`.

### 2026-07-09 — Stored preset migration and Long round persistence 2.80.166

- Migration fix: pipeline store version bumped to refresh old saved built-in
  `Multi Verdict` / `Multi Red Team` configs. Stale participant model lists are
  cleared, so selecting these presets opens with no participant models selected.
- Long round persistence: changes in `debate-round-limit-select` are now written
  back to the active `Duel Long` / `Triad Long` built-in config. `infinite`
  persists as `R1 Models`; finite values persist and restore the expanded
  `.pipeline-flow` round count.
- Tests: added coverage for stale built-in Multi migration and stored Long
  round-limit preservation.
- Version: `manifest.json`, `package.json`, `package-lock.json` updated to
  `2.80.166`.

### 2026-07-09 — Separate Multi synthesis and Long round flow 2.80.165

- Multi synthesis: `Multi Verdict` / `Multi Red Team` получили отдельный UI
  control `multi-final-synthesizer-select` и отдельный flow select
  `multi-final-synthesis-flow-select`. Multi больше не читает и не сохраняет
  `triadSynthesizer`; для Multi используется `protocol.multiSynthesizer`.
- Multi defaults: built-in `Multi Verdict` и `Multi Red Team` теперь
  открываются без выбранных participant-моделей. Пользователь явно выбирает
  минимум две модели перед запуском; Final Synthesis model выбирается отдельно.
- Long rounds: список количества раундов показывается только для `Duel Long` и
  `Triad Long`. Обычные `Duel` / `Triad` / `Multi` presets больше не показывают
  round selector и не выводят round count в summary.
- Long flow: `Duel Long` и `Triad Long` по умолчанию имеют `roundLimit:
  infinite`, поэтому `.pipeline-flow` показывает только `R1 Models`. При выборе
  конечного числа раундов flow расширяется до выбранного количества; при `∞`
  остаётся `R1`, а следующие стадии должны добавляться во время выполнения.
- UI extraction: добавлен `results/debate-ui.js` с чистыми решениями видимости
  Debate UI (`roundLimit`, `synthesisStage`, protocol synthesizer). `results.js`
  теперь использует этот helper вместо локального дублирования части UI-логики.
- Serial state cleanup: `window.__serialDebateState` оставлен как debug mirror,
  но больше не читается как источник истины. Канонический доступ идёт через
  локальный `serialDebateState` и `window.__getSerialDebateState()`.
- Bugfix: выбор built-in `Multi Verdict` / `Multi Red Team` очищает активную
  debate-ленту и transcript текущей вкладки, чтобы после reload не показывался
  старый контент от предыдущего сценария.
- Version: `manifest.json`, `package.json`, `package-lock.json` обновлены до
  `2.80.165`.

### 2026-07-08 — Multi Final Synthesis runtime 2.80.164

- Runtime: `Multi Verdict` и `Multi Red Team` больше не используют Duel runtime
  под видом `scheme: many`. Добавлены включённые preset ids `MULTI_STANDARD` и
  `MULTI_RED_TEAM`; оба имеют `topology: multi`, fixed wave limit и
  `auto_after_limit` finalization.
- Execution: добавлен отдельный Multi executor в `results.js`: все выбранные
  модели запускаются параллельными волнами, после последней валидные ответы
  собираются в отдельный prompt `Final Synthesis`, который отправляется выбранной
  модели-синтезатору. Ответ синтезатора добавляется как итоговая verdict-card.
  Минимум для запуска Multi — две выбранные модели.
- UI: колонка `Final Synthesis` теперь показывается для `scheme=many`, а не
  только для Triad. В info panel для Multi отображается выбранный synthesizer и
  runtime prompt финального синтеза.
- Compatibility: встроенные saved pipeline configs автоматически мигрируются,
  если в storage остались старые `Multi Verdict` / `Multi Red Team` с
  `presetId: DUEL_STANDARD` или неправильными `type/scheme`. Это устраняет
  ситуацию, когда после обновления UI выглядел прежним и запуск продолжал идти
  по старой serial-duel ветке.
- Docs: обновлены `README.md`, `docs/project-overview.md`, `docs/disput-docs/D8_duel-protocol.md` и
  `docs/disput-docs/D9_triad-protocol.md` с простым описанием Multi Final Synthesis.
- Version: `manifest.json`, `package.json`, `package-lock.json` синхронизированы
  на `2.80.164`.

### 2026-07-08 — Debate pipeline runtime presets and Long modes 2.80.163

- UI/Product: runtime presets добавлены как pipeline items в `.pipeline-items`,
  а не как dropdown. Список сгруппирован по 3 строки на колонку:
  `Duel Verdict`, `Duel Red Team`, `Duel Long`; `Triad Verdict`,
  `Triad Red Team`, `Triad Long`; `Multi Verdict`, `Multi Red Team`,
  `Multi Long — later`. `Multi Long` показан как отключённый experimental
  вариант и не запускается.
- UI correction: удалён ошибочный header dropdown `pipeline-preset-select`.
  Runtime preset теперь берётся из `protocol.presetId` активного item в
  `.pipeline-items` / `.customer-pipeline-items`; оба контейнера имеют click
  handling, а static HTML entrypoints показывают те же built-in items до
  JS-перерендера.
- Naming/layout correction: удалены generic items `Duel` и `Triad`, `Red Team
  Triad` переименован в `Triad Red Team`, добавлен `Multi Red Team`, CSS
  `.pipeline-items` переключён на `grid-template-rows: repeat(3, max-content)`.
- Runtime: добавлен config-only модуль `disput/pipeline-presets.js`.
  `normalizePipelinePreset()` возвращает замороженный runtime snapshot с
  `topology`, `duration`, `terminationOwner`, `finalizationPolicy`, лимитами,
  checkpoint policy и safety policy. Активный запуск читает `protocol.presetId`
  выбранного pipeline item и дальше не меняет snapshot во время работы.
- Duel/Triad Long: open-ended presets получают `turnLimit = null` /
  `waveLimit = null`, `terminationOwner = moderator`, `manual_only`
  finalization и checkpoint policy. `DebateFSM` и `TriadFSM` считают
  `null`-лимит бесконечным и не запускают auto-finalization по лимиту.
- UI/compat: `debate-round-limit-select` виден для fixed `Multi Verdict` и
  `Multi Red Team`, скрыт/disabled для built-in `Duel`/`Triad` и Long presets.
  Старые saved pipelines со схемой `2`/`3` больше не открывают этот selector;
  Long presets при этом не перетираются прямым переключением схемы.
- UI/compat: переключатель `Реестр` вынес из класса `triad-only` в отдельный
  `registry-capable`, поэтому он виден и для Triad, и для Multi modes; synthesis
  controls остаются только Triad.
- FSM: `DebateFSM` и `TriadFSM` получили поля preset/duration/termination,
  checkpoint/finalization policy, moderator pause/stop/finalization transitions
  и technical pause state. Triad дополнительно получил `completedWaves` и
  `shouldRunTriadCheckpoint()`.
- Entry points: `pipeline_panel.html` и `result_new.html` подключают
  `disput/pipeline-presets.js`; `manifest.json` добавляет его в
  `web_accessible_resources`.
- Проверки: `node --check results.js disput/pipeline-presets.js
  disput/debate-runtime.js disput/triad-runtime.js` passed; focused Jest
  `tests/pipeline-presets.test.js`, `tests/debate-runtime.test.js`,
  `tests/triad-runtime.test.js`, `tests/results-debate-favorites.test.js`
  — 4 suites / 72 tests passed.
- Версия `manifest.json` синхронизирована: 2.80.163.

### 2026-07-08 — Debate resilience, serial init hardening, and safe SVG 2.80.162

- MV3 recovery: при rehydrate persisted `jobState.session.roundsInProgress === true`
  больше не оставляет Debate в вечном busy-state. Оркестратор очищает stuck-флаг,
  пишет `roundsRecoveredFromStuckAt`/`clearedRoundsInProgress` и переармит hard-stop
  таймеры для уже подтверждённых prompt'ов после cold start service worker.
- Storage cleanup: `CLEAR_ALL_SESSIONS` теперь удаляет не только UI-сессии, но и
  persisted `jobState`, поэтому новый запуск не наследует старый background state.
- Serial Debate: auto routing переведён с async-рекурсии на явный loop/runner.
  Manual routing больше не меняет `modelA`/`modelB`: target является решением
  маршрутизации текущего хода, а не переопределением личности сторон.
- Serial opening: A0 и тихая B0-инициализация запускаются одним batch через
  `promptsByModel`, сохраняя изоляцию B0, но убирая лишний последовательный старт.
- Auto Debate: если публичный ход вернул пустой/error/exception, Auto делает один
  retry, затем ставит run на паузу с `pendingAutoContinuation`, а не silently
  переводит сценарий в error при первом сбое.
- State/schema guard: добавлен `shared/debate-schema.js`; страница валидирует форму
  serial-state в log-only режиме и предупреждает о некорректном runtime state без
  падения UI.
- Security: `setSvgContent` теперь дополнительно чистит SVG от script/foreignObject/
  iframe/object/embed, inline event handlers и `javascript:`/`data:text/html` attrs.
- Tests: добавлены/обновлены `tests/clear-all-sessions-persistence.test.js`,
  `tests/results-serial-routing-source.test.js`, `tests/debate-schema.test.js`,
  `tests/mv3-reconcile.test.js`, `tests/dom-utils.test.js`,
  `tests/results-debate-favorites.test.js`.
- Targeted verification: `npm test -- --runTestsByPath tests/mv3-reconcile.test.js tests/clear-all-sessions-persistence.test.js tests/dom-utils.test.js tests/results-serial-routing-source.test.js tests/debate-runtime.test.js tests/debate-schema.test.js tests/prompts-by-model.test.js tests/results-debate-favorites.test.js` — 8 suites / 82 tests passed.
- Версия `manifest.json` синхронизирована: 2.80.162.

### 2026-07-08 — Debate Multi Verdict preset and round-limit visibility 2.80.161

- UI/Product: в список встроенных Debate pipeline presets добавлен `Multi Verdict`.
  Этот сценарий использует схему `many`, автоматически выбирает все доступные
  модели и позволяет пользователю вручную оставить любое количество моделей
  от двух до полного списка.
- UX fix: `many` больше не нормализуется обратно в `2`; ранний обработчик
  кликов по model header тоже понимает `many`, поэтому выключение одной модели
  в `Multi Verdict` не схлопывает выбор до двух.
- UX fix: `debate-round-limit-select` теперь виден только для `Multi Verdict`.
  Для двух- и трёхмодельных встроенных шаблонов (`Duel`, `Triad`) список
  лимита раундов скрыт; выбор/снятие моделей в `Multi Verdict` больше не
  прячет этот контрол.
- Builder: `New pipeline` получил вариант схемы `Multi Verdict`; в нём можно
  выбрать от 2 до всех доступных моделей, в отличие от `2 LLM`/`3 LLM`, где
  требуется ровно 2 или ровно 3 модели.
- Tests: targeted `npx jest --config tests/jest.config.js tests/results-debate-favorites.test.js --runInBand` — 36 passed.
- Версия `manifest.json` синхронизирована: 2.80.161.

### 2026-07-06 — Main and Debate model selection isolated 2.80.160

- **Page-local selection:** выбор кнопок моделей на главной странице и на Debate/Pipeline странице больше не пишет в общий snapshot. У каждой страницы теперь своё локальное состояние выбора.
- **Navigation preserved:** кнопка перехода на Debate (`.sidebar-toggle-icon-branch-v3`) остаётся рабочей и больше не конфликтует с логикой сохранения выбора моделей.
- **Pipeline restore guard:** сохранённый `protocol.selectedModels` теперь применяется только на `pipeline_panel.html`, поэтому открытие pipeline не перетирает выбор на главной странице.
- Версия `manifest.json` синхронизирована: 2.80.160.

### 2026-07-05 — Triad debate registry: artifacts + triggers 2.80.158

- Feature: 3-модельный Triad получил опциональный **реестр диспута** (артефакты
  и триггеры). Трёхслойная модель по ТЗ (`artefact.txt`): event log (сырые ходы,
  неизменяемый источник истины) → artifact registry (рабочее состояние) →
  checkpoint-дельта модели-анализатора C (предложение, не истина). Оркестратор
  (код) валидирует каждую дельту по event log и применяет только проверяемое.
- Новый чистый модуль `disput/triad-registry.js`: 5 MVP-артефактов (Open Issues,
  Claim Ledger, Terminology Ledger, PendingActions, Protocol Violations),
  верификация якорной цитаты (дельта/триггер отклоняются, если цитата не найдена
  дословно в указанной реплике → Protocol Violation), каталог из 10 триггеров с
  фиксированным приоритетом, cooldown по (triggerId, target), архивация (лимит 20
  Open Issues), `serializeForPromptModel` (гибридный контекст: активные артефакты
  = id+status+anchor, + один primary-триггер на модель).
- `disput/triad-massage.js`: `buildTriadCheckpointPrompt` (строгий JSON-запрос к
  C), `parseTriadCheckpointOutput` (устойчивый разбор, не бросает исключений),
  и опциональные секции `registryContext` / `primaryTrigger` в
  `buildTriadWavePrompt` (обратно совместимо — без аргументов рендер прежний).
- `results.js`: интеграция в оркестрацию волн. Роль C исполняет уже выбранный
  Triad-синтезатор; checkpoint запускается после каждой волны в ИЗОЛИРОВАННОЙ
  вкладке (`forceNewTabs: true`), чтобы не засорять контекст участника-синтезатора.
  Состояние реестра инъектируется в промпт следующей волны (активные артефакты +
  primary-триггер на модель). Полностью degrade-safe: любой сбой checkpoint
  (нет ответа/не разобран/ошибка) оставляет реестр как есть и волна идёт как в
  базовом Triad.
- UI: опт-ин переключатель `Реестр` (`triad-registry-checkbox`, класс `triad-only`,
  виден только в схеме «3») в шапке debate, выключен по умолчанию, сохраняется в
  `chrome.storage.local` (`llmCodexTriadRegistry.v1`), блокируется на время
  активного прогона. Выключен → базовый Triad не изменён байт-в-байт.
- Инвариант: участники по-прежнему пишут свободным текстом; JSON парсится ТОЛЬКО
  из ответа checkpoint-модели C, не из реплик участников.
- Тесты: новый `tests/triad-registry.test.js` + расширен `tests/triad-massage.test.js`
  (30 новых тестов, все зелёные). Полный `npm test`: 601 passed, 1 failed —
  падение `results-debate-favorites.test.js` («Final synthesis round») существовало
  ДО этой правки (не относится к реестру; results.js в этой части не менялся).
- Версии: 2.80.157 → 2.80.158 (`manifest.json`, `package.json`,
  `package-lock.json`, `docs/project-overview.md` «Current version» + строка простым языком).

### 2026-07-04 — User pipelines split out from built-in presets 2.80.157

- UI/Product: нижний список `Pipelines` разделён на встроенные presets и
  пользовательские сценарии. Встроенные пресеты живут сверху в `pipeline-items`,
  не имеют кнопки удаления и остаются фиксированными.
- UX: пользовательские pipeline показываются в `customer-pipeline-items` ниже
  разделительной линии; у них есть удаление и `📝`-документ, а в панели
  появляется кнопка `+` для добавления нового раунда после создания custom
  pipeline.
- Builder: `New pipeline` теперь задаёт схему `2..N LLM`, оставляет
  `Synthesizer` пустым по умолчанию и не предлагает редактировать prompt
  templates в модальном окне; шаблоны редактируются уже в canvas.
- Pipeline flow: финальный `Synthesis`-раунд Triad теперь оформлен как обычный
  последний stage, без подписи `Final synthesis`, с центральным выравниванием и
  обычными стрелками.
- Тесты: targeted `npx jest tests/results-debate-favorites.test.js tests/release-log-regressions.test.js --runInBand` — green.
- Версии: 2.80.156 → 2.80.157.

### 2026-07-04 — Triad scheme now comes from saved pipeline 2.80.156

- UI/Product: removed the separate `2 LLM` / `3 LLM` switch from the top bar. The active saved pipeline, or the guided `New pipeline` flow, now carries the scheme state instead.
- UX: `pipeline-flow` still renders the right number of slots for the current scheme, but the mode is no longer edited from the header.
- Pipeline info: saved pipeline presets continue to restore `2 LLM` or `3 LLM`, Auto/Manual, models, synthesizer, and round limits when selected.
- Versions: 2.80.155 → 2.80.156.

### 2026-07-04 — Triad synthesis round becomes a visible final stage 2.80.155

- UI/Product: Triad now shows an explicit final `Synthesis` round in the `pipeline-flow`. The final block contains a model picker with the full available model list, so the synthesizer can be chosen even if that model is not part of the current wave.
- UX: the selected synthesizer is highlighted in green in the flow, the final synthesis block reflects the current model, and the saved pipeline keeps that choice. Double-click on any model block still works as a shortcut for the same selection.
- Pipeline info: saved pipeline summaries and the pipeline document now describe the final synthesis round explicitly instead of treating synthesis as a hidden tail step.
- Builder: `New pipeline` keeps the guided creator, and its synthesizer picker now offers the full model list instead of only the models currently selected for the flow.
- Тесты: targeted `npx jest tests/results-debate-favorites.test.js --runInBand` to be run after the implementation verification step.
- Версии: 2.80.154 → 2.80.155.

### 2026-07-03 — Runnable built-in Pipeline presets 2.80.154

- UI/Product: примерные pipeline `Research & Analysis`, `Content Gen`, `Idea Validation` заменяются реальными runnable-пресетами при пустом/демо-хранилище: `Duel Verdict`, `Duel Red Team`, `Triad Verdict`, `Triad Red Team`.
- UX: выбор saved pipeline сразу восстанавливает режим `2/3 LLM`, Auto/Manual, лимит, выбранные модели, синтезатора и число стадий в `.pipeline-flow`; вся схема до запуска отображается приглушённой, активный цвет получает только текущая стадия runtime.
- Custom pipelines: prompt selector в R2/R3/... сохранён для пользовательских pipeline; встроенные Triad-пресеты используют зашитые prompt-шаблоны протокола.
- Тесты: targeted `npx jest tests/results-debate-favorites.test.js tests/release-log-regressions.test.js --runInBand` — green.
- Версии: 2.80.153 → 2.80.154.

### 2026-07-03 — Header LLM-count selector + pipeline slots 2.80.153

- UI: селектор схемы переименован из `N моделей` в `N LLM` и перенесён в правую группу управления между `Auto` и `New pages`.
- UX: выбор `2 LLM` / `3 LLM` ограничивает количество активных моделей в `.models-row-header`; лишняя выбранная модель автоматически снимается.
- Pipeline panel: `.pipeline-flow` теперь показывает ровно 2 или 3 model-slot'а; незаполненные места отображаются как неактивные пустые блоки и не попадают в сохранённый pipeline как реальные модели.
- Тесты: targeted `npx jest tests/results-debate-favorites.test.js tests/release-log-regressions.test.js --runInBand` — green.
- Версии: 2.80.152 → 2.80.153.

### 2026-07-03 — Saved Pipeline protocol presets 2.80.152

- Для чего: перевести Triad/Duel из отдельной идеи в сохраняемый продуктовый preset. Изменение: `capturePipelineConfig()` теперь сохраняет `protocol` (`duel/triad`, scheme, Auto/Manual, length, round limit, max turns, Triad synthesizer, selected models), а `applyPipelineConfig()` восстанавливает эти настройки при выборе pipeline.
- Для чего: сделать нижний список pipeline реальной точкой входа. Изменение: элементы списка показывают бейдж `Duel`, `Triad`, `· Auto`, чтобы пользователь видел runnable-схему до запуска, а экспорт/import pipeline переносит protocol вместе с конфигом раундов.
- Тесты: добавлен regression-контракт на `snapshot.config.protocol`; targeted `npx jest tests/results-debate-favorites.test.js tests/release-log-regressions.test.js --runInBand` — green.
- Версии: 2.80.151 → 2.80.152. Реальный smoke-run с внешними LLM-вкладками всё ещё нужен для проверки end-to-end выбора saved Triad pipeline.

### 2026-07-03 — Verdict artifact + live protocol stage panel 2.80.151

- Для чего: превратить конец Debate/Triad из просто ленты процесса в отдельный продуктовый артефакт. Изменение: добавлен `appendVerdictFeedEntry()`; serial moderator summary теперь создаёт карточку `Verdict`, а Triad synthesis пишет итог в такую же approved-карточку с `data-verdict="true"`. Карточка наследует copy/export/favorite/delete без отдельного export-пути.
- Для чего: сделать pipeline panel пультом, а не статичной схемой. Изменение: `syncPipelineFlowVisualState()` теперь читает активный serial/Triad runtime и ставит `pipeline-stage-current/past/future` по реальной стадии: init/R1, public wave/R2, final/synthesis/Output. На panel пишутся `data-pipeline-active-stage` и `data-pipeline-active-round-id`.
- UI: добавлены scoped-стили для текущей стадии pipeline и лёгкий visual accent для Verdict-card.
- Тесты: targeted `npx jest tests/results-debate-favorites.test.js tests/release-log-regressions.test.js --runInBand` — green.
- Версии: 2.80.150 → 2.80.151. Реальный smoke-run с внешними LLM-вкладками всё ещё нужен для проверки provider orchestration.

### 2026-07-03 — Triad orchestration: waves, final words, synthesis 2.80.150

- Для чего: включить схему `3 модели` на Debate странице. Изменение: `results.js` получил отдельный `triadState`, ветку старта `getDebateScheme() === '3'`, init-волну с изолированными per-model prompt'ами, публичные волны критики через один batch с `promptsByModel`, Manual barrier по approval всех трёх карточек, Auto barrier по терминальности ответов, финальные слова и optional synthesis.
- Для чего: переиспользовать существующую инфраструктуру без поломки serial. Изменение: Triad использует `runModelBatch`, `pipelineWaiter`, debate cards, approval checkbox, timeline, attachments только на init-волну, LONG generation profile, те же pause/cancel/finalize UI-шаги. Serial `DebateFSM` и `disput/disput-massage.js` не менялись; общий approval hook дополнен вторым независимым `routeApprovedTriadTurn`.
- Для чего: подключить runtime/templates в UI. Изменение: `pipeline_panel.html` и `result_new.html` грузят `disput/triad-runtime.js` и `disput/triad-massage.js` рядом с serial disput-модулями.
- Тесты: targeted `npx jest tests/results-debate-favorites.test.js tests/triad-runtime.test.js tests/triad-massage.test.js tests/prompts-by-model.test.js --runInBand` — green.
- Версии: 2.80.149 → 2.80.150. Требуется ручной smoke-run Triad по `docs/disput-docs/D9_triad-protocol.md` §13 на реальных вкладках моделей.

### 2026-07-03 — Triad UI: scheme and synthesizer selectors 2.80.149

- Для чего: открыть на Debate странице выбор схемы без изменения текущего поведения по умолчанию. Изменение: в `pipeline_panel.html` добавлен `debate-scheme-select` со значениями `2`, `3`, disabled `many`; добавлен скрытый `triad-synthesizer-select`, который показывается только при схеме `3`.
- Для чего: подготовить UI к синтезу итогов Triad. Изменение: `results.js` заполняет синтезатор из списка header-моделей, по умолчанию выбирает Claude при наличии, сохраняет схему в `chrome.storage.local` по ключу `llmCodexDebateScheme.v1`, восстанавливает её при загрузке и блокирует схему/синтезатор на время активного run.
- Для чего: не задеть legacy prompt suffix. Изменение: `debate-mode-select` не переиспользовался; новый UI использует только `debate-scheme-select`.
- Тесты: targeted `npx jest tests/results-debate-favorites.test.js tests/model-selection-toolbar.test.js --runInBand` — green.
- Версии: 2.80.148 → 2.80.149. Для пользователя схема `2 модели` остаётся дефолтом; схема `3 модели` пока только выбирается в UI, оркестрация идёт следующим срезом.

### 2026-07-03 — Triad: чистые FSM и prompt-шаблоны 2.80.148

- Для чего: вынести протокол Triad в тестируемые чистые модули до интеграции в большой `results.js`. Изменение: добавлен `disput/triad-runtime.js` с состоянием трёх участников, init-гейтом, wave barrier helpers, лимитом волн и статусными переходами. Serial `DebateFSM` не менялся.
- Для чего: закрепить изоляцию первой волны. Изменение: добавлен `disput/triad-massage.js` с шаблонами init/public wave/final/synthesis; init-шаблон не принимает opponents и не содержит имён или текстов других участников.
- Тесты: новые `tests/triad-runtime.test.js` и `tests/triad-massage.test.js`; targeted `npx jest tests/triad-runtime.test.js tests/triad-massage.test.js --runInBand` — green.
- Версии: 2.80.147 → 2.80.148. Для пользователя поведение страницы ещё не меняется: UI и оркестрация Triad будут подключены следующими срезами.

### 2026-07-03 — Triad transport: promptsByModel 2.80.147

- Для чего: подготовить волновой режим Triad и будущий graph-mode транспорт. Изменение: `START_FULLPAGE_PROCESS` получил опциональную карту `promptsByModel`, `runModelBatch` санитизирует её через `TransportPolicy`, background сохраняет карту в `jobState.session`, а `startModelForLLM` перед API/Web UI отправкой выбирает индивидуальный prompt модели с общим `prompt` как fallback. Файлы: `shared/transport-policy.js`, `results.js`, `background/message-router.js`, `background/job-orchestrator.js`.
- API fallback отдельной ветки не потребовал: он получает уже разрешённый prompt из `startModelForLLM`, поэтому та же подмена покрывает web UI, API direct и retry-путь.
- UI-страницы подключают `shared/transport-policy.js`, чтобы page-context `runModelBatch` мог использовать тот же резолвер, что и background. Файлы: `pipeline_panel.html`, `result_new.html`.
- Тесты: новый `tests/prompts-by-model.test.js`; targeted `npx jest tests/prompts-by-model.test.js tests/transport-policy.test.js --runInBand` — green.
- Версии: 2.80.146 → 2.80.147. Для пользователя обычные запуски без `promptsByModel` не меняются.

### 2026-07-03 — ТЗ режима «3 модели» (Triad) для страницы Debate (док-срез, без version bump)

- Новый документ `docs/disput-docs/D9_triad-protocol.md`: полное ТЗ волнового режима трёх моделей.
  Селектор схемы 2/3/>3 (`debate-scheme-select` — легаси-id `debate-mode-select` занят
  суффиксом промпта в results.js:3513 и не переиспользуется), протокол: изолированная
  init-волна → волны перекрёстной критики (один batch на 3 модели с картой «модель→промпт»)
  → финальные слова → синтез выбранной моделью. Manual = барьер утверждения всех 3 карточек
  волны, Auto = барьер терминальности.
- ТЗ самодостаточно для более слабой модели-исполнителя: нормативные реализации
  `disput/triad-runtime.js` (FSM), `disput/triad-massage.js` (промпты, пин изоляции init),
  резолвера `promptsByModel` в `shared/transport-policy.js`; интеграция в results.js/фон —
  по строковым якорям; 4 релизных среза (2.80.147–150), тесты и ручная приёмка по этапам.
- Этап 1 ТЗ (карта «модель→промпт» в payload `START_FULLPAGE_PROCESS`, подмена в
  `startModelForLLM`) — реализует транспортную предпосылку граф-режима из
  `docs/graph-mode/AUDIT_REPORT.md` §2.2; run-guard остаётся односессионным.

### 2026-07-03 — Graph Mode: аудит §7 брифа + расцепление транспорта 2.80.146

- **Аудит расцепления (бриф §7.1)**: фоновый слой (tab-manager, dispatch-coordinator, job-orchestrator, message-router) подтверждённо не знает про Speaker/роли/очерёдность — граф-режим может строиться на текущем транспорте. Два найденных зацепления устранены: (1) мёртвые `importScripts` `disput/disput-massage.js` + `disput/debate-engine.js` убраны из `background/index.js` (потребители — только страницы UI; наследие удалённого теневого executor'а), пин в `tests/release-log-regressions.test.js` перевёрнут — теперь фон **не должен** грузить disput-модули; (2) вшитый LONG-профиль в `runModelBatch` заменён параметром `generationProfile` (`'long' | 'inherit'`, дефолт `'long'` — поведение диспута не изменилось, тест `debate-forces-long-profile` зелёный).
- **Ревизия run-guard (§7.2)**: диагноз брифа подтверждён — один boolean на один глобальный `jobState`. Рекомендация против semaphore-пула: промпт течёт per-model (`startModelForLLM`), поэтому волна графа ≤3 операций выражается ОДНИМ batch с картой «модель→промпт» (дешёвое изменение payload), run-guard остаётся односессионным. Ограничения зафиксированы в отчёте.
- **Gate 3 по логам (§7.3)**: прямых данных о JSON-валидности в логах НЕТ (расширение никогда не парсило JSON из ответов моделей) — порог ≥70–75% измерим только на ручном прогоне. Извлечён транспортный прокси по 6 экспортам (~4700 событий): надёжное ядро GPT/Claude/DeepSeek (7–10% warn+err), рисковые Gemini 40% / Qwen 32% / Le Chat 24% / Grok 19% — в первую волну пускать, в структурные операции по замеру.
- **Комплект Gate 0 (§7.4)**: `docs/graph-mode/gate0/` — `node.schema.json` (анонимность и traceability исполняются схемой: нет поля автора, anchor обязателен, `additionalProperties:false`), `node-templates.json` (10 заготовок), промпты 4 операций (DECOMPOSE/ATTACK/REPAIR/COMPRESS с R4/A5/C1–C3/провокацией), `attack-wave-check.js` — скрипт замера Gate 3 + доли дублей по волне (Jaccard слова+шинглы, A1-проверка anchor-цитат; проверен на синтетической волне, ловит перефраз). Протокол ручного прогона: `docs/graph-mode/README.md`.
- Полный отчёт: `docs/graph-mode/AUDIT_REPORT.md`; бриф вложен как `docs/graph-mode/GRAPH_MODE_BRIEF.md`. Тесты: полный `npm test` — 99 suites / 550 tests green.
- Версии: 2.80.145 → 2.80.146. Для пользователя поведение не меняется (расцепление внутреннее); Debate по-прежнему всегда ждёт длинные ответы.

### 2026-07-02 — Smoke-run 2.80.144 validation + causal pins 2.80.145 (по реальному прогону `1782997990116`, экспорт `All Logs 20260702_15-16.md`)

- **Smoke-run подтвердил все срезы A–D и timing-план**: LONG-прогон, 8 моделей, run complete; ни одного `SCRIPT_RUNTIME_HARD_STOP` (лестница 2.80.142 ✅); ни одного `verification skipped (batch timeout)`/`ROUND2_CUTOFF` (батч-формула 2.80.144 ✅ — впервые за всю историю логов); ни одного `VISIT_QUOTA_BACKOFF` (квота 20s ✅ — тоже впервые); `UNSAFE_REUSE_SKIPPED` ×2 (preflight 2.80.140 реально пропустил занятые вкладки); `FINALIZE_BLOCKED_SUBMIT_PENDING` ×1 (pre-send gate 2.80.136 предотвратил финализацию до отправки в живом прогоне); `STALE_BASELINE_ANSWER_IGNORED` ×2 (guards отбили старые ответы в reused-вкладках).
- **Z.ai `EXTERNAL_LLM_FAILURE` — честный итог, не дефект**: провайдер вернул error surface (17 chars), materialize recovery нашёл на странице только ответ прошлого хода (3290 chars) и корректно отверг его по baseline. Требуется просто ретрай модели.
- **Дефект экспорта (исправлен): причинные события вытеснены шумом.** В экспорте (632 события) сработавшие guards видны, но `DISPATCH_BASELINE_CAPTURED` (несёт `anchorAnswerCount` из F6.2) вытеснен из буфера — по экспорту нельзя показать, откуда у guard'а baseline. Изменение: one-shot причинные labels добавлены в оба pinned-набора (`TRANSPORT_DECISION`, `PROMPT_SUBMITTED_*`, `PAGE_READY_BLOCKED`, `DISPATCH_BASELINE_CAPTURED`, `UNSAFE_REUSE_SKIPPED`, `FINALIZE_BLOCKED_SUBMIT_PENDING`, `SENDER_TAB_MISMATCH_REJECTED`, `STALE_SNAPSHOT_SIGNATURE_EXCLUDED`, `TAB_CREATE_FAILED`); экспортированы `isPinnedTelemetryEvent`/`trimDiagnosticsBuffer` для тестов. Файлы: `background/telemetry-logs.js`, `background/message-router.js`.
- **Наблюдение (follow-up, не фикс)**: post-terminal осцилляция detector'а у Z.ai (`ANSWER_GENERATING` 3290↔82 каждые ~3s, 20 событий за 30s) — lifecycle-detector position-blind и мечется между узлом старого ответа и новым мелким узлом; F6.2-якорь на detector пока не распространён. Зафиксировано в roadmap (Трек 1/anchor). Фильтровать эти события нельзя: после terminal failure поздний рост текста — потенциальный сигнал для recovered-upgrade.
- Тесты: новый `tests/pinned-telemetry-labels.test.js` (behavioral trim под флудом 700 noise-событий + parity обоих наборов). Полный `npm test` — 99 suites / 550 tests green.
- Версии: 2.80.144 → 2.80.145.

### 2026-07-02 — Timing map refresh (объединённый timing-план, срез 4, без version bump)

- `docs/timing-map.md` обновлён: шапка «Актуальность 2.80.144» с профильной лестницей short/long и списком изменений 2.80.142–144; исправлено устаревшее описание `TAB_READY_TIMEOUT_MS`. Инварианты лестницы закреплены `tests/timing-ladder.test.js` (12 tests) — док больше не может молча разъехаться с кодом. Полный аудит: `docs/timing-review-2026-07-02.md`.

### 2026-07-02 — Batch/quota scaling + knob consolidation 2.80.144 (объединённый timing-план, срез 3)

- **ROUND2-бюджет от числа моделей**: `getRound2BatchBudgetMs(N) = max(45s, N×8s)` — фиксированные 45s не вмещали 9×~7s, и хвост из 3-4 моделей в каждом полном прогоне терял Round2-верификацию (`verification skipped (batch timeout)`). Файл: `background/job-orchestrator.js`.
- **Квота визитов 12s → 20s** на окно 60s (T5): план визитов (round2 2×5–8s + round3 precollect + post-R2 + materialize) требовал 20–30s/мин против квоты 12s — запланированные визиты блокировали друг друга (`VISIT_QUOTA_BACKOFF` в каждом реальном прогоне). Файл: `background/human-presence.js`.
- **Одно определение стабильности (T3)**: `STABLE_PENDING_AUTO_FINALIZE_MS = DEFER_STREAM_STABLE_FORCE_MS` (30s) — 15-секундный auto-finalize больше не подрезает 30-секундное правило stable-force для того же pending-ответа.
- **Submit-timeout — единственный источник (T2)**: legacy-карта `PROMPT_SUBMIT_TIMEOUTS_MS` удалена из dispatch-coordinator (расходившийся дубль ModelPolicy), мёртвый фолбэк `getTiming(..., 7000)` заменён на честный 15000, `config/timing.js` default выровнен 20000 → 15000 (фактически действовавшее значение ModelPolicy). Файлы: `background/dispatch-coordinator.js`, `config/timing.js`.
- **Пороги длины вернулись в policy (T8)**: `earlyGuardForceSuccessChars: 1800`, `minPartialChars: 120`, `manualLatestMinChars: 20` теперь в `shared/answer-length-policy.js`; orchestrator читает их оттуда с literal-фолбэками (паттерн 2.74.98). Файлы: `shared/answer-length-policy.js`, `background/job-orchestrator.js`.
- Тесты: +5 guards в `tests/timing-ladder.test.js` (формула батча; квота ≥ 20s; равенство порогов стабильности; single-source submit-timeout; пороги в policy); обновлены пины в `tests/early-terminal-guard.test.js` (backdate 20s→35s под новый порог 30s) и `tests/manual-latest-recovery.test.js`. Полный `npm test` — 98 suites / 548 tests green.
- Версии: 2.80.143 → 2.80.144. Поведенческое следствие для smoke-run: stable-pending финализация наступает на ~15s позже прежнего (30s стабильности вместо 15s) — сознательный трейд скорости на корректность.

### 2026-07-02 — Dispatch tuning 2.80.143 (объединённый timing-план, срез 2)

- **Убраны zero-delay retry** (усилитель гонок dispatch): `DISPATCH_RETRY_BACKOFF_MS` `[0,800,3000,8000]` → `[500,800,3000,8000]`; `CONSERVATIVE_RETRY_BACKOFF_MS` `[0,2500,5000,9000]` → `[2000,2500,5000,9000]` — «консервативный» бэкофф, начинавшийся с 0ms, был оксюмороном. Файл: `background/dispatch-coordinator.js`.
- **Perplexity `promptSubmitTimeoutMs` 8s → 12s** — 8s агрессивен и давал ложные submit-retry на медленной загрузке. Файл: `shared/model-policy.js`.
- **Reload-путь вкладки ждёт дольше**: `TAB_READY_RELOAD_TIMEOUT_MS = 25s` для reload discarded/тяжёлой SPA-вкладки (warm-проверки остаются на 15s). Файл: `background/tab-manager.js`.
- **No-focus probe 5s → 3s**, `focusRestoreMaxMs` 8s → 5s — probe не должен долго блокировать отправку. Файл: `config/timing.js`.
- Тесты: guards в `tests/timing-ladder.test.js` (нет retry < 500ms; reload-таймаут > warm), обновлены пины в `tests/model-policy.test.js`. Полный `npm test` — 98 suites / 541+2 tests green.
- Версии: 2.80.142 → 2.80.143. Источник: объединённый план двух timing-review (пункты 2 и 4).

### 2026-07-02 — Profiled timeout ladder 2.80.142 (объединённый timing-план, срез 1)

- **LONG-профиль теперь доходит до background.** `longGenerationMode` читается в `shared-state.js` (hydrate + storage.onChanged), `isLongGenerationProfile()`/`profiledTimeoutMs()` доступны всем background-модулям. Ранее профиль масштабировал только content-потолки (450s hardMax), а фиксированный `SCRIPT_RUNTIME_HARD_STOP=180s` убивал длинные генерации (GPT-кейс из `1782944449199`).
- **Лестница таймаутов short/long**: hard stop 180s → **210s/480s** (content hardMax + margin); defer max 180s → **180s/460s**; round4 gate 190s → **230s/500s** (hard stop + 20s, закрывается ПОСЛЕ hard stop); adaptive probes window 180s → **270s/540s** (recovery переживает hard stop — закрывает тройное одновременное истечение t=180s из лога DeepSeek); baseline-guard window 120s → **240s/510s** (guard живёт всю легальную генерацию — раньше отключался со 2-й минуты). Все потребители переведены на профильные getters. Файлы: `background/shared-state.js`, `background/dispatch-coordinator.js`, `background/job-orchestrator.js`.
- Тесты: новый `tests/timing-ladder.test.js` — числовые инварианты лестницы в обоих профилях (deferMax < hardStop > contentHardMax, gate > hardStop, probes > hardStop, baseline > generation; long > short по всем уровням), проверка что потребители используют getters, behavioral VM-тест переключения профиля через storage.onChanged. Обновлены `tests/round4-gate.test.js` (advance 195s→235s) и `tests/dispatch-baseline-stale-guard.test.js` (профильный getter). Полный `npm test` — 98 suites / 541 tests green.
- Версии: 2.80.141 → 2.80.142.
- ВАЖНО: это изменение тайм-бюджета всего прогона — требуется smoke-run в LONG-режиме с заведомо длинным ответом (ожидаем: нет `SCRIPT_RUNTIME_HARD_STOP` на живой генерации до ~8 минут; `ROUND4_GATE_WAIT` продолжается после 190s). Примечание: профиль применяется к таймеру hard stop в момент arm'а — смена профиля посреди активного dispatch не переармирует уже взведённые таймеры.

### 2026-07-02 — Big-tracks roadmap + replay fixtures (Phase E глобального review, без version bump)

- Документирован пошаговый план четырёх больших треков в `docs/stabilization/big-tracks-roadmap-2026-07-02.md`: (1) content runtime unification 9→1 (порядок миграции по моделям, гейты smoke-run, приоритетный подшаг «Claude paste-first» против 40s окна гонок), (2) финализация как единый редьюсер через shadow mode, (3) fetch-monitor как network-источник generation lifecycle (shadow → per-model primary), (4) full-loop replay-тесты.
- Реализован первый шаг трека 4: каталог `tests/replay-fixtures/` (внутрь положен реальный дефектный экспорт run `1781134505984`), в `tests/log-replay-harness.test.js` добавлен replay-тест: фикстура не даёт ни одного terminal outcome и корректно флагуется как `export_during_active_run`. Каждый будущий проблемный экспорт добавляется туда же. Полный `npm test` — 97 suites / 536 tests green.
- Код расширения не менялся — version bump не требуется (остаётся 2.80.141).

### 2026-07-02 — CSP-safe main-world bridge 2.80.141 (Phase D глобального review)

- **Bridge инжектился inline-скриптом под CSP страницы (P1 из cross-review).** Провайдер, ужесточивший `script-src`, молча ломает trusted events и вложения. Изменение: приоритетный CSP-safe путь — content-bootstrap отправляет `BRIDGE_INJECT_REQUEST`, background инжектит `content-scripts/content-bridge.js` через `chrome.scripting.executeScript({world:'MAIN', files})` (исполняется браузером мимо CSP), затем передаёт токен вторым `executeScript(func, args)` — токен идёт через extension API, не через DOM. Bridge получил отложенный одноразовый сеттер `__LLM_BRIDGE_SET_TOKEN__` (placeholder-детект через split-литерал, чтобы inline-темплейтинг его не задел); повторный вызов сеттера возвращает false — background детектирует перехват (`BRIDGE_TOKEN_NOT_ACCEPTED`) и не рапортует успех. Прежний inline-путь сохранён как fallback. Файлы: `content-scripts/content-bridge.js`, `content-scripts/content-bootstrap.js`, `background/message-router.js`.
- Тесты: новый `tests/main-world-bridge.test.js` — 3 behavioral через VM-router (files+args последовательность, отказ без sender tab/токена, детекция consumed-сеттера) + 2 source-контракта. Полный `npm test` — 97 suites / 535 tests green.
- Версии: 2.80.140 → 2.80.141.
- Остаточный риск (зафиксирован): теоретическая гонка page-скрипта за одноразовый сеттер между двумя executeScript-вызовами; детектируется по `BRIDGE_TOKEN_NOT_ACCEPTED` и деградирует в прежний inline-путь, не хуже статус-кво.

### 2026-07-02 — Unsafe reuse preflight + legacy selector bundle removal 2.80.140 (Phase C глобального review)

- **Global reuse не должен захватывать рабочий чат пользователя (P1 из cross-review).** При `New pages = off` выбиралась самая новая подходящая вкладка провайдера без проверки содержимого страницы. Изменение: `probeReusableTabSurface()` — быстрый executeScript-проб перед attach unbound-вкладки: черновик в composer (`composer_has_draft`) или активная генерация (`generation_active`) → вкладка пропускается (`UNSAFE_REUSE_SKIPPED`), перебираются до 3 кандидатов, при провале всех — `ATTACH_REJECTED unsafe_reuse_preflight` и штатный fallback на новую вкладку. Run-bound вкладки и probe-сбои не блокируются. Файл: `background/tab-manager.js`.
- **Legacy selector bundle был хуже, чем «мина» (P2 из cross-review — эскалировано).** `content-scripts/platform-selectors.js` не просто конфликтовал namespace'ом: `scripts/build-bundles.js` включал в `dist/content-lib.js` именно его, а настоящий `answer-pipeline-selectors.js` — нет; bundled two-script режим работал с несовместимым контрактом (`'gpt'` vs `'chatgpt'`) → pipeline получал generic-селекторы. Изменение: бандлер переведён на `answer-pipeline-selectors.js`; legacy-файл перемещён в `legacy/platform-selectors.js`; `node scripts/build-bundles.js` прогнан успешно. Файлы: `scripts/build-bundles.js`, `legacy/platform-selectors.js`.
- Тесты: новый `tests/reuse-preflight-and-bundle.test.js` (3 guards: preflight-контракт; legacy вне content-scripts и manifest; бандлер использует настоящий контракт). Полный `npm test` — 96 suites / 530 tests green.
- Версии: 2.80.139 → 2.80.140.

### 2026-07-02 — Positional turn anchor F6.2 2.80.139 (Phase B глобального review)

- **Инвариант вместо семейства guard'ов.** Все stale-инциденты (Grok-13037 несколько ходов назад, Claude pre-send, Gemini snapshot) — следствие position-blind extraction: «ответ» выбирался ранжированием по длине/низу, без привязки к ходу диалога. Существующий F6 baseline (сигнатура последнего assistant-текста) ловит только непосредственно-предыдущий ход и хрупок к extraction-разнице (±23 chars у Claude). Изменение: **позиционный якорь хода** — конструктор `UnifiedAnswerPipeline` фиксирует `anchorAnswerCount` (число answer-кандидатов на странице в момент dispatch); `getAnswerElement()` при появлении новых узлов ограничивает выбор узлами ПОСЛЕ якоря (отвергает любой прошлый ход, даже если новый ответ короче); пока новых узлов нет — прежнее поведение под защитой сигнатурного baseline (кейс стриминга в существующий узел). Кандидаты собираются общим `collectSortedAnswerCandidates()`. Файл: `content-scripts/unified-answer-pipeline.js`.
- **Якорь доступен background-сканам.** Anchor публикуется в `window.__UnifiedPipelineTurnAnchor`, `reportDispatchBaseline()` передаёт его в `DISPATCH_BASELINE_CAPTURED`, роутер сохраняет `entry.preDispatchAnswerNodeCount`; `lateCollectAnswer` прокидывает его в inline-скан, который best-effort отбрасывает первые `anchorAnswerCount` кандидатов по document-позиции (фильтр применяется только если оставляет кандидатов; `anchorApplied` в результате для телеметрии). Файлы: `content-scripts/content-utils.js`, `background/message-router.js`, `background/job-orchestrator.js`.
- Тесты: новый `tests/turn-anchor.test.js` — 3 DOM-fixture behavioral (реальный класс pipeline в jsdom: старые ходы не выбираются после появления нового узла, даже более короткого; свежая страница без фильтра; anchor экспонируется для baseline-репорта) + 2 wiring-контракта. Полный `npm test` — 95 suites / 527 tests green.
- Версии: 2.80.138 → 2.80.139.
- Ожидаемые признаки в smoke-run: в переиспользованной вкладке с многоходовой историей извлечённый ответ соответствует новому ходу; в `DISPATCH_BASELINE_CAPTURED` meta есть `anchorAnswerCount`; при manual recovery в трейсах `anchorApplied=true`.

### 2026-07-02 — Lifecycle sender gate + tab create failure handling 2.80.138 (Phase A глобального review)

- **Границы доверия между вкладками (P0 из cross-review).** Content script живёт во всех вкладках провайдера, включая ручные чаты пользователя; lifecycle-сообщения принимались без проверки вкладки-источника: чужая вкладка того же провайдера могла подтвердить отправку (`PROMPT_SUBMITTED`, причём код сам подставлял текущий `runSessionId` при его отсутствии в meta), доставить ответ (`LLM_RESPONSE`/`FINAL_LLM_RESPONSE`) или выставить completion evidence (`LLM_RESPONSE_READY` → `lifecycleReadyAt`, влияет на PARTIAL/SUCCESS). Изменение: единый `validateLifecycleSender()` — сообщение принимается только если `sender.tab.id` совпадает с bound tab модели; отклонение пишет `SENDER_TAB_MISMATCH_REJECTED`. Применён к `PROMPT_SUBMITTED`, `LLM_RESPONSE`, `FINAL_LLM_RESPONSE`, `LLM_RESPONSE_READY`, `ANSWER_SNAPSHOT` (в `DISPATCH_BASELINE_CAPTURED` проверка уже была). Non-tab senders (страницы расширения) и модели без активного binding сохраняют прежнее поведение. Файл: `background/message-router.js`.
- **`chrome.tabs.create` без обработки ошибки (P1 из cross-review).** Callback сразу использовал `tab.id`; при popup blocker / internal Chrome error / session-restore edge-case — runtime exception и модель без вкладки и без понятного состояния. Изменение: проверка `chrome.runtime.lastError || !tab?.id` → телеметрия `TAB_CREATE_FAILED` + перевод модели в recoverable error через `handleLLMResponse(type: tab_create_failed)`. Файл: `background/tab-manager.js`.
- Тесты: новый `tests/lifecycle-sender-gate.test.js` — 8 tests, из них 7 behavioral через VM-router (foreign tab отклоняется и не мутирует state; bound tab принимается; extension pages и unbound-модели не блокируются) + source-guard на tabs.create. Полный `npm test` — 94 suites / 522 tests green.
- Версии: 2.80.137 → 2.80.138.

### 2026-07-02 — Stable pending vs completed answer 2.80.137 (по тому же прогону `1782945983672`: Z.ai финализирован обрезанным ответом)

- **Z.ai — SUCCESS серединой стрима.** Таймлайн из экспорта: detector зафиксировал завершённый ответ `ANSWER_COMPLETE_DETECTED textLength=3351` (00:47:30), но через 2 секунды `Stable pending auto-finalization — len=1843` финализировал устаревший pending-снимок середины стрима; поздние полные ответы отбрасывались как `duplicate_final`; карточка показывала 1843 chars, пока dblclick пользователя (00:51:09, фиксы 2.80.134/135) не дотянул `1843 -> 3626`.
- Причина: stable-pending таймер финализировал `pendingFinalAnswer` не сверяясь с уже известной длиной завершённого ответа (`answerCompleteTextLength`/`lifecycleReadyMeta.textLength`).
- Изменение: если известная длина завершённого ответа превышает pending более чем на 24 chars — таймер не финализирует огрызок, а запускает пересбор (`stable_pending_complete_refresh`, до 3 попыток; лог `Stable pending auto-finalization deferred (longer complete answer detected)`, телеметрия `STABLE_PENDING_STALE_SHORTER_THAN_COMPLETE`); свежий сбор приносит полный текст и финализация идёт с ним. Если 3 пересбора не дотянули полный текст — огрызок финализируется честным `PARTIAL` (не `SUCCESS`), double-click остаётся страховкой. Файл: `background/job-orchestrator.js`.
- Тесты: `tests/early-terminal-guard.test.js` +2 behavioral (таймер пересобирает вместо финализации огрызка и инкрементит refresh-счётчик; после исчерпания попыток — terminal `PARTIAL`, не `SUCCESS`). Полный `npm test` — 93 suites / 514 tests green.
- Версии `manifest.json`, `package.json`, `package-lock.json`, README: 2.80.136 → 2.80.137.
- Ожидаемые признаки в следующем smoke-run: у Z.ai/стриминговых моделей terminal `SUCCESS` имеет длину не меньше `ANSWER_COMPLETE_DETECTED textLength`; при расхождении в телеметрии `STABLE_PENDING_STALE_SHORTER_THAN_COMPLETE` и следом финализация полным текстом; худший исход при недоступности полного текста — `PARTIAL`, не короткий `SUCCESS`. Green test suite ≠ release-ready: нужен реальный повтор с Z.ai.

### 2026-07-02 — Pre-send finalization gate 2.80.136 (по тому же прогону `1782945983672`: Claude тоже подтянул предыдущий ответ)

- **Claude — SUCCESS предыдущим ответом до отправки промпта.** Таймлайн из экспорта: печать промпта заняла ~40s (`Typing done — 40200ms`); в 00:47:17 `Stable pending auto-finalization len=7742` зафиксировал terminal SUCCESS текстом предыдущего ответа со страницы, `Send attempt (ctrl+enter)` произошёл в 00:47:18, реальный ответ (7895 chars, `ANSWER_COMPLETE_DETECTED` 00:47:21) был отброшен как `duplicate_final` в 00:48:36. Baseline-guard не сработал из-за extraction-разницы в ~23 символа (exact-match сигнатура).
- Причина: auto-финализация «стабильного» pending-текста не проверяла, что prompt текущего dispatch вообще отправлен — а во время печати промпта «стабильный текст» на странице по определению является pre-dispatch контентом.
- Изменение: gate `awaitingSubmitConfirmation === true && !promptSubmittedAt` в обоих путях: (1) таймер `scheduleStablePendingAutoFinalization` — лог `Stable pending auto-finalization blocked (submit unconfirmed)`, сброс расписания, финализация не происходит; (2) forced-ветка `maybeDeferStreamingFinalization` — лог `Finalization deferred (submit unconfirmed)`, статус остаётся `RECEIVING awaiting_submit_confirmation`, планируется recheck-ping. Оба пути пишут телеметрию `FINALIZE_BLOCKED_SUBMIT_PENDING`. После подтверждения отправки финализация идёт штатно — реальный ответ становится первым terminal. Файл: `background/job-orchestrator.js`.
- Тесты: `tests/early-terminal-guard.test.js` +2 behavioral (deferred force-final не срабатывает при неподтверждённой отправке и финализируется после подтверждения; stable-pending таймер блокируется с нужным логом). Полный `npm test` — 93 suites / 512 tests green.
- Версии `manifest.json`, `package.json`, `package-lock.json`, README: 2.80.135 → 2.80.136.
- Ожидаемые признаки в следующем smoke-run: у моделей с долгой печатью промпта (Claude) нет `MODEL_FINAL` раньше `Send confirmed`; при попытке — `FINALIZE_BLOCKED_SUBMIT_PENDING` в телеметрии; terminal-ответ соответствует новому ответу (`ANSWER_COMPLETE_DETECTED` с бОльшим textLength), а не предыдущему ходу переписки. Green test suite ≠ release-ready: нужен реальный повтор с Claude в переиспользованной вкладке.

### 2026-07-02 — Stale answer replay guard + dblclick replace 2.80.135 (по реальному прогону `1782945983672`, экспорт `All Logs 20260702_00-55.md`)

- **Grok — подтянут ответ прошлой сессии (13037 chars), dblclick не помогал.** По логу: content script не увидел новый ответ (`DOM_FALLBACK_TIMEOUT`, `Answer unchanged after ping`); одиночный Manual ping в 00:49:46 форсировал `SUCCESS forced_success_with_text` текстом старого хода переписки (тот самый len=13037, который в прогоне `1782940321214` корректно отвергался как stale). Live inline-скан взял этот блок со страницы, потому что он всё ещё в DOM; baseline-guard не сработал (13037 — не последний ответ перед dispatch, а более старый). Далее dblclick стал no-op: настоящий ответ короче, а правило улучшения принимало только более длинный текст (`improvesTerminalAnswer`).
- Изменение (replay guard): tab-scoped snapshot cache entry с чужим `dispatchId` признаётся stale — не отдаётся как ответ ни в dead-tab, ни в fallback ветке (`usableCached`), а его сигнатура добавляется в `excludeTextSignatures` inline-скана, чтобы live-скан не мог вернуть тот же старый блок; телеметрия `STALE_SNAPSHOT_SIGNATURE_EXCLUDED`. Этот guard предотвратил бы сам ложный SUCCESS в 00:49:51. Файл: `background/job-orchestrator.js` (`lateCollectAnswer`).
- Изменение (dblclick replace): явный latest-recovery по dblclick теперь может ЗАМЕНИТЬ terminal-ответ другим валидным кандидатом даже если он короче (`replacesTerminalAnswer`): требования — терминальная entry, текст ≥80 chars, отличается по сигнатуре от текущего, не prompt echo, не pre-dispatch baseline; лог `Terminal answer replaced by manual latest recovery`, UI-пуш `replaced_after_terminal`. Автоматические late-collect пути по-прежнему не уменьшают terminal-ответ. Файл: `background/job-orchestrator.js` (`acceptLateCollectResult`).
- Тесты: `tests/materialize-recovery-finality.test.js` +3 behavioral (dblclick заменяет stale 13k более коротким настоящим ответом; автоматика не уменьшает; кандидат==baseline отвергается); новый `tests/stale-answer-replay-1782945983672.test.js` (3 guards: чужой dispatch в кэше не отдаётся, сигнатура исключается из скана, replace-контракт). Полный `npm test` — 93 suites / 510 tests green.
- Версии `manifest.json`, `package.json`, `package-lock.json`, README: 2.80.134 → 2.80.135.
- Ожидаемые признаки в следующем smoke-run: при повторном использовании вкладки Grok со старой перепиской — `STALE_SNAPSHOT_SIGNATURE_EXCLUDED` в телеметрии и НЕ появляется ответ прошлых сессий; если неверный ответ всё же зафиксирован — dblclick даёт `Terminal answer replaced by manual latest recovery` и карточка показывает настоящий последний ответ. Green test suite ≠ release-ready: нужен реальный повтор на переиспользованной вкладке Grok.

### 2026-07-02 — Status dblclick full-answer recovery 2.80.134 (по реальному прогону `1782944449199`, экспорт `All Logs 20260702_00-25.md`)

- **Perplexity — двойной клик не подтягивал полный ответ.** Три причины по логу: (1) `PipelineFSM.shouldAcceptEvent` разрешал recovered-override только failure→success, поэтому найденный manual recovery `SUCCESS` поверх locked `PARTIAL` (обрезанный snapshot 3099 chars, `soft_timeout`) отбрасывался как `Response ignored (pipeline control) — duplicate_final` (00:24:39/00:24:43); (2) latest-recovery был жёстко прибит к стратегии `bottom_most` — все 4 клика перечитывали тот же нижний блок страницы вместо основного ответа, ротация стратегий не работала несмотря на `advance=true`; (3) 3-й и 4-й клики молча умирали на `RECOVERY_BUDGET_EXHAUSTED manualPingAttempts:2/2` — явное действие пользователя ограничивалось бюджетом автоматики.
- Изменение (1): `shouldAcceptEvent` принимает `recovered_partial_upgrade` — locked `PARTIAL/STREAM_TIMEOUT_HIDDEN/STREAM_TIMEOUT` → входящий полный success того же dispatch при `allowRecoveredFinal`; повторный `PARTIAL` по-прежнему `duplicate_final`. Дальше апгрейд идёт штатным `terminal_rank_upgrade` FinalizationController. Файл: `shared/pipeline-fsm.js`.
- Изменение (2): первый dblclick сеется в `bottom_most` (последний видимый ответ), последующие ротируют стратегии (`longest`, `markdown_only`, `assistant_role_only`, ...) через `resolveManualRecoveryStrategy` с учётом failed-списка; при исчерпании всех стратегий ротация для явного пользовательского запроса перезапускается, а не выдаёт dead-end; `buildManualLatestRecoveryOptions()` получает выбранную стратегию и failed-список. Файл: `background/job-orchestrator.js`.
- Изменение (3): `manualLatestRecovery` (dblclick по статусу) больше не потребляет `manualPing` recovery budget — от спама кликов защищает существующий single-flight cooldown `lateCollectAnswer`; автоматические manual pings остаются под бюджетом. Файл: `background/job-orchestrator.js`.
- Тесты: `tests/pipeline-fsm.test.js` +1 behavioral (PARTIAL→SUCCESS c allowRecoveredFinal → `recovered_partial_upgrade`; без флага → `duplicate_final`; повторный PARTIAL → `duplicate_final`); `tests/manual-latest-recovery.test.js` +2 guards (ротация стратегий без hardcoded bottom_most; бюджетный bypass). Полный `npm test` — 92 suites / 504 tests green.
- Версии `manifest.json`, `package.json`, `package-lock.json`, README: 2.80.133 → 2.80.134.
- Ожидаемые признаки в следующем smoke-run: после dblclick на PARTIAL-карточке при найденном более длинном ответе — `Terminal answer improved after late collect` и/или `FINALIZATION_DECISION SUCCESS:accepted` с `recovered_partial_upgrade` вместо `duplicate_final`; повторные dblclick показывают в диагностике разные `strategy=` (bottom_most → longest → ...); нет `RECOVERY_BUDGET_EXHAUSTED manualPingAttempts` на пользовательских кликах. Green test suite ≠ release-ready: нужен реальный повтор c Perplexity.

### 2026-07-01 — Attachment smoke-run fixes 2.80.133 (по реальному прогону `1782940321214`, экспорт `All Logs 20260701_23-16.md`)

- **DeepSeek/Le Chat crash:** dispatch падал с `attachmentHandler is not defined` (объявление `const attachmentHandler = window.AttachmentHandler || null;` отсутствовало при наличии attachment-блока) и завершался `UNCERTAIN` до вставки prompt. Объявление добавлено в оба content script. Файлы: `content-scripts/content-deepseek.js`, `content-scripts/content-lechat.js`.
- **Grok — файл без запроса:** при `ATTACHMENT_CONFIRM_TIMEOUT` flow обрывался до вставки prompt — пользователь видел в composer только файл и не мог отправить даже вручную. Теперь при сбое attachment prompt вставляется в composer (без отправки), diag `Prompt preserved in composer for manual send`; `USER_ACTION_REQUIRED:attachment_failed` означает «проверьте вложение и нажмите send». Файл: `content-scripts/content-grok.js`.
- **Grok — false-negative подтверждения вложения:** файл был визуально прикреплён, но оба confirm-таймаута сработали — узкие селекторы `[data-testid*="attachment"]/[data-testid*="file"]` не матчат tailwind/tiptap chips Grok. confirmSelectors расширены generic-набором (blob/data image, Remove-кнопки, `[class*="attachment"]`, `[class*="chip"]`); baseline-сравнение защищает от false-confirm. Файл: `content-scripts/attachment-handler.js`.
- **Ложный SUCCESS от stale-ответа (Le Chat):** после крэша (prompt не отправлен, terminal `UNCERTAIN`) stale-ответ прошлой сессии (2037 chars) прошёл через recovered-final upgrade и дал `SUCCESS` в 23:12:54. Теперь upgrade locked terminal failure требует подтверждённого dispatch (`promptSubmittedAt`/`submitSource`); блок пишет `RECOVERED_FINAL_UPGRADE_BLOCKED_UNCONFIRMED_SEND`; исключения — manual recovery, api, preserved_pending, Qwen-inference (как в существующем guard `acceptLateCollectResult`). Файл: `background/job-orchestrator.js`.
- **GPT «оранжевый при полном ответе»:** стабильный ответ 3895 chars, Stop скрыт, застрявший busy → `Finalization forced (stable answer evidence)`, но статус ставился `PARTIAL streaming_incomplete` (противоречие собственному логу). Теперь текст, наблюдавшийся неизменным на ≥2 defer-перепроверках (`pendingFinalAnswerStableCount`), при stable-force финализируется `SUCCESS` (stable_text через early-terminal guard re-observation); одиночный длинный снимок на streaming max по-прежнему `PARTIAL`. Файл: `background/job-orchestrator.js`.
- **Достроена global-state answer recovery (падавшие тесты):** `syncStatusFromGlobalState` гидрирует пустую карточку из persisted `answer/answerHtml` broadcast-снапшота (`source=GLOBAL_STATE_ANSWER_RECOVERY`), а зелёный статус без ответа где-либо понижается до `UNCERTAIN` (`const status = successWithoutAnswer ? 'UNCERTAIN' : rawStatus;`). Файл: `results.js`.
- Тесты: добавлен `tests/smoke-run-1782940321214-regressions.test.js` (6 guards: объявления attachmentHandler во всех content scripts, Grok prompt-preserve и confirm-набор, stable-vs-streaming выражение, upgrade gate); `tests/materialize-recovery-finality.test.js` +3 behavioral (stale upgrade blocked / confirmed upgrade allowed / manual bypass); `tests/early-terminal-guard.test.js` +2 behavioral (stability across checks → SUCCESS, одиночный снимок → PARTIAL) + недостающие sandbox-stubs. Полный `npm test` — 92 suites / 501 tests green (до изменений baseline имел 2 red в `results-ui-recovery-triggers.test.js` — реализация достроена).
- Версии `manifest.json`, `package.json`, `package-lock.json`, README: 2.80.132 → 2.80.133.
- Ожидаемые признаки в следующем attachment smoke-run: нет `attachmentHandler is not defined`; у Grok при сбое вложения prompt остаётся в composer (`Prompt preserved in composer for manual send`), при видимом chip — `ATTACHMENT_CONFIRMED`; нет upgrade `UNCERTAIN/NO_SEND -> SUCCESS` без `PROMPT_SUBMITTED_*` (вместо него `RECOVERED_FINAL_UPGRADE_BLOCKED_UNCONFIRMED_SEND`); стабильный длинный ответ с застрявшим busy даёт `MODEL_FINAL SUCCESS` (stable_text), а не `PARTIAL streaming_incomplete`. Green test suite ≠ release-ready: нужен повторный реальный прогон с вложением.

### 2026-07-01 — Sidebar title back to left edge 2.80.132

- **Sidebar header:** `Notes`/`Sessions` title toggle явно закреплён слева (`justify-self: start`, `text-align: left`), при этом `+`/`Save` остаются справа.
- Версии `manifest.json`, `package.json`, `package-lock.json` и README синхронизированы: 2.80.132.

### 2026-07-01 — Sidebar header no search + notes tabs backup 2.80.131

- **Sidebar header:** поле поиска удалено из header левого sidebar на main и Debate/Pipeline страницах.
- **Actions:** `+` и `Save` перенесены к правому краю header; оба остаются в одном 56px action-slot, поэтому `+` визуально центрируется по кнопке `Save`.
- **Notes backup tabs:** export/import Notes уже включает store `tabs`; после import UI больше не вызывает auto-prune пустых tabs, поэтому импортированные tabs заметок не исчезают.
- Версии `manifest.json`, `package.json`, `package-lock.json` и README синхронизированы: 2.80.131.

### 2026-07-01 — Delete saved session returns to Current 2.80.130

- **Delete flow:** удаление открытой saved Session теперь сразу применяет `Current session` snapshot и возвращает textarea к запросу, который был до открытия saved Session.
- **Sidebar width:** default width левого sidebar теперь равен существующей минимальной ширине (`280px`), без дополнительного расширения.
- Версии `manifest.json`, `package.json`, `package-lock.json` и README синхронизированы: 2.80.130.

### 2026-07-01 — Current session restores exact live state 2.80.129

- **Current session:** возврат на `Current session` теперь восстанавливает prompt из сохранённого current snapshot, а не только из временного preview текста.
- **Model buttons:** выбор моделей восстанавливается точно по snapshot, включая случай, когда перед открытием saved Session все model buttons были сняты.
- **Cards:** карточки ответов по-прежнему восстанавливаются из `sessionsState.currentSnapshot`, то есть из состояния до открытия saved Session.
- Версии `manifest.json`, `package.json`, `package-lock.json` и README синхронизированы: 2.80.129.

### 2026-07-01 — Sidebar session backup restores saved prompt text 2.80.128

- **Prompt backup:** saved Sessions теперь дублируют `promptText` в manifest и snapshot, чтобы export/import не терял сам запрос.
- **Import fallback:** при нормализации backup `pageSnapshot` больше не затирает top-level prompt; если snapshot пустой или старого формата, prompt берётся из `session.promptText` / `session.savedPromptText`.
- **Preview:** поле запроса при выборе imported saved Session показывает URL-список сверху и сохранённый запрос под ним даже если IndexedDB snapshot отсутствует.
- Версии `manifest.json`, `package.json`, `package-lock.json` и README синхронизированы: 2.80.128.

### 2026-07-01 — Saved sidebar sessions open on main page from Debate 2.80.127

- **Navigation:** если пользователь находится на Debate/Pipeline странице и выбирает saved Session в левом sidebar, выбор сохраняется как pending intent, после чего app автоматически открывает `result_new.html`.
- **Restore after navigation:** на главной странице pending intent одноразово считывается из `chrome.storage.local`, sidebar остаётся в `Sessions`, и выбранная saved Session применяется к обычным карточкам ответов.
- **Safety:** intent имеет короткий TTL и удаляется после чтения, поэтому старый выбор не сработает при будущих загрузках.
- Версии `manifest.json`, `package.json`, `package-lock.json` и README синхронизированы: 2.80.127.

### 2026-07-01 — Restored sidebar cards keep grid layout 2.80.126

- **Layout:** restored saved-session model cards больше не растягиваются на всю ширину строки; они снова используют обычную `.llm-results` grid раскладку рядом друг с другом.
- **Visibility kept:** `llm-panel-session-restored` по-прежнему показывает `.output` поверх stream preview hide-rule, поэтому импортированные ответы остаются видимыми.
- Версии `manifest.json`, `package.json`, `package-lock.json` и README синхронизированы: 2.80.126.

### 2026-07-01 — Restored sidebar model answers stay visible 2.80.125

- **Root cause:** stream preview mode скрывал `.output` у model cards через `body.llm-stream-preview-open`, поэтому после import/выбора saved Session ответы моделей могли быть в DOM, но визуально выглядеть как свёрнутые; Favourite не попадал под это правило и поэтому отображался нормально.
- **Fix:** restored model cards получают inline state `llm-panel-session-restored` и `data-restored-response="true"`; для этого state CSS явно показывает `.output` даже при активном stream preview.
- **Layout:** карточки остаются в обычной `.llm-results` сетке и не используют `llm-panel-expanded`, поэтому больше не всплывают поверх интерфейса.
- **Regression:** добавлен guard, фиксирующий preview-hide override и JS-restored state.
- Версии `manifest.json`, `package.json`, `package-lock.json` и README синхронизированы: 2.80.125.

### 2026-07-01 — Sidebar remembers Notes/Sessions mode 2.80.124

- **Mode memory:** левый sidebar теперь сохраняет последний выбранный режим `Notes` или `Sessions` в `chrome.storage.local`.
- **Startup:** при следующей загрузке применяется сохранённый режим; если сохранённого значения ещё нет, sidebar стартует в `Sessions`.
- Версии `manifest.json`, `package.json`, `package-lock.json` и README синхронизированы: 2.80.124.

### 2026-07-01 — Sidebar opens in Sessions by default 2.80.123

- **Default mode:** левый sidebar теперь стартует во вкладке `Sessions`, а не `Notes`, на основной и pipeline страницах.
- **Toggle state:** стартовая HTML-разметка уже содержит `is-sessions-active`, заголовок `Sessions` и `aria-pressed="true"`, чтобы не было мигания Notes до JS-инициализации.
- **Notes toggle:** при переключении обратно заголовок корректно возвращается в `Notes`, потому что default title больше не берётся из стартового текста DOM.
- Версии `manifest.json`, `package.json`, `package-lock.json` и README синхронизированы: 2.80.123.

### 2026-07-01 — Imported model cards use inline restored state 2.80.122

- **Visible model answers:** карточки моделей с импортированными ответами теперь получают отдельный класс `llm-panel-session-restored`, который раскрывает их внутри обычной `.llm-results` сетки на всю ширину строки.
- **No floating:** восстановленные model cards не используют `llm-panel-expanded`, поэтому не всплывают над интерфейсом и не выходят из зоны ответов.
- Версии `manifest.json`, `package.json`, `package-lock.json` и README синхронизированы: 2.80.122.

### 2026-07-01 — Imported model cards show restored answers inline 2.80.121

- **Model card visibility:** карточки моделей с восстановленными ответами после import/выбора saved Session теперь получают увеличенную высоту output внутри обычной `.llm-results` сетки, чтобы содержимое сразу было видно.
- **No overlay:** `llm-panel-expanded` по-прежнему не включается автоматически, поэтому карточки не всплывают над остальным интерфейсом.
- Версии `manifest.json`, `package.json`, `package-lock.json` и README синхронизированы: 2.80.121.

### 2026-07-01 — Imported model cards stay in results grid 2.80.120

- **Model card restore:** импорт/выбор saved Session больше не включает `llm-panel-expanded` для восстановленных карточек моделей. Этот класс делает карточку floating overlay, поэтому одна карточка могла появляться над всеми окнами.
- **Normal layout:** перед применением saved-session snapshot все model cards сбрасывают expanded state, а восстановленные ответы остаются в обычной `.llm-results` зоне с нормальной высотой и scroll.
- Версии `manifest.json`, `package.json`, `package-lock.json` и README синхронизированы: 2.80.120.

### 2026-07-01 — Backup export asks for filename 2.80.119

- **Backup export UX:** перед скачиванием `sessions/notes` backup открывается prompt-модал с предложенным именем вида `codex-notes-sessions-YYYY-MM-DD_HH_MM.json`; текст имени сразу выделен для быстрой замены.
- **Confirm label:** в этом окне правая кнопка показывает `Yes`; нажатие `Yes` сохраняет с предложенным или введённым именем, `Cancel` отменяет export.
- **Filename safety:** пустое имя возвращается к стандартному, запрещённые символы заменяются на `_`, расширение `.json` добавляется автоматически.
- Версии `manifest.json`, `package.json`, `package-lock.json` и README синхронизированы: 2.80.119.

### 2026-07-01 — Notes backup import stores full notes + visible answer cards 2.80.118

- **Notes import contract:** import больше не передаёт `parsed.notes` в `NotesClient.importBackup` внутри лишней обёртки `{ payload: ... }`; теперь NotesService получает реальные `tabs/nodes/chunks/...` и сохраняет все заметки из backup.
- **Import refresh:** после импорта backup с `notes` results page полностью переинициализирует Notes, чтобы восстановить весь tree заметок, tabs и scratch state.
- **Backup data:** формат backup не менялся; `NotesClient` уже экспортирует/import'ит все stores (`tabs`, `nodes`, `chunks`, `meta`, `tasks`, `backupState`, `searchIndex`, `noteTokens`).
- **Answer cards:** restored saved-session response cards автоматически раскрываются, а для старых backups выбор моделей выводится из сохранённых карточек, чтобы ответы сразу были видны после import/выбора session.
- Версии `manifest.json`, `package.json`, `package-lock.json` и README синхронизированы: 2.80.118.

### 2026-07-01 — Sidebar header geometry stable 2.80.116

- **Notes/Sessions header:** header left sidebar зафиксирован одной grid-структурой для обоих режимов: title, action-slot и search всегда занимают одни и те же колонки.
- **Search stability:** `.notes-search` больше не дёргается при переключении Notes/Sessions и остаётся справа в той же позиции и ширине.
- **Action alignment:** `+` в Notes и `Save` в Sessions накладываются на один action-slot; `+` стоит по центру ширины кнопки `Save`.
- Версии `manifest.json`, `package.json`, `package-lock.json` и README синхронизированы: 2.80.116.

### 2026-07-01 — Sidebar Sessions: scoped tabs + saved prompt 2.80.115

- **Scoped tabs:** `Session -> Save` для новой sidebar-сессии теперь берёт только вкладки моделей, привязанные к текущему run/session, а не все ранее отслеженные вкладки этих провайдеров.
- **Saved prompt:** snapshot saved Session теперь сохраняет содержимое prompt field. При выборе saved Session поле запроса показывает список сохранённых вкладок сверху, затем сохранённый запрос ниже.
- **Import/migration:** prompt считается полноценной частью snapshot, поэтому JSON import/старые inline snapshots не теряют сессию, если в ней есть запрос даже без карточек/Favourite.
- Версии `manifest.json`, `package.json`, `package-lock.json` и README синхронизированы: 2.80.115.

### 2026-07-01 — Sidebar Sessions: Current session + IndexedDB snapshots 2.80.114

- **Sidebar UI:** левый sidebar Notes/Sessions унифицирован: `.sidebar-title` переключает `Notes`/`Sessions`, кнопки `Add`/`Save` перенесены в header, удаления — в нижний hint-row, а tabs Notes живут над hint-row.
- **Current session:** в списке Sessions появился закреплённый `Current session`. Он хранит текущие карточки ответов во временной памяти страницы; выбор saved Session подменяет карточки/Favourite/highlights, возврат на `Current session` возвращает рабочее состояние.
- **Saved Sessions storage:** `chrome.storage.local/sync` теперь хранит только лёгкий manifest saved Sessions (`id`, `name`, URLs, `boundTabIds`, counters/bytes). Тяжёлые `pageSnapshot` с HTML карточек ответов, Favourite и пользовательскими выделениями вынесены в IndexedDB `llm_sidebar_sessions_v1`.
- **Lazy load:** snapshot saved Session загружается из IndexedDB только при выборе/открытии этой сессии. Старые inline snapshots мигрируются из storage в IndexedDB при загрузке.
- **Backup:** JSON export/import остаётся резервной копией и переносом между компьютерами: export подтягивает snapshots из IndexedDB, import пишет snapshots обратно в IndexedDB и сохраняет только manifest.
- **Проверки:** `node --check results.js` — OK; `npm test -- --runInBand tests/results-debate-favorites.test.js` — 31/31 OK.
- Версии `manifest.json`, `package.json`, `package-lock.json` и README синхронизированы: 2.80.114.

### 2026-06-30 — Claude provider-error false negative and manual latest recovery 2.80.113

- **Claude false `don't answer`:** provider-error классификация стала менее грубой: короткие/system-like capacity/error surfaces по-прежнему считаются `provider_error`, но содержательные ответы, которые лишь упоминают capacity/try-again сценарий, больше не превращаются в `EXTERNAL_LLM_FAILURE`.
- **Manual latest для Claude:** inline DOM scan, который запускается двойным кликом по status indicator, получил Claude-specific селекторы (`conversation-turn`, `data-is-response`, `standard-markdown`), чтобы не зависеть только от content-script cache и не возвращать `candidateCount=0`.
- **Z.ai сохранён как корректный failure:** короткое сообщение `Model is currently at capacity...` остаётся provider-error surface и не должно становиться зелёным ответом.
- **Регрессии:** `provider-error-surface.test.js` покрывает длинный валидный ответ с упоминанием capacity; `manual-latest-recovery.test.js` фиксирует наличие Claude selector map для inline latest recovery.
- **Проверки:** `node --check` по изменённым JS/test файлам — OK; профильные тесты `provider-error-surface`, `manual-latest-recovery`, `claude-latest-response` — 9/9 OK. Полный `npm test -- --runInBand`: 90 suites / 481 tests OK; прежние 1 suite / 2 known failures остаются в `results-ui-recovery-triggers.test.js`.
- Версии `manifest.json`, `package.json`, `package-lock.json` и README синхронизированы: 2.80.113.

### 2026-06-29 — Attachment dispatch is fail-closed 2.80.112

- **Запуск с файлами больше не деградирует в запуск без файлов:** `results.js` удаляет fallback, который при ошибке старта повторял `START_FULLPAGE_PROCESS` без `attachments`; теперь такой старт останавливается с явным уведомлением.
- **Адаптеры LLM fail-closed:** Claude, Grok, Perplexity, Qwen, DeepSeek и Le Chat теперь бросают `attachment_failed`, если файл был выбран, но upload не подтверждён; ChatGPT/Gemini уже имели такой контракт.
- **Confirmation для legacy-провайдеров:** DeepSeek и Le Chat добавлены в общий `AttachmentHandler` с `drop/input` стратегиями и `confirmSelectors`; их adapter-пути теперь сначала используют shared handler, а старый `attachFilesToComposer` оставлен только как fallback.
- **Регрессии:** `attachment-handler-bridge-auth.test.js` проверяет, что results page не содержит retry-without-files, все attachment-capable адаптеры имеют fail-closed `attachment_failed`, а DeepSeek/Le Chat идут через shared confirmation-gated handler.
- **Проверки:** `node --check` по изменённым JS/test файлам — OK; профильные тесты `attachment-handler-bridge-auth`, `gpt-clipboard-attachment`, `provider-error-surface` — 17/17 OK. Полный `npm test -- --runInBand`: 90 suites / 479 tests OK; прежние 1 suite / 2 known failures остаются в `results-ui-recovery-triggers.test.js`.
- Версии `manifest.json`, `package.json`, `package-lock.json` и README синхронизированы: 2.80.112.

### 2026-06-29 — Double-click latest repair работает для красного Grok NO_SEND 2.80.111

- **Grok manual repair:** явный double-click по красному `.status-indicator` (`manual_latest_recovery`) теперь может принять свежий latest-кандидат и заменить `Error: Grok submission was not confirmed`, даже если run уже locked в `NO_SEND` без `promptSubmittedAt`.
- **Границы безопасности:** обычный `manual_ping_late_collect` и direct scrape по-прежнему не апгрейдят unconfirmed `NO_SEND`; исключение сделано только для explicit `manual_latest_recovery`, который уже использует `bottom_most`, исключает текущий error/старый текст и проходит min-length/prompt-echo gates.
- **Регрессии:** `early-terminal-guard.test.js` добавляет поведенческий сценарий `Grok NO_SEND -> double-click manual_latest_recovery -> SUCCESS + answer in card`; `manual-latest-recovery` и Grok sanity tests остаются зелёными.
- **Проверки:** `node --check` по orchestrator/test файлам — OK; профильные тесты `early-terminal-guard`, `manual-latest-recovery`, `prompt-echo-suspect-not-green` — 39/39 OK. Полный `npm test -- --runInBand`: 90 suites / 476 tests OK; прежние 1 suite / 2 known failures остаются в `results-ui-recovery-triggers.test.js`.
- Версии `manifest.json`, `package.json`, `package-lock.json` и README синхронизированы: 2.80.111.

### 2026-06-29 — Grok/Z.ai не теряют валидный поздний ответ 2.80.110

- **Grok:** после фактически подтверждённой отправки (`dispatchSuccess`: composer cleared или response started) content script теперь сразу посылает `PROMPT_SUBMITTED` с `payloadVerified=false`, а строгая проверка rendered user-turn остаётся отдельной диагностикой. Это не даёт позднему `GROK_SENT_PROMPT_MISMATCH` стереть уже подтверждённый send и заблокировать найденный DOM-ответ как `grok_submit_unconfirmed`.
- **Z.ai:** `SUCCESS` на suspect-short candidate теперь откладывается для Z.ai даже если lifecycle ошибочно выглядит complete. Кандидат вроде 16 символов остаётся `RECEIVING`, чтобы последующие 287/2146 символов могли обновить карточку без ручного double-click.
- **Регрессии:** обновлены `prompt-echo-suspect-not-green.test.js` и `early-terminal-guard.test.js`: Grok закрепляет ранний dispatch confirmation + позднюю strict verification, Z.ai закрепляет defer suspect-short при `lifecycleReadyAt`.
- **Проверки:** `node --check` по Grok/orchestrator/test файлам — OK; профильные тесты `prompt-echo-suspect-not-green`, `early-terminal-guard`, `manual-latest-recovery`, `zai-extraction`, `zai-integration` — 47/47 OK. Полный `npm test -- --runInBand`: 90 suites / 475 tests OK; прежние 1 suite / 2 known failures остаются в `results-ui-recovery-triggers.test.js`.
- Версии `manifest.json`, `package.json`, `package-lock.json` и README синхронизированы: 2.80.110.

### 2026-06-29 — Двойной клик по статусу запускает manual latest recovery 2.80.109

- **UX:** двойной клик по `.status-indicator` теперь запускает `manualLatestRecovery`, а не обычную выдачу cached/current answer. Это даёт пользователю ручной способ скорректировать неверно найденный последний ответ.
- **Latest strategy:** request идёт через `bottom_most` inline DOM extraction, пропускает cached fast-path, обычный live `getResponses` и live `entry.answer`, исключает текущий сохранённый текст/предыдущий baseline через `excludeTextSignatures`, затем выбирает нижний видимый assistant-кандидат.
- **Безопасность:** существующие guards остаются в силе: prompt echo/provider-error/ui-noise/finalization gates не обходятся; если найден только тот же старый текст, он не принимается как manual latest correction.
- **Регрессии:** добавлен `tests/manual-latest-recovery.test.js`: UI посылает `manualLatestRecovery`, router не возвращает cached answer, orchestrator использует `bottom_most` и исключает текущий текст.
- **Проверки:** `node --check` по background/results/test файлам — OK; целевые тесты `manual-latest-recovery`, `provider-error-surface`, `error-output-helper`, `release-log-regressions` — 32/32 OK; orchestrator/finalization набор `early-terminal-guard`, `finalization-evidence`, `answer-length-policy`, `manual-latest-recovery` — 45/45 OK. Полный `npm test -- --runInBand`: 90 suites / 474 tests OK; прежние 1 suite / 2 known failures остаются в `results-ui-recovery-triggers.test.js`.
- Версии `manifest.json`, `package.json`, `package-lock.json` и README синхронизированы: 2.80.109.

### 2026-06-29 — Карточка показывает `[LLM] don't answer` при provider-error 2.80.108

- **UX:** если модель не начала нормальную генерацию и вместо ответа получила provider/system error surface, карточка получает display text вида `GPT don't answer`, `Claude don't answer`, `Z.ai don't answer`.
- **Статус:** этот display text не переводит индикатор в зелёный SUCCESS. `ResultsShared.isErrorOutput()` считает `don't answer` error-output, поэтому сообщение видно в карточке, но не участвует как валидный ответ в сравнении/экспорте.
- **Background:** `handleLLMResponse` сохраняет `entry.answer = "[LLM] don't answer"` только для `EXTERNAL_LLM_FAILURE`-класса (`answer_provider_error`, `provider_error_surface`, rate-limit/model-unavailable/overload), помечая `entry.providerErrorDisplay = true`.
- **Регрессии:** `error-output-helper.test.js` закрепляет `GPT/Z.ai/Le Chat don't answer` как error-output; `provider-error-surface.test.js` закрепляет display path в orchestrator.
- **Проверки:** `node --check` по background/results/test файлам — OK; целевые тесты `provider-error-surface`, `error-output-helper`, `answer-content-classifier`, `prompt-echo-suspect-not-green`, `release-log-regressions` — 53/53 OK. Полный `npm test -- --runInBand`: 89 suites / 472 tests OK; прежние 1 suite / 2 known failures остаются в `results-ui-recovery-triggers.test.js`.
- Версии `manifest.json`, `package.json`, `package-lock.json` и README синхронизированы: 2.80.108.

### 2026-06-29 — Provider overload/error surface не становится зелёным ответом 2.80.107

- **Корректность:** системные окна/тосты провайдера вроде overload, high demand, unable to respond, failed to generate теперь классифицируются как `provider_error`, а не как валидный ответ модели.
- **Background gate:** `handleLLMResponse` отклоняет не только `ui_noise`, но и `provider_error` до success-finalization. Такие ответы уходят в ошибочный статус (`EXTERNAL_LLM_FAILURE` через failure classification), не в зелёный SUCCESS.
- **DOM guard:** `ContentUtils.detectProviderErrorSurface()` ищет видимые `dialog`/`alert`/toast/modal/banner/error surfaces. `UnifiedAnswerPipeline` проверяет этот guard перед stale-baseline/final classifier, чтобы при видимом overload modal не финализировать старый assistant из DOM.
- **Регрессии:** добавлен `tests/provider-error-surface.test.js`: classifier non-terminal для overload/system inability текстов, DOM-сценарий `старый assistant + видимый overload dialog`, source-contract для pipeline/background guard.
- **Проверки:** `node --check` по classifier/content/pipeline/background/test файлам — OK; целевые тесты `provider-error-surface`, `answer-content-classifier`, `pipeline-baseline-anchor`, `prompt-echo-suspect-not-green` — 31/31 OK; `release-log-regressions` + `provider-error-surface` — 26/26 OK. Полный `npm test -- --runInBand`: 89 suites / 471 tests OK; прежние 1 suite / 2 known failures остаются в `results-ui-recovery-triggers.test.js`.
- Версии `manifest.json`, `package.json`, `package-lock.json` и README синхронизированы: 2.80.107.

### 2026-06-28 — Z.ai выбирает последний assistant после follow-up 2.80.106

- **Корректность Z.ai:** extractor больше не останавливается на первом непустом selector-layer. Он собирает response-кандидатов со всех Z.ai селекторов, отбрасывает user/disclaimer/noise, дедуплицирует и сортирует по фактическому DOM order перед выбором последнего assistant.
- **Follow-up сценарий:** исправлен случай, где старый ответ матчился более ранним точным selector-layer, а новый ответ после follow-up — другим допустимым selector-layer; раньше старый слой мог полностью скрыть новый ответ от `readLatestResponse()`.
- **Watcher:** общий `UnifiedAnswerWatcher.getAnswerElement()` теперь для `lastMessage` берёт последний matching element по DOM order, а не первый `querySelector`, чтобы streaming/baseline-наблюдение не привязывалось к старому сообщению в длинном чате.
- **Baseline:** Z.ai DOM-wait теперь сравнивает кандидата с pre-send baseline через `ContentUtils.isBaselineEquivalent`, а не только через raw string equality.
- **Регрессия:** `zai-extraction.test.js` расширен поведенческим DOM-сценарием `assistant → user follow-up → assistant → user draft`, где старый и новый ответы матчятся разными selector layers.
- **Проверки:** `node --check` по Z.ai/watcher/selector файлам — OK; целевые тесты `zai-extraction`, `zai-integration`, `dispatch-baseline-stale-guard`, `pipeline-baseline-anchor`, `release-log-regressions` — 58/58 OK. Полный `npm test -- --runInBand`: 88 suites / 468 tests OK; прежние 1 suite / 2 known failures остаются в `results-ui-recovery-triggers.test.js`.
- Версии `manifest.json`, `package.json`, `package-lock.json` и README синхронизированы: 2.80.106.

### 2026-06-28 — Claude выбирает последний assistant по DOM order 2.80.105

- **Корректность Claude:** extraction/baseline больше не полагается на `:last-of-type` как на источник истины. Этот CSS-псевдокласс означает «последний элемент своего типа среди siblings», а не «последний matching assistant»; если после Claude-ответа есть user turn/draft, он может не выбрать последний assistant.
- **Extractor:** `content-claude.js` теперь добавляет broad assistant selectors без `:last-of-type`, объединяет primary+fallback candidates, дедуплицирует message roots и сортирует их по фактическому DOM order перед выбором последнего валидного assistant.
- **Pipeline/selectors:** `answer-pipeline-selectors.js`, `selectors/claude.config.js` и `selectors/config-bundle.*` синхронизированы с broad Claude selectors, чтобы общий pipeline и selector registry не оставались на старой модели выбора.
- **Регрессия:** добавлен `tests/claude-latest-response.test.js` с DOM-сценарием `assistant → user → assistant → user`; старый `:last-of-type` не матчится, а текущий bundle выбирает `Latest Claude answer`.
- **Проверки:** `node --check` по Claude/selector файлам — OK; целевые тесты `claude-latest-response`, `dispatch-baseline-stale-guard`, `pipeline-baseline-anchor` — 28/28 OK.
- Версии `manifest.json`, `package.json`, `package-lock.json` и README синхронизированы: 2.80.105.

### 2026-06-28 — Follow-up baseline guard для всех адаптеров 2.80.104

- **Корректность:** все web-адаптеры вооружают pre-send baseline перед отправкой follow-up в существующий чат и передают тот же baseline в `UnifiedAnswerPipeline({ baselineText })`, чтобы старый последний assistant не мог стать новым ответом текущего dispatch.
- **Fallback guard:** DOM fallback пути ChatGPT/Perplexity/DeepSeek/Le Chat дополнительно отклоняют baseline-равный кандидат через общий `ContentUtils.isBaselineEquivalent`.
- **Background guard:** `DISPATCH_BASELINE_CAPTURED` теперь валидирует `runSessionId`, `dispatchId` и sender tab перед записью или очисткой baseline guard; stale baseline-события не могут перезаписать текущий dispatch.
- **Snapshot cache:** late-answer snapshot не сохраняет baseline-равный stale answer (`SNAPSHOT_STALE_BASELINE_SKIPPED`), чтобы старый ответ не попадал в recovery-cache.
- **Регрессии:** расширен `dispatch-baseline-stale-guard.test.js`: baseline report для 9 адаптеров, `baselineText` в pipeline, stale guard в fallback, identity rejection и snapshot-write rejection.
- **Проверки:** `node --check` по затронутым content/background файлам — OK; целевые тесты `dispatch-baseline-stale-guard`, `pipeline-baseline-anchor`, `gemini-stale-response` — 28/28 OK; полный `npm test -- --runInBand` — 87 suites / 465 tests OK, 1 suite / 2 known failures остаются в `results-ui-recovery-triggers.test.js`.
- Версии `manifest.json`, `package.json`, `package-lock.json` и README синхронизированы: 2.80.104.

### 2026-06-24 — TXT-экспорт карточки Favourite 2.80.103

- **UI:** в header карточки Favourite сразу после её HTML-экспорта добавлена кнопка `txt`.
- **Экспорт:** создаётся UTF-8 файл `Favourite YYYYMMDD_HH-MM.txt`, содержащий только избранные записи, сгруппированные по исходной модели, с сохранением времени и plain-text содержимого.
- **Регрессии:** закреплены порядок HTML → TXT → Clear, имя файла, секция `Favourite` и текстовая сериализация групп.
- Версии `manifest.json`, `package.json`, `package-lock.json` и README синхронизированы: 2.80.103.

### 2026-06-23 — Общий экспорт ответов в TXT 2.80.102

- **UI:** в `.toolbar-cluster` сразу после кнопки общего HTML-экспорта добавлена компактная кнопка `txt`.
- **Экспорт:** создаётся UTF-8 файл `LLM Responses YYYYMMDD_HH-MM.txt` с промптом, Favourite и всеми непустыми ответами моделей; ошибки моделей, как и в существующем HTML-экспорте, пропускаются.
- **Формат:** plain-text секции явно разделены заголовками `Prompt`, `Favourite` и `LLM Responses`; для ответов сохраняются названия моделей и metadata line.
- **Регрессии:** закреплены положение кнопки между HTML и Copy All, MIME `text/plain;charset=utf-8`, расширение `.txt` и содержимое Favourite/ответов.
- Версии `manifest.json`, `package.json`, `package-lock.json` и README синхронизированы: 2.80.102.

### 2026-06-23 — Toolbar доступен внутри карточки Favourite 2.80.101

- **Изменение:** выделение текста внутри `.favorite-item-body` теперь открывает тот же Toolbar форматирования, что и обычные карточки ответов.
- **Сохранение:** цвет, снятие подсветки, bold и italic сразу синхронизируются с записью в `llmComparatorFavoriteEntries`, поэтому оформление не теряется после перерендера.
- **Избранное:** звезда для уже сохранённого элемента отображается активной; повторное нажатие удаляет этот элемент вместо создания вложенного дубликата.
- **Регрессия:** закреплено отсутствие прежнего исключения `favoriteOutputId` и наличие синхронизации редактируемого favorite-item.
- Версии `manifest.json`, `package.json`, `package-lock.json` и README синхронизированы: 2.80.101.

### 2026-06-23 — Единый порядок моделей и обновлённый Toolbar выделения 2.80.100

- **Порядок моделей:** кнопки `.models-row-header` на основной и pipeline-страницах, а также карточки ответов на основной странице приведены к одному порядку: GPT, Gemini, Claude, Grok, Z.ai, Qwen, DeepSeek, Le Chat, Perplex.
- **Toolbar выделения:** перед жёлтым цветом добавлена кнопка снятия подсветки в виде перечёркнутого пустого квадрата. Избранное визуально различает неактивное `☆` и активное `★` состояния и поддерживает повторное нажатие для удаления фрагмента.
- **Регрессии:** тест фиксирует DOM-порядок всех девяти кнопок на обеих страницах и соответствующий порядок девяти карточек; профильные тесты Toolbar проверяют снятие цвета и переключение избранного.
- Версии `manifest.json`, `package.json`, `package-lock.json` и README синхронизированы: 2.80.100.

### 2026-06-22 — MD-экспорт больше не ждёт очередь телеметрии 2.80.99

- **Для чего:** устранить задержку 30–60+ секунд между нажатием MD и появлением файла при большом потоке telemetry events.
- **Изменение:** нажатие MD фиксирует point-in-time snapshot уже доступных telemetry events и копию диагностических логов. `GET_DIAG_EVENTS` читает последнее атомарно сохранённое состояние без ожидания `diagnosticsMutationChain`; незавершённые записи продолжают сохраняться в фоне. Runtime-снимок и Run Summary ограничены общим deadline 300 мс, после чего файл создаётся из уже доступных данных.
- **Гарантия:** события с timestamp позже момента нажатия не попадают в текущий файл и остаются доступными для следующего экспорта; экспорт не очищает и не останавливает телеметрию.
- **Тесты:** добавлены regression-проверки point-in-time snapshot и независимости `GET_DIAG_EVENTS` от очереди записи.
- **Полный прогон:** 456/458 тестов успешно; два прежних падения остаются в `results-ui-recovery-triggers.test.js`.

### 2026-06-22 — Z.ai: ответ вместо футера попадает в карточку 2.80.98

- **Для чего:** устранить ложный SUCCESS с 16 символами и пустую карточку после успешной отправки Z.ai.
- **Изменение:** по логу `All Logs 20260622_08-09.md` установлено, что общий `.prose` извлекал футер `Generated by AI.`. По production-бандлу Z.ai найден фактический контракт ответа: `.chat-assistant.markdown-prose` внутри `message-*`. Точные селекторы подняты во все extraction/recovery-пути, общие `.prose` удалены, адаптер теперь выбирает последний узел первого успешного точного selector-layer и явно отбрасывает provider disclaimer.
- **Файлы:** `content-scripts/content-zai.js`, `selectors/zai.config.js`, selector bundles, `answer-pipeline-selectors.js`, `platform-selectors.js`, `pragmatist-runner.js`, `notes-sidebar-inject.js`, `content-utils.js`, `background/job-orchestrator.js`, `tests/zai-extraction.test.js`.

### 2026-06-22 — Добавлена web-UI модель Z.ai 2.80.97

- **Для чего:** запускать запросы и собирать ответы через `https://chat.z.ai/` вместе с остальными моделями.
- **Изменение:** добавлены домен и target-реестры, selector profile по живому DOM (`#chat-input`, `#send-message-button`), отдельный content-adapter, lifecycle/recovery-политики, telemetry aliases, UI-кнопки/панель, pipeline и smoke tooling. Прямой API отключён до появления подтверждённого API-контракта и ключа.
- **Файлы:** `manifest.json`, `background/*`, `content-scripts/content-zai.js`, `selectors/zai.config.js`, selector/pipeline maps, `result_new.html`, `pipeline_panel.html`, `popup.*`, `results*.js`, `pipeline/pipeline-runtime.js`, `scripts/*`, `README.md`.

### 2026-06-21 — Grok: Markdown-render больше не считается обрезанным промптом 2.80.96
Симптом: `Error: prompt_not_confirmed_before_round4`. Первичный сбой в `All Logs 20260621_22-03.md`: `GROK_SENT_PROMPT_MISMATCH expected=847 actual=835`, после чего код сам остановил генерацию (`generationStopped=true`).

- Перед отправкой Grok-композер был подтверждён полностью: `GROK_COMPOSER_SNAPSHOT matchesPrompt=true`, затем пятсекундный commit guard. Следовательно, потеря произошла не при вставке.
- Корень — сравнение разных представлений: ожидаемая строка содержала Markdown source, а опубликованный user turn читался через `innerText` уже после Markdown-render. Маркеры заголовков, списков, emphasis и ссылок исчезали из текста и создавали ложную разницу в длине.
- Добавлена `normalizeGrokRenderedPrompt`: контролируемо удаляет только синтаксические Markdown-маркеры и сохраняет все пользовательские слова. Проверка сначала требует strict equality, затем допускает `rendered_markdown` equality. Реальное усечение остаётся mismatch и по-прежнему останавливает неверную генерацию.
- `GROK_SENT_PROMPT_CONFIRMED` теперь пишет `match=strict|rendered_markdown`; mismatch-телеметрия содержит длины обеих rendered-нормализаций.
- Профильные тесты: 40/40. Полный прогон: 446/448; два прежних падения остаются в `results-ui-recovery-triggers.test.js`. Версии manifest/package/lock/README синхронизированы: 2.80.96.

### 2026-06-21 — Gemini RPC: устранён ложный ACK от results page 2.80.95
Основание: `All Logs 20260621_22-03.md` на 2.80.94. Trusted CDP-клики выполнялись (`GEMINI_CDP_UPLOAD_TRIGGER_CLICKED` ×12), но chooser не открылся. Одновременно обнаружен строгий временной инвариант: `ATTACHMENT_DISPATCHED` записан в 21:59:16, тогда как background завершил ту же операцию ошибкой `gemini_file_chooser_not_opened` только в 22:00:08.

- **Корень ложного успеха:** общий `chrome.runtime.onMessage` в `results.js` безусловно вызывал `sendResponse({ok:true})` после switch — в том числе для чужого `GEMINI_CDP_ATTACH_REQUEST`. Results page выигрывал гонку ответа у service worker, content-script считал dispatch успешным и запускал 90-секундный UI-confirm, не дожидаясь фактического CDP-результата.
- **Исправление RPC:** введён whitelist `RESULTS_RUNTIME_MESSAGE_TYPES`; неизвестные типы немедленно возвращают `false` без `sendResponse`. Теперь ответ на `GEMINI_CDP_ATTACH_REQUEST` может дать только background, а `gemini_file_chooser_not_opened` приводит к `ATTACHMENT_DISPATCH_FAILED` без ложного confirm-timeout.
- **Стабилизация trusted click:** перед каждой попыткой используется `Page.bringToFront`; это не позволяет параллельному focus scheduler нажимать Gemini-кнопку в неактивной вкладке. Телеметрия `GEMINI_CDP_UPLOAD_TRIGGER_CLICKED` теперь содержит точную подпись/tag/role выбранного trigger, чтобы следующий лог однозначно показал, нажата кнопка Add или пункт Upload files.
- Regression-тест запрещает results page отвечать на Gemini RPC. Полный прогон: 445/447; два прежних падения остаются в `results-ui-recovery-triggers.test.js`. Версии manifest/package/lock/README синхронизированы: 2.80.95.

### 2026-06-21 — Gemini: trusted chooser вместо поиска скрытого input 2.80.94
Основание: `All Logs 20260621_19-14.md` (728 telemetry events). Новая поэтапная телеметрия установила точный корень: файл материализован, debugger подключён, но операция завершилась `GEMINI_CDP_ATTACH_FAILED — gemini_file_input_not_found`. Следовательно, гипотеза «Gemini не хватило времени» опровергнута: Gemini лениво создаёт file input только при настоящем открытии chooser, а программный DOM `.click()` его надёжно не создаёт.

- Background подписывается на `chrome.debugger.onEvent` до открытия chooser и перехватывает `Page.fileChooserOpened`; из события берётся `backendNodeId` реального file input.
- Кнопка Add/Upload находится в основном DOM и открытых Shadow DOM, прокручивается в viewport и нажимается доверенной CDP-последовательностью `Input.dispatchMouseEvent`: move → press → release. Добавлены подписи EN/RU/ES/FR/DE/IT.
- После `Page.fileChooserOpened` файл назначается через `DOM.setFileInputFiles({ backendNodeId, files })`. Уже существующий `input[type=file]` сохранён как быстрый путь через `objectId`.
- Удалён ненадёжный DOM `element.click()`. Если chooser не открылся, background возвращает `gemini_file_chooser_not_opened`; attachment-handler должен завершить стратегию как `ATTACHMENT_DISPATCH_FAILED`, не переходя к 90-секундному ожиданию UI-confirmation.
- Добавлена закреплённая стадия `GEMINI_CDP_UPLOAD_TRIGGER_CLICKED`; listener debugger гарантированно удаляется в `finally`.
- Профильные тесты: 11/11. Полный прогон: 444/446; два прежних падения остаются в `results-ui-recovery-triggers.test.js` и не относятся к Gemini. Версии manifest/package/lock/README синхронизированы: 2.80.94.

### 2026-06-21 — Gemini attachments + надёжная телеметрия и MD-экспорт 2.80.93
Основание: `All Logs 20260621_18-13.md`. Лог содержал только 83 поздних события, пустые rounds и обрезанную диагностику; для Gemini CDP-доставка могла завершиться успешно, но подтверждение интерфейса не успевало появиться. Гипотеза «Gemini не хватило времени» учтена как гипотеза, а не как установленный факт.

- **Gemini attachment:** оставлен один предсказуемый путь `cdp-file-input`; background временно материализует файлы через `chrome.downloads`, находит file input (включая Shadow DOM) и назначает файлы через `DOM.setFileInputFiles`. Добавлены разрешения `downloads` и `debugger`.
- **Тайминг Gemini:** общий бюджет ожидания увеличен до 90 секунд без умножения на число файлов; подтверждение работает на batch целиком. Изменение `input.files` считается evidence, но при отсутствии UI-чипа даётся ещё 15 секунд на завершение обработки. Временные файлы удаляются через `chrome.alarms` через 120 секунд, поэтому очистка переживает остановку MV3 service worker.
- **Защита GPT:** clipboard/paste исключён из attachment-стратегий GPT (`drop` → `input`), чтобы содержимое текстового вложения не попадало в поле запроса из глобального clipboard.
- **Наблюдаемость attachment:** добавлены закреплённые стадии `REQUESTED`, `FILES_MATERIALIZED`, `DEBUGGER_ATTACHED`, `FILE_INPUT_FOUND`, `FILES_ASSIGNED`, `DISPATCHED`, `CONFIRMED`, timeout/failure. Следующий лог различит задержку интерфейса, ошибку назначения файла и реальный timeout.
- **Сохранность телеметрии:** записи diagnostics сериализованы через единую mutation-chain вместо конкурирующих read-modify-write. Лимит поднят до 2000 событий / 1.5 MB; модельные логи — до 120 записей с сохранением pinned-событий. Шум после терминального состояния фильтруется.
- **MD-экспорт:** перезагрузка окна результатов больше не очищает телеметрию; экспорт разрешён при наличии Run Summary даже без events/logs; `Blob` URL отзывается с задержкой, чтобы загрузка успела начаться.
- **Проверка:** профильные regression-тесты — 28/28. Полный прогон — 443/445 тестов; два оставшихся падения в `results-ui-recovery-triggers.test.js` существовали до этих изменений и не относятся к Gemini/телеметрии.
- Версии `manifest.json`, `package.json`, `package-lock.json` и README синхронизированы: 2.80.93.

### 2026-06-21 — Gemini: вложение не вставляется → drag&drop первым 2.80.88
Жалоба: на странице Gemini вложенный файл не вставляется (лог `20260621_08-47`; ранее у Gemini был `failed to attach … TIMEOUT`).
Корень: у `MODEL_CONFIG.Gemini` не было `strategies` → дефолт `['input']` (программный `input.files`), который Gemini игнорирует — тот же профиль, что у GPT/Qwen. Нужен drop.
- **`content-scripts/attachment-handler.js`** (`MODEL_CONFIG.Gemini`): `strategies: ['drop','input']`; добавлены `dropSelectors` по композеру Gemini (`div.ql-editor[contenteditable="true"]`, `rich-textarea div[contenteditable="true"]`, …). Drop идёт через тот же main-world bridge (`attachViaBridge(…, 'drop')` → `content-bridge.js`), аутентичный `DataTransfer`/`DragEvent` в контексте страницы; input остаётся фолбэком. `confirmSelectors` расширены дженерик-индикаторами (`img[src^="blob:"]`, remove-кнопка и т.п.), как у GPT 2.80.86.
- `npm test` — 81 suite / 412 зелёных. Версия 2.80.87 → 2.80.88.
- ⚠️ Проверяемо вживую: следующий прогон Gemini с вложением. Если drop не сядет — фолбэк на input как раньше. Точный `confirmSelectors` (чип файла Gemini) по-прежнему ждёт снимка живого DOM.

### 2026-06-21 — Убрано окно «failed to attach… Please attach manually» (все модели) 2.80.87
Жалоба: даже когда файл реально загрузился и запрос отправился, всплывало окно `GPT: failed to attach 1 file(s) automatically. Please attach manually.` Это окно ненадёжное по своей природе — оно завязано на `waitForUploadConfirmation`, который ложно-отрицателен (чип не совпадает с `confirmSelectors`), поэтому срабатывало и при успешной загрузке. Пользователь попросил убрать его у всех моделей.
- **`results.js`** (обработчик `ATTACHMENT_MANUAL_REQUIRED`): пользовательский попап `showNotification(...)` убран — единая точка для всех моделей (GPT/Claude/Gemini/Grok/Qwen/Perplexity шлют один и тот же тип сообщения). Событие по-прежнему фиксируется отдельным `LLM_DIAGNOSTIC_EVENT` в диагностике, просто без окна-прерывания.
- `npm test` — 81 suite / 412 зелёных. Версия 2.80.86 → 2.80.87.
- Прочее из того же прогона (`20260621_08-20`): «запрос не вставился → потом вставился и отправился», «file already added», «Process start: unexpected background response (no_response)» — это та самая осцилляция attach без достоверного сигнала загрузки; устранимо только живым `confirmSelectors` (см. 2.80.86). Окно manual-required к ним отношения не имеет и теперь не мешает.

### 2026-06-21 — GPT: откат short-circuit (файл переставал прикрепляться) 2.80.86
Жалоба после 2.80.85: **GPT вообще не вставил файл** (лог `20260621_07-51`: у GPT нет ни одного attach-события и нет `Manual attachment required`, но он всё равно дошёл до SUCCESS — т.е. ответил без файла).
Корень — регресс от `confirmOptional` (2.80.85): он считал успешный **диспатч** успехом, но `attachViaBridge` возвращает `true` за сам факт срабатывания события и **не знает**, долетел ли файл. Поэтому каскад обрывался после первого `drop(bridge)`; если именно он в этот прогон не сел (тайминг/неготовый композер), фолбэки (`drop(content)`/`paste`/`input`) уже не запускались → файл молча не прикреплялся. Это хуже дубликата: GPT отвечает не по файлу. Вдобавок мы не знаем достоверно, какой вектор реально грузит файл в 2.80.84 (мог быть не bridge-drop) — значит short-circuit отрезал рабочий путь.
- **`content-scripts/attachment-handler.js`**:
  - Убран `confirmOptional: true` у GPT (флаг и инфраструктура `tryVia` оставлены, дефолт `false` → каскад как в 2.80.84: надёжная вставка). **Надёжная загрузка важнее косметического дубликата.**
  - `confirmSelectors` GPT расширены дженерик-индикаторами загрузки (`img[src^="blob:"]`, `img[src^="data:image"]`, `button[aria-label*="Remove"/"Удалить"]`, `[class*="attachment"]`). Если confirm поймает реальное вложение — каскад остановится раньше и **дубликата не будет**; если промахнётся — безопасная деградация в «работает, но с предупреждением о дубликате», а не «пусто». `waitForUploadConfirmation` сверяет с baseline до вставки, поэтому существующие совпадения не дают ложного подтверждения.
- `npm test` — 81 suite / 412 зелёных. Версия 2.80.85 → 2.80.86.
- ⚠️ **Это финальная правка вслепую.** Дальше осцилляция «дубликат ↔ пусто» неустранима без достоверного подтверждения загрузки. Нужен снимок живого DOM прикреплённого файла ChatGPT (через расширение Claude in Chrome) → точный `confirmSelectors` → confirm станет истинным, дубликат уйдёт без риска «пусто».

### 2026-06-20 — GPT: файл вставлялся несколько раз («уже вставлен») 2.80.85
Жалоба после 2.80.84: drag&drop **заработал** — файл вставляется, грузится и отправляется (лог `20260620_23-13`: GPT SUCCESS, ответ 4798 симв.). Но ChatGPT ругается, что **файл уже был вставлен** → файл прикрепляется несколько раз.
Корень (из кода, без догадок по DOM): `confirmSelectors` GPT (`[data-testid*="attachment"]`, `[data-testid*="file"]`) **не совпадают** с реальным DOM прикреплённого файла ChatGPT, поэтому `waitForUploadConfirmation` даёт ложный TIMEOUT (в логе `23:10:53 Manual attachment required … TIMEOUT`, хотя файл реально загрузился). В `runStrategy` неуспех confirm считался неуспехом доставки, и каскад шёл дальше: для одной стратегии запускались И bridge, И content-fallback (`attachViaBridge` возвращает `true` за сам факт диспатча), затем следующие стратегии — drop(bridge)+drop(content)+paste(bridge)+paste(content)+input → один файл прикреплялся 4-5 раз.
- **`content-scripts/attachment-handler.js`**:
  - Новый флаг `confirmOptional` (только GPT): успешный **диспатч** доставляющей стратегии завершает каскад, даже если confirm не подтвердил. confirm по-прежнему пробуется первым (чистый успех, когда селекторы совпадут), но ложный TIMEOUT больше не приводит к повторным вставкам. Заодно убирает ложный warning «attach manually» для GPT.
  - Исправлен реальный баг каскада: helper `tryVia()` — если **bridge** уже доставил, content-fallback той же стратегии **не запускается** (раньше bridge-`true`+confirm-`false` всё равно тянул второй, дублирующий, диспатч). Для прочих моделей (`confirmOptional=false`) поведение идентично прежнему: фолбэк по-прежнему срабатывает, когда confirm не прошёл.
- `npm test` — 81 suite / 412 зелёных. Версия 2.80.84 → 2.80.85.
- ⚠️ **Остаётся вживую:** правильные `confirmSelectors` для прикреплённого файла ChatGPT (тогда confirm станет истинно-положительным, а не «optional»). Нужен снимок DOM чипа — Chrome в этой сессии не подключён. Тот же латентный двойной-диспатч возможен у **Qwen** (`['drop','input']`); если всплывёт «файл уже добавлен» в Qwen — включить `confirmOptional` и там.

### 2026-06-20 — GPT: вложение вставляется, но не догружается → drag&drop первым 2.80.84
Жалоба (повтор): **файл вставляется на странице GPT (чип появляется), но не грузится; при этом ручной Ctrl+V и выбор через Finder загружают успешно.**
Этот же баг чинили вслепую дважды — 2.80.35 (добавили синтетический `paste`) и 2.80.76 (поставили `paste` первым) — и оба раза с пометкой «требует проверки на живом ChatGPT». Раз симптом повторяется, синтетический `ClipboardEvent('paste')` **не доставляет файл** в загрузку ChatGPT: вероятнее всего ChatGPT обрабатывает `clipboardData` только у доверенного события (`isTrusted`), поэтому работает лишь настоящий Ctrl+V, а программная вставка лишь иногда «садится». Программный `input.files` ChatGPT тоже игнорирует (чип появляется, загрузка не идёт).
Решение зеркалит уже доказанный фикс **Qwen** («не вставляется через Ctrl+V, но Finder и Drag&Drop работают»): synthetic **drop** с настоящим `DataTransfer`, собранным в контексте страницы через main-world bridge, не гейтится `isTrusted` и читается drop-обработчиком ChatGPT как реальная загрузка.
- **`content-scripts/attachment-handler.js`** (`MODEL_CONFIG.GPT`): `strategies: ['drop','paste','input']` (было `['paste','input']`); добавлены `dropSelectors` (`#prompt-textarea`, `form div[contenteditable="true"]`, `main form` и т.д.). Каждый шаг по-прежнему гейтится `waitForUploadConfirmation`, поэтому застрявший input-чип не даёт ложного «подтверждено» и не пропускает рабочие drop/paste пути. Drop идёт через тот же `attachViaBridge(…, 'drop')` → `content-bridge.js` `tryDrop`/`dispatchDrop`, что и Qwen (нулевой новый код в bridge).
- `npm test` — см. ниже. Версия 2.80.83 → 2.80.84.
- ⚠️ **Проверяемо только вживую (Chrome не подключён в этой сессии):** следующий прогон GPT с вложением должен показать реальную загрузку файла на сервер (не только появление чипа). Если drop не сядет — фолбэк на paste/input сработает как раньше. Если и drop не грузит, следующий шаг — гейтить подтверждение по исчезновению спиннера загрузки (`confirmGoneSelectors`), но для этого нужен снимок DOM прикреплённого файла ChatGPT.

### 2026-06-19 — Главная: разросшееся поле ввода больше не наезжает на блоки ниже 2.80.83
Жалоба: на главной при добавлении большого количества строк `.prompt-container` растягивается и в какой-то момент наезжает на расположенные ниже блоки. Причина не в самом авто-росте (2.80.65/66), а в раскладке до отправки: `body:not(.pipeline-page) .app-main .container + .llm-controls` тянет `.llm-controls` вверх большим отрицательным `margin-top` (`clamp(-230px, 30px - 30dvh, -90px)`), чтобы прижать их под вертикально-центрированное маленькое поле. Этот сдвиг рассчитан на фиксированную высоту поля — когда поле растёт вниз от центра, оно врезается в подтянутые вверх controls.
- **`styles/app-controls.css`**: когда поле авто-разрослось (`.prompt-container.is-prompt-autogrown`) и запрос ещё не отправлен (`:not(.prompt-submitted)`), переходим к естественному потоку — те же правила, что и для режима с чипами: `.input-section { display:block; min-height:0; padding-top: clamp(120px, 50dvh-164px, 260px) }` и `.llm-controls { margin-top:20px }` (отрицательный сдвиг отменяется). После отправки действуют существующие `.prompt-submitted`-правила, поэтому ограничено `:not(.prompt-submitted)`.
- Только CSS; класс `.is-prompt-autogrown` уже выставляется `autoGrowPromptInput`. `npm test` — 81 suite / 412 зелёных. Версия 2.80.82 → 2.80.83.

### 2026-06-19 — Grok: вставка как настоящий Ctrl+V (только text/plain) 2.80.82
Ключ от пользователя: **ручной Ctrl+V в Grok вставляет промпт успешно.** Значит ProseMirror корректно обрабатывает настоящую вставку `text/plain` с переносами строк — проблема в программном пути.
Корень: общий `pasteTextFirst` (`content-utils.js`) кладёт в `DataTransfer` И `text/plain`, И `text/html` = тот же плоский текст. ProseMirror предпочитает `text/html` и парсит плоский текст как HTML → многострочный промпт ломается. Настоящий Ctrl+V отдаёт **только `text/plain`**.
- **`content-grok.js`**: новая `grokPasteText()` — повторяет ручной Ctrl+V: `ClipboardEvent('paste')` с `DataTransfer`, где задан **только `text/plain`**; ProseMirror сам разбивает по переносам на абзацы. Самопроверка: ждёт, что в композере появилась полная «голова» промпта (120 симв.), а не только первая строка; иначе откатывается на прежний `pasteTextFirst`. Поставлена первым методом вставки.
- `npm test` — 81 suite / 412 зелёных. Версия 2.80.81 → 2.80.82.
- ⚠️ Проверяемо вживую: следующий прогон Grok + `GROK_COMPOSER_SNAPSHOT` (2.80.81) подтвердит, что `composerLines==promptLines` и `matchesPrompt=true`.

### 2026-06-19 — Grok layer-1: инструментирование вставки в композер (закреплённый снимок) 2.80.81
Grok-сбой («вставляет только первую строку») — это слой ВВОДА в `content-grok.js`, который мы ни разу не могли наблюдать: диагностика вставки тонула в FIFO-кэше логов (60 записей на модель) задолго до экспорта. Хватит чинить вслепую — делаю слой наблюдаемым.
- **`content-grok.js`** (после валидации вставки, перед send): закреплённый `GROK_COMPOSER_SNAPSHOT` (`type:'TELEMETRY'`) — реальное содержимое ProseMirror-композера ДО отправки: `composerChars/composerLines` против `promptChars/promptLines`, `matchesPrompt`, `composerHead/promptHead`. Если `composerLines==1` при `promptLines>1` — многострочная вставка режется; head покажет, что именно осталось.
- **`telemetry-logs.js`** (`dispatchTelemetry`): закреплённые лейблы (`PINNED_LABELS`) больше не выкидываются 5%-сэмплингом на входе (раньше пин защищал только уже сохранённые записи от прунинга, но не от сэмплинга при приёме). `GROK_COMPOSER_SNAPSHOT` добавлен в `PINNED_LABELS`. Заодно это чинит потерю прочих важных content-телеметрий при сэмплинге.
- `npm test` — 81 suite / 412 зелёных. Версия 2.80.80 → 2.80.81.
- ⚠️ Это диагностический шаг: сам фикс вставки сделаю по факту следующего лога Grok (где будет виден `GROK_COMPOSER_SNAPSHOT`), а не по догадке. Наиболее вероятный корень уже локализован — `humanoid.replaceContentEditableText` → `execCommand('insertText', …)` с переносами строк в ProseMirror; снимок это подтвердит или опровергнет.

### 2026-06-19 — «Подозрительное ≠ зелёное»: не воскрешать провал из фейкового ответа 2.80.80
Архитектурный разбор лога `All Logs 20260619_20-58.md` (2.80.79). Гард 2.80.79 сработал (`DOM snapshot recovery blocked (submit unconfirmed)` ×6, Gemini дал реальный 3246 после ручного фокуса). Но всплыл другой класс ложного зелёного — **финализаторы-«воскресители»**, которые делают SUCCESS из фейкового текста:
- **Claude `len=394 (suspect short)`**: ответ был распознан как `answer_prompt_echo` → `EXTRACT_FAILED`, но затем `TERMINAL_FAILURE_BLOCKED_BY_ANSWER_EVIDENCE` **воскресил** сохранённый эхо-текст обратно в SUCCESS — путь `preserved_answer_evidence` не перепроверял, что это эхо.
- **`job-orchestrator.js`** (`handleLLMResponse`, блок `terminal_failure_blocked_by_answer_evidence`, ~6691): теперь перед воскрешением проверяется, что `preservedAnswer` — РЕАЛЬНЫЙ ответ: не prompt-echo (`isPromptEchoAnswerCandidate`) и не suspect-short (`AnswerLengthPolicy.suspectShortSuccess`). Иначе — честный `RECOVERABLE_ERROR` + `PRESERVED_EVIDENCE_REJECTED` (закреплено в `PINNED_LABELS`). Реальные ответы (приходят по lifecycle-пути, не через failure-preservation) не затронуты.
- `npm test` — 81 suite / 412 зелёных (новый `tests/prompt-echo-suspect-not-green.test.js`). Версия 2.80.79 → 2.80.80.

Важно по **Grok** (отдельным разбором, без правок в этом коммите): его `len=206 (suspect short, forced_success_with_text)` — это **НЕ** проблема финализации. Существующий `isPromptEchoAnswerCandidate` уже ловит любой чистый префикс промпта (ветка overlap), а 206 им не ловится → значит это не чистый префикс, а **реальный короткий ответ Grok на ОБРЕЗАННЫЙ промпт**: в композер попадает только первая строка. Это **слой ввода (layer-1)** в `content-grok.js`, а не оркестратор. Диагностировать вслепую нельзя — инструментирую вставку отдельным шагом (запинить `Prompt injected length` + снимок содержимого композера), чтобы следующий лог дал факт, а не догадку.

### 2026-06-19 — «Зелёное» на старом ответе: основной гард по подтверждению отправки (submit-confirmation) 2.80.79
По логу `All Logs 20260619_00-13.md` (уже на 2.80.78) baseline-гард 2.80.78 **не сработал**: ни одного события `DISPATCH_BASELINE_CAPTURED`/`RECOVERY_STALE_BASELINE_REJECTED`, а Gemini и Perplexity снова финализировались на старом ответе через `dom_snapshot_recovery` (len=2435 / 2953).
Причина провала baseline-подхода — он зависел от контент-скрипта, который и отказывает: у Gemini вкладка получает фокус лишь на ~655 мс (`TAB_VISIT_SHORT`), скрипт не успевает дойти до `reportDispatchBaseline`; плюс сравнение текста «в лоб» между двумя разными экстракторами (grab vs inline_executeScript) хрупкое.
Правильный инвариант — **в фоне, без контент-скрипта**: на повторной отправке новый ответ невозможен, пока промпт реально не отправлен. У Gemini в логе submit так и не подтвердился (`submit confirmation still pending`), но recovery всё равно принял снапшот старого ответа.
- **`job-orchestrator.js`** (`recoverAnswerViaDomSnapshot`, в самом начале — до траты бюджета): новый submit-confirmation гард. Если для текущего dispatch нет подтверждённой отправки (`promptSubmittedAt` / `submitSource='content'|'inferred_answer_evidence'` / `confirmedDispatchId===dispatchId`) И нет признаков нового ответа (`answerCompleteDetectedAt`/`lifecycleReadyAt`) — recovery отклоняется (`RECOVERY_BLOCKED_SUBMIT_UNCONFIRMED`, событие закреплено в `PINNED_LABELS`), модель остаётся НЕ терминальной. Есть явный обход `meta.allowUnconfirmedRecovery` (не используется по умолчанию).
- Это снимает именно «ложь» (зелёное на старом ответе) у Gemini и Perplexity, не завися от фокуса вкладки. Baseline-гард 2.80.78 оставлен как defense-in-depth для случая «submit подтверждён, но прочитался старый ответ».
- `npm test` — 80 suites / 407 зелёных (расширен `tests/dispatch-baseline-stale-guard.test.js`). Версия 2.80.78 → 2.80.79.
- ⚠️ Это делает телеметрию ЧЕСТНОЙ, но НЕ заставляет Gemini отправлять. Отдельный корень — **голодание по фокусу**: один визит 655 мс, дальше фокус держат стримящие GPT/Claude, а ввод Gemini требует сфокусированной вкладки (~3 с: `sleep(1000)`+композер+`sleep(2000)`). Это следующий фикс (планировщик визитов), не входит сюда.

### 2026-06-18 — Повторный запрос в ту же вкладку: защита от «зелёного» старого ответа (baseline-гард) 2.80.78
Жалоба по повторной отправке в уже открытую беседу (`attach_existing`): на странице уже висит ПЕРВЫЙ ответ, и пайплайн финализирует именно его — телеметрия зелёная, но это старый ответ.
Разбор лога `All Logs 20260618_23-05.md` показал один общий корень для Gemini/DeepSeek/Perplexity:
- **Gemini** — submit так и не подтвердился (`ROUND2_REPAIR_DISPATCH_PENDING`), затем `recoverAnswerViaDomSnapshot` принял старый ответ (`len=2435`) → `SUCCESS — dom_snapshot_recovery`. То есть реально не отправилось, а «зелёное» — это снапшот прошлого ответа.
- **DeepSeek/Perplexity** — `ANSWER_START_DETECTED` приходит сразу на полную длину (5649 / 2953) и мгновенно стабилен = это прежний ответ, принятый за новый.
- Эталон — **Claude**: ловит `claudeDispatchBaseline` (ответ на странице) ДО отправки и отбраковывает кандидата, равного ему. У остальных адаптеров и у фонового recovery такого гарда не было.

Что сделано (фон-гард + проводка, как выбрано — «background guard first»):
- **`content-utils.js`** — `reportDispatchBaseline(llmName, meta, text)`: нормализует текущий ответ-на-странице (та же нормализация, что `normalizeAnswerSignatureBg` в фоне: `\s+`→' ', `trim`, `toLowerCase`) и шлёт `DISPATCH_BASELINE_CAPTURED` ДО отправки (переживает неподтверждённый submit — кейс Gemini).
- **`content-gemini.js` / `content-deepseek.js` / `content-perplexity.js`** — после нахождения композера, перед отправкой, репортят baseline (`grabLatestAssistantMarkup().text` / `grabLatestAssistantText().text`).
- **`message-router.js`** — кейс `DISPATCH_BASELINE_CAPTURED`: пишет `entry.preDispatchAnswerSignature/…DispatchId/…CapturedAt`; пустой baseline (новый чат) гард не включает.
- **`job-orchestrator.js`** — `isStaleBaselineCandidate(entry, text, dispatchId)` (окно `BASELINE_GUARD_WINDOW_MS=120s`, привязка к dispatchId): (а) `recoverAnswerViaDomSnapshot` отклоняет снапшот, равный baseline (рефанд бюджета + `RECOVERY_STALE_BASELINE_REJECTED`); (б) `handleLLMResponse` игнорирует ответ, равный baseline (`STALE_BASELINE_ANSWER_IGNORED`). Оба события закреплены в `PINNED_LABELS`.
- Первый запрос (новый чат) не затронут: baseline пустой → гард выключен. Окно 120с не даёт «заклинить» прогон, если новый ответ окажется байт-в-байт прежним.
- `npm test` — 80 suites / 401 зелёных (новый `tests/dispatch-baseline-stale-guard.test.js`). Версия 2.80.77 → 2.80.78.
- ⚠️ Завязано на живой DOM провайдеров — финальная проверка только вживую (повторная отправка в открытые вкладки Gemini/DeepSeek/Perplexity).
- TODO (отдельными коммитами): порт baseline в Grok + Le Chat/Qwen; и отдельный баг Grok — вставка многострочного промпта в ProseMirror теряет всё после первой строки (вставляется только префикс «Ссылайся на следующее содержимое:»).

### 2026-06-18 — Телеметрия: убран лишний тост «Diagnostics logs cleared» 2.80.77
Жалоба: после очистки окно телеметрии и так визуально пустеет — лишний подтверждающий тост «Diagnostics logs cleared.» не нужен.
- **`results.js`** (`clearDiagnosticsView`): удалён вызов `showNotification('Diagnostics logs cleared.')`. Сама очистка (`llmLogs` + `renderDiagnosticsModal`) не тронута; касается обоих путей — кнопки очистки панели Logs и события `diagnostics-clear-request` от кнопки «clear all» окна телеметрии.
- `npm test` — 79 suites / 389 зелёных. Версия 2.80.76 → 2.80.77.

### 2026-06-18 — Вложения: авто-сброс после отправки + стратегии загрузки GPT/Qwen 2.80.76
Запрос пользователя по файлам-вложениям (три пункта).
1. **Авто-сброс после отправки** (`results/attachments.js`, `results.js`): новый `clearPromptAttachments()` (чистит `attachedFiles` + `attachmentKeys` + значение `input[type=file]`, ре-рендер бара). Вызывается после успешной отправки на главной (рядом с `resetPromptInputSize`) и в `finally` прогона дебата — файл больше не уезжает повторно со следующим запросом в те же открытые вкладки. Тест в `tests/attachments.test.js`.
2. **GPT — файл вставлялся, но не догружался** (`attachment-handler.js`, `content-bridge.js`): причина — bridge/`input` отрабатывали ПЕРВЫМИ, программно выставленный `input.files` ChatGPT игнорирует (чип появляется, но загрузка не идёт), а ложное подтверждение по селектору чипа пропускало paste-путь. Теперь у GPT `strategies: ['paste','input']` — paste (как ручной Ctrl+V, который у пользователя работает) идёт первым, `input` лишь как последний фолбэк.
3. **Qwen — не вставляется через Ctrl+V, но работает Finder и Drag&Drop** (`attachment-handler.js`, `content-bridge.js`): у Qwen `strategies: ['drop','input']`; добавлен drag&drop как стратегия — основной путь через main-world bridge (`mode:'drop'`, аутентичный `DataTransfer`/`DragEvent` в контексте страницы), плюс content-script `attachViaDrop` как фолбэк; paste для Qwen не используется (бесполезен).
- Инфраструктура: `EXT_ATTACH` в bridge теперь понимает `mode` (`drop`/`paste`/`input`/`auto`) и дефолтные селекторы композера; `attachViaBridge(…, mode)`; `attach()` гоняет упорядоченный per-model список стратегий (bridge → content-fallback → подтверждение). Для прочих моделей поведение прежнее (default `['input']`, у preferPaste — `['paste','input']`).
- `npm test` — 79 suites / 389 зелёных. Версия 2.80.75 → 2.80.76.
- ⚠️ Загрузка файлов завязана на живые DOM провайдеров — пункты 2/3 проверяемы только вживую на страницах GPT и Qwen.

### 2026-06-18 — Стабилизация: debate-рантайм → явный FSM (DebateFSM) 2.80.75
Реализация плана `global-code-review-2026-06-18.md` — Phase 3 (F-C). Самый рискованный остров — сделан инкрементально, под защитой `results-debate-favorites.test.js`, поведение сохранено.
- **`disput/debate-runtime.js`** (новый, чистый dual-context `DebateFSM`) — единый источник истины для машины состояний дебата:
  - **форма состояния** `createState()` — заменил ДВА разошедшихся инициализатора в results.js (литерал на 14784 был без `newPagesOpenedModels`);
  - **phase-gate A0/B0** (disput-logic §8/§22): `canRoutePublic`/`beginOpenings`/`recordOpeningA`/`recordOpeningB`;
  - **A/B-routing** `applyApprovedRoutingTargets`;
  - **статус-жизненный цикл** `markRunning`/`markPaused`/`markCompleted`/`markError`/`markCancelled` + `STATUSES`;
  - **прогрессия ходов** `computeRound`/`hasReachedTurnLimit`/`shouldAutoContinue`;
  - **чистые мапперы** `turnKind`/`turnStatus`/`mapMessageStatusToTurnStatus`/`normalizeBoolean`/`normalizeKind`.
- **`results.js`**: проведён через FSM в **26 делегирующих сайтах** — имена helper'ов и call-sites сохранены, поведение идентично. Убраны два инлайновых литерала состояния, инлайновые phase/status/round-мутации.
- **Подключение**: `result_new.html` + `pipeline_panel.html` (перед results.js) + 2 тест-харнесса, исполняющих results.js (`results-debate-favorites`, `modifier-bootstrap-reset`).
- **Тесты**: `tests/debate-runtime.test.js` (shape/Sets-изоляция, A0/B0-gate, routing, статус-переходы, computeRound, гварды, мапперы); regression-guard «opening-phase gate» в `release-log-regressions.test.js` обновлён — гейт теперь живёт в FSM (проверяется и results.js, и сам модуль).
- **Граница (честно):** вынесена вся машина состояний и чистая логика решений (риск низкий, −68 строк нетто). UI-оркестрация дебата (dispatch/approval/cancel/pause через DOM+`runModelBatch`) остаётся контроллером в results.js — её вынос требует массивного DI и браузерного смоука (jsdom не покрывает async dispatch), это отдельный высокорисковый заход (`monolith-decomposition-plan.md`). Суть F-C закрыта: явный FSM теперь владеет debate-потоком.
- `npm test` — **79 suites / 388 зелёных** (+1 suite, +7). Версия 2.80.74 → 2.80.75.

### 2026-06-18 — Стабилизация: контракт порядка загрузки content-scripts + opt-in бандлер; коррекция F-B 2.80.74
Реализация плана `global-code-review-2026-06-18.md` — Phase 1 (F-A) и пересмотр Phase 2 (F-B).
- **Phase 1 — контракт порядка загрузки (F-A).** Расширение **сознательно** не имеет build-шага для content-scripts (raw-инжект, чтобы не было drift — README + gitignore `dist/`). Поэтому **манифест не переключался** на бандл (это решение владельца: cutover вводит rebuild-before-reload). Вместо этого неявный контракт сделан явным и проверяемым:
  - **`tests/content-load-order.test.js`** — для каждого co-injected набора (shared-блок ∪ провайдерский блок, 37 файлов): все файлы существуют; **0 коллизий** top-level `const`/`let`/`class` (защита от случайного клоббера глобалов + гарантия бандлируемости).
  - **`scripts/build-content-bundle.js`** (`npm run build:content-bundle`) — opt-in **конкатенирующий** бандлер (не esbuild: classic-скрипты с общим isolated-world scope; модульный бандлинг сломал бы их). Пишет `dist/content-bundles/*.bundle.js` (gitignored). Все 8 бандлов проходят `node --check` — эмпирическое доказательство эквивалентности последовательной инжекции.
- **Phase 2 — находка F-B пересмотрена (кода не меняли).** Детальный разбор: `withSmartScroll` закрывается над per-adapter координатором и уже делегирует в `ContentUtils`; `attachFilesToComposer` — 8 разных тел; `isElementInteractable`/`findAndCacheElement` — по 5 разных. `BaseLLMAdapter` реально инстанцируется всеми 8; общая логика уже в `ContentUtils`/`UnifiedAnswerPipeline` (139 ссылок). Это не «8 копий», а 8 провайдер-специфичных реализаций. **Безопасного автоматического дедупа нет**; слияние разошедшихся тел — пер-провайдерный рефактор с обязательным браузерным смоуком (вне автономного объёма). Рискованных правок в 8 content-скриптов не вносилось.
- `npm test` — **78 suites / 368 зелёных** (+1 suite, +3). Версия 2.80.73 → 2.80.74.

### 2026-06-18 — Стабилизация: единый logger с уровнями, тишина release-логов в background 2.80.73
Реализация плана `global-code-review-2026-06-18.md` — Phase 4 (F-D).
- **`shared/logger.js`** (новый, dual-context): `LLMLog` с уровнями. `error`/`warn` — **всегда**; `debug`/`info`/`log` — за флагом, **по умолчанию OFF**. Флаг включается без пересборки: `chrome.storage.local {"__llm_debug_logging__": true}` или `globalThis.__LLM_DEBUG__=true` (+ live-реакция на `storage.onChanged`).
- **Конвертация background:** все **119** `console.log`/`console.info` (116 + 3) → `globalThis.LLMLog?.debug?.(`/`?.info?.(`. `console.warn` (92) и `console.error` (39) **не тронуты** — реальные проблемы остаются видимыми. В MV3 SW это снимает шум на каждом dispatch/retry/load, не пряча структурную телеметрию.
- **Почему такой синтаксис вызова:** optional-chaining по свойству `globalThis` — безопасный no-op в любом контексте, где logger не установлен, включая изолированные `vm.runInContext` песочницы background-тестов. **Ноль изменений в тестах.** logger подключён первым в `background/index.js` importScripts (до module-load вызовов).
- **Тест `tests/logger.test.js`** (5 кейсов): установка на global, тишина debug/info по умолчанию, всегда-видимые warn/error, включение гейта, безопасность паттерна вызова при отсутствии logger.
- `npm test` — **77 suites / 365 зелёных** (+1 suite, +5). Версия 2.80.72 → 2.80.73.

### 2026-06-18 — Стабилизация: редактирование секретов в экспортах + гигиена репо 2.80.72
Реализация плана `global-code-review-2026-06-18.md` — Phase 5 (F-E) и Phase 6 (F-F).
- **Phase 5 — редактирование секретов (новый слой защиты).** Раньше «не логировать ключи» было только соглашением (README + `utils/api-key-storage.js`), без принуждения. Добавлен `shared/secret-redaction.js` — чистый dual-context редактор: маскирует значения под secret-именами полей (`apiKey/authorization/cookie/__api_session__`…) и формы ключей провайдеров (`sk-…`, `sk-ant-…`, `xai-…`, `AIza…`, `pplx-…`, JWT, `Bearer …`) в любом свободном тексте; защита от циклов/глубины. Подключён в **реальные пути экспорта**: `results-devtools.js` (JSON-экспорт телеметрии + копирование), `results.js` (`buildAllLogsMarkdown` — исторически утёкшая поверхность из дефекта run 1781134505984), `result_new.html`/`pipeline_panel.html` (script), `background/index.js` (importScripts). Везде безопасный фолбэк на обычный stringify, если модуль не загрузился.
- **Тест `tests/secret-redaction.test.js`** (7 кейсов): маскирование по именам полей и по формам ключей, «ключ в каждом поле telemetry-shaped payload не утекает», сохранение неసекретных данных/структуры, циклы/Date/глубина, regression-guard (наивный stringify утёк бы — редактированный нет).
- **Phase 6 — гигиена.** Удалён протухший `dist/` из рабочего дерева (untracked, регенерится `build:bundles`); untrack LibreOffice-lock `SelectorPicker/.~lock.…docx#` + паттерн `.~lock.*#` в `.gitignore`; README — счётчик тестов 74/347 → 76/360 с пометкой «snapshot, см. `npm test`».
- `npm test` — **76 suites / 360 зелёных** (+1 suite, +7 тестов). Версия 2.80.71 → 2.80.72.

### 2026-06-18 — Grok: чистим черновик в поле и ловим загрязнённую вставку 2.80.71
Жалоба + диагностический лог (`All Logs 20260618_16-13.md`): Grok иногда не вставляет запрос, иногда вставляет «непонятно откуда взявшееся» «Ссылайся на следующее содержимое:». Поиск по коду: такой строки в расширении нет — значит это **посторонний текст в самом поле Grok** (в логе все вкладки — `attach_existing`, т.е. подхват уже открытой беседы; Grok восстанавливает несохранённый черновик). Усугублялось двумя дефектами вставки в `content-grok.js`:
- единственная зачистка поля шла через `pasteTextFirst` (execCommand selectAll/delete) — на rich-редакторе Grok ненадёжно;
- валидация вставки проверяла `normalizedValue.includes(promptHead)`, поэтому **лишний текст ПЕРЕД промптом не детектился** (включает промпт → ок) — и загрязнённый запрос уходил на отправку.
- **`content-grok.js`**: добавлен `clearComposer()` — надёжная очистка поля (execCommand + нативная установка пустого `value`/`textContent` + события input/change), вызывается **перед** вставкой. Валидация ужесточена: поле должно **начинаться** с промпта (`startsWith`), а не просто содержать его; при постороннем тексте впереди — `clearComposer` + `forceComposerValue` (полная пересборка поля). Это убирает «приклеенный» черновик и заодно повышает надёжность собственно вставки.
- Примечание: интермиттентная «не отправка» в логе — это задержка подтверждения сабмита (ROUND2_REPAIR_DISPATCH/awaiting_delayed_confirmation), её машинерия уже отрабатывает; данная правка чинит чистоту/надёжность вставки, не трогая логику подтверждения.
- `npm test` — 75 suites / 353 зелёных. Версия 2.80.70 → 2.80.71.

### 2026-06-18 — Телеметрия: экспорт MD/JSON уважает активный фильтр окна 2.80.70
Жалоба: фильтры в окне телеметрии работают, но экспорт **MD** и **JSON** выгружает все платформы даже при выбранной одной модели. Причина: оба экспорта брали полный набор событий мимо фильтра — JSON из `telemetryScopedCache` (комментарий специально обходил UI-таблицу из-за её капа 250 и пустышки при «нет фильтра»), а MD через `bridge.getLatestEvents()` (весь `telemetryCache`).
- **`results-devtools.js`**: добавлены `applyActiveTelemetryFilter(events)` (применяет выбранную модель/платформу/тип/пресет **без** UI-капа 250; при отсутствии фильтра возвращает всё — полнота экспорта сохранена) и `getActiveTelemetryPlatformNames()`/`isTelemetryFilterActive()`. Экспонированы через bridge (`applyActiveFilter`, `getActivePlatformNames`, `isFilterActive`). `exportTelemetryJson` теперь фильтрует базу через `applyActiveTelemetryFilter`.
- **`results.js`**: `getTelemetryEventsForExport` применяет `bridge.applyActiveFilter` к смёрженным (bridge+runtime) событиям — общий MD/HTML/JSON путь экспорта телеметрии уважает фильтр. MD-экспорт «All Logs» дополнительно сужает секции диагностических логов до выбранных моделей (`getActiveTelemetrySourceFilter` по `bridge.getActivePlatformNames`).
- Поведение без фильтра не изменилось (выгружается всё). jsdom-репро: при `platform=gpt` JSON содержит GPT и не содержит Claude; без фильтра — обе платформы.
- `npm test` — 75 suites / 353 зелёных. Версия 2.80.69 → 2.80.70.

### 2026-06-18 — Debate: prompt-container растёт вместе с textarea при закрытой ленте 2.80.69
Жалоба: на странице debate `.prompt-container` должен вести себя как на главной — при расширении textarea сейчас контейнер «расплывается» (текст вылезает за рамку). Происходит только при **закрытой ленте** (`:not(.has-debate-feed)`); при открытой рост идёт вверх, низ зафиксирован — там ок. Причина та же, что в 2.80.66 для главной: композер дебатов при закрытой ленте жёстко зафиксирован (`height/max-height: 122px`), а вложенный `.mod-middle` — `height: 66px`; растущая `#modTa` (`growTA`/`autoGrowDebateTextarea`) вылезала за рамку.
- **`results.js`** (`autoGrowDebateTextarea`): для `#modTa` при закрытой ленте теперь поведение как на главной — рост до **12 строк** (`lineHeight*12 + паддинги`), внутренний скролл сверх лимита, и на композер вешается класс `.is-prompt-autogrown`. При открытой ленте всё по-прежнему (кап 120px, рост вверх, класс снимается). `syncPromptSandwichLayoutState` пересчитывает высоту поля при смене состояния ленты.
- **`styles/modals-responsive.css`**: при `.debate-composer.is-prompt-autogrown:not(.has-debate-feed)` контейнер и `.mod-middle` получают `height: auto; max-height: none` с нижними границами `min-height: 122px` / `66px` (дефолт сохраняется, рост — вниз, без вылезания за рамку).
- `npm test` — 75 suites / 353 зелёных. Версия 2.80.68 → 2.80.69.

### 2026-06-18 — Телеметрия: фильтры не сбрасываются авто-рефрешем 2.80.68
Жалоба: в окне телеметрии не работают фильтры (`#telemetry-tabpanel … .devtools-select`). Диагностика (jsdom-репро на реальном `results-devtools.js`): сама логика фильтрации цела — выбор платформы/типа/пресета корректно сужает таймлайн (и с выбранными моделями, и без). Реальная причина — **авто-рефреш**: пока активна вкладка телеметрии, `setInterval(refreshTelemetry, 2500)` на каждый приход новых событий вызывал `syncTelemetryPlatformOptions`/`syncTelemetryTypeOptions`, которые **безусловно** делали `clearNode()` + пересборку `<option>` у select'ов. Во время стрима событий (≈каждые 2.5с) это закрывало раскрытый список прямо в момент выбора и могло сбросить выбранное значение — фильтры «не работают».
- **`results-devtools.js`**: `syncTelemetryPlatformOptions`/`syncTelemetryTypeOptions` стали идемпотентными — новый помощник `selectOptionValuesMatch()` сравнивает текущий набор `value` с желаемым и **пересобирает options только когда набор реально изменился**. При стабильном наборе (те же модели/типы событий) select не трогается → раскрытый список и выбранный фильтр сохраняются. Текущее значение по-прежнему валидируется (если выпало из набора — сбрасывается в `all`).
- `npm test` — 75 suites / 353 зелёных. Версия 2.80.67 → 2.80.68.

### 2026-06-18 — Favourite: панель прокручивается в зону видимости при добавлении 2.80.67
Жалоба: «перестала появляться карточка Favourite» (при добавлении фрагмента через всплывающий тулбар или карточки целиком через звезду). Диагностика (jsdom-репро на реальном `results.js`): логика избранного цела — секция создаётся, становится `display:block`, наполняется контентом даже когда карточка-источник развёрнута. Реальная причина — **видимость**: панель Favourite вставляется наверху страницы (перед `.llm-results`), а избранное теперь часто добавляют из **развёрнутой карточки-оверлея** (`position: fixed`, по центру экрана) или со скролла вниз — панель появляется за кадром (выше вьюпорта/за оверлеем), и кажется, что она «не появилась».
- **`results.js`**: новый помощник `scrollFavoritePanelIntoView()` (scrollIntoView секции, `block:'nearest'`, smooth) вызывается в `addFavoriteEntry()` после рендера — при добавлении нового избранного панель прокручивается в зону видимости (поверх центрального оверлея, в верхнем поле). Вызывается только при добавлении записи, не на каждом ре-рендере (правка избранного не дёргает скролл).
- `npm test` — 75 suites / 353 зелёных. Версия 2.80.66 → 2.80.67.

### 2026-06-18 — Авто-рост поля ввода: расширять весь .prompt-container, а не только textarea 2.80.66
Фоллоу-ап к 2.80.65: авто-рост менял высоту только у `textarea`, но контейнер `.prompt-container.prompt-sandwich` до первой отправки жёстко зафиксирован (`height/max-height: 122px`), а сама textarea CSS-ограничена `max-height:120px`. В итоге растущий текст вылезал за рамку контейнера («расплывался»).
- **`styles/modals-responsive.css`**: добавлено правило `.prompt-container.prompt-sandwich.is-prompt-autogrown:not(.debate-composer)` — `height:auto; max-height:none; min-height:122px; justify-content:flex-start` (зеркалит уже существующее поведение `body.prompt-submitted`, чтобы контейнер рос вместе с полем; дефолтная нижняя граница 122px сохранена).
- **`results.js`** (`autoGrowPromptInput`): теперь (1) снимает CSS-кап textarea, выставляя инлайн `max-height` под 12 строк (иначе поле упиралось в 120px ≈ 5 строк), и (2) переключает класс `.is-prompt-autogrown` на контейнере, когда поле выросло выше дефолта. `resetPromptInputSize()` дополнительно чистит инлайн `max-height` и снимает класс — возврат к дефолту после отправки.
- `npm test` — 75 suites / 353 зелёных. Версия 2.80.65 → 2.80.66.

### 2026-06-18 — Поле ввода запроса: авто-рост до 12 строк, сброс после отправки 2.80.65
Жалоба/запрос: поле ввода запроса (`#prompt-input`) должно растягиваться по мере набора (добавлять строку), максимум до 12 строк; после отправки — возвращаться к размеру по умолчанию.
- **`results.js`**: добавлены `autoGrowPromptInput()` (высота = `scrollHeight`, ограничена 12 строками: `lineHeight*12 + paddingTop + paddingBottom`; при превышении включается внутренний скролл `overflow-y:auto`) и `resetPromptInputSize()` (сброс инлайн-`height`/`overflowY` → CSS-дефолт `min-height:142px`). Авто-рост вешается на `input` и вызывается при инициализации; работает только для главного поля (не для модераторского `#modTa`, у него свой `autoGrowDebateTextarea`). CSS `min-height` удерживает нижнюю границу (дефолт ~6 строк), поэтому поле не схлопывается ниже исходного.
- **`results.js`** (`startButton` click): после успешной отправки запроса вызывается `resetPromptInputSize()` — поле возвращается к размеру по умолчанию (текст сохраняется, при необходимости скроллится).
- `npm test` — 75 suites / 353 зелёных. Версия 2.80.64 → 2.80.65.

### 2026-06-18 — Развёрнутая карточка: ещё +3% высоты и центрирование по вертикали окна 2.80.64
Продолжение 2.80.63.
- **`results.js`**: `EXPANDED_PANEL_OUTPUT_MAX_HEIGHT` 493px → **508px** (ещё +3% к высоте развёрнутой карточки, растёт вниз). `scrollIntoView` при разворачивании убран — карточка теперь центрируется в окне и видна всегда.
- **`styles/results-debate.css`**: развёрнутая карточка переведена с `position: absolute; top:0` (прижатие к верху сетки) на `position: fixed` с центрированием по обеим осям (`top/left:50%` + `translate(-50%,-50%)`) — **равные отступы сверху и снизу от края экрана**. Ширина ограничена `min(var(--center-max-width), 100vw-32px)`, высота — `calc(100vh - 32px)` с `overflow: hidden`, чтобы карточка не вылезала за экран. Убран ставший ненужным `position: relative` у `.llm-results`.
- `npm test` — 75 suites / 353 зелёных. Версия 2.80.63 → 2.80.64.

### 2026-06-18 — Развёрнутая карточка: ещё +12% высоты и сворачивание по клику вне карточки 2.80.63
Продолжение 2.80.62.
- **`results.js`**: `EXPANDED_PANEL_OUTPUT_MAX_HEIGHT` 440px → **493px** (ещё +12% к высоте развёрнутой карточки, растёт вниз).
- **`results.js`** (`attachPanelExpansionHandlers`): добавлен документный `pointerdown`-листенер — клик **в любом месте вне развёрнутой карточки** сворачивает её (логика вынесена в `collapseExpandedPanel`, восстанавливает прежний `maxHeight`/`minHeight`). Клик внутри самой карточки не сворачивает. Плавающий тулбар выделения (`.response-sel-toolbar`/`.debate-sel-toolbar`, живёт в `<body>`) исключён — иначе форматирование/добавление в избранное выделенного фрагмента схлопывало бы карточку.
- `npm test` — 75 suites / 353 зелёных. Версия 2.80.62 → 2.80.63.

### 2026-06-18 — Глобальный код-ревью + план стабилизации (architecture pass)
Только документация (кода и версии не трогали). Проведён сквозной архитектурный ревью расширения.
- **`docs/stabilization/global-code-review-2026-06-18.md`** (новый): тезис, сильные стороны (защищать), находки F-A…F-F по убыванию рычага, фазовый план без big-bang (esbuild → де-дубликация адаптеров → debate-FSM → logger → redaction-тест → гигиена), метрики прогресса, перекрёстные ссылки.
- Ключевые находки: F-A нет шага сборки (33 content-script файла на вкладку, координация через `window.*`); F-B «unified»-адаптеры дублируют общие хелперы 8× (15 767 строк); F-C два монолита (`results.js` 18 273 / `job-orchestrator.js` 7 458); F-D шум `console.*` (892 в release-путях); F-E изоляция секретов без redaction-теста; F-F мелкий дрейф (README 74/347 ↔ факт 75/353, протухший `dist/`).
- **`docs/stabilization/what-to-do.md`** §6: добавлены esbuild, де-дубликация адаптеров (P2), единый logger и redaction-тест (P1) со ссылками на план.
- `npm test` без изменений — 75 suites / 353 зелёных (прогон в рамках ревью).

### 2026-06-17 — Подсветка: белый текст на зелёном/красном фоне 2.80.60
По запросу: при выделении фрагмента зелёным или красным текст становится белым (читаемость); жёлтый — без изменений (чёрный текст).
- **`results.js`**: новый помощник `highlightStylePatch(color)` — для фонов `#05e56d` (зелёный) и `#f44336` (красный) добавляет `color:#ffffff`, для жёлтого `#FFEB3B` оставляет дефолт. Подключён в `applyResponseSelectionStyle` (главная) и `applyDebateSelectionStyle` (дебаты).
- `npm test` — 75 suites / 353 зелёных. Версия 2.80.59 → 2.80.60.

### 2026-06-17 — Разворачивание карточки ответа: вся шапка, выше, поверх остальных 2.80.62
Три правки UX разворачивания карточек ответов моделей на главной странице.
- **`results.js`** (`attachPanelExpansionHandlers`): двойной клик для разворота теперь ловится на **всей `.llm-header`**, а не только на названии модели. Интерактивные элементы шапки (кнопки copy/export/clear, индикаторы статуса/API) исключены через `event.target.closest(...)`, чтобы дабл-клик по ним не сворачивал/разворачивал карточку. `scrollIntoView` сменён на `block: 'start'`, чтобы верх оверлея был под тулбаром.
- **`results.js`**: `EXPANDED_PANEL_OUTPUT_MAX_HEIGHT` 400px → **440px** (+10% высоты развёрнутой карточки, растёт вниз).
- **`styles/results-debate.css`**: развёрнутая карточка (`.llm-results .llm-panel.llm-panel-expanded:not(.favorite-panel)`) теперь `position: absolute; top:0; left:0; right:0; z-index:60` с непрозрачным фоном и тенью — **всплывает поверх остальных карточек**, прижимаясь к верху сетки (под `.pro-toggle-bar`); остальные карточки перетекают на освободившееся место, а при сворачивании карточка возвращается на штатное место. `.llm-results` получил `position: relative` как якорь. Панель Favourite (отдельная секция) не затронута.
- `npm test` — 75 suites / 353 зелёных. Версия 2.80.61 → 2.80.62.

### 2026-06-17 — Телеметрия: настоящая причина двойного JSON-экспорта 2.80.61
Чинилось несколько раз неверно (искали дубль между `results.js` и `results-devtools.js`). **Реальная причина:** в `results-devtools.js` делегированный capture-листенер (`document` click, `TELEMETRY_ACTION_SELECTOR`) для refresh/reset/clear-all зовёт функции напрямую, а для **export и copy** вызывал `telemetryExportJsonBtn?.click()` / `telemetryCopyBtn?.click()` — при том, что у кнопок есть ещё и **собственный прямой `addEventListener`**. Один клик → оба пути → два файла. refresh/reset/clear-all тоже двоятся, но идемпотентны (жалоб нет); только export даёт видимый побочный эффект.
- **`results-devtools.js`**: export/copy вынесены в `exportTelemetryJson()` / `copyTelemetry()`, их прямые `addEventListener` удалены, делегат зовёт функции напрямую → ровно один вызов на клик.
- clear-all/refresh/reset оставлены с двойной привязкой намеренно (идемпотентны; `telemetry-clear-all.test.js` это требует).
- `npm test` — 75 suites / 353 зелёных. Версия 2.80.60 → 2.80.61.

### 2026-06-17 — Grok: сабмит платформо-зависимым чордом (Cmd на Mac) 2.80.60
Жалоба: Grok иногда отвечает «сервер перегружен» при отправке расширением, но ручной путь (Ctrl+V + **Cmd+Return**) на Mac работает как обычно. Причина — `simulateCtrlEnter` жёстко слал **Ctrl+Enter** (`ctrlKey`) на всех платформах и синтетические key-события без `keyCode/which=13`. На Mac-версии Grok сабмит-хоткей — **Cmd+Return** (`metaKey`); ctrlKey мог не совпасть с обработчиком, отправка соскальзывала на менее надёжные фолбэки → нестабильный результат.
- **`content-scripts/content-grok.js`**:
  - `isMacPlatform` (по `userAgentData.platform`/`navigator.platform`); чорд сабмита теперь `metaKey` на macOS, `ctrlKey` иначе — точная репликация рабочей ручной комбинации.
  - `makeEnterEvent` — полные key-события: `keyCode/which=13`, `cancelable`, `composed`, корректный модификатор (многие обработчики проверяют keyCode и модификатор, а не только `key`).
  - На macOS дополнительно эмитится и Ctrl+Enter-вариант (на случай билда Grok, который ещё его чтит; безвреден при игнорировании).
- Вставка текста уже шла через `pasteTextFirst` (paste/execCommand) — это совпадает с ручным Ctrl+V, не трогал.
- `npm test` — 75 suites / 353 зелёных. Версия 2.80.59 → 2.80.60.

### 2026-06-17 — Подсветка текста работает через границы форматов/блоков 2.80.59
Жалоба: бар выделения цветом в карточках ответов не выделял несколько строк, если они в разных форматах. Причина — `wrapResponseSelectionRange`/`wrapDebateSelectionRange` делали `range.extractContents()` и заворачивали **весь** фрагмент в один `<span>`. Как только выделение пересекало границы блоков (абзацы, списки, код-блоки, таблицы), фрагмент содержал блочные узлы — вложить их в один `<span>` невалидно, `insertNode` бросал исключение → подсветка молча не применялась.
- **`results.js`**: новый общий помощник `wrapRangeAcrossFormats(range, tag, stylePatch)` подсвечивает **по текстовым узлам**: собирает все текстовые узлы, пересекающие диапазон (через `intersectsNode`, до сплита — пограничные остатки отсекаются сами), разрезает пограничные узлы по offset'ам выделения, оборачивает каждый в свой styled-элемент. Формат-независимо: работает сколько бы блоков/форматов ни пересекало выделение. Возвращает диапазон, охватывающий новые обёртки, для ре-селекта.
- Оба обработчика — главная (`wrapResponseSelectionRange`) и дебаты (`wrapDebateSelectionRange`) — переведены на общий помощник. Касается всех команд бара (hiliteColor/bold/italic).
- `npm test` — 75 suites / 353 зелёных. Версия 2.80.58 → 2.80.59.

### 2026-06-17 — Перф первой загрузки: devtools убран из критического пути 2.80.58
Жалоба: после **установки** расширение грузится 5-8с (на последующих запусках норм). Причина — холодная V8-компиляция большого бандла страницы при первой установке (некэшировано; затем срабатывает code cache → быстро). Усугублялось тем, что `results-devtools.js` (код вкладки телеметрии) грузился **синхронно** в `result_new.html` и `pipeline_panel.html`, хотя в `results.js` уже есть ленивый загрузчик `ensureTelemetryDevtoolsLoaded` (setTimeout 0/1000 после boot). Синхронный тег сводил ленивую загрузку на нет (гард `__DEVTOOLS_TELEMETRY_READY__` уже был выставлен) и добавлял парсинг в критический путь первой загрузки.
- **`result_new.html`, `pipeline_panel.html`**: удалён `<script src="results-devtools.js">`. Телеметрия теперь подгружается ленивым загрузчиком сразу после интерактивности страницы, вне критического пути.
- Каркас страницы (~900 строк статической разметки в body) рисуется из HTML сразу — это не менялось. Доминирующая стоимость первой установки (компиляция `results.js` + SW-бандл из `importScripts`) — врождённая и кэшируется V8 после первого запуска.
- `npm test` — 75 suites / 353 зелёных. Версия 2.80.57 → 2.80.58.

### 2026-06-17 — HTML-экспорт: Favourite между Prompt и ответами 2.80.57
(`results.js`, `buildResponsesExportHtml`): блок Favourite перемещён — теперь идёт сразу под Prompt и над LLM Responses (в 2.80.55 был выше промпта). Версия 2.80.56 → 2.80.57.

### 2026-06-17 — Le Chat: отправка не пропускалась из-за disabled-кнопки 2.80.56
Прошлый фикс (2.80.54) улучшил только *детекцию* отправки. Реальная первопричина «вставляется, но не отправляется»: `resolveSendButton` опирался на `isElementInteractable`, который возвращает `false` для кнопки с атрибутом `disabled`. Le Chat (Mistral, ProseMirror) держит кнопку send **disabled**, пока React не зарегистрирует ввод composer'а → `resolveSendButton` возвращал `null` → клик пропускался целиком → оставался только Enter, который на ProseMirror не срабатывает (`isTrusted=false`).
- **`content-scripts/content-lechat.js`**:
  - `resolveSendButton(ref, { allowDisabled })` — новый режим находит кнопку даже в disabled-состоянии (`isSendButtonPresent`: видима+на экране, но без проверки disabled). Широкий last-resort `button:has(svg)` теперь скоупится формой/контейнером composer'а (берётся самая правая) — не цепляет посторонние кнопки страницы.
  - `waitForSendEnabled(composer, 2500)` — ждёт активации кнопки, попутно ре-диспатчит `input`-событие, чтобы фреймворк перевычислил disabled→enabled.
  - `sendComposer`: Strategy 1 теперь ждёт активную кнопку вместо пропуска при стартовом disabled; composer фокусируется перед клик- и Enter-попытками.
- `npm test` — 75 suites / 353 зелёных. Версия 2.80.55 → 2.80.56.

### 2026-06-17 — HTML-экспорт: карточка избранного идёт первой 2.80.55
(`results.js`, функция `buildResponsesExportHtml`): блок Favourite перенесён в начало документа — перед промптом и ответами моделей. `npm test` — 75 suites / 353 зелёных. Версия 2.80.54 → 2.80.55.

### 2026-06-17 — Le Chat: фикс no_send + улучшение подтверждения отправки 2.80.54
Два независимых бага по логу 15:08:

**Баг 1 — Le Chat не отправлял промпт** (`content-scripts/content-lechat.js`): `confirmLeChatSend` тайм-аутил за 1800мс на всех трёх стратегиях — Le Chat изменил индикаторы генерации (stop-button, animate-pulse, aria-busy). Промпт вставлялся, но не уходил.
- Добавлен 4-й детектор: счётчик response-контейнеров до отправки (`main article, .prose, [data-testid*="assistant"]`) — если вырос, отправка подтверждена.
- Таймаут подтверждения 1800ms → 3000ms (и дефолт функции 2200ms → 3000ms).

**Баг 2 — Промпт затягивался в карточку ответа** (`background/job-orchestrator.js`): при `finalStatus === 'NO_SEND'` блок `TERMINAL_FAILURE_BLOCKED_BY_ANSWER_EVIDENCE` принимал `preserved_answer` (текст из composer'а = неотправленный промпт) как SUCCESS. Теперь при NO_SEND `preservedAnswer` принудительно пустой — отказ не проходит через этот блок.

Попутно: `generationWaitProfile` перенесён из удалённого дубля в корректный путь — `results.js` экспонирует геттер через `ResultsShared`, `results-devtools.js` читает его при построении JSON-экспорта. Тест обновлён.
- `npm test` — 75 suites / 353 зелёных. Версия 2.80.53 → 2.80.54.

### 2026-06-17 — Телеметрия: убран дубль обработчика JSON-экспорта 2.80.53
На кнопку `#telemetry-export-json-btn` было навешено два независимых обработчика — один в `results-devtools.js` (оригинальный, baseline 13 июня), второй добавлен в `results.js` в 2.80.41 как регрессия. Оба строили JSON по-разному → при нажатии скачивались два файла разного размера. Удалён дублирующий обработчик из `results.js` (строки 11619–11640). Единственный рабочий обработчик остался в `results-devtools.js`.

### 2026-06-17 — Телеметрия: возвращена кнопка очистки (clear all) 2.80.52
Кнопку очистки из окна телеметрии ранее убрали по ошибке — осталась только сброс-фильтров (`#telemetry-reset-btn` лишь возвращал селекторы в «all»). Вернул реальную очистку.
- **HTML** (`result_new.html`): корзина `#telemetry-clear-all-btn` (`ti-trash`) справа от кнопки экспорта Json в `.telemetry-actions`.
- **JS** (`results-devtools.js`): `clearAllTelemetry()` — шлёт `CLEAR_DIAG_EVENTS` (чистит бэкенд-стор телеметрии/диагностики), обнуляет `telemetryCache/Scoped/Filtered` + `telemetryEventKeys`, сбрасывает фильтры и `renderTelemetry([])` → пустеют **Telemetry Rounds, Timeline, Summary**. Диспатчит `diagnostics-clear-request`. Кнопка проведена и напрямую, и через делегированный `TELEMETRY_ACTION_SELECTOR` (устойчиво к ре-рендеру).
- **JS** (`results.js`): слушает `diagnostics-clear-request` → `clearDiagnosticsView()` — пустеет окно **Logs** (llmLogs). Итог: после нажатия все окна телеметрии чистые → можно сделать чистый экспорт.
- Тест: `telemetry-clear-all.test.js`. `npm test` — 75 suites / 353 зелёных. Версия 2.80.51 → 2.80.52.

### 2026-06-17 — Perplexity: рефанд snapshot-бюджета + гейт stale-cache 2.80.51
По логу `All Logs 20260617_09-44.md`: Perplexity финализировался **PARTIAL@2309 из `snapshot_cache`** — принят устаревший снапшот середины генерации. Цепочка: повторяющийся `PING_TRANSPORT_ERROR (message port closed)` → `RECOVERY_BUDGET_EXHAUSTED snapshotAttempts:3/3` (весь бюджет сгорел на транспортных ошибках, не дав ни одного свежего чтения DOM) → `VISIT_QUOTA_BACKOFF` → после пере-визита `execute_script_unavailable` → fallback на кэш 2309 → `Finalization defer bypassed (timeout_with_text)` → PARTIAL.
- **Рефанд бюджета на «без свежего чтения»** (`background/job-orchestrator.js`): новые `refundRecoveryBudget` / `hasRecoveryBudgetRemaining`. `recoverAnswerViaDomSnapshot` возвращает попытку снапшота обратно, когда она не прочитала живой DOM — miss (port closed/dead tab), cooldown- и in-flight-короткие выходы. Транспортная нестабильность больше не исчерпывает 3/3; бюджет резервируется под попытки, реально читающие свежий DOM (общий cap `maxTotalMs=120000` сохраняется).
- **Гейт stale-cache** (там же): `snapshot_cache`/`partial_from_snapshot` больше не финализируется сразу, если нет completion-evidence И остался snapshot-бюджет — рефанд + defer (`DOM snapshot recovery deferred (stale cache, fresh read pending)`), чтобы следующий цикл прочитал **полный** ответ. Кэш принимается только как последний рубеж (бюджет исчерпан / есть completion-evidence) — ответ не теряется.
- Тест: `recovery-budget-tuning.test.js` (+2 кейса). `npm test` — 74 suites / 349 зелёных. Версия 2.80.50 → 2.80.51 (manifest+package синхронизированы).

### 2026-06-17 — Главная: убран блок судьи, иконка Copy All 2.80.50
- **HTML** (`result_new.html`): `#justice-toggle-btn` (иконка весов) → `#copy-all-btn` (`ti-copy`); удалён весь `.llm-action-block` (compare/smart-compare + селекты evaluator/judge-system-prompt).
- **JS** (`results.js`): убраны `justiceToggleBtn`, `proHeaderActionBlock`, `judgeControlsVisibleStorageKey`, `applyJudgeControlsVisibility`, восстановление состояния из storage и click-handler (~35 строк). Обработчик `#copy-all-btn` уже существовал (`collectLLMResponses` → формат `=== Модель ===` + rich/plain clipboard) — новый JS не потребовался.
- **CSS** (`results-debate.css`, `modals-responsive.css`): удалены `.justice-icon`, `.justice-toggle-btn`, `.llm-action-block`, `.action-button`, `.action-select`, `#compare-button`, `#smart-compare-button` (~135 строк мёртвых правил).
- `npm test` — 74 suites / 347 зелёных. Версия 2.80.49 → 2.80.50.

### 2026-06-16 — Selector-health → extraction + Gemini-PARTIAL тултип 2.80.49
Доделаны пункты, которые ранее были передержаны в «отложенных».
- **#1 selector-health → extraction** (`content-scripts/unified-answer-pipeline.js`): `getAnswerElement` консультирует `window.SelectorCircuit` (пропускает disabled-селекторы) и кормит его на finalize (`reportHealth`): success победившему селектору, failure более приоритетному, промахнувшемуся при победе нижнего → дрейф → авто-демотинг после порога. Замыкает цикл selector-health (раньше circuit никто не кормил из пайплайна).
- **#4 Gemini false PARTIAL (UX)** (`results.js`, `resolveIndicatorTooltip`): тултип снапшот-PARTIAL с адекватной длиной объясняет «Recovered after a stream drop — length looks complete» вместо «partial answer». Снимает путаницу «почему оранжевый при полном ответе». Цвет/relabel не трогали.
- Тест: `selector-tier.test.js` (+ circuit-wiring). `npm test` — 74 suites / 347 зелёных. Версия 2.80.48 → 2.80.49.
- Остались осознанно отложенными только: node-fingerprint/turn-index для F6 (хрупкий per-platform селектор «все ходы»), корень геометрии UI (ждёт данные новой телеметрии), единый FinalizationController для всех источников (крупный рефактор). См. `what-to-do.md`.

### 2026-06-16 — Selector-tier тегирование + dead-code sweep 2.80.48
Backlog `what-to-do.md`, P1.1 (частично) + tech-debt.
- **Selector-tier** (`content-scripts/unified-answer-pipeline.js`): `getAnswerElement` запоминает селектор, давший ответ; `classifySelectorTier` → `primary_assistant | secondary_platform_specific | generic_markdown | last_resort_generic | unknown`. Tier пишется в `finalizationResult` + телеметрию; при low-tier финале — `finalization_low_tier_selector` (leading-сигнал дрейфа платформенных селекторов). Защита «low-tier требует подтверждения» уже обеспечена classifier-гейтом (отклоняет non-answer любого tier). Остаток — связать selector-health (hitRate) с reordering/`'unknown'`-в-tri-state (больший рефактор), см. what-to-do.
- **Dead-code sweep — чисто:** нет висячих ссылок на удалённые `circuit-breaker.js`/`shared/debate-engine.js`; все `importScripts`/`<script src>` существуют; `dist/` untracked+ignored; tmp gitignored. Кода менять не пришлось.
- Тест: `selector-tier.test.js`. `npm test` — 74 suites / 346 зелёных. Версия 2.80.47 → 2.80.48.

### 2026-06-16 — Изоляция профиля Debate 2.80.47
Backlog `what-to-do.md`, профили.
- **Изоляция профиля Debate** (`results.js`): Debate по-прежнему форсит LONG per-turn, но `finalizeSerialDebateRuntime` восстанавливает общий флаг `longGenerationMode` к выбору пользователя на главной по завершении дебата — прошлый дебат больше не «залипает» на LONG для последующего main-рана.
- SHORT-тюнинг и Gemini-PARTIAL-UX: по данным логов 21-12/21-22 (2.80.41) изменений не требуется (Grok/Perplexity не режутся, Gemini уходит в SUCCESS на LONG); UX-оттенок остаточного снапшот-PARTIAL отложен как косметика. Детали — `what-to-do.md`.
- Тест: `debate-forces-long-profile.test.js` (+ restore). `npm test` — 73 suites / 344 зелёных. Версия 2.80.46 → 2.80.47.

### 2026-06-16 — MV3 reconcile на onStartup (анти-зависание рана) 2.80.46
Backlog `what-to-do.md`, MV3 P0.
- **Добавлен `chrome.runtime.onStartup` → `loadJobState`** (`background/job-orchestrator.js`): на холодном старте браузера прерванный ран реконсайлится сразу, а не ждёт до 30с следующего тика survival-alarm.
- Ревизия показала, что база MV3-устойчивости уже была: `MV3_SURVIVAL_ALARM` (30с, пока есть открытые модели) → `loadJobState` → `rehydrateActiveJobRuntime` пере-вооружает collection-пинги + dispatch-supervisor; `ensureInitialState` лениво грузит jobState при пробуждении по сообщению. Полное переписывание `setTimeout`→`chrome.alarms` для каждой отложенной финализации не требуется — 30-секундный reconcile бэкстопит любой потерянный session-таймер (нет зависших ранов).
- Идемпотентность: rehydrate пере-вооружает СБОР ответа, а не повторную отправку промпта (гейт `promptSubmittedAt`). «Осиротевшие промисы» — не hazard (исчезают вместе с awaiter'ами при рестарте SW).
- Тест: `mv3-reconcile.test.js`. `npm test` — 73 suites / 343 зелёных. Версия 2.80.45 → 2.80.46. F5-инвентарь и what-to-do обновлены.

### 2026-06-16 — Pipeline отклоняет non-answer финалы (усиление F6) 2.80.45
Backlog `what-to-do.md`, P1.2 (частично).
- `content-scripts/unified-answer-pipeline.js`: финализация, кроме stale-baseline, теперь отклоняет финал, классифицированный как non-answer (provider_error / ui_noise / empty) через `AnswerContentClassifier` — адаптер уходит в fallback/ожидание вместо возврата не-ответа. Консервативно: только при наличии модуля, prompt-echo оставлен адаптер/background-гардам (в пайплайне нет текста промпта).
- **Node-fingerprint/turn-index не внедряли осознанно:** идентичность DOM-узла небезопасна как сигнал staleness (узел переиспользуется при стриминге). F6 (text-signature) + классификатор закрывают основной кейс. Детали — `what-to-do.md`.
- Тесты: `pipeline-baseline-anchor.test.js` (+ guard non-answer). `npm test` — 72 suites / 340 зелёных. Версия 2.80.44 → 2.80.45.

### 2026-06-16 — Manual-ping без force-success + content-classifier 2.80.44
Backlog `what-to-do.md`, батч 2 (механика ответов P0.5 + P1.3).
- **P0.5 — manual ping не форсит terminal success на слабом evidence** (`background/job-orchestrator.js`, `acceptLateCollectResult`): `forceTerminalSuccess` теперь гейтится на `candidateTerminalEligible` (длина ≥ min И не prompt-echo). Не-ответ (эхо/снапшот старого/слишком короткий) больше не маскируется форсированным SUCCESS — финализируется штатно (может стать PARTIAL). Лог `Forced terminal success withheld (weak evidence)`. Auto-finalization пути (stable-pending) не трогали — у них своя DOM-stability evidence.
- **P1.3 — content-classifier вместо `textLength >= 20`** (`shared/answer-content-classifier.js`, новый): классы `valid | short_valid | prompt_echo | ui_noise | provider_error | empty`, terminal-eligible только `valid`/`short_valid`. Подключён в gate завершения `response-lifecycle-detector.js` (короткие осмысленные ответы проходят, UI-шум/ошибки провайдера длиной >20 — режутся; fallback на `length>=20` если модуль не загружен). Доступен и в background (`importScripts`). Тесты: `answer-content-classifier.test.js`, `manual-ping-no-force-success.test.js`.
- Тесты: `npm test` — 72 suites / 339 зелёных. README/manifest/background синхронизированы. Версия 2.80.43 → 2.80.44.

### 2026-06-16 — UI-recovery телеметрия + backoff финализации 2.80.43
Backlog `what-to-do.md`, батч 1 (UI + Финализация).
- **UI-recovery телеметрия** (`results/boot-utils.js`): когда `recoverUiIfHidden` срабатывает, шлёт `LLM_DIAGNOSTIC_EVENT` (llmName `UI`, label `UI recovery triggered`) с условием-триггером (shellHidden/bodyHidden/textLen/geometry) → попадает в экспорт логов. Это даст реальные данные по ещё открытому корню «схлопывания геометрии» (сайдбары клампятся [240,360], так что спекулятивный гард не делаю — жду данные телеметрии).
- **Backoff recheck-пингов deferred-финализации** (`background/job-orchestrator.js`): `nextDeferRecheckDelay` геометрически растит интервал (8с → ×1.6 → cap 32с), пока длина pending-ответа не растёт; на рост — сброс. Зависший стрим больше не пингуется каждые 8с минутами.
- **Свод порогов финализации в один блок** (`DEFER_STREAM_*`, `STABLE_PENDING_*`) с комментарием-шапкой; значения не менялись.
- **Property-тест финализации** через `log-replay-harness`: Le Chat-подобная последовательность deferred→forced→PARTIAL даёт один PARTIAL-терминал, дубль игнорируется.
- Тесты: `tests/finalization-backoff-and-replay.test.js`. `npm test` — 70 suites / 330 зелёных. README синхронизирован. Версия 2.80.42 → 2.80.43.

### 2026-06-16 — Быстрое восстановление UI главной после рана 2.80.42
Баг-репорт: иногда после отработки всех страниц при возврате на главную UI «зависает» — исчезают окна/кнопки, остаётся фон, через время возвращается.
- Причина: `recoverUiIfHidden` (чинит скрытый/схлопнутый `.app-shell`) вызывался только на boot, `pageshow` и watchdog'е **каждые 30с**. Листенер `visibilitychange` лишь логировал, recovery не запускал → при возврате на вкладку (её фоном держали, пока работали табы моделей) shell мог вернуться скрытым/со схлопнутой геометрией до следующего тика watchdog (до 30с).
- `results.js`: `visibilitychange` при переходе в `visible` теперь вызывает `recoverUiIfHidden('visibilitychange')`; в `finally` завершения рана — `recoverUiIfHidden('run_complete')` (на случай, если пользователь остался на главной). Оба отложены на два `requestAnimationFrame`, чтобы layout успел перерисоваться и не сработал ложный триггер «схлопнуто» на первом кадре.
- Эффект: окно «только фон» сокращается с «до 30с» до практически мгновенного на возврате/завершении. Корневую причину схлопывания геометрии (вероятно измерение ширин сайдбаров при фоновой вкладке → 0) добивать отдельно; recovery её и так лечит, теперь быстро.
- Тест: `tests/results-ui-recovery-triggers.test.js`. `npm test` — 69 suites / 327 зелёных. Версия 2.80.41 → 2.80.42.
- `README.md`: синхронизирована версия (2.80.36 → 2.80.42) и секция Generation Wait Profiles (дефолт теперь Long, Debate всегда форсит Long). `docs/stabilization/what-to-do.md`: добавлен единый backlog незакрытых улучшений.

### 2026-06-16 — Тюнинг recovery для connection-fragile моделей + severity пинга 2.80.41
По результатам теста 2.80.40 SHORT (лог `All Logs 20260616_21-12`): Grok/Perplexity больше не обрезаются (75→2329, PARTIAL→1602 SUCCESS) — код-фиксы F6 сработали. Остались два хвоста.
- **Recovery-бюджет для connection-fragile моделей** (`background/job-orchestrator.js`): Gemini/Perplexity рвут стрим (message port closed) и попадают на снапшот-путь до появления completion-evidence → ложный PARTIAL даже при полном тексте. Введены `CONNECTION_FRAGILE_RECOVERY_MODELS = {Gemini, Perplexity}` и `RECOVERY_BUDGET_CONNECTION_FRAGILE` (snapshot 2→3, inlineDom 2→3, manualPing 1→2, maxTotalMs 90000→120000). `consumeRecoveryBudget` берёт лимиты через `getRecoveryBudgetForModel(llmName)`. Даёт модели дотянуться до *завершённого* DOM и финализироваться SUCCESS, **не ослабляя** completion-guard.
- **Severity пинга** (`background/message-router.js`): отбраковка `prompt_echo_or_invalid_candidate`/`invalid_candidate`/`unchanged`/`stale` — это успешная защита (модель затем финализируется SUCCESS), а не сбой. Понижена с `error` до `warning` (в логе 21-12 это давало 8 ложных «errors» у Qwen, который завершился SUCCESS).
- **Осознанно НЕ сделано:** relabel снапшот-PARTIAL→SUCCESS. Guard стоит из-за реального инцидента (Grok 550 символов ложно SUCCESS); «Stop пропал» не отличает завершённый ответ от оборванного фрагмента. Лечим причину (дать дотянуться до завершения), а не ярлык.
- **Qwen: клик по кнопке голосового ввода во время генерации** (`content-scripts/content-qwen.js`, баг-репорт из теста LONG `21-22`). Во время генерации Qwen подменяет Send на Stop, строгие send-селекторы (`:not([disabled])`) не находят кнопку → код падает в fallback-скоринг, где кнопка микрофона набирала проходной балл (svg +4, близость к композеру +6 = 11 ≥ 8) и кликалась → всплывал голосовой ввод. В `scoreSendButtonCandidate` добавлен hard-reject (`return 0`) для контролов voice/microphone/audio/record/语音/录音/stop/停止/attach/upload до скоринга. Тест: `tests/qwen-send-button-exclusion.test.js`.
- **Главная: дефолт профиля изменён SHORT → LONG** (`results.js`): на загрузке тумблер Long теперь ВКЛ (`checked=true`, флаг `longGenerationMode=true`, `lastGenerationWaitProfile='long'`). Основание — тесты 2.80.4x: на LONG все 8 моделей дают полные ответы, SHORT режет Grok/Perplexity. Пользователь по-прежнему может вручную переключить на SHORT для быстрых прогонов.
- **Tri-state сигнала завершения** (`content-utils/response-lifecycle-detector.js`, идея P0.2 из внешнего ревью механики ответов). Сигнал стоп-кнопки переведён в `true | false | 'unknown'`: завершение инферится только при подтверждённо-отсутствующей кнопке (`stopButtonSignal === false`), а недостоверная проба (`'unknown'`) не даёт ни completion, ни +confidence — правило `unknown !== false`. Заодно починен латентный баг: regex `/stop/i` пропускал локализованные стоп-кнопки (`Останов/Detener/Arrêter`) → присутствующая кнопка читалась как отсутствующая → ложное завершение. Тест: `tests/lifecycle-tristate-completion.test.js`. Разбор всего ревью + follow-up'ы (P1.2/P1.3/P0.5/P1.1) — `docs/stabilization/answer-mechanics-review-followups.md`.
- **Debate всегда форсит LONG-профиль** (`results.js`, `runModelBatch` — диспетчер serial-дебата). На странице Debate своего тумблера Long нет, а по умолчанию глобальный флаг = SHORT, что резало медленные модели в каждом ходе. Теперь `runModelBatch` перед диспатчем awaited-записью ставит `longGenerationMode=true` (тот же общий флаг, что читают content-адаптеры) и помечает `lastGenerationWaitProfile='long'`. Флаг глобальный, но главная сбрасывает его в SHORT при загрузке, так что дефолт главной не меняется; видимый тумблер не трогаем. Тест: `tests/debate-forces-long-profile.test.js`.
- Тесты: `npm test` — 67 suites / 321 зелёных (+3 suite: `recovery-budget-tuning`, `qwen-send-button-exclusion`, `debate-forces-long-profile`). `node --check` чист.
- Версия: 2.80.40 → 2.80.41.

### 2026-06-16 — Стабилизация runtime-детерминизма + релизная упаковка 2.80.40
Этап «end-to-end стабилизация» (workstream'ы 1–3 из ревью). Полный аудит — `docs/stabilization/`.

**Runtime-детерминизм:**
- **F1 recovery-троттлинг** (`background/dispatch-coordinator.js`): при отказе recovery-intent (есть answer-evidence) entry бэк-оффится на `RECOVERY_DENY_BACKOFF_MS=15000` (`entry.recoveryDeniedUntil`), супервайзер его пропускает, а `RECOVERY_INTENT_DENIED` эмитится один раз на окно (дедуп по signature). Раньше денел спамился каждый тик (~3 мин на зависшем Le Chat в логе). Тест: `tests/recovery-deny-throttle.test.js`.
- **F6 baseline-якорь для всех адаптеров** (`content-scripts/unified-answer-pipeline.js`): конструктор пайплайна захватывает `baselineAnswerSignature` (текст последнего ассистент-тёрна до генерации; override `baselineText` приоритетен), финализация отклоняет ответ, совпадающий с базлайном (`stale_baseline_answer`). Claude прокидывает свой `claudeDispatchBaseline`. Снимает класс багов «подхват прошлого ответа» на странице с историей для ВСЕХ моделей. Тест: `tests/pipeline-baseline-anchor.test.js`.
- **F4 аудит финализации** (`docs/stabilization/finalization-decision-audit.md`): задокументирован поток принятия «ответ готов»; терминальная сверка статусов уже централизована (`FinalizationController`); тайминг-слой признан функционально корректным — вслепую не меняем, follow-up'ы вынесены отдельно.

**Релизная упаковка:**
- **F3 WAR** (`manifest.json`): `web_accessible_resources.matches` сужен с `["<all_urls>"]` до 14 origin'ов LLM-платформ (R2).
- **F2 dist/**: убран из git-трекинга + `.gitignore` (не шипится манифестом, генерится `build:bundles`, дрейфовал).
- **F8 кодировка**: починены битые UTF-8 комментарии в `dispatch-coordinator.js`, `job-orchestrator.js`, `unified-answer-pipeline.js`.
- `docs/stabilization/release-packaging-checklist.md` — остаточные риски стора (API host_permissions, `*://x.com/*`, humanoid) для product owner.

**MV3-устойчивость:**
- **F5 инвентаризация** (`docs/stabilization/mv3-state-inventory.md`): классификация module-scope состояния. Ключевой вывод R5: `jobState`/rate-limit/circuit переживают рестарт SW, но session-таймеры (`setTimeout`) — нет → риск зависания рана в deferred-finalization. Рекомендации (alarms вместо setTimeout + reconcile на `onStartup`) — следующий этап.

- Тесты: `npm test` — 64 suites / 315 зелёных (+2 suite / +6 тестов). `node --check` чист для всех правленых файлов.
- Версия: 2.80.39 → 2.80.40.

### 2026-06-16 — Claude больше не подхватывает прошлый ответ на странице с историей 2.80.39
- Для чего: при отправке промпта в существующий чат Claude (не на новую страницу) расширение иногда финализировало **предыдущий** ответ вместо нового. Путь диспатча уже защищён `isStaleClaudeResponse(response, baselineText)`, но путь пинга/`getResponses` (которым активно опрашивает background) базлайна не знал и эмитил `:last-of-type` ассистент-тёрн «как есть».
- `content-scripts/content-claude.js`:
  - Добавлена модульная переменная `claudeDispatchBaseline` — текст ассистент-тёрна, существовавшего до текущего диспатча. Заполняется в момент захвата `baselineText` перед отправкой.
  - `waitForClaudeResponseForPing` пропускает кандидатов, совпадающих с базлайном (`isStaleClaudeResponse`), и продолжает ждать новый ответ, а не возвращает прошлый.
  - Хендлер `getResponses` дополнен явным гардом: если на странице только до-диспатчевый ответ — репортит `unchanged` (stale_baseline) и не эмитит его как `LLM_RESPONSE`, чтобы background не финализировал прошлый ответ (`no_resend_after_answer_evidence`).
- На новой/пустой странице поведение не меняется: пустой `baselineText` → `isStaleClaudeResponse` возвращает `false`. Совпадает с гардом, уже применяемым к результату пайплайна на пути диспатча.
- Тесты: `npm test` — 62 suites / 309 зелёных. `node --check content-scripts/content-claude.js` чист.
- Версия: 2.80.38 → 2.80.39.
- Из лога `All Logs 20260616_15-47`: Grok в этом ране игнорируется (зависла модель); отдельно открыт вопрос по Le Chat (PARTIAL @ hard_timeout + длинный цикл `RECOVERY_INTENT_DENIED`).

### 2026-06-15 — Telemetry export shows the active Generation Wait Profile 2.80.38
- Для чего: в экспорте телеметрии видно, какой профиль ожидания генерации (Short/Long) реально использовался.
- `results.js`: профиль фиксируется в момент диспатча рана (`lastGenerationWaitProfile`, по `longModeCheckbox.checked`), поэтому экспорт отражает использованный профиль, а не текущее состояние тумблера. В «All Logs» markdown добавлена заметная строка-шапка `Generation wait profile: **LONG/SHORT** — …`; в Telemetry JSON добавлены поля `generationWaitProfile` и `generationWaitProfileLabel`.
- Тест: guard в `release-log-regressions` фиксирует наличие capture + строки шапки + JSON-поля.
- Тесты: `npm test` — 62 suites / 309 зелёных.
- Версия: 2.80.37 → 2.80.38.

### 2026-06-15 — Default to main page on install + remember last opened panel 2.80.37
- Для чего: после установки расширение должно открывать главную страницу, а затем помнить, какую страницу пользователь открывал последней.
- `background/index.js`: на `onInstalled` (reason `install`) автоматически открывается `result_new.html` (главная). Клик по action теперь открывает последнюю использованную страницу через `codexResolveStartPage` (читает `chrome.storage.local.lastOpenedPage`, дефолт — `result_new.html`); раньше по умолчанию открывался `pipeline_panel.html`. Поведение «фокус уже открытой панели» сохранено.
- `results.js`: при каждой загрузке панели пишет `lastOpenedPage` (`pipeline_panel.html` если `body.pipeline-page`, иначе `result_new.html`).
- Тесты: `npm test` — 62 suites / 308 зелёных. `node --check` background/results чист.
- Версия: 2.80.36 → 2.80.37.

### 2026-06-15 — Long generation mode (patient answer-wait profile) 2.80.36
- Для чего: длинные ответы на главной странице успевают догенерироваться — отдельный «терпеливый» профиль таймингов вместо единственного.
- **Два профиля ожидания генерации** в `content-scripts/pipeline-config.js` (`AnswerPipelineConfig` — единый хаб): Short (текущие значения, по умолчанию) и Long (умеренный, ~6–8 мин). Long-оверрайды (deep-merge поверх Short, сохраняя `maxChars` и т.п.): `adaptiveTimeout` ×~2.5 (`hardMax` 180000→450000, short/medium/long/veryLong timeout, `softExtension` 75000), `settlementWatcher.maxDuration` 45000→120000, `completionCriteria` (+1 stable-check: `contentStableChecks` 3→4, выше `mutationIdle`/`scrollStable`/`contentStable`), `intelligentRetry` (`maxRetries` 5→8, `noGrowthThreshold` 2→4), `finalization.stabilityChecks` 3→4, `streamStartTimeout` 30000→60000. Экспорт `window.AnswerPipelineTiming.applyTimingProfile('short'|'long')`.
- **Переключение профиля:** `pipeline-config.js` (грузится в каждый таб модели) синхронизируется с флагом `chrome.storage.local.longGenerationMode` — читает при загрузке и слушает `onChanged`; применяет профиль до per-run конструирования `UnifiedAnswerPipeline`/watcher (которые клонируют живой конфиг). Работает для всех 8 моделей.
- **UI:** в `prompt-footer-actions` (главная страница, `result_new.html`) перед «New pages» добавлен тумблер **Long** (`#long-mode-checkbox`), по умолчанию ВЫКЛ. `results.js` сбрасывает флаг в `false` при каждой загрузке главной и пишет состояние при переключении.
- Тесты: `npm test` — 62 suites / 308 зелёных. `node --check` для pipeline-config/results чист.
- Версия: 2.80.35 → 2.80.36.
- Примечание: тумблер только на главной (как и просили). Флаг общий, поэтому на главной он сбрасывается в OFF при каждой загрузке.

### 2026-06-15 — Attachment delivery fixes (GPT paste, Claude false warning) 2.80.35
- **Issue 2a (ложное окно «These LLMs may not support attachments: Claude»):** `ATTACH_CAPABILITY` в `results.js` содержал устаревший `{ Claude: false }` — единственный источник этого пред-сенд предупреждения. Claude вложения принимает; карта очищена до `{}`, ложное окно убрано.
- **Issue 3 (GPT: файл вставляется в поле, но не грузится; ручной Ctrl+V работает):** реальный путь доставки — общий `content-scripts/attachment-handler.js` (`AttachmentHandler.attach`), а он умел только bridge + `input.files`, без paste. Добавлена стратегия `attachViaPaste` (синтетический `ClipboardEvent('paste')` с `DataTransfer`), включаемая флагом `preferPaste: true` ТОЛЬКО для GPT и гейтуемая подтверждением загрузки (подтверждённый paste пропускает input → без двойного вложения). Остальные провайдеры не затронуты (нулевой риск регресса). Требует проверки на живом ChatGPT.
- Тесты: `npm test` — 62 suites / 308 зелёных. Синтаксис content-scripts проверен.
- Версия: 2.80.34 → 2.80.35.
- **Открыто (нужен живой DOM, не чинится вслепую):** 2b (Perplexity показывает «failed to attach… attach manually», хотя файл прикрепляется — ложный негатив `waitForUploadConfirmation`: `confirmSelectors` не совпадают с актуальным DOM Perplexity) и 4 (Qwen: синтетические события игнорируются, работает только системный диалог выбора файла). Менять общую логику подтверждения вслепую нельзя — сломает 5 работающих провайдеров. Нужен снимок DOM прикреплённого файла для Perplexity/Qwen.

### 2026-06-15 — Data hygiene + monolith carve-out (boot-utils) + behavioural tests 2.80.34
- **Гигиена данных (A.3):** `.gitignore` дополнен (`logs.json`, `telemetry-*.json`, `All Logs *.md`, `Codex - All Logs *.md`, `*LLM Responses*.html`, `tmp-run-*.js`, `artifacts/`, `flag.md`); из трекинга выведены (`git rm --cached`) `logs.json`, `telemetry-1781134749690.json`, 6 `All Logs/Codex - All Logs *.md`, `tmp-run-telemetry-check.js`, `artifacts/manual-auth-smoke-report.json`, `flag.md` (файлы остаются на диске). Ревизия: in-repo телеметрия — только метаданные (tabId/dispatchId/llmName), без текста ответов; `All Logs` md логируют длины, не контент.
- **Декомпозиция монолита (B.6):** вынесены два острова из `results.js` (≈290 строк):
  - `results/boot-utils.js` (boot/reload/ссылочные хелперы: `resetGeometryState`, `recoverUiIfHidden`, `isPageReloadNavigation`, `clearTelemetryOnReload`, `clearDebateTranscriptOnReload`, `normalizeExternalLinkUrl`, `decorateLinksForNewTab`, `openResponseLinkInNewTab`). Вынесен ДОСЛОВНО код текущей ветки (с её улучшениями: mailto, `contenteditable`, MV3 `setTimeout(finish,250)`) — НЕ модуль Doc_3 (тот регрессировал бы).
  - `results/dom-utils.js` (DOM/HTML/SVG/incremental-render: `parseHtmlDocument`, `createHtmlFragment`, `replaceChildrenFromHtml`, `replaceChildrenFromSanitizedHtml`, `renderIncrementalList`, `clearNode`, `setSvgContent`, `plainTextFromHtml`, `buildHtmlFromText`, `looksLikeHtml`, `insertTextAtCursor` + `getListDepth`/`getListPrefix`). Через `create({promptPasteBlockSelector, escapeHtml, sanitizeHTML})`; render-handler теперь подключается через `setIncrementalRenderHandler(...)` вместо прямого присваивания. Тела сверены — идентичны текущим.
  - `results/attachments.js` (вложения промпта: состояние файлов, чтение `FileReader`, рендер attach-bar, 3 listener'а) через `create({promptAttachInput, promptAttachBtn, promptAttachmentBar, escapeHtml, clearNode, replaceChildrenFromHtml, showNotification})`. `ATTACH_CAPABILITY` оставлен в `results.js` (используется в др. местах). Тело идентично текущему.
  - Имена сохранены через деструктуризацию → call-sites не тронуты. Подключено в `result_new.html` И `pipeline_panel.html` И оба тест-харнесса. План/очередь — `docs/stabilization/monolith-decomposition-plan.md`. `results.js`: 18622 → 18158 строк (−464 за 4 острова).
- **Тесты → поведенческие (B.5):** новые `tests/boot-utils.test.js`, `tests/dom-utils.test.js`, `tests/attachments.test.js` — реальные проверки вход/выход (boot: блокировка `javascript:`/фрагментов, упрочнение ссылок, reload; dom: `looksLikeHtml`/`buildHtmlFromText`/`plainTextFromHtml` со списками, инкрементальный диф с замерами, `insertTextAtCursor`; attach: add/dedup/render, `buildAttachmentPayload` в base64 + лимит размера, `extractFilesFromTransfer`). Снапшот-ассерт `DEBATE_TRANSCRIPT_STORAGE_KEY` перенаправлен на `boot-utils.js` + ассерты на wiring в `results.js`. Добавлен guard-тест: любая HTML-точка входа с `results.js` обязана грузить все `results/`-модули перед ним.
- **Фикс регресса выноса:** `pipeline_panel.html` грузил `results.js`, но НЕ грузил новые `results/`-модули → на странице pipeline/Disput `window.ResultsBootUtils/DomUtils/Tooltips` были undefined, init `results.js` падал, **не работали все кнопки**. Добавлены `<script>` для трёх модулей в `pipeline_panel.html` (как в `result_new.html`). Добавлен guard-тест: любая HTML-точка входа, грузящая `results.js`, обязана грузить три `results/`-модуля ПЕРЕД ним (presence + порядок).
- Тесты: `npm test` — 62 suites / 308 зелёных.
- Версия: 2.80.33 → 2.80.34 (manifest/package/lock + cache-buster `?v=`).

### 2026-06-15 — Merge best of Doc_3 branch (modular CSS + programmatic tab-focus) 2.80.33
- Для чего: взять лучшее из ветки Doc_3 (A_code_Doc_3 2.80.34), проверяя каждый перенос на корректность, и наложить на консолидированную ветку с тестами.
- **Модульный CSS** (перенесено, проверено lossless): `styles.css` теперь @import-загрузчик, правила вынесены в `styles/` (base, notes-sidebar, pipeline, app-controls, devtools-selectors, results-debate, modals-responsive). Проверка: order-independent и ordered diff против прежнего монолита — отличия только 4 схлопнутых пустых строки + CDN-импорт в загрузчике; контент идентичен. В манифест добавлено `styles/*.css` в `web_accessible_resources` (как в Doc_3). Тесты, читающие CSS, переведены на `readResolvedCss()` (резолвит загрузчик + модули).
- **Programmatic tab-focus lease** (перенесено, проверено additive): `background/human-presence.js` + `background/tab-manager.js` из Doc_3 — программные активации вкладок помечаются (`markProgrammaticTabFocus`) и игнорируются `handleTabActivation` как пользовательский фокус (`TAB_ACTIVATION_IGNORED_PROGRAMMATIC` / `PROGRAMMATIC_FOCUS_START`), устраняя ложные `user_focus`/recovery после авто-переключений. Файлы были чисто-аддитивными надмножествами текущих → перенос точный. Добавлен поведенческий тест.
- **Вынос хелперов в `results/`** — перенесён ТОЛЬКО `results/tooltips.js` (floating-tooltip контроллер): тело модуля сверено с инлайном текущей (эквивалентно), вызовы переведены на `tooltipController` (`registerTooltipTarget`/`repositionActive`), убран дублирующий `tooltipTargets.forEach` (текущая навешивала листенеры дважды). Подключён в `result_new.html` и в тестовые харнессы. Добавлен поведенческий guard (init упадёт, если модуль не загружен).
- **`results/` boot-utils/dom-utils/attachments/pipeline-export — НЕ перенесены (проверка выявила регресс).** При сверке тел оказалось, что текущая ветка **впереди** Doc_3: напр. `clearDebateTranscriptOnReload` в текущей имеет MV3-fallback `setTimeout(() => finish(true), 250)`, которого в модуле Doc_3 НЕТ. Принять модули Doc_3 = молча откатить улучшения текущей. Вывод: для этих хелперов «лучшее из обеих» = оставить код текущей; модуляризацию, если нужна, делать выносом КОДА ТЕКУЩЕЙ (self-refactor с ручной UI-проверкой), а не импортом Doc_3.
- **Не брался** `job-orchestrator.js` (разошёлся на 591 строку) и `precollect_nudge` visit-scope — не требуется для ядра tab-focus-фичи.
- Тесты: `npm test` — 59 suites / 288 зелёных.
- Версия: 2.80.32 → 2.80.33 (manifest/package/lock + cache-buster `?v=`).

### 2026-06-15 — Disput consolidation + prod-prep hardening 2.80.32
- Для чего: убрать три расходящиеся реализации диспута и закрыть корректностные баги основного потока перед продом.
- Консолидация (по `docs/stabilization/disput-consolidation-plan.md`): `serialDebateState` в `results.js` — единственный рантайм. Удалён теневой `DebateBackgroundExecutor` (`disput/debate-executor.js`, ветка в `background/message-router.js`, importScripts в `background/index.js`, тест `tests/debate-executor.test.js`); из `results.js` убраны сообщения `START_DEBATE_RUN` / `PAUSE_DEBATE` / `RESUME_DEBATE` / `CANCEL_DEBATE`. `disput/debate-engine.js` ужат 889→~430 строк до утилиты транскрипта/персиста/экспорта/шаблонов (серийный движок/FSM/контекст/политики удалены, нигде не вызывались). Одноразовая очистка ключа `llmCortexDebateBackgroundExecutor.v1` при старте SW.
- Корректность (этой серии): вырезан недостижимый легаси-цикл pipeline после `return` в `runPipeline`; ответы-ошибки (`Error:`) больше не уходят в диспут как валидные ходы (`isErrorOutput` на A0/B0/turn/final); жизненный цикл диспута переживает manual-approval/паузу (abort-контроллер и run-context живут, пока `serialDebateState.active`), Cancel работает в любом состоянии, параллельные approve сериализованы, пауза в auto реально останавливает и резюмируется; зелёная карточка не перекрашивается поздним статусом той же модели (lock settled feed-индикатора); на модель — максимум одна открытая карточка ответа (`resolveSingleDebateAnswerCard`), без дублей целиком/частично; фаза `init/public` гейтит публичную маршрутизацию (A0 не уходит к B до B0).
- Стабилизационный ТЗ: проверено, что этапы (структурные ошибки `RunError`, единый circuit/retry в `dispatch-retry`, judge-защита `JudgePromptBuilder` с nonce-делимитерами и бюджетом, подписываемый канал селекторов) реально подключены.
- Очистка манифеста: убраны ссылки на удалённые `Modifiers/*.json`, добавлен `disput/pipeline-actions.json`.
- Тесты: `npm test` — 59 suites / 287 tests зелёные.
- Версия: `manifest.json` / `package.json` / `package-lock.json` 2.80.31 → 2.80.32; cache-buster `?v=` в HTML обновлён.

### 2026-06-14 20:05 CEST — Main Start new pages reset fix 2.80.31
- Для чего: исправить ошибку главной страницы `Failed to send request: resetNewPagesCheckboxAfterOpen is not defined`.
- Изменение: `resetNewPagesCheckboxAfterOpen` вынесена из pipeline-only блока в общую область `results.js`, чтобы ей могли пользоваться и main Start, и pipeline Disput.
- Версия: `manifest.json` / `package.json` / `package-lock.json` 2.80.30 → 2.80.31.

### 2026-06-14 19:35 CEST — Separate Disput devtools tab 2.80.30
- Для чего: разделить общий Telemetry export и Disput-анализ, чтобы отчёт главной страницы не смешивался с протоколом диспута.
- Изменение: после tab `Telemetry` добавлен отдельный tab `Disput` с собственными кнопками `MD` и `Json`; из Telemetry удалены Disput-кнопки. `Disput` визуально повторяет Telemetry, но не содержит списков `All platforms`, `All types`, `Presets`.
- Версия: `manifest.json` / `package.json` / `package-lock.json` 2.80.29 → 2.80.30.

### 2026-06-14 19:15 CEST — Disput folder consolidation 2.80.29
- Для чего: собрать специализированные файлы Disput/Debate в одной папке `disput/`.
- Изменение: перенесены `disput-massage.js`, `debate-engine.js`, `debate-executor.js`, `debate-auto-default.js`, `pipeline-actions.json`, `D8_duel-protocol.md`; обновлены HTML script paths, background `importScripts`, fetch path модераторских actions и тестовые пути.
- Версия: `manifest.json` / `package.json` / `package-lock.json` 2.80.28 → 2.80.29.

### 2026-06-14 17:35 CEST — Serial dispute B init guard 2.80.28
- Для чего: исправить сценарий, где после первого ответа модели A тихая инициализация модели B не отправлялась, а UI показывал `Pipeline: error (run_already_active)`.
- Изменение: `runModelBatch` теперь ждёт освобождения фонового `roundsInProgress` между последовательными батчами pipeline и повторяет старт при временном `RUN_ALREADY_ACTIVE`; `GET_ACTIVE_RUN_STATE` отдаёт `roundsInProgress`. `pipelineName` и `truncateDisputeLabel` вынесены в общую область, чтобы сохранённая тема стабильно обновляла `debate-session-tab`.
- Проверки: добавлен regression-сценарий, где B получает тихую инициализацию после A и первая попытка B временно возвращает `RUN_ALREADY_ACTIVE`.
- Версия: `manifest.json` / `package.json` / `package-lock.json` 2.80.27 → 2.80.28.

### 2026-06-14 17:20 CEST — Debate Auto restore hardening 2.80.27
- Для чего: убрать самопроизвольный переход `Auto` в `on` при старте сессии на pipeline.
- Изменение: добавлен ранний `debate-auto-default.js`, который до и после загрузки принудительно ставит `#auto-checkbox` и `#debate-run-policy-select` в manual/off, пока пользователь сам не тронет контрол. В `results.js` `auto-checkbox`/`debate-run-policy-select` исключены из cross-view persistence и защищены от восстановления на старте.
- Версия: `manifest.json` / `package.json` / `package-lock.json` 2.80.26 → 2.80.27.

### 2026-06-14 17:10 CEST — Auto toggle square enlargement 2.80.26
- Для чего: увеличить визуальный квадрат в `Auto`, не меняя ширину самой кнопки и не затрагивая логику режима.
- Изменение: `debate-auto-toggle-btn` теперь рендерит квадрат через отдельный span `debate-auto-toggle-square`, которому задан увеличенный размер `1.15em`. `results.js` обновляет кнопку через `innerHTML`, а regression guard проверяет новый HTML-фрагмент.
- Версия: `manifest.json` / `package.json` / `package-lock.json` 2.80.25 → 2.80.26.

### 2026-06-14 17:05 CEST — New pages label cleanup 2.80.25
- Для чего: убрать визуальные `On/Off` справа от `New pages`, чтобы toggle оставался компактным и не дублировал состояние текстом.
- Изменение: из `result_new.html` и `pipeline_panel.html` удалён `top-toggle-state`; из `styles.css` убраны связанные правила `On/Off`. Логика `checked` и bootstrap `new-pages-default.js` не менялись.
- Проверки: обновлён regression guard на `New pages` разметку и CSS; версия `manifest.json` / `package.json` / `package-lock.json` поднята до `2.80.25`.

### 2026-06-14 16:45 CEST — New pages restore race hardening 2.80.24
- Для чего: pipeline всё ещё мог показывать `New pages Off` после reload из-за позднего browser form-state restore.
- Изменение: `new-pages-default.js` теперь делает серию default-pass после загрузки (`0..2500ms`) и останавливается при реальном пользовательском взаимодействии с toggle. Runtime-reset после открытия страниц вызывает `window.__stopNewPagesDefaultBootstrap()` перед установкой `checked=false`, чтобы штатный сброс после send не был переотменён bootstrap.
- Проверки: добавлены regression guards на repeated bootstrap и runtime stop hook.
- Версия: `manifest.json` / `package.json` / `package-lock.json` 2.80.23 → 2.80.24.

### 2026-06-14 16:27 CEST — Dispute topic tab display 2.80.23
- Для чего: после сохранения темы диспута показывать её не только в `pipeline-panel .pipeline-name`, но и в активной вкладке `debate-session-tab`.
- Изменение: сохранение темы теперь синхронно обновляет `session.disputeTopic`, `session.title`, видимый текст/title активной session tab и заголовок pipeline. Версии `manifest.json`, `package.json`, `package-lock.json` и cache-busting HTML assets приведены к `2.80.23`.
- Проверки: `node --check results.js`; `npm test -- --runTestsByPath tests/disput-massage.test.js tests/release-log-regressions.test.js`.
- Версия: `manifest.json` / `package.json` / `package-lock.json` 2.80.22/2.80.21 → 2.80.23.

### 2026-06-14 16:04 CEST — Structured dispute protocol 2.80.22
- Для чего: заменить универсальный serial-debate envelope на явную схему диспута с разными фазами: инициализация A, тихая инициализация B, публичные ходы A/B, финальные слова и итог модератора.
- Изменение: `shared/disput-massage.js` получил отдельные шаблоны `buildInitAPrompt`, `buildInitBPrompt`, `buildStandardTurnPrompt` с формулировками задач из схемы диспута. Pipeline-runner теперь запрашивает тему при первом Start, сохраняет её как `pipelineName`, отправляет `Init A`, затем `Init B`, сохраняет `B0` как стартовую позицию и не маршрутизирует его в A как отдельный ход.
- Изменение: стандартный ход строится как `modelX → modelY` с ответом оппонента, собственной стартовой позицией целевой модели и опциональным блоком модератора. На лимите раундов запрашиваются финальные слова A/B, затем добавляется итоговое резюме модератора.
- Изменение: `pipeline-actions.json` пополнен шаблонами для `pipeline-modifiers-section`: коррекция модератора, Challenge, Evidence Request, запрос финального слова и итоговое резюме.
- Проверки: `node --check results.js`; `npm test -- --runTestsByPath tests/disput-massage.test.js tests/debate-engine.test.js tests/debate-executor.test.js tests/release-log-regressions.test.js`.
- Версия: `manifest.json` 2.80.21 → 2.80.22.

### 2026-06-14 09:30 CEST — New pages explicit On/Off state 2.80.21
- Для чего: убрать неоднозначность, где пользователь мог трактовать положение/цвет toggle как обратное состояние.
- Изменение: рядом с `New pages` добавлен явный state-label `On` / `Off`, завязанный на тот же `checked` checkbox: `checked=true` показывает `On` и отправляет `forceNewTabs=true`. HTML/CSS assets получили cache-busting `2.80.21`.
- Проверки: добавлен regression guard на HTML state-span и CSS `On/Off`; подтверждена цепочка `checked=true → forceNewTabs=true → createNewLlmTab(forceCreate)`.
- Версия: `manifest.json` / `package.json` / `package-lock.json` 2.80.20 → 2.80.21.

### 2026-06-14 09:15 CEST — Early New pages default bootstrap 2.80.20
- Для чего: сделать default `New pages = on` устойчивым не только в HTML, но и при browser form-state restore / reload уже открытых extension pages.
- Изменение: добавлен ранний внешний `new-pages-default.js`, который при загрузке, `DOMContentLoaded` и `pageshow` принудительно выставляет `#new-pages-checkbox` в `checked/defaultChecked=true`. HTML/CSS assets получили cache-busting `2.80.20`.
- Проверки: реальная Browser-проверка через `127.0.0.1`: после ручного снятия checkbox и reload на `result_new.html` и `pipeline_panel.html` значение возвращается в `checked=true`.
- Версия: `manifest.json` / `package.json` / `package-lock.json` 2.80.19 → 2.80.20.

### 2026-06-14 08:55 CEST — New pages checked visual state 2.80.19
- Для чего: исправить реальную браузерную проблему, когда `New pages` был `checked=true`, но визуально выглядел выключенным из-за серого checked-фона toggle.
- Изменение: checked-состояние `.top-new-pages-checkbox` теперь получает явный тёмный active-color `#1f3b4c` в глобальном и scoped `.msg-head-right-top` правилах; это синхронизирует визуальное состояние с DOM.
- Проверки: проверено в Browser через локальный `127.0.0.1` на `result_new.html` и `pipeline_panel.html`; добавлен regression guard на checked background.
- Версия: `manifest.json` / `package.json` / `package-lock.json` 2.80.18 → 2.80.19.

### 2026-06-14 08:35 CEST — New pages serial pipeline reset 2.80.18
- Для чего: привести `New pages` к единому сценарию на main и pipeline: сначала включён на обеих страницах, затем выключается только после открытия страниц всех выбранных моделей.
- Изменение: pipeline теперь стартует с включённым `New pages`; в serial debate checkbox не сбрасывается после ответа модели A, а остаётся включённым для открытия модели B и выключается после того, как обе модели A/B были задействованы с `forceNewTabs`.
- Проверки: добавлен behavior test для serial A → approve → B и regression guard на новый default/reset path.
- Версия: `manifest.json` / `package.json` / `package-lock.json` 2.80.17 → 2.80.18.

### 2026-06-14 02:20 CEST — Debate card Minimise toggle 2.80.17
- Для чего: дать быстрый способ свернуть развёрнутый длинный ответ модели.
- Изменение: существующая нижняя правая кнопка карточки теперь работает симметрично: в collapsed состоянии показывает `Show more`, после раскрытия остаётся на месте и меняет текст на `Minimise`; повторный click сворачивает ответ.
- Проверки: обновлены behavior tests для click и double-click expansion/collapse.
- Версия: `manifest.json` / `package.json` / `package-lock.json` 2.80.16 → 2.80.17.

### 2026-06-14 02:05 CEST — Round select arrow spacing 2.80.16
- Для чего: убрать наезд кастомной стрелки справа на текст `rounds` в списке ограничения раундов.
- Изменение: для `#debate-round-limit-select` задана отдельная ширина `86px` и `padding-right: 24px`, чтобы текст и стрелка не делили одну область; token select не раздут.
- Проверки: добавлен regression guard на размеры round select.
- Версия: `manifest.json` / `package.json` / `package-lock.json` 2.80.15 → 2.80.16.

### 2026-06-14 01:55 CEST — Moderator route center offset 2.80.15
- Для чего: сместить `.msg-head-center` вправо ровно на 15px без влияния на расчёт grid-колонок и без дёргания при скрытии rounds.
- Изменение: геометрия оставлена прежней: центр `.msg-head-center` задаётся второй `auto`-колонкой grid между равными `1fr` боковыми колонками. Сдвиг выполнен пост-лейаутом через `transform: translateX(15px)`, поэтому left/right layout не пересчитывается.
- Проверки: добавлен regression guard на точный `translateX(15px)`.
- Версия: `manifest.json` / `package.json` / `package-lock.json` 2.80.14 → 2.80.15.

### 2026-06-14 01:40 CEST — Stable centered moderator route controls 2.80.14
- Для чего: закрепить `.msg-head-center` ровно по центру строки, чтобы route selectors не сдвигались при появлении или скрытии rounds select.
- Изменение: `.msg-header` переведён с flex на трёхколоночный grid `minmax(0, 1fr) auto minmax(0, 1fr)`. `.msg-head-center` закреплён во второй колонке через `justify-self: center` и `grid-column: 2`; left/right группы остаются в равных боковых колонках.
- Проверки: добавлены regression guards на grid layout и фиксированную центральную колонку.
- Версия: `manifest.json` / `package.json` / `package-lock.json` 2.80.13 → 2.80.14.

### 2026-06-14 01:25 CEST — Manual rounds visibility and centered route selectors 2.80.13
- Для чего: исправить реальную причину, почему rounds select мог оставаться видимым при `Auto off`, и отделить route selectors от левого tool cluster.
- Изменение: добавлено явное CSS-правило `.debate-select-wrap[hidden] { display: none !important; }`, потому author `display: inline-flex` перебивал браузерный `[hidden]`. После применения сохранённого pipeline config выполняется повторный `syncPipelineRoundsToDebateLimit()`, чтобы Manual всегда сжимал canvas до `R1`.
- Изменение: `mod-sender-select`, direction arrow, `mod-receiver-select` и `mod-role-select` вынесены из `.msg-head-left` в новый `.msg-head-center` между left и right.
- Проверки: обновлены regression guards на реальное скрытие `[hidden]`, Manual → R1 после config restore и структуру `.msg-head-center`.
- Версия: `manifest.json` / `package.json` / `package-lock.json` 2.80.12 → 2.80.13.

### 2026-06-14 01:05 CEST — Pipeline rounds control in left header 2.80.12
- Для чего: собрать оба compact select в левой части moderator header рядом с `Pro`.
- Изменение: `debate-round-limit-select` перенесён в `.msg-head-left` сразу после token/debate length select и перед sender selector. Существующая логика сохранена: при `Auto off` rounds скрывается, а canvas синхронизируется до одного раунда `R1`.
- Проверки: обновлены регрессионные guard-ожидания на порядок controls и сохранение Manual → R1 canvas sync.
- Версия: `manifest.json` / `package.json` / `package-lock.json` 2.80.11 → 2.80.12.

### 2026-06-14 00:45 CEST — Pipeline token control and New pages defaults 2.80.11
- Для чего: уточнить верхнюю панель pipeline и сделать `New pages` одноразовым переключателем для запуска.
- Изменение: token/debate length select перенесён в `.msg-head-left` сразу после `Pro`; справа остался round limit, который скрывается при `Auto off`. При `Auto off` canvas синхронизируется к одному раунду `R1`, при включении Auto снова строится по выбранному round limit.
- Изменение: `New pages` больше не читает старое сохранённое состояние: на pipeline стартует выключенным, на главной стартует включённым; после запуска с открытием новых страниц checkbox сбрасывается в off.
- Проверки: обновлены регрессионные guard-ожидания для порядка controls, Auto/manual canvas sync и defaults `New pages`.
- Версия: `manifest.json` / `package.json` / `package-lock.json` 2.80.10 → 2.80.11.

### 2026-06-14 00:20 CEST — Pipeline header controls layout 2.80.10
- Для чего: привести верхнюю панель pipeline к новой схеме управления без лишнего сохранения состояния между страницами.
- Изменение: кнопка `Pro` перенесена в `.msg-head-left` сразу после кнопки модификаторов; списки `rounds` и token limit поменяны местами; список rounds скрывается при `Auto off`; `New pages` на pipeline всегда стартует выключенным и больше не перезаписывает запомненное состояние главной страницы.
- Проверки: добавлены регрессионные guard-ожидания на порядок controls, скрытие rounds при Manual/Auto off и раздельное поведение `New pages`.
- Версия: `manifest.json` / `package.json` / `package-lock.json` 2.80.09 → 2.80.10.

### 2026-06-14 00:05 CEST — Serial debate state lazy-init after moderator note 2.80.09
- Для чего: после заметки `Moderator -> None` последующий выбор модели A и send мог падать с `Cannot set properties of null (setting 'active')`.
- Изменение: добавлен единый `ensureSerialDebateState()`, который lazy-init создаёт serial debate state перед стартом и перед чтением routing selectors. `runPipeline()`, `getSerialOpponentModel()` и `syncModeratorSelectors()` больше не обращаются к nullable `serialDebateState` напрямую.
- Проверки: добавлен поведенческий тест сценария note → выбор A → serial debate start.
- Версия: `manifest.json` / `package.json` / `package-lock.json` 2.80.08 → 2.80.09.

### 2026-06-13 23:48 CEST — Exact moderator None start semantics 2.80.08
- Для чего: привести start/send в зоне модерации к точной debate-логике: `Moderator -> None` по умолчанию, первый send просит выбрать модель A, повторный send при оставшемся `None` сохраняет заметку модератора.
- Изменение: удалён auto-target initial model. `receiver=None` до старта снова только ставит `debateInitialTargetPromptPending` и показывает `Выберите первую модель (A), которая будет отвечать.`; если после этого receiver остаётся `None`, текст уходит в ленту как moderator note. Выбор receiver-модели запускает serial debate для выбранной A.
- Проверки: обновлены регрессионные ожидания, запрещающие auto-target.
- Версия: `manifest.json` / `package.json` / `package-lock.json` 2.80.07 → 2.80.08.

### 2026-06-13 23:35 CEST — Start button serial debate auto-target 2.80.07
- Для чего: единственная start-кнопка в `.msg-header` не должна выглядеть нерабочей при `receiver=None`, но должна сохранять прежнюю serial-debate логику, а не запускать canvas pipeline.
- Изменение: если выбран receiver `None` и в header выбраны ровно две модели, `runPipeline()` автоматически назначает первой выбранной модели роль initial target A и запускает serial debate. Если выбрано не две модели, показывается явная ошибка выбора. Поведение moderator note для `None` внутри уже начатого контекста сохранено.
- Проверки: обновлены регрессионные ожидания для auto-target serial debate.
- Версия: `manifest.json` / `package.json` / `package-lock.json` 2.80.06 → 2.80.07.

### 2026-06-13 23:20 CEST — Restore debate start semantics 2.80.06
- Для чего: вернуть прежнюю debate-логику запуска после ошибочной трактовки кнопки как запуска canvas pipeline.
- Изменение: `runPipeline()` снова требует выбор первой модели при receiver `None`, сохраняет поведение moderator note для `None` после начала контекста и запускает serial debate по выбранному receiver. Привязка новой кнопки `.msg-header` сохранена.
- Проверки: регрессионные тесты возвращены к прежней serial-debate семантике.
- Версия: `manifest.json` / `package.json` / `package-lock.json` 2.80.05 → 2.80.06.

### 2026-06-13 23:05 CEST — Pipeline start button route 2.80.05
- Для чего: кнопка запуска на странице `pipeline` визуально была перенесена в `.msg-header`, но запуск обычного canvas pipeline блокировался логикой serial debate при receiver `None`.
- Изменение: `runPipeline()` теперь разделяет режимы: serial debate запускается только при выбранном конкретном receiver, а `None` / `All models` запускают обычный canvas pipeline по R1 Input-моделям. Удалён мёртвый ранний переход, из-за которого основной pipeline-код не выполнялся.
- Проверки: обновлён регрессионный тест, фиксирующий новую маршрутизацию кнопки.
- Версия: `manifest.json` / `package.json` / `package-lock.json` 2.80.04 → 2.80.05.

### 2026-06-13 22:40 CEST — Stable pending auto-finalization 2.80.04
- Для чего: Le Chat/Qwen не должны оставаться в оранжевом промежуточном статусе до ручного посещения вкладки, если длинный стабильный ответ уже захвачен.
- Изменение: `job-orchestrator` ставит одноразовый stable-pending auto-finalization timer для длинных pending-ответов. Перед `SUCCESS` он повторно проверяет страницу: если stop-кнопка видна, финализация откладывается; если stop не виден, pending-ответ финализируется без пользовательского visit.
- Проверки: добавлены регрессионные тесты на auto-finalize и stop-visible блокировку.
- Версия: `manifest.json` / `package.json` / `package-lock.json` 2.80.03 → 2.80.04.

### 2026-06-13 14:45 CEST — Fast extension action open 2.80.03
- Для чего: убрать задержку 5-10 секунд при открытии расширения кликом по иконке на cold start MV3 service worker.
- Изменение: `background/index.js` регистрирует лёгкий `chrome.action.onClicked` до тяжёлого `importScripts(...)`, поэтому UI-вкладка открывается сразу, а оркестратор догружается после этого. `tab-manager.js` не регистрирует второй action handler, если быстрый уже активен.
- Версия: `manifest.json` / `package.json` / `package-lock.json` 2.80.02 → 2.80.03.

### 2026-06-13 14:35 CEST — Non-blocking UI boot 2.80.02
- Для чего: открыть страницу расширения без ожидания 5-10 секунд на cold start.
- Изменение: `results.js` больше не блокирует `DOMContentLoaded` на очистке reload telemetry/debate state, чтении judge visibility, загрузке `prompts.json`, system templates, modifiers и cross-view restore. Базовые prompts выставляются синхронно, а storage/fetch hydration запускается после первого paint.
- Версия: `manifest.json` / `package.json` / `package-lock.json` 2.80.01 → 2.80.02.

### 2026-06-13 14:20 CEST — Startup and app tab close guard 2.80.01
- Для чего: исправить периодическое самозакрытие страницы приложения и убрать лишнюю задержку старта после стабилизационного релиза.
- Изменение: `TabMapManager` больше не сохраняет `result_new.html` / `pipeline_panel.html` как LLM-вкладки и вычищает такие старые записи из `llmTabMap`; cleanup закрывает только проверенные не-UI вкладки. `ensureInitialState()` больше не ждёт миграцию/prune сжатого storage перед обработкой первых сообщений, maintenance запускается отложенно.
- Файлы: `background/tab-manager.js`, `background/job-orchestrator.js`, `background/evaluation-manager.js`, `background/message-router.js`.
- Версия: `manifest.json` / `package.json` / `package-lock.json` 2.80.00 → 2.80.01.

### 2026-06-13 13:58 CEST — Recovery finalization guard 2.80.00
- Для чего: реальный экспорт `All Logs 20260613_13-46.md` показал ранний `SUCCESS` на неполных ответах: Claude был принят как `materialize_recovery` при `preserved_pending len=387`, а затем content-script увидел полный текст около `2729`; Perplexity был принят как `dom_snapshot_recovery len=1215`, что оказалось недостаточно надёжным.
- Изменение: `AnswerLengthPolicy` поднят до `answer-length-policy@2`; snapshot terminal threshold увеличен до `2400`, suspect short success threshold до `800`; `preTerminalMaterialize` больше не является самостоятельным terminal-доказательством.
- Изменение: `runPreTerminalMaterializeRecovery()` теперь отклоняет fragile recovery sources (`preserved_pending`, `preserved_answer`, snapshot) без completion evidence, если длина ниже stable threshold; вместо раннего `SUCCESS` модель остаётся открытой для последующего `ANSWER_COMPLETE_DETECTED`.
- Проверки: `node --check shared/answer-length-policy.js shared/answer-evidence.js background/job-orchestrator.js` passed; focused finalization/evidence tests passed; полный `npm test -- --runInBand` — 59 suites / 282 tests green.
- Версия: включено в релиз `2.80.00`.

### 2026-06-13 06:20 CEST — Stabilization stages 2-10 completion 2.80.00
- Для чего: закрыть оставшиеся этапы стабилизационного ТЗ после уже выполненных этапов 0-1. Изменение: legacy `background/circuit-breaker.js` удалён, circuit переведён на `unifiedCircuitState.v1` с порогом 3 и cooldown 5 минут; dispatch idempotency TTL поднят до 15 минут; подтверждённый duplicate dispatch блокируется с `DUPLICATE_DISPATCH_BLOCKED`.
- Для чего: убрать недетерминированные status/error каналы. Изменение: добавлен `shared/run-error.js`, producers в background переведены со строк `Error: ...` на structured `RunError`, UI использует единый `ResultsShared.isErrorOutput()`, success-классификация больше не зависит от `startsWith("Error:")`.
- Для чего: сделать MV3-safe resume и защищённый judge контур. Изменение: rate-limit переведён на `chrome.alarms` + storage key `rateLimitUntilByModel.v1`; добавлен `shared/judge-prompt-builder.js` с nonce-delimited bounded response blocks; evaluation manager ждёт `ReadySignalManager.waitForReady()`.
- Для чего: закрыть update/security/product gates. Изменение: remote selectors теперь принимают только signed envelope `selectors-override.signed.v1`, добавлен `scripts/sign-selectors.js`; добавлен first-run ToS consent overlay `tos-consent.js`; исправлены user-facing API опечатки.
- Документы: обновлены `docs/stabilization/retry-inventory.md`, `docs/stabilization/risk-register.md`, `docs/stabilization/acceptance-report.md`.
- Проверки: `node --check` по изменённым JS passed; focused stabilization tests passed; полный `npm test -- --runInBand` — 59 suites / 280 tests green. Ручной Chrome smoke из этапа 10 не выполнялся в этой среде.
- Версия: `manifest.json` 2.74.136 → 2.80.00; `package.json` / `package-lock.json` 0.1.1 → 2.80.00.

### 2026-06-13 04:25 CEST — New pages and pipeline placeholder parity 2.74.136
- Для чего: сделать переключатель new-pages одинаковым на main и pipeline. Изменение: подпись на обеих страницах изменена на `New pages`; на pipeline порядок controls стал `Pro → New pages → start`, а no-feed switch использует те же размеры/gap, что main.
- Для чего: привести pipeline placeholder к main prompt. Изменение: `textarea#modTa` получил placeholder `Enter a prompt` и no-feed typography `font-size: 16px`, `line-height: 1.45`, совпадающие с main `#prompt-input`; main placeholder также нормализован до `Enter a prompt`.
- Проверки: focused `npm test -- --runInBand tests/release-log-regressions.test.js` passed; полный `npm test` — 52 suites / 261 tests green; локальная Playwright geometry-проверка подтвердила одинаковый `New pages` rect на main и pipeline (`x=1036.625`, `right=1143`, `w=106.375`), одинаковый input rect (`x=256`, `w=928`, `h=66`) и одинаковые placeholder styles (`font-size=16px`, `line-height=23.2px`, `padding=10px 15px`, `placeholder=Enter a prompt`).
- Версия: `manifest.json` 2.74.135 → 2.74.136.

### 2026-06-13 04:10 CEST — Pipeline run button icon parity 2.74.135
- Для чего: привести содержимое pipeline start/resume button к main prompt send button. Изменение: idle/resume `#debate-run-toggle-btn` использует `<i class="ti ti-send" aria-hidden="true"></i>` вместо текстового `▶`; pause-состояние использует icon-only `ti ti-player-pause`.
- Проверки: `node --check results.js` passed; focused `npm test -- --runInBand tests/release-log-regressions.test.js` passed; локальная Playwright DOM-проверка подтвердила, что main `#start-button i` и pipeline `#debate-run-toggle-btn i` оба имеют class `ti ti-send`.
- Версия: `manifest.json` 2.74.134 → 2.74.135.

### 2026-06-13 03:55 CEST — Pipeline composer geometry parity 2.74.134
- Для чего: убрать визуальное дёргание между главной страницей и pipeline при пустом debate feed. Изменение: no-feed `.prompt-container.prompt-sandwich.debate-composer` получает расчетный `margin-top`, а `.moderator-input` повторяет геометрию main prompt: outer `948×122`, textarea/moderator text area `928×66`, footer/header `932×32`.
- Для чего: поставить pipeline Tuning Control и start/pause в те же относительные точки, что и main prompt buttons. Изменение: no-feed `.moderator-input` использует `padding: 2.5px 9px 0`, header offset `margin-top: 18px`, поэтому toggle и run button имеют offset `dx=10`, `dy=87.5`.
- Для чего: открытие pipeline modifiers не должно менять размер prompt. Изменение: `#pipeline-modifiers-section` вынесен изнутри `.prompt-container.prompt-sandwich` и расположен отдельным блоком под ним, как main modifiers panel.
- Проверки: focused `npm test -- --runInBand tests/release-log-regressions.test.js` passed; полный `npm test` — 52 suites / 261 tests green; локальная Playwright geometry-проверка подтвердила main/pipeline prompt `x=246 y=389 w=948 h=122`, input area `dx=10 dy=3.5 w=928 h=66`, toggle `dx=10 dy=87.5`, start `dy=87.5 rightGap≈10`, а открытая pipeline modifiers panel не двигает prompt и появляется ниже него (`y=525`).
- Версия: `manifest.json` 2.74.133 → 2.74.134.

### 2026-06-13 03:30 CEST — Pipeline column width second padding 2.74.133
- Для чего: дать delete-кнопке pipeline ещё больше места после визуальной проверки. Изменение: ширина колонки `.pipeline-items-row` увеличена с `150px` до `160px`, то есть ещё на `10px`.
- Проверки: focused `npm test -- --runInBand tests/release-log-regressions.test.js` passed; локальная Playwright geometry-проверка подтвердила `computedColumns=160px` и `clearance=15.656px` между `×` и следующей колонкой.
- Версия: `manifest.json` 2.74.132 → 2.74.133.

### 2026-06-13 03:20 CEST — Pipeline column width padding 2.74.132
- Для чего: убрать наезд delete-кнопки pipeline на соседнюю grid-колонку. Изменение: ширина колонки `.pipeline-items-row` зафиксирована как `repeat(6, 150px)`, то есть +10px к фактическим прежним `140px`; прежний `minmax(0, ...)` позволял grid сжимать колонку обратно и делал номинальное увеличение ненадёжным.
- Проверки: focused `npm test -- --runInBand tests/release-log-regressions.test.js` passed; локальная Playwright geometry-проверка подтвердила `computedColumns=150px` и `clearance=5.656px` между `×` и следующей колонкой.
- Версия: `manifest.json` 2.74.131 → 2.74.132.

### 2026-06-13 03:05 CEST — Pipeline delete column alignment 2.74.131
- Для чего: сделать позицию удаления pipeline визуально стабильной для имён разной длины. Изменение: после рендера списка вычисляется максимальная фактическая ширина `.pipeline-item-main`, эта ширина задаётся всем pipeline items через `--pipeline-item-main-width`, поэтому `×` находится в одной колонке, а для самого длинного имени сохраняется gap `5px`.
- Для чего: убрать рывок layout при переименовании. Изменение: rename input теперь вставляется внутрь `.pipeline-item-main`, а не между delete-кнопкой и `last` badge.
- Проверки: `node --check results.js` passed; focused `npm test -- --runInBand tests/release-log-regressions.test.js tests/modifier-bootstrap-reset.test.js tests/results-debate-favorites.test.js` passed; полный `npm test` — 52 suites / 261 tests green; локальная Playwright geometry-проверка подтвердила одинаковый `deleteOffset=140.344px` для разных имён и `gap=5px` для самого длинного имени.
- Версия: `manifest.json` 2.74.130 → 2.74.131.

### 2026-06-13 02:40 CEST — Pipeline tuning controls and delete spacing 2.74.130
- Для чего: сохранить незакоммиченный Pipeline/Tuning UI-срез и убрать визуальный дефект удаления pipeline. Изменение: кнопка удаления pipeline теперь располагается сразу после имени, а не после растянутой grid-ячейки; измеренный gap между правым краем имени и `×` — 5px.
- Для чего: не ломать основной prompt input. Изменение: prompt modal использует `prompt-dialog-input`, поэтому основной `#prompt-input` остаётся уникальным на странице.
- Для чего: вынести быстрые действия диспута из select в Tuning Control. Изменение: добавлен `Modifiers/pipeline-actions.json`, блок `pipeline-modifiers-section` и toggle `pipeline-toggle-modifiers-btn`; старый `debate-action-select` удалён.
- Проверки: `node --check results.js` passed; focused `npm test -- --runInBand tests/release-log-regressions.test.js tests/modifier-bootstrap-reset.test.js tests/results-debate-favorites.test.js` passed; локальная Playwright geometry-проверка подтвердила `gap=5`.
- Версия: `manifest.json` 2.74.129 → 2.74.130.

### 2026-06-13 02:25 CEST — Behavioral session stability validation 2.74.129
- Для чего: усилить stabilization validation с source-level guards до исполнения реального router/orchestrator code path. Изменение: `tests/session-stability-validation.test.js` теперь поднимает `message-router.js` в VM и реально проверяет, что stale `NEED_FOCUS` возвращает `focus_denied_stale`, отправляет `SESSION_EXPIRED` и не активирует вкладку; активный `NEED_FOCUS` проходит только через session/model/tab/status checks.
- Для чего: доказать stop→start timer boundary на поведении, а не только на структуре. Изменение: тест поднимает `job-orchestrator.js`, регистрирует session timer, вызывает `stopAllProcesses()` и подтверждает, что callback не исполняется после advance timers.
- Проверки: `npm test -- --runInBand tests/session-stability-validation.test.js` — 6 tests green; полный `npm test` — 52 suites / 261 tests green.
- Версия: `manifest.json` 2.74.128 → 2.74.129.

### 2026-06-13 02:12 CEST — Package metadata stabilization bump
- Для чего: синхронизировать package metadata с текущим stabilization slice. Изменение: `package.json` и root entry `package-lock.json` подняты с `0.1.0` до `0.1.1`; версия расширения остаётся в `manifest.json` как `2.74.128`.
- Проверки: package/package-lock consistency check passed; `npm test -- --runInBand tests/session-stability-validation.test.js` passed; полный `npm test` — 52 suites / 258 tests green.

### 2026-06-13 02:05 CEST — Stabilization validation guards 2.74.128
- Для чего: закрыть локально проверяемую часть session-stability validation без доступа к реальным model tabs. Изменение: добавлен `tests/session-stability-validation.test.js`, который фиксирует три инварианта: `NEED_FOCUS` отправляется только при active session/request, background отклоняет stale `NEED_FOCUS` и отправляет `SESSION_EXPIRED` до любой активации tab, session timers регистрируются и очищаются через общий registry.
- Для чего: не смешивать автоматическую регрессию с ручным smoke. Изменение: `docs/session-stability-plan.md` и `docs/session-stability-ops.md` обновлены как validation slice: automated guard есть, реальный stop→start/browser smoke всё ещё требует ручного запуска в расширении.
- Проверки: `npm test -- --runInBand tests/session-stability-validation.test.js` passed; полный `npm test` — 52 suites / 258 tests green.
- Версия: `manifest.json` 2.74.127 → 2.74.128.

### 2026-06-13 01:40 CEST — Stabilization layer release marker 2.74.127
- Для чего: закрепить текущий стабилизационный слой как отдельную версию расширения. Изменение: `manifest.json` поднят с `2.74.126` до `2.74.127`.
- Включено в срез: baseline snapshot, Stage 1.1 run ownership guard, Stage 1.2 API transport feature flag.
- Проверки: последний полный `npm test` после Stage 1.2 — 51 suites / 255 tests green.
- Ограничение: файл `docs/stabilization/TZ-stabilization-layer.md` отсутствует внутри `/Users/restart/Downloads/LLM_Codex-Codex`; после уточнения рабочей папки дальнейшие действия не опирались на соседний репозиторий.

### 2026-06-13 01:35 CEST — Stabilization Stage 1.2 API transport feature flag
- Для чего: выключить direct API transport по умолчанию отдельным feature flag. Изменение: `TransportPolicy.isApiTransportEnabled()` возвращает true только для literal `true`, а `tryApiDirect()` читает `feature_api_transport_enabled` перед любой попыткой API.
- Для чего: сохранить диагностическую прозрачность при выключенном API. Изменение: при disabled flag пишется `TRANSPORT_DECISION` с `web_ui:api_transport_feature_disabled`, и модель остаётся на Web UI transport.
- Для чего: не обходить feature flag через аварийный fallback. Изменение: rate-limit/captcha fallback вызывает `executeApiFallback()` только после того же enabled check.
- Для чего: убрать пользовательский переключатель API из основного UI при выключенном флаге. Изменение: контейнер `api-mode-checkbox` скрыт через `hidden` с title `API transport feature disabled`.
- Проверки: `node --check shared/transport-policy.js background/job-orchestrator.js` passed; `npm test -- --runInBand tests/transport-policy.test.js tests/release-log-regressions.test.js` passed; полный `npm test` — 51 suites / 255 tests green.

### 2026-06-13 01:30 CEST — Stabilization Stage 1.1 run ownership guard
- Для чего: запретить одновременные Pipeline/fullpage запуски, которые делят один mutable `jobState`. Изменение: добавлен `shared/run-guard.js`, подключён в background service worker и проверяется в `startProcess`, `START_FULLPAGE_PROCESS` и `SUBMIT_PROMPT`.
- Для чего: не стирать диагностику активного запуска при ошибочном повторном старте. Изменение: router выполняет early guard до очистки diagnostics runtime logs.
- Для чего: дать UI понятный отказ вместо silent overlap. Изменение: `results.js` обрабатывает `RUN_ALREADY_ACTIVE` в обычном start path и в Pipeline batch path через warn notification и `run_already_active`.
- Проверки: `node --check shared/run-guard.js background/index.js background/job-orchestrator.js background/message-router.js results.js` passed; `npm test -- --runInBand tests/run-ownership-guard.test.js` passed; полный `npm test` — 51 suites / 254 tests green.

### 2026-06-12 21:05 CEST — Pipeline flow state and export parity 2.74.126
- Для чего: сделать Pro canvas визуально честнее по отношению к ходу serial Pipeline/Disput. Изменение: будущие раунды помечаются как `pipeline-stage-future`, поэтому их блоки выглядят более бледными, а стрелки и соединения в ещё не задействованных стадиях остаются светло-серыми вместо оранжевых.
- Для чего: зафиксировать точный промежуток между prompt и заголовком Pro controls. Изменение: `pipeline-panel-toggle-title` больше не добавляет собственный верхний отступ, а внешний gap остаётся 15px.
- Для чего: убрать расхождение между `Output / Export HTML` и экспортом кнопки `debate-session-export-btn`. Изменение: оба пути теперь используют один и тот же `Debate Feed` HTML builder/download path.
- Проверки: будут выполнены после патча и отражены в следующем log entry.
- Версия: `manifest.json` 2.74.125 → 2.74.126.

### 2026-06-12 20:25 CEST — Pro output vertical centering 2.74.125
- Для чего: визуально выровнять `Output / Export HTML` в Pro canvas по высоте относительно entry-point и блока Disput. Изменение: `connectorToOutput` и `outputColumn` получают `align-self: center`, а `outputColumn` центрирует собственный контент по вертикали.
- Проверки: будет закреплено CSS-регрессией и полным тестовым прогоном после патча.
- Версия: `manifest.json` 2.74.124 → 2.74.125.

### 2026-06-12 20:05 CEST — Compact Disput telemetry export 2.74.124
- Для чего: сделать кнопку `Disput` в окне телеметрии полезной для анализа LLM хода Pipeline/Disput. Изменение: кнопка экспортирует компактный Markdown flow без raw logs: step, time, action, from, to, model, round, status и короткую note.
- Для чего: не терять события при переходе между страницами. Изменение: export объединяет точный in-memory `serialDebateTimeline` с run-scoped telemetry events (`PROMPT_SUBMITTED_*`, `MODEL_FINAL`, `PIPELINE_*`, `ROUND*`) и фильтрует шумные selector/DOM/service события.
- Проверки: `node --check results.js results-devtools.js shared/telemetry-export.js` passed; `npm test -- --runInBand tests/release-log-regressions.test.js` passed; полный `npm test -- --runInBand` — 50 suites / 250 tests green; локальная Playwright DOM-проверка подтвердила Blob export с `# Disput Pipeline Flow`, `SEND_CONFIRMED`, `RESPONSE`, model names, run и session.
- Версия: `manifest.json` 2.74.123 → 2.74.124.

### 2026-06-12 19:45 CEST — Telemetry toolbar simplification 2.74.123
- Для чего: упростить телеметрийную панель. Изменение: из верхней строки убраны `↻`, copy и `🗑`; рядом с `MD` добавлена кнопка `Disput`, а JSON-export переименован в `Json`.
- Проверки: `npm test -- --runInBand tests/release-log-regressions.test.js` passed; полный `npm test -- --runInBand` — 50 suites / 250 tests green; визуальная регрессия закреплена в `tests/release-log-regressions.test.js`.
- Версия: `manifest.json` 2.74.122 → 2.74.123.

### 2026-06-12 19:30 CEST — New label inline alignment 2.74.122
- Для чего: исправить расположение подписи `New` у переключателя новых вкладок. Изменение: label теперь остаётся горизонтальным inline-flex, поэтому текст располагается слева от переключателя, а не уходит наверх.
- Проверки: локальная DOM-проверка подтверждает горизонтальное расположение `New` слева от тумблера; кодовая и регрессионная база из предыдущего шага остаётся зелёной.
- Версия: `manifest.json` 2.74.121 → 2.74.122.

### 2026-06-12 19:10 CEST — Debate stepper, compact Pro spacing and export icon 2.74.121
- Для чего: перестроить управление длиной диспута в ленте. Изменение: `debate-length-select` оставлен как compatibility state, а видимый control перенесён слева от кнопки старта в виде stepper с up/down arrow buttons и текущим значением в центре.
- Для чего: поджать верхнюю часть страницы. Изменение: расстояние между `.pipeline-page .prompt-group` и `.pipeline-panel-toggle-title` сведено к `15px`.
- Для чего: убрать лишнюю пустоту в Pro canvas при выборе нескольких моделей. Изменение: пустой canvas теперь схлопывается до фактического контента без большого нижнего отступа, а `pipeline-flow` остаётся скрытым до появления выбранных моделей.
- Для чего: унифицировать экспорт pipeline с основным экспортом карточек. Изменение: кнопка `pipeline-export-btn` получила download icon в стиле export action с главной страницы.
- Проверки: `node --check results.js pipeline/pipeline-runtime.js shared/debate-engine.js background/debate-executor.js background/message-router.js background/index.js` passed; focused `npm test -- --runInBand tests/debate-engine.test.js tests/debate-executor.test.js tests/results-debate-favorites.test.js tests/release-log-regressions.test.js` — 4 suites / 53 tests green; полный `npm test -- --runInBand` — 50 suites / 249 tests green; локальная Playwright DOM-проверка подтвердила stepper before Run, `pipeline-export-btn` with download icon, and compact pipeline chrome.
- Версия: `manifest.json` 2.74.120 → 2.74.121.

### 2026-06-12 18:31 CEST — Debate feed controls and Pro canvas collapse 2.74.120
- Для чего: заменить неоднозначный `Auto` select в блоке ленты на явную кнопку состояния. Изменение: visible control теперь `Auto off` / `Auto on`, hidden `debate-run-policy-select` оставлен compatibility state; кнопка синхронизирует `aria-pressed`, hidden select и legacy `auto-checkbox`.
- Для чего: уплотнить toolbar. Изменение: подпись `.top-new-pages-toggle` изменена с `New Pages` на `New`.
- Для чего: не восстанавливать старый moderator route после reload. Изменение: cross-view restore на reload пропускает `mod-sender-select` / `mod-receiver-select`, а `syncModeratorSelectors()` пересобирает route без сохранения старого значения, возвращая `Moderator -> None`.
- Для чего: разрешить заметку модератора в `None` после предупреждения выбрать первую модель. Изменение: первый Start с `None` ставит pending state и показывает предупреждение; повторное подтверждение/выбор `None` с текстом добавляет Moderator note в ленту без dispatch и возвращает сценарий к ожиданию выбора модели A.
- Для чего: убрать просвет stage labels в пустом Pro canvas. Изменение: `.pipeline-canvas-empty` схлопывается в `0px`, скрывает `.pipeline-flow` и не показывает `In/R1/R2/Output` до появления выбранных моделей.
- Для чего: поддерживать соответствие Pro columns выбранному round limit после восстановления pipeline config. Изменение: после `initPipelineList()` выполняется `syncPipelineRoundsToDebateLimit()`, чтобы canvas приводился к текущему значению `debate-round-limit-select`.
- Проверки: `node --check results.js pipeline/pipeline-runtime.js shared/debate-engine.js background/debate-executor.js background/message-router.js background/index.js` passed; focused `npm test -- --runInBand tests/debate-engine.test.js tests/debate-executor.test.js tests/results-debate-favorites.test.js tests/release-log-regressions.test.js` — 4 suites / 52 tests green; полный `npm test -- --runInBand` — 50 suites / 248 tests green; локальная Playwright DOM-проверка `pipeline_panel.html` с mock `chrome` подтвердила: `Auto off -> Auto on`, подпись `New`, reload reset `Moderator -> None`, empty canvas `0px` и hidden `.pipeline-flow`, `None` после предупреждения добавляет Moderator note и очищает composer, выбор `5 rounds` даёт `R1..R5`, `bodyOverflowX=0`. Реальный model smoke-run не запускался: requires manual auth on model pages.
- Версия: `manifest.json` 2.74.119 → 2.74.120.

### 2026-06-12 16:23 CEST — Pipeline Pro empty canvas and stable serial dispatch 2.74.119
- Для чего: исправить runtime error при старте serial Pipeline после выбора модели A. Изменение: serial path `runPipeline()` теперь явно вычисляет `forceNewTabs` в своём scope перед первым `runModelBatch()`.
- Для чего: привести Pro canvas к текущей логике “модели появляются только после выбора в header”. Изменение: pipeline runtime больше не гидрирует дефолтные model blocks; `syncPipelineRoundModelsFromSelectedLLMs()` перерисовывает все round stacks только выбранными header-моделями, а пустой canvas получает compact state `10px`.
- Для чего: убрать лишние Output варианты. Изменение: Output stack теперь содержит только `Export HTML`, включённый по умолчанию; `Notes` и MD/JSON `Export` удалены из runtime defaults.
- Для чего: не показывать ложный success при пустом terminal event. Изменение: `pipelineWaiter.handleFinal()` больше не закрывает ожидание модели terminal-событием без непустого ответа, поэтому пустой green result превращается в timeout/missing diagnostics вместо успешного ответа.
- Для чего: подготовить трассировку ответов в Debate/Pipeline. Изменение: model/fragment cards получают stable `responseId`, он сохраняется в message store и DebateEngine turn artifact.
- Для чего: ограничить Pro при выборе `∞`. Изменение: выбор `∞` в round selector нормализуется в `3 rounds`; дополнительные раунды должны добавляться по фактическому ходу диспута, а не заранее раздувать canvas.
- Проверки: `node --check results.js pipeline/pipeline-runtime.js shared/debate-engine.js background/debate-executor.js background/message-router.js background/index.js` passed; focused `npm test -- --runInBand tests/debate-engine.test.js tests/debate-executor.test.js tests/results-debate-favorites.test.js tests/release-log-regressions.test.js` — 4 suites / 52 tests green; полный `npm test -- --runInBand` — 50 suites / 248 tests green; локальная Playwright DOM-проверка `pipeline_panel.html` с mock `chrome` подтвердила: initial `R1/R2` без model blocks, `.pipeline-canvas` `10px` и `pipeline-canvas-empty`, после выбора `GPT+Claude` блоки появляются в `R1/R2`, Output содержит только `exportHtml`, `∞` нормализуется в `3` и видны `R1..R3`, `bodyOverflowX=0`. Реальный model smoke-run не запускался: requires manual auth on model pages.
- Версия: `manifest.json` 2.74.118 → 2.74.119.

### 2026-06-12 03:15 CEST — Smart moderator route selectors 2.74.118
- Для чего: сделать sender/receiver в зоне модерации отражением текущей логики диспута. Изменение: default остаётся `Moderator -> None`; при старте с `None` показывается требование выбрать первую модель `A`; после ответа модели selector автоматически показывает `Model A -> Model B`, далее `B -> A`.
- Для чего: разрешить безопасное вмешательство модератора. Изменение: `None` во время диспута сохраняет заметку модератора в ленту и не меняет очередь; ручной receiver перед отправкой/approve становится следующим target и может переопределить модель `A` для дальнейшей очередности.
- Для чего: не ломать manual gate. Изменение: selector может показывать `A -> B` сразу после ответа A, но фактическая отправка дальше в manual mode остаётся через approve.
- Проверки: `node --check results.js` passed; focused `npm test -- --runInBand tests/debate-engine.test.js tests/debate-executor.test.js tests/results-debate-favorites.test.js tests/release-log-regressions.test.js` — 4 suites / 50 tests green; полный `npm test -- --runInBand` — 50 suites / 246 tests green; локальная Playwright DOM-проверка `pipeline_panel.html` с mock `chrome` подтвердила default `Moderator -> None`, наличие `None` option и `bodyOverflowX=0`. Реальный model smoke-run не запускался: requires manual auth on model pages.
- Версия: `manifest.json` 2.74.117 → 2.74.118.

### 2026-06-12 02:55 CEST — Pro rounds mirror header models 2.74.117
- Для чего: исправить рассинхрон Pro, где `R1 Models` отражал выбранные пользователем модели, а `R2/R3... Disput` оставались заполнены дефолтными/старыми моделями. Изменение: добавлен `syncPipelineRoundModelsFromSelectedLLMs()`, который синхронизирует все `r*-models` с header model buttons; старый `setR1ModelsFromSelectedLLMs()` оставлен wrapper-ом для совместимости.
- Для чего: убрать возврат старых моделей из saved pipeline config и при добавлении новых раундов. Изменение: после `applyPipelineConfig()` выполняется force-sync всех round stacks; новые Disput rounds создаются через selected header model indices, а не через `DEFAULT_JUDGE_INDICES` / `DEFAULT_LATE_JUDGE_INDICES`.
- Проверки: `node --check results.js` passed; focused `npm test -- --runInBand tests/debate-engine.test.js tests/debate-executor.test.js tests/results-debate-favorites.test.js tests/release-log-regressions.test.js` — 4 suites / 49 tests green; полный `npm test -- --runInBand` — 50 suites / 245 tests green; локальная Playwright DOM-проверка `pipeline_panel.html` с mock `chrome` подтвердила: после выбора `Le Chat` + `Perplexity` в header синхронно активны только эти модели в `R1`, `R2` и новом `R3`, старые `Claude/GPT/Gemini` не остаются активными, `bodyOverflowX=0`. Реальный model smoke-run не запускался: requires manual auth on model pages.
- Версия: `manifest.json` 2.74.116 → 2.74.117.

### 2026-06-12 02:35 CEST — Debate feed reload boundary 2.74.116
- Для чего: Pro/Debate не должен подтягивать ленту предыдущих сессий после явной перегрузки страницы. Изменение: при `performance.navigation`/Navigation Timing `reload` удаляется persisted DebateEngine transcript `llmCortexDebateEngineState.v1`; `loadDebateTranscriptFromStorage()` дополнительно не выполняет restore на reload.
- Для чего: сохранить нужное поведение при переходе между страницами. Изменение: очистка привязана только к `isPageReloadNavigation()`, поэтому обычная навигация между `pipeline_panel.html` и `result_new.html` сохраняет существующий persisted transcript.
- Проверки: `node --check results.js` passed; focused `npm test -- --runInBand tests/debate-engine.test.js tests/debate-executor.test.js tests/results-debate-favorites.test.js tests/release-log-regressions.test.js` — 4 suites / 48 tests green; полный `npm test -- --runInBand` — 50 suites / 244 tests green; локальная Playwright reload-проверка `pipeline_panel.html` с mock `chrome` подтвердила `navigation.type=reload`, вызов `chrome.storage.local.remove('llmCortexDebateEngineState.v1')` и отсутствие старого session text после reload. Реальный model smoke-run не запускался: requires manual auth on model pages.
- Версия: `manifest.json` 2.74.115 → 2.74.116.

### 2026-06-12 02:15 CEST — Pro header controls and gated Output 2.74.115
- Для чего: сделать колонку `Output` зависимой от фактического R1. Изменение: Output-колонка и connector скрываются, если в `R1 Models` нет ни одной активной модели; checkbox-состояния Output остаются в DOM и сохраняются в pipeline config через `rememberWhenHidden` / `visible`.
- Для чего: убрать лишнее место в `.pipeline-canvas`. Изменение: `add-round-btn` и `remove-round-btn` перенесены из canvas в `.pipeline-list-header`; canvas больше не держит нижний padding под floating round controls.
- Для чего: перенести service controls к списку pipelines. Изменение: save/export/import теперь находятся справа в `.pipeline-list-header-actions`; верхний Pro header оставлен для имени, `Run`, new/delete.
- Проверки: `node --check results.js` passed; focused `npm test -- --runInBand tests/debate-engine.test.js tests/debate-executor.test.js tests/results-debate-favorites.test.js tests/release-log-regressions.test.js` — 4 suites / 47 tests green; полный `npm test -- --runInBand` — 50 suites / 243 tests green; локальная Playwright DOM-проверка `pipeline_panel.html` с mock `chrome` подтвердила: Output виден при активной R1 модели, скрывается вместе с connector при нуле R1 models, `data-remember-output-state=true`, checkbox states сохраняются при hide/show, save/export/import находятся в `.pipeline-list-header-actions`, round +/- находятся в `.pipeline-list-round-actions`, legacy `.round-buttons` отсутствует, `.pipeline-canvas` имеет `minHeight=0px`, extra height над `.pipeline-flow` только padding 36px, `bodyOverflowX=0`. Реальный model smoke-run не запускался: requires manual auth on model pages.
- Версия: `manifest.json` 2.74.114 → 2.74.115.

### 2026-06-12 01:55 CEST — Pipeline controls exact 15px prompt gap 2.74.114
- Для чего: исправить визуальный regression после 2.74.113: `.control-buttons` вернулся вниз страницы, потому что вставка после всей `.input-section` давала `15px` отступ от нижнего края высокой секции, а не от `.prompt-group`. Изменение: блок снова вставляется сразу после `.prompt-group`, а `.pipeline-page .app-main .input-section` переведён в вертикальный flex layout, чтобы `.control-buttons` не вставал справа.
- Для чего: закрепить контракт. Изменение: регрессия проверяет вставку после `.prompt-group`, `marginTop=15px` и вертикальный layout `.input-section`.
- Проверки: `node --check results.js` passed; focused `npm test -- --runInBand tests/debate-engine.test.js tests/debate-executor.test.js tests/results-debate-favorites.test.js tests/release-log-regressions.test.js` — 4 suites / 46 tests green; полный `npm test -- --runInBand` — 50 suites / 242 tests green; локальная Playwright DOM-проверка `pipeline_panel.html` с mock `chrome` подтвердила: `.control-buttons.previousElementSibling === .prompt-group`, parent `.input-section`, `flexDirection=column`, `promptGroup.marginBottom=0px`, `controlButtons.marginTop=15px`, фактический `gap=15`, левый край/ширина совпадают с `.prompt-group`, `bodyOverflowX=0`. Реальный model smoke-run не запускался: requires manual auth on model pages.
- Версия: `manifest.json` 2.74.113 → 2.74.114.

### 2026-06-12 01:40 CEST — Pipeline controls below composer 2.74.113
- Для чего: исправить размещение `.control-buttons`, который после предыдущего переноса вставал справа от `.prompt-group` и был почти не виден. Изменение: блок теперь переносится после всей `.input-section`, то есть визуально отдельной строкой под prompt/composer, с тем же `15px` отступом.
- Для чего: закрепить контракт. Изменение: `tests/release-log-regressions.test.js` проверяет, что вставка идёт через `.input-section`, а не напрямую после `.prompt-group`.
- Проверки: `node --check results.js` passed; focused `npm test -- --runInBand tests/debate-engine.test.js tests/debate-executor.test.js tests/results-debate-favorites.test.js tests/release-log-regressions.test.js` — 4 suites / 46 tests green; полный `npm test -- --runInBand` — 50 suites / 242 tests green; локальная Playwright DOM-проверка `pipeline_panel.html` с mock `chrome` подтвердила: `.control-buttons.previousElementSibling === .input-section`, `.control-buttons.previousElementSibling !== .prompt-group`, `marginTop=15px`, левый край/ширина совпадают с `.input-section`, `bodyOverflowX=0`. Реальный model smoke-run не запускался: requires manual auth on model pages.
- Версия: `manifest.json` 2.74.112 → 2.74.113.

### 2026-06-12 01:25 CEST — Debate round limit Pro sync 2.74.112
- Для чего: исправить off-by-one при добавлении Disput-раундов в Pro: при выборе `5 rounds` интерфейс не должен создавать `R6 Disput`. Изменение: `debate-round-limit-select` теперь вызывает `syncPipelineRoundsToDebateLimit()`, который доводит количество Pro-колонок ровно до выбранного round limit; `∞` не создаёт дополнительные колонки.
- Для чего: закрепить поведение регрессией. Изменение: `tests/release-log-regressions.test.js` проверяет, что синхронизация использует `roundCounter < targetRounds`, а не `<=`.
- Проверки: `node --check results.js` passed; focused `npm test -- --runInBand tests/debate-engine.test.js tests/debate-executor.test.js tests/results-debate-favorites.test.js tests/release-log-regressions.test.js` — 4 suites / 45 tests green; полный `npm test -- --runInBand` — 50 suites / 241 tests green; локальная Playwright DOM-проверка `pipeline_panel.html` с mock `chrome` подтвердила, что при выборе `5 rounds` видны `R1 Models`…`R5 Disput`, `R6 Disput` отсутствует, `bodyOverflowX=0`. Реальный model smoke-run не запускался: requires manual auth on model pages.
- Версия: `manifest.json` 2.74.111 → 2.74.112.

### 2026-06-12 01:05 CEST — Serial debate routing and Disput flow export 2.74.111
- Для чего: исправить дефект manual/auto serial debate, где первый запрос модератора уходил по старому Pro/R1 batch сразу нескольким моделям. Изменение: `runPipeline()` для `serial_debate_2` теперь строит feed scenario, требует ровно две выбранные header-модели и конкретный receiver, отправляет initial moderator envelope только в выбранную Model A (`models: [serialScenario.modelA]`) и не выполняет старый multi-round Pro loop для serial run.
- Для чего: manual mode должен маршрутизировать утверждённый ответ A в B только после approve. Изменение: `approveDebateCard()` вызывает serial approve bridge; если в `.moderator-input textarea` есть текст, он добавляется в ленту как Moderator comment и уходит в следующий envelope вместе с approved answer A и первичным moderator header.
- Для чего: auto mode не должен превращаться в parallel pipeline. Изменение: serial auto route использует тот же A↔B opponent routing и ограничивается `rounds * 2` dispatches.
- Для чего: сделать ход диспута понятным для анализа LLM без большого All Logs export. Изменение: в Diagnostics actions добавлена кнопка `Disput`, экспортирующая компактный Markdown flow: Moderator -> A, A -> Moderator, Approved, Moderator -> B, errors/completion.
- Для чего: привести Pro terminology к текущему режиму. Изменение: видимые `Judge` stage labels переименованы в `Disput`; `.control-buttons` при init перемещается сразу под `.prompt-group` с `15px` отступом; R1 Pro selection принудительно синхронизируется с header model buttons.
- Проверки: `node --check results.js shared/debate-engine.js background/debate-executor.js background/message-router.js background/index.js` passed; focused `npm test -- --runInBand tests/debate-engine.test.js tests/debate-executor.test.js tests/results-debate-favorites.test.js tests/release-log-regressions.test.js` — 4 suites / 44 tests green; полный `npm test -- --runInBand` — 50 suites / 240 tests green; локальная Playwright DOM-проверка `pipeline_panel.html` на 1440px и 390px подтвердила `bodyOverflowX=0`, видимые `Disput` export и `R2 Disput`, перенос `.control-buttons` сразу под `.prompt-group` с `15px` отступом, видимый round selector и стабильную send button. Реальный model smoke-run не запускался: requires manual auth on model pages.
- Версия: `manifest.json` 2.74.110 → 2.74.111.

### 2026-06-12 00:20 CEST — Serial Debate 2-model contract 2.74.110
- Для чего: зафиксировать MVP-режим управляемого диспута `serial_debate_2`, где один run состоит строго из двух моделей `A/B`, а один round равен двум ходам `A turn + B turn`. Изменение: `shared/debate-engine.js` получил `SerialDebateScenario`, `SerialDebateRun`, serial turn schema без `finalText`, `buildSerialDebateEnvelope()`, progress/completion helpers, auto/manual routing policy и error-stop contract на отсутствие usable response.
- Для чего: не передавать моделям полную историю как hidden summary. Изменение: serial envelope содержит только тему, роль, формат без системного ограничения объёма, последний ответ оппонента и сообщение модератора; блок `[ФИНАЛЬНЫЙ РАУНД]` добавляется только для последнего round.
- Для чего: связать Feed/Pro с единым run-state. Изменение: `background/debate-executor.js` при `START_DEBATE_RUN` c `serial_debate_2` создаёт и сохраняет `serialRun`, возвращает его в `GET_DEBATE_STATE`, синхронизирует статус при `PAUSE_DEBATE` / `RESUME_DEBATE` / `CANCEL_DEBATE`; web dispatch пока остаётся в существующем Pipeline transport.
- Для чего: сделать `.debate-turn-limit` именно round selector, а не числовой turns input. Изменение: в `pipeline_panel.html` рядом со Start/Pause добавлен dropdown `debate-round-limit-select` (`1/2/3/5/∞`), hidden legacy `debate-max-turns-input` оставлен compatibility bridge; `results.js` вычисляет `maxTurns = rounds * 2`, передаёт `mode: serial_debate_2` и `turnLimit` в background/transcript settings.
- Для чего: закрепить контракт тестами без реального логина в модели. Изменение: расширены `tests/debate-engine.test.js`, `tests/debate-executor.test.js`, `tests/results-debate-favorites.test.js`, `tests/release-log-regressions.test.js`.
- Проверки: `node --check shared/debate-engine.js background/debate-executor.js results.js` passed; focused `npm test -- --runInBand tests/debate-engine.test.js tests/debate-executor.test.js tests/results-debate-favorites.test.js tests/release-log-regressions.test.js` — 4 suites / 43 tests green; полный `npm test -- --runInBand` — 50 suites / 239 tests green; локальная Playwright DOM-проверка `pipeline_panel.html` на 1440px и 390px подтвердила `bodyOverflowX=0`, видимый `debate-round-limit-select=3`, hidden legacy `debate-max-turns-input`, `mod-send-btn` width 32px/sticky и видимый `Manual` policy select. Реальный model smoke-run не запускался: requires manual auth on model pages.
- Версия: `manifest.json` 2.74.109 → 2.74.110.

### 2026-06-11 21:35 CEST — DebateEngine foundation and executor 2.74.109
- Для чего: начать перевод Pipeline/Debate от UI-only имитации беседы к явному DebateEngine contract. Изменение: добавлен `shared/debate-engine.js` с transcript store, session/turn schema, FSM states, scheduling modes, delivery ledger, context-pack builder, model-moderator command parser, export/replay и Markdown export.
- Для чего: вынести lifecycle Debate в background-ready слой без подмены существующего pipeline dispatch. Изменение: добавлен `background/debate-executor.js`; service worker загружает `shared/debate-engine.js` и executor, `message-router.js` делегирует `START_DEBATE_RUN`, `GET_DEBATE_STATE`, `APPROVE_DEBATE_TURN`, `REJECT_DEBATE_TURN`, `STEP_DEBATE`, `PAUSE_DEBATE`, `RESUME_DEBATE`, `CANCEL_DEBATE`; UI синхронизирует start/pause/resume/cancel без блокировки legacy pipeline.
- Для чего: сделать ленту Debate пригодной для восстановления, экспорта и дальнейшего multi-model orchestration. Изменение: `results.js` зеркалит moderator/model cards в структурированный DebateEngine transcript artifact, сохраняет turnId/status/targets/text/html/terminal evidence, очищает и удаляет turns вместе с UI, восстанавливает persisted transcript из storage при загрузке и умеет рендерить cards из artifact/store. Debug surface получил `collectDebateArtifact()` / `collectDebateMarkdown()` / `hydrateDebateTranscriptFromArtifact()`. `pipeline_panel.html` и `result_new.html` подключают `shared/debate-engine.js`.
- Для чего: закрепить контракт тестами без реального логина в модели. Изменение: добавлены `tests/debate-engine.test.js`, `tests/debate-executor.test.js`, расширены `tests/results-debate-favorites.test.js` и `tests/release-log-regressions.test.js`.
- Проверки: `node --check shared/debate-engine.js background/debate-executor.js background/message-router.js background/index.js results.js` passed; focused `npm test -- --runInBand tests/debate-engine.test.js tests/debate-executor.test.js tests/results-debate-favorites.test.js tests/release-log-regressions.test.js` — 4 suites / 38 tests green; полный `npm test -- --runInBand` — 50 suites / 234 tests green; локальная Playwright DOM-проверка `pipeline_panel.html` на 1440px и 390px подтвердила `bodyOverflowX=0`, `mod-send-btn` width 32px/sticky, видимый `Manual` policy select и hidden legacy `auto-checkbox`. Реальный model smoke-run не запускался: requires manual auth on model pages.
- Версия: `manifest.json` 2.74.108 → 2.74.109.

### 2026-06-11 21:10 CEST — Debate run policy control 2.74.108
- Для чего: `Auto` checkbox в основной строке Debate был неоднозначным и конфликтовал с планом “идеального DebateEngine”, где auto должен быть approval/run policy, а не отдельным checkbox. Изменение: видимый `Auto` checkbox заменён на явный `debate-run-policy-select` со значениями `Manual` / `Auto`; старый `auto-checkbox` оставлен hidden compatibility bridge для существующего `autoMode`/top-toggle кода; `waitForDebateApproval()` теперь читает `isDebateAutoPolicy()`. Файлы: `pipeline_panel.html`, `results.js`, `styles.css`.
- Для чего: сохранить release safety. Изменение: регрессия в `tests/release-log-regressions.test.js` проверяет наличие policy select, hidden compatibility checkbox и новую policy-функцию.
- Проверки: `node --check results.js` passed; focused `npm test -- --runInBand tests/release-log-regressions.test.js tests/results-debate-favorites.test.js` — 2 suites / 22 tests green; полный `npm test -- --runInBand` — 48 suites / 218 tests green; Playwright DOM-проверка `pipeline_panel.html` на 1440px и 390px подтвердила видимый `Manual` policy select 66px, hidden legacy `auto-checkbox`, `mod-send-btn` width 32px/sticky visibility и отсутствие body horizontal overflow.
- Версия: `manifest.json` 2.74.107 → 2.74.108. Реальный model smoke-run не запускался: изменение относится к локальному Debate UI/control flow.

### 2026-06-11 20:55 CEST — Debate toolbar compact controls 2.74.107
- Для чего: в верхней строке Pipeline/Debate кнопка отправки запроса сжималась по ширине и могла уезжать вправо из-за соседних select/checkbox controls. Изменение: уменьшены gaps, padding и размеры compact select, `Max turns` input и checkbox toggle на 1-2px; закрытая ширина top-row select зафиксирована компактнее; `top-new-pages-toggle` в этой строке сгруппирован как compact inline-flex; `mod-send-btn` закреплена как `flex: 0 0 32px` и `sticky` справа внутри toolbar, чтобы send icon не сжимался и оставался видимым. Файл: `styles.css`.
- Проверки: focused `npm test -- --runInBand tests/release-log-regressions.test.js tests/results-debate-favorites.test.js` — 2 suites / 22 tests green; полный `npm test -- --runInBand` — 48 suites / 218 tests green; Playwright DOM-проверка `pipeline_panel.html` на 1440px и 390px подтвердила `mod-send-btn` width 32px, `flex: 0 0 32px`, sticky visibility внутри toolbar, `Action` select 136px, length select 56px и отсутствие body horizontal overflow.
- Версия: `manifest.json` 2.74.106 → 2.74.107. Реальный model smoke-run не запускался: изменение относится к локальной CSS-геометрии.

### 2026-06-11 20:45 CEST — Debate compact icon toggle 2.74.106
- Для чего: единая `Run/Pause/Resume` кнопка и верхние debate controls не помещались в одну строку рядом с `Max turns`. Изменение: `debate-run-toggle-btn` стала компактной icon-only кнопкой: `▶` для run/resume и `Ⅱ` для pause; текстовое состояние сохранено в `title` и `aria-label`; верхний toolbar теперь не переносит элементы и использует локальный horizontal scroll на узком экране, не расширяя страницу. Файлы: `pipeline_panel.html`, `results.js`, `styles.css`.
- Для чего: закрепить UX contract. Изменение: регрессия в `tests/release-log-regressions.test.js` проверяет icon-only toggle и доступный `aria-label`.
- Проверки: `node --check results.js` passed; focused `npm test -- --runInBand tests/release-log-regressions.test.js tests/results-debate-favorites.test.js` — 2 suites / 22 tests green; полный `npm test -- --runInBand` — 48 suites / 218 tests green; Playwright DOM-проверка `pipeline_panel.html` на 1440px и 390px подтвердила одну строку toolbar (`rowHeight=32`), icon-only toggle и отсутствие body horizontal overflow.
- Версия: `manifest.json` 2.74.105 → 2.74.106. Реальный model smoke-run не запускался: изменение относится к локальному UI/control flow.

### 2026-06-11 20:35 CEST — Debate single run toggle 2.74.105
- Для чего: убрать дублирование `Run/Resume` и `Pause` в Pipeline/Debate. Изменение: две кнопки заменены одной `debate-run-toggle-btn`, которая в idle показывает `▶ Run`, во время активного run/approval показывает `Ⅱ Pause`, а в paused state показывает `▶ Resume`; ширина кнопки стабилизирована, чтобы смена состояния не сдвигала `Max turns`; soft pause semantics сохранены, `Stop` не добавлен. Файлы: `pipeline_panel.html`, `results.js`, `styles.css`.
- Для чего: закрепить UI contract. Изменение: регрессия в `tests/release-log-regressions.test.js` проверяет наличие единой toggle-кнопки и отсутствие старых отдельных `debate-start-btn` / `debate-pause-btn`.
- Проверки: `node --check results.js` passed; focused `npm test -- --runInBand tests/release-log-regressions.test.js tests/results-debate-favorites.test.js` — 2 suites / 22 tests green; полный `npm test -- --runInBand` — 48 suites / 218 tests green; локальная Playwright DOM-проверка `pipeline_panel.html` на 1440px и 390px подтвердила видимость единой кнопки, отсутствие старых id и отсутствие горизонтального overflow.
- Версия: `manifest.json` 2.74.104 → 2.74.105. Реальный model smoke-run не запускался: изменение относится к локальному UI/control flow.

### 2026-06-11 20:20 CEST — Debate soft pause controls 2.74.104
- Для чего: подготовить Pipeline/Debate UI к управляемой беседе без отдельной destructive `Stop` кнопки. Изменение: над moderator send controls добавлен `Run/Resume`, `Pause` и `Max turns`; `Pause` теперь является soft pause — она не вызывает `cancelPipelineRun()` и не прерывает текущую генерацию, а останавливает auto-continue на следующей точке approval. Файлы: `pipeline_panel.html`, `results.js`, `styles.css`.
- Для чего: auto debate не должен быть бесконечным. Изменение: `waitForDebateApproval()` считает auto-continued turns и при достижении `Max turns` переводит Debate в paused state с уведомлением; `Run/Resume` продолжает ожидание без нового run. Файл: `results.js`.
- Для чего: закрепить UX contract. Изменение: добавлена регрессия в `tests/release-log-regressions.test.js`, что `Pause` не возвращает старое cancel-поведение; focused tests `npm test -- --runInBand tests/results-debate-favorites.test.js tests/release-log-regressions.test.js` — 2 suites / 22 tests green; полный `npm test -- --runInBand` — 48 suites / 218 tests green. Локальная Playwright DOM-проверка `pipeline_panel.html` на 1440px и 390px подтвердила видимость `Run`, `Pause`, `Max turns` и отсутствие горизонтального overflow.
- Версия: `manifest.json` 2.74.103 → 2.74.104. Реальный model smoke-run не запускался: изменение проверяет UI/control flow и не требует авторизации моделей.

### 2026-06-11 19:45 CEST — Smoke-run telemetry cleanup 2.74.103
- Для чего: реальный прогон `2.74.102`, run `1781197522635`, экспорт `Codex - All Logs 20260611_19-11.md`, завершился 8/8 `SUCCESS`, но после terminal success у DeepSeek и Le Chat в экспорт попали stale lifecycle-события `ANSWER_COMPLETE_TIMEOUT`/`ANSWER_PARTIAL_ON_TIMEOUT`, создавая противоречие `SUCCESS` vs late partial timeout. Изменение: post-terminal noise policy теперь отбрасывает эти timeout lifecycle labels в `ModelRunState` и `telemetry-logs` так же, как уже отбрасывались `ANSWER_GENERATING` и `answer: layer semantic`. Файлы: `shared/model-run-state.js`, `background/telemetry-logs.js`.
- Для чего: `TRANSPORT_DECISION` отсутствовал в smoke-run export, когда API mode был выключен, потому что `tryApiDirect()` вообще не вызывался при `useApiFallback=false`. Изменение: `startModelForLLM()` всегда проходит через `tryApiDirect()`; disabled API path эмитит и сохраняет явное решение `web_ui:api_mode_disabled` с `dispatchReason=start_model`, после чего продолжает Web UI dispatch. Файл: `background/job-orchestrator.js`.
- Для чего: `Telemetry Rounds` неверно показывал R4 done по времени `MODEL_FINAL`, хотя фактические `ROUND4_START/ROUND4_END` наступали позже; Perplexity в логе показывал R4 как `19:05:50`, хотя реальные R4 events были `19:08:16/19:08:18`. Изменение: MD export и devtools rounds matrix больше не трактуют `MODEL_FINAL`/`FINAL_STATUS` как `ROUND4_END`; R4 строится только по round telemetry. Файлы: `results.js`, `results-devtools.js`.
- Для чего: закрепить регрессии. Изменение: добавлен `tests/release-log-regressions.test.js`, расширен `tests/post-terminal-diagnostics.test.js`. Тесты: `npm test -- --runInBand tests/post-terminal-diagnostics.test.js tests/model-run-state.test.js tests/transport-policy.test.js tests/release-log-regressions.test.js` — 4 suites / 17 tests green; полный `npm test -- --runInBand` — 48 suites / 217 tests green. Реальный login smoke-run не запускался: требуется ручная авторизация.
- Версия: `manifest.json` 2.74.102 → 2.74.103. Ожидаемый признак в следующем smoke-run/export: после `MODEL_FINAL SUCCESS` нет поздних `ANSWER_PARTIAL_ON_TIMEOUT`; по всем моделям есть `TRANSPORT_DECISION` даже при disabled API mode; R4 в `Telemetry Rounds` совпадает с реальными `ROUND4_*` events.

### 2026-06-11 11:20 CEST — Transport policy hardening 2.74.102
- Для чего: сделать выбор между direct API и Web UI явным product contract, а не побочным эффектом наличия API key. Изменение: добавлен `shared/transport-policy.js` с решениями `api_first`, `web_ui`, `api_unavailable`, `blocked`; policy учитывает `apiModeEnabled`, наличие API config/key, доступность Web UI, model policy и количество attachments. Файлы: `shared/transport-policy.js`, `shared/model-policy.js`, `background/index.js`.
- Для чего: не терять вложения из-за скрытого API-first пути. Изменение: `tryApiDirect()` получает `attachments`, пишет `TRANSPORT_DECISION`, сохраняет `entry.transportDecision` и не запускает API direct при attachments, пока model policy явно не объявит `apiSupportsAttachments=true`; запросы с attachments уходят в Web UI transport. Файл: `background/job-orchestrator.js`.
- Для чего: API-ответы должны иметь те же доказательства финализации, что и DOM/materialize/snapshot ответы. Изменение: successful API fallback передаёт `responseMeta.source=api`, `answerSource=api`, `completionReason=api_response`; `AnswerEvidence` добавил `api` source kind и терминальный reason `api_with_text`. Файлы: `background/api-fallback.js`, `shared/answer-evidence.js`.
- Для чего: закрепить новый контракт тестами без реального логина в модели. Изменение: добавлен `tests/transport-policy.test.js`, расширен `tests/answer-evidence.test.js` API-case. Тесты: `npm test -- --runInBand tests/transport-policy.test.js tests/answer-evidence.test.js tests/model-policy.test.js tests/finalization-evidence.test.js` — 4 suites / 26 tests green; полный `npm test -- --runInBand` — 47 suites / 214 tests green. Реальный login smoke-run не запускался, потому что требует ручной авторизации на страницах моделей.
- Версия: `manifest.json` 2.74.101 → 2.74.102. Ожидаемый признак в следующем smoke-run/export: по каждой модели появляется `TRANSPORT_DECISION`; API-success финализируется с `answerSource=api`; prompt с attachments не должен уходить через direct API без явной поддержки attachments в policy.

### 2026-06-11 10:27 CEST — Release readiness hardening 2.74.101
- Для чего: закрыть release-blocker review по terminal outcome taxonomy. Изменение: `EXTERNAL_LLM_FAILURE`, `USER_ACTION_REQUIRED`, `UNCERTAIN` стали first-class terminal failure statuses в `LLMStatusContract`, `FinalizationController`, `ModelRunState`, telemetry export и replay harness; `RECOVERABLE_ERROR` остаётся non-terminal. Файлы: `shared/status-contract.js`, `shared/finalization-controller.js`, `shared/model-run-state.js`, `shared/telemetry-export.js`, `shared/log-replay-harness.js`, `background/shared-state.js`.
- Для чего: user-action blockers не должны превращаться в поздний generic `NO_SEND`. Изменение: non-retryable page-ready blockers (`auth_required`, `captcha`, `wrong_page` и похожие) завершаются через `handleLLMResponse()` как `USER_ACTION_REQUIRED`; provider/rate-limit/model-unavailable ошибки маппятся в `EXTERNAL_LLM_FAILURE`, truly unknown failure — в `UNCERTAIN`. Файлы: `background/dispatch-coordinator.js`, `background/job-orchestrator.js`.
- Для чего: UI и export должны отличать частичный ответ от полного success. Изменение: `PARTIAL`/`STREAM_TIMEOUT_HIDDEN` получили отдельный `partial` status class, добавлены UI classes/tooltips для `USER_ACTION_REQUIRED`, `EXTERNAL_LLM_FAILURE`, `UNCERTAIN`; `MODEL_FINAL` telemetry больше не помечает новые failure outcomes как success-level. Файлы: `results.js`, `styles.css`, `background/job-orchestrator.js`.
- Для чего: закрепить контракт тестами и убрать шум, мешавший читать CI output. Изменение: добавлены проверки новых terminal outcomes в status contract, telemetry export, background run summary и failure classification; jsdom `window.scrollBy` теперь глушится принудительно в setup. Файлы: `tests/status-contract.test.js`, `tests/telemetry-export.test.js`, `tests/run-outcome-summary.test.js`, `tests/finalization-evidence.test.js`, `tests/setupEnv.js`.
- Тесты: `npm test -- --runInBand` — 46 suites / 209 tests green. Реальный 8-model smoke-run не выполнялся: он требует ручной авторизации на страницах моделей и остаётся обязательным release gate перед фактической публикацией.
- Версия: `manifest.json` 2.74.100 → 2.74.101. Ожидаемый признак в следующем smoke-run: auth/captcha/wrong-page сценарии дают `MODEL_FINAL USER_ACTION_REQUIRED`, provider/rate-limit — `MODEL_FINAL EXTERNAL_LLM_FAILURE`, uncertain state — `MODEL_FINAL UNCERTAIN`; MD/JSON exports отражают эти outcomes в Run Summary.

### 2026-06-11 09:00 CEST — Smoke-run follow-up 2.74.100 (по реальному прогону `2.74.99`, run `1781159284885`, экспорт `All Logs 20260611_08-35.md`)
- Для чего: smoke-run подтвердил `Run Summary (background state)` в MD-экспорте (`Run state: complete`, все 8 моделей с финальными статусами, Qwen 866 chars корректно помечен `suspect short`) и отсутствие флуда `ANSWER_GENERATING`. Но пользователь визуально подтвердил: Grok вернул только часть ответа, при этом приложение финализировало его `SUCCESS` (len=550, source=preserved_pending) после `SCRIPT_RUNTIME_HARD_STOP` 180s — без какого-либо completion evidence (`ANSWER_COMPLETE_DETECTED`/`ANSWER_TEXT_STABLE` отсутствуют). Текст, спасённый recovery в hard-stop контексте, нельзя доказать полным. Изменение: добавлен `classifyMaterializeRecoveryFinality()` — materialize recovery в hard-stop/timeout контексте без lifecycle completion evidence финализируется как `PARTIAL` (`completionReason=hard_stop_recovered_partial`, sanityConfidence 0.72); при наличии completion evidence или в benign-контексте (например `no_send` с сохранённым завершённым ответом) остаётся `SUCCESS`. `partial_from_snapshot` остаётся `PARTIAL` всегда. Файл: `background/job-orchestrator.js`.
- Для чего: последствие правила — GPT в том же прогоне (тот же путь hard_stop+preserved_pending без completion evidence, len=1561) теперь тоже получит `PARTIAL`: это сознательный консервативный выбор — без evidence полноты статус не должен утверждать полноту; double-click/manual late collect может улучшить контент и поднять terminal через существующий upgrade path. Зафиксировано как policy decision.
- Для чего: закрепить регрессию тестами. Изменение: добавлен `tests/materialize-recovery-finality.test.js` — Grok-кейс (hard stop без evidence → PARTIAL), hard stop с completion evidence → SUCCESS, benign `no_send` → SUCCESS, `partial_from_snapshot` → PARTIAL, и end-to-end через `acceptLateCollectResult`: recovered 550-символьный текст финализируется `PARTIAL` с `lengthPolicy` reference. Итог: 46 suites / 206 tests green.
- Версия: `manifest.json` 2.74.99 → 2.74.100. Ожидаемый признак в следующем smoke-run: аналогичный hard-stop кейс даёт `MODEL_FINAL PARTIAL`, в `Run Summary` — `PARTIAL`, карточка в UI показывает partial label; SUCCESS появляется только при наличии completion evidence.

### 2026-06-11 08:30 CEST — Smoke-run follow-up 2.74.99 (по реальному прогону `2.74.98`, run `1781157526316`, экспорт `All Logs 20260611_08-04.md`)
- Для чего: smoke-run подтвердил исправления 2.74.98 (ни одного `ROUND4_FORCE_FINAL`, gate закрылся штатно `ROUND4_END results tab focused`, Round2 repair восстановил delayed confirmation, все 8 моделей вернули ответы), но вскрыл флуд диагностики: DeepSeek с застрявшим loading-индикатором поверх стабильного текста эмитил `ANSWER_GENERATING state=GENERATING textLength=4276` на каждом poll-тике (~50 одинаковых событий), вытесняя terminal-события из storage-буфера. Изменение: lifecycle detector троттлит `ANSWER_GENERATING` — повторная эмиссия только при изменении `textLength` или раз в 15с (`ANSWER_GENERATING_TELEMETRY_THROTTLE_MS`). Файл: `content-utils/response-lifecycle-detector.js`.
- Для чего: MD-экспорт smoke-run не содержал ни одного terminal-события и имел пустую секцию Diagnostics (page-side `llmLogs`/bridge-кэш теряются при reload страницы результатов; storage-буфер lossy) — подтвердить SUCCESS моделей по экспорту было невозможно. Изменение: добавлен background message `GET_RUN_OUTCOME_SUMMARY`, который строит per-model итог из `jobState` (finalStatus, terminal, finalizedAt, answerLength, answerSource, `lengthPolicyRef`, `suspectShortSuccess`); MD-экспорт «All Logs» добавляет секцию `## Run Summary (background state)` с маркером `export during active run`/`complete`, переживающую любой reload UI. Файлы: `background/message-router.js`, `results.js`.
- Для чего: закрепить регрессии тестами. Изменение: добавлены `tests/lifecycle-generating-throttle.test.js` (стабильный текст + застрявший индикатор даёт ≤2 события вместо ~30; рост текста пробивает троттл) и `tests/run-outcome-summary.test.js` (контракт `GET_RUN_OUTCOME_SUMMARY`: terminal/non-terminal модели, `complete`-флаг, suspect short success, отсутствие jobState). Итог: 45 suites / 201 tests green.
- Версия: `manifest.json` 2.74.98 → 2.74.99. Остаточное наблюдение: `ANSWER_PARTIAL_ON_TIMEOUT` у DeepSeek пришёл через 27с после `ROUND4_END` — поздний lifecycle-сигнал после завершения run корректно не менял terminal state, но требует подтверждения в следующем smoke-run экспорте (ожидаем `Run Summary` с финальным статусом DeepSeek).

### 2026-06-11 00:00 CEST — Release stabilization 2.74.98 (по реальному прогону `2.74.97`, run `1781134505984`, экспорты `All Logs 20260611_01-39.md` + `telemetry-1781134749690.json`)
- Для чего: убрать дубли `ROUND4_FORCE_FINAL no_send_stall` (в реальном прогоне Qwen получил 8 повторов за 14 секунд, каждый повтор заново входил в `handleLLMResponse(no_send)` пока шла async materialize recovery). Изменение: `finalizeNoSendModelIfStalled()` стал one-shot per dispatch через `entry.round4ForceFinalKey/round4ForceFinalAt`; новый dispatchId (manual retry) заново разрешает force-final; gate-timeout ветка получила собственный one-shot ключ `gate_timeout:<dispatchId>`. Файл: `background/job-orchestrator.js`.
- Для чего: сделать 190-секундное ожидание Round4 gate видимым в экспортах (Grok и Le Chat висели в нём без какого-либо telemetry-сигнала на момент экспорта). Изменение: цикл `waitForRound4Gate()` каждые 15с (`ROUND4_GATE_WAIT_TELEMETRY_MS`) пишет `ROUND4_GATE_WAIT` с `extraction_pending`/`awaiting_submit_confirmation`, `elapsedMs`, `waitMaxMs` и dispatchId по каждой pending-модели. Файл: `background/job-orchestrator.js`.
- Для чего: переживать SW restart без повторного force-final того же dispatch. Изменение: `compactJobStateForStorage()` сохраняет `round4ForceFinalKey`, `round4ForceFinalAt`. Файл: `shared/pipeline-fsm.js`.
- Для чего: убрать наложение DOM fallback loops у Grok (в реальном прогоне одновременно работали ~6 циклов по 45с, фактический elapsed 46–63с > заявленного timeout). Изменение: `waitForDomAnswer()` стал single-flight — конкурентные вызовы с тем же prompt присоединяются к активному циклу (`DOM_FALLBACK_JOINED`), новый цикл стартует только после завершения предыдущего; функция экспортирована в `window.__grokAllCopyV6` для тестов. Файл: `content-scripts/content-grok.js`.
- Для чего: устранить разрозненные/противоречивые пороги длины ответа (orchestrator 80, dispatch-coordinator fallback 120, answer-evidence собственные 80/1200/1200) и дать terminal `SUCCESS` явную ссылку на policy. Изменение: добавлен `shared/answer-length-policy.js` (`answer-length-policy@1`): default `minTerminalChars=80`, `stableForceMinChars=1200`, `snapshotTerminalMinChars=1200`, `shortSuccessSuspectMaxChars=400`, per-model exceptions пока не требуются (структура `MODEL_OVERRIDES` зарезервирована); `answer-evidence` и orchestrator-константы читают пороги из policy, dispatch-coordinator больше не использует мёртвый fallback `|| 120`. Файлы: `shared/answer-length-policy.js`, `shared/answer-evidence.js`, `background/job-orchestrator.js`, `background/dispatch-coordinator.js`, `background/index.js`.
- Для чего: сделать подозрительно короткий SUCCESS диагностируемым (в реальном прогоне Claude закрылся `SUCCESS` на 233 символах при 2.4–5k у остальных моделей; правомерность ответа нельзя было оценить по экспорту). Изменение: `buildFinalizationEvidence()` пишет `lengthPolicy` (policyRef, пороги, `meetsTerminalMin`, `suspectShortSuccess`) в finalization evidence каждого terminal outcome; accepted SUCCESS короче 400 символов даёт warning `ANSWER_LENGTH_SUSPECT` (без смены статуса). Файлы: `background/job-orchestrator.js`, `background/telemetry-logs.js`.
- Для чего: исправить telemetry/export completeness defect — JSON-экспорт того же прогона не содержал ни одного terminal/finalization события (при пустом UI-фильтре экспортировался только результат фильтра ≈ round events), тогда как MD-экспорт их содержал. Изменение: JSON-экспорт сериализует полный run-scoped кэш без UI-фильтров и добавляет группу `<RUN_SUMMARY>` (per-model `MODEL_OUTCOME` с финальным статусом/`no_terminal_outcome` и `RUN_EXPORT_STATE` c `export_during_active_run`/`run_complete` и списком pending-моделей) через новый `shared/telemetry-export.js`. Файлы: `results-devtools.js`, `shared/telemetry-export.js`, `result_new.html`, `pipeline_panel.html`.
- Для чего: diagnostics storage не должен терять pinned terminal-события до экспорта (старый бюджет 200 записей/50KB вытеснял даже `MODEL_FINAL`). Изменение: бюджеты подняты до 400 записей/120KB в обоих write-путях, `FINALIZATION_DECISION` и `ANSWER_LENGTH_SUSPECT` добавлены в pinned labels read/write-трима. Файлы: `background/telemetry-logs.js`, `background/message-router.js`.
- Для чего: закрепить регрессии тестами. Изменение: добавлены `tests/round4-gate.test.js` (one-shot force-final, re-arm на новый dispatch, gate timeout → `extract_failed`, повторный gate без повторного финала, `ROUND4_GATE_WAIT`), `tests/grok-dom-fallback.test.js` (single-flight loop), `tests/answer-length-policy.test.js` (policy thresholds, `lengthPolicy` в evidence, `ANSWER_LENGTH_SUSPECT` на короткий SUCCESS и его отсутствие на failure), `tests/telemetry-export.test.js` (terminal/no-terminal summary, приоритет `MODEL_FINAL` над `RECOVERABLE_ERROR`, `export_during_active_run` на replay реального прогона). Итог: 43 suites / 196 tests green (baseline 39/170).
- Версия: `manifest.json` 2.74.97 → 2.74.98. Примечание: green test suite ≠ release-ready; требуется реальный мульти-модельный smoke-run с анализом обоих экспортов (checklist в финальном отчёте).

### 2026-06-10 00:00 CEST
- Для чего: исправить реальный прогон `2.74.96`, где Qwen сгенерировал ответ, но приложение не смогло его забрать и manual ping повторно видел prompt echo. Изменение: Qwen сохраняет текущий prompt для manual extraction, `getResponses` вызывает `waitForQwenReply()` с prompt-aware фильтрацией, отклоняет prompt echo как `prompt_echo_or_invalid_candidate`, а перед terminal error делает last-chance DOM extraction с тем же baseline/prompt guard. Файл: `content-scripts/content-qwen.js`.
- Для чего: не допустить регрессии, где prompt echo принимается за ответ Qwen. Изменение: экспортирован тестируемый `isQwenAnswerCandidate()` и добавлен unit-тест на rejection prompt echo и acceptance валидного ответа. Файл: `tests/qwen-extraction.test.js`.
- Для чего: исправить реальный прогон `2.74.96`, где Gemini вставил prompt, но не отправил его. Изменение: Gemini dispatch получил расширенные send selectors, scored resolver кнопки отправки, fallback-стратегии `ctrl_enter/button_click/plain_enter/meta_enter/form_submit/scored_button_click` и диагностические события по каждой стратегии; `PROMPT_SUBMITTED` по-прежнему отправляется только после подтверждения отправки. Файл: `content-scripts/content-gemini.js`.

### 2026-06-10 00:00 CEST
- Для чего: исправить уточнённый симптом Gemini из реального прогона `2.74.94`, где запрос фактически не отправился, а manual/late collect принял предыдущий ответ из `snapshot_cache` как текущий результат. Изменение: `acceptLateCollectResult()` теперь отклоняет snapshot-like evidence (`snapshot_cache`, inline DOM, DOM snapshot) при неподтверждённом текущем dispatch (`promptSubmittedAt/submitSource` отсутствуют) и пишет `LATE_COLLECT_STALE_ANSWER_REJECTED`. Файл: `background/job-orchestrator.js`.
- Для чего: не закрывать модель `PARTIAL/SUCCESS` старым DOM-снимком при `awaitingSubmitConfirmation`. Изменение: добавлен regression test, где `partial_from_snapshot` без submit confirmation не меняет terminal state. Файл: `tests/early-terminal-guard.test.js`.

### 2026-06-09 00:00 CEST
- Для чего: исправить регрессию из реального прогона `2.74.94`, где `ROUND2_REPAIR_CONFIRM_WAIT` честно видел `dispatch_pending`, но pre-visit repair всё равно завершался как `ROUND2_REPAIR_DISPATCH_FAIL` и `not_confirmed_after_repair`. Изменение: `dispatch_pending` после repair теперь классифицируется как `ROUND2_REPAIR_DISPATCH_PENDING`, переводит Round2 в `awaiting_delayed_confirmation_after_repair` и планирует precollect/adaptive probes. Файл: `background/job-orchestrator.js`.
- Для чего: сделать pre-visit и post-visit repair одинаковыми по delayed-confirmation policy. Изменение: добавлены `isRound2DelayedConfirmationState()` и `scheduleRound2DelayedConfirmationContinuation()`, общие для обеих веток Round2. Файл: `background/job-orchestrator.js`.
- Для чего: закрепить contract тестом. Изменение: тест delayed Round2 dispatch теперь проверяет, что `dispatch_pending` распознаётся как delayed confirmation state, а не hard `not_confirmed`. Файл: `tests/early-terminal-guard.test.js`.

### 2026-06-09 00:00 CEST
- Для чего: убрать ложные `ROUND2_REPAIR_DISPATCH_FAIL`, когда реальная страница подтверждает отправку/начинает ответ с задержкой после repair-dispatch. Изменение: после `round2_repair_pre_visit` и `round2_repair` orchestrator ждёт bounded window `ROUND2_REPAIR_CONFIRM_WAIT_MS` с polling и принимает не только `promptSubmittedAt`, но и answer/lifecycle evidence как подтверждение. Файл: `background/job-orchestrator.js`.
- Для чего: не превращать delayed submit в немедленный `not_confirmed`, если dispatch ещё pending. Изменение: Round2 получил состояние `awaiting_delayed_confirmation`; для него планируются precollect/adaptive probes вместо hard warning path. Файл: `background/job-orchestrator.js`.
- Для чего: закрепить поведение тестами. Изменение: добавлены проверки, что Round2 answer evidence является confirmation signal, а pending dispatch остаётся `dispatch_pending`, а не `not_confirmed`. Файл: `tests/early-terminal-guard.test.js`.

### 2026-06-09 00:00 CEST
- Для чего: не принимать неполный ответ как terminal только потому, что текст стабилен, пока на странице ещё видна кнопка Stop. Изменение: `AnswerEvidence Lite` больше не считает `stable_text` terminal-eligible при `stopButtonVisible=true`; такой случай получает `rejectReason=stable_text_stop_visible` и остаётся в сборе. Файл: `shared/answer-evidence.js`.
- Для чего: не закрывать модель коротким DOM snapshot, который часто является началом ответа. Изменение: snapshot evidence без явного manual/materialize/final сигнала требует повышенный `snapshotTerminalMinChars=1200`; короткий snapshot получает `rejectReason=snapshot_text_too_short_without_terminal_signal`. Файл: `shared/answer-evidence.js`.
- Для чего: double-click/manual ping после terminal должен дотягивать полный текст, а не упираться в `duplicate_final`. Изменение: `acceptLateCollectResult()` теперь до повторной finalization обновляет сохранённый terminal answer и отправляет UI `LLM_PARTIAL_RESPONSE`, если late collect нашёл более длинный валидный текст; статус остаётся terminal, но содержимое карточки улучшается. Файл: `background/job-orchestrator.js`.
- Для чего: закрепить регрессию тестами. Изменение: добавлены проверки `stable_text_stop_visible`, короткого snapshot без terminal-сигнала и post-terminal улучшения ответа через manual late collect. Файлы: `tests/answer-evidence.test.js`, `tests/early-terminal-guard.test.js`.

### 2026-06-09 00:00 CEST
- Для чего: перевести DOM/snapshot/panel/materialize/timeout ответы на единый минимальный evidence contract. Изменение: добавлен `shared/answer-evidence.js` с `AnswerEvidence Lite` (`sourceKind`, length/hash, terminalEligible, partialAllowed, reason) и подключён в service worker. Файлы: `shared/answer-evidence.js`, `background/index.js`.
- Для чего: не держать модель в `RECEIVING`, если есть достаточный timeout/snapshot/materialize/panel/stable answer evidence, даже когда страница ещё показывает busy/generation indicator. Изменение: `maybeDeferStreamingFinalization()` теперь проверяет `AnswerEvidence.shouldFinalizeWithEvidence()` и форсирует terminal path с диагностикой `Finalization forced (answer evidence policy)`; timeout/hardstop-with-text маппится в `PARTIAL`, snapshot/materialize/panel/stable - в success-like finalization без нового UI-статуса. Файл: `background/job-orchestrator.js`.
- Для чего: сделать terminal state absorbing не только через `modelRunState`, но и через legacy `finalStatusRecorded/finalizedAt/finalStatus`. Изменение: `updateModelState()` теперь явно блокирует поздние `RECEIVING/GENERATING/OPEN` после legacy terminal и пишет `STATUS_IGNORED` с reason `legacy_terminal_blocks_non_terminal_status`. Файл: `background/state-manager.js`.
- Для чего: закрепить новый контракт тестами. Изменение: добавлены unit-тесты `AnswerEvidence Lite`, проверка timeout-with-text -> `PARTIAL`, интеграция answer evidence в `finalizationEvidence` и legacy terminal guard для late `RECEIVING`. Файлы: `tests/answer-evidence.test.js`, `tests/finalization-evidence.test.js`, `tests/state-manager-terminal-guard.test.js`.

### 2026-06-09 00:00 CEST
- Для чего: исправить реальный GPT-сбой, где prompt вообще не отправлялся. Причина: в `content-chatgpt.js` были вызовы `emitDiagnostic(...)`, но сама функция отсутствовала, что давало `emitDiagnostic is not defined` и terminal `ERROR`. Изменение: добавлен безопасный `emitDiagnostic()` в GPT content script. Файл: `content-scripts/content-chatgpt.js`.
- Для чего: не тратить Round2 batch budget на длинные verify-visits, когда prompt ещё не подтверждён. Изменение: `dispatchRound2Verification()` теперь делает `round2_repair_pre_visit` до verify visits; если repair подтвердил submit, сразу планирует precollect/adaptive probe, если не подтвердил - завершает модель как `not_confirmed_after_repair` без лишних вкладочных визитов. Файл: `background/job-orchestrator.js`.
- Для чего: не считать fallback materialize visit успешным после короткого/сорванного фокуса. Изменение: `focusTabForVerification()` теперь возвращает visit summary через `startTabVisit/finalizeTabVisit`, а `runPreTerminalMaterializeRecovery()` пишет `MATERIALIZE_RECOVERY_VISIT_FALLBACK_SHORT` и не выставляет `didVisit=true` для `shortVisit`. Файл: `background/job-orchestrator.js`.
- Для чего: не держать Gemini/Le Chat/DeepSeek бесконечно в `RECEIVING`, когда текст уже извлечён, но detector всё ещё видит `busy=true`. Изменение: `maybeDeferStreamingFinalization()` получил stable-answer escape hatch: длинный ответ без видимого Stop и с elapsed/evidence финализируется с диагностикой `Finalization forced (stable answer evidence)`. Файл: `background/job-orchestrator.js`.
- Для чего: закрепить finalization escape hatch тестом. Изменение: `early-terminal-guard.test.js` проверяет, что длинный стабильный answer при `busyVisible=true`, `stopVisible=false` финализируется, а кейс manual recovery с видимым Stop остаётся deferred. Файл: `tests/early-terminal-guard.test.js`.

### 2026-06-09 00:00 CEST
- Для чего: не считать сорванные переключения вкладок полноценными forced visits. Изменение: добавлен `shared/visit-policy.js`, который классифицирует фактическое foreground-время визита как `usefulVisit/shortVisit/retryable`; `human-presence.js` сохраняет summary, пишет `TAB_VISIT_SHORT` и возвращает фактический результат `visitTabWithAutomation()`. Файлы: `shared/visit-policy.js`, `background/human-presence.js`, `background/index.js`.
- Для чего: исправить порядок/длительность посещения вкладок из логов, где визиты на 100-600ms засчитывались как успешные. Изменение: `runForcedAutomationVisits()` больше не увеличивает performed counter для `shortVisit`, пишет `FORCED_VISIT_SHORT_RETRY` и повторяет тот же planned visit в рамках `maxShortRetries`. Файл: `background/job-orchestrator.js`.
- Для чего: не завершать чужой активный lease отложенным finalizer старого automation visit. Изменение: `endAutomationVisit()` финализирует только tracker той же модели, иначе возвращает сохранённый `lastAutomationVisitSummary`. Файл: `background/human-presence.js`.
- Для чего: закрепить регрессию тестами. Изменение: добавлены проверки `VisitPolicy` и сценария, где automation visit GPT прерывается переключением на вкладку Claude и возвращается как `shortVisit`, а не как успешный визит. Файлы: `tests/visit-policy.test.js`, `tests/human-presence-lease.test.js`.

### 2026-06-09 00:00 CEST
- Для чего: убрать ложный смысл `ROUND1_END dispatch complete`, когда prompt ещё не подтверждён content script. Изменение: Round1 теперь пишет `prompt confirmed` только при `PROMPT_SUBMITTED`, иначе `dispatch command sent (awaiting confirmation)` с `reason=awaiting_submit_confirmation`. Файл: `background/job-orchestrator.js`.
- Для чего: не оставлять GPT и Le Chat без repair после `prompt not confirmed`. Изменение: `ROUND2_REPAIR_MODELS` расширен до `GPT`, `Gemini`, `Claude`, `Grok`, `Le Chat`, `Qwen`. Файл: `background/job-orchestrator.js`.
- Для чего: сделать состояние неподтверждённой отправки явным для supervisor/replay/debug. Изменение: `dispatchPromptToTab(skipSubmitWait)` ставит `awaitingSubmitConfirmation*`, telemetry `PROMPT_SUBMITTED_PENDING`, а content/inferred submit очищает эти поля. Файлы: `background/dispatch-coordinator.js`, `background/message-router.js`, `background/job-orchestrator.js`.
- Для чего: следующий реальный лог должен показывать точную точку отказа отправки. Изменение: Qwen/GPT content scripts пишут diagnostics для `composer ready`, `paste attempted`, `value validated`, `send attempt`, `send confirmed/failed`. Файлы: `content-scripts/content-qwen.js`, `content-scripts/content-chatgpt.js`.
- Для чего: не терять причину отказа в manual-auth smoke. Изменение: `scripts/manual-auth-real-pages.js` после `START_RUN=1` запрашивает `GET_DIAG_EVENTS`, сохраняет diagnostics в report и печатает последние события в stdout. Файл: `scripts/manual-auth-real-pages.js`.
- Для чего: новый запуск не должен блокироваться зависшим старым run сообщением `Дождитесь завершения запроса на главной странице`. Изменение: `GET_ACTIVE_RUN_STATE` возвращает `staleActiveRun/sessionAgeMs` и не считает stale run активным после 15 минут без rounds; manual-auth перед UI-run отправляет `STOP_ALL` как preflight cleanup. Файлы: `background/message-router.js`, `results.js`, `scripts/manual-auth-real-pages.js`.

### 2026-06-09 00:00 CEST
- Для чего: разделить поведение иконки Tuning Console на обычный и двойной клик. Изменение: `#toggle-modifiers-btn` в `results.js` теперь по single-click сворачивает/разворачивает сам блок модификаторов, а по double-click раскрывает/сворачивает полный список карточек модификаторов; добавлена задержка, чтобы двойной клик не срабатывал как два одиночных. Файл: `results.js`.
- Для чего: не восстанавливать карточки ответов и HTML панели Favourite после refresh страницы и reload расширения. Изменение: bootstrap `results.js` теперь удаляет `shared.outputs` из `llmComparatorCrossViewUiState` до `restoreCrossViewUiState()`, поэтому сохранённые `.llm-panel .output`, `#comparison-output` и старый DOM `Favourite` больше не возвращаются из `chrome.storage.local` на старте. Файл: `results.js`.
- Для чего: безопасно тестировать реальные страницы моделей без передачи Google password/2FA в Codex. Изменение: добавлен `scripts/manual-auth-real-pages.js`, который запускает Playwright persistent profile, открывает реальные страницы выбранных моделей, ждёт ручной вход пользователя и пишет readiness report. Файл: `scripts/manual-auth-real-pages.js`.
- Для чего: проверить не только авторизацию, но и end-to-end prompt dispatch после ручного входа. Изменение: script поддерживает `START_RUN=1`, заполняет prompt в `result_new.html`, вызывает `START_FULLPAGE_PROCESS` и собирает output lengths. Файл: `scripts/manual-auth-real-pages.js`.
- Для чего: сделать запуск воспроизводимым. Изменение: добавлен npm script `auth:models`; профиль по умолчанию хранится в `.playwright-auth-profile`, отчёт в `artifacts/manual-auth-smoke-report.json`. Файл: `package.json`.
- Для чего: не сохранять OAuth query/email/nonce в тестовых логах. Изменение: manual-auth script пишет в stdout/report только `origin + pathname`, а auth blocker определяет по hostname/pathname и отсутствию composer. Файл: `scripts/manual-auth-real-pages.js`.

### 2026-06-08 00:00 CEST
- Для чего: превратить selector health profile из одноразового broken gate в lifecycle decision contract. Изменение: добавлен `shared/selector-profile-lifecycle.js` с решениями `use_current`, `monitor_degraded`, `rollback_to_last_known_good`, `fallback_only`. Файл: `shared/selector-profile-lifecycle.js`.
- Для чего: объяснимо выбирать поведение resolver при broken profile. Изменение: `SelectorResolverV2` теперь пишет `selectorProfileLifecycle` в diagnostics, пропускает exact/cache по lifecycle decision и отличает rollback-eligible профиль от fallback-only. Файл: `content-utils/selector-resolver-v2.js`.
- Для чего: загрузить lifecycle policy и в service worker, и на страницах моделей. Изменение: `background/index.js` импортирует shared-модуль, `manifest.json` подключает `shared/selector-profile-lifecycle.js` перед `content-utils/selector-resolver-v2.js` во всех content-script группах. Файлы: `background/index.js`, `manifest.json`.
- Для чего: закрепить lifecycle тестами. Изменение: добавлен `selector-profile-lifecycle.test.js`, resolver spec проверяет rollback decision для broken profile с last known good. Файлы: `tests/selector-profile-lifecycle.test.js`, `tests/selector-resolver-v2.spec.js`.

### 2026-06-08 00:00 CEST
- Для чего: получить offline replay baseline для diagnostics/telemetry без запуска вкладок и моделей. Изменение: добавлен `shared/log-replay-harness.js`, который нормализует события из `label/type/event`, `meta`, `telemetryTaxonomy`, `decisionLedger` и строит per-model итог. Файл: `shared/log-replay-harness.js`.
- Для чего: видеть causal failure classes в replay output. Изменение: harness считает `staleEvents`, `recoveryDenied`, `duplicateFinalIgnored`, `terminalEvents` и финальный статус модели только по принятому terminal decision. Файл: `shared/log-replay-harness.js`.
- Для чего: закрепить replay contract. Изменение: добавлен `log-replay-harness.test.js` для terminal accept, duplicate final ignored, stale quarantine и recovery denial. Файл: `tests/log-replay-harness.test.js`.

### 2026-06-08 00:00 CEST
- Для чего: привести page blockers к единой runtime taxonomy вместо разрозненных `login_required/captcha/wrong_page` строк. Изменение: добавлен `shared/page-blocker-policy.js` с alias-normalization и action policy (`terminal_user_action_required`, `retry_after_or_error`, `wait_retry`, `selector_health_degraded`). Файл: `shared/page-blocker-policy.js`.
- Для чего: не планировать бессмысленные dispatch retries при terminal blockers. Изменение: `normalizePageReadyState()` теперь добавляет `blockerPolicy`, terminal blockers переводят gate в blocked state, а retry не ставится при `retryable=false`. Файл: `background/dispatch-coordinator.js`.
- Для чего: закрепить поведение тестами. Изменение: добавлен `page-blocker-policy.test.js`, page-ready test проверяет нормализацию `login_required` в `auth_required` и terminal user-action policy. Файлы: `tests/page-blocker-policy.test.js`, `tests/page-ready-state.test.js`.

### 2026-06-08 00:00 CEST
- Для чего: получить объяснимую цепочку решений без разметки всех telemetry call-sites. Изменение: добавлен `shared/decision-ledger.js`, который хранит компактный per-model `decisionLedger` и `lastDecisionRecord`. Файл: `shared/decision-ledger.js`.
- Для чего: связать ledger с уже стабилизированными single-writer решениями. Изменение: `handleLLMResponse()` пишет `ignore_stale_event`, `accept_success`, `finalize_error`, `upgrade_terminal`, `ignore_duplicate_final`; RecoveryIntent denial пишет `deny_recovery_intent`. Файлы: `background/job-orchestrator.js`, `background/dispatch-coordinator.js`.
- Для чего: проверить causal trace baseline. Изменение: добавлен `decision-ledger.test.js`, orchestrator tests проверяют ledger records для stale identity и manual resend denial. Файлы: `tests/decision-ledger.test.js`, `tests/finalization-evidence.test.js`.

### 2026-06-08 00:00 CEST
- Для чего: не принимать stale events от другого run/dispatch/tab в terminal path. Изменение: добавлен `shared/run-identity.js` с `RunIdentity.build()` и `validateEvent()` для `runSessionId`, `dispatchId`, `tabId`, `promptHash`. Файл: `shared/run-identity.js`.
- Для чего: закрепить identity на момент отправки prompt. Изменение: `dispatchPromptToTab()` записывает `entry.runIdentity` при регистрации `dispatchId`. Файл: `background/dispatch-coordinator.js`.
- Для чего: quarantined stale response до финализации. Изменение: `handleLLMResponse()` заменил локальные session/dispatch проверки на `RunIdentity.validateEvent()`, пишет `entry.lastRunIdentityDecision` и telemetry `STALE_EVENT_QUARANTINED`. Файл: `background/job-orchestrator.js`.
- Для чего: покрыть contract тестами. Изменение: добавлен `run-identity.test.js`, orchestrator test проверяет, что response с чужим `runSessionId` не меняет terminal state. Файлы: `tests/run-identity.test.js`, `tests/finalization-evidence.test.js`.

### 2026-06-08 00:00 CEST
- Для чего: снизить риск зависаний после остановки MV3 Service Worker во время долгой генерации. Изменение: активный open-run поддерживает `llm_orchestrator_mv3_survival_v1` alarm, который будит SW и запускает `loadJobState()`. Файл: `background/job-orchestrator.js`.
- Для чего: восстановить runtime-поведение после rehydrate, а не только прочитать storage. Изменение: `loadJobState()` вызывает `rehydrateActiveJobRuntime()`, помечает `mv3RehydratedAt/mv3RehydrationCount`, сбрасывает stale in-flight флаги и re-arm collect/adaptive probes для моделей с подтверждённой отправкой. Файл: `background/job-orchestrator.js`.
- Для чего: закрепить baseline тестом. Изменение: orchestrator test проверяет, что сохранённый open job после `loadJobState()` получает rehydration metadata и создаёт survival alarm. Файл: `tests/finalization-evidence.test.js`.

### 2026-06-08 00:00 CEST
- Для чего: отделить read-only recovery от опасных mutating/resend действий. Изменение: добавлен `shared/recovery-intent.js` с intent-классами `observe_only`, `focus_only`, `nudge_generation`, `composer_repair`, `resend_prompt` и правилом `no_resend_after_answer_evidence`. Файл: `shared/recovery-intent.js`.
- Для чего: не отправлять prompt повторно, если уже есть terminal-eligible answer evidence. Изменение: `dispatchPromptToTab()` проверяет recovery intent для `manual_resend`, `round2_repair`, `retry_supervisor` и пишет `RECOVERY_INTENT_DENIED` вместо фокуса/перезагрузки/повторной отправки. Файл: `background/dispatch-coordinator.js`.
- Для чего: не мутировать state machine до проверки безопасности recovery. Изменение: `round2_repair` и `handleManualResendRequest()` вызывают `RecoveryIntent.authorize()` до reset/dispatch; manual resend возвращает `manual_resend_denied`, если есть сохранённый ответ. Файл: `background/job-orchestrator.js`.
- Для чего: закрепить No-Resend Guard тестами. Изменение: добавлен `recovery-intent.test.js`, а orchestrator тест проверяет отказ manual resend при `pendingFinalAnswer`. Файлы: `tests/recovery-intent.test.js`, `tests/finalization-evidence.test.js`.

### 2026-06-08 00:00 CEST
- Для чего: начать перевод финализации моделей из набора локальных проверок в single-writer runtime. Изменение: добавлен `shared/finalization-controller.js` с `tryFinalize()`, который единой точкой решает `accept`, `ignore`, `keep_locked_status`, terminal upgrade и duplicate terminal для candidate final status. Файл: `shared/finalization-controller.js`.
- Для чего: убрать разрозненную логику locked terminal/upgrade/duplicate из `handleLLMResponse()`. Изменение: `background/job-orchestrator.js` теперь вызывает `FinalizationController.tryFinalize()` перед записью terminal state, сохраняет `entry.finalizationControllerDecision` и только после принятого решения продолжает evidence/projection/broadcast path. Файл: `background/job-orchestrator.js`.
- Для чего: загрузить controller в MV3 service worker до orchestration runtime. Изменение: `background/index.js` импортирует `shared/finalization-controller.js` после status/model-run contracts. Файл: `background/index.js`.
- Для чего: закрепить новый contract тестами. Изменение: добавлен `finalization-controller.test.js`, а VM-тесты orchestrator загружают shared status/finalization contracts перед `job-orchestrator.js`. Файлы: `tests/finalization-controller.test.js`, `tests/finalization-evidence.test.js`, `tests/early-terminal-guard.test.js`.

### 2026-06-08 00:00 CEST
- Для чего: не терять введённый prompt и активные кнопки моделей при переключении `result_new.html` ↔ `pipeline_panel.html`. Причина: внутренний переход между view выполняет новую загрузку страницы, а bootstrap-reset чистил `llmComparatorCrossViewUiState` и `llmComparatorSelected*` без отличия от обычного refresh. Изменение: переключатель страниц теперь пишет короткоживущий `llmComparatorCrossViewNavigationIntent`, а initial bootstrap consumes этот intent и пропускает очистку transient cross-view state только для целевого view. Файл: `results.js`.
- Для чего: сохранить reset-on-refresh, но не перетирать cross-view draft пустым DOM до восстановления. Изменение: ранние неконтролируемые вызовы `clearModifierSelectionsOnLoad()` убраны, initial `loadModifiers()` выполняет gated restore, а persistence modifier selections подавляется на время начального cross-view restore. Файл: `results.js`.
- Для чего: зафиксировать регрессию тестом. Изменение: `modifier-bootstrap-reset.test.js` проверяет два контракта: обычная загрузка очищает stored modifier selections, а cross-view navigation сохраняет prompt, active model button и modifier storage. Файл: `tests/modifier-bootstrap-reset.test.js`.

### 2026-06-08 00:00 CEST
- Для чего: не восстанавливать введённый prompt и выбор кнопок моделей после refresh страницы и reload расширения. Изменение: bootstrap `results.js` теперь очищает `promptText`, `modelButtonIds`, `promptSubmitted` и prompt-related `formControls` из `llmComparatorCrossViewUiState` до `restoreCrossViewUiState()`, поэтому transient draft и active model selection больше не возвращаются из `chrome.storage.local` на старте. Файл: `results.js`.
- Для чего: добавить общий selection-toolbar на открытых страницах моделей и связать его с главным избранным. Изменение: `content-scripts/model-selection-toolbar.js` добавляет floating toolbar на выделение текста в model-page и передаёт fragment в `llmComparatorFavoriteEntries`; `manifest.json` подключает этот content script ко всем model-page. Файл: `content-scripts/model-selection-toolbar.js`, `manifest.json`.
- Для чего: объединить favorite items из карточек ответов и model-page selections в один model-group. Изменение: `results.js` группирует `Favourite` по `modelKey`, поэтому карточки ответа и выделенные фрагменты одной модели попадают в один `.favorite-entry`. Файл: `results.js`.
- Для чего: сохранять форматирование выделенного текста и не терять его при добавлении в избранное. Изменение: response-selection toolbar сохраняет HTML-highlight/bold/italic вместе с fragment, а `Favourite` хранит и plain text, и sanitized HTML. Файл: `results.js`, `content-scripts/model-selection-toolbar.js`.
- Для чего: поддерживать editable favourite items и удаление отдельных записей без разрушения группы. Изменение: `favorite-item-body` остаётся редактируемым, а remove-button удаляет только один item, сохраняя остальные элементы модели в том же group. Файл: `results.js`.
- Для чего: держать transient UI state сброшенным на reload. Изменение: `Favourite` не восстанавливается из storage при bootstrap, а выбранные query modifiers очищаются на старте и не возвращаются после refresh. Файл: `results.js`.
- Для чего: не восстанавливать selections модификаторов из старого storage и не держать их после очистки textarea. Изменение: `loadModifiers()` запускается без restoreSelections на initial load, bootstrap чистит `llmComparatorSelected*`, а корзина очистки prompt также сбрасывает modifiers. Файл: `results.js`.
- Для чего: сделать export всех ответов включающим Favourite в тот же HTML bundle. Изменение: общий HTML export теперь дописывает `Favourite` как отдельную секцию в общий документ LLM Responses; export Favourite отдельно сохранён. Файл: `results.js`.

### 2026-06-08 00:00 CEST
- Для чего: исправить регрессию, при которой страницы моделей открывались, но prompt не вставлялся. Причина: `noFocusResponse` был объявлен блочным `const` внутри ветки no-focus probe и затем использовался снаружи в `normalizePageReadyState()`, что давало runtime `ReferenceError` до отправки `GET_ANSWER`. Изменение: `noFocusResponse` вынесен во внешний scope dispatch flow. Файл: `background/dispatch-coordinator.js`.

### 2026-06-08 00:00 CEST
- Для чего: нормализовать telemetry после стабилизации runtime events, не переписывая все call-sites. Изменение: добавлен `normalizeTelemetryTaxonomy()` с `schemaVersion`, `eventKey`, `domain`, `stage`, `outcome`, `eventClass`; taxonomy автоматически добавляется в `meta.telemetryTaxonomy` для diagnostics и telemetry entries. Файл: `background/telemetry-logs.js`.
- Для чего: выделить duplicate final events как отдельный failure/ignored mode. Изменение: taxonomy классифицирует `MODEL_FINAL ignored (deduplicated)` и `duplicate_final` как `eventClass=finalization_duplicate_ignored`, `domain=finalization`, `outcome=ignored`. Файл: `background/telemetry-logs.js`.

### 2026-06-08 00:00 CEST
- Для чего: дать UI зрелый фасад поверх сложного FSM без изменения runtime semantics. Изменение: `LLMStatusContract` получил `deriveResultMeta()`, который сводит model/run status к фазам `pending`, `success`, `partial`, `error` с label/status/execution/answer metadata. Файл: `shared/status-contract.js`.
- Для чего: показывать ResultMeta на status indicator как UI-only слой. Изменение: `results.js` теперь добавляет `data-result-phase`, `data-result-label`, class `result-phase-*` и tooltip `Result: ...`, не меняя исходный `currentStatus` и rank-logic. Файл: `results.js`.

### 2026-06-08 00:00 CEST
- Для чего: раньше уходить в fallback при явно сломанном selector profile. Изменение: `SelectorResolverV2` читает `selector_health_profile_v1`; при `broken` для роли пропускает exact/cache path и сразу переходит к semantic/spatial fallback, записывая `selectorProfileStatus`, `exactSkipped`, `cacheSkipped` в diagnostics. Файл: `content-utils/selector-resolver-v2.js`.

### 2026-06-08 00:00 CEST
- Для чего: централизовать только runtime-significant model quirks без превращения policy в энциклопедию моделей. Изменение: добавлен `shared/model-policy.js` с полями `stableTextMs`, `terminalFailureRequiresEvidenceMiss`, `extractionPriority`, `requireAckReady`, `transportErrorsRecoverable`, `conservativeDispatch`, `promptSubmitTimeoutMs`. Файл: `shared/model-policy.js`.
- Для чего: убрать hardcoded dispatch quirks из отдельных веток. Изменение: `dispatch-coordinator` теперь берёт prompt submit timeout, conservative backoff/connection delays и ACK_READY requirement из `ModelPolicy` с fallback на старые constants. Файл: `background/dispatch-coordinator.js`.
- Для чего: подключить policy в MV3 service worker runtime. Изменение: `background/index.js` загружает `shared/model-policy.js` после status/model state contracts. Файл: `background/index.js`.

### 2026-06-08 00:00 CEST
- Для чего: отделить page-ready/composer-ready от старого бинарного `requiresFocus`, чтобы не отправлять prompt в заведомо неподходящую страницу. Изменение: добавлен `normalizePageReadyState()` с поддержкой `status`, `pageReady`, `composerReady`, `blockers`, legacy `requiresFocus`; старые content responses остаются совместимыми. Файл: `background/dispatch-coordinator.js`.
- Для чего: сделать PageReadyState behavioral gate перед фактическим `GET_ANSWER`. Изменение: dispatch теперь пишет `PAGE_READY_STATE`, а при `login_required`, `captcha_required`, `wrong_page`, `page_not_ready`, `composer_missing/composer_not_ready` останавливает отправку, пишет `PAGE_READY_BLOCKED`, diagnostic и schedule retry. Файл: `background/dispatch-coordinator.js`.

### 2026-06-08 00:00 CEST
- Для чего: завершить существующий TabLease до полноценного arbitration layer без переписывания human-presence runtime. Изменение: `startTabVisit()` теперь выдаёт lease с `leaseKey`, `leaseOwner`, `leaseExpiresAt`, `leaseTtlMs`, не позволяет competing human/automation visit перехватить активную вкладку до TTL, но разрешает явный `user_focus` preemption и terminal cleanup. Файл: `background/human-presence.js`.
- Для чего: не оставлять зависший lease бесконечно. Изменение: expired lease логируется как `LEASE_EXPIRED`, затем освобождается через обычный `LEASE_RELEASED`; denied competing requests логируются как `LEASE_DENIED` с owner/active lease metadata и diagnostic event. Файл: `background/human-presence.js`.

### 2026-06-08 00:00 CEST
- Для чего: сделать результат pre-terminal materialization переносимым контрактом, а не набором разрозненных полей. Изменение: `EvidenceSummary` теперь содержит `valid`, `source`, `reason`, `answerHash`, `dedupeKey`, `dispatchId`, `sourceRunId`, `extractedAt`, `answerLength`, `answerHtmlLength` и используется в telemetry/materialization paths. Файл: `background/job-orchestrator.js`.
- Для чего: ограничить recovery paths детерминированным budget вместо неявных повторов. Изменение: добавлен per-dispatch recovery budget для `snapshot`, `inlineDom`, `manualPing`, `controlledVisit` с telemetry `RECOVERY_BUDGET_CONSUMED`/`RECOVERY_BUDGET_EXHAUSTED`; pre-terminal materialization, DOM snapshot recovery, forced visit и manual ping теперь проходят через общий budget gate. Файл: `background/job-orchestrator.js`.
- Для чего: не терять recovery budget при storage compaction/service-worker lifecycle. Изменение: `compactJobStateForStorage()` сохраняет `recoveryBudgets` в model entry. Файл: `shared/pipeline-fsm.js`.

### 2026-06-07 00:00 CEST — Model Favorites Sync
- Для чего: добавить selection-toolbar на страницах моделей, открытых расширением, и унифицировать его с Pipeline-баром. Изменение: в `content-scripts/model-selection-toolbar.js` добавлен общий floating toolbar для assistant-response selection с действиями `hiliteColor`, `bold`, `italic` и `Favourite`; toolbar включён в `manifest.json` для всех model-page content scripts.
- Для чего: отправлять выделенный фрагмент из model-page в общую систему избранного. Изменение: кнопка `Favourite` сохраняет fragment в `chrome.storage.local` под ключом `llmComparatorFavoriteEntries`, включая `text`, `html`, `sourceName`, `timeLabel` и `kind=fragment`, а `results.js` подхватывает эти записи и рендерит их в главной панели Favourite.
- Для чего: сделать избранное на главной странице общим хранилищем для целых ответов и фрагментов. Изменение: `results.js` теперь загружает favorites из storage при старте, слушает `chrome.storage.onChanged`, синхронизирует `favoriteState` и объединяет записи в общие группы по модели/источнику.
- Для чего: гарантировать, что фрагменты из main-page card и model-page selection попадают в одну модельную entry. Изменение: введён канонический `modelKey` в payload favorites, и `results.js` группирует `Favourite` по `modelKey`, а не по `sourceOutputId`, поэтому оба канала записи складываются в один общий блок модели.
- Для чего: экспортировать Favourite без управляющих элементов и в том же HTML-формате, что и другие ответы. Изменение: экспорт Favourite теперь строится из состояния favourites, а не из текущего DOM, поэтому крестики удаления не попадают в HTML-файл; итоговая разметка использует тот же response-export шаблон с секциями и body-blocks, что и стандартный экспорт ответов.
- Для чего: держать новые favorite items внизу списка, а не вверху. Изменение: новые записи избранного теперь добавляются в конец `favoriteState.entries` и в storage append-order, поэтому внутри `favorite-entry` последняя добавленная запись оказывается последней строкой внизу списка.
- Для чего: очищать transient UI state на каждой перезагрузке страницы. Изменение: `Favourite` больше не восстанавливается из `chrome.storage.local` при bootstrap и очищается на load; выбранные query modifiers тоже сбрасываются при старте страницы и больше не подхватываются из сохранённого selection storage.
- Для чего: убрать скрытое восстановление модификаторов через defaultSelected на bootstrap. Изменение: `loadModifiers()` больше не подставляет `defaultSelected` при старте страницы, поэтому после refresh все query modifiers начинаются в пустом состоянии и не переустанавливаются обратно в storage.
- Для чего: исправить регрессию после добавления bootstrap-reset для modifiers. Изменение: `loadModifiers()` теперь принимает `restoreSelections` явно, так что стартовый сброс и обычная работа preset-ов не конфликтуют и не вызывают ошибок при загрузке.
- Для чего: гарантированно чистить весь selection storage модификаторов на старте, а не только текущий preset. Изменение: при bootstrap теперь удаляются `llmComparatorSelected`, `llmComparatorSelectedByPreset` и `llmComparatorSelectedByPresetPipeline`, так что refresh/extension reload не восстанавливает ни один сохранённый набор query modifiers.
- Для чего: убрать восстановление выбранных модификаторов именно на initial page load. Изменение: стартовый `loadModifierPresets()` теперь вызывает `loadModifiers(..., { restoreSelections: false })`, поэтому refresh не подхватывает даже пустой selection state из storage и UI стартует с полностью чистым состоянием.
- Для чего: гарантировать, что selection storage модификаторов реально очищается на bootstrap, а не только в отложенном callback. Изменение: `clearModifierSelectionsOnLoad()` вызывается сразу при инициализации и перед `loadModifiers()`, поэтому refresh и reload расширения удаляют все сохранённые query modifiers до восстановления UI.
- Для чего: перевести главную страницу на нижний layout-триггер для Tuning Console и LLM Stream. Изменение: иконки управления вынесены в нижнюю строку `prompt-footer-actions`, обе секции стартуют скрытыми, Tuning Console раскрывается по клику на иконку, а LLM Stream открывается по клику и автоматически при отправке запроса.
- Для чего: убрать TDZ-регрессию в обработчике синхронизации модификаторов. Изменение: `getApprovedSenderModels()` больше не зависит от раннего lexical `debateModelCards` и берёт контейнер напрямую через `document.getElementById()`, чтобы `llm-selection-change` не падал до полной инициализации debate UI.
- Для чего: сохранить форматирование при повторной перекраске и при добавлении в избранное. Изменение: в response-selection логике удалён конфликтующий `background-color` внутри уже подсвеченных фрагментов, а при добавлении fragment в Favourite HTML-разметка сохраняется вместе с текстом, чтобы highlight не терялся.
- Для чего: сузить editable-surface в Favourite до одной строки редактирования. Изменение: `favorite-item-body` стал единственной редактируемой частью favorite item; запись синхронизируется обратно в storage после редактирования, а remove-действие остаётся отдельной кнопкой.
- Для чего: синхронизировать текущую рабочую версию с расширением. Изменение: `manifest.json` получил подключение нового content script `content-scripts/model-selection-toolbar.js`.

### 2026-06-05 00:00 CEST
- Для чего: отделить тип terminal status от причины сбоя. Изменение: добавлены `classifyFailure()` и `deriveFailureFinalStatus()`, которые присваивают ошибкам классы `transport`, `lease_lifecycle`, `page_readiness`, `dispatch`, `generation`, `extraction`, `semantic`, сохраняя совместимость с существующими статусами `NO_SEND`, `EXTRACT_FAILED`, `STREAM_TIMEOUT`, `ERROR`. Файл: `background/job-orchestrator.js`.
- Для чего: transport/channel errors больше не выглядят как semantic/extraction failure в диагностике. Изменение: `handleLLMResponse()` теперь записывает `failureClass`, `failureRecoveryFirst` и `terminalRequiresEvidenceMiss` в logs, partial metadata, responseMeta, finalization evidence и DispatchCircuit payload. Файл: `background/job-orchestrator.js`.

### 2026-06-04 18:30 CEST
- Для чего: перевести предтерминальное восстановление из набора частных recovery-веток в детерминированный gate перед terminal failure. Изменение: добавлен `materializeLatestAnswerEvidence()`, который валидирует evidence по rule-based признакам и проверяет preserved answer, snapshot cache, live/inline late collect перед фиксацией ошибки. Файл: `background/job-orchestrator.js`.
- Для чего: не терять ответы Qwen/похожих моделей, появляющиеся сразу после первого recovery miss. Изменение: pre-terminal materialization получил короткий повторный сбор для моделей с задержанным DOM/update path и теперь пишет telemetry `MATERIALIZE_EVIDENCE_*` с `evidenceSource`, `evidenceLen`, `evidenceHash`, `rejectReason`. Файл: `background/job-orchestrator.js`.
- Для чего: позволить позднему валидному recovered success заменить recoverable terminal failure, а не отбрасывать его как `duplicate_final`. Изменение: `PipelineFSM.shouldAcceptEvent()` принимает контролируемый `allowRecoveredFinal` только для перехода с failure final на success final того же dispatch. Файлы: `shared/pipeline-fsm.js`, `background/job-orchestrator.js`.

### 2026-06-03 07:16 CEST
- Для чего: сделать Pipeline FSM реальным источником истины для pipeline-level state transitions. Изменение: добавлен `PipelineFSM.transition(...)` и `PipelineFSM.completeRun(...)`, а `PIPELINE_FSM_EVENT` в background теперь проходит через transition вместо прямого вызова model-level `markFinal`.
- Для чего: закрыть bypass для cancelled run. Изменение: `PipelineFSM.markFinal(...)` теперь отказывает в переходе, если текущий control state уже `CANCELLED`, `STOPPED` или `FAILED`; cancelled pipeline не может вернуться в `COMPLETED`.
- Для чего: переживать restart service worker даже если full `jobState` не был восстановлен. Изменение: `loadJobState()` теперь восстанавливает минимальный pipeline control snapshot из `chrome.storage.session`, если `jobState` отсутствует.
- Для чего: не хранить большие runtime payloads без политики. Изменение: `DEFAULT_LIMITS` расширен `maxPayloadBytes`, `maxSnapshotsPerModel`, `maxRoundsRetained`, `maxAgeMs`, `dropPartialAfterFinal`, `dropPayloadAfterExport`; `compactJobStateForStorage()` теперь режет payload/log/history/snapshot хвосты по явным retention rules.
- Для чего: убрать bridge token из page-readable DOM/URL. Изменение: `content-bootstrap.js` теперь инжектит main-world bridge как inline script из fetched source, `content-bridge.js` использует token placeholder, а `content-utils.js` хранит bridge token только в isolated-world state.

### 2026-06-03 07:16 CEST
- Для чего: ввести Pipeline FSM для MV3 lifecycle. Изменение: добавлен `shared/pipeline-fsm.js` со state machine для `STARTING`, `DISPATCHING`, `AWAITING_APPROVAL`, `AWAITING_FINAL`, `COMPLETED`, `CANCELLED`, `FAILED`, `STOPPED`, а background и results теперь публикуют и восстанавливают контрольное состояние через FSM.
- Для чего: переживать restart service worker между approve/dispatch/final. Изменение: critical control state (`pipelineRunId`, `pipelineState`, `dispatchId`, tab/session scope) сохраняется в `chrome.storage.session`, а `jobState` при сохранении компактуется вместо хранения неограниченных payload.
- Для чего: сделать cancel scoped по конкретному run. Изменение: `CANCEL_PIPELINE_RUN` теперь сравнивает `pipelineRunId` и игнорирует stale cancel/late final для другого запуска.
- Для чего: не принимать дубли финалов и поздние ответы после retry/cancel. Изменение: `shouldAcceptEvent()` отсекает duplicate final, stale tab/session и late final для cancelled run.
- Для чего: защитить web-UI automation bridge от fake `CustomEvent`. Изменение: `content-bootstrap.js` внедряет bridge token, `content-bridge.js` принимает только trusted events с валидным token/source, а content scripts прокидывают token в bridge-вызовы.

### 2026-06-03 06:05 CEST
- Для чего: убрать дополнительную строку для `Show more`. Изменение: кнопка переведена в overlay-режим `position: absolute` и размещается у нижнего края карточки, а не под текстом.
- Для чего: сделать toggle collapse по dblclick на имени модели. Изменение: повторный dblclick по `.debate-model-card-name` теперь переключает `is-expanded` обратно в `false`, то есть сворачивает карточку до 5 строк.

### 2026-06-03 00:24 CEST
- Для чего: добавить управляемое раскрытие длинных ответов. Изменение: добавлены `Show more`, `is-expanded`, `syncDebateCardOutputLayout()` и раскрытие по клику `Show more` или двойному клику по `.debate-model-card-name`.

### 2026-06-03 00:12 CEST
- Для чего: восстановить работу color/bold/italic в floating toolbar. Изменение: общий `document mouseup` больше не вызывает `hideDebateSelectionToolbar()` для событий внутри `#debateSelTb`, поэтому сохранённый selection range не сбрасывается перед `click`.

### 2026-06-03 00:10 CEST
- Для чего: перевести floating toolbar выделения в светлую тему. Изменение: `.debate-sel-toolbar` получил белый фон, светлые кнопки, мягкую границу и менее тяжёлую тень.
- Для чего: сделать выбор цвета понятным визуально. Изменение: цветовые кнопки теперь залиты образцом цвета целиком через `--swatch-color`, а не отображаются тонкими полосками.

### 2026-06-03 00:06 CEST
- Для чего: сделать пункты toolbar видимыми без угадывания. Изменение: цветовые кнопки стали тонкими горизонтальными полосками, а `Bold`, `Italic`, `Favorite` получили явные CSS-иконки `B`, `I`, `★`.
- Для чего: сохранить доступные подписи. Изменение: текстовые `.stb-label` оставлены в HTML, но визуально скрыты CSS вместо пустых невидимых зон.

### 2026-06-02 23:49 CEST
- Для чего: исправить отправку Pipeline в модели, которых пользователь не выбирал. Изменение: R1 Pipeline синхронизируется с верхним списком выбранных LLM перед запуском, пока R1 не был явно изменён вручную или загруженным pipeline config.
- Для чего: сохранить ручную настройку Pipeline. Изменение: добавлен dirty-флаг для `#r1-models`; ручные изменения R1 не перезаписываются верхним выбором.

### 2026-06-02 23:37 CEST
- Для чего: убрать визуальную метку pending-зоны. Изменение: удалён CSS `.debate-model-card.first-pending-zone-card::before` и текст `На утверждение`; runtime больше не добавляет `first-pending-zone-card`.
- Для чего: убрать статус-индикатор из moderator header. Изменение: из `pipeline_panel.html` удалён `#mod-status-indicator` внутри `.msg-header`.

### 2026-06-02 23:35 CEST
- Для чего: исправить регрессию approval reorder в Pipeline Debate. Изменение: `insertDebateCard(card, { zone: 'approved' })` снова учитывает `zone` и переносит approved-карточку перед первой pending-карточкой текущей session.

### 2026-06-02 23:01 CEST
- Для чего: выполнить P2.1 без полного risky split `results.js`. Изменение: добавлен `pipeline/pipeline-runtime.js` с model registry, render helpers, output helpers, stack capture и runtime snapshot helpers; `results.js` теперь делегирует Pipeline rendering/snapshot helpers этому модулю.
- Для чего: выполнить P2.2 и убрать hard-coded Pipeline model blocks из HTML. Изменение: `pipeline_panel.html` и `result_new.html` теперь содержат только mount points `#r1-models`, `#r2-models`, `#output-stack` с `data-render`, а карточки моделей/output blocks рендерятся из state в `pipeline-runtime.js`.
- Для чего: обеспечить загрузку нового runtime. Изменение: оба HTML entrypoints подключают `pipeline/pipeline-runtime.js` перед `results.js`, а `manifest.json` добавляет файл в `web_accessible_resources`.

### 2026-06-02 22:42 CEST
- Для чего: сделать Pipeline UI источником правды для R1. Изменение: запуск строит runtime snapshot из `r1-models` и больше не подменяет первый раунд выбранными top/debate models.
- Для чего: заморозить конфигурацию на старте run. Изменение: `buildPipelineRuntimeSnapshot()` читает rounds/output один раз, сохраняет model names/input/send/role и использует этот snapshot до конца запуска.
- Для чего: убрать хрупкую зависимость output selection от текста label. Изменение: `pipeline_panel.html` получил `data-output="notes|export|exportHtml"`, а `getPipelineOutputSelection()` читает machine keys с fallback на legacy labels.
- Для чего: уйти от hard-coded `r === 1` в execution flow. Изменение: runtime rounds получают `stage: models|judge`, а loop выбирает ветку по `roundState.stage`.
- Для чего: санитизировать Pipeline HTML export. Изменение: `safePipelineMarkdownToHtml()` удаляет опасные HTML/protocol tokens, экранирует model text, конвертирует markdown и пропускает результат через sanitizer.
- Для чего: убрать global approval escape hatch. Изменение: `resolveDebateApprovalGlobal` заменён на state-object `debateApprovalBridge`.

### 2026-06-02 17:47 CEST
- Для чего: стабилизировать lifecycle Pipeline run. Изменение: `pipelineWaiter` теперь хранит pending-state по `pipelineRunId`, `pipelineRoundId`, `pipelineBatchId`, optional `dispatchId` и игнорирует ответы не из текущего batch.
- Для чего: не запускать следующие раунды на первом chunk. Изменение: `LLM_PARTIAL_RESPONSE` обновляет preview, но закрывает waiter только при terminal metadata (`SUCCESS`, `COPY_SUCCESS`, `ERROR`, `STREAM_TIMEOUT`, etc.) или explicit final message.
- Для чего: убрать зависание manual approval. Изменение: `waitForDebateApproval()` получил abort/timeout cleanup и больше не оставляет висящий resolver после cancel/error.
- Для чего: добавить явную отмену Pipeline. Изменение: активный run получает `AbortController`; кнопка Pause во время run работает как `Cancel`, чистит waiter/approval и отправляет `CANCEL_PIPELINE_RUN` в background, где он проходит через существующий `stopAllProcesses()`.

### 2026-06-02 15:28 CEST
- Для чего: добавить скрытую поисковую метку для сторонних разработчиков. Изменение: в `pipeline_panel.html` добавлены невидимые для пользователя `<!-- LLM Discus -->` и `<meta name="keywords" content="LLM Discus">` в `<head>`.

### 2026-06-02 15:17 CEST
- Для чего: добавить управление текущей session через `-` рядом с `+`. Изменение: `#debate-session-delete-btn` удаляет активную session при наличии нескольких sessions; если session одна, она не удаляется, а очищается и остаётся активной.
- Для чего: держать кнопки управления sessions визуально пустыми. Изменение: `#debate-session-add-btn` и `#debate-session-delete-btn` получили прямой transparent/no-border override и выключенные hover/active фоновые эффекты.

### 2026-06-02 09:08 CEST
- Для чего: исправить неработающий CSS override для `#debate-session-add-btn`. Изменение: селектор был уточнён до прямого `#debate-session-add-btn`, потому что кнопка находится в `.debate-session-left`, а не в `.debate-session-actions`; сняты border/background/box-shadow и hover/active на самой кнопке.

### 2026-06-02 09:05 CEST
- Для чего: полностью убрать border/background у `#debate-session-add-btn`. Изменение: добавлен точечный override `border: none`, `background: transparent`, `box-shadow: none` и снят hover/active visual state для этой кнопки.

### 2026-06-02 09:02 CEST
- Для чего: убрать у `#debate-session-add-btn` лишние фон и рамку. Изменение: добавлен точечный override `background: transparent` и `box-shadow: none` для кнопки добавления session.

### 2026-06-02 09:02 CEST
- Для чего: убрать отдельные fragment-card из обычной Pipeline-ленты. Изменение: `shouldShowDebateCard()` теперь скрывает `kind=fragment` при `favoriteOnly=false`; saved fragments остаются в session timeline/store и показываются только в favorite-view/export текущего режима.
- Для чего: сделать выделение в обычной ленте реальным форматированием исходной карточки. Изменение: toolbar больше не полагается на `document.execCommand`; выделение оборачивается через сохранённый `Range` в `span` с `backgroundColor`, `strong` или `em`, затем source message синхронизируется с обновлённым HTML.
- Для чего: не терять текст выделения при клике по toolbar. Изменение: favorite fragment берёт текст из сохранённого `debateSelectionState.range`, а не только из текущего `window.getSelection()`.

### 2026-06-02 08:51 CEST
- Для чего: исправить неработающий double-click по `.debate-session-tab` в Pipeline favorite-view. Изменение: single-click теперь выполняется с короткой задержкой и отменяется при `dblclick`, поэтому первый click больше не перерисовывает tab до обработки double-click; обычный click возвращает session в полный timeline.
- Для чего: сделать toolbar выделенного текста понятным без угадывания иконок. Изменение: кнопки highlight/bold/italic/favorite получили видимые подписи и `aria-label`, добавлены стили `.debate-sel-toolbar .stb/.stb-label`.

### 2026-06-01 23:52 CEST
- Для чего: убрать рассинхрон `Favorites` между DOM-флагами и внутренним состоянием. Изменение: введён единый state-layer на `entryId` (`debateMessageStore` + `debateDomIndex`), `ensureDebateCardMessage()` теперь нормализует карточку в store и обратно в DOM.
- Для чего: стабилизировать показ карточек в favorite-only режиме. Изменение: добавлен `shouldShowDebateCard()`; `getVisibleDebateCards()` и фильтрация используют единое условие.
- Для чего: исключить конфликт `messageId`/`entryId`. Изменение: синхронизация карточки теперь всегда выставляет оба атрибута на единый id; удаление карточки очищает store по `entryId`.

### 2026-06-01 23:16 CEST
- Для чего: перевести Pipeline favorite-view с набора DOM-флагов на явный lifecycle сообщений. Изменение: session теперь имеет `messages`, карточки получают `data-message-id`, добавлены `ensureDebateCardMessage()`, `patchDebateCardMessage()`, `removeDebateCardMessage()` и `getVisibleDebateCards()`.
- Для чего: сделать избранное устойчивым при approval, session-filter, fragment и delete. Изменение: `approval`, `favorite`, fragment creation, clear/delete и filter синхронизируют DOM-карточку с message-store.
- Для чего: показать режим избранного на табе. Изменение: double-click по `.debate-session-tab` обновляет `.favorite-only`, для таба добавлен визуальный маркер `★`.

### 2026-06-01 22:55 CEST
- Для чего: убрать лишний заголовок approved-зоны в Pipeline. Изменение: удалён `content: "Утверждённые"` для `.debate-model-card.first-approved-zone-card::before`.
- Для чего: вернуть порядок заголовка карточки к `Model time`. Изменение: `normalizeDebateCardState()` переносит `.debate-model-card-time` после `.debate-model-card-name`, а не перед ним.

### 2026-06-01 22:41 CEST
- Для чего: убрать конкретное CSS-перебивание модератора. Изменение: `.debate-moderator-card .debate-model-card-name/.time` теперь явно `16px`, а output остаётся `11px`, как у ответов моделей.

### 2026-06-01 19:19 CEST
- Для чего: убрать влияние глобального `.msg-time` (`9px`) на время в утверждённых карточках ответов. Изменение: в `approveDebateCard()` время больше не получает `msg-time`; добавляется отдельный класс `debate-inline-time`.

### 2026-06-01 19:08 CEST
- Для чего: в утверждённых карточках разместить время ответа слева от названия модели. Изменение: в `approveDebateCard()` элемент `.debate-model-card-time` получает класс `msg-time` и переносится в начало `.debate-model-card-title-main`.

### 2026-06-01 18:46 CEST
- Для чего: добавить время ответа рядом с названием модели в Pipeline HTML export, включая `Moderator`. Изменение: экспорт теперь строится через `pipelineExportCardParts()`, `pipelineExportHeading()` и выводит `<span class="response-time">HH:MM</span>` рядом с именем модели.
- Для чего: привести Pipeline export к формату LLM Stream export. Изменение: добавлен `pipelineExportDocument()` со стилями `section`, `h1/h2`, `.response-body`, `pre`, таблиц и списков по аналогии с рабочим экспортом LLM Stream.
- Для чего: очищать утверждённые ответы от live-status. Изменение: `approveDebateCard()` удаляет `.status-indicator` при переносе карточки в approved-зону.

### 2026-06-01 18:18 CEST
- Для чего: зарегистрировать Pipeline export handlers на уровне документа. Изменение: `#debate-session-export-btn` и `.debate-card-export` вынесены из `DOMContentLoaded` в top-level delegated handlers внутри guard `__RESULTS_PAGE_LOADED`.
- Для чего: убрать зависимость Pipeline export от scoped-функций внутреннего init-блока. Изменение: добавлены top-level helpers `pipelineExportCollectFeedHtml()`, `pipelineExportDownloadHtml()`, `pipelineExportStamp()`, `pipelineExportEscape()`; они работают напрямую через DOM и повторяют anchor-download flow рабочей главной страницы.

### 2026-06-01 17:58 CEST
- Для чего: убрать ещё одно отличие Pipeline export от рабочего экспорта главной страницы. Изменение: `#debate-session-export-btn` теперь обрабатывается через `document.addEventListener('click')` и `event.target.closest(...)`, как `#export-html-btn` и `.panel-export-html-btn`, вместо прямого listener на элемент.

### 2026-06-01 17:53 CEST
- Для чего: окончательно привести HTML-экспорт Pipeline к рабочему паттерну главной страницы. Изменение: экспорт сессии теперь прямо в `debateSessionExportBtn` создаёт `Blob`, `ObjectURL`, `a.download`, делает `click()` и `revokeObjectURL()` без промежуточного helper.
- Для чего: починить экспорт карточек Pipeline тем же способом, что `.panel-export-html-btn`. Изменение: добавлен document-level handler для `.debate-card-export`, который собирает `.debate-model-card-output` и выполняет локальный anchor-download; контейнерный handler больше не запускает отдельную export-логику.
- Для чего: убрать лишнюю сложность предыдущих попыток. Изменение: удалён неиспользуемый `triggerHtmlDownload()`, удалён background route `DOWNLOAD_HTML_EXPORT`, из `manifest.json` убрано permission `downloads`.

### 2026-06-01 17:48 CEST
- Для чего: восстановить HTML-экспорт Pipeline тем же способом, который уже работает на главной странице. Изменение: `triggerHtmlDownload()` упрощён до локального паттерна `Blob -> URL.createObjectURL -> a.download -> click -> revokeObjectURL`; удалена зависимость Pipeline export от background route, `chrome.downloads`, `showSaveFilePicker` и async `sendMessage`.
- Для чего: сделать failures видимыми. Изменение: `debateSessionExportBtn` и `debate-card-export` теперь вызывают `flashButtonFeedback(..., 'success'|'error')` после попытки экспорта.

### 2026-06-01 17:00 CEST
- Для чего: исправить причину, по которой HTML-экспорт Pipeline всё ещё не запускался. Изменение: `DOWNLOAD_HTML_EXPORT` вынесен в early route `background/message-router.js` до `NOTES_CMD` и до `ensureInitialState()`, чтобы download не зависел от готовности общего pipeline-state.
- Для чего: сделать вызов background-экспорта совместимым с callback-style Chrome APIs. Изменение: `triggerHtmlDownload()` больше не использует Promise-форму `chrome.runtime.sendMessage`, а оборачивает callback в `Promise` и проверяет `chrome.runtime.lastError`.

### 2026-06-01 16:43 CEST
- Для чего: исправить HTML-экспорт Pipeline через правильный extension-контекст. Изменение: добавлен background route `DOWNLOAD_HTML_EXPORT` в `background/message-router.js`, который выполняет `chrome.downloads.download()` из service worker; `triggerHtmlDownload()` в `results.js` теперь сначала отправляет HTML в background и только затем использует локальные fallback-механизмы.

### 2026-06-01 16:30 CEST
- Для чего: устранить системную причину неработающего HTML-экспорта в extension UI. Изменение: `triggerHtmlDownload()` теперь сначала использует `window.showSaveFilePicker()` с записью `Blob` напрямую, а уже потом откатывается к `chrome.downloads.download` и `<a download>`.

### 2026-06-01 16:28 CEST
- Для чего: системно восстановить экспорт HTML карточек и сессии в extension-контексте. Изменение: `triggerHtmlDownload()` переведён на `async` с приоритетом `chrome.downloads.download` и fallback на `<a download>`; обработчики `debateSessionExportBtn` и `debate-card-export` теперь `await` этот путь.
- Для чего: обеспечить доступ к API загрузок в MV3. Изменение: в `manifest.json` добавлено permission `downloads`.

### 2026-06-01 16:24 CEST
- Для чего: восстановить экспорт HTML карточки и сессии в Pipeline. Изменение: добавлен единый helper `triggerHtmlDownload()` и оба обработчика (`debate-card-export`, `debateSessionExportBtn`) переведены на него.
- Для чего: убрать `Moderator` и имена моделей из копирования сессии. Изменение: `collectDebateFeedText()` теперь копирует только текст ответов и пропускает карточки `kind=moderator`.
- Для чего: сделать `None` получателем по умолчанию при старте сессии. Изменение: `mod-receiver-select` получил `selected` на `__none__`, а `syncModeratorSelectors()` по умолчанию восстанавливает `__none__`.

### 2026-06-01 09:39 CEST
- Для чего: убрать лишний индикатор статуса из карточки модератора. Изменение: из HTML, создаваемого `appendModeratorFeedEntry()`, удалён `span.status-indicator`; индикаторы моделей не затронуты.

### 2026-06-01 09:34 CEST
- Для чего: при утверждении ответа переносить карточку из зоны `На утверждение` в конец зоны `Утверждённые`, а не оставлять её под pending-ответами. Изменение: `approveDebateCard()` теперь использует `insertDebateCard(..., { zone: 'approved' })`; порядок зон изменён на `Утверждённые` выше `На утверждение`, approved-карточка вставляется перед первой pending-карточкой текущей сессии.

### 2026-06-01 01:48 CEST
- Для чего: дать модератору возможность оставить комментарий в ленте без отправки моделям. Изменение: в `mod-receiver-select` добавлен получатель `None`; при выборе `None` `mod-send-btn` добавляет карточку `Moderator` в ленту, очищает composer и не отправляет `START_FULLPAGE_PROCESS`.

### 2026-06-01 01:40 CEST
- Для чего: очищать composer после отправки запроса модератора. Изменение: добавлен `clearModeratorComposer()`, который очищает `textarea#modTa` и `#mod-message-body` сразу после добавления карточки `Moderator` в ленту и создания карточек получателей, не дожидаясь завершения ответов моделей.

### 2026-06-01 01:33 CEST
- Для чего: не оставлять pending-дубли одной модели в зоне утверждения. Изменение: при отправке и обновлении ответа переиспользуется последняя неутверждённая карточка модели, включая уже существующие response-карточки без `live=true`.

### 2026-06-01 01:24 CEST
- Для чего: гарантировать, что первый запрос модератора стоит выше карточек моделей. Изменение: первая карточка `Moderator` в сессии вставляется перед первой существующей карточкой этой сессии, даже если в ленте уже были stale/pending карточки моделей.
- Для чего: остановить разбиение одного ответа на несколько карточек. Изменение: при отправке повторно используется существующая pending/live-карточка модели, а поздние UI-update события после финала обновляют последнюю неутверждённую карточку вместо создания новой.

### 2026-06-01 01:14 CEST
- Для чего: убрать дублирование prompt при отправке из `mod-send-btn`. Изменение: удалён второй `onclick`-handler, оставлен единый `addEventListener`, добавлен короткий debounce запуска pipeline на 500ms.
- Для чего: сохранить хронологию первого сообщения. Изменение: карточка `Moderator` больше не считается approved-ответом модели и остаётся перед pending-карточками получателей.

### 2026-06-01 01:04 CEST
- Для чего: разделить ленту на две зоны. Изменение: pending-карточки вставляются перед первой approved-карточкой, approved-карточка переносится вниз approved-зоны; для первых карточек зон добавлены метки `На утверждение` и `Утверждённые`.

### 2026-06-01 00:45 CEST
- Для чего: сделать первое сообщение сессии видимым в ленте. Изменение: при каждом запуске `mod-send-btn` текст модератора добавляется отдельной карточкой `Moderator` перед пустыми карточками получателей, поэтому первый запрос всегда становится первой записью debate-ленты.

### 2026-06-01 00:34 CEST
- Для чего: не плодить карточки на partial-ответах. Изменение: карточка ответа стала live-card: новые части ответа той же модели обновляют текущую карточку, во время генерации показывается `[Model] printing`, финальный статус убирает служебное сообщение.

### 2026-06-01 00:18 CEST
- Для чего: перенести утверждение ответов из зоны модератора в ленту. Изменение: блок `debate-approval` удалён из `pipeline_panel.html`; ответы для утверждения теперь выбираются чекбоксами внутри карточек ленты, а выбранные карточки при отправке фиксируются как approved и теряют чекбокс.
- Для чего: создавать пустые карточки только после отправки запроса выбранным получателям. Изменение: автосоздание карточек при выборе моделей в header отключено; `runPipeline` берёт получателей из `mod-receiver-select`/выбранных моделей и добавляет карточки внизу ленты на момент отправки.
- Для чего: добавить управление Auto в session bar. Изменение: добавлена кнопка pause/resume слева от копирования, она видима только при включённом `Auto`; кнопка добавления сессии перенесена сразу за последним tab.

### 2026-05-31 23:52 CEST
- Для чего: устранить реальный silent-fail `mod-send-btn` на Pipeline. Изменение: `debateActionSelect`, `debateModeSelect`, `debateLengthSelect` вынесены из локального блока `pipelinePanel` в общую область debate UI, потому что `syncModeratorMiniPrompts()` вызывалась снаружи и падала с `ReferenceError` до навешивания обработчиков кнопки отправки.
- Для чего: исправить чтение текста модератора. Изменение: `buildDebateModeratorDispatchText()` теперь читает текст не только из `textarea#modTa`, но и из `#mod-message-body` как fallback-источника.
- Для чего: сделать следующий сбой диагностируемым. Изменение: добавлены короткие console-сообщения для клика по запуску, пустого moderator prompt и отсутствующих выбранных top-моделей.

### 2026-05-31 23:38 CEST
- Для чего: устранить silent-fail при нажатии `mod-send-btn`. Изменение: `runPipeline` дополнительно экспортирован в `window`, а на `#mod-send-btn` добавлен прямой `onclick`-handler (с `preventDefault/stopPropagation`) в дополнение к `addEventListener`, чтобы запуск происходил гарантированно.
- Для чего: закрепить отображение роли прямо справа от модели в `debate-model-card-header`. Изменение: `debate-model-card-title-main` выровнен в одну строку по центру, а `updateCardRole()` нормализует текст роли (`trim`), чтобы badge корректно появлялся рядом с названием.
- Для чего: сделать иконку `branch` видимой в текущем UI. Изменение: для `debate-card-branch` добавлен явный символ-фолбэк `⎇` (как визуальный аналог из прототипа), чтобы кнопка не пропадала даже при проблемах с icon-font.

### 2026-05-31 23:29 CEST
- Для чего: вернуть рабочую отправку через `mod-send-btn`. Изменение: исправлены сломанные закрывающие скобки в блоке `devtoolsTabs`/`setActiveDevtoolsTab` в `results.js`; после этого скрипт снова корректно выполняется, и Pipeline стартует.
- Для чего: привести `branch` к виду из прототипа. Изменение: для `debate-card-branch` закреплён иконный стиль `ti-git-branch` компактного формата в `debate-model-card-header`.

### 2026-05-31 13:20 CEST
- Для чего: перенести actions карточки в header. Изменение: иконки `branch`, `⧉`, `⬆`, `🗑️` перенесены в `debate-model-card-meta` между временем ответа и `favorite`; нижний footer-ряд карточки удалён.

### 2026-05-31 13:12 CEST
- Для чего: привести header карточек ленты к прототипу. Изменение: роль ответа перенесена в отдельный badge под именем модели (`debate-model-card-title-main` + `debate-model-card-role`) и обновлена структура карточек.
- Для чего: добавить нижнюю панель действий карточки ответа. Изменение: в каждую карточку ленты добавлены иконки `branch`, `⧉`, `⬆`, `🗑️`; подключены обработчики: branch → перенос текста в модераторский input, copy/export/delete для карточки.

### 2026-05-31 12:56 CEST
- Для чего: сделать `.prompt-sandwich .moderator-input` визуально единой зоной. Изменение: у `debate-approval-body` и `textarea#modTa` убраны внутренние рамки/фоны/скругления; разделение внутри блока оставлено только через подпись `Moderator`.

### 2026-05-31 12:48 CEST
- Для чего: убрать `Moderator` из выбора модели-отправителя. Изменение: placeholder в `mod-sender-select` заменён на `Sender`, а динамическое заполнение в `syncModeratorSelectors()` больше не добавляет `Moderator` в список.
- Для чего: привести иконку избранного к требуемым состояниям. Изменение: у `.debate-fav` неактивное состояние теперь только контурное без фона, активное состояние — цвет `#1f3b4c` (контур и символ), без фоновой заливки.
- Для чего: унифицировать кнопку отправки в модерации с главной кнопкой отправки. Изменение: `#mod-send-btn` переведена на круглую тёмную кнопку с треугольным маркером через `::before`, с тем же поведением `active`, как у основной `send-button`.

### 2026-05-31 12:20 CEST
- Для чего: сделать `moderator-input` визуально единой зоной и выровнять разделитель `Moderator`. Изменение: убраны внутренние разделительные бордеры/карточность, `debate-approval` интегрирован в общий блок, `mod-divider-label` выровнен по левой оси заголовка зоны утверждения.

### 2026-05-31 12:12 CEST
- Для чего: привести иконку `Favorite` к стилю action-кнопок главной страницы. Изменение: `.debate-fav` получила единый button-style (геометрия, hover/active), а `active`-состояние сохранено акцентным цветом.

### 2026-05-31 12:05 CEST
- Для чего: привести debate-кнопки к стилю главной страницы. Изменение: `mod-send-btn`, кнопки в `debate-session-actions`, иконки `msg-head-right`, а также `mod-select` получили ту же визуальную логику, что и основные элементы интерфейса.

### 2026-05-31 11:55 CEST
- Для чего: убрать отдельный `Approve`-шаг и сделать `mod-send-btn` единственной точкой отправки. Изменение: если заполнены обе зоны, в prompt отправляется блок `ModelName + response` и блок `Moderator + message`; если заполнена только одна зона, отправляется только она.

### 2026-05-31 11:50 CEST
- Для чего: сделать approval-зону постоянно видимой. Изменение: `debate-approval` больше не скрывается по умолчанию, а `setDebateApprovalCandidate()` показывает waiting-state вместо `hidden`.

### 2026-05-31 11:45 CEST
- Для чего: исправить порядок approval-блока. Изменение: `debate-approval` перенесён ниже `msg-header` и выше `mod-divider-label`, чтобы approved response отображался в нужной зоне.

### 2026-05-31 11:40 CEST
- Для чего: удалить лишнее поле `prompt-input` из Debate layout и сохранить работу запуска на одном вводе. Изменение: `prompt-input` убран из `pipeline_panel.html`, а `results.js` перепривязан к `modTa` как к источнику текста для запуска.

### 2026-05-31 11:20 CEST
- Для чего: восстановить видимость debate feed и approval flow в нужном порядке. Изменение: `debate-model-cards` теперь гарантированно перерисовывается на `llm-selection-change`, а `debate-approval` перенесён сразу под `msg-header` внутри `moderator-input`.

### 2026-05-31 11:05 CEST
- Для чего: привести Debate layout к требуемому порядку блоков. Изменение: `msg-header` возвращён внутрь `moderator-input`, лента сообщений оставлена между `debate-session-bar` и блоком модерации, а порядок секций зафиксирован в `styles.css` через `order` так, чтобы сверху шла лента, снизу модераторский блок.

### 2026-05-31 10:40 CEST
- Для чего: синхронизировать документацию с последними изменениями Pipeline Debate UI. Изменение: обновлены `pipeline_panel.html` и `results.js` под структуру ленты сверху, moderator-input снизу, сессионные табы, approval flow и карточки ответов.

### 2026-05-31 09:45 CEST — Pipeline Debate Integration
- Для чего: заменить управление в зоне `textarea` на debate-механику из макета. Изменение: добавлена новая панель `debate-controls` с контролами `Mode`, `Length`, `Action`, `Pause`, `Step`, `Start`; старые attach/export/send-кнопки в этой зоне выведены из основного сценария.
- Для чего: перенести запуск и модерацию с legacy-кнопок Pipeline на новые debate-кнопки. Изменение: в `results.js` добавлена связка `debate-start-btn -> runPipeline`, поддержка `Pause/Resume`, пошаговое подтверждение `Step/Approve` для manual-режима и auto-паузы, а также добавление `Mode/Length/Action` как модераторского суффикса к prompt.
- Для чего: оформить новый UI. Изменение: в `styles.css` добавлены стили `debate-controls`, `debate-select`, `debate-btn*`.

### 2026-05-30 12:24 CEST
- Для чего: исправить сценарий, где индикатор статуса уже становился зелёным, часть ответа сохранялась, но страница модели фактически продолжала генерацию и полный текст приходилось добирать повторным двойным кликом по статусу. Изменение: проверка активной генерации во вкладке теперь имеет приоритет над `manualRecovery`, `manualOverride`, `lateCollectFinal` и `forceTerminalSuccess`; если виден `Stop`/busy-сигнал, финализация откладывается, UI получает только partial update со статусом `GENERATING`, а background продолжает follow-up collect. Файл: `background/job-orchestrator.js`.
- Для чего: убрать преждевременный зелёный `SUCCESS` у моделей с долгим `busy=true` без видимой stop-кнопки. Изменение: `busy-only` больше не пробивает финализацию после короткого лимита; при достижении общего streaming-лимита ответ может быть зафиксирован только как `PARTIAL`/`streaming_incomplete`, а не как чистый success. Файл: `background/job-orchestrator.js`.

### 2026-05-30 10:56 CEST
- Для чего: восстановить ожидаемое поведение `New Pages = off`, когда запросы должны идти в последние уже открытые вкладки моделей, включая вкладки из прошлых сессий. Изменение: первичное подключение существующей вкладки теперь допускает global reuse через `allowGlobalReuse`, после чего выбранная вкладка привязывается к текущему run scope; scoped resolver при этом остаётся защищённым от чужих вкладок. Файлы: `background/job-orchestrator.js`, `background/tab-manager.js`.
- Для чего: снизить риск преждевременного terminal success от DOM-сигналов. Изменение: исчезновение stop-кнопки и стабильность текста 2 секунды теперь трактуются как completion evidence, а не как самостоятельное финальное решение. Файлы: `content-scripts/unified-answer-watcher.js`, `content-scripts/unified-answer-pipeline.js`.

### 2026-05-30 08:31 CEST
- Для чего: исправить сценарий из `All Logs 20260530_08-28.md`, где Qwen уже материализовал ответ в панели (`textLen=11632`), но stale lifecycle продолжал слать `ANSWER_GENERATING textLength=6067` и блокировал terminal success до `ANSWER_COMPLETE_TIMEOUT`. Изменение: `maybeDeferEarlyTerminalSuccess()` больше не требует `sameObservation`, если длинный ответ (`>= EARLY_TERMINAL_GUARD_FORCE_SUCCESS_CHARS`) ждёт guard дольше `EARLY_TERMINAL_GUARD_MAX_WAIT_MS`; для коротких, но достаточных ответов добавлен extended wait `MAX_WAIT * 3`. Файл: `background/job-orchestrator.js`.
- Для чего: сделать такие случаи видимыми в логах. Изменение: при принудительном выходе из guard после max wait добавлен log `Terminal success guard max wait elapsed` с длиной ответа, временем ожидания и причиной. Файл: `background/job-orchestrator.js`.

### 2026-05-30 07:45 CEST
- Для чего: сделать copy-button completion signal пригодным для диагностики hover/hidden toolbar. Изменение: классификация copy-кнопки теперь различает `present`, `visible`, `interactable`, `disabled` и сохраняет эти поля в `metrics.copyButton`/detector signal. Файл: `content-scripts/unified-answer-watcher.js`.
- Для чего: не принимать copy-кнопку из пользовательского сообщения или неподтверждённого scope. Изменение: добавлен `isAssistantScope()` guard с явной/эвристической проверкой assistant/model/response scope и отклонением user-scope candidate. Файл: `content-scripts/unified-answer-watcher.js`.
- Для чего: различать тип copy-кнопки без преждевременной финализации code-only/code-block сценариев. Изменение: `classifyCopyButton()` теперь возвращает `copyType: message_toolbar | answer_scope | code_block | rejected`; `code_block` логируется как найденный, но не считается валидным completion evidence. Файл: `content-scripts/unified-answer-watcher.js`.
- Для чего: сделать сигнал видимым в общем telemetry export как отдельное событие. Изменение: добавлен dedupe-emitter `COPY_COMPLETION_SIGNAL` с `found/valid/present/visible/interactable/copyType/answerHash/rejectedReason`, без сохранения полного текста ответа. Файл: `content-scripts/unified-answer-watcher.js`.

### 2026-05-30 07:36 CEST
- Для чего: добавить более надёжный признак окончания генерации, когда модель показывает toolbar ответа после завершения стрима. Изменение: `UnifiedAnswerCompletionWatcher` теперь определяет видимую copy-кнопку рядом с последним assistant answer и учитывает её как `copyButtonVisible` criterion только при отсутствии stop-кнопки и стабильном тексте/fingerprint. Файл: `content-scripts/unified-answer-watcher.js`.
- Для чего: не ловить ложные copy-сигналы от старых сообщений или кнопок копирования кода. Изменение: copy-кнопка ищется только в scope последнего ответа/близких контейнеров, disabled/hidden controls игнорируются, copy внутри `pre/code` не считается evidence завершения ответа. Файл: `content-scripts/unified-answer-watcher.js`.
- Для чего: сделать новый сигнал диагностируемым в `All Logs` и result metrics. Изменение: `copyButtonVisible` добавлен в `UniversalCompletionCriteria`, scoring, detector snapshots, verbose criteria log, `completionSelectors`, `selectorAttempts` и `metrics.copyButton`. Файлы: `content-scripts/pipeline-modules.js`, `content-scripts/unified-answer-watcher.js`.
- Для чего: дать watcher платформенные CSS-кандидаты copy-кнопки. Изменение: добавлены общие copy selectors в основной и fallback selector bundles. Файлы: `content-scripts/answer-pipeline-selectors.js`, `content-scripts/platform-selectors.js`.

### 2026-05-29 23:48 CEST
- Для чего: исправить сценарий из `All Logs 20260529_23-44.md`, где Gemini получил terminal `PARTIAL` с ответом, но статус-индикатор оставался жёлтым как будто генерация не завершена. Изменение: в results UI статусы `PARTIAL` и `STREAM_TIMEOUT_HIDDEN` теперь отображаются зелёным terminal-success индикатором, tooltip сохраняет уточнение о partial/timeout. Файл: `results.js`.
- Для чего: убрать ложный жёлтый статус, если панель ответа уже получила непустой текст, но UI-состояние застряло в `GENERATING/RECEIVING/RECOVERABLE_ERROR`. Изменение: `updateLLMPanelOutput()` теперь при валидном непустом ответе поднимает индикатор минимум до `PARTIAL`, если текущий статус ещё не success-like. Файл: `results.js`.

### 2026-05-29 21:53 CEST
- Для чего: исправить сценарий из `All Logs 20260529_21-48.md`, где Le Chat возвращал текст в панель, но оставался жёлтым и продолжал получать `getResponses`/human visits. Изменение: `content-lechat.js` теперь прокидывает `msg.meta` в `LLM_RESPONSE` при manual `getResponses`, поэтому background видит `manualRecovery/lateCollectFinal/forceTerminalSuccess` и может финализировать ответ вместо повторного streaming defer. Файл: `content-scripts/content-lechat.js`.
- Для чего: сделать ручной сбор Le Chat диагностируемым так же, как Grok/Qwen/DeepSeek. Изменение: manual `getResponses` у Le Chat теперь сразу подтверждает доставку `manual_refresh_dispatched`, а результат асинхронной extraction-операции сообщает отдельным `MANUAL_PING_RESULT` со статусом `success/unchanged/failed/aborted` и `pingId`. Файл: `content-scripts/content-lechat.js`.
- Для чего: остановить обращения к модели после terminal state, даже если terminal записан в FSM раньше legacy-проекции. Изменение: terminal guards в `dispatch-coordinator.js` теперь используют `ModelRunState.isTerminalRunState(entry)` наряду с legacy `status/finalStatus`. Файл: `background/dispatch-coordinator.js`.
- Для чего: не возвращать терминальную модель в ожидание из-за позднего `LLM_RESPONSE_READY` и не запускать лишний manual recovery при наличии cached answer. Изменение: `message-router.js` получил единый `isTerminalRouterEntry()`, который учитывает FSM terminal state. Файл: `background/message-router.js`.
- Для чего: синхронизировать summary/stalled-метрики run с FSM. Изменение: `job-orchestrator.js` использует FSM terminal state в `isTerminalEntry()` и при построении `stalledModels` в `RUN_SUMMARY`. Файл: `background/job-orchestrator.js`.

### 2026-05-29 00:11 CEST
- Для чего: исправить регрессию из `All Logs 20260529_00-08.md`, где планировщики могли продолжать считать модель незавершённой, если terminal state уже был зафиксирован в FSM, но legacy-поля ещё не были спроецированы. Изменение: `isFinalizedEntry()` теперь использует `ModelRunState.isTerminalRunState(entry)` как первый источник терминальности, а legacy `finalStatus/finalStatusRecorded` остаются fallback. Файл: `background/job-orchestrator.js`.
- Для чего: убрать зависание Le Chat/похожих моделей в `Finalization deferred (generation active)` при ложном `busy=true` без видимой кнопки Stop. Изменение: добавлен лимит `DEFER_STREAM_BUSY_ONLY_MAX_MS = 45000`; если уже есть пригодный текст ответа, `busyVisible=true` без `stopVisible` больше не откладывает финализацию до общего лимита 180 секунд. Файл: `background/job-orchestrator.js`.
- Для чего: сделать `All Logs` пригодным для анализа после terminal state. Изменение: прямые `POST_TERMINAL_NOISE` переходы больше не экспортируются как `MODEL_RUN_TRANSITION` по умолчанию; счётчик `postTerminalNoiseCount` продолжает обновляться внутри FSM. Файл: `background/state-manager.js`.
- Для чего: убрать ложные `STATE_DIVERGENCE_DETECTED`, возникавшие в нормальном порядке `transition -> legacy projection`. Изменение: divergence больше не проверяется сразу после каждого transition; проверка остаётся после projection или при явном `detectDivergence=true`. Файл: `background/state-manager.js`.

### 2026-05-29 00:01 CEST
- Для чего: исправить регрессию из `All Logs 20260528_23-56.md`, где `RECOVERABLE_ERROR` закрывал FSM как terminal failure и блокировал последующий валидный recovery-ответ (`ANSWER_CANDIDATE_ACCEPTED:terminal_blocks_candidate`). Изменение: `RECOVERABLE_ERROR` теперь остаётся failure-status, но исключён из terminal statuses в общем `StatusContract`. Файл: `shared/status-contract.js`.
- Для чего: не блокировать успешный answer candidate после recoverable/failure состояния. Изменение: `ModelRunState` ввёл `isFinalTerminalStatus()` и не считает `RECOVERABLE_ERROR` финальным terminal; success-кандидат может поднять состояние в `SUCCESS` без `terminal_blocks_candidate`. Файл: `shared/model-run-state.js`.
- Для чего: не ухудшать `All Logs` избыточной state telemetry. Изменение: `MODEL_RUN_TRANSITION` для `POST_TERMINAL_NOISE` теперь дедуплицируется по label/source в окне 10 секунд; счётчик `postTerminalNoiseCount` продолжает обновляться. Файл: `background/state-manager.js`.

### 2026-05-28 23:24 CEST
- Для чего: убрать риск расхождения классификации статусов между `status-contract.js` и `model-run-state.js`. Изменение: `ModelRunState` теперь использует `LLMStatusContract` как основной источник `SUCCESS_STATUSES`, `FAILURE_STATUSES`, `TERMINAL_STATUSES`, `normalizeStatus()` и `is*Status()`; локальный список оставлен только как fallback для автономного запуска. Файл: `shared/model-run-state.js`.
- Для чего: сократить прямые записи legacy-полей мимо FSM. Изменение: добавлен `projectModelRunStateToLegacy()` как единая projection-точка для `entry.status`, `entry.finalStatus`, `entry.finalStatusRecorded`, `entry.finalizedAt`, `answer/statusData/responseMeta` и связанных полей. Файл: `background/state-manager.js`.
- Для чего: перевести финальный commit ответа на порядок `transition -> legacy projection`. Изменение: финальная секция `handleLLMResponse()` теперь сначала коммитит `ANSWER_CANDIDATE_ACCEPTED`/`TERMINAL_FAILURE`, затем применяет legacy projection через `projectModelRunStateToLegacy()` вместо прямых `entry.status/finalStatus` записей. Файл: `background/job-orchestrator.js`.
- Для чего: централизовать stop/reset projection. Изменение: `stopAllProcesses()` больше не пишет `jobState.llms[llmName].status = 'STOPPED'` напрямую при наличии projection helper. Файл: `background/job-orchestrator.js`.

### 2026-05-28 22:43 CEST
- Для чего: сделать dual write / рассинхрон legacy-полей и `modelRunState` видимым в `All Logs`. Изменение: добавлен telemetry helper `commitModelRunTransition()`, который для каждого перехода пишет `MODEL_RUN_TRANSITION` с `previousState`, `nextState`, `legacyBefore`, `legacyAfter`, source и результатом применения. Файлы: `background/state-manager.js`, `background/job-orchestrator.js`, `background/message-router.js`, `background/dispatch-coordinator.js`, `background/telemetry-logs.js`.
- Для чего: прямо фиксировать случаи, когда legacy `status/finalStatus` расходится с `modelRunState.uiStatus/terminalStatus`. Изменение: добавлен `detectModelStateDivergence()` и событие `STATE_DIVERGENCE_DETECTED` с legacy/modelRunState snapshot, причиной и source; повтор одинакового divergence дедуплицируется на 5 секунд. Файл: `background/state-manager.js`.
- Для чего: видеть места, где legacy-поля всё ещё коммитятся как projection после перехода state machine. Изменение: добавлен `emitStateProjectionCommitted()` и событие `STATE_PROJECTION_COMMITTED`; оно вызывается из `updateModelState()` и финальной projection-секции `handleLLMResponse()`. Файлы: `background/state-manager.js`, `background/job-orchestrator.js`.
- Для чего: гарантировать попадание новой state telemetry в общий export-файл. Изменение: `MODEL_RUN_TRANSITION`, `STATE_DIVERGENCE_DETECTED`, `STATE_PROJECTION_COMMITTED` добавлены в pinned telemetry labels. Файл: `background/telemetry-logs.js`.

### 2026-05-28 22:16 CEST
- Для чего: заменить цепочку патчей вокруг жёлтых/ложных статусов единым источником истины. Изменение: добавлен `shared/model-run-state.js` с явной transition matrix для dispatch/generation/lifecycle/answer/terminal/post-terminal состояний модели. Файлы: `shared/model-run-state.js`, `background/index.js`.
- Для чего: отделить диагностические события от изменения состояния модели. Изменение: `LLM_RESPONSE_READY`, `ANSWER_COMPLETE_DETECTED` и post-terminal diagnostics теперь проходят через `ModelRunState`; после terminal success не могут вернуть модель в `RECEIVING/GENERATING`, а шум учитывается как `postTerminalNoiseCount`. Файлы: `background/message-router.js`, `background/dispatch-coordinator.js`, `background/telemetry-logs.js`.
- Для чего: сделать финализацию ответа не набором исключений, а candidate pipeline. Изменение: добавлены `buildAnswerCandidate()`, `evaluateAnswerCandidate()` и `submitAnswerCandidate()` поверх существующего `buildFinalizationEvidence()`; принятые/отклонённые кандидаты пишут переходы `ANSWER_CANDIDATE_ACCEPTED/REJECTED` или `TERMINAL_FAILURE`. Файл: `background/job-orchestrator.js`.
- Для чего: синхронизировать UI-индикаторы с фактическим terminal state. Изменение: `buildGlobalStateSnapshot()` теперь отдаёт `modelRunState`, `terminalState`, `generationState`, `runMetrics`, а results UI предпочитает `modelRunState.uiStatus` перед legacy `status`. Файлы: `background/ui-broadcast.js`, `results.js`.
- Для чего: остановить лишние human/automation visits после терминального состояния. Изменение: human-presence scheduler использует `ModelRunState.isTerminalRunState()` и успех из `modelRunState.terminalState`, а не только legacy-поля. Файл: `background/human-presence.js`.

### 2026-05-27 23:25 CEST
- Для чего: исправить сценарий из `All Logs 20260527_23-17.md`, где ответы уже финализированы как `SUCCESS`, но журнал продолжал показывать признаки активной генерации. Изменение: post-terminal фильтр диагностики теперь отбрасывает `ANSWER_GENERATING`, `answer: layer semantic`, stale `LATE_COLLECT_DECISION_TRACE`, `DOM_FALLBACK_START`, retry/waiting/getResponses и похожие шумовые события после успешного terminal status. Файл: `background/telemetry-logs.js`.
- Для чего: не возвращать финализированную модель в состояние ожидания готовности. Изменение: `LLM_RESPONSE_READY` теперь игнорируется для моделей с terminal status/finalStatusRecorded, вместо вызова `updateModelState(..., 'RECEIVING')`. Файл: `background/message-router.js`.

### 2026-05-27 20:57 CEST
- Для чего: исправить сценарий из `All Logs 20260527_19-39.md`, где `Get answers` успешно вытягивал текст ответа из DOM, но модель могла оставаться жёлтой и продолжать получать human/automation visits. Изменение: `acceptLateCollectResult()` теперь сохраняет входной `responseMeta`, распознаёт явный пользовательский late collect и передаёт `lateCollectFinal/forceTerminalSuccess` в финализацию. Файл: `background/job-orchestrator.js`.
- Для чего: не откладывать пользовательский recovery в `RECEIVING`, когда ответ уже явно собран из DOM. Изменение: streaming defer и early-terminal guard пропускаются для `forceTerminalSuccess`, `lateCollectFinal`, `manualRecovery` и `preTerminalMaterialize`, при этом passive recovery без таких флагов остаётся под защитой от раннего зелёного статуса. Файл: `background/job-orchestrator.js`.
- Для чего: сделать кнопку `Get answers` финальным сбором, а не только обновлением панели. Изменение: `collectResponsesStaged()` помечает свой late collect как `user_collect_late_collect` и terminal-final, чтобы успешный ответ синхронизировал UI-статус, `MODEL_FINAL` и остановку дальнейших визитов вкладки. Файл: `background/job-orchestrator.js`.

### 2026-05-26 16:09 CEST
- Для чего: восстановить работу кнопок выбора моделей в header на странице `pipeline_panel.html`. Изменение: добавлена защита от отсутствующего `#compare-button`, чтобы инициализация `results.js` не падала на pipeline-странице и обработчики `.llm-button` корректно навешивались. Файл: `results.js`.

### 2026-05-21 20:41 CEST
- Для чего: исправить сценарий из `All Logs 20260521_20-38.md`, где `Qwen` и `Le Chat` сначала находили ответ через recovery/отложенную финализацию, но затем принимали финальный `NO_SEND/ERROR`. Изменение: `buildFinalizationEvidence()` теперь учитывает `pendingFinalAnswer` как answer evidence и блокирует terminal failure при наличии любого answer evidence, включая pre-terminal recovery. Файл: `background/job-orchestrator.js`.
- Для чего: не терять текст, который был показан как `Terminal success deferred (await lifecycle)`. Изменение: early-terminal guard сохраняет `pendingFinalAnswer/pendingFinalAnswerHtml`, чтобы последующая ошибочная финализация могла быть заменена на `SUCCESS` по сохранённому ответу. Файл: `background/job-orchestrator.js`.
- Для чего: сделать такие случаи диагностируемыми в общем export-файле. Изменение: добавлено событие `TERMINAL_FAILURE_BLOCKED_BY_ANSWER_EVIDENCE` и оно включено в pinned telemetry export. Файлы: `background/job-orchestrator.js`, `background/telemetry-logs.js`.

### 2026-05-20 09:38 CEST
- Для чего: исправить ручной вызов ответа конкретной модели по двойному клику на статус-индикаторе журнала модели. Изменение: статус-индикатор теперь отправляет `REQUEST_LLM_RESPONSE` для одной модели, то есть использует тот же путь, что кнопка `Get answers`: сначала отдаётся cached answer из background state, а при отсутствии кэша запускается manual late collect. Файл: `results.js`.
- Для чего: убрать нестабильность обработки двойного клика через `click`/`event.detail`. Изменение: обработчик статус-индикаторов переведён на настоящий delegated `dblclick`; добавлен keyboard fallback `Enter`/`Space`. Файл: `results.js`.
- Для чего: сделать интерактивность статус-индикатора явной для UI и accessibility. Изменение: статус-индикаторы получают `role="button"`, `tabIndex=0`, `aria-label`, tooltip “Double-click to fetch this model answer” и `focus-visible` outline. Файлы: `results.js`, `styles.css`.

### 2026-05-20 08:47 CEST
- Для чего: перенести открытие окна телеметрии с общей API-кнопки header на API-индикаторы в журналах/карточках моделей. Изменение: динамические `.api-indicator` теперь являются интерактивными элементами с `role="button"`, `tabIndex=0`, подсказкой и открывают DevTools/telemetry modal по двойному клику. Файл: `results.js`.
- Для чего: сохранить доступность нового действия с клавиатуры. Изменение: для `.api-indicator` добавлен обработчик `Enter`/`Space`, который открывает то же окно телеметрии. Файл: `results.js`.
- Для чего: убрать старое свойство у header API-кнопки. Изменение: удалён `dblclick`-handler с `#api-toggle`, а tooltip изменён с “opens DevTools on double-click” на нейтральное “API: uses connected APIs.” Файлы: `results.js`, `result_new.html`.
- Для чего: визуально показать интерактивность API-индикаторов. Изменение: `.api-indicator` получил `cursor: pointer`, `user-select: none` и `focus-visible` outline. Файл: `styles.css`.

### 2026-05-20 08:31 CEST
- Для чего: перейти от точечных recovery-патчей к единому системному слою финализации модели. Изменение: добавлен `buildFinalizationEvidence()` — единый evidence object для каждого финального решения: статус, причина, source, длина/hash ответа, dispatch/tab, promptSubmitted/lifecycle признаки, наличие pre-final recovery, prompt echo, contradictions и accepted flag. Файл: `background/job-orchestrator.js`.
- Для чего: сделать финальный статус объяснимым в `All Logs`. Изменение: перед фиксацией ответа теперь пишется pinned telemetry `FINALIZATION_DECISION`; тот же `finalizationEvidence` попадает в `Response`, `MODEL_FINAL` и `LLM_PARTIAL_RESPONSE.metadata`. Файлы: `background/job-orchestrator.js`, `background/telemetry-logs.js`.
- Для чего: не принимать оригинальный prompt как ответ не только в Grok content-script, но и на уровне background для всех моделей. Изменение: добавлены `normalizeEvidenceText()`, `isPromptEchoAnswerCandidate()` и `ANSWER_SANITY_REJECTED`; prompt echo превращается в `EXTRACT_FAILED/answer_prompt_echo` и проходит общий pre-final recovery вместо зелёного `SUCCESS`. Файл: `background/job-orchestrator.js`.
- Для чего: сделать pre-final recovery частью общего контракта, а не списком исключений для отдельных моделей. Изменение: `PRE_TERMINAL_MATERIALIZE_MODELS` расширен на все web-модели (`GPT`, `Gemini`, `Claude`, `Le Chat`, `Perplexity`, `Grok`, `Qwen`, `DeepSeek`), поэтому спорные `NO_SEND/EXTRACT_FAILED/ERROR` проходят единый materialize + late collect перед финальной ошибкой. Файл: `background/job-orchestrator.js`.
- Для чего: хранить машинное состояние модели отдельно от UI-статуса. Изменение: добавлен `recordModelRunState()` с `executionStatus`, `generationStatus`, `answerStatus`, `uiStatus`, `dispatchId`, `updatedAt`; состояние сохраняется в `entry.modelRunState`. Файл: `background/job-orchestrator.js`.

### 2026-05-19 15:39 CEST
- Для чего: исправить `Perplexity: extractfailedround4gatetimeout` из `All Logs 20260519_15-33.md`, где до таймаута уже были успешные inline snapshot recovery на 248/1124/3452 символа, но финальный materialization не запускался. Изменение: `Perplexity` добавлен в `PRE_TERMINAL_MATERIALIZE_MODELS`, поэтому перед `EXTRACT_FAILED` теперь выполняется foreground materialization + `lateCollectAnswer()`. Файл: `background/job-orchestrator.js`.
- Для чего: устранить `Le Chat: nosendround4gatetimeout`, когда Round1 пропустил отправку из-за `tab_ineligible`, а дальше система пыталась собирать ответ из неподходящей вкладки. Изменение: при `tab_ineligible/tab_missing` в Round1 оркестратор сбрасывает binding, создаёт новую вкладку Le Chat, ждёт binding/readiness и только затем отправляет prompt; события `ROUND1_TAB_RECOVERY_*` попадают в экспорт. Файл: `background/job-orchestrator.js`.
- Для чего: запретить Grok фиксировать оригинальный prompt как успешный ответ. Изменение: `content-grok.js` сохраняет последний отправленный prompt, проверяет pipeline/manual ping ответы через `isPromptEcho()`, отклоняет echo событием `GROK_PROMPT_ECHO_REJECTED` и ждёт альтернативный non-echo ответ вместо отправки prompt в background как `SUCCESS`. Файл: `content-scripts/content-grok.js`.
- Для чего: исправить fallback поиска non-echo ответа Grok. Изменение: в `waitForNonEchoResponse()` заменён ошибочный `observer.disconnect()` на безопасный вызов `stopObserve()`, иначе echo-recovery мог падать при cleanup. Файл: `content-scripts/content-grok.js`.
- Для чего: сохранить новые диагностические маркеры в общем `All Logs` экспорте. Изменение: `ROUND1_TAB_RECOVERY_*`, `MATERIALIZE_RECOVERY_VISIT_FALLBACK` и `GROK_PROMPT_ECHO_REJECTED` добавлены в pinned telemetry labels. Файл: `background/telemetry-logs.js`.

### 2026-05-19 15:18 CEST
- Для чего: лучше понимать, почему pre-terminal recovery запускается перед `NO_SEND/EXTRACT_FAILED/ERROR`. Изменение: добавлено событие `MATERIALIZE_RECOVERY_CONTEXT` с исходным статусом-кандидатом, причиной, типом ошибки, `dispatchId`, признаками lifecycle, длинами уже известных answer/pending/snapshot и количеством transport-ошибок; полный текст ответа не логируется. Файл: `background/job-orchestrator.js`.
- Для чего: видеть, на каком слое позднего сбора ответ был найден или потерян. Изменение: `lateCollectAnswer()` теперь пишет `LATE_COLLECT_DECISION_TRACE` для каждого исхода цепочки (`content_script`, `inline_executeScript`, `snapshot_cache`, `none`) с состоянием вкладки, статусом, длиной текста, hash, candidateCount, selector/strategy и elapsedMs без полного текста ответа. Файл: `background/job-orchestrator.js`.
- Для чего: финальная ошибка после неудачного recovery должна быть объяснима в export-файле. Изменение: перед повторной финализацией исходной ошибки пишется `FINAL_ERROR_AFTER_RECOVERY` с original status/reason, recovery status/source/reason, количеством candidates и recovered length. Файл: `background/job-orchestrator.js`.
- Для чего: гарантировать попадание новой диагностики в общий экспорт `All Logs ...md` даже при большом числе событий. Изменение: новые telemetry labels добавлены в pinned-набор persistent diagnostics, который не вырезается обычным trim unpinned-событий. Файл: `background/telemetry-logs.js`.

### 2026-05-19 08:17 CEST
- Для чего: не считать `Qwen send not confirmed` окончательным отсутствием ответа, если тот мог быть сгенерирован и просто не был извлечён из виртуализированного DOM. Изменение: `NO_SEND` для Qwen теперь сначала переводится в `RECOVERABLE_ERROR` и получает один предфинальный materialize + late collect проход; только после промаха исходная ошибка фиксируется как финальная. Файл: `background/job-orchestrator.js`.
- Для чего: дать диагностический след, который покажет, сработал ли новый слой восстановления в следующем реальном логе. Изменение: добавлены telemetry-маркеры `MATERIALIZE_RECOVERY_DEFER_TERMINAL`, `MATERIALIZE_RECOVERY_START`, `MATERIALIZE_RECOVERY_SUCCESS`, `MATERIALIZE_RECOVERY_MISS`, `MATERIALIZE_RECOVERY_ERROR`; в miss пишутся candidates/source/status без текста ответа. Файл: `background/job-orchestrator.js`.

### 2026-05-18 20:06 CEST
- Для чего: убрать дублирование и расхождение правил статусов между background и results UI. Изменение: добавлен общий модуль `shared/status-contract.js` с едиными `SUCCESS/FAILURE/TERMINAL` списками, rank, normalization, downgrade guard и derived contract (`executionState`, `answerState`, `uiStatus`). Файл: `shared/status-contract.js`.
- Для чего: сделать background state источником структурированного статуса, а не только строки `status`. Изменение: `state-manager` и `job-orchestrator` теперь используют `LLMStatusContract.shouldApplyStatusUpdate()` и сохраняют `statusContract`; игнорируемые stale/downgrade события логируются как `STATUS_IGNORED`. Файлы: `background/state-manager.js`, `background/job-orchestrator.js`.
- Для чего: синхронизировать global snapshot с новым контрактом. Изменение: `buildGlobalStateSnapshot()` теперь отдаёт `executionState`, `answerState`, `statusRank`, `liveStatus`, `finalStatus` и итоговый `status` из `deriveStatusContract()`. Файл: `background/ui-broadcast.js`.
- Для чего: убрать отдельную UI-таблицу рангов и использовать тот же guard, что и background. Изменение: `results.js` подключает `shared/status-contract.js` и применяет `LLMStatusContract` для normalization/rank/downgrade guard индикаторов. Файлы: `result_new.html`, `results.js`.

### 2026-05-18 19:00 CEST
- Для чего: исправить рассинхрон индикаторов статуса, когда ответ уже получен и вставлен, но индикатор остаётся в старом состоянии из-за потерянного или устаревшего `STATUS_UPDATE`. Изменение: `LLM_PARTIAL_RESPONSE` теперь синхронизирует индикатор по `metadata.status`, а не только обновляет текст панели. Файл: `results.js`.
- Для чего: защитить UI от старых поздних событий, приходящих после финального статуса. Изменение: добавлен client-side terminal-rank guard: `SUCCESS` не понижается до `PARTIAL/ERROR/NO_SEND`, terminal-статус не сбрасывается не-terminal событиями, кроме явного reset нового job. Файл: `results.js`.
- Для чего: восстанавливать индикаторы после потери сообщения или перезагрузки results tab. Изменение: `GLOBAL_STATE_BROADCAST` теперь применяется к индикаторам, а background snapshot отдаёт `finalStatus`, `finalStatusRecorded`, `liveStatus` и `statusData`. Файлы: `results.js`, `background/ui-broadcast.js`.
- Для чего: синхронизировать индикаторы из диагностических финальных событий. Изменение: `FINAL_STATUS`, `MODEL_FINAL` и `Status:*` log entries теперь используются как дополнительные authoritative источники статуса. Файл: `results.js`.

### 2026-05-17 22:38 CEST
- Для чего: убрать системную причину зависаний на страницах моделей после того, как часть моделей уже завершилась. Изменение: Round2 теперь пропускает модели с `finalStatus/finalStatusRecorded` так же, как Round3/Round4, и пишет `skipped (already complete)` вместо повторной проверки/фокуса. Файл: `background/job-orchestrator.js`.
- Для чего: устранить жёлтые индикаторы после уже зафиксированного зелёного успеха. Изменение: `updateModelState()` получил terminal-rank guard и больше не понижает `SUCCESS` до `PARTIAL/ERROR/NO_SEND` поздними событиями. Файл: `background/state-manager.js`.
- Для чего: сохранить возможность ручного восстановления ответа, но не портить terminal status. Изменение: manual late recovery может заменить текст ответа, однако при уже зафиксированном `SUCCESS` входящий `PARTIAL` сохраняет статус `SUCCESS` и логирует `Manual response kept terminal status`. Файл: `background/job-orchestrator.js`.
- Для чего: кнопка “получить ответы” не должна снова ходить по вкладкам, если ответ уже есть в background state. Изменение: `REQUEST_LLM_RESPONSE` теперь сразу отдаёт cached terminal answer и не запускает `handleManualResponsePing()` без `advanceStrategy`. Файл: `background/message-router.js`.

### 2026-05-17 10:08 CEST
- Для чего: убрать ложный жёлтый статус, когда late snapshot вернул полный ответ, но был помечен как `PARTIAL` только из-за источника `snapshot_cache`. Изменение: `handleLLMResponse()` теперь снимает forced partial для `snapshot_cache`, если есть доказательство завершения ответа: `ANSWER_COMPLETE_DETECTED`/`LLM_RESPONSE_READY` с сопоставимой длиной или `generation_inactive` на длинном snapshot. Файл: `background/job-orchestrator.js`.
- Для чего: использовать уже приходящий lifecycle diagnostic как доказательство завершения ответа. Изменение: `updateTypingStateFromDiagnostic()` теперь сохраняет `ANSWER_COMPLETE_DETECTED` в `entry.lifecycleReadyAt/lifecycleReadyMeta/answerCompleteTextLength`, чтобы поздняя финализация могла отличить полный snapshot от настоящего partial. Файл: `background/dispatch-coordinator.js`.

### 2026-05-17 09:51 CEST
- Для чего: защитить late answer snapshot cache от устаревших данных после краша extension, перезапуска браузера или пропущенного `stopAllProcesses()`. Изменение: `readAnswerSnapshotCache()` теперь применяет TTL `60 минут`; просроченные snapshot удаляются из in-memory cache и `CompressedStorage`, а не используются как fallback. Файл: `background/job-orchestrator.js`.
- Для чего: гарантировать очистку snapshot cache до создания нового `jobState`. Изменение: `startProcess()` переведён в async, ожидает `clearLateAnswerSnapshotCache("start_process")`, а `START_FULLPAGE_PROCESS` в router теперь вызывает `await startProcess(...)` перед ответом UI. Файлы: `background/job-orchestrator.js`, `background/message-router.js`.

### 2026-05-17 09:49 CEST
- Для чего: закрыть риск накопления устаревших DOM snapshot после внедрения late answer collection. Изменение: добавлен `clearLateAnswerSnapshotCache()`, который очищает in-memory cache и удаляет из `chrome.storage.local` все ключи `late_answer_snapshot_v1:*`. Файл: `background/job-orchestrator.js`.
- Для чего: не допустить попадания snapshot старого запуска в новый run. Изменение: `startProcess()` теперь запускает очистку late answer snapshot cache перед новым запуском, а `stopAllProcesses()` дополнительно очищает in-flight late collection и snapshot cache. Файл: `background/job-orchestrator.js`.

### 2026-05-17 09:21 CEST
- Для чего: реализовать недеструктивный механизм позднего сбора ответа, когда ответ уже есть или недавно был в DOM, но не попал в журнал. Изменение: в `background/job-orchestrator.js` добавлен `lateCollectAnswer()` с цепочкой `snapshot cache -> content-script ping/getResponses -> inline executeScript extractor -> cache fallback`, single-flight защитой, bounded timeouts и явными статусами `success`, `partial_from_snapshot`, `dead_tab_no_snapshot`, `late_collect_failed`.
- Для чего: не уничтожать DOM ответа при позднем сборе. Изменение: late collector использует отдельную readable-политику: проверяет `tabs.get`, `discarded`, URL eligibility, короткий ping и read-only `chrome.scripting.executeScript`, но не вызывает `reloadTab`, не переотправляет prompt и не использует destructive dispatch recovery path. Файл: `background/job-orchestrator.js`.
- Для чего: иметь fallback, если content script жив, выгружен или service worker перезапустился. Изменение: добавлен snapshot cache ответа с ключами по `llmName/runSessionId/dispatchId/tabId` и alias-ключами без `dispatchId`; snapshot хранится в памяти и через `CompressedStorage`, а telemetry/diagnostics получают только безопасные метаданные без полного текста ответа. Файлы: `background/job-orchestrator.js`, `background/message-router.js`.
- Для чего: регулярно сохранять последний видимый assistant-текст без тяжёлого reinject. Изменение: `content-scripts/content-utils.js` получил idempotent MutationObserver с debounce/hash, model-specific lightweight selectors, `extractSafeVisibleText()`, `collectLateSnapshotCandidate()` и обработчик `LATE_COLLECT_PING`; content script отправляет `ANSWER_SNAPSHOT` в background без регистрации дополнительных model-specific listeners.
- Для чего: сделать ручное подтягивание ответа через индикатор статуса более надёжным. Изменение: `handleManualResponsePing()` после обычного `getResponses` теперь дополнительно запускает `lateCollectAnswer()` и при успешном результате фиксирует ответ через общий `handleLLMResponse`. Файл: `background/job-orchestrator.js`.
- Для чего: заменить старый примитивный staged collection на единый поздний сбор. Изменение: `collectResponsesStaged()` теперь определяет модель по tab binding/URL и использует `lateCollectAnswer()` вместо короткого `chrome.tabs.sendMessage({ action: "get_response" })` без fallback. Файл: `background/job-orchestrator.js`.

### 2026-05-16 19:39 CEST
- Для чего: использовать индикатор статуса в карточке ответа как быстрый способ подтянуть ответ конкретной модели, если он не попал в журнал вместе с остальными. Изменение: одиночный клик по `.status-indicator` теперь вызывает существующий manual response ping (`MANUAL_RESPONSE_PING`) для модели из `data-llm-name`, сохраняя сам индикатор как визуальный статус. Файл: `results.js`.
- Для чего: сохранить доступ к прежнему окну телеметрии без конфликта с новым действием. Изменение: открытие DevTools/телеметрии перенесено на двойной клик по индикатору статуса; tooltip индикатора теперь показывает статус и подсказку `Click to fetch this model answer`. Файл: `results.js`.

### 2026-05-16 19:31 CEST
- Для чего: сделать ссылки в журналах ответов моделей кликабельными. Изменение: `results.js` теперь декорирует ссылки внутри response/log containers атрибутами `target="_blank"`, `rel="noopener noreferrer"` и `contenteditable="false"`, чтобы ссылки не превращались в обычный редактируемый текст внутри панели ответа.
- Для чего: открывать ссылки из журналов ответов в новой вкладке браузера. Изменение: добавлен делегированный click-handler для `.output`, `.response-content`, `.response-body` и диагностических log-контейнеров; при клике по `a[href]` используется `chrome.tabs.create({ url })`, а при недоступности API выполняется fallback на `window.open(..., "_blank")`. Файл: `results.js`.

### 2026-05-16 19:23 CEST
- Для чего: не терять частично видимый ответ при deferred hard-stop у DeepSeek/Le Chat/Qwen. Изменение: background DOM snapshot recovery расширен на `Le Chat`, `Qwen` и `DeepSeek`, добавлены платформенные answer selectors, а перед финальным `script_runtime_hard_stop` оркестратор делает последний DOM snapshot recovery и фиксирует найденный ответ вместо чистого `ERROR`. Файл: `background/job-orchestrator.js`.
- Для чего: восстановить Qwen после одиночного промаха подтверждения отправки. Изменение: `Qwen` добавлен в `ROUND2_REPAIR_MODELS`, поэтому при `prompt not confirmed` Round2 может выполнить repair-dispatch вместо раннего terminal `NO_SEND`. Файл: `background/job-orchestrator.js`.
- Для чего: повысить шанс реальной отправки Qwen в текущей разметке. Изменение: `content-qwen.js` получил более широкий поиск send button по `aria-label`, `data-testid`, class/icon/submit-кандидатам рядом с composer, fallback через `Meta+Enter` и `form.requestSubmit()` перед финальным `Qwen send not confirmed`. Файл: `content-scripts/content-qwen.js`.

### 2026-05-13 20:36 CEST
- Для чего: сделать проверку активной генерации устойчивее для разных интерфейсов и языков UI. Изменение: background-проверка активной генерации теперь учитывает stop-кнопки на нескольких языках, `role=button`, `progressbar`, loading/generating/streaming классы и Qwen-специфичные loading-сигналы. Файл: `background/job-orchestrator.js`.
- Для чего: не принимать непроверенный DOM-фрагмент за финальный ответ после deferred-finalization. Изменение: early terminal guard теперь применяется ко всем основным web-моделям для `deferred_finalization/generation_inactive` и `dom_snapshot_recovery`; короткие ответы могут завершиться только после повторного стабильного наблюдения и max-wait, либо после lifecycle-ready. Файл: `background/job-orchestrator.js`.

### 2026-05-12 23:58 CEST
- Для чего: исправить Qwen, когда селектор ответа захватывал слишком широкий контейнер и подтягивал служебный нижний блок выбора режима рассуждения. Изменение: в `content-scripts/answer-pipeline-selectors.js` и `selectors/qwen.config.js` Qwen `response/lastMessage` selectors сужены до реального markdown/response body внутри assistant message; удалены слишком широкие fallback-пути вроде `main article`, `.prose`, `[class*="response"]`, которые могли цеплять посторонние узлы.
- Для чего: убрать попадание слова `Автоматический`/`Automatic` и похожих mode labels в текст ответа Qwen. Изменение: `content-scripts/content-qwen.js` теперь перед извлечением `text/html` клонирует assistant message и вырезает интерактивные/footer/reasoning-mode узлы (`button`, `radiogroup`, `listbox`, `mode-switch`, `reasoning` и точные labels `automatic/автоматический/自动`), после чего извлекает только очищенный markdown body.

### 2026-05-12 23:48 CEST
- Для чего: исправить Gemini, когда ответ был виден lifecycle detector, но итоговый статус и UI теряли семантику `partial/hard_timeout`. Изменение: `content-gemini.js` теперь сохраняет pipeline metadata рядом с `text/html` и передаёт её в background через `meta.responseMeta`, поэтому `streaming_incomplete`, `hard_timeout`, `sanityWarnings`, `sanityConfidence` и `partial` больше не теряются на пути `UnifiedAnswerPipeline -> LLM_RESPONSE -> handleLLMResponse`.
- Для чего: сохранить единый контракт ответа для Gemini и не ломать fallback-пути. Изменение: `normalizeResponsePayload()` расширен поддержкой `meta/metadata`, а отправка `LLM_RESPONSE`/`FINAL_LLM_RESPONSE` мержит `responseMeta` с исходным dispatch meta вместо отправки только `message.meta`.

### 2026-05-12 23:42 CEST
- Для чего: убрать ранний зелёный финал у GPT, Gemini и Perplexity, когда в журнал попадал только фрагмент ответа. Изменение: в `background/job-orchestrator.js` добавлен early-terminal guard для рискованных путей `dom_snapshot_recovery` и `deferred_finalization/generation_inactive`; теперь первый короткий или неподтверждённый ответ не фиксируется как terminal `SUCCESS`, а переводится обратно в `RECEIVING` с follow-up ping до lifecycle-ready или повторно стабильного длинного ответа.
- Для чего: связать lifecycle detector с финализацией background-оркестратора. Изменение: `background/message-router.js` теперь сохраняет `LLM_RESPONSE_READY` в `jobState` как `lifecycleReadyAt/lifecycleReadyMeta`, очищает pending early-terminal guard и тем самым разрешает безопасную terminal финализацию только после сигнала готовности ответа.

### 2026-05-12 23:20 CEST
- Для чего: закрыть уточнения ТЗ по безопасному lifecycle cancellation. Изменение: `stopResponseLifecycleTracking()` теперь возвращает стабильную форму `{ ok, stopped, reason }`, поддерживает фильтры `modelName`, `dispatchId`, `runSessionId`, выставляет `cancelledAt/cancelReason`, отключает `MutationObserver`, очищает pending timers и является идемпотентным. Файл: `content-utils/response-lifecycle-detector.js`.
- Для чего: предотвратить поздние readiness/final события после cleanup. Изменение: добавлен `isTrackerActive()` и cancellation guard перед `ANSWER_COMPLETE_DETECTED`, `LLM_RESPONSE_READY` и возвратом `COMPLETE`; ожидания polling теперь используют cancellable timers, чтобы остановка tracker немедленно завершала loop как `CANCELLED`. Файл: `content-utils/response-lifecycle-detector.js`.
- Для чего: убрать тяжёлые selector resolver вызовы из каждого lifecycle tick. Изменение: composer/send readiness сначала проверяется дешёвым `detectCheapComposerReadiness()`, а `SelectorResolverV2.resolveComposer()` / `resolveSendButton()` вызываются только после `textStable` и с коротким timeout `800ms`. Файл: `content-utils/response-lifecycle-detector.js`.
- Для чего: ограничить fallback DOM text extraction по обновлённому контракту. Изменение: `extractSafeVisibleText()` теперь принимает `maxChars = 10000`, нормализует whitespace, не выбрасывает исключения и обрезает возвращаемый текст. Файл: `content-utils/selector-resolver-v2.js`.

### 2026-05-12 22:47 CEST
- Для чего: добавить детерминированный self-healing слой селекторов без внешних зависимостей для composer, send button и latest assistant answer. Изменение: добавлены новые модули `content-utils/selector-resolver-v2.js` и `content-utils/response-lifecycle-detector.js` с exact/cache/semantic/spatial resolution, fingerprint/cache validation, shadow-DOM scan, lifecycle tracking, generating-indicator detection, self-test API и безопасной телеметрией без prompt/answer persistence. Файлы: `content-utils/selector-resolver-v2.js`, `content-utils/response-lifecycle-detector.js`.
- Для чего: загрузить новые resolver/lifecycle utilities раньше model-specific content scripts и не менять host permissions. Изменение: оба модуля подключены в общий LLM content-script bundle и продублированы перед каждым model-specific content script entry, чтобы fallback и async lifecycle были доступны до инициализации платформенных скриптов. Файл: `manifest.json`.
- Для чего: добавить background-level placeholder и readiness signal без вмешательства в текущий final answer flow. Изменение: `background/message-router.js` теперь обрабатывает `VISUAL_RESOLVE_REQUEST` как disabled placeholder, принимает `LLM_RESPONSE_READY` только как diagnostic/readiness update и нормализует `selector_resolution` metric через `layer || method`, не меняя существующий `LLM_RESPONSE / FINAL_LLM_RESPONSE` путь. Файл: `background/message-router.js`.

### 2026-04-24 14:21 CEST
- Для чего: исправить reuse вкладок для всех моделей, когда `New Pages` выключен. Изменение: поиск кандидата для attach теперь проходит по всем открытым вкладкам и фильтрует их вручную по URL-паттернам и пригодности, вместо зависимости от узкого `chrome.tabs.query` пути, поэтому non-GPT модели тоже должны переиспользовать уже открытые вкладки, если они есть. Файл: `background/tab-manager.js`.

### 2026-05-17 20:27 CEST
- Для чего: устранить зависание на Claude, когда вкладка захватывала фокус до завершения ответа и `FOCUS_STUCK` только логировался, но не освобождал визит. Изменение: `FOCUS_STUCK` теперь принудительно завершает активный human visit, возвращает фокус на страницу результатов и пишет отдельный диагностический маркер `HUMAN_VISIT_FOCUS_STUCK_TERMINATED`. Файл: `background/human-presence.js`.
- Для чего: защититься от ситуации, когда глобальный hard-cap визита перезаписывается другим визитом и текущая вкладка остаётся активной слишком долго. Изменение: каждый `visitTabWithHumanity()` получил локальный `HUMAN_VISIT_HARD_CAP_MS` таймер, который очищается при нормальном завершении и завершает только свой активный визит при превышении лимита. Файл: `background/human-presence.js`.

### 2026-05-17 20:08 CEST
- Для чего: не зависать на Qwen или другой модели, если она стала terminal во время активного human/automation visit. Изменение: активные visits получили polling terminal-состояния каждые `500ms` и завершаются сразу после `finalStatus/finalStatusRecorded`, очищая timers/locks и возвращая фокус. Файл: `background/human-presence.js`.
- Для чего: не запускать forced automation visit, если модель уже завершилась между планированием и фактическим визитом. Изменение: `runForcedAutomationVisits()` проверяет terminal-состояние перед каждым визитом, логирует `FORCED_VISIT_SKIPPED`, не считает skipped-визиты выполненными и прекращает цикл после terminal. Файл: `background/job-orchestrator.js`.
- Для чего: убрать misleading Round4 telemetry, будто завершённые модели снова фокусируются. Изменение: model-level Round4 START/END для terminal-моделей теперь пишется как `skipped (already complete)`, а не `focusing results tab`. Файл: `background/job-orchestrator.js`.

### 2026-05-17 19:41 CEST
- Для чего: отличать проблему UI-события от проблемы background/content-script. Изменение: в diagnostics добавлены события `Manual ping: status indicator double-click` и `Manual ping: status indicator single click ignored` с source/advance details. Файл: `results.js`.
- Для чего: видеть, дошёл ли восстановленный ответ до страницы результатов и был ли вставлен в DOM-панель. Изменение: при manual ping логируется `Manual ping: response payload received` с `textLen/htmlLen`, а `updateLLMPanelOutput()` пишет `Panel output updated` или `Panel output update failed` с id панели и длинами. Файл: `results.js`.

### 2026-05-17 19:19 CEST
- Для чего: запускать ручное подтягивание ответа именно по двойному клику на индикаторе статуса ответа в журнале модели. Изменение: обработчик `.status-indicator` теперь вызывает `triggerManualPing()` только на `dblclick`; одиночный клик больше не запускает manual recovery. Файл: `results.js`.
- Для чего: убрать конфликт с телеметрией, так как её открытие уже доступно двойным кликом по кнопке API. Изменение: открытие DevTools/telemetry modal с индикатора статуса удалено. Файл: `results.js`.
- Для чего: синхронизировать подсказку UI с новым поведением. Изменение: tooltip индикатора статуса теперь показывает `Double-click to fetch this model answer`. Файл: `results.js`.

### 2026-05-17 19:10 CEST
- Для чего: не считать рабочую стратегию плохой при первом ручном восстановлении ответа. Изменение: `MANUAL_RESPONSE_PING` и `REQUEST_LLM_RESPONSE` получили явный `advanceStrategy`; предыдущий DOM-кандидат помечается rejected только при `advanceStrategy=true`. Файлы: `background/message-router.js`, `background/job-orchestrator.js`, `results.js`.
- Для чего: разделить UX “получить ответ” и “попробовать следующий селектор” без отдельной кнопки. Изменение: первый клик по индикатору отправляет `advanceStrategy=false`, последующие клики после запуска recovery отправляют `advanceStrategy=true`. Файл: `results.js`.
- Для чего: сделать ручное восстановление диагностируемым. Изменение: `manualRecovery` теперь хранит `lastAcceptedCandidate`, `exhausted`, `candidateCount`, `textHash`, `strategyId`, `strategyIndex` и selector metadata; content-script/live и inline late collect возвращают diagnostics в результат. Файл: `background/job-orchestrator.js`.

### 2026-05-17 12:24 CEST
- Для чего: дать кнопке журнала модели не только повторно запросить ответ, но и восстановить неправильный ответ после промаха селектора. Изменение: manual ping получил persistent `manualRecovery` state в `jobState.llms[llmName]`, хранит использованные стратегии/селекторы и при повторном клике помечает предыдущий кандидат rejected. Файл: `background/job-orchestrator.js`.
- Для чего: при повторном клике выбирать другой DOM-путь, а не возвращать тот же ошибочный блок. Изменение: inline late extractor получил стратегии `default_score`, `last_visible`, `bottom_most`, `longest`, `markdown_only`, `assistant_role_only`, `article_bottom`, а single-flight late collect теперь разделяется по strategy/attempt. Файл: `background/job-orchestrator.js`.
- Для чего: разрешить ручному восстановлению заменить уже финализированный ответ, если пользователь видит, что журнал подтянул неверный текст. Изменение: `handleLLMResponse` принимает success-ответы с `manualRecovery/manualOverride` поверх terminal-lock, но не позволяет manual override по ошибочным или слишком коротким payload. Файл: `background/job-orchestrator.js`.
- Для чего: пробросить режим ротации селекторов от кнопки статуса/журнала до background. Изменение: `MANUAL_RESPONSE_PING` теперь принимает `manualRecovery`, `advanceSelector` и `reason`, а UI отправляет эти параметры при клике по индикатору. Файлы: `background/message-router.js`, `results.js`.

### 2026-04-24 14:05 CEST
- Для чего: исправить Qwen, когда ответ генерируется, но не попадает в журнал. Изменение: Qwen-извлечение теперь учитывает реальные классы текущей разметки (`qwen-chat-message-assistant`, `chat-response-message-right`, `response-message-content`, `custom-qwen-markdown`, `qwen-markdown`), чтобы ответ не терялся при промахе по более общим селекторам. Файлы: `content-scripts/content-qwen.js`, `selectors/qwen.config.js`, `selectors/config-bundle.js`, `content-scripts/answer-pipeline-selectors.js`.
- Для чего: при выключенном `New Pages` предпочитать уже открытые вкладки модели, а не открывать новые. Изменение: поиск существующей вкладки для attach больше не режется фильтром `audible:false`, поэтому reuse может сработать для любой уже открытой подходящей вкладки, включая последнюю по времени. Файл: `background/tab-manager.js`.

### 2026-04-24 13:41 CEST
- Для чего: сделать этот прогон доступным через стандартную команду проекта. Изменение: в `package.json` добавлен `npm run test:qwen`. Файл: `package.json`.

### 2026-04-24 13:31 CEST
- Для чего: исправить сценарий, где Qwen генерирует ответ и статус остаётся зелёным, но ответ не попадает в журнал из-за промаха по селекторам. Изменение: `content-qwen.js` теперь использует более широкий DOM fallback для извлечения ответа, а `answer-pipeline-selectors.js` получил расширенный Qwen selector pack и alias `response`, чтобы журнал мог подхватить ответ даже при изменении разметки. Файлы: `content-scripts/content-qwen.js`, `content-scripts/answer-pipeline-selectors.js`.
- Для чего: уменьшить зависимость Qwen от одного пути подтверждения отправки. Изменение: `sendComposer` теперь подтверждает отправку по новому user-message или явному streaming/busy-сигналу, а не по очистке composer. Файл: `content-scripts/content-qwen.js`.

### 2026-04-22 16:17 CEST
- Для чего: не фиксировать GPT/Claude зелёными по первому неполному фрагменту ответа. Изменение: `job-orchestrator.js` теперь перед terminal `SUCCESS` для GPT и Claude проверяет вкладку через `chrome.scripting.executeScript`; если виден `Stop`/streaming/busy-сигнал, финализация откладывается, в UI отправляется только partial update, а сбор ответа повторяется через deferred ping. Файл: `background/job-orchestrator.js`.
- Для чего: устранить ложный `SUCCESS` Qwen, когда prompt фактически не был отправлен/не появился в чате. Изменение: `content-qwen.js` больше не считает отправку подтверждённой по одному только очищению composer; подтверждение требует streaming-сигнал, disabled send button или появление нового user-message с началом prompt. Файл: `content-scripts/content-qwen.js`.
- Для чего: не принимать старый ответ Qwen как новый после неудачной отправки. Изменение: fallback-наблюдение Qwen теперь учитывает baseline count контейнеров сообщений и не возвращает старый last message, если после send не появился новый контейнер. Файл: `content-scripts/content-qwen.js`.

### 2026-04-22 15:51 CEST
- Для чего: устранять жёлтый статус Gemini/Perplexity, когда ответ уже есть на странице, но content-script канал сломан (`message port closed` / `message channel closed`). Изменение: добавлен background-level DOM snapshot recovery для Gemini и Perplexity: background выполняет `chrome.scripting.executeScript` во вкладке, ищет последний assistant-answer по DOM/shadow-DOM селекторам и передаёт найденный текст в `handleLLMResponse` как `dom_snapshot_recovery`. Файл: `background/job-orchestrator.js`.
- Для чего: запускать DOM recovery именно в сценариях из лога `All Logs 20260422_15-45.md`. Изменение: recovery вызывается при `PING_TRANSPORT_ERROR` в passive/manual ping и при `transport_error_after_submit`, не затрагивая Grok, где зависание связано с самой моделью и ответ не появился. Файлы: `background/job-orchestrator.js`, `background/dispatch-coordinator.js`.

### 2026-04-20 10:23 CEST
- Для чего: убрать ложный красный хвост после успешного `MODEL_FINAL`. Изменение: `telemetry-logs.js` теперь отбрасывает известные шумные post-terminal события для моделей с зафиксированным успешным финалом (`PIPELINE_ERROR`, `SELECTOR_STATS`, `FOCUS_STUCK`, visit/lease-события, transport/pipeline-noise), не скрывая реальные ошибки до финала. Файл: `background/telemetry-logs.js`.
- Для чего: остановить источник поздних `FOCUS_STUCK` и `TAB_VISIT` после успеха. Изменение: `human-presence.js` теперь не начинает human/automation visit для модели с успешным terminal-статусом, проверяет terminal-состояние перед фактическим переключением вкладки и умеет завершать активный визит по конкретной модели. Файл: `background/human-presence.js`.
- Для чего: синхронизировать финал модели с остановкой human-presence. Изменение: при `SUCCESS`, `PARTIAL` или `STREAM_TIMEOUT_HIDDEN` оркестратор вызывает `completeHumanPresenceForModel`, чтобы убрать активные visit/automation locks сразу после фиксации результата. Файл: `background/job-orchestrator.js`.
- Для чего: гарантированно очищать телеметрию прошлого прогона при reload страницы результатов. Изменение: `results.js` теперь ожидает ответ `CLEAR_DIAG_EVENTS` перед дальнейшей инициализацией, чтобы экспорт не успевал прочитать старый `__diagnostics_events__`. Файл: `results.js`.
- Для чего: не переносить диагностику между сетями даже без reload страницы. Изменение: `message-router.js` очищает persistent telemetry и runtime `entry.logs` при `CLEAR_DIAG_EVENTS` и перед запуском нового `START_FULLPAGE_PROCESS`. Файл: `background/message-router.js`.

### 2026-04-20 09:56 CEST
- Для чего: очищать телеметрию прошлого запуска при перезагрузке страницы результатов. Изменение: `results.js` теперь определяет `navigation.type === 'reload'` и отправляет `CLEAR_DIAG_EVENTS` в background до восстановления UI, чтобы `__diagnostics_events__` не тянулся из предыдущей сети/прогона. Файл: `results.js`.

### 2026-04-19 15:26 CEST
- Для чего: устранить ложный `NO_SEND` у Grok, когда `Ctrl+Enter` не срабатывает в новой разметке. Изменение: добавлен дополнительный путь отправки `Enter`, а также fallback через `form.requestSubmit()` после неуспешных попыток кнопкой/клавиатурой. Файл: `content-scripts/content-grok.js`.
- Для чего: уменьшить задержку фактической отправки на Claude после ввода prompt. Изменение: фиксированная пауза перед send снижена с 2000ms до 350ms. Файл: `content-scripts/content-claude.js`.
- Для чего: убрать сценарий «красный статус + manual ping skipped» для недавно завершённых `EXTRACT_FAILED/NO_SEND/ERROR`. Изменение: manual ping теперь разрешён для recoverable terminal-статусов в пределах окна 180s; добавлен диагностический маркер `Manual ping override (recoverable terminal)`. Файл: `background/job-orchestrator.js`.
- Для чего: повысить шанс автоматического восстановления Grok ещё на этапе Round2. Изменение: Grok добавлен в `ROUND2_REPAIR_MODELS`, чтобы при `prompt not confirmed` выполнялся repair-dispatch. Файл: `background/job-orchestrator.js`.

### 2026-04-19 10:30 CEST
- Для чего: сократить длительное «красное окно» после `script_runtime_hard_stop`, когда ответ может прийти с задержкой. Изменение: добавлены модельно-зависимые defer-окна (`Gemini/Claude/Le Chat/Perplexity/Grok`) и расширен deferred-recovery не только для `GPT`; перед финальной hard-stop ошибкой добавлен дополнительный `final_ping_before_error`. Файл: `background/job-orchestrator.js`.
- Для чего: ускорить восстановление канала при `PING_TRANSPORT_ERROR` и `message port closed`. Изменение: `sendPassiveMessageWithRetries` поддерживает явный план задержек (`transportRetryDelays`), а оркестратор использует быстрый профиль ретраев для `getResponses` ping (включая hard-stop и manual ping). Файлы: `background/dispatch-coordinator.js`, `background/job-orchestrator.js`.
- Для чего: убрать повторяющийся flood `SELECTOR_STATS` и повысить сигнал/шум в диагностике. Изменение: в watcher добавлена дедупликация одинаковых selector-метрик в окне `selectorStatsDedupWindowMs` (по умолчанию 30s). Файл: `content-scripts/unified-answer-watcher.js`.
# 2.81.196

- Added a Perplexity per-tab single-flight gate so retry-supervisor commands
  cannot run two concurrent composer insertions for the same prompt.
- Switched current Perplexity submission to native click on the proven
  `#ask-input`-owned localized Send control; native Enter is now fallback only.
- Removed the redundant two-second delay after draft preparation. Le Chat is
  unchanged.

# 2.81.195

- Fixed the missing `debugger` manifest permission that made the restored donor
  Send/Enter routes unreachable in 2.81.194.
- Restricted debugger RPC execution to Le Chat/Perplexity submission only;
  historical trusted-input and CDP-attachment routes remain fail-closed.
- Native browser dispatch is now explicit submission evidence, avoiding both
  slow DOM fallback chains and the old composer-clearing false-positive.
- With New pages disabled, Le Chat and Perplexity reuse a persisted or newest
  matching provider tab before generic surface rejection can create a duplicate.

# 2.81.194

- Restored the proven 2.81.75 browser-level submission path for Le Chat and
  Perplexity: trusted provider Send for Le Chat, trusted Enter followed by
  trusted Send for Perplexity, with current proof-based confirmation retained.
- When New pages is disabled, only Le Chat and Perplexity get one direct retry
  against their persisted mapped conversation before a fresh tab is created.

# 2.81.192

- Routed concrete unified-pipeline streaming/finalization steps into canonical
  generation and completion proof instead of the legacy debug ring.

# 2.81.191

- Completed active dispatch identity enrichment, emitted explicit empty
  baselines, preserved render/commit outcomes, and deduplicated one-frame
  observation evidence references.

# 2.81.190

- Aligned runtime export auditing with offline S03 incident-scope and S04 event-
  layer validation.

# 2.81.189

- Added canonical source-materialization and extraction boundaries to the common
  response finalizer, closing the proof gap for direct provider response paths.

# 2.81.188

- `reportDispatchBaseline()` now waits for the background acknowledgement
  instead of returning immediately after queuing the runtime message; all nine
  adapters therefore establish baseline ordering before Send.

# 2.81.187

- Restored canonical typed facts for finalization and terminal telemetry,
  preserved delivery-proof identifiers, and propagated active dispatch epoch
  identity into baseline/final events.
- Prevented unscoped forensic companions from creating invalid cross-incident
  evidence links; forensic snapshots now use the canonical audit layer.

# 2.81.186

- false-success standalone reports preserve the exact incident-scoped runtime trace when evidence is incomplete, so generation/verification/commit gaps remain diagnosable.

# 2.81.185

- Validated lifecycle answers now emit an explicit accepted extraction boundary with the same incident and payload identity as source and delivery proof.
- All-presets policy metadata is derived from the runtime configuration event, and export audit separates diagnostic usability from structural schema validity.
- Secret redaction now distinguishes true recursion from repeated aliases, eliminating spurious `[CIRCULAR]` placeholders in telemetry reports.
- Added the source-correlated runtime recovery review and acceptance gates.

# 2.81.184

- Web dispatch now propagates one generation-scoped `attemptId` and `generationEpoch` through dispatch, page, baseline and submission proof events.
- All provider adapters wait for the pre-send baseline acknowledgement before Send, and a fast accepted submission can no longer regress to a later pending state.

# 2.81.183

- Proof telemetry now coalesces mutations accumulated during an active persistence transaction, preventing a high-rate event stream from creating a transaction-per-event backlog.
- JSON export no longer downloads the last committed boundary when the proof-ledger barrier times out. It returns a retryable incomplete-snapshot status and asks the user to export again after the queue drains.
# 2.81.223

- Добавлен машинно проверяемый реестр всех канонических событий proof-телеметрии: производители, идентичность, получатели, sampling, retention и потребители.
- Добавлена матрица диагностических возможностей для legacy/schema 6 и всех экспортных представлений.
- Dependency registry полного экспорта теперь содержит снимок event inventory и capability matrix.

# 2.81.224

- Добавлена общая воспроизводимая матрица из 13 обязательных сценариев телеметрии.
- Добавлен read-only анализатор размеров, повторов, event envelope, observer/lease потоков и покрытия legacy/native producers.
- Команда `npm run measure:telemetry -- <file.json>` измеряет пользовательский all-presets JSON без его изменения.

# 2.81.225

- Replay harness теперь явно различает legacy events, grouped legacy export, schema 6 events, all-presets и standalone report.
- Schema 6 адаптер читает `modelId`, `eventType` и `wallTs` и сверяет набор моделей с `ProofTelemetryPolicy.replay`.
- Смешанный и неизвестный вход завершается ошибкой `UNSUPPORTED_REPLAY_SCHEMA` вместо молчаливого пустого или неверного replay.

# 2.81.226

- Export audit теперь независимо фиксирует `snapshotCompleteness` и `runCompleteness`.
- `RUN_CONFIG_RECORDED` сохраняет ожидаемые модели, а audit перечисляет observed, terminal и pending models.
- Для каждой модели сохраняются состояния активного запуска, включая partial answer, tab closed during generation и SUCCESS с error done reason.
- Event inventory загружается в export worker и обе страницы результатов до построителя телеметрии.

# 2.81.227

- Добавлен семантический comparator embedded и standalone отчётов для каждой задачи, модели и инцидента.
- Embedded `seq` нормализуется обратно в канонический `eventId`; сравниваются verdict, sufficiency, slots, evidence, ограничения, нарушения, arbitration и sibling relations.
- Мутационные отрицательные тесты доказывают, что изменение verdict, slot, evidence, limitation или causal relation ломает parity gate.

# 2.81.228

- Все четырнадцать `stateAxes` теперь вычисляются вместе с точным `stateAxesProvenance`: слоем, фактическими basis-событиями, правилом и версией.
- Basis-ссылки входят в semantic/artifact hashes, материализуются в standalone отчёте и проверяются на существование и принадлежность тому же инциденту.

# 2.81.229

- Embedded и standalone отчёты теперь используют одно чистое ядро `buildIncidentReportSemantics` для applicability, verdict, slots, completeness, arbitration, siblings и provenance.
- Parity gate сравнивает обе экспортные формы ещё и с канонической проекцией ядра для каждой задачи, модели и инцидента.

# 2.81.230

- Добавлен контейнер `canonical-evidence`: полный canonical ledger, registry и компактный индекс всех incident axes/provenance без `reports` и полного `derivedViews`.
- Доверенный `readerGuidance` берётся только из версионированной константы; schema и offline validator проверяют allowlist, boundaries, basis refs, privacy и все section/artifact hashes.

# 2.81.231

- Добавлен офлайн CLI `build-proof-telemetry-report.js`: проверяет canonical/full input, перечисляет incidents и строит standalone либо full forensic тем же shared builder.
- Неоднозначный incident требует явного `--incident`; unknown generator требует явного `--reproduction=reinterpretation`, а выход хранит source и полный cache-key provenance.

# 2.81.232

- В обеих страницах результатов добавлен явный выбор `Digest` / `Canonical evidence` / `Full forensic`; default остаётся `Digest`, прежняя настройка toggle мигрируется.
- Canonical evidence и full forensic строятся/сериализуются в worker, а timeout по-прежнему гарантирует recovery JSON со всеми canonical events.

# 2.81.233

- Добавлены read-only proof-ledger проекции Timeline и Markdown с eventId, scope, layer и typed fact без сырых prompt/answer данных.
- Timeline сравнивается с legacy потоком в shadow-режиме; MD сохраняет прежние разделы и добавляет canonical proof appendix из той же snapshot boundary.

# 2.81.234

- Большой JSON-экспорт получил progress по стадиям, single-flight отмену, отдельные stage/overall deadlines, обязательное завершение worker и transient-метрики без записи в наблюдаемый ledger.
- Temporal slot matching переведён с повторного полного сканирования на индексированный поиск; full forensic для 10 000 событий в контрольном прогоне ускорен примерно с 32,4 с до 0,5 с.
- Добавлен воспроизводимый stress gate для 500/2 000/5 000/10 000 событий, трёх параллельных экспортов, malformed ledger, missing registry и 32 MiB memory pressure.

# 2.81.235

- Добавлен безопасный полевой валидатор сохранённых JSON/выжимок: он классифицирует исторический drift по версии, перестраивает current canonical/full, сверяет ledger hash и семантику всех задач/инцидентов.
- Все восемь доступных реальных JSON прошли gate: 16 валидных перестроенных артефактов, 826 из 826 эквивалентных семантических сравнений, ни одного необъяснённого расхождения.
- Зафиксировано назначение выжимки: быстрый triage без integrity/replay; для воспроизводимого диагноза требуется JSON либо canonical evidence.

# 2.81.236

- Export worker теперь применяет secret redaction к входному ledger до построения артефакта; hashes и measuredBytes относятся к фактически скачиваемому представлению.
- Добавлен регрессионный тест с реальным token-shaped значением: redacted canonical evidence остаётся полностью валидным.

# 2.81.237

- Offline report CLI теперь независимо сравнивает generator, report version и registry hash с текущим toolchain для canonical и all-presets inputs.
- Исторический all-presets больше не может быть помечен как exact reproduction; без явного `--reproduction=reinterpretation` CLI завершает работу с `REPRODUCTION_UNSUPPORTED`.

# 2.81.238

- Results pages и background теперь загружают proof telemetry policy до export builder, как это уже делал worker.
- Page-side task reports используют точный `stateAxesProvenance` с реальными basis event IDs вместо `legacy-fallback-*`; порядок закреплён browser-context тестом.

# 2.81.239

- Field validator принимает historical drift только по точной сигнатуре, структуре и ожидаемому числу migration findings; дополнительные либо частичные S22 теперь блокируют gate.
- Project version читается из manifest, а exact identity учитывает generator, report version и registry hash вместо hardcoded версии и одной проверки generator.

# 2.81.240

- Worker orchestration вынесена в общий исполняемый runtime, используемый production UI и поведенческими тестами.
- Реально проверяются single-flight cancel, stage/overall timeout, worker crash, synchronous postMessage failure, terminate, canonical recovery и Blob URL cleanup; прежние строковые проверки больше не являются единственным gate.

# 2.81.241

- Offline CLI больше не скрывает допустимые диагностические нарушения S06/S15: они записываются в source provenance итогового артефакта и печатаются в stderr.
- Артефакт перестраивается с limitations до окончательной проверки, поэтому добавленная диагностика входит в integrity hashes.

# 2.81.242

- Выводы `none`/`not_started`/tier 0 из полного отсутствия сигналов теперь имеют слой `audit`, а не необоснованный `inference`.
- Валидатор отклоняет `fact`, `inference` и `decision` provenance без basis event; версия derivation повышена до 1.1.0, generator — до 2.8.0.

# 2.81.243

- Исполняемый ledger-тест фиксирует инвариант экспортной границы: export builder не добавляет событий, persistence writes или queued mutations после ожидаемого snapshot.

# 2.81.244

- Контракт CLI различает exact, conditional legacy, explicit reinterpretation и unsupported outcome.
- `legacy-reproduction` больше не является нераспознанной строкой: без зарегистрированного исторического адаптера он fail-closed завершается кодом `REPRODUCTION_UNSUPPORTED`; текущая policy не выдаётся за legacy.

# 2.81.245

- Строгий field validator распознаёт миграцию пяти zero-basis inference из артефактов до 2.81.242 только по точной версии generator, derivation version, ruleId, пустому basis и вычисленному из структуры числу находок.
- Любое частичное совпадение, изменённое правило или неверное число S22 остаётся блокирующей необъяснённой ошибкой.

# 2.81.246

- Claude теперь фиксирует исходное состояние подтверждения строго до первой попытки отправки и использует его повторно во всех проверках. Быстрый новый ход, новый ответ или индикатор генерации больше не теряется из-за повторного снятия baseline после отправки.
- Ошибки транспорта вида `Error: Claude send not confirmed` передаются с пустым полем ответа и классифицируются как `technical_message`; они не материализуются, не отмечаются как завершённая экстракция и не учитываются как символы ответа.
- Добавлены регрессии на порядок снятия Claude baseline, его повторное использование и отсечение технических сообщений.

# 2.81.247

- Неполученное прямое подтверждение Send у Claude больше не прерывает выполнение до запуска pipeline и DOM-экстракции. Адаптер продолжает ждать новый ответ относительно сохранённого до отправки assistant-якоря.
- Если новый непустой, не-echo и не-baseline ответ найден, он подтверждает текущую отправку доказательством `fresh_answer_after_pre_send_anchor`; `PROMPT_SUBMITTED` публикуется перед `LLM_RESPONSE`, поэтому настоящий ответ не блокируется терминальным `NO_SEND`.
- Если отправки действительно не было, прежний ответ не принимается: позиционный якорь, prompt-echo и baseline-проверки остаются обязательными, а пустое ожидание заканчивается обычной ошибкой экстракции.

# 2.81.248

- Восстановление после неподтверждённой отправки перенесено на общий уровень оркестратора и больше не зависит от списка известных моделей. Любой текущий или будущий адаптер, использующий общий `handleLLMResponse`, получает одинаковое окно наблюдения до терминального `NO_SEND`.
- Общий контур выполняет до шести проверок свежего ответа в течение 165 секунд. Единственный управляемый визит и все DOM-чтения ограничены единым бюджетом; при появлении ответа цикл немедленно прекращается.
- Автоматически принимается только ответ с доказательством текущего хода: lifecycle-сигналом или позиционным DOM-якорем. Нулевой baseline теперь тоже является полноценным якорем — первый появившийся assistant-ответ можно доказать как новый.
- `anchorApplied` больше не теряется между inline-экстрактором и решением оркестратора. Технические строки `Error: <любой новый провайдер> send not confirmed` отсекаются без перечня имён моделей.
- Ошибки вложений не входят в этот recovery: отсутствие подтверждённой загрузки файла остаётся отдельной fail-closed ошибкой.

# 2.81.249

- Общий распознаватель текущего хода теперь пропускает DOM-кандидаты, которые классификатор определил как служебный интерфейс, prompt echo или техническое сообщение, и продолжает поиск содержательного ответа в том же новом ходе.
- Профиль Z.AI распознаёт актуальный `message-…-start` без обязательных старых CSS-классов, но явно исключает пользовательские сообщения. Локальный DOM fallback применяет ту же классификацию, что и общий pipeline.
- Добавлены регрессии для случая из прогона `1785761736255`: настоящий ответ расположен перед 24-символьной подсказкой интерфейса `Refer to the following content`; подсказка больше не заменяет ответ.

# 2.81.250

- Внутренние ошибки больше не передаются и не сохраняются как текст ответа. Все девять адаптеров, фоновые таймауты, ошибки вкладок, отправки, извлечения и оценщика используют структурный канал `error.type`/`error.message`, оставляя `answer` пустым.
- Центральная финализация больше не синтезирует строки `Error: …` для пустого ответа, UI scaffolding, prompt echo и исчерпанного восстановления. Старые сообщения распознаются единым реестром технических форматов; явно помеченная внутренняя ошибка от будущего адаптера отсекается независимо от её текста.
- Добавлен исполняемый контракт, запрещающий адаптерам сериализовать `Error:` или `Structural Error:` в `answer`, и регрессия для Z.AI: ошибка `Extracted text is prompt/UI scaffolding, not an answer` даёт `EXTRACT_FAILED` с нулевой длиной ответа.
# 2.81.331 — Completion Protocol core

- Добавлен `shared/completion-protocol.js`: append-only Evidence Ledger, deterministic CompletionPolicy, Producer Gate с hysteresis, unified veto facts, semantic MutationClassifier, независимые timeout-классы, Materialization/Hydration Gate, RecoveryReconciler и immutable ExtractionSnapshot.
- `SUCCESS_TERMINAL` определяется только полной конъюнкцией generation/producer/content/ownership/no-veto; score и отдельные UI-сигналы не участвуют в predicate.
- Protocol загружается до lifecycle detector в content-script entry points и bundled runtime; добавлена unit truth-table и component regression suite.
# 2.81.332 — Single Completion Authority

- `ResponseLifecycleDetector` tracker преобразован в canonical `CompletionSession`: generation, ownership, producer hysteresis, veto, structural/content verification, materialization и timeout facts сходятся в единственном `TerminalResult`.
- `UnifiedAnswerCompletionWatcher` переведён в witness-only режим. Copy, Regenerate, completion marker, DOM stability и diagnostic score больше не публикуют success; watcher принимает только решение lifecycle authority.
- Streaming требует `SUCCESS_TERMINAL`: удачный scroll больше не компенсирует failed completion. Finalization использует immutable extraction snapshot и не перечитывает live DOM после terminal verification.
- Background принимает `LLM_RESPONSE_READY` только с typed `SUCCESS_TERMINAL`; добавлены capability health, recovery reconciliation, fact-level/shadow telemetry и mapping в статусы `FinalizationController`.
- Обновлены regression contracts старых heuristic tests; добавлены проверки truth-table, hydration reset, immutable extraction и streaming OR-gate.
# 2.81.340 — Completion protocol E2E matrix

- Добавлена последовательностная regression matrix для всех failure classes из Completion Architecture Refactor, включая early controls, stalled partial, hydration/structure delay, replacement, Continue/error/navigation и extraction race.

# 2.81.339 — Completion recovery and resource lifecycle

- RecoveryReconciler корректно читает сериализованный `CompletionSession.snapshot()` и сверяет immutable context/response identity перед resume.
- После non-success terminal или закрытия post-terminal audit освобождаются observers, timers, waiters и DOM references; detector получил version-aware `dispose()` для безопасного runtime upgrade.

# 2.81.338 — End-to-end terminal authority gate

- Lifecycle регистрирует completion attempt и typed terminal result в background; `LLM_RESPONSE`, `FINAL_LLM_RESPONSE` и `LLM_RESPONSE_READY` теперь используют одну authority boundary.
- Provider-specific fallback watcher больше не может опубликовать SUCCESS в `enforced` без `SUCCESS_TERMINAL`; `shadow/legacy` остаются явным migration exception.
- Typed non-success terminal немедленно маппится в существующую finalization taxonomy, включая `CONTINUE_REQUIRED → USER_ACTION_REQUIRED`.

# 2.81.337 — Functional Completion rollout

- `legacy`, `shadow`, `enforced` теперь реально меняют delivery policy; migration default переведён в `shadow` до завершения provider smoke matrix.
- Переходный legacy adapter отделён от watcher authority и принимает только fresh + stable + corroborated candidate без veto; weighted score не может дать delivery.

# 2.81.336 — Semantic mutation and producer timeout fixes

- Оба observer path теперь передают MutationClassifier text и structural hashes; изменения DOM-структуры при неизменном тексте больше не считаются cosmetic.
- Producer-Stuck timeout остаётся активным после `CONTENT_PROGRESS`, а повторный terminal witness может заново открыть hysteresis после отзыва candidate.
- Изменение при materialization явно сбрасывает content stability telemetry.

# 2.81.335 — Canonical Completion telemetry

- Все события Completion Protocol из ТЗ зарегистрированы как canonical schema-6 events и больше не отбрасываются в debug-route при экспорте.
- Критические границы attempt/generation/ownership/producer/content/timeout/terminal/extraction закреплены в диагностических буферах и имеют inventory metadata.

# 2.81.334 — Completion fact transitions

- `CompletionSession` теперь публикует все изменения deterministic facts через пассивный transition callback: witness, generation, producer hysteresis, ownership, veto, content, timeout, terminal и immutable extraction snapshot.
- Completion Protocol и lifecycle detector получили явные runtime-версии `2.1.0`; повторный bootstrap переиспользует только точно совпадающую версию протокола.

# 2.81.333 — Idempotent Completion Protocol bootstrap

- Повторная инъекция shared/provider manifest-блоками теперь переиспользует уже созданный `CompletionProtocol`, не заменяя глобальный API во время активной lifecycle session.

# 2.81.341 — Canonical shadow and capability evidence

- Shadow comparison теперь сохраняется как canonical audit-событие, а переходы critical capability health — как `OBSERVER_HEALTH_OBSERVED` с дедупликацией неизменившихся состояний.
- `PRODUCER_TERMINAL` больше не приравнивается к provider finish reason Tier 4; составной V2 `SUCCESS_TERMINAL` формирует Tier 3 и корректные completion axes.
- Повторная идентичная ownership-проверка больше не создаёт телеметрический шум.
### 2026-09-05 — Reduce worker storage pressure, version 2.81.366

- Diagnostics events share a batch read/expand/compress/write while retaining ordered mutations and clear operations. A 200-event burst now uses one storage write.
- Job-state writes coalesce synchronous bursts and serialize later snapshots. Message handlers no longer start full-state compression before returning an ACK; dispatch-intent awaiters still wait for persistence.
- Tests cover concurrent appends, clear ordering, write failures, updates during writes, and durable command-intent waiting.

### 2026-09-05 — Restore first and short answer completion, version 2.81.365

- Empty chat containers no longer count as a previous assistant response and hide the first generated answer.
- Completion observes the same current turn as structural verification. Nonempty short responses retain their text, HTML and proof instead of being replaced by a broad DOM scrape.
- A short response can pass materialization and finalization when exact current dispatch identity, confirmed submission, complete structure and inactive generation are verified. Unverified scrape thresholds remain enforced.
- Lifecycle delivery now forwards the HTML captured with the completed text.

### 2026-09-05 — Make controlled composer replacement framework-safe, version 2.81.364

- Re-resolve live composer nodes during prompt preparation and avoid DOM-clearing that can restore stale framework state.
- Respect editor-owned `beforeinput` handling and prevent duplicate native insertion/fallback paths.
- Verify the replacement composer before accepting prompt preparation, including Kimi and Perplexity flows.
