// Canonical participant and terminal transport-failure contract shared by all
// debate topologies. Keeps acceptance failures separate from transport dropout.
(function initDebateParticipantRegistry(root) {
  'use strict';

  const normalizeModelIds = (models) => Array.from(new Set((Array.isArray(models) ? models : [])
    .map((model) => String(model || '').trim()).filter(Boolean)));

  const normalizeFailure = (failure, defaults = {}) => {
    if (!failure || typeof failure !== 'object') return null;
    const modelId = String(failure.modelId || failure.model || failure.participant || '').trim();
    if (!modelId || failure.terminal === false) return null;
    return {
      modelId,
      terminal: true,
      reasonCode: String(failure.reasonCode || failure.reason || defaults.reasonCode || 'terminal_transport_failure'),
      stageId: String(failure.stageId || defaults.stageId || ''),
      attemptId: String(failure.attemptId || defaults.attemptId || '')
    };
  };

  function terminalFailures(result, defaults = {}) {
    const raw = result?.failed;
    if (!raw) return [];
    const failures = Array.isArray(raw)
      ? raw.map((entry) => normalizeFailure(entry, defaults))
      : Object.entries(raw).map(([modelId, reasonCode]) => normalizeFailure({ modelId, reasonCode }, defaults));
    const byModel = new Map();
    failures.filter(Boolean).forEach((failure) => byModel.set(failure.modelId, failure));
    return Array.from(byModel.values());
  }

  function initialize(state, configuredModels) {
    if (!state) return state;
    const configured = normalizeModelIds(configuredModels);
    const existingDropped = normalizeModelIds(state.droppedModels);
    state.configuredParticipants = configured;
    state.droppedParticipants = Array.isArray(state.droppedParticipants) ? state.droppedParticipants.slice() : [];
    state.droppedModels = existingDropped;
    state.activeParticipants = configured.filter((modelId) => !existingDropped.includes(modelId));
    return state;
  }

  function markDropped(state, failures, defaults = {}) {
    if (!state) return [];
    const normalized = (Array.isArray(failures) ? failures : [])
      .map((failure) => typeof failure === 'string'
        ? normalizeFailure({ modelId: failure }, defaults)
        : normalizeFailure(failure, defaults))
      .filter(Boolean);
    const configured = normalizeModelIds(state.configuredParticipants || state.models);
    const dropped = new Set(normalizeModelIds(state.droppedModels));
    state.droppedParticipants = Array.isArray(state.droppedParticipants) ? state.droppedParticipants : [];
    normalized.forEach((failure) => {
      dropped.add(failure.modelId);
      const index = state.droppedParticipants.findIndex((entry) => entry?.modelId === failure.modelId);
      if (index < 0) state.droppedParticipants.push(failure);
      else state.droppedParticipants[index] = { ...state.droppedParticipants[index], ...failure, terminal: true };
    });
    state.configuredParticipants = configured;
    state.droppedModels = Array.from(dropped);
    state.activeParticipants = configured.filter((modelId) => !dropped.has(modelId));
    return state.activeParticipants.slice();
  }

  const active = (state) => normalizeModelIds(state?.activeParticipants
    || normalizeModelIds(state?.configuredParticipants || state?.models).filter((modelId) => !normalizeModelIds(state?.droppedModels).includes(modelId)));

  const filterActive = (state, models) => {
    const activeSet = new Set(active(state));
    return normalizeModelIds(models).filter((modelId) => activeSet.has(modelId));
  };

  const api = Object.freeze({ normalizeModelIds, terminalFailures, initialize, markDropped, active, filterActive });
  root.DebateParticipantRegistry = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
