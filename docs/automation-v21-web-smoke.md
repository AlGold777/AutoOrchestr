# Automation Layer v2.1 — Web Runtime smoke test

This branch contains the first executable integration test of the v2.1 Web Runtime concept on top of the existing MyOrchestrator web-UI transport.

## Test flow

1. Open `automation.html` as an extension page.
2. Select exactly two authenticated providers.
3. Enter a human request and press **Run two-round test**.
4. Round 1 opens fresh provider conversations and sends the same user request independently to both models.
5. The controller waits for terminal results from the existing MyOrchestrator runtime.
6. Each raw answer is accepted only if it has the exact current call/attempt frame and strict semantic JSON.
7. Accepted Round 1 answers are combined deterministically.
8. Round 2 starts fresh web runs. Both selected models receive:
   - the original request;
   - both Round 1 answers;
   - the same synthesis instruction.
9. The controller validates both Round 2 responses.
10. On success it downloads:
    - `automation-v2.1-smoke-<run>-result.txt`
    - `automation-v2.1-smoke-<run>-audit.json`

## Files

- `automation.html` — test UI/controller page.
- `automation.css` — page styling.
- `automation.js` — two-round orchestration state machine.
- `automation-test-protocol.js` — transport frame, semantic parser, prompt compiler and deterministic merge.
- `tests/automation-test-protocol.test.js` — protocol contract tests.

## Existing infrastructure reused

The test deliberately does not introduce a second DOM scraper.

It calls the existing background runtime through `START_FULLPAGE_PROCESS` with:

- `forceNewTabs: true`
- `useApiFallback: false`
- per-model `promptsByModel`
- `pipelineContext.sourceView = "automation"`

The existing provider adapters, selector profiles, prompt dispatch, completion authority, stale-answer protection, answer extraction and provider failure handling remain the transport implementation.

## v2.1 mechanisms exercised

- web UI only; API fallback explicitly disabled;
- fresh conversations for independent semantic runs;
- one `run_id` at controller level;
- unique `CALL_TOKEN` and `ATTEMPT_TOKEN` per provider call;
- prompt SHA-256 recorded by the controller;
- strict response frame correlation;
- strict semantic shape: exactly `result` + `content`;
- stale attempt rejection;
- trailing-content rejection;
- no partial answer salvage;
- attempts are immutable and never concatenated;
- bounded retry: maximum two attempts per provider per round;
- successful provider output is retained while only the failed provider is retried;
- deterministic Round 1 merge;
- persistent controller state in `chrome.storage.local`;
- append-only controller event ledger;
- recovery after reloading `automation.html`;
- final TXT artifact plus audit JSON.

## Transport response contract

Each model must return exactly:

```text
<<<PAF_RESPONSE <CALL_TOKEN> <ATTEMPT_TOKEN>>>
{"result":"COMPLETE","content":"complete answer"}
<<<END_PAF_RESPONSE <CALL_TOKEN> <ATTEMPT_TOKEN>>>
```

The controller rejects:

- missing or duplicate frame markers;
- a response from a previous attempt;
- invalid JSON;
- unknown semantic fields;
- empty content;
- text before or after the response frame;
- a runtime result that did not reach terminal `SUCCESS`.

## Smoke-test scope

This test intentionally validates the web orchestration boundary before introducing the complete Product→Architecture object registry.

The controller ledger uses `chrome.storage.local`; it is sufficient for this integration smoke test but is not presented as the production transactional Ledger from the full v2.1 specification.

The test also relies on the existing MyOrchestrator provider runtime for actual prompt-delivery and completion evidence. It does not claim that this smoke controller itself independently re-proves every provider DOM invariant.

## Manual execution

Load this branch as an unpacked Chrome extension, authenticate the two chosen providers, then open:

```text
chrome-extension://<extension-id>/automation.html
```

A real successful run is defined by both downloaded artifacts being produced automatically and the page ending in `COMPLETED`.
