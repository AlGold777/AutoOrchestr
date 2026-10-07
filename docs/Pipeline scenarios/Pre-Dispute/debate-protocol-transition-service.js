// Atomic integration boundary between mutable topology FSMs and DebateRunStore.
(function initDebateProtocolTransitionService(root) {
  'use strict';

  const VERSION = 1;
  const CONTRACT = Object.freeze({
    name: 'DebateProtocolTransitionService',
    version: VERSION,
    methods: Object.freeze(['applyProtocolTransition', 'cloneProtocolState']),
    requiredWhen: 'legacy'
  });

  function cloneProtocolState(value, seen = new WeakMap()) {
    if (value == null || typeof value !== 'object') return value;
    if (seen.has(value)) return seen.get(value);
    if (value instanceof Date) return new Date(value.getTime());
    if (value instanceof Set) {
      const cloned = new Set();
      seen.set(value, cloned);
      value.forEach((item) => cloned.add(cloneProtocolState(item, seen)));
      return cloned;
    }
    if (value instanceof Map) {
      const cloned = new Map();
      seen.set(value, cloned);
      value.forEach((item, key) => cloned.set(cloneProtocolState(key, seen), cloneProtocolState(item, seen)));
      return cloned;
    }
    if (Array.isArray(value)) {
      const cloned = [];
      seen.set(value, cloned);
      value.forEach((item) => cloned.push(cloneProtocolState(item, seen)));
      return cloned;
    }
    const cloned = {};
    seen.set(value, cloned);
    Reflect.ownKeys(value).forEach((key) => {
      cloned[key] = cloneProtocolState(value[key], seen);
    });
    return cloned;
  }

  function replaceStateContents(target, source) {
    if (!target || typeof target !== 'object') return cloneProtocolState(source);
    Reflect.ownKeys(target).forEach((key) => { delete target[key]; });
    const committed = cloneProtocolState(source);
    Reflect.ownKeys(committed || {}).forEach((key) => { target[key] = committed[key]; });
    return target;
  }

  function applyProtocolTransition(input = {}) {
    const protocol = input.protocol;
    const protocolState = input.protocolState;
    const event = input.event || {};
    if (!protocol || typeof protocol.reduce !== 'function') {
      throw new TypeError('PROTOCOL_TRANSITION_REDUCER_MISSING');
    }
    if (!protocolState || typeof protocolState !== 'object') {
      throw new TypeError('PROTOCOL_TRANSITION_STATE_MISSING');
    }
    if (!event.type) throw new TypeError('PROTOCOL_TRANSITION_EVENT_TYPE_MISSING');
    if (typeof input.syncState !== 'function') {
      throw new TypeError('PROTOCOL_TRANSITION_SYNC_MISSING');
    }

    const revisionValue = typeof input.getProtocolRevision === 'function'
      ? input.getProtocolRevision()
      : null;
    const expectedProtocolRevision = revisionValue == null ? null : Number(revisionValue);
    const draft = cloneProtocolState(protocolState);
    const reduced = protocol.reduce(draft, event) || draft;
    const synchronized = input.syncState(
      reduced,
      String(input.reason || event.type || 'protocol_transition'),
      Number.isFinite(expectedProtocolRevision) ? { expectedProtocolRevision } : {}
    ) || reduced;

    // The live FSM object is mutated only after canonical synchronization succeeds.
    return replaceStateContents(protocolState, synchronized);
  }

  const api = Object.freeze({ VERSION, CONTRACT, applyProtocolTransition, cloneProtocolState });
  root.DebateProtocolTransitionService = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
