# Product→Architecture Automation — v2.2.4

Status: v2.2.4, consolidated after an executable pilot of stages 1–5 (`automation_lab.html` in the repository root). See `FINAL_CHANGESET_v2.2.4.md`. File names that still say `v2.2.3` contain v2.2.4 content.

This archive is self-contained. No manual patching is required. Files from v2.2.2 are superseded by the v2.2.3 files included here.

## Human / Framework sources

- `sources/product_architecture_framework_human.html` — human interactive representation of the 30-stage framework.
- `sources/product_architecture_framework_system_model_final.json` — unchanged machine Framework source of truth.

## Runtime source of truth

- `Automation Layer v2.2.3 — Web Runtime for Product→Architecture Framework.md` — full normative runtime specification.
- `product_architecture_framework_automation_layer_v2.2.3.json` — full machine monolith, **generated** from the split files by `scripts/automation-spec-sync.js` (do not edit by hand).
- `manifest.json` + split directories — canonical split machine bundle.
- `IMPLEMENTATION_INTEGRATION_SPEC_v2.2.3.md` — production integration specification for MyOrchestrator.
- `FINAL_CHANGESET_v2.2.4.md` — contradictions removed after the pilot; `FINAL_CHANGESET_v2.2.3.md` — previous change list.

## Contract / verification

- `objects/al-struct-1.schema.json` — full validator schema.
- `execution/al-struct-1.prompt-contract.json` — compact model-facing contract.
- `runtime/contract-tests.json` — normative contract-test inventory.
- `tests/automation-static-contracts.mjs` — static package integrity runner.
- `tests/m1-transport-stage.json` — synthetic zero-commit M1 probe.
- `runtime/m1-telemetry-contract.json` — M1 provider compliance telemetry.
- `runtime/cost-telemetry-contract.json` — measured runtime cost/call telemetry.

## Browser / provider integration

- `browser/provider-matrix.json` — ten-provider matrix.
- `browser/structured-response-extraction.json` — deterministic Web JSON extraction policy.
- `browser/adapter-profiles/` — provider bindings.
- `integration/existing-runtime-boundary.json` — explicit Automation Layer / MyOrchestrator / disput boundary.

## Prototype

- `sources/automation_prototype_v2.2.3.html` — offline test surface; not production canonical state.

## Final implementation order

- **M0:** manifest loader/lint + precompiled validators + IndexedDB schema.
- **M1:** synthetic zero-commit transport probe across the enabled provider set.
- **M2:** MutationNormalizer + disposition reconciliation + atomic IndexedDB StateCommit + replay/idempotency.
- **M3:** Product path through stages 1–13 + QST/QANS + G1/PFB.
- **M4:** stages 14–17 + evidence/constraints + G2/AIP.
- **M5:** stages 18–30 + G3/G4/CAB.
- **M6:** browser/runtime hardening, failover, crash matrix, export/replay.

Contract test count in this package: **111**.

## Pilot (stages 1–5)

- Page: `automation_lab.html` (link in the Pipeline top bar).
- Runtime copy of the spec: `automation-spec/` (synced by `node scripts/automation-spec-sync.js`).
- Tests: `npx jest tests/automation-lab.test.js`, `node tests/automation-lab-e2e.js`.
