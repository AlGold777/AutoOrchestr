const fs = require('fs');
const vm = require('vm');
test.each(['qwen', 'grok', 'lechat'])('%s preserves prose, sources and literal code', provider => {
  const source = fs.readFileSync(require.resolve(`../content-scripts/content-${provider}`), 'utf8');
  const a = source.indexOf('  class ContentCleaner {');
  const b = source.indexOf('  const contentCleaner = new ContentCleaner();', a);
  if (a < 0 || b <= a) throw new Error('Cleaner boundaries changed');
  const cleaner = vm.runInNewContext(source.slice(a, b) + '\nnew ContentCleaner();', { DOMParser, document, console });
  const text = 'Today at 12:30, Copy the Qwen and Alibaba links.\nhttps://example.org/docs?q=1&x=2\n\n```html\n<button>Save</button>\n<!-- literal comment -->\n```\n\n```python\nif ready:\n    print("Search &nbsp; Menu")\n```';
  expect(cleaner.clean(text)).toBe(text);
  expect(cleaner.getStats().charactersRemoved).toBe(0);
  expect(cleaner.clean('<p>Copy https://example.org</p>', { format: 'html' })).toBe('Copy https://example.org');
});

test('chatgpt keeps model names, prose, links and indentation of the answer', () => {
  const source = fs.readFileSync(require.resolve('../content-scripts/content-chatgpt'), 'utf8');
  const a = source.indexOf('  class ContentCleaner {');
  const b = source.indexOf('  window.contentCleaner = new ContentCleaner();', a);
  if (a < 0 || b <= a) throw new Error('Cleaner boundaries changed');
  const cleaner = vm.runInNewContext(source.slice(a, b) + '\nnew ContentCleaner();', { DOMParser, document, console, Date, window: {} });
  const text = '{"refs":["cycle=1 step=2 model=GPT"]}\nGPT-5 and ответ GPT: Search the docs, Copy https://example.org/a?b=1 at 12:30.\n```python\nif ready:\n    print("Edit &nbsp;")\n```';
  expect(cleaner.cleanContent(text)).toBe(text);
  expect(cleaner.cleanContent('<p>ответ GPT</p>', { format: 'html' })).toBe('ответ GPT');
  expect(cleaner.getCleaningStats().charactersRemoved).toBe(0);
});

const answerText = model => `{"refs":["cycle=1 step=2 model=${model}"]}\nClaude, GPT and DeepSeek answer: Search the docs, Copy https://example.org/a?b=1 at 12:30 Today.\n\`\`\`python\nif ready:\n    print("Edit &nbsp;")\n\`\`\``;

test.each([
  ['claude', '  class ContentCleaner {', '  const contentCleaner = new ContentCleaner();', 'clean', 'getStats', 'Claude'],
  ['deepseek', '  class ContentCleaner {', '  const contentCleaner = new ContentCleaner();', 'clean', 'getStats', 'DeepSeek'],
  ['gemini', 'class ContentCleaner {', 'window.contentCleaner = new ContentCleaner();', 'cleanContent', 'getCleaningStats', 'GPT'],
  ['perplexity', 'class ContentCleaner {', 'window.contentCleaner = new ContentCleaner();', 'cleanContent', 'getCleaningStats', 'Claude']
])('%s keeps model names, links, time and indentation of the answer', (provider, start, end, method, stats, model) => {
  const source = fs.readFileSync(require.resolve(`../content-scripts/content-${provider}`), 'utf8');
  const a = source.indexOf(start);
  const b = source.indexOf(end, a);
  if (a < 0 || b <= a) throw new Error('Cleaner boundaries changed');
  const cleaner = vm.runInNewContext(source.slice(a, b) + '\nnew ContentCleaner();', { DOMParser, document, console, Date, window: {} });
  const text = answerText(model);
  expect(cleaner[method](text)).toBe(text);
  expect(cleaner[method]('<p>ответ GPT</p>', { format: 'html' })).toBe('ответ GPT');
  expect(cleaner[stats]().charactersRemoved).toBe(0);
});
