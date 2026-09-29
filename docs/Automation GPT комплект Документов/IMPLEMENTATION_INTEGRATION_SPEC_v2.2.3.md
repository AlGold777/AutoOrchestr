# Automation Layer v2.2.3 — Implementation / Integration Specification

**Status:** implementation source of truth  
**Version:** 2.2.4  
**Target:** existing Web/DOM runtime of this repository (`AlGold777/AutoOrchestr`, extension `A_Fable`; earlier drafts called it MyOrchestrator)  
**Inputs:**  
1. `product_architecture_framework_system_model_final.json`  
2. `Automation Layer v2.2.3 — Web Runtime for Product→Architecture Framework`  
3. `product_architecture_framework_automation_layer_v2.2.3.json` and split bundle  
4. `automation_prototype_v2.2.3.html` as a test surface only

---

## 1. Implementation objective

Implement the full Product→Architecture process as an event-driven controller **above the existing MyOrchestrator Web runtime**.

The production Automation Layer must execute:

`IDEA → product stages 1–13 → PFB → architecture-input stages 14–17 → AIP → architecture stages 18–30 → CAB`

without manual prompt copying, while preserving the existing provider/Web ownership model.

The Automation Layer owns process semantics and persistent project state.  
Existing MyOrchestrator owns browser/provider transport.

---

## 2. Non-negotiable integration boundary

### Existing MyOrchestrator continues to own

- provider tab lifecycle;
- provider-specific DOM selectors and interaction;
- prompt insertion and submission;
- generation/terminal-state detection;
- stale-answer protection;
- extraction of the final assistant message;
- provider-specific recovery/retry already implemented in transport;
- compressed `jobState` persistence used by the current runtime;
- model/provider selection infrastructure.

**Do not create a second DOM scraper, second provider adapter stack, second completion detector, or API fallback path inside Automation Layer.**

### Automation Layer owns

- project/run/stage state machine;
- loading the machine manifest and running `manifest_lint`;
- immutable input snapshots;
- stable snapshot serialization and `input_snapshot_hash`;
- deterministic prompt compilation;
- `RULES → STATE → ACTIVE → DELTA → TASK`;
- context budget and context assembly audit;
- AL-STRUCT-1 compact prompt contract injection; full schema remains validator-side;
- accepted source-message idempotency;
- parsing and validation of AL-STRUCT-1;
- reference/authority/evidence/coverage validation;
- temp-id → canonical-id allocation;
- Registry/Ledger/Baseline state;
- atomic StateCommit;
- fan-out/fan-in at framework stages;
- Owner questionnaire flow;
- Human Test flow;
- routing, wait states, recovery, and project completion;
- exports.

---

## 3. Production file layout

Keep the current MyOrchestrator provider implementation intact.

Add the following Automation Layer modules:

```text
automation.html
automation.css
automation.js

automation/
  automation-core.js
  manifest-loader.js
  project-store.js
  stage-scheduler.js
  input-snapshot.js
  context-assembler.js
  prompt-compiler.js
  dispatch-bridge.js
  response-parser.js
  al-struct-validator.js
  semantic-validator.js
  mutation-normalizer.js
  state-committer.js
  gate-engine.js
  baseline-service.js
  interaction-engine.js
  recovery.js
  export.js

automation-spec/
  [contents of Product_Architecture_Automation_v2.2.3 bundle]

tests/
  automation-static-contracts.mjs
  automation-integration.test.js
  automation-recovery.test.js
```

This is a module boundary, not a requirement to rewrite working MyOrchestrator internals.

---

## 4. Runtime state

Use one persistent project record plus append-only events.

Minimum project controller state:

```json
{
  "project_id": "...",
  "project_revision": 0,
  "workflow_state": "NEW",
  "current_stage": 1,
  "framework_manifest_version": "2.0.0",
  "automation_layer_version": "2.2.4",
  "active_baselines": {},
  "registry": {},
  "accepted_message_ids": [],
  "active_runs": {},
  "wait": null
}
```

Canonical domain truth must be recoverable from durable committed state/events.  
Rendered UI, provider chat history, prototype DOM, and raw model text are not project state.

