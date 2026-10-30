const fs = require('fs');
const path = require('path');

const read = (...parts) => fs.readFileSync(path.join(__dirname, '..', ...parts), 'utf8');

describe('dispatch correlation contract', () => {
  test('submit waiters are keyed by model and exact dispatch id', () => {
    const src = read('background', 'dispatch-coordinator.js');
    expect(src).toContain('modelWaiters?.get?.(String(dispatchId))');
    expect(src).toContain('createPromptSubmittedWaiter(llmName, dispatchId, submitTimeoutMs)');
    expect(src).toContain('waiterController?.armAfter?.(PROVIDER_SEND_ACTION_FALLBACK_MS)');
    expect(src).toContain("emitTelemetry(llmName, 'DISPATCH_COMMAND_ACCEPTED'");
    const router = read('background', 'message-router.js');
    expect(router).toContain("if (stage === 'send_action_requested')");
    expect(router).toContain('self.armPromptSubmittedWaiter?.(llmName, dispatchId)');
    expect(router).toContain("emitTelemetry(llmName, 'DISPATCH_SEND'");
    expect(src).not.toContain('waitForPromptSubmitted(llmName, submitTimeoutMs)');
    expect(src).toContain('waitForPromptInsertion(\n          llmName,\n          dispatchId,');
  });

  test('lifecycle events require exact current dispatch and run session', () => {
    const src = read('background', 'message-router.js');
    expect(src).toContain('validateLifecycleCorrelation');
    expect(src).toContain("reason: incomingDispatchId ? 'dispatch_mismatch' : 'missing_dispatch_id'");
    expect(src).toContain("reason: incomingRunSessionId ? 'run_session_mismatch' : 'missing_run_session_id'");
    expect(src).toContain("return { ok: false, reason: 'no_bound_tab'");
    expect(src).toContain("validateLifecycleSender(llmName, sender, 'PROMPT_INSERTION_OBSERVED'");
    expect(src).toContain("validateLifecycleCorrelation(llmName, message, 'PROMPT_INSERTION_OBSERVED')");
    expect(src).toContain('resolvePromptInsertion(llmName, {');
  });

  test('mapping changes quarantine the command instead of rerouting stale metadata', () => {
    const src = read('background', 'dispatch-coordinator.js');
    expect(src).toContain("'STALE_TAB_COMMAND_QUARANTINED'");
    expect(src).not.toContain('sendMessageSafely(mappedTabId, llmName, message, attempt)');
  });
});
