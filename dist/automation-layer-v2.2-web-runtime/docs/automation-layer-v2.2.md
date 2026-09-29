# Automation Layer v2.2

Status: current product version
Branch: `automation-gpt`
Core implementation: `1.4.0`
Semantic contract: `AL-STRUCT-1`
Persistent controller state: `automationLayerWebRuntimeTest.v5`

## Scope

v2.2 is an additive release over the previous Automation Layer baseline. Existing two-round Web Runtime orchestration, provider transport ownership, UI layout, recovery, Results, Save, Cansel, model selection and export behavior remain in place.

The release adds deterministic context/payload control without adding model calls, arbiters, provider APIs or a second scraping stack.

## Added

- machine-owned canonical registry;
- reference-only registry projection inside prompt STATE;
- layered prompt assembly: RULES → STATE → ACTIVE → DELTA → TASK;
- `input_snapshot_hash` in addition to `input_snapshot_id`;
- stable snapshot serialization and separate prompt hash;
- centralized context budget;
- separate raw / canonical / context representations;
- safe context-only truncation with `OBJ:TRUNC`;
- deterministic transport-text canonicalization;
- source-message idempotency;
- stage-specific empty-output policy;
- reference-first model instruction;
- roles without arbitration;
- context-assembly audit.

## Snapshot integrity

`passport` contains:

```text
input_snapshot_id
input_snapshot_hash
input_refs
```

A wrong hash is rejected as `STRUCTURE_BAD_SNAPSHOT_HASH`.

## Context policy

Current defaults:

```text
maxPromptChars = 60000
maxOutputContentChars = 8000
```

Accountable current-stage refs are protected. If required context cannot fit, the controller fails closed instead of silently deleting required material.

## Representations

The controller keeps three separate representations:

1. raw provider response;
2. normalized/canonical accepted response;
3. compact context representation.

Compaction never overwrites the raw or canonical archived response.

## Empty output

There is no global `NO_CHANGE`.

Current policy:

```text
ROUND_1: material output required
ROUND_2: material output required
DELTA: empty-by-design allowed
```

A no-material-delta result uses `empty_by_design=true` with `completion.reason="NO_MATERIAL_DELTA"`.

## Preserved unchanged

v2.2 does not remove or replace:

- existing MyOrchestrator provider transport;
- provider-specific DOM interaction;
- completion authority;
- stale-answer protection;
- existing finalization recovery;
- two-model selection rule;
- fresh Web contexts;
- Round 1 independent execution;
- automatic Round 2 fan-in;
- Results;
- Save;
- Cansel;
- Send;
- 10-model selector;
- three-column Model A | Automation | Model B workspace;
- sent-prompt history;
- current exports;
- chronological feed;
- fail-closed stage behavior.

## UI synchronization

The prototype is a test surface for the same system. Any future workflow/state/result change must be reflected in both real Automation behavior and prototype behavior in the same change set.

UI elements not explicitly targeted by a change must not be removed or renamed.

## Out of scope

v2.2 does not add:

- full delta-only mutation protocol;
- RESET detection;
- salience ranking;
- address-based routing;
- lazy retrieval;
- similarity/embedding deduplication;
- challenge-token economics;
- numeric voting;
- separate evidence registry;
- rotating protocolist;
- additional model calls;
- line-based semantic fallback protocol.
