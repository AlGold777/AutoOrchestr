# Gemini: unconfirmed dispatch stall, 2.81.696

Field evidence: `Disput Flow 20261010_22-41.json` and `Disput Flow 20261010_22-44.json`, exported from extension 2.81.695. The corresponding transport extracts omit the version, but both original JSON files record it.

## What the exports establish

- First run: round 1 submitted its prompt and delivered a 2028-character answer after 68.7 seconds. Round 2 accepted `GET_ANSWER`, reported `submit_unconfirmed` five seconds later, then showed no submitted prompt, first text or terminal outcome through the last focus visit, 222 seconds after preparation.
- Second run: no dispatch or model tab acquisition. The background refused 111 start attempts with `RUN_ALREADY_ACTIVE` over 55 seconds, then the panel cancelled the waiting batch.
- The exports contain delivery journals, not the full provider diagnostics. They do not identify the failing insertion/send strategy, prove which cancellation action occurred between runs, or prove that removing the response label caused the send failure.

## Concrete code defect and chain

1. `background/dispatch-coordinator.js:1302`: after the fixed foreground visit, an unconfirmed command sets `awaitingSubmitConfirmation`; the state machine may already be in `ERROR`, while the model status remains `IDLE`.
2. `background/job-orchestrator.js:4385`: `finalizeNoSendModelIfStalled` previously deferred any entry with that flag, without checking its age or whether a dispatch still executed. The round gate therefore used the much longer 500/950-second generation timeout for an idle unconfirmed send.
3. `background/job-orchestrator.js`, `runDispatchRounds`: the gate keeps `session.roundsInProgress` set until completion.
4. `shared/run-guard.js:35`: that flag causes `RUN_ALREADY_ACTIVE`.
5. `results.js:6233`: the panel retries refused starts every batch-guard interval, explaining the second export's refusals before any tab opens.

The old background state is a plausible link between the two exports. Neither file includes an active-state snapshot identifying the owner of the second run's refusal, so that link is not established conclusively.

## Change

For an idle/error dispatch with no submission confirmation or in-flight operation, expire the pending-confirmation exemption after the existing 180-second composer window and 45 seconds without provider progress for that dispatch or runtime activity. Protect receiving/streaming/generating states, executing/queued dispatches and confirmed prompts. Use the existing one-shot materialization and finalization path: a recoverable answer is still checked before a missing send becomes `NO_SEND`.

This bounds a specific background waiting defect. It does not change Gemini selectors, send gestures, label removal, feed layout or moderator input width; it does not establish or fix the initial cause of the unconfirmed Send.

## Validation

- `npm test -- --runInBand tests/round4-gate.test.js`: before the fix, two new idle/error scenarios failed (9 passed); after the fix and additional protection tests, 17 passed.
- `npm test -- --runInBand tests/round4-gate.test.js tests/round1-simple-pass.test.js tests/run-ownership-guard.test.js tests/gemini-answer-gap.test.js tests/provider-submit-proof-contract.test.js tests/pipeline-message-handlers.test.js tests/materialize-recovery-finality.test.js tests/no-resend-after-submission.test.js`: 8 suites, 97 tests passed.
- `node --check background/job-orchestrator.js`; `git diff --check`: passed.
- Not verified on live Gemini: three rounds completing, the exact failing send strategy, cancellation/restart after the reported stall, or the card presentation reported by the user.