### Required persistent records

- ProjectState
- RegistryEntry versions
- append-only project events
- InputSnapshot
- StageRun / Attempt
- accepted `source_message_id`
- RAW response
- CANONICAL accepted AL-STRUCT-1 response
- CONTEXT representation
- ContextAssemblyAudit
- committed PFB/AIP/CAB baselines

---

## 5. Startup

Production startup sequence:

1. Load `manifest.json` and split machine bundle.
2. Verify bundle version compatibility.
3. Run `manifest_lint`.
4. Load current provider/runtime capabilities from MyOrchestrator.
5. Verify required provider capabilities for the next runnable stage.
6. Load/replay project state.
7. Reconcile incomplete runs.
8. Continue from the deterministic workflow state.

If manifest lint or state replay fails, **do not dispatch a model**.

---

## 6. Stage execution pipeline

Every model-driven stage must execute the same controller pipeline:

```text
SELECT READY STAGE
→ RESOLVE INPUT SELECTORS
→ FREEZE INPUT SNAPSHOT
→ STABLE SERIALIZE SNAPSHOT
→ COMPUTE input_snapshot_hash
→ RESOLVE COVERAGE SET
→ CHECK DECOMPOSITION
→ ASSEMBLE RULES / STATE / ACTIVE / DELTA / TASK
→ ENFORCE CONTEXT BUDGET
→ PERSIST CONTEXT ASSEMBLY AUDIT
→ COMPILE PROMPT
→ COMPUTE prompt_hash
→ ALLOCATE run / attempt / call identities
→ DISPATCH THROUGH EXISTING MYORCHESTRATOR
→ VERIFY DELIVERED PROMPT
→ CORRELATE SOURCE MESSAGE
→ WAIT FOR EXISTING TERMINAL-SUCCESS AUTHORITY
→ EXTRACT RAW RESPONSE
→ SOURCE-MESSAGE DEDUP
→ PARSE SINGLE AL-STRUCT-1 JSON
→ VALIDATE SNAPSHOT ACK / REFERENCES / ENUMS
→ NORMALIZE CHANGES
→ DOMAIN / AUTHORITY / EVIDENCE / COVERAGE VALIDATION
→ OPTIMISTIC VERSION CHECK
→ ATOMIC STATE COMMIT
→ STAGE_RUN_COMMITTED
→ STALE PROPAGATION
→ GATE / ROUTE / NEXT STAGE
```

A failure before atomic commit causes **zero domain mutations**.

---

## 7. Dispatch bridge to current MyOrchestrator

Reuse the existing dispatch path used by the earlier Automation prototype/integration:

- `START_FULLPAGE_PROCESS`
- `forceNewTabs: true` for independent semantic runs
- `useApiFallback: false`
- `sourceView: "automation"`
- stage/run-scoped `pipelineRunId`

Correlation must not depend on “last assistant message”.

The Automation Layer bridge only asks MyOrchestrator to execute a Web call and then consumes the trusted terminal transport result.

### Bridge input

```json
{
  "automation_project_id": "...",
  "run_id": "...",
  "attempt_id": "...",
  "stage": 18,
  "step_id": "candidate-A",
  "model_id": "GPT",
  "prompt_text": "...",
  "prompt_hash": "...",
  "input_snapshot_id": "...",
  "input_snapshot_hash": "..."
}
```

### Bridge output

```json
{
  "source_message_id": "...",
  "conversation_id": "...",
  "tab_id": "...",
  "provider": "...",
  "declared_model": "...",
  "raw_output": "...",
  "transport_complete": true,
  "finalized_at": "..."
}
```

The exact provider-specific mechanics remain inside current MyOrchestrator.

---

## 8. Prompt compiler

Prompt compiler consumes only trusted machine state.

Canonical assembly:

```text
RULES
STATE
ACTIVE
DELTA
TASK
```

### RULES

- stage identity and role;
- stage allowed/forbidden operations;
- active DPL/authority constraints;
- AL-STRUCT-1 schema;
- closed enums;
- one `role="schema_example"` example;
- stage material-output policy.

### STATE

