/** @jest-environment jsdom */
const fs = require('fs');
const path = require('path');

const CONFIG_SOURCE = fs.readFileSync(
  path.join(__dirname, '..', 'content-scripts', 'pipeline-config.js'), 'utf8'
);
const PIPELINE_SOURCE = fs.readFileSync(
  path.join(__dirname, '..', 'content-scripts', 'unified-answer-pipeline.js'), 'utf8'
);

// Загружает пайплайн и возвращает класс; HumanSessionController записывает конфиг, с которым создан.
function loadPipelineClass(captured) {
  class Dummy { constructor(config) { this.config = config; } start() {} stop() {} }
  class DummyTelemetry { constructor() { this.traceId = 'human-session-ceiling'; } record() {} logPhase() {} }
  class RecordingHumanSession {
    constructor(deps, cfg) { captured.push(cfg); }
    startSession() {}
    stopSession() {}
  }
  window.UnifiedPipelineModules = {
    AdaptiveTimeoutManager: Dummy, coordinationModes: {}, selectMode: () => ({}),
    IntelligentRetryManager: Dummy, ContinuousHumanActivity: Dummy, MaintenanceScroll: Dummy,
    ComprehensiveTelemetry: DummyTelemetry, PerplexityStabilization: Dummy,
    HumanSessionController: RecordingHumanSession
  };
  window.AnswerPipelineSelectors = {
    PLATFORM_SELECTORS: { testmodel: { lastMessage: '.answer', messageRoot: '.answer' }, generic: {} },
    detectPlatform: () => 'testmodel'
  };
  window.AnswerPipeline = { UnifiedAnswerCompletionWatcher: Dummy, SanityCheck: Dummy };
  delete window.UnifiedAnswerPipeline;
  window.eval(PIPELINE_SOURCE);
  return window.UnifiedAnswerPipeline;
}

// Вызывает только _initHumanSession на объекте с нужным конфигом.
function initHumanSessionWith(Pipeline, config) {
  const fake = { config: JSON.parse(JSON.stringify(config)) };
  Pipeline.prototype._initHumanSession.call(fake);
  return fake;
}

describe('HumanSession ceiling follows the lifecycle detector', () => {
  let storageCallback;

  beforeEach(() => {
    delete window.AnswerPipelineConfig;
    delete window.AnswerPipelineTiming;
    delete window.LLMExtension;
    delete window.ResponseLifecycleDetector;
    storageCallback = null;
    global.chrome = {
      storage: {
        local: { get: jest.fn((_key, callback) => { storageCallback = callback; }) },
        onChanged: { addListener: jest.fn() }
      }
    };
    window.eval(CONFIG_SOURCE);
    // Профиль по умолчанию (не long), чтобы адаптивный hardMax не влиял на тест.
    storageCallback && storageCallback({});
  });

  test('ceiling is at least lifecycle wait plus margin when the detector reports 450000 ms', () => {
    window.LLMExtension = { ResponseLifecycleDetector: { completionWaitMs: () => 450000 } };
    const captured = [];
    const Pipeline = loadPipelineClass(captured);
    initHumanSessionWith(Pipeline, window.AnswerPipelineConfig);

    const cfg = captured[captured.length - 1];
    expect(cfg.baseTimeoutMs).toBeGreaterThanOrEqual(455000);
    expect(cfg.hardStopMin).toBe(cfg.baseTimeoutMs);
    expect(cfg.hardStopMax).toBe(cfg.baseTimeoutMs);
    expect(cfg.hardStopAbsoluteMaxMs).toBe(cfg.baseTimeoutMs);
  });

  test('ceiling stays at 180000 when the detector is not loaded', () => {
    const captured = [];
    const Pipeline = loadPipelineClass(captured);
    initHumanSessionWith(Pipeline, window.AnswerPipelineConfig);

    const cfg = captured[captured.length - 1];
    expect(cfg.baseTimeoutMs).toBe(180000);
    expect(cfg.hardStopMin).toBe(180000);
    expect(cfg.hardStopMax).toBe(180000);
    expect(cfg.hardStopAbsoluteMaxMs).toBe(180000);
  });

  test('shared pipeline config is not mutated', () => {
    window.LLMExtension = { ResponseLifecycleDetector: { completionWaitMs: () => 450000 } };
    const captured = [];
    const Pipeline = loadPipelineClass(captured);
    const shared = {
      streaming: { humanSession: { baseTimeoutMs: 1000, hardStopMin: 1000 } }
    };
    const before = JSON.stringify(shared);
    const fake = { config: shared };
    Pipeline.prototype._initHumanSession.call(fake);

    expect(JSON.stringify(shared)).toBe(before);
    const cfg = captured[captured.length - 1];
    expect(cfg).not.toBe(shared.streaming.humanSession);
    expect(cfg.baseTimeoutMs).toBeGreaterThanOrEqual(455000);
  });
});
