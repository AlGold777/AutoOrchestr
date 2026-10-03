/** @jest-environment node */
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const root = path.join(__dirname, '..');
const viewerHtml = fs.readFileSync(path.join(root, 'response-viewer.html'), 'utf8');
const viewerScript = fs.readFileSync(path.join(root, 'response-viewer.js'), 'utf8');
const purifierScript = fs.readFileSync(path.join(root, 'lib/purify.min.js'), 'utf8');

describe('response viewer feed', () => {
  let dom;
  let viewer;
  let closeDom;
  let receive;
  let render;

  beforeEach(() => {
    dom = new JSDOM(viewerHtml, { url: 'https://viewer.test/', runScripts: 'outside-only' });
    viewer = dom.window;
    closeDom = viewer.close.bind(viewer);
    viewer.close = jest.fn();
    viewer.chrome = { runtime: { sendMessage: jest.fn(), onMessage: { addListener: (listener) => { receive = listener; } } } };
    viewer.eval(purifierScript);
    viewer.eval(viewerScript);
    render = (payload) => receive({ type: 'RESPONSE_VIEWER_SET_CONTENT', ...payload });
  });

  afterEach(() => closeDom());

  test('renders full cards and round labels while removing unsafe content and inactive controls', () => {
    render({
      view: 'debate-feed', model: 'Debate feed',
      html: '<div class="debate-model-card"><div class="debate-model-card-title-main">GPT <span class="debate-model-card-round">R2</span></div><div contenteditable="true"><h1>Debate feed</h1><p>Full answer</p><button>Copy</button><input type="checkbox"><script>throw new Error("unsafe")</script></div></div>'
    });
    const content = viewer.document.getElementById('viewer-content');
    expect(content.querySelector('.debate-model-card-round').textContent).toBe('R2');
    expect(content.querySelector('h1').textContent).toBe('Debate feed');
    expect(content.textContent).toContain('Full answer');
    expect(content.querySelector('button, input, script, [contenteditable]')).toBeNull();
    expect(viewer.document.title).toBe('Debate feed');
  });

  test('Escape closes the popup through the existing close path', () => {
    render({ view: 'debate-feed', text: 'Answer' });
    viewer.document.dispatchEvent(new viewer.KeyboardEvent('keydown', { key: 'Escape' }));
    expect(viewer.chrome.runtime.sendMessage).toHaveBeenCalledWith({ type: 'RESPONSE_VIEWER_CLOSE' });
    expect(viewer.close).toHaveBeenCalledTimes(1);
  });

  test('clicking outside the native popup closes it when it loses focus', () => {
    render({ view: 'debate-feed', text: 'Answer' });
    viewer.dispatchEvent(new viewer.Event('blur'));
    viewer.dispatchEvent(new viewer.Event('blur'));
    expect(viewer.close).toHaveBeenCalledTimes(1);
    expect(viewer.chrome.runtime.sendMessage).toHaveBeenCalledWith({ type: 'RESPONSE_VIEWER_CLOSE' });
  });

  test('keeps the existing single-answer heading behavior and closes only feeds on blur', () => {
    render({ model: 'GPT', html: '<h1>GPT</h1><p>Original answer</p>' });
    viewer.dispatchEvent(new viewer.Event('blur'));
    expect(viewer.close).not.toHaveBeenCalled();
    expect(viewer.document.getElementById('viewer-content').querySelector('h1')).toBeNull();
    expect(viewer.document.title).toBe('GPT response');
  });

  test('live updates preserve the position of a reader scrolling through earlier cards', () => {
    const shell = viewer.document.getElementById('viewer-shell');
    Object.defineProperty(shell, 'scrollHeight', { configurable: true, value: 2000 });
    Object.defineProperty(shell, 'clientHeight', { configurable: true, value: 600 });
    render({ view: 'debate-feed', html: '<p>First answer</p>' });
    shell.scrollTop = 250;
    render({ view: 'debate-feed', html: '<p>First answer</p><p>Continuation</p>' });
    expect(shell.scrollTop).toBe(250);
    expect(viewer.document.getElementById('viewer-content').textContent).toContain('Continuation');
  });

  test('a delayed stored snapshot cannot overwrite a newer delivered feed', async () => {
    viewer.history.replaceState(null, '', '?viewerId=race');
    let resolveStored;
    viewer.chrome.storage = { session: { get: jest.fn(() => new Promise((resolve) => { resolveStored = resolve; })) } };
    viewer.eval(viewerScript);
    render({ view: 'debate-feed', html: '<p>New answer</p>' });
    resolveStored({ 'llmResponseViewer.race': { view: 'debate-feed', html: '<p>Old answer</p>' } });
    await Promise.resolve();
    expect(viewer.document.getElementById('viewer-content').textContent).toBe('New answer');
  });
});
