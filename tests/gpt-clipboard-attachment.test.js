const fs = require('fs');
const path = require('path');

const HANDLER_SRC = fs.readFileSync(
  path.join(__dirname, '..', 'content-scripts', 'attachment-handler.js'),
  'utf8'
);
const GPT_SRC = fs.readFileSync(
  path.join(__dirname, '..', 'content-scripts', 'content-chatgpt.js'),
  'utf8'
);
const BRIDGE_SRC = fs.readFileSync(
  path.join(__dirname, '..', 'content-scripts', 'content-bridge.js'),
  'utf8'
);
const ORCHESTRATOR_SRC = fs.readFileSync(
  path.join(__dirname, '..', 'background', 'job-orchestrator.js'),
  'utf8'
);

describe('GPT attachment isolation', () => {
  test('GPT never pastes file contents into the prompt composer', () => {
    const gptConfig = HANDLER_SRC.slice(HANDLER_SRC.indexOf('GPT: {'), HANDLER_SRC.indexOf('Grok: {'));
    expect(gptConfig).toContain("strategies: ['drop', 'input']");
    expect(gptConfig).not.toContain("'paste'");
    expect(gptConfig).not.toContain("'clipboard'");
    expect(HANDLER_SRC).toContain('const baselineState = captureUploadBaseline(config)');
  });

  test('unconfirmed attachment blocks the prompt instead of sending without the file', () => {
    expect(GPT_SRC).toContain("type: 'attachment_failed'");
    expect(GPT_SRC).toContain('GPT attachment upload not confirmed');
    expect(ORCHESTRATOR_SRC).toContain('unsafe_prompt_modal|attachment_failed');
  });

  test('synthetic drop always closes the drag lifecycle', () => {
    expect(HANDLER_SRC).toContain("['dragleave', 'dragend']");
    expect(GPT_SRC).not.toContain('async function attachFilesToComposer');
    expect(BRIDGE_SRC).toContain("['dragleave', 'dragend']");
    expect(HANDLER_SRC.slice(HANDLER_SRC.indexOf('GPT: {'), HANDLER_SRC.indexOf('Grok: {')))
      .toContain('finishDragLifecycle: true');
    expect(BRIDGE_SRC).toContain('Qwen consumes drop asynchronously');
  });
});
