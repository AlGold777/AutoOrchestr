const fs = require('fs');
const path = require('path');

const delay = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));

function renderBootstrapDom({ pipelinePage = false } = {}) {
  window.history.replaceState(null, '', pipelinePage ? '/pipeline_panel.html' : '/result_new.html');
  document.body.className = pipelinePage ? 'pipeline-page' : '';
  const promptId = pipelinePage ? 'modTa' : 'prompt-input';
  document.body.innerHTML = `
    <div class="app-main prompt-sandwich">
      <div class="debate-sel-toolbar" id="debateSelTb"></div>
      <div id="debate-session-tabs">
        <button type="button" class="debate-session-tab active" data-session-id="1">1</button>
      </div>
      <div class="llm-buttons">
        <button class="llm-button" id="llm-gpt">GPT</button>
      </div>
      <button id="debate-session-add-btn" type="button">+</button>
      <button id="debate-session-delete-btn" type="button">−</button>
      <button id="debate-session-copy-btn" type="button">copy</button>
      <button id="debate-session-export-btn" type="button">export</button>
      <button id="debate-session-clear-btn" type="button">clear</button>
      <div id="pipeline-panel"></div>
      ${pipelinePage ? `
        <section id="pipeline-modifiers-section" hidden></section>
        <button id="pipeline-toggle-modifiers-btn" type="button"></button>
        <div id="pipeline-modifiers-container"></div>
        <div id="mod-mini-prompts"></div>
      ` : ''}
      <div id="prompt-pasted-text-bar" hidden></div>
      <textarea id="${promptId}"></textarea>
      <div id="modifiers-header"></div>
      <div id="modifiers-row"></div>
      <div id="modifiers-container"></div>
      <div id="prefix-cards-container"></div>
      <div id="secondary-prefix-cards-container"></div>
      <div id="suffix-cards-container"></div>
      <div id="secondary-suffix-cards-container"></div>
      <div id="debate-model-cards"></div>
      <div id="create-template-modal" class="modal">
        <button class="close" type="button">x</button>
        <div class="model-selector"></div>
      </div>
      <select id="template-select"></select>
      <button id="cancel-template" type="button"></button>
      <button id="save-template" type="button"></button>
      <button id="add-variable" type="button"></button>
      <input id="template-name">
      <textarea id="template-prompt"></textarea>
      <div id="template-preview"></div>
      <div id="variables-list"></div>
      <div id="saved-templates-list"></div>
      <div id="system-templates-list"></div>
      <div id="saved-templates-box"></div>
      <button id="saved-templates-toggle" type="button"></button>
      <div id="saved-templates-content"></div>
      <div id="system-templates-box"></div>
      <button id="system-templates-toggle" type="button"></button>
      <div id="system-templates-content"></div>
      <div id="variable-inputs"></div>
      <button id="export-templates-btn" type="button"></button>
      <button id="import-templates-btn" type="button"></button>
      <input id="import-file-input" type="file">
      <div id="confirm-modal" class="modal"></div>
      <div id="confirm-message"></div>
      <button id="delete-confirm" type="button"></button>
      <button id="cancel-confirm" type="button"></button>
      <div id="notification-modal" class="modal"></div>
      <div id="notification-message"></div>
      <button id="notification-ok-btn" type="button"></button>
      <input id="file-input" type="file">
      <div id="file-name-display"></div>
    </div>
  `;
}

