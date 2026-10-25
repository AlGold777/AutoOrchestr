// Results-page harness for end-to-end card tests. Copied from tests/results-debate-favorites.test.js
// (installChromeStorageMock, installDomMocks, renderDebateDom, loadResultsScript) with the REAL
// results-shared.js, DOMPurify and utils/sanitize.js loaded, as on the real page.
const fs = require('fs');
const path = require('path');

const delay = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));

function installChromeStorageMock() {
  const store = new Map();
  chrome.runtime.getURL = jest.fn((value) => value);
  chrome.storage.local.get = jest.fn((key, callback) => {
    let result = {};
    if (key === null) {
      store.forEach((value, storeKey) => { result[storeKey] = value; });
    } else if (typeof key === 'string') {
      result = { [key]: store.get(key) };
    } else if (Array.isArray(key)) {
      key.forEach((item) => { result[item] = store.get(item); });
    } else {
      Object.keys(key || {}).forEach((item) => {
        result[item] = store.has(item) ? store.get(item) : key[item];
      });
    }
    if (typeof callback === 'function') {
      callback(result);
      return undefined;
    }
    return Promise.resolve(result);
  });
  chrome.storage.local.set = jest.fn((obj, callback) => {
    Object.entries(obj || {}).forEach(([key, value]) => store.set(key, value));
    if (typeof callback === 'function') callback();
    return Promise.resolve();
  });
}

function installDomMocks() {
  window.ResultsShared = {
    escapeHtml: (value = '') => String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
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
      payload = [];
    }
    return {
      ok: true,
      json: async () => payload
    };
  });
  document.execCommand = jest.fn();
  window.requestAnimationFrame = (callback) => setTimeout(callback, 0);
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

