const fs = require('fs');
const path = require('path');

const SOURCE = fs.readFileSync(
  path.join(__dirname, '..', 'results', 'response-find-replace.js'),
  'utf8'
);

function loadModule(markup) {
  document.body.innerHTML = markup;
  delete window.ResponseFindReplace;
  const install = new Function(
    'window', 'document', 'Node', 'NodeFilter', 'InputEvent', 'CustomEvent', SOURCE
  );
  install(window, document, window.Node, window.NodeFilter, window.InputEvent, window.CustomEvent);
  document.dispatchEvent(new window.Event('DOMContentLoaded'));
  return window.ResponseFindReplace;
}

describe('response find and replace', () => {
  test('keeps the selected answer scope when Ctrl+F is dispatched by the document', () => {
    const api = loadModule('<div class="llm-panel" id="panel-gpt"><div class="output" id="output-gpt">alpha beta</div></div>');
    const output = document.getElementById('output-gpt');
    const range = document.createRange();
    range.selectNodeContents(output);
    window.getSelection().removeAllRanges();
    window.getSelection().addRange(range);

    document.dispatchEvent(new window.Event('selectionchange'));
    document.dispatchEvent(new window.KeyboardEvent('keydown', {
      key: 'f', ctrlKey: true, bubbles: true, cancelable: true
    }));

    const panel = document.getElementById('response-find-replace-panel');
    expect(panel).not.toBeNull();
    expect(panel.hidden).toBe(false);
    panel.querySelector('[name="find"]').value = 'alpha';
    panel.querySelector('[name="replace"]').value = 'gamma';
    panel.querySelector('[name="find"]').dispatchEvent(new window.Event('input', { bubbles: true }));
    api.replaceAll();

    expect(output.textContent).toBe('gamma beta');
  });

  test('reacquires a response card after its output node is replaced', () => {
    const api = loadModule('<div class="llm-panel" id="panel-gpt"><div class="output" id="output-gpt">old answer</div></div>');
    const output = document.getElementById('output-gpt');
    api.open(output);
    const replacement = document.createElement('div');
    replacement.className = 'output';
    replacement.id = 'output-gpt';
    replacement.textContent = 'fresh answer';
    output.replaceWith(replacement);

    const panel = document.getElementById('response-find-replace-panel');
    panel.querySelector('[name="find"]').value = 'fresh';
    panel.querySelector('[name="replace"]').value = 'updated';
    panel.querySelector('[name="find"]').dispatchEvent(new window.Event('input', { bubbles: true }));
    api.replaceAll();

    expect(replacement.textContent).toBe('updated answer');
  });
});
