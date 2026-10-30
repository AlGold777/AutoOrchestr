const fs = require('fs');
const path = require('path');

const read = (...parts) => fs.readFileSync(path.join(__dirname, '..', ...parts), 'utf8');

describe('provider dispatch stage telemetry', () => {
  test('Grok and Perplexity publish full composer, insertion and send stages', () => {
    for (const file of ['content-grok.js', 'content-perplexity.js']) {
      const source = read('content-scripts', file);
      expect(source).toContain("reportStage('composer_transaction_started')");
      expect(source).toContain("reportStage('composer_ready'");
      expect(source).toContain("reportStage('prompt_insertion_started')");
      expect(source).toContain("reportStage('send_action_requested')");
      expect(source).toContain("reportStage('send_action_completed'");
    }
  });

  test.each([
    'content-chatgpt.js',
    'content-claude.js',
    'content-deepseek.js',
    'content-gemini.js',
    'content-lechat.js',
    'content-qwen.js'
  ])('%s publishes the physical Send boundary', (file) => {
    const source = read('content-scripts', file);
    expect(source).toContain("'send_action_requested'");
    expect(source).toContain("'send_action_completed'");
  });

  test('stage messages require bound-tab and dispatch correlation', () => {
    const router = read('background', 'message-router.js');
    expect(router).toContain("case 'PROVIDER_DISPATCH_STAGE_OBSERVED'");
    expect(router).toContain("validateLifecycleSender(llmName, sender, 'PROVIDER_DISPATCH_STAGE_OBSERVED'");
    expect(router).toContain("validateLifecycleCorrelation(llmName, message, 'PROVIDER_DISPATCH_STAGE_OBSERVED')");
  });

  test('send-only recovery is exact, provider-neutral and never reinserts the prompt', () => {
    const coordinator = read('background', 'dispatch-coordinator.js');
    const router = read('background', 'message-router.js');
    const grok = read('content-scripts', 'content-grok.js');
    const perplexity = read('content-scripts', 'content-perplexity.js');
    expect(router).toContain("stage === 'prompt_inserted' || stage === 'send_action_failed'");
    expect(coordinator).toContain("type: 'RECOVER_PROVIDER_SEND'");
    expect(coordinator).toContain('liveDispatchId !== dispatchId');
    expect(grok).toContain("msg?.type === 'RECOVER_PROVIDER_SEND'");
    expect(grok).toContain("reason: 'visible_composer_prompt_mismatch'");
    expect(perplexity).toContain("message?.type === 'RECOVER_PROVIDER_SEND'");
    expect(perplexity).toContain('findOwnedPerplexityPromptComposer(prompt)');
    expect(perplexity).toContain("reason: 'visible_current_composer_prompt_mismatch'");
    expect(perplexity).toContain('const ownedPromptComposer = findLivePromptComposer()');
    expect(perplexity).toContain('inputField = ownedPromptComposer');
  });
});
