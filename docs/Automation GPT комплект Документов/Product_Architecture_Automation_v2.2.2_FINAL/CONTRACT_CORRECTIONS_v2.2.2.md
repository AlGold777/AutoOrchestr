# Contract Corrections v2.2.2

Status: changelog only. All corrections are already integrated into the full v2.2.2 source-of-truth documents; no manual patching is required.

This patch closes four execution blockers discovered during implementation review without changing the 30-stage Product→Architecture framework.

## 1. Transformation dispositions

`AL-STRUCT-1.input_fate` remains bookkeeping and is not overloaded with domain transformation semantics. A deterministic `CoverageDeriver` computes the legacy/domain coverage outcome from `input_fate + changes + frozen snapshot`. Accountable inputs in stages 3 and 15 cannot be satisfied by `CONSUMED` alone. `DEFER` is derived only from a policy-valid transition to `DEFERRED`.

## 2. Model changes -> internal mutations

Model vocabulary remains `CREATE|UPDATE|SUPERSEDE|MERGE`. `changes[].state_patch` is added for proposed Registry state. `MutationNormalizer` maps this to internal `CREATE|REVISE|SET_STATUS|SUPERSEDE|MERGE`. Registry state is not smuggled into the domain payload.

## 3. Annotations

`annotations[]` are diagnostic-only. They have no authority and cannot affect mutation normalization, status, evidence, gate predicates or commit.

## 4. Decomposition

Concrete deterministic policies are defined for stages 7, 11, 12 and 15, including selector, ordering, maximum partition size, coverage obligation and fan-in behavior.

## Additional runtime decisions

- canonical hash format: lowercase bare SHA-256 hex;
- Ajv standalone/precompiled validation for MV3;
- IndexedDB is authoritative transaction store;
- automation UI is non-authoritative and controller logic is restartable;
- DOM response extraction uses `textContent`;
- evidence verification requires persisted TOOL/HUMAN artifact;
- one bounded snapshot-hash repair is permitted.


## v2.2.2 additional correction — provider matrix completeness

Review against the live `automation-gpt` repository showed that MyOrchestrator exposes ten Web providers while v2.2.1 bundled only five adapter binding profiles. v2.2.2 adds bindings for Le Chat, DeepSeek, Perplexity, Z.ai and Kimi, introduces `browser/provider-matrix.json`, and requires per-provider M1 `textContent`/raw-text structured-response extraction and correlation smoke tests for every enabled provider.
