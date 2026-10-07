# PRE-DISPUTE BASELINE

## Status

**Epic:** PD-01 — Baseline Freeze  
**Baseline version:** 2.81.444  
**Baseline commit:** `1fee9d2fc72fefcde4ba6fe33da9abc826672f7a`  
**Baseline date:** 2026-09-17  
**Repository:** `AlGold777/MyOrchestrator`  
**Remote modifications made by audit:** none

### PD-01 status

| Task | Status |
|---|---|
| PD-01.1 Repository baseline | DONE |
| PD-01.2 Baseline scenario evidence | DONE (static/test evidence); browser smoke pending |
| PD-01.3 Freeze boundary | DONE |
| PD-01.4 Formal baseline exit gate | REVIEW / MANUAL_REQUIRED |

PD-01 is **not formally closed** until the live extension smoke matrix is executed against this exact baseline.

---

## Evidence levels

- **STATIC_VERIFIED** — implementation path is present in the baseline source.
- **STATIC_TEST_COVERAGE** — repository contains an explicit test for the behavior, but that test was not executed by this audit and there is no CI result attached to the baseline commit.
- **MANUAL_REQUIRED** — a live Chrome/provider run is required to prove end-to-end behavior.
- **KNOWN_LIMITATION** — explicitly documented by the baseline source/changelog.
- **UNKNOWN** — insufficient evidence; no assumption is made.

The baseline commit currently has no GitHub status checks/workflow run evidence available to this audit. Therefore repository tests are not reported as executed.

---

## Frozen boundary

During Pre-Dispute the following subsystems are **read/trace/analyze only**:

1. `background/job-orchestrator*`
2. `content-scripts/*`
3. provider-specific adapters
4. DOM extraction and completion detection
5. existing main parallel pipeline
6. `START_FULLPAGE_PROCESS` transport implementation behind the Dispute transport port

Allowed:
- source inspection;
- dependency tracing;
- runtime-path reconstruction;
- test inspection;
- documentation of existing defects/limitations.

Forbidden during Pre-Dispute:
- behavioral refactor;
- transport replacement;
- DOM extraction redesign;
- provider adapter changes;
- cleanup that can change the main parallel pipeline.

---

## Baseline scenario evidence matrix

| # | Scenario | Current static evidence | Test evidence | Live browser/provider proof | Baseline classification |
|---:|---|---|---|---|---|
| 1 | Single model dispatch | `DebateStageExecutor` supports `single` and validates participant count | `tests/debate-stage-executor.test.js` exercises single-participant retry/failure/cancel paths and rejects ambiguous multi-participant single stages | Required | STATIC_TEST_COVERAGE + MANUAL_REQUIRED |
| 2 | Parallel dispatch | Native batch dispatch exists for parallel LLM participants | Explicit parallel/all, partial failure, quorum and native batch tests | Required | STATIC_TEST_COVERAGE + MANUAL_REQUIRED |
| 3 | Selective dispatch | Stage participant list is explicit; planned stages can target a selected participant subset | `tests/debate-orchestrator.test.js` contains a planned synthesis stage assigned only to `beta`; transcript model also stores explicit `targets` | Required, especially UI → transport targeting | STATIC_TEST_COVERAGE + MANUAL_REQUIRED |
| 4 | Sequential dispatch | `StageExecutor` exposes `sequential` dispatch mode | Explicit order-preservation and `first_success` sequential tests | Required | STATIC_TEST_COVERAGE + MANUAL_REQUIRED |
| 5 | One model/participant failure | Partial completion and canonical terminal failures are represented | Explicit partial batch, terminal `TIMEOUT`/`NO_SEND`, retry exhaustion tests | Required against real providers | STATIC_TEST_COVERAGE + MANUAL_REQUIRED |
| 6 | Pause / resume | Universal orchestrator owns pause/continue lifecycle | Tests cover `QUIESCING → PAUSED`, snapshot, lease release, reconcile and resume; application bridge also covers pause/resume | Required | STATIC_TEST_COVERAGE + MANUAL_REQUIRED |
| 7 | Cancel | Application delegates cancellation to universal orchestrator and projects cancelled aggregate | Explicit application lifecycle test checks orchestrator `CANCELLED` and UI aggregate `cancelled` | Required | STATIC_TEST_COVERAGE + MANUAL_REQUIRED |
| 8 | Synthesis / final response | Planned synthesis stages and explicit finalization are supported | Orchestrator tests cover planned synthesis and idempotent `finalizeRun`; application tests cover automatic final aggregate projection | Required | STATIC_TEST_COVERAGE + MANUAL_REQUIRED |
| 9 | Reload / recovery | Orchestrator persistence supports snapshot/replay recovery; application has recovery bridge | Tests cover reload simulation, restore paused state, resume after recovery, and missing recovery state | Required in MV3/browser environment | STATIC_TEST_COVERAGE + MANUAL_REQUIRED |
| 10 | Continue existing session | Transcript utility persists/restores sessions; recovered orchestrator can continue a paused run | `tests/debate-engine.test.js` covers persist/load/replay; orchestrator/application tests cover recovered run continuation | Required for integrated UI/session flow | STATIC_TEST_COVERAGE + MANUAL_REQUIRED |

---

## Current known baseline limitations

### Main transport/recovery limitation documented in v2.81.444

The 2.81.444 changelog states that the new automatic bottom-and-collect pass:

- reuses the existing `Get it` recovery semantics;
- does **not** make a successful recovery independent proof of provider completion;
- is not automatically resumed after a service-worker restart if interrupted;
- relies on manual `Get it` as the recovery path for that interruption.

This is an **existing baseline limitation**, not a regression attributable to Pre-Dispute.

### Live-provider status

No statement is made here that every provider currently passes the 10 end-to-end scenarios. The repository contains substantial automated test coverage, but this audit has not executed the extension against real ChatGPT/Claude/Gemini/etc. sessions.

---

## Mandatory live smoke matrix before PD-01 formal completion

Run the exact baseline `1fee9d2fc72fefcde4ba6fe33da9abc826672f7a` in Chrome and record PASS/FAIL plus run/session IDs for:

- [ ] S1 — single model
- [ ] S2 — parallel models
- [ ] S3 — selective targets
- [ ] S4 — sequential targets
- [ ] S5 — one participant failure / partial result
- [ ] S6 — pause → resume
- [ ] S7 — cancel
- [ ] S8 — synthesis/finalization
- [ ] S9 — page/extension reload → recovery
- [ ] S10 — continue existing session

For every failure record:
- provider/model;
- run ID/session ID;
- observed UI state;
- terminal status;
- whether transport sent the prompt;
- whether a response was extracted;
- whether the issue already exists in the baseline.

---

## Exit criterion

PD-01 becomes **DONE** only when:

1. the exact repository baseline remains fixed;
2. frozen subsystem boundaries remain unchanged;
3. all ten scenarios have static evidence classification;
4. the live smoke matrix is executed against the exact baseline;
5. baseline failures are recorded as pre-existing defects rather than silently repaired during the audit.

Until item 4 is complete, the formal state is:

**PD-01 = REVIEW / MANUAL_REQUIRED**

PD-02 must not be formally opened under the agreed dependency policy until this gate is satisfied.
