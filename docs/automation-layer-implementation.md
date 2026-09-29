# Automation Layer — implementation / field-test guide

## Repository and branch

Repository: `AlGold777/MyOrchestrator`

Implementation branch: `automation-gpt`

The implementation branch is isolated for the GPT architecture experiment and contains only this implementation's changes on top of the project baseline.

Important repository observation made during implementation: `automation.html` was not present in `main` or the other existing working branches. The implementation therefore created `automation.html` using the established UI contract from `popup.html`:

- prompt: `#prompt`
- send button: `#send-button`
- model selection: `input[name="llm"]`

If another physical working copy contains an older `automation.html`, preserve its existing controls and port the controller bindings to its actual selectors instead of duplicating the controls.

## Architecture

The implementation uses an event-driven controller above the existing MyOrchestrator runtime.

It does not introduce:

- a second DOM scraper;
- provider-specific automation in `automation.js`;
- model API calls;
- a second transport-correlation protocol;
- a second completion detector.

It does introduce one compact semantic response contract, `AL-STRUCT-1`, which is validated after the existing Web runtime has accepted the provider response.

The existing MyOrchestrator background/content-script stack remains responsible for:

- provider tabs;
- prompt insertion/send;
- provider-specific DOM behavior;
- stale-answer protection;
- completion authority;
- extraction;
- internal dispatch/recovery;
- terminal model status.

The new controller is responsible for:

- the two-stage business flow;
- automation run correlation;
- stage correlation;
- storing accepted stage outputs;
- chronological feed;
- deterministic Round 1 fan-in;
- Round 2 prompt construction;
- checkpoint/reload recovery;
- final artifact export.

## Files

- `automation.html` — automation page using the established prompt/send/model-selection controls.
- `automation.css` — feed/status/diagnostics presentation.
- `automation.js` — browser-side controller.
- `automation/automation-core.js` — pure correlation/fan-in/artifact helpers.
- `tests/automation-layer-core.test.js` — contract tests.
- `docs/automation-layer-implementation.md` — this guide.
- `docs/automation-layer-structural-elements-report.md` — architecture-element report.

## Real runtime integration

Round dispatch uses the existing background message:

```js
chrome.runtime.sendMessage({
  type: 'START_FULLPAGE_PROCESS',
  prompt,
  selectedLLMs: ['GPT', 'Claude'],
  forceNewTabs: true,
  useApiFallback: false,
  sourceView: 'automation',
  pipelineContext: {
    sourceView: 'automation',
    automationRunId,
    automationRound
  }
})
```

The page listens to `chrome.storage.local.jobState` changes.

A result is consumed only when it belongs to the current automation stage.

For live in-memory state the controller can use `pipelineContext`. For persisted/compacted state it uses the stage-scoped persisted identifier:

```text
jobState.session.pipelineRunId == <automationRunId>:R<round>
```

The dispatch sets that value through `pipelineContext.pipelineRunId`, and the existing MyOrchestrator compactor preserves `session.pipelineRunId` across storage/reload.

The controller then uses the existing terminal facts:

- `entry.finalStatusRecorded`
- `entry.finalStatus`
- `entry.finalizedAt`
- `entry.answer`

Only terminal `SUCCESS` with a non-empty accepted answer advances the business flow.

## Transport correlation vs structural response contract

Transport correlation remains runtime-owned: the existing MyOrchestrator runtime provides dispatch/session identity, stale-answer guards, completion authority, extraction and finalization.

Separately, model outputs must satisfy the compact semantic contract `AL-STRUCT-1`. This contract structures the content and provenance of the answer; it is not used as the Web transport correlation mechanism.

The controller therefore keeps transport identity outside the model response while still machine-validating the semantic structure before accepting an answer.

## Round 1

The user:

1. enters the request in `#prompt`;
2. selects exactly two existing `input[name="llm"]` controls;
3. presses `#send-button`.

The controller starts one existing MyOrchestrator batch with:

- the original prompt;
- the two canonical model names;
- fresh tabs;
- API fallback disabled.

Accepted model results are added to the feed immediately, ordered by `finalizedAt`.

## Fan-in

The machine input for Round 2 is built in selected-model order, not completion order.

Example:

```text
===== SOURCE 1: GPT =====
...
===== END SOURCE 1: GPT =====

===== SOURCE 2: Claude =====
...
===== END SOURCE 2: Claude =====
```

This makes the next prompt reproducible even if Claude completed first.

## Round 2

Round 2 starts automatically after both Round 1 answers are accepted.

The prompt contains:

- the original request;
- the two labelled source answers;
- the fixed synthesis task.

The source blocks are explicitly described as data, not instructions.

Round 2 runs through another fresh MyOrchestrator batch with API fallback disabled.

## Observable workspace

The page has three parallel lanes: model A, Moderator, model B.

The Moderator lane preserves the user's original request after Send and groups accepted model results under a single `Round 1` and `Round 2` heading.

Each model lane preserves the exact prompt dispatched for that round, followed by the accepted readable answer and a compact structural projection.

The lower request box in each model lane is transient and clears after dispatch. The lower Moderator composer clears after Send.

Diagnostics stay in the collapsed `Runtime / Diagnostics` area and never replace the human-readable execution history.

## Failure model

The Automation Controller does not implement a competing retry loop.

The existing MyOrchestrator runtime already owns provider dispatch/recovery. The controller waits for its final result.

If one model reaches terminal non-success after that existing recovery process, the automation run becomes `ERROR`. It never treats one successful model as overall success.