function installMocks() {
  delete window.__RESULTS_PAGE_LOADED;
  chrome.runtime.getURL = jest.fn((value) => value);
  chrome.runtime.sendMessage = jest.fn((message, callback) => {
    if (typeof callback === 'function') callback({ ok: true });
    return Promise.resolve({ ok: true });
  });
  chrome.storage.local._store.clear();
  chrome.storage.local.get = jest.fn((key, callback) => {
    let result = {};
    if (key === null) {
      chrome.storage.local._store.forEach((value, k) => { result[k] = value; });
    } else if (typeof key === 'string') {
      result = { [key]: chrome.storage.local._store.get(key) };
    } else if (Array.isArray(key)) {
      key.forEach((k) => { result[k] = chrome.storage.local._store.get(k); });
    } else {
      Object.keys(key || {}).forEach((k) => {
        result[k] = chrome.storage.local._store.get(k) ?? key[k];
      });
    }
    if (typeof callback === 'function') callback(result);
    return Promise.resolve(result);
  });
  chrome.storage.local.set = jest.fn((obj, callback) => {
    Object.entries(obj || {}).forEach(([k, v]) => {
      chrome.storage.local._store.set(k, v);
    });
    if (typeof callback === 'function') callback();
    return Promise.resolve();
  });
  chrome.storage.local.remove = jest.fn((keys, callback) => {
    (Array.isArray(keys) ? keys : [keys]).forEach((k) => chrome.storage.local._store.delete(k));
    if (typeof callback === 'function') callback();
    return Promise.resolve();
  });

  window.ResultsShared = {
    escapeHtml: (value = '') => String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/\"/g, '&quot;')
      .replace(/'/g, '&#39;'),
    stripHtmlToPlainText: (html = '') => String(html).replace(/<[^>]*>/g, ''),
    buildResponseCopyHtmlBlock: () => '',
    wrapResponsesHtmlBundle: (sections = '') => sections,
    fallbackCopyViaTextarea: jest.fn(),
    flashButtonFeedback: jest.fn(),
    writeRichContentToClipboard: jest.fn()
  };

  window.fetch = jest.fn(async (url = '') => {
    const pathValue = String(url);
    let payload = { templates: [] };
    if (pathValue.includes('system_templates/index.json')) {
      payload = [];
    } else if (pathValue.includes('Modifiers/modifier-presets.json')) {
      payload = [{ id: 'base', label: 'Base', file: 'modifiers.json' }];
    } else if (pathValue.includes('disput/pipeline-actions.json')) {
      payload = [
        { id: 'harden', label: 'Harden Critique', type: 'suffix', text: 'Attack the previous thesis harder. Find a logical flaw or false assumption.', order: 10, groupLabel: 'Action' },
        { id: 'compare', label: 'Compare by Criteria', type: 'suffix', text: 'Build a comparative table: cost, complexity, risks, scalability.', order: 20, groupLabel: 'Action' }
      ];
    } else if (pathValue.includes('Modifiers/modifiers.json')) {
      payload = [
        {
          id: 'mod-a',
          label: 'A',
          groupLabel: 'Group A',
          order: 1,
          defaultSelected: true
        },
        {
          id: 'mod-b',
          label: 'B',
          groupLabel: 'Group A',
          order: 2,
          defaultSelected: true
        }
      ];
    }
    return {
      ok: true,
      json: async () => payload
    };
  });

  document.execCommand = jest.fn();
  window.requestAnimationFrame = (callback) => setTimeout(callback, 0);
  window.scrollBy = jest.fn();

  Object.defineProperty(window.Range.prototype, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({
      width: 120,
      height: 20,
      top: 20,
      left: 20,
      right: 140,
      bottom: 40,
      x: 20,
      y: 20,
      toJSON() { return this; }
    })
  });

  Object.defineProperty(window.HTMLElement.prototype, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({
      width: 640,
      height: 320,
      top: 0,
      left: 0,
      right: 640,
      bottom: 320,
      x: 0,
      y: 0,
      toJSON() { return this; }
    })
  });
}

async function loadResultsScript() {
  const pipelineRuntime = fs.readFileSync(path.join(__dirname, '..', 'pipeline', 'pipeline-runtime.js'), 'utf8');
  window.eval(pipelineRuntime);
  const domContentLoadedListeners = [];
  const originalAddEventListener = document.addEventListener.bind(document);
  document.addEventListener = (type, listener, options) => {
    if (type === 'DOMContentLoaded') {
      domContentLoadedListeners.push({ listener, options });
    }
    return originalAddEventListener(type, listener, options);
  };
  // DebateFSM is the explicit serial-debate state machine results.js init depends on.
  window.eval(fs.readFileSync(path.join(__dirname, '..', 'disput', 'debate-runtime.js'), 'utf8'));
  ['boot-utils', 'dom-utils', 'attachments', 'pasted-text', 'tooltips', 'debate-sessions-store', 'debate-export'].forEach((mod) => { window.eval(fs.readFileSync(path.join(__dirname, '..', 'results', `${mod}.js`), 'utf8')); });
  const script = fs.readFileSync(path.join(__dirname, '..', 'results.js'), 'utf8');
  window.eval(script);
  document.addEventListener = originalAddEventListener;
  document.dispatchEvent(new Event('DOMContentLoaded', { bubbles: true }));
  await delay(320);
  domContentLoadedListeners.forEach(({ listener, options }) => {
    document.removeEventListener('DOMContentLoaded', listener, options);
  });
}

