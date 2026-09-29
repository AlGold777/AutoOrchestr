# Automation Layer — implementation / field-test guide

## Repository and branch

Repository: `AlGold777/MyOrchestrator`

Implementation branch: `codex/automation-layer-independent-v1`

The branch is based directly on `main`.

Important repository observation made during implementation: `automation.html` was not present in `main` or the other existing working branches. The implementation therefore created `automation.html` using the established UI contract from `popup.html`:

- prompt: `#prompt`
- send button: `#send-button`
- model selection: `input[name="llm"]`

If another physical working copy contains an older `automation.html`, preserve its existing controls and port the controller bindings to its actual selectors instead of duplicating the controls.

## Architecture

The implementation uses an event-driven controller above the existing MyOrchestrator runtime. It does not introduce a second DOM scraper, provider-specific automation, model APIs, a custom model response envelope, or a second completion detector.

Existing MyOrchestrator remains responsible for provider tabs, prompt insertion/send, provider-specific DOM behavior, stale-answer protection, completion authority, extraction, internal dispatch/recovery, and terminal model status.

The new controller owns only the two-stage business flow, stage correlation, accepted outputs, chronological feed, deterministic fan-in, Round 2 prompt construction, checkpoint/reload recovery, and exports.

## Files

- `automation.html`
- `automation.css`
- `automation.js`
- `automation/automation-core.js`
- `tests/automation-layer-core.test.js`
- `docs/automation-layer-implementation.md`
- `docs/automation-layer-structural-elements-report.md`

## Real runtime integration

Dispatch uses existing `START_FULLPAGE_PROCESS` with `forceNewTabs: true`, `useApiFallback: false`, `sourceView: "automation"`, and a stage-scoped `pipelineRunId`.

For live in-memory state the controller can use `pipelineContext`. For persisted/compacted state it uses:

`jobState.session.pipelineRunId == <automationRunId>:R<round>`

The existing MyOrchestrator compactor preserves `session.pipelineRunId`, `finalStatusRecorded`, `finalStatus`, `finalizedAt`, and full `answer` content. The page loads the existing `CompressedStorage` decoder because persisted `jobState` may be LZ-compressed.

Only terminal `SUCCESS` with a non-empty accepted `answer` advances the automation flow.

## Round 1

The user enters the request in `#prompt`, selects exactly two existing `input[name="llm"]` controls, and presses `#send-button`. The controller starts one existing MyOrchestrator batch with fresh tabs and API fallback disabled. Accepted model results are added to the feed immediately, ordered by `finalizedAt`.

## Fan-in

Round 1 answers are combined in selected-model order, not completion order, using labelled SOURCE boundaries. This is deterministic code, not a third LLM call.

## Round 2

Round 2 starts automatically. The prompt contains the original request, both labelled Round 1 answers, and the fixed synthesis task. SOURCE blocks are explicitly described as data, not instructions. Round 2 uses another fresh Web batch.

## Failure model

The Automation Controller does not resend model prompts and does not implement provider extraction. It supervises terminal progress and, after a bounded idle interval, invokes the existing `GET_IT_BATCH` recovery primitive for pending models only. It permits up to two recovery passes per round. Existing MyOrchestrator remains the owner of provider dispatch, extraction, stale-answer protection and finalization. A terminal non-success ends the run as `ERROR`; if pending answers still have no terminal state after both recovery passes, the run ends as `FINALIZATION_STALLED`. One successful model is never treated as overall success.

The feed and diagnostic journal record `ANSWER_PENDING_FINALIZATION`, `RECOVERY_STARTED`, the `GET_IT_BATCH` model list, `RECOVERY_ACCEPTED`, and `FINALIZATION_STALLED` as applicable.

## Persistence and recovery

Controller state is stored in `chrome.storage.local['automationLayer.v1']`. On reload the feed, phase, bounded recovery attempt count and recovery timestamps are reconstructed, compacted `jobState` is decoded through existing `CompressedStorage`, stage correlation is recovered through persisted `pipelineRunId`, and terminal keys prevent duplicate messages. Ambiguous state fails closed.

## Artifacts

On success the page automatically downloads:

- `automation-<run-id>-result.txt`
- `automation-<run-id>-audit.json`

Manual re-download buttons remain available.

## Automated verification

Run:

`npm test -- --runInBand tests/automation-layer-core.test.js`

The core tests cover model-name normalization, deterministic fan-in, Round 2 prompt construction, live and persisted correlation, acceptance chronology, duplicate suppression, and result composition.

Local checks performed while building this bundle:

- `automation.js` JavaScript syntax: PASS
- `automation/automation-core.js` JavaScript syntax: PASS
- pure Node assertions for normalization, persisted correlation, chronology, fan-in and Round 2 prompt: PASS

## Required real Chrome field test

Load the branch as an unpacked extension, authenticate the chosen providers, and open:

`chrome-extension://<extension-id>/automation.html`

Verify real Web dispatch, chronological answers, automatic Round 2, exports, reload recovery, and terminal failure behavior. The current execution environment cannot authenticate into the user's local provider sessions, so this remains the final field test.
