/** @jest-environment node */
const fs = require('fs');
const vm = require('vm');
const source = fs.readFileSync(require.resolve('../results'), 'utf8');

test('repeated global snapshots cannot overwrite a manually displayed answer with an old artifact', () => {
  const output = { textContent: 'Full answer recovered from Grok', dataset: {} };
  const c = vm.createContext({
    window: {},
    document: { getElementById: () => ({ querySelector: () => output }) },
    updateLLMPanelOutput: jest.fn((_model, text) => { output.textContent = text; })
  });
  const start = source.indexOf('    function hydrateAnswerFromGlobalState');
  vm.runInContext(source.slice(start, source.indexOf('    const GREEN_SUCCESS_STATUSES', start)), c);
  for (let i = 0; i < 3; i++) {
    expect(c.hydrateAnswerFromGlobalState('Grok', {
      answer: '', unverifiedArtifact: { text: 'Old partial answer' }
    })).toBe(true);
  }
  expect(output.textContent).toBe('Full answer recovered from Grok');
  expect(c.updateLLMPanelOutput).not.toHaveBeenCalled();
  // Clearing the card for a new run still allows snapshot recovery.
  output.textContent = '';
  c.hydrateAnswerFromGlobalState('Grok', { unverifiedArtifact: { text: 'New candidate' } });
  expect(output.textContent).toBe('New candidate');
});

test('manual result uses one rendering entry point for both card views', () => {
  const c = vm.createContext({
    updateLLMPanelOutput: jest.fn(), updateDebateModelCardOutput: jest.fn(),
    manualPingReveal: new Set(['Grok']), setPingButtonState: jest.fn(),
    debateFeedMessageMeta: () => ({}), stashAnswerCopy: jest.fn()
  });
  const start = source.indexOf("case 'MANUAL_PING_RESULT':");
  const end = source.indexOf("case 'SELECTOR_OVERRIDE_CLEARED':", start);
  vm.runInContext(`function receive(message) { switch(message.type) { ${source.slice(start,end)} } }`, c);
  c.receive({type:'MANUAL_PING_RESULT',llmName:'Grok',status:'success',answer:'Full recovered answer'});
  expect(c.updateLLMPanelOutput).toHaveBeenCalledTimes(1);
  expect(c.updateDebateModelCardOutput).not.toHaveBeenCalled();
  expect(c.manualPingReveal.has('Grok')).toBe(false);
});
