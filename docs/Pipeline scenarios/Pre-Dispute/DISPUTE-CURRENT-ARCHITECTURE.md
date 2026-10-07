# DISPUTE CURRENT ARCHITECTURE

**Repository:** `AlGold777/MyOrchestrator`  
**Baseline:** `2.81.444` @ `1fee9d2fc72fefcde4ba6fe33da9abc826672f7a`  
**Covers:** PD-03 Execution Path, PD-04 State Ownership, PD-05 Semantic Control Loop, PD-06 Orchestrator Responsibility.

---

## 1. Executive finding

The current system already contains a coherent **universal debate runtime**. The principal architecture is:

```text
UI / page adapter
    ↓ commands
Application facade
    ↓
Orchestrator
    ├─ Planner
    ├─ Stage Executor
    │    ↓
    │  LLM Adapter
    │    ↓
    │  Chrome Transport
    │    ↓
    │  existing MyOrchestrator provider/DOM pipeline
    │
    ├─ Artifact Pipeline
    │    response → Artifact → StateDelta → atomic semantic commit
    │
    ├─ Plan Revision
    └─ Persistence / event-snapshot-lease
    ↓
RunStore / StateMap / trace projections
    ↓
Renderer / sessions / export / telemetry
```

The strongest existing property is separation between **stage execution** and **semantic commit**. The principal weakness is that the boundary between “received text” and “verified evidence of the correct provider turn” is weaker than the semantic state machinery above it.

---

## 2. Actual execution path reconstruction

### 2.1 Start/new run

```text
Dispute UI
→ results.js page adapter
→ DebateApplication.start(...)
→ create/validate DebateCase + policies
→ DebateOrchestrator.startRun(...)
→ persist RUN_CREATED / RUN_STARTED
→ plannerTick()
→ DebatePlanner decision
→ STAGE_CREATED
→ StageExecutor.execute(stage)
→ LLM adapter
→ DebateTransport.dispatchBatch(...)
→ START_FULLPAGE_PROCESS
→ existing provider pipeline
→ model result(s)
→ structural response acceptance
→ artifact extraction
→ StateDelta proposal
→ Orchestrator semantic commit
→ goal evaluation
→ stage completion
→ next planner tick or finalization
→ RunStore/UI projection
```

Provider/DOM internals after `START_FULLPAGE_PROCESS` remain frozen external transport internals in this audit.

### 2.2 Ten baseline scenarios

| Scenario | Universal-runtime branch | State effect |
|---|---|---|
| Single model | one participant, `single` dispatch | one attempt; eligible result may produce delta |
| Parallel models | multiple LLM participants/native batch | peer results; explicit completion policy |
| Selective targets | explicit stage participant subset | only selected participants dispatched |
| Sequential targets | `sequential` mode | ordered attempts; optional first-success |
| One participant failure | failed/terminal participant + partial stage | availability changes; planner sees active set |
| Pause/resume | `PAUSE_REQUESTED → QUIESCING → PAUSED`; reconcile on resume | checkpoint/lease boundary |
| Cancel | application delegates cancellation | terminal `CANCELLED`; projected to UI |
| Synthesis/final | synthesis stage + explicit finalization | synthesis/final artifacts and terminal lifecycle |
| Reload/recovery | snapshot/checkpoint + event replay + ownership recovery | runtime restored before recovered UI state |
| Continue session | restored run/session re-enters orchestration | no second canonical runtime owner |

---

## 3. State ownership audit

### Ownership law

A value may have many projections, but only one canonical semantic owner.

| State | Canonical owner | Writers | Readers | Persistence | Assessment |
|---|---|---|---|---|---|
| `runId` | run/orchestrator | initialization | all layers | events/snapshots/UI aggregate | clear |
| lifecycle | Orchestrator | orchestrator transitions | application/UI | events/snapshots | clear |
| `caseVersion` | semantic run/case | semantic commit | planner/delta/recovery | events/snapshot | must remain single counter |
| DebateCase artifacts | domain state | Domain Commit | planner/StateMap/UI | recovery state | clear |
| StateDelta | transaction proposal | artifact pipeline/executor | orchestrator commit | event trail | good boundary |
| StateMap | derived projection | projector | planner/UI/finalization | snapshot/read-model | derived only |
| plan revision | revision service/orchestrator | explicit command | planner/stages/UI | runtime persistence | clear |
| stage status | Orchestrator | orchestrator/executor integration | planner/UI | events/snapshot | clear |
| participant availability | Orchestrator | terminal-failure integration | planner/UI | events/snapshot | clear |
| open goals | Orchestrator/domain semantics | commit/evaluation/intervention | planner/UI | events/snapshot | one mutation path required |
| human decision | Orchestrator | decision/intervention command | UI/recovery | events/snapshot | clear |
| transport state | existing provider pipeline | job orchestration | transport/diagnostics | external pipeline | separate technical state |
| UI aggregate | RunStore | application projection | renderer/controller | page cache | projection only |
| session transcript | session/transcript utility | UI/session | export/UI | session storage | non-canonical |
| trace/evidence | trace/evidence layer | instrumentation | telemetry/audit | trace storage | must not mutate domain directly |

---

## 4. Duplicate/ambiguous ownership risks

### Orchestrator vs RunStore
Correct interpretation:

```text
Orchestrator lifecycle = canonical
RunStore status = projection
```

RunStore must never decide canonical lifecycle.

### Orchestrator persistence vs RunStore persistence