function renderDebateDom() {
  document.body.innerHTML = `
    <div class="prompt-container prompt-sandwich debate-composer has-debate-feed">
      <div class="debate-sel-toolbar" id="debateSelTb">
        <button type="button" data-more="1" aria-expanded="false">⌄</button>
        <button class="stb" data-clear-highlight="1" aria-label="Remove highlight">No colour</button>
        <button class="stb col" data-color="#fde68a" aria-label="Yellow highlight">Yellow</button>
        <button class="stb col" data-color="#bbf7d0" aria-label="Green highlight">Green</button>
        <button class="stb col" data-color="#bfdbfe" aria-label="Blue highlight">Blue</button>
        <button class="stb" data-cmd="bold" aria-label="Bold">Bold</button>
        <button class="stb" data-cmd="italic" aria-label="Italic">Italic</button>
        <button class="stb" data-fav="1" aria-label="Add selected fragment to favorites">Favorite</button>
        <div class="selection-toolbar-extra" hidden>
          <button type="button" data-block="left">Left</button>
          <button type="button" data-block="center">Center</button>
          <button type="button" data-block="right">Right</button>
          <button type="button" data-block="list">List</button>
          <button type="button" data-block="outdent">Outdent</button>
          <button type="button" data-block="indent">Indent</button>
        </div>
      </div>
      <div class="debate-session-bar" id="debate-session-bar">
        <span class="debate-session-bar-hit">Debate</span>
        <div id="debate-session-tabs">
          <button type="button" class="debate-session-tab active" data-session-id="1">1</button>
        </div>
      </div>
      <div class="llm-buttons">
        <button class="llm-button" id="llm-gpt">GPT</button>
        <button class="llm-button" id="llm-gemini">Gemini</button>
        <button class="llm-button" id="llm-claude">Claude</button>
        <button class="llm-button" id="llm-grok">Grok</button>
        <button class="llm-button" id="llm-lechat">Le Chat</button>
        <button class="llm-button" id="llm-qwen">Qwen</button>
        <button class="llm-button" id="llm-deepseek">DeepSeek</button>
        <button class="llm-button" id="llm-perplexity">Perplexity</button>
      </div>
      <div class="llm-panel" id="panel-gemini">
        <span class="llm-title">Gemini</span>
        <span class="status-indicator" data-llm-name="Gemini"></span>
        <div class="output" id="output-gemini"></div>
      </div>
      <button id="debate-session-add-btn" type="button">+</button>
      <button id="debate-session-delete-btn" type="button">−</button>
      <button id="debate-full-answers-btn" type="button" aria-pressed="true"><i></i></button>
      <button id="debate-session-fullscreen-btn" type="button" aria-expanded="false"><i class="ti ti-maximize"></i></button>
      <button id="debate-session-copy-btn" type="button">copy</button>
      <button id="debate-session-export-btn" type="button">export</button>
      <button id="debate-session-clear-btn" type="button">clear</button>
      <button id="debate-auto-pause-btn" class="hidden" type="button">Ⅱ</button>
      <select id="debate-run-policy-select">
        <option value="manual" selected>Manual</option>
        <option value="auto">Auto</option>
      </select>
      <select id="debate-length-select">
        <option value="300">300</option>
        <option value="500" selected>500</option>
        <option value="700">700</option>
      </select>
      <button id="debate-auto-toggle-btn" type="button">Auto off</button>
      <input id="auto-checkbox" type="checkbox" hidden aria-hidden="true">
      <button id="get-it-button" type="button">Get it</button>
      <input id="new-pages-checkbox" type="checkbox" checked>
      <select id="mod-sender-select">
        <option value="Moderator" selected>Moderator</option>
      </select>
      <span id="direction-icon">→</span>
      <select id="mod-receiver-select">
        <option value="">All models</option>
        <option value="__none__" selected>None</option>
      </select>
      <select id="mod-role-select">
        <option value="">Role</option>
      </select>
      <div id="mod-message-body"></div>
      <div id="mod-mini-prompts"></div>
      <button type="button" id="debate-run-toggle-btn" aria-label="Run debate">Run</button>
      <label class="debate-select-wrap" id="debate-round-limit-wrap">
        <select id="debate-round-limit-select">
          <option value="1">1 round</option>
          <option value="2">2 rounds</option>
          <option value="3" selected>3 rounds</option>
          <option value="5">5 rounds</option>
          <option value="infinite">∞</option>
        </select>
      </label>
      <input id="debate-max-turns-input" type="number" value="6" hidden aria-hidden="true">
      <div id="pipeline-panel">
        <span id="currentPipelineName" class="pipeline-name">Universal</span><div class="entry-point" id="entryPoint">▶</div>
        <button type="button" id="pipeline-add-round-btn">+</button>
        <button type="button" id="removeRoundBtn">−</button>
        <button type="button" id="pipeline-add-btn">+</button><button type="button" id="pipeline-save-btn">Save</button><button type="button" id="pipeline-import-btn">Import</button><button type="button" id="pipeline-export-all-btn">Export all</button><button type="button" id="pipeline-profile-btn">Paste</button>
        <div class="stage-column" id="round1" data-round="1">
          <div class="model-stack" id="r1-models">
            <div class="model-block">
              <span class="model-name">GPT</span>
              <input type="checkbox" class="model-input-checkbox" checked>
              <input type="checkbox" class="model-send-checkbox" checked>
            </div>
            <div class="model-block">
              <span class="model-name">Claude</span>
              <input type="checkbox" class="model-input-checkbox">
              <input type="checkbox" class="model-send-checkbox" checked>
            </div>
          </div>
        </div>
        <div class="connector-group" data-round="2">
          <svg class="connector-svg" id="svg-r1-r2"></svg>
        </div>
        <div class="stage-column" id="round2" data-round="2">
          <div class="model-stack" id="r2-models"></div>
        </div>
        <div id="insertionPoint"></div>
        <div class="pipeline-items" id="pipelineItems">
          <div class="pipeline-item active" data-name="Research & Analysis">
            <input type="radio" name="pipeline" class="pipeline-radio" checked>
            <span class="pipeline-item-name" title="Research & Analysis">Research & Anal...</span>
          </div>
          <div class="pipeline-item" data-name="Content Gen">
            <input type="radio" name="pipeline" class="pipeline-radio">
            <span class="pipeline-item-name" title="Content Gen">Content Gen</span>
          </div>
          <div class="pipeline-item" data-name="Idea Validation">
            <input type="radio" name="pipeline" class="pipeline-radio">
            <span class="pipeline-item-name" title="Idea Validation">Idea Validation</span>
          </div>
        </div>
        <div class="pipeline-items-divider"></div>
        <div class="customer-pipeline-items" id="customerPipelineItems"></div>
      </div>
      <div id="prompt-pasted-text-bar" hidden></div>
      <textarea id="modTa"></textarea>
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
      <dialog class="pipeline-stage-dialog owner-ask-dialog" id="owner-ask-dialog" aria-labelledby="owner-ask-title">
        <header class="pipeline-stage-dialog-header"><h2 id="owner-ask-title">Вопрос User</h2></header>
        <p class="owner-ask-hint" id="owner-ask-hint"></p>
        <div class="pipeline-stage-card" id="owner-ask-list"></div>
        <div class="owner-ask-actions">
          <button type="button" data-owner-ask="answer">Ответить и продолжить</button>
          <button type="button" data-owner-ask="skip">Продолжить без ответа</button>
          <button type="button" data-owner-ask="later">Позже</button>
        </div>
      </dialog>
    </div>
  `;
}


