// Owner of Debate UI sessions; exposes the legacy state shape as a projection.
(function initDebateSessionsStore(root) {
  'use strict';

  function normalizeSession(id, session = {}) {
    return {
      id: String(id || session.id || '1'),
      title: String(session.title || id || '1'),
      favoriteOnly: session.favoriteOnly === true,
      cards: Array.isArray(session.cards) ? session.cards : [],
      messages: Array.isArray(session.messages) ? session.messages : [],
      ...session
    };
  }

  function create(initial = {}) {
    const activeSessionId = String(initial.activeSessionId || '1');
    const sessions = initial.sessions instanceof Map ? initial.sessions : new Map();
    if (!sessions.has(activeSessionId)) sessions.set(activeSessionId, normalizeSession(activeSessionId));
    const state = { activeSessionId, sessions };
    return Object.freeze({
      state,
      ensure(sessionId = state.activeSessionId) {
        const id = String(sessionId || '1');
        if (!state.sessions.has(id)) state.sessions.set(id, normalizeSession(id));
        const session = normalizeSession(id, state.sessions.get(id));
        state.sessions.set(id, session);
        return session;
      },
      setActive(sessionId) {
        const session = this.ensure(sessionId);
        state.activeSessionId = session.id;
        return session;
      },
      remove(sessionId) {
        const id = String(sessionId || '');
        const removed = state.sessions.delete(id);
        if (state.activeSessionId === id) state.activeSessionId = Array.from(state.sessions.keys())[0] || '1';
        if (!state.sessions.size) this.ensure('1');
        return removed;
      },
      list() { return Array.from(state.sessions.values()); }
    });
  }

  const api = Object.freeze({ create });
  root.DebateSessionsStore = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
