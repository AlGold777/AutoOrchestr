# DISPUTE TARGET BEHAVIOR CONTRACT

**Baseline source:** `2.81.444` @ `1fee9d2fc72fefcde4ba6fe33da9abc826672f7a`  
**Phase:** PD-09  
**Normative language:** MUST / MUST NOT / SHOULD.

This document defines required behavior independently of current filenames and implementation details.

---

## 1. System definition

Dispute is a multi-participant reasoning runtime that coordinates model/human stages, preserves a versioned semantic case, and advances only when evidence required by policy is available.

The runtime MUST distinguish four facts:

1. dispatch was requested;
2. a response was observed/captured;
3. captured response satisfies a response contract;
4. semantic state transition was accepted.

No fact MUST be silently substituted for another.

---

## 2. Run identity and correlation

Every run MUST have stable `RUN_ID`.
Every executable stage MUST have stable stage-instance ID.
Every model/human attempt SHOULD have stable attempt ID.

Correlation MUST survive batch responses, pause/resume, page reload, retries, repair attempts and human intervention.

A run mismatch is a hard correlation failure and MUST NOT be auto-repaired as formatting.

---

## 3. Lifecycle

Normative lifecycle:

```text
CREATED
RUNNING
QUIESCING
PAUSED
RECONCILING
FINALIZING
COMPLETED

terminal alternatives:
CANCELLED
FAILED
```

An evidence/technical hold MAY be represented as substate/reason but MUST NOT be reported as successful completion.

Commands that can be repeated by UI/browser retry MUST be idempotent or deterministically rejected.

---

## 4. Run creation/configuration

Run creation MUST bind run identity, case identity/version, participant registry, policies, problem/prompt context, execution options and persistence namespace.

Production startup MUST fail closed if required execution or semantic-commit ports are absent.

Frozen run configuration MUST NOT later be inferred from mutable UI state when the canonical value exists.

---

## 5. Planning

Planner input MUST explicitly contain current case/version, unresolved goals, available participants, active plan revision, applicable policies, relevant artifacts and execution constraints.

Planner MUST return a decision and MUST NOT directly mutate the case.

Planned stages MUST identify purpose, participants, relevant inputs/goals and execution/completion mode.

---

## 6. Dispatch semantics

Runtime MUST support:

- **single** — exactly one participant;
- **selective** — explicit participant subset;
- **sequential** — ordered execution;
- **parallel** — coordinated concurrent/batch execution;
- configured all/quorum/first-success completion where applicable.

Parallel dispatch MUST NOT imply one shared semantic commit.

Provider-specific DOM mechanics MUST remain below ProviderTransport.

---

## 7. Observation and evidence

### Evidence classes
At minimum:

- `LOCAL_SYSTEM`
- `MODEL_DECLARATION`
- `DOM_OBSERVATION`
- `DERIVED_FROM_DOM`
- `PROVIDER_VERIFIED` only when provider-authoritative evidence actually exists.

Model declarations MUST NOT be upgraded into external proof.
DOM observation MUST NOT be described as provider/server verification.

### Capture
A capture SHOULD include correlation IDs, participant/provider, observed content, sequence/time, extractor version, normalization version, tab/frame/turn anchor where available, fingerprint/hash and completion knowledge with evidence source.

Captures SHOULD be append-only/incremental so DOM virtualization cannot erase the only evidence of earlier content.

### Unknown
`unknown` is a valid result.
Critical unknowns MUST NOT become `ACCEPT`.
The system MUST prefer `unknown` to a false positive.

---

## 8. Response contract

A stage response contract MAY require non-empty content, JSON/structured output, required sections, BEGIN/END markers, run echo, output IDs, counts, lineage, input fate and EMPTY-BY-DESIGN.

Contract validation establishes only that observed content obeys the contract. It does not independently prove provider completion.

---

## 9. Verification

A verification record SHOULD contain target capture/attempt, verifier type/id/version, individual checks, pass/fail/unknown, reason code, supporting evidence class and repairability classification.

