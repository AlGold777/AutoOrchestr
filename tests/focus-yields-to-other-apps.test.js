// Reported 2026-07-31: "the extension stays active more than 10-15 minutes and
// steals focus even from other programs".
//
// The human/automation visit loop runs for as long as any model is
// non-terminal, and every visit called chrome.windows.update({ focused: true }),
// which raises the Chrome window over whatever application the user is actually
// in. A visit needs its tab foregrounded *inside Chrome*; it does not need
// Chrome pulled in front of another app.
const fs = require('fs');
const path = require('path');

const SRC = fs.readFileSync(
  path.join(__dirname, '..', 'background', 'human-presence.js'),
  'utf8'
);

describe('visits do not steal focus from another application', () => {
  test('both visit paths go through the guarded raise', () => {
    expect(SRC).toContain('raiseWindowUnlessUserIsElsewhere(tab.windowId, `human_visit:${llmName}`');
    expect(SRC).toContain('raiseWindowUnlessUserIsElsewhere(tab.windowId, `automation_visit:${llmName}`');
  });

  test('no visit path raises a window directly any more', () => {
    const visitRegion = SRC.slice(SRC.indexOf('function visitTabWithHumanity'));
    expect(visitRegion).not.toContain("chrome.windows.update(tab.windowId, { focused: true }");
  });

  test('the raise is skipped when no Chrome window holds focus', () => {
    const guard = SRC.slice(
      SRC.indexOf('async function raiseWindowUnlessUserIsElsewhere'),
      SRC.indexOf('var humanPresenceLoopTimeout')
    );
    expect(guard).toContain('chrome.windows.getLastFocused');
    expect(guard).toContain('win.focused === true');
    expect(guard).toContain('if (!browserHasFocus || !isCurrent())');
    // The skip must return before the update call.
    expect(guard.indexOf('if (!browserHasFocus || !isCurrent())'))
      .toBeLessThan(guard.indexOf('chrome.windows.update(windowId, { focused: true }'));
  });

  test('an unknown focus state does not steal focus on a guess', () => {
    const guard = SRC.slice(
      SRC.indexOf('async function raiseWindowUnlessUserIsElsewhere'),
      SRC.indexOf('var humanPresenceLoopTimeout')
    );
    // Both the lastError branch and the throw branch resolve false.
    const resolves = guard.match(/resolve\(false\)/g) || [];
    expect(resolves.length).toBeGreaterThanOrEqual(2);
  });

  test('yielding is recorded, so a quiet run is distinguishable from a broken one', () => {
    expect(SRC).toContain('WINDOW_FOCUS_YIELDED_TO_USER');
  });
});

describe('CDP dispatchers do not raise the window from another application', () => {
  const ROUTER = fs.readFileSync(
    path.join(__dirname, '..', 'background', 'message-router.js'),
    'utf8'
  );

  test('every dispatcher goes through the guarded raise', () => {
    const direct = ROUTER.match(/callChromeDebugger\('sendCommand', target, 'Page\.bringToFront'\)/g) || [];
    // Exactly one remains: the guarded helper's own call.
    expect(direct.length).toBe(1);
    const helper = ROUTER.slice(
      ROUTER.indexOf('const bringToFrontUnlessUserIsElsewhere'),
      ROUTER.indexOf('const callChromeDownloads')
    );
    expect(helper).toContain("callChromeDebugger('sendCommand', target, 'Page.bringToFront')");
  });

  test('the helper does not call itself', () => {
    const helper = ROUTER.slice(
      ROUTER.indexOf('const bringToFrontUnlessUserIsElsewhere'),
      ROUTER.indexOf('const callChromeDownloads')
    );
    const selfCalls = helper.match(/bringToFrontUnlessUserIsElsewhere\(target\)/g) || [];
    expect(selfCalls.length).toBe(0);
  });

  test('the guard checks focus before raising', () => {
    const helper = ROUTER.slice(
      ROUTER.indexOf('const bringToFrontUnlessUserIsElsewhere'),
      ROUTER.indexOf('const callChromeDownloads')
    );
    expect(helper).toContain('chrome.windows.getLastFocused');
    expect(helper.indexOf('if (!browserHasFocus) return false;'))
      .toBeLessThan(helper.indexOf("'Page.bringToFront'"));
  });
});
