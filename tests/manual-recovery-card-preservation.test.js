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

test('an empty payload from Get It or the indicator double-click keeps the answer the card shows', () => {
  const output = { textContent: 'Full answer already on the card', dataset: {} };
  const panel = { querySelector: () => output };
  const logs = [];
  const c = vm.createContext({
    document: { getElementById: () => panel },
    ingestLogs: (_model, entries) => logs.push(...entries),
    makeLocalDiagEntry: (label) => ({ label }),
    sanitizeInlineHtml: () => { throw new Error('rendered'); }
  });
  const start = source.indexOf('    function updateLLMPanelOutput');
  const end = source.indexOf('\n    }\n', start) + 6;
  vm.runInContext(source.slice(start, end), c);
  for (const answer of ['', '   ', null, { text: '', html: '' }]) {
    expect(c.updateLLMPanelOutput('Claude', answer, '', {})).toMatchObject({ updated: false, emptyPayloadIgnored: true });
  }
  expect(output.textContent).toBe('Full answer already on the card');
  expect(logs.map((entry) => entry.label)).toContain('Panel output kept');
  // A real answer still goes on to render.
  expect(() => c.updateLLMPanelOutput('Claude', 'New answer', '', {})).toThrow('rendered');
});