async function loadResultsScript(seededPipelineStore = null) {
  installChromeStorageMock();
  // A seeded store plays the part of what a previous page load left in chrome.storage.
  if (seededPipelineStore) chrome.storage.local.set({ llmComparatorPipelines: seededPipelineStore });
  installDomMocks();
  // Real shared helpers and sanitizer (the favorites test mocks them).
  const realShared = window.ResultsShared;
  window.eval(fs.readFileSync(path.join(__dirname, '..', '..', 'results-shared.js'), 'utf8'));
  window.ResultsShared = { ...window.ResultsShared, fallbackCopyViaTextarea: realShared.fallbackCopyViaTextarea, flashButtonFeedback: realShared.flashButtonFeedback, writeRichContentToClipboard: realShared.writeRichContentToClipboard };
  window.eval(fs.readFileSync(path.join(__dirname, '..', '..', 'lib', 'purify.min.js'), 'utf8'));
  window.eval(fs.readFileSync(path.join(__dirname, '..', '..', 'utils', 'sanitize.js'), 'utf8'));
  window.eval(fs.readFileSync(path.join(__dirname, '..', '..', 'shared', 'markdown-to-html.js'), 'utf8'));
  window.__RESULTS_TEST_DEBUG__ = true;
  window.eval(fs.readFileSync(path.join(__dirname, '..', '..', 'shared', 'status-contract.js'), 'utf8'));
  window.eval(fs.readFileSync(path.join(__dirname, '..', '..', 'shared', 'answer-proof-normalization.js'), 'utf8'));
  const pipelineRuntime = fs.readFileSync(path.join(__dirname, '..', '..', 'pipeline', 'pipeline-runtime.js'), 'utf8');
  window.eval(pipelineRuntime);
  window.eval(fs.readFileSync(path.join(__dirname, '..', '..', 'shared', 'transport-policy.js'), 'utf8'));
  const debateEngine = fs.readFileSync(path.join(__dirname, '..', '..', 'disput', 'debate-engine.js'), 'utf8');
  window.eval(debateEngine);
  // DebateFSM is the explicit serial-debate state machine results.js init depends on.
  window.eval(fs.readFileSync(path.join(__dirname, '..', '..', 'disput', 'debate-runtime.js'), 'utf8'));
  window.eval(fs.readFileSync(path.join(__dirname, '..', '..', 'disput', 'debate-run-store.js'), 'utf8'));
  window.eval(fs.readFileSync(path.join(__dirname, '..', '..', 'disput', 'debate-trace-schema.js'), 'utf8'));
  window.eval(fs.readFileSync(path.join(__dirname, '..', '..', 'disput', 'debate-trace-store.js'), 'utf8'));
  window.eval(fs.readFileSync(path.join(__dirname, '..', '..', 'disput', 'debate-trace-projections.js'), 'utf8'));
  window.eval(fs.readFileSync(path.join(__dirname, '..', '..', 'disput', 'debate-draft-plan.js'), 'utf8'));
  window.eval(fs.readFileSync(path.join(__dirname, '..', '..', 'disput', 'debate-projections.js'), 'utf8'));
  window.eval(fs.readFileSync(path.join(__dirname, '..', '..', 'disput', 'debate-prompt-catalog.js'), 'utf8'));
  window.eval(fs.readFileSync(path.join(__dirname, '..', '..', 'disput', 'pipeline-presets.js'), 'utf8'));
  // The same order as pipeline_panel.html: the modules the engine uses come before it.
  ['stage-markers', 'basic-output', 'basic-artifacts', 'custom-engine', 'basic-schema', 'schema-text-reader', 'custom-run-record'].filter((mod) => fs.existsSync(path.join(__dirname, '..', '..', 'disput', `${mod}.js`))).forEach((mod) => { window.eval(fs.readFileSync(path.join(__dirname, '..', '..', 'disput', `${mod}.js`), 'utf8')); });
  ['boot-utils', 'dom-utils', 'code-blocks', 'attachments', 'pasted-text', 'tooltips', 'debate-ui', 'debate-transport', 'debate-controller', 'debate-renderer', 'debate-sessions-store', 'debate-export', 'debate-telemetry-view'].forEach((mod) => { window.eval(fs.readFileSync(path.join(__dirname, '..', '..', 'results', `${mod}.js`), 'utf8')); });
  window.eval(fs.readFileSync(path.join(__dirname, '..', '..', 'utils', 'selection-block-format.js'), 'utf8'));
  window.eval(fs.readFileSync(path.join(__dirname, '..', '..', 'results', 'owner-ask.js'), 'utf8'));
  const script = fs.readFileSync(path.join(__dirname, '..', '..', 'results.js'), 'utf8');
  window.eval(script);
  document.dispatchEvent(new Event('DOMContentLoaded', { bubbles: true }));
  await delay(20);
}


module.exports = { delay, installChromeStorageMock, installDomMocks, renderDebateDom, loadResultsScript };