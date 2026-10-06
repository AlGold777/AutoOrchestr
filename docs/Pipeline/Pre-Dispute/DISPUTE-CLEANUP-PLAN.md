# DISPUTE CLEANUP PLAN

**Baseline:** `2.81.444` @ `1fee9d2fc72fefcde4ba6fe33da9abc826672f7a`  
**Rule:** cleanup occurs only after migration gates. This document does not authorize deletion now.

---

## 1. Objective

Remove historical/duplicate execution paths only after the universal target runtime demonstrably owns lifecycle, planning, execution coordination, semantic commit, recovery and finalization.

Cleanup is evidence-driven: **zero production reachability + passing regression gates**, not naming convention.

---

## 2. Cleanup classes

### C1 — Competing execution owners
Candidates:
- legacy debate runtime scheduling independently of `DebateApplication → DebateOrchestrator`;
- transcript/session engine deciding next work;
- page code directly starting provider jobs bypassing application facade.

Action: DROP after caller-zero proof.

`DebateEngine` may remain as transcript/export utility but must not own orchestration.

### C2 — Duplicate state writers
Candidates:
- UI/session lifecycle mutation;
- StateMap writes outside projector;
- artifact mutation outside Domain Commit;
- alternate case-version counters;
- alternate revision mutation.

Action: delete or convert to read-only projection.

### C3 — Duplicate persistence authority
Candidates:
- RunStore cache treated as canonical recovery;
- session storage duplicating run state;
- ad-hoc localStorage semantic keys;
- service-worker memory relied on as durable truth.

Action: keep only explicitly rebuildable caches; remove recovery authority.

### C4 — Legacy transport wrappers
Candidates:
- alternate Chrome message wrappers;
- direct `START_FULLPAGE_PROCESS` calls from UI after ProviderTransport is universal;
- duplicate cancellation/read-state wrappers.

Action: collapse to one port.

Do **not** delete existing background/job/content provider implementation.

### C5 — Dead domain helpers
After migration, establish caller evidence for rule/protocol, context, convergence/stagnation, process-audit, profile/config and historical schema/migration helpers.

Classify individually:
- live dependency → keep;
- migration/test-only → move to explicit package;
- zero-call historical → delete.

Production page should eventually load actual dependencies, not every historical helper globally.

---

## 3. Specific targets and gates

| Target | Cleanup | Removal condition |
|---|---|---|
| broad domain logic in `results.js` | extract | UI regression passes |
| direct message literals outside transport | remove | all calls use ProviderTransport |
| lifecycle mutation in UI/read stores | remove | one orchestrator writer proven |
| semantic artifact mutation outside commit | remove | StateDelta path covers all mutations |
| duplicate recovery keys | retire/migrate | prior-version recovery fixture passes |
| transcript runtime ownership | remove | transcript still exports/replays without scheduling |
| stale global-loaded helpers | unload/delete | runtime caller count zero + tests green |
| legacy plan/executor path | delete | all baseline scenarios route through universal core |
| obsolete schemas/migrations | archive/delete cautiously | no supported persisted version needs them |
| temporary bridges | delete | target owner receives 100% of commands for agreed soak period |

---

## 4. Explicitly protected subsystems

Not cleanup targets merely because Dispute gains cleaner architecture:

- `background.js`;
- `background/job-orchestrator*`;
- content scripts;
- provider adapters/selectors;
- Get it / bottom-and-collect machinery;
- generic main-page parallel dispatch;
- provider-specific recovery logic.

Changes there require a separate transport project/baseline.

---

## 5. Validation before deletion

1. static search shows no production callers;
2. page script graph no longer requires module;
3. unit tests do not rely on accidental global;
4. ten Dispute smoke scenarios pass;
5. reload/recovery with old stored state passes or rejects unsupported version explicitly;
6. export/session/history passes;
7. provider pipeline behavior unchanged;
8. telemetry reports no use of removed bridge.

---

## 6. Documentation cleanup

After code cleanup:

- update architecture diagram;
- remove retired-runtime references;
- document canonical lifecycle/semantic owners;
- document persistence schema versions;
- document ProviderTransport and evidence classes;
- retain migration/changelog notes needed for stored-state compatibility.

---

## 7. Final invariant

After cleanup this must be true:

> For any run state or semantic artifact, exactly one component is authorized to change it, and every UI/transport/persistence representation is identifiable as canonical, evidence, or projection.

If false, cleanup is incomplete.