Verifier MUST NOT hide unknowns behind one confidence score.
Deterministic checks SHOULD be preferred where possible.

---

## 10. Failure and repair

Failures MUST distinguish transport failure, run mismatch, capture incomplete/unknown, response-contract violation, semantic extraction failure, stale case version, semantic no-op and human/context contamination.

Rules:

- formatting/required-section failures MAY be repairable;
- coverage omissions MAY use targeted repair;
- run mismatch MUST be non-repairable in the same attempt;
- unknown delivery/side effects MUST NOT trigger blind resend;
- repair may fix structure/coverage but cannot retroactively prove truth or delivery.

---

## 11. Semantic commit

Models and transport MUST NOT mutate canonical semantic state.

```text
verified/eligible response
→ deterministic artifact extraction
→ candidate StateDelta
→ validate version/invariants
→ apply OR reject OR no-op
→ canonical event
→ derived StateMap
```

Commit result MUST state `applied`; if applied it MUST explicitly state whether state `changed`.

Stage completion MUST NOT automatically resolve a goal.

---

## 12. Versioning

Every semantic mutation MUST be checked against known case version.
Stale writes MUST be rejected/reconciled explicitly.
Parallel proposals from one base version need explicit atomic/merge policy; implicit last-write-wins is forbidden.
Projection version MUST NOT be confused with semantic case version.

---

## 13. Pause/resume

Pause MUST stop new stage creation, handle running work according to policy, persist a recoverable checkpoint, release ownership when quiescent and expose canonical PAUSED state.

Resume MUST reacquire ownership, restore/reconcile canonical state, reconcile external execution state where available, invalidate stale planning assumptions and only then resume planning.

---

## 14. Cancellation

Cancellation is terminal unless a new run is explicitly created.
It MUST propagate to provider transport where supported.
Late provider responses after cancellation MUST NOT mutate semantic state.

---

## 15. Recovery

Recovery MUST treat independently:

1. canonical run/domain state;
2. provider transport state;
3. capture/evidence state;
4. UI projection/session state.

Recovery in one domain MUST NOT imply recovery in another.

On restart the system MUST be able to classify recovered / not recovered / unknown / manual intervention required.
If automatic resume could duplicate side effects, safe hold is preferred.

---

## 16. Human intervention

Human actions MUST be explicit commands/events.
Manual edit, regenerate, replacement response or provider interaction that changes context SHOULD invalidate/contaminate affected automatic evidence.

Stale human decisions MUST be rejected by request/version correlation.
Duplicate submissions MUST be idempotent or deterministically rejected.

---

## 17. Synthesis/final output

Final output MUST use explicit finalization policy.
It MUST NOT infer “final” merely because generation stopped, no new DOM text appeared, cards contain text or synthesis-like prose exists.

Synthesis artifact SHOULD be identifiable/versioned. If audit is required, it MUST target the current synthesis version.
Finalization MUST be idempotent.

---

## 18. Observability

Important transitions SHOULD emit event with run ID, sequence, stage/attempt where applicable, type, reason, relevant version, timestamp and producer.

Event log proves what MyOrchestrator decided/did; it does not automatically prove provider-server action.

---

## 19. Ownership invariants

1. Orchestrator owns lifecycle.
2. Planner proposes work; it does not execute/commit.
3. Stage executor owns attempt mechanics.
4. Provider transport owns provider interaction only.
5. Domain commit owns semantic mutation.
6. Persistence stores authoritative records; it does not invent decisions.
7. UI stores are projections/read models.
8. Evidence producers report observations; policy determines sufficiency.
9. No layer may silently strengthen assurance level received from a lower layer.

---

## 20. PD-09 exit

Run creation, planning, dispatch modes, partial failure, evidence/acceptance, semantic commit/versioning, pause/resume/cancel, recovery, synthesis/finalization, human intervention, observability and ownership are specified independently of old implementation names.

**PD-09 status: DONE.**
