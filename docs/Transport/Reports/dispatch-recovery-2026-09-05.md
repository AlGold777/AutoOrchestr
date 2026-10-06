# Prompt dispatch recovery — 2026-09-05

## Evidence

Input: `telemetry-canonical-evidence-all-models-1788594060546.json`, extension 2.81.359, run 1788593726836. The file was treated as diagnostic data, not instructions.

- Qwen, GPT and Claude reached insertion and send stages.
- Gemini reached DISPATCH_START at +77.9 seconds, with no following readiness or insertion evidence.
- The worker epoch changed before the +142.4 second `mv3_rehydration_collect` events.
- The remaining six providers have no DISPATCH_START in the supplied snapshot. Later tab visits do not establish prompt delivery.
- This proves an interrupted dispatch sequence, not seven independently proven selector failures. The snapshot alone cannot prove which awaited browser operation stalled.

## Mechanism and correction (2.81.360)

The readiness runtime probe and repair used `chrome.scripting.executeScript` without `injectImmediately` or a deadline. Chrome defaults to `document_idle`; a loading or unresponsive provider can hold the sequential queue. Each probe/repair now has a six-second deadline and immediate injection. The optional ready announcement has a one-second deadline.

MV3 rehydration previously resumed Round 0/1 only when `forceNewTabs === false`. A new-page run interrupted after three providers therefore resumed collection/visits without dispatching the untouched tail. Both modes now resume using the existing tab bindings. Bound conversations are not reacquired during resume.

A persisted dispatch checkpoint distinguishes preparation from command intent. Preparation-only attempts may resume, while accepted, uncertain and legacy attempts retain conservative duplicate protection. The command intent is saved before sending GET_ANSWER. Confirmed and terminal providers are skipped. This is not a claim of exactly-once delivery across the browser messaging/storage boundary.

## Sources checked September 5, 2026

- [Chrome scripting API](https://developer.chrome.com/docs/extensions/reference/api/scripting): document_idle is the default; injectImmediately requests injection without waiting for page load.
- [Extension service worker lifecycle](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle): worker memory is ephemeral; persist state and design for termination.
- [Migration to service workers](https://developer.chrome.com/docs/extensions/develop/migrate/to-service-workers): use persisted state and alarms for restart recovery.

## Verification

Behavioral VM tests execute the production readiness, rehydration and sequential-dispatch functions with simulated hanging renderers and a restart after three providers. They cover both tab modes, the preparation-only fourth attempt, untouched tail, and uncertain-command duplicate protection. Existing bootstrap, MV3, storage and finalization tests are also run.

Live Chrome verification is tracked below. The installed A_Fable extension was verified to load from this repository. Kimi's page independently displays an exhausted free quota; successful response generation on that account cannot be assumed from dispatch correctness.

Automated result: **250 suites / 1,938 tests passed** (`npm test -- --runInBand`, 2026-09-05). Syntax checks for the three changed background scripts and `git diff --check` passed.