- machine-owned project state needed by the stage;
- reference-first Registry projection;
- current committed baseline references.

### ACTIVE

- exact `passport.input_refs`;
- `input_snapshot_id`;
- `input_snapshot_hash`;
- stage-permitted prior outputs, explicitly wrapped as `role="prior_output"`.

### DELTA

Only new/changed refs relevant to this call.

### TASK

The concrete current stage/step task.

Historical Web chat transcript is never compiled as project context.

---

## 9. Context assembly

Use `policy/context-policy.json`.

Default v2.2 implementation profile:

- `maxPromptChars = 60000`
- `maxOutputContentChars = 8000`

Maintain three representations:

- `RAW`
- `CANONICAL`
- `CONTEXT`

Only `CONTEXT` may be compacted.

If safe truncation is required, use the exact marker:

`[OBJ:TRUNC]`

The following may not be silently removed:

- accountable current-stage refs;
- stage-required inputs;
- active authority/policy material required by stage;
- AL-STRUCT-1 contract;
- snapshot identity/hash.

If required context still does not fit, terminate the call with `PROMPT_TOO_LARGE` and use declared stage decomposition or fail the stage.

Persist `ContextAssemblyAudit` before dispatch.

---

### Compact model-facing contract

`prompt-compiler.js` MUST load `execution/al-struct-1.prompt-contract.json`. The full `objects/al-struct-1.schema.json` stays validator-side and is not embedded in normal Web prompts. Before dispatch, verify the compact contract `full_schema_hash` against the actual full schema.

### Structured-response extraction

`response-parser.js` first applies `browser/structured-response-extraction.json` to the correlated assistant `textContent`/raw text. It accepts only `WHOLE_TEXT_JSON` or exactly one `SINGLE_FENCED_JSON`. Wrapper prose remains RAW; multiple candidates are rejected. `innerHTML` is never authoritative input.

## 10. AL-STRUCT-1 parser/validator

Accept exactly one **canonical semantic JSON object** after deterministic transport extraction (`browser/structured-response-extraction.json`).

Required fields:

- `passport`
- `outputs`
- `annotations`
- `trace`
- `input_fate`
- `changes`
- `completion`

Reject:

- zero or multiple/ambiguous JSON candidates;
- unknown fields in control structures;
- unknown enum values;
- wrong `input_snapshot_hash`;
- canonical IDs/versions invented outside `passport.input_refs`;
- runtime-owned keys in model-controlled payload;
- dangling output/trace/input_fate references;
- incorrect `completion.output_count`;
- global `NO_CHANGE`.

`CONSUMED` means only “processed”.  
It must not change domain status.

---

## 11. Mutation bridge

The model-facing v2.2 vocabulary is:

- CREATE
- UPDATE
- SUPERSEDE
- MERGE

The preserved internal canonical mutation vocabulary is:

- CREATE
- REVISE
- SET_STATUS
- SUPERSEDE
- MERGE

`mutation-normalizer.js` maps validated AL-STRUCT-1 proposals into the internal mutation protocol.

Rules:

- new objects use response-local `tmp-*`;
- canonical ID is allocated only inside StateCommit;
- existing object target must be a versioned ObjectRef from the frozen snapshot;
- no hard delete;
- revision creates a new immutable version;
- no model response is itself a commit record.

---

## 12. Atomic commit

`state-committer.js` is the only module with canonical write access.

One transaction must include, when applicable:

- project revision increment;
- canonical ID allocation;
- tmp→canonical map;
- new RegistryEntry versions;
- status transitions;
- event records;
- baseline change;
- accepted run commit record.

Commit idempotency key: `run_id`.

Transport acceptance idempotency key: `source_message_id`.

Crash before commit: no domain change.  
Crash after commit but before routing: replay sees `STAGE_RUN_COMMITTED`, does not call the model again, and recomputes routing.

---

## 13. Scheduler and 30-stage process

`stage-scheduler.js` reads `process/stages.json` and `process/control-flow.json`.

It must not hard-code a separate copy of the 30-stage graph.

For each stage it resolves:

- input selectors;
- stage mode;
- required role/capabilities;
- independence/fan-out requirements;
- coverage obligation;
- output schemas;
- postconditions;
- route on success/failure.

