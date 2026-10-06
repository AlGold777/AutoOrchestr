// Explicit, preset-neutral policies and the single configuration validation contract
// shared by UI and runtime (Extraction Contract §3.5, §8, §18).
(function initDebatePolicies(root) {
  'use strict';

  const POLICY_SCHEMA_VERSION = 1;

  // §8.5 Participant cardinality: the only source of participant count rules.
  const DEFAULT_CARDINALITY = Object.freeze({
    policyId: 'participant-cardinality.default.v1',
    minimum: 1,
    maximum: null, // unlimited unless an explicit reason exists
    recommended: 2,
    reason: 'Universal engine supports arbitrary participant counts.'
  });

  const DEFAULT_FINALIZATION = Object.freeze({
    policyId: 'finalization.default.v1',
    mode: 'manual', // manual | on_stagnation | on_budget_exhaustion | after_required_goals | after_synthesis
    synthesis: 'optional', // none | optional | required
    audit: 'optional', // none | optional | required
    allowContinueAfterSynthesis: true
  });

  const DEFAULT_STAGNATION = Object.freeze({
    policyId: 'stagnation.default.v1',
    unchangedStateMapLimit: 3,
    noStateDeltaLimit: 3,
    repeatedActionLimit: 2,
    repeatedArtifactSimilarityThreshold: 0.9
  });

  const DEFAULT_PAUSE = Object.freeze({
    policyId: 'pause.default.v1',
    mode: 'finish_current_stage' // finish_current_stage | cancel_active_dispatch | finish_received_only
  });

  const DEFAULT_RETRY = Object.freeze({
    policyId: 'retry.default.v1',
    maxAttempts: 2,
    delayMs: 0
  });

  const DEFAULT_COMPLETION = Object.freeze({
    policyId: 'completion.default.v1',
    mode: 'all', // all | quorum | first_success
    quorumSize: null // required when mode === 'quorum'
  });

  const DEFAULT_INDEPENDENCE = Object.freeze({
    policyId: 'independence.default.v1',
    verifierMustDifferFromAuthor: true,
    preferDifferentProvider: true,
    allowDegraded: true
  });

  const DEFAULT_COMPACTION = Object.freeze({
    policyId: 'compaction.default.v1',
    actionInterval: 8,
    contextPressureThreshold: 0.8
  });

  const DEFAULT_BUDGETS = Object.freeze({
    policyId: 'budgets.default.v1',
    maxStagesPerTick: 2,
    maxConcurrentStages: 4,
    maxTotalStages: 50,
    maxModelCalls: null,
    maxHumanWaits: null,
    maxRetryAttempts: null,
    maxContextTokens: null,
    maxCorrections: null,
    maxEstimatedCost: null,
    maxElapsedTimeMs: null
  });

  function defaults() {
    return {
      schemaVersion: POLICY_SCHEMA_VERSION,
      cardinality: { ...DEFAULT_CARDINALITY },
      finalization: { ...DEFAULT_FINALIZATION },
      stagnation: { ...DEFAULT_STAGNATION },
      pause: { ...DEFAULT_PAUSE },
      retry: { ...DEFAULT_RETRY },
      completion: { ...DEFAULT_COMPLETION },
      independence: { ...DEFAULT_INDEPENDENCE },
      compaction: { ...DEFAULT_COMPACTION },
      budgets: { ...DEFAULT_BUDGETS }
    };
  }

  function resolve(overrides = {}) {
    const base = defaults();
    for (const key of Object.keys(base)) {
      if (key === 'schemaVersion') continue;
      if (overrides[key] && typeof overrides[key] === 'object') base[key] = { ...base[key], ...overrides[key] };
    }
    return base;
  }

  // §18.3/§18.4 — single validation contract with traceable refusals.
  function violation(policyId, code, message, actual, allowed) {
    return { policyId, code, message, actual, allowed };
  }

  function validateConfiguration(config = {}, policies = defaults()) {
    const errors = [];
    const appliedPolicies = [];
    const participants = Array.isArray(config.participants) ? config.participants : [];
    const cardinality = policies.cardinality || DEFAULT_CARDINALITY;
    appliedPolicies.push(cardinality.policyId);
    if (participants.length < cardinality.minimum) {
      errors.push(violation(cardinality.policyId, 'PARTICIPANTS_BELOW_MINIMUM',
        `Requires at least ${cardinality.minimum} participant(s)`, participants.length, `>= ${cardinality.minimum}`));
    }
    if (cardinality.maximum != null && participants.length > cardinality.maximum) {
      errors.push(violation(cardinality.policyId, 'PARTICIPANTS_ABOVE_MAXIMUM',
        cardinality.reason || 'Participant maximum exceeded', participants.length, `<= ${cardinality.maximum}`));
    }
    const ids = participants.map((p) => String((typeof p === 'string' ? p : (p?.participantId || p?.model)) || '').trim());
    if (ids.some((id) => !id)) {
      errors.push(violation('participant-identity.v1', 'PARTICIPANT_ID_REQUIRED',
        'Every participant needs a stable participantId', ids, 'non-empty ids'));
    }
    if (new Set(ids.filter(Boolean)).size !== ids.filter(Boolean).length) {
      errors.push(violation('participant-identity.v1', 'PARTICIPANT_ID_DUPLICATE',
        'Participant ids must be unique', ids, 'unique ids'));
    }
    const completion = policies.completion || DEFAULT_COMPLETION;
    appliedPolicies.push(completion.policyId);
    if (completion.mode === 'quorum') {
      const quorum = Number(completion.quorumSize);
      if (!Number.isInteger(quorum) || quorum < 1 || quorum > Math.max(participants.length, 1)) {
        errors.push(violation(completion.policyId, 'QUORUM_INVALID',
          'quorumSize must be an integer within participant count', completion.quorumSize, `1..${participants.length}`));
      }
    }
    const finalization = policies.finalization || DEFAULT_FINALIZATION;
    appliedPolicies.push(finalization.policyId);
    if (finalization.synthesis === 'required' && !participants.length) {
      errors.push(violation(finalization.policyId, 'SYNTHESIS_NEEDS_PARTICIPANT',
        'Required synthesis needs at least one participant with synthesis capability', 0, '>= 1'));
    }
    const budgets = policies.budgets || DEFAULT_BUDGETS;
    appliedPolicies.push(budgets.policyId);
    Object.entries(budgets).forEach(([key, value]) => {
      if (key === 'policyId' || value == null) return;
      if (!Number.isFinite(Number(value)) || Number(value) < 0) {
        errors.push(violation(budgets.policyId, 'BUDGET_LIMIT_INVALID',
          `${key} must be a non-negative finite number or null`, value, '>= 0 or null'));
      }
    });
    return { valid: errors.length === 0, errors, appliedPolicies };
  }

  const api = Object.freeze({
    POLICY_SCHEMA_VERSION,
    DEFAULT_CARDINALITY,
    DEFAULT_FINALIZATION,
    DEFAULT_STAGNATION,
    DEFAULT_PAUSE,
    DEFAULT_RETRY,
    DEFAULT_COMPLETION,
    DEFAULT_INDEPENDENCE,
    DEFAULT_COMPACTION,
    DEFAULT_BUDGETS,
    defaults,
    resolve,
    validateConfiguration
  });
  root.DebatePolicies = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
