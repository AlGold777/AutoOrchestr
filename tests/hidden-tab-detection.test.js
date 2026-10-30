/** @jest-environment node */
// L-34: dispatch detects a hidden tab or locked screen via document.visibilityState,
// emits tab_hidden_detected and a warning, and never blocks or throws into the send path.
const fs = require('fs');
const vm = require('vm');
const source = fs.readFileSync(require.resolve('../background/dispatch-coordinator'), 'utf8');

const start = source.indexOf('const TAB_VISIBILITY_PROBE_TIMEOUT_MS');
const end = source.indexOf('async function dispatchPromptToTab(', start);
if (start < 0 || end < 0) throw new Error('visibility helper block not found');
const block = source.slice(start, end);

function load({ executeScript, timeoutMs } = {}) {
  const telemetry = [];
  const diagnostics = [];
  const context = {
    console,
    setTimeout,
    clearTimeout,
    Promise,
    Error,
    document: { visibilityState: 'hidden', hidden: true },
    chrome: {
      scripting: {
        executeScript: executeScript || (async ({ func }) => [{ result: func() }])
      }
    },
    emitTelemetry: (llmName, event, payload) => telemetry.push({ llmName, event, payload }),
    broadcastDiagnostic: (llmName, entry) => diagnostics.push({ llmName, entry }),
    result: null
  };
  vm.createContext(context);
  vm.runInContext(block, context);
  return { context, telemetry, diagnostics };
}

const flush = () => new Promise((resolve) => setImmediate(resolve));

describe('L-34 hidden tab detection', () => {
  test('hidden tab emits tab_hidden_detected and a warning', async () => {
    const { context, telemetry, diagnostics } = load();
    context.checkTabVisibilityForDispatch('DeepSeek', 42, { dispatchId: 'd1' });
    await flush();
    expect(telemetry).toHaveLength(1);
    expect(telemetry[0]).toMatchObject({
      llmName: 'DeepSeek',
      event: 'tab_hidden_detected',
      payload: { level: 'warning', details: 'hidden', meta: { tabId: 42, visibilityState: 'hidden', hidden: true, dispatchId: 'd1' } }
    });
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].llmName).toBe('DeepSeek');
    expect(diagnostics[0].entry.label).toBe('Экран заблокирован или вкладка скрыта: ответы моделей могут не приходить');
    expect(diagnostics[0].entry.level).toBe('warning');
  });

  test('visible tab emits nothing', async () => {
    const { context, telemetry, diagnostics } = load();
    context.document.visibilityState = 'visible';
    context.document.hidden = false;
    context.checkTabVisibilityForDispatch('Gemini', 7);
    await flush();
    expect(telemetry).toHaveLength(0);
    expect(diagnostics).toHaveLength(0);
  });

  test('probe failure is silent and does not throw', async () => {
    const { context, telemetry, diagnostics } = load({
      executeScript: async () => { throw new Error('no access to tab'); }
    });
    expect(() => context.checkTabVisibilityForDispatch('Claude', 9)).not.toThrow();
    await flush();
    expect(telemetry).toHaveLength(0);
    expect(diagnostics).toHaveLength(0);
  });

  test('probe that never answers times out without blocking the caller', async () => {
    const { context, telemetry } = load({
      executeScript: () => new Promise(() => {})
    });
    const probe = context.probeTabVisibility(3);
    const state = await probe;
    expect(state).toBeNull();
    expect(telemetry).toHaveLength(0);
  });
});