Already accepted answers remain in the feed and stored state.

## Persistence and reload recovery

Controller state is checkpointed in:

`chrome.storage.local['automationLayerWebRuntimeTest.v5']`

On page reload:

1. the feed and controller phase are reconstructed;
2. the controller inspects persisted `jobState`;
3. if it belongs to the same automation run and round, monitoring resumes;
4. terminal event keys prevent duplicate feed messages;
5. if a dispatch intent was persisted but no matching run exists, the controller performs one recovery dispatch;
6. if a supposedly running state cannot be reconciled, the controller fails closed instead of guessing.

## Artifacts

On successful Round 2 completion the page automatically downloads:

- `automation-<run-id>-result.txt`
- `automation-<run-id>-audit.json`

The TXT contains the user request and both rounds.

The audit JSON contains the controller state, feed and journal.

Manual re-download buttons remain available.

## Local automated verification

Run:

```bash
npm test -- --runInBand tests/automation-layer-core.test.js
```

The tests cover:

- model-name normalization from existing UI values;
- Round 1 structural-contract injection with `schema_example`;
- exact IDEA/object refs and snapshot identity;
- valid `AL-STRUCT-1` acceptance;
- rejection of missing/mismatched input/provenance coverage;
- model-created canonical ID rejection and temp-ID allowance;
- explicit `EMPTY_BY_DESIGN`;
- Round 2 `prior_output` construction and provenance;
- persisted stage correlation;
- acceptance chronology from `finalizedAt`.

## Required real Chrome field test

Load the branch as an unpacked extension, authenticate the chosen provider web UIs and open:

```text
chrome-extension://<extension-id>/automation.html
```

Verify:

1. exactly two models are selected;
2. the original request is sent through real Web UI;
3. answers appear in the feed in acceptance chronology;
4. no API fallback occurs;
5. Round 2 starts without user action;
6. Round 2 receives both Round 1 answers;
7. both final answers appear in the same feed;
8. result TXT and audit JSON download automatically;
9. reload during a round restores the controller;
10. a provider terminal failure produces `ERROR`, not false `COMPLETED`.

The current execution environment used to produce this branch cannot authenticate into the user's local Chrome provider sessions, so the real provider run remains the required final field test.


## Structured response contract v1.2

Each model response is now required to satisfy the compact `AL-STRUCT-1` contract:

```text
passport
outputs
annotations
trace
input_fate
changes
completion
```

The controller validates the contract before accepting an answer. Plain unstructured prose is rejected as `STRUCTURE_INVALID`.

All semantic marker types are represented through the single `annotations` array rather than separate empty sections.

Runtime-owned identity/integrity fields (`run_id`, model, round, prompt hash, payload hash) are added by the controller and shown with the parsed structure.

The main feed still shows the readable answer normally; full structure is available in a collapsed `Structure` disclosure.

## Finalization supervisor

The field test showed that a provider can visibly finish while the existing runtime has not yet materialized a terminal `jobState`.

The controller therefore performs one bounded supervisory recovery after 60 seconds of missing terminal progress:

```text
GET_IT_BATCH(pending models)
```

This reuses the existing MyOrchestrator extraction/recovery path. It does not add a second scraper or resend the model prompt.

If pending models still have no accepted answer 60 seconds after that recovery pass, the automation run fails closed with `Finalization stalled after recovery`.


## Final prototype-derived interaction rules

The final Automation page follows the runtime instead of explaining it.

- Three equal work lanes: selected model A, Moderator, selected model B.
- In every lane, output/history is above and the request composer is below.
- The Moderator's original request exists in the composer only before Send. After Send it is cleared and preserved in the Moderator history.
- Model request composers are transient: the exact dispatched prompt appears while dispatching and clears after send.
- Each model history preserves the exact sent prompt and the accepted response.
- Round headings are emitted once per round, not repeated before every message.
- Round 2 visibly preserves the consolidated prompt built from both structured Round 1 outputs.
- Human-readable answer content is primary; structural metadata is compact and subordinate.
- Diagnostics are separate from the reading flow.
- The page is light, minimal and designed to fit a normal MacBook Chrome viewport with internal lane scrolling.

These are observability requirements, not decoration: a user must be able to infer what the orchestrator did from the page without reading implementation documentation.

## Final structural additions

The final contract adds the following requirements beyond the prototype-visible metadata:

- machine-owned input snapshot identity;
- machine-owned IDEA/object references with exact IDs and versions;
- support for existing decision/object refs through `passport.input_refs`;
- response-local `temp_id` only for newly proposed domain objects;
- explicit `CONSUMED = processed, not resolved` semantics;
- mandatory instruction + generated valid JSON example on every dispatch;
- closed vocabularies;
- explicit `prior_output` role wrappers in Round 2;
- provenance-only `trace`, never reasoning trace;
- fail-closed validation of refs, fates, completion counts and canonical-ID ownership.

## Final controller state

Persistent key:

`chrome.storage.local['automationLayerWebRuntimeTest.v5']`

The state includes the machine-owned `ideaRef`, exact sent prompts for both rounds, structured answers, runtime integrity metadata, feed and journal.


## Automation Layer v2.2

Current product version: **2.2**. Core: `1.4.0`. Persistent controller state: `automationLayerWebRuntimeTest.v5`.

The additive v2.2 implementation details are documented in `docs/automation-layer-v2.2.md`. Existing behavior not explicitly changed there remains preserved.
