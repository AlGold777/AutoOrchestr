// L-6 (dispatch side): the visit does not close while the page's Send is still in flight,
// a failed send is not reported as submitted, and a repeat of a prompt checks the page for
// its own user turn before it sends the command again.
const fs = require('fs');
const path = require('path');

const source = fs.readFileSync(path.join(__dirname, '..', 'background/dispatch-coordinator.js'), 'utf8');

function section(start, end) {
  const a = source.indexOf(start);
  const b = source.indexOf(end, a + start.length);
  if (a < 0 || b < 0) throw new Error(`boundaries changed: ${start}`);
  return source.slice(a, b);
}

describe('simple first pass keeps the visit open while the send is in flight', () => {
  const visit = section('async function dispatchSimpleFirstPass', 'async function dispatchPromptToTab');

  test('the fixed post-send slot is extended only while the page reports send_action_requested', () => {
    expect(source).toMatch(/const SEND_IN_FLIGHT_EXTENSION_MS = 15000;/);
    expect(visit).toContain('const sendInFlightCapAt = leaveAt + SEND_IN_FLIGHT_EXTENSION_MS;');
    expect(visit).toContain("entry.providerDispatchStage === 'send_action_requested'");
    expect(visit).toMatch(/while \(current\(\) && sendInFlight\(\) && Date\.now\(\) < sendInFlightCapAt\)/);
  });

  test('a send reported as failed is not counted as submitted', () => {
    expect(visit).toContain('const attempted = Boolean(sendObserved()) && !failed();');
  });
});

describe('repeat dispatch verifies its own user turn before sending again', () => {
  const dispatch = section('async function dispatchPromptToTab', 'function queuedTabMessageContextFailure');

  test('repeat reasons check the page first and count it as delivered when the turn is there', () => {
    expect(dispatch).toContain("['retry_supervisor', 'round2_repair', 'round2_repair_pre_visit', 'manual_resend'].includes(reason)");
    expect(dispatch).toMatch(/if \(repeatDispatch && await pageHoldsOwnPromptTurn\(tabId, prompt\)\) \{\s*return recoverUndeliveredCommand\(\{ ok: false, reason: 'repeat_own_turn_on_page' \}\);/);
  });

  test('both delivery call sites go through the verifying wrapper', () => {
    expect(dispatch.match(/await deliverOrVerifyCommand\(\)/g)).toHaveLength(2);
    expect(dispatch).not.toMatch(/await recoverUndeliveredCommand\(await deliverAnswerCommand\(\)\)/);
  });
});
