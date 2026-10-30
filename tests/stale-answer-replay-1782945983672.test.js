// Regressions from run 1782945983672 (All Logs 20260702_00-55.md, v2.80.134):
// Grok's tab-scoped snapshot cache still held a 13037-char answer from an older
// conversation turn (different dispatch). The live inline scan re-picked the
// same text from the page and a manual ping force-finalized it as this run's
// SUCCESS; every status double-click was then a no-op because the true answer
// is shorter and the improvement rule only accepted longer text.
const fs = require('fs');
const path = require('path');

const read = (...p) => fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8');
const ORCH_SRC = read('background', 'job-orchestrator.js');

describe('stale cached answer replay guard (run 1782945983672)', () => {
  test('cached snapshot from a different dispatch is never served as the answer', () => {
    expect(ORCH_SRC).toContain('const cachedIsStaleForDispatch = Boolean(');
    expect(ORCH_SRC).toContain("String(cachedDispatchId) !== String(dispatchId)");
    expect(ORCH_SRC).toContain('const usableCached = cachedIsStaleForDispatch ? null : cached;');
    expect(ORCH_SRC).toContain('STALE_SNAPSHOT_SIGNATURE_EXCLUDED');
    // Both cached-answer return paths must go through usableCached.
    expect(ORCH_SRC).not.toMatch(/status: 'partial_from_snapshot',\s*\n\s*text: cached\.text/);
  });

  test('stale cached signature is excluded from the inline live scan candidates', () => {
    expect(ORCH_SRC).toContain('const staleSignature = normalizeAnswerSignatureBg(cached.text);');
    expect(ORCH_SRC).toContain('base.excludeTextSignatures = existingSignatures;');
    expect(ORCH_SRC).toContain('runInlineLateExtract({ tabId, llmName, minChars, manualRecovery: inlineScanOptions, enrich: !passiveFrame })');
  });

  test('manual latest recovery may replace a terminal answer with a shorter different candidate', () => {
    expect(ORCH_SRC).toContain('const replacesTerminalAnswer = Boolean(');
    expect(ORCH_SRC).toContain('manualLatestRecoveryRequested');
    expect(ORCH_SRC).toContain('!isStaleBaselineCandidate(entry, incomingText, replaceGuardDispatchId)');
    expect(ORCH_SRC).toContain("'Terminal answer replaced by manual latest recovery'");
    expect(ORCH_SRC).toContain('if (entry && (improvesTerminalAnswer || replacesTerminalAnswer)) {');
  });
});