describe('modifier bootstrap reset', () => {
  beforeEach(() => {
    renderBootstrapDom();
    installMocks();
  });

  test('refresh clears stored selections and does not restore them in the UI', async () => {
    chrome.storage.local._store.set('llmComparatorSelected', ['mod-a', 'mod-b']);
    chrome.storage.local._store.set('llmComparatorSelectedByPreset', { base: ['mod-a', 'mod-b'] });
    chrome.storage.local._store.set('llmComparatorSelectedByPresetPipeline', { base: ['mod-a', 'mod-b'] });
    const removeSpy = jest.spyOn(chrome.storage.local, 'remove');

    await loadResultsScript();

    const checked = Array.from(document.querySelectorAll('input[data-mod-id]'))
      .filter((checkbox) => checkbox.checked)
      .map((checkbox) => checkbox.dataset.modId);

    expect(checked).toEqual([]);
    expect(removeSpy).toHaveBeenCalled();
    expect(chrome.storage.local._store.has('llmComparatorSelected')).toBe(false);
    expect(chrome.storage.local._store.has('llmComparatorSelectedByPreset')).toBe(false);
    expect(chrome.storage.local._store.has('llmComparatorSelectedByPresetPipeline')).toBe(false);
  });

  test('cross-view navigation preserves prompt, model buttons, and modifier selections', async () => {
    renderBootstrapDom({ pipelinePage: true });
    installMocks();
    const now = Date.now();
    chrome.storage.local._store.set('llmComparatorSelectedByPresetPipeline', { base: ['mod-b'] });
    chrome.storage.local._store.set('llmComparatorSelectedModelsByView.pipeline', ['llm-gpt']);
    chrome.storage.local._store.set('llmComparatorCrossViewNavigationIntent', {
      sourceView: 'main',
      targetView: 'pipeline',
      savedAt: now
    });
    chrome.storage.local._store.set('llmComparatorCrossViewUiState', {
      version: 2,
      savedAt: now,
      views: {
        main: {},
        pipeline: {
          savedAt: now,
          promptText: 'draft prompt survives view switch',
          modifiers: {
            presetId: 'base',
            selectedIds: ['mod-b'],
            customText: {}
          },
          formControls: {}
        }
      },
      shared: {}
    });
    const removeSpy = jest.spyOn(chrome.storage.local, 'remove');

    await loadResultsScript();

    expect(document.getElementById('modTa').value).toBe('draft prompt survives view switch');
    expect(document.getElementById('llm-gpt').classList.contains('active')).toBe(true);
    expect(chrome.storage.local._store.get('llmComparatorSelectedByPresetPipeline')).toEqual({ base: ['mod-b'] });
    expect(chrome.storage.local._store.has('llmComparatorCrossViewNavigationIntent')).toBe(false);
    expect(removeSpy).not.toHaveBeenCalledWith(expect.arrayContaining([
      'llmComparatorSelected',
      'llmComparatorSelectedByPreset',
      'llmComparatorSelectedByPresetPipeline'
    ]));
  });

  test('Pipeline action hydration restores a chip-only cross-view draft', async () => {
    renderBootstrapDom({ pipelinePage: true });
    installMocks();
    const now = Date.now();
    const text = 'Restored Pipeline document\n'.repeat(140);
    chrome.storage.local._store.set('llmComparatorCrossViewNavigationIntent', {
      sourceView: 'main', targetView: 'pipeline', savedAt: now
    });
    chrome.storage.local._store.set('llmComparatorCrossViewUiState', {
      version: 2, savedAt: now,
      views: { main: {}, pipeline: {
        promptText: text,
        pastedText: { version: 1, visibleText: '', chips: [{ text, offset: 0, name: 'Pasted text 1.txt' }] },
        formControls: {}
      } },
      shared: {}
    });

    await loadResultsScript();

    expect(document.getElementById('pipeline-modifiers-container').querySelectorAll('input[data-mod-id]')).toHaveLength(8);
    expect(document.getElementById('modTa').value).toBe('');
    expect(document.querySelectorAll('.pasted-text-chip')).toHaveLength(1);
    document.querySelector('.pasted-text-open').click();
    expect(document.querySelector('.pasted-text-editor').value).toBe(text);
    document.querySelector('.pasted-text-dialog-actions button').click();
    expect(chrome.storage.local._store.get('llmComparatorCrossViewUiState').views.pipeline.promptText).toBe(text);
  });
});
