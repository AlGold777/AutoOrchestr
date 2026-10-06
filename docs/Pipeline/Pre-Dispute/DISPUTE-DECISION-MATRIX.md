# DISPUTE DECISION MATRIX

**Baseline:** `2.81.444` @ `1fee9d2fc72fefcde4ba6fe33da9abc826672f7a`  
**Covers:** PD-07 Reuse Inventory + PD-08 KEEP / MIGRATE / REWRITE / DROP.

---

## 1. Decision vocabulary

- **KEEP** — semantics and ownership are appropriate; retain implementation with normal hardening.
- **MIGRATE** — retain useful logic but put it behind a clearer facade/contract or move ownership.
- **REWRITE** — current behavior cannot safely provide the target invariant; replace while preserving external contract where possible.
- **DROP** — remove from execution architecture after caller-zero proof. Utility use may remain when explicitly stated.

No component is deleted during Pre-Dispute.

---

## 2. Formal matrix

| Component | Current role | Reachability | Ownership/coupling risk | Decision | Target layer/facade | Completion/removal condition |
|---|---|---|---|---|---|---|
| `result_new.html` Dispute UI | user entry | production | low | KEEP | UI projection | N/A |
| `results.js` | page composition/integration | production | high due breadth | MIGRATE | thin UI composition | domain commands no longer implemented inline |
| `results/debate-controller.js` | pure run-control view model | production | low | KEEP | UI projection | N/A |
| renderer/export/telemetry views | presentation | production | low | KEEP | UI projection | N/A |
| `results/debate-sessions-store.js` | UI/session persistence | production | medium if canonicalized | MIGRATE | UI/session repository | explicitly read-model/session-only |
| `results/debate-transport.js` | Chrome message transport | production port | medium | MIGRATE | `ProviderTransport` | domain callers use interface, not message literals |
| `START_FULLPAGE_PROCESS` pipeline | provider execution | production external | mature/high complexity | KEEP | ProviderTransport implementation | separate project required to replace |
| background job orchestration | provider run coordination | production external | frozen | KEEP | ProviderTransport implementation | N/A here |
| content scripts/provider adapters | DOM/provider mechanics | production external | provider-specific | KEEP | provider adapters | N/A here |
| `DebateApplication` | universal facade | production | low/medium | KEEP + MIGRATE | application facade | explicit ports established |
| `DebateOrchestrator` | canonical run lifecycle | production | large but coherent | KEEP + MIGRATE | run orchestration | non-orchestration leakage removed |
| `DebatePlanner` | next-stage planning | production | medium | KEEP | planning | explicit input/output contract |
| `DebateStageExecutor` | dispatch/retry/repair | production | medium | KEEP + MIGRATE | stage execution | consumes verification-aware result envelope |
| `DebatePlanRevision` | plan versioning | production | medium | KEEP | planning | single revision authority |
| policies/participant/capability registries | planning/domain policy | production-loaded | low/medium | KEEP | planning/domain | remove duplicates if found |
| prompt compiler/pack/catalog | prompt construction | production-loaded | medium | KEEP + MIGRATE | stage execution input | one authoritative compilation route |
| `DebateResponseAcceptance` | structural acceptance | production | high if treated as proof | KEEP, NARROW | stage validation | no provider/capture assurance implication |
| `DebateArtifactPipeline` | response→artifact→delta→commit | production | high-value + evidence gap | MIGRATE / PARTIAL REWRITE | domain commit | verified capture explicit input |
| `DebateStateDelta` | transaction semantics | production-loaded | low/medium | KEEP + MIGRATE | domain commit | authoritative delta contract |
| `DebateStateMap` | derived semantic projection | production | medium if writable | KEEP | domain read model | enforce derived-only |
| case/artifact schemas | domain schema | production-loaded | medium | KEEP | domain | schema versioning |
| `DebateOrchestratorPersistence` | events/snapshot/lease | production | medium | MIGRATE | persistence/recovery | authoritative MV3-capable adapter |
| `DebateRunStore` | UI aggregate | production | medium if dual owner | KEEP, NARROW | UI projection | no domain mutation authority |
| trace schema/store/projections | trace/evidence support | production-loaded | medium | MIGRATE | evidence/observability | evidence classes/verifier provenance normalized |
| correlation guard | run/correlation checks | production-loaded | high value | KEEP + STRENGTHEN | verification | correlation becomes gate input |
| execution context | run/stage metadata | production-loaded | medium | MIGRATE | execution contracts | inferred context removed |
| context broker/budget | context assembly | production-loaded | medium | KEEP | planning/execution | no semantic ownership |
| human/decision modules | human gates | production-loaded | medium | KEEP + MIGRATE | orchestration commands | stale/idempotent semantics retained |
| rule/convergence/protocol services | policy helpers | production-loaded | possible overlap | REVIEW→KEEP through owner | planning/domain | no independent lifecycle writes |
| `DebateEngine` | transcript/replay/export utility | production-loaded | historical naming risk | DROP AS EXECUTION OWNER; KEEP UTILITY | transcript/export | no scheduling/orchestration dependency |
| pipeline profile modules | config/presets | production-loaded | low | KEEP | configuration | N/A |
| legacy alternative execution paths | historical | variable | critical dual-owner risk | DROP after proof | none | zero reachability + migration tests pass |

---

## 3. Reuse inventory outcome

### Reuse essentially as-is
- domain case/schema primitives;
- policies;
- planner decision mechanics;
- plan-revision mechanics;
- run-control view model;
- renderer/export;
- existing provider adapters and main provider pipeline.

### Reuse through a stable adapter/facade
- DebateApplication;
- DebateOrchestrator;
- DebateStageExecutor;
- DebateOrchestratorPersistence;
- DebateRunStore;
- page transport;
- trace/correlation modules.

### Preserve shape but change semantics at boundary
- response acceptance;
- artifact pipeline;
- trace/evidence storage;
- recovery coordination.

### Do not carry forward as competing runtime owner
- DebateEngine as an orchestration engine;
- UI/session stores;
- StateMap;
- any legacy executor path parallel to DebateApplication/Orchestrator.

---

## 4. Why this is not rewrite-from-zero

The current repository already solves dispatch modes, retries, terminal failure, plan revisions, pause/resume, lease/recovery, human decisions, StateDelta commit, StateMap projection and transport reuse.

Replacing all of it would create regression risk without addressing the central deficiency.

The required change is narrower:

> make evidence, ownership and transition contracts explicit so the existing universal runtime cannot confuse delivery, observation, structural acceptance and semantic acceptance.

---

## 5. Phase exits

**PD-07: DONE.** Every significant reusable subsystem has a disposition.  
**PD-08: DONE.** Every significant current component has an explicit KEEP/MIGRATE/REWRITE/DROP category or a constrained REVIEW→KEEP decision.
