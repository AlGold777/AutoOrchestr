# DISPUTE MIGRATION PLAN

**Baseline:** `2.81.444` @ `1fee9d2fc72fefcde4ba6fe33da9abc826672f7a`

---

## 1. Principle

No big-bang rewrite. Every slice must retain a rollback point and must not create two canonical owners. The frozen provider pipeline remains operational while Dispute contracts above it are strengthened.

---

## M0 — Baseline/live evidence

**Goal:** reproducible runtime baseline.

Actions:
- execute ten live smoke scenarios on exact baseline;
- capture run/session IDs;
- record provider-specific baseline defects;
- preserve baseline manifest.

Exit: all ten scenarios have PASS/FAIL evidence and failures are classified baseline vs regression.

---

## M1 — Explicit application ports

Define ports for:

- `ProviderTransport`;
- `ResponseAcceptance`;
- `ArtifactExtractor`;
- `DomainCommit`;
- `RuntimePersistence`;
- `EvidenceRecorder/Verifier`.

Route application composition through these ports without changing provider implementation.

Tests: fail closed on missing port; page startup still uses real transport; no second executor/orchestrator constructed.

Exit: one composition root for Dispute runtime.

---

## M2 — Stable run/stage/attempt correlation

Normalize:

- RUN_ID;
- stage instance ID;
- attempt ID;
- participant/model identity;
- transport correlation ID;
- tab/frame/turn anchor where observed.

Rules: run mismatch hard-fails; late response cannot attach to newer run; cancelled run rejects late semantic commit.

Exit: every execution/result transition has explicit correlation.

---

## M3 — Capture/evidence record

At transport/execution boundary record immutable/incremental capture series with evidence class, extractor/normalization version, observed text/fingerprint, sequence/time, correlation, isolation context and completion knowledge.

Where provider proof is unavailable, record `unknown` rather than inventing proof.

Tests: duplicate observation idempotency, incremental text, late END, worker/page restart, DOM replacement, identical text in different attempts.

Exit: semantic acceptance references capture ID rather than naked text.

---

## M4 — Verification and repairability

Deterministic verification for:

- correlation;
- contract markers/shape;
- IDs/counts where required;
- uniqueness;
- coverage/input fate where required;
- lineage validity;
- capture completeness knowledge.

Reason classes:

- repairable format/coverage;
- non-repairable run mismatch;
- unknown delivery/side effects;
- context contamination;
- stale semantic version.

Hard invariant: critical `unknown` cannot become `ACCEPT`.

Exit: verification record controls gate behavior.

---

## M5 — Domain commit hardening

Artifact creation receives verified capture reference, verification record, evidence provenance and lineage.

Preserve deterministic IDs, StateDelta, expectedCaseVersion, apply/reject/no-op and StateMap.

Strengthen full lineage, input fate where required, EMPTY-BY-DESIGN and prohibition on fallback artifact from ineligible response.

Exit: every committed artifact traces to eligible source evidence.

---

## M6 — Persistence/recovery authority

Separate persisted namespaces for:

- domain/orchestrator;
- evidence/capture;
- provider execution references;
- UI projection cache.

For cross-context MV3 recovery, durable extension storage becomes authoritative; service-worker memory is cache only.

Recovery sequence:
1. restore canonical run;
2. restore evidence;
3. query/reconcile provider execution state;
4. classify unknowns;
5. decide resumability;
6. rebuild UI projection.

Exit: restart cannot produce stronger state than persisted evidence supports.

---

## M7 — UI/read-model narrowing

- RunStore consumes canonical projection only;
- session store owns display/session concerns only;
- controller remains derived-control selector;
- StateMap view remains read-only;
- `results.js` forwards commands through Application facade.

Invariant test: UI mutation cannot advance lifecycle or semantic case.

Exit: all domain writes trace to orchestrator/domain commit.

---

## M8 — Human contamination/intervention

Explicit events/reasons for regenerate, edited prompt/response, manual provider interaction, substitute response and human approval/decision.

Affected automatic evidence becomes contaminated/invalid within defined scope.

Exit: old verification cannot authorize state after context-changing manual action.

---

## M9 — Finalization hardening

Requirements:

- current synthesis artifact ID/version;
- audit targets exact synthesis when required;
- no stale synthesis finalization;
- idempotent finalization;
- unresolved critical unknown → hold/manual path, not completion.

Exit: final lineage replayable from canonical state/evidence.

---

## M10 — Legacy removal

Only after:

- target path handles all ten scenarios;
- live provider regression passes;
- telemetry shows no legacy execution calls;
- recovery migration tested on stored runs;
- export/session features pass.

Then apply `DISPUTE-CLEANUP-PLAN.md`.

---

## Test gates for every affected slice

1. unit contract tests;
2. orchestration integration tests;
3. persistence/recovery tests where applicable;
4. browser smoke for affected path;
5. single/parallel/selective/sequential;
6. partial failure;
7. pause/resume;
8. cancel;
9. synthesis;
10. reload/recovery;
11. continue existing session.

Real-provider browser tests remain authoritative for DOM interaction; synthetic DOM tests cannot prove provider acceptance.

---

## Rollback rule

A slice is deployable only if it can be disabled/reverted without making stored state unreadable.

Schema changes require explicit version, forward migration, safe rejection of unknown/newer schemas and prior-version fixture.

---

## Forbidden shortcuts

- rewriting provider/background adapters as part of Dispute migration;
- old and new semantic writers in parallel;
- inferring run status from UI cards;
- treating UI aggregate as canonical semantic state;
- blind resend after unknown delivery;
- deleting legacy code before zero reachability;
- a global confidence score that hides unknown checks.

---

## Recommended implementation order

```text
M0 baseline live evidence
→ M1 ports
→ M2 correlation
→ M3 capture
→ M4 verification
→ M5 domain provenance
→ M6 persistence/recovery
→ M7 UI narrowing
→ M8 human contamination
→ M9 finalization
→ M10 cleanup
```
