# DISPUTE REACHABILITY & DEPENDENCY AUDIT

**Repository:** `AlGold777/MyOrchestrator`  
**Baseline:** `2.81.444`  
**Commit:** `1fee9d2fc72fefcde4ba6fe33da9abc826672f7a`  
**Audit phase:** PD-02  
**Evidence type:** source/static reachability. Live-provider execution is not claimed unless explicitly stated.

---

## 1. Conclusion

The current Dispute implementation is **production-loaded and structurally reachable**. It is not merely a collection of experimental/test modules.

`result_new.html` contains the Dispute UI (`#page-dispute`) and synchronously loads the domain/runtime chain before `results.js`. That chain includes contracts, prompt compilation, response acceptance, run store, state delta/map, trace modules, planner, participant registry, stage executor, orchestrator, orchestrator persistence, artifact pipeline, application facade, and page-side transport/UI adapters.

The production boundary is:

```text
result_new.html / Dispute controls
        ↓
results.js page adapter
        ↓
results/debate-*.js
        ↓
DebateApplication
        ↓
DebateOrchestrator
        ├─ DebatePlanner
        ├─ DebateStageExecutor
        ├─ DebatePlanRevision
        ├─ DebateArtifactPipeline
        └─ DebateOrchestratorPersistence
        ↓
results/debate-transport.js
        ↓
chrome.runtime.sendMessage
        ↓
START_FULLPAGE_PROCESS / existing MyOrchestrator transport
```

The final hop into provider/DOM automation is a **frozen external transport dependency** during Pre-Dispute.

---

## 2. Production entry point

`result_new.html` contains visible Dispute controls for new run, synthesis, pause, continue, stop, participant selection, all/one mode, target selection, prompt entry, run/next action, sessions and export.

The same page loads, in production, the relevant domain modules including:

- `debate-artifact-definitions.js`
- `debate-contracts.js`
- `debate-context-broker.js`
- `debate-capability-registry.js`
- `debate-prompt-pack.js`
- `debate-prompt-compiler.js`
- `debate-response-acceptance.js`
- `debate-problem-spec.js`
- `debate-epistemic-outcome.js`
- `debate-engine.js`
- `debate-runtime.js`
- `debate-rule-engine.js`
- `debate-decision-request.js`
- `debate-correlation-guard.js`
- `debate-context-budget.js`
- `debate-run-store.js`
- `debate-case-schema.js`
- `debate-storage-migrations.js`
- `debate-state-delta.js`
- `debate-case-store.js`
- `debate-trace-schema.js`
- `debate-trace-store.js`
- `debate-trace-projections.js`
- `debate-execution-context.js`
- `debate-stage-types.js`
- `debate-policies.js`
- `debate-draft-plan.js`
- `debate-plan-revision.js`
- `debate-planner.js`
- `debate-participant-registry.js`
- `debate-stage-executor.js`
- `debate-orchestrator.js`
- `debate-orchestrator-persistence.js`
- `debate-state-map.js`
- `debate-artifact-pipeline.js`
- `debate-application.js`
- profile/configuration modules
- result-side controller/renderer/session/export/telemetry modules
- `results.js`.

This establishes **page-load reachability**, not proof that every exported function executes in every scenario.

---

## 3. Reachability classifications

- **PRODUCTION-ENTRY** — direct production page/UI entry.
- **PRODUCTION-LOADED** — synchronously loaded by `result_new.html`.
- **PRODUCTION-PORT** — bridge to an external/frozen execution subsystem.
- **DOMAIN-SUPPORT** — production-loaded domain helper/service.
- **PROJECTION/UI** — presentation/projection concern, not execution owner.
- **UTILITY/TRANSCRIPT** — supporting utility, not canonical run owner.
- **STATIC-ONLY-UNKNOWN** — present in repository but no stronger invocation proof established.
- **FROZEN-EXTERNAL** — existing MyOrchestrator provider/DOM pipeline reached through transport.

---

## 4. Major module reachability matrix