The Scheduler may run a stage only when `stage_ready_to_run` passes.

---

## 14. Fan-out / fan-in

For independent stages:

1. Freeze one immutable InputSnapshot.
2. Dispatch each required model in a fresh conversation.
3. Give each model the same snapshot hash.
4. Hide sibling outputs until the independent set closes.
5. Validate each result separately.
6. Fan-in only exact accepted/canonical outputs declared by the stage.

Do not use completion order to determine semantic ordering.

---

## 15. Questionnaire / Owner flow

Owner interaction remains selection-only where specified.

Flow:

```text
blocking A2/A3 decision
→ QST
→ WAITING_FOR_SELECTION
→ Owner chooses option IDs
→ QANS
→ deterministic effects compiler
→ AEV
→ atomic state update
→ resume
```

No LLM reinterpretation of selected options.

The UI should render the questionnaire from machine QST objects rather than generate its own questions.

---

## 16. Human Test flow

When verification requires real-world execution:

```text
stage creates/routes HTSK
→ WAITING_FOR_HUMAN_TEST
→ Human Tester submits PASS / FAIL / BLOCKED + observations
→ HRES + AEV
→ deterministic HUMAN_TEST EVD
→ resume
```

A model cannot generate HRES and cannot promote its own analysis to VERIFIED.

---

## 17. Gates and baselines

Gate engine reads only frozen canonical state.

- G1 commits PFB
- G2 commits AIP
- G3 closes architecture direction predicate
- G4 commits CAB

Gate pass and baseline commit must be atomic where the spec requires it.

Checkboxes, UI text, and model claims such as “gate passed” have no authority.

---

## 18. Recovery

On extension/page reload:

1. load project state;
2. decode existing compacted MyOrchestrator `jobState` as already supported;
3. find active Automation runs by stage-scoped `pipelineRunId`;
4. reconcile terminal results;
5. deduplicate using `source_message_id`;
6. detect already committed `run_id`;
7. rebuild the UI feed from persistent state;
8. route deterministically.

Ambiguous recovery state fails closed into `WAITING_FOR_OPERATOR` / technical failure state rather than guessing.

---

## 19. UI

`automation_prototype_v2.2.3.html` is not production state.

Production `automation.html` should expose only controller actions/state:

- project creation/open;
- model selection where stage policy permits;
- current stage/phase;
- chronological accepted results;
- Owner questionnaire;
- Human Test task;
- wait/failure status;
- Results/export;
- Cancel where safe.

The UI may project AL-STRUCT metadata, but editing the display must never change canonical project state.

---

## 19a. Pilot implementation (v2.2.4, stages 1–5)

The pilot runs as a separate page and does not modify the Debate pipeline:

| Module | Responsibility |
|---|---|
| `automation_lab.html`, `automation/lab-ui.js`, `automation/lab.css` | UI only; every view is re-rendered from IndexedDB |
| `automation/al-spec.js` | loads `automation-spec/` (runtime copy of this bundle) and runs `manifest_lint`; the engine refuses to start on any problem |
| `automation/al-canonical.js` | JCS, SHA-256 (bare 64-hex), transport text canonicalization |
| `automation/al-schema.js` | CSP-safe JSON Schema interpreter, cross-checked against Ajv in jest |
| `automation/al-snapshot.js` | input selectors → frozen InputSnapshot + `input_snapshot_hash` |
| `automation/al-prompt-compiler.js` | RULES → STATE → ACTIVE → DELTA → TASK, compact contract, context budget, `[OBJ:TRUNC]` |
| `automation/al-response-parser.js` | token-located frame + three deterministic JSON modes |
| `automation/al-validator.js` | AL-STRUCT-1 pipeline, reference-first, TempRef, dispositions, Policy Engine |
| `automation/al-committer.js` | StateCommitter, answer compiler, routing (only canonical writer) |
| `automation/al-store.js` | IndexedDB stores; one commit = one readwrite transaction |
| `automation/al-engine.js` | restartable controller: attempts, repair, fresh attempt, failover, fan-in, recovery |
| `automation/al-transport.js` | bridge to `START_FULLPAGE_PROCESS` (`useApiFallback:false`, `sourceView:"automation"`) |
| `automation/al-simulator.js` | offline model simulator + fault injection |

