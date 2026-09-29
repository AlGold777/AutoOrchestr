# Automation Layer v2.2 — Web Runtime

This directory is the versioned **working Web Runtime package** for Automation Layer v2.2.

It is **not** the HTML prototype.

## Product / implementation versions

- Automation Layer: **2.2**
- Core: **1.4.0**
- Semantic contract: **AL-STRUCT-1**
- Persistent controller state: **automationLayerWebRuntimeTest.v5**
- Source branch: **automation-gpt**

## Runtime files

```text
automation.html
automation.css
automation.js
automation/automation-core.js
styles.css
lib/lz-string.min.js
utils/storage-compress.js
```

These are exact copies of the corresponding current runtime files on the `automation-gpt` branch.

The package also includes:

```text
tests/automation-layer-core.test.js
docs/automation-layer-v2.2.md
```

## v2.2 elements included

- machine-owned registry;
- canonical IDs + response-local temp IDs;
- instruction + schema_example;
- explicit CONSUMED semantics;
- prior_output role;
- input_snapshot_id + input_snapshot_hash;
- RULES → STATE → ACTIVE → DELTA → TASK prompt assembly;
- reference-first prompt state;
- deterministic context budget;
- raw / canonical / context response separation;
- safe context-only truncation with OBJ:TRUNC;
- deterministic provider-text canonicalization;
- source-message idempotency;
- stage-specific EMPTY_BY_DESIGN / NO_MATERIAL_DELTA policy;
- context assembly audit;
- roles without arbitration;
- existing bounded finalization recovery.

## Existing behavior preserved

The package keeps the existing:

- MyOrchestrator Web transport;
- START_FULLPAGE_PROCESS integration;
- GET_IT_BATCH finalization recovery;
- STOP_ALL cancellation;
- exactly-two-model current workflow;
- Round 1 independent execution;
- automatic Round 2 fan-in;
- 10-model selector;
- Model A | Automation | Model B layout;
- Results;
- Save;
- Cansel;
- Send;
- exact sent-prompt history;
- fail-closed behavior.

## Integration

This package is an **overlay/runtime module for MyOrchestrator**, not a standalone browser application.

Its files retain the same relative paths as the main repository. Overlay them onto the corresponding paths of the MyOrchestrator extension, or use the current `automation-gpt` branch directly.

The provider/background runtime itself remains owned by the existing MyOrchestrator codebase and is intentionally not duplicated into this package.
