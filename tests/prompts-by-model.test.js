const TransportPolicy = require('../shared/transport-policy');
const fs = require('fs');
const path = require('path');

describe('TransportPolicy promptsByModel', () => {
  test('sanitizePromptsByModel rejects non-object inputs', () => {
    expect(TransportPolicy.sanitizePromptsByModel(null)).toBeNull();
    expect(TransportPolicy.sanitizePromptsByModel(undefined)).toBeNull();
    expect(TransportPolicy.sanitizePromptsByModel('GPT')).toBeNull();
    expect(TransportPolicy.sanitizePromptsByModel(['GPT'])).toBeNull();
  });

  test('sanitizePromptsByModel normalizes model names and drops blank text', () => {
    expect(TransportPolicy.sanitizePromptsByModel({
      ' gpt ': 'Prompt A',
      Claude: '  Prompt B  ',
      Gemini: '   ',
      Qwen: 42,
      ' ': 'ignored'
    })).toEqual({
      GPT: 'Prompt A',
      CLAUDE: '  Prompt B  '
    });
  });

  test('sanitizePromptsByModel returns null for an empty usable map', () => {
    expect(TransportPolicy.sanitizePromptsByModel({
      GPT: '',
      Claude: '   '
    })).toBeNull();
  });

  test('resolvePromptForModel uses mapped prompt with case-insensitive lookup', () => {
    const map = TransportPolicy.sanitizePromptsByModel({
      CLAUDE: 'Claude prompt',
      gpt: 'GPT prompt'
    });

    expect(TransportPolicy.resolvePromptForModel(map, 'Claude', 'fallback')).toBe('Claude prompt');
    expect(TransportPolicy.resolvePromptForModel(map, ' gPt ', 'fallback')).toBe('GPT prompt');
  });

  test('resolvePromptForModel falls back for misses, null maps, and blank mapped values', () => {
    expect(TransportPolicy.resolvePromptForModel(null, 'Claude', 'fallback')).toBe('fallback');
    expect(TransportPolicy.resolvePromptForModel({ GPT: 'GPT prompt' }, 'Claude', 'fallback')).toBe('fallback');
    expect(TransportPolicy.resolvePromptForModel({ CLAUDE: '   ' }, 'Claude', 'fallback')).toBe('fallback');
  });

  test('background resolves the model prompt at the actual dispatch boundary', () => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'background', 'job-orchestrator.js'), 'utf8');
    const round1 = source.slice(
      source.indexOf('async function dispatchRound1Sequentially'),
      source.indexOf('async function verifyRound2Sequentially')
    );
    expect(round1).toContain('const modelPrompt = resolvePromptForDispatch(llmName, prompt);');
    expect(round1).toContain("dispatchPromptToTab(llmName, tabId, modelPrompt, attachments, 'round1'");
    expect(source).toContain("resolvePromptForDispatch(llmName, jobState.prompt), jobState.attachments || [], 'round2_repair'");
  });

  test('round1 uses the simple ordered dispatch path', () => {
    const orchestrator = fs.readFileSync(path.join(__dirname, '..', 'background', 'job-orchestrator.js'), 'utf8');
    const coordinator = fs.readFileSync(path.join(__dirname, '..', 'background', 'dispatch-coordinator.js'), 'utf8');
    expect(orchestrator).toContain('simpleFirstPass: true');
    expect(orchestrator).toContain('postSendMs: ROUND1_POST_SEND_MS');
    expect(orchestrator).not.toContain('progressFocusExtensionMs: ROUND1_PROGRESS_FOCUS_EXTENSION_MS');
    expect(coordinator).toContain("emitTelemetry(llmName, 'DISPATCH_POST_COMMAND_FOCUS_HOLD'");
    expect(coordinator).toContain('waitForPromptFocusBoundary(');
    expect(coordinator).toContain('insertionWaiter');
  });

  test('global-state answer recovery also settles the active Debate batch', () => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'results.js'), 'utf8');
    const syncBlock = source.slice(
      source.indexOf('function syncStatusFromGlobalState'),
      source.indexOf('// --- END STATUS INDICATOR LOGIC ---')
    );
    // Recovery settles only the request it belongs to, through the same
    // delivery filter as a live answer.
    expect(syncBlock).toContain('if (entry?.finalStatusRecorded && entry?.transportRequestId)');
    expect(syncBlock).toContain('transportRequestId: entry.transportRequestId');
    expect(syncBlock).toContain('window.MessageDelivery.receive(recovered, { final: true })');
    expect(syncBlock).toContain("type: 'LLM_FINAL_RESPONSE'");
    expect(syncBlock).toContain("source: 'GLOBAL_STATE_ANSWER_RECOVERY'");
    expect(syncBlock).toContain('pipelineWaiter.handleFinal');
  });
});
