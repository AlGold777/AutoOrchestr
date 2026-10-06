(function initDebateRuleEngine(root) {
  'use strict';
  const VERSION = 1;
  const Contracts = root.DebateContracts || (typeof require === 'function' ? require('./debate-contracts') : null);
  const CATALOG = Object.freeze({
    UNCRITICIZED_CLAIM: { role: 'critic', priority: 70, action: 'critique_claim', mode: 'automatic', cost: 1 },
    BLOCKING_OBJECTION: { role: 'defender', priority: 100, action: 'resolve_blocker', mode: 'automatic', cost: 1 },
    FACT_DISPUTE: { role: 'verifier', priority: 95, action: 'verify_fact', mode: 'ask-human', cost: 2 },
    WEAK_EVIDENCE: { role: 'verifier', priority: 90, action: 'verify_evidence', mode: 'automatic', cost: 1 },
    REVISION_RECHECK: { role: 'critic', priority: 80, action: 'recheck_revision', mode: 'automatic', cost: 1 },
    CONTRADICTION: { role: 'arbiter', priority: 75, action: 'resolve_contradiction', mode: 'automatic', cost: 1 },
    ACTIVE_DISSENT: { role: 'arbiter', priority: 60, action: 'examine_dissent', mode: 'automatic', cost: 1 },
    REPETITION: { role: 'moderator', priority: 55, action: 'stop_repetition', mode: 'automatic', cost: 0 },
    CONTEXT_PRESSURE: { role: 'moderator', priority: 52, action: 'compact_context', mode: 'automatic', cost: 0 },
    STAGNATION: { role: 'synthesizer', priority: 50, action: 'summarize_or_stop', mode: 'automatic', cost: 1 },
    READY_FOR_SYNTHESIS: { role: 'synthesizer', priority: 40, action: 'synthesize', mode: 'automatic', cost: 1 },
    SYNTHESIS_AUDIT: { role: 'auditor', priority: 35, action: 'audit_synthesis', mode: 'automatic', cost: 1 }
  });
  const keyOf = (task) => `${task.triggerId}:${task.targetId || 'run'}`;
  const normalizeRule = (raw, index = 0) => {
    const input = typeof raw === 'string' ? { triggerId: raw } : (raw || {});
    const triggerId = String(input.triggerId || input.id || '').trim().toUpperCase();
    const spec = CATALOG[triggerId] || {};
    return Object.freeze({
      ruleId: String(input.ruleId || `${triggerId || 'RULE'}:${index + 1}`), triggerId,
      enabled: input.enabled !== false, mode: String(input.mode || spec.mode || 'automatic'),
      role: String(input.role || spec.role || ''), action: String(input.action || spec.action || ''),
      priority: Number(input.priority ?? spec.priority ?? 0), cost: Number(input.cost ?? spec.cost ?? 0),
      cooldown: Math.max(0, Number(input.cooldown ?? 2)), maxExecutions: Math.max(1, Number(input.maxExecutions ?? 3)),
      parameters: input.parameters && typeof input.parameters === 'object' ? { ...input.parameters } : {}
    });
  };
  const normalizeRules = (rules = null) => (Array.isArray(rules) ? rules : Object.keys(CATALOG)).map(normalizeRule).filter((rule) => CATALOG[rule.triggerId]);
  const rawMatches = (rule, map = {}, state = {}) => {
    const triggerId = rule.triggerId; const parameters = rule.parameters || {};
    const matches = [];
    const objectionsByClaim = new Set((map.objections || []).map((item) => item.targetId));
    if (triggerId === 'UNCRITICIZED_CLAIM') (map.claims || []).filter((item) => !objectionsByClaim.has(item.id)).forEach((item) => matches.push([item.id, 'Claim ещё не проходил независимую критику.']));
    if (triggerId === 'BLOCKING_OBJECTION') (map.blockers || []).filter((item) => !parameters.severities || parameters.severities.includes(item.severity)).forEach((item) => matches.push([item.id, 'Открыто блокирующее возражение.']));
    const weakTiers = Array.isArray(parameters.tiers) ? parameters.tiers : ['model_argument', 'unverified'];
    if (triggerId === 'WEAK_EVIDENCE') (map.evidence || []).filter((item) => !item.tier || weakTiers.includes(item.tier)).forEach((item) => matches.push([item.id, 'Evidence требует независимой проверки.']));
    if (triggerId === 'REVISION_RECHECK') (map.revisions || []).forEach((item) => matches.push([item.id, 'Изменённый claim нужно проверить повторно.']));
    if (triggerId === 'ACTIVE_DISSENT') (map.dissent || []).forEach((item) => matches.push([item.id, 'Сохраняется содержательное несогласие.']));
    if (triggerId === 'FACT_DISPUTE') (map.evidence || []).filter((item) => item.status === 'disputed' || item.factDispute).forEach((item) => matches.push([item.id, 'Оспоренный факт требует независимой проверки.']));
    if (triggerId === 'CONTRADICTION') (state.contradictions || map.contradictions || []).forEach((item) => matches.push([item.id || item.targetId, item.reason || 'Обнаружено логическое противоречие.']));
    if (triggerId === 'REPETITION' && state.repetitionDetected) matches.push([map.runId, 'Новый вклад повторяет обработанный материал.']);
    if (triggerId === 'CONTEXT_PRESSURE' && state.contextPressure) matches.push([map.runId, 'Контекст приближается к безопасному пределу.']);
    if (triggerId === 'SYNTHESIS_AUDIT' && state.synthesisPendingAudit) matches.push([map.runId, 'Финальный синтез ещё не проверен по карте.']);
    if (triggerId === 'READY_FOR_SYNTHESIS' && ['ready', 'limited'].includes(map.readiness?.id)) matches.push([map.runId, map.readiness.label]);
    if (triggerId === 'STAGNATION' && state.stagnant === true) matches.push([map.runId, 'Окно прогресса не изменилось.']);
    return matches;
  };
  function evaluate(map = {}, state = {}, rules = null) {
    const traces = []; const tasks = [];
    normalizeRules(rules).forEach((rule) => {
      const matches = rawMatches(rule, map, state).slice(0, Math.max(1, Number(rule.parameters?.maxCandidates || 50)));
      if (!matches.length) traces.push({ ruleId: rule.ruleId, triggerId: rule.triggerId, status: 'suppressed', reasonCode: 'condition_not_met' });
      matches.forEach(([targetId, reason]) => {
        const key = `${rule.triggerId}:${targetId || 'run'}`;
        let reasonCode = '';
        if (!rule.enabled) reasonCode = 'rule_disabled';
        else if (Number(state.cooldowns?.[key] || 0) > Number(state.seq || 0)) reasonCode = 'cooldown_active';
        else if (Number(state.loopCounts?.[key] || 0) >= rule.maxExecutions) reasonCode = 'execution_ceiling';
        const status = reasonCode ? 'suppressed' : 'fired';
        const trace = { ruleId: rule.ruleId, triggerId: rule.triggerId, targetId: String(targetId || ''), status, reasonCode, mode: rule.mode, priority: rule.priority, at: Date.now() };
        traces.push(trace);
        if (status !== 'fired') return;
        const actionContract = Contracts?.createActionContract?.({ action: rule.action, role: rule.role, targetId, reason, cost: rule.cost }) || null;
        tasks.push({ ...trace, reason, role: rule.role, action: rule.action, actionContract, expectedArtifactTypes: actionContract?.expectedArtifactTypes || [], independence: actionContract?.independence || 'none', requiredTool: actionContract?.requiredTool || '', cost: rule.cost, cooldown: rule.cooldown, maxExecutions: rule.maxExecutions });
      });
    });
    return Object.freeze({ version: VERSION, tasks: Object.freeze(tasks), traces: Object.freeze(traces) });
  }
  function utility(task, map = {}) {
    const blocker = (map.blockers || []).some((item) => item.id === task.targetId) ? 50 : 0;
    const disputed = (map.evidence || []).some((item) => item.id === task.targetId && (item.status === 'disputed' || item.factDispute)) ? 35 : 0;
    const uncertainty = ['WEAK_EVIDENCE', 'FACT_DISPUTE', 'CONTRADICTION'].includes(task.triggerId) ? 25 : 0;
    return Number(task.priority || 0) + blocker + disputed + uncertainty - (task.action === 'synthesize' ? 10 : 0) - Number(task.cost || 0) * 5;
  }
  const api = Object.freeze({ VERSION, CATALOG, normalizeRule, normalizeRules, evaluate, utility, keyOf });
  root.DebateRuleEngine = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
