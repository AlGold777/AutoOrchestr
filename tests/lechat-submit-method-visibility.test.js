const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const LECHAT = fs.readFileSync(path.join(ROOT, 'content-scripts', 'content-lechat.js'), 'utf8');
const ROUTER = fs.readFileSync(path.join(ROOT, 'background', 'message-router.js'), 'utf8');
const PINNED = fs.readFileSync(path.join(ROOT, 'background', 'telemetry-logs.js'), 'utf8');

// Run 1785914453420 (Le Chat, 2026-08-05): the prompt was visibly inserted and
// visibly sent, but the export could not say what sent it. `sendComposer`
// confirmed submission only through ChatGPT/Claude-shaped `data-role` user-turn
// selectors and an English-only `aria-label*="Stop"` — none of which
// chat.mistral.ai emits in this deployment — so all four strategies ran,
// none confirmed, sendComposer threw, PROMPT_SUBMITTED never fired, and the
// run ended UNCERTAIN with submission stuck at evidence_partial.
describe('Le Chat submit method visibility', () => {
  test('Ctrl+Enter runs before the debugger-backed trusted Send', () => {
    const order = ['ctrl_enter', 'trusted_send']
      .map((method) => LECHAT.indexOf(`runStrategy('${method}'`));
    expect(order.every((index) => index > 0)).toBe(true);
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  test('submission can be confirmed without provider-specific turn attributes', () => {
    // The rendered-prompt check is the DOM-shape- and locale-independent proof.
    expect(LECHAT).toMatch(/countRenderedPromptTurns\s*\(\)\s*>\s*baselinePromptTurns/);
    expect(LECHAT).toMatch(/const baselinePromptTurns = countRenderedPromptTurns\(\)/);
  });

  test('generation evidence is not English-only', () => {
    const block = LECHAT.slice(
      LECHAT.indexOf('const collectGenerationEvidence'),
      LECHAT.indexOf('const baselineGenerationEvidence')
    );
    expect(block).toContain('button[data-testid*="stop" i]');
    expect(block).toMatch(/aria-label\*="Стоп"|aria-label\*="Остан"/);
  });

  test('a consumed composer stops the strategy chain instead of re-sending', () => {
    expect(LECHAT).toMatch(/if \(sawIndirectEvidence\) \{[\s\S]*?skipped_composer_consumed/);
    // Indirect evidence must never be upgraded to a confirmed submission.
    expect(LECHAT).toMatch(/evidence: 'indirect'/);
    expect(LECHAT).toMatch(/confirmed: submitEvidence === 'direct'/);
  });

  test('the submitting control is reported to telemetry on success and failure', () => {
    expect(LECHAT).toContain("event: 'PROVIDER_SUBMIT_METHOD_OBSERVED'");
    expect(LECHAT).toMatch(/reportSubmitMethod\('none', 'none'/);
    // After fix: submitMethod is pre-assigned to handle undefined case safely
    expect(LECHAT).toMatch(/const submitMethod = submitOutcome\?\.method \|\| 'unknown'/);
    expect(LECHAT).toMatch(/reportSubmitMethod\(submitMethod, submitEvidence/);
  });

  test('the submit method is pinned so it survives ring compaction', () => {
    expect(PINNED).toContain("'PROVIDER_SUBMIT_METHOD_OBSERVED'");
    expect(PINNED).toContain("'PROMPT_SUBMITTED_UNCONFIRMED'");
  });

  test('the router carries submitMethod on both accepted and unconfirmed submits', () => {
    const emitBlock = (label) => {
      const start = ROUTER.indexOf(`emitTelemetry(llmName, '${label}'`);
      expect(start).toBeGreaterThan(0);
      return ROUTER.slice(start, start + 900);
    };
    expect(emitBlock('PROMPT_SUBMITTED_ACCEPTED')).toContain('submitMethod: normalizedMeta.submitMethod');
    expect(emitBlock('PROMPT_SUBMITTED_UNCONFIRMED')).toContain('submitMethod: normalizedMeta.submitMethod');
  });
});
