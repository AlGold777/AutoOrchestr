# Automation Layer v2.1 Web Runtime — Implementation Handoff

## 1. Task

Implement and field-test the smallest real Automation Layer v2.1 flow on top of the existing MyOrchestrator browser-extension transport.

The implementation must use real provider web interfaces through the existing DOM/content-script infrastructure. Do not replace the provider layer with API calls, mocks, or a second scraper.

Required business flow:

1. Human enters one request and selects exactly two models.
2. The request is sent independently to both models.
3. Wait until both runs reach a terminal result.
4. Validate and copy both answers.
5. Deterministically combine the two accepted Round 1 answers.
6. Build one pre-defined Round 2 synthesis request containing:
   - original human request;
   - both Round 1 answers;
   - fixed synthesis instruction.
7. Send the Round 2 request independently to the same two models in fresh conversations.
8. Wait for and validate both Round 2 answers.
9. Save the result automatically to a text file.
10. Save a separate machine/audit JSON.

The smoke test is successful only when the controller reaches `COMPLETED` and both export files are created.

---

## 2. Repository baseline

Repository:

`AlGold777/MyOrchestrator`

Implementation branch:

`codex/automation-v21-web-smoke`

Do not implement the test as a standalone browser script.

The repository already contains:

- provider-specific content scripts;
- selector profiles;
- prompt insertion;
- trusted send paths;
- tab lifecycle;
- prompt-submission evidence;
- completion authority;
- stale-answer protection;
- answer extraction;
- recovery logic;
- rate-limit/auth/provider-error classification;
- telemetry.

Reuse these components.

---

## 3. Files owned by this smoke test

Primary implementation:

- `automation.html`
- `automation.css`
- `automation.js`
- `automation-test-protocol.js`

Verification:

- `tests/automation-test-protocol.test.js`

Documentation:

- `docs/automation-v21-web-smoke.md`
- this handoff document

Existing provider adapters and selectors are not part of the smoke-test implementation unless a real field run proves an existing transport bug.

---

## 4. Existing runtime integration points

### 4.1 Start a provider batch

Send:

```js
chrome.runtime.sendMessage({
  type: 'START_FULLPAGE_PROCESS',
  prompt: fallbackPrompt,
  selectedLLMs: ['GPT', 'Claude'],
  forceNewTabs: true,
  useApiFallback: false,
  promptsByModel: {
    GPT: '<provider-specific framed prompt>',
    Claude: '<provider-specific framed prompt>'
  },
  sourceView: 'automation',
  pipelineContext: {
    sourceView: 'automation',
    automationRunId: '<controller-run-id>',
    automationRound: 1,
    automationModels: ['GPT', 'Claude'],
    protocolVersion: '2.1-smoke.1'
  }
})
```

Relevant implementation:

- `background/message-router.js` → `START_FULLPAGE_PROCESS`
- `background/job-orchestrator.js` → `startProcess()`
- `shared/transport-policy.js` → `sanitizePromptsByModel()`, `resolvePromptForModel()`

Required invariants:

- `forceNewTabs: true`
- `useApiFallback: false`
- per-model prompts must be passed through `promptsByModel`
- `pipelineContext.automationRunId` and `automationRound` must be present

### 4.2 Detect whether the shared background runtime is busy

Send:

```js
chrome.runtime.sendMessage({ type: 'GET_ACTIVE_RUN_STATE' })
```

Do not start the next batch while `active === true`.

### 4.3 Observe completed answers

The smoke controller reads persisted `chrome.storage.local.jobState`.

For the active smoke run, require:

```js
jobState.session.pipelineContext.automationRunId === controllerRunId
jobState.session.pipelineContext.automationRound === expectedRound
```

Per model use:

- `entry.finalStatusRecorded`
- `entry.finalStatus` / `entry.modelRunState.terminalStatus`
- `entry.answer`

Only terminal `SUCCESS` is accepted by this smoke test.

The controller does not bypass the background completion authority. It consumes the answer already accepted by the existing runtime.

### 4.4 Stop

Send:

```js
chrome.runtime.sendMessage({
  type: 'STOP_ALL',
  platforms: selectedModels
})
```

---

## 5. Model-call transport contract

Every provider call has:

- controller `runId`
- round
- model
- attempt number
- random `CALL_TOKEN`
- random `ATTEMPT_TOKEN`
- SHA-256 of the complete compiled prompt

The model is instructed to return exactly:

```text
<<<PAF_RESPONSE <CALL_TOKEN> <ATTEMPT_TOKEN>>>
{"result":"COMPLETE","content":"complete answer"}
<<<END_PAF_RESPONSE <CALL_TOKEN> <ATTEMPT_TOKEN>>>
```

The parser must reject the complete candidate if any of the following is true:

