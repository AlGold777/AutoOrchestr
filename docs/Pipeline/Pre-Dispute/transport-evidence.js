// content-scripts/transport-evidence.js
// Collects the provider's own stream lifecycle for the run currently in flight
// and turns it into ladder signals.
//
// This is the P0/P1 witness. It answers two questions the DOM cannot: has the
// producer stopped (as opposed to the renderer having caught up), and is a
// stream for this turn still delivering frames — the fact that vetoes an
// otherwise convincing pile of DOM evidence.
//
// Correlation here is causal ordering plus the provider's generation endpoint,
// not a provider-issued request id, and it says so: `correlationMethod` travels
// with every signal and caps the guarantee below strict.

(function initTransportEvidence(root) {
  'use strict';

  const CORRELATION_METHOD = 'causal_order';

  class TransportRunObserver {
    constructor(platform, options = {}) {
      this.platform = platform || null;
      this.llmName = options.llmName || null;
      this.installed = false;
      this.hasGenerationContract = false;
      this.unsubscribe = null;
      this.parseFailures = 0;
      this.lastSignalAt = 0;
      this.runStartedAt = 0;
      this.dispatchId = null;
      this.streams = new Map();
      this.terminal = null;
      this.lastError = null;
      this.unobservableCount = 0;
      this.attach();
    }

    attach() {
      const state = root.humanoidFetchMonitorState?.() || null;
      this.installed = !!state?.injected;
      this.hasGenerationContract = !!state?.hasGenerationContract;
      if (typeof root.onHumanoidStreamEvent !== 'function') {
        this.installed = false;
        return;
      }
      this.unsubscribe = root.onHumanoidStreamEvent((event) => this.ingest(event));
    }

    detach() {
      try { this.unsubscribe?.(); } catch (_) {}
      this.unsubscribe = null;
    }

    // A run boundary, not a reset: streams that belong to an earlier turn stay
    // out of this run's evidence rather than being reinterpreted for it.
    beginRun(input = {}) {
      this.runStartedAt = Number(input.startedAt) || Date.now();
      this.dispatchId = input.dispatchId || null;
      this.streams = new Map();
      this.terminal = null;
      this.lastError = null;
      this.unobservableCount = 0;
      return this;
    }

    ingest(event = {}) {
      if (!event || event.kind !== 'stream') return;
      const at = Number(event.at) || Date.now();
      this.lastSignalAt = at;
      const streamId = event.streamId || null;
      // Anything that started before this run belongs to a previous turn.
      if (this.runStartedAt && at < this.runStartedAt && !this.streams.has(streamId)) return;
      if (!streamId) return;

      const record = this.streams.get(streamId) || {
        streamId,
        url: event.url || null,
        method: event.method || null,
        requestedAt: at,
        startedAt: null,
        firstChunkAt: null,
        endedAt: null,
        open: false,
        bytes: 0,
        chunkCount: 0,
        terminal: null,
        error: null,
        unobservable: false
      };

      switch (event.phase) {
        case 'request':
          record.requestedAt = at;
          record.open = true;
          break;
        case 'start':
          record.startedAt = at;
          record.open = true;
          break;
        case 'first_chunk':
          record.firstChunkAt = at;
          record.open = true;
          break;
        case 'terminal_marker':
          record.terminal = {
            kind: event.markerKind || 'stream_done_token',
            finishReason: event.finishReason || null,
            terminalReason: event.terminalReason || 'UNKNOWN',
            at
          };
          this.terminal = Object.assign({ streamId }, record.terminal);
          break;
        case 'end':
          record.endedAt = at;
          record.open = false;
          record.bytes = Number(event.bytes) || record.bytes;
          record.chunkCount = Number(event.chunkCount) || record.chunkCount;
          if (event.terminalMarkerSeen && !record.terminal) {
            record.terminal = {
              kind: event.markerKind || 'stream_done_token',
              finishReason: event.finishReason || null,
              terminalReason: event.terminalReason || 'UNKNOWN',
              at
            };
            this.terminal = Object.assign({ streamId }, record.terminal);
          }
          break;
        case 'error':
          record.open = false;
          record.error = event.error || `status_${event.status || 0}`;
          this.lastError = record.error;
          this.parseFailures += 1;
          break;
        case 'unobservable':
          record.open = false;
          record.unobservable = true;
          this.unobservableCount += 1;
          break;
        default:
          break;
      }

      this.streams.set(streamId, record);
    }

    runStreams() {
      const streams = [];
      this.streams.forEach((record) => {
        if (!this.runStartedAt || record.requestedAt >= this.runStartedAt) streams.push(record);
      });
      return streams;
    }

    isStreamOpen() {
      return this.runStreams().some((record) => record.open === true);
    }

    // The transport channel's own health, in the shape ObserverHealth expects.
    observerInput(options = {}) {
      return {
        installed: this.installed && this.hasGenerationContract,
        parseFailures: this.parseFailures,
        lastSignalAt: this.lastSignalAt || null,
        expectSignals: options.expectSignals === true,
        silenceLimitMs: options.silenceLimitMs,
        // A stream we were told about but could not read is a capability loss,
        // not a quiet provider.
        schemaMismatch: this.unobservableCount > 0
      };
    }

    snapshot(options = {}) {
      const streams = this.runStreams();
      const open = streams.some((record) => record.open === true);
      const ended = streams.filter((record) => record.endedAt && !record.open);
      const signals = [];
      const contradictions = [];

      // Causal ordering identifies the turn's stream only while there is one
      // generation request in the window. With two or more, this observer
      // cannot say which stream produced the text on the page, and a terminal
      // marker from the wrong one would prove the wrong answer complete. So
      // the evidence is dropped rather than attributed to the likelier stream:
      // an ambiguous witness is not a weak witness.
      const ambiguous = streams.length > 1;
      const correlated = !ambiguous;
      const correlationMethod = ambiguous ? 'ambiguous' : CORRELATION_METHOD;

      if (this.terminal) {
        signals.push({
          kind: this.terminal.kind,
          correlated,
          correlationMethod,
          at: this.terminal.at,
          meta: {
            finishReason: this.terminal.finishReason,
            terminalReason: this.terminal.terminalReason,
            streamId: this.terminal.streamId,
            dispatchId: this.dispatchId
          }
        });
      }
      if (!open && ended.length) {
        signals.push({
          kind: 'stream_closed',
          correlated,
          correlationMethod,
          at: ended[ended.length - 1].endedAt,
          meta: { streamCount: ended.length, dispatchId: this.dispatchId }
        });
      }
      if (open) {
        contradictions.push({
          kind: 'stream_open',
          detail: 'a generation stream for this run is still delivering frames'
        });
      }

      return {
        schemaVersion: 1,
        platform: this.platform,
        dispatchId: this.dispatchId,
        available: this.installed && this.hasGenerationContract,
        ambiguousCorrelation: ambiguous,
        streamOpen: open,
        streamCount: streams.length,
        endedStreamCount: ended.length,
        unobservableCount: this.unobservableCount,
        bytes: streams.reduce((sum, record) => sum + (record.bytes || 0), 0),
        chunkCount: streams.reduce((sum, record) => sum + (record.chunkCount || 0), 0),
        terminal: this.terminal ? Object.assign({}, this.terminal) : null,
        terminalReason: ambiguous ? null : (this.terminal?.terminalReason || null),
        correlationMethod,
        lastError: this.lastError,
        signals,
        contradictions,
        observerInput: this.observerInput(options)
      };
    }
  }

  const instances = new Map();

  function forPlatform(platform, options = {}) {
    const key = String(platform || 'generic');
    if (!instances.has(key)) {
      instances.set(key, new TransportRunObserver(key, options));
    }
    return instances.get(key);
  }

  const api = Object.freeze({
    CORRELATION_METHOD,
    TransportRunObserver,
    forPlatform,
    reset() {
      instances.forEach((instance) => instance.detach());
      instances.clear();
    }
  });

  root.TransportEvidence = api;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
