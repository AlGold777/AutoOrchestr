(function initDebateEngine(root) {
  'use strict';

  // Transcript persistence/export utility. Executable prompts are owned by
  // DebatePromptCompiler and DebatePromptPack, never by this UI store.
  const VERSION = 1;
  const STORAGE_KEY = 'llmCortexDebateEngineState.v1';
  const DEFAULT_SETTINGS = Object.freeze({
    runPolicy: 'manual',
    maxTurns: 5,
    mode: 'universal_pipeline',
    turnLimit: 3,
    autoApprovalDelayMs: 0,
    stopOnFailure: true,
    stopOnUncertain: true,
    deliveryMode: 'reused_tab',
    contextPolicy: 'auto',
    maxFullTurns: 30,
    maxTurnTextChars: 12000,
    summaryAfterTurns: 20,
    recentTurns: 8
  });
  const TURN_STATUSES = Object.freeze([
    'draft',
    'pending',
    'streaming',
    'completed',
    'awaiting_approval',
    'approved',
    'rejected',
    'superseded'
  ]);
  const TERMINAL_STATUSES = Object.freeze([
    'SUCCESS',
    'PARTIAL',
    'ERROR',
    'NO_SEND',
    'EXTRACT_FAILED',
    'EXTERNAL_LLM_FAILURE',
    'USER_ACTION_REQUIRED',
    'UNCERTAIN'
  ]);
  const UNIVERSAL_PIPELINE_MODE = 'universal_pipeline';

  const nowIso = () => new Date().toISOString();
  const compactIdPart = () => Math.random().toString(36).slice(2, 8);
  const makeId = (prefix) => `${prefix}-${Date.now()}-${compactIdPart()}`;
  const clampInt = (value, min, max, fallback) => {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return fallback;
    return Math.max(min, Math.min(max, Math.round(numeric)));
  };
  const normalizeArray = (value) => Array.isArray(value) ? value.filter((item) => item != null).map(String) : [];
  const normalizeRunPolicy = (value) => String(value || '').toLowerCase() === 'auto' ? 'auto' : 'manual';
  const normalizeTurnLimit = (value, fallback = DEFAULT_SETTINGS.turnLimit) => {
    if (value === 'infinite' || value === Infinity || String(value || '').trim() === '∞') return 'infinite';
    return clampInt(value, 1, 50, fallback);
  };
  const normalizeStatus = (value, fallback = 'draft') => {
    const status = String(value || fallback).toLowerCase();
    return TURN_STATUSES.includes(status) ? status : fallback;
  };
  const normalizeTerminalStatus = (value) => {
    const status = String(value || '').trim().toUpperCase();
    return TERMINAL_STATUSES.includes(status) ? status : '';
  };
  const trimText = (text, limit = DEFAULT_SETTINGS.maxTurnTextChars) => {
    const value = String(text || '');
    if (value.length <= limit) return value;
    return `${value.slice(0, Math.max(0, limit - 16))}\n[...truncated]`;
  };
  const clone = (value) => {
    if (value == null) return value;
    try {
      if (typeof structuredClone === 'function') return structuredClone(value);
    } catch (_) {}
    return JSON.parse(JSON.stringify(value));
  };
  const escapeMarkdown = (value) => String(value || '').replace(/\r\n/g, '\n');

  function normalizeSettings(settings = {}) {
    return {
      ...DEFAULT_SETTINGS,
      ...settings,
      runPolicy: normalizeRunPolicy(settings.runPolicy || DEFAULT_SETTINGS.runPolicy),
      maxTurns: clampInt(settings.maxTurns, 1, 50, DEFAULT_SETTINGS.maxTurns),
      mode: settings.mode === UNIVERSAL_PIPELINE_MODE ? UNIVERSAL_PIPELINE_MODE : DEFAULT_SETTINGS.mode,
      turnLimit: normalizeTurnLimit(settings.turnLimit, DEFAULT_SETTINGS.turnLimit),
      autoApprovalDelayMs: clampInt(settings.autoApprovalDelayMs, 0, 60000, DEFAULT_SETTINGS.autoApprovalDelayMs),
      maxFullTurns: clampInt(settings.maxFullTurns, 1, 200, DEFAULT_SETTINGS.maxFullTurns),
      maxTurnTextChars: clampInt(settings.maxTurnTextChars, 500, 100000, DEFAULT_SETTINGS.maxTurnTextChars),
      summaryAfterTurns: clampInt(settings.summaryAfterTurns, 1, 200, DEFAULT_SETTINGS.summaryAfterTurns),
      recentTurns: clampInt(settings.recentTurns, 1, 30, DEFAULT_SETTINGS.recentTurns)
    };
  }

  function createSession(input = {}) {
    const createdAt = input.createdAt || nowIso();
    return {
      sessionId: String(input.sessionId || makeId('debate-session')),
      title: String(input.title || 'Debate'),
      createdAt,
      updatedAt: input.updatedAt || createdAt,
      status: String(input.status || 'idle'),
      participants: Array.isArray(input.participants) ? clone(input.participants) : [],
      moderator: input.moderator ? clone(input.moderator) : { type: 'human', name: 'Moderator' },
      turns: Array.isArray(input.turns) ? input.turns.map((turn, index) => normalizeTurn(turn, { sessionId: input.sessionId, index: index + 1 })) : [],
      summaries: Array.isArray(input.summaries) ? clone(input.summaries) : [],
      settings: normalizeSettings(input.settings || {})
    };
  }

  function normalizeTurn(input = {}, fallback = {}) {
    const sessionId = String(input.sessionId || fallback.sessionId || '');
    const createdAt = input.createdAt || nowIso();
    const textLimit = input.settings?.maxTurnTextChars || DEFAULT_SETTINGS.maxTurnTextChars;
    return {
      turnId: String(input.turnId || makeId('turn')),
      responseId: input.responseId ? String(input.responseId) : null,
      sessionId,
      index: clampInt(input.index, 1, Number.MAX_SAFE_INTEGER, fallback.index || 1),
      author: String(input.author || 'Moderator'),
      authorType: ['moderator', 'model', 'system'].includes(input.authorType) ? input.authorType : 'moderator',
      role: String(input.role || ''),
      targets: normalizeArray(input.targets),
      replyToTurnId: input.replyToTurnId ? String(input.replyToTurnId) : null,
      text: trimText(input.text, textLimit),
      html: input.html ? trimText(input.html, textLimit) : '',
      status: normalizeStatus(input.status, 'draft'),
      terminalStatus: normalizeTerminalStatus(input.terminalStatus),
      evidence: input.evidence ? clone(input.evidence) : null,
      createdAt,
      completedAt: input.completedAt || null,
      approvedAt: input.approvedAt || null,
      delivery: input.delivery ? clone(input.delivery) : {}
    };
  }

  function createTurn(session, input = {}) {
    const turns = Array.isArray(session?.turns) ? session.turns : [];
    return normalizeTurn({
      ...input,
      sessionId: input.sessionId || session?.sessionId,
      index: input.index || turns.length + 1,
      settings: session?.settings || DEFAULT_SETTINGS
    });
  }

  function createStore(initial = {}) {
    const sessions = new Map();
    const sourceSessions = Array.isArray(initial.sessions)
      ? initial.sessions
      : (initial.session ? [initial.session] : []);
    sourceSessions.forEach((sessionInput) => {
      const session = createSession(sessionInput);
      sessions.set(session.sessionId, session);
    });
    const firstSession = sessions.values().next().value || createSession();
    sessions.set(firstSession.sessionId, firstSession);
    let activeSessionId = String(initial.activeSessionId || firstSession.sessionId);
    if (!sessions.has(activeSessionId)) activeSessionId = firstSession.sessionId;

    const touch = (session) => {
      if (session) session.updatedAt = nowIso();
      return session;
    };

    const api = {
      version: VERSION,
      get activeSessionId() { return activeSessionId; },
      setActiveSession(sessionId) {
        const id = String(sessionId || '');
        if (!sessions.has(id)) throw new Error(`Unknown debate session: ${id}`);
        activeSessionId = id;
        return api.getSession(id);
      },
      listSessions() {
        return Array.from(sessions.values()).map(clone);
      },
      getSession(sessionId = activeSessionId) {
        const session = sessions.get(String(sessionId || activeSessionId));
        return session ? clone(session) : null;
      },
      getMutableSession(sessionId = activeSessionId) {
        return sessions.get(String(sessionId || activeSessionId)) || null;
      },
      upsertSession(input = {}) {
        const existing = input.sessionId ? sessions.get(String(input.sessionId)) : null;
        const session = createSession({ ...(existing || {}), ...input });
        sessions.set(session.sessionId, touch(session));
        activeSessionId = session.sessionId;
        return clone(session);
      },
      updateSettings(sessionId, settings = {}) {
        const session = api.getMutableSession(sessionId);
        if (!session) throw new Error(`Unknown debate session: ${sessionId}`);
        session.settings = normalizeSettings({ ...session.settings, ...settings });
        touch(session);
        return clone(session.settings);
      },
      appendTurn(sessionId, input = {}) {
        const session = api.getMutableSession(sessionId);
        if (!session) throw new Error(`Unknown debate session: ${sessionId}`);
        const turn = createTurn(session, input);
        session.turns.push(turn);
        touch(session);
        return clone(turn);
      },
      updateTurn(sessionId, turnId, patch = {}) {
        const session = api.getMutableSession(sessionId);
        if (!session) throw new Error(`Unknown debate session: ${sessionId}`);
        const index = session.turns.findIndex((turn) => turn.turnId === turnId);
        if (index < 0) throw new Error(`Unknown debate turn: ${turnId}`);
        session.turns[index] = normalizeTurn({ ...session.turns[index], ...patch }, { sessionId, index: session.turns[index].index });
        touch(session);
        return clone(session.turns[index]);
      },
      approveTurn(sessionId, turnId, patch = {}) {
        return api.updateTurn(sessionId, turnId, { ...patch, status: 'approved', approvedAt: patch.approvedAt || nowIso() });
      },
      rejectTurn(sessionId, turnId, patch = {}) {
        return api.updateTurn(sessionId, turnId, { ...patch, status: 'rejected' });
      },
      deleteTurn(sessionId, turnId) {
        const session = api.getMutableSession(sessionId);
        if (!session) throw new Error(`Unknown debate session: ${sessionId}`);
        const before = session.turns.length;
        session.turns = session.turns.filter((turn) => turn.turnId !== turnId);
        session.turns = session.turns.map((turn, index) => ({ ...turn, index: index + 1 }));
        touch(session);
        return { deleted: before !== session.turns.length, turnId };
      },
      clearTurns(sessionId) {
        const session = api.getMutableSession(sessionId);
        if (!session) throw new Error(`Unknown debate session: ${sessionId}`);
        session.turns = [];
        touch(session);
        return clone(session);
      },
      toJSON() {
        return {
          version: VERSION,
          activeSessionId,
          sessions: Array.from(sessions.values()).map(clone)
        };
      }
    };
    return api;
  }

  function compactSession(sessionInput, policy = {}) {
    const session = createSession(sessionInput);
    const settings = normalizeSettings({ ...session.settings, ...policy });
    const turns = session.turns || [];
    const fullStart = Math.max(0, turns.length - settings.maxFullTurns);
    const fullTurns = turns.slice(fullStart).map((turn) => normalizeTurn({ ...turn, text: trimText(turn.text, settings.maxTurnTextChars), html: trimText(turn.html, settings.maxTurnTextChars) }));
    const omittedTurns = turns.slice(0, fullStart);
    const summaries = session.summaries.slice();
    if (omittedTurns.length) {
      const upToTurnIndex = omittedTurns[omittedTurns.length - 1]?.index || omittedTurns.length;
      const alreadyCovered = summaries.some((summary) => Number(summary?.upToTurnIndex || 0) >= upToTurnIndex);
      if (!alreadyCovered) {
        summaries.push(createRuleBasedSummary(omittedTurns, { upToTurnIndex }));
      }
    }
    return {
      ...session,
      turns: fullTurns,
      summaries,
      settings
    };
  }

  function serializeStore(store, policy = {}) {
    const snapshot = typeof store?.toJSON === 'function' ? store.toJSON() : store;
    return {
      version: VERSION,
      activeSessionId: snapshot.activeSessionId,
      sessions: (snapshot.sessions || []).map((session) => compactSession(session, policy))
    };
  }

  async function persistStore(store, options = {}) {
    const key = options.key || STORAGE_KEY;
    const storage = options.storage || root?.chrome?.storage?.local;
    if (!storage?.set) return { ok: false, reason: 'storage_unavailable' };
    const payload = serializeStore(store, options.policy || {});
    await storage.set({ [key]: payload });
    return { ok: true, key, payload };
  }

  async function loadStore(options = {}) {
    const key = options.key || STORAGE_KEY;
    const storage = options.storage || root?.chrome?.storage?.local;
    if (!storage?.get) return createStore();
    const result = await storage.get(key);
    return createStore(result?.[key] || {});
  }

  function createRuleBasedSummary(turns = [], options = {}) {
    const normalized = turns.map((turn, index) => normalizeTurn(turn, { index: index + 1 }));
    const excerpts = normalized.map((turn) => `${turn.index}. ${turn.author}: ${trimText(turn.text, 220).replace(/\s+/g, ' ')}`);
    return {
      summaryId: String(options.summaryId || makeId('summary')),
      upToTurnIndex: options.upToTurnIndex || normalized[normalized.length - 1]?.index || 0,
      consensus: '',
      disagreements: '',
      claims: excerpts,
      openQuestions: [],
      nextFocus: '',
      text: excerpts.join('\n'),
      createdAt: nowIso()
    };
  }

  function exportArtifact(storeOrSession) {
    const snapshot = typeof storeOrSession?.toJSON === 'function'
      ? storeOrSession.toJSON()
      : { version: VERSION, activeSessionId: storeOrSession.sessionId, sessions: [createSession(storeOrSession)] };
    return {
      version: VERSION,
      exportedAt: nowIso(),
      activeSessionId: snapshot.activeSessionId,
      sessions: snapshot.sessions || []
    };
  }

  function exportMarkdown(sessionInput) {
    const session = createSession(sessionInput);
    const lines = [
      '# Debate',
      '',
      `Moderator: ${session.moderator?.name || 'Moderator'}`,
      `Participants: ${(session.participants || []).map((item) => item.name || item.modelName || item).join(', ') || 'None'}`,
      ''
    ];
    session.turns.forEach((turn) => {
      lines.push(`## Turn ${turn.index} — ${turn.author}${turn.targets?.length ? ` -> ${turn.targets.join(', ')}` : ''}`);
      if (turn.role) lines.push(`Role: ${turn.role}`);
      if (turn.terminalStatus) lines.push(`Outcome: ${turn.terminalStatus}`);
      lines.push('', escapeMarkdown(turn.text), '');
    });
    return lines.join('\n');
  }

  function replayArtifact(artifact = {}) {
    return createStore({
      activeSessionId: artifact.activeSessionId,
      sessions: artifact.sessions || []
    });
  }

  const api = {
    VERSION,
    STORAGE_KEY,
    DEFAULT_SETTINGS,
    TURN_STATUSES,
    TERMINAL_STATUSES,
    UNIVERSAL_PIPELINE_MODE,
    normalizeSettings,
    createSession,
    createTurn,
    createStore,
    compactSession,
    serializeStore,
    persistStore,
    loadStore,
    createRuleBasedSummary,
    exportArtifact,
    exportMarkdown,
    replayArtifact
  };

  root.DebateEngine = api;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(typeof window !== 'undefined' ? window : globalThis);
