# Product→Architecture Automation — v2.2.2

Status: current implementation package.

## Source-of-truth documents

1. `Automation Layer v2.2.2 — Web Runtime for Product→Architecture Framework.md` — full normative runtime specification.
2. `product_architecture_framework_automation_layer_v2.2.2.json` — full machine-executable monolith.
3. `IMPLEMENTATION_INTEGRATION_SPEC_v2.2.2.md` — full production integration specification for MyOrchestrator.
4. `sources/product_architecture_framework_system_model_final.json` — unchanged machine Framework source.
5. `sources/automation_prototype_v2.2.2.html` — prototype/test surface, not production source of truth.
6. `runtime/contract-tests.json` — executable contract catalog.
7. `tests/automation-static-contracts.mjs` — static integrity runner.

`CONTRACT_CORRECTIONS_v2.2.2.md` is changelog/history only. **No manual patching is required.** All corrections are integrated into the three full source-of-truth v2.2.2 documents above.

## v2.2.2 integrated corrections

- CoverageDeriver for transformation dispositions.
- `changes[].state_patch` + deterministic MutationNormalizer.
- annotations are diagnostic-only.
- deterministic decomposition for stages 7/11/12/15.
- IndexedDB authoritative storage and atomic StateCommit.
- CSP-safe build-time schema validation for MV3.
- canonical bare 64-hex SHA-256 format.
- DOM JSON extraction from correlated `textContent`.
- persisted Evidence Collector artifact requirement.
- one bounded snapshot-hash repair.

## Implementation order

M0: bundle loader/lint + precompiled validators + IndexedDB schema.
M1: IDEA → stage 1 → stage 2 fan-out ×2, parse/validate only, no StateCommit.
M2: MutationNormalizer + CoverageDeriver + atomic StateCommit + replay/idempotency.
M3: stages 3–13 + QST/QANS + G1/PFB.
M4+: stages 14–30 only after M1/M2/M3 contract suites are green.


## v2.2.2

This release keeps the v2.2.1 contract closure intact and closes provider-matrix drift against the current MyOrchestrator `automation-gpt` branch. Ten provider bindings are now explicit: ChatGPT, Claude, Gemini, Grok, Le Chat, Qwen, DeepSeek, Perplexity, Z.ai, Kimi. Every enabled provider must pass provider-specific M1 structured-response extraction/correlation tests.
