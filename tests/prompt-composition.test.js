const fs = require('fs');
const path = require('path');
const vm = require('vm');
const MessageDelivery = require('../shared/message-delivery.js');

const resultsSource = fs.readFileSync(path.join(__dirname, '..', 'results.js'), 'utf8');

function loadPromptComposer({ selectedModifierIds = [], modifiersById = {}, modifierText = {}, liveResponses = '' } = {}) {
  const start = resultsSource.indexOf('    function buildLLMResponsesBlock() {');
  const end = resultsSource.indexOf('\n    startButton?.addEventListener(\'click\', async () => {', start);
  if (start < 0 || end < 0) throw new Error('Prompt composition functions were not found in results.js');

  const context = {
    selectedModifierIds,
    modifiersById,
    getEffectiveModifierText: (modifier) => modifierText[modifier.id] || '',
    collectLLMResponses: () => ({ combinedText: liveResponses }),
    window: {}
  };
  vm.createContext(context);
  vm.runInContext(`${resultsSource.slice(start, end)}\nthis.compose = applySelectedModifiersToPrompt;`, context);
  return context.compose;
}

describe('main prompt composition', () => {
  beforeEach(() => MessageDelivery.reset());
  afterEach(() => MessageDelivery.reset());

  test.each([
    ['a response-looking line in the first line', '=== User supplied heading ===\nKeep all of this prompt.'],
    ['a response-looking line in the middle', 'Keep this introduction.\n=== ordinary user text ===\nKeep this ending.'],
    ['a Markdown thematic break', 'Keep the first paragraph.\n\n===\n\nKeep the last paragraph.']
  ])('preserves the complete user prompt when it contains %s', (_label, prompt) => {
    const compose = loadPromptComposer();
    expect(compose(prompt)).toBe(`<Prompt>\n${prompt}\n</Prompt>`);
  });

  test('preserves a literal LLM Responses tag during ordinary prompt composition', () => {
    const compose = loadPromptComposer();
    const prompt = 'Explain this example:\n<LLM Responses>\nnot a generated response\n</>';
    expect(compose(prompt)).toBe(`<Prompt>\n${prompt}\n</Prompt>`);
  });

  test('keeps modifiers around the full prompt', () => {
    const compose = loadPromptComposer({
      selectedModifierIds: ['prefix', 'suffix'],
      modifiersById: {
        prefix: { id: 'prefix', type: 'prefix', groupLabel: 'Rule' },
        suffix: { id: 'suffix', type: 'suffix', groupLabel: 'Output' }
      },
      modifierText: { prefix: 'Use the provided format.', suffix: 'Be concise.' }
    });
    const prompt = '=== Heading ===\nFull prompt body.';
    expect(compose(prompt)).toBe([
      '<Rule: Use the provided format.>',
      `<Prompt>\n${prompt}\n</Prompt>`,
      '<Output: Be concise.>'
    ].join('\n\n'));
  });

  test('extracts an explicit embedded responses block only when requested, without duplicating it', () => {
    const embedded = '=== GPT ===\nAn existing answer.\nGPT END';
    const prompt = `Summarize this discussion.\n\n<LLM Responses>\n${embedded}\n</>`;
    const composeEmbedded = loadPromptComposer();
    const result = composeEmbedded(prompt, { includeResponses: true });
    expect(result).toBe(`<Prompt>\nSummarize this discussion.\n</Prompt>\n\n<LLM Responses>\n${embedded}\n</>`);
    expect(result.match(/<LLM Responses>/g)).toHaveLength(1);

    const composeWithLiveResponses = loadPromptComposer({ liveResponses: embedded });
    const liveResult = composeWithLiveResponses(prompt, { includeResponses: true });
    expect(liveResult.match(/<LLM Responses>/g)).toHaveLength(1);
    expect(liveResult.match(/An existing answer\./g)).toHaveLength(1);
  });

  test('keeps a plain-text === section as prompt content even when responses are requested', () => {
    const prompt = 'Compare these instructions.\n=== GPT ===\nThis is user-authored text.\nGPT END';
    const compose = loadPromptComposer();
    expect(compose(prompt, { includeResponses: true })).toBe(`<Prompt>\n${prompt}\n</Prompt>`);
  });

  test('keeps a complete prompt through MessageDelivery.prepare for ten models', () => {
    const compose = loadPromptComposer();
    const rawPrompt = '=== User heading ===\nThe request body stays intact.\n\nLiteral <LLM Responses> example.';
    const composed = compose(rawPrompt);
    const models = ['GPT', 'Claude', 'Qwen', 'Z.ai', 'Kimi', 'Gemini', 'Grok', 'DeepSeek', 'Le Chat', 'Perplexity'];
    const prompts = MessageDelivery.prepare({ prompt: composed, models });

    models.forEach((model) => {
      expect(prompts[model]).toContain(`<Prompt>\n${rawPrompt}\n</Prompt>`);
      expect(prompts[model]).toMatch(/\n\nПоследней строкой ответа напиши только метку \[\[AO-[a-z0-9]{6}\]\]$/i);
      expect(prompts[model].indexOf('Последней строкой ответа напиши только метку')).toBeGreaterThan(rawPrompt.length);
    });
  });
});