- opening marker missing or duplicated;
- closing marker missing or duplicated;
- wrong call token;
- wrong attempt token;
- content before frame;
- meaningful content after frame;
- invalid JSON;
- semantic object contains fields other than `result` and `content`;
- `result !== "COMPLETE"`;
- `content` is empty.

Never salvage a fragment.

Never concatenate attempts.

Never accept an answer from a previous attempt.

---

## 6. Retry semantics

Maximum:

`2 attempts / model / round`

If Model A succeeds and Model B fails:

- keep A's accepted semantic result in controller state;
- do not call A again;
- start a fresh MyOrchestrator batch containing only B;
- generate a new CALL_TOKEN and ATTEMPT_TOKEN for B.

A rejected attempt is immutable diagnostic history and never contributes content to a later attempt.

---

## 7. Deterministic Round 1 fan-in

After both Round 1 model results are accepted, combine them in the selected-model order:

```text
===== SOURCE 1: <MODEL A> =====
<accepted content>
===== END SOURCE 1: <MODEL A> =====

===== SOURCE 2: <MODEL B> =====
<accepted content>
===== END SOURCE 2: <MODEL B> =====
```

Do not ask a model to create this merge.

This exact combined text is the source package for both Round 2 calls.

---

## 8. Round 2 prompt

Both models receive equivalent semantic input:

1. original request;
2. deterministic Round 1 combined source text;
3. synthesis instruction.

Default synthesis instruction:

> Using the two independent answers below, produce the best final answer to the original user request. Independently evaluate both answers instead of voting or averaging. Resolve contradictions, correct errors, preserve useful unique points, and remove duplication. Do not mention this orchestration process or the existence of the other model unless the user request requires it. Answer as if you were responding directly to the original user.

Each model still receives its own transport CALL_TOKEN/ATTEMPT_TOKEN.

Round 2 runs use fresh conversations.

---

## 9. Controller persistence

Smoke state key:

`automationWebRuntimeSmoke.v21`

Storage:

`chrome.storage.local`

State contains:

- controller run ID;
- phase;
- original request;
- original request hash;
- selected models;
- synthesis instruction;
- round state;
- per-model attempts;
- prompt hashes;
- accepted semantic responses;
- append-only smoke ledger;
- generated result text.

Reloading `automation.html` during an active run must restore the controller and resume monitoring.

This is smoke-test durability only. Do not describe `chrome.storage.local` as the production transactional Ledger required by the full v2.1 design.

---

## 10. Controller state machine

Normal path:

```text
IDLE
  ↓ Run
ROUND1_PREPARE
  ↓
ROUND1_RUNNING
  ↓ both accepted
ROUND1_COMMITTED
  ↓ automatic Round 2 dispatch
ROUND2_RUNNING
  ↓ both accepted
COMPLETED
```

Failure path:

```text
RUNNING
  ↓ rejected response and retry budget remains
fresh attempt for failed model only
  ↓
RUNNING
```

Exhausted retry or fatal controller/runtime error:

```text
ERROR
```

Explicit user stop:

```text
CANCELLED
```

---

## 11. Exact user-visible behavior

### State A — page opened, no run

The user sees:

- header: `Automation Layer v2.1 — smoke test`;
- badge: `IDLE`;
- `No active run`;
- `Human request` textarea;
- 10 model checkboxes;
- GPT and Claude selected by default;
- editable `Round 2 instruction`;
- active `Run two-round test` button;
- disabled `Cancel`;
- disabled `Download result .txt`;
- disabled `Download audit .json`;
- empty Round 1 panel;
- empty Round 2 panel;
- empty Runtime ledger.

### State B — user presses Run

Very briefly:

- phase becomes `ROUND1_PREPARE`;
- a run ID appears;
- Run becomes disabled;
- Cancel becomes enabled;
- two model rows appear in Round 1.

Then:

- phase becomes `ROUND1_RUNNING`;
- each Round 1 row displays current status and `attempt 1/2`;
- ledger begins showing `RUN_CREATED`, `ROUND_ATTEMPT_PREPARED`, `ROUND_DISPATCHED`.

Provider web tabs are opened by the existing runtime.

Important: although the new tabs are created with `active:false`, existing provider adapters may temporarily activate/focus a provider tab if that provider requires focus for trusted insertion/send. Therefore the user may see Chrome briefly switch from `automation.html` to a provider page. This is expected with the current MyOrchestrator transport.

### State C — models are generating Round 1

On `automation.html`:

- phase remains `ROUND1_RUNNING`;
- each model row changes according to the persisted runtime state;
- attempt counter remains visible;
- combined Round 1 textarea stays empty until both accepted responses exist;
- ledger continues to grow.

The smoke UI does not stream model answer text token by token.

