(function initDebateProcessAudit(root) {
  'use strict';
  function audit({ state = {}, registry = null, plan = {}, traceEvents = [] } = {}) {
    const legitimateSkipReasons = new Set(['no_independent_auditor', 'failure_policy_skip', 'participant_dropout_degraded', 'manual_skip']);
    const completed = new Set(traceEvents.filter((e) => {
      if (e.type === 'STAGE_COMPLETED') return true;
      if (e.type !== 'STAGE_SKIPPED') return false;
      return legitimateSkipReasons.has(String(e.payload?.reasonCode || e.reasonCode || ''));
    }).map((e) => e.payload?.stageId || e.stageId));
    const expected = (plan.stages || []).map((s) => s.stageId); const checks = [];
    checks.push({ id: 'plan_executed', verdict: expected.every((id) => completed.has(id)) ? 'pass' : 'fail', detail: expected.filter((id) => !completed.has(id)).join(', ') || 'all stages observed' });
    const artifacts = Object.values(registry?.artifacts || {});
    const claims = artifacts.filter((item) => item.type === 'claim');
    const objections = artifacts.filter((item) => item.type === 'objection');
    const contestedClaims = claims.filter((item) => ['contested', 'refuted', 'conceded'].includes(item.status));
    if (!registry) checks.push({ id: 'claims_received_critique', verdict: 'skipped', detail: 'registry unavailable' });
    else if (!claims.length) checks.push({ id: 'claims_received_critique', verdict: 'fail', detail: 'no claims were extracted' });
    else {
      const challenged = new Set(objections.map((item) => item.targetId)).size + contestedClaims.length;
      const ratio = Math.min(1, challenged / claims.length);
      checks.push({ id: 'claims_received_critique', verdict: ratio === 0 ? 'fail' : ratio < 0.5 ? 'warn' : 'pass', detail: `${challenged}/${claims.length} claims challenged` });
    }
    if (!registry) checks.push({ id: 'roles_executed', verdict: 'skipped', detail: 'registry unavailable' });
    else {
      const criticalModels = Object.entries(plan.roles || {}).filter(([, role]) => String(role).includes('critical')).map(([model]) => model);
      const missing = criticalModels.filter((model) => !objections.some((item) => item.target === model || item.author === model));
      const synthesisSeen = traceEvents.some((e) => (e.payload?.stageId || e.stageId) === 'final:synthesis' && e.type === 'STAGE_COMPLETED');
      checks.push({ id: 'roles_executed', verdict: missing.length || (plan.synthesizer && !synthesisSeen) ? 'warn' : 'pass', detail: missing.length ? `no objection activity: ${missing.join(', ')}` : 'critical roles and synthesizer observed' });
    }
    const filters = (state.roundFilters || []).map((item) => String(item.text || '')).join('\n');
    const synthesisText = String(state.synthesisText || state.finalVerdict || '');
    const hasMinority = /позици[яии]\s+меньшинства|minority/i.test(filters);
    checks.push({ id: 'minority_retained', verdict: hasMinority && !/позици[яии]\s+меньшинства|minority/i.test(synthesisText) ? 'fail' : 'pass', detail: hasMinority ? 'minority section traced' : 'no minority section in filters' });
    const deltas = Array.isArray(state.roundDeltas) ? state.roundDeltas : [];
    const emptyWaves = deltas.filter((entry) => Number(entry?.delta?.stagnation?.newContentRatio || 0) === 0).map((entry) => entry.wave);
    checks.push({ id: 'rounds_productive', verdict: emptyWaves.length ? 'warn' : 'pass', detail: emptyWaves.length ? `no new content: ${emptyWaves.join(', ')}` : 'all observed deltas productive' });
    checks.push({ id: 'degraded_disclosed', verdict: !state.degradedMode || /выбыл|degraded|деград/i.test(synthesisText) ? 'pass' : 'warn', detail: state.degradedMode ? 'degraded disclosure checked' : 'not applicable' });
    const failures = checks.filter((item) => item.verdict === 'fail').length;
    return { checks, summary: failures ? 'fail' : checks.some((item) => item.verdict === 'warn') ? 'attention_required' : 'pass' };
  }
  const api = Object.freeze({ audit }); root.DebateProcessAudit = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