Verification: `tests/automation-lab.test.js` (jest) and `tests/automation-lab-e2e.js` (real Chromium with the unpacked extension). `node scripts/automation-spec-sync.js` regenerates the monolith, the SHA manifest and `automation-spec/`.

## 20. Implementation sequence

### M0 — bundle loader / lint

Implement:

- `manifest-loader.js`
- static schema references
- `manifest_lint`

**Done when:** invalid/missing stage/schema/ref blocks project start.

### M1 — one real Web call with v2.2 boundary

Implement:

- InputSnapshot/hash
- layered prompt compiler
- dispatch bridge
- RAW response capture
- AL-STRUCT-1 parser/validator
- source-message dedup
- no commit yet

**Done when:** every provider in the explicitly enabled M1 set passes the synthetic zero-commit probe and emits required telemetry; no canonical project mutation occurs.

### M2 — canonical state commit

Implement:

- RegistryEntry
- temp IDs
- mutation normalizer
- atomic StateCommit
- event log
- crash/replay idempotency

**Done when:** one stage can create/revise canonical objects and survive reload without duplicate commit.

### M3 — Product path to G1

Implement stages 1–13 plus:

- QST/QANS/AEV
- product loops
- G1
- PFB

**Done when:** one free-form idea reaches either committed PFB or a precise wait/terminal state without manual prompt copying.

### M4 — AIP path

Implement stages 14–17, evidence/constraint handling and G2/AIP.

### M5 — Architecture path

Implement stages 18–30, independent candidates, reviews, comparison, evidence closure, change propagation and G4/CAB.

### M6 — hardening

Implement/verify:

- DOM drift quarantine;
- failover;
- context overflow/decomposition;
- source-message replay;
- full crash matrix;
- export/replay;
- all contract tests.

Do not attempt all 30 stages before M1/M2 are green.

---

## 21. Acceptance gate

Production Automation Layer v2.2.3 is not “implemented” because the page looks correct.

Minimum release gate:

1. bundle static validation passes;
2. AL-STRUCT-1 invalid output never commits;
3. snapshot mismatch never commits;
4. duplicate source message never creates duplicate accepted result;
5. crash before commit produces no mutations;
6. crash after commit does not rerun model;
7. canonical IDs are never model-owned;
8. Owner choice is compiled without reinterpretation;
9. evidence policy prevents model analysis becoming VERIFIED;
10. G1/PFB can be reached end-to-end;
11. full process can reach G4/CAB or a declared terminal/wait state;
12. project can be reconstructed from persistent state/events;
13. context audit can reproduce what each model actually saw.

`runtime/contract-tests.json` is the normative acceptance inventory.

---

## 22. What is intentionally not built into v2.2.3

Do not add these while implementing the v2.2.3 baseline:

- full debate-wide delta-only protocol;
- semantic-similarity dedup/embedding service;
- numeric voting;
- lazy retrieval;
- model compressor/arbiter;
- address/broadcast economics;
- challenge-token budget;
- a second provider automation stack.

They can be evaluated only after the baseline runtime passes its contract tests.


## Production contract requirements v2.2.3

This bundle supersedes ambiguous v2.2 implementation details with the following concrete decisions:

