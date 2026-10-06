// Validates extracted semantic changes before they can affect the state map.
(function initDebateStateDelta(root) {
  'use strict';
  const VERSION = 1;
  const text = (value) => String(value == null ? '' : value).trim();
  const loose = (value) => text(value).replace(/\s+/g, ' ').toLowerCase();
  const list = (value) => Array.isArray(value) ? value : [];
  const OPERATIONS = Object.freeze(['create', 'set_status', 'revise', 'merge', 'supersede', 'reopen', 'human_decision']);

  function normalize(input = {}) {
    const changes = list(input.changes || input.artifacts).map((change, index) => ({
      changeId: text(change.changeId || `${input.deltaId || 'delta'}:${index + 1}`),
      operation: text(change.operation || change.op || 'create').toLowerCase(),
      artifact: change.artifact || change,
      targetId: text(change.targetId || change.id || change.artifact?.targetId),
      expectedRevision: change.expectedRevision == null ? null : Number(change.expectedRevision),
      anchor: change.anchor || change.provenance || change.artifact?.provenance || null,
      confidence: Math.max(0, Math.min(1, Number(change.confidence ?? input.confidence ?? 0.5)))
    }));
    return Object.freeze({
      schemaVersion: VERSION,
      deltaId: text(input.deltaId || input.actionId || `delta-${Date.now()}`),
      actionId: text(input.actionId), attemptId: text(input.attemptId), actor: text(input.actor || 'synthesizer'),
      expectedSequence: input.expectedSequence == null ? null : Number(input.expectedSequence),
      changes: Object.freeze(changes)
    });
  }

  function findEvent(state, turnId) {
    return list(state?.sourceEvents || state?.events || state?.eventLog).find((event) => text(event.turnId || event.eventId || event.id) === text(turnId)) || null;
  }

  function anchorVerdict(state, anchor) {
    if (!anchor || typeof anchor !== 'object') return { ok: false, reason: 'anchor_missing' };
    const turnId = text(anchor.turnId || anchor.eventId);
    const quote = loose(anchor.quote);
    const event = findEvent(state, turnId);
    if (!event) return { ok: false, reason: `anchor_event_missing:${turnId || 'none'}` };
    if (quote.length < 3) return { ok: false, reason: 'anchor_quote_too_short' };
    const source = loose(event.text || event.payload?.text || event.payload?.answer);
    return source.includes(quote) ? { ok: true, event } : { ok: false, reason: `anchor_quote_not_found:${turnId}` };
  }

  function validate(state = {}, input = {}) {
    const delta = normalize(input);
    const errors = [];
    if (!delta.deltaId) errors.push('delta_id_missing');
    if (!delta.changes.length) errors.push('delta_changes_missing');
    if (delta.expectedSequence != null && delta.expectedSequence !== list(state.changes).length) errors.push(`delta_sequence_stale:${delta.expectedSequence}:${list(state.changes).length}`);
    delta.changes.forEach((change) => {
      if (!OPERATIONS.includes(change.operation)) errors.push(`delta_operation_invalid:${change.operation}`);
      const artifact = change.artifact || {};
      const id = text(artifact.id || change.targetId);
      const existing = state.artifacts?.[id];
      if (change.operation === 'create' && existing) errors.push(`delta_artifact_exists:${id}`);
      if (change.operation !== 'create' && !existing && change.operation !== 'human_decision') errors.push(`delta_target_missing:${id}`);
      if (existing && change.expectedRevision != null && Number(existing.revision || 0) !== change.expectedRevision) errors.push(`delta_revision_stale:${id}:${change.expectedRevision}:${Number(existing.revision || 0)}`);
      const anchored = anchorVerdict(state, change.anchor);
      if (!anchored.ok && change.operation !== 'human_decision') errors.push(anchored.reason);
      if (change.confidence < 0.35) errors.push(`delta_confidence_too_low:${change.changeId}`);
    });
    return Object.freeze({ ok: errors.length === 0, errors: Object.freeze(errors), delta });
  }

  function apply(state, input, schema = root.DebateCaseSchema) {
    const verdict = validate(state, input);
    if (!verdict.ok) return { ok: false, errors: verdict.errors, state, delta: verdict.delta };
    if (!schema?.applyChange) return { ok: false, errors: ['case_schema_unavailable'], state, delta: verdict.delta };
    let next = state; const applied = [];
    for (const change of verdict.delta.changes) {
      const artifactInput = change.artifact || {};
      const id = text(artifactInput.id || change.targetId);
      const previous = next.artifacts?.[id] || null;
      let artifact = { ...(previous || {}), ...artifactInput, id, provenance: change.anchor, extractionConfidence: change.confidence };
      if (change.operation === 'set_status' || change.operation === 'reopen') artifact.status = change.operation === 'reopen' ? 'reopened' : text(artifactInput.status);
      if (change.operation === 'revise') artifact = { ...artifactInput, id: text(artifactInput.id || `${id}:revision`), type: 'revision', targetId: id, provenance: change.anchor, extractionConfidence: change.confidence };
      if (change.operation === 'supersede') artifact = { ...previous, status: 'superseded', supersededBy: text(artifactInput.supersededBy), provenance: change.anchor };
      if (change.operation === 'merge') artifact = { ...previous, mergedInto: text(artifactInput.mergedInto), status: 'merged', provenance: change.anchor };
      if (change.operation === 'human_decision') artifact = { ...artifactInput, id: id || `human-${verdict.delta.deltaId}`, type: 'human_decision', status: 'accepted', provenance: change.anchor || { actor: 'human' } };
      const result = schema.applyChange(next, {
        kind: 'UPSERT_ARTIFACT', actor: verdict.delta.actor,
        correlationId: `${verdict.delta.deltaId}:${change.changeId}`,
        expectedSequence: next.changes.length,
        artifact
      });
      if (!result.ok) return { ok: false, errors: result.errors, state: next, partial: applied, delta: verdict.delta };
      next = result.state; applied.push(artifact.id);
    }
    return { ok: true, state: next, applied, delta: verdict.delta };
  }

  const api = Object.freeze({ VERSION, OPERATIONS, normalize, findEvent, anchorVerdict, validate, apply });
  root.DebateStateDelta = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
