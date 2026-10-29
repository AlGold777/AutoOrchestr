// background/dispatch-state-machine.js
// Dispatch lifecycle state machine for LLM prompt delivery.

'use strict';

const DISPATCH_STATES = {
  IDLE: 'IDLE',
  QUEUED: 'QUEUED',
  ACTIVATING: 'ACTIVATING',
  TYPING: 'TYPING',
  SUBMITTING: 'SUBMITTING',
  WAITING: 'WAITING',
  STREAMING: 'STREAMING',
  DONE: 'DONE',
  ERROR: 'ERROR'
};

const TRANSITIONS = {
  [DISPATCH_STATES.IDLE]: [DISPATCH_STATES.QUEUED],
  [DISPATCH_STATES.QUEUED]: [DISPATCH_STATES.ACTIVATING, DISPATCH_STATES.ERROR],
  [DISPATCH_STATES.ACTIVATING]: [DISPATCH_STATES.TYPING, DISPATCH_STATES.ERROR],
  [DISPATCH_STATES.TYPING]: [DISPATCH_STATES.SUBMITTING, DISPATCH_STATES.ERROR],
  [DISPATCH_STATES.SUBMITTING]: [DISPATCH_STATES.WAITING, DISPATCH_STATES.ERROR],
  [DISPATCH_STATES.WAITING]: [DISPATCH_STATES.STREAMING, DISPATCH_STATES.DONE, DISPATCH_STATES.ERROR],
  [DISPATCH_STATES.STREAMING]: [DISPATCH_STATES.DONE, DISPATCH_STATES.ERROR],
  [DISPATCH_STATES.DONE]: [DISPATCH_STATES.IDLE],
  [DISPATCH_STATES.ERROR]: [DISPATCH_STATES.IDLE, DISPATCH_STATES.QUEUED]
};

class DispatchStateMachine {
  constructor(llmName) {
    this.llmName = llmName;
    this.state = DISPATCH_STATES.IDLE;
    this.data = {};
    this.history = [];
    this.listeners = new Set();
    this.enteredAt = Date.now();
  }

  queue(data) {
    return this._transition(DISPATCH_STATES.QUEUED, {
      prompt: data?.prompt,
      attachments: data?.attachments || [],
      dispatchId: data?.dispatchId || this._generateId(),
      dispatchAttempts: data?.dispatchAttempts,
      queuedAt: Date.now()
    });
  }

  activate(data) {
    return this._transition(DISPATCH_STATES.ACTIVATING, {
      tabId: data?.tabId ?? null,
      activatingAt: Date.now(),
      ...data
    });
  }

  ready(data = {}) {
    return this._transition(DISPATCH_STATES.TYPING, {
      readyAt: Date.now(),
      ...data
    });
  }

  submit(data = {}) {
    return this._transition(DISPATCH_STATES.SUBMITTING, {
      submittingAt: Date.now(),
      ...data
    });
  }

  sent(data = {}) {
    return this._transition(DISPATCH_STATES.WAITING, {
      sentAt: Date.now(),
      ...data
    });
  }

  stream(data = {}) {
    return this._transition(DISPATCH_STATES.STREAMING, {
      streamStartedAt: Date.now(),
      ...data
    });
  }

  complete(data) {
    return this._transition(DISPATCH_STATES.DONE, {
      response: data?.response,
      completedAt: Date.now(),
      duration: Date.now() - (this.data.queuedAt || Date.now()),
      ...data
    });
  }

  error(data) {
    return this._transition(DISPATCH_STATES.ERROR, {
      error: data?.error,
      errorCode: data?.code,
      errorAt: Date.now(),
      failedInState: this.state,
      ...data
    });
  }

  reset() {
    if (this.state === DISPATCH_STATES.IDLE) {
      this.data = {};
      return;
    }
    const hadError = this.state === DISPATCH_STATES.ERROR;
    const hadSuccess = this.state === DISPATCH_STATES.DONE;
    // Only DONE and ERROR lead to IDLE in TRANSITIONS; a dispatch abandoned in QUEUED..STREAMING (a stopped run, a
    // plain send never finished) must still be dropped, or the next run reads that state as «already sent».
    this._transition(DISPATCH_STATES.IDLE, {
      resetAt: Date.now(),
      previousOutcome: hadError ? 'error' : (hadSuccess ? 'success' : 'cancelled')
    }, { force: true });
    this.data = {};
  }

  retry() {
    if (this.state !== DISPATCH_STATES.ERROR) {
      console.warn(`[STATE] Cannot retry from ${this.state}`);
      return false;
    }
    const { prompt, attachments } = this.data;
    this.reset();
    return this.queue({ prompt, attachments });
  }

  is(state) {
    return this.state === state;
  }

  isOneOf(...states) {
    return states.includes(this.state);
  }

  isTerminal() {
    return this.state === DISPATCH_STATES.DONE || this.state === DISPATCH_STATES.ERROR;
  }