1. **Transformation coverage** — AL-STRUCT-1 contains explicit `dispositions[]` only for stages whose contract sets `dispositions_required=true`; all other stages return `[]`. `CoverageDeriver` is a reconciliation validator: runtime owns accountable_set and rejects any disposition inconsistent with `changes + input_fate + frozen snapshot`. `CONSUMED` remains bookkeeping only.
2. **Mutation normalization** — model-facing `changes.op` stays `CREATE|UPDATE|SUPERSEDE|MERGE`. Optional `state_patch` carries proposed `status`, `blocking`, `authority_class`. `UPDATE` normalizes into `REVISE` and, when `status` changes, a separate `SET_STATUS`; all emitted mutations commit atomically.
3. **Annotations** — `annotations[]` are diagnostic-only. They are retained for RAW/audit/UI and ignored by authoritative validation, policy, gates and StateCommit.
4. **Decomposition** — stages 7/11/12/15 have deterministic partition selectors and hard `max_items_per_partition` in `execution/decomposition-policy.json`; coverage is checked before fan-in.
5. **MV3 schema validation** — use Ajv standalone validators compiled at build time (`strict:false`, `allErrors:true`). Do not compile schemas at runtime with `new Function`/`eval`.
6. **Authoritative persistence** — Registry/Ledger/run state live in IndexedDB. One StateCommit is one IndexedDB `readwrite` transaction. `chrome.storage.local` is non-authoritative.
7. **Controller lifetime** — `automation.html` is UI only. The coordinator is restartable and reconstructs the FSM from IndexedDB after page close/service-worker suspension.
8. **Hash format** — all canonical and echoed SHA-256 values are lowercase bare 64-hex. The `sha256:` prefix is not accepted.
9. **DOM JSON extraction** — extract from correlated response/code-block `textContent`, never reconstructed rendered markdown/`innerHTML`; provider matrix tests are required.
10. **Evidence** — external facts become verifiable only through a persisted TOOL/HUMAN evidence artifact. Model statements alone remain `MODEL_ANALYSIS`; if no collector path exists, route to HTSK.

### Milestone order

- **M0**: load manifest + precompiled validators + IndexedDB stores.
- **M1**: execute only `tests/m1-transport-stage.json` synthetic zero-commit probe across the enabled provider set. Validate snapshot → compact layered prompt → existing Web transport → correlation → deterministic JSON extraction → AL-STRUCT schema → snapshot acknowledgement → telemetry. No Registry/Ledger domain commit and no canonical ID allocation.
- **M2**: MutationNormalizer + disposition reconciliation + atomic IndexedDB StateCommit + replay/idempotency. Only after M2 is green may real Product Stage 1 run.
- **M3**: stages 3–13 + QST/QANS + G1/PFB, only after M1/M2 contract suite is green.
- **M4+**: stages 14–30 + evidence collector/HUMAN_TEST routing.


## M1 Provider Matrix Acceptance (v2.2.3)

M1 больше не проверяется на произвольных двух моделях. Для production-enabled provider set используется `browser/provider-matrix.json`. Текущий MyOrchestrator `automation-gpt` содержит 10 Web-провайдеров: ChatGPT, Claude, Gemini, Grok, Le Chat, Qwen, DeepSeek, Perplexity, Z.ai и Kimi.

Для каждого enabled provider M1 обязан подтвердить:

1. существующий MyOrchestrator adapter/content script найден и используется без дублирования DOM-логики Automation Layer;
2. prompt доставлен и сопоставлен с `call_id/attempt_id`;
3. выбран именно correlated terminal assistant message, а не «последний ответ на странице»;
4. AL-STRUCT-1 извлекается через `textContent`/raw text; `innerHTML` и reconstruction rendered markdown не являются parser input;
5. `source_message_id` стабилен для duplicate suppression;
6. проходит fixture extraction test;
7. проходит минимум один live Web smoke call.

Если конкретный provider не проходит matrix, он отключается/карантинируется; это не разрешает считать его поддержанным. M1 может быть объявлен зелёным только для явно зафиксированного enabled provider set, где все его участники прошли эти проверки.


## Final pre-code decisions v2.2.3

1. Explicit `dispositions[]` are model-authored only for transformation stages; runtime reconciles them.
2. Canonical hashes are bare lowercase 64-hex everywhere.
3. Full AL schema stays validator-side; models receive compact prompt contract + one example + full schema hash.
4. Parser tolerates only deterministic whole-frame JSON or a single fenced JSON candidate.
5. Representation repair remains bounded to one per call until M1 telemetry justifies change.
6. M1 is synthetic and zero-commit; M2 is the first milestone with canonical StateCommit.
7. Cost/call-count is measured, not assumed.
8. `disput/` is not the Product→Architecture execution engine; only explicit adapter-level infrastructure reuse is allowed.
