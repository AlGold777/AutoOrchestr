// Locks the UI-recovery wiring fix: the main page must recover a hidden/collapsed
// shell promptly (on tab re-visibility and on run completion) instead of only on the
// 30s watchdog tick — the cause of "after a run the main page shows only the
// background for a while, then comes back".
const fs = require('fs');
const path = require('path');

const RESULTS_SRC = fs.readFileSync(path.join(__dirname, '..', 'results.js'), 'utf8');
const DEVTOOLS_SRC = fs.readFileSync(path.join(__dirname, '..', 'results-devtools.js'), 'utf8');
const BOOT_SRC = fs.readFileSync(path.join(__dirname, '..', 'results', 'boot-utils.js'), 'utf8');
const UI_BROADCAST_SRC = fs.readFileSync(path.join(__dirname, '..', 'background', 'ui-broadcast.js'), 'utf8');
const ORCHESTRATOR_SRC = fs.readFileSync(path.join(__dirname, '..', 'background', 'job-orchestrator.js'), 'utf8');
const DEBATE_CSS = fs.readFileSync(path.join(__dirname, '..', 'styles', 'results-debate.css'), 'utf8');

describe('main-page UI recovery triggers', () => {
  test('visibilitychange (becoming visible) triggers recovery, not just logging', () => {
    const idx = RESULTS_SRC.indexOf("addEventListener('visibilitychange'");
    expect(idx).toBeGreaterThan(-1);
    const block = RESULTS_SRC.slice(idx, idx + 1600);
    expect(block).toContain("document.visibilityState === 'visible'");
    expect(block).toContain("recoverUiIfHidden('visibilitychange')");
  });

  test('run completion triggers recovery', () => {
    expect(RESULTS_SRC).toContain("recoverUiIfHidden('run_complete')");
  });

  test('recovery defers via requestAnimationFrame so layout reports real sizes', () => {
    // Both triggers should double-rAF before measuring (avoid false collapse trigger).
    const visibilityAt = RESULTS_SRC.indexOf("recoverUiIfHidden('visibilitychange')");
    const visibilityBlock = RESULTS_SRC.slice(Math.max(0, visibilityAt - 180), visibilityAt + 220);
    expect(visibilityBlock).toContain('requestAnimationFrame(() => requestAnimationFrame(() => {');
    expect(RESULTS_SRC).toMatch(/requestAnimationFrame\(\(\) => requestAnimationFrame\(\(\) => recoverUiIfHidden\('run_complete'\)\)\)/);
  });

  test('background telemetry is cached without rebuilding hidden results DOM', () => {
    expect(RESULTS_SRC).toContain("document.visibilityState === 'hidden' || diagnosticsRenderTimer");
    expect(RESULTS_SRC).toContain('if (isDevtoolsModalVisible()) renderDiagnosticsModal()');
    expect(RESULTS_SRC).toContain('flushPendingDiagnosticsRenders()');
    expect(DEVTOOLS_SRC).toContain('const isTelemetrySurfaceVisible = () =>');
    expect(DEVTOOLS_SRC).toMatch(/refreshTelemetryBridge\(\);[\s\S]{0,400}renderTelemetryIfVisible\(\);/);
    expect(DEVTOOLS_SRC).toContain("document.addEventListener('devtools-visibility-change'");
  });

  test('recoverUiIfHidden still un-hides shell + clears hiding classes/styles', () => {
    // Guard the remediation contract the triggers rely on.
    expect(BOOT_SRC).toContain("classList.remove('pro-features-hidden', 'hidden')");
    expect(BOOT_SRC).toContain("resetGeometryState()");
  });

  test('global-state recovery hydrates an empty card from persisted answer payload', () => {
    expect(UI_BROADCAST_SRC).toContain('buildGlobalStateSnapshot({ includeAnswers: true })');
    expect(RESULTS_SRC).toContain("source: 'GLOBAL_STATE_ANSWER_RECOVERY'");
    expect(RESULTS_SRC).toContain('updateDebateModelCardOutput(llmName, answerText, answerHtml');
    expect(RESULTS_SRC).toContain('const finalHtml = resolveCompleteAnswerHtml(answerText, answerHtml);');
  });

  test('rendering falls back to committed text when rich HTML loses its tail', () => {
    expect(RESULTS_SRC).toContain('function resolveCompleteAnswerHtml(answerText = \'\', answerHtml = \'\')');
    expect(RESULTS_SRC).toContain('const missingTailChars = textProjection.length - htmlProjection.length;');
    expect(RESULTS_SRC).toContain('return htmlProjectionIsTruncated ? textHtml : sanitizedHtml;');
    expect(RESULTS_SRC).toContain('const formattedHtml = resolveCompleteAnswerHtml(text, html);');
  });

  test('results-page reload reconciles persisted answers instead of discarding them', () => {
    expect(RESULTS_SRC).toContain("const reconciliationState = response?.runtimeReset === true");
    expect(RESULTS_SRC).toContain('syncStatusFromGlobalState(reconciliationState, { replace: true });');
    expect(RESULTS_SRC).not.toContain('syncStatusFromGlobalState(pageWasReloaded ? {}');
  });

  test('manual ping success carries and applies the persisted answer as a backup channel', () => {
    expect(ORCHESTRATOR_SRC).toContain("answer: String(updatedEntry?.answer || result.text || '')");
    expect(RESULTS_SRC).toContain("source: 'MANUAL_PING_RESULT_RECOVERY'");
    expect(RESULTS_SRC).toContain("updateLLMPanelOutput(llmName, recoveredText, message.answerHtml || '', recoveryMeta)");
  });

  test('accepted answer is persisted before SUCCESS is published', () => {
    const guardAt = ORCHESTRATOR_SRC.indexOf('Persist accepted answer text before publishing SUCCESS');
    const block = ORCHESTRATOR_SRC.slice(guardAt, guardAt + 1000);
    expect(guardAt).toBeGreaterThan(-1);
    expect(block.indexOf('commitAcceptedAnswer(llmName, entry, normalizedAnswer, normalizedHtml')).toBeGreaterThan(-1);
    expect(block.indexOf('updateModelState(llmName, finalStatus, {'))
      .toBeGreaterThan(block.indexOf('commitAcceptedAnswer(llmName, entry, normalizedAnswer, normalizedHtml'));
    expect(RESULTS_SRC).toContain("const status = successWithoutAnswer ? 'UNCERTAIN' : rawStatus;");
  });

  test('a success message cannot paint a green live card before its answer is applied', () => {
    expect(RESULTS_SRC).toContain('const deferredSuccessStatusByModel = {};');
    expect(RESULTS_SRC).toContain("'READY': 'prompt-ready'");
    expect(RESULTS_SRC).toContain('indicatorHasAppliedAnswer(indicator, normalizedName)');
    expect(RESULTS_SRC).toContain("const renderedStatus = deferOnThisIndicator ? 'RECEIVING' : normalizedStatus;");
    expect(RESULTS_SRC).toContain('const deferred = deferredSuccessStatusByModel[llmName];');
    expect(RESULTS_SRC).not.toContain("source: 'PANEL_OUTPUT_HAS_ANSWER'");
    expect(RESULTS_SRC).not.toContain("source: 'PANEL_OUTPUT_HAS_ANSWER_RECOVERED'");
    const receivingAt = DEBATE_CSS.indexOf('.status-indicator.receiving');
    expect(DEBATE_CSS.slice(receivingAt, receivingAt + 180)).toContain('#f59e0b');
  });
});
