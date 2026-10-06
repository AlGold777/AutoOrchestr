# DISPUTE ARCHITECTURE DECISION

**ADR:** Target logical architecture for Dispute migration  
**Baseline:** `2.81.444` @ `1fee9d2fc72fefcde4ba6fe33da9abc826672f7a`  
**Phase:** PD-10  
**Decision status:** ACCEPTED FOR MIGRATION DESIGN; live-runtime certification remains pending.

---

## 1. Decision

Retain the existing universal runtime as migration base, but enforce eight explicit logical layers and one cross-cutting evidence boundary.

```text
1. UI PROJECTION
        ↓ commands / ← projections
2. APPLICATION FACADE
        ↓
3. RUN ORCHESTRATION
        ↕
4. PLANNING
        ↓
5. STAGE EXECUTION
        ↓
6. PROVIDER TRANSPORT
        ↓
   provider tabs / DOM

5. STAGE EXECUTION
        ↓ eligible verified response
7. DOMAIN COMMIT
        ↓
8. PERSISTENCE / RECOVERY
```

Cross-cutting:

```text
OBSERVATION / EVIDENCE / VERIFICATION
```

Evidence is **not** a ninth business-state owner. It supplies facts to policy/orchestration; it does not decide domain meaning.

---

## 2. Layer responsibilities

### Layer 1 — UI Projection
Owns controls, renderer, StateMap/telemetry views, sessions as presentation/history and export.

Must not own lifecycle, planning, semantic commit or provider-completion inference.

Current mapping: `result_new.html`, `results.js` after thinning, controller, renderer, session/export/view modules.

### Layer 2 — Application Facade
Single public entry into runtime: start, pause, resume, cancel, recover, intervention, participant response, finalization and revision commands.

Current mapping: `DebateApplication`.

Decision: keep; make ports/contracts explicit.

### Layer 3 — Run Orchestration
Owns lifecycle, run ownership, planner loop, stages, participant availability, human gates, finalization and recovery coordination.

Current mapping: `DebateOrchestrator`.

Decision: keep; remove provider/UI/persistence-encoding leakage.

### Layer 4 — Planning
Owns next-work decision, stage proposals, participant/policy selection and plan revisions.

Current mapping: planner, policies, plan revision, participant/capability registries, context selection.

Decision: keep with explicit immutable/snapshot inputs.

### Layer 5 — Stage Execution
Owns dispatch mode, attempts, retries, structural response contract, repair requests and stage-local result assembly.

Current mapping: `DebateStageExecutor`, prompt compiler, response acceptance.

Decision: keep; require verification-aware result envelope.

### Layer 6 — Provider Transport
Owns Chrome runtime messages, batch dispatch, cancellation, provider execution-state query and provider mechanics below the port.

Current mapping: `results/debate-transport.js` + existing background/job/content/provider pipeline.

Decision: preserve implementation; standardize port. No Dispute-specific provider rewrite.

### Layer 7 — Domain Commit
Owns Artifact creation, StateDelta, invariant/version validation, apply/reject/no-op and StateMap projection.

Current mapping: artifact pipeline, artifact definitions, StateDelta, StateMap, case/domain schema.

Decision: retain shape; rework evidence/provenance input boundary.

### Layer 8 — Persistence / Recovery
Owns durable canonical events, snapshots/checkpoints, lease/ownership, evidence/captures where applicable and recovery metadata.

Current mapping: orchestrator persistence + trace store. RunStore persistence becomes non-authoritative projection cache.

Decision: migrate to explicitly authoritative MV3-capable adapter.

---

## 3. Cross-cutting evidence boundary

Target pipeline:

```text
Execution request
→ ProviderTransport
→ Observation/Capture
→ Verification
→ Stage structural acceptance
→ candidate semantic transformation
→ Domain Commit
→ orchestration transition
```

Hard rule:

> The orchestrator may act on evidence, but may never strengthen it.

Examples:

- `DOM_OBSERVATION` cannot become `PROVIDER_VERIFIED` because the run later succeeded.
- model-provided `RUN_ID_ECHO` can support correlation but remains model declaration.
- valid END marker proves contract form, not provider-server completion.

---

## 4. Current-to-target mapping

| Current subsystem | Target layer | Migration form |
|---|---|---|
| `result_new.html`, renderer, controller | UI | direct |
| broad `results.js` logic | UI/Application seam | extract commands/facades |
| `DebateApplication` | Application | direct + hardened ports |
| `DebateOrchestrator` | Orchestration | direct + responsibility tightening |
| planner/policies/revisions | Planning | direct |
| executor/prompt/acceptance | Stage execution | direct + result-contract migration |
| `DebateTransport` | Provider transport port | adapter |
| background/job/content/provider | Provider implementation | unchanged/frozen |
| artifact pipeline/state delta/map | Domain commit | migrate/partial rewrite |
| orchestrator persistence | Persistence | adapter migration |
| RunStore | UI read model | keep, narrow |
| trace/correlation modules | Evidence/observability | consolidate |
| DebateEngine | transcript/export utility | remove from execution semantics |

---

## 5. Hard architecture laws

**A-01 Single lifecycle owner.** Only Run Orchestration changes canonical lifecycle.

**A-02 Single semantic write gate.** Only Domain Commit mutates canonical DebateCase state.

**A-03 Projection immutability.** UI read models and StateMap cannot mutate canonical state.

**A-04 Provider isolation.** Provider/DOM mechanics remain below ProviderTransport.

**A-05 Evidence monotonicity.** Higher layers cannot upgrade evidence class without new independent evidence.

**A-06 Recovery separation.** Domain, transport, evidence and UI recovery are separate statuses.

**A-07 Versioned writes.** Semantic changes require explicit version/invariant validation.

**A-08 No competing orchestrators.** No legacy/transcript/UI engine independently schedules stages once universal facade owns run.

---

## 6. Why no generic Control Compiler now

The migration does not introduce a new meta-architecture that generates arbitrary controls from abstract Stage/Operation/Artifact profiles.

That would create a second design problem before current ownership/evidence gaps are closed.

Controls should initially be selected explicitly per handoff/stage contract. A compiler can be considered later only if stable repetition justifies it.

---

## 7. Transition bridges

Allowed one-way bridges:

```text
legacy UI → Application facade
Application → existing transport
old projection ← canonical events
```

Forbidden:

```text
legacy runtime ↔ new runtime both writing same run
old semantic store ↔ new semantic store both writable
```

Every bridge needs owner, source, target, removal condition and telemetry proving no alternate writer.

---

## 8. Consequences

### Positive
- preserves mature provider pipeline;
- preserves working universal core;
- narrows rewrite surface;
- makes MV3 recovery semantics explicit;
- makes `unknown` safe;
- supports deterministic audit/replay;
- enables cleanup by proof.

### Cost
- persistence/evidence contracts become versioned;
- page/global dependencies need gradual extraction;
- tests need evidence-boundary fixtures;
- some existing “success” cases may become hold/unknown until stronger evidence exists.

That is correctness, not regression.

---

## 9. PD-10 exit

- eight target layers defined;
- current subsystems mapped;
- direct/adapter/rework decisions established;
- transition bridge rules established;
- dual-owner migration forbidden.

**PD-10 status: DONE.**
