# Automation Layer — Final

Branch: `automation-gpt`  
Semantic contract: `AL-STRUCT-1`  
Controller/Core: `1.4.0`

## Purpose

Run a two-round multi-model workflow through existing MyOrchestrator Web UI adapters without model APIs, while preserving exact inputs, machine-owned identity, structured provenance, recovery and observable execution.

## Runtime ownership

Existing MyOrchestrator owns:

- provider tabs and fresh conversations;
- DOM prompt insertion and send;
- provider-specific selectors;
- stale-response protection;
- completion/extraction;
- terminal provider state;
- provider recovery.

Automation Controller owns:

- two-model/two-round flow;
- semantic prompt packaging;
- stage/snapshot correlation;
- structured response validation;
- Round 1 fan-in;
- Round 2 synthesis dispatch;
- persistent controller state;
- user-visible execution history;
- export.

No second scraper, provider adapter or completion detector is introduced.

## Flow

1. User enters one request and selects exactly two models.
2. Controller allocates run ID, IDEA ref and Round 1 input snapshot.
3. Round 1 dispatches the same task independently to both models.
4. Each accepted response must pass `AL-STRUCT-1`.
5. Controller wraps both accepted responses as `role:"prior_output"`.
6. Round 2 receives original IDEA + both Round 1 structured results + synthesis task under a new input snapshot.
7. Both Round 2 responses must pass the same contract.
8. Result and audit artifacts are exported.

## AL-STRUCT-1

Every accepted model response is one JSON object:

```text
passport
outputs
annotations
trace
input_fate
changes
completion
```

### passport

Contains:

- contract identity;
- stage;
- machine-owned `input_snapshot_id`;
- exact `input_refs[] = {id,type,version}`.

Existing IDEA/PD/REQ/etc IDs are copied exactly. The model never invents canonical IDs.

### outputs

Response-local output objects:

- `id`
- `type`
- `version`
- `content`

### annotations

Closed semantic vocabulary only.

### trace

Provenance only: output → exact source IDs. It is not reasoning trace.

### input_fate

Exactly one disposition per accountable input.

`CONSUMED` means **processed only**. It never means resolved, verified, accepted or closed.

### changes

Mutation proposals.

New domain objects use response-local `temp_id`; canonical IDs remain orchestrator-owned.

### completion

Must agree with actual outputs and supports explicit valid empty result through:

```json
{"status":"COMPLETE","output_ids":[],"output_count":0,"empty_by_design":true,"anomalies":[]}
```

## Prompt discipline

Every dispatch includes:

1. compact normative contract instruction;
2. closed enums and ID rules;
3. explicit CONSUMED semantics;
4. a concrete valid JSON example wrapped as `role:"schema_example"`.

Round 2 previous responses are separately wrapped as `role:"prior_output"`.

The two roles cannot be confused.

## Validation

The controller rejects:

- invalid JSON;
- missing blocks;
- wrong contract/stage/snapshot;
- missing or changed input refs;
- unknown provenance sources;
- missing input fate;
- invalid enums;
- inconsistent output counts;
- invalid empty results;
- model-created canonical IDs;
- invalid mutation targets.

Rejected structure never advances the workflow.

## Observability

The page is a light, minimal, three-lane workspace:

```text
Model A | Moderator | Model B
```

Each lane has:

- history/output above;
- request composer below.

Behavior:

- Moderator input clears after Send and the request appears in history.
- Model request boxes are transient and clear after dispatch.
- Exact sent prompts remain visible in model histories.
- Round headings appear once per round.
- Round 2 visibly contains the consolidated input built from both Round 1 outputs.
- Answer content is primary; structural metadata is a compact secondary projection.
- Diagnostics are separate.
- The normal MacBook Chrome view uses one viewport with internal lane scrolling.

## Recovery

If provider UI visibly completes but terminal state is not materialized, controller performs one bounded recovery through existing `GET_IT_BATCH` for pending models.

No second scraper or resend loop is introduced.

Failure after bounded recovery is explicit and fail-closed.

## Persistence

Controller key:

`automationLayerWebRuntimeTest.v5`

Persisted state includes:

- run ID;
- IDEA ref;
- snapshot IDs;
- exact sent prompts;
- structured accepted outputs;
- runtime prompt/payload hashes;
- feed;
- journal;
- export state.

## Final invariants

- Real Web UI only.
- Exactly two models for this test flow.
- Fresh execution context per round/model run.
- Model output is proposal/data, never runtime truth.
- Canonical IDs, snapshots, hashes and completion authority are machine-owned.
- Structure is mandatory and validated.
- UI reflects actual runtime events instead of explaining hidden internals.
- One model failure cannot produce false overall success.


## Automation Layer v2.2

Current product version: **2.2**. Core: `1.4.0`. Persistent controller state: `automationLayerWebRuntimeTest.v5`.

The additive v2.2 context/payload-control specification is documented in `docs/automation-layer-v2.2.md`. Existing behavior not explicitly changed there remains part of the system.
