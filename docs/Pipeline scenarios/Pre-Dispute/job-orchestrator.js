// background/job-orchestrator.js
// Job lifecycle orchestration.

if (!self.__JOB_ORCHESTRATOR_INITIALIZED__) {
  self.__JOB_ORCHESTRATOR_INITIALIZED__ = true;
  (function initJobOrchestrator() {
    'use strict';

const ROUND0_OPEN_STAGGER_MS = 1000;
const ROUND0_BIND_WAIT_TIMEOUT_MS = 15000;
const ROUND0_BIND_POLL_MS = 250;
//- 1.1. Сокращаем подготовку -//
const ROUND1_BEFORE_SEND_MS = 2000;
//- 1.2. Round 1 sends the command quickly, but confirmation is handled explicitly in Round 2. -//
const ROUND1_POST_SEND_MS = 5000;
const ROUND_PROVIDER_PIPELINE_OWNERSHIP_TTL_MS = 180000;
const ROUND2_VISIT_COUNT = 2;
const ROUND2_VISIT_MIN_MS = 5000;
const ROUND2_VISIT_MAX_MS = 8000;
const ROUND2_BATCH_MAX_MS = 45000;
// A fixed 45s batch starved the tail: 9 models x ~7s visit budget need ~63s,
// so 3-4 models per full run systematically got "verification skipped
// (batch timeout)". The budget now scales with the batch size.
const ROUND2_MODEL_TIME_SLICE_MS = 8000;
const getRound2BatchBudgetMs = (modelCount) => Math.max(
  ROUND2_BATCH_MAX_MS,
  Math.max(1, Number(modelCount) || 1) * ROUND2_MODEL_TIME_SLICE_MS
);
const ROUND2_MODEL_VISIT_BUDGET_MS = 7000;
const ROUND2_MODEL_MIN_REMAINING_MS = 1800;
const ROUND2_MODEL_MIN_DWELL_MS = 1400;
const ROUND2_REPAIR_CONFIRM_WAIT_MS = 3500;
const ROUND2_REPAIR_CONFIRM_POLL_MS = 250;
const PRECOLLECT_NUDGE_STABILIZE_MS = 250;
//-- 4.1. Константа для Round 3 --//
const ROUND3_COLLECT_DELAY_MS = 2000;
const ROUND3_START_DELAY_MS = 2000;
const ROUND3_PRECOLLECT_VISIT_COUNT = 1;
const ROUND3_PRECOLLECT_VISIT_MIN_MS = 5000;
const ROUND3_PRECOLLECT_VISIT_MAX_MS = 8000;
const ROUND4_FOCUS_DELAY_MS = 500;
// Ladder: round4 gate closes AFTER the script hard stop (hard stop + 20s).
const ROUND4_PENDING_WAIT_MAX_SHORT_MS = 500000;
const ROUND4_PENDING_WAIT_MAX_LONG_MS = 950000;
const getRound4PendingWaitMaxMs = () => (self.isLongGenerationProfile?.()
  ? ROUND4_PENDING_WAIT_MAX_LONG_MS
  : ROUND4_PENDING_WAIT_MAX_SHORT_MS);
const ROUND4_PENDING_POLL_MS = 1500;
const ROUND4_GATE_WAIT_TELEMETRY_MS = 15000;
const NO_SEND_STALL_GRACE_MS = 45000;
// Round 2 repairs a dispatch whose prompt was never confirmed. This used to be an
// allowlist that predates stabilization and happened to exclude Perplexity and
// DeepSeek - the two providers whose send evidence is hardest to observe, i.e.
// exactly the ones that need the repair. The mechanism is provider-independent
// and already guarded by RecoveryIntent.authorize and the provider-pipeline
// ownership check, so it applies to every model unless explicitly opted out.
const ROUND2_REPAIR_OPT_OUT_MODELS = new Set();
const canRepairDispatchInRound2 = (llmName) => !!llmName && !ROUND2_REPAIR_OPT_OUT_MODELS.has(llmName);
const POST_R2_AUTO_COLLECT_DELAY_MS = 8000;
const POST_R2_AUTO_COLLECT_VISIT_COUNT = 1;
const POST_R2_AUTO_COLLECT_VISIT_MIN_MS = 5000;
const POST_R2_AUTO_COLLECT_VISIT_MAX_MS = 8000;
const CLAUDE_RETRY_VISIT_MIN_MS = 5000;
const CLAUDE_RETRY_VISIT_MAX_MS = 8000;
const CLAUDE_RETRY_DELAY_MS = 4000;
const CLAUDE_RETRY_FINALIZE_MS = 20000;
const MANUAL_PING_WINDOW_MS = 20000;
const ADAPTIVE_PROBE_FAST_WINDOW_MS = 20000;
const ADAPTIVE_PROBE_MEDIUM_WINDOW_MS = 60000;
const ADAPTIVE_PROBE_FAST_INTERVAL_MS = 2500;
const ADAPTIVE_PROBE_MEDIUM_INTERVAL_MS = 6000;
const ADAPTIVE_PROBE_SLOW_INTERVAL_MS = 12000;
// Ladder: recovery probes must OUTLIVE the hard stop they rescue from
// (run 1781134505984: probes died window_exhausted in the same second as the
// 180s hard stop). Window = hard stop + 60s per profile.
const ADAPTIVE_PROBE_TOTAL_WINDOW_SHORT_MS = 540000;
const ADAPTIVE_PROBE_TOTAL_WINDOW_LONG_MS = 990000;
const getAdaptiveProbeTotalWindowMs = () => (self.isLongGenerationProfile?.()
  ? ADAPTIVE_PROBE_TOTAL_WINDOW_LONG_MS
  : ADAPTIVE_PROBE_TOTAL_WINDOW_SHORT_MS);
const EARLY_GESTURE_RECOVERY_MODELS = new Set(['Gemini', 'Perplexity']);
const EARLY_GESTURE_RECOVERY_MIN_ELAPSED_MS = 45000;
const EARLY_GESTURE_RECOVERY_MIN_ERRORS = 3;
const EARLY_GESTURE_RECOVERY_COOLDOWN_MS = 30000;
const EARLY_GESTURE_RECOVERY_VISIT_MIN_MS = 2200;
const EARLY_GESTURE_RECOVERY_VISIT_MAX_MS = 3200;
const HARD_STOP_DEFER_WINDOW_DEFAULT_MS = 12000;
const HARD_STOP_DEFER_WINDOW_BY_MODEL_MS = Object.freeze({
  Gemini: 24000,
  Claude: 18000,
  'Le Chat': 18000,
  Perplexity: 18000,
  Grok: 18000
});
const HARD_STOP_ACTIVITY_GRACE_MS = 15000;
const HARD_STOP_DEFER_RECOVERY_MODELS = new Set(['GPT', 'Gemini', 'Claude', 'Le Chat', 'Perplexity', 'Grok', 'Z.ai', 'Kimi']);
const HARD_STOP_DEFER_RECOVERY_VISIT_MIN_MS = 2000;
const HARD_STOP_DEFER_RECOVERY_VISIT_MAX_MS = 3200;
const PRE_TERMINAL_MATERIALIZE_STATUSES = new Set(['NO_SEND', 'EXTRACT_FAILED', 'ERROR']);
const PRE_TERMINAL_MATERIALIZE_VISIT_MIN_MS = 5200;
const PRE_TERMINAL_MATERIALIZE_VISIT_MAX_MS = 7600;
const PRE_TERMINAL_MATERIALIZE_SCROLL_MAX_MS = 5600;
const PRE_TERMINAL_MATERIALIZE_SETTLE_MS = 1100;
const PRE_TERMINAL_MATERIALIZE_COOLDOWN_MS = 45000;
// Provider-independent recovery window for the race "the page accepted Send but
// the adapter missed the confirmation signal". Absolute offsets keep the window
// bounded even when an individual DOM probe is slow. No model allowlist: a future
// adapter gets the same protection as soon as it uses the common response path.
const UNCONFIRMED_SEND_OBSERVATION_OFFSETS_MS = Object.freeze([0, 10000, 30000, 65000, 110000, 165000]);
const UNCONFIRMED_SEND_RECOVERY_BUDGET = Object.freeze({
  snapshotAttempts: 2,
  inlineDomAttempts: 12,
  manualPingAttempts: 1,
  controlledVisitAttempts: 1,
  maxTotalMs: 210000
});
const TERMINAL_EXTRACTION_RECOVERY_DELAYS_MS = Object.freeze([12000, 35000, 75000]);
const TERMINAL_EXTRACTION_RECOVERY_REASONS = new Set([
  'empty_answer',
  'answer_prompt_echo',
  'answer_ui_noise',
  'extract_failed'
]);
const MATERIALIZE_LATEST_RETRY_WAIT_MS = 1800;
const MATERIALIZE_LATEST_RETRY_MODELS = new Set(['Qwen', 'Gemini', 'Le Chat', 'Perplexity', 'DeepSeek', 'Z.ai', 'Kimi']);
const FAST_PING_RETRY_DELAYS_MS = Object.freeze([700, 1500, 2600]);
const HARD_STOP_PING_RETRY_DELAYS_MS = Object.freeze([350, 900, 1700, 2800]);
const MODEL_FINAL_DEDUP_WINDOW_MS = 20000;
const RECOVERABLE_TERMINAL_MANUAL_PING_WINDOW_MS = 180000;
const RECOVERABLE_TERMINAL_PING_STATUSES = new Set(['EXTRACT_FAILED', 'NO_SEND', 'ERROR']);
const DOM_SNAPSHOT_RECOVERY_MODELS = new Set(['Gemini', 'Perplexity', 'Le Chat', 'Qwen', 'DeepSeek', 'Z.ai', 'Kimi']);
const DOM_SNAPSHOT_RECOVERY_MIN_CHARS = self.AnswerLengthPolicy?.DEFAULTS?.minTerminalChars || 80;
const DOM_SNAPSHOT_RECOVERY_COOLDOWN_MS = 5000;
// On a follow-up into an existing conversation tab (attach_existing), the previous
// answer is already on the page. Until the freshly-submitted prompt renders a new
// answer, every recovery/snapshot/answer-start path reads that *prior* answer and
// would finalize it as a false success. The adapter reports a baseline signature of
// the on-page answer *before* it sends (mirrors content-claude's claudeDispatchBaseline),
// and we reject any candidate whose normalized signature equals it. Bounded by a time
// window so a legitimately-identical re-answer can't wedge the run open forever.
// Ladder: the stale-baseline guard must survive the whole legal generation
// window (content hardMax + 60s), otherwise it dies exactly in long runs
// where the previous-answer protection matters most.
const BASELINE_GUARD_WINDOW_SHORT_MS = 510000;
const BASELINE_GUARD_WINDOW_LONG_MS = 960000;
const getBaselineGuardWindowMs = () => (self.isLongGenerationProfile?.()
  ? BASELINE_GUARD_WINDOW_LONG_MS
  : BASELINE_GUARD_WINDOW_SHORT_MS);
function normalizeAnswerSignatureBg(text) {
  return String(text || '').replace(/\s+/g, ' ').trim().toLowerCase();
}
function hashAnswerSignatureBg(text) {
  return hashEvidenceText(normalizeAnswerSignatureBg(text));
}
function isStaleBaselineCandidate(entry, text, dispatchId = null) {
  if (!entry || !entry.preDispatchAnswerSignature) return false;
  const capturedAt = Number(entry.preDispatchAnswerCapturedAt || 0);
  if (capturedAt && (Date.now() - capturedAt) > getBaselineGuardWindowMs()) return false;
  const baseDispatch = entry.preDispatchAnswerDispatchId || null;
  if (baseDispatch && dispatchId && baseDispatch !== dispatchId) return false;
  const sig = normalizeAnswerSignatureBg(text);
  if (!sig) return false;
  if (entry.preDispatchAnswerHash && hashAnswerSignatureBg(sig) === entry.preDispatchAnswerHash) return true;
  return sig === entry.preDispatchAnswerSignature;
}
const LATE_COLLECT_CACHE_KEY_PREFIX = 'late_answer_snapshot_v1';
const LATE_COLLECT_CACHE_MAX_CHARS = 50000;
const LATE_COLLECT_TOTAL_BUDGET_MS = 12000;
const LATE_COLLECT_PING_TIMEOUT_MS = 900;
const LATE_COLLECT_SLOW_PING_TIMEOUT_MS = 1500;
const LATE_COLLECT_EXECUTE_TIMEOUT_MS = 3500;
const LATE_COLLECT_POST_LIVE_WAIT_MS = 700;
const LATE_COLLECT_SINGLE_FLIGHT_COOLDOWN_MS = 2500;
const UNAVAILABLE_OBSERVATION_RETRY_DELAYS_MS = Object.freeze([2000, 7000, 20000, 45000, 90000]);
var lateCollectExecutionMutex = Promise.resolve();

function withLateCollectExecutionLock(operation) {
  const run = lateCollectExecutionMutex.then(
    () => Promise.resolve(operation()),
    () => Promise.resolve(operation())
  );
  lateCollectExecutionMutex = run.catch(() => undefined);
  return run;
}
const LATE_COLLECT_SNAPSHOT_TTL_MS = 60 * 60 * 1000;
const LATE_COLLECT_SLOW_MODELS = new Set(['Gemini', 'Claude', 'Qwen', 'DeepSeek', 'Le Chat', 'Perplexity', 'Z.ai', 'Kimi']);
const RECOVERY_BUDGET_DEFAULT = Object.freeze({
  snapshotAttempts: 2,
  inlineDomAttempts: 2,
  manualPingAttempts: 1,
  controlledVisitAttempts: 1,
  maxTotalMs: 90000
});
// Models whose stream connection tends to drop mid-generation (message port closed),
// pushing them onto the snapshot path before completion evidence exists -> false PARTIAL
// even when the salvaged text is complete (e.g. Gemini). Give them more recovery
// attempts/time so they can re-read a *completed* DOM and finalize SUCCESS, instead of
// bailing to a snapshot-cache PARTIAL. This does NOT relax the completion guard — it just
// gives the model a fairer chance to reach genuine completion.
const CONNECTION_FRAGILE_RECOVERY_MODELS = new Set(['Gemini', 'Perplexity']);
const RECOVERY_BUDGET_CONNECTION_FRAGILE = Object.freeze({
  snapshotAttempts: 3,
  inlineDomAttempts: 3,
  manualPingAttempts: 2,
  controlledVisitAttempts: 1,
  maxTotalMs: 120000
});
function getRecoveryBudgetForModel(llmName) {
  return CONNECTION_FRAGILE_RECOVERY_MODELS.has(llmName)
    ? RECOVERY_BUDGET_CONNECTION_FRAGILE
    : RECOVERY_BUDGET_DEFAULT;
}
const lateAnswerSnapshotMemory = new Map();
const lateAnswerCollectInFlight = new Map();
const MANUAL_RECOVERY_STRATEGIES = Object.freeze([
  { id: 'default_score', label: 'Default selector score' },
  { id: 'last_visible', label: 'Last visible answer candidate' },
  { id: 'bottom_most', label: 'Bottom-most answer candidate' },
  { id: 'longest', label: 'Longest answer candidate' },
  { id: 'markdown_only', label: 'Markdown/prose answer candidate' },
  { id: 'assistant_role_only', label: 'Assistant-role answer candidate' },
  { id: 'article_bottom', label: 'Bottom article answer candidate' }
]);
// ─── Finalization timings (single config block) ───────────────────────────────
// All deferred/stable-pending finalization thresholds live here so they can be
// tuned in one place. Values unchanged from before consolidation.
const DEFER_STREAM_FINAL_MODELS = new Set(['GPT', 'Gemini', 'Claude', 'Le Chat', 'Perplexity', 'Grok', 'Qwen', 'DeepSeek', 'Z.ai', 'Kimi']);
const SUSPECT_SHORT_DEFER_MODELS = new Set(['Z.ai']);
const DEFER_STREAM_FINAL_RECHECK_MS = 8000;        // base recheck interval while deferred
const DEFER_STREAM_FINAL_RECHECK_MAX_MS = 32000;   // cap after backoff on unchanged text
const DEFER_STREAM_FINAL_RECHECK_BACKOFF = 1.6;    // multiplier per consecutive unchanged defer
const DEFER_STREAM_FINAL_MAX_SHORT_MS = 460000;
const DEFER_STREAM_FINAL_MAX_LONG_MS = 910000;
const getDeferStreamFinalMaxMs = () => (self.isLongGenerationProfile?.()
  ? DEFER_STREAM_FINAL_MAX_LONG_MS
  : DEFER_STREAM_FINAL_MAX_SHORT_MS);
const DEFER_STREAM_STABLE_FORCE_MS = 30000;
const DEFER_STREAM_STABLE_FORCE_MIN_CHARS = self.AnswerLengthPolicy?.DEFAULTS?.stableForceMinChars || 1200;
// T3 (timing review): one definition of "stable enough to finalize". The
// 15s auto-finalize undercut the 30s defer stable-force rule for the same
// pending answer; both now share DEFER_STREAM_STABLE_FORCE_MS.
const STABLE_PENDING_AUTO_FINALIZE_MS = DEFER_STREAM_STABLE_FORCE_MS;
// Compute the next deferred-recheck delay: back off geometrically while the pending
// answer length is not growing, so a stuck stream stops re-pinging every 8s for minutes.
function nextDeferRecheckDelay(entry, pendingAnswerLength) {
  if (!entry) return DEFER_STREAM_FINAL_RECHECK_MS;
  const prevLen = Number(entry.deferRecheckLastLen);
  if (pendingAnswerLength > 0 && pendingAnswerLength === prevLen) {
    entry.deferRecheckUnchanged = (Number(entry.deferRecheckUnchanged) || 0) + 1;
  } else {
    entry.deferRecheckUnchanged = 0;
  }
  entry.deferRecheckLastLen = pendingAnswerLength;
  return Math.min(
    DEFER_STREAM_FINAL_RECHECK_MAX_MS,
    Math.round(DEFER_STREAM_FINAL_RECHECK_MS * Math.pow(DEFER_STREAM_FINAL_RECHECK_BACKOFF, entry.deferRecheckUnchanged))
  );
}
const EARLY_TERMINAL_GUARD_MODELS = new Set(['GPT', 'Gemini', 'Claude', 'Le Chat', 'Perplexity', 'Grok', 'Qwen', 'DeepSeek', 'Z.ai', 'Kimi']);
const EARLY_TERMINAL_GUARD_FORCE_SUCCESS_CHARS = self.AnswerLengthPolicy?.DEFAULTS?.earlyGuardForceSuccessChars || 1800;
const EARLY_TERMINAL_GUARD_MAX_WAIT_MS = 20000;
const EARLY_TERMINAL_GUARD_STABLE_MS = 2500;
const EARLY_TERMINAL_GUARD_REPING_MS = 2200;
//- 1.2. Увеличиваем общий лимит раунда, чтобы он никогда не обрывался на середине списка -//
const DISPATCH_BUDGET_MS = 120000;
// Internal "short" remains the legacy boolean-off branch, but is now the
// user-facing Standard profile (the former 450s Long behavior).
const GENERATION_BUDGET_SHORT_MS = 450000;
const GENERATION_BUDGET_LONG_MS = 900000;
const COLLECT_BUDGET_MS = 60000;

const resolveBudgetMsForPhase = (phase) => {
  switch (String(phase || '').toLowerCase()) {
    case 'dispatch':
      return DISPATCH_BUDGET_MS;
    case 'generation':
      return self.isLongGenerationProfile?.()
        ? GENERATION_BUDGET_LONG_MS
        : GENERATION_BUDGET_SHORT_MS;
    case 'collect':
      return COLLECT_BUDGET_MS;
    default:
      return 0;
  }
};

const ensureBudgetStore = (entry) => {
  if (!entry) return null;
  if (!entry.budgetTimers || typeof entry.budgetTimers !== 'object') {
    entry.budgetTimers = {};
  }
  return entry.budgetTimers;
};
const runtimeBudgetTimerIds = new Set();

const isTerminalEntry = (entry) => {
  if (!entry) return false;
  if (self.ModelRunState?.isTerminalRunState && self.ModelRunState.isTerminalRunState(entry)) return true;
  const terminalStatuses = Array.isArray(TERMINAL_STATUSES) ? TERMINAL_STATUSES : ['COPY_SUCCESS'];
  if (terminalStatuses.includes(entry.status)) return true;
  if (entry.finalStatusRecorded || entry.finalStatus) return true;
  return false;
};

const isFinalizedEntry = (entry) => {
  if (!entry) return false;
  if (self.ModelRunState?.isTerminalRunState && self.ModelRunState.isTerminalRunState(entry)) return true;
  return Boolean(entry.finalStatusRecorded || entry.finalStatus);
};

function extractLatestAssistantSnapshotInPage(modelName, minChars = 80, options = {}) {
  const normalizedModel = String(modelName || '').toLowerCase();
  const manualOptions = options && typeof options === 'object' ? options : {};
  const normalizeSignature = (value = '') => String(value || '').replace(/\s+/g, ' ').trim().toLowerCase();
  const excludeTextSignatures = new Set(
    (Array.isArray(manualOptions.excludeTextSignatures) ? manualOptions.excludeTextSignatures : [])
      .map(normalizeSignature)
      .filter(Boolean)
  );
  const strategyIds = [
    'default_score',
    'last_visible',
    'bottom_most',
    'longest',
    'markdown_only',
    'assistant_role_only',
    'article_bottom'
  ];
  const skipStrategyIds = new Set(Array.isArray(manualOptions.skipStrategyIds) ? manualOptions.skipStrategyIds.map(String) : []);
  const skipSelectors = new Set(Array.isArray(manualOptions.skipSelectors) ? manualOptions.skipSelectors.map(String) : []);
  const requestedStrategyId = typeof manualOptions.strategyId === 'string' ? manualOptions.strategyId : '';
  const requestedStrategyIndex = Number.isFinite(Number(manualOptions.strategyIndex)) ? Number(manualOptions.strategyIndex) : 0;
  const resolveStrategyId = () => {
    if (requestedStrategyId && strategyIds.includes(requestedStrategyId) && !skipStrategyIds.has(requestedStrategyId)) {
      return requestedStrategyId;
    }
    for (let offset = 0; offset < strategyIds.length; offset += 1) {
      const id = strategyIds[(requestedStrategyIndex + offset) % strategyIds.length];
      if (!skipStrategyIds.has(id)) return id;
    }
    return 'default_score';
  };
  const strategyId = resolveStrategyId();
  const strategyIndex = Math.max(0, strategyIds.indexOf(strategyId));
  const selectorMap = {
    gemini: [
      'model-response',
      '.model-response-text',
      'message-content',
      '[data-test-id="model-response-text"]',
      '[data-message-author-role="assistant"]',
      '[data-role="assistant"]',
      'div[class*="model-response"]',
      '.markdown',
      'article'
    ],
    perplexity: [
      '[data-testid="answer-card"]',
      '[data-testid="answer-card"] .prose',
      '[data-testid="answer"]',
      '[data-testid="answer"] .prose',
      '[data-testid="chat-message"] .prose',
      '[data-testid="conversation-turn"] .prose',
      '[class*="answer-container" i] .prose',
      '.answer',
      '.prose',
      'article'
    ],
    'le chat': [
      'div[data-testid="lechat-response"] .prose',
      '[data-testid="answer"] .prose',
      '[data-testid="message-content"]',
      'div[class*="message-content" i]',
      '[role="article"] .prose',
      'article .prose',
      '.prose',
      '.answer',
      '.result'
    ],
    qwen: [
      'div.qwen-chat-message.qwen-chat-message-assistant div.response-message-content div.custom-qwen-markdown > div.qwen-markdown.qwen-markdown-loose',
      'div.qwen-chat-message-assistant div.chat-response-message-right div.response-message-content div.custom-qwen-markdown .qwen-markdown.qwen-markdown-loose',
      'div.qwen-chat-message-assistant div.custom-qwen-markdown .qwen-markdown',
      'div.qwen-chat-message.qwen-chat-message-assistant div.qwen-markdown.qwen-markdown-loose',
      '[data-testid="chat-response"] .qwen-markdown',
      '[data-testid="chat-response"] .custom-qwen-markdown',
      'div.custom-qwen-markdown',
      'div.qwen-markdown.qwen-markdown-loose'
    ],
    deepseek: [
      '.message-item[data-role="assistant"] .markdown-body',
      '.message-item[data-role="assistant"] .message-content',
      '[data-role="assistant"] .markdown-body',
      '[data-role="assistant"] .message-content',
      'div.ds-message div.ds-markdown',
      '.assistant-message .markdown-body',
      '.assistant-message',
      '.markdown-body',
      '.message-content'
    ],
    claude: [
      'div[data-testid="conversation-turn"][data-author-role="assistant"] div.standard-markdown.grid-cols-1',
      'div[data-testid="conversation-turn"][data-role="assistant"] div.standard-markdown.grid-cols-1',
      'div[data-is-response="true"] div.font-claude-response.relative div.standard-markdown.grid-cols-1',
      'div[data-is-response="true"] div.standard-markdown.grid-cols-1',
      'div[data-testid="conversation-turn"][data-author-role="assistant"] [data-testid="message-text"]',
      'div[data-testid="conversation-turn"][data-role="assistant"] [data-testid="message-text"]',
      'div[data-is-response="true"] [data-testid="message-text"]',
      'div[data-testid="conversation-turn"][data-author-role="assistant"] article',
      'div[data-testid="conversation-turn"][data-role="assistant"] article',
      'div[data-is-response="true"] article',
      '[data-testid="conversation-turn"][data-author-role="assistant"]',
      '[data-testid="conversation-turn"][data-role="assistant"]',
      '[data-is-response="true"]',
      '.font-claude-response .standard-markdown',
      '.standard-markdown.grid-cols-1'
    ],
    'z.ai': [
      '.chat-assistant.markdown-prose',
      '[id^="message-"] .chat-assistant.markdown-prose',
      '[data-message-author-role="assistant"]',
      '[data-role="assistant"]',
      '[data-testid*="assistant" i]',
      '[class*="assistant-message"]',
      '[class*="assistant" i] [class*="markdown" i]'
    ]
  };
  const genericSelectors = [
    '[data-message-author-role="assistant"]',
    '[data-role="assistant"]',
    '[data-testid*="assistant" i]',
    '.assistant-message',
    '[class*="assistant" i] .markdown',
    '[class*="assistant" i] .prose',
    '.markdown',
    '.markdown-body',
    '.prose',
    'article',
    '[role="article"]'
  ];
  const selectors = selectorMap[normalizedModel] || genericSelectors;
  const seen = new Set();
  const nodes = [];
  const nodeSelectors = new Map();
  const walkRoot = (root) => {
    if (!root?.querySelectorAll) return;
    selectors.forEach((selector) => {
      try {
        root.querySelectorAll(selector).forEach((node) => {
          if (node && !seen.has(node)) {
            seen.add(node);
            nodes.push(node);
            nodeSelectors.set(node, selector);
          }
        });
      } catch (_) {}
    });
    try {
      root.querySelectorAll('*').forEach((node) => {
        if (node?.shadowRoot) walkRoot(node.shadowRoot);
      });
    } catch (_) {}
  };
  walkRoot(document);
  const isRejectedNode = (node) => {
    const tag = String(node?.tagName || '').toLowerCase();
    if (['input', 'textarea', 'button', 'nav', 'header', 'footer', 'form'].includes(tag)) return true;
    if (node?.closest?.('textarea,input,button,nav,header,footer,form,[contenteditable="true"]')) return true;
    return false;
  };
  const getText = (node) => String(node?.innerText || node?.textContent || '').replace(/\s+/g, ' ').trim();
  const hashText = (value = '') => {
    const text = String(value || '');
    let hash = 2166136261;
    for (let i = 0; i < text.length; i += 1) {
      hash ^= text.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(16);
  };
  let baseCandidates = nodes
    .filter((node) => node && !isRejectedNode(node))
    .map((node, index) => {
      const text = getText(node);
      let visible = true;
      let rectTop = 0;
      let rectBottom = 0;
      try {
        const style = window.getComputedStyle(node);
        const rect = node.getBoundingClientRect();
        visible = style.display !== 'none' && style.visibility !== 'hidden' && node.getClientRects().length > 0;
        rectTop = Number(rect?.top || 0);
        rectBottom = Number(rect?.bottom || 0);
      } catch (_) {}
      const selector = nodeSelectors.get(node) || '';
      const descriptor = `${selector}#${index}`;
      const className = String(node.className || '');
      const html = String(node.innerHTML || '').trim();
      const isMarkdown = /markdown|prose|qwen-markdown|markdown-body/i.test(`${selector} ${className}`);
      const assistantNode = node.closest?.('[data-message-author-role="assistant"],[data-role="assistant"],.assistant-message,.qwen-chat-message-assistant,[class*="assistant" i]');
      const isAssistantRole = !!assistantNode;
      const isArticle = selector.includes('article') || !!node.closest?.('article,[role="article"]');
      return {
        index,
        text,
        html,
        selector,
        descriptor,
        visible,
        rectTop,
        rectBottom,
        isMarkdown,
        isAssistantRole,
        isArticle,
        score: (visible ? 1000000 : 0) + index
      };
    })
    .filter((candidate) => candidate.text.length >= minChars)
    .filter((candidate) => !excludeTextSignatures.has(normalizeSignature(candidate.text)))
    .filter((candidate) => !skipSelectors.has(candidate.selector) && !skipSelectors.has(candidate.descriptor));
  // F6.2: positional turn anchor from the dispatch baseline — candidates that
  // were already on the page before this dispatch are previous conversation
  // turns. Best-effort: the scan's candidate space differs from the pipeline's,
  // so the filter applies only when it leaves at least one candidate.
  const hasCapturedAnchor = manualOptions.anchorAnswerCount !== null
    && manualOptions.anchorAnswerCount !== undefined
    && Number.isFinite(Number(manualOptions.anchorAnswerCount));
  const anchorAnswerCount = hasCapturedAnchor ? Math.max(0, Number(manualOptions.anchorAnswerCount)) : 0;
  let anchorApplied = false;
  if (hasCapturedAnchor && baseCandidates.length > anchorAnswerCount) {
    const byPosition = baseCandidates.slice().sort((a, b) => (a.rectTop - b.rectTop) || (a.index - b.index));
    const allowed = new Set(byPosition.slice(anchorAnswerCount));
    const positionallyNew = baseCandidates.filter((candidate) => allowed.has(candidate));
    if (positionallyNew.length) {
      baseCandidates = positionallyNew;
      anchorApplied = true;
    }
  }
  const filterByStrategy = (items) => {
    if (strategyId === 'markdown_only') return items.filter((candidate) => candidate.isMarkdown);
    if (strategyId === 'assistant_role_only') return items.filter((candidate) => candidate.isAssistantRole);
    if (strategyId === 'article_bottom') return items.filter((candidate) => candidate.isArticle);
    return items;
  };
  const scoreByStrategy = (candidate) => {
    if (strategyId === 'last_visible') return (candidate.visible ? 1000000 : 0) + candidate.index;
    if (strategyId === 'bottom_most' || strategyId === 'article_bottom') return (candidate.visible ? 1000000 : 0) + candidate.rectBottom;
    if (strategyId === 'longest') return candidate.text.length;
    return candidate.score;
  };
  let candidates = filterByStrategy(baseCandidates);
  if (!candidates.length && strategyId !== 'default_score') {
    candidates = baseCandidates;
  }
  candidates = candidates
    .map((candidate) => ({ ...candidate, strategyScore: scoreByStrategy(candidate) }))
    .sort((a, b) => b.strategyScore - a.strategyScore);
  const best = candidates[0] || null;
  return best
    ? {
      ok: true,
      text: best.text,
      html: best.html,
      length: best.text.length,
      visible: best.visible,
      candidates: candidates.length,
      candidateCount: baseCandidates.length,
      strategyId,
      strategyIndex,
      selectorUsed: best.selector,
      selectorDescriptor: best.descriptor,
      textHash: hashText(best.text),
      anchorApplied
    }
    : {
      ok: false,
      length: 0,
      candidates: 0,
      candidateCount: baseCandidates.length,
      strategyId,
      strategyIndex,
      anchorApplied
    };
}

const normalizeSnapshotKeyPart = (value) => String(value || 'none')
  .replace(/[^a-z0-9_-]+/gi, '_')
  .slice(0, 96);

const buildAnswerSnapshotKey = ({ llmName, runSessionId, dispatchId, tabId } = {}) => [
  LATE_COLLECT_CACHE_KEY_PREFIX,
  normalizeSnapshotKeyPart(llmName),
  normalizeSnapshotKeyPart(runSessionId || 'session'),
  normalizeSnapshotKeyPart(dispatchId || 'dispatch'),
  normalizeSnapshotKeyPart(tabId || 'tab')
].join(':');

const normalizeLateAnswerText = (value, maxChars = LATE_COLLECT_CACHE_MAX_CHARS) => String(value || '')
  .replace(/\s+/g, ' ')
  .trim()
  .slice(0, Math.max(0, Number(maxChars) || LATE_COLLECT_CACHE_MAX_CHARS));

const simpleLateAnswerHash = (value = '') => {
  const text = String(value || '');
  let hash = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16);
};

const getCurrentRunSessionId = () => Number(jobState?.session?.startTime || 0) || null;

const resolveLateCollectDispatchId = (llmName, meta = {}) => {
  const entry = llmName ? jobState?.llms?.[llmName] : null;
  return meta?.dispatchId || entry?.lastDispatchMeta?.dispatchId || null;
};

async function saveAnswerSnapshotFromContent(message = {}, sender = {}) {
  const tabId = sender?.tab?.id || message?.tabId || null;
  const llmName = message?.llmName || (tabId ? TabMapManager.getNameByTabId(tabId) : null);
  if (!llmName || !isValidTabId(tabId)) {
    return { status: 'snapshot_ignored', reason: 'missing_llm_or_tab' };
  }
  const text = normalizeLateAnswerText(message?.text || message?.answer || '');
  if (text.length < DOM_SNAPSHOT_RECOVERY_MIN_CHARS) {
    return { status: 'snapshot_ignored', reason: 'too_short' };
  }
  const meta = message?.meta && typeof message.meta === 'object' ? message.meta : {};
  const runSessionId = meta.runSessionId || meta.sessionId || getCurrentRunSessionId() || null;
  const dispatchId = meta.dispatchId || resolveLateCollectDispatchId(llmName, meta);
  const entry = jobState?.llms?.[llmName] || null;
  if (isStaleBaselineCandidate(entry, text, dispatchId)) {
    emitTelemetry(llmName, 'SNAPSHOT_STALE_BASELINE_SKIPPED', {
      level: 'warning',
      details: `len=${text.length}`,
      meta: { dispatchId, tabId, runSessionId }
    });
    return { status: 'snapshot_ignored', reason: 'stale_baseline_answer' };
  }
  const key = buildAnswerSnapshotKey({ llmName, runSessionId, dispatchId, tabId });
  const payload = {
    llmName,
    tabId,
    text,
    html: typeof message?.html === 'string' ? message.html.slice(0, LATE_COLLECT_CACHE_MAX_CHARS) : '',
    hash: message?.hash || simpleLateAnswerHash(text),
    length: text.length,
    url: typeof message?.url === 'string' ? message.url.slice(0, 1024) : '',
    meta: {
      runSessionId,
      sessionId: runSessionId,
      dispatchId,
      tabSessionId: meta.tabSessionId || null
    },
    updatedAt: Date.now()
  };
  const aliasKeys = Array.from(new Set([
    key,
    buildAnswerSnapshotKey({ llmName, runSessionId, dispatchId: null, tabId }),
    buildAnswerSnapshotKey({ llmName, runSessionId: null, dispatchId: null, tabId })
  ]));
  aliasKeys.forEach((aliasKey) => lateAnswerSnapshotMemory.set(aliasKey, payload));
  if (self.CompressedStorage?.set) {
    try {
      await Promise.all(aliasKeys.map((aliasKey) => self.CompressedStorage.set(aliasKey, payload)));
    } catch (err) {
      console.warn('[LateAnswerCollector] snapshot storage failed', err);
    }
  }
  return { status: 'snapshot_saved', key, length: payload.length, hash: payload.hash };
}

async function readAnswerSnapshotCache({ llmName, runSessionId, dispatchId, tabId } = {}) {
  const keys = [
    buildAnswerSnapshotKey({ llmName, runSessionId, dispatchId, tabId }),
    buildAnswerSnapshotKey({ llmName, runSessionId, dispatchId: null, tabId }),
    buildAnswerSnapshotKey({ llmName, runSessionId: null, dispatchId: null, tabId })
  ];
  const isFreshSnapshot = (entry) => {
    const updatedAt = Number(entry?.updatedAt || 0);
    return updatedAt > 0 && (Date.now() - updatedAt) <= LATE_COLLECT_SNAPSHOT_TTL_MS;
  };
  for (const key of keys) {
    const memoryValue = lateAnswerSnapshotMemory.get(key);
    if (!memoryValue?.text) continue;
    if (isFreshSnapshot(memoryValue)) return memoryValue;
    lateAnswerSnapshotMemory.delete(key);
  }
  if (self.CompressedStorage?.get) {
    for (const key of keys) {
      try {
        const stored = await self.CompressedStorage.get(key);
        if (!stored?.text) continue;
        if (isFreshSnapshot(stored)) {
          lateAnswerSnapshotMemory.set(key, stored);
          return stored;
        }
        lateAnswerSnapshotMemory.delete(key);
        if (self.CompressedStorage?.remove) {
          await self.CompressedStorage.remove(key);
        }
      } catch (_) {}
    }
  }
  return null;
}

async function clearLateAnswerSnapshotCache(reason = 'new_run') {
  lateAnswerSnapshotMemory.clear();
  if (!chrome?.storage?.local?.get || !chrome?.storage?.local?.remove) {
    return { ok: true, removed: 0, reason: 'storage_unavailable' };
  }
  try {
    const all = await chrome.storage.local.get(null);
    const keys = Object.keys(all || {}).filter((key) => key.startsWith(`${LATE_COLLECT_CACHE_KEY_PREFIX}:`));
    if (keys.length) {
      await chrome.storage.local.remove(keys);
    }
    return { ok: true, removed: keys.length, reason };
  } catch (err) {
    console.warn('[LateAnswerCollector] snapshot cache cleanup failed', err);
    return { ok: false, removed: 0, reason, error: err?.message || String(err) };
  }
}

const withLateCollectTimeout = (promise, timeoutMs, fallback) => new Promise((resolve) => {
  let settled = false;
  const timer = registerSessionTimer(setTimeout(() => {
    if (settled) return;
    settled = true;
    deregisterSessionTimer(timer);
    resolve(typeof fallback === 'function' ? fallback() : fallback);
  }, Math.max(1, Number(timeoutMs) || 1)));
  Promise.resolve(promise)
    .then((value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      deregisterSessionTimer(timer);
      resolve(value);
    })
    .catch((err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      deregisterSessionTimer(timer);
      resolve(typeof fallback === 'function' ? fallback(err) : fallback);
    });
});

const sendTabMessageForLateCollect = (tabId, payload, timeoutMs) => withLateCollectTimeout(new Promise((resolve) => {
  try {
    chrome.tabs.sendMessage(tabId, payload, (response) => {
      const errMsg = chrome.runtime.lastError?.message || '';
      if (errMsg) {
        resolve({ ok: false, error: errMsg });
        return;
      }
      resolve({ ok: true, response });
    });
  } catch (err) {
    resolve({ ok: false, error: err?.message || String(err) });
  }
}), timeoutMs, (err) => ({ ok: false, error: err?.message || 'timeout' }));

async function classifyLateCollectState(tabId, llmName, options = {}) {
  const tab = await getTabSafe(tabId);
  if (!tab) return { state: 'DEAD', reason: 'tab_missing' };
  if (tab.discarded === true) return { state: 'DEAD', reason: 'tab_discarded', tab: buildTabSnapshot(tab) };
  if (!isEligibleTabForLlm(llmName, tab)) return { state: 'DEAD', reason: 'tab_ineligible', tab: buildTabSnapshot(tab) };
  // Get it has just prepared the visible page and uses inline extraction.
  // A content-script ping and a second scripting probe add no prerequisite.
  if (options.inlineOnly === true) return { state: 'REINJECTABLE', reason: 'manual_inline_collection', tab: buildTabSnapshot(tab) };
  const pingTimeout = LATE_COLLECT_SLOW_MODELS.has(llmName) ? LATE_COLLECT_SLOW_PING_TIMEOUT_MS : LATE_COLLECT_PING_TIMEOUT_MS;
  const ping = await sendTabMessageForLateCollect(tabId, {
    action: 'LATE_COLLECT_PING',
    type: 'LATE_COLLECT_PING',
    llmName
  }, pingTimeout);
  if (ping?.ok) {
    return { state: 'ALIVE', reason: 'content_script_ping_ok', tab: buildTabSnapshot(tab), ping: ping.response || null };
  }
  const probe = await withLateCollectExecutionLock(() => withLateCollectTimeout(chrome.scripting.executeScript({
    target: { tabId },
    func: () => ({
      ok: true,
      href: location.href,
      readyState: document.readyState,
      hasBody: !!document.body
    })
  }), LATE_COLLECT_EXECUTE_TIMEOUT_MS, (err) => ({ ok: false, error: err?.message || 'execute_timeout' })));
  const probeOk = Array.isArray(probe) && probe.some((item) => item?.result?.ok);
  if (probeOk) {
    return { state: 'REINJECTABLE', reason: 'execute_script_probe_ok', tab: buildTabSnapshot(tab), pingError: ping?.error || null };
  }
  return {
    // The tab still exists, is eligible and is not discarded. A timed-out or
    // rejected scripting call is therefore a temporary observation failure,
    // not proof that the page is dead or that generation has ended.
    state: 'UNAVAILABLE',
    reason: 'execute_script_temporarily_unavailable',
    tab: buildTabSnapshot(tab),
    error: probe?.error || ping?.error || null
  };
}

async function runInlineLateExtract({ tabId, llmName, minChars = DOM_SNAPSHOT_RECOVERY_MIN_CHARS, manualRecovery = null } = {}) {
  // Read-only fallback: execute a pure extractor only, without content-script reinjection,
  // listeners, observers, reloads, prompt resend, or DOM mutation.
  const result = await withLateCollectExecutionLock(() => withLateCollectTimeout(chrome.scripting.executeScript({
    target: { tabId },
    func: extractLatestAssistantSnapshotInPage,
    args: [llmName, minChars, manualRecovery || {}]
  }), LATE_COLLECT_EXECUTE_TIMEOUT_MS, (err) => ({ ok: false, error: err?.message || 'execute_timeout' })));
  const snapshot = Array.isArray(result) ? result.find((item) => item?.result)?.result : null;
  if (snapshot?.ok && snapshot.text) {
    return snapshot;
  }
  return { ok: false, length: snapshot?.length || 0, candidates: snapshot?.candidates || 0, error: result?.error || null };
}

async function lateCollectAnswer({ llmName, tabId, reason = 'late_collect', meta = {}, minChars = DOM_SNAPSHOT_RECOVERY_MIN_CHARS, manualRecovery = null } = {}) {
  if (!llmName || !isValidTabId(tabId)) return { ok: false, status: 'late_collect_failed', reason: 'missing_llm_or_tab' };
  const entry = jobState?.llms?.[llmName] || null;
  const runSessionId = meta?.runSessionId || meta?.sessionId || getCurrentRunSessionId();
  const dispatchId = resolveLateCollectDispatchId(llmName, meta);
  const manualFlightPart = manualRecovery?.manualRecovery
    ? `${manualRecovery.strategyId || 'manual'}:${manualRecovery.selectorAttempt ?? '0'}`
    : 'auto';
  const manualLatestRecovery = Boolean(manualRecovery?.manualLatestRecovery || meta?.manualLatestRecovery || meta?.responseMeta?.manualLatestRecovery);
  const flightKey = `${llmName}:${tabId}:${dispatchId || 'no_dispatch'}:${manualFlightPart}`;
  const existing = lateAnswerCollectInFlight.get(flightKey);
  if (existing && Date.now() - Number(existing.startedAt || 0) < LATE_COLLECT_TOTAL_BUDGET_MS) {
    return existing.promise;
  }

  const promise = (async () => {
    const startedAt = Date.now();
    const emitDecisionTrace = (result = {}, extra = {}) => {
      const textLength = Number(result?.textLength || String(result?.text || '').length || 0);
      emitTelemetry(llmName, 'LATE_COLLECT_DECISION_TRACE', {
        level: result?.ok ? 'success' : 'warning',
        details: `${reason}:${result?.status || 'unknown'}:${result?.source || 'none'}`,
        meta: {
          reason,
          tabId,
          dispatchId,
          runSessionId,
          ok: !!result?.ok,
          status: result?.status || null,
          state: extra.state || null,
          stateReason: extra.stateReason || result?.reason || null,
          stateError: extra.stateError || null,
          source: result?.source || 'none',
          textLength,
          candidateCount: Number(result?.candidateCount || result?.candidates || 0),
          selectorUsed: result?.selectorUsed || null,
          strategyId: result?.strategyId || null,
          strategyIndex: Number.isFinite(Number(result?.strategyIndex)) ? Number(result.strategyIndex) : null,
          textHash: result?.textHash || (result?.text ? simpleLateAnswerHash(result.text) : null),
          cachedLength: Number(extra.cachedLength || 0),
          elapsedMs: Math.max(0, Date.now() - startedAt),
          manualRecovery: !!(manualRecovery || meta?.manualRecovery),
          preTerminalMaterialize: !!meta?.preTerminalMaterialize
        },
        force: true
      });
      return result;
    };
    const cached = await readAnswerSnapshotCache({ llmName, runSessionId, dispatchId, tabId });
    // Run 1782945983672: the tab-scoped cache alias returned a snapshot written
    // for a PREVIOUS dispatch (Grok's 13037-char answer from an older
    // conversation turn). That text is still on the page, so the live inline
    // scan re-picked it and it was force-finalized as this run's SUCCESS. A
    // cached snapshot belonging to another dispatch is stale evidence for the
    // current one: never serve it as an answer and exclude its signature from
    // the inline scan candidates.
    const cachedDispatchId = cached?.meta?.dispatchId || null;
    const cachedIsStaleForDispatch = Boolean(
      cached?.text
      && dispatchId
      && cachedDispatchId
      && String(cachedDispatchId) !== String(dispatchId)
    );
    if (cachedIsStaleForDispatch) {
      emitTelemetry(llmName, 'STALE_SNAPSHOT_SIGNATURE_EXCLUDED', {
        level: 'warning',
        details: `cachedDispatch=${cachedDispatchId} len=${cached?.length || String(cached?.text || '').length}`,
        meta: { reason, tabId, dispatchId, cachedDispatchId, cachedLength: cached?.length || 0 },
        force: true
      });
    }
    const usableCached = cachedIsStaleForDispatch ? null : cached;
    const state = await classifyLateCollectState(tabId, llmName, { inlineOnly: meta?.getIt === true && manualLatestRecovery });
    if (state.state === 'ALIVE' || state.state === 'REINJECTABLE') {
      clearUnavailableObservationRecovery(entry, dispatchId);
    } else if (state.state === 'UNAVAILABLE') {
      scheduleUnavailableObservationRetry(llmName, tabId, runSessionId, dispatchId, reason);
    }
    if (state.state === 'DEAD') {
      broadcastDiagnostic(llmName, {
        type: 'RECOVERY',
        label: usableCached?.text ? 'Late collect used cached snapshot' : 'Late collect dead tab',
        details: state.reason,
        level: usableCached?.text ? 'warning' : 'error',
        meta: { source: 'late_collect', reason, state: state.state, length: usableCached?.length || 0 }
      });
      return emitDecisionTrace(usableCached?.text
        ? { ok: true, status: 'partial_from_snapshot', text: usableCached.text, html: usableCached.html || '', source: 'snapshot_cache', reason: state.reason }
        : { ok: false, status: 'dead_tab_no_snapshot', text: '', source: 'none', reason: state.reason }, {
          state: state.state,
          stateReason: state.reason,
          stateError: state.error || null,
          cachedLength: usableCached?.length || 0
        });
    }

    if (state.state === 'ALIVE' && !manualLatestRecovery) {
      await sendTabMessageForLateCollect(tabId, {
        action: 'getResponses',
        meta: {
          ...(meta || {}),
          source: `late_collect_live:${reason}`,
          runSessionId,
          sessionId: runSessionId,
          dispatchId,
          forceEmitOnUnchanged: true,
          manualRecovery: manualRecovery || meta?.manualRecovery || null
        }
      }, LATE_COLLECT_SLOW_PING_TIMEOUT_MS);
      await withLateCollectTimeout(new Promise((resolve) => {
        const timer = registerSessionTimer(setTimeout(() => {
          deregisterSessionTimer(timer);
          resolve(true);
        }, LATE_COLLECT_POST_LIVE_WAIT_MS));
      }), LATE_COLLECT_POST_LIVE_WAIT_MS + 100, true);
      const liveEntry = jobState?.llms?.[llmName] || entry;
      if (liveEntry?.answer && String(liveEntry.answer).trim().length >= minChars) {
        const liveMeta = liveEntry.responseMeta && typeof liveEntry.responseMeta === 'object' ? liveEntry.responseMeta : {};
        return emitDecisionTrace({
          ok: true,
          status: 'success',
          text: liveEntry.answer,
          html: liveEntry.answerHtml || '',
          source: 'content_script',
          reason: state.reason,
          strategyId: liveMeta.strategyId || manualRecovery?.strategyId || meta?.manualRecovery?.strategyId || null,
          strategyIndex: Number.isFinite(Number(liveMeta.strategyIndex))
            ? Number(liveMeta.strategyIndex)
            : (manualRecovery?.strategyIndex ?? meta?.manualRecovery?.strategyIndex ?? null),
          selectorUsed: liveMeta.selectorUsed || null,
          selectorDescriptor: liveMeta.selectorDescriptor || liveMeta.selectorUsed || null,
          candidateCount: Number(liveMeta.candidateCount || liveMeta.candidates || 0),
          textHash: liveMeta.textHash || simpleLateAnswerHash(liveEntry.answer)
        }, { state: state.state, stateReason: state.reason, cachedLength: cached?.length || 0 });
      }
    }

    const inlineScanOptions = (() => {
      const base = (manualRecovery || meta?.manualRecovery) && typeof (manualRecovery || meta?.manualRecovery) === 'object'
        ? { ...(manualRecovery || meta?.manualRecovery) }
        : {};
      if (cachedIsStaleForDispatch) {
        const staleSignature = normalizeAnswerSignatureBg(cached.text);
        const existingSignatures = Array.isArray(base.excludeTextSignatures) ? base.excludeTextSignatures.slice() : [];
        if (staleSignature && !existingSignatures.includes(staleSignature)) {
          existingSignatures.push(staleSignature);
        }
        base.excludeTextSignatures = existingSignatures;
      }
      // F6.2: forward the positional turn anchor captured at dispatch so the
      // inline scan can skip previous conversation turns.
      const hasCapturedAnchor = entry?.preDispatchAnswerNodeCount !== null
        && entry?.preDispatchAnswerNodeCount !== undefined
        && Number.isFinite(Number(entry.preDispatchAnswerNodeCount));
      const anchorCount = hasCapturedAnchor ? Math.max(0, Number(entry.preDispatchAnswerNodeCount)) : 0;
      const anchorDispatchOk = !entry?.preDispatchAnswerNodeCountDispatchId
        || !dispatchId
        || String(entry.preDispatchAnswerNodeCountDispatchId) === String(dispatchId);
      const baseHasAnchor = base.anchorAnswerCount !== null
        && base.anchorAnswerCount !== undefined
        && Number.isFinite(Number(base.anchorAnswerCount));
      if (hasCapturedAnchor && anchorDispatchOk && !baseHasAnchor) {
        base.anchorAnswerCount = anchorCount;
      }
      return Object.keys(base).length ? base : null;
    })();
    const inline = await runInlineLateExtract({ tabId, llmName, minChars, manualRecovery: inlineScanOptions });
    if (inline?.ok && inline.text) {
      await saveAnswerSnapshotFromContent({
        llmName,
        tabId,
        text: inline.text,
        html: inline.html || '',
        hash: simpleLateAnswerHash(inline.text),
        url: state?.tab?.url || '',
        meta: {
          runSessionId,
          sessionId: runSessionId,
          dispatchId,
          manualRecovery: manualRecovery || meta?.manualRecovery || null,
          strategyId: inline.strategyId || null,
          selectorUsed: inline.selectorUsed || null,
          anchorApplied: inline.anchorApplied === true
        }
      }, { tab: { id: tabId } });
      return emitDecisionTrace({
        ok: true,
        status: 'success',
        text: inline.text,
        html: inline.html || '',
        source: 'inline_executeScript',
        reason: state.reason,
        candidates: inline.candidates || 0,
        candidateCount: inline.candidateCount || inline.candidates || 0,
        visible: !!inline.visible,
        strategyId: inline.strategyId || null,
        strategyIndex: Number.isFinite(Number(inline.strategyIndex)) ? Number(inline.strategyIndex) : null,
        selectorUsed: inline.selectorUsed || null,
        selectorDescriptor: inline.selectorDescriptor || inline.selectorUsed || null,
        anchorApplied: inline.anchorApplied === true,
        freshTurnEvidence: inline.anchorApplied === true,
        textHash: inline.textHash || simpleLateAnswerHash(inline.text)
      }, { state: state.state, stateReason: state.reason, cachedLength: cached?.length || 0 });
    }

    if (usableCached?.text) {
      return emitDecisionTrace({
        ok: true,
        status: 'partial_from_snapshot',
        text: usableCached.text,
        html: usableCached.html || '',
        source: 'snapshot_cache',
        reason: inline?.error || 'inline_extract_missed'
      }, { state: state.state, stateReason: state.reason, cachedLength: usableCached?.length || 0 });
    }

    return emitDecisionTrace({
      ok: false,
      status: state.state === 'UNAVAILABLE' ? 'observation_temporarily_unavailable' : 'late_collect_failed',
      text: '',
      source: 'none',
      reason: inline?.error || 'no_answer_extracted',
      candidates: inline?.candidates || 0,
      candidateCount: inline?.candidateCount || inline?.candidates || 0
    }, { state: state.state, stateReason: state.reason, stateError: state.error || null, cachedLength: cached?.length || 0 });
  })().finally(() => {
    const current = lateAnswerCollectInFlight.get(flightKey);
    if (current?.promise === promise) {
      const age = Date.now() - Number(current.startedAt || 0);
      if (age >= LATE_COLLECT_SINGLE_FLIGHT_COOLDOWN_MS) {
        lateAnswerCollectInFlight.delete(flightKey);
      } else {
        const timer = registerSessionTimer(setTimeout(() => {
          deregisterSessionTimer(timer);
          if (lateAnswerCollectInFlight.get(flightKey)?.promise === promise) {
            lateAnswerCollectInFlight.delete(flightKey);
          }
        }, LATE_COLLECT_SINGLE_FLIGHT_COOLDOWN_MS - age));
      }
    }
  });
  lateAnswerCollectInFlight.set(flightKey, { promise, startedAt: Date.now() });
  return promise;
}

function acceptLateCollectResult(llmName, result, meta = {}) {
  if (!llmName || !result?.ok || !result.text) return false;
  const entry = jobState?.llms?.[llmName] || null;
  const incomingText = String(result.text || '').trim();
  const incomingHtml = String(result.html || '');
  const currentText = String(entry?.answer || entry?.pendingFinalAnswer || '').trim();
  const terminalEntry = Boolean(entry && isFinalizedEntry(entry));
  const incomingResponseMeta = meta?.responseMeta && typeof meta.responseMeta === 'object' ? meta.responseMeta : {};
  const resultStatus = String(result.status || '').toLowerCase();
  const isSnapshotPartial = resultStatus === 'partial_from_snapshot';
  const sourceHint = String(incomingResponseMeta.source || meta?.source || result.source || '').toLowerCase();
  const snapshotLikeSource = isSnapshotPartial
    || sourceHint.includes('snapshot')
    || sourceHint.includes('inline_executescript')
    || sourceHint.includes('inline_execute_script')
    || sourceHint.includes('dom_snapshot');
  const manualLatestRecovery = Boolean(
    incomingResponseMeta.manualLatestRecovery
    || meta?.manualLatestRecovery
    || sourceHint === 'manual_latest_recovery'
  );
  const currentDispatchConfirmed = Boolean(entry?.promptSubmittedAt || entry?.submitSource === 'content' || entry?.submitSource === 'inferred_answer_evidence');
  const lockedStatus = String(entry?.finalStatus || entry?.status || '').toUpperCase();
  const lockedNoSendWithoutConfirmation = Boolean(
    entry
    && terminalEntry
    && lockedStatus === 'NO_SEND'
    && !currentDispatchConfirmed
    && !manualLatestRecovery
    && llmName !== 'Qwen'
    && !sourceHint.includes('api')
  );
  if (lockedNoSendWithoutConfirmation) {
    emitTelemetry(llmName, 'TERMINAL_UPGRADE_BLOCKED_UNCONFIRMED_SEND', {
      level: 'warning',
      details: `NO_SEND -> SUCCESS blocked source=${sourceHint || result.source || 'unknown'} len=${incomingText.length}`,
      meta: {
        dispatchId: meta?.dispatchId || entry?.lastDispatchMeta?.dispatchId || null,
        source: sourceHint || result.source || null,
        answerLength: incomingText.length,
        promptSubmittedAt: entry?.promptSubmittedAt || null,
        submitSource: entry?.submitSource || null,
        reason: 'locked_no_send_without_current_dispatch_confirmation'
      },
      force: true
    });
    appendLogEntry(llmName, {
      type: 'RECOVERY',
      label: 'Terminal upgrade blocked (submit unconfirmed)',
      details: 'NO_SEND remains terminal; recovered DOM text may belong to a previous session',
      level: 'warning',
      meta: {
        source: sourceHint || result.source || null,
        answerLength: incomingText.length,
        dispatchId: meta?.dispatchId || entry?.lastDispatchMeta?.dispatchId || null
      }
    });
    return false;
  }
  if (entry && !terminalEntry && snapshotLikeSource && !currentDispatchConfirmed) {
    emitTelemetry(llmName, 'LATE_COLLECT_STALE_ANSWER_REJECTED', {
      level: 'warning',
      details: `source=${sourceHint || result.source || 'unknown'} len=${incomingText.length}`,
      meta: {
        dispatchId: meta?.dispatchId || entry?.lastDispatchMeta?.dispatchId || null,
        source: sourceHint || result.source || null,
        status: result.status || null,
        answerLength: incomingText.length,
        promptSubmittedAt: entry?.promptSubmittedAt || null,
        submitSource: entry?.submitSource || null,
        reason: 'unconfirmed_dispatch_snapshot_like_answer'
      },
      force: true
    });
    appendLogEntry(llmName, {
      type: 'RECOVERY',
      label: 'Late collect stale answer rejected',
      details: 'unconfirmed_dispatch_snapshot_like_answer',
      level: 'warning',
      meta: {
        source: sourceHint || result.source || null,
        status: result.status || null,
        answerLength: incomingText.length,
        dispatchId: meta?.dispatchId || entry?.lastDispatchMeta?.dispatchId || null
      }
    });
    return false;
  }
  const improvesTerminalAnswer = Boolean(
    terminalEntry
    && incomingText.length >= DOM_SNAPSHOT_RECOVERY_MIN_CHARS
    && incomingText.length > currentText.length + 24
    && !isPromptEchoAnswerCandidate(incomingText, jobState?.prompt || '')
  );
  // Run 1782945983672: a stale 13037-char answer from an older conversation
  // turn was finalized as Grok's SUCCESS; the true answer is SHORTER, so the
  // longer-only improvement rule made every status double-click a no-op. An
  // explicit user latest-recovery request may REPLACE the terminal answer with
  // a different valid candidate even when it is shorter — the inline scan has
  // already excluded the current answer, the pre-dispatch baseline and known
  // stale snapshots, and prompt echo / baseline guards still apply here.
  const manualLatestRecoveryRequested = Boolean(
    meta?.manualLatestRecovery
    || incomingResponseMeta.manualLatestRecovery
    || meta?.manualRecovery?.manualLatestRecovery
  );
  const replaceGuardDispatchId = meta?.dispatchId || entry?.lastDispatchMeta?.dispatchId || null;
  const replacesTerminalAnswer = Boolean(
    terminalEntry
    && !improvesTerminalAnswer
    && manualLatestRecoveryRequested
    && incomingText.length >= DOM_SNAPSHOT_RECOVERY_MIN_CHARS
    && normalizeAnswerSignatureBg(incomingText) !== normalizeAnswerSignatureBg(currentText)
    && !isPromptEchoAnswerCandidate(incomingText, jobState?.prompt || '')
    && !isStaleBaselineCandidate(entry, incomingText, replaceGuardDispatchId)
  );
  const manualRecovery = Boolean(meta?.manualRecovery || incomingResponseMeta.manualRecovery || incomingResponseMeta.manualOverride);
  const automaticLateUpgrade = Boolean(terminalEntry && !manualRecovery && !manualLatestRecoveryRequested);
  if (automaticLateUpgrade && (improvesTerminalAnswer || replacesTerminalAnswer) && self.AnswerVerification?.canAutoUpgrade) {
    const upgradeVerification = incomingResponseMeta.answerVerification || meta?.answerVerification || {};
    const previousTurnAnchor = entry?.preDispatchAnswerNodeCount ?? entry?.anchorAnswerCount ?? entry?.baselineAnswerCount ?? null;
    const upgradeGate = self.AnswerVerification.canAutoUpgrade(
      { length: currentText.length, runSessionId: jobState?.session?.startTime || null,
        dispatchId: entry?.lastDispatchMeta?.dispatchId || null, generationEpoch: entry?.generationEpoch ?? null,
        turnAnchor: previousTurnAnchor },
      { length: incomingText.length, verified: upgradeVerification.verified === true,
        verificationState: upgradeVerification.state, generationActive: upgradeVerification.generationActive,
        resolution: upgradeVerification.resolution, structuralComplete: upgradeVerification.structuralComplete,
        runSessionId: meta?.runSessionId ?? meta?.sessionId ?? incomingResponseMeta.runSessionId ?? upgradeVerification.runSessionId ?? null,
        dispatchId: meta?.dispatchId ?? incomingResponseMeta.dispatchId ?? upgradeVerification.dispatchId ?? null,
        generationEpoch: meta?.generationEpoch ?? incomingResponseMeta.generationEpoch ?? upgradeVerification.generationEpoch ?? null,
        turnAnchor: meta?.turnAnchor ?? incomingResponseMeta.turnAnchor ?? upgradeVerification.turnAnchor ?? null },
      { previousText: currentText, nextText: incomingText }
    );
    if (!upgradeGate.ok) {
      self.AnswerVerification.appendRevision?.(entry, {
        text: incomingText, channel: sourceHint || 'late_collect', decision: 'upgrade_rejected',
        reason: upgradeGate.reasons.join(','), dispatchId: meta?.dispatchId || null
      });
      emitTelemetry(llmName, 'AUTOMATIC_LATE_UPGRADE_REJECTED', {
        level: 'warning', details: upgradeGate.reasons.join(','),
        meta: { previousLength: currentText.length, incomingLength: incomingText.length,
          dispatchId: meta?.dispatchId || entry?.lastDispatchMeta?.dispatchId || null,
          generationEpoch: entry?.generationEpoch || null }, force: true
      });
      return false;
    }
  }
  const preTerminalMaterialize = Boolean(
    meta?.preTerminalMaterialize
    || meta?.preTerminalMaterializeFinal
    || incomingResponseMeta.preTerminalMaterialize
    || incomingResponseMeta.preTerminalMaterializeFinal
  );
  const userCollectLate = sourceHint === 'collect_responses_staged_late_collect'
    || sourceHint === 'manual_ping_late_collect';
  // P0.5: manual ping / late-collect must not FORCE terminal success on weak evidence
  // (prompt echo, snapshot of a prior answer, too-short). Gate the force flag on the
  // candidate being terminal-eligible; otherwise let normal finalization classify it
  // (it can still land PARTIAL) instead of a forced SUCCESS that masks a non-answer.
  const forceTerminalRequested = Boolean(
    incomingResponseMeta.forceTerminalSuccess
    || incomingResponseMeta.lateCollectFinal
    || manualRecovery
    || preTerminalMaterialize
    || userCollectLate
  );
  const candidateTerminalEligible = Boolean(
    incomingText
    && incomingText.length >= DOM_SNAPSHOT_RECOVERY_MIN_CHARS
    && !isPromptEchoAnswerCandidate(incomingText, jobState?.prompt || '')
  );
  const forceTerminalSuccess = Boolean(!isSnapshotPartial && forceTerminalRequested && candidateTerminalEligible);
  if (forceTerminalRequested && !candidateTerminalEligible) {
    appendLogEntry(llmName, {
      type: 'RESPONSE',
      label: 'Forced terminal success withheld (weak evidence)',
      details: `len=${incomingText.length} promptEcho=${isPromptEchoAnswerCandidate(incomingText, jobState?.prompt || '')}`,
      level: 'warning',
      meta: { source: sourceHint || result.source || null, status: result.status || null }
    });
  }
  if (entry && (improvesTerminalAnswer || replacesTerminalAnswer)) {
    entry.answer = incomingText;
    entry.answerHtml = incomingHtml || (replacesTerminalAnswer ? '' : entry.answerHtml) || '';
    entry.pendingFinalAnswer = incomingText;
    entry.pendingFinalAnswerHtml = incomingHtml || (replacesTerminalAnswer ? '' : entry.pendingFinalAnswerHtml) || '';
    entry.responseMeta = {
      ...(entry.responseMeta || {}),
      ...(incomingResponseMeta || {}),
      source: incomingResponseMeta.source || meta?.source || result.source || 'late_collect',
      answerSource: incomingResponseMeta.answerSource || result.source || null,
      completionReason: incomingResponseMeta.completionReason
        || (replacesTerminalAnswer ? 'manual_replaced_terminal_answer' : 'manual_improved_terminal_answer'),
      improvedAfterTerminal: true,
      replacedAfterTerminal: replacesTerminalAnswer || undefined,
      previousAnswerLength: currentText.length,
      improvedAnswerLength: incomingText.length
    };
    appendLogEntry(llmName, {
      type: 'RESPONSE',
      label: replacesTerminalAnswer
        ? 'Terminal answer replaced by manual latest recovery'
        : 'Terminal answer improved after late collect',
      details: `${currentText.length} -> ${incomingText.length}`,
      level: 'success',
      meta: {
        source: incomingResponseMeta.source || meta?.source || result.source || 'late_collect',
        previousAnswerLength: currentText.length,
        improvedAnswerLength: incomingText.length,
        replacedAfterTerminal: replacesTerminalAnswer,
        status: entry.finalStatus || entry.status || null
      }
    });
    sendMessageToResultsTab({
      type: 'LLM_PARTIAL_RESPONSE',
      llmName,
      answer: incomingText,
      answerHtml: entry.answerHtml || '',
      requestId: entry.requestId || null,
      metadata: {
        status: entry.finalStatus || entry.status || 'SUCCESS',
        reason: replacesTerminalAnswer ? 'replaced_after_terminal' : 'improved_after_terminal',
        completionReason: replacesTerminalAnswer ? 'manual_replaced_terminal_answer' : 'manual_improved_terminal_answer',
        improvedAfterTerminal: true,
        replacedAfterTerminal: replacesTerminalAnswer || undefined,
        previousAnswerLength: currentText.length,
        improvedAnswerLength: incomingText.length
      },
      logs: getLogSnapshot(llmName)
    });
  }
  handleLLMResponse(
    llmName,
    incomingText,
    null,
    {
      ...(meta || {}),
      sessionId: meta?.sessionId || getCurrentRunSessionId(),
      runSessionId: meta?.runSessionId || meta?.sessionId || getCurrentRunSessionId(),
      dispatchId: meta?.dispatchId || entry?.lastDispatchMeta?.dispatchId || null,
      tabId: meta?.tabId || entry?.runIdentity?.tabId || entry?.tabId || null,
      tabSessionId: meta?.tabSessionId || entry?.runIdentity?.tabSessionId || null,
      contentScriptInstanceId: meta?.contentScriptInstanceId || entry?.runIdentity?.contentScriptInstanceId || null,
      navigationSeq: meta?.navigationSeq || entry?.runIdentity?.navigationSeq || null,
      responseMeta: {
        ...(incomingResponseMeta || {}),
        source: incomingResponseMeta.source || meta?.source || result.source || 'late_collect',
        answerSource: incomingResponseMeta.answerSource || result.source || null,
        extractionSource: incomingResponseMeta.extractionSource || result.source || null,
        completionReason: incomingResponseMeta.completionReason
          || (isSnapshotPartial ? 'soft_timeout' : (userCollectLate ? 'user_collect_late_collect' : 'late_collect')),
        sanityConfidence: typeof incomingResponseMeta.sanityConfidence === 'number'
          ? incomingResponseMeta.sanityConfidence
          : (isSnapshotPartial ? 0.72 : 0.84),
        partial: Boolean(incomingResponseMeta.partial || isSnapshotPartial),
        lateCollectFinal: Boolean(incomingResponseMeta.lateCollectFinal || forceTerminalSuccess),
        forceTerminalSuccess,
        manualRecovery,
        manualOverride: Boolean(incomingResponseMeta.manualOverride || manualRecovery),
        preTerminalMaterialize,
        strategyId: result.strategyId || incomingResponseMeta.strategyId || meta?.manualRecovery?.strategyId || null,
        strategyIndex: Number.isFinite(Number(result.strategyIndex))
          ? Number(result.strategyIndex)
          : (incomingResponseMeta.strategyIndex ?? meta?.manualRecovery?.strategyIndex ?? null),
        selectorUsed: result.selectorUsed || incomingResponseMeta.selectorUsed || null,
        selectorDescriptor: result.selectorDescriptor || result.selectorUsed || incomingResponseMeta.selectorDescriptor || null,
        candidateCount: Number(result.candidateCount || result.candidates || 0),
        textHash: result.textHash || simpleLateAnswerHash(result.text)
      }
    },
    incomingHtml
  );
  return true;
}

function isTerminalExtractionRecoveryEligible(entry, reason = null) {
  if (!entry || !isFinalizedEntry(entry)) return false;
  const status = String(entry.finalStatus || entry.status || '').toUpperCase();
  if (!['EXTRACT_FAILED', 'ERROR'].includes(status)) return false;
  const resolvedReason = String(
    reason
    || entry.statusReason
    || entry.responseMeta?.failureType
    || entry.finalizationEvidence?.finalReason
    || ''
  ).toLowerCase();
  return TERMINAL_EXTRACTION_RECOVERY_REASONS.has(resolvedReason);
}

async function runTerminalExtractionRecovery(llmName, trigger = {}) {
  const entry = jobState?.llms?.[llmName] || null;
  if (!isTerminalExtractionRecoveryEligible(entry, trigger.reason)) return false;
  const dispatchId = trigger.dispatchId || entry?.lastDispatchMeta?.dispatchId || entry?.confirmedDispatchId || null;
  const currentDispatchId = entry?.lastDispatchMeta?.dispatchId || entry?.confirmedDispatchId || null;
  if (dispatchId && currentDispatchId && String(dispatchId) !== String(currentDispatchId)) return false;
  const tabId = resolveBoundTabIdForOrchestrator(llmName, entry);
  if (!isValidTabId(tabId)) return false;
  const runSessionId = getCurrentRunSessionId();
  const source = trigger.source || 'terminal_extraction_auto_recovery';
  // Field evidence 2026-08-01, single-model Grok run: the answer was on the page
  // (1797 chars) while extraction repeatedly returned a 47-character fragment of
  // the user's own prompt. This recovery already ran — and re-read the same
  // wrong node, returning the same 131-character frame. The manual double-click
  // succeeded within seconds because it asks for the *latest* answer node
  // instead. Every reason that makes this recovery eligible (empty answer,
  // prompt echo, UI noise, extract failed) means the default target was wrong,
  // so the retry must not repeat it.
  const meta = {
    source,
    runSessionId,
    sessionId: runSessionId,
    dispatchId,
    manualLatestRecovery: true,
    responseMeta: {
      source,
      completionReason: trigger.lifecycleComplete
        ? 'lifecycle_complete_auto_recovery'
        : 'terminal_extraction_auto_recovery',
      lateCollectFinal: true,
      forceTerminalSuccess: true,
      recovered: true,
      manualLatestRecovery: true,
      lifecycleComplete: !!trigger.lifecycleComplete
    }
  };
  const result = await lateCollectAnswer({
    llmName,
    tabId,
    reason: source,
    meta
  });
  // Accept under the same identity the collection ran with; a divergence here
  // is what gets an otherwise good answer rejected on correlation.
  const accepted = Boolean(result?.ok && result.text && acceptLateCollectResult(llmName, result, meta));
  emitTelemetry(llmName, accepted ? 'TERMINAL_EXTRACTION_AUTO_RECOVERY_SUCCESS' : 'TERMINAL_EXTRACTION_AUTO_RECOVERY_MISS', {
    level: accepted ? 'success' : 'warning',
    details: `${source}:${result?.status || result?.reason || 'missed'}`,
    meta: {
      dispatchId,
      tabId,
      source,
      lifecycleComplete: !!trigger.lifecycleComplete,
      expectedTextLength: Number(trigger.textLength || 0),
      recoveredTextLength: String(result?.text || '').length,
      resultSource: result?.source || null,
      resultStatus: result?.status || null
    },
    force: true
  });
  return accepted;
}

function recoverTerminalFailureAfterLifecycle(llmName, lifecycle = {}) {
  const entry = jobState?.llms?.[llmName] || null;
  if (!isTerminalExtractionRecoveryEligible(entry)) return false;
  const dispatchId = lifecycle.dispatchId || entry?.lastDispatchMeta?.dispatchId || entry?.confirmedDispatchId || null;
  const key = String(dispatchId || 'no_dispatch');
  if (entry.terminalLifecycleRecoveryDispatchId === key) return true;
  entry.terminalLifecycleRecoveryDispatchId = key;
  emitTelemetry(llmName, 'TERMINAL_LIFECYCLE_RECOVERY_SCHEDULED', {
    level: 'warning',
    details: `complete_len=${Number(lifecycle.textLength || 0)}`,
    meta: { dispatchId, textLength: Number(lifecycle.textLength || 0), source: lifecycle.source || null },
    force: true
  });
  const timer = registerSessionTimer(setTimeout(() => {
    deregisterSessionTimer(timer);
    runTerminalExtractionRecovery(llmName, {
      source: 'terminal_lifecycle_complete_recovery',
      lifecycleComplete: true,
      textLength: Number(lifecycle.textLength || 0),
      dispatchId
    }).catch(() => {});
  }, 250));
  saveJobState(jobState);
  return true;
}

function scheduleTerminalExtractionRecovery(llmName, reason = null) {
  const entry = jobState?.llms?.[llmName] || null;
  if (!isTerminalExtractionRecoveryEligible(entry, reason)) return false;
  if (!entry.promptSubmittedAt && entry.submitSource !== 'content' && entry.submitSource !== 'inferred_answer_evidence') return false;
  const dispatchId = entry?.lastDispatchMeta?.dispatchId || entry?.confirmedDispatchId || null;
  const key = String(dispatchId || 'no_dispatch');
  if (entry.terminalExtractionRecoveryDispatchId === key) return true;
  entry.terminalExtractionRecoveryDispatchId = key;
  entry.terminalExtractionRecoveryTimers = [];
  TERMINAL_EXTRACTION_RECOVERY_DELAYS_MS.forEach((delayMs, attemptIndex) => {
    const timer = registerSessionTimer(setTimeout(() => {
      deregisterSessionTimer(timer);
      const liveEntry = jobState?.llms?.[llmName] || null;
      if (!isTerminalExtractionRecoveryEligible(liveEntry)) return;
      if (String(liveEntry.terminalExtractionRecoveryDispatchId || '') !== key) return;
      runTerminalExtractionRecovery(llmName, {
        source: `terminal_extraction_auto_recovery_${attemptIndex + 1}`,
        dispatchId,
        reason
      }).catch(() => {});
    }, delayMs));
    entry.terminalExtractionRecoveryTimers.push(timer);
  });
  emitTelemetry(llmName, 'TERMINAL_EXTRACTION_AUTO_RECOVERY_SCHEDULED', {
    level: 'warning',
    details: `${reason || 'extraction_failure'} attempts=${TERMINAL_EXTRACTION_RECOVERY_DELAYS_MS.length}`,
    meta: { dispatchId, reason, delaysMs: Array.from(TERMINAL_EXTRACTION_RECOVERY_DELAYS_MS) },
    force: true
  });
  return true;
}

function buildEvidenceDedupeKey({ llmName, dispatchId, sourceRunId, hash, source } = {}) {
  return [
    llmName || 'unknown',
    dispatchId || 'no_dispatch',
    sourceRunId || 'no_run',
    source || 'unknown',
    hash || 'no_hash'
  ].join('::');
}

function buildRecoveryBudgetKey({ dispatchId, reason, scope } = {}) {
  return [
    dispatchId || 'no_dispatch',
    scope || 'recovery',
    String(reason || 'unknown').replace(/\s+/g, '_').slice(0, 120)
  ].join('::');
}

function ensureRecoveryBudget(entry, key, limits = RECOVERY_BUDGET_DEFAULT) {
  if (!entry || !key) return null;
  if (!entry.recoveryBudgets || typeof entry.recoveryBudgets !== 'object') {
    entry.recoveryBudgets = {};
  }
  if (!entry.recoveryBudgets[key]) {
    entry.recoveryBudgets[key] = {
      key,
      startedAt: Date.now(),
      snapshotAttempts: 0,
      inlineDomAttempts: 0,
      manualPingAttempts: 0,
      controlledVisitAttempts: 0,
      maxTotalMs: Number(limits.maxTotalMs || RECOVERY_BUDGET_DEFAULT.maxTotalMs)
    };
  }
  return entry.recoveryBudgets[key];
}

function consumeRecoveryBudget(llmName, entry, key, kind, meta = {}) {
  const limits = meta.limits || getRecoveryBudgetForModel(llmName);
  const budget = ensureRecoveryBudget(entry, key, limits);
  if (!budget) return { ok: false, reason: 'budget_unavailable' };
  const now = Date.now();
  const elapsedMs = Math.max(0, now - Number(budget.startedAt || now));
  const maxTotalMs = Number(budget.maxTotalMs || limits.maxTotalMs || RECOVERY_BUDGET_DEFAULT.maxTotalMs);
  if (elapsedMs > maxTotalMs) {
    emitTelemetry(llmName, 'RECOVERY_BUDGET_EXHAUSTED', {
      level: 'warning',
      details: `maxTotalMs:${kind}`,
      meta: { key, kind, elapsedMs, maxTotalMs, ...(meta.telemetry || {}) },
      force: true
    });
    return { ok: false, reason: 'recovery_budget_max_total_ms', budget };
  }
  const field = `${kind}Attempts`;
  const limit = Number(limits[field] ?? RECOVERY_BUDGET_DEFAULT[field] ?? 0);
  const current = Number(budget[field] || 0);
  if (limit >= 0 && current >= limit) {
    emitTelemetry(llmName, 'RECOVERY_BUDGET_EXHAUSTED', {
      level: 'warning',
      details: `${field}:${current}/${limit}`,
      meta: { key, kind, field, current, limit, elapsedMs, ...(meta.telemetry || {}) },
      force: true
    });
    return { ok: false, reason: `recovery_budget_${field}`, budget };
  }
  budget[field] = current + 1;
  budget.lastAttemptAt = now;
  budget.lastKind = kind;
  emitTelemetry(llmName, 'RECOVERY_BUDGET_CONSUMED', {
    level: 'info',
    details: `${field}:${budget[field]}/${limit}`,
    meta: { key, kind, field, count: budget[field], limit, elapsedMs, ...(meta.telemetry || {}) }
  });
  return { ok: true, budget };
}

// Give back a consumed attempt when it never reached the live DOM (transport error /
// dead-tab / served-from-cache). A connection-fragile model (Perplexity, Gemini) was
// losing its whole snapshot budget to repeated "message port closed" failures, so by
// the time the tab recovered there was nothing left to fetch the *complete* answer and
// it finalized on a stale mid-stream cache (PARTIAL@2309). Refunding keeps the per-attempt
// budget reserved for attempts that actually read a fresh DOM; the maxTotalMs cap still
// bounds the overall recovery effort.
function refundRecoveryBudget(llmName, entry, key, kind, meta = {}) {
  if (!entry?.recoveryBudgets || !key) return;
  const budget = entry.recoveryBudgets[key];
  if (!budget) return;
  const field = `${kind}Attempts`;
  const current = Number(budget[field] || 0);
  if (current <= 0) return;
  budget[field] = current - 1;
  emitTelemetry(llmName, 'RECOVERY_BUDGET_REFUNDED', {
    level: 'info',
    details: `${field}:${budget[field]} (${meta.reason || 'no_fresh_read'})`,
    meta: { key, kind, field, count: budget[field], ...(meta.telemetry || {}) }
  });
}

function hasRecoveryBudgetRemaining(llmName, entry, key, kind) {
  if (!entry?.recoveryBudgets || !key) return false;
  const budget = entry.recoveryBudgets[key];
  if (!budget) return true;
  const limits = getRecoveryBudgetForModel(llmName);
  const field = `${kind}Attempts`;
  const limit = Number(limits[field] ?? RECOVERY_BUDGET_DEFAULT[field] ?? 0);
  return Number(budget[field] || 0) < limit;
}

function isVerifiedCurrentAnswer(entry, text, verification, dispatchId) {
  if (!entry?.promptSubmittedAt || !dispatchId || entry.confirmedDispatchId !== dispatchId) return false;
  if (verification?.verified !== true || verification.resolution !== 'exact'
    || verification.structuralComplete !== true || verification.generationActive !== false
    || verification.lengthRegressionActive === true) return false;
  const identity = self.AnswerVerification?.compareIdentity?.({
    runSessionId: jobState?.session?.startTime,
    dispatchId,
    generationEpoch: entry.generationEpoch,
    turnAnchor: entry.preDispatchAnswerNodeCount ?? entry.anchorAnswerCount ?? entry.baselineAnswerCount
  }, verification, { strict: true });
  const length = String(text || '').trim().length;
  return identity?.ok === true && length > 0
    && Number(verification.selectedLength) === length;
}

function validateMaterializedAnswerEvidence(llmName, text = '', meta = {}) {
  const value = String(text || '').trim();
  const source = meta?.source || 'unknown';
  if (!value) {
    return { valid: false, rejectReason: 'empty', source, length: 0, hash: null, answerHash: null };
  }
  const hash = hashEvidenceText(value);
  const verified = isVerifiedCurrentAnswer(meta.entry, value, meta.answerVerification, meta.dispatchId);
  if (value.length < DOM_SNAPSHOT_RECOVERY_MIN_CHARS && !verified) {
    return { valid: false, rejectReason: 'too_short', source, length: value.length, hash, answerHash: hash };
  }
  // Heuristic guard for DOM-extracted text (page error banners); not a status channel.
  if (/^error\s*:/i.test(value)) {
    return { valid: false, rejectReason: 'status_error_text', source, length: value.length, hash, answerHash: hash };
  }
  if (isPromptEchoAnswerCandidate(value, jobState?.prompt || '')) {
    return { valid: false, rejectReason: 'prompt_echo', source, length: value.length, hash, answerHash: hash };
  }
  if (isStaleBaselineCandidate(meta?.entry, value, meta?.dispatchId || null)) {
    return { valid: false, rejectReason: 'stale_baseline_answer', source, length: value.length, hash, answerHash: hash };
  }
  return {
    valid: true,
    rejectReason: null,
    source,
    length: value.length,
    hash,
    answerHash: hash
  };
}

function buildMaterializedEvidenceSummary(llmName, candidate = {}, validation = {}) {
  const text = String(candidate.text || '').trim();
  const source = candidate.source || validation.source || 'unknown';
  const hash = validation.hash || validation.answerHash || (text ? hashEvidenceText(text) : null);
  const sourceRunId = candidate.sourceRunId || candidate.runSessionId || candidate.sessionId || getActiveSessionId() || null;
  const dispatchId = candidate.dispatchId || null;
  const dedupeKey = candidate.dedupeKey || buildEvidenceDedupeKey({
    llmName,
    dispatchId,
    sourceRunId,
    hash,
    source
  });
  return {
    llmName,
    source,
    text,
    html: String(candidate.html || ''),
    length: text.length,
    hash,
    answerHash: hash,
    dedupeKey,
    dispatchId,
    sourceRunId,
    extractedAt: Date.now(),
    valid: !!validation.valid,
    rejectReason: validation.rejectReason || null,
    status: candidate.status || null,
    candidates: Number(candidate.candidates || candidate.candidateCount || 0),
    selectorUsed: candidate.selectorUsed || null,
    anchorApplied: candidate.anchorApplied === true,
    freshTurnEvidence: candidate.freshTurnEvidence === true
  };
}

async function materializeLatestAnswerEvidence(llmName, entry, context = {}) {
  const tabId = context.tabId || resolveBoundTabIdForOrchestrator(llmName, entry);
  const sessionId = context.sessionId || context.runSessionId || getActiveSessionId();
  const dispatchId = context.dispatchId || entry?.lastDispatchMeta?.dispatchId || entry?.confirmedDispatchId || null;
  const reason = context.reason || 'terminal_failure';
  const recoveryBudgetKey = context.recoveryBudgetKey || buildRecoveryBudgetKey({
    dispatchId,
    reason,
    scope: 'materialize_latest'
  });
  const emitEvidence = (label, summary, level = null) => {
    emitTelemetry(llmName, label, {
      level: level || (summary?.valid ? 'success' : 'warning'),
      details: `${summary?.source || 'none'} len=${Number(summary?.length || 0)}${summary?.rejectReason ? ` reject=${summary.rejectReason}` : ''}`,
      meta: {
        reason,
        tabId: isValidTabId(tabId) ? tabId : null,
        dispatchId,
        evidenceSource: summary?.source || null,
        evidenceLen: Number(summary?.length || 0),
        evidenceHash: summary?.hash || null,
        answerHash: summary?.answerHash || summary?.hash || null,
        dedupeKey: summary?.dedupeKey || null,
        sourceRunId: summary?.sourceRunId || null,
        rejectReason: summary?.rejectReason || null,
        status: summary?.status || null,
        candidates: Number(summary?.candidates || 0),
        selectorUsed: summary?.selectorUsed || null
      },
      force: true
    });
  };
  const consider = (candidate = {}) => {
    const validation = validateMaterializedAnswerEvidence(llmName, candidate.text || '', {
      source: candidate.source || 'unknown',
      entry,
      dispatchId
    });
    const summary = buildMaterializedEvidenceSummary(llmName, {
      dispatchId,
      sourceRunId: sessionId,
      ...(candidate || {})
    }, validation);
    // Extraction is only a candidate, not proof that it belongs to this dispatch.
    emitEvidence(
      validation.valid ? 'MATERIALIZE_EVIDENCE_ACCEPTED' : 'MATERIALIZE_EVIDENCE_REJECTED',
      summary,
      validation.valid ? 'info' : 'warning'
    );
    return summary;
  };

  const preservedCandidates = [
    { source: 'preserved_pending', text: entry?.pendingFinalAnswer, html: entry?.pendingFinalAnswerHtml, dispatchId, sourceRunId: sessionId },
    { source: 'preserved_answer', text: entry?.answer, html: entry?.answerHtml, dispatchId, sourceRunId: sessionId }
  ].filter((candidate) => String(candidate.text || '').trim());
  for (const candidate of preservedCandidates) {
    const summary = consider(candidate);
    if (summary.valid) return { ok: true, summary, result: { ok: true, text: summary.text, html: summary.html, source: summary.source, status: 'preserved' } };
  }

  if (isValidTabId(tabId)) {
    const cached = await readAnswerSnapshotCache({ llmName, runSessionId: sessionId, dispatchId, tabId });
    if (cached?.text) {
      const summary = consider({
        source: 'snapshot_cache',
        text: cached.text,
        html: cached.html || '',
        status: 'partial_from_snapshot',
        dispatchId,
        sourceRunId: sessionId
      });
      if (summary.valid) return { ok: true, summary, result: { ok: true, text: summary.text, html: summary.html, source: summary.source, status: 'partial_from_snapshot' } };
    }

    const collectOnce = async (collectReason) => lateCollectAnswer({
      llmName,
      tabId,
      reason: collectReason,
      meta: {
        ...(context.meta || {}),
        preTerminalMaterialize: true,
        materializeLatestEvidence: true,
        source: collectReason,
        runSessionId: sessionId,
        sessionId,
        dispatchId,
        forceEmitOnUnchanged: true
      },
      minChars: DOM_SNAPSHOT_RECOVERY_MIN_CHARS
    });
    const firstBudget = consumeRecoveryBudget(llmName, entry, recoveryBudgetKey, 'inlineDom', {
      limits: context.recoveryBudgetLimits,
      telemetry: { reason, tabId, dispatchId, collectReason: `materialize_latest:${reason}` }
    });
    if (!firstBudget.ok) {
      const budgetSummary = buildMaterializedEvidenceSummary(llmName, {
        source: 'none',
        text: '',
        status: 'recovery_budget_exhausted',
        dispatchId,
        sourceRunId: sessionId
      }, { valid: false, rejectReason: firstBudget.reason, source: 'none' });
      emitEvidence('MATERIALIZE_EVIDENCE_MISS', budgetSummary, 'warning');
      return { ok: false, summary: budgetSummary, reason: firstBudget.reason };
    }
    let result = await collectOnce(`materialize_latest:${reason}`);
    if ((!result?.ok || !result.text) && MATERIALIZE_LATEST_RETRY_MODELS.has(llmName)) {
      const retryBudget = consumeRecoveryBudget(llmName, entry, recoveryBudgetKey, 'inlineDom', {
        limits: context.recoveryBudgetLimits,
        telemetry: { reason, tabId, dispatchId, collectReason: `materialize_latest_retry:${reason}` }
      });
      if (!retryBudget.ok) {
        const budgetSummary = buildMaterializedEvidenceSummary(llmName, {
          source: 'none',
          text: '',
          status: 'recovery_budget_exhausted',
          dispatchId,
          sourceRunId: sessionId
        }, { valid: false, rejectReason: retryBudget.reason, source: 'none' });
        emitEvidence('MATERIALIZE_EVIDENCE_MISS', budgetSummary, 'warning');
        return { ok: false, summary: budgetSummary, result, reason: retryBudget.reason };
      }
      emitTelemetry(llmName, 'MATERIALIZE_EVIDENCE_RETRY_WAIT', {
        level: 'warning',
        details: `${MATERIALIZE_LATEST_RETRY_WAIT_MS}ms`,
        meta: { reason, tabId, dispatchId, firstStatus: result?.status || null, firstReason: result?.reason || null },
        force: true
      });
      await orchestratorSleepMs(MATERIALIZE_LATEST_RETRY_WAIT_MS);
      result = await collectOnce(`materialize_latest_retry:${reason}`);
    }
    if (result?.ok && result.text) {
      const summary = consider({
        source: result.source || 'late_collect',
        text: result.text,
        html: result.html || '',
        status: result.status || null,
        candidates: result.candidates || result.candidateCount || 0,
        selectorUsed: result.selectorUsed || null,
        anchorApplied: result.anchorApplied === true,
        freshTurnEvidence: result.freshTurnEvidence === true,
        dispatchId,
        sourceRunId: sessionId
      });
      if (summary.valid) return { ok: true, summary, result };
      return { ok: false, summary, result, reason: summary.rejectReason || 'invalid_evidence' };
    }
    const missSummary = buildMaterializedEvidenceSummary(llmName, {
      source: result?.source || 'none',
      text: '',
      status: result?.status || null,
      candidates: result?.candidates || result?.candidateCount || 0,
      dispatchId,
      sourceRunId: sessionId
    }, { valid: false, rejectReason: result?.reason || result?.status || 'no_answer_extracted', source: result?.source || 'none' });
    emitEvidence('MATERIALIZE_EVIDENCE_MISS', missSummary, 'warning');
    return { ok: false, summary: missSummary, result, reason: missSummary.rejectReason };
  }

  const missingTabSummary = buildMaterializedEvidenceSummary(llmName, {
    source: 'none',
    text: '',
    dispatchId,
    sourceRunId: sessionId
  }, { valid: false, rejectReason: 'tab_not_collectable', source: 'none' });
  emitEvidence('MATERIALIZE_EVIDENCE_MISS', missingTabSummary, 'warning');
  return { ok: false, summary: missingTabSummary, reason: 'tab_not_collectable' };
}

function hasFullSnapshotCompletionEvidence(entry, textLength, completionReason, responseSource) {
  const length = Number(textLength || 0);
  if (!entry || length < 500) return false;
  const source = String(responseSource || '').toLowerCase();
  if (source !== 'snapshot_cache') return false;
  const readyAt = Number(entry.lifecycleReadyAt || entry.answerCompleteDetectedAt || 0);
  const completeLength = Number(entry.answerCompleteTextLength || entry.lifecycleReadyMeta?.textLength || 0) || 0;
  if (readyAt > 0 && (!completeLength || length >= Math.floor(completeLength * 0.95))) {
    return true;
  }
  return String(completionReason || '').toLowerCase() === 'generation_inactive' && length >= 1000;
}

async function recoverAnswerViaDomSnapshot(llmName, tabId, reason = 'dom_snapshot_recovery', meta = {}) {
  if (!DOM_SNAPSHOT_RECOVERY_MODELS.has(llmName)) return false;
  if (!isValidTabId(tabId)) return false;
  const entry = jobState?.llms?.[llmName];
  if (!entry || isFinalizedEntry(entry)) return false;
  const dispatchId = meta?.dispatchId || entry?.lastDispatchMeta?.dispatchId || entry?.confirmedDispatchId || null;
  // Submit-confirmation gate (primary stale-answer guard, content-independent).
  // On a follow-up into an existing conversation the previous answer is already on the
  // page. If the prompt for THIS dispatch was never confirmed submitted — and no new
  // answer started/completed — then whatever the DOM shows is the prior answer, and
  // accepting it is the "all green, but it's the old answer" false success (Gemini /
  // Perplexity). Unlike the content-reported baseline (a focus-starved tab never sends
  // it), submit evidence lives in the background and is always available.
  const submitConfirmed = Boolean(
    entry.promptSubmittedAt
    || entry.submitSource === 'content'
    || entry.submitSource === 'inferred_answer_evidence'
    || (entry.confirmedDispatchId && (!dispatchId || entry.confirmedDispatchId === dispatchId))
  );
  const newAnswerEvidence = Boolean(entry.answerCompleteDetectedAt || entry.lifecycleReadyAt);
  if (!meta?.allowUnconfirmedRecovery && !submitConfirmed && !newAnswerEvidence) {
    broadcastDiagnostic(llmName, {
      type: 'RECOVERY',
      label: 'DOM snapshot recovery blocked (submit unconfirmed)',
      details: `reason=${reason} — prompt not confirmed submitted; on-page answer is the previous one`,
      level: 'warning',
      meta: { reason, tabId, dispatchId }
    });
    emitTelemetry(llmName, 'RECOVERY_BLOCKED_SUBMIT_UNCONFIRMED', {
      level: 'warning',
      details: reason,
      meta: { reason, tabId, dispatchId }
    });
    return false;
  }
  const recoveryBudgetKey = meta?.recoveryBudgetKey || buildRecoveryBudgetKey({
    dispatchId,
    reason,
    scope: 'dom_snapshot'
  });
  const budget = consumeRecoveryBudget(llmName, entry, recoveryBudgetKey, 'snapshot', {
    telemetry: { reason, tabId, dispatchId }
  });
  if (!budget.ok) {
    broadcastDiagnostic(llmName, {
      type: 'RECOVERY',
      label: 'DOM snapshot recovery skipped (budget)',
      details: budget.reason,
      level: 'warning',
      meta: { reason, tabId, dispatchId }
    });
    return false;
  }
  const now = Date.now();
  if (entry.domSnapshotRecoveryInFlight) {
    refundRecoveryBudget(llmName, entry, recoveryBudgetKey, 'snapshot', { reason: 'in_flight', telemetry: { reason, tabId } });
    return false;
  }
  if (Number(entry.domSnapshotRecoveryAt || 0) && (now - Number(entry.domSnapshotRecoveryAt || 0)) < DOM_SNAPSHOT_RECOVERY_COOLDOWN_MS) {
    refundRecoveryBudget(llmName, entry, recoveryBudgetKey, 'snapshot', { reason: 'cooldown', telemetry: { reason, tabId } });
    return false;
  }
  entry.domSnapshotRecoveryInFlight = true;
  entry.domSnapshotRecoveryAt = now;
  try {
    const snapshot = await lateCollectAnswer({
      llmName,
      tabId,
      reason,
      meta,
      minChars: DOM_SNAPSHOT_RECOVERY_MIN_CHARS
    });
    if (!snapshot?.ok || !snapshot.text) {
      // No live DOM was read (transport error / dead tab) — give the attempt back so a
      // later cycle, after the tab recovers, can still fetch the complete answer.
      refundRecoveryBudget(llmName, entry, recoveryBudgetKey, 'snapshot', {
        reason: `miss:${snapshot?.status || 'missed'}`,
        telemetry: { reason, tabId, status: snapshot?.status || 'missed' }
      });
      broadcastDiagnostic(llmName, {
        type: 'RECOVERY',
        label: 'DOM snapshot recovery missed',
        details: `reason=${reason} status=${snapshot?.status || 'missed'} candidates=${snapshot?.candidates || 0}`,
        level: snapshot?.status === 'dead_tab_no_snapshot' ? 'error' : 'warning'
      });
      return false;
    }
    // A stale cached snapshot (no fresh DOM read) is a last resort, not a finalize
    // trigger. If completion was never observed and we still have a snapshot attempt
    // left, refund + defer so the next cycle reads the *complete* DOM instead of
    // finalizing a mid-stream cache as PARTIAL. Only when budget is gone (or completion
    // evidence exists) do we accept the cache rather than lose the answer.
    if (String(snapshot.source || '') === 'snapshot_cache' && snapshot.status === 'partial_from_snapshot') {
      const completionEvidence = Boolean(
        entry.lifecycleReadyAt
        || entry.answerCompleteDetectedAt
        || entry.lifecycleReadyMeta?.state === 'COMPLETE'
      );
      if (!completionEvidence && hasRecoveryBudgetRemaining(llmName, entry, recoveryBudgetKey, 'snapshot')) {
        refundRecoveryBudget(llmName, entry, recoveryBudgetKey, 'snapshot', {
          reason: 'stale_cache_defer_for_fresh_read',
          telemetry: { reason, tabId, status: snapshot.status, source: 'snapshot_cache' }
        });
        broadcastDiagnostic(llmName, {
          type: 'RECOVERY',
          label: 'DOM snapshot recovery deferred (stale cache, fresh read pending)',
          details: `reason=${reason} len=${String(snapshot.text || '').length}`,
          level: 'warning',
          meta: { reason, tabId, source: 'snapshot_cache' }
        });
        return false;
      }
    }
    // Reject the pre-existing (previous) answer on a follow-up conversation page:
    // accepting it here is the "all green, but it's the old answer" false success.
    if (isStaleBaselineCandidate(entry, snapshot.text, dispatchId)) {
      refundRecoveryBudget(llmName, entry, recoveryBudgetKey, 'snapshot', {
        reason: 'stale_baseline_answer',
        telemetry: { reason, tabId, dispatchId }
      });
      broadcastDiagnostic(llmName, {
        type: 'RECOVERY',
        label: 'DOM snapshot recovery rejected (stale baseline)',
        details: `len=${String(snapshot.text || '').length} reason=${reason}`,
        level: 'warning',
        meta: { reason, tabId, dispatchId }
      });
      emitTelemetry(llmName, 'RECOVERY_STALE_BASELINE_REJECTED', {
        level: 'warning',
        details: reason,
        meta: { reason, tabId, dispatchId }
      });
      return false;
    }
    broadcastDiagnostic(llmName, {
      type: 'RECOVERY',
      label: 'DOM snapshot recovery accepted',
      details: `len=${String(snapshot.text || '').length} reason=${reason} source=${snapshot.source || 'late_collect'}`,
      level: 'success',
      meta: {
        reason,
        tabId,
        candidates: snapshot.candidates || 0,
        visible: !!snapshot.visible,
        source: snapshot.source || null,
        status: snapshot.status || null
      }
    });
    handleLLMResponse(
      llmName,
      snapshot.text,
      null,
      {
        ...(meta || {}),
        sessionId: Number(jobState?.session?.startTime || 0) || null,
        runSessionId: Number(jobState?.session?.startTime || 0) || null,
        dispatchId: entry?.lastDispatchMeta?.dispatchId || meta?.dispatchId || null,
        responseMeta: {
          source: snapshot.source || 'dom_snapshot_recovery',
          completionReason: snapshot.status === 'partial_from_snapshot' ? 'soft_timeout' : 'dom_snapshot_recovery',
          sanityConfidence: snapshot.status === 'partial_from_snapshot' ? 0.72 : 0.84,
          partial: snapshot.status === 'partial_from_snapshot'
        }
      },
      snapshot.html || ''
    );
    return true;
  } catch (err) {
    broadcastDiagnostic(llmName, {
      type: 'RECOVERY',
      label: 'DOM snapshot recovery failed',
      details: err?.message || String(err),
      level: 'warning',
      meta: { reason, tabId }
    });
    return false;
  } finally {
    const liveEntry = jobState?.llms?.[llmName];
    if (liveEntry) liveEntry.domSnapshotRecoveryInFlight = false;
  }
}


// Recovery after a hard stop/timeout salvages whatever text the page had at that
// moment. Without independent completion evidence that text cannot be proven
// complete, so the terminal outcome must be PARTIAL, not SUCCESS (run
// 1781159284885: Grok hard-stopped at 180s and a 550-char fragment was finalized
// as SUCCESS while the user saw only part of the real answer).
function classifyMaterializeRecoveryFinality(recoveryReason, entry, resultStatus) {
  if (resultStatus === 'partial_from_snapshot') {
    return { partial: true, completionReason: 'soft_timeout', context: 'partial_from_snapshot' };
  }
  const context = String(recoveryReason || '').toLowerCase();
  const hardStopContext = /hard_stop|hard_timeout|stream_timeout/.test(context);
  const hasCompletionEvidence = Boolean(
    entry?.answerCompleteDetectedAt
    || entry?.lifecycleReadyAt
    || entry?.lifecycleReadyMeta?.state === 'COMPLETE'
  );
  if (hardStopContext && !hasCompletionEvidence) {
    return { partial: true, completionReason: 'hard_stop_recovered_partial', context: 'hard_stop_without_completion_evidence' };
  }
  if (!hasCompletionEvidence) {
    return { partial: true, completionReason: 'materialize_recovered_unconfirmed_complete', context: 'recovery_without_completion_evidence' };
  }
  return { partial: false, completionReason: 'materialize_recovery', context: hardStopContext ? 'hard_stop_with_completion_evidence' : 'benign' };
}

function hasMaterializeCompletionEvidence(entry, result = {}) {
  return Boolean(
    entry?.answerCompleteDetectedAt
    || entry?.lifecycleReadyAt
    || entry?.lifecycleReadyMeta?.state === 'COMPLETE'
    || result?.status === 'complete'
    || result?.completionDetected === true
  );
}

function shouldAcceptMaterializeRecoveryResult(llmName, entry, result = {}, evidenceSummary = {}) {
  const source = String(result?.source || evidenceSummary?.source || '').toLowerCase();
  const text = String(result?.text || evidenceSummary?.text || '').trim();
  const length = text.length;
  const dispatchId = evidenceSummary?.dispatchId || result?.dispatchId || entry?.lastDispatchMeta?.dispatchId || entry?.confirmedDispatchId || null;
  if (isStaleBaselineCandidate(entry, text, dispatchId)) {
    return { ok: false, reason: 'stale_baseline_answer', length, source: source || null, dispatchId };
  }
  const intentFreshness = self.RecoveryIntent?.evaluateFreshEvidence?.(entry, {
    dispatchId,
    minChars: DOM_SNAPSHOT_RECOVERY_MIN_CHARS
  }) || { fresh: false, reason: 'freshness_policy_unavailable' };
  const positionalFreshness = Boolean(result?.anchorApplied || evidenceSummary?.anchorApplied);
  const explicitFreshness = Boolean(result?.freshTurnEvidence || evidenceSummary?.freshTurnEvidence);
  const fresh = Boolean(intentFreshness.fresh || positionalFreshness || explicitFreshness);
  if (!fresh) {
    return {
      ok: false,
      reason: 'materialize_recovery_freshness_unproven',
      attributionState: 'unproven',
      length,
      source: source || null,
      dispatchId,
      freshness: intentFreshness
    };
  }
  const policy = self.AnswerLengthPolicy?.getPolicy?.(llmName) || {};
  const stableMinChars = Number(policy.stableForceMinChars || DEFER_STREAM_STABLE_FORCE_MIN_CHARS);
  const fragileSource = source === 'preserved_pending'
    || source === 'preserved_answer'
    || source === 'snapshot_cache'
    || source.includes('snapshot');
  if (!fragileSource) return { ok: true, freshness: intentFreshness, positionalFreshness, explicitFreshness };
  if (hasMaterializeCompletionEvidence(entry, result)) return { ok: true, freshness: intentFreshness, positionalFreshness, explicitFreshness };
  if (length >= stableMinChars) return { ok: true, freshness: intentFreshness, positionalFreshness, explicitFreshness };
  return {
    ok: false,
    reason: 'materialize_recovery_without_completion_evidence',
    length,
    stableMinChars,
    source: source || null
  };
}

function getCompleteMaterializeVerification(entry, result = {}, evidenceSummary = {}) {
  const verification = result?.answerVerification
    || result?.responseMeta?.answerVerification
    || evidenceSummary?.answerVerification
    || entry?.answerVerification
    || null;
  if (!verification) return null;
  const textLength = String(result?.text || evidenceSummary?.text || '').trim().length;
  const selectedLength = Number(verification.selectedLength || 0);
  const lengthMatches = selectedLength > 0 && textLength > 0
    && Math.abs(selectedLength - textLength) <= Math.max(12, Math.floor(textLength * 0.08));
  return verification.verified === true
    && verification.resolution === 'exact'
    && verification.structuralComplete === true
    && verification.generationActive === false
    && verification.lengthRegressionActive !== true
    && lengthMatches
    ? verification
    : null;
}

function preserveUnprovenMaterializeArtifact(llmName, entry, result = {}, evidenceSummary = {}, gate = {}) {
  const text = String(result?.text || evidenceSummary?.text || '').trim();
  const verification = getCompleteMaterializeVerification(entry, result, evidenceSummary);
  if (!entry || !text || gate?.reason !== 'materialize_recovery_freshness_unproven' || !verification) {
    return false;
  }
  const html = String(result?.html || evidenceSummary?.html || '');
  const dispatchId = evidenceSummary?.dispatchId || result?.dispatchId || entry?.lastDispatchMeta?.dispatchId || null;
  const artifact = {
    text,
    html,
    capturedAt: Date.now(),
    source: result?.source || evidenceSummary?.source || 'materialize_recovery',
    dispatchId,
    length: text.length,
    hash: evidenceSummary?.hash || hashEvidenceText(text),
    completenessState: 'complete',
    attributionState: 'unproven',
    reason: 'materialize_recovery_freshness_unproven',
    answerVerification: verification
  };
  entry.pendingFinalAnswer = text;
  entry.pendingFinalAnswerHtml = html;
  entry.unverifiedArtifact = artifact;
  entry.attributionState = 'unproven';
  entry.answerState = 'candidate';
  entry.verificationState = 'candidate';
  entry.status = 'RECEIVING';
  entry.statusData = {
    ...(entry.statusData || {}),
    attributionState: 'unproven',
    answerState: 'candidate',
    verificationState: 'candidate',
    reason: artifact.reason,
    hasAnswer: true
  };
  updateModelState(llmName, 'RECEIVING', entry.statusData);
  sendMessageToResultsTab({
    type: 'LLM_PARTIAL_RESPONSE',
    llmName,
    answer: text,
    answerHtml: html,
    metadata: {
      status: 'RECEIVING',
      terminal: false,
      answerState: 'candidate',
      verificationState: 'candidate',
      attributionState: 'unproven',
      attributionLabel: 'Attribution unverified',
      completenessState: 'complete',
      reason: artifact.reason,
      source: artifact.source,
      dispatchId
    }
  });
  emitTelemetry(llmName, 'MATERIALIZE_RECOVERY_CONTENT_UNVERIFIED', {
    level: 'warning',
    details: `attribution_unproven len=${text.length} source=${artifact.source}`,
    meta: {
      dispatchId,
      length: text.length,
      hash: artifact.hash,
      resolution: verification.resolution,
      structuralComplete: verification.structuralComplete,
      generationActive: verification.generationActive,
      attributionState: 'unproven'
    },
    force: true
  });
  saveJobState(jobState);
  broadcastGlobalState();
  return true;
}

function isUnconfirmedSendFailure(finalStatus, finalReason, error) {
  const status = String(finalStatus || '').toUpperCase();
  const errorType = String(error?.type || '').toLowerCase();
  const reason = String(finalReason || error?.message || '').toLowerCase();
  if (errorType === 'attachment_unavailable' || errorType.includes('attachment') || reason.includes('attachment') || reason.includes('file upload')) return false;
  if (status !== 'NO_SEND' && errorType !== 'send_failed' && errorType !== 'no_send') return false;
  return errorType === 'send_failed'
    || errorType === 'no_send'
    || /\b(send|submit|submission|prompt)\b.*\b(not confirmed|unconfirmed|failed|failure)\b/.test(reason)
    || /\b(not confirmed|unconfirmed)\b.*\b(send|submit|submission|prompt)\b/.test(reason);
}

function shouldMaterializeBeforeTerminal(llmName, finalStatus, finalReason, error, metaObj = {}) {
  if (!llmName) return false;
  if (metaObj?.preTerminalMaterializeFinal || metaObj?.manualRecovery || metaObj?.responseMeta?.manualRecovery) return false;
  const errorType = String(error?.type || '').toLowerCase();
  const reason = String(finalReason || error?.message || '').toLowerCase();
  if (errorType === 'attachment_unavailable' || errorType.includes('attachment') || reason.includes('attachment') || reason.includes('file upload')) return false;
  const status = String(finalStatus || '').toUpperCase();
  if (isUnconfirmedSendFailure(status, reason, error)) return true;
  if (Array.isArray(FAILURE_STATUSES) && FAILURE_STATUSES.includes(status)) return true;
  if (!PRE_TERMINAL_MATERIALIZE_STATUSES.has(status)) return false;
  if (status === 'NO_SEND') return false;
  if (status === 'EXTRACT_FAILED') return errorType === 'extract_failed' || reason.includes('extract') || reason.includes('round4');
  if (status === 'ERROR') return errorType === 'script_runtime_hard_stop' || reason.includes('hard_stop');
  return false;
}

async function runPreTerminalMaterializeRecovery(llmName, tabId, sessionId, reason, meta = {}) {
  const entry = jobState?.llms?.[llmName] || null;
  if (!entry || isFinalizedEntry(entry) || !isValidTabId(tabId)) {
    return { ok: false, reason: 'not_collectable' };
  }
  emitTelemetry(llmName, 'MATERIALIZE_RECOVERY_START', {
    level: 'warning',
    details: reason,
    meta: {
      tabId,
      reason,
      dispatchId: meta?.dispatchId || entry?.lastDispatchMeta?.dispatchId || null
    },
    force: true
  });
  try {
    const beforeVisit = jobState?.llms?.[llmName] || entry;
    const visitStartedAt = Date.now();
    const tabBefore = await getTabSafe(tabId);
    const focusSwitchesBefore = Number(beforeVisit?.focusSwitches || 0);
    const humanVisitBefore = Number(beforeVisit?.humanVisitTotalMs || 0);
    const dispatchId = meta?.dispatchId || entry?.lastDispatchMeta?.dispatchId || null;
    const recoveryBudgetKey = meta?.recoveryBudgetKey || buildRecoveryBudgetKey({
      dispatchId,
      reason,
      scope: 'pre_terminal_materialize'
    });
    const visitBudget = consumeRecoveryBudget(llmName, beforeVisit, recoveryBudgetKey, 'controlledVisit', {
      limits: meta?.recoveryBudgetLimits,
      telemetry: { reason, tabId, dispatchId }
    });
    let didVisit = false;
    if (visitBudget.ok) {
      didVisit = await runForcedAutomationVisits(llmName, tabId, sessionId, {
        visits: 1,
        minMs: PRE_TERMINAL_MATERIALIZE_VISIT_MIN_MS,
        maxMs: PRE_TERMINAL_MATERIALIZE_VISIT_MAX_MS,
        maxScrollDurationMs: PRE_TERMINAL_MATERIALIZE_SCROLL_MAX_MS,
        reason: `materialize_recovery:${reason}`
      });
    }
    if (!didVisit && (!sessionId || isSessionActive(sessionId))) {
      emitTelemetry(llmName, 'MATERIALIZE_RECOVERY_VISIT_FALLBACK', {
        level: 'warning',
        details: visitBudget.ok ? `direct_focus_after_visit_miss:${reason}` : `visit_budget_exhausted:${visitBudget.reason}`,
        meta: { tabId, reason, dispatchId, budgetReason: visitBudget.ok ? null : visitBudget.reason },
        force: true
      });
      if (visitBudget.ok) {
        const fallbackVisit = await focusTabForVerification(llmName, tabId, 2600, sessionId);
        await runPreCollectScrollNudge(llmName, tabId, sessionId, `materialize_recovery_fallback:${reason}`);
        didVisit = fallbackVisit === true || (fallbackVisit && typeof fallbackVisit === 'object' && fallbackVisit.usefulVisit !== false);
        if (!didVisit) {
          emitTelemetry(llmName, 'MATERIALIZE_RECOVERY_VISIT_FALLBACK_SHORT', {
            level: 'warning',
            details: `duration=${fallbackVisit?.durationMs || 0}ms reason=${reason}`,
            meta: {
              tabId,
              reason,
              dispatchId,
              visit: fallbackVisit && typeof fallbackVisit === 'object' ? fallbackVisit : null
            },
            force: true
          });
        }
      }
    }
    const tabAfter = await getTabSafe(tabId);
    const afterVisitState = jobState?.llms?.[llmName] || null;
    emitTelemetry(llmName, 'MATERIALIZE_RECOVERY_VISIT_RESULT', {
      // Visiting the tab is transport progress, not a successful model answer.
      level: didVisit ? 'info' : 'warning',
      details: `didVisit=${!!didVisit} reason=${reason}`,
      meta: {
        tabId,
        reason,
        didVisit: !!didVisit,
        configuredMinMs: PRE_TERMINAL_MATERIALIZE_VISIT_MIN_MS,
        configuredMaxMs: PRE_TERMINAL_MATERIALIZE_VISIT_MAX_MS,
        configuredMaxScrollDurationMs: PRE_TERMINAL_MATERIALIZE_SCROLL_MAX_MS,
        elapsedMs: Math.max(0, Date.now() - visitStartedAt),
        focusSwitchDelta: Math.max(0, Number(afterVisitState?.focusSwitches || 0) - focusSwitchesBefore),
        humanVisitDeltaMs: Math.max(0, Number(afterVisitState?.humanVisitTotalMs || 0) - humanVisitBefore),
        tabActiveBefore: !!tabBefore?.active,
        tabActiveAfter: !!tabAfter?.active,
        tabDiscardedBefore: tabBefore?.discarded === true,
        tabDiscardedAfter: tabAfter?.discarded === true,
        tabStillAlive: !!tabAfter,
        dispatchId,
        budgetReason: visitBudget.ok ? null : visitBudget.reason
      },
      force: true
    });
    await orchestratorSleepMs(PRE_TERMINAL_MATERIALIZE_SETTLE_MS);
    const afterVisit = jobState?.llms?.[llmName] || null;
    if (!afterVisit || isFinalizedEntry(afterVisit)) {
      return { ok: false, reason: 'finalized_during_materialize' };
    }
    const evidence = await materializeLatestAnswerEvidence(llmName, afterVisit, {
      tabId,
      sessionId,
      runSessionId: sessionId,
      dispatchId: meta?.dispatchId || entry?.lastDispatchMeta?.dispatchId || null,
      reason: `materialize_recovery:${reason}`,
      recoveryBudgetKey,
      meta: {
        ...(meta || {}),
        recoveryBudgetKey
      },
      recoveryBudgetLimits: meta?.recoveryBudgetLimits
    });
    const result = evidence?.result || null;
    if (evidence?.ok && result?.text) {
      const materializeGate = shouldAcceptMaterializeRecoveryResult(llmName, afterVisit, result, evidence.summary);
      if (!materializeGate.ok) {
        if (preserveUnprovenMaterializeArtifact(llmName, afterVisit, result, evidence.summary, materializeGate)) {
          return {
            ok: true,
            reason: 'attribution_unproven',
            outcome: 'content_unverified',
            result
          };
        }
        emitTelemetry(llmName, 'MATERIALIZE_RECOVERY_REJECTED', {
          level: 'warning',
          details: `${materializeGate.reason} len=${materializeGate.length} source=${materializeGate.source || 'unknown'}`,
          meta: {
            tabId,
            reason,
            dispatchId: meta?.dispatchId || null,
            gate: materializeGate
          },
          force: true
        });
        return { ok: false, reason: materializeGate.reason, result };
      }
      const recoveryFinality = classifyMaterializeRecoveryFinality(reason, afterVisit, result.status);
      const accepted = acceptLateCollectResult(llmName, result, {
        ...(meta || {}),
        preTerminalMaterialize: true,
        materializeLatestEvidence: true,
        responseMeta: {
          source: result.source || 'materialize_recovery',
          completionReason: recoveryFinality.completionReason,
          sanityConfidence: recoveryFinality.partial ? 0.72 : 0.86,
          partial: recoveryFinality.partial,
          recovered: true,
          recoverySource: result.source || evidence.summary?.source || 'materialize_recovery',
          evidenceSource: evidence.summary?.source || result.source || null,
          evidenceHash: evidence.summary?.hash || hashEvidenceText(result.text),
          evidenceLength: evidence.summary?.length || String(result.text || '').length,
          freshTurnEvidence: Boolean(
            materializeGate?.freshness?.fresh
            || materializeGate?.positionalFreshness
            || materializeGate?.explicitFreshness
          )
        }
      });
      emitTelemetry(llmName, accepted ? 'MATERIALIZE_RECOVERY_SUCCESS' : 'MATERIALIZE_RECOVERY_REJECTED', {
        level: accepted ? 'success' : 'warning',
        details: `len=${String(result.text || '').length} source=${result.source || 'unknown'}`,
        meta: {
          tabId,
          reason,
          status: result.status || null,
          source: result.source || null,
          candidates: result.candidates || result.candidateCount || 0,
          dispatchId: meta?.dispatchId || null
        },
        force: true
      });
      return { ok: accepted, reason: accepted ? 'accepted' : 'not_accepted', result };
    }
    emitTelemetry(llmName, 'MATERIALIZE_RECOVERY_MISS', {
      level: 'warning',
      details: evidence?.reason || result?.reason || result?.status || 'no_answer',
      meta: {
        tabId,
        reason,
        status: result?.status || null,
        candidates: result?.candidates || result?.candidateCount || 0,
        source: result?.source || null,
        evidenceSource: evidence?.summary?.source || null,
        evidenceLen: Number(evidence?.summary?.length || 0),
        evidenceHash: evidence?.summary?.hash || null,
        rejectReason: evidence?.summary?.rejectReason || null,
        dispatchId: meta?.dispatchId || null
      },
      force: true
    });
    return { ok: false, reason: evidence?.reason || result?.reason || result?.status || 'missed', result, evidence: evidence?.summary || null };
  } catch (err) {
    emitTelemetry(llmName, 'MATERIALIZE_RECOVERY_ERROR', {
      level: 'warning',
      details: err?.message || String(err),
      meta: { tabId, reason, dispatchId: meta?.dispatchId || null },
      force: true
    });
    return { ok: false, reason: err?.message || String(err) };
  }
}

function maybeDeferTerminalFailureForMaterialization(llmName, entry, finalStatus, finalReason, error, metaObj, normalizedAnswer, normalizedHtml) {
  if (!entry || entry.finalStatusRecorded) return false;
  if (!shouldMaterializeBeforeTerminal(llmName, finalStatus, finalReason, error, metaObj)) return false;
  const tabId = resolveBoundTabIdForOrchestrator(llmName, entry);
  if (!isValidTabId(tabId)) return false;
  const now = Date.now();
  const dispatchId = metaObj?.dispatchId || entry?.lastDispatchMeta?.dispatchId || null;
  const reason = String(finalReason || error?.type || finalStatus || 'terminal').toLowerCase();
  const key = `${dispatchId || 'no_dispatch'}:${finalStatus}:${reason}`;
  const unconfirmedSendObservation = isUnconfirmedSendFailure(finalStatus, finalReason, error)
    && metaObj?.skipExtendedSendObservation !== true;
  const existing = entry.preTerminalMaterializeRecovery || null;
  if (existing?.inFlight && existing.key === key) return true;
  if (existing?.key === key && Number(existing.attemptedAt || 0) && (now - Number(existing.attemptedAt || 0)) < PRE_TERMINAL_MATERIALIZE_COOLDOWN_MS) {
    return false;
  }
  entry.preTerminalMaterializeRecovery = {
    key,
    inFlight: true,
    attemptedAt: now,
    status: finalStatus,
    reason,
    dispatchId,
    mode: unconfirmedSendObservation ? 'unconfirmed_send_observation' : 'single_probe',
    probeCount: 0,
    observationDeadlineAt: unconfirmedSendObservation
      ? now + UNCONFIRMED_SEND_OBSERVATION_OFFSETS_MS[UNCONFIRMED_SEND_OBSERVATION_OFFSETS_MS.length - 1]
      : now
  };
  updateModelState(llmName, 'RECOVERABLE_ERROR', {
    message: `pre_terminal_materialize_${reason}`,
    originalStatus: finalStatus
  });
  emitTelemetry(llmName, 'MATERIALIZE_RECOVERY_CONTEXT', {
    level: 'warning',
    details: `${finalStatus}:${reason}`,
    meta: {
      tabId,
      dispatchId,
      finalStatusCandidate: finalStatus,
      finalReasonCandidate: reason,
      errorType: error?.type || null,
      errorMessage: error?.message || null,
      promptSubmittedAt: entry?.promptSubmittedAt || null,
      lifecycleReadyAt: entry?.lifecycleReadyAt || null,
      answerCompleteDetectedAt: entry?.answerCompleteDetectedAt || null,
      answerLengthBefore: String(entry?.answer || '').length,
      pendingFinalAnswerLength: String(entry?.pendingFinalAnswer || '').length,
      snapshotLengthBefore: Number(entry?.lastAnswerSnapshotLength || entry?.answerSnapshotLength || 0),
      pingTransportErrorCount: Number(entry?.pingTransportErrorCount || 0),
      statusBefore: entry?.status || null,
      finalStatusBefore: entry?.finalStatus || null,
      recoveryMode: unconfirmedSendObservation ? 'unconfirmed_send_observation' : 'single_probe'
    },
    force: true
  });
  emitTelemetry(llmName, 'MATERIALIZE_RECOVERY_DEFER_TERMINAL', {
    level: 'warning',
    details: `${finalStatus}:${reason}`,
    meta: { tabId, dispatchId, finalStatus, finalReason: reason },
    force: true
  });
  const sessionId = metaObj?.runSessionId || metaObj?.sessionId || getActiveSessionId();
  // Failure details travel through finalError/finalReason. They are not model text.
  const finalAnswer = normalizedAnswer || '';
  const finalHtml = normalizedHtml || '';
  const finalError = error ? { ...error } : { type: String(finalReason || finalStatus || 'terminal').toLowerCase() };
  registerSessionTimer(setTimeout(async () => {
    const observationStartedAt = Date.now();
    const probeOffsets = unconfirmedSendObservation ? UNCONFIRMED_SEND_OBSERVATION_OFFSETS_MS : [0];
    const recoveryBudgetKey = buildRecoveryBudgetKey({
      dispatchId,
      reason,
      scope: unconfirmedSendObservation ? 'unconfirmed_send_observation' : 'pre_terminal_materialize'
    });
    let result = { ok: false, reason: 'not_started' };
    for (let probeIndex = 0; probeIndex < probeOffsets.length; probeIndex += 1) {
      const targetOffsetMs = Number(probeOffsets[probeIndex] || 0);
      const waitMs = Math.max(0, observationStartedAt + targetOffsetMs - Date.now());
      if (waitMs > 0) await orchestratorSleepMs(waitMs);
      const liveEntry = jobState?.llms?.[llmName];
      if (!liveEntry || liveEntry.finalStatusRecorded) return;
      if (String(liveEntry.preTerminalMaterializeRecovery?.key || '') !== key) return;
      if (sessionId && !isSessionActive(sessionId)) return;
      liveEntry.preTerminalMaterializeRecovery.probeCount = probeIndex + 1;
      liveEntry.preTerminalMaterializeRecovery.lastProbeAt = Date.now();
      emitTelemetry(llmName, 'MATERIALIZE_RECOVERY_PROBE', {
        level: 'warning',
        details: `${probeIndex + 1}/${probeOffsets.length}:${reason}`,
        meta: {
          tabId,
          dispatchId,
          probeIndex,
          probeCount: probeOffsets.length,
          targetOffsetMs,
          recoveryMode: unconfirmedSendObservation ? 'unconfirmed_send_observation' : 'single_probe'
        },
        force: true
      });
      result = await runPreTerminalMaterializeRecovery(llmName, tabId, sessionId, reason, {
        ...(metaObj || {}),
        dispatchId,
        runSessionId: sessionId || undefined,
        sessionId: sessionId || undefined,
        recoveryBudgetKey,
        recoveryBudgetLimits: unconfirmedSendObservation ? UNCONFIRMED_SEND_RECOVERY_BUDGET : undefined
      });
      const afterProbe = jobState?.llms?.[llmName];
      // A transient provider navigation can invalidate this terminal candidate
      // while asynchronous DOM recovery is running. Re-check ownership after
      // every await; otherwise a stale failure can finalize a resumed dispatch.
      if (!afterProbe || afterProbe.finalStatusRecorded
        || afterProbe.preTerminalMaterializeRecovery?.key !== key) return;
      afterProbe.preTerminalMaterializeRecovery.result = result?.reason || null;
      afterProbe.preTerminalMaterializeRecovery.lastProbeResult = result?.reason || null;
      if (result?.ok) {
        afterProbe.preTerminalMaterializeRecovery.inFlight = false;
        return;
      }
    }
    const afterRecovery = jobState?.llms?.[llmName];
    if (!afterRecovery || afterRecovery.finalStatusRecorded
      || afterRecovery.preTerminalMaterializeRecovery?.key !== key) return;
    afterRecovery.preTerminalMaterializeRecovery.inFlight = false;
    afterRecovery.preTerminalMaterializeRecovery.result = result?.reason || null;
    if (unconfirmedSendObservation) {
      emitTelemetry(llmName, 'UNCONFIRMED_SEND_OBSERVATION_EXHAUSTED', {
        level: 'error',
        details: `${probeOffsets.length} probes without fresh answer`,
        meta: {
          tabId,
          dispatchId,
          probeCount: probeOffsets.length,
          elapsedMs: Math.max(0, Date.now() - observationStartedAt),
          recoveryReason: result?.reason || null
        },
        force: true
      });
    }
    const afterMiss = jobState?.llms?.[llmName];
    if (!afterMiss || afterMiss.finalStatusRecorded
      || afterMiss.preTerminalMaterializeRecovery?.key !== key) return;
    emitTelemetry(llmName, 'FINAL_ERROR_AFTER_RECOVERY', {
      level: 'error',
      details: `${finalStatus}:${reason}:${result?.reason || 'missed'}`,
      meta: {
        tabId,
        dispatchId,
        originalStatus: finalStatus,
        originalReason: reason,
        errorType: finalError?.type || null,
        recoveryReason: result?.reason || null,
        recoveryStatus: result?.result?.status || result?.status || null,
        recoverySource: result?.result?.source || result?.source || null,
        candidates: Number(result?.result?.candidates || result?.result?.candidateCount || 0),
        textLengthRecovered: String(result?.result?.text || '').length,
        recoveryOk: !!result?.ok,
        preTerminalMaterializeFinal: true
      },
      force: true
    });
    handleLLMResponse(
      llmName,
      finalAnswer,
      finalError,
      {
        ...(metaObj || {}),
        dispatchId,
        runSessionId: sessionId || undefined,
        sessionId: sessionId || undefined,
        preTerminalMaterializeFinal: true,
        preTerminalMaterializeResult: result?.reason || 'missed'
      },
      finalHtml
    );
  }, 0));
  saveJobState(jobState);
  broadcastGlobalState();
  return true;
}

function detectActiveGenerationInPage(modelName) {
  const commonStopSelectors = [
    'button[aria-label*="Stop" i]',
    'button[aria-label*="Останов" i]',
    'button[aria-label*="Detener" i]',
    'button[aria-label*="Arrêter" i]',
    'button[aria-label*="停止" i]',
    'button[data-testid="stop-button"]',
    'button[data-testid*="stop" i]',
    'button[aria-label*="Stop generation" i]',
    'button[class*="stop" i]',
    '[role="button"][aria-label*="Stop" i]',
    '[role="button"][aria-label*="停止" i]'
  ];
  const commonBusySelectors = [
    '[aria-busy="true"]',
    '[data-is-streaming="true"]',
    '[data-streaming="true"]',
    '[data-generating="true"]',
    '[data-loading="true"]',
    '[class*="streaming" i]',
    '[class*="typing" i]',
    '[class*="loading" i]',
    '[class*="generating" i]',
    '[class*="response-loading" i]',
    '[class*="qwen"][class*="loading" i]',
    '[role="progressbar"]'
  ];
  const stopTextPattern = /\b(stop|stop generating|cancel|cancel generation)\b|останов|detener|arrêter|停止|中止/i;
  const isVisible = (node) => {
    if (!node) return false;
    try {
      const style = window.getComputedStyle(node);
      if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity || 1) === 0) return false;
      return node.getClientRects().length > 0;
    } catch (_) {
      return false;
    }
  };
  const isEnabledButton = (node) => {
    if (!node) return false;
    if (node.disabled || node.getAttribute?.('aria-disabled') === 'true' || node.getAttribute?.('data-disabled') === 'true') return false;
    return isVisible(node);
  };
  const hasStopTextButton = () => {
    try {
      const controls = Array.from(document.querySelectorAll('button,[role="button"]')).slice(0, 160);
      return controls.some((node) => {
        if (!isEnabledButton(node)) return false;
        const text = String(node.getAttribute?.('aria-label') || node.getAttribute?.('title') || node.textContent || '').trim();
        return stopTextPattern.test(text);
      });
    } catch (_) {
      return false;
    }
  };
  const stopVisible = commonStopSelectors.some((selector) => {
    try {
      return Array.from(document.querySelectorAll(selector)).some(isEnabledButton);
    } catch (_) {
      return false;
    }
  }) || hasStopTextButton();
  const busyVisible = commonBusySelectors.some((selector) => {
    try {
      return Array.from(document.querySelectorAll(selector)).some(isVisible);
    } catch (_) {
      return false;
    }
  });
  return {
    active: stopVisible || busyVisible,
    stopVisible,
    busyVisible,
    modelName: String(modelName || '')
  };
}

function maybeDeferStreamingFinalization(llmName, answer, metaObj, answerHtml, normalizedAnswer) {
  if (!DEFER_STREAM_FINAL_MODELS.has(llmName)) return false;
  const responseMeta = metaObj?.responseMeta && typeof metaObj.responseMeta === 'object' ? metaObj.responseMeta : {};
  if (
    metaObj?.finalizationDeferredCheck
    || metaObj?.source === 'dom_snapshot_recovery'
    || responseMeta.preTerminalMaterialize
  ) return false;
  const entry = jobState?.llms?.[llmName];
  if (!entry || isFinalizedEntry(entry)) return false;
  const tabId = resolveBoundTabIdForOrchestrator(llmName, entry);
  if (!isValidTabId(tabId) || !chrome?.scripting?.executeScript) return false;
  const startedAt = Number(entry.finalizationDeferStartedAt || Date.now());
  entry.finalizationDeferStartedAt = startedAt;
  // Track observed stability across defer re-entries: only text seen unchanged
  // on repeated checks may later count as "stable" against streaming_incomplete.
  const nextPendingFinalAnswer = String(normalizedAnswer || answer || '');
  const previousPendingFinalAnswer = String(entry.pendingFinalAnswer || '');
  if (previousPendingFinalAnswer && previousPendingFinalAnswer === nextPendingFinalAnswer) {
    entry.pendingFinalAnswerStableCount = Number(entry.pendingFinalAnswerStableCount || 0) + 1;
  } else {
    entry.pendingFinalAnswerStableCount = 0;
  }
  entry.pendingFinalAnswer = nextPendingFinalAnswer;
  entry.pendingFinalAnswerHtml = String(answerHtml || '');
  const precheckAnswerEvidence = self.AnswerEvidence?.buildAnswerEvidence?.({
    llmName,
    text: entry.pendingFinalAnswer,
    html: entry.pendingFinalAnswerHtml,
    source: responseMeta?.source || metaObj?.source || null,
    responseMeta,
    dispatchId: metaObj?.dispatchId || entry?.lastDispatchMeta?.dispatchId || null,
    tabId,
    minChars: DOM_SNAPSHOT_RECOVERY_MIN_CHARS,
    stableMinChars: DEFER_STREAM_STABLE_FORCE_MIN_CHARS
  }) || null;
  const precheckFinalization = self.AnswerEvidence?.shouldFinalizeWithEvidence?.(precheckAnswerEvidence, {
    minChars: DOM_SNAPSHOT_RECOVERY_MIN_CHARS
  }) || { ok: false };
  if (
    precheckFinalization.ok
    && ['timeout_with_text', 'hardstop_with_text', 'snapshot_with_text', 'materialize_with_text', 'panel_with_text'].includes(precheckFinalization.reason)
  ) {
    appendLogEntry(llmName, {
      type: 'RESPONSE',
      label: 'Finalization defer bypassed (answer evidence policy)',
      details: `reason=${precheckFinalization.reason} len=${precheckAnswerEvidence.length}`,
      level: 'warning',
      meta: {
        tabId,
        answerEvidence: precheckAnswerEvidence,
        finalizationPolicy: precheckFinalization
      }
    });
    return false;
  }
  chrome.scripting.executeScript({
    target: { tabId },
    func: detectActiveGenerationInPage,
    args: [llmName]
  }).then((results) => {
    const liveEntry = jobState?.llms?.[llmName];
    if (!liveEntry || isFinalizedEntry(liveEntry)) return;
    const state = Array.isArray(results) ? results.find((item) => item?.result)?.result : null;
    const elapsedMs = Math.max(0, Date.now() - Number(liveEntry.finalizationDeferStartedAt || Date.now()));
    const pendingAnswerLength = String(liveEntry.pendingFinalAnswer || normalizedAnswer || answer || '').trim().length;
    const pendingAnswerEvidence = self.AnswerEvidence?.buildAnswerEvidence?.({
      llmName,
      text: liveEntry.pendingFinalAnswer || normalizedAnswer || answer || '',
      html: liveEntry.pendingFinalAnswerHtml || answerHtml || '',
      source: responseMeta?.source || metaObj?.source || 'deferred_finalization',
      responseMeta,
      dispatchId: metaObj?.dispatchId || liveEntry?.lastDispatchMeta?.dispatchId || null,
      tabId,
      generationActive: !!state?.active,
      stopButtonVisible: !!state?.stopVisible,
      busyIndicatorVisible: !!state?.busyVisible,
      stableMinChars: DEFER_STREAM_STABLE_FORCE_MIN_CHARS,
      minChars: DOM_SNAPSHOT_RECOVERY_MIN_CHARS
    }) || null;
    const evidenceFinalization = self.AnswerEvidence?.shouldFinalizeWithEvidence?.(pendingAnswerEvidence, {
      minChars: DOM_SNAPSHOT_RECOVERY_MIN_CHARS
    }) || { ok: false };
    const streamingMaxReached = Boolean(state?.active && elapsedMs >= getDeferStreamFinalMaxMs());
    // Same submit-pending gate as stable-pending auto-finalization: while the
    // dispatch command was sent but not confirmed, the pending answer is
    // pre-dispatch page content (run 1782945983672 Claude case) — keep
    // deferring instead of force-finalizing it.
    if (liveEntry.awaitingSubmitConfirmation === true && !liveEntry.promptSubmittedAt) {
      appendLogEntry(llmName, {
        type: 'RESPONSE',
        label: 'Finalization deferred (submit unconfirmed)',
        details: `len=${pendingAnswerLength} elapsed=${elapsedMs}ms`,
        level: 'warning',
        meta: { tabId, elapsedMs, pendingAnswerLength, awaitingSubmitConfirmation: true }
      });
      emitTelemetry(llmName, 'FINALIZE_BLOCKED_SUBMIT_PENDING', {
        level: 'warning',
        details: `deferred_finalization len=${pendingAnswerLength}`,
        meta: {
          tabId,
          dispatchId: metaObj?.dispatchId || liveEntry?.lastDispatchMeta?.dispatchId || null,
          source: 'deferred_finalization'
        },
        force: true
      });
      updateModelState(llmName, 'RECEIVING', {
        message: 'awaiting_submit_confirmation',
        completionReason: 'awaiting_submit_confirmation',
        responseSource: responseMeta?.source || null
      });
      // 2.81.121 (principle 5). Deliver the pending text as a labelled candidate
      // instead of leaving an orange card empty. Unlike the blocked-success path,
      // submission was never confirmed here, so the content really could be
      // pre-dispatch page material — deliver only what is provably NOT the
      // pre-dispatch baseline, and never as a terminal result.
      const deferredText = String(liveEntry.pendingFinalAnswer || normalizedAnswer || answer || '').trim();
      const deferredDispatchId = metaObj?.dispatchId || liveEntry?.lastDispatchMeta?.dispatchId || null;
      if (deferredText && !isStaleBaselineCandidate(liveEntry, deferredText, deferredDispatchId)) {
        sendMessageToResultsTab({
          type: 'LLM_PARTIAL_RESPONSE',
          llmName,
          answer: deferredText,
          answerHtml: String(liveEntry.pendingFinalAnswerHtml || normalizedHtml || ''),
          requestId: liveEntry?.requestId || null,
          metadata: {
            status: 'RECEIVING',
            terminal: false,
            answerState: 'candidate',
            verificationState: 'candidate',
            attributionState: 'unproven',
            attributionLabel: 'Submission unconfirmed',
            reason: 'awaiting_submit_confirmation',
            source: responseMeta?.source || null,
            dispatchId: deferredDispatchId
          }
        });
      }
      const recheckDelay = nextDeferRecheckDelay(jobState?.llms?.[llmName], pendingAnswerLength);
      registerSessionTimer(setTimeout(() => {
        const recheckEntry = jobState?.llms?.[llmName];
        if (!recheckEntry || isFinalizedEntry(recheckEntry)) return;
        triggerResponseCollectionPing(llmName, tabId, 'finalization_deferred_submit_unconfirmed', {
          allowRecovery: true,
          maxAttempts: 3,
          baseDelay: 700
        });
      }, recheckDelay));
      return;
    }
    const hasCompletionEvidence = Boolean(
      liveEntry.lifecycleReadyAt
      || liveEntry.answerCompleteDetectedAt
      || liveEntry.lifecycleReadyMeta?.state === 'COMPLETE'
      || String(responseMeta?.completionReason || '').includes('timeout')
      || String(responseMeta?.source || '').includes('snapshot')
    );
    const stableAnswerForceFinal = Boolean(
      state?.active
      && !state?.stopVisible
      && pendingAnswerLength >= DEFER_STREAM_STABLE_FORCE_MIN_CHARS
      && (elapsedMs >= DEFER_STREAM_STABLE_FORCE_MS || hasCompletionEvidence)
    );
    const evidenceCanOverrideStop = ['timeout_with_text', 'hardstop_with_text', 'materialize_with_text'].includes(String(evidenceFinalization.reason || ''));
    const evidenceForceFinal = Boolean(
      evidenceFinalization.ok
      && state?.active
      && (!state?.stopVisible || evidenceCanOverrideStop)
    );
    if (state?.active && !streamingMaxReached && !stableAnswerForceFinal && !evidenceForceFinal) {
      appendLogEntry(llmName, {
        type: 'RESPONSE',
        label: 'Finalization deferred (generation active)',
        details: `elapsed=${elapsedMs}ms stop=${!!state.stopVisible} busy=${!!state.busyVisible}`,
        level: 'warning',
        meta: {
          tabId,
          elapsedMs,
          stopVisible: !!state.stopVisible,
          busyVisible: !!state.busyVisible,
          pendingAnswerLength
        }
      });
      updateModelState(llmName, 'RECEIVING', {
        message: 'generation_active',
        completionReason: 'generation_active',
        responseSource: responseMeta?.source || null
      });
      sendMessageToResultsTab({
        type: 'LLM_PARTIAL_RESPONSE',
        llmName,
        answer: String(normalizedAnswer || answer || ''),
        answerHtml: String(answerHtml || ''),
        metadata: { status: 'GENERATING', reason: 'generation_active' },
        logs: getLogSnapshot(llmName)
      });
      scheduleStablePendingAutoFinalization(llmName, tabId, metaObj, 'deferred_generation_active');
      const recheckDelay = nextDeferRecheckDelay(jobState?.llms?.[llmName], pendingAnswerLength);
      registerSessionTimer(setTimeout(() => {
        const recheckEntry = jobState?.llms?.[llmName];
        if (!recheckEntry || isFinalizedEntry(recheckEntry)) return;
        triggerResponseCollectionPing(llmName, tabId, 'finalization_deferred_generation_active', {
          allowRecovery: true,
          maxAttempts: 3,
          baseDelay: 700
        });
      }, recheckDelay));
      return;
    }
    if (stableAnswerForceFinal) {
      appendLogEntry(llmName, {
        type: 'RESPONSE',
        label: 'Finalization forced (stable answer evidence)',
        details: `len=${pendingAnswerLength} elapsed=${elapsedMs}ms stop=${!!state.stopVisible} busy=${!!state.busyVisible}`,
        level: 'warning',
        meta: {
          tabId,
          elapsedMs,
          pendingAnswerLength,
          stopVisible: !!state.stopVisible,
          busyVisible: !!state.busyVisible,
          hasCompletionEvidence,
          thresholdMs: DEFER_STREAM_STABLE_FORCE_MS,
          thresholdChars: DEFER_STREAM_STABLE_FORCE_MIN_CHARS
        }
      });
    } else if (evidenceForceFinal) {
      appendLogEntry(llmName, {
        type: 'RESPONSE',
        label: 'Finalization forced (answer evidence policy)',
        details: `reason=${evidenceFinalization.reason} len=${pendingAnswerLength} stop=${!!state.stopVisible} busy=${!!state.busyVisible}`,
        level: 'warning',
        meta: {
          tabId,
          elapsedMs,
          pendingAnswerLength,
          answerEvidence: pendingAnswerEvidence,
          finalizationPolicy: evidenceFinalization
        }
      });
    }
    // streamingMaxReached alone must not downgrade a stable-answer finalization:
    // run 1782940321214 GPT had a stable 3895-char answer, no Stop button and only
    // a stuck busy indicator for 210s — "Finalization forced (stable answer
    // evidence)" then finalized PARTIAL streaming_incomplete, contradicting its own
    // log line. The stable evidence wins only when the SAME text was observed
    // unchanged across repeated defer checks; a single long snapshot at streaming
    // max (possibly mid-generation) still finalizes as streaming_incomplete PARTIAL.
    const observedStableAcrossChecks = Number(liveEntry.pendingFinalAnswerStableCount || 0) >= 2;
    const streamingIncompleteFinal = streamingMaxReached
      && !(stableAnswerForceFinal && observedStableAcrossChecks);
    handleLLMResponse(
      llmName,
      liveEntry.pendingFinalAnswer || answer,
      null,
      {
        ...(metaObj || {}),
        finalizationDeferredCheck: true,
        responseMeta: {
          ...(metaObj?.responseMeta || {}),
          source: metaObj?.responseMeta?.source || 'deferred_finalization',
          completionReason: streamingIncompleteFinal ? 'streaming_incomplete' : (evidenceFinalization.ok ? evidenceFinalization.reason : 'generation_inactive'),
          partial: streamingIncompleteFinal || pendingAnswerEvidence?.partialAllowed || undefined,
          answerEvidence: pendingAnswerEvidence || undefined,
          forceTerminalSuccess: streamingIncompleteFinal ? false : metaObj?.responseMeta?.forceTerminalSuccess,
          lateCollectFinal: streamingIncompleteFinal ? false : metaObj?.responseMeta?.lateCollectFinal
        }
      },
      liveEntry.pendingFinalAnswerHtml || answerHtml || ''
    );
  }).catch(() => {
    handleLLMResponse(
      llmName,
      answer,
      null,
      { ...(metaObj || {}), finalizationDeferredCheck: true },
      answerHtml || ''
    );
  });
  return true;
}

function scheduleStablePendingAutoFinalization(llmName, tabId, metaObj = {}, reason = 'stable_pending') {
  const entry = jobState?.llms?.[llmName];
  if (!entry || isFinalizedEntry(entry)) return false;
  if (!isValidTabId(tabId)) return false;
  const pendingText = String(entry.pendingFinalAnswer || entry.answer || '').trim();
  if (pendingText.length < DEFER_STREAM_STABLE_FORCE_MIN_CHARS) return false;
  const dispatchId = metaObj?.dispatchId || entry?.lastDispatchMeta?.dispatchId || entry?.confirmedDispatchId || null;
  if (
    entry.stablePendingAutoFinalizeDispatchId
    && String(entry.stablePendingAutoFinalizeDispatchId) === String(dispatchId || '')
    && Number(entry.stablePendingAutoFinalizeDueAt || 0) > Date.now()
  ) {
    return true;
  }
  const startedAt = Number(entry.finalizationDeferStartedAt || entry.earlyTerminalGuard?.startedAt || Date.now());
  const dueAt = Math.max(Date.now() + 500, startedAt + STABLE_PENDING_AUTO_FINALIZE_MS);
  entry.stablePendingAutoFinalizeDispatchId = dispatchId || null;
  entry.stablePendingAutoFinalizeDueAt = dueAt;
  const delayMs = Math.max(500, dueAt - Date.now());
  const timer = registerSessionTimer(setTimeout(async () => {
    deregisterSessionTimer(timer);
    const liveEntry = jobState?.llms?.[llmName];
    if (!liveEntry || isFinalizedEntry(liveEntry)) return;
    if (String(liveEntry.stablePendingAutoFinalizeDispatchId || '') !== String(dispatchId || '')) return;
    const latestPending = String(liveEntry.pendingFinalAnswer || liveEntry.answer || '').trim();
    if (latestPending.length < DEFER_STREAM_STABLE_FORCE_MIN_CHARS) return;
    // Run 1782945983672: Claude typed the prompt for ~40s and this timer fired
    // one second BEFORE the ctrl+enter send, finalizing the previous on-page
    // answer as this run's SUCCESS; the real 7895-char answer arriving seconds
    // later was dropped as duplicate_final. While the dispatch command was sent
    // but the submit is still unconfirmed, the stable pending text can only be
    // pre-dispatch page content — never auto-finalize it.
    if (liveEntry.awaitingSubmitConfirmation === true && !liveEntry.promptSubmittedAt) {
      appendLogEntry(llmName, {
        type: 'RESPONSE',
        label: 'Stable pending auto-finalization blocked (submit unconfirmed)',
        details: `len=${latestPending.length} reason=${reason}`,
        level: 'warning',
        meta: { dispatchId, reason, awaitingSubmitConfirmation: true }
      });
      emitTelemetry(llmName, 'FINALIZE_BLOCKED_SUBMIT_PENDING', {
        level: 'warning',
        details: `stable_pending:${reason} len=${latestPending.length}`,
        meta: { dispatchId, reason, source: 'stable_pending_auto_finalization' },
        force: true
      });
      liveEntry.stablePendingAutoFinalizeDispatchId = null;
      liveEntry.stablePendingAutoFinalizeDueAt = 0;
      return;
    }
    const liveTabId = resolveBoundTabIdForOrchestrator(llmName, liveEntry);
    if (!isValidTabId(liveTabId)) return;
    // Run 1782945983672 (Z.ai): the lifecycle detector reported COMPLETE at
    // 3351 chars two seconds before this timer fired, but the timer finalized
    // the stale mid-stream pending snapshot (1843 chars). When a longer
    // completed answer is known, re-collect it instead of finalizing the stub.
    const knownCompleteLength = Number(
      liveEntry.answerCompleteTextLength
      || liveEntry.lifecycleReadyMeta?.textLength
      || 0
    ) || 0;
    const completeRefreshCount = Number(liveEntry.stablePendingCompleteRefreshCount || 0);
    const pendingShorterThanComplete = knownCompleteLength > latestPending.length + 24;
    if (pendingShorterThanComplete && completeRefreshCount < 3) {
      liveEntry.stablePendingCompleteRefreshCount = completeRefreshCount + 1;
      appendLogEntry(llmName, {
        type: 'RESPONSE',
        label: 'Stable pending auto-finalization deferred (longer complete answer detected)',
        details: `pending=${latestPending.length} complete=${knownCompleteLength} reason=${reason} refresh=${completeRefreshCount + 1}/3`,
        level: 'warning',
        meta: { dispatchId, reason, pendingLength: latestPending.length, knownCompleteLength }
      });
      emitTelemetry(llmName, 'STABLE_PENDING_STALE_SHORTER_THAN_COMPLETE', {
        level: 'warning',
        details: `pending=${latestPending.length} complete=${knownCompleteLength}`,
        meta: { dispatchId, reason, pendingLength: latestPending.length, knownCompleteLength, refreshAttempt: completeRefreshCount + 1 },
        force: true
      });
      liveEntry.stablePendingAutoFinalizeDispatchId = null;
      liveEntry.stablePendingAutoFinalizeDueAt = 0;
      triggerResponseCollectionPing(llmName, liveTabId, 'stable_pending_complete_refresh', {
        allowRecovery: true,
        maxAttempts: 3,
        baseDelay: 700
      });
      return;
    }
    let state = null;
    try {
      if (chrome?.scripting?.executeScript) {
        const results = await chrome.scripting.executeScript({
          target: { tabId: liveTabId },
          func: detectActiveGenerationInPage,
          args: [llmName]
        });
        state = Array.isArray(results) ? results.find((item) => item?.result)?.result : null;
      }
    } catch (err) {
      state = { probeError: err?.message || String(err) };
    }
    if (state?.active && state?.stopVisible) {
      appendLogEntry(llmName, {
        type: 'RESPONSE',
        label: 'Stable pending auto-finalization deferred (stop visible)',
        details: `len=${latestPending.length} reason=${reason}`,
        level: 'warning',
        meta: {
          dispatchId,
          tabId: liveTabId,
          stopVisible: true,
          busyVisible: !!state.busyVisible
        }
      });
      return;
    }
    appendLogEntry(llmName, {
      type: 'RESPONSE',
      label: 'Stable pending auto-finalization',
      details: `len=${latestPending.length} reason=${reason} stop=${!!state?.stopVisible} busy=${!!state?.busyVisible}`,
      level: 'success',
      meta: {
        dispatchId,
        tabId: liveTabId,
        reason,
        probeError: state?.probeError || null,
        stopVisible: !!state?.stopVisible,
        busyVisible: !!state?.busyVisible,
        thresholdMs: STABLE_PENDING_AUTO_FINALIZE_MS,
        thresholdChars: DEFER_STREAM_STABLE_FORCE_MIN_CHARS
      }
    });
    handleLLMResponse(
      llmName,
      latestPending,
      null,
      {
        ...(metaObj || {}),
        finalizationDeferredCheck: true,
        stablePendingAutoFinalization: true,
        responseMeta: {
          ...(metaObj?.responseMeta || {}),
          source: metaObj?.responseMeta?.source || 'deferred_finalization',
          completionReason: 'stable_pending_auto_finalization',
          // Refresh attempts could not re-collect the longer completed answer
          // the lifecycle reported: the stub must not claim to be complete.
          partial: pendingShorterThanComplete ? true : (metaObj?.responseMeta?.partial),
          forceTerminalSuccess: !pendingShorterThanComplete,
          lateCollectFinal: true
        }
      },
      liveEntry.pendingFinalAnswerHtml || ''
    );
  }, delayMs));
  saveJobState(jobState);
  return true;
}

function buildEarlyTerminalGuardSignature(text) {
  const value = String(text || '').replace(/\s+/g, ' ').trim();
  if (!value) return '';
  if (value.length <= 512) return value;
  return `${value.slice(0, 256)}::${value.slice(-256)}`;
}

function isEarlyTerminalGuardRisk({ llmName, responseSource, completionReason }) {
  if (!EARLY_TERMINAL_GUARD_MODELS.has(llmName)) return false;
  const source = String(responseSource || '').toLowerCase();
  const reason = String(completionReason || '').toLowerCase();
  if (source === 'dom_snapshot_recovery') return true;
  if (source === 'deferred_finalization' || reason === 'generation_inactive') {
    return true;
  }
  return false;
}

function maybeDeferEarlyTerminalSuccess(llmName, entry, options = {}) {
  if (!entry) return false;
  const {
    trimmedAnswer = '',
    normalizedAnswer = '',
    normalizedHtml = '',
    responseSource = '',
    completionReason = '',
    metaObj = null,
    sendConfirmed = null
  } = options;
  const responseMeta = metaObj?.responseMeta && typeof metaObj.responseMeta === 'object' ? metaObj.responseMeta : {};
  if (
    responseMeta.forceTerminalSuccess
    || responseMeta.lateCollectFinal
    || responseMeta.manualRecovery
    || responseMeta.manualOverride
    || responseMeta.preTerminalMaterialize
    || metaObj?.preTerminalMaterialize
    || metaObj?.preTerminalMaterializeFinal
  ) {
    entry.earlyTerminalGuard = null;
    return false;
  }
  const now = Date.now();
  const answerLength = String(trimmedAnswer || '').length;
  const signature = buildEarlyTerminalGuardSignature(trimmedAnswer);
  const dispatchId = metaObj?.dispatchId || entry?.lastDispatchMeta?.dispatchId || null;
  const lengthPolicy = self.AnswerLengthPolicy?.evaluateTerminalAnswerLength?.(llmName, answerLength, { finalStatus: 'SUCCESS' }) || {};
  const suspectShortDefer = Boolean(
    SUSPECT_SHORT_DEFER_MODELS.has(llmName)
    && lengthPolicy.suspectShortSuccess
  );
  if (!isEarlyTerminalGuardRisk({ llmName, responseSource, completionReason })) return false;
  if (!suspectShortDefer && (entry.lifecycleReadyAt || entry.lifecycleReadyMeta?.state === 'COMPLETE')) {
    entry.earlyTerminalGuard = null;
    return false;
  }
  const existing = entry.earlyTerminalGuard && String(entry.earlyTerminalGuard.dispatchId || '') === String(dispatchId || '')
    ? entry.earlyTerminalGuard
    : null;
  const startedAt = Number(existing?.startedAt || now);
  const sameObservation = !!existing
    && existing.signature === signature
    && Number(existing.answerLength || 0) === answerLength
    && (now - Number(existing.lastSeenAt || startedAt)) >= EARLY_TERMINAL_GUARD_STABLE_MS;
  const waitedMs = Math.max(0, now - startedAt);
  const forceLongAnswerAfterMaxWait = Boolean(
    existing
    && answerLength >= EARLY_TERMINAL_GUARD_FORCE_SUCCESS_CHARS
    && waitedMs >= EARLY_TERMINAL_GUARD_MAX_WAIT_MS
  );
  const forceAnyAnswerAfterExtendedWait = Boolean(
    existing
    && answerLength >= DOM_SNAPSHOT_RECOVERY_MIN_CHARS
    && waitedMs >= (EARLY_TERMINAL_GUARD_MAX_WAIT_MS * 3)
  );
  const allowTerminalSuccess = (
    sameObservation
    && (answerLength >= EARLY_TERMINAL_GUARD_FORCE_SUCCESS_CHARS || waitedMs >= EARLY_TERMINAL_GUARD_MAX_WAIT_MS)
  ) || forceLongAnswerAfterMaxWait || forceAnyAnswerAfterExtendedWait;

  if (allowTerminalSuccess && !suspectShortDefer) {
    if (!sameObservation) {
      appendLogEntry(llmName, {
        type: 'RESPONSE',
        label: 'Terminal success guard max wait elapsed',
        details: `len=${answerLength} waited=${waitedMs}ms`,
        level: 'warning',
        meta: {
          dispatchId,
          answerLength,
          waitedMs,
          forceLongAnswerAfterMaxWait,
          forceAnyAnswerAfterExtendedWait,
          responseSource,
          completionReason
        }
      });
    }
    entry.earlyTerminalGuard = null;
    return false;
  }

  // Field evidence 2026-08-01, single-model Grok run: `deferred_finalization`
  // extracted the real answer (2546 chars, identity current_dispatch) and two
  // seconds later a `manual_ping` extraction of 88 chars — the same wrong node
  // as before — committed over it and became the terminal. The user saw the
  // answer appear and then be replaced by their own prompt. Both extractions
  // claim identity current_dispatch, so identity cannot separate them; what
  // separates them is that one is a fraction of the other.
  // A later extraction for the same dispatch may not displace a materially
  // longer one already held. Growth still passes, because it is not shorter.
  const incomingFinalAnswer = String(normalizedAnswer || trimmedAnswer || '');
  const heldFinalAnswer = String(entry.pendingFinalAnswer || '');
  const heldDispatchId = entry.pendingFinalAnswerDispatchId || null;
  const sameDispatchAsHeld = !heldDispatchId || !dispatchId || String(heldDispatchId) === String(dispatchId);
  const wouldShrinkHeldAnswer = Boolean(
    heldFinalAnswer.length >= DOM_SNAPSHOT_RECOVERY_MIN_CHARS
    && sameDispatchAsHeld
    && incomingFinalAnswer.length * 2 < heldFinalAnswer.length
  );
  if (wouldShrinkHeldAnswer) {
    emitTelemetry(llmName, 'SHORTER_EXTRACTION_REJECTED', {
      level: 'warning',
      details: `held=${heldFinalAnswer.length} incoming=${incomingFinalAnswer.length} source=${responseSource || 'unknown'}`,
      meta: {
        dispatchId,
        heldAnswerLength: heldFinalAnswer.length,
        incomingAnswerLength: incomingFinalAnswer.length,
        source: responseSource || null,
        reason: 'later_extraction_would_shrink_held_answer'
      },
      force: true
    });
    return false;
  }
  entry.pendingFinalAnswer = incomingFinalAnswer;
  entry.pendingFinalAnswerDispatchId = dispatchId || heldDispatchId || null;
  entry.pendingFinalAnswerHtml = String(normalizedHtml || '');
  entry.earlyTerminalGuard = {
    dispatchId,
    startedAt,
    lastSeenAt: now,
    signature,
    answerLength,
    responseSource: String(responseSource || ''),
    completionReason: String(completionReason || '')
  };

  appendLogEntry(llmName, {
    type: 'RESPONSE',
    label: suspectShortDefer ? 'Terminal success deferred (suspect short answer)' : 'Terminal success deferred (await lifecycle)',
    details: `source=${responseSource || 'unknown'} reason=${completionReason || 'unknown'} len=${answerLength} waited=${waitedMs}ms`,
    level: 'warning',
    meta: {
      dispatchId,
      answerLength,
      waitedMs,
      lifecycleReadyAt: entry.lifecycleReadyAt || null,
      responseSource,
      completionReason,
      lengthPolicy
    }
  });

  updateModelState(llmName, 'RECEIVING', {
    message: 'Awaiting full answer confirmation',
    completionReason,
    responseSource
  });

  sendMessageToResultsTab({
    type: 'LLM_PARTIAL_RESPONSE',
    llmName,
    answer: normalizedAnswer,
    answerHtml: normalizedHtml,
    requestId: entry?.requestId || null,
    metadata: {
      status: 'RECEIVING',
      reason: 'await_lifecycle_ready',
      completionReason,
      responseSource,
      sendConfirmed
    },
    logs: getLogSnapshot(llmName)
  });

  const nextAllowedPingAt = Number(entry.earlyTerminalGuardNextPingAt || 0);
  const tabId = resolveBoundTabIdForOrchestrator(llmName, entry);
  scheduleStablePendingAutoFinalization(llmName, tabId, metaObj, 'early_terminal_guard');
  if (isValidTabId(tabId) && now >= nextAllowedPingAt) {
    entry.earlyTerminalGuardNextPingAt = now + EARLY_TERMINAL_GUARD_REPING_MS;
    registerSessionTimer(setTimeout(() => {
      const liveEntry = jobState?.llms?.[llmName];
      if (!liveEntry || isFinalizedEntry(liveEntry)) return;
      if (liveEntry.lifecycleReadyAt || liveEntry.lifecycleReadyMeta?.state === 'COMPLETE') return;
      const liveTabId = resolveBoundTabIdForOrchestrator(llmName, liveEntry);
      if (!isValidTabId(liveTabId)) return;
      triggerResponseCollectionPing(llmName, liveTabId, 'early_terminal_guard_followup', {
        allowRecovery: true,
        maxAttempts: 3,
        baseDelay: 700
      });
    }, EARLY_TERMINAL_GUARD_REPING_MS));
  }

  saveJobState(jobState);
  broadcastGlobalState();
  return true;
}

const resolveHardStopDeferWindowMs = (llmName) => {
  const byModelMs = Number(HARD_STOP_DEFER_WINDOW_BY_MODEL_MS?.[llmName] || 0);
  if (Number.isFinite(byModelMs) && byModelMs > 0) return byModelMs;
  return HARD_STOP_DEFER_WINDOW_DEFAULT_MS;
};

const resolveBoundTabIdForOrchestrator = (llmName, entry = null) => {
  if (typeof self.getBoundTabId === 'function') {
    return self.getBoundTabId(llmName, entry);
  }
  if (typeof TabMapManager !== 'undefined' && typeof TabMapManager.get === 'function') {
    return TabMapManager.get(llmName) || null;
  }
  return null;
};

const buildInitialLlmEntry = (llmName, overrides = {}) => {
  const entry = {
    ...(LLM_TARGETS[llmName] || {}),
    llmName,
    tabId: null,
    answer: null,
    messageSent: false,
    dispatchInFlight: false,
    dispatchState: 'IDLE',
    csBusyUntil: 0,
    dispatchAttempts: 0,
    focusSwitches: 0,
    lastDispatchAt: 0,
    lastDispatchMeta: null,
    recentDispatchIds: [],
    confirmedDispatchId: null,
    preDispatchAnswerSignature: null,
    preDispatchAnswerHash: null,
    preDispatchAnswerDispatchId: null,
    preDispatchAnswerCapturedAt: 0,
    promptSubmittedAt: null,
    promptInsertedAt: null,
    promptInsertedDispatchId: null,
    preInsertionDeferralCount: 0,
    preInsertionDeferral: null,
    submitSource: null,
    dispatchSource: null,
    adaptiveCollectActive: false,
    adaptiveCollectScheduledAt: null,
    status: 'IDLE',
    logs: [],
    humanVisits: 0,
    humanStalled: false,
    skipHumanLoop: false,
    humanVisitDurations: [],
    humanVisitTotalMs: 0,
    typingActive: false,
    typingStartedAt: null,
    typingEndedAt: null,
    typingGuardUntil: 0,
    typingGuardReason: null,
    lastRuntimeActivityAt: 0,
    lastRuntimeActivitySource: null,
    pingTransportErrorCount: 0,
    lastPingTransportErrorAt: 0,
    lastEarlyGestureAt: 0,
    hardStopDeferredAt: 0,
    hardStopDeferredDispatchId: null,
    automationDeadlineAt: null,
    automationDeadlinePhase: null,
    automationDeadlineBudgetMs: null,
    automationDeadlineReached: false,
    lastFinalEmitKey: null,
    lastFinalEmittedAt: 0,
    transientBlocker: null,
    transientBlockerActive: null,
    transientBlockerActiveAt: 0,
    transientBlockerRunSessionId: null,
    transientBlockerDispatchId: null,
    transientBlockerTabId: null,
    lastClearedTransientBlockerToken: null,
    perplexityPaywallResumeCount: 0,
    ...overrides
  };
  entry.modelRunState = self.ModelRunState?.deriveModelRunState
    ? self.ModelRunState.deriveModelRunState(entry)
    : null;
  return entry;
};

const ensureRoundEntries = (selectedLLMs, reason = 'round_integrity') => {
  if (!jobState?.llms || !Array.isArray(selectedLLMs)) return;
  selectedLLMs.forEach((llmName) => {
    if (!llmName) return;
    if (jobState.llms[llmName]) return;
    const tabId = TabMapManager.get(llmName) || null;
    jobState.llms[llmName] = buildInitialLlmEntry(llmName, {
      tabId,
      status: 'RECOVERY_PENDING'
    });
    emitTelemetry(llmName, 'ROUND_STATE_REPAIR', {
      level: 'warning',
      details: 'missing model entry restored before round',
      meta: { reason, tabId }
    });
  });
};

const ensureManualRecoveryModelEntry = (llmName, tabId = null, reason = 'manual_recovery') => {
  if (!llmName) return null;
  if (!jobState || typeof jobState !== 'object') {
    jobState = {};
  }
  if (!jobState.llms || typeof jobState.llms !== 'object') {
    jobState.llms = {};
  }
  if (!Number.isFinite(Number(jobState.responsesCollected))) {
    jobState.responsesCollected = 0;
  }
  if (typeof jobState.evaluationStarted === 'undefined') {
    jobState.evaluationStarted = false;
  }
  if (!jobState.session || typeof jobState.session !== 'object') {
    const startedAt = Date.now();
    jobState.session = {
      startTime: startedAt,
      totalModels: Math.max(1, Object.keys(jobState.llms).length || 1),
      selectedModels: Object.keys(jobState.llms).length ? Object.keys(jobState.llms) : [llmName],
      completed: 0,
      failed: 0,
      focusSwitches: 0,
      boundTabIds: [],
      recoveryOnly: true
    };
  }
  if (!jobState.llms[llmName]) {
    jobState.llms[llmName] = buildInitialLlmEntry(llmName, {
      tabId: isValidTabId(tabId) ? tabId : null,
      status: 'RECOVERY_PENDING',
      recoveryOnly: true
    });
    appendLogEntry(llmName, {
      type: 'PING',
      label: 'Manual recovery entry created',
      details: reason,
      level: 'warning',
      meta: { tabId }
    });
  } else if (isValidTabId(tabId)) {
    jobState.llms[llmName].tabId = tabId;
  }
  if (!Array.isArray(jobState.session.selectedModels)) {
    jobState.session.selectedModels = [];
  }
  if (!jobState.session.selectedModels.includes(llmName)) {
    jobState.session.selectedModels.push(llmName);
    jobState.session.totalModels = Math.max(Number(jobState.session.totalModels || 0), jobState.session.selectedModels.length);
  }
  return jobState.llms[llmName];
};

const getManualRecoveryState = (entry) => {
  if (!entry) return null;
  if (!entry.manualRecovery || typeof entry.manualRecovery !== 'object') {
    entry.manualRecovery = {
      attempt: 0,
      strategyIndex: 0,
          failedStrategyIds: [],
          failedSelectors: [],
          candidates: [],
          lastAcceptedCandidate: null,
          exhausted: false,
          startedAt: Date.now(),
          updatedAt: Date.now()
    };
  }
  if (!Array.isArray(entry.manualRecovery.failedStrategyIds)) entry.manualRecovery.failedStrategyIds = [];
  if (!Array.isArray(entry.manualRecovery.failedSelectors)) entry.manualRecovery.failedSelectors = [];
  if (!Array.isArray(entry.manualRecovery.candidates)) entry.manualRecovery.candidates = [];
  return entry.manualRecovery;
};

const buildManualLatestRecoveryOptions = (entry, llmName, strategy = null, options = {}) => {
  const signatures = [];
  const pushSignature = (value) => {
    const normalized = normalizeAnswerSignatureBg(value);
    if (normalized && !signatures.includes(normalized)) signatures.push(normalized);
  };
  if (!options.keepCurrentAnswer) {
    pushSignature(entry?.answer || '');
    pushSignature(entry?.pendingFinalAnswer || '');
  }
  pushSignature(entry?.preDispatchAnswerSignature || '');
  return {
    enabled: true,
    manualRecovery: true,
    manualOverride: true,
    manualLatestRecovery: true,
    selectorAttempt: Number(entry?.manualRecovery?.attempt || 0),
    advanceStrategy: true,
    strategyId: strategy?.id || 'bottom_most',
    strategyIndex: Number.isFinite(Number(strategy?.index))
      ? Number(strategy.index)
      : Math.max(0, MANUAL_RECOVERY_STRATEGIES.findIndex((item) => item.id === 'bottom_most')),
    skipStrategyIds: Array.isArray(entry?.manualRecovery?.failedStrategyIds)
      ? entry.manualRecovery.failedStrategyIds.slice()
      : [],
    skipSelectors: [],
    excludeTextSignatures: signatures,
    reason: 'manual_latest_recovery',
    llmName
  };
};

const markLastManualCandidateRejected = (recovery) => {
  if (!recovery) return;
  const last = Array.isArray(recovery.candidates) ? recovery.candidates[recovery.candidates.length - 1] : null;
  if (last?.strategyId && !recovery.failedStrategyIds.includes(last.strategyId)) {
    recovery.failedStrategyIds.push(last.strategyId);
  }
  const selector = last?.selectorDescriptor || last?.selectorUsed || null;
  if (selector && !recovery.failedSelectors.includes(selector)) {
    recovery.failedSelectors.push(selector);
  }
  recovery.attempt = Number(recovery.attempt || 0) + 1;
  recovery.strategyIndex = Math.min(
    MANUAL_RECOVERY_STRATEGIES.length,
    Number(recovery.strategyIndex || 0) + 1
  );
  recovery.updatedAt = Date.now();
};

const resolveManualRecoveryStrategy = (recovery) => {
  const failed = new Set(Array.isArray(recovery?.failedStrategyIds) ? recovery.failedStrategyIds : []);
  const start = Math.max(0, Number(recovery?.strategyIndex || 0));
  for (let offset = 0; offset < MANUAL_RECOVERY_STRATEGIES.length; offset += 1) {
    const index = (start + offset) % MANUAL_RECOVERY_STRATEGIES.length;
    const strategy = MANUAL_RECOVERY_STRATEGIES[index];
    if (strategy?.id && !failed.has(strategy.id)) {
      return { ...strategy, index };
    }
  }
  return null;
};

const saveManualRecoveryCandidate = (entry, result = {}, strategy = null) => {
  const recovery = getManualRecoveryState(entry);
  if (!recovery || !result?.ok || !result.text) return null;
  const candidate = {
    strategyId: result.strategyId || strategy?.id || null,
    strategyIndex: Number.isFinite(Number(result.strategyIndex)) ? Number(result.strategyIndex) : (strategy?.index ?? null),
    selectorUsed: result.selectorUsed || null,
    selectorDescriptor: result.selectorDescriptor || result.selectorUsed || null,
    source: result.source || 'late_collect',
    textHash: result.textHash || simpleLateAnswerHash(result.text),
    length: String(result.text || '').trim().length,
    candidateCount: Number(result.candidateCount || result.candidates || 0),
    acceptedAt: Date.now()
  };
  recovery.candidates.push(candidate);
  recovery.lastCandidate = candidate;
  recovery.lastAcceptedCandidate = candidate;
  recovery.lastStrategyId = candidate.strategyId;
  recovery.lastSelectorUsed = candidate.selectorDescriptor || candidate.selectorUsed || null;
  recovery.exhausted = false;
  recovery.updatedAt = Date.now();
  if (Number.isFinite(Number(candidate.strategyIndex))) {
    recovery.strategyIndex = Math.min(MANUAL_RECOVERY_STRATEGIES.length, Number(candidate.strategyIndex) + 1);
  }
  return candidate;
};

const waitForRound0Binding = async (llmName, sessionId, timeoutMs = ROUND0_BIND_WAIT_TIMEOUT_MS) => {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (sessionId && !isSessionActive(sessionId)) return false;
    const entry = jobState?.llms?.[llmName] || null;
    const boundTabId = resolveBoundTabIdForOrchestrator(llmName, entry);
    if (isValidTabId(boundTabId)) {
      const tab = await getTabSafe(boundTabId);
      if (tab && (typeof isEligibleTabForLlm !== 'function' || isEligibleTabForLlm(llmName, tab))) {
        return true;
      }
    }
    await orchestratorSleepMs(ROUND0_BIND_POLL_MS);
  }
  emitTelemetry(llmName, 'ROUND0_BIND_WAIT_TIMEOUT', {
    level: 'warning',
    details: `${timeoutMs}ms`,
    meta: { timeoutMs }
  });
  broadcastDiagnostic(llmName, {
    type: 'DISPATCH',
    label: 'ROUND0 bind timeout',
    details: `${timeoutMs}ms`,
    level: 'warning'
  });
  return false;
};

const postR2AutoCollectTimers = new Map();
const claudeRetryTimers = new Map();
const claudeRetryFinalizeTimers = new Map();
const adaptiveCollectTimers = new Map();

const clearClaudeRetryTimers = (llmName) => {
  const timer = claudeRetryTimers.get(llmName);
  if (timer) {
    clearTimeout(timer);
    deregisterSessionTimer(timer);
    claudeRetryTimers.delete(llmName);
  }
  const finalizeTimer = claudeRetryFinalizeTimers.get(llmName);
  if (finalizeTimer) {
    clearTimeout(finalizeTimer);
    deregisterSessionTimer(finalizeTimer);
    claudeRetryFinalizeTimers.delete(llmName);
  }
};

const getRecentPipelineErrorReason = (entry) => {
  const logs = Array.isArray(entry?.logs) ? entry.logs : [];
  for (let idx = logs.length - 1; idx >= 0; idx -= 1) {
    const log = logs[idx];
    if (!log || log.label !== 'PIPELINE_ERROR') continue;
    const reason = String(log?.meta?.message || log?.details || '').toLowerCase();
    if (reason) return reason;
  }
  return '';
};

const maybeRunEarlyGestureRecovery = (llmName, tabId, source = 'adaptive_ping_transport_error') => {
  if (!llmName || !isValidTabId(tabId)) return;
  if (!EARLY_GESTURE_RECOVERY_MODELS.has(llmName)) return;
  const entry = jobState?.llms?.[llmName];
  if (!entry || isFinalizedEntry(entry) || entry.automationVisitActive) return;
  const now = Date.now();
  const submittedAt = Number(entry.promptSubmittedAt || entry.lastDispatchAt || 0);
  if (!submittedAt) return;
  const elapsedMs = Math.max(0, now - submittedAt);
  const errors = Number(entry.pingTransportErrorCount || 0);
  const lastGestureAt = Number(entry.lastEarlyGestureAt || 0);
  if (elapsedMs < EARLY_GESTURE_RECOVERY_MIN_ELAPSED_MS) return;
  if (errors < EARLY_GESTURE_RECOVERY_MIN_ERRORS) return;
  if (lastGestureAt && now - lastGestureAt < EARLY_GESTURE_RECOVERY_COOLDOWN_MS) return;

  entry.lastEarlyGestureAt = now;
  const runSessionId = Number(jobState?.session?.startTime || 0) || null;
  emitTelemetry(llmName, 'EARLY_GESTURE_RECOVERY_START', {
    level: 'warning',
    details: source,
    meta: {
      tabId,
      source,
      elapsedMs,
      errors,
      cooldownMs: EARLY_GESTURE_RECOVERY_COOLDOWN_MS
    }
  });
  Promise.resolve().then(async () => {
    if (runSessionId && !isSessionActive(runSessionId)) return;
    const liveEntry = jobState?.llms?.[llmName];
    if (!liveEntry || isFinalizedEntry(liveEntry)) return;
    const liveTabId = resolveBoundTabIdForOrchestrator(llmName, liveEntry);
    if (!isValidTabId(liveTabId)) return;
    await runForcedAutomationVisits(llmName, liveTabId, runSessionId, {
      visits: 1,
      minMs: EARLY_GESTURE_RECOVERY_VISIT_MIN_MS,
      maxMs: EARLY_GESTURE_RECOVERY_VISIT_MAX_MS,
      reason: 'early_gesture_recovery'
    });
    const afterVisitEntry = jobState?.llms?.[llmName];
    if (!afterVisitEntry || isFinalizedEntry(afterVisitEntry)) return;
    const afterVisitTabId = resolveBoundTabIdForOrchestrator(llmName, afterVisitEntry);
    if (!isValidTabId(afterVisitTabId)) return;
    triggerResponseCollectionPing(llmName, afterVisitTabId, 'early_gesture_recovery');
    emitTelemetry(llmName, 'EARLY_GESTURE_RECOVERY_END', {
      details: 'visit_and_ping_done',
      meta: {
        tabId: afterVisitTabId,
        source
      }
    });
  }).catch((err) => {
    emitTelemetry(llmName, 'EARLY_GESTURE_RECOVERY_ERROR', {
      level: 'warning',
      details: err?.message || String(err),
      meta: { tabId, source }
    });
  });
};

const triggerResponseCollectionPing = (llmName, tabId, source = 'auto_collect', options = {}) => {
  if (!llmName || !isValidTabId(tabId)) return;
  const liveEntry = jobState?.llms?.[llmName];
  if (!liveEntry || isFinalizedEntry(liveEntry)) return;
  const opts = options && typeof options === 'object' ? options : {};
  const sourceTag = String(source || '').toLowerCase();
  const isHardStopPing = sourceTag.includes('hard_stop');
  const transportRetryDelays = Array.isArray(opts.transportRetryDelays) && opts.transportRetryDelays.length
    ? opts.transportRetryDelays
    : (isHardStopPing ? HARD_STOP_PING_RETRY_DELAYS_MS : FAST_PING_RETRY_DELAYS_MS);
  const maxAttempts = Math.max(
    1,
    Number(
      opts.maxAttempts
      || (Array.isArray(transportRetryDelays) ? transportRetryDelays.length : 0)
      || (isHardStopPing ? 4 : 3)
    )
  );
  const baseDelay = Math.max(1, Number(opts.baseDelay || 700));
  const allowRecovery = typeof opts.allowRecovery === 'boolean' ? opts.allowRecovery : isHardStopPing;
  extendPingWindowForLLM(llmName, MANUAL_PING_WINDOW_MS);
  const responseMeta = {
    source,
    runSessionId: Number(jobState?.session?.startTime || 0) || null,
    sessionId: Number(jobState?.session?.startTime || 0) || null,
    dispatchId: liveEntry?.lastDispatchMeta?.dispatchId || null,
    forceEmitOnUnchanged: opts.forceEmitOnUnchanged === true
  };
  sendPassiveMessageWithRetries(tabId, llmName, { action: 'getResponses', meta: responseMeta }, {
    maxAttempts,
    baseDelay,
    transportRetryDelays,
    allowRecovery,
    onSuccess: (response) => {
      const successEntry = jobState?.llms?.[llmName];
      if (successEntry) {
        successEntry.pingTransportErrorCount = 0;
      }
      if (response?.status === 'ignored_terminal') {
        if (opts.forceEmitOnUnchanged === true && typeof self.recoverAnswerViaDomSnapshot === 'function') {
          // The provider adapter may already have closed its observer after the
          // discarded pre-scroll delivery. Read fresh DOM through recovery.
          self.recoverAnswerViaDomSnapshot(llmName, tabId, `terminal_observer:${source}`, {
            dispatchId: successEntry?.lastDispatchMeta?.dispatchId || null
          }).catch(() => {});
        }
        return;
      }
      broadcastDiagnostic(llmName, {
        type: 'PING',
        label: 'getResponses command sent',
        details: response?.status ? `CS status: ${response.status}` : '',
        level: 'success'
      });
    },
    onError: (errMsg) => {
      const failedEntry = jobState?.llms?.[llmName];
      if (failedEntry) {
        failedEntry.pingTransportErrorCount = Number(failedEntry.pingTransportErrorCount || 0) + 1;
        failedEntry.lastPingTransportErrorAt = Date.now();
      }
      if (typeof self.recoverAnswerViaDomSnapshot === 'function') {
        self.recoverAnswerViaDomSnapshot(llmName, tabId, `passive_ping_error:${source}`, {
          dispatchId: failedEntry?.lastDispatchMeta?.dispatchId || null
        }).catch(() => {});
      }
      broadcastDiagnostic(llmName, {
        type: 'PING_ERROR',
        label: 'PING_TRANSPORT_ERROR',
        details: errMsg,
        level: 'warning'
      });
      maybeRunEarlyGestureRecovery(llmName, tabId, source);
    }
  });
};

function clearUnavailableObservationRecovery(entry, dispatchId = null) {
  if (!entry) return;
  if (dispatchId && entry.unavailableObservationRecoveryDispatchId
    && String(entry.unavailableObservationRecoveryDispatchId) !== String(dispatchId)) return;
  entry.unavailableObservationRecoveryAttempts = 0;
  entry.unavailableObservationRecoveryScheduled = false;
  entry.unavailableObservationRecoveryDueAt = null;
  entry.unavailableObservationRecoveryDispatchId = dispatchId || null;
}

function scheduleUnavailableObservationRetry(llmName, tabId, sessionId, dispatchId, source = 'late_collect') {
  const entry = jobState?.llms?.[llmName];
  if (!entry || isFinalizedEntry(entry) || !isValidTabId(tabId)) return false;
  if (entry.unavailableObservationRecoveryDispatchId
    && String(entry.unavailableObservationRecoveryDispatchId) !== String(dispatchId || '')) {
    clearUnavailableObservationRecovery(entry, dispatchId);
  }
  if (entry.unavailableObservationRecoveryScheduled === true) return true;
  const attempt = Math.max(0, Number(entry.unavailableObservationRecoveryAttempts || 0));
  if (attempt >= UNAVAILABLE_OBSERVATION_RETRY_DELAYS_MS.length) {
    emitTelemetry(llmName, 'OBSERVATION_RECOVERY_EXHAUSTED', {
      level: 'warning',
      details: `attempts=${attempt}`,
      meta: { tabId, dispatchId, source, attempts: attempt },
      force: true
    });
    return false;
  }
  const delayMs = UNAVAILABLE_OBSERVATION_RETRY_DELAYS_MS[attempt];
  entry.unavailableObservationRecoveryAttempts = attempt + 1;
  entry.unavailableObservationRecoveryScheduled = true;
  entry.unavailableObservationRecoveryDueAt = Date.now() + delayMs;
  entry.unavailableObservationRecoveryDispatchId = dispatchId || null;
  emitTelemetry(llmName, 'OBSERVATION_RECOVERY_SCHEDULED', {
    level: 'warning',
    details: `${attempt + 1}/${UNAVAILABLE_OBSERVATION_RETRY_DELAYS_MS.length}:${delayMs}ms`,
    meta: { tabId, dispatchId, source, attempt: attempt + 1, delayMs },
    force: true
  });
  let retryTimer = null;
  retryTimer = registerSessionTimer(setTimeout(() => {
    deregisterSessionTimer(retryTimer);
    const liveEntry = jobState?.llms?.[llmName];
    if (!liveEntry || isFinalizedEntry(liveEntry)) return;
    liveEntry.unavailableObservationRecoveryScheduled = false;
    liveEntry.unavailableObservationRecoveryDueAt = null;
    if (sessionId && !isSessionActive(sessionId)) return;
    if (dispatchId && liveEntry?.lastDispatchMeta?.dispatchId
      && String(liveEntry.lastDispatchMeta.dispatchId) !== String(dispatchId)) return;
    triggerResponseCollectionPing(llmName, tabId, 'observation_unavailable_retry', {
      allowRecovery: false,
      maxAttempts: 1,
      baseDelay: 500
    });
  }, delayMs));
  return true;
}

const clearAdaptiveCollectTimer = (llmName) => {
  const timer = adaptiveCollectTimers.get(llmName);
  if (timer) {
    clearTimeout(timer);
    deregisterSessionTimer(timer);
    adaptiveCollectTimers.delete(llmName);
  }
  const entry = jobState?.llms?.[llmName];
  if (entry) {
    entry.adaptiveCollectActive = false;
    entry.adaptiveCollectScheduledAt = null;
  }
};

const resolveAdaptiveProbeIntervalMs = (elapsedMs) => {
  if (elapsedMs < ADAPTIVE_PROBE_FAST_WINDOW_MS) return ADAPTIVE_PROBE_FAST_INTERVAL_MS;
  if (elapsedMs < ADAPTIVE_PROBE_MEDIUM_WINDOW_MS) return ADAPTIVE_PROBE_MEDIUM_INTERVAL_MS;
  if (elapsedMs < getAdaptiveProbeTotalWindowMs()) return ADAPTIVE_PROBE_SLOW_INTERVAL_MS;
  return 0;
};

const scheduleAdaptiveCollectionProbe = (llmName, sessionId, options = {}) => {
  if (!llmName) return;
  const entry = jobState?.llms?.[llmName];
  if (!entry || isFinalizedEntry(entry) || entry.dispatchSource === 'api') {
    clearAdaptiveCollectTimer(llmName);
    return;
  }
  const now = Date.now();
  const baseTs = Number(entry.promptSubmittedAt || entry.lastDispatchAt || now);
  const elapsedMs = Math.max(0, now - baseTs);
  const intervalMs = resolveAdaptiveProbeIntervalMs(elapsedMs);
  if (intervalMs <= 0) {
    emitTelemetry(llmName, 'ADAPTIVE_PROBE_STOP', {
      details: 'window_exhausted',
      meta: { elapsedMs, baseTs }
    });
    clearAdaptiveCollectTimer(llmName);
    return;
  }

  clearAdaptiveCollectTimer(llmName);
  entry.adaptiveCollectActive = true;
  entry.adaptiveCollectScheduledAt = now + intervalMs;
  const runSessionId = sessionId || getActiveSessionId();
  const timerId = registerSessionTimer(setTimeout(() => {
    deregisterSessionTimer(timerId);
    adaptiveCollectTimers.delete(llmName);

    const liveEntry = jobState?.llms?.[llmName];
    if (!liveEntry || isFinalizedEntry(liveEntry)) {
      clearAdaptiveCollectTimer(llmName);
      return;
    }
    if (runSessionId && !isSessionActive(runSessionId)) {
      clearAdaptiveCollectTimer(llmName);
      return;
    }
    const liveTabId = resolveBoundTabIdForOrchestrator(llmName, liveEntry);
    const probeElapsedMs = Math.max(0, Date.now() - Number(liveEntry.promptSubmittedAt || baseTs));
    if (isValidTabId(liveTabId)) {
      emitTelemetry(llmName, 'ADAPTIVE_PROBE_TICK', {
        details: options.reason || 'adaptive_collect',
        meta: { elapsedMs: probeElapsedMs, tabId: liveTabId, intervalMs }
      });
      triggerResponseCollectionPing(llmName, liveTabId, options.source || 'adaptive_collect');
    } else {
      emitTelemetry(llmName, 'ADAPTIVE_PROBE_SKIP', {
        level: 'warning',
        details: 'missing_tab',
        meta: { elapsedMs: probeElapsedMs, intervalMs }
      });
    }
    scheduleAdaptiveCollectionProbe(llmName, runSessionId, options);
  }, intervalMs));

  adaptiveCollectTimers.set(llmName, timerId);
};

const schedulePostR2AutoCollect = (llmName, tabId, sessionId) => {
  if (!llmName || !isValidTabId(tabId)) return;
  const entry = jobState?.llms?.[llmName];
  if (!entry || isFinalizedEntry(entry)) return;
  if (entry.postR2AutoCollectScheduledAt) return;
  entry.postR2AutoCollectScheduledAt = Date.now();
  const timerId = registerSessionTimer(setTimeout(async () => {
    deregisterSessionTimer(timerId);
    postR2AutoCollectTimers.delete(llmName);
    const liveEntry = jobState?.llms?.[llmName];
    if (!liveEntry || isFinalizedEntry(liveEntry)) return;
    const boundTabId = resolveBoundTabIdForOrchestrator(llmName, liveEntry);
    if (!isValidTabId(boundTabId)) return;
    await runForcedAutomationVisits(llmName, boundTabId, sessionId, {
      visits: POST_R2_AUTO_COLLECT_VISIT_COUNT,
      minMs: POST_R2_AUTO_COLLECT_VISIT_MIN_MS,
      maxMs: POST_R2_AUTO_COLLECT_VISIT_MAX_MS,
      reason: 'post_r2_precollect'
    });
    const afterVisitEntry = jobState?.llms?.[llmName];
    if (!afterVisitEntry || isFinalizedEntry(afterVisitEntry)) return;
    triggerResponseCollectionPing(llmName, boundTabId, 'post_r2_auto');
  }, POST_R2_AUTO_COLLECT_DELAY_MS));
  postR2AutoCollectTimers.set(llmName, timerId);
};

const scheduleClaudeHardTimeoutRetry = (llmName, entry, metaObj, sessionId) => {
  if (!entry || entry.hardTimeoutRetryDone) return false;
  const tabId = resolveBoundTabIdForOrchestrator(llmName, entry);
  if (!isValidTabId(tabId)) return false;
  entry.hardTimeoutRetryDone = true;
  entry.hardTimeoutRetryInFlight = true;
  entry.hardTimeoutRetryScheduledAt = Date.now();
  broadcastDiagnostic(llmName, {
    type: 'RESPONSE',
    label: 'Retry extraction scheduled',
    details: 'hard_timeout',
    level: 'warning'
  });
  emitTelemetry(llmName, 'RETRY_EXTRACTION_SCHEDULED', {
    level: 'warning',
    details: 'hard_timeout',
    meta: { tabId }
  });
  const timerId = registerSessionTimer(setTimeout(async () => {
    deregisterSessionTimer(timerId);
    claudeRetryTimers.delete(llmName);
    const liveEntry = jobState?.llms?.[llmName];
    if (!liveEntry || isFinalizedEntry(liveEntry)) return;
    const boundTabId = resolveBoundTabIdForOrchestrator(llmName, liveEntry);
    if (!isValidTabId(boundTabId)) return;
    await runForcedAutomationVisits(llmName, boundTabId, sessionId, {
      visits: 1,
      minMs: CLAUDE_RETRY_VISIT_MIN_MS,
      maxMs: CLAUDE_RETRY_VISIT_MAX_MS,
      reason: 'claude_retry'
    });
    triggerResponseCollectionPing(llmName, boundTabId, 'claude_retry');
  }, CLAUDE_RETRY_DELAY_MS));
  claudeRetryTimers.set(llmName, timerId);
  const finalizeTimer = registerSessionTimer(setTimeout(() => {
    deregisterSessionTimer(finalizeTimer);
    claudeRetryFinalizeTimers.delete(llmName);
    const liveEntry = jobState?.llms?.[llmName];
    if (!liveEntry || isFinalizedEntry(liveEntry)) return;
    liveEntry.hardTimeoutRetryInFlight = false;
    handleLLMResponse(
      llmName,
      '',
      { type: 'hard_timeout_retry_exhausted', message: 'Claude retry expired' },
      metaObj || null,
      ''
    );
  }, CLAUDE_RETRY_FINALIZE_MS));
  claudeRetryFinalizeTimers.set(llmName, finalizeTimer);
  return true;
};

const stopContentAutomationAtDeadline = (llmName, entry, phase, budgetMs) => {
  const tabId = resolveBoundTabIdForOrchestrator(llmName, entry);
  if (!isValidTabId(tabId)) return false;
  const payload = {
    reason: 'automation_deadline',
    phase,
    budgetMs: Number(budgetMs || 0)
  };
  const messages = [
    {
      type: 'HUMANOID_FORCE_STOP',
      payload
    },
    {
      type: 'STOP_AND_CLEANUP',
      reason: 'automation_deadline',
      payload
    }
  ];
  let dispatched = false;
  messages.forEach((message) => {
    try {
      const pending = chrome.tabs.sendMessage(tabId, message);
      pending?.catch?.(() => {});
      dispatched = true;
    } catch (_) {}
  });
  return dispatched;
};

const finalizeAutomationDeadline = (llmName, phase, budgetMs, meta = {}) => {
  const entry = jobState?.llms?.[llmName];
  if (!entry || isFinalizedEntry(entry)) return false;
  const normalizedPhase = String(phase || '').toLowerCase();
  if (!['generation', 'collect'].includes(normalizedPhase)) return false;
  const resolvedBudgetMs = Number(budgetMs || resolveBudgetMsForPhase(normalizedPhase)) || 0;
  if (meta?.contentLifecycleSignal) {
    const budgetRecord = entry?.budgetTimers?.[normalizedPhase] || null;
    const fallbackStartedAt = Number(entry.promptSubmittedAt || entry.lastDispatchAt || 0);
    const authoritativeDeadlineAt = Number(
      budgetRecord?.deadlineAt
      || (fallbackStartedAt > 0 && resolvedBudgetMs > 0 ? fallbackStartedAt + resolvedBudgetMs : 0)
    );
    if (!authoritativeDeadlineAt || authoritativeDeadlineAt > Date.now()) {
      emitTelemetry(llmName, 'AUTOMATION_DEADLINE_SIGNAL_DEFERRED', {
        level: 'info',
        details: `${normalizedPhase}:authoritative_deadline_not_reached`,
        meta: {
          phase: normalizedPhase,
          reportedBudgetMs: Number(budgetMs || 0),
          authoritativeBudgetMs: Number(budgetRecord?.budgetMs || resolvedBudgetMs || 0),
          authoritativeDeadlineAt: authoritativeDeadlineAt || null,
          remainingMs: authoritativeDeadlineAt ? Math.max(0, authoritativeDeadlineAt - Date.now()) : null
        }
      });
      return false;
    }
  }

  const reachedAt = Date.now();
  const pendingAnswer = String(entry.pendingFinalAnswer || entry.answer || '').trim();
  const pendingAnswerHtml = pendingAnswer
    ? String(entry.pendingFinalAnswerHtml || entry.answerHtml || '')
    : '';
  entry.automationDeadlineAt = reachedAt;
  entry.automationDeadlinePhase = normalizedPhase;
  entry.automationDeadlineBudgetMs = resolvedBudgetMs || null;
  entry.automationDeadlineReached = true;
  entry.skipHumanLoop = true;
  entry.adaptiveCollectActive = false;
  entry.adaptiveCollectScheduledAt = null;

  closePingWindowForLLM(llmName);
  clearAdaptiveCollectTimer(llmName);
  clearClaudeRetryTimers(llmName);
  if (typeof self.completeHumanPresenceForModel === 'function') {
    self.completeHumanPresenceForModel(llmName, 'automation_deadline');
  }
  if (typeof self.clearScriptRuntimeHardStop === 'function') {
    self.clearScriptRuntimeHardStop(
      llmName,
      entry?.confirmedDispatchId || entry?.lastDispatchMeta?.dispatchId || null
    );
  }
  const extensionRuntimeStopDispatched = stopContentAutomationAtDeadline(
    llmName,
    entry,
    normalizedPhase,
    resolvedBudgetMs
  );

  emitTelemetry(llmName, 'AUTOMATION_DEADLINE_REACHED', {
    level: 'warning',
    details: `${normalizedPhase}:${resolvedBudgetMs}ms`,
    meta: {
      phase: normalizedPhase,
      budgetMs: resolvedBudgetMs,
      answerLength: pendingAnswer.length,
      tabId: entry?.tabId || null,
      dispatchId: entry?.lastDispatchMeta?.dispatchId || null,
      providerGenerationLeftRunning: true,
      extensionRuntimeStopDispatched,
      manualRecoveryAvailable: true,
      // A model that reached the deadline after a deferred pre-insertion failure
      // did not simply run out of generation time - say so in the record.
      preInsertionDeferredReason: entry?.preInsertionDeferral?.reason || null,
      preInsertionDeferredStatus: entry?.preInsertionDeferral?.deferredFinalStatus || null,
      ...meta
    },
    force: true
  });

  const terminalMeta = {
    dispatchId: entry?.lastDispatchMeta?.dispatchId || entry?.confirmedDispatchId || null,
    sessionId: jobState?.session?.startTime || undefined,
    runSessionId: jobState?.session?.startTime || undefined,
    automationDeadline: true,
    preTerminalMaterializeFinal: true,
    finalizationDeferredCheck: true,
    responseMeta: {
      source: 'automation_deadline',
      completionReason: 'automation_deadline',
      partial: Boolean(pendingAnswer),
      lateCollectFinal: true,
      forceTerminalSuccess: Boolean(pendingAnswer),
      automationStopped: true,
      providerGenerationLeftRunning: true,
      extensionRuntimeStopDispatched,
      manualRecoveryAvailable: true
    }
  };

  if (pendingAnswer) {
    handleLLMResponse(llmName, pendingAnswer, null, terminalMeta, pendingAnswerHtml);
  } else {
    handleLLMResponse(
      llmName,
      '',
      { type: 'automation_deadline', message: `Automation deadline reached after ${resolvedBudgetMs}ms` },
      terminalMeta,
      ''
    );
  }
  return true;
};

const scheduleBudgetTimer = (llmName, normalizedPhase, record, meta = {}) => {
  if (!record) return null;
  const deadlineAt = Number(record.deadlineAt || (Number(record.startedAt || Date.now()) + Number(record.budgetMs || 0)));
  const remainingMs = Math.max(1, deadlineAt - Date.now());
  let timerId = null;
  timerId = setTimeout(() => {
    runtimeBudgetTimerIds.delete(timerId);
    const liveEntry = jobState?.llms?.[llmName];
    const liveRecord = liveEntry?.budgetTimers?.[normalizedPhase];
    if (!liveEntry || !liveRecord || Number(liveRecord.deadlineAt || 0) !== deadlineAt) return;
    liveRecord.timerId = null;
    const dispatchId = liveEntry?.lastDispatchMeta?.dispatchId || null;
    const tabId = liveEntry?.tabId || null;
    emitTelemetry(llmName, 'BUDGET_EXHAUSTED', {
      level: 'warning',
      meta: {
        phase: normalizedPhase,
        budgetMs: Number(liveRecord.budgetMs || 0),
        startedAt: Number(liveRecord.startedAt || 0),
        deadlineAt,
        elapsedMs: Math.max(0, Date.now() - Number(liveRecord.startedAt || Date.now())),
        dispatchId,
        tabId,
        ...meta
      },
      force: true
    });
    finalizeAutomationDeadline(llmName, normalizedPhase, Number(liveRecord.budgetMs || 0), meta);
  }, remainingMs);
  runtimeBudgetTimerIds.add(timerId);
  record.timerId = timerId;
  record.deadlineAt = deadlineAt;
  return timerId;
};

const startBudgetPhase = (llmName, phase, budgetMs, meta = {}) => {
  const entry = jobState?.llms?.[llmName];
  if (!entry || !phase) return;
  const store = ensureBudgetStore(entry);
  if (!store) return;
  const normalizedPhase = String(phase).toLowerCase();
  const resolvedBudgetMs = Number(budgetMs || resolveBudgetMsForPhase(normalizedPhase)) || 0;
  if (resolvedBudgetMs <= 0) return;
  const existing = store[normalizedPhase];
  if (normalizedPhase === 'generation' && existing) {
    existing.startedAt = Number(existing.startedAt || entry.promptSubmittedAt || entry.lastDispatchAt || Date.now());
    existing.budgetMs = Number(existing.budgetMs || resolvedBudgetMs);
    existing.deadlineAt = Number(existing.deadlineAt || (existing.startedAt + existing.budgetMs));
    const activeFocusBudgetMs = Number(entry.activeFocusBudgetMs || self.getActiveFocusWindowMs?.() || 60000);
    entry.activeFocusStartedAt = Number(entry.activeFocusStartedAt || existing.startedAt);
    entry.activeFocusBudgetMs = activeFocusBudgetMs;
    entry.activeFocusDeadlineAt = Number(
      entry.activeFocusDeadlineAt
      || (entry.activeFocusStartedAt + activeFocusBudgetMs)
    );
    if (!existing.timerId || !runtimeBudgetTimerIds.has(existing.timerId)) {
      existing.timerId = null;
      scheduleBudgetTimer(llmName, normalizedPhase, existing, {
        ...meta,
        resumedExistingDeadline: true
      });
    }
    return;
  }
  if (existing?.timerId && runtimeBudgetTimerIds.has(existing.timerId)) {
    clearTimeout(existing.timerId);
    runtimeBudgetTimerIds.delete(existing.timerId);
  }
  const startedAt = Date.now();
  const record = {
    timerId: null,
    startedAt,
    deadlineAt: startedAt + resolvedBudgetMs,
    budgetMs: resolvedBudgetMs
  };
  store[normalizedPhase] = record;
  if (normalizedPhase === 'generation') {
    const activeFocusBudgetMs = Number(self.getActiveFocusWindowMs?.() || 60000);
    entry.activeFocusStartedAt = startedAt;
    entry.activeFocusBudgetMs = activeFocusBudgetMs;
    entry.activeFocusDeadlineAt = startedAt + activeFocusBudgetMs;
    entry.activeFocusExhaustedAt = null;
  }
  scheduleBudgetTimer(llmName, normalizedPhase, record, meta);
  saveJobState(jobState);
};

const endBudgetPhase = (llmName, phase) => {
  const entry = jobState?.llms?.[llmName];
  if (!entry || !phase) return;
  const store = ensureBudgetStore(entry);
  if (!store) return;
  const normalizedPhase = String(phase).toLowerCase();
  const existing = store[normalizedPhase];
  if (existing?.timerId && runtimeBudgetTimerIds.has(existing.timerId)) {
    clearTimeout(existing.timerId);
    runtimeBudgetTimerIds.delete(existing.timerId);
  }
  delete store[normalizedPhase];
};

const clearBudgetPhases = (llmName) => {
  const entry = jobState?.llms?.[llmName];
  if (!entry) return;
  const store = ensureBudgetStore(entry);
  if (!store) return;
  Object.keys(store).forEach((phase) => endBudgetPhase(llmName, phase));
};

function emitModelRoundTelemetry(llmName, round, phase, details = '', { level = 'info', meta = {} } = {}) {
  if (!llmName || typeof phase !== 'string' || round == null) return;
  const dispatchId = jobState?.llms?.[llmName]?.lastDispatchMeta?.dispatchId || null;
  if (jobState?.session) {
    jobState.session.roundDurations = jobState.session.roundDurations || {};
    jobState.session.roundStarts = jobState.session.roundStarts || {};
    const startsForRound = jobState.session.roundStarts[round] || {};
    if (phase === 'START') {
      startsForRound[llmName] = Date.now();
      jobState.session.roundStarts[round] = startsForRound;
    } else if (phase === 'END') {
      const startedAt = startsForRound[llmName];
      if (startedAt) {
        const durationMs = Math.max(0, Date.now() - startedAt);
        const durations = jobState.session.roundDurations[round] || [];
        durations.push(durationMs);
        jobState.session.roundDurations[round] = durations.slice(-50);
      }
    }
  }
  emitTelemetry(llmName, `ROUND${round}_${phase}`, {
    details,
    level,
    meta: { round, dispatchId, ...meta },
    force: true
  });
}

const resolveRoundModelNames = (selectedLLMs = []) => {
  if (Array.isArray(selectedLLMs) && selectedLLMs.length) {
    return [...new Set(selectedLLMs.filter(Boolean))];
  }
  const sessionModels = Array.isArray(jobState?.session?.selectedModels)
    ? jobState.session.selectedModels
    : [];
  if (sessionModels.length) return [...new Set(sessionModels.filter(Boolean))];
  return Object.keys(jobState?.llms || {});
};

const getPendingRoundModels = (modelNames = []) => modelNames.filter((llmName) => {
  const entry = jobState?.llms?.[llmName];
  if (!entry) return true;
  return !isFinalizedEntry(entry);
});

const finalizeNoSendModelIfStalled = (llmName, sessionId, reason = 'round4_gate') => {
  const entry = jobState?.llms?.[llmName];
  if (!entry || isFinalizedEntry(entry)) return false;
  const dispatchAttempts = Number(entry.dispatchAttempts || 0);
  if (dispatchAttempts <= 0) return false;
  const hasPromptConfirmation = !!entry.promptSubmittedAt;
  if (hasPromptConfirmation) return false;
  // A provider dispatch can remain queued behind the focus/visit lease well past
  // the ordinary no-send grace window. In that state "not confirmed yet" is not
  // evidence that the send failed. Let the round4 gate keep waiting; its bounded
  // timeout remains the final backstop if the dispatch never settles.
  const dispatchStillPending = Boolean(
    entry.awaitingSubmitConfirmation === true
    || entry.dispatchInFlight === true
    || ['QUEUED', 'ACTIVATING', 'READY', 'TYPING', 'SUBMITTING'].includes(
      String(entry.dispatchState || '').toUpperCase()
    )
  );
  if (dispatchStillPending) {
    const pendingKey = entry?.lastDispatchMeta?.dispatchId || `tab_${entry?.tabId || 'unknown'}`;
    if (entry.round4PendingDispatchDeferredKey !== pendingKey) {
      entry.round4PendingDispatchDeferredKey = pendingKey;
      emitTelemetry(llmName, 'ROUND4_NO_SEND_DEFERRED', {
        level: 'info',
        details: 'dispatch_still_pending',
        meta: {
          reason,
          dispatchId: entry?.lastDispatchMeta?.dispatchId || null,
          tabId: entry?.tabId || null,
          awaitingSubmitConfirmation: entry.awaitingSubmitConfirmation === true,
          dispatchInFlight: entry.dispatchInFlight === true,
          dispatchState: entry.dispatchState || null
        },
        force: true
      });
    }
    return false;
  }
  const sessionStart = Number(jobState?.session?.startTime || 0) || Date.now();
  const stallStartedAt = Number(entry.lastDispatchAt || sessionStart || Date.now());
  const elapsedMs = Math.max(0, Date.now() - stallStartedAt);
  if (elapsedMs < NO_SEND_STALL_GRACE_MS) return false;
  // Force-final is one-shot per dispatch: handleLLMResponse may defer terminal into
  // async materialize recovery, and re-firing on every gate poll re-enters that path.
  const forceFinalKey = entry?.lastDispatchMeta?.dispatchId || `tab_${entry?.tabId || 'unknown'}`;
  if (entry.round4ForceFinalKey === forceFinalKey) return false;
  entry.round4ForceFinalKey = forceFinalKey;
  entry.round4ForceFinalAt = Date.now();

  emitTelemetry(llmName, 'ROUND4_FORCE_FINAL', {
    level: 'warning',
    details: 'no_send_stall',
    meta: {
      reason,
      elapsedMs,
      graceMs: NO_SEND_STALL_GRACE_MS,
      dispatchAttempts,
      dispatchId: entry?.lastDispatchMeta?.dispatchId || null,
      tabId: entry?.tabId || null
    }
  });
  handleLLMResponse(
    llmName,
    '',
    { type: 'no_send', message: `Prompt submission not confirmed for ${elapsedMs}ms` },
    {
      dispatchId: entry?.lastDispatchMeta?.dispatchId || null,
      sessionId: sessionId || getActiveSessionId(),
      runSessionId: sessionId || getActiveSessionId(),
      // The round gate already supplied the long observation window. Keep the
      // ordinary one-shot materialize probe, but do not start another 165s cycle.
      skipExtendedSendObservation: true,
      lastResortTerminal: true
    },
    ''
  );
  return true;
};

async function waitForRound4Gate(modelNames, sessionId) {
  const trackedModels = resolveRoundModelNames(modelNames);
  if (!trackedModels.length) {
    return { ready: true, timedOut: false, pendingBefore: [], pendingAfter: [] };
  }

  const startedAt = Date.now();
  let lastGateWaitTelemetryAt = 0;
  while (true) {
    if (sessionId && !isSessionActive(sessionId)) {
      return { ready: false, timedOut: false, pendingBefore: [], pendingAfter: [] };
    }
    ensureRoundEntries(trackedModels, 'round4_gate');
    const pendingBefore = getPendingRoundModels(trackedModels);
    if (!pendingBefore.length) {
      return { ready: true, timedOut: false, pendingBefore, pendingAfter: [] };
    }

    const now = Date.now();
    if (now - lastGateWaitTelemetryAt >= ROUND4_GATE_WAIT_TELEMETRY_MS) {
      lastGateWaitTelemetryAt = now;
      pendingBefore.forEach((llmName) => {
        const entry = jobState?.llms?.[llmName];
        emitTelemetry(llmName, 'ROUND4_GATE_WAIT', {
          level: 'info',
          details: entry?.promptSubmittedAt ? 'extraction_pending' : 'awaiting_submit_confirmation',
          meta: {
            elapsedMs: now - startedAt,
            waitMaxMs: getRound4PendingWaitMaxMs(),
            promptConfirmed: !!entry?.promptSubmittedAt,
            dispatchId: entry?.lastDispatchMeta?.dispatchId || null
          }
        });
      });
    }

    pendingBefore.forEach((llmName) => {
      finalizeNoSendModelIfStalled(llmName, sessionId, 'round4_gate');
    });

    const pendingAfter = getPendingRoundModels(trackedModels);
    if (!pendingAfter.length) {
      return { ready: true, timedOut: false, pendingBefore, pendingAfter: [] };
    }

    const elapsedMs = Date.now() - startedAt;
    if (elapsedMs >= getRound4PendingWaitMaxMs()) {
      pendingAfter.forEach((llmName) => {
        const entry = jobState?.llms?.[llmName];
        if (!entry || isFinalizedEntry(entry)) return;
        const timeoutForceFinalKey = `gate_timeout:${entry?.lastDispatchMeta?.dispatchId || `tab_${entry?.tabId || 'unknown'}`}`;
        if (entry.round4ForceFinalKey === timeoutForceFinalKey) return;
        entry.round4ForceFinalKey = timeoutForceFinalKey;
        entry.round4ForceFinalAt = Date.now();
        const hasPromptConfirmation = !!entry.promptSubmittedAt;
        const errorType = hasPromptConfirmation ? 'extract_failed' : 'no_send';
        const errorMessage = hasPromptConfirmation
          ? `Round4 gate timeout after ${elapsedMs}ms`
          : `Prompt submission not confirmed before gate timeout (${elapsedMs}ms)`;
        emitTelemetry(llmName, 'ROUND4_FORCE_FINAL', {
          level: 'warning',
          details: 'gate_timeout',
          meta: {
            elapsedMs,
            waitMaxMs: getRound4PendingWaitMaxMs(),
            reason: 'round4_gate_timeout',
            errorType,
            dispatchId: entry?.lastDispatchMeta?.dispatchId || null,
            tabId: entry?.tabId || null
          }
        });
        handleLLMResponse(
          llmName,
          '',
          { type: errorType, message: errorMessage },
          {
            dispatchId: entry?.lastDispatchMeta?.dispatchId || null,
            sessionId: sessionId || getActiveSessionId(),
            runSessionId: sessionId || getActiveSessionId(),
            skipExtendedSendObservation: true,
            lastResortTerminal: true
          },
          ''
        );
      });
      return {
        ready: false,
        timedOut: true,
        pendingBefore,
        pendingAfter: getPendingRoundModels(trackedModels)
      };
    }

    await orchestratorSleepMs(ROUND4_PENDING_POLL_MS);
  }
}

// Purpose: keep orchestrator delays cancelable and tied to the current session context.
let orchestratorAbortController = new AbortController();

function getOrchestratorAbortSignal() {
  return orchestratorAbortController.signal;
}

function resetOrchestratorAbortController() {
  orchestratorAbortController = new AbortController();
}

function abortOrchestratorOperations(reason = 'session_reset') {
  if (!orchestratorAbortController.signal.aborted) {
    orchestratorAbortController.abort(reason);
  }
}

function orchestratorSleepMs(ms, signal = getOrchestratorAbortSignal()) {
  const duration = Math.max(0, ms || 0);
  return new Promise((resolve) => {
    if (duration <= 0) {
      resolve();
      return;
    }
    if (signal?.aborted) {
      resolve();
      return;
    }
    let resolved = false;
    const finish = () => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timer);
      deregisterSessionTimer(timer);
      resolve();
    };
    let timer = null;
    timer = registerSessionTimer(setTimeout(finish, duration));
    signal?.addEventListener('abort', finish, { once: true });
  });
}

function hasRound2SubmitOrAnswerEvidence(entry) {
  if (!entry || typeof entry !== 'object') return false;
  const dispatchId = entry.lastDispatchMeta?.dispatchId || entry.confirmedDispatchId || null;
  const freshness = self.RecoveryIntent?.evaluateFreshEvidence?.(entry, {
    dispatchId,
    minChars: DOM_SNAPSHOT_RECOVERY_MIN_CHARS
  });
  if (freshness) return freshness.fresh === true;
  return Boolean(entry.promptSubmittedAt && entry.submitSource !== 'inferred_answer_evidence');
}

function getRound2SubmitConfirmationState(llmName, dispatchId = null) {
  const entry = jobState?.llms?.[llmName] || null;
  if (!entry) return { ok: false, reason: 'entry_missing', entry: null };
  if (isFinalizedEntry(entry)) return { ok: true, reason: 'terminal', entry };
  const liveDispatchId = entry.lastDispatchMeta?.dispatchId || entry.awaitingSubmitConfirmationDispatchId || entry.confirmedDispatchId || null;
  const sameDispatch = !dispatchId || !liveDispatchId || liveDispatchId === dispatchId || entry.confirmedDispatchId === dispatchId;
  if (sameDispatch && entry.promptSubmittedAt) {
    return { ok: true, reason: entry.submitSource === 'content' ? 'prompt_submitted' : 'prompt_submitted_non_content', entry };
  }
  if (sameDispatch && hasRound2SubmitOrAnswerEvidence(entry)) {
    return { ok: true, reason: 'answer_evidence', entry };
  }
  if (sameDispatch && (entry.messageSent || entry.awaitingSubmitConfirmation || entry.dispatchInFlight)) {
    return { ok: false, reason: 'dispatch_pending', entry };
  }
  return { ok: false, reason: sameDispatch ? 'not_confirmed' : 'stale_dispatch', entry };
}

async function waitForRound2SubmitConfirmation(llmName, dispatchId = null, timeoutMs = ROUND2_REPAIR_CONFIRM_WAIT_MS) {
  const startedAt = Date.now();
  const maxWaitMs = Math.max(0, Number(timeoutMs) || 0);
  let state = getRound2SubmitConfirmationState(llmName, dispatchId);
  if (state.ok || maxWaitMs <= 0) {
    return { ...state, waitedMs: Date.now() - startedAt };
  }
  while ((Date.now() - startedAt) < maxWaitMs) {
    const remainingMs = maxWaitMs - (Date.now() - startedAt);
    await orchestratorSleepMs(Math.min(ROUND2_REPAIR_CONFIRM_POLL_MS, Math.max(0, remainingMs)));
    state = getRound2SubmitConfirmationState(llmName, dispatchId);
    if (state.ok) {
      return { ...state, waitedMs: Date.now() - startedAt };
    }
  }
  return { ...state, waitedMs: Date.now() - startedAt };
}

function isRound2DelayedConfirmationState(state) {
  return state?.reason === 'dispatch_pending';
}

async function scheduleRound2DelayedConfirmationContinuation(llmName, tabId, sessionId, reason, state = {}) {
  broadcastDiagnostic(llmName, {
    type: 'DISPATCH',
    label: 'ROUND2_VERIFY',
    details: 'prompt confirmation delayed; collection/probes scheduled',
    level: 'info',
    meta: { tabId, reason: state.reason || 'dispatch_pending', source: reason }
  });
  emitTelemetry(llmName, 'ROUND2_VERIFY_DELAYED_CONFIRMATION', {
    level: 'info',
    details: 'dispatch still pending',
    meta: { tabId, reason: state.reason || 'dispatch_pending', source: reason }
  });
  const liveEntry = jobState?.llms?.[llmName];
  if (liveEntry && !isFinalizedEntry(liveEntry)) {
    await runPreCollectScrollNudge(llmName, tabId, sessionId, `${reason}_precollect`);
    triggerResponseCollectionPing(llmName, tabId, `${reason}_probe`);
    schedulePostR2AutoCollect(llmName, tabId, sessionId);
    scheduleAdaptiveCollectionProbe(llmName, sessionId, {
      reason,
      source: 'adaptive_round2'
    });
  }
}
const getActiveSessionId = () => jobState?.session?.startTime || null;
const isSessionActive = (sessionId) => !!sessionId && jobState?.session?.startTime === sessionId;
const MV3_SURVIVAL_ALARM = 'llm_orchestrator_mv3_survival_v1';
const MV3_SURVIVAL_ALARM_PERIOD_MIN = 0.5;
let mv3RehydrationInFlight = false;

const sessionTimers = new Set();
const sessionTimerMetadata = new Map();

const captureTimerStack = () => {
  const rawStack = (new Error()).stack || '';
  const cleanLines = rawStack
    .split('\n')
    .slice(2, 6)
    .map((line) => line.replace(/^\s+at\s+/i, '').trim())
    .filter(Boolean);
  return cleanLines.join(' | ');
};

function registerSessionTimer(timerId) {
  if (!timerId) return null;
  sessionTimers.add(timerId);
  sessionTimerMetadata.set(timerId, {
    registeredAt: Date.now(),
    stack: captureTimerStack()
  });
  return timerId;
}

function deregisterSessionTimer(timerId) {
  if (!timerId) return;
  sessionTimers.delete(timerId);
  sessionTimerMetadata.delete(timerId);
}

function clearSessionTimers() {
  if (!sessionTimers.size) return;
  const entries = Array.from(sessionTimerMetadata.entries()).slice(0, 8).map(([timerId, info]) => ({
    timerId,
    ageMs: Date.now() - info.registeredAt,
    stack: info.stack
  }));
  console.warn(`[BACKGROUND] clearSessionTimers clearing ${sessionTimers.size} session timers`, {
    samples: entries,
    reportedAt: Date.now()
  });
  sessionTimers.forEach((timerId) => {
    clearTimeout(timerId);
  });
  sessionTimers.clear();
  sessionTimerMetadata.clear();
}

function hasOpenModelRuns(state = jobState) {
  return Object.values(state?.llms || {}).some((entry) => entry && !isFinalizedEntry(entry));
}

function updateMv3SurvivalAlarm(state = jobState) {
  try {
    if (!chrome?.alarms?.create) return;
    if (state?.session?.startTime && hasOpenModelRuns(state)) {
      chrome.alarms.create(MV3_SURVIVAL_ALARM, { periodInMinutes: MV3_SURVIVAL_ALARM_PERIOD_MIN });
      return;
    }
    chrome.alarms.clear?.(MV3_SURVIVAL_ALARM);
  } catch (err) {
    console.warn('[BACKGROUND] MV3 survival alarm update failed', err);
  }
}

function rehydrateActiveJobRuntime(source = 'load_job_state') {
  if (mv3RehydrationInFlight) return false;
  // A survival alarm can fire in the same live worker while Round 1 is
  // awaiting a provider transaction. That is not a restart and must never
  // clear round ownership or replace current dispatch identities.
  if (self.__dispatchRoundsRuntimeActive === true) {
    updateMv3SurvivalAlarm(jobState);
    return false;
  }
  if (!jobState?.session?.startTime || !jobState?.llms || !hasOpenModelRuns(jobState)) {
    updateMv3SurvivalAlarm(jobState);
    return false;
  }
  mv3RehydrationInFlight = true;
  try {
    jobState.session.mv3RehydratedAt = Date.now();
    jobState.session.mv3RehydrationCount = Number(jobState.session.mv3RehydrationCount || 0) + 1;
    const clearedRoundsInProgress = jobState.session.roundsInProgress === true;
    const interruptedRoundPhase = jobState.session.roundPhase || null;
    if (clearedRoundsInProgress) {
      jobState.session.roundsInProgress = false;
      jobState.session.roundsRecoveredFromStuckAt = jobState.session.mv3RehydratedAt;
    }
    emitTelemetry('SYSTEM', 'MV3_REHYDRATION', {
      level: 'info',
      details: source,
      meta: {
        sessionId: jobState.session.startTime || null,
        count: jobState.session.mv3RehydrationCount,
        clearedRoundsInProgress,
        interruptedRoundPhase,
        openModels: Object.entries(jobState.llms || {})
          .filter(([, entry]) => entry && !isFinalizedEntry(entry))
          .map(([name]) => name)
      },
      force: true
    });
    Object.entries(jobState.llms || {}).forEach(([llmName, entry]) => {
      if (!entry || isFinalizedEntry(entry)) return;
      entry.rehydratedAt = Date.now();
      entry.dispatchInFlight = false;
      entry.domSnapshotRecoveryInFlight = false;
      // Session timers do not survive MV3 suspension. Let an observation miss
      // schedule its bounded retry again instead of retaining a stale lock.
      entry.unavailableObservationRecoveryScheduled = false;
      entry.unavailableObservationRecoveryDueAt = null;
      entry.preTerminalMaterializeRecovery = entry.preTerminalMaterializeRecovery && typeof entry.preTerminalMaterializeRecovery === 'object'
        ? { ...entry.preTerminalMaterializeRecovery, inFlight: false, rehydrated: true }
        : entry.preTerminalMaterializeRecovery;
      const budgetStore = ensureBudgetStore(entry);
      Object.entries(budgetStore || {}).forEach(([phase, record]) => {
        const normalizedPhase = String(phase || '').toLowerCase();
        const budgetMs = Number(record?.budgetMs || resolveBudgetMsForPhase(normalizedPhase)) || 0;
        const startedAt = Number(record?.startedAt || entry.promptSubmittedAt || Date.now());
        if (!['generation', 'collect'].includes(normalizedPhase) || budgetMs <= 0) {
          delete budgetStore[phase];
          return;
        }
        record.timerId = null;
        record.startedAt = startedAt;
        record.budgetMs = budgetMs;
        record.deadlineAt = Number(record?.deadlineAt || (startedAt + budgetMs));
        scheduleBudgetTimer(llmName, normalizedPhase, record, {
          rehydrated: true,
          rehydrationSource: source
        });
      });
      const tabId = resolveBoundTabIdForOrchestrator(llmName, entry);
      if (entry.promptSubmittedAt && isValidTabId(tabId)) {
        if (typeof self.armScriptRuntimeHardStopForConfirmedPrompt === 'function') {
          self.armScriptRuntimeHardStopForConfirmedPrompt(llmName, {
            dispatchId: entry?.confirmedDispatchId || entry?.lastDispatchMeta?.dispatchId || null,
            tabId
          });
        }
        registerSessionTimer(setTimeout(() => {
          const liveEntry = jobState?.llms?.[llmName];
          if (!liveEntry || isFinalizedEntry(liveEntry)) return;
          triggerResponseCollectionPing(llmName, tabId, 'mv3_rehydration_collect', {
            maxAttempts: 2,
            baseDelay: 800,
            allowRecovery: true
          });
          scheduleAdaptiveCollectionProbe(llmName, jobState?.session?.startTime || null, {
            source: 'mv3_rehydration_adaptive',
            baseDelayMs: 1400,
            maxDelayMs: 5000,
            maxAttempts: 3
          });
        }, 250));
      }
    });
    const shouldResumeBootstrap = clearedRoundsInProgress
      && ['round0', 'round1'].includes(interruptedRoundPhase);
    if (shouldResumeBootstrap) {
      const selectedModels = Array.isArray(jobState.session.selectedModels)
        ? jobState.session.selectedModels.slice()
        : Object.keys(jobState.llms || {});
      selectedModels.forEach((llmName) => {
        delete llmStartChains[llmName];
        dispatchMutexManager.clear(llmName);
      });
      emitTelemetry('SYSTEM', 'MV3_DISPATCH_BOOTSTRAP_RESUME', {
        level: 'warning',
        details: interruptedRoundPhase,
        meta: {
          sessionId: jobState.session.startTime || null,
          interruptedRoundPhase,
          selectedModels
        },
        force: true
      });
      void runDispatchRounds(
        selectedModels,
        jobState.prompt || '',
        false,
        Array.isArray(jobState.attachments) ? jobState.attachments : [],
        { resume: true }
      );
    } else if (typeof schedulePromptDispatchSupervisor === 'function') {
      schedulePromptDispatchSupervisor();
    }
    updateMv3SurvivalAlarm(jobState);
    saveJobState(jobState);
    broadcastGlobalState();
    return true;
  } catch (err) {
    console.warn('[BACKGROUND] MV3 rehydration failed', err);
    return false;
  } finally {
    mv3RehydrationInFlight = false;
  }
}

if (typeof chrome !== 'undefined' && chrome?.alarms?.onAlarm?.addListener) {
  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm?.name !== MV3_SURVIVAL_ALARM) return;
    if (self.__dispatchRoundsRuntimeActive === true
      || (jobState?.session?.roundsInProgress === true && hasOpenModelRuns(jobState))) {
      updateMv3SurvivalAlarm(jobState);
      return;
    }
    loadJobState()
      .catch((err) => console.warn('[BACKGROUND] MV3 survival alarm failed', err));
  });
}

// On browser startup the SW cold-starts with empty in-memory jobState. The survival
// alarm persists and reconciles within its period, but that leaves an up-to-30s window
// where an interrupted run is not re-armed. Reconcile immediately on startup so a run
// that was active when the browser closed resumes its collection/finalization at once.
if (typeof chrome !== 'undefined' && chrome?.runtime?.onStartup?.addListener) {
  chrome.runtime.onStartup.addListener(() => {
    loadJobState()
      .catch((err) => console.warn('[BACKGROUND] startup job-state reconcile failed', err));
  });
}

//-- 11.1. Сохранение и загрузка jobState из storage --//
let jobStateSaveFlight = null;
let pendingJobStateSave = null;
let pendingJobStateSaveWaiters = [];
function saveJobState(state) {
  pendingJobStateSave = state;
  const saved = new Promise(resolve => pendingJobStateSaveWaiters.push(resolve));
  if (!jobStateSaveFlight) {
    // Defer compression out of message ACK handlers and coalesce their burst.
    // Resolve each batch's callers after that batch is persisted. Waiting for
    // the whole writer to drain starves dispatch while generation keeps adding
    // newer snapshots, even after its command intent is already durable.
    jobStateSaveFlight = Promise.resolve().then(async () => {
      try {
        while (pendingJobStateSave) {
          const next = pendingJobStateSave;
          const waiters = pendingJobStateSaveWaiters;
          pendingJobStateSave = null;
          pendingJobStateSaveWaiters = [];
          await persistJobStateSnapshot(next);
          waiters.forEach(resolve => resolve());
        }
      } finally { jobStateSaveFlight = null; }
    });
  }
  return saved;
}

async function persistJobStateSnapshot(state) {
  try {
    const persisted = self.PipelineFSM?.compactJobStateForStorage
      ? self.PipelineFSM.compactJobStateForStorage(state)
      : state;
    await CompressedStorage.set('jobState', persisted);
    updateMv3SurvivalAlarm(state);
    if (self.PipelineFSM?.persistControlState) {
      const control = self.PipelineFSM.normalizeControlState?.(state?.session?.pipelineControl || {
        pipelineRunId: state?.session?.pipelineRunId || null,
        sessionId: state?.session?.startTime || null,
        state: state?.session?.pipelineState || 'IDLE',
        stage: state?.session?.pipelineStage || null,
        round: state?.session?.pipelineRoundId || null
      });
      void self.PipelineFSM.persistControlState(control);
    }
    globalThis.LLMLog?.debug?.('[BACKGROUND] Job state saved to storage (compressed)');
  } catch (e) {
    console.error('[BACKGROUND] Failed to save job state:', e);
  }
}

async function loadJobState() {
  try {
    if (self.__dispatchRoundsRuntimeActive === true) return;
    const saved = await CompressedStorage.get('jobState');
    if (saved) {
      const control = self.PipelineFSM?.loadControlState ? await self.PipelineFSM.loadControlState() : null;
      if (self.PipelineFSM?.hydrateJobState) {
        self.PipelineFSM.hydrateJobState(saved, control);
      }
      await self.DispatchIntentStore?.restore?.(saved);
      if (self.__dispatchRoundsRuntimeActive === true) return;
      jobState = saved;
      self.jobState = jobState;
      globalThis.LLMLog?.debug?.('[BACKGROUND] Job state loaded from storage');
      if (typeof hasPendingHumanVisits === 'function' && hasPendingHumanVisits()) {
        scheduleHumanPresenceLoop();
      }
      rehydrateActiveJobRuntime('load_job_state');
      broadcastHumanVisitStatus();
      return;
    }
    const control = self.PipelineFSM?.loadControlState ? await self.PipelineFSM.loadControlState() : null;
    if (control && control.state && control.state !== 'IDLE') {
      jobState = {
        session: {
          startTime: control.sessionId || null,
          pipelineRunId: control.pipelineRunId || null,
          pipelineState: control.state || 'IDLE',
          pipelineStage: control.stage || null,
          pipelineRoundId: control.round || null,
          pipelineControl: control
        },
        llms: {}
      };
      self.jobState = jobState;
      globalThis.LLMLog?.debug?.('[BACKGROUND] Job state restored from session control state');
    }
  } catch (e) {
    console.error('[BACKGROUND] Failed to load job state:', e);
    throw e;
  }
}

function getActivePipelineControlState() {
  return jobState?.session?.pipelineControl || (self.PipelineFSM?.normalizeControlState ? self.PipelineFSM.normalizeControlState({
    pipelineRunId: jobState?.session?.pipelineRunId || null,
    sessionId: jobState?.session?.startTime || null,
    state: jobState?.session?.pipelineState || 'IDLE',
    stage: jobState?.session?.pipelineStage || null,
    round: jobState?.session?.pipelineRoundId || null
  }) : {
    pipelineRunId: jobState?.session?.pipelineRunId || null,
    sessionId: jobState?.session?.startTime || null,
    state: jobState?.session?.pipelineState || 'IDLE'
  });
}

function persistPipelineControlState(nextControl = null) {
  if (!self.PipelineFSM?.persistControlState) return;
  const control = nextControl || getActivePipelineControlState();
  if (jobState?.session) {
    jobState.session.pipelineControl = control;
    jobState.session.pipelineRunId = control.pipelineRunId || null;
    jobState.session.pipelineState = control.state || jobState.session.pipelineState || 'IDLE';
    jobState.session.pipelineStage = control.stage || null;
    jobState.session.pipelineRoundId = control.round || null;
  }
  void self.PipelineFSM.persistControlState(control);
}

function stopAllProcesses(reason = 'unspecified', { closeTabs = false } = {}) {
  globalThis.LLMLog?.debug?.(`[BACKGROUND] stopAllProcesses: reason=${reason}, closeTabs=${closeTabs}`);
  // Purpose: cancel orchestrator waits tied to the previous session immediately.
  abortOrchestratorOperations(reason);
  resetOrchestratorAbortController();
  clearSessionTimers();
  if (typeof self.clearAllScriptRuntimeHardStops === 'function') {
    self.clearAllScriptRuntimeHardStops();
  }
  adaptiveCollectTimers.clear();
  stopHumanPresenceLoop();
  stopHeartbeatMonitor();
  pendingPings.clear();
  pendingPingByTabId.clear();
  lateAnswerCollectInFlight.clear();
  void clearLateAnswerSnapshotCache('stop_all_processes');
  healthCheckFailuresByTabId.clear();
  lastHealthCheckReportAtByTabId.clear();

  const sessionId = jobState?.session?.startTime || null;
  const tabsToClose = [];
  TabMapManager.entries().forEach(([llmName, tabId]) => {
    if (!isValidTabId(tabId)) return;
    try {
      chrome.tabs.sendMessage(tabId, {
        type: 'STOP_AND_CLEANUP',
        reason,
        meta: { sessionId }
      }).catch(() => {});
    } catch (_) {}
    closePingWindowForTab(tabId);
    delete llmActivityMap[tabId];
    if (closeTabs) tabsToClose.push(tabId);
    if (jobState?.llms?.[llmName]) {
      if (typeof self.projectModelRunStateToLegacy === 'function') {
        self.projectModelRunStateToLegacy(llmName, jobState.llms[llmName], { status: 'STOPPED' }, 'stopAllProcesses');
      } else {
        Object.assign(jobState.llms[llmName], { status: 'STOPPED' });
      }
    }
  });

  if (isValidTabId(evaluatorTabId)) {
    try {
      chrome.tabs.sendMessage(evaluatorTabId, {
        type: 'STOP_AND_CLEANUP',
        reason,
        meta: { sessionId }
      }).catch(() => {});
    } catch (_) {}
    if (closeTabs) tabsToClose.push(evaluatorTabId);
  }

  if (closeTabs && tabsToClose.length) {
    const uniqueTabIds = Array.from(new Set(tabsToClose));
    Promise.all(uniqueTabIds.map((tabId) => getTabSafe(tabId)))
      .then((tabs) => tabs
        .filter((tab) => tab?.id && !isAppUiTab(tab))
        .map((tab) => tab.id))
      .then((safeTabsToClose) => {
        if (safeTabsToClose.length) {
          chrome.tabs.remove(safeTabsToClose, () => chrome.runtime.lastError);
        }
      })
      .catch((err) => {
        console.warn('[BACKGROUND] Failed to filter tabs before closing:', err);
      });
  }

  clearActiveListeners();
  clearPingState();

  jobMetadata.clear();
  Object.keys(llmRequestMap).forEach((key) => delete llmRequestMap[key]);
  // Purpose: clear the tab registry without blocking stop cleanup.
  void TabMapManager.clear().catch((err) => {
    console.warn('[BACKGROUND] TabMapManager.clear failed:', err);
  });

  const timers = Array.from(postSuccessScrollTimers.values());
  postSuccessScrollTimers.clear();
  timers.forEach((id) => clearTimeout(id));

  Object.keys(deferredAnswerTimers).forEach((key) => {
    clearTimeout(deferredAnswerTimers[key]);
    delete deferredAnswerTimers[key];
  });

  if (jobState?.llms) {
    Object.keys(jobState.llms).forEach((name) => clearBudgetPhases(name));
  }

  rateLimitState.clear();
  rateLimitTimers.forEach((id) => clearTimeout(id));
  rateLimitTimers.clear();

  if (jobState && Object.keys(jobState).length) {
    try {
      chrome.storage.local.remove(['jobState']);
    } catch (_) {}
  }
  if (self.PipelineFSM?.stopRun) {
    const control = getActivePipelineControlState();
    const nextControl = String(reason || '').toLowerCase().includes('cancel')
      ? self.PipelineFSM.cancelRun(control, { reason, pipelineRunId: control.pipelineRunId || null, stage: 'cancelled' })
      : self.PipelineFSM.stopRun(control, { reason, pipelineRunId: control.pipelineRunId || null, stage: 'stopped' });
    persistPipelineControlState(nextControl);
  }
  jobState = {};
  broadcastGlobalState();
}

async function startProcess(prompt, selectedLLMs, resultsTab, options = {}) {
  const runGuard = self.RunGuard?.canStartNewRun?.(jobState?.session, options);
  if (runGuard && runGuard.ok === false) {
    console.warn('[BACKGROUND] Refusing to start process while another run is active', runGuard);
    return runGuard;
  }
  const tosAck = await chrome.storage.local.get('tos_acknowledged_v1')
    .then((d) => d?.tos_acknowledged_v1 === true).catch(() => false);
  if (!tosAck) {
    console.warn('[BACKGROUND] startProcess rejected: ToS consent missing');
    return { ok: false, errorCode: 'TOS_ACK_REQUIRED' };
  }

  const forceNewTabs = options.forceNewTabs !== undefined ? options.forceNewTabs : true;
  const useApiFallback = options.useApiFallback !== undefined ? options.useApiFallback : true;
  const promptsByModel = self.TransportPolicy?.sanitizePromptsByModel
    ? self.TransportPolicy.sanitizePromptsByModel(options.promptsByModel)
    : null;
  const attachments = Array.isArray(options.attachments) ? options.attachments : [];
  const pipelineContext = options.pipelineContext && typeof options.pipelineContext === 'object'
    ? { ...options.pipelineContext }
    : null;
  const sourceView = options.sourceView || pipelineContext?.sourceView || null;
  globalThis.LLMLog?.debug?.(`[BACKGROUND] Starting process. Force new tabs: ${forceNewTabs}. Use API: ${useApiFallback}. LLMs:`, selectedLLMs);
  resultsTabId = resultsTab;
  jobMetadata.clear();
  Object.keys(llmRequestMap).forEach((key) => delete llmRequestMap[key]);
  const snapshotCleanup = await clearLateAnswerSnapshotCache('start_process');
  if (snapshotCleanup?.removed) {
    globalThis.LLMLog?.debug?.(`[LateAnswerCollector] Cleared ${snapshotCleanup.removed} stale snapshot keys before new run`);
  }
  stopHumanPresenceLoop();
  // Purpose: reset orchestrator cancel signal before the new run.
  resetOrchestratorAbortController();
  adaptiveCollectTimers.clear();

  const sessionStartTime = Date.now();
  const telemetrySampled = resolveTelemetrySampling(sessionStartTime);
  jobState = self.PipelineRunState.create({
    prompt,
    selectedModels: Array.isArray(selectedLLMs) ? selectedLLMs : [],
    useApiFallback,
    forceNewTabs,
    attachments,
    sourceView,
    pipelineContext,
    telemetrySampled,
    telemetrySampleRate: TELEMETRY_SAMPLE_RATE,
    startedAt: sessionStartTime,
    promptsByModel
  });
  // A per-model start chain belongs to exactly one run. A promise left by an
  // interrupted MV3 worker/run must never hold the next run behind old work.
  selectedLLMs.forEach((llmName) => {
    delete llmStartChains[llmName];
    promptSubmitWaiters.delete(llmName);
    dispatchMutexManager.clear(llmName);
  });
  // Authoritatively admit the new run before any model telemetry can arrive.
  // A mismatched late event is quarantined by the proof ledger and can no
  // longer reset the active run implicitly.
  await self.ProofTelemetryLedger?.beginRun?.(sessionStartTime, {
    wallTs: sessionStartTime,
    expectedModels: Array.isArray(selectedLLMs) ? selectedLLMs.slice() : []
  });
  humanPresencePaused = false;
  humanPresenceManuallyStopped = false;
  if (self.PipelineFSM?.startRun) {
    jobState.session.pipelineControl = self.PipelineFSM.startRun({
      pipelineRunId: pipelineContext?.pipelineRunId || null,
      sessionId: sessionStartTime,
      stage: 'dispatch',
      state: self.PipelineFSM.STATES?.STARTING || 'STARTING',
      payload: {
        pipelineContext,
        selectedModels: Array.isArray(selectedLLMs) ? selectedLLMs.slice() : [],
        totalModels: selectedLLMs.length
      }
    });
  }
  saveJobState(jobState);

  initializeCircuitBreakers(selectedLLMs);
  allowCircuitHalfOpenForNewRun(selectedLLMs);
  startHeartbeatMonitor();
  broadcastGlobalState();

  selectedLLMs.forEach(llmName => {
    const machine = self.DispatchStateManager ? self.DispatchStateManager.get(llmName) : null;
    if (machine) {
      machine.reset();
    }
    jobState.llms[llmName] = buildInitialLlmEntry(llmName);
    updateModelState(llmName, 'IDLE', { apiStatus: 'idle' });
    if (self.syncDispatchEntryFromMachine) {
      self.syncDispatchEntryFromMachine(llmName, jobState.llms[llmName], machine);
    }
    emitTelemetry(llmName, 'RUN_START', {
      details: `models=${selectedLLMs.length}`,
      meta: {
        sessionId: jobState.session.startTime,
        totalModels: selectedLLMs.length,
        selectedModels: selectedLLMs,
        forceNewTabs,
        useApiFallback,
        source: 'start_process'
      }
    });
  });
  broadcastHumanVisitStatus();

  let resolveBootstrap;
  const bootstrapReady = new Promise((resolve) => { resolveBootstrap = resolve; });
  void runDispatchRounds(selectedLLMs, prompt, forceNewTabs, attachments, {
    onBootstrapComplete: resolveBootstrap
  });
  // Keeping the START_FULLPAGE_PROCESS reply open keeps the MV3 worker alive
  // through reusable-tab acquisition and the initial send commands. This is
  // only needed for the existing-pages path that previously stalled midway.
  if (!forceNewTabs) {
    await Promise.race([
      bootstrapReady,
      orchestratorSleepMs(45000)
    ]);
  }
}

function resolvePromptForDispatch(llmName, fallbackPrompt = '') {
  return self.TransportPolicy?.resolvePromptForModel
    ? self.TransportPolicy.resolvePromptForModel(jobState?.session?.promptsByModel, llmName, fallbackPrompt)
    : fallbackPrompt;
}

function startModelForLLM(llmName, prompt, forceNewTabs, attachments = [], options = {}) {
  prompt = resolvePromptForDispatch(llmName, prompt);
  const sessionId = options.sessionId || getActiveSessionId();
  const chain = llmStartChains[llmName] || Promise.resolve();
  llmStartChains[llmName] = chain.then(async () => {
    if (sessionId && !isSessionActive(sessionId)) {
      return;
    }
    if (isRateLimited(llmName)) {
      globalThis.LLMLog?.debug?.(`[RATE-LIMIT] ${llmName} is rate limited, scheduling retry`);
      scheduleRateLimitRetry(llmName, () => startModelForLLM(llmName, prompt, forceNewTabs, attachments, { ...options, sessionId }));
      return;
    }
    const circuitGate = self.DispatchCircuit?.canDispatchWithCircuit
      ? self.DispatchCircuit.canDispatchWithCircuit(llmName)
      : { ok: true, retryAfterMs: 0 };
    if (!circuitGate.ok) {
      const remainingTime = Math.round((circuitGate.retryAfterMs || 0) / 1000);
      const errorMsg = `Model is temporarily disabled due to repeated failures. Retrying in ${remainingTime}s.`;
      globalThis.LLMLog?.debug?.(`[CIRCUIT-BREAKER] Skipping ${llmName}: circuit is OPEN for ${remainingTime}s.`);
      const circuitError = self.RunError?.makeRunError
        ? self.RunError.makeRunError(self.RunError.CODES.CIRCUIT_OPEN, errorMsg)
        : { type: 'circuit_open', message: errorMsg };
      handleLLMResponse(llmName, '', circuitError);
      updateModelState(llmName, 'CIRCUIT_OPEN', { message: errorMsg });
      return;
    }

    const apiUsed = await tryApiDirect(llmName, prompt, attachments);
    if (apiUsed) {
      return;
    }

    await runModelThroughTabs(llmName, prompt, forceNewTabs, attachments, { ...options, sessionId });
  }).catch((err) => {
    console.error(`[BACKGROUND] Failed to start ${llmName}:`, err);
  });
  return llmStartChains[llmName];
}

async function tryApiDirect(llmName, prompt, attachments = []) {
  const config = apiFallbackConfig[llmName];
  if (!jobState?.llms?.[llmName]) return false;
  if (!(await isApiTransportFeatureEnabled())) {
    recordApiTransportFeatureDisabled(llmName, attachments, 'start_model');
    return false;
  }
  if (jobState?.useApiFallback === false) {
    const transportDecision = self.TransportPolicy?.decideTransport
      ? self.TransportPolicy.decideTransport({
        llmName,
        apiModeEnabled: false,
        hasApiConfig: !!config,
        hasApiKey: false,
        hasWebUi: true,
        attachmentsCount: Array.isArray(attachments) ? attachments.length : 0
      })
      : { mode: 'web_ui', reason: 'api_mode_disabled', apiEligible: false, webUiEligible: true };
    emitTelemetry(llmName, 'TRANSPORT_DECISION', {
      level: 'info',
      details: `${transportDecision.mode}:${transportDecision.reason}`,
      meta: {
        ...transportDecision,
        dispatchReason: 'start_model'
      }
    });
    jobState.llms[llmName].transportDecision = {
      ...transportDecision,
      decidedAt: Date.now()
    };
    return false;
  }
  if (!config) {
    const transportDecision = self.TransportPolicy?.decideTransport
      ? self.TransportPolicy.decideTransport({
        llmName,
        apiModeEnabled: jobState?.useApiFallback !== false,
        hasApiConfig: false,
        hasApiKey: false,
        hasWebUi: true,
        attachmentsCount: Array.isArray(attachments) ? attachments.length : 0
      })
      : { mode: 'web_ui', reason: 'api_config_missing', apiEligible: false };
    emitTelemetry(llmName, 'TRANSPORT_DECISION', {
      level: 'warning',
      details: `${transportDecision.mode}:${transportDecision.reason}`,
      meta: {
        ...transportDecision,
        dispatchReason: 'start_model'
      }
    });
    if (jobState.llms[llmName]) {
      jobState.llms[llmName].transportDecision = {
        ...transportDecision,
        decidedAt: Date.now()
      };
    }
    return false;
  }
  try {
    let apiKey = await ApiKeyStorage.getSessionKey(config.storageKey);
    if (!apiKey) {
      apiKey = await ApiKeyStorage.getLegacyKey(config.storageKey);
      if (apiKey) {
        ApiKeyStorage.warnPlaintext(config.storageKey);
      }
    }
    const transportDecision = self.TransportPolicy?.decideTransport
      ? self.TransportPolicy.decideTransport({
        llmName,
        apiModeEnabled: jobState?.useApiFallback !== false,
        hasApiConfig: !!config,
        hasApiKey: !!apiKey,
        hasWebUi: true,
        attachmentsCount: Array.isArray(attachments) ? attachments.length : 0
      })
      : {
        mode: apiKey && config ? 'api_first' : 'web_ui',
        reason: apiKey ? 'api_key_available' : 'api_key_missing_use_web_ui',
        apiEligible: !!(apiKey && config)
      };
    emitTelemetry(llmName, 'TRANSPORT_DECISION', {
      level: transportDecision.apiEligible ? 'info' : 'warning',
      details: `${transportDecision.mode}:${transportDecision.reason}`,
      meta: {
        ...transportDecision,
        dispatchReason: 'start_model'
      }
    });
    const entry = jobState.llms[llmName];
    entry.transportDecision = {
      ...transportDecision,
      decidedAt: Date.now()
    };
    if (transportDecision.mode !== 'api_first') {
      if (transportDecision.reason === 'api_key_missing_use_web_ui') {
        logApiEvent(llmName, 'API key missing, using web', 'warning', config, '', getApiEndpointMeta(config));
      } else {
        broadcastDiagnostic(llmName, {
          type: 'TRANSPORT',
          label: 'Web UI transport selected',
          details: transportDecision.reason || 'web_ui',
          level: 'info',
          meta: transportDecision
        });
      }
      return false;
    }
    if (!apiKey) {
      logApiEvent(llmName, 'API key missing, using web', 'warning', config, '', getApiEndpointMeta(config));
      return false;
    }
    initRequestMetadata(llmName, null, 'API');
    entry.dispatchAttempts = (entry.dispatchAttempts || 0) + 1;
    entry.dispatchSource = 'api';
    entry.submitSource = 'api';
    const machine = self.DispatchStateManager ? self.DispatchStateManager.get(llmName) : null;
    if (machine) {
      if (!machine.canQueue()) {
        machine.reset();
      }
      machine.queue({
        prompt,
        attachments: jobState.attachments || [],
        dispatchId: `api:${llmName}:${Date.now()}`,
        dispatchAttempts: entry.dispatchAttempts
      });
      machine.activate({ tabId: null, source: 'api' });
      machine.ready({ source: 'api' });
      machine.submit({ source: 'api' });
      machine.sent({ source: 'api', confirmedAt: Date.now() });
    }
    logApiEvent(llmName, 'API request initiated', 'info', config, '', getApiEndpointMeta(config));
    const success = await executeApiFallback(llmName, prompt, {
      silentOnFailure: true,
      apiKeyOverride: apiKey
    });
    return success;
  } catch (err) {
    console.warn(`[API] Could not read API key for ${llmName}:`, err?.message || err);
    return false;
  }
}

const API_TRANSPORT_FEATURE_FLAG_KEY = 'feature_api_transport_enabled';

async function isApiTransportFeatureEnabled() {
  try {
    const data = await chrome.storage.local.get(API_TRANSPORT_FEATURE_FLAG_KEY);
    return self.TransportPolicy?.isApiTransportEnabled
      ? self.TransportPolicy.isApiTransportEnabled(data?.[API_TRANSPORT_FEATURE_FLAG_KEY])
      : data?.[API_TRANSPORT_FEATURE_FLAG_KEY] === true;
  } catch (err) {
    console.warn('[API] Could not read API transport feature flag:', err?.message || err);
    return false;
  }
}

function recordApiTransportFeatureDisabled(llmName, attachments = [], dispatchReason = 'start_model') {
  const transportDecision = {
    schemaVersion: 1,
    llmName,
    mode: 'web_ui',
    reason: 'api_transport_feature_disabled',
    apiEligible: false,
    webUiEligible: true,
    featureApiTransportEnabled: false,
    attachmentsCount: Array.isArray(attachments) ? attachments.length : 0
  };
  emitTelemetry(llmName, 'TRANSPORT_DECISION', {
    level: 'info',
    details: 'web_ui:api_transport_feature_disabled',
    meta: {
      ...transportDecision,
      dispatchReason
    }
  });
  if (jobState?.llms?.[llmName]) {
    jobState.llms[llmName].transportDecision = {
      ...transportDecision,
      decidedAt: Date.now()
    };
  }
  return transportDecision;
}

const DONOR_STICKY_REUSE_MODELS = new Set(['Le Chat', 'Perplexity']);

async function reuseMappedDonorProviderTab(llmName, prompt, attachments = [], options = {}) {
  if (!DONOR_STICKY_REUSE_MODELS.has(llmName)) return false;
  if (options.sessionId && !isSessionActive(options.sessionId)) return false;
  const mappedTabId = TabMapManager.get(llmName);
  const matchingTabs = await findReusableTabsForLlm(llmName).catch(() => []);
  const candidateIds = Array.from(new Set([
    isValidTabId(mappedTabId) ? mappedTabId : null,
    ...matchingTabs.map((tab) => tab?.id)
  ].filter(isValidTabId)));
  for (const tabId of candidateIds) {
    try {
      const tab = await new Promise((resolve) => {
        chrome.tabs.get(tabId, (value) => {
          if (chrome.runtime.lastError || !value) resolve(null);
          else resolve(value);
        });
      });
      if (!tab) continue;
      const readiness = await ensureTabReadyForDispatch(tabId, llmName, {
        reason: 'donor_sticky_reuse'
      });
      if (!readiness.ok) continue;
      if (!options.deferDispatch) {
        await prepareTabForUse(tabId, llmName);
      }
      initRequestMetadata(llmName, tabId, readiness.tab?.url || tab.url || LLM_TARGETS[llmName]?.url || '');
      await setTabBinding(llmName, tabId);
      emitTelemetry(llmName, 'DONOR_STICKY_TAB_REUSED', {
        level: 'info',
        details: `tab=${tabId}`,
        meta: {
          tabId,
          reason: 'provider_tab_reuse',
          selection: tabId === mappedTabId ? 'persisted_mapping' : 'newest_matching_tab',
          donorVersion: '2.81.75'
        },
        force: true
      });
      if (!options.deferDispatch) {
        dispatchPromptToTab(llmName, tabId, prompt, attachments, 'donor_sticky_reuse');
      }
      return true;
    } catch (err) {
      emitTelemetry(llmName, 'DONOR_STICKY_TAB_REUSE_FAILED', {
        level: 'warning',
        details: err?.message || 'provider_tab_reuse_failed',
        meta: { tabId, reason: 'provider_tab_reuse_failed' },
        force: true
      });
    }
  }
  return false;
}

async function runModelThroughTabs(llmName, prompt, forceNewTabs, attachments = [], options = {}) {
  if (options.sessionId && !isSessionActive(options.sessionId)) {
    return false;
  }
  if (forceNewTabs) {
    detachExistingTab(llmName);
    await setTabBinding(llmName, null);
    return createNewLlmTab(llmName, prompt, attachments, { ...options, forceCreate: true });
  }

  // Le Chat and Perplexity deliberately retain the donor's sticky-conversation
  // behaviour: if any valid provider tab exists, use it before the generic
  // draft/modal preflight can redirect the request into a duplicate new tab.
  if (!options.deferDispatch && await reuseMappedDonorProviderTab(llmName, prompt, attachments, options)) {
    return true;
  }

  // This acquisition is a transaction: the caller must not advance Round 0
  // until either a safe existing tab is bound or a fresh tab is created.
  // tryAttachExistingTab already considers every eligible global tab, including
  // the persisted mapping. Falling back to that mapping after a failed surface
  // probe would simply reintroduce the rejected draft/generation state.
  try {
    const attached = await tryAttachExistingTab(llmName, prompt, attachments, {
      ...options,
      allowGlobalReuse: true,
      // New pages is off: a repeat request must land in the page the user
      // already has open. Recoverable page residue (a leftover draft, a modal)
      // may be overridden rather than answered with a duplicate tab.
      mandatoryReuse: true
    });
    if (attached) return true;
  } catch (err) {
    console.warn(`[BACKGROUND] Failed to attach existing tab for ${llmName}:`, err?.message || err);
  }

  await setTabBinding(llmName, null);
  broadcastGlobalState();
  emitTelemetry(llmName, 'TAB_ISOLATION_FALLBACK_CREATE', {
    level: 'warning',
    details: 'no_safe_reusable_tab',
    meta: { reason: 'no_safe_reusable_tab' },
    force: true
  });
  return createNewLlmTab(llmName, prompt, attachments, {
    ...options,
    forceCreate: true
  });
}

//-- 3.1. Round 0: НЕ прерываем открытие вкладок при изменении sessionId --//
async function openTabsSequentially(selectedLLMs, prompt, forceNewTabs, attachments = [], sessionId, options = {}) {
  const capturedSessionId = sessionId; // Захватываем начальный sessionId

  // Existing pages are independent resources. Acquiring them concurrently
  // avoids a 9 x 15s sequential window in which MV3 can suspend the worker.
  // New-tab creation remains sequential so it cannot produce a focus storm.
  if (!forceNewTabs) {
    const acquisitions = selectedLLMs.map(async (llmName, index) => {
      if (capturedSessionId && jobState?.session?.startTime !== capturedSessionId) return false;
      // Preserve the exact conversation binding across worker restarts.
      const resumedBinding = options.resume === true && isValidTabId(resolveBoundTabIdForOrchestrator(llmName, jobState?.llms?.[llmName]));
      if (!resumedBinding) {
        await startModelForLLM(llmName, prompt, false, attachments, { deferDispatch: true, sessionId });
        await waitForRound0Binding(llmName, sessionId, ROUND0_BIND_WAIT_TIMEOUT_MS);
      }
      const entry = jobState?.llms?.[llmName];
      const tabId = resolveBoundTabIdForOrchestrator(llmName, entry);
      // Round 0 binds pages only. Receiver recovery runs in the focused
      // Round 1 slot, so an idle page cannot hold every provider behind it.
      emitTelemetry(llmName, 'ROUND0_TAB_OPENED', {
        details: `${index + 1}/${selectedLLMs.length}`,
        meta: { index, total: selectedLLMs.length, tabId: jobState?.llms?.[llmName]?.tabId || null, acquisitionMode: 'parallel_reuse' }
      });
      return true;
    });
    await Promise.allSettled(acquisitions);
    if (capturedSessionId && jobState?.session?.startTime !== capturedSessionId) return false;
    if (selectedLLMs.length) {
      emitTelemetry('orchestrator', 'ROUND0_COMPLETE', {
        details: `${selectedLLMs.length} existing tabs acquired`,
        level: 'info',
        meta: { count: selectedLLMs.length, acquisitionMode: 'parallel_reuse' },
        force: true
      });
    }
    return true;
  }
  
  for (let i = 0; i < selectedLLMs.length; i += 1) {
    // ✅ Проверяем только НАЧАЛЬНЫЙ sessionId, игнорируем промежуточные изменения
    if (capturedSessionId && jobState?.session?.startTime !== capturedSessionId) {
      console.warn(`[ROUND0] Session changed during tab opening, aborting (${i}/${selectedLLMs.length})`);
      return false;
    }
    const llmName = selectedLLMs[i];
    await startModelForLLM(llmName, prompt, forceNewTabs, attachments, { deferDispatch: true, sessionId });
    await waitForRound0Binding(llmName, sessionId, ROUND0_BIND_WAIT_TIMEOUT_MS);

    //-- 4.1. Логирование успешного открытия вкладки --//
globalThis.LLMLog?.debug?.(`[ROUND0] Opened tab ${i + 1}/${selectedLLMs.length}: ${llmName}`);
    emitTelemetry(llmName, 'ROUND0_TAB_OPENED', {
      details: `${i + 1}/${selectedLLMs.length}`,
      meta: { index: i, total: selectedLLMs.length, tabId: jobState?.llms?.[llmName]?.tabId || null }
    });

    if (i < selectedLLMs.length - 1) {
      await orchestratorSleepMs(ROUND0_OPEN_STAGGER_MS);
    }
  }
  if (selectedLLMs.length) {
    emitTelemetry('orchestrator', 'ROUND0_COMPLETE', {
      details: `${selectedLLMs.length} tabs opened`,
      level: 'info',
      meta: { count: selectedLLMs.length },
      force: true
    });
  }
  return true;
}

async function recoverRound1TabReadiness(llmName, prompt, attachments = [], sessionId, previousTabId = null, reason = 'round1_recover') {
  if (sessionId && !isSessionActive(sessionId)) return null;
  emitTelemetry(llmName, 'ROUND1_TAB_RECOVERY_START', {
    level: 'warning',
    details: reason,
    meta: { previousTabId, reason },
    force: true
  });
  try {
    await setTabBinding(llmName, null);
    broadcastGlobalState();
    createNewLlmTab(llmName, prompt, attachments, { sessionId, forceCreate: true, deferDispatch: true });
    await waitForRound0Binding(llmName, sessionId, ROUND0_BIND_WAIT_TIMEOUT_MS);
    const tabId = await resolveTabForLlmNameAsync(llmName);
    if (!isValidTabId(tabId)) {
      emitTelemetry(llmName, 'ROUND1_TAB_RECOVERY_MISS', {
        level: 'warning',
        details: 'tab_not_found_after_create',
        meta: { previousTabId, reason },
        force: true
      });
      return null;
    }
    const readiness = await ensureTabReadyForDispatch(tabId, llmName, { reason });
    emitTelemetry(llmName, readiness.ok ? 'ROUND1_TAB_RECOVERY_OK' : 'ROUND1_TAB_RECOVERY_MISS', {
      level: readiness.ok ? 'success' : 'warning',
      details: readiness.ok ? 'ready' : (readiness.reason || 'not_ready'),
      meta: { previousTabId, tabId, reason, snapshot: readiness.snapshot || null },
      force: true
    });
    return readiness.ok ? { tabId, readiness } : null;
  } catch (err) {
    emitTelemetry(llmName, 'ROUND1_TAB_RECOVERY_ERROR', {
      level: 'error',
      details: err?.message || String(err),
      meta: { previousTabId, reason },
      force: true
    });
    return null;
  }
}

const orderRound1Models = (selectedLLMs = []) => {
  const source = Array.isArray(selectedLLMs) ? selectedLLMs.filter(Boolean) : [];
  return [...new Set(source)];
};

async function dispatchRound1Sequentially(selectedLLMs, prompt, attachments = [], sessionId, options = {}) {
  // A single ordered pass owns foreground dispatch. Recovery starts in Round 2.
  const models = orderRound1Models(selectedLLMs);
  for (const llmName of models) {
    if (sessionId && !isSessionActive(sessionId)) return false;
    await (async () => {
      if (sessionId && !isSessionActive(sessionId)) return false;
      let entry = jobState?.llms?.[llmName];
      if (!entry) {
        ensureRoundEntries([llmName], 'round1_missing_entry');
        entry = jobState?.llms?.[llmName];
      }
      if (!entry || isFinalizedEntry(entry)) return;
      const preparationInterrupted = entry.dispatchCheckpoint?.phase === 'preparing'
        && entry.dispatchCheckpoint?.dispatchId === entry.lastDispatchMeta?.dispatchId;
      if (options.resume === true && (
        entry.promptSubmittedAt
        || (entry.lastDispatchMeta?.dispatchId && !preparationInterrupted)
        || (self.getDispatchFlags?.(llmName, entry)?.isSent === true)
      )) {
        emitModelRoundTelemetry(llmName, 1, 'END', 'resume skipped previous dispatch attempt', {
          meta: {
            tabId: resolveBoundTabIdForOrchestrator(llmName, entry) || null,
            reason: 'resume_previous_attempt',
            dispatchId: entry.lastDispatchMeta?.dispatchId || entry.confirmedDispatchId || null
          }
        });
        return;
      }
      const roundStart = Date.now();
      const endMeta = { tabId: null, reason: 'unknown' };
      let endLevel = 'info';
      let endDetails = 'dispatch complete';
      let tabId = resolveBoundTabIdForOrchestrator(llmName, entry);
      emitModelRoundTelemetry(llmName, 1, 'START', 'dispatching prompt', {
        meta: { tabId: isValidTabId(tabId) ? tabId : null }
      });
      if (!isValidTabId(tabId)) {
        endLevel = 'warning';
        endDetails = 'tab not found';
        endMeta.reason = 'tab_not_found';
        emitModelRoundTelemetry(llmName, 1, 'END', endDetails, {
          level: endLevel,
          meta: { ...endMeta, durationMs: Date.now() - roundStart }
        });
        return;
      }
      endMeta.tabId = tabId;
      let tabTimer;
      const dispatchTab = await Promise.race([
        getTabSafe(tabId),
        new Promise(resolve => { tabTimer = setTimeout(() => resolve(null), 1500); })
      ]).finally(() => clearTimeout(tabTimer));
      if (sessionId && !isSessionActive(sessionId)) return false;
      initRequestMetadata(llmName, tabId, dispatchTab?.url || dispatchTab?.pendingUrl || '');
      // Every provider receives the same fixed 2s + 5s visit. Recovery follows
      // only after this ordered pass has finished.
      const modelPrompt = resolvePromptForDispatch(llmName, prompt);
      const dispatchResult = await dispatchPromptToTab(llmName, tabId, modelPrompt, attachments, 'round1', {
        simpleFirstPass: true,
        postSendMs: ROUND1_POST_SEND_MS,
        forceFocus: true,
        skipNoFocusProbe: true,
        skipFocusRestore: true,
        skipSubmitWait: true,
        deferSendMs: ROUND1_BEFORE_SEND_MS,
        skipTypingGuard: true,
        requireCommandAcceptance: true,
        resetStateAfterSend: false
      });
      const postDispatchEntry = jobState?.llms?.[llmName] || entry;
      const confirmedByContent = !!postDispatchEntry?.promptSubmittedAt && postDispatchEntry?.submitSource === 'content';
      const passResult = postDispatchEntry?.firstPassResult;
      const commandIssued = passResult?.dispatchId === postDispatchEntry?.lastDispatchMeta?.dispatchId
        && passResult?.commandAt != null;
      endMeta.reason = confirmedByContent ? 'prompt_confirmed' : (dispatchResult?.reason || 'dispatch_not_issued');
      endDetails = confirmedByContent ? 'prompt confirmed'
        : (commandIssued ? 'dispatch command issued (confirmation tracked separately)' : 'dispatch deferred before command');
      endLevel = confirmedByContent ? 'success' : (commandIssued ? 'info' : 'warning');
      emitModelRoundTelemetry(llmName, 1, 'END', endDetails, {
        level: endLevel,
        meta: {
          tabId,
          durationMs: Date.now() - roundStart,
          reason: endMeta.reason,
          commandIssued,
          promptSubmittedAt: postDispatchEntry?.promptSubmittedAt || null,
          submitSource: postDispatchEntry?.submitSource || null,
          dispatchId: postDispatchEntry?.lastDispatchMeta?.dispatchId || null
        }
      });
      endBudgetPhase(llmName, 'dispatch');
    })().catch(error => {
      emitModelRoundTelemetry(llmName, 1, 'END', 'dispatch preparation failed', {
        level: 'error', meta: { reason: String(error?.message || error || 'dispatch_failed') }
      });
    });
  }
  return !sessionId || isSessionActive(sessionId);
}

async function focusTabForVerification(llmName, tabId, durationMs, sessionId) {
  if (self.isInitialPromptPassActive?.()) return false;
  if (!isValidTabId(tabId)) return false;
  if (sessionId && !isSessionActive(sessionId)) return false;
  const entry = jobState?.llms?.[llmName];
  if (!entry || isFinalizedEntry(entry)) return false;
  if (entry && self.isActiveFocusAllowedForEntry?.(entry) === false) {
    emitTelemetry(llmName, 'VERIFICATION_FOCUS_SKIPPED', {
      details: 'active_focus_window_exhausted',
      meta: { tabId, activeFocusDeadlineAt: entry.activeFocusDeadlineAt || null }
    });
    return false;
  }
  const remainingFocusMs = entry?.activeFocusDeadlineAt
    ? Math.max(0, Number(entry.activeFocusDeadlineAt) - Date.now())
    : Number(durationMs || 0);
  const boundedDurationMs = Math.min(12000, Number(durationMs || 0), remainingFocusMs);
  if (boundedDurationMs <= 0) return false;
  return withPromptDispatchFocusLock(async () => {
    if (self.isInitialPromptPassActive?.() || (sessionId && !isSessionActive(sessionId))
      || jobState?.llms?.[llmName] !== entry || isFinalizedEntry(entry)
      || self.isActiveFocusAllowedForEntry?.(entry) === false) return false;
    if (await activateTabForDispatch(tabId) !== true) return false;
    let visitStarted = false;
    if (typeof startTabVisit === 'function') {
      visitStarted = startTabVisit(tabId, llmName, 'verification_focus') === true;
    }
    // This timer must resolve even when Stop clears registered session timers,
    // otherwise the shared focus queue would remain locked across the next run.
    await new Promise(resolve => setTimeout(resolve, boundedDurationMs));
    let visitSummary = null;
    if (visitStarted && typeof finalizeTabVisit === 'function'
      && typeof tabVisitTracker !== 'undefined' && tabVisitTracker?.tabId === tabId
      && tabVisitTracker?.llmName === llmName) {
      visitSummary = finalizeTabVisit('verification_focus_end');
    }
    if (sessionId && !isSessionActive(sessionId)) return false;
    return visitSummary || true;
  });
}


async function runPreCollectScrollNudge(llmName, tabId, sessionId, reason = 'precollect_nudge', options = {}) {
  const requiredBottom = options.getIt === true;
  if (self.isInitialPromptPassActive?.()) return false;
  if (!llmName || !isValidTabId(tabId)) return false;
  if (sessionId && !isSessionActive(sessionId)) return false;
  const initialEntry = jobState?.llms?.[llmName];
  if (!initialEntry || (!requiredBottom && isFinalizedEntry(initialEntry))) {
    emitTelemetry(llmName, 'PRECOLLECT_NUDGE_SKIP', {
      details: 'terminal',
      meta: { tabId, reason }
    });
    return false;
  }
  if (!requiredBottom && self.isActiveFocusAllowedForEntry?.(initialEntry) === false) {
    emitTelemetry(llmName, 'PRECOLLECT_NUDGE_SKIP', {
      details: 'active_focus_window_exhausted',
      meta: { tabId, reason, activeFocusDeadlineAt: initialEntry.activeFocusDeadlineAt || null }
    });
    return false;
  }
  const performNudge = async () => {
    const liveEntry = jobState?.llms?.[llmName];
    if (self.isInitialPromptPassActive?.() || (sessionId && !isSessionActive(sessionId))
      || liveEntry !== initialEntry || (!requiredBottom && isFinalizedEntry(liveEntry))) return false;
    if (!requiredBottom && self.isActiveFocusAllowedForEntry?.(liveEntry) === false) return false;
    if (typeof activateTabForDispatch === 'function') {
      await activateTabForDispatch(tabId);
    }
    if (self.isInitialPromptPassActive?.() || (sessionId && !isSessionActive(sessionId))
      || jobState?.llms?.[llmName] !== liveEntry || (!requiredBottom && isFinalizedEntry(liveEntry))) return false;
    const manualVisitStartedAt = Date.now();
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      func: (meta = {}) => {
        const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
        const requiredBottom = meta.requiredBottom === true;
        let arrowClicks = 0;
        const clickBottomArrow = () => {
          if (!requiredBottom) return;
          // Only explicit navigation controls; never a generic down-arrow SVG
          // that might instead be Send, Download or a model-selection menu.
          const button = Array.from(document.querySelectorAll('button, [role="button"]')).find(node => {
            if (node.disabled || node.getAttribute('aria-disabled') === 'true' || !node.getClientRects().length) return false;
            const label = [node.getAttribute('aria-label'), node.getAttribute('title'), node.getAttribute('data-testid')].filter(Boolean).join(' ');
            return /scroll[\s_-]*to[\s_-]*(bottom|latest)|scroll[\s_-]*down|jump[\s_-]*to[\s_-]*(bottom|latest)|прокрутить.*вниз|к последнему сообщению|滚动到底部|回到底部/i.test(label);
          });
          if (button) { button.click(); arrowClicks += 1; }
        };
        const resolveScrollableTargets = () => {
          const set = new Set();
          const root = document.scrollingElement || document.documentElement || document.body;
          const add = (node) => {
            if (!node || set.has(node)) return;
            const height = Number(node.scrollHeight || 0);
            const view = Number(node.clientHeight || 0);
            if (height - view <= 40) return;
            if (node !== root) {
              const style = getComputedStyle(node);
              if (!/(auto|scroll|overlay)/.test(style.overflowY) || !node.getClientRects().length) return;
              if (node.closest('nav, aside, pre, [role="navigation"], [role="listbox"]')) return;
            }
            set.add(node);
          };
          // Include ordinary divs with generated class names, and their outer
          // scrolling ancestors. A class-name heuristic misses these entirely.
          document.querySelectorAll('body *').forEach(add);
          const candidates = Array.from(set);
          const conversation = candidates.filter(node => node.matches('main, [role="main"]')
            || node.closest('main, [role="main"]') || node.querySelector('main, [role="main"]'));
          const pool = conversation.length ? conversation : candidates;
          // Prefer the large conversation viewport over nested code/table panes.
          pool.sort((a, b) => b.clientHeight * b.clientWidth - a.clientHeight * a.clientWidth);
          const primary = pool[0];
          set.clear();
          for (let node = primary; node; node = node.parentElement) add(node);
          add(root);
          if (requiredBottom && !set.size && root?.clientHeight > 0 && root?.scrollHeight > 0) set.add(root);
          return Array.from(set);
        };
        const getTop = (node) => {
          if (!node) return 0;
          if (node === document.body || node === document.documentElement || node === document.scrollingElement) {
            return Number(window.scrollY || node.scrollTop || 0);
          }
          return Number(node.scrollTop || 0);
        };
        const setTop = (node, top) => {
          if (!node) return;
          const bounded = Math.max(0, top);
          if (node === document.body || node === document.documentElement || node === document.scrollingElement) {
            window.scrollTo({ top: bounded, behavior: 'instant' });
            return;
          }
          node.scrollTo({ top: bounded, behavior: 'instant' });
        };
        return Promise.resolve().then(async () => {
          let previousTargets = [], previousSignature = '', stableSamples = 0;
          for (let pass = 0; pass < 8; pass += 1) {
            if (requiredBottom && document.visibilityState === 'hidden') return { ok: false, settled: false, reason: 'page_hidden' };
            clickBottomArrow();
            // Re-resolve after rendering: both the node and its height can change.
            const targets = resolveScrollableTargets();
            targets.forEach(node => setTop(node, node.scrollHeight - node.clientHeight));
            window.dispatchEvent(new Event('scroll'));
            await sleep(150);
            const atBottom = (!requiredBottom || targets.length > 0) && targets.every(node => node.isConnected && node.scrollHeight - node.clientHeight - getTop(node) <= 4);
            const signature = targets.map(node => {
              const text = node.innerText || node.textContent || '';
              return `${node.scrollHeight}:${node.clientHeight}:${text.length}:${text.slice(-160)}`;
            }).join('|');
            const sameNodes = targets.length === previousTargets.length
              && targets.every((node, index) => node === previousTargets[index]);
            stableSamples = atBottom && sameNodes && signature === previousSignature ? stableSamples + 1 : 0;
            if (stableSamples >= 2) return { ok: true, settled: true, targets: targets.length, passes: pass + 1, arrowClicks };
            previousTargets = targets;
            previousSignature = signature;
          }
          // This only prepares the DOM. It is never evidence of completed generation.
          return { ok: true, settled: false, targets: previousTargets.length, passes: 8 };
        });
      },
      args: [{ reason, llmName, requiredBottom }]
    });
    // Manual visits already wait for rendering in the page script. Do not add
    // the automatic nudge's extra stabilization delay on top of their dwell.
    if (!requiredBottom) await orchestratorSleepMs(PRECOLLECT_NUDGE_STABILIZE_MS);
    emitTelemetry(llmName, 'PRECOLLECT_NUDGE', {
      details: reason,
      meta: { tabId, reason, scrollPreparation: results?.[0]?.result || null }
    });
    if (requiredBottom && (Number.isInteger(options.returnToTabId) || options.batchDwell === true)) {
      // Keep this dwell and return inside the focus lock, so another model
      // cannot take this recovery's slot while we are waiting.
      await orchestratorSleepMs(options.batchDwell === true ? 2000
        : Math.max(0, 2500 - (Date.now() - manualVisitStartedAt)));
      try {
        const returnTab = Number.isInteger(options.returnToTabId) ? await getTabSafe(options.returnToTabId) : null;
        if (isAppUiTab(returnTab)) {
          await chrome.tabs.update(returnTab.id, { active: true });
          await chrome.windows.update(returnTab.windowId, { focused: true });
        }
      } catch (err) {
        // A closed source tab must not turn successful preparation into failure.
        emitTelemetry(llmName, 'MANUAL_RECOVERY_RETURN_FAILED', {
          level: 'warning', details: err?.message || String(err)
        });
      }
    }
    return !requiredBottom || results?.[0]?.result?.settled === true;
  };
  try {
    // Keep focus for the full render preparation, not just tabs.update().
    return typeof withPromptDispatchFocusLock === 'function'
      ? await withPromptDispatchFocusLock(performNudge) : await performNudge();
  } catch (err) {
    emitTelemetry(llmName, 'PRECOLLECT_NUDGE_ERROR', {
      level: 'warning',
      details: err?.message || String(err),
      meta: { tabId, reason }
    });
    return false;
  }
}

async function runForcedAutomationVisits(llmName, tabId, sessionId, options = {}) {
  if (self.isInitialPromptPassActive?.()) return false;
  if (!isValidTabId(tabId)) return false;
  const visitFn = (typeof self.visitTabWithAutomation === 'function') ? self.visitTabWithAutomation : null;
  const visitPolicy = self.VisitPolicy || null;
  const visits = Math.max(1, Number(options.visits || 1) || 1);
  const minMs = Math.max(1000, Number(options.minMs || 0) || 1000);
  const maxMs = Math.max(minMs, Number(options.maxMs || minMs) || minMs);
  const reason = options.reason || 'automation_visit';
  const maxShortRetries = Math.max(0, Number(options.maxShortRetries ?? visitPolicy?.DEFAULT_MAX_SHORT_RETRIES ?? 1) || 0);
  let performed = 0;
  let shortRetries = 0;
  for (let index = 0; index < visits; index += 1) {
    if (sessionId && !isSessionActive(sessionId)) return false;
    const liveEntry = jobState?.llms?.[llmName];
    if (!liveEntry || isFinalizedEntry(liveEntry)) {
      emitTelemetry(llmName, 'FORCED_VISIT_SKIPPED', {
        details: 'terminal_before_visit',
        meta: { tabId, reason, visitIndex: index + 1, total: visits }
      });
      break;
    }
    if (self.isActiveFocusAllowedForEntry?.(liveEntry) === false) {
      emitTelemetry(llmName, 'FORCED_VISIT_SKIPPED', {
        details: 'active_focus_window_exhausted',
        meta: { tabId, reason, visitIndex: index + 1, total: visits, activeFocusDeadlineAt: liveEntry.activeFocusDeadlineAt || null }
      });
      break;
    }
    const dwellMs = Math.floor(minMs + Math.random() * (maxMs - minMs));
    const maxScrollDurationMs = Math.max(1200, Number(options.maxScrollDurationMs || 3600) || 3600);
    const scrollDurationMs = Math.min(maxScrollDurationMs, Math.max(1200, Math.floor(dwellMs * 0.6)));
    emitTelemetry(llmName, 'FORCED_VISIT', {
      details: `reason=${reason} dwell=${dwellMs}ms`,
      meta: { tabId, reason, dwellMs, scrollDurationMs, visitIndex: index + 1, total: visits }
    });
    let visitResult = false;
    if (visitFn) {
      visitResult = await visitFn(llmName, tabId, { dwellMs, scrollDurationMs, reason, sessionId });
    } else {
      await focusTabForVerification(llmName, tabId, dwellMs, sessionId);
      visitResult = true;
    }
    const visitSummary = visitResult && typeof visitResult === 'object' ? visitResult : null;
    const usefulVisit = visitResult === true || (visitSummary && visitSummary.usefulVisit !== false);
    const retryShortVisit = visitPolicy?.shouldRetryVisit
      ? visitPolicy.shouldRetryVisit(visitSummary, { attempt: shortRetries, maxShortRetries })
      : Boolean(visitSummary?.shortVisit && shortRetries < maxShortRetries);
    if (retryShortVisit) {
      shortRetries += 1;
      emitTelemetry(llmName, 'FORCED_VISIT_SHORT_RETRY', {
        level: 'warning',
        details: `duration=${visitSummary?.durationMs || 0}ms retry=${shortRetries}/${maxShortRetries}`,
        meta: {
          tabId,
          reason,
          visitIndex: index + 1,
          total: visits,
          shortRetries,
          maxShortRetries,
          durationMs: visitSummary?.durationMs || 0,
          minUsefulMs: visitSummary?.minUsefulMs || null,
          source: visitSummary?.source || 'unknown',
          finishReason: visitSummary?.reason || 'unknown'
        },
        force: true
      });
      index -= 1;
      await orchestratorSleepMs(Math.min(1000, Math.max(250, Math.floor(minMs * 0.2))));
      continue;
    }
    if (usefulVisit) performed += 1;
    const afterVisitEntry = jobState?.llms?.[llmName];
    if (!afterVisitEntry || isFinalizedEntry(afterVisitEntry)) break;
  }
  return performed > 0;
}

async function dispatchRound2Verification(selectedLLMs, sessionId) {
  const round2BatchStartedAt = Date.now();
  const round2BatchStartedPerf = (typeof performance !== 'undefined' && typeof performance.now === 'function')
    ? performance.now()
    : null;
  const round2BatchBudgetMs = getRound2BatchBudgetMs(selectedLLMs.length);
  const round2DeadlineAt = round2BatchStartedAt + round2BatchBudgetMs;
  const getRound2Timing = () => {
    const nowWall = Date.now();
    const wallElapsedMs = Math.max(0, nowWall - round2BatchStartedAt);
    let elapsedMs = wallElapsedMs;
    if (Number.isFinite(round2BatchStartedPerf) && round2BatchStartedPerf !== null && typeof performance !== 'undefined' && typeof performance.now === 'function') {
      const perfElapsedMs = Math.max(0, Math.round(performance.now() - round2BatchStartedPerf));
      elapsedMs = Number.isFinite(perfElapsedMs) ? perfElapsedMs : wallElapsedMs;
    }
    return {
      elapsedMs: Math.max(0, Math.round(elapsedMs)),
      wallElapsedMs: Math.max(0, Math.round(wallElapsedMs)),
      remainingMs: Math.max(0, round2DeadlineAt - nowWall)
    };
  };
  const emitRound2CutoffFrom = async (startIndex, timingMeta = null) => {
    const timing = timingMeta || getRound2Timing();
    const pendingModels = selectedLLMs.slice(startIndex);
    emitTelemetry('ROUNDS', 'ROUND2_CUTOFF', {
      level: 'warning',
      details: `batch timeout ${timing.elapsedMs}ms`,
      meta: {
        batchBudgetMs: round2BatchBudgetMs,
        pendingModels,
        elapsedMs: timing.elapsedMs,
        wallElapsedMs: timing.wallElapsedMs,
        remainingMs: timing.remainingMs,
        sessionId
      }
    });
    for (const pendingName of pendingModels) {
      const pendingEntry = jobState?.llms?.[pendingName];
      if (!pendingEntry) continue;
      const pendingTabId = self.getBoundTabId
        ? self.getBoundTabId(pendingName, pendingEntry)
        : (pendingEntry.tabId || TabMapManager.get(pendingName) || null);
      if (isFinalizedEntry(pendingEntry)) {
        emitModelRoundTelemetry(pendingName, 2, 'START', 'skipped (already complete)', {
          level: 'info',
          meta: { tabId: isValidTabId(pendingTabId) ? pendingTabId : null, reason: 'terminal' }
        });
        emitModelRoundTelemetry(pendingName, 2, 'END', 'skipped (already complete)', {
          level: 'info',
          meta: { tabId: isValidTabId(pendingTabId) ? pendingTabId : null, reason: 'terminal' }
        });
        continue;
      }
      broadcastDiagnostic(pendingName, {
        type: 'DISPATCH',
        label: 'ROUND2_SKIP',
        details: 'batch_timeout',
        level: 'warning'
      });
      emitModelRoundTelemetry(pendingName, 2, 'START', 'verification skipped (batch timeout)', {
        level: 'warning',
        meta: { tabId: isValidTabId(pendingTabId) ? pendingTabId : null, reason: 'batch_timeout' }
      });
      emitModelRoundTelemetry(pendingName, 2, 'END', 'verification skipped (batch timeout)', {
        level: 'warning',
        meta: { tabId: isValidTabId(pendingTabId) ? pendingTabId : null, reason: 'batch_timeout' }
      });
      if (pendingEntry.promptSubmittedAt && !isFinalizedEntry(pendingEntry) && isValidTabId(pendingTabId)) {
        await runPreCollectScrollNudge(pendingName, pendingTabId, sessionId, 'round2_batch_timeout');
        triggerResponseCollectionPing(pendingName, pendingTabId, 'round2_batch_timeout');
        schedulePostR2AutoCollect(pendingName, pendingTabId, sessionId);
        scheduleAdaptiveCollectionProbe(pendingName, sessionId, {
          reason: 'round2_batch_timeout',
          source: 'adaptive_round2'
        });
      }
    }
  };
  for (let index = 0; index < selectedLLMs.length; index += 1) {
    const llmName = selectedLLMs[index];
    const batchTiming = getRound2Timing();
    if (batchTiming.elapsedMs > round2BatchBudgetMs || batchTiming.remainingMs <= 0) {
      await emitRound2CutoffFrom(index, batchTiming);
      break;
    }
    if (sessionId && !isSessionActive(sessionId)) return false;
    const entry = jobState?.llms?.[llmName];
    if (!entry) continue;
    let tabId = resolveBoundTabIdForOrchestrator(llmName, entry);
    if (isFinalizedEntry(entry)) {
      emitModelRoundTelemetry(llmName, 2, 'START', 'skipped (already complete)', {
        level: 'info',
        meta: { tabId: isValidTabId(tabId) ? tabId : null, reason: 'terminal' }
      });
      emitModelRoundTelemetry(llmName, 2, 'END', 'skipped (already complete)', {
        level: 'info',
        meta: { tabId: isValidTabId(tabId) ? tabId : null, reason: 'terminal' }
      });
      continue;
    }
    emitModelRoundTelemetry(llmName, 2, 'START', 'verifying prompt', {
      meta: { tabId: isValidTabId(tabId) ? tabId : null }
    });
    let endDetails = 'round2 skipped';
    let endLevel = 'warning';
    const endMeta = {
      tabId: isValidTabId(tabId) ? tabId : null,
      reason: 'unknown'
    };
    try {
      if (entry?.dispatchSource === 'api') {
        endDetails = 'api dispatch (verification skipped)';
        endLevel = 'info';
        endMeta.reason = 'api_dispatch';
        continue;
      }
      if (!isValidTabId(tabId)) {
        tabId = await resolveTabForLlmNameAsync(llmName);
      }
      if (!isValidTabId(tabId)) {
        endMeta.reason = 'tab_not_found';
        continue;
      }
      endMeta.tabId = tabId;

      const initialConfirmed = !!entry?.promptSubmittedAt && entry?.submitSource === 'content';
      if (initialConfirmed) {
        endDetails = 'already confirmed';
        endLevel = 'info';
        endMeta.reason = 'already_confirmed';
        const liveEntry = jobState?.llms?.[llmName];
        if (liveEntry && !isFinalizedEntry(liveEntry)) {
          await runPreCollectScrollNudge(llmName, tabId, sessionId, 'round2_precollect');
          triggerResponseCollectionPing(llmName, tabId, 'round2_probe');
          schedulePostR2AutoCollect(llmName, tabId, sessionId);
          scheduleAdaptiveCollectionProbe(llmName, sessionId, {
            reason: 'round2_already_confirmed',
            source: 'adaptive_round2'
          });
        }
        continue;
      }

      let readiness = await ensureTabReadyForDispatch(tabId, llmName, { reason: 'round2' });
      if (!readiness.ok) {
        const retryTabId = await resolveTabForLlmNameAsync(llmName);
        if (isValidTabId(retryTabId) && retryTabId !== tabId) {
          readiness = await ensureTabReadyForDispatch(retryTabId, llmName, { reason: 'round2_retry' });
          if (readiness.ok) {
            emitTelemetry(llmName, 'ROUND2_RETRY_OK', {
              details: 'resolved tabId on retry',
              meta: { previousTabId: tabId, tabId: retryTabId }
            });
            tabId = retryTabId;
            endMeta.tabId = tabId;
          }
        }
      }
      if (!readiness.ok) {
        broadcastDiagnostic(llmName, {
          type: 'DISPATCH',
          label: 'ROUND2_SKIP',
          details: readiness.reason || 'tab_not_ready',
          level: 'warning'
        });
        endDetails = 'round2 skipped';
        endLevel = 'warning';
        endMeta.reason = readiness.reason || 'tab_not_ready';
        continue;
      }
      let confirmedByContent = !!entry?.promptSubmittedAt && entry?.submitSource === 'content';
      let repairAttemptedBeforeVisit = false;
      const providerPipelineActive = self.isProviderPipelineOwnershipActive
        ? self.isProviderPipelineOwnershipActive(entry)
        : ((entry?.providerComposerTransactionActive === true || entry?.providerPipelineActive === true)
          && Date.now() - Number(entry?.providerComposerTransactionActiveAt || entry?.providerPipelineActiveAt || 0) < ROUND_PROVIDER_PIPELINE_OWNERSHIP_TTL_MS);
      if (!confirmedByContent && providerPipelineActive) {
        emitTelemetry(llmName, 'ROUND2_REPAIR_DISPATCH_SKIPPED', {
          level: 'info',
          details: 'original provider pipeline is still active',
          meta: { tabId, reason: 'provider_pipeline_active', dispatchId: entry?.providerPipelineDispatchId || null },
          force: true
        });
        endDetails = 'awaiting original provider pipeline';
        endMeta.reason = 'provider_pipeline_active';
        endMeta.outcome = 'deferred';
        endLevel = 'info';
        // The content adapter still owns the tab. Collection probes here race
        // the open message port and produce misleading transport failures.
        // PROMPT_SUBMITTED / terminal pipeline failure will resolve ownership.
        continue;
      }
      if (!confirmedByContent && canRepairDispatchInRound2(llmName) && jobState?.prompt) {
        repairAttemptedBeforeVisit = true;
        const repairIntentDecision = self.RecoveryIntent?.authorize
          ? self.RecoveryIntent.authorize(entry, {
            intent: 'resend_prompt',
            reason: 'round2_repair_pre_visit',
            minChars: DOM_SNAPSHOT_RECOVERY_MIN_CHARS
          })
          : { ok: true };
        if (!repairIntentDecision.ok) {
          emitTelemetry(llmName, 'ROUND2_REPAIR_DISPATCH_SKIPPED', {
            level: 'warning',
            details: repairIntentDecision.reason || 'recovery_intent_denied',
            meta: { tabId, reason: 'repair_dispatch_pre_visit', intentDecision: repairIntentDecision },
            force: true
          });
          broadcastDiagnostic(llmName, {
            type: 'DISPATCH',
            label: 'ROUND2 repair skipped',
            details: repairIntentDecision.reason || 'recovery_intent_denied',
            level: 'warning',
            meta: { tabId, intentDecision: repairIntentDecision }
          });
        } else {
          emitTelemetry(llmName, 'ROUND2_REPAIR_DISPATCH_START', {
            level: 'warning',
            details: 'prompt not confirmed before verify visit',
            meta: { tabId, reason: 'repair_dispatch_pre_visit' }
          });
          try {
            const previousDispatchId = entry?.lastDispatchMeta?.dispatchId || null;
            const machine = self.DispatchStateManager ? self.DispatchStateManager.get(llmName) : null;
            if (machine && machine.isInProgress && machine.isInProgress()) {
              machine.reset();
            }
            if (entry) {
              entry.dispatchInFlight = false;
              entry.messageSent = false;
              entry.dispatchState = 'IDLE';
              entry.csBusyUntil = 0;
            }
            await dispatchPromptToTab(llmName, tabId, resolvePromptForDispatch(llmName, jobState.prompt), jobState.attachments || [], 'round2_repair_pre_visit', {
              forceFocus: true,
              skipNoFocusProbe: true,
              deferSendMs: 250,
              skipSubmitWait: false,
              skipTypingGuard: true,
              resetStateAfterSend: false,
              recoveryIntent: 'resend_prompt'
            });
            const repairDispatchId = jobState?.llms?.[llmName]?.lastDispatchMeta?.dispatchId || previousDispatchId || null;
            const waitBudgetMs = Math.min(
              ROUND2_REPAIR_CONFIRM_WAIT_MS,
              Math.max(0, getRound2Timing().remainingMs - ROUND2_MODEL_MIN_REMAINING_MS)
            );
            const repairWait = await waitForRound2SubmitConfirmation(llmName, repairDispatchId, waitBudgetMs);
            emitTelemetry(llmName, 'ROUND2_REPAIR_CONFIRM_WAIT', {
              level: repairWait.ok ? 'info' : 'warning',
              details: `${repairWait.waitedMs}ms:${repairWait.reason}`,
              meta: {
                tabId,
                dispatchId: repairDispatchId,
                reason: 'repair_dispatch_pre_visit',
                confirmationReason: repairWait.reason,
                waitedMs: repairWait.waitedMs,
                ok: repairWait.ok
              },
              force: true
            });
          } catch (repairErr) {
            emitTelemetry(llmName, 'ROUND2_REPAIR_DISPATCH_ERROR', {
              level: 'warning',
              details: repairErr?.message || String(repairErr),
              meta: { tabId, reason: 'repair_dispatch_pre_visit_error' }
            });
          }
        }
        const repairedEntry = jobState?.llms?.[llmName] || entry;
        const repairConfirmation = getRound2SubmitConfirmationState(llmName, repairedEntry?.lastDispatchMeta?.dispatchId || null);
        const delayedConfirmation = isRound2DelayedConfirmationState(repairConfirmation);
        confirmedByContent = repairConfirmation.ok || (!!repairedEntry?.promptSubmittedAt && repairedEntry?.submitSource === 'content');
        emitTelemetry(llmName, confirmedByContent ? 'ROUND2_REPAIR_DISPATCH_OK' : (delayedConfirmation ? 'ROUND2_REPAIR_DISPATCH_PENDING' : 'ROUND2_REPAIR_DISPATCH_FAIL'), {
          level: confirmedByContent || delayedConfirmation ? 'info' : 'warning',
          details: confirmedByContent
            ? 'submit/evidence confirmed after pre-visit repair'
            : (delayedConfirmation ? 'submit confirmation still pending after pre-visit repair' : 'submit still not confirmed after pre-visit repair'),
          meta: {
            tabId,
            reason: confirmedByContent
              ? 'repair_confirmed_pre_visit'
              : (delayedConfirmation ? 'repair_pending_pre_visit' : 'repair_not_confirmed_pre_visit'),
            confirmationReason: repairConfirmation.reason
          },
          force: true
        });
        if (!confirmedByContent && delayedConfirmation) {
          await scheduleRound2DelayedConfirmationContinuation(
            llmName,
            tabId,
            sessionId,
            'round2_repair_delayed_confirmation',
            repairConfirmation
          );
          endDetails = 'awaiting delayed confirmation';
          endLevel = 'info';
          endMeta.reason = 'awaiting_delayed_confirmation_after_repair';
          endMeta.confirmationReason = repairConfirmation.reason;
          continue;
        }
        if (!confirmedByContent) {
          broadcastDiagnostic(llmName, {
            type: 'DISPATCH',
            label: 'ROUND2_VERIFY',
            details: 'prompt not confirmed after repair dispatch',
            level: 'warning',
            meta: { tabId, repairAttemptedBeforeVisit }
          });
          endDetails = 'prompt not confirmed';
          endLevel = 'warning';
          endMeta.reason = 'not_confirmed_after_repair';
          continue;
        }
        endDetails = 'prompt confirmed';
        endLevel = 'info';
        endMeta.reason = repairConfirmation.reason === 'answer_evidence'
          ? 'repair_answer_evidence_pre_visit'
          : 'repair_confirmed_pre_visit';
        const liveEntry = jobState?.llms?.[llmName];
        if (liveEntry && !isFinalizedEntry(liveEntry)) {
          await runPreCollectScrollNudge(llmName, tabId, sessionId, 'round2_repair_precollect');
          triggerResponseCollectionPing(llmName, tabId, 'round2_repair_probe');
          schedulePostR2AutoCollect(llmName, tabId, sessionId);
          scheduleAdaptiveCollectionProbe(llmName, sessionId, {
            reason: 'round2_repair_confirmed',
            source: 'adaptive_round2'
          });
        }
        continue;
      }
      const preVisitTiming = getRound2Timing();
      if (preVisitTiming.elapsedMs > round2BatchBudgetMs || preVisitTiming.remainingMs <= 0) {
        endDetails = 'verification skipped (batch timeout)';
        endLevel = 'warning';
        endMeta.reason = 'batch_timeout';
        await emitRound2CutoffFrom(index + 1, preVisitTiming);
        break;
      }
      const pendingModelsCount = Math.max(1, selectedLLMs.length - index);
      const safeRemainingMs = Math.max(0, preVisitTiming.remainingMs - 1000);
      const sharedSliceMs = Math.floor(safeRemainingMs / pendingModelsCount);
      const rawPerModelVisitBudgetMs = Math.max(0, sharedSliceMs);
      if (rawPerModelVisitBudgetMs < ROUND2_MODEL_MIN_REMAINING_MS) {
        endDetails = 'verification skipped (model budget)';
        endLevel = 'warning';
        endMeta.reason = 'model_budget_timeout';
        emitTelemetry(llmName, 'ROUND2_MODEL_BUDGET_SKIP', {
          level: 'warning',
          details: `${rawPerModelVisitBudgetMs}ms`,
          meta: {
            tabId,
            perModelVisitBudgetMs: rawPerModelVisitBudgetMs,
            pendingModelsCount,
            remainingMs: preVisitTiming.remainingMs
          }
        });
        continue;
      }
      const perModelVisitBudgetMs = Math.min(ROUND2_MODEL_VISIT_BUDGET_MS, rawPerModelVisitBudgetMs);
      const visitCount = perModelVisitBudgetMs >= (ROUND2_MODEL_MIN_DWELL_MS * 2 + 1000)
        ? Math.min(ROUND2_VISIT_COUNT, 2)
        : 1;
      const perVisitBudgetMs = Math.max(ROUND2_MODEL_MIN_DWELL_MS, Math.floor(perModelVisitBudgetMs / visitCount));
      const visitMaxMs = Math.max(ROUND2_MODEL_MIN_DWELL_MS, Math.min(ROUND2_VISIT_MAX_MS, perVisitBudgetMs));
      const visitMinMs = Math.max(
        ROUND2_MODEL_MIN_DWELL_MS,
        Math.min(ROUND2_VISIT_MIN_MS, Math.floor(visitMaxMs * 0.75))
      );
      emitTelemetry(llmName, 'ROUND2_MODEL_BUDGET', {
        details: `${perModelVisitBudgetMs}ms`,
        meta: {
          tabId,
          pendingModelsCount,
          remainingMs: preVisitTiming.remainingMs,
          visitCount,
          visitMinMs,
          visitMaxMs
        }
      });

      await runForcedAutomationVisits(llmName, tabId, sessionId, {
        visits: visitCount,
        minMs: visitMinMs,
        maxMs: visitMaxMs,
        reason: 'round2_verify'
      });
      const postVisitTiming = getRound2Timing();
      if (postVisitTiming.elapsedMs > ROUND2_BATCH_MAX_MS || postVisitTiming.remainingMs <= 0) {
        endDetails = 'verification skipped (batch timeout)';
        endLevel = 'warning';
        endMeta.reason = 'batch_timeout';
        await emitRound2CutoffFrom(index + 1, postVisitTiming);
        break;
      }
      if (!confirmedByContent && !repairAttemptedBeforeVisit && canRepairDispatchInRound2(llmName) && jobState?.prompt) {
        const repairIntentDecision = self.RecoveryIntent?.authorize
          ? self.RecoveryIntent.authorize(entry, {
            intent: 'resend_prompt',
            reason: 'round2_repair',
            minChars: DOM_SNAPSHOT_RECOVERY_MIN_CHARS
          })
          : { ok: true };
        if (!repairIntentDecision.ok) {
          emitTelemetry(llmName, 'ROUND2_REPAIR_DISPATCH_SKIPPED', {
            level: 'warning',
            details: repairIntentDecision.reason || 'recovery_intent_denied',
            meta: { tabId, reason: 'repair_dispatch', intentDecision: repairIntentDecision },
            force: true
          });
          broadcastDiagnostic(llmName, {
            type: 'DISPATCH',
            label: 'ROUND2 repair skipped',
            details: repairIntentDecision.reason || 'recovery_intent_denied',
            level: 'warning',
            meta: { tabId, intentDecision: repairIntentDecision }
          });
        } else {
          emitTelemetry(llmName, 'ROUND2_REPAIR_DISPATCH_START', {
            level: 'warning',
            details: 'prompt not confirmed after verify visits',
            meta: { tabId, reason: 'repair_dispatch' }
          });
          try {
            const previousDispatchId = entry?.lastDispatchMeta?.dispatchId || null;
            const machine = self.DispatchStateManager ? self.DispatchStateManager.get(llmName) : null;
            if (machine && machine.isInProgress && machine.isInProgress()) {
              machine.reset();
            }
            if (entry) {
              entry.dispatchInFlight = false;
              entry.messageSent = false;
              entry.dispatchState = 'IDLE';
              entry.csBusyUntil = 0;
            }
            await dispatchPromptToTab(llmName, tabId, resolvePromptForDispatch(llmName, jobState.prompt), jobState.attachments || [], 'round2_repair', {
              forceFocus: true,
              skipNoFocusProbe: true,
              deferSendMs: 500,
              skipSubmitWait: false,
              skipTypingGuard: true,
              resetStateAfterSend: false,
              recoveryIntent: 'resend_prompt'
            });
            const repairDispatchId = jobState?.llms?.[llmName]?.lastDispatchMeta?.dispatchId || previousDispatchId || null;
            const waitBudgetMs = Math.min(
              ROUND2_REPAIR_CONFIRM_WAIT_MS,
              Math.max(0, getRound2Timing().remainingMs - ROUND2_MODEL_MIN_REMAINING_MS)
            );
            const repairWait = await waitForRound2SubmitConfirmation(llmName, repairDispatchId, waitBudgetMs);
            emitTelemetry(llmName, 'ROUND2_REPAIR_CONFIRM_WAIT', {
              level: repairWait.ok ? 'info' : 'warning',
              details: `${repairWait.waitedMs}ms:${repairWait.reason}`,
              meta: {
                tabId,
                dispatchId: repairDispatchId,
                reason: 'repair_dispatch',
                confirmationReason: repairWait.reason,
                waitedMs: repairWait.waitedMs,
                ok: repairWait.ok
              },
              force: true
            });
          } catch (repairErr) {
            emitTelemetry(llmName, 'ROUND2_REPAIR_DISPATCH_ERROR', {
            level: 'warning',
            details: repairErr?.message || String(repairErr),
            meta: { tabId, reason: 'repair_dispatch_error' }
            });
          }
        }
        const repairedEntry = jobState?.llms?.[llmName] || entry;
        const repairConfirmation = getRound2SubmitConfirmationState(llmName, repairedEntry?.lastDispatchMeta?.dispatchId || null);
        const delayedConfirmation = isRound2DelayedConfirmationState(repairConfirmation);
        confirmedByContent = repairConfirmation.ok || (!!repairedEntry?.promptSubmittedAt && repairedEntry?.submitSource === 'content');
        if (confirmedByContent) {
          emitTelemetry(llmName, 'ROUND2_REPAIR_DISPATCH_OK', {
            details: 'submit/evidence confirmed after repair dispatch',
            meta: { tabId, reason: 'repair_confirmed', confirmationReason: repairConfirmation.reason }
          });
        } else if (delayedConfirmation) {
          emitTelemetry(llmName, 'ROUND2_REPAIR_DISPATCH_PENDING', {
            level: 'info',
            details: 'submit confirmation still pending',
            meta: { tabId, reason: 'repair_pending', confirmationReason: repairConfirmation.reason }
          });
        } else {
          emitTelemetry(llmName, 'ROUND2_REPAIR_DISPATCH_FAIL', {
            level: 'warning',
            details: 'submit still not confirmed',
            meta: { tabId, reason: 'repair_not_confirmed', confirmationReason: repairConfirmation.reason }
          });
        }
      }
      if (!confirmedByContent) {
        const delayedState = getRound2SubmitConfirmationState(llmName, entry?.lastDispatchMeta?.dispatchId || null);
        if (isRound2DelayedConfirmationState(delayedState)) {
          await scheduleRound2DelayedConfirmationContinuation(
            llmName,
            tabId,
            sessionId,
            'round2_delayed_confirmation',
            delayedState
          );
          endDetails = 'awaiting delayed confirmation';
          endLevel = 'info';
          endMeta.reason = 'awaiting_delayed_confirmation';
        } else {
          broadcastDiagnostic(llmName, {
            type: 'DISPATCH',
            label: 'ROUND2_VERIFY',
            details: 'prompt not confirmed as sent yet',
            level: 'warning'
          });
          emitTelemetry(llmName, 'ROUND2_VERIFY', {
            details: 'prompt not confirmed',
            meta: { tabId, reason: 'not_confirmed', confirmationReason: delayedState.reason }
          });
          endDetails = 'prompt not confirmed';
          endLevel = 'warning';
          endMeta.reason = 'not_confirmed';
        }
      } else {
        endDetails = 'prompt confirmed';
        endLevel = 'info';
        endMeta.reason = 'confirmed';
      }

      const liveEntry = jobState?.llms?.[llmName];
      if (liveEntry && !isFinalizedEntry(liveEntry) && (liveEntry.promptSubmittedAt || endMeta.reason === 'awaiting_delayed_confirmation' || hasRound2SubmitOrAnswerEvidence(liveEntry))) {
        await runPreCollectScrollNudge(llmName, tabId, sessionId, 'round2_precollect');
        triggerResponseCollectionPing(llmName, tabId, 'round2_probe');
        schedulePostR2AutoCollect(llmName, tabId, sessionId);
        scheduleAdaptiveCollectionProbe(llmName, sessionId, {
          reason: 'round2_confirmed',
          source: 'adaptive_round2'
        });
      }
    } finally {
      emitModelRoundTelemetry(llmName, 2, 'END', endDetails, {
        level: endLevel,
        meta: endMeta
      });
    }
  }
  return true;
}

//-- 2.1. Round 3: сбор ответов только с незавершённых вкладок --//
async function dispatchRound3CollectAnswers(selectedLLMs, sessionId) {
  const terminalModels = selectedLLMs.filter((llmName) => {
    const entry = jobState?.llms?.[llmName];
    return entry && isFinalizedEntry(entry);
  });
  terminalModels.forEach((llmName) => {
    const entry = jobState?.llms?.[llmName];
    if (!entry) return;
    const tabId = resolveBoundTabIdForOrchestrator(llmName, entry);
    emitModelRoundTelemetry(llmName, 3, 'START', 'skipped (already complete)', {
      level: 'info',
      meta: { tabId, reason: 'terminal' }
    });
    emitModelRoundTelemetry(llmName, 3, 'END', 'skipped (already complete)', {
      level: 'info',
      meta: { tabId, reason: 'terminal' }
    });
  });

  const incompleteModels = selectedLLMs.filter((llmName) => {
    const entry = jobState?.llms?.[llmName];
    if (!entry) return false;
    return !isFinalizedEntry(entry);
  });
  
  globalThis.LLMLog?.debug?.(`[ROUND3] Collecting from ${incompleteModels.length}/${selectedLLMs.length} incomplete models`);
  emitTelemetry('ROUND3', 'COLLECTION_START', {
    details: `${incompleteModels.length} incomplete`,
    meta: { incomplete: incompleteModels, total: selectedLLMs.length }
  });
  
  for (const llmName of incompleteModels) {
    if (sessionId && !isSessionActive(sessionId)) return false;
    
    const entry = jobState.llms[llmName];
    const tabId = resolveBoundTabIdForOrchestrator(llmName, entry);
    if (!isValidTabId(tabId)) continue;
    
    emitModelRoundTelemetry(llmName, 3, 'START', 'collecting answer', {
      meta: { tabId }
    });
    startBudgetPhase(llmName, 'collect', null, { tabId });
    await runForcedAutomationVisits(llmName, tabId, sessionId, {
      visits: ROUND3_PRECOLLECT_VISIT_COUNT,
      minMs: ROUND3_PRECOLLECT_VISIT_MIN_MS,
      maxMs: ROUND3_PRECOLLECT_VISIT_MAX_MS,
      reason: 'round3_precollect'
    });
    const afterVisitEntry = jobState?.llms?.[llmName];
    if (!afterVisitEntry || isFinalizedEntry(afterVisitEntry)) {
      emitModelRoundTelemetry(llmName, 3, 'END', 'terminal after visit', {
        meta: { tabId, reason: 'terminal_after_visit' }
      });
      endBudgetPhase(llmName, 'collect');
      continue;
    }
    await runPreCollectScrollNudge(llmName, tabId, sessionId, 'round3_precollect');
    triggerResponseCollectionPing(llmName, tabId, 'round3_collect');
    scheduleAdaptiveCollectionProbe(llmName, sessionId, {
      reason: 'round3_collect',
      source: 'adaptive_round3'
    });
    emitModelRoundTelemetry(llmName, 3, 'END', 'collection visit', {
      meta: { tabId }
    });
    endBudgetPhase(llmName, 'collect');
  }
  
  return true;
}

//-- 3.1. Исправленное расписание: Round 0-1-2-3-4 с правильным порядком --//
//-- 6.1. Флаг активности Rounds для защиты от supervisor --//
async function runDispatchRounds(selectedLLMs, prompt, forceNewTabs, attachments = [], options = {}) {
  self.__dispatchRoundsRuntimeActive = true;
  const sessionId = getActiveSessionId();
  let bootstrapSignalled = false;
  const signalBootstrap = (result = true) => {
    if (bootstrapSignalled) return;
    bootstrapSignalled = true;
    try { options.onBootstrapComplete?.(result); } catch (_) {}
  };
  const markRoundPhase = async (phase) => {
    if (!jobState?.session) return;
    jobState.session.roundPhase = phase;
    await saveJobState(jobState);
  };
  try {
    // Устанавливаем флаг активности Rounds
    if (jobState?.session) {
      jobState.session.roundsInProgress = true;
    }
    await markRoundPhase('round0');
    const roundMetaBase = {
      sessionId,
      totalModels: selectedLLMs.length
    };
    const emitRoundEvent = (round, phase, details = '', meta = {}) => {
      emitTelemetry('ROUNDS', `ROUND${round}_${phase}`, {
        details,
        meta: { round, ...roundMetaBase, ...meta },
        force: true
      });
    };
    
      emitRoundEvent(0, 'START', 'opening tabs sequentially');
      // Round 0: Последовательное открытие вкладок (пауза 2с между вкладками)
      await openTabsSequentially(selectedLLMs, prompt, forceNewTabs, attachments, sessionId, options);
      if (sessionId && !isSessionActive(sessionId)) return;
      emitRoundEvent(0, 'END', 'tabs acquired; readiness is checked per model', {
        totalModels: selectedLLMs.length,
        readinessMode: 'per_model_dispatch_gate'
      });
      
      ensureRoundEntries(selectedLLMs, 'pre_round1');
      await markRoundPhase('round1');
      emitRoundEvent(1, 'START', 'dispatching prompts sequentially');
      // Round 1: 2 seconds before the command, 5 seconds after it, in model order.
      await dispatchRound1Sequentially(selectedLLMs, prompt, attachments, sessionId, options);
    if (sessionId && !isSessionActive(sessionId)) return;
    emitRoundEvent(1, 'END', 'dispatch round complete');
    signalBootstrap(true);

    ensureRoundEntries(selectedLLMs, 'pre_round2');
    await markRoundPhase('round2');
    
    emitRoundEvent(2, 'START', 'verifying prompts');
    // Round 2: Верификация отправки (10с на каждой вкладке)
    await dispatchRound2Verification(selectedLLMs, sessionId);
    if (sessionId && !isSessionActive(sessionId)) return;
    emitRoundEvent(2, 'END', 'verification complete');
    
    emitRoundEvent(3, 'START', 'collect delay');
    await markRoundPhase('round3');
    // Round 3: Сбор ответов (только незавершённые вкладки)
    await orchestratorSleepMs(ROUND3_COLLECT_DELAY_MS);
    emitRoundEvent(3, 'COLLECT_DELAY_END', 'collect delay elapsed');
    if (sessionId && !isSessionActive(sessionId)) return;
    emitRoundEvent(3, 'COLLECT_START', 'collecting incomplete answers', {
      pending: selectedLLMs.length
    });
    await dispatchRound3CollectAnswers(selectedLLMs, sessionId);
    emitRoundEvent(3, 'END', 'collection complete');
    if (sessionId && !isSessionActive(sessionId)) return;

    const trackedModels = resolveRoundModelNames(selectedLLMs);
    await runAutomaticGetItPass(selectedLLMs, sessionId);
    if (sessionId && !isSessionActive(sessionId)) return;
    await markRoundPhase('round4');
    const pendingBeforeGate = getPendingRoundModels(trackedModels);
    emitRoundEvent(4, 'GATE_START', 'waiting pending models', {
      pendingModels: pendingBeforeGate
    });
    const gateResult = await waitForRound4Gate(trackedModels, sessionId);
    if (sessionId && !isSessionActive(sessionId)) return;
    emitRoundEvent(4, 'GATE_END', gateResult.timedOut ? 'gate timeout forced finalization' : 'all models finalized', {
      pendingBefore: gateResult.pendingBefore || [],
      pendingAfter: gateResult.pendingAfter || [],
      timedOut: !!gateResult.timedOut
    });

    const pendingAfterGate = getPendingRoundModels(trackedModels);
    if (pendingAfterGate.length) {
      emitRoundEvent(4, 'SKIP', 'results focus skipped (pending models remain)', {
        pendingModels: pendingAfterGate
      });
    } else {
      emitRoundEvent(4, 'START', 'focusing results tab');
      selectedLLMs.forEach((llmName) => {
        const entry = jobState?.llms?.[llmName];
        emitModelRoundTelemetry(
          llmName,
          4,
          'START',
          isFinalizedEntry(entry) ? 'skipped (already complete)' : 'focusing results tab',
          { meta: { reason: isFinalizedEntry(entry) ? 'terminal' : 'results_focus' } }
        );
      });
      await orchestratorSleepMs(ROUND4_FOCUS_DELAY_MS);
      await openOrFocusResultsTab().catch(() => {});
      selectedLLMs.forEach((llmName) => {
        const entry = jobState?.llms?.[llmName];
        emitModelRoundTelemetry(
          llmName,
          4,
          'END',
          isFinalizedEntry(entry) ? 'skipped (already complete)' : 'results tab focused',
          { meta: { reason: isFinalizedEntry(entry) ? 'terminal' : 'results_focus' } }
        );
      });
      emitRoundEvent(4, 'END', 'results tab focused');
    }
    
    // Запускаем supervisor и human presence ПОСЛЕ всех rounds
    //-- 5.0. Rounds больше не владеют фокусом вкладок: снимаем флаг до старта
    // human presence, иначе цикл визитов будет отложен своим же охранником.
    if (jobState?.session?.roundsInProgress) {
      jobState.session.roundsInProgress = false;
      saveJobState(jobState);
    }
    schedulePromptDispatchSupervisor();
    if (hasPendingHumanVisits()) {
      scheduleHumanPresenceLoop(true);
    }
    
    //-- 5.1. Диагностика: проверяем пропущенные модели --//
    let missingModelsTimer = null;
    missingModelsTimer = registerSessionTimer(setTimeout(() => {
      deregisterSessionTimer(missingModelsTimer);
      if (sessionId && !isSessionActive(sessionId)) return;
      if (!jobState?.llms || !Array.isArray(selectedLLMs) || !selectedLLMs.length) return;
      ensureRoundEntries(selectedLLMs, 'post_round_integrity_check');
      const allModels = selectedLLMs;
      const activeModels = Object.keys(jobState?.llms || {});
      const missingModels = allModels.filter(name => !activeModels.includes(name));
      
      if (missingModels.length > 0) {
        console.error(`[ROUNDS] Missing models detected: ${missingModels.join(', ')}`);
        const integritySnapshot = (() => {
          const bindings = {};
          Object.keys(jobState?.llms || {}).forEach((name) => {
            const entry = jobState.llms[name] || {};
            bindings[name] = {
              tabId: entry.tabId || null,
              status: entry.status || null,
              dispatchId: entry?.lastDispatchMeta?.dispatchId || null
            };
          });
          return {
            runSessionId: jobState?.session?.startTime || null,
            roundsInProgress: !!jobState?.session?.roundsInProgress,
            promptLength: String(jobState?.prompt || '').length,
            bindings,
            sessionTimers: sessionTimers?.size || 0
          };
        })();
        missingModels.forEach(llmName => {
          emitTelemetry(llmName, 'MODEL_MISSING', {
            level: 'error',
            details: 'Model not found in jobState after rounds',
            meta: { allModels, activeModels, missingModels, snapshot: integritySnapshot }
          });
          
          // Пытаемся восстановить пропущенную модель
          if (!jobState.llms[llmName]) {
            jobState.llms[llmName] = buildInitialLlmEntry(llmName, {
              status: 'RECOVERY_PENDING'
            });
            
            // Запускаем восстановление
            //-- 1.1. Recovery НЕ создаёт новые вкладки --//
            startModelForLLM(llmName, prompt, false, attachments, { 
              sessionId: getActiveSessionId() 
            }).catch(err => {
              console.error(`[RECOVERY] Failed to recover ${llmName}:`, err);
            });
          }
        });
      }
    }, 5000)); // Проверка через 5 секунд после завершения rounds


  } catch (err) {
    console.error('[BACKGROUND] Round sequencing failed:', err);
    // The retry supervisor must never invent attempt #1 for models that Round 1
    // did not reach. Keep initial-dispatch ownership here and resume only the
    // untouched tail, sequentially, under the existing roundsInProgress guard.
    const untouchedModels = (Array.isArray(selectedLLMs) ? selectedLLMs : []).filter((llmName) => {
      const entry = jobState?.llms?.[llmName];
      return entry && Number(entry.dispatchAttempts || 0) === 0 && !entry.lastDispatchMeta?.dispatchId;
    });
    if (untouchedModels.length && (!sessionId || isSessionActive(sessionId))) {
      emitTelemetry('ROUNDS', 'ROUND1_RECOVERY_RESUME', {
        level: 'warning',
        details: err?.message || String(err),
        meta: { sessionId, untouchedModels },
        force: true
      });
      try {
        await dispatchRound1Sequentially(
          untouchedModels,
          prompt,
          attachments,
          sessionId,
          { ...options, resume: true }
        );
      } catch (resumeErr) {
        console.error('[BACKGROUND] Round 1 recovery resume failed:', resumeErr);
      }
    }
    schedulePromptDispatchSupervisor();
  } finally {
    signalBootstrap(false);
    self.__dispatchRoundsRuntimeActive = false;
    //-- 6.2. Снимаем флаг активности Rounds --//
    if (jobState?.session) {
      jobState.session.roundsInProgress = false;
      jobState.session.roundPhase = null;
      saveJobState(jobState);
    }
  }
}

function collectResponses() {
  globalThis.LLMLog?.debug?.('[BACKGROUND] Collecting responses');
  Object.keys(jobState.llms).forEach(llmName => {
    const entry = jobState.llms[llmName];
    const flags = self.getDispatchFlags ? self.getDispatchFlags(llmName, entry) : null;
    const alreadySent = flags ? flags.isSent : !!entry.messageSent;
    const boundTabId = resolveBoundTabIdForOrchestrator(llmName, entry);
    if (boundTabId && !alreadySent) {
      dispatchPromptToTab(llmName, boundTabId, resolvePromptForDispatch(llmName, jobState.prompt), jobState.attachments || [], 'collect_responses');
    }
  });
  broadcastHumanVisitStatus();
  if (hasPendingHumanVisits()) {
    scheduleHumanPresenceLoop(true);
  }
}

async function collectResponsesStaged() {
  try {
    const tabs = await chrome.tabs.query({ url: [
      'https://chat.openai.com/*', 'https://chatgpt.com/*', 'https://claude.ai/*',
      'https://gemini.google.com/*', 'https://grok.com/*', 'https://chat.deepseek.com/*',
      'https://www.perplexity.ai/*', 'https://chat.qwen.ai/*', 'https://chat.mistral.ai/*',
      'https://chat.z.ai/*'
    ], audible: false });
    const active = await chrome.tabs.query({ active: true, currentWindow: true });
    const activeId = active?.[0]?.id;
    const foreground = tabs.filter(t => t.id === activeId);
    const background = tabs.filter(t => t.id !== activeId);

    const inferLlmNameForCollectTab = (tab) => {
      if (!tab?.id) return null;
      const mapped = TabMapManager.getNameByTabId(tab.id);
      if (mapped) return mapped;
      return Object.keys(LLM_TARGETS || {}).find((name) => isEligibleTabForLlm(name, tab)) || null;
    };
    const results = [];
    const collectOne = async (tab) => {
      const tabId = tab?.id || null;
      const llmName = inferLlmNameForCollectTab(tab);
      if (!tabId || !llmName) {
        return { tabId, platform: 'unknown', text: '', error: 'llm_not_resolved' };
      }
      const meta = {
        source: 'collect_responses_staged_late_collect',
        runSessionId: getCurrentRunSessionId(),
        sessionId: getCurrentRunSessionId(),
        dispatchId: resolveLateCollectDispatchId(llmName),
        responseMeta: {
          source: 'collect_responses_staged_late_collect',
          completionReason: 'user_collect_late_collect',
          lateCollectFinal: true,
          forceTerminalSuccess: true
        }
      };
      const result = await lateCollectAnswer({
        llmName,
        tabId,
        reason: 'collect_responses_staged',
        meta
      });
      if (result?.ok && result.text) {
        acceptLateCollectResult(llmName, result, meta);
        return {
          tabId,
          platform: llmName,
          sessionId: meta.sessionId,
          text: result.text,
          source: result.source || 'late_collect',
          status: result.status || 'success'
        };
      }
      return {
        tabId,
        platform: llmName,
        sessionId: meta.sessionId,
        text: '',
        error: result?.reason || result?.status || 'late_collect_failed'
      };
    };

    for (const t of foreground) {
      if (t.id) results.push(await collectOne(t));
    }
    const bgPromises = background.filter(t => t.id).map(t => collectOne(t));
    const bgResults = await Promise.all(bgPromises);
    results.push(...bgResults);
    return results;
  } catch (err) {
    console.warn('[BACKGROUND] collectResponsesStaged failed', err);
    return [];
  }
}

function resolveModelFinalStatus(finalStatus, finalReason, error) {
  const normalized = String(finalStatus || '').toUpperCase();
  const errorType = error?.type || finalReason;
  if (errorType === 'user_cancel') return 'CANCELLED';
  if (normalized === 'SUCCESS') return 'SUCCESS';
  if (['PARTIAL', 'STREAM_TIMEOUT', 'STREAM_TIMEOUT_HIDDEN'].includes(normalized)) return 'PARTIAL';
  if (FAILURE_STATUSES.includes(normalized)) return normalized;
  return 'ERROR';
}

function resolveModelDoneReason({ completionReason, finalStatus, finalReason, error }) {
  const errorType = error?.type || null;
  if (errorType === 'user_cancel') return 'user_cancel';
  const normalizedFinal = String(finalStatus || '').toLowerCase();
  if (['stream_timeout', 'stream_timeout_hidden'].includes(normalizedFinal)) return 'timeout';
  const reason = completionReason ? String(completionReason).toLowerCase() : '';
  if (normalizedFinal === 'success') {
    if (['all_terminal_facts_proven', 'success_terminal'].includes(reason)) return 'completion_authority';
    if (reason.includes('manual_ping') || reason.includes('recovery')) return 'recovery';
    return 'success';
  }
  if (['hard_timeout', 'soft_timeout', 'stream_start_timeout', 'streaming_incomplete'].includes(reason)) {
    return 'timeout';
  }
  if (['content_mutation_stable', 'score_threshold', 'criteria_met'].includes(reason)) {
    return 'stabilization';
  }
  if (['regenerate_visible', 'completion_signal', 'stop_disappeared'].includes(reason)) {
    return 'ui';
  }
  if (reason === 'hard_stop') return 'user_cancel';
  if (errorType || finalReason) return 'error';
  return 'unknown';
}

function classifyFailure(error = null, context = {}) {
  const responseMeta = context.responseMeta && typeof context.responseMeta === 'object' ? context.responseMeta : {};
  const explicitClass = String(responseMeta.failureClass || context.failureClass || '').trim().toLowerCase();
  const allowedClasses = new Set(['transport', 'lease_lifecycle', 'page_readiness', 'dispatch', 'generation', 'extraction', 'semantic', 'external_llm', 'unknown']);
  const rawType = String(error?.type || context.errorType || context.finalReason || '').trim();
  const type = rawType.toLowerCase();
  const message = String(error?.message || context.message || '').toLowerCase();
  const reason = String(context.finalReason || responseMeta.completionReason || responseMeta.answerReason || '').toLowerCase();
  const source = String(responseMeta.source || responseMeta.answerSource || context.responseSource || '').toLowerCase();
  const haystack = [type, message, reason, source].filter(Boolean).join(' ');
  const result = (failureClass, recoveryFirst = true, terminalRequiresEvidenceMiss = true) => ({
    class: failureClass,
    type: rawType || null,
    reason: context.finalReason || error?.message || rawType || null,
    source: responseMeta.source || responseMeta.answerSource || context.responseSource || null,
    recoveryFirst: !!recoveryFirst,
    terminalRequiresEvidenceMiss: !!terminalRequiresEvidenceMiss
  });

  if (explicitClass && allowedClasses.has(explicitClass)) {
    return result(explicitClass, explicitClass !== 'semantic', true);
  }
  if (!error && context.isSuccess) return result('unknown', false, false);
  if (!error && !rawType && !haystack) return result('unknown', false, false);

  if (
    /transport|message_channel|message channel|message port|port closed|receiving end|connection|could not establish|ping_transport|runtime\.lasterror/.test(haystack)
  ) {
    return result('transport', true, true);
  }
  if (
    /script_runtime_hard_stop|background-force-stop|force_stop|tab_closed|tab closed|lifecycle|concurrent_request|request already running/.test(haystack)
  ) {
    return result('lease_lifecycle', true, true);
  }
  if (
    /wrong_page|page_ready|page readiness|login|required_login|auth_required|captcha|tab_not_ready|ack_timeout|handshake_timeout|script_not_ready/.test(haystack)
  ) {
    return result('page_readiness', true, true);
  }
  if (
    /send_failed|send_payload_mismatch|send_payload_unverified|no_send|submit_timeout|prompt_submit|prompt_submitted_timeout|dispatch_error|dispatch_send|tab reference|tab not found|circuit_open/.test(haystack)
  ) {
    return result('dispatch', true, true);
  }
  if (
    /hard_timeout|soft_timeout|stream_start_timeout|streaming_incomplete|generation|busy|stop_visible|content_growing/.test(haystack)
  ) {
    return result('generation', true, true);
  }
  if (
    /extract_failed|empty_answer|answer_element_missing|no_answer_extracted|selector|late_collect_failed|answer_missing/.test(haystack)
  ) {
    return result('extraction', true, true);
  }
  if (
    /provider_error|provider_error_surface|model_unavailable|rate_limit|rate limit|external_llm|external llm|overload|overloaded|high_demand|unable_to_respond/.test(haystack)
  ) {
    return result('external_llm', true, true);
  }
  if (
    /answer_prompt_echo|prompt_echo|status text|non-answer|policy|blocked|semantic/.test(haystack)
  ) {
    return result('semantic', false, true);
  }
  return result('unknown', true, true);
}

function deriveFailureFinalStatus(error = null, sendConfirmed = null, failure = null) {
  const type = String(error?.type || failure?.type || '').toLowerCase();
  const failureClass = String(failure?.class || '').toLowerCase();
  const reason = String(error?.message || failure?.reason || '').toLowerCase();
  const haystack = [type, failureClass, reason].filter(Boolean).join(' ');
  if (/auth_required|continue_required|login|required_login|captcha|wrong_page|conversation_limit|unsafe_prompt_modal|attachment_failed|attachment_unavailable/.test(haystack)) return 'USER_ACTION_REQUIRED';
  if (/provider_error|provider_error_surface|model_unavailable|rate_limit|rate limited|external_llm|external llm|api_failed|overload|overloaded|high_demand|unable_to_respond/.test(haystack)) return 'EXTERNAL_LLM_FAILURE';
  if (sendConfirmed === false) return 'NO_SEND';
  if (['send_failed', 'send_payload_mismatch', 'send_payload_unverified', 'no_send'].includes(type)) return 'NO_SEND';
  if (failureClass === 'dispatch' && /send|submit|dispatch|no_send/.test(type)) return type === 'no_send' || /send|submit/.test(type) ? 'NO_SEND' : 'ERROR';
  if (['extract_failed', 'empty_answer', 'answer_element_missing', 'answer_prompt_echo', 'answer_ui_noise'].includes(type)) return 'EXTRACT_FAILED';
  if (['extraction', 'semantic'].includes(failureClass) && !/^rate_limit|captcha/.test(type)) return 'EXTRACT_FAILED';
  if (type === 'stream_start_timeout' || type === 'automation_deadline') return 'STREAM_TIMEOUT';
  if (failureClass === 'generation' && /stream_start_timeout|automation_deadline/.test(type)) return 'STREAM_TIMEOUT';
  if (failureClass === 'unknown' || type === 'unknown_state' || type === 'uncertain') return 'UNCERTAIN';
  return 'ERROR';
}

function buildDontAnswerDisplayText(llmName) {
  const name = String(llmName || 'LLM').trim() || 'LLM';
  return `${name} don't answer`;
}

function shouldDisplayDontAnswerMessage(error = null, failure = null, finalStatus = '') {
  const status = String(finalStatus || '').toUpperCase();
  const type = String(error?.type || failure?.type || '').toLowerCase();
  const reason = String(error?.message || failure?.reason || '').toLowerCase();
  const klass = String(failure?.class || '').toLowerCase();
  const haystack = [type, reason, klass].filter(Boolean).join(' ');
  return status === 'EXTERNAL_LLM_FAILURE'
    && /answer_provider_error|provider_error|provider_error_surface|model_unavailable|rate_limit|rate limited|external_llm|external llm|overload|overloaded|high_demand|unable_to_respond/.test(haystack);
}


function normalizeEvidenceText(value = '') {
  return String(value || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function hashEvidenceText(value = '') {
  if (self.AnswerProofNormalization?.hashText) return self.AnswerProofNormalization.hashText(value);
  const text = String(value || '');
  let hash = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16);
}

function expectedAnswerCardId(llmName = '') {
  return `panel-${String(llmName || '').toLowerCase().replace(/[^a-z0-9]+/g, '')}`;
}

function commitAcceptedAnswer(llmName, entry, answerText, answerHtml, context = {}) {
  if (!entry) return null;
  const dispatchId = context.dispatchId || entry?.lastDispatchMeta?.dispatchId || null;
  const attemptId = context.attemptId || context.sourceRevisionId || null;
  const proof = self.AnswerProofNormalization?.evidence?.(answerText, { dispatchId, attemptId }) || null;
  const previousProof = self.AnswerProofNormalization?.evidence?.(entry.answer || '', {
    dispatchId,
    attemptId: entry.answerCommitEvidence?.attemptId || 'previous'
  }) || null;
  const overwrite = Boolean(previousProof?.normalizedHash && proof?.normalizedHash
    && previousProof.normalizedHash !== proof.normalizedHash);
  const commitKey = [dispatchId, attemptId, proof?.normalizedHash, context.outcome || 'accepted'].join('|');
  entry.answer = answerText;
  entry.answerHtml = answerHtml;
  const commit = {
    dispatchId,
    attemptId,
    payloadEvidenceId: proof?.payloadEvidenceId || context.payloadEvidenceId || null,
    normalizationVersion: proof?.normalizationVersion || context.normalizationVersion || null,
    normalizedLength: proof?.normalizedLength ?? String(answerText || '').length,
    normalizedHash: proof?.normalizedHash || context.normalizedHash || null,
    outcome: context.outcome || 'accepted',
    overwrite,
    previousNormalizedLength: previousProof?.normalizedLength ?? 0,
    previousNormalizedHash: previousProof?.normalizedHash || null,
    expectedCardId: expectedAnswerCardId(llmName),
    committedAt: Date.now()
  };
  entry.answerCommitEvidence = commit;
  if (entry.lastAnswerCommitTelemetryKey !== commitKey) {
    entry.lastAnswerCommitTelemetryKey = commitKey;
    emitTelemetry(llmName, 'ANSWER_COMMIT_EVALUATED', {
      level: 'success',
      details: overwrite ? 'overwrite' : 'accepted',
      meta: commit,
      force: true
    });
  }
  return commit;
}
self.commitAcceptedAnswer = commitAcceptedAnswer;

function isPromptEchoAnswerCandidate(answerText = '', promptText = '') {
  const answer = normalizeEvidenceText(answerText);
  const prompt = normalizeEvidenceText(promptText);
  if (!answer || !prompt || prompt.length < 80) return false;
  if (answer === prompt) return true;
  if (answer.includes(prompt) && answer.length <= prompt.length + 180) return true;
  const promptHead = prompt.slice(0, Math.min(prompt.length, 240));
  if (promptHead.length >= 80 && answer.startsWith(promptHead)) return true;
  const limit = Math.min(prompt.length, answer.length);
  let overlap = 0;
  for (let i = 0; i < limit; i += 1) {
    if (answer[i] !== prompt[i]) break;
    overlap += 1;
  }
  return overlap >= Math.min(limit, Math.floor(prompt.length * 0.9));
}

function buildAnswerCandidate(llmName, entry, context = {}) {
  const text = String(context.trimmedAnswer || context.answer || '').trim();
  const responseMeta = context.responseMeta && typeof context.responseMeta === 'object' ? context.responseMeta : {};
  const metaObj = context.metaObj && typeof context.metaObj === 'object' ? context.metaObj : {};
  const dispatchId = context.dispatchId || metaObj.dispatchId || entry?.lastDispatchMeta?.dispatchId || null;
  return {
    llmName,
    text,
    html: String(context.normalizedHtml || context.answerHtml || ''),
    length: text.length,
    hash: text ? hashEvidenceText(text) : null,
    status: String(context.finalStatus || '').toUpperCase(),
    reason: context.finalReason || null,
    source: responseMeta?.source || responseMeta?.answerSource || context.responseSource || null,
    dispatchId,
    tabId: entry?.tabId || null,
    runSessionId: jobState?.session?.startTime || null,
    manualRecovery: Boolean(metaObj.manualRecovery || responseMeta.manualRecovery || responseMeta.manualOverride),
    preFinalRecovery: Boolean(metaObj.preTerminalMaterializeFinal || metaObj.preTerminalMaterialize || responseMeta.preTerminalMaterialize),
    promptEcho: isPromptEchoAnswerCandidate(text, jobState?.prompt || ''),
    answerEvidence: context.answerEvidence || responseMeta.answerEvidence || null,
    createdAt: Date.now()
  };
}

function evaluateAnswerCandidate(llmName, entry, candidate = {}, context = {}) {
  const evidence = buildFinalizationEvidence(llmName, entry, {
    ...context,
    trimmedAnswer: candidate.text || context.trimmedAnswer || '',
    finalStatus: candidate.status || context.finalStatus,
    finalReason: candidate.reason || context.finalReason,
    responseSource: candidate.source || context.responseSource
  });
  return {
    candidate,
    evidence,
    accepted: !!evidence.accepted,
    rejectionReasons: evidence.accepted ? [] : (evidence.contradictions || ['candidate_rejected'])
  };
}

function submitAnswerCandidate(llmName, entry, candidate = {}, context = {}) {
  const evaluation = evaluateAnswerCandidate(llmName, entry, candidate, context);
  if (entry) {
    self.AnswerVerification?.appendRevision?.(entry, {
      text: candidate.text || '', hash: candidate.hash || null, length: candidate.length || 0,
      channel: candidate.source || context.responseSource || 'background_candidate',
      decision: evaluation.accepted ? 'accepted' : 'rejected',
      reason: evaluation.accepted ? null : evaluation.rejectionReasons.join(','),
      dispatchId: candidate.dispatchId || null, runSessionId: candidate.runSessionId || null,
      turnAnchor: entry.preDispatchAnswerNodeCount ?? entry.anchorAnswerCount ?? entry.baselineAnswerCount ?? null,
      verified: evaluation.evidence?.answerVerified === true
    });
    self.AnswerVerification?.appendTimeline?.(entry, {
      stage: 'extraction', state: evaluation.accepted ? 'candidate_accepted' : 'candidate_rejected',
      dispatchId: candidate.dispatchId || null, source: candidate.source || context.responseSource || 'background_candidate',
      details: { length: candidate.length || 0, verified: evaluation.evidence?.answerVerified === true,
        reasons: evaluation.rejectionReasons.join(',') }
    });
    entry.lastAnswerCandidate = {
      llmName,
      status: candidate.status || null,
      reason: candidate.reason || null,
      source: candidate.source || null,
      dispatchId: candidate.dispatchId || null,
      tabId: candidate.tabId || null,
      length: candidate.length || 0,
      hash: candidate.hash || null,
      promptEcho: !!candidate.promptEcho,
      answerEvidence: candidate.answerEvidence || context.answerEvidence || null,
      accepted: !!evaluation.accepted,
      rejectionReasons: evaluation.rejectionReasons,
      createdAt: candidate.createdAt || Date.now()
    };
  }
  const candidateStatus = String(candidate.status || context.finalStatus || '').toUpperCase();
  const transition = evaluation.accepted
    ? (FAILURE_STATUSES.includes(candidateStatus) ? 'TERMINAL_FAILURE' : 'ANSWER_CANDIDATE_ACCEPTED')
    : 'ANSWER_CANDIDATE_REJECTED';
  if (entry && (self.commitModelRunTransition || self.ModelRunState?.applyModelRunTransition)) {
    const payload = {
      status: candidate.status || context.finalStatus,
      reason: candidate.reason || context.finalReason,
      answerLength: candidate.length || 0,
      answerHash: candidate.hash || null,
      dispatchId: candidate.dispatchId || null,
      tabId: candidate.tabId || null,
      runSessionId: candidate.runSessionId || jobState?.session?.startTime || null,
      manualRecovery: !!candidate.manualRecovery,
      verified: evaluation.evidence?.answerVerified === true,
      allowTerminalUpgrade: !!context.allowTerminalUpgrade,
      source: candidate.source || context.responseSource || 'submitAnswerCandidate'
    };
    if (self.commitModelRunTransition) {
      self.commitModelRunTransition(llmName, entry, transition, payload);
    } else {
      self.ModelRunState.applyModelRunTransition(entry, transition, payload);
    }
  }
  return evaluation;
}

function recordPipelineAnswerVerification(llmName, verification = {}, sender = {}) {
  const entry = jobState?.llms?.[llmName];
  if (!entry || !verification || typeof verification !== 'object') return false;
  const dispatchId = entry.confirmedDispatchId || entry.lastDispatchMeta?.dispatchId || null;
  const incomingIdentity = {
    runSessionId: verification.runSessionId ?? null,
    dispatchId: verification.dispatchId ?? null,
    generationEpoch: verification.generationEpoch ?? null,
    turnAnchor: verification.turnAnchor ?? null
  };
  const currentIdentity = {
    runSessionId: jobState?.session?.startTime || null,
    dispatchId,
    generationEpoch: Number(entry.generationEpoch || 0) || null,
    turnAnchor: entry.preDispatchAnswerNodeCount ?? entry.anchorAnswerCount ?? entry.baselineAnswerCount ?? null
  };
  const identityCheck = self.AnswerVerification?.compareIdentity?.(currentIdentity, incomingIdentity, { strict: true })
    || { ok: false, missing: ['identity_contract_unavailable'], mismatched: [] };
  const senderMatches = !sender?.tab?.id || !entry.tabId || Number(sender.tab.id) === Number(entry.tabId);
  const verified = verification.verified === true && identityCheck.ok && senderMatches;
  const identityReasons = [
    ...(identityCheck.missing || []).map((key) => `identity_missing:${key}`),
    ...(identityCheck.mismatched || []).map((key) => `identity_mismatch:${key}`),
    ...(senderMatches ? [] : ['identity_mismatch:tabId'])
  ];
  const recordedAt = Date.now();
  const result = {
    verified,
    state: verified ? 'verified' : (verification.state || 'candidate'),
    reasons: Array.from(new Set([
      ...(Array.isArray(verification.reasons) ? verification.reasons : []),
      ...identityReasons
    ])).slice(0, 12),
    selectedHash: verification.selectedHash || null,
    selectedLength: Number(verification.selectedLength || 0),
    candidateSetHash: verification.candidateSetHash || null,
    messageRootHash: verification.messageRootHash || null,
    resolution: verification.resolution || 'unknown',
    structuralComplete: verification.structuralComplete === true,
    structuralIssues: Array.isArray(verification.structuralIssues) ? verification.structuralIssues.slice(0, 20) : [],
    generationActive: typeof verification.generationActive === 'boolean' ? verification.generationActive : null,
    generationSignalKind: verification.generationSignalKind || null,
    generationSignalSelector: verification.generationSignalSelector || null,
    generationSignalChecks: Array.isArray(verification.generationSignalChecks) ? verification.generationSignalChecks.slice(0, 40) : [],
    selectedNodeKey: verification.selectedNodeKey || null,
    selectedCandidateIndex: Number.isFinite(Number(verification.selectedCandidateIndex)) ? Number(verification.selectedCandidateIndex) : null,
    candidateOrdinalAfterAnchor: Number.isFinite(Number(verification.candidateOrdinalAfterAnchor)) ? Number(verification.candidateOrdinalAfterAnchor) : null,
    candidateFirstSeenAt: Number(verification.candidateFirstSeenAt || 0) || null,
    firstMutationAfterDispatchAt: Number(verification.firstMutationAfterDispatchAt || 0) || null,
    baselineEquivalent: verification.baselineEquivalent ?? null,
    maxObservedTextLength: Number(verification.maxObservedTextLength || verification.selectedLength || 0),
    lengthDecreaseCount: Number(verification.lengthDecreaseCount || 0),
    lastLengthDecrease: verification.lastLengthDecrease || null,
    lengthRegressionActive: verification.lengthRegressionActive === true,
    lengthRegressionFloor: Number(verification.lengthRegressionFloor || 0),
    recentLengths: Array.isArray(verification.recentLengths) ? verification.recentLengths.slice(-12) : [],
    messageRootLength: Number(verification.messageRootLength || 0),
    snapshotsCompared: Number(verification.snapshotsCompared || 0),
    nodes: Array.isArray(verification.nodes) ? verification.nodes.slice(0, 12) : [],
    effectiveConfig: verification.effectiveConfig || null,
    ...incomingIdentity,
    tabId: sender?.tab?.id || entry.tabId || null,
    observedAt: Number(verification.observedAt || 0) || recordedAt,
    recordedAt,
    method: 'dom_structural_stability'
  };
  entry.answerVerificationLast = result;
  if (result.verified || entry.answerVerification?.verified !== true) {
    entry.answerVerification = result;
  }
  emitTelemetry(llmName, 'ANSWER_VERIFICATION_RECORDED', {
    level: result.verified ? 'success' : 'warning',
    details: result.verified ? 'verified' : (result.reasons.join(',') || 'candidate'),
    meta: {
      verified: result.verified,
      state: result.state,
      reasons: result.reasons,
      resolution: result.resolution,
      structuralComplete: result.structuralComplete,
      structuralIssues: result.structuralIssues,
      generationActive: result.generationActive,
      generationSignalKind: result.generationSignalKind,
      generationSignalSelector: result.generationSignalSelector,
      generationSignalChecks: result.generationSignalChecks,
      selectedNodeKey: result.selectedNodeKey,
      selectedCandidateIndex: result.selectedCandidateIndex,
      candidateOrdinalAfterAnchor: result.candidateOrdinalAfterAnchor,
      candidateFirstSeenAt: result.candidateFirstSeenAt,
      firstMutationAfterDispatchAt: result.firstMutationAfterDispatchAt,
      baselineEquivalent: result.baselineEquivalent,
      maxObservedTextLength: result.maxObservedTextLength,
      lengthDecreaseCount: result.lengthDecreaseCount,
      lengthRegressionActive: result.lengthRegressionActive,
      lengthRegressionFloor: result.lengthRegressionFloor,
      lastLengthDecrease: result.lastLengthDecrease,
      recentLengths: result.recentLengths,
      messageRootLength: result.messageRootLength,
      selectedLength: result.selectedLength,
      snapshotsCompared: result.snapshotsCompared,
      observedAt: result.observedAt,
      recordedAt: result.recordedAt,
      identityCheck,
      incomingIdentity,
      currentIdentity,
      senderMatches
    },
    force: true
  });
  self.AnswerVerification?.appendTimeline?.(entry, {
    stage: 'verification', state: result.state, dispatchId, tabId: result.tabId,
    source: result.method, details: { reasons: result.reasons.join(','), selectedLength: result.selectedLength,
      snapshotsCompared: result.snapshotsCompared }
  });
  const transition = result.verified ? 'ANSWER_VERIFIED' : 'ANSWER_CANDIDATE_OBSERVED';
  const payload = { status: 'FINALIZING', dispatchId, tabId: result.tabId, verifiedAt: result.observedAt, method: result.method };
  if (self.commitModelRunTransition) self.commitModelRunTransition(llmName, entry, transition, payload);
  else self.ModelRunState?.applyModelRunTransition?.(entry, transition, payload);
  saveJobState(jobState);
  return true;
}
self.recordPipelineAnswerVerification = recordPipelineAnswerVerification;

function extractCalibrationEndMarker(promptText = '') {
  const lines = String(promptText || '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const match = lines[index].match(/\b(B2-[A-Z0-9-]*END-[A-Z0-9]+)\b/i);
    if (match) return match[1];
  }
  return null;
}
self.extractCalibrationEndMarker = extractCalibrationEndMarker;

function buildFinalizationEvidence(llmName, entry, context = {}) {
  const answerText = String(context.trimmedAnswer || '').trim();
  const error = context.error || null;
  const finalStatus = String(context.finalStatus || '').toUpperCase();
  const responseMeta = context.responseMeta && typeof context.responseMeta === 'object' ? context.responseMeta : {};
  const failureClassification = context.failureClassification && typeof context.failureClassification === 'object'
    ? context.failureClassification
    : classifyFailure(context.error || null, {
      responseMeta,
      responseSource: context.responseSource || null,
      finalReason: context.finalReason || null,
      isSuccess: SUCCESS_STATUSES.includes(String(context.finalStatus || '').toUpperCase())
    });
  const dispatchId = context.dispatchId || context.metaObj?.dispatchId || entry?.lastDispatchMeta?.dispatchId || null;
  const promptSubmittedAt = Number(entry?.promptSubmittedAt || 0) || null;
  const lastDispatchAt = Number(entry?.lastDispatchAt || 0) || null;
  const lifecycleReadyAt = Number(entry?.lifecycleReadyAt || entry?.answerCompleteDetectedAt || 0) || null;
  const source = responseMeta?.source || responseMeta?.answerSource || context.responseSource || null;
  const verifiedCurrentAnswer = isVerifiedCurrentAnswer(entry, answerText,
    responseMeta.answerVerification || context.metaObj?.answerVerification || entry?.answerVerification, dispatchId);
  const evidenceMinChars = verifiedCurrentAnswer ? 1 : DOM_SNAPSHOT_RECOVERY_MIN_CHARS;
  const answerEvidence = (!verifiedCurrentAnswer && (context.answerEvidence || responseMeta?.answerEvidence)) || (self.AnswerEvidence?.buildAnswerEvidence?.({
    llmName,
    text: answerText,
    html: context.normalizedHtml || '',
    source,
    responseMeta,
    dispatchId,
    attemptId: responseMeta.attemptId || context.metaObj?.attemptId || context.metaObj?.sourceRevisionId || null,
    tabId: entry?.tabId || null,
    promptConfirmed: context.sendConfirmed,
    minChars: evidenceMinChars,
    verifiedCurrentAnswer,
    stableMinChars: DEFER_STREAM_STABLE_FORCE_MIN_CHARS
  }) || null);
  const evidencePolicy = self.AnswerEvidence?.shouldFinalizeWithEvidence?.(answerEvidence, {
    minChars: evidenceMinChars
  }) || { ok: false };
  const answerLength = answerText.length;
  const promptEcho = isPromptEchoAnswerCandidate(answerText, jobState?.prompt || '');
  const staleBaseline = isStaleBaselineCandidate(entry, answerText, dispatchId);
  const freshness = self.RecoveryIntent?.evaluateFreshEvidence?.(entry, {
    dispatchId,
    minChars: DOM_SNAPSHOT_RECOVERY_MIN_CHARS
  }) || null;
  const explicitCandidateFresh = responseMeta.freshTurnEvidence === true;
  const hasAcceptedAnswer = answerLength >= evidenceMinChars && !promptEcho && !staleBaseline && !error;
  const hasPriorAnswer = Boolean(freshness?.fresh && String(entry?.answer || '').trim().length >= DOM_SNAPSHOT_RECOVERY_MIN_CHARS);
  const hasPendingFinalAnswer = Boolean(freshness?.fresh && String(entry?.pendingFinalAnswer || '').trim().length >= DOM_SNAPSHOT_RECOVERY_MIN_CHARS);
  const hasAnswerEvidence = hasAcceptedAnswer
    || hasPriorAnswer
    || hasPendingFinalAnswer
    || lifecycleReadyAt
    || Number(entry?.answerCompleteTextLength || 0) >= DOM_SNAPSHOT_RECOVERY_MIN_CHARS;
  const preFinalRecovery = Boolean(context.metaObj?.preTerminalMaterializeFinal || context.metaObj?.preTerminalMaterialize || responseMeta?.preTerminalMaterialize);
  const manualRecovery = Boolean(context.metaObj?.manualRecovery || responseMeta?.manualRecovery || responseMeta?.manualOverride);
  const verification = responseMeta.answerVerification || context.metaObj?.answerVerification || entry?.answerVerification || null;
  const currentIdentity = {
    runSessionId: jobState?.session?.startTime || null,
    dispatchId,
    generationEpoch: Number(entry?.generationEpoch || 0) || null,
    turnAnchor: entry?.preDispatchAnswerNodeCount ?? entry?.anchorAnswerCount ?? entry?.baselineAnswerCount ?? verification?.turnAnchor ?? null
  };
  const evidenceIdentity = {
    runSessionId: verification?.runSessionId ?? responseMeta.runSessionId ?? context.metaObj?.runSessionId ?? context.metaObj?.sessionId ?? null,
    dispatchId: verification?.dispatchId ?? responseMeta.dispatchId ?? context.metaObj?.dispatchId ?? context.dispatchId ?? null,
    generationEpoch: verification?.generationEpoch ?? responseMeta.generationEpoch ?? context.metaObj?.generationEpoch ?? null,
    turnAnchor: verification?.turnAnchor ?? responseMeta.turnAnchor ?? context.metaObj?.turnAnchor ?? null
  };
  const verificationIdentity = self.AnswerVerification?.compareIdentity
    ? self.AnswerVerification.compareIdentity(currentIdentity, evidenceIdentity, { strict: true })
    : { ok: false, missing: ['identity_contract_unavailable'], mismatched: [] };
  // Content and background use intentionally independent hash functions. Bind the
  // proof by dispatch/epoch and compare the observed length instead of pretending
  // the hashes are interoperable.
  const verificationLengthMatches = !verification?.selectedLength || !answerText
    || Math.abs(Number(verification.selectedLength) - answerText.length) <= Math.max(12, Math.floor(answerText.length * 0.08));
  const strictAutomaticVerification = verification?.verified === true
    && verification?.resolution === 'exact'
    && verification?.structuralComplete === true
    && verification?.generationActive === false
    && verification?.lengthRegressionActive !== true
    && verificationLengthMatches;
  const confirmedDispatchId = entry?.confirmedDispatchId || null;
  // A provider whose Send leaves no observable click evidence (Perplexity's
  // trusted-send probe, Le Chat's confirmed-send handler) could never reach an
  // automatic SUCCESS: submission was inferred from the answer itself, the
  // inference was then disqualified here, so every finalization carried
  // `automatic_finalization_before_submit_confirmation` and the model sat until
  // the automation deadline. The inference counts when it is backed by fresh
  // current-dispatch evidence - never when the text may predate the dispatch.
  const submissionInferredFromAnswer = entry?.submitSource === 'inferred_answer_evidence';
  const inferredSubmissionUsable = submissionInferredFromAnswer
    && freshness?.fresh === true
    && !staleBaseline
    && !promptEcho;
  const automaticSubmissionConfirmed = Boolean(
    dispatchId
    && promptSubmittedAt
    && confirmedDispatchId
    && String(confirmedDispatchId) === String(dispatchId)
    && (!submissionInferredFromAnswer || inferredSubmissionUsable)
  );
  const answerVerified = Boolean(manualRecovery
    || (automaticSubmissionConfirmed && verificationIdentity.ok && strictAutomaticVerification));
  const calibrationEndMarker = extractCalibrationEndMarker(
    resolvePromptForDispatch(llmName, jobState?.prompt || '')
  );
  const calibrationEndMarkerPresent = calibrationEndMarker
    ? answerText.includes(calibrationEndMarker)
    : null;
  // This is a copied, decision-time diagnostic record. It deliberately contains
  // no answer text or HTML and is not recomputed from a later DOM capture.
  const decisionSnapshot = Object.freeze({
    capturedAt: Date.now(),
    verificationObservedAt: Number(verification?.observedAt || 0) || null,
    answerLength,
    selectedLength: Number(verification?.selectedLength || 0),
    messageRootLength: Number(verification?.messageRootLength || 0),
    resolution: verification?.resolution || 'unknown',
    structuralComplete: verification?.structuralComplete === true,
    structuralIssues: Array.isArray(verification?.structuralIssues) ? verification.structuralIssues.slice(0, 20) : [],
    generationActive: typeof verification?.generationActive === 'boolean' ? verification.generationActive : null,
    generationSignalKind: verification?.generationSignalKind || null,
    generationSignalSelector: verification?.generationSignalSelector || null,
    snapshotsCompared: Number(verification?.snapshotsCompared || 0),
    sendCommandAt: lastDispatchAt,
    submissionConfirmedAt: promptSubmittedAt,
    submissionConfirmedForDispatch: automaticSubmissionConfirmed,
    confirmedDispatchId,
    baselineHash: entry?.preDispatchAnswerHash || entry?.baselineAnswerHash || null,
    baselineEquivalent: verification?.baselineEquivalent ?? null,
    selectedNodeKey: verification?.selectedNodeKey || null,
    selectedCandidateIndex: Number.isFinite(Number(verification?.selectedCandidateIndex)) ? Number(verification.selectedCandidateIndex) : null,
    candidateOrdinalAfterAnchor: Number.isFinite(Number(verification?.candidateOrdinalAfterAnchor)) ? Number(verification.candidateOrdinalAfterAnchor) : null,
    candidateFirstSeenAt: Number(verification?.candidateFirstSeenAt || entry?.answerStartedAt || 0) || null,
    firstMutationAfterDispatchAt: Number(verification?.firstMutationAfterDispatchAt || 0) || null,
    maxObservedTextLength: Number(verification?.maxObservedTextLength || verification?.selectedLength || 0),
    lengthDecreaseCount: Number(verification?.lengthDecreaseCount || 0),
    lastLengthDecrease: verification?.lastLengthDecrease || null,
    lengthRegressionActive: verification?.lengthRegressionActive === true,
    lengthRegressionFloor: Number(verification?.lengthRegressionFloor || 0),
    recentLengths: Array.isArray(verification?.recentLengths) ? verification.recentLengths.slice(-12) : [],
    generationSignalChecks: Array.isArray(verification?.generationSignalChecks) ? verification.generationSignalChecks.slice(0, 40) : [],
    calibrationEndMarker,
    calibrationEndMarkerPresent
  });
  const terminalFailure = FAILURE_STATUSES.includes(finalStatus);
  const success = SUCCESS_STATUSES.includes(finalStatus);
  const lengthPolicy = self.AnswerLengthPolicy?.evaluateTerminalAnswerLength?.(llmName, answerLength, { finalStatus, verifiedCurrentAnswer })
    || { policyRef: 'answer-length-policy@fallback', length: answerLength, minTerminalChars: DOM_SNAPSHOT_RECOVERY_MIN_CHARS, meetsTerminalMin: answerLength >= DOM_SNAPSHOT_RECOVERY_MIN_CHARS };
  const contradictions = [];
  // Run 1786280638177, Z.ai: 16 characters accepted as SUCCESS while the same
  // decision recorded `evidence_policy:text_too_short` and `no_accepted_answer`
  // among its own blockers. The refusal was computed and then ignored, because
  // a manual ping waives every contradiction below. A manual ping may waive how
  // strictly the answer was verified; it cannot waive there not being an answer,
  // so this one is unwaivable. The text is not lost — a blocked success is kept
  // as a visible pending candidate (principle 5).
  if (success && lengthPolicy.meetsTerminalMin === false) {
    contradictions.push('answer_below_terminal_minimum');
  }
  if (promptEcho) contradictions.push('prompt_echo_candidate');
  if (staleBaseline && !manualRecovery) contradictions.push('stale_baseline_candidate');
  if (preFinalRecovery && success && !manualRecovery && !freshness?.fresh && !explicitCandidateFresh) {
    contradictions.push('prefinal_recovery_freshness_unproven');
  }
  // The verifier being unavailable is not evidence. Automatic success must
  // fail closed instead of silently reverting to the legacy heuristic path.
  if (success && !answerVerified) contradictions.push('answer_not_verified');
  if (success && !manualRecovery && !automaticSubmissionConfirmed) {
    contradictions.push('automatic_finalization_before_submit_confirmation');
  }
  if (terminalFailure && hasAnswerEvidence && !manualRecovery) {
    contradictions.push(preFinalRecovery
      ? 'failure_with_answer_evidence_after_prefinal_recovery'
      : 'failure_with_answer_evidence_without_prefinal_recovery');
  }
  // The run's own typed proof is a first-class contradiction: a success whose
  // result came out UNKNOWN or OBSERVER_LOST is claiming more than the run
  // proved, regardless of how the strict verifier scored the extraction.
  const runResultType = String(
    responseMeta?.runResult?.type || context.answerEvidence?.resultType || ''
  ).toUpperCase();
  if (success && ['UNKNOWN', 'OBSERVER_LOST', 'FAILED', 'CANCELLED'].includes(runResultType)) {
    contradictions.push(`unproven_run_result_${runResultType.toLowerCase()}`);
  }
  if (finalStatus === 'NO_SEND' && promptSubmittedAt) contradictions.push('no_send_after_prompt_submitted');
  if (finalStatus === 'EXTRACT_FAILED' && lifecycleReadyAt) contradictions.push('extract_failed_after_lifecycle_ready');
  // Strict verification fails closed by design, but "unverified" was terminal for
  // the whole run: a complete, generation-inactive answer stayed blocked until the
  // 15-minute automation deadline and landed as PARTIAL, while a manual ping
  // accepted the very same text as SUCCESS seconds later. When the only missing
  // piece is the strict verifier's own signal - the answer belongs to this
  // dispatch, is not an echo, is not the pre-dispatch baseline, generation is
  // observed inactive and the evidence policy is satisfied - accept it and keep
  // the lifted reason on the record instead of waiting out a deadline that
  // changes nothing.
  const liftedContradictions = [];
  const strictnessOnlyBlockers = contradictions.length > 0
    && contradictions.every((reason) => LIFTABLE_STRICTNESS_CONTRADICTIONS.has(reason));
  // Run 1785870408469: this lift never fired once across four models and twelve
  // decisions, so the reason each precondition failed has to be on the record -
  // otherwise the next attempt to widen it is guesswork again.
  const stableEvidenceBlockers = [];
  if (!strictnessOnlyBlockers) stableEvidenceBlockers.push('non_strictness_blocker');
  if (!success) stableEvidenceBlockers.push('not_success_status');
  if (promptEcho) stableEvidenceBlockers.push('prompt_echo');
  if (staleBaseline) stableEvidenceBlockers.push('stale_baseline');
  if (!hasAcceptedAnswer) stableEvidenceBlockers.push('no_accepted_answer');
  if (!verificationIdentity.ok) stableEvidenceBlockers.push('identity_unproven');
  if (!automaticSubmissionConfirmed) stableEvidenceBlockers.push('submission_unconfirmed');
  if (evidencePolicy?.ok !== true) stableEvidenceBlockers.push(`evidence_policy:${evidencePolicy?.reason || 'blocked'}`);
  if (verification?.generationActive !== false) stableEvidenceBlockers.push('generation_inactive_unproven');
  if (verification?.lengthRegressionActive === true) stableEvidenceBlockers.push('length_regression_active');
  if (!stableEvidenceBlockers.length) {
    liftedContradictions.push(...contradictions.splice(0, contradictions.length));
  }
  return {
    llmName,
    finalStatus,
    finalReason: context.finalReason || null,
    modelFinalStatus: context.modelFinalStatus || null,
    doneReason: context.doneReason || null,
    dispatchId,
    tabId: entry?.tabId || null,
    source,
    answerLength,
    answerHash: answerLength ? hashEvidenceText(answerText) : null,
    promptEcho,
    staleBaseline,
    freshness,
    hasAcceptedAnswer,
    hasPriorAnswer,
    hasPendingFinalAnswer,
    hasAnswerEvidence: !!hasAnswerEvidence,
    answerEvidence,
    evidencePolicy,
    lengthPolicy,
    terminalEligible: !!answerEvidence?.terminalEligible,
    terminalEligibleReason: answerEvidence?.reason || null,
    promptSubmittedAt,
    lastDispatchAt,
    lifecycleReadyAt,
    answerCompleteTextLength: Number(entry?.answerCompleteTextLength || entry?.lifecycleReadyMeta?.textLength || 0) || null,
    sendConfirmed: context.sendConfirmed ?? null,
    completionReason: context.completionReason || null,
    errorType: error?.type || null,
    errorMessage: error?.message || null,
    failureClass: failureClassification?.class || null,
    failureRecoveryFirst: failureClassification?.recoveryFirst ?? null,
    terminalRequiresEvidenceMiss: failureClassification?.terminalRequiresEvidenceMiss ?? null,
    preFinalRecovery,
    manualRecovery,
    automaticSubmissionConfirmed,
    confirmedDispatchId,
    answerVerified,
    verificationState: answerVerified ? 'verified' : (verification?.state || 'candidate'),
    verificationMethod: manualRecovery ? 'manual_recovery' : verification?.method || null,
    verificationIdentity,
    verification,
    decisionSnapshot,
    calibrationEndMarker,
    calibrationEndMarkerPresent,
    terminalFailure,
    success,
    contradictions,
    liftedContradictions,
    stableEvidenceBlockers,
    acceptedOnStableEvidence: liftedContradictions.length > 0,
    unwaivableContradictions: contradictions.filter((reason) => UNWAIVABLE_CONTRADICTIONS.has(reason)),
    accepted: contradictions.length === 0
      || (manualRecovery && !contradictions.some((reason) => UNWAIVABLE_CONTRADICTIONS.has(reason)))
  };
}

function summarizeFinalizationEvidenceForTelemetry(evidence = null) {
  if (!evidence || typeof evidence !== 'object') return null;
  const summary = { ...evidence };
  const answerEvidence = evidence.answerEvidence && typeof evidence.answerEvidence === 'object'
    ? evidence.answerEvidence
    : null;
  if (answerEvidence) {
    const text = String(answerEvidence.text || '');
    const html = String(answerEvidence.html || '');
    summary.answerEvidence = {
      source: answerEvidence.source || null,
      method: answerEvidence.method || null,
      length: Number(answerEvidence.length || answerEvidence.textLength || text.trim().length || 0),
      hash: answerEvidence.hash || answerEvidence.answerHash || null,
      htmlLength: Number(answerEvidence.htmlLength || html.length || 0),
      dispatchId: answerEvidence.dispatchId || null,
      tabId: answerEvidence.tabId || null,
      promptConfirmed: answerEvidence.promptConfirmed ?? null,
      freshTurnEvidence: answerEvidence.freshTurnEvidence ?? null,
      terminalEligible: answerEvidence.terminalEligible ?? null,
      reason: answerEvidence.reason || null
    };
  }
  return summary;
}

function shouldInferSubmitFromAnswerEvidence(llmName, entry, context = {}) {
  if (llmName !== 'Qwen') return false;
  if (!entry || entry.promptSubmittedAt) return false;
  const answerText = String(context.trimmedAnswer || '').trim();
  if (answerText.length < DOM_SNAPSHOT_RECOVERY_MIN_CHARS) return false;
  // Heuristic guard for DOM-extracted text (page error banners); not a status channel.
  if (/^error\s*:/i.test(answerText)) return false;
  if (isPromptEchoAnswerCandidate(answerText, jobState?.prompt || '')) return false;
  const responseMeta = context.responseMeta && typeof context.responseMeta === 'object' ? context.responseMeta : {};
  const metaObj = context.metaObj && typeof context.metaObj === 'object' ? context.metaObj : {};
  const source = String(responseMeta.source || responseMeta.answerSource || context.responseSource || metaObj.source || '').toLowerCase();
  const status = String(entry.status || entry.finalStatus || '').toUpperCase();
  const dispatchId = metaObj.dispatchId || entry?.lastDispatchMeta?.dispatchId || entry?.confirmedDispatchId || null;
  if (isStaleBaselineCandidate(entry, answerText, dispatchId)) return false;
  const liveDispatchId = entry?.lastDispatchMeta?.dispatchId || entry?.awaitingSubmitConfirmationDispatchId || null;
  const previousPendingAnswer = String(entry?.pendingFinalAnswer || '').trim();
  const observedGrowthAfterDispatch = Boolean(
    entry.awaitingSubmitConfirmation === true
    && Number(entry.lastDispatchAt || 0) > 0
    && (!dispatchId || !liveDispatchId || String(dispatchId) === String(liveDispatchId))
    && answerText.length >= DOM_SNAPSHOT_RECOVERY_MIN_CHARS
    && answerText.length > previousPendingAnswer.length + 24
  );
  const freshTurnProven = Boolean(
    responseMeta.freshTurnEvidence
    || responseMeta.anchorApplied
    || metaObj.freshTurnEvidence
    || metaObj.anchorApplied
    || observedGrowthAfterDispatch
    || self.RecoveryIntent?.hasMatchingLifecycleEvidence?.(entry, dispatchId)
  );
  if (!freshTurnProven) return false;
  return Boolean(
    responseMeta.recovered
    || responseMeta.lateCollectFinal
    || responseMeta.forceTerminalSuccess
    || responseMeta.preTerminalMaterialize
    || metaObj.preTerminalMaterialize
    || metaObj.materializeLatestEvidence
    || source.includes('late_collect')
    || source.includes('materialize')
    || source.includes('snapshot')
    || source.includes('inline_executescript')
    || observedGrowthAfterDispatch
    || status === 'NO_SEND'
    || status === 'RECOVERABLE_ERROR'
  );
}

function inferPromptSubmittedFromAnswerEvidence(llmName, entry, context = {}) {
  if (!shouldInferSubmitFromAnswerEvidence(llmName, entry, context)) return false;
  const now = Date.now();
  const metaObj = context.metaObj && typeof context.metaObj === 'object' ? context.metaObj : {};
  const responseMeta = context.responseMeta && typeof context.responseMeta === 'object' ? context.responseMeta : {};
  const dispatchId = metaObj.dispatchId || entry?.lastDispatchMeta?.dispatchId || entry?.confirmedDispatchId || null;
  const answerText = String(context.trimmedAnswer || '').trim();
  entry.promptSubmittedAt = now;
  entry.lastRuntimeActivityAt = now;
  entry.lastRuntimeActivitySource = 'answer_evidence_submit_inferred';
  entry.awaitingSubmitConfirmation = false;
  entry.awaitingSubmitConfirmationAt = null;
  entry.awaitingSubmitConfirmationDispatchId = null;
  entry.confirmedDispatchId = dispatchId || entry.confirmedDispatchId || null;
  entry.submitSource = 'inferred_answer_evidence';
  entry.submitConfirmedBy = responseMeta.source || responseMeta.answerSource || metaObj.source || 'answer_evidence';
  entry.submitInferredFromAnswerHash = hashEvidenceText(answerText);
  appendLogEntry(llmName, {
    type: 'DISPATCH',
    label: 'Submit confirmation inferred from answer evidence',
    details: `source=${entry.submitConfirmedBy}`,
    level: 'success',
    meta: {
      dispatchId,
      answerLength: answerText.length,
      answerHash: entry.submitInferredFromAnswerHash,
      source: entry.submitConfirmedBy
    }
  });
  emitTelemetry(llmName, 'PROMPT_SUBMITTED_INFERRED', {
    level: 'success',
    details: 'answer_evidence',
    meta: {
      dispatchId,
      submitSource: entry.submitSource,
      source: entry.submitConfirmedBy,
      answerLength: answerText.length,
      answerHash: entry.submitInferredFromAnswerHash
    },
    force: true
  });
  resolvePromptSubmitted(llmName, {
    ok: true,
    ts: entry.promptSubmittedAt,
    inferred: true,
    meta: metaObj,
    dispatchId
  });
  return true;
}

function recordModelRunState(llmName, entry, evidence = {}) {
  if (!entry) return;
  const status = String(evidence.finalStatus || entry.status || '').toUpperCase();
  const acceptedSuccess = Boolean(evidence.accepted && evidence.success);
  const acceptedFailure = Boolean(evidence.accepted && evidence.terminalFailure);
  const legacyState = {
    executionStatus: acceptedSuccess ? 'finalized_success' : (acceptedFailure ? 'finalized_failure' : 'running'),
    generationStatus: evidence.lifecycleReadyAt ? 'complete' : (evidence.completionReason || 'unknown'),
    answerStatus: evidence.promptEcho ? 'rejected_prompt_echo' : (evidence.hasAcceptedAnswer ? 'accepted' : (evidence.hasAnswerEvidence ? 'candidate' : 'none')),
    uiStatus: status || null,
    dispatchId: evidence.dispatchId || null,
    updatedAt: Date.now()
  };
  if (self.commitModelRunTransition || self.ModelRunState?.applyModelRunTransition) {
    const transition = evidence.accepted
      ? (evidence.terminalFailure ? 'TERMINAL_FAILURE' : 'ANSWER_CANDIDATE_ACCEPTED')
      : 'ANSWER_CANDIDATE_REJECTED';
    const payload = {
      status,
      reason: evidence.finalReason || null,
      answerLength: evidence.answerLength || 0,
      answerHash: evidence.answerHash || null,
      dispatchId: evidence.dispatchId || null,
      tabId: evidence.tabId || null,
      runSessionId: jobState?.session?.startTime || null,
      manualRecovery: !!evidence.manualRecovery,
      verified: evidence.answerVerified === true,
      source: 'recordModelRunState'
    };
    if (self.commitModelRunTransition) {
      self.commitModelRunTransition(llmName, entry, transition, payload);
    } else {
      self.ModelRunState.applyModelRunTransition(entry, transition, payload);
    }
    entry.modelRunState = {
      ...(entry.modelRunState || {}),
      ...legacyState,
      executionState: entry.modelRunState?.executionState || legacyState.executionStatus,
      generationState: entry.modelRunState?.generationState || legacyState.generationStatus,
      answerState: entry.modelRunState?.answerState || legacyState.answerStatus,
      terminalStatus: entry.modelRunState?.terminalStatus || (acceptedSuccess || acceptedFailure ? status : null),
      terminalState: entry.modelRunState?.terminalState || (acceptedSuccess ? 'success' : (acceptedFailure ? 'failure' : 'open'))
    };
    return;
  }
  entry.modelRunState = legacyState;
}

function emitFinalizationDecision(llmName, evidence = {}) {
  const entry = jobState?.llms?.[llmName] || null;
  emitTelemetry(llmName, 'FINALIZATION_DECISION', {
    level: evidence.accepted ? (evidence.terminalFailure ? 'warning' : 'success') : 'warning',
    details: `${evidence.finalStatus || 'UNKNOWN'}:${evidence.accepted ? 'accepted' : 'blocked'}`,
    meta: {
      finalStatus: evidence.finalStatus || null,
      finalReason: evidence.finalReason || null,
      decisionAccepted: evidence.accepted === true,
      // `contradictions` is dropped by canonical metadata compaction, so the
      // reason a finalization was blocked never reached an export and every
      // blocked run had to be diagnosed by guessing. This key survives.
      decisionReasons: Array.isArray(evidence.contradictions) ? evidence.contradictions.slice(0, 12) : [],
      liftedDecisionReasons: Array.isArray(evidence.liftedContradictions) ? evidence.liftedContradictions.slice(0, 12) : [],
      acceptedOnStableEvidence: evidence.acceptedOnStableEvidence === true,
      stableEvidenceBlockedReasons: Array.isArray(evidence.stableEvidenceBlockers) ? evidence.stableEvidenceBlockers.slice(0, 12) : [],
      modelFinalStatus: evidence.modelFinalStatus || null,
      doneReason: evidence.doneReason || null,
      dispatchId: evidence.dispatchId || null,
      generationEpoch: evidence.generationEpoch
        ?? entry?.lastDispatchMeta?.generationEpoch
        ?? entry?.generationEpoch
        ?? null,
      attemptId: evidence.attemptId || entry?.lastDispatchMeta?.attemptId || null,
      tabId: evidence.tabId || null,
      source: evidence.source || null,
      answerLength: evidence.answerLength || 0,
      answerHash: evidence.answerHash || null,
      promptEcho: !!evidence.promptEcho,
      hasAcceptedAnswer: !!evidence.hasAcceptedAnswer,
      hasPriorAnswer: !!evidence.hasPriorAnswer,
      hasPendingFinalAnswer: !!evidence.hasPendingFinalAnswer,
      hasAnswerEvidence: !!evidence.hasAnswerEvidence,
      promptSubmittedAt: evidence.promptSubmittedAt || null,
      lifecycleReadyAt: evidence.lifecycleReadyAt || null,
      answerCompleteTextLength: evidence.answerCompleteTextLength || null,
      sendConfirmed: evidence.sendConfirmed,
      completionReason: evidence.completionReason || null,
      errorType: evidence.errorType || null,
      preFinalRecovery: !!evidence.preFinalRecovery,
      manualRecovery: !!evidence.manualRecovery,
      decisionSnapshot: evidence.decisionSnapshot || null,
      calibrationEndMarker: evidence.calibrationEndMarker || null,
      calibrationEndMarkerPresent: evidence.calibrationEndMarkerPresent ?? null,
      contradictions: evidence.contradictions || [],
      accepted: !!evidence.accepted
    },
    force: true
  });
}

function getTerminalRank(status) {
  if (self.LLMStatusContract && typeof self.LLMStatusContract.getStatusRank === 'function') {
    return self.LLMStatusContract.getStatusRank(status);
  }
  return 0;
}

// One deferral per model per run: enough for the Round 2 repair to re-dispatch,
// never enough to loop.
// Blocked-finalization reasons that describe the verifier's own strictness, not a
// doubt about which answer this is. Identity, echo and stale-baseline reasons are
// never liftable.
const LIFTABLE_STRICTNESS_CONTRADICTIONS = new Set(['answer_not_verified']);
// Contradictions a manual recovery may not waive. Manual intent can stand in for
// a verifier that did not run; it cannot stand in for an answer that is not
// there.
const UNWAIVABLE_CONTRADICTIONS = new Set(['answer_below_terminal_minimum']);
const PRE_INSERTION_DEFERRAL_LIMIT = 1;
// Round 2 has to fit its whole batch inside its budget, so the deferral has to
// outlive that batch - and then stop. Run 1785870408469: Grok and Perplexity were
// deferred and simply stayed pending, with no terminal at all, where the old code
// had at least reported a definite outcome in 30 seconds. A deferral that is not
// bounded trades a bad answer for no answer.
const PRE_INSERTION_DEFERRAL_TIMEOUT_MS = 120000;
// Blockers a repeat dispatch cannot clear - only a human can. Everything else
// (attachment upload not confirmed, unclassified adapter error, transport loss)
// is worth exactly one more attempt before the model is written off.
const USER_ACTION_BLOCKER_PATTERN = /auth_required|required_login|\blogin\b|captcha|conversation_limit|unsafe_prompt_modal|wrong_page|rate_limit|quota_exceeded/;

function evaluatePreInsertionFailureDeferral(llmName, entry, context = {}) {
  const decline = (reason) => ({ defer: false, reason });
  if (!entry) return decline('missing_entry');
  if (context.isSuccess || String(context.answerText || '').trim()) return decline('not_a_bare_failure');
  // The automation deadline and the Round 4 force-final are the last resort by
  // construction: they run when every earlier stage is already spent, so
  // deferring them would leave the model open with nothing left to reopen it.
  if (context.lastResortTerminal) return decline('last_resort_terminal');
  // The gate runs before run-identity validation, so a late failure from an
  // earlier dispatch must not reset the flags of the dispatch that is live now.
  const liveDispatchId = entry.lastDispatchMeta?.dispatchId || null;
  if (context.dispatchId && liveDispatchId && String(context.dispatchId) !== String(liveDispatchId)) {
    return decline('foreign_dispatch');
  }
  if (isFinalizedEntry(entry)) return decline('already_finalized');
  if (entry.promptSubmittedAt) return decline('prompt_already_submitted');
  const dispatchId = context.dispatchId || null;
  const insertedDispatchId = entry.promptInsertedDispatchId || null;
  const insertedForThisDispatch = Boolean(entry.promptInsertedAt)
    && (!dispatchId || !insertedDispatchId || String(insertedDispatchId) === String(dispatchId));
  if (insertedForThisDispatch) return decline('prompt_already_inserted');
  const haystack = [
    context.error?.type,
    context.error?.message,
    context.failureClassification?.type,
    context.failureClassification?.reason
  ].filter(Boolean).join(' ').toLowerCase();
  if (USER_ACTION_BLOCKER_PATTERN.test(haystack)) return decline('user_action_required');
  const used = Number(entry.preInsertionDeferralCount || 0);
  if (used >= PRE_INSERTION_DEFERRAL_LIMIT) return decline('deferral_budget_exhausted');
  return {
    defer: true,
    reason: context.error?.type || context.failureClassification?.type || context.finalStatus || 'unknown',
    failureClass: context.failureClassification?.class || 'unknown',
    finalStatus: context.finalStatus || null,
    dispatchId,
    attempt: used + 1
  };
}

const preInsertionDeferralTimers = new Map();

function clearPreInsertionDeferralTimeout(llmName) {
  const timer = preInsertionDeferralTimers.get(llmName);
  if (!timer) return;
  clearTimeout(timer);
  deregisterSessionTimer(timer);
  preInsertionDeferralTimers.delete(llmName);
}

function schedulePreInsertionDeferralTimeout(llmName, decision = {}) {
  clearPreInsertionDeferralTimeout(llmName);
  const timer = registerSessionTimer(setTimeout(() => {
    preInsertionDeferralTimers.delete(llmName);
    deregisterSessionTimer(timer);
    const entry = jobState?.llms?.[llmName];
    if (!entry || isFinalizedEntry(entry)) return;
    // The repair had its window. Anything that made progress - a confirmed
    // submission, an inserted prompt, an answer - keeps the model open.
    if (entry.promptSubmittedAt || entry.promptInsertedAt || String(entry.answer || '').trim()) return;
    emitTelemetry(llmName, 'PRE_INSERTION_DEFERRAL_EXPIRED', {
      level: 'warning',
      details: decision.reason || 'unknown',
      meta: {
        dispatchId: decision.dispatchId || null,
        reason: decision.reason || null,
        deferredFinalStatus: decision.finalStatus || null,
        timeoutMs: PRE_INSERTION_DEFERRAL_TIMEOUT_MS,
        phase: 'pre_insertion'
      },
      force: true
    });
    handleLLMResponse(
      llmName,
      '',
      {
        type: decision.reason || 'pre_insertion_failure',
        message: `Prompt never reached the composer and the repair window expired (${PRE_INSERTION_DEFERRAL_TIMEOUT_MS}ms)`
      },
      {
        dispatchId: decision.dispatchId || entry?.lastDispatchMeta?.dispatchId || null,
        sessionId: jobState?.session?.startTime || undefined,
        runSessionId: jobState?.session?.startTime || undefined,
        lastResortTerminal: true
      },
      ''
    );
  }, PRE_INSERTION_DEFERRAL_TIMEOUT_MS));
  preInsertionDeferralTimers.set(llmName, timer);
}

function applyPreInsertionFailureDeferral(llmName, entry, decision = {}) {
  if (!entry) return false;
  entry.preInsertionDeferralCount = Number(entry.preInsertionDeferralCount || 0) + 1;
  entry.preInsertionDeferral = {
    reason: decision.reason || null,
    failureClass: decision.failureClass || null,
    deferredFinalStatus: decision.finalStatus || null,
    dispatchId: decision.dispatchId || null,
    at: Date.now()
  };
  // Leave the model dispatchable so the repair path is not blocked by the
  // remains of the attempt that just failed.
  entry.dispatchInFlight = false;
  entry.messageSent = false;
  entry.dispatchState = 'IDLE';
  entry.csBusyUntil = 0;
  const machine = self.DispatchStateManager?.get?.(llmName) || null;
  if (machine && typeof machine.reset === 'function') machine.reset();
  schedulePreInsertionDeferralTimeout(llmName, decision);
  emitTelemetry(llmName, 'PRE_INSERTION_FAILURE_DEFERRED', {
    level: 'warning',
    details: `${decision.finalStatus || 'FAILURE'}:${decision.reason || 'unknown'}`,
    meta: {
      dispatchId: decision.dispatchId || null,
      reason: decision.reason || null,
      failureClass: decision.failureClass || null,
      deferredFinalStatus: decision.finalStatus || null,
      attempt: decision.attempt || 1,
      phase: 'pre_insertion'
    },
    force: true
  });
  appendLogEntry(llmName, {
    type: 'DISPATCH',
    label: 'Terminal deferred (prompt never inserted)',
    details: decision.reason || 'unknown',
    level: 'warning',
    meta: {
      dispatchId: decision.dispatchId || null,
      deferredFinalStatus: decision.finalStatus || null,
      attempt: decision.attempt || 1
    }
  });
  return true;
}

function handleLLMResponse(llmName, answer, error = null, meta = null, answerHtml = '') {
  if (!jobState?.llms || typeof llmName !== 'string') {
    console.error('[BACKGROUND] Invalid state for response:', llmName);
    return;
  }
  const resolvedName = (() => {
    if (jobState.llms[llmName]) return llmName;
    const trimmed = llmName.trim();
    if (jobState.llms[trimmed]) return trimmed;
    const lower = trimmed.toLowerCase();
    const match = Object.keys(jobState.llms).find((key) => key && key.toLowerCase() === lower);
    return match || llmName;
  })();
  if (resolvedName !== llmName) {
    console.warn(`[BACKGROUND] Normalized llmName "${llmName}" -> "${resolvedName}"`);
  }
  llmName = resolvedName;

  const entry = jobState.llms?.[llmName];
  const metaObj = meta && typeof meta === 'object' ? meta : null;
  const earlyResponseMeta = (() => {
    if (!metaObj || typeof metaObj !== 'object') return {};
    const merged = {};
    [metaObj.response, metaObj.responseMeta, metaObj.answerMeta, metaObj.pipelineMeta].forEach((candidate) => {
      if (candidate && typeof candidate === 'object') Object.assign(merged, candidate);
    });
    return merged;
  })();
  const earlyAnswerText = (() => {
    if (answer && typeof answer === 'object') return String(answer.text || answer.answer || '');
    return typeof answer === 'string' ? answer : String(answer ?? '');
  })().trim();
  const earlyIsSuccess = !error && !!earlyAnswerText;
  if (earlyIsSuccess && self.CompletionAuthorityRegistry?.validateDelivery) {
    const authorityGate = self.CompletionAuthorityRegistry.validateDelivery(llmName, {
      answer: earlyAnswerText,
      error: null,
      meta: metaObj || {}
    });
    if (!authorityGate.ok) {
      emitTelemetry(llmName, 'ANSWER_DELIVERY_REJECTED', {
        level: 'error',
        details: authorityGate.reason,
        meta: {
          ...(metaObj || {}),
          answerLength: earlyAnswerText.length,
          messageType: 'BACKGROUND_FINALIZATION',
          completionAuthorityReason: authorityGate.reason
        },
        force: true
      });
      return handleLLMResponse(llmName, '', {
        type: 'completion_authority_missing',
        message: authorityGate.reason
      }, {
        ...(metaObj || {}),
        completionAuthorityRejected: true,
        completionAuthorityReason: authorityGate.reason,
        lastResortTerminal: true
      }, '');
    }
  }
  const earlyFailureClassification = earlyIsSuccess
    ? null
    : classifyFailure(error, {
      responseMeta: earlyResponseMeta,
      responseSource: earlyResponseMeta?.source || metaObj?.source || null
    });
  const earlyFinalStatus = earlyIsSuccess
    ? (earlyResponseMeta?.partial ? 'PARTIAL' : 'SUCCESS')
    : deriveFailureFinalStatus(error, null, earlyFailureClassification);
  const earlySource = String(earlyResponseMeta?.source || metaObj?.source || '').toLowerCase();
  const recoveredFinalRequested = Boolean(
    earlyIsSuccess
    && (
      metaObj?.manualRecovery
      || metaObj?.preTerminalMaterialize
      || metaObj?.preTerminalMaterializeFinal
      || metaObj?.materializeLatestEvidence
      || earlyResponseMeta?.manualRecovery
      || earlyResponseMeta?.manualOverride
      || earlyResponseMeta?.preTerminalMaterialize
      || earlyResponseMeta?.recovered
      || earlyResponseMeta?.forceTerminalSuccess
      || earlyResponseMeta?.lateCollectFinal
      || earlySource.includes('late_collect')
      || earlySource.includes('materialize')
      || earlySource.includes('snapshot')
    )
  );
  // A recovered answer may upgrade a locked terminal failure only when THIS
  // dispatch was actually confirmed as sent. Run 1782940321214: the Le Chat
  // dispatch crashed before the prompt was inserted (terminal UNCERTAIN), then a
  // stale on-page answer arrived through the recovery path and upgraded it to a
  // false SUCCESS. Manual recovery, api transport, preserved run-scoped answers
  // and Qwen's guarded submit-inference path keep their existing behaviour.
  const recoveredDispatchConfirmed = Boolean(
    entry?.promptSubmittedAt
    || entry?.submitSource === 'content'
    || entry?.submitSource === 'inferred_answer_evidence'
  );
  const recoveredManualIntent = Boolean(
    metaObj?.manualRecovery
    || metaObj?.manualLatestRecovery
    || earlyResponseMeta?.manualRecovery
    || earlyResponseMeta?.manualOverride
    || earlyResponseMeta?.manualLatestRecovery
    || earlySource.includes('manual')
  );
  const recoveredUpgradeBlockedUnconfirmed = Boolean(
    recoveredFinalRequested
    && !recoveredDispatchConfirmed
    && !recoveredManualIntent
    && llmName !== 'Qwen'
    && !earlySource.includes('api')
    && !earlySource.includes('preserved')
  );
  const allowRecoveredFinalOverride = recoveredFinalRequested && !recoveredUpgradeBlockedUnconfirmed;
  if (recoveredUpgradeBlockedUnconfirmed && entry && entry.finalStatusRecorded) {
    emitTelemetry(llmName, 'RECOVERED_FINAL_UPGRADE_BLOCKED_UNCONFIRMED_SEND', {
      level: 'warning',
      details: `locked=${String(entry.finalStatus || '').toUpperCase()} source=${earlySource || 'unknown'} len=${earlyAnswerText.length}`,
      meta: {
        dispatchId: metaObj?.dispatchId || entry?.lastDispatchMeta?.dispatchId || null,
        source: earlySource || null,
        answerLength: earlyAnswerText.length,
        promptSubmittedAt: entry?.promptSubmittedAt || null,
        submitSource: entry?.submitSource || null,
        reason: 'recovered_answer_without_current_dispatch_confirmation'
      },
      force: true
    });
    appendLogEntry(llmName, {
      type: 'RECOVERY',
      label: 'Recovered final upgrade blocked (submit unconfirmed)',
      details: 'recovered answer may belong to a previous session; terminal failure kept',
      level: 'warning',
      meta: {
        source: earlySource || null,
        answerLength: earlyAnswerText.length,
        dispatchId: metaObj?.dispatchId || entry?.lastDispatchMeta?.dispatchId || null
      }
    });
    return;
  }
  // A dispatch that failed before the prompt reached the composer used to become
  // a terminal status within seconds (attachment upload not confirmed ->
  // USER_ACTION_REQUIRED, unclassified adapter error -> UNCERTAIN). A finalized
  // model is skipped by every later stage, so the Round 2 repair dispatch that
  // exists for exactly this case never ran, and the model was lost for the whole
  // run while the run itself kept going for minutes. Keep the model open once so
  // the repair can happen; genuine user-action blockers still terminate at once.
  const preInsertionDeferral = evaluatePreInsertionFailureDeferral(llmName, entry, {
    isSuccess: earlyIsSuccess,
    answerText: earlyAnswerText,
    error,
    finalStatus: earlyFinalStatus,
    failureClassification: earlyFailureClassification,
    dispatchId: metaObj?.dispatchId || entry?.lastDispatchMeta?.dispatchId || null,
    lastResortTerminal: Boolean(
      metaObj?.automationDeadline
      || metaObj?.lastResortTerminal
      || earlyResponseMeta?.automationStopped
      || earlyResponseMeta?.lateCollectFinal
    )
  });
  if (preInsertionDeferral.defer) {
    applyPreInsertionFailureDeferral(llmName, entry, preInsertionDeferral);
    return;
  }
  const pipelineControl = getActivePipelineControlState();
  const incomingPipelineRunId = metaObj?.pipelineRunId || metaObj?.runSessionId || jobState?.session?.pipelineRunId || pipelineControl?.pipelineRunId || null;
  const incomingTabSessionId = metaObj?.tabSessionId || metaObj?.responseMeta?.tabSessionId || metaObj?.pipelineTabSessionId || null;
  if (entry && metaObj) {
    const expectedSessionId = Number(jobState?.session?.startTime || 0) || null;
    const incomingSessionId = metaObj?.sessionId ? Number(metaObj.sessionId) : null;
    const incomingDispatchId = typeof metaObj?.dispatchId === 'string' ? metaObj.dispatchId : null;
    const identityDecision = self.RunIdentity?.validateEvent
      ? self.RunIdentity.validateEvent(entry, {
        sessionId: incomingSessionId,
        runSessionId: metaObj?.runSessionId || incomingSessionId,
        dispatchId: incomingDispatchId,
        tabId: metaObj?.tabId || metaObj?.responseMeta?.tabId || null
      }, {
        runSessionId: expectedSessionId,
        tabId: entry?.tabId || null
      })
      : { ok: true, reason: 'legacy_no_run_identity' };
    entry.lastRunIdentityDecision = {
      ...identityDecision,
      decidedAt: Date.now()
    };
    if (!identityDecision.ok) {
      self.DecisionLedger?.append?.(entry, {
        decision: 'ignore_stale_event',
        reason: identityDecision.reason || 'stale_event',
        source: 'handleLLMResponse',
        inputs: { identityDecision },
        resultingState: entry.finalStatus || entry.status || 'open'
      });
      appendLogEntry(llmName, {
        type: 'RESPONSE',
        label: 'Response ignored (stale identity)',
        details: identityDecision.reason || 'stale_event',
        level: 'warning',
        meta: { identityDecision }
      });
      emitTelemetry(llmName, 'STALE_EVENT_QUARANTINED', {
        level: 'warning',
        details: identityDecision.reason || 'stale_event',
        meta: { identityDecision },
        force: true
      });
      return;
    }
  }
  // Reject the previous on-page answer reported as if it were the new one. On a
  // follow-up the answer-start/extraction can latch onto the prior answer (it arrives
  // instantly at full length); finalizing it is a false success. The baseline was
  // captured before this dispatch's submit, so a genuine new answer differs from it.
  if (entry && earlyIsSuccess) {
    const guardDispatchId = (metaObj && typeof metaObj.dispatchId === 'string' ? metaObj.dispatchId : null)
      || entry?.confirmedDispatchId
      || entry?.lastDispatchMeta?.dispatchId
      || null;
    if (isStaleBaselineCandidate(entry, earlyAnswerText, guardDispatchId)) {
      appendLogEntry(llmName, {
        type: 'RESPONSE',
        label: 'Response ignored (stale baseline)',
        details: `len=${earlyAnswerText.length}`,
        level: 'warning',
        meta: { dispatchId: guardDispatchId }
      });
      emitTelemetry(llmName, 'STALE_BASELINE_ANSWER_IGNORED', {
        level: 'warning',
        details: `len=${earlyAnswerText.length}`,
        meta: { dispatchId: guardDispatchId, source: earlySource || null },
        force: true
      });
      return;
    }
  }
  if (self.PipelineFSM?.shouldAcceptEvent) {
    const acceptance = self.PipelineFSM.shouldAcceptEvent(pipelineControl, {
      pipelineRunId: incomingPipelineRunId,
      llmName,
      dispatchId: metaObj?.dispatchId || entry?.lastDispatchMeta?.dispatchId || null,
      tabSessionId: incomingTabSessionId,
      kind: 'final',
      finalStatus: earlyFinalStatus,
      allowRecoveredFinal: allowRecoveredFinalOverride
    });
    if (!acceptance.ok) {
      appendLogEntry(llmName, {
        type: 'RESPONSE',
        label: 'Response ignored (pipeline control)',
        details: acceptance.reason || 'pipeline_control_reject',
        level: 'warning',
        meta: {
          pipelineRunId: incomingPipelineRunId || null,
          dispatchId: metaObj?.dispatchId || entry?.lastDispatchMeta?.dispatchId || null,
          reason: acceptance.reason || null
        }
      });
      return;
    }
  }
  if (entry && typeof self.markModelRuntimeActivity === 'function') {
    self.markModelRuntimeActivity(llmName, Date.now(), 'llm_response');
  }

  const responseMeta = (() => {
    if (!metaObj || typeof metaObj !== 'object') return {};
    const merged = {};
    const candidates = [
      metaObj.response,
      metaObj.responseMeta,
      metaObj.answerMeta,
      metaObj.pipelineMeta
    ];
    candidates.forEach((candidate) => {
      if (candidate && typeof candidate === 'object') {
        Object.assign(merged, candidate);
      }
    });
    return merged;
  })();
  const answerMeta = responseMeta?.answer && typeof responseMeta.answer === 'object' ? responseMeta.answer : null;
  const sanityWarnings = Array.isArray(responseMeta?.sanityWarnings) ? responseMeta.sanityWarnings : [];
  const sanityConfidence = typeof responseMeta?.sanityConfidence === 'number' ? responseMeta.sanityConfidence : null;
  const completionReasonRaw = responseMeta?.completionReason || responseMeta?.answerReason || answerMeta?.reason || null;
  const completionReason = completionReasonRaw ? String(completionReasonRaw).toLowerCase() : null;
  const hardStopReason = responseMeta?.hardStopReason || answerMeta?.hardStopReason || null;
  const sendConfirmed = typeof responseMeta?.sendConfirmed === 'boolean'
    ? responseMeta.sendConfirmed
    : (typeof responseMeta?.confirmed === 'boolean' ? responseMeta.confirmed : null);
  const sendMethod = responseMeta?.sendMethod || responseMeta?.method || null;
  const responseSource = responseMeta?.source || responseMeta?.answerSource || null;
  const failureClassification = classifyFailure(error, {
    responseMeta,
    responseSource,
    sendConfirmed,
    finalReason: error?.type || error?.message || null,
    isSuccess: false
  });
  const manualTerminalOverrideRequested = Boolean(
    metaObj?.manualRecovery
    || responseMeta?.manualRecovery
    || responseMeta?.manualOverride
  );

  if (error?.type === 'concurrent_request') {
    const now = Date.now();
    const busyForMs = 60000;
    if (entry) {
      entry.csBusyUntil = now + busyForMs;
      saveJobState(jobState);
    }
    appendLogEntry(llmName, {
      type: 'RESPONSE',
      label: 'Request already running (content)',
      details: error?.message || String(answer || ''),
      level: 'warning'
    });
    broadcastDiagnostic(llmName, {
      type: 'DISPATCH',
      label: 'Request already running (content)',
      details: `${busyForMs}ms`,
      level: 'warning'
    });
    resolvePromptSubmitted(llmName, { ok: false, busy: true, ts: now, meta: metaObj });
    return;
  }

  if (error && (error.type === 'rate_limit' || error.type === 'captcha_detected')) {
    globalThis.LLMLog?.debug?.(`[API-FALLBACK] Triggered for ${llmName} due to error: ${error.type}`);
    if (error.type === 'rate_limit') {
      setRateLimit(llmName, 60000, error?.message);
    }
    isApiTransportFeatureEnabled()
      .then((enabled) => {
        if (!enabled) {
          recordApiTransportFeatureDisabled(llmName, [], 'error_fallback');
          handleLLMResponse(
            llmName,
            answer || '',
            { type: 'fallback_unavailable' },
            meta
          );
          return null;
        }
        return executeApiFallback(llmName, jobState.prompt);
      })
      .then((started) => {
        if (started === null) {
          return;
        }
        if (!started) {
          handleLLMResponse(
            llmName,
            '',
            self.RunError.makeRunError(self.RunError.CODES.FALLBACK_UNAVAILABLE, error?.message || 'API fallback unavailable'),
            meta
          );
        }
      })
      .catch((fallbackError) => {
        console.error('[API-FALLBACK] Failed to execute fallback:', fallbackError);
        handleLLMResponse(llmName, '', self.RunError.makeRunError(self.RunError.CODES.FALLBACK_FAILED, fallbackError?.message || 'API fallback failed'), meta);
      });
    return;
  }
  closePingWindowForLLM(llmName);
  clearPostSuccessScrollAudit(llmName);
  let normalizedAnswer = '';
  let normalizedHtml = '';
  if (answer && typeof answer === 'object') {
    normalizedAnswer = String(answer.text || answer.answer || '');
    normalizedHtml = String(answer.html || answer.answerHtml || answerHtml || '');
  } else {
    normalizedAnswer = typeof answer === 'string' ? answer : (answer ?? '');
    normalizedHtml = typeof answerHtml === 'string' ? answerHtml : '';
  }
  let trimmedAnswer = String(normalizedAnswer || '').trim();
  if (!error && !trimmedAnswer) {
    error = { type: 'empty_answer', message: 'Empty answer received from content script' };
    normalizedAnswer = '';
    trimmedAnswer = '';
  }
  const answerContentClassification = trimmedAnswer
    ? self.AnswerContentClassifier?.classify?.(trimmedAnswer, {
      prompt: jobState?.prompt || '',
      minValid: 20,
      internalError: !!error
    })
    : null;
  if (answerContentClassification?.contentClass === 'technical_message') {
    emitTelemetry(llmName, 'ANSWER_SANITY_REJECTED', {
      level: 'warning',
      details: 'technical_message_candidate',
      meta: {
        reason: answerContentClassification.reason || 'technical_message_candidate',
        answerLength: trimmedAnswer.length,
        answerHash: hashEvidenceText(trimmedAnswer),
        dispatchId: metaObj?.dispatchId || entry?.lastDispatchMeta?.dispatchId || null,
        source: responseSource || null
      },
      force: true
    });
    error = error || {
      type: 'answer_technical_message',
      message: 'Adapter transport diagnostic received instead of an answer'
    };
    normalizedAnswer = '';
    normalizedHtml = '';
    trimmedAnswer = '';
  }
  if (!error && ['ui_noise', 'provider_error'].includes(answerContentClassification?.contentClass)) {
    const rejectedClass = answerContentClassification.contentClass;
    emitTelemetry(llmName, 'ANSWER_SANITY_REJECTED', {
      level: 'warning',
      details: `${rejectedClass}_candidate`,
      meta: {
        reason: answerContentClassification.reason || `${rejectedClass}_candidate`,
        answerLength: trimmedAnswer.length,
        answerHash: hashEvidenceText(trimmedAnswer),
        dispatchId: metaObj?.dispatchId || entry?.lastDispatchMeta?.dispatchId || null,
        source: responseSource || null
      },
      force: true
    });
    const message = rejectedClass === 'provider_error'
      ? 'Provider returned an overload/error surface instead of an answer'
      : 'Extracted text is prompt/UI scaffolding, not an answer';
    error = { type: `answer_${rejectedClass}`, message };
    normalizedAnswer = '';
    normalizedHtml = '';
    trimmedAnswer = '';
  }
  if (!error && trimmedAnswer && isPromptEchoAnswerCandidate(trimmedAnswer, jobState?.prompt || '')) {
    emitTelemetry(llmName, 'ANSWER_SANITY_REJECTED', {
      level: 'warning',
      details: 'prompt_echo_candidate',
      meta: {
        reason: 'prompt_echo_candidate',
        answerLength: trimmedAnswer.length,
        answerHash: hashEvidenceText(trimmedAnswer),
        promptLength: String(jobState?.prompt || '').length,
        dispatchId: metaObj?.dispatchId || entry?.lastDispatchMeta?.dispatchId || null,
        source: responseSource || null
      },
      force: true
    });
    error = { type: 'answer_prompt_echo', message: 'Extracted answer matches original prompt' };
    normalizedAnswer = '';
    normalizedHtml = '';
    trimmedAnswer = '';
  }
  //- 1.1. Fix Claude: Если текст ответа получен (>50 символов), считаем это частичным успехом, а не фатальной ошибкой -//
  const hasAnswerContent = trimmedAnswer.length > 50;
  const isClaude = llmName.toLowerCase().includes('claude');
  const hardTimeoutLike = Boolean(
    (error?.type === 'hard_timeout'
      || completionReason === 'hard_timeout'
      || getRecentPipelineErrorReason(entry).includes('hard_timeout'))
    && error?.type !== 'hard_timeout_retry_exhausted'
  );
  if (isClaude && entry && hardTimeoutLike && !hasAnswerContent) {
    if (!entry.hardTimeoutRetryDone) {
      const sessionId = jobState?.session?.startTime || null;
      if (scheduleClaudeHardTimeoutRetry(llmName, entry, metaObj, sessionId)) {
        appendLogEntry(llmName, {
          type: 'PIPELINE',
          label: 'PIPELINE_ERROR (degraded)',
          details: 'hard_timeout',
          level: 'warning',
          meta: { degraded: true, degradedReason: 'hard_timeout', retry: 'scheduled' }
        });
        emitTelemetry(llmName, 'PIPELINE_ERROR', {
          level: 'warning',
          details: 'hard_timeout',
          meta: { degraded: true, degradedReason: 'hard_timeout', retry: 'scheduled' }
        });
        updateModelState(llmName, 'RECOVERABLE_ERROR', {
          message: 'hard_timeout_retry_scheduled',
          degradedReason: 'hard_timeout'
        });
        return;
      }
    } else if (entry.hardTimeoutRetryInFlight) {
      appendLogEntry(llmName, {
        type: 'RESPONSE',
        label: 'Response deferred (retry in flight)',
        details: 'hard_timeout',
        level: 'warning'
      });
      return;
    }
  }
  let isSuccess = !error && !!String(normalizedAnswer || '').trim();
  const manualLatestRecovery = Boolean(
    responseMeta?.manualLatestRecovery
    || metaObj?.manualLatestRecovery
    || String(responseSource || metaObj?.source || '').toLowerCase() === 'manual_latest_recovery'
  );
  // Grok explicitly reports confirmed:false when every send strategy fails. A later
  // broad DOM/manual-ping scrape must not turn composer text or an old page fragment
  // into SUCCESS. Messages from the same content script are ordered, so a real Grok
  // response always follows its accepted PROMPT_SUBMITTED signal.
  const grokSubmissionUnconfirmed = Boolean(
    isSuccess
    && llmName === 'Grok'
    && entry
    && !entry.promptSubmittedAt
    && sendConfirmed !== true
    && !manualLatestRecovery
    && !String(responseSource || '').toLowerCase().includes('api')
  );
  if (grokSubmissionUnconfirmed) {
    emitTelemetry(llmName, 'ANSWER_SANITY_REJECTED', {
      level: 'warning',
      details: 'grok_submit_unconfirmed',
      meta: {
        reason: 'grok_submit_unconfirmed',
        answerLength: trimmedAnswer.length,
        answerHash: hashEvidenceText(trimmedAnswer),
        dispatchId: metaObj?.dispatchId || entry?.lastDispatchMeta?.dispatchId || null,
        source: responseSource || null
      },
      force: true
    });
    error = { type: 'send_failed', message: 'Grok submission was not confirmed; extracted page text was rejected' };
    normalizedAnswer = '';
    normalizedHtml = '';
    trimmedAnswer = '';
  }
  isSuccess = !error && !!String(normalizedAnswer || '').trim();
  const lockedStatusBeforeCandidate = String(entry?.finalStatus || entry?.status || '').toUpperCase();
  const responseSourceIsApi = String(responseSource || metaObj?.source || '').toLowerCase().includes('api');
  const blockUnconfirmedNoSendUpgrade = Boolean(
    isSuccess
    && entry
    && entry.finalStatusRecorded
    && lockedStatusBeforeCandidate === 'NO_SEND'
    && !entry.promptSubmittedAt
    && entry.submitSource !== 'content'
    && entry.submitSource !== 'inferred_answer_evidence'
    && !manualLatestRecovery
    && llmName !== 'Qwen'
    && !responseSourceIsApi
  );
  if (blockUnconfirmedNoSendUpgrade) {
    emitTelemetry(llmName, 'TERMINAL_UPGRADE_BLOCKED_UNCONFIRMED_SEND', {
      level: 'warning',
      details: `NO_SEND -> SUCCESS blocked source=${responseSource || metaObj?.source || 'unknown'} len=${trimmedAnswer.length}`,
      meta: {
        dispatchId: metaObj?.dispatchId || entry?.lastDispatchMeta?.dispatchId || null,
        source: responseSource || metaObj?.source || null,
        answerLength: trimmedAnswer.length,
        promptSubmittedAt: entry?.promptSubmittedAt || null,
        submitSource: entry?.submitSource || null,
        reason: 'locked_no_send_without_current_dispatch_confirmation'
      },
      force: true
    });
    appendLogEntry(llmName, {
      type: 'RECOVERY',
      label: 'Response ignored (NO_SEND submit unconfirmed)',
      details: 'Recovered text cannot upgrade an unsubmitted dispatch',
      level: 'warning',
      meta: { source: responseSource || metaObj?.source || null, answerLength: trimmedAnswer.length }
    });
    return;
  }
  const answerEvidence = self.AnswerEvidence?.buildAnswerEvidence?.({
    llmName,
    text: trimmedAnswer,
    html: normalizedHtml,
    source: responseSource || metaObj?.source || null,
    responseMeta,
    dispatchId: metaObj?.dispatchId || entry?.lastDispatchMeta?.dispatchId || null,
    tabId: entry?.tabId || null,
    promptConfirmed: sendConfirmed,
    minChars: DOM_SNAPSHOT_RECOVERY_MIN_CHARS,
    stableMinChars: DEFER_STREAM_STABLE_FORCE_MIN_CHARS
  }) || null;
  const answerEvidencePolicy = self.AnswerEvidence?.shouldFinalizeWithEvidence?.(answerEvidence, {
    minChars: DOM_SNAPSHOT_RECOVERY_MIN_CHARS
  }) || { ok: false };
  const allowManualTerminalOverride = Boolean(manualTerminalOverrideRequested && isSuccess && trimmedAnswer.length >= DOM_SNAPSHOT_RECOVERY_MIN_CHARS);
  if (isSuccess && entry) {
    inferPromptSubmittedFromAnswerEvidence(llmName, entry, {
      trimmedAnswer,
      responseMeta,
      responseSource,
      metaObj
    });
  }
  if (isSuccess && maybeDeferStreamingFinalization(llmName, normalizedAnswer, metaObj, normalizedHtml, normalizedAnswer)) {
    return;
  }
  if (isSuccess && entry && (entry.hardTimeoutRetryInFlight || entry.hardTimeoutRetryDone)) {
    clearClaudeRetryTimers(llmName);
    entry.hardTimeoutRetryInFlight = false;
  }
  if (!isSuccess) {
    normalizedHtml = '';
  }
  const partialSignals = new Set(['hard_timeout', 'soft_timeout', 'stream_start_timeout', 'streaming_incomplete']);
  const MIN_PARTIAL_ANSWER_LENGTH = self.AnswerLengthPolicy?.DEFAULTS?.minPartialChars || 120;
  const hasPartialWarnings = sanityWarnings.some((warning) =>
    ['streaming_active', 'content_growing', 'hard_timeout'].includes(String(warning || '').toLowerCase())
  );
  const completionSuggestsPartial = completionReason && partialSignals.has(completionReason);
  const shortAnswer = trimmedAnswer.length > 0 && trimmedAnswer.length < MIN_PARTIAL_ANSWER_LENGTH;
  const fullSnapshotCompletionEvidence = hasFullSnapshotCompletionEvidence(
    entry,
    trimmedAnswer.length,
    completionReason,
    responseSource
  );
  // A run whose own proof came out unproven must not land as SUCCESS. The
  // clause below it only reads partialAllowed when the policy accepted the
  // evidence, and an unproven result is exactly the case the policy rejects —
  // so without this term the rejection had no effect on the status at all.
  const unprovenRunResult = ['UNKNOWN', 'OBSERVER_LOST', 'FAILED', 'CANCELLED']
    .includes(String(answerEvidence?.resultType || '').toUpperCase());
  const isPartial = Boolean(
    (responseMeta?.partial && !fullSnapshotCompletionEvidence)
    || responseMeta?.degraded
    || (completionSuggestsPartial && (shortAnswer || trimmedAnswer.length >= DOM_SNAPSHOT_RECOVERY_MIN_CHARS))
    || unprovenRunResult
    || (answerEvidencePolicy.ok && answerEvidence?.partialAllowed)
    || hasPartialWarnings
    || (typeof sanityConfidence === 'number' && sanityConfidence < 0.7)
  );
  const streamTimeoutHidden = completionReason === 'hard_timeout' && hardStopReason === 'hidden';
  let finalStatus = 'ERROR';
  let finalReason = null;
  if (isSuccess) {
    finalStatus = isPartial ? (streamTimeoutHidden ? 'STREAM_TIMEOUT_HIDDEN' : 'PARTIAL') : 'SUCCESS';
    const normalizedReason = (!isPartial && completionSuggestsPartial) ? 'ok' : completionReason;
    finalReason = normalizedReason || (isPartial ? 'partial' : 'ok');
  } else {
    finalStatus = deriveFailureFinalStatus(error, sendConfirmed, failureClassification);
    finalReason = error?.type || error?.message || 'error';
  }

  if (
    isSuccess
    && finalStatus === 'SUCCESS'
    && !manualTerminalOverrideRequested
    && maybeDeferEarlyTerminalSuccess(llmName, entry, {
      trimmedAnswer,
      normalizedAnswer,
      normalizedHtml,
      responseSource,
      completionReason,
      metaObj,
      sendConfirmed
    })
  ) {
    return;
  }

  const isHardStopError = String(error?.type || finalReason || '').toLowerCase() === 'script_runtime_hard_stop';
  const incomingDispatchId = metaObj?.dispatchId || entry?.lastDispatchMeta?.dispatchId || null;
  const hardStopDeferWindowMs = resolveHardStopDeferWindowMs(llmName);
  if (
    entry
    && isHardStopError
    && !metaObj?.hardStopDeferredRetry
    && !entry.finalStatusRecorded
  ) {
    const now = Date.now();
    const lastRuntimeActivityAt = Number(entry.lastRuntimeActivityAt || 0);
    const hasRecentRuntime = lastRuntimeActivityAt > 0 && (now - lastRuntimeActivityAt) <= HARD_STOP_ACTIVITY_GRACE_MS;
    const hasTransportSignal = Number(entry.pingTransportErrorCount || 0) >= 2;
    const alreadyDeferred = Number(entry.hardStopDeferredAt || 0) > 0
      && String(entry.hardStopDeferredDispatchId || '') === String(incomingDispatchId || '');
    if (!alreadyDeferred && (hasRecentRuntime || hasTransportSignal)) {
      entry.hardStopDeferredAt = now;
      entry.hardStopDeferredDispatchId = incomingDispatchId || null;
      updateModelState(llmName, 'RECOVERABLE_ERROR', {
        message: 'script_runtime_hard_stop_deferred',
        deferredMs: hardStopDeferWindowMs
      });
      emitTelemetry(llmName, 'HARD_STOP_DEFERRED', {
        level: 'warning',
        details: `${hardStopDeferWindowMs}ms`,
        meta: {
          dispatchId: incomingDispatchId,
          hasRecentRuntime,
          hasTransportSignal,
          lastRuntimeActivityAt,
          pingTransportErrorCount: Number(entry.pingTransportErrorCount || 0)
        },
        force: true
      });
      const deferredTabId = resolveBoundTabIdForOrchestrator(llmName, entry);
      if (isValidTabId(deferredTabId)) {
        triggerResponseCollectionPing(llmName, deferredTabId, 'hard_stop_deferred');
      }
      const deferredSessionId = getActiveSessionId();
      registerSessionTimer(setTimeout(async () => {
        const liveEntry = jobState?.llms?.[llmName];
        if (!liveEntry || liveEntry.finalStatusRecorded) return;
        if (String(liveEntry.hardStopDeferredDispatchId || '') !== String(incomingDispatchId || '')) return;
        const liveTabId = resolveBoundTabIdForOrchestrator(llmName, liveEntry);
        const canRunRecovery = HARD_STOP_DEFER_RECOVERY_MODELS.has(llmName) && isValidTabId(liveTabId);
        if (canRunRecovery) {
          emitTelemetry(llmName, 'HARD_STOP_DEFERRED_RECOVERY_START', {
            level: 'warning',
            details: 'deferred_hard_stop_recovery',
            meta: { dispatchId: incomingDispatchId, tabId: liveTabId }
          });
          try {
            await runForcedAutomationVisits(llmName, liveTabId, deferredSessionId, {
              visits: 1,
              minMs: HARD_STOP_DEFER_RECOVERY_VISIT_MIN_MS,
              maxMs: HARD_STOP_DEFER_RECOVERY_VISIT_MAX_MS,
              reason: 'hard_stop_deferred_recovery'
            });
            triggerResponseCollectionPing(llmName, liveTabId, 'hard_stop_deferred_recovery');
            await orchestratorSleepMs(1200);
            const afterRecovery = jobState?.llms?.[llmName];
            if (!afterRecovery || afterRecovery.finalStatusRecorded) return;
            triggerResponseCollectionPing(llmName, liveTabId, 'hard_stop_deferred_recovery_followup');
            await orchestratorSleepMs(900);
            const afterFollowup = jobState?.llms?.[llmName];
            if (!afterFollowup || afterFollowup.finalStatusRecorded) return;
            emitTelemetry(llmName, 'HARD_STOP_DEFERRED_RECOVERY_END', {
              level: 'warning',
              details: 'recovery_exhausted_without_terminal',
              meta: { dispatchId: incomingDispatchId, tabId: liveTabId }
            });
          } catch (recoveryErr) {
            emitTelemetry(llmName, 'HARD_STOP_DEFERRED_RECOVERY_ERROR', {
              level: 'warning',
              details: recoveryErr?.message || String(recoveryErr),
              meta: { dispatchId: incomingDispatchId, tabId: liveTabId }
            });
          }
        }
        const retryEntry = jobState?.llms?.[llmName];
        if (!retryEntry || retryEntry.finalStatusRecorded) return;
        if (String(retryEntry.hardStopDeferredDispatchId || '') !== String(incomingDispatchId || '')) return;
        if (isValidTabId(liveTabId)) {
          emitTelemetry(llmName, 'HARD_STOP_DEFERRED_FINAL_PING', {
            level: 'warning',
            details: 'final_ping_before_error',
            meta: { dispatchId: incomingDispatchId, tabId: liveTabId }
          });
          triggerResponseCollectionPing(llmName, liveTabId, 'hard_stop_deferred_final_ping', {
            allowRecovery: true,
            maxAttempts: 4,
            baseDelay: 700,
            transportRetryDelays: HARD_STOP_PING_RETRY_DELAYS_MS
          });
          await orchestratorSleepMs(1400);
        }
        const afterFinalPing = jobState?.llms?.[llmName];
        if (!afterFinalPing || afterFinalPing.finalStatusRecorded) return;
        if (String(afterFinalPing.hardStopDeferredDispatchId || '') !== String(incomingDispatchId || '')) return;
        if (isValidTabId(liveTabId) && typeof self.recoverAnswerViaDomSnapshot === 'function') {
          const recovered = await self.recoverAnswerViaDomSnapshot(llmName, liveTabId, 'hard_stop_deferred_final_snapshot', {
            dispatchId: incomingDispatchId || null,
            hardStopDeferredRetry: true
          });
          if (recovered) return;
        }
        const afterSnapshotRecovery = jobState?.llms?.[llmName];
        if (!afterSnapshotRecovery || afterSnapshotRecovery.finalStatusRecorded) return;
        if (String(afterSnapshotRecovery.hardStopDeferredDispatchId || '') !== String(incomingDispatchId || '')) return;
        handleLLMResponse(
          llmName,
          '',
          { type: 'script_runtime_hard_stop', message: `Timed out after deferred window ${hardStopDeferWindowMs}ms` },
          {
            ...(metaObj || {}),
            dispatchId: incomingDispatchId || null,
            sessionId: deferredSessionId || undefined,
            runSessionId: deferredSessionId || undefined,
            hardStopDeferredRetry: true
          },
          ''
        );
      }, hardStopDeferWindowMs));
      return;
    }
  }

  if (maybeDeferTerminalFailureForMaterialization(
    llmName,
    entry,
    finalStatus,
    finalReason,
    error,
    metaObj,
    normalizedAnswer,
    normalizedHtml
  )) {
    return;
  }

  const lockedFinalStatus = String(entry?.finalStatus || '').toUpperCase();
  const incomingStatus = String(finalStatus || '').toUpperCase();
  const lockedRank = getTerminalRank(lockedFinalStatus);
  const incomingRank = getTerminalRank(incomingStatus);
  let allowTerminalUpgrade = false;
  const finalizationController = self.FinalizationController;
  const finalizationControl = finalizationController?.tryFinalize
    ? finalizationController.tryFinalize(entry || {}, {
      finalStatus,
      dispatchId: incomingDispatchId,
      trimmedAnswer,
      allowManualTerminalOverride,
      allowRecoveredFinalOverride
    })
    : { ok: true, action: 'accept', reason: 'legacy_no_finalization_controller', allowTerminalUpgrade: false };
  if (entry) {
    entry.finalizationControllerDecision = {
      action: finalizationControl.action || null,
      reason: finalizationControl.reason || null,
      incomingStatus,
      lockedFinalStatus,
      incomingRank,
      lockedRank,
      dispatchId: incomingDispatchId || null,
      decidedAt: Date.now()
    };
    self.DecisionLedger?.append?.(entry, {
      decision: finalizationControl.ok
        ? (finalizationControl.allowTerminalUpgrade ? 'upgrade_terminal' : (isSuccess ? 'accept_success' : 'finalize_error'))
        : (finalizationControl.reason === 'duplicate_terminal' ? 'ignore_duplicate_final' : 'reject_final_candidate'),
      reason: finalizationControl.reason || null,
      source: 'FinalizationController',
      inputs: {
        finalizationControl,
        finalStatus,
        incomingDispatchId
      },
      resultingState: finalizationControl.finalStatusOverride || finalStatus
    });
  }
  if (finalizationControl.action === 'keep_locked_status') {
    appendLogEntry(llmName, {
      type: 'RESPONSE',
      label: 'Manual response kept terminal status',
      details: `locked=${lockedFinalStatus} incoming=${incomingStatus}`,
      level: 'info',
      meta: {
        lockedFinalStatus,
        incomingStatus,
        lockedRank,
        incomingRank,
        dispatchId: incomingDispatchId
      }
    });
    finalStatus = finalizationControl.finalStatusOverride || lockedFinalStatus;
    finalReason = `manual_recovery_kept_${lockedFinalStatus.toLowerCase()}`;
  }
  if (!finalizationControl.ok && finalizationControl.reason === 'terminal_success_locked') {
    const staleDispatchId = metaObj?.dispatchId || entry?.lastDispatchMeta?.dispatchId || null;
    if (typeof self.clearScriptRuntimeHardStop === 'function') {
      self.clearScriptRuntimeHardStop(llmName, staleDispatchId || null);
    }
    appendLogEntry(llmName, {
      type: 'RESPONSE',
      label: 'Response ignored (terminal success locked)',
      details: `locked=${lockedFinalStatus} incoming=${incomingStatus}`,
      level: 'warning',
      meta: {
        lockedFinalStatus,
        incomingStatus,
        dispatchId: staleDispatchId
      }
    });
    return;
  }
  if (!finalizationControl.ok && finalizationControl.reason === 'terminal_rank_downgrade') {
    appendLogEntry(llmName, {
      type: 'RESPONSE',
      label: 'Response ignored (terminal rank downgrade)',
      details: `locked=${lockedFinalStatus} incoming=${incomingStatus}`,
      level: 'warning',
      meta: {
        lockedFinalStatus,
        incomingStatus,
        lockedRank,
        incomingRank,
        dispatchId: incomingDispatchId
      }
    });
    return;
  }
  if (finalizationControl.reason === 'terminal_failure_upgraded_by_recovered_answer') {
    allowTerminalUpgrade = true;
    appendLogEntry(llmName, {
      type: 'RESPONSE',
      label: 'Terminal failure upgraded by recovered answer evidence',
      details: `${lockedFinalStatus} -> ${incomingStatus}`,
      level: 'success',
      meta: {
        lockedFinalStatus,
        incomingStatus,
        dispatchId: incomingDispatchId,
        recoverySource: responseSource || null
      }
    });
  } else if (finalizationControl.reason === 'terminal_rank_upgrade') {
    allowTerminalUpgrade = true;
    appendLogEntry(llmName, {
      type: 'RESPONSE',
      label: 'Terminal status upgraded',
      details: `${lockedFinalStatus} -> ${incomingStatus}`,
      level: 'warning',
      meta: {
        lockedFinalStatus,
        incomingStatus,
        lockedRank,
        incomingRank,
        dispatchId: incomingDispatchId
      }
    });
  }
  if (!finalizationControl.ok && finalizationControl.reason === 'duplicate_terminal') {
    const lockedDispatchId = finalizationControl.lockedDispatchId || entry?.confirmedDispatchId || entry?.lastDispatchMeta?.dispatchId || null;
    if (typeof self.clearScriptRuntimeHardStop === 'function') {
      self.clearScriptRuntimeHardStop(llmName, incomingDispatchId || lockedDispatchId || null);
    }
    appendLogEntry(llmName, {
      type: 'RESPONSE',
      label: 'Response ignored (duplicate terminal)',
      details: `locked=${lockedFinalStatus} incoming=${incomingStatus}`,
      level: 'warning',
      meta: {
        lockedFinalStatus,
        incomingStatus,
        dispatchId: incomingDispatchId || lockedDispatchId || null,
        finalizationController: finalizationControl
      }
    });
    return;
  }
  if (!finalizationControl.ok) {
    appendLogEntry(llmName, {
      type: 'RESPONSE',
      label: 'Response ignored (finalization controller)',
      details: finalizationControl.reason || 'finalization_rejected',
      level: 'warning',
      meta: {
        lockedFinalStatus,
        incomingStatus,
        dispatchId: incomingDispatchId || null,
        finalizationController: finalizationControl
      }
    });
    return;
  }

  const modelFinalStatus = resolveModelFinalStatus(finalStatus, finalReason, error);
  const doneReason = resolveModelDoneReason({ completionReason, finalStatus, finalReason, error });
  const answerCandidate = buildAnswerCandidate(llmName, entry, {
    trimmedAnswer,
    normalizedHtml,
    finalStatus,
    finalReason,
    metaObj,
    responseMeta,
    responseSource
    , answerEvidence
  });
  const answerEvaluation = submitAnswerCandidate(llmName, entry, answerCandidate, {
    finalStatus,
    finalReason,
    modelFinalStatus,
    doneReason,
    error,
    metaObj,
    responseMeta,
    responseSource,
    trimmedAnswer,
    answerEvidence,
    sendConfirmed,
    completionReason,
    failureClassification: isSuccess ? null : failureClassification,
    allowTerminalUpgrade
  });
  const finalizationEvidence = answerEvaluation.evidence;
  const answerAttemptId = finalizationEvidence?.answerEvidence?.attemptId
    || metaObj?.attemptId || responseMeta?.attemptId || metaObj?.sourceRevisionId || null;
  const acceptedPayloadProof = self.AnswerProofNormalization?.evidence?.(trimmedAnswer, {
    dispatchId: incomingDispatchId,
    attemptId: answerAttemptId
  }) || null;
  if (entry && isSuccess && trimmedAnswer && incomingDispatchId && acceptedPayloadProof) {
    const materializationKey = [
      incomingDispatchId,
      answerAttemptId || 'attempt-none',
      acceptedPayloadProof.payloadEvidenceId || acceptedPayloadProof.normalizedHash || trimmedAnswer.length
    ].join('|');
    if (entry.lastAnswerMaterializationTelemetryKey !== materializationKey) {
      entry.lastAnswerMaterializationTelemetryKey = materializationKey;
      const proofMeta = {
        dispatchId: incomingDispatchId,
        generationEpoch: metaObj?.generationEpoch
          ?? entry?.lastDispatchMeta?.generationEpoch
          ?? entry?.generationEpoch
          ?? null,
        attemptId: answerAttemptId || entry?.lastDispatchMeta?.attemptId || null,
        payloadEvidenceId: acceptedPayloadProof.payloadEvidenceId || null,
        normalizationVersion: acceptedPayloadProof.normalizationVersion || null,
        normalizedLength: acceptedPayloadProof.normalizedLength ?? trimmedAnswer.length,
        normalizedHash: acceptedPayloadProof.normalizedHash || null,
        candidateId: finalizationEvidence?.answerEvidence?.candidateId || null,
        answerIdentity: finalizationEvidence?.answerEvidence?.dispatchId
          ? (String(finalizationEvidence.answerEvidence.dispatchId) === String(incomingDispatchId)
              ? 'current_dispatch'
              : 'previous_dispatch')
          : 'current_dispatch',
        source: responseSource || finalizationEvidence?.source || 'handleLLMResponse'
      };
      emitTelemetry(llmName, 'ANSWER_SOURCE_MATERIALIZED', {
        level: 'info',
        details: 'normalized_answer_available',
        meta: proofMeta,
        force: true
      });
      emitTelemetry(llmName, 'ANSWER_EXTRACTION_COMPLETED', {
        level: 'info',
        details: 'completed',
        meta: { ...proofMeta, status: 'completed', outcome: 'completed' },
        force: true
      });
    }
  }
  recordModelRunState(llmName, entry, finalizationEvidence);
  if (entry) {
    entry.finalizationEvidence = finalizationEvidence;
  }
  // handleLLMResponse re-runs on every streaming poll. When finalization keeps
  // getting blocked for the same unchanged candidate (e.g. answer_not_verified
  // stuck pending auto-finalization), re-emitting the full FINALIZATION_DECISION
  // event every ~1-2s produced hundreds of near-duplicate events for one run
  // (telemetry export bloat, run 1785185340505). Accepted/terminal outcomes
  // always emit; repeated blocked outcomes for the same candidate only emit once.
  const finalizationDedupeKey = JSON.stringify({
    finalStatus: finalizationEvidence?.finalStatus || null,
    finalReason: finalizationEvidence?.finalReason || null,
    dispatchId: finalizationEvidence?.dispatchId || null,
    answerHash: finalizationEvidence?.answerHash || null,
    answerLength: finalizationEvidence?.answerLength || 0
  });
  const isRepeatBlockedFinalization = entry
    && !finalizationEvidence?.accepted
    && entry.lastFinalizationDecisionDedupeKey === finalizationDedupeKey;
  if (entry) entry.lastFinalizationDecisionDedupeKey = finalizationDedupeKey;
  if (!isRepeatBlockedFinalization) {
    emitFinalizationDecision(llmName, finalizationEvidence);
  }

  if (finalizationEvidence?.success && finalizationEvidence?.lengthPolicy?.suspectShortSuccess) {
    emitTelemetry(llmName, 'ANSWER_LENGTH_SUSPECT', {
      level: 'warning',
      details: `success_len=${finalizationEvidence.answerLength} < suspect_max=${finalizationEvidence.lengthPolicy.shortSuccessSuspectMaxChars}`,
      meta: {
        ...finalizationEvidence.lengthPolicy,
        dispatchId: incomingDispatchId,
        source: finalizationEvidence.source || null
      },
      force: true
    });
  }

  // A materialized recovery explicitly classified as "unconfirmed complete"
  // is only an answer candidate. Do not turn it into a terminal PARTIAL when
  // the completion policy rejected it. Explicit hard-stop/deadline PARTIAL
  // outcomes keep their separate terminal contract.
  const unconfirmedRecoveredCompletion = isSuccess
    && finalizationEvidence.success
    && !finalizationEvidence.accepted
    && completionReason === 'materialize_recovered_unconfirmed_complete';
  if ((finalStatus === 'SUCCESS' && finalizationEvidence.success && !finalizationEvidence.accepted)
    || unconfirmedRecoveredCompletion) {
    entry.pendingFinalAnswer = normalizedAnswer;
    entry.pendingFinalAnswerHtml = normalizedHtml;
    emitTelemetry(llmName, 'TERMINAL_SUCCESS_BLOCKED_BY_ANSWER_EVIDENCE', {
      level: 'warning',
      details: `${finalStatus}:${finalizationEvidence.contradictions.join(',') || 'insufficient_answer_evidence'}`,
      meta: {
        finalStatus,
        finalReason,
        dispatchId: incomingDispatchId,
        answerLength: trimmedAnswer.length,
        contradictions: finalizationEvidence.contradictions
      },
      force: true
    });
    updateModelState(llmName, 'RECEIVING', {
      message: 'awaiting_stronger_answer_evidence',
      completionReason,
      responseSource
    });
    // 2.81.121 (principle 5). The answer is complete and already stored in
    // pendingFinalAnswer, but this path used to keep it invisible: the card went
    // orange with no text and the user had to press Get It or double-click to see
    // anything. Absence of proof is a statement about the proof, not about the
    // content — deliver it as a non-terminal labelled candidate instead of hiding
    // it. Field evidence: a full run where every answer was complete and carried
    // its end marker, yet nothing appeared until manual collection.
    if (trimmedAnswer) {
      sendMessageToResultsTab({
        type: 'LLM_PARTIAL_RESPONSE',
        llmName,
        answer: normalizedAnswer,
        answerHtml: normalizedHtml,
        requestId: entry?.requestId || null,
        metadata: {
          status: 'RECEIVING',
          terminal: false,
          answerState: 'candidate',
          verificationState: 'candidate',
          attributionState: 'unproven',
          attributionLabel: 'Verification pending',
          completenessState: 'complete',
          reason: finalizationEvidence.contradictions.join(',') || 'insufficient_answer_evidence',
          source: responseSource || null,
          dispatchId: incomingDispatchId,
          attemptId: answerAttemptId,
          payloadEvidenceId: acceptedPayloadProof?.payloadEvidenceId || null,
          normalizationVersion: acceptedPayloadProof?.normalizationVersion || null,
          normalizedLength: acceptedPayloadProof?.normalizedLength ?? trimmedAnswer.length,
          normalizedHash: acceptedPayloadProof?.normalizedHash || null,
          expectedCardId: expectedAnswerCardId(llmName)
        }
      });
    }
    const retryTabId = resolveBoundTabIdForOrchestrator(llmName, entry);
    if (isValidTabId(retryTabId)) {
      triggerResponseCollectionPing(llmName, retryTabId, 'terminal_success_evidence_blocked', {
        allowRecovery: true,
        maxAttempts: 3,
        baseDelay: 700
      });
    }
    saveJobState(jobState);
    broadcastGlobalState();
    return;
  }

  if (finalizationEvidence.terminalFailure && !finalizationEvidence.accepted) {
    const preservedAnswer = finalStatus === 'NO_SEND'
      ? ''
      : String(entry?.answer || entry?.pendingFinalAnswer || '').trim();
    const preservedHtml = finalStatus === 'NO_SEND' ? '' : String(entry?.answerHtml || entry?.pendingFinalAnswerHtml || '');
    emitTelemetry(llmName, 'TERMINAL_FAILURE_BLOCKED_BY_ANSWER_EVIDENCE', {
      level: preservedAnswer ? 'success' : 'warning',
      details: `${finalStatus}:${finalizationEvidence.contradictions.join(',') || 'answer_evidence'}`,
      meta: {
        finalStatus,
        finalReason,
        dispatchId: incomingDispatchId,
        hasPriorAnswer: !!finalizationEvidence.hasPriorAnswer,
        hasPendingFinalAnswer: !!finalizationEvidence.hasPendingFinalAnswer,
        hasAnswerEvidence: !!finalizationEvidence.hasAnswerEvidence,
        preservedAnswerLength: preservedAnswer.length,
        contradictions: finalizationEvidence.contradictions
      },
      force: true
    });
    // Do not re-green a failure with a fake answer. The preserved text must be a real
    // answer — not the prompt echo (incl. a short prompt-prefix fragment) and not a
    // suspect-short scrape. Otherwise EXTRACT_FAILED on an echo gets "preserved" back to
    // SUCCESS (Claude's 394 = answer_prompt_echo re-greened). Suspect ≠ green.
    const preservedEcho = isPromptEchoAnswerCandidate(preservedAnswer, jobState?.prompt || '');
    const preservedLengthPolicy = self.AnswerLengthPolicy?.evaluateTerminalAnswerLength?.(llmName, preservedAnswer.length, { finalStatus: 'SUCCESS' }) || {};
    const preservedSuspectShort = !!preservedLengthPolicy.suspectShortSuccess;
    if (preservedAnswer.length >= DOM_SNAPSHOT_RECOVERY_MIN_CHARS && !preservedEcho && !preservedSuspectShort) {
      handleLLMResponse(
        llmName,
        preservedAnswer,
        null,
        {
          ...(metaObj || {}),
          responseMeta: {
            ...(responseMeta || {}),
            source: 'terminal_failure_blocked_by_answer_evidence',
            completionReason: 'preserved_answer_evidence',
            recoveredFromStatus: finalStatus
          }
        },
        preservedHtml
      );
      return;
    }
    if (preservedAnswer.length >= DOM_SNAPSHOT_RECOVERY_MIN_CHARS && (preservedEcho || preservedSuspectShort)) {
      emitTelemetry(llmName, 'PRESERVED_EVIDENCE_REJECTED', {
        level: 'warning',
        details: preservedEcho ? 'prompt_echo' : 'suspect_short',
        meta: { dispatchId: incomingDispatchId, preservedAnswerLength: preservedAnswer.length, finalStatus },
        force: true
      });
    }
    updateModelState(llmName, 'RECOVERABLE_ERROR', {
      message: `terminal_failure_blocked_${String(finalStatus || '').toLowerCase()}`,
      originalStatus: finalStatus
    });
    appendLogEntry(llmName, {
      type: 'RESPONSE',
      label: 'Terminal failure blocked by answer evidence',
      details: finalizationEvidence.contradictions.join(',') || finalStatus,
      level: 'warning',
      meta: { finalizationEvidence }
    });
    saveJobState(jobState);
    broadcastGlobalState();
    return;
  }

  const dontAnswerDisplayText = shouldDisplayDontAnswerMessage(error, failureClassification, finalStatus)
    ? buildDontAnswerDisplayText(llmName)
    : '';
  if (dontAnswerDisplayText) {
    normalizedAnswer = dontAnswerDisplayText;
    normalizedHtml = '';
    trimmedAnswer = dontAnswerDisplayText;
    if (entry) {
      entry.answer = dontAnswerDisplayText;
      entry.answerHtml = '';
      entry.providerErrorDisplay = true;
      entry.providerErrorDisplayAt = Date.now();
    }
  }

  globalThis.LLMLog?.debug?.(`[BACKGROUND] Handling response from ${llmName}. Success: ${isSuccess}`);
  appendLogEntry(llmName, {
    type: 'RESPONSE',
    label: isSuccess
      ? (isPartial ? 'Answer received (partial)' : 'Answer received')
      : 'Response error',
    details: isSuccess ? '' : (error?.message || normalizedAnswer),
    level: isSuccess ? (isPartial ? 'warning' : 'success') : 'error',
    meta: {
      reason: finalReason,
      status: finalStatus,
      sendConfirmed,
      sendMethod,
      responseSource,
      completionReason,
      hardStopReason,
      sanityWarnings,
      sanityConfidence,
      failureClass: isSuccess ? null : failureClassification?.class || 'unknown',
      failureRecoveryFirst: isSuccess ? null : !!failureClassification?.recoveryFirst,
      terminalRequiresEvidenceMiss: isSuccess ? null : !!failureClassification?.terminalRequiresEvidenceMiss,
      finalizationEvidence
    }
  });
  // Persist accepted answer text before publishing SUCCESS. updateModelState emits
  // STATUS_UPDATE and a global-state broadcast synchronously; publishing the status
  // first created a durable "green but empty card" state when LLM_PARTIAL_RESPONSE
  // was missed by the results page.
  let answerCommitEvidence = null;
  if (entry && isSuccess) {
    answerCommitEvidence = commitAcceptedAnswer(llmName, entry, normalizedAnswer, normalizedHtml, {
      dispatchId: incomingDispatchId,
      attemptId: answerAttemptId,
      payloadEvidenceId: acceptedPayloadProof?.payloadEvidenceId || null,
      normalizationVersion: acceptedPayloadProof?.normalizationVersion || null,
      normalizedHash: acceptedPayloadProof?.normalizedHash || null
    });
    delete entry.unverifiedArtifact;
    entry.attributionState = finalizationEvidence?.answerVerified === true ? 'proven' : null;
  }
  updateModelState(llmName, finalStatus, {
    message: finalReason || '',
    completionReason,
    hardStopReason,
    failureClass: isSuccess ? null : failureClassification?.class || 'unknown',
    hasAnswer: Boolean(isSuccess && trimmedAnswer),
    answerLength: isSuccess ? trimmedAnswer.length : 0
  });
  clearBudgetPhases(llmName);
  clearAdaptiveCollectTimer(llmName);
  const answerLen = trimmedAnswer.length;
  const durationMs = entry?.lastDispatchAt ? Math.max(0, Date.now() - entry.lastDispatchAt) : null;
  const provider = entry?.provider || entry?.apiProvider || entry?.modelProvider || llmName;
  const focusSwitchesUsed = Number(entry?.focusSwitches || 0);
  const foregroundMsUsed = Number(entry?.humanVisitTotalMs || 0);
  const dispatchId = metaObj?.dispatchId || entry?.lastDispatchMeta?.dispatchId || null;
  const generationEpoch = metaObj?.generationEpoch
    ?? entry?.lastDispatchMeta?.generationEpoch
    ?? entry?.generationEpoch
    ?? null;
  const tabId = entry?.tabId || null;
  if (typeof self.clearScriptRuntimeHardStop === 'function') {
    self.clearScriptRuntimeHardStop(llmName, dispatchId || null);
  }
  if (self.PipelineFSM?.markFinal) {
    const control = jobState?.session?.pipelineControl || getActivePipelineControlState();
    const finalControl = self.PipelineFSM.markFinal(control, {
      llmName,
      dispatchId,
      tabSessionId: incomingTabSessionId || null,
      pipelineRunId: incomingPipelineRunId || null,
      finalStatus,
      reason: finalReason,
      sessionId: jobState?.session?.startTime || null
    });
    if (finalControl?.ok && finalControl.state) {
      persistPipelineControlState(finalControl.state);
    }
  }
  const finalEmitKey = `${modelFinalStatus}::${doneReason || ''}::${dispatchId || ''}`;
  const finalEmitAt = Number(entry?.lastFinalEmittedAt || 0);
  let skipModelFinalEmit = false;
  if (
    entry
    && entry.lastFinalEmitKey === finalEmitKey
    && finalEmitAt > 0
    && (Date.now() - finalEmitAt) < MODEL_FINAL_DEDUP_WINDOW_MS
  ) {
    appendLogEntry(llmName, {
      type: 'RESPONSE',
      label: 'MODEL_FINAL ignored (deduplicated)',
      details: `window=${MODEL_FINAL_DEDUP_WINDOW_MS}ms key=${finalEmitKey}`,
      level: 'warning',
      meta: {
        dispatchId,
        generationEpoch,
        modelFinalStatus,
        doneReason
      }
    });
    skipModelFinalEmit = true;
  } else if (entry) {
    entry.lastFinalEmitKey = finalEmitKey;
    entry.lastFinalEmittedAt = Date.now();
  }
  if (!skipModelFinalEmit) {
    emitTelemetry(llmName, 'MODEL_FINAL', {
      level: FAILURE_STATUSES.includes(modelFinalStatus)
        ? (modelFinalStatus === 'UNCERTAIN' ? 'warning' : 'error')
        : (modelFinalStatus === 'PARTIAL' ? 'warning' : 'success'),
      meta: {
        status: modelFinalStatus,
        doneReason,
        durationMs,
        answerLen,
        provider,
        focusSwitchesUsed,
        foregroundMsUsed,
        completionReason,
        finalStatus,
        finalReason,
        dispatchId,
        generationEpoch,
        tabId,
        answerEvidenceLength: finalizationEvidence?.answerEvidence
          ? Number(finalizationEvidence.answerEvidence.length || finalizationEvidence.answerEvidence.textLength || 0)
          : null,
        answerEvidenceDispatchId: finalizationEvidence?.answerEvidence?.dispatchId || null,
        answerEvidenceSource: finalizationEvidence?.answerEvidence?.source || null,
        answerEvidenceVerified: finalizationEvidence?.answerEvidence ? finalizationEvidence.answerVerified === true : null,
        answerEvidenceFreshTurnEvidence: finalizationEvidence?.answerEvidence?.freshTurnEvidence ?? null,
        answerIdentity: finalizationEvidence?.answerEvidence?.dispatchId && dispatchId
          ? (String(finalizationEvidence.answerEvidence.dispatchId) === String(dispatchId) ? 'current_dispatch' : 'previous_dispatch')
          : null,
        attemptId: answerCommitEvidence?.attemptId || answerAttemptId || entry?.lastDispatchMeta?.attemptId || null,
        payloadEvidenceId: answerCommitEvidence?.payloadEvidenceId || acceptedPayloadProof?.payloadEvidenceId || null,
        normalizedLength: answerCommitEvidence?.normalizedLength ?? acceptedPayloadProof?.normalizedLength ?? (isSuccess ? trimmedAnswer.length : null),
        normalizedHash: answerCommitEvidence?.normalizedHash || acceptedPayloadProof?.normalizedHash || null,
        normalizationVersion: answerCommitEvidence?.normalizationVersion || acceptedPayloadProof?.normalizationVersion || null,
        finalizationEvidence: summarizeFinalizationEvidenceForTelemetry(finalizationEvidence)
      },
      force: true
    });
  }
  sendMessageToResultsTab({
    type: 'LLM_PARTIAL_RESPONSE',
    llmName,
    answer: normalizedAnswer,
    answerHtml: normalizedHtml,
    requestId: entry?.requestId || jobState?.llms?.[llmName]?.requestId || null,
    metadata: {
      status: finalStatus,
      reason: finalReason,
      completionReason,
      hardStopReason,
      failureClass: isSuccess ? null : failureClassification?.class || 'unknown',
      failureRecoveryFirst: isSuccess ? null : !!failureClassification?.recoveryFirst,
      terminalRequiresEvidenceMiss: isSuccess ? null : !!failureClassification?.terminalRequiresEvidenceMiss,
      finalizationEvidence,
      dispatchId,
      attemptId: answerCommitEvidence?.attemptId || answerAttemptId,
      payloadEvidenceId: answerCommitEvidence?.payloadEvidenceId || acceptedPayloadProof?.payloadEvidenceId || null,
      normalizationVersion: answerCommitEvidence?.normalizationVersion || acceptedPayloadProof?.normalizationVersion || null,
      normalizedLength: answerCommitEvidence?.normalizedLength ?? acceptedPayloadProof?.normalizedLength ?? trimmedAnswer.length,
      normalizedHash: answerCommitEvidence?.normalizedHash || acceptedPayloadProof?.normalizedHash || null,
      expectedCardId: answerCommitEvidence?.expectedCardId || expectedAnswerCardId(llmName)
    },
    logs: getLogSnapshot(llmName)
  });

  const alreadyFinalized = entry?.finalStatusRecorded && entry?.finalizedAt && entry?.finalStatus;
  if (entry) {
    const projectedResponseMeta = isSuccess ? responseMeta : {
      ...(responseMeta || {}),
      failureClass: failureClassification?.class || 'unknown',
      failureType: failureClassification?.type || error?.type || null,
      failureRecoveryFirst: !!failureClassification?.recoveryFirst,
      terminalRequiresEvidenceMiss: !!failureClassification?.terminalRequiresEvidenceMiss
    };
    const finalProjection = {
      earlyTerminalGuard: null,
      earlyTerminalGuardNextPingAt: 0,
      transientBlocker: null,
      transientBlockerActive: null,
      transientBlockerActiveAt: 0,
      transientBlockerRunSessionId: null,
      transientBlockerDispatchId: null,
      transientBlockerTabId: null,
      responseMeta: projectedResponseMeta
    };
    if (!alreadyFinalized || allowTerminalUpgrade || allowManualTerminalOverride) {
      finalProjection.answer = normalizedAnswer;
      finalProjection.answerHtml = normalizedHtml;
      finalProjection.status = finalStatus;
      finalProjection.statusReason = finalReason;
    } else {
      const lockedStatus = String(entry.finalStatus || entry.status || 'ERROR').toUpperCase();
      finalProjection.status = lockedStatus;
      finalProjection.statusReason = entry.statusReason || 'terminal_locked';
    }
    if (finalStatus === 'SUCCESS' || finalStatus === 'PARTIAL' || finalStatus === 'STREAM_TIMEOUT_HIDDEN') {
      finalProjection.hardStopDeferredAt = 0;
      finalProjection.hardStopDeferredDispatchId = null;
    } else if (metaObj?.hardStopDeferredRetry || !isHardStopError) {
      finalProjection.hardStopDeferredAt = 0;
      finalProjection.hardStopDeferredDispatchId = null;
    }
    if (!alreadyFinalized || allowTerminalUpgrade || allowManualTerminalOverride) {
      finalProjection.finalStatusRecorded = true;
      finalProjection.finalizedAt = Date.now();
      finalProjection.finalStatus = finalStatus;
    }
    if (self.commitModelRunTransition || self.ModelRunState?.applyModelRunTransition) {
      const finalTransition = FAILURE_STATUSES.includes(finalStatus)
        ? 'TERMINAL_FAILURE'
        : 'ANSWER_CANDIDATE_ACCEPTED';
      const finalPayload = {
        status: finalStatus,
        reason: finalReason,
        answerLength: trimmedAnswer.length,
        answerHash: trimmedAnswer.length ? hashEvidenceText(trimmedAnswer) : null,
        dispatchId,
        tabId,
        runSessionId: jobState?.session?.startTime || null,
        manualRecovery: allowManualTerminalOverride,
        verified: finalizationEvidence?.answerVerified === true,
        allowTerminalUpgrade,
        failureClass: isSuccess ? null : failureClassification?.class || 'unknown',
        failureType: isSuccess ? null : failureClassification?.type || error?.type || null,
        source: 'handleLLMResponse_final_projection'
      };
      if (self.commitModelRunTransition) {
        self.commitModelRunTransition(llmName, entry, finalTransition, finalPayload);
      } else {
        self.ModelRunState.applyModelRunTransition(entry, finalTransition, finalPayload);
      }
    } else if (self.ModelRunState?.deriveModelRunState) {
      entry.modelRunState = self.ModelRunState.deriveModelRunState(entry);
    }
    if (typeof self.projectModelRunStateToLegacy === 'function') {
      self.projectModelRunStateToLegacy(llmName, entry, finalProjection, 'handleLLMResponse_final_projection');
    } else {
      Object.assign(entry, finalProjection);
      entry.statusContract = self.LLMStatusContract?.deriveStatusContract
        ? self.LLMStatusContract.deriveStatusContract(entry)
        : null;
    }
    self.AnswerVerification?.markLatestRevisionApplied?.(entry, {
      dispatchId, appliedTimestamp: Date.now(), verified: finalizationEvidence?.answerVerified === true,
      decision: isSuccess ? 'applied' : 'failure_applied'
    });
    self.AnswerVerification?.appendTimeline?.(entry, {
      stage: 'applied', state: finalStatus.toLowerCase(), dispatchId, tabId,
      source: responseSource || 'handleLLMResponse',
      details: { answerLength: trimmedAnswer.length, verified: finalizationEvidence?.answerVerified === true }
    });
  }

  if (!isSuccess && !metaObj?.automationDeadline) {
    scheduleTerminalExtractionRecovery(llmName, finalReason);
  }

  const machine = self.DispatchStateManager ? self.DispatchStateManager.get(llmName) : null;
  if (machine) {
    const states = self.DISPATCH_STATES || {};
    if (machine.is(states.IDLE)) {
      machine.queue({
        prompt: jobState?.prompt,
        attachments: jobState?.attachments || [],
        dispatchId: metaObj?.dispatchId || `${llmName}:${Date.now()}`
      });
    }
    if (machine.is(states.QUEUED)) {
      const boundTabId = resolveBoundTabIdForOrchestrator(llmName, entry);
      machine.activate({ tabId: boundTabId, inferred: true });
    }
    if (machine.is(states.ACTIVATING)) {
      machine.ready({ inferred: true });
    }
    if (machine.is(states.TYPING)) {
      machine.submit({ inferred: true });
    }
    if (machine.is(states.SUBMITTING)) {
      machine.sent({ inferred: true });
      if (entry && !entry.submitSource) {
        entry.submitSource = 'inferred';
      }
    }
    if (machine.is(states.WAITING) || machine.is(states.STREAMING)) {
      if (isSuccess) {
        machine.complete({ response: normalizedAnswer, responseHtml: normalizedHtml });
      } else {
        machine.error({ error: error?.message || normalizedAnswer, code: finalReason || finalStatus });
      }
    }
  }

  if (self.DispatchCircuit) {
    if (isSuccess) {
      self.DispatchCircuit.recordDispatchSuccess(llmName);
    } else {
      self.DispatchCircuit.recordDispatchFailure(llmName, {
        type: error?.type || finalReason || finalStatus || 'error',
        failureClass: failureClassification?.class || 'unknown',
        message: error?.message || ''
      });
    }
  }

  if (!alreadyFinalized) {
    if (finalStatus === 'SUCCESS' || finalStatus === 'PARTIAL' || finalStatus === 'STREAM_TIMEOUT_HIDDEN') {
      jobState.responsesCollected += 1;
      jobState.session.completed += 1;
    } else {
      jobState.session.failed += 1;
    }
  } else if (allowTerminalUpgrade) {
    const wasSuccessLike = ['SUCCESS', 'PARTIAL', 'STREAM_TIMEOUT_HIDDEN'].includes(lockedFinalStatus);
    const nowSuccessLike = ['SUCCESS', 'PARTIAL', 'STREAM_TIMEOUT_HIDDEN'].includes(finalStatus);
    if (!wasSuccessLike && nowSuccessLike) {
      jobState.responsesCollected += 1;
      jobState.session.completed += 1;
      jobState.session.failed = Math.max(0, Number(jobState.session.failed || 0) - 1);
    } else if (wasSuccessLike && !nowSuccessLike) {
      jobState.responsesCollected = Math.max(0, Number(jobState.responsesCollected || 0) - 1);
      jobState.session.completed = Math.max(0, Number(jobState.session.completed || 0) - 1);
      jobState.session.failed += 1;
    }
  }

  jobState.session.completed = Math.min(jobState.session.totalModels, jobState.session.completed);
  jobState.session.failed = Math.min(jobState.session.totalModels, jobState.session.failed);

  if (finalStatus === 'SUCCESS' || finalStatus === 'PARTIAL' || finalStatus === 'STREAM_TIMEOUT_HIDDEN') {
    if (typeof self.completeHumanPresenceForModel === 'function') {
      self.completeHumanPresenceForModel(llmName, 'terminal_success');
    }
    if (typeof self.schedulePostSuccessScrollAudit === 'function' && isValidTabId(tabId)) {
      self.schedulePostSuccessScrollAudit(llmName, tabId);
    }
    if (typeof self.downgradePipelineHardTimeoutLogs === 'function') {
      self.downgradePipelineHardTimeoutLogs(llmName);
    }
    if (typeof self.downgradePipelineHardTimeoutStorage === 'function') {
      self.downgradePipelineHardTimeoutStorage(llmName);
    }
  }

  emitTelemetry(llmName, 'RESPONSE', {
    details: finalStatus,
    meta: {
      status: finalStatus,
      reason: finalReason,
      completionReason,
      sendConfirmed,
      sendMethod,
      responseSource,
      partial: isPartial,
      sanityWarnings,
      sanityConfidence
    }
  });

  broadcastDiagnostic(llmName, {
    type: 'FINAL_STATUS',
    label: finalStatus,
    details: finalReason,
    level: finalStatus === 'SUCCESS' || finalStatus === 'PARTIAL' || finalStatus === 'STREAM_TIMEOUT_HIDDEN' ? 'success' : 'warning'
  });

  saveJobState(jobState);
  broadcastGlobalState();
  broadcastHumanVisitStatus();

  if (jobState.responsesCollected >= jobState.session.totalModels) {
    if (jobState.session.runSummaryEmitted) return;
    jobState.session.completedAt = Date.now();
    const totalModels = jobState.session.totalModels || 0;
    const completed = jobState.session.completed || 0;
    const failed = jobState.session.failed || 0;
    const stalled = Object.entries(jobState.llms || {})
      .filter(([_, entry]) => entry && !isFinalizedEntry(entry))
      .map(([name]) => name);
    const durationMs = jobState.session.completedAt - (jobState.session.startTime || jobState.session.completedAt);
    const successRate = totalModels ? Math.round((completed / totalModels) * 100) : 0;
    const errorDistribution = {};
    Object.entries(jobState.llms || {}).forEach(([name, entry]) => {
      const status = entry?.status || 'UNKNOWN';
      errorDistribution[status] = (errorDistribution[status] || 0) + 1;
    });
    const runMetrics = self.ModelRunState?.buildRunMetrics ? self.ModelRunState.buildRunMetrics(jobState) : null;
    if (runMetrics) {
      jobState.session.runMetrics = runMetrics;
    }
    const roundDurations = jobState.session.roundDurations || {};
    const avgRoundTimes = {};
    Object.keys(roundDurations).forEach((round) => {
      const vals = roundDurations[round] || [];
      if (!vals.length) return;
      const avg = Math.round(vals.reduce((a, b) => a + b, 0) / vals.length);
      avgRoundTimes[`round${round}`] = avg;
    });
    emitTelemetry('ROUNDS', 'RUN_SUMMARY', {
      meta: {
        runSessionId: jobState.session.startTime || null,
        totalModels,
        completed,
        failed,
        stalledModels: stalled,
        successRate,
        durationMs,
        runMetrics,
        avgRoundTimes,
        errorDistribution
      },
      force: true
    });
    jobState.session.runSummaryEmitted = true;
    saveJobState(jobState);
    broadcastGlobalState();
  }
}

const generateRequestId = () => `llm_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

function initRequestMetadata(llmName, tabId, initialUrl = '') {
  if (!llmName) return null;
  const existingId = jobState?.llms?.[llmName]?.requestId || llmRequestMap[llmName];
  if (existingId) {
    return persistRequestMetadata(llmName, {
      tabId: tabId || null,
      url: initialUrl || '',
      requestId: existingId
    });
  }
  const requestId = generateRequestId();
  llmRequestMap[llmName] = requestId;
  if (jobState?.llms?.[llmName]) {
    jobState.llms[llmName].requestId = requestId;
  }
  const snapshot = {
    requestId,
    llmName,
    tabId: tabId || null,
    createdAt: Date.now(),
    url: initialUrl || '',
    completedAt: null
  };
  jobMetadata.set(requestId, snapshot);
  sendMessageToResultsTab({
    type: 'LLM_JOB_CREATED',
    requestId,
    llmName,
    metadata: {
      url: snapshot.url,
      createdAt: snapshot.createdAt,
      completedAt: snapshot.completedAt
    }
  });
  return snapshot;
}

function persistRequestMetadata(llmName, updates = {}) {
  if (!llmName) return null;
  let requestId = jobState?.llms?.[llmName]?.requestId || llmRequestMap[llmName];
  if (!requestId) {
    const fallback = initRequestMetadata(llmName, TabMapManager.get(llmName), updates.url || '');
    requestId = fallback?.requestId;
  }
  if (!requestId) return null;
  const existing = jobMetadata.get(requestId) || { requestId, llmName };
  const merged = { ...existing };
  merged.llmName = llmName;
  Object.entries(updates || {}).forEach(([key, value]) => {
    if (typeof value === 'undefined' || value === null) {
      return;
    }
    merged[key] = value;
  });
  jobMetadata.set(requestId, merged);
  return merged;
}

let getItBatchInFlight = null;

async function runAutomaticGetItPass(selectedModels, sessionId) {
  if (!isSessionActive(sessionId) || jobState.session?.automaticGetItStarted) return;
  // A manual pass owns the same route. Wait for it rather than silently treating
  // its failed-only model list as the automatic all-model pass.
  if (getItBatchInFlight) await getItBatchInFlight.catch(() => {});
  if (!isSessionActive(sessionId) || jobState.session?.automaticGetItStarted) return;
  jobState.session.automaticGetItStarted = true;
  saveJobState(jobState);
  try {
    return await collectGetItBatch(selectedModels, {
      failedOnly: true, allModels: true, automatic: true,
      returnToTabId: typeof resultsTabId === 'number' ? resultsTabId : null
    });
  } finally {
    if (isSessionActive(sessionId)) {
      jobState.session.automaticGetItFinished = true;
      saveJobState(jobState);
    }
  }
}

function collectGetItBatch(selectedModels = [], options = {}) {
  if (getItBatchInFlight) return getItBatchInFlight;
  if (options.failedOnly === true) {
    getItBatchInFlight = collectFailedGetItPages(selectedModels, options)
      .finally(() => { getItBatchInFlight = null; });
    return getItBatchInFlight;
  }
  const names = [...new Set(Array.isArray(selectedModels) ? selectedModels : [])]
    .filter(name => typeof name === 'string' && (jobState?.llms?.[name] || LLM_TARGETS?.[name]));
  const dispatches = new Map(names.map(name => [name, jobState?.llms?.[name]?.lastDispatchMeta?.dispatchId || null]));
  let sessionId = getActiveSessionId();
  getItBatchInFlight = (async () => {
    const results = [];
    for (const llmName of names) {
      if (sessionId && !isSessionActive(sessionId)) return { status: 'get_it_cancelled', results };
      const dispatchId = jobState?.llms?.[llmName]?.lastDispatchMeta?.dispatchId || null;
      if (dispatchId !== dispatches.get(llmName)) {
        results.push({ llmName, status: 'manual_ping_failed', error: 'Запрос модели изменился во время Get it.' });
        continue;
      }
      try {
        const result = await handleManualResponsePing(llmName, {
          getIt: true, manualLatestRecovery: true, manualRecovery: true,
          advanceStrategy: false, reason: 'get_it_batch'
        });
        results.push({ ...result, llmName });
      } catch (err) {
        results.push({ llmName, status: 'manual_ping_failed', error: err?.message || String(err) });
      }
      // Manual recovery can create the initial session when none existed.
      if (!sessionId) sessionId = getActiveSessionId();
    }
    return { status: 'get_it_completed', results };
  })().finally(() => { getItBatchInFlight = null; });
  return getItBatchInFlight;
}

async function collectFailedGetItPages(selectedModels, options) {
  if (self.isInitialPromptPassActive?.()) {
    return {status:'get_it_busy', results:[], error:'Сначала должен закончиться первоначальный проход отправки запросов.'};
  }
  const sessionId = getActiveSessionId();
  if (!sessionId) return {status:'get_it_unavailable', results:[], error:'Нет сохранённого запуска для ручного сбора.'};
  const names = [...new Set([
    ...(Array.isArray(selectedModels) ? selectedModels : []),
    ...(options.allModels ? [] : Object.keys(jobState?.llms || {}))
  ])].filter(name => {
    const entry = jobState?.llms?.[name];
    return entry && (options.allModels || String(entry.finalStatus || entry.status).toUpperCase() !== 'SUCCESS' || !entry.answer);
  });
  if (!names.length) return {status:'get_it_empty', results:[]};
  const entries = new Map(names.map(name => [name, {
    entry: jobState.llms[name], dispatchId: jobState.llms[name].lastDispatchMeta?.dispatchId
  }]));
  const collections = [];
  const results = [];
  try {
    for (const llmName of names) {
      if (!isSessionActive(sessionId) || self.isInitialPromptPassActive?.()) break;
      const captured = entries.get(llmName);
      const entry = jobState.llms[llmName];
      if (entry !== captured.entry || entry.lastDispatchMeta?.dispatchId !== captured.dispatchId) continue;
      try {
        const tab = await getTabSafe(entry.tabId);
        if (!isEligibleTabForLlm(llmName, tab)) throw new Error('Привязанная вкладка недоступна');
        const reason = options.automatic ? 'automatic_get_it_batch' : 'get_it_failed_batch';
        const prepared = await runPreCollectScrollNudge(llmName, tab.id, sessionId, reason, {
          getIt: true, batchDwell: true
        });
        if (!prepared) throw new Error('Не удалось прокрутить страницу до конца');
        if (!isSessionActive(sessionId) || jobState.llms[llmName] !== entry
          || entry.lastDispatchMeta?.dispatchId !== captured.dispatchId) continue;
        // Collection continues without owning focus; it must not delay the next visit.
        collections.push(handleManualResponsePing(llmName, {
          getIt: true, skipBottomPreparation: true, manualLatestRecovery: true,
          manualRecovery: true, advanceStrategy: false, reason
        }).then(result => results.push({ ...result, llmName }),
          err => results.push({llmName, status:'manual_ping_failed', error:err?.message || String(err)})));
      } catch (err) {
        results.push({llmName, status:'manual_ping_failed', error:err?.message || String(err)});
      }
    }
  } finally {
    try {
      const tab = isSessionActive(sessionId) ? await getTabSafe(options.returnToTabId) : null;
      if (isAppUiTab(tab)) {
        await chrome.tabs.update(tab.id, {active:true});
        await chrome.windows.update(tab.windowId, {focused:true});
      } else if (options.automatic && isSessionActive(sessionId)) {
        await openOrFocusResultsTab();
      }
    } catch (_) { /* A closed source tab must not interrupt pending collection. */ }
  }
  await Promise.all(collections);
  return {status:'get_it_completed', results};
}

async function handleManualResponsePing(llmName, options = {}) {
  if (!llmName) {
    return { status: 'manual_ping_failed', error: 'LLM name missing' };
  }
  let tabId = jobState?.llms?.[llmName]?.tabId || TabMapManager.get(llmName);
  if (tabId) {
    const boundTab = await getTabSafe(tabId);
    if (!boundTab || !isEligibleTabForLlm(llmName, boundTab)) {
      return { status: 'manual_ping_failed', error: 'Привязанная вкладка модели недоступна. Откройте нужный диалог перед сбором ответа.' };
    }
  }
  if (!tabId) {
    broadcastDiagnostic(llmName, {
      type: 'PING',
      label: 'Manual ping fallback',
      details: 'Tab not registered, searching open tabs',
      level: 'warning'
    });
    const patterns = typeof getQueryPatternsForLLM === 'function'
      ? getQueryPatternsForLLM(llmName)
      : null;
    const queryList = Array.isArray(patterns) && patterns.length ? patterns : null;
    if (!queryList) {
      broadcastDiagnostic(llmName, {
        type: 'PING',
        label: 'Manual ping unavailable',
        details: 'No query patterns configured',
        level: 'error'
      });
      return { status: 'manual_ping_failed', error: 'No open tabs found. Please open the LLM website first.' };
    }
    const tabs = await new Promise((resolve) => {
      chrome.tabs.query({ url: queryList }, (foundTabs) => {
        if (chrome.runtime.lastError) {
          resolve([]);
          return;
        }
        resolve(Array.isArray(foundTabs) ? foundTabs : []);
      });
    });
    const eligibleTabs = tabs
      .filter((tab) => isEligibleTabForLlm(llmName, tab))
      .sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0));
    if (!eligibleTabs.length) {
      broadcastDiagnostic(llmName, {
        type: 'PING',
        label: 'Manual ping unavailable',
        details: 'No eligible tabs found',
        level: 'error'
      });
      return { status: 'manual_ping_failed', error: 'No open tabs found. Please open the LLM website first.' };
    }
    tabId = eligibleTabs[0].id;
    broadcastDiagnostic(llmName, {
      type: 'PING',
      label: 'Manual ping fallback tab selected',
      details: `Using tab ${tabId}`,
      level: 'info'
    });
    if (typeof setTabBinding === 'function') {
      await setTabBinding(llmName, tabId);
    }
  }
  broadcastDiagnostic(llmName, {
    type: 'PING',
    label: 'Manual ping initiated',
    details: 'UI button',
    level: 'info'
  });
  const manualRecoveryRequested = options?.manualRecovery !== false;
  let liveEntry = ensureManualRecoveryModelEntry(llmName, tabId, options?.reason || 'manual_ping');
  const manualLatestRecovery = Boolean(options?.manualLatestRecovery);
  const recovery = manualRecoveryRequested ? getManualRecoveryState(liveEntry) : null;
  const advanceStrategy = options?.advanceStrategy === true || options?.advanceSelector === true;
  if (manualRecoveryRequested && advanceStrategy) {
    markLastManualCandidateRejected(recovery);
  }
  // Run 1782944449199: four status-indicator double-clicks all re-ran the same
  // hardcoded bottom_most scan and re-read the same truncated Perplexity block.
  // The first latest-recovery click starts from bottom_most (= latest visible
  // answer), further clicks rotate through the remaining strategies (longest,
  // markdown, assistant-role, ...) so an explicit user retry actually tries
  // something new; when every strategy was rejected, the rotation restarts
  // instead of dead-ending an explicit user request.
  const bottomMostIndex = Math.max(0, MANUAL_RECOVERY_STRATEGIES.findIndex((item) => item.id === 'bottom_most'));
  if (manualLatestRecovery && recovery && !recovery.latestRecoveryStrategySeeded) {
    recovery.latestRecoveryStrategySeeded = true;
    recovery.strategyIndex = bottomMostIndex;
  }
  let strategy = manualRecoveryRequested ? resolveManualRecoveryStrategy(recovery) : null;
  if (manualLatestRecovery && !strategy && recovery) {
    recovery.failedStrategyIds = [];
    recovery.failedSelectors = [];
    recovery.strategyIndex = bottomMostIndex;
    strategy = resolveManualRecoveryStrategy(recovery);
  }
  if (manualRecoveryRequested && !strategy) {
    if (recovery) {
      recovery.exhausted = true;
      recovery.updatedAt = Date.now();
    }
    broadcastDiagnostic(llmName, {
      type: 'PING',
      label: 'Manual recovery exhausted',
      details: 'No more selector strategies',
      level: 'warning'
    });
    saveJobState(jobState);
    return { status: 'manual_ping_failed', error: 'No more selector strategies for manual recovery.' };
  }
  const finalizedAt = Number(liveEntry?.finalizedAt || 0);
  const finalizedStatus = String(liveEntry?.status || liveEntry?.finalStatus || '').toUpperCase();
  const allowRecoverableTerminalPing = Boolean(
    isFinalizedEntry(liveEntry)
    && finalizedAt > 0
    && (Date.now() - finalizedAt) <= RECOVERABLE_TERMINAL_MANUAL_PING_WINDOW_MS
    && RECOVERABLE_TERMINAL_PING_STATUSES.has(finalizedStatus)
    && isValidTabId(tabId)
  );
  const allowManualSelectorRecovery = Boolean(manualRecoveryRequested && isValidTabId(tabId));
  if (isFinalizedEntry(liveEntry) && !allowRecoverableTerminalPing && !allowManualSelectorRecovery) {
    broadcastDiagnostic(llmName, {
      type: 'PING',
      label: 'Manual ping skipped (terminal)',
      details: `status=${liveEntry?.status || liveEntry?.finalStatus || 'terminal'}`,
      level: 'warning'
    });
    return { status: 'manual_ping_sent' };
  }
  if (options.getIt === true && options.skipBottomPreparation !== true) {
    const prepared = await runPreCollectScrollNudge(llmName, tabId, getActiveSessionId(), 'get_it_precollect', {
      getIt: true,
      returnToTabId: options.reason === 'status_indicator_dblclick' ? options.returnToTabId : null
    });
    if (!prepared) return { status: 'manual_ping_failed', error: 'Не удалось перейти к концу беседы. Повторите Get it после завершения отправки запросов.' };
  } else if (options.skipBottomPreparation !== true && !isFinalizedEntry(liveEntry)) {
    await runPreCollectScrollNudge(llmName, tabId, getActiveSessionId(), 'manual_ping_precollect');
  } else if (allowRecoverableTerminalPing || allowManualSelectorRecovery) {
    broadcastDiagnostic(llmName, {
      type: 'PING',
      label: allowManualSelectorRecovery ? 'Manual selector recovery started' : 'Manual ping override (recoverable terminal)',
      details: allowManualSelectorRecovery
        ? `strategy=${strategy?.id || 'default'} attempt=${Number(recovery?.attempt || 0)}`
        : `status=${finalizedStatus} age=${Math.max(0, Date.now() - finalizedAt)}ms`,
      level: 'warning'
    });
  }
  extendPingWindowForLLM(llmName, MANUAL_PING_WINDOW_MS);
  const manualRecoveryMeta = manualLatestRecovery
    ? buildManualLatestRecoveryOptions(liveEntry, llmName, strategy, { keepCurrentAnswer: options.getIt === true })
    : (manualRecoveryRequested ? {
    enabled: true,
    manualRecovery: true,
    manualOverride: true,
    selectorAttempt: Number(recovery?.attempt || 0),
    advanceStrategy,
    strategyId: strategy?.id || null,
    strategyIndex: strategy?.index ?? 0,
    skipStrategyIds: Array.isArray(recovery?.failedStrategyIds) ? recovery.failedStrategyIds.slice() : [],
    skipSelectors: Array.isArray(recovery?.failedSelectors) ? recovery.failedSelectors.slice() : []
  } : null);
  const responseMeta = {
    source: 'manual_ping',
    getIt: options.getIt === true,
    runSessionId: Number(jobState?.session?.startTime || 0) || null,
    sessionId: Number(jobState?.session?.startTime || 0) || null,
    dispatchId: liveEntry?.lastDispatchMeta?.dispatchId || null,
    forceEmitOnUnchanged: true,
    manualRecovery: manualRecoveryMeta,
    manualLatestRecovery,
    responseMeta: manualRecoveryMeta ? {
      manualRecovery: true,
      manualOverride: true,
      manualLatestRecovery,
      source: manualLatestRecovery ? 'manual_latest_recovery' : 'manual_ping',
      completionReason: manualLatestRecovery ? 'manual_latest_recovery' : 'manual_ping_late_collect',
      lateCollectFinal: true,
      forceTerminalSuccess: true,
      advanceStrategy,
      strategyId: manualRecoveryMeta.strategyId,
      strategyIndex: manualRecoveryMeta.strategyIndex,
      excludeTextSignatures: manualRecoveryMeta.excludeTextSignatures || []
    } : undefined
  };
  if (!manualLatestRecovery) {
    sendPassiveMessageWithRetries(tabId, llmName, { action: 'getResponses', meta: responseMeta }, {
      maxAttempts: 4,
      baseDelay: 700,
      transportRetryDelays: HARD_STOP_PING_RETRY_DELAYS_MS,
      allowRecovery: true,
      onSuccess: (response) => {
        const successEntry = jobState?.llms?.[llmName];
        if (successEntry) {
          successEntry.pingTransportErrorCount = 0;
        }
        if (response?.status === 'ignored_terminal') {
          chrome.runtime.sendMessage({
            type: 'MANUAL_PING_RESULT',
            llmName,
            status: 'ignored_terminal'
          });
          return;
        }
        broadcastDiagnostic(llmName, {
          type: 'PING',
          label: 'getResponses command sent',
          details: response?.status ? `CS status: ${response.status}` : '',
          level: 'success'
        });
      },
      onError: (errMsg) => {
        const liveEntry = jobState?.llms?.[llmName];
        if (liveEntry) {
          liveEntry.pingTransportErrorCount = Number(liveEntry.pingTransportErrorCount || 0) + 1;
          liveEntry.lastPingTransportErrorAt = Date.now();
        }
        const isTerminal = !!(liveEntry && isFinalizedEntry(liveEntry));
        const lateManualRecoveryPending = Boolean(allowManualSelectorRecovery);
        if (!isTerminal && typeof self.recoverAnswerViaDomSnapshot === 'function') {
          self.recoverAnswerViaDomSnapshot(llmName, tabId, 'manual_ping_transport_error', {
            dispatchId: liveEntry?.lastDispatchMeta?.dispatchId || null
          }).catch(() => {});
        }
        broadcastDiagnostic(llmName, {
          type: isTerminal && !lateManualRecoveryPending ? 'PING' : 'PING_ERROR',
          label: isTerminal && !lateManualRecoveryPending ? 'Manual ping skipped (terminal)' : 'PING_TRANSPORT_ERROR',
          details: isTerminal && !lateManualRecoveryPending
            ? `${errMsg} | status=${liveEntry?.status || 'terminal'}`
            : errMsg,
          level: 'warning'
        });
        if (!isTerminal) {
          maybeRunEarlyGestureRecovery(llmName, tabId, 'manual_ping');
        }
        if (!lateManualRecoveryPending) {
          chrome.runtime.sendMessage({
            type: 'MANUAL_PING_RESULT',
            llmName,
            status: isTerminal ? 'ignored_terminal' : 'failed',
            error: errMsg
          });
        }
      }
    });
  } else {
    broadcastDiagnostic(llmName, {
      type: 'PING',
      label: 'Manual latest recovery uses inline DOM scan',
      details: 'Skipping content-script getResponses to avoid replaying a stale cached answer',
      level: 'info'
    });
  }
  if (!isFinalizedEntry(liveEntry) || allowRecoverableTerminalPing || allowManualSelectorRecovery) {
        const manualBudgetKey = buildRecoveryBudgetKey({
          dispatchId: liveEntry?.lastDispatchMeta?.dispatchId || null,
          reason: manualLatestRecovery ? 'manual_latest_recovery' : 'manual_ping_late_collect',
          scope: manualLatestRecovery ? 'manual_latest_recovery' : (allowManualSelectorRecovery ? 'manual_selector_recovery' : 'manual_ping')
        });
    // An explicit status-indicator double-click is a user decision, not an
    // automation loop: run 1782944449199 showed the 3rd/4th clicks silently
    // dying on manualPingAttempts budget. The single-flight cooldown inside
    // lateCollectAnswer still throttles rapid clicks; only automated manual
    // pings stay budget-limited.
    const manualBudget = manualLatestRecovery
      ? { ok: true, reason: 'user_initiated_latest_recovery' }
      : consumeRecoveryBudget(llmName, liveEntry, manualBudgetKey, 'manualPing', {
        telemetry: {
          tabId,
          dispatchId: liveEntry?.lastDispatchMeta?.dispatchId || null,
          manualSelectorRecovery: allowManualSelectorRecovery
        }
      });
    if (!manualBudget.ok) {
      chrome.runtime.sendMessage({
        type: 'MANUAL_PING_RESULT',
        llmName,
        status: 'failed',
        error: manualBudget.reason
      });
    } else {
        await lateCollectAnswer({
          llmName,
          tabId,
          reason: manualLatestRecovery ? 'manual_latest_recovery' : 'manual_ping_late_collect',
          minChars: manualLatestRecovery ? (self.AnswerLengthPolicy?.DEFAULTS?.manualLatestMinChars || 20) : DOM_SNAPSHOT_RECOVERY_MIN_CHARS,
          meta: {
            ...responseMeta,
            recoveryBudgetKey: manualBudgetKey
        },
        manualRecovery: manualRecoveryMeta
      })
      .then((result) => {
        if (acceptLateCollectResult(llmName, result, responseMeta)) {
          const updatedEntry = jobState?.llms?.[llmName] || liveEntry;
          const candidate = saveManualRecoveryCandidate(updatedEntry, result, strategy);
          saveJobState(jobState);
          chrome.runtime.sendMessage({
            type: 'MANUAL_PING_RESULT',
            llmName,
            status: 'success',
            source: result.source || 'late_collect',
            answer: String(updatedEntry?.answer || result.text || ''),
            answerHtml: String(updatedEntry?.answerHtml || result.html || ''),
            requestId: updatedEntry?.requestId || null,
            finalStatus: updatedEntry?.finalStatus || updatedEntry?.status || null,
            strategyId: candidate?.strategyId || result.strategyId || strategy?.id || null,
            selectorUsed: candidate?.selectorDescriptor || result.selectorDescriptor || result.selectorUsed || null,
            attempt: Number(recovery?.attempt || 0)
          });
        } else if (result?.status) {
          chrome.runtime.sendMessage({
            type: 'MANUAL_PING_RESULT',
            llmName,
            status: 'failed',
            error: result.reason || result.status
          });
        }
      })
      .catch((err) => {
        chrome.runtime.sendMessage({
          type: 'MANUAL_PING_RESULT',
          llmName,
          status: 'failed',
          error: err?.message || String(err)
        });
      });
    }
  }
  saveJobState(jobState);
  return {
    status: 'manual_ping_sent',
    strategyId: strategy?.id || null,
    strategyIndex: strategy?.index ?? null,
    attempt: Number(recovery?.attempt || 0),
    advanceStrategy
  };
}

function handleManualResendRequest(llmName) {
  if (!llmName) {
    return { status: 'manual_resend_failed', error: 'LLM name missing' };
  }
  const llmEntry = jobState?.llms?.[llmName];
  if (!llmEntry) {
    return { status: 'manual_resend_failed', error: 'LLM not active' };
  }
  const tabId = resolveBoundTabIdForOrchestrator(llmName, llmEntry);
  if (!tabId) {
    return { status: 'manual_resend_failed', error: 'Tab not found' };
  }
  const prompt = jobState?.prompt;
  if (!prompt) {
    return { status: 'manual_resend_failed', error: 'Prompt unavailable' };
  }
  const intentDecision = self.RecoveryIntent?.authorize
    ? self.RecoveryIntent.authorize(llmEntry, {
      intent: 'resend_prompt',
      reason: 'manual_resend',
      minChars: DOM_SNAPSHOT_RECOVERY_MIN_CHARS
    })
    : { ok: true };
  llmEntry.lastRecoveryIntentDecision = {
    ...intentDecision,
    reasonLabel: 'manual_resend',
    decidedAt: Date.now()
  };
  if (!intentDecision.ok) {
    self.DecisionLedger?.append?.(llmEntry, {
      decision: 'deny_recovery_intent',
      reason: intentDecision.reason || 'recovery_intent_denied',
      source: 'manual_resend',
      inputs: { intentDecision },
      resultingState: llmEntry.finalStatus || llmEntry.status || 'open'
    });
    emitTelemetry(llmName, 'MANUAL_RESEND_DENIED', {
      level: 'warning',
      details: intentDecision.reason || 'recovery_intent_denied',
      meta: { tabId, intentDecision },
      force: true
    });
    broadcastDiagnostic(llmName, {
      type: 'RESEND',
      label: 'Manual resend denied',
      details: intentDecision.reason || 'recovery_intent_denied',
      level: 'warning',
      meta: { intentDecision }
    });
    return { status: 'manual_resend_denied', reason: intentDecision.reason || 'recovery_intent_denied', intent: intentDecision.intent || 'resend_prompt' };
  }
  llmEntry.manualResendActive = true;
  llmEntry.manualResendStartedAt = Date.now();
  llmEntry.manualResendAttempts = (llmEntry.manualResendAttempts || 0) + 1;
  broadcastDiagnostic(llmName, {
    type: 'RESEND',
    label: 'Manual resend initiated',
    level: 'info'
  });
  const machine = self.DispatchStateManager ? self.DispatchStateManager.get(llmName) : null;
  if (machine) {
    machine.reset();
  }
  dispatchPromptToTab(llmName, tabId, resolvePromptForDispatch(llmName, prompt), jobState.attachments || [], 'manual_resend', {
    recoveryIntent: 'resend_prompt'
  });
  return { status: 'manual_resend_dispatched' };
}

function sendCleanupCommand(llmName) {
  const tabId = TabMapManager.get(llmName);
  if (!tabId) return;

  chrome.tabs.sendMessage(tabId, { type: 'STOP_AND_CLEANUP' }, (response) => {
    if (chrome.runtime.lastError) {
      console.warn(`[BACKGROUND] Cleanup command failed for ${llmName}:`, chrome.runtime.lastError.message);
    } else {
      globalThis.LLMLog?.debug?.(`[BACKGROUND] Cleanup command sent to ${llmName}, response:`, response);
    }
  });
}

  self.saveJobState = saveJobState;
  self.loadJobState = loadJobState;
  self.stopAllProcesses = stopAllProcesses;
  self.startProcess = startProcess;
  self.collectResponses = collectResponses;
  self.collectGetItBatch = collectGetItBatch;
  self.collectResponsesStaged = collectResponsesStaged;
  self.handleLLMResponse = handleLLMResponse;
  self.startBudgetPhase = startBudgetPhase;
  self.endBudgetPhase = endBudgetPhase;
  self.clearBudgetPhases = clearBudgetPhases;
  self.finalizeAutomationDeadline = finalizeAutomationDeadline;
  self.initRequestMetadata = initRequestMetadata;
  self.persistRequestMetadata = persistRequestMetadata;
  self.handleManualResponsePing = handleManualResponsePing;
  self.handleManualResendRequest = handleManualResendRequest;
  self.lateCollectAnswer = lateCollectAnswer;
  self.acceptLateCollectResult = acceptLateCollectResult;
  self.runTerminalExtractionRecovery = runTerminalExtractionRecovery;
  self.recoverTerminalFailureAfterLifecycle = recoverTerminalFailureAfterLifecycle;
  self.scheduleTerminalExtractionRecovery = scheduleTerminalExtractionRecovery;
  self.saveAnswerSnapshotFromContent = saveAnswerSnapshotFromContent;
  self.readAnswerSnapshotCache = readAnswerSnapshotCache;
  self.clearLateAnswerSnapshotCache = clearLateAnswerSnapshotCache;
  self.classifyLateCollectState = classifyLateCollectState;
  self.recoverAnswerViaDomSnapshot = recoverAnswerViaDomSnapshot;
  self.sendCleanupCommand = sendCleanupCommand;
  self.scheduleAdaptiveCollectionProbe = scheduleAdaptiveCollectionProbe;
  self.clearAdaptiveCollectTimer = clearAdaptiveCollectTimer;
  self.buildEarlyTerminalGuardSignature = buildEarlyTerminalGuardSignature;
  self.maybeDeferEarlyTerminalSuccess = maybeDeferEarlyTerminalSuccess;
  self.scheduleStablePendingAutoFinalization = scheduleStablePendingAutoFinalization;
  self.finalizeNoSendModelIfStalled = finalizeNoSendModelIfStalled;
  self.waitForRound4Gate = waitForRound4Gate;
  self.classifyMaterializeRecoveryFinality = classifyMaterializeRecoveryFinality;
  self.isUnconfirmedSendFailure = isUnconfirmedSendFailure;
  self.shouldMaterializeBeforeTerminal = shouldMaterializeBeforeTerminal;
  self.shouldAcceptMaterializeRecoveryResult = shouldAcceptMaterializeRecoveryResult;
  self.getCompleteMaterializeVerification = getCompleteMaterializeVerification;
  self.preserveUnprovenMaterializeArtifact = preserveUnprovenMaterializeArtifact;
  self.normalizeEvidenceText = normalizeEvidenceText;
  self.buildEvidenceDedupeKey = buildEvidenceDedupeKey;
  self.buildRecoveryBudgetKey = buildRecoveryBudgetKey;
  self.ensureRecoveryBudget = ensureRecoveryBudget;
  self.consumeRecoveryBudget = consumeRecoveryBudget;
  self.validateMaterializedAnswerEvidence = validateMaterializedAnswerEvidence;
  self.buildMaterializedEvidenceSummary = buildMaterializedEvidenceSummary;
  self.materializeLatestAnswerEvidence = materializeLatestAnswerEvidence;
  self.classifyFailure = classifyFailure;
  self.deriveFailureFinalStatus = deriveFailureFinalStatus;
  self.isPromptEchoAnswerCandidate = isPromptEchoAnswerCandidate;
  self.buildAnswerCandidate = buildAnswerCandidate;
  self.evaluateAnswerCandidate = evaluateAnswerCandidate;
  self.submitAnswerCandidate = submitAnswerCandidate;
  self.buildFinalizationEvidence = buildFinalizationEvidence;
  self.evaluatePreInsertionFailureDeferral = evaluatePreInsertionFailureDeferral;
  self.applyPreInsertionFailureDeferral = applyPreInsertionFailureDeferral;
  self.canRepairDispatchInRound2 = canRepairDispatchInRound2;
  self.emitFinalizationDecision = emitFinalizationDecision;
  self.summarizeFinalizationEvidenceForTelemetry = summarizeFinalizationEvidenceForTelemetry;
  self.hasRound2SubmitOrAnswerEvidence = hasRound2SubmitOrAnswerEvidence;
  self.getRound2SubmitConfirmationState = getRound2SubmitConfirmationState;
  self.waitForRound2SubmitConfirmation = waitForRound2SubmitConfirmation;
  self.orderRound1Models = orderRound1Models;
  self.isRound2DelayedConfirmationState = isRound2DelayedConfirmationState;
  self.shouldInferSubmitFromAnswerEvidence = shouldInferSubmitFromAnswerEvidence;
  self.inferPromptSubmittedFromAnswerEvidence = inferPromptSubmittedFromAnswerEvidence;
  self.recordModelRunState = recordModelRunState;
  self.emitFinalizationDecision = emitFinalizationDecision;
  self.getActivePipelineControlState = getActivePipelineControlState;
  self.persistPipelineControlState = persistPipelineControlState;
  self.rehydrateActiveJobRuntime = rehydrateActiveJobRuntime;
  self.updateMv3SurvivalAlarm = updateMv3SurvivalAlarm;
  self.registerSessionTimer = registerSessionTimer;
  self.deregisterSessionTimer = deregisterSessionTimer;
  self.clearSessionTimers = clearSessionTimers;

    globalThis.LLMLog?.debug?.('[JobOrchestrator] Module loaded');
  })();
}
