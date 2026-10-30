/** @jest-environment node */
const fs = require('fs');
const vm = require('vm');
const read = name => fs.readFileSync(require.resolve(`../content-scripts/content-${name}.js`), 'utf8');
// Explicit boundaries fail loudly if the adapter is reorganized.
function section(source, start, end) {
  const a = source.indexOf(start);
  const b = source.indexOf(end, a + start.length);
  if (a < 0 || b < 0) throw new Error('Adapter gate boundaries changed');
  return source.slice(a, b);
}
const prompt = 'a'.repeat(150) + ' middle ' + 'z'.repeat(150);
test('GPT does not confirm Send merely because the composer is empty', async () => {
  const code = section(read('chatgpt'), '        const confirmChatgptSend =', '        let sendButton =');
  let now = 0;
  const confirm = vm.runInNewContext(code + '\nconfirmChatgptSend;', {
    Date: { now: () => now }, sleep: async ms => { now += ms; },
    inputField: { value: '' }, preSendUserCount: 1,
    userTurnSelector: '[data-message-author-role="user"], [data-user-message-bubble="true"]',
    document: { querySelector: () => null, querySelectorAll: () => [{}] },
    grabLatestAssistantMarkup: () => ({ node: null, text: '' })
  });
  await expect(confirm()).resolves.toBe(false);
});
test.each(['', prompt.slice(0, 120), 'old draft ' + prompt, 'a'.repeat(150) + 'z'.repeat(150)])(
  'GPT blocks Send for incomplete or contaminated draft %#', draft => {
    const send = jest.fn();
    const report = jest.fn();
    const code = section(read('chatgpt'), '        const composerAfterPrepare =', '        activity.heartbeat(0.35');
    const inputField = { isConnected: true };
    const context = { inputField, prepared: { ok: true, method: 'fixture', composer: inputField }, expectedComposerText: prompt,
      normalizeForComparison: s => s, readComposerValue: () => draft, prompt,
      preparedRecently: false, hasPreparedPrompt: false, MODEL: 'GPT', dispatchMeta: {},
      window: { ContentUtils: { reportPromptInsertion: report } }, send };
    expect(() => vm.runInNewContext(code + '\nsend();', context)).toThrow();
    expect(send).not.toHaveBeenCalled();
    expect(report.mock.calls[0][2].state).toBe('failed');
  }
);
test('GPT accepts the full live draft but rejects a detached composer', () => {
  const code = section(read('chatgpt'), '        const composerAfterPrepare =', '        activity.heartbeat(0.35');
  const send = jest.fn();
  const inputField = { isConnected: true };
  const c = { inputField, prepared: { ok: true, method: 'fixture', composer: inputField }, expectedComposerText: prompt, prompt,
    normalizeForComparison: s => s, readComposerValue: () => prompt, preparedRecently: false,
    hasPreparedPrompt: false, MODEL: 'GPT', dispatchMeta: {}, window: {}, send };
  vm.runInNewContext(code + '\nsend();', c);
  expect(send).toHaveBeenCalledTimes(1);
  c.inputField.isConnected = false;
  expect(() => vm.runInNewContext(code + '\nsend();', c)).toThrow();
  expect(send).toHaveBeenCalledTimes(1);
});
test('Claude verifies the entire live draft and blocks Send on a negative verdict', () => {
  const matcher = section(read('claude'), '  const composerHasPromptHead =', '  const forceComposerValue =');
  const c = { normalizeComposerText: s => s, readComposerValue: e => e.text };
  const match = vm.runInNewContext(matcher + '\ncomposerHasPromptHead;', c);
  expect(match({ isConnected: true, text: prompt }, prompt)).toBe(true);
  for (const text of ['', prompt.slice(0, 120), 'old ' + prompt]) {
    expect(match({ isConnected: true, text }, prompt)).toBe(false);
  }
  expect(match({ isConnected: false, text: prompt }, prompt)).toBe(false);
  const gate = section(read('claude'), '        if (!composerConfirmed) {', '        // 2.81.117:');
  const send = jest.fn();
  expect(() => vm.runInNewContext(gate + '\nsend();', { composerConfirmed: false, send })).toThrow();
  expect(send).not.toHaveBeenCalled();
});
