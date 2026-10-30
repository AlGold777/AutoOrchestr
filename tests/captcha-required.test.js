const fs = require('fs');
const path = require('path');
const PageBlockerPolicy = require('../shared/page-blocker-policy.js');

const read = (...parts) => fs.readFileSync(path.join(__dirname, '..', ...parts), 'utf8');

describe('captcha_required: page in the tab is Google check page', () => {
  test('Gemini tab on google.com/sorry is captcha_required', () => {
    expect(PageBlockerPolicy.classifyUrl(
      'https://www.google.com/sorry/index?continue=https://gemini.google.com/&q=EgR'
    )).toBe('captcha_required');
    expect(PageBlockerPolicy.classifyUrl('https://google.com/sorry/index')).toBe('captcha_required');
    expect(PageBlockerPolicy.classifyUrl('https://www.google.co.uk/sorry/index?x=1')).toBe('captcha_required');
  });

  test('normal provider and Google pages are not blockers', () => {
    expect(PageBlockerPolicy.classifyUrl('https://gemini.google.com/app/abc')).toBeNull();
    expect(PageBlockerPolicy.classifyUrl('https://www.google.com/search?q=sorry')).toBeNull();
    expect(PageBlockerPolicy.classifyUrl('https://example.com/sorry/index')).toBeNull();
    expect(PageBlockerPolicy.classifyUrl('https://google.com.evil.example/sorry/')).toBeNull();
    expect(PageBlockerPolicy.classifyUrl('')).toBeNull();
    expect(PageBlockerPolicy.classifyUrl('not a url')).toBeNull();
  });

  test('the blocker maps to a terminal user-action policy', () => {
    expect(PageBlockerPolicy.classify({ reason: 'captcha_required' })).toEqual(expect.objectContaining({
      blocker: 'captcha',
      action: 'terminal_user_action_required',
      terminal: true,
      retryable: false
    }));
  });

  test('tab readiness returns captcha_required before the eligibility check', () => {
    const src = read('background', 'tab-manager.js');
    const body = src.slice(src.indexOf('async function ensureTabReadyForDispatch'));
    const blockerAt = body.indexOf('classifyUrl');
    expect(blockerAt).toBeGreaterThan(0);
    expect(blockerAt).toBeLessThan(body.indexOf("'tab_ineligible'"));
    expect(body).toMatch(/return \{ ok: false, reason: blockerUrl/);
  });

  test('dispatch ends the attempt at once with a user-action message and no retry', () => {
    const src = read('background', 'dispatch-coordinator.js');
    const start = src.indexOf("readiness.reason === 'captcha_required'");
    expect(start).toBeGreaterThan(0);
    const branch = src.slice(start, src.indexOf('if (!readiness.ok) {', start));
    expect(branch).toContain('проверку (CAPTCHA)');
    expect(branch).toContain('retryable: false');
    expect(branch).not.toContain('scheduleDispatchRetry');
    expect(branch).toContain('return;');
  });

  test('engine judges the reason without repeating the request and shows the human text', () => {
    const src = read('disput', 'custom-engine.js');
    expect(src).toContain("captcha_required: 'модель просит пройти проверку (CAPTCHA)");
    expect(src).toMatch(/verdict\.reason !== 'captcha_required'\) retry\.push/);
  });
});
