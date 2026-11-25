const fs = require('fs');
const load = file => { eval(fs.readFileSync(require.resolve(file), 'utf8')); };

beforeEach(() => {
  delete window.ContentUtils;
  delete window.kimiContentScriptLoaded;
  delete window.BaseLLMAdapter;
  document.body.replaceChildren();
  chrome.runtime.id = 'test-extension';
});
afterEach(() => {
  delete window.ContentUtils;
  delete window.LLMExtension;
  delete window.ResponseLifecycleDetector;
  delete window.UnifiedAnswerPipeline;
  delete window.kimiContentScriptLoaded;
  delete window.DataTransfer;
  delete window.ClipboardEvent;
});

test.each([true, false])('baseline and authority acknowledgements overlap but both must succeed (%s)', async authorityOk => {
  let authorityAck, baselineAck;
  window.ResponseLifecycleDetector = {
    captureTurnAnchor: () => 2,
    startResponseLifecycleTracking: jest.fn(() => new Promise(resolve => { authorityAck = resolve; }))
  };
  chrome.runtime.sendMessage = jest.fn((message, callback) => {
    if (message.type === 'DISPATCH_BASELINE_CAPTURED') baselineAck = callback;
  });
  load('../content-scripts/content-utils');
  let finished = false;
  const preflight = window.ContentUtils.reportDispatchBaseline('Kimi', { dispatchId:'d1', runSessionId:1 }, 'old answer')
    .then(result => { finished = true; return result; });
  expect(typeof authorityAck).toBe('function');
  expect(typeof baselineAck).toBe('function');
  baselineAck({status:'dispatch_baseline_ack'});
  await Promise.resolve();
  expect(finished).toBe(false);
  authorityAck({ok:authorityOk});
  expect(await preflight).toBe(authorityOk);
  expect(window.__LLMPreDispatchTurnAnchor.anchorAnswerCount).toBe(2);
});

test('simple first pass captures the old turn before returning without waiting for authority ACKs', async () => {
  let authorityAck, baselineAck;
  window.ResponseLifecycleDetector = {
    captureTurnAnchor: () => 3,
    startResponseLifecycleTracking: () => new Promise(resolve => {authorityAck = resolve;})
  };
  chrome.runtime.sendMessage = (message, cb) => {if (message.type === 'DISPATCH_BASELINE_CAPTURED') baselineAck = cb;};
  load('../content-scripts/content-utils');
  expect(await window.ContentUtils.reportDispatchBaseline('Kimi', {
    dispatchId:'simple-1', runSessionId:1, simpleFirstPass:true
  },'previous answer')).toBe(true);
  expect(window.__LLMPreDispatchTurnAnchor.anchorAnswerCount).toBe(3);
  expect(window.__LLMDispatchPreflight).toMatchObject({ok:false,pending:true});
  baselineAck({status:'dispatch_baseline_ack'});
  authorityAck({ok:false,reason:'authority_unavailable'});
  await new Promise(resolve => setTimeout(resolve,0));
  expect(window.__LLMDispatchPreflight).toMatchObject({ok:false,reason:'authority_unavailable'});
});

test('Kimi sends a complete wrapped prompt when the editor removes its envelope line breaks', async () => {
  const listeners = [];
  const sent = [];
  let delivered;
  const delivery = new Promise(resolve => { delivered = resolve; });
  chrome.runtime.onMessage.addListener = fn => listeners.push(fn);
  chrome.runtime.sendMessage = (message, callback) => {
    sent.push(message);
    callback?.({status:message.type === 'DISPATCH_BASELINE_CAPTURED' ? 'dispatch_baseline_ack' : 'ok'});
    if (message.type === 'LLM_RESPONSE') delivered(message);
    return Promise.resolve({});
  };
  window.ResponseLifecycleDetector = { captureTurnAnchor: () => 0, startResponseLifecycleTracking: async () => ({ok:true}) };
  // jsdom has no clipboard classes. This editor ignores the paste event, so the shared insertion path takes over.
  window.DataTransfer = class { setData() {} };
  window.ClipboardEvent = class extends Event {};
  load('../content-scripts/content-utils');
  window.UnifiedAnswerPipeline = class { async execute() { return {success:true, answer:'2', answerHtml:'<p>2</p>'}; } };
  document.body.innerHTML = '<div class="chat-input-editor" contenteditable="true"></div><div class="send-button-container"></div>';
  document.querySelectorAll('*').forEach(el => { el.getClientRects = () => [{width:100,height:40}]; });
  const editor = document.querySelector('.chat-input-editor');
  const click = jest.fn(() => {
    const user = document.createElement('div'); user.className = 'segment-user'; user.textContent = editor.textContent;
    document.body.append(user); editor.textContent = '';
  });
  document.querySelector('.send-button-container').addEventListener('click', click);
  const oldExec = document.execCommand;
  document.execCommand = jest.fn((command, _, text) => {
    if (command === 'insertText') editor.textContent = text.replace(/\n/g, '');
    return true;
  });
  try {
    load('../content-scripts/content-kimi');
    const prompt = '<Prompt>\n8 / 4 =\n</Prompt>';
    listeners.forEach(fn => fn({type:'GET_ANSWER', prompt, meta:{dispatchId:'d1',runSessionId:1}}, {}, () => {}));
    expect((await delivery).error).toBeFalsy();
    expect(click).toHaveBeenCalledTimes(1);
    expect(sent.some(message => message.type === 'PROMPT_SUBMITTED')).toBe(true);
    expect(sent.some(message => message.type === 'KIMI_TRUSTED_INPUT_REQUEST')).toBe(false);
    expect(document.querySelector('.segment-user').textContent).toBe('<Prompt>8 / 4 =</Prompt>');
    expect(window.ContentUtils.promptMatchesComposer('<Prompt>8 / 5 =</Prompt>', prompt)).toBe(false);
    expect(window.ContentUtils.promptMatchesComposer(prompt + prompt, prompt)).toBe(false);
  } finally { document.execCommand = oldExec; }
});