- orchestrator persistence = runtime recovery authority;
- RunStore persistence = UI recovery/cache.

They are not equivalent.

### StateMap vs DebateCase
StateMap must remain derived, not a second writable semantic database.

### Transcript/session vs run
Transcript/session storage may replay/display history but may not schedule work, satisfy goals or change case version.

---

## 5. Semantic control loop audit

Current intended mutation chain:

```text
provider response
   ↓
acceptResponse(text)
   ↓
extractArtifacts(...)
   ↓
proposeStateDelta(...)
   ↓
Orchestrator receives candidate delta
   ↓
validate expectedCaseVersion + commit contract
   ↓
commitStateDelta(...)
   ├─ applied + changed
   ├─ rejected/stale
   └─ no_state_change
   ↓
STATE_DELTA_APPLIED / REJECTED / diagnostic event
   ↓
goal evaluation
   ↓
StateMap projection
   ↓
planner/UI/finalization
```

### Already correct

- model/transport does not directly mutate canonical semantic state;
- accepted response may yield no state change;
- stale case version can reject a delta;
- commit reports `applied` and explicit `changed` semantics;
- goal completion is criterion-driven rather than stage-completion-driven;
- missing semantic commit wiring fails closed;
- parallel proposals have explicit commit behavior.

### Main semantic gap: acceptance ≠ evidence

`DebateResponseAcceptance.evaluate()` verifies structural properties such as empty/error output, minimum/maximum length, valid JSON, audit verdict format, required sections, truncation markers and incomplete ending.

It does **not** prove:

- correct provider turn captured;
- capture complete under DOM virtualization;
- provider-server completion;
- prompt delivered exactly once;
- absence of human/regenerate contamination;
- response belongs to expected run/turn.

A first-class observation/evidence gate is therefore required before semantic transition authorization.

---

## 6. Artifact pipeline audit

Current shape:

```text
response text
→ structured artifact extraction if available
→ fallback artifact by stage purpose
→ deterministic artifact ID/provenance hash
→ StateDelta + expectedCaseVersion
→ prepare mutations
→ commit
→ StateMap
```

Strengths:

- deterministic IDs;
- explicit artifact types;
- provenance includes run/stage/participant/response hash;
- optimistic version check;
- no-op detection;
- projection separated from commit.

Risks:

1. fallback conversion can turn arbitrary structurally accepted text into a domain artifact;
2. provenance does not encode evidence strength/class;
3. `extractionConfidence: 1` is not provider-completion proof;
4. internal stable hash is a fingerprint, not cryptographic or provider proof;
5. full input-fate/output-source lineage is not universal.

Target: retain pipeline shape, insert verified capture/evidence prerequisite, enrich provenance and lineage.

---

## 7. Persistence/recovery audit

`DebateOrchestratorPersistence` owns:

- de-duplicated event append;
- bounded snapshots;
- recovery checkpoint lookup;
- last-published sequence;
- lease/CAS lease;
- optional browser exclusive lock;
- lease broadcast.

Important limitations:

1. current implementation prefers page `localStorage` where available, which is not automatically the same authority as MV3 service-worker state;
2. baseline 2.81.444 documents that automatic provider bottom-and-collect is not auto-resumed after an interrupted worker restart.

Target recovery must distinguish:

```text
domain run recovery
provider transport recovery
capture/evidence recovery
UI projection recovery
```

Recovery of one does not prove recovery of the others.

---

## 8. Orchestrator responsibility audit

### Appropriate — retain

- run lifecycle;
- ownership/lease coordination;
- planner loop;
- stage creation/status;
- dispatch coordination through executor;
- pause/resume/cancel/reconcile;
- participant availability;
- semantic commit coordination;
- goal evaluation;
- plan revision activation;
- human intervention boundaries;
- synthesis/finalization;
- recovery coordination;
- canonical runtime events.

### Must remain outside

- provider DOM mechanics;
- button clicking/keyboard submission;
- tab navigation;
- raw selectors/extraction;
- HTML rendering/export formatting;
- transcript formatting;
- persistence encoding details;
- telemetry presentation.

### Missing responsibility boundary

The orchestrator needs a decision gate that consumes external verification, but it must not manufacture or upgrade evidence.

```text
Capture/Verifier says what is known.
Policy says whether evidence is sufficient.
Orchestrator performs the allowed transition.
```

---

## 9. Current architecture risks

| ID | Risk | Severity |
|---|---|---:|
| CA-01 | structural acceptance mistaken for execution proof | High |
| CA-02 | multiple persistence surfaces confused as sources of truth | High |
| CA-03 | globally loaded modules hide actual invocation | Medium |
| CA-04 | broad `results.js` integration adapter | Medium |
| CA-05 | recovery domains can diverge | High |
| CA-06 | DOM observation provenance not first-class in semantic commit | High |
| CA-07 | human/regenerate contamination not universal invariant | Medium/High |
| CA-08 | “success” spans incompatible assurance levels | High |

---

## 10. Phase exits

| Phase | Exit result |
|---|---|
| PD-03 Actual execution path | DONE — static path reconstructed |
| PD-04 State ownership | DONE — canonical vs projection ownership established |
| PD-05 Semantic control loop | DONE — mutation chain and principal gap identified |
| PD-06 Orchestrator responsibility | DONE — retained/excluded/missing responsibilities defined |

Live Chrome evidence remains a certification gate, not a reason to invent runtime observations.