| Module / subsystem | Status | Current role | Target disposition |
|---|---|---|---|
| `result_new.html#page-dispute` | PRODUCTION-ENTRY | Dispute UI | KEEP |
| `results.js` | PRODUCTION-ENTRY | page integration/bootstrapping | MIGRATE toward thin adapter |
| `results/debate-controller.js` | PRODUCTION-LOADED / UI | pure run-control view model | KEEP |
| renderer/session/export/telemetry views | PRODUCTION-LOADED / UI | presentation/read models | KEEP, narrow ownership |
| `results/debate-transport.js` | PRODUCTION-PORT | Chrome transport bridge | MIGRATE behind explicit port |
| `disput/debate-application.js` | PRODUCTION-LOADED | universal application facade | KEEP/MIGRATE |
| `disput/debate-orchestrator.js` | PRODUCTION-LOADED | run lifecycle/coordination | KEEP/MIGRATE |
| `disput/debate-planner.js` | PRODUCTION-LOADED | stage planning | KEEP |
| `disput/debate-stage-executor.js` | PRODUCTION-LOADED | dispatch/retry/acceptance | KEEP/MIGRATE |
| `disput/debate-plan-revision.js` | PRODUCTION-LOADED | plan revisions | KEEP |
| `disput/debate-artifact-pipeline.js` | PRODUCTION-LOADED | response→Artifact→StateDelta→commit | MIGRATE/PARTIAL REWRITE |
| `disput/debate-orchestrator-persistence.js` | PRODUCTION-LOADED | events/snapshot/lease | MIGRATE |
| `disput/debate-run-store.js` | PRODUCTION-LOADED | UI aggregate/projection | KEEP, narrow |
| `disput/debate-response-acceptance.js` | PRODUCTION-LOADED | structural response checks | KEEP, narrow semantics |
| prompt compiler/pack/catalog | PRODUCTION-LOADED | prompt construction | KEEP/MIGRATE to one route |
| contracts/state-delta/state-map | PRODUCTION-LOADED | domain semantics/read model | KEEP/MIGRATE |
| trace schema/store/projections | PRODUCTION-LOADED | trace/evidence support | MIGRATE/consolidate |
| correlation guard | PRODUCTION-LOADED | correlation checks | KEEP/STRENGTHEN |
| execution context | PRODUCTION-LOADED | execution metadata | MIGRATE to explicit contract |
| context broker/budget | PRODUCTION-LOADED | context assembly | KEEP, no state ownership |
| case schema/store | PRODUCTION-LOADED | domain schema/storage | KEEP/MIGRATE carefully |
| decision/human modules | PRODUCTION-LOADED | human gate semantics | KEEP/MIGRATE |
| rule/convergence/protocol helpers | PRODUCTION-LOADED | domain policy helpers | KEEP only through explicit owner |
| `disput/debate-engine.js` | PRODUCTION-LOADED / UTILITY | transcript/replay/export utility | KEEP utility; DROP as execution owner |
| pipeline profile modules | PRODUCTION-LOADED | config/presets | KEEP outside canonical state |
| background/job/content/provider stack | FROZEN-EXTERNAL | provider execution/DOM | KEEP/FROZEN |

---

## 5. Presence is not execution

The audit distinguishes:

1. **Loaded** — proven by production script graph.
2. **Wired into universal facade** — proven for application/orchestrator/planner/executor/artifact/persistence core.
3. **Executed in a specific live scenario** — requires live runtime evidence.

No module is promoted from (1) to (3) merely because a `<script>` tag exists.

---

## 6. Transport reachability

`results/debate-transport.js` provides a concrete Chrome-extension port. `dispatchBatch()` sends `START_FULLPAGE_PROCESS` with prompt/prompts-by-model, selected models, attachments and pipeline context. It also exposes cancellation, pipeline FSM notification, active-run-state query, and page-side RunStore persistence/recovery.

This proves that Dispute reuses the existing MyOrchestrator provider pipeline rather than embedding a second provider implementation.

### Consequence

Provider automation, tab handling, DOM observation and completion extraction remain **below ProviderTransport** and outside the canonical Dispute domain state.

---

## 7. Reachability risks

### R-01 — production load is broader than proven use
Many helpers are globally loaded. Target architecture must eliminate accidental ownership-by-global.

### R-02 — `results.js` is a broad integration adapter
It can hide control flow and duplicate semantics. It should be thinned progressively, not rewritten wholesale.

### R-03 — transport is asynchronous and external to domain state
A Chrome message response is not proof of provider completion/correct DOM capture.

### R-04 — multiple persistence surfaces
Orchestrator persistence, RunStore persistence and session persistence have different purposes and must not become competing sources of truth.

---

## 8. PD-02 exit assessment

| Criterion | Result |
|---|---|
| Production entry identified | PASS |
| Universal core production load established | PASS |
| Main transport edge identified | PASS |
| Significant module families classified | PASS |
| Presence vs runtime execution distinguished | PASS |
| Live-provider invocation for every helper proven | MANUAL RUNTIME EVIDENCE PENDING |

**PD-02 status: DONE (static/source audit).**