If the user opens provider tabs, they see the normal provider UI and the framed automation prompt/response.

### State D — one Round 1 model succeeds, one fails validation

The successful semantic response is retained internally.

The user sees:

- successful model eventually represented as accepted for the completed attempt;
- failed model enters a second attempt;
- failed model counter becomes `attempt 2/2`;
- a new provider conversation/tab is created only for the failed model;
- phase remains `ROUND1_RUNNING`;
- ledger records `MODEL_RESPONSE_ACCEPTED`, `MODEL_RESPONSE_REJECTED`, and `ROUND_RETRY_SCHEDULED`.

There is no manual confirmation between attempts.

### State E — Round 1 complete

Once both semantic responses are accepted:

- ledger gets `ROUND_COMMITTED`;
- Round 1 combined textarea is filled with the two labelled source answers;
- controller immediately advances to Round 2;
- phase normally moves so quickly through `ROUND1_COMMITTED` that the user may only briefly see it.

No user click is required.

### State F — Round 2 running

The user sees:

- phase: `ROUND2_RUNNING`;
- Round 1 combined answer remains visible;
- Round 2 panel shows two model rows with attempt counters/status;
- new fresh provider conversations are opened;
- both providers receive the same original request + combined sources + synthesis task, with different transport tokens.

Round 2 final answer textarea remains empty until responses are accepted.

### State G — one Round 2 model requires retry

Same policy as Round 1:

- successful model answer is preserved;
- only the failed model is re-run;
- attempt changes to `2/2`;
- phase remains `ROUND2_RUNNING`.

### State H — successful completion

The user sees:

- phase badge turns to `COMPLETED`;
- Run becomes active again;
- Cancel becomes disabled;
- Round 1 combined source remains visible;
- Round 2 final textarea contains two labelled final answers;
- full ledger remains visible;
- `Download result .txt` becomes active;
- `Download audit .json` remains active.

The browser automatically starts two downloads:

- `automation-v2.1-smoke-<run>-result.txt`
- `automation-v2.1-smoke-<run>-audit.json`

### State I — fatal failure

The user sees:

- phase: `ERROR`;
- red error text below the main controls;
- current state/ledger remains on the page;
- Run becomes available for a new test;
- Cancel becomes disabled;
- audit JSON can still be downloaded.

Current smoke behavior does not yet expose the full v2.1 `WAITING_FOR_OPERATOR` state in the controller UI. If an existing provider runtime reports authentication/CAPTCHA/user-action failure, the smoke controller treats it as a non-success attempt, retries within its budget, and can ultimately enter `ERROR`.

This is a known smoke-test limitation, not production v2.1 behavior.

### State J — Cancel

The user presses `Cancel`:

- background receives `STOP_ALL`;
- controller phase becomes `CANCELLED`;
- monitoring stops;
- ledger records `RUN_CANCELLED`.

---

## 12. Acceptance criteria

Implementation is accepted only if a real Chrome run proves all of the following:

1. Exactly two selected real provider web UIs receive Round 1 prompts.
2. API fallback is not used.
3. Both answers are extracted by existing MyOrchestrator infrastructure.
4. Wrong/missing response frame is rejected.
5. Stale ATTEMPT_TOKEN is rejected.
6. One failed model can be retried without re-running the successful model.
7. Round 1 accepted answers are combined deterministically.
8. Both Round 2 providers receive the combined package.
9. Both Round 2 responses are independently validated.
10. The page reaches `COMPLETED`.
11. TXT export is produced automatically.
12. Audit JSON export is produced automatically.
13. Reloading `automation.html` during a run restores monitoring rather than creating a second run.
14. Existing main comparator/debate flows still work after the smoke-test files are added.

---

## 13. Known scope boundaries

Do not claim the smoke test already implements the complete production Automation Layer v2.1.

Not implemented here:

- full Product→Architecture Registry;
- typed domain objects;
- DPL;
- evidence model;
- baseline/gate engine;
- transactional production Ledger;
- full WAITING_FOR_OPERATOR UX;
- stage decomposition;
- complete production recovery matrix.

The purpose of this test is narrower: prove the core two-round web orchestration boundary using the real MyOrchestrator DOM runtime.

---

## 14. Implementation rule for another coding model

Before changing code:

1. inspect the files listed in sections 2–4;
2. preserve existing provider transport behavior;
3. do not create a duplicate DOM scraper;
4. do not enable APIs;
5. do not silently weaken framed-response validation to make a field test pass;
6. if a real provider fails, classify whether the defect is in:
   - smoke controller,
   - protocol contract,
   - existing provider adapter,
   - existing completion/extraction runtime;
7. fix the narrowest owning layer;
8. add a regression test for every code-level defect found.

The goal is to test the architecture, not to force a green result by bypassing its guarantees.
