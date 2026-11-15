const fs = require('fs');
const path = require('path');

const read = (...parts) => fs.readFileSync(path.join(__dirname, '..', ...parts), 'utf8');

describe('manual latest-answer recovery from status indicator', () => {
  test('status indicator double-click requests latest recovery instead of cached answer', () => {
    const results = read('results.js');
    const router = read('background', 'message-router.js');

    expect(results).toContain('const manualLatestRecovery = options.manualLatestRecovery === true');
    expect(results).toContain("String(options.source || '').startsWith('status_indicator_')");
    expect(results).toContain('manualLatestRecovery,');
    expect(results).toContain("triggerManualPing(llmName, indicator, { source: 'status_indicator_dblclick' });");

    expect(router).toContain('const manualLatestRecovery = message.manualLatestRecovery === true;');
    expect(router).toContain('entry && entry.answer && !manualLatestRecovery');
    expect(router).toContain('!shouldAdvanceStrategy && !manualLatestRecovery');
    expect(router).toContain('manualLatestRecovery,');
  });

  test('orchestrator latest recovery uses bottom-most candidate and excludes current answer', () => {
    const orchestrator = read('background', 'job-orchestrator.js');

    expect(orchestrator).toContain('buildManualLatestRecoveryOptions');
    expect(orchestrator).toContain("manualLatestRecovery: true");
    expect(orchestrator).toContain("strategyId: strategy?.id || 'bottom_most'");
    expect(orchestrator).toContain('excludeTextSignatures');
    expect(orchestrator).toContain('!excludeTextSignatures.has(normalizeSignature(candidate.text))');
    expect(orchestrator).toContain("reason: manualLatestRecovery ? 'manual_latest_recovery' : 'manual_ping_late_collect'");
    expect(orchestrator).toContain('minChars: manualLatestRecovery ? (self.AnswerLengthPolicy?.DEFAULTS?.manualLatestMinChars || 20) : DOM_SNAPSHOT_RECOVERY_MIN_CHARS');
    expect(orchestrator).toContain('if (!manualLatestRecovery) {');
    expect(orchestrator).toContain('Skipping content-script getResponses to avoid replaying a stale cached answer');
    expect(orchestrator).toContain("if (state.state === 'ALIVE' && !manualLatestRecovery && !preferEnrichedGptHtml)");
    expect(orchestrator).toContain('if (!preferEnrichedGptHtml && liveEntry?.answer && String(liveEntry.answer).trim().length >= minChars)');
  });

  test('GPT late collect bypasses the short live-entry result for enriched HTML except passive frames', () => {
    const orchestrator = read('background', 'job-orchestrator.js');
    const lateCollect = orchestrator.slice(
      orchestrator.indexOf('async function lateCollectAnswer('),
      orchestrator.indexOf('\nfunction ', orchestrator.indexOf('async function lateCollectAnswer(') + 1)
    );

    expect(lateCollect).toContain("const preferEnrichedGptHtml = llmName === 'GPT' && !passiveFrame;");
    expect(lateCollect).toContain("if (state.state === 'ALIVE' && !manualLatestRecovery && !preferEnrichedGptHtml)");
    expect(lateCollect).toContain('if (!preferEnrichedGptHtml && liveEntry?.answer && String(liveEntry.answer).trim().length >= minChars)');
    expect(lateCollect).toContain('enrich: !passiveFrame');
  });

  test('repeated latest-recovery double-clicks rotate strategies instead of re-running bottom_most (run 1782944449199)', () => {
    const orchestrator = read('background', 'job-orchestrator.js');

    // First click is seeded to bottom_most, later clicks resolve the next
    // non-failed strategy; exhaustion restarts the rotation for explicit
    // user requests instead of dead-ending.
    expect(orchestrator).toContain('recovery.latestRecoveryStrategySeeded = true;');
    expect(orchestrator).toContain('recovery.strategyIndex = bottomMostIndex;');
    expect(orchestrator).toContain('let strategy = manualRecoveryRequested ? resolveManualRecoveryStrategy(recovery) : null;');
    expect(orchestrator).toContain('if (manualLatestRecovery && !strategy && recovery) {');
    expect(orchestrator).toContain('buildManualLatestRecoveryOptions(liveEntry, llmName, strategy, { keepCurrentAnswer: options.getIt === true })');
    // The hardcoded latest-recovery strategy object must be gone.
    expect(orchestrator).not.toContain("? { id: 'bottom_most', label: 'Latest visible answer candidate'");
  });

  test('user-initiated latest recovery is not blocked by the automation manual-ping budget', () => {
    const orchestrator = read('background', 'job-orchestrator.js');
    expect(orchestrator).toContain("? { ok: true, reason: 'user_initiated_latest_recovery' }");
    expect(orchestrator).toContain('const manualBudget = manualLatestRecovery');
  });

  test('orchestrator inline latest recovery has Claude-specific answer selectors', () => {
    const orchestrator = read('background', 'job-orchestrator.js');
    const claudeMap = orchestrator.slice(
      orchestrator.indexOf('claude: ['),
      orchestrator.indexOf("'z.ai': [")
    );

    expect(claudeMap).toContain('conversation-turn');
    expect(claudeMap).toContain('standard-markdown');
    expect(claudeMap).toContain('[data-is-response="true"]');
  });

  test('tokened-block override applies only to a short last block (qwen chat, 2026-11-15)', () => {
    const orchestrator = read('background', 'job-orchestrator.js');
    expect(orchestrator).toContain('manualOptions.manualLatestRecovery === true && best && best.text.length < 800');
  });
});