  isInProgress() {
    return this.isOneOf(
      DISPATCH_STATES.QUEUED,
      DISPATCH_STATES.ACTIVATING,
      DISPATCH_STATES.TYPING,
      DISPATCH_STATES.SUBMITTING,
      DISPATCH_STATES.WAITING,
      DISPATCH_STATES.STREAMING
    );
  }

  canQueue() {
    return this.state === DISPATCH_STATES.IDLE;
  }

  getTimeInState() {
    return Date.now() - this.enteredAt;
  }

  onTransition(callback) {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }

  getSnapshot() {
    return {
      llmName: this.llmName,
      state: this.state,
      data: { ...this.data },
      enteredAt: this.enteredAt,
      timeInState: this.getTimeInState(),
      historyLength: this.history.length
    };
  }

  _transition(newState, data = {}, { force = false } = {}) {
    if (!force && !this._canTransition(newState)) {
      console.error(`[STATE] Invalid transition: ${this.llmName} ${this.state} -> ${newState}`);
      return false;
    }
    const prevState = this.state;
    const prevData = { ...this.data };
    this.state = newState;
    this.data = { ...this.data, ...data };
    this.enteredAt = Date.now();

    this.history.push({
      from: prevState,
      to: newState,
      data,
      timestamp: Date.now()
    });
    if (this.history.length > 50) {
      this.history = this.history.slice(-50);
    }

    const event = {
      llmName: this.llmName,
      from: prevState,
      to: newState,
      data: this.data,
      prevData,
      timestamp: Date.now()
    };

    globalThis.LLMLog?.debug?.(`[STATE] ${this.llmName}: ${prevState} -> ${newState}`, data);

    this.listeners.forEach((fn) => {
      try {
        fn(event);
      } catch (err) {
        console.error('[STATE] Listener error:', err);
      }
    });
    return true;
  }

  _canTransition(newState) {
    const allowed = TRANSITIONS[this.state];
    return !!(allowed && allowed.includes(newState));
  }

  _generateId() {
    return `${this.llmName}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  }
}

const DispatchStateManager = {
  _machines: new Map(),
  _globalListeners: new Set(),

  get(llmName) {
    if (!this._machines.has(llmName)) {
      const machine = new DispatchStateMachine(llmName);
      machine.onTransition((event) => {
        this._globalListeners.forEach((fn) => fn(event));
      });
      this._machines.set(llmName, machine);
    }
    return this._machines.get(llmName);
  },

  onAnyTransition(callback) {
    this._globalListeners.add(callback);
    return () => this._globalListeners.delete(callback);
  },

  getAllSnapshots() {
    const snapshots = {};
    for (const [name, machine] of this._machines) {
      snapshots[name] = machine.getSnapshot();
    }
    return snapshots;
  },

  findInState(state) {
    const result = [];
    for (const [name, machine] of this._machines) {
      if (machine.is(state)) {
        result.push({ name, machine });
      }
    }
    return result;
  },

  resetAll() {
    for (const machine of this._machines.values()) {
      machine.reset();
    }
  },

  remove(llmName) {
    this._machines.delete(llmName);
  }
};

const getDispatchFlags = (llmName, entry = null) => {
  const machine = DispatchStateManager.get(llmName);
  const isSent = machine.isOneOf(DISPATCH_STATES.WAITING, DISPATCH_STATES.STREAMING, DISPATCH_STATES.DONE);
  const isInFlight = machine.isOneOf(DISPATCH_STATES.ACTIVATING, DISPATCH_STATES.TYPING, DISPATCH_STATES.SUBMITTING);
  return {
    machine,
    state: machine.state,
    isSent,
    isInFlight,
    isQueued: machine.is(DISPATCH_STATES.QUEUED),
    isTerminal: machine.isTerminal(),
    isInProgress: machine.isInProgress(),
    entry
  };
};

const syncDispatchEntryFromMachine = (llmName, entry, machineOverride = null) => {
  const machine = machineOverride || DispatchStateManager.get(llmName);
  if (!entry || !machine) return;
  const flags = getDispatchFlags(llmName);
  entry.dispatchState = flags.state;
  entry.messageSent = flags.isSent;
  entry.dispatchInFlight = flags.isInFlight;
  if (machine.data?.dispatchId) {
    entry.dispatchId = machine.data.dispatchId;
  }
};

DispatchStateManager.onAnyTransition((event) => {
  if (typeof jobState === 'undefined' || !jobState?.llms) return;
  const entry = jobState.llms[event.llmName];
  if (!entry) return;
  syncDispatchEntryFromMachine(event.llmName, entry);
});

self.DISPATCH_STATES = DISPATCH_STATES;
self.DispatchStateMachine = DispatchStateMachine;
self.DispatchStateManager = DispatchStateManager;
self.getDispatchFlags = getDispatchFlags;
self.syncDispatchEntryFromMachine = syncDispatchEntryFromMachine;

globalThis.LLMLog?.debug?.('[DispatchStateMachine] Module loaded');
