const fs = require('fs');
const source = fs.readFileSync(require.resolve('../content-scripts/content-chatgpt'), 'utf8');
const utils = fs.readFileSync(require.resolve('../content-scripts/content-utils'), 'utf8');
const extract = (from, to) => source.slice(source.indexOf(from), source.indexOf(to, source.indexOf(from)));
const prepareSource = extract('        const resolveLiveComposer', '        activity.heartbeat(0.35');
const readSource = extract('  const normalizeForComparison', '  const setNativeValue');

beforeEach(() => {
  delete window.ContentUtils;
  window.eval(utils);
  document.body.innerHTML = '<div contenteditable="true"></div>';
});

async function prepare(input, prompt) {
  const report = jest.fn();
  window.ContentUtils.reportPromptInsertion = report;
  // Execute the real adapter block, including its final full-text check.
  const asyncFn = new (Object.getPrototypeOf(async function(){}).constructor)(
    'inputField', 'prompt', 'inputSelectors', 'isElementInteractable', 'fastSetPrompt', 'MODEL', 'dispatchMeta',
    `${readSource}\n${prepareSource}\nreturn inputField;`);
  return { field: await asyncFn(input, prompt, ['[contenteditable="true"]'], () => true,
    jest.fn(), 'GPT', { dispatchId: 'GPT:1:1' }), report };
}

test('GPT preserves a 24828-character prompt when the controlled editor replaces its node', async () => {
  const old = document.querySelector('div');
  const prompt = 'Start\n' + 'x'.repeat(24817) + '\nEnd.';
  const previous = document.execCommand;
  document.execCommand = jest.fn((cmd, _, text) => {
    if (cmd === 'insertText') {
      const next = document.createElement('div');
      next.setAttribute('contenteditable', 'true');
      next.textContent = text;
      old.replaceWith(next);
    }
    return true;
  });
  try {
    const { field, report } = await prepare(old, prompt);
    expect(field).not.toBe(old);
    expect(field.textContent).toBe(prompt);
    expect(report).toHaveBeenCalledWith('GPT', expect.anything(), expect.objectContaining({ state: 'inserted' }));
  } finally { document.execCommand = previous; }
});

test('GPT refuses a composer that retains only the first 20000 characters', async () => {
  const input = document.querySelector('div');
  const prompt = 'x'.repeat(24828);
  const previous = document.execCommand;
  document.execCommand = jest.fn((cmd, _, text) => { input.textContent = text.slice(0, 20000); return true; });
  try {
    await expect(prepare(input, prompt)).rejects.toMatchObject({ type: 'prompt_injection_failed' });
  } finally { document.execCommand = previous; }
});
